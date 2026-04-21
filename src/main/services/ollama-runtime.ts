import { EventEmitter } from 'node:events';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { killProcessTree, spawnHiddenExecutable } from '../../providers/util';
import { LocalOllamaRuntime, type OllamaRuntime, type OllamaTagResponse } from '../../providers/ollama/runtime';
import type { OllamaPullProgress } from '../../shared/domain';
import type { AppEvent } from '../../shared/events';
import type { OllamaModelMutationResult, OllamaRuntimeSnapshot } from '../../shared/ipc';

const MODEL_MUTATION_TIMEOUT_MS = 1000 * 60 * 30;
const MANAGED_START_TIMEOUT_MS = 8_000;
const MANAGED_START_POLL_INTERVAL_MS = 250;

interface OllamaPullStreamChunk {
  status?: string;
  completed?: number;
  total?: number;
  digest?: string;
  error?: string;
}

class OllamaPullStreamError extends Error {
  readonly alreadyReported = true;
}

function extractModelIds(tags: OllamaTagResponse | null) {
  return (tags?.models ?? [])
    .map((entry) => {
      if (typeof entry.name === 'string' && entry.name.trim()) {
        return entry.name.trim();
      }
      if (typeof entry.model === 'string' && entry.model.trim()) {
        return entry.model.trim();
      }
      return null;
    })
    .filter((value): value is string => Boolean(value));
}

export class OllamaRuntimeService implements OllamaRuntime {
  private readonly emitter = new EventEmitter();
  private managedChild: ChildProcessWithoutNullStreams | null = null;
  private starting = false;

  constructor(
    private readonly runtime: OllamaRuntime = new LocalOllamaRuntime(),
    private readonly spawnProcess: typeof spawnHiddenExecutable = spawnHiddenExecutable,
    private readonly killProcess: typeof killProcessTree = killProcessTree
  ) {}

  get baseUrl() {
    return this.runtime.baseUrl;
  }

  fetch(path: string, options?: RequestInit, timeoutMs?: number) {
    return this.runtime.fetch(path, options, timeoutMs);
  }

  listTags() {
    return this.runtime.listTags();
  }

  showModel(model: string) {
    return this.runtime.showModel(model);
  }

  detectInstall() {
    return this.runtime.detectInstall();
  }

  getStatus() {
    return this.runtime.getStatus();
  }

  start(cliPath?: string | null) {
    return this.runtime.start(cliPath);
  }

  async listModels() {
    return extractModelIds(await this.runtime.listTags());
  }

  async getSnapshot(): Promise<OllamaRuntimeSnapshot> {
    const status = await this.runtime.getStatus();
    const managedByApp = this.isManagedChildActive();
    return {
      installed: status.installed,
      reachable: status.reachable,
      cliPath: status.cliPath,
      baseUrl: status.baseUrl,
      models: extractModelIds(status.tags),
      managedByApp,
      canManageProcess: Boolean(status.cliPath),
      canStop: managedByApp,
      starting: this.starting && managedByApp
    };
  }

  async startAndGetSnapshot(cliPath?: string | null) {
    const current = await this.getSnapshot();
    if (current.reachable || current.starting) {
      return current;
    }

    const executable = cliPath ?? current.cliPath;
    if (!executable) {
      await this.runtime.start(cliPath);
      return this.getSnapshot();
    }

    this.starting = true;
    try {
      const child = this.spawnProcess(executable, ['serve']);
      child.stdout.resume();
      child.stderr.resume();
      this.trackManagedChild(child);
      await this.waitForReachable();
      return this.getSnapshot();
    } catch (error) {
      if (this.managedChild) {
        const child = this.managedChild;
        this.managedChild = null;
        await this.killProcess(child);
      }
      throw error;
    } finally {
      this.starting = false;
    }
  }

  async stopAndGetSnapshot() {
    const child = this.managedChild;
    this.starting = false;
    this.managedChild = null;
    if (child) {
      await this.killProcess(child);
    }
    return this.getSnapshot();
  }

  async dispose() {
    await this.stopAndGetSnapshot();
  }

  onEvent(listener: (event: AppEvent) => void) {
    this.emitter.on('event', listener);
    return () => this.emitter.off('event', listener);
  }

