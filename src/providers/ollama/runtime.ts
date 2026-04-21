import { detectCliInstall, launchTerminalExecutable } from '../util';
import type { ProviderInstallStatus } from '../types';

export const DEFAULT_OLLAMA_BASE_URL = 'http://127.0.0.1:11434';
const DEFAULT_REQUEST_TIMEOUT_MS = 2_000;

function createTimedSignal(signal: AbortSignal | null | undefined, timeoutMs: number) {
  const controller = new AbortController();
  const abortFromInput = () => controller.abort();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  if (signal) {
    if (signal.aborted) {
      controller.abort();
    } else {
      signal.addEventListener('abort', abortFromInput, { once: true });
    }
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer);
      if (signal) {
        signal.removeEventListener('abort', abortFromInput);
      }
    }
  };
}

export interface OllamaTagResponse {
  models?: Array<{
    name?: string;
    model?: string;
    details?: {
      families?: string[];
    };
  }>;
}

export interface OllamaShowResponse {
  parameters?: string;
  model_info?: Record<string, unknown>;
}

export interface OllamaRuntimeStatus extends ProviderInstallStatus {
  reachable: boolean;
  baseUrl: string;
  tags: OllamaTagResponse | null;
}

export interface OllamaRuntime {
  readonly baseUrl: string;
  fetch(path: string, options?: RequestInit, timeoutMs?: number): Promise<Response>;
  listTags(): Promise<OllamaTagResponse | null>;
  showModel(model: string): Promise<OllamaShowResponse | null>;
  detectInstall(): Promise<ProviderInstallStatus>;
  getStatus(): Promise<OllamaRuntimeStatus>;
  start(cliPath?: string | null): Promise<void>;
}

export class LocalOllamaRuntime implements OllamaRuntime {
  constructor(
    readonly baseUrl = DEFAULT_OLLAMA_BASE_URL,
    private readonly fetchImpl: typeof globalThis.fetch = globalThis.fetch,
    private readonly detectInstallImpl: typeof detectCliInstall = detectCliInstall,
    private readonly startImpl: typeof launchTerminalExecutable = launchTerminalExecutable
  ) {}

  async fetch(path: string, options?: RequestInit, timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS) {
    const timedSignal = createTimedSignal(options?.signal, timeoutMs);
    try {
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        ...options,
        signal: timedSignal.signal,
        headers: {
          'Content-Type': 'application/json',
          ...(options?.headers ?? {})
        }
      });
      return response;
    } finally {
      timedSignal.cleanup();
    }
  }

  async listTags() {
    try {
      const response = await this.fetch('/api/tags');
      if (!response.ok) {
        return null;
      }

      return (await response.json()) as OllamaTagResponse;
    } catch {
      return null;
    }
  }

  async showModel(model: string) {
    try {
      const response = await this.fetch('/api/show', {
        method: 'POST',
        body: JSON.stringify({ model })
      });
      if (!response.ok) {
        return null;
      }

      return (await response.json()) as OllamaShowResponse;
    } catch {
      return null;
    }
  }

  async detectInstall() {
    const install = await this.detectInstallImpl('ollama');
    if (install.installed) {
      return install;
    }

    const tags = await this.listTags();
    if (tags !== null) {
      return {
        installed: true,
        cliPath: null
      };
    }

    return install;
  }

  async getStatus() {
    const install = await this.detectInstallImpl('ollama');
    const tags = await this.listTags();

    return {
      installed: install.installed || tags !== null,
      cliPath: install.cliPath,
      reachable: tags !== null,
      baseUrl: this.baseUrl,
      tags
    } satisfies OllamaRuntimeStatus;
  }

  async start(cliPath?: string | null) {
    await this.startImpl('Ollama', cliPath ?? 'ollama', ['serve']);
  }
}
