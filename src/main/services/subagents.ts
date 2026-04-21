import { EventEmitter } from 'node:events';
import type { ProviderManager } from './provider-manager';
import { DatabaseService } from '../../storage/database';
import type { AppEvent } from '../../shared/events';
import type { SubagentSpawnInput, SubagentSummary } from '../../shared/domain';
import { getProviderMetadata, providerDisplayName, providerSubagentConcurrencyLimit, selectPreferredSubagentModel } from '../../shared/providers';
import { resolveSubagentReasoningEffort } from '../../shared/subagents';

function summarizeChildThread(subagent: SubagentSummary, db: DatabaseService) {
  if (!subagent.childThreadId) {
    return subagent.outputSummary;
  }

  try {
    const thread = db.getThread(subagent.childThreadId);
    const assistantTurn = [...thread.turns].reverse().find((turn) => turn.role === 'assistant');
    return assistantTurn?.content.trim() || thread.lastPreview || subagent.outputSummary;
  } catch {
    return subagent.outputSummary;
  }
}

export class SubagentOrchestratorService {
  private readonly emitter = new EventEmitter();
  private readonly subagentIdByRunId = new Map<string, string>();
  private readonly finalizingRunIds = new Set<string>();

  constructor(
    private readonly db: DatabaseService,
    private readonly providers: ProviderManager
  ) {}

  onEvent(listener: (event: AppEvent) => void) {
    this.emitter.on('event', listener);
    return () => this.emitter.off('event', listener);
  }

  listForThread(threadId: string) {
    return this.db.listSubagentsByParentThread(threadId);
  }

  getDetail(subagentId: string) {
    return this.db.getSubagent(subagentId);
  }

  async spawn(input: SubagentSpawnInput) {
    const parentThread = this.db.getThread(input.parentThreadId);
    const providerId = input.providerId ?? parentThread.providerId;
    const activeCount = this.db.countActiveSubagentsByProvider(providerId);
    const concurrencyLimit = providerSubagentConcurrencyLimit(providerId);
    if (activeCount >= concurrencyLimit) {
      throw new Error(
        `${providerDisplayName(providerId)} already has ${activeCount} active subagent${activeCount === 1 ? '' : 's'}. Wait for one to finish before starting another.`
      );
    }
    const provider = await this.providers.getProvider(providerId).catch(() => null);
    const resolvedModelId =
      input.modelId ??
      (provider ? selectPreferredSubagentModel(providerId, provider.models)?.id : null) ??
      (providerId === parentThread.providerId ? parentThread.modelId : getProviderMetadata(providerId).defaultModelId);
    const subagent = this.db.createSubagent({
      parentThreadId: input.parentThreadId,
      parentRunId: input.parentRunId ?? null,
      name: input.name,
      title: input.title,
      prompt: input.prompt,
      providerId,
      modelId: resolvedModelId,
      executionPermission: input.executionPermission ?? parentThread.executionPermission,
      delegationProfile: input.delegationProfile ?? 'research'
    });
    this.emit({ type: 'subagent.created', subagent });

    try {
      const result = await this.providers.startDelegatedBackgroundRun({
        projectId: parentThread.projectId,
        title: subagent.title,
        prompt: subagent.prompt,
        providerId: subagent.providerId,
        modelId: subagent.modelId,
        reasoningEffort: resolveSubagentReasoningEffort(
          subagent.delegationProfile,
          input.reasoningEffort ?? null
        ),
        executionPermission: subagent.executionPermission,
        delegationProfile: subagent.delegationProfile
      });
      const running = this.db.updateSubagent(subagent.id, {
        childThreadId: result.thread.id,
        childRunId: result.runId,
        status: 'running',
        startedAt: new Date().toISOString(),
        lastError: null
      });
      this.subagentIdByRunId.set(result.runId, running.id);
      this.emit({ type: 'subagent.updated', subagent: running });
      return running;
    } catch (error) {
      const failed = this.db.updateSubagent(subagent.id, {
        status: 'failed',
        lastError: error instanceof Error ? error.message : String(error),
        completedAt: new Date().toISOString()
      });
      this.emit({ type: 'subagent.failed', subagent: failed });
      throw error;
    }
  }