  async pullModel(model: string): Promise<OllamaModelMutationResult> {
    this.emitPullProgress({
      model,
      status: `Starting pull for ${model}`,
      completed: null,
      total: null,
      digest: null,
      state: 'running'
    });

    try {
      const response = await this.runtime.fetch(
        '/api/pull',
        {
          method: 'POST',
          body: JSON.stringify({ model })
        },
        MODEL_MUTATION_TIMEOUT_MS
      );

      if (!response.ok) {
        const message = await response.text().catch(() => '');
        const normalized = message.trim() || `Ollama returned HTTP ${response.status} while pulling ${model}.`;
        this.emitPullProgress({
          model,
          status: normalized,
          completed: null,
          total: null,
          digest: null,
          state: 'failed'
        });
        throw new Error(normalized);
      }

      await this.consumePullStream(model, response);

      return {
        model,
        models: await this.listModels()
      };
    } catch (error) {
      const message = error instanceof Error && error.message.trim() ? error.message.trim() : `Unable to pull ${model}.`;
      if (!message.includes('while pulling') && !(error instanceof OllamaPullStreamError)) {
        this.emitPullProgress({
          model,
          status: message,
          completed: null,
          total: null,
          digest: null,
          state: 'failed'
        });
      }
      throw error;
    }
  }

  async deleteModel(model: string): Promise<OllamaModelMutationResult> {
    const response = await this.runtime.fetch('/api/delete', {
      method: 'DELETE',
      body: JSON.stringify({ model })
    });

    if (!response.ok) {
      const message = await response.text().catch(() => '');
      throw new Error(message.trim() || `Ollama returned HTTP ${response.status} while deleting ${model}.`);
    }

    return {
      model,
      models: await this.listModels()
    };
  }

  private emit(event: AppEvent) {
    this.emitter.emit('event', event);
  }

  private emitPullProgress(progress: OllamaPullProgress) {
    this.emit({
      type: 'ollama.pullProgress',
      progress
    });
  }

  private readPullProgressChunk(model: string, chunk: OllamaPullStreamChunk): OllamaPullProgress | null {
    const status =
      typeof chunk.status === 'string' && chunk.status.trim()
        ? chunk.status.trim()
        : typeof chunk.error === 'string' && chunk.error.trim()
          ? chunk.error.trim()
          : null;

    if (!status) {
      return null;
    }

    return {
      model,
      status,
      completed: typeof chunk.completed === 'number' && Number.isFinite(chunk.completed) ? chunk.completed : null,
      total: typeof chunk.total === 'number' && Number.isFinite(chunk.total) ? chunk.total : null,
      digest: typeof chunk.digest === 'string' && chunk.digest.trim() ? chunk.digest.trim() : null,
      state: typeof chunk.error === 'string' && chunk.error.trim() ? 'failed' : status === 'success' ? 'completed' : 'running'
    };
  }

  private async consumePullStream(model: string, response: Response) {
    if (!response.body) {
      const payload = (await response.json().catch(() => ({}))) as OllamaPullStreamChunk;
      const progress =
        this.readPullProgressChunk(model, payload) ??
        ({
          model,
          status: 'success',
          completed: null,
          total: null,
          digest: null,
          state: 'completed'
        } satisfies OllamaPullProgress);
      this.emitPullProgress(progress);
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let lastProgress: OllamaPullProgress | null = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/gu);
      buffer = lines.pop() ?? '';

      for (const line of lines.map((entry) => entry.trim()).filter(Boolean)) {
        const progress = this.readPullProgressChunk(model, JSON.parse(line) as OllamaPullStreamChunk);
        if (!progress) {
          continue;
        }
        lastProgress = progress;
        this.emitPullProgress(progress);
        if (progress.state === 'failed') {
          throw new OllamaPullStreamError(progress.status);
        }
      }
    }

    buffer += decoder.decode();
    const trailing = buffer.trim();
    if (trailing) {
      const progress = this.readPullProgressChunk(model, JSON.parse(trailing) as OllamaPullStreamChunk);
      if (progress) {
        lastProgress = progress;
        this.emitPullProgress(progress);
        if (progress.state === 'failed') {
          throw new OllamaPullStreamError(progress.status);
        }
      }
    }

    if (!lastProgress || lastProgress.state === 'running') {
      this.emitPullProgress({
        model,
        status: lastProgress?.status ?? 'success',
        completed: lastProgress?.completed ?? null,
        total: lastProgress?.total ?? null,
        digest: lastProgress?.digest ?? null,
        state: 'completed'
      });
    }
  }

  private isManagedChildActive() {
    return Boolean(this.managedChild?.pid) && this.managedChild?.exitCode === null && !this.managedChild.killed;
  }

  private trackManagedChild(child: ChildProcessWithoutNullStreams) {
    this.managedChild = child;
    child.once('exit', () => {
      if (this.managedChild === child) {
        this.managedChild = null;
      }
    });
  }

  private async waitForReachable() {
    const startedAt = Date.now();

    while (Date.now() - startedAt < MANAGED_START_TIMEOUT_MS) {
      const status = await this.runtime.getStatus();
      if (status.reachable) {
        return;
      }
      if (!this.isManagedChildActive()) {
        throw new Error('Ollama exited before the local runtime became reachable.');
      }
      await new Promise((resolve) => setTimeout(resolve, MANAGED_START_POLL_INTERVAL_MS));
    }

    throw new Error('Timed out waiting for the Ollama local runtime to become reachable.');
  }
}