  async cancel(subagentId: string) {
    const subagent = this.db.getSubagent(subagentId);
    if (subagent.status === 'completed' || subagent.status === 'failed' || subagent.status === 'cancelled') {
      return subagent;
    }

    if (subagent.childRunId && subagent.status === 'running') {
      await this.providers.stopRun(subagent.childRunId);
      return this.db.getSubagent(subagentId);
    }

    if (subagent.status === 'queued') {
      const cancelled = this.db.updateSubagent(subagentId, {
        status: 'cancelled',
        lastError: null,
        completedAt: new Date().toISOString()
      });
      if (subagent.childRunId) {
        this.subagentIdByRunId.delete(subagent.childRunId);
      }
      this.emit({ type: 'subagent.cancelled', subagent: cancelled });
      return cancelled;
    }

    return subagent;
  }

  attachRunToChildThread(threadId: string, runId: string) {
    const current = this.db.getSubagentByChildThreadId(threadId);
    if (!current) {
      return null;
    }

    if (current.childRunId && current.childRunId !== runId) {
      this.subagentIdByRunId.delete(current.childRunId);
    }

    this.subagentIdByRunId.set(runId, current.id);

    if (current.childRunId === runId && current.status === 'running') {
      return current;
    }

    const running = this.db.updateSubagent(current.id, {
      childRunId: runId,
      status: 'running',
      outputSummary: null,
      startedAt: new Date().toISOString(),
      completedAt: null,
      lastError: null
    });
    this.emit({ type: 'subagent.updated', subagent: running });
    return running;
  }

  async handleProviderEvent(event: AppEvent) {
    if (event.type !== 'run.status') {
      return;
    }

    let subagentId = this.subagentIdByRunId.get(event.runId);
    if (!subagentId && event.threadId && event.status !== 'info') {
      const adopted = this.attachRunToChildThread(event.threadId, event.runId);
      subagentId = adopted?.id ?? null;
    }
    if (!subagentId) {
      return;
    }

    const current = this.db.getSubagent(subagentId);
    if (current.status === 'completed' || current.status === 'failed' || current.status === 'cancelled') {
      this.subagentIdByRunId.delete(event.runId);
      return;
    }

    if (event.status === 'completed') {
      if (this.finalizingRunIds.has(event.runId)) {
        return;
      }
      this.finalizingRunIds.add(event.runId);
      try {
        const completed = await this.finalizeTerminalSubagent(current, event.runId, 'completed', null);
        if (completed) {
          this.emit({ type: 'subagent.completed', subagent: completed });
        }
      } finally {
        this.finalizingRunIds.delete(event.runId);
      }
      return;
    }

    if (event.status === 'failed') {
      if (this.finalizingRunIds.has(event.runId)) {
        return;
      }
      this.finalizingRunIds.add(event.runId);
      try {
        const failed = await this.finalizeTerminalSubagent(current, event.runId, 'failed', event.message ?? current.lastError);
        if (failed) {
          this.emit({ type: 'subagent.failed', subagent: failed });
        }
      } finally {
        this.finalizingRunIds.delete(event.runId);
      }
      return;
    }

    if (event.status === 'aborted') {
      if (this.finalizingRunIds.has(event.runId)) {
        return;
      }
      this.finalizingRunIds.add(event.runId);
      try {
        const cancelled = await this.finalizeTerminalSubagent(current, event.runId, 'cancelled', event.message ?? null);
        if (cancelled) {
          this.emit({ type: 'subagent.cancelled', subagent: cancelled });
        }
      } finally {
        this.finalizingRunIds.delete(event.runId);
      }
    }
  }

  private async finalizeTerminalSubagent(
    current: SubagentSummary,
    runId: string,
    status: 'completed' | 'failed' | 'cancelled',
    lastError: string | null
  ) {
    const fallbackSummary = summarizeChildThread(current, this.db);
    const outputSummary =
      current.childThreadId && typeof (this.providers as ProviderManager).generateSubagentTerminalSummary === 'function'
        ? await (this.providers as ProviderManager).generateSubagentTerminalSummary({
            threadId: current.childThreadId,
            providerId: current.providerId,
            modelId: current.modelId,
            status,
            fallback: fallbackSummary
          }).catch(() => fallbackSummary)
        : fallbackSummary;

    const latest = this.db.getSubagent(current.id);
    if (latest.status === 'completed' || latest.status === 'failed' || latest.status === 'cancelled') {
      this.subagentIdByRunId.delete(runId);
      return null;
    }

    const finalized = this.db.updateSubagent(current.id, {
      status,
      outputSummary,
      lastError,
      completedAt: new Date().toISOString()
    });
    this.subagentIdByRunId.delete(runId);
    return finalized;
  }

  private emit(event: AppEvent) {
    this.emitter.emit('event', event);
  }
}
