import type { ProviderAdapter } from '../../providers/types';
import type {
  ProviderId,
  ThreadDetail
} from '../../shared/domain';
import type { ThreadCollaborationSummary } from '../../shared/ipc';
import {
  buildCollaborationSummaryPrompt,
  buildSubagentTerminalSummaryPrompt,
  deriveCollaborationThreadSummary,
  deriveSubagentTerminalSummaryFallback,
  normalizeSubagentTerminalSummary,
  parseCollaborationSummaryOutput
} from './thread-summary';
import {
  runUtilityTextGeneration,
  type UtilityTextGenerationDependencies
} from './utility-text-generation';

type SummaryThreadRecord = Pick<ThreadDetail, 'id' | 'providerId' | 'modelId'> & ThreadDetail;

export interface ProviderSummaryTextServiceHost {
  adapters: Record<ProviderId, ProviderAdapter>;
  db: {
    getThread(threadId: string): SummaryThreadRecord;
    getProviderAccount(providerId: ProviderId): import('../../shared/domain').ProviderAccount | null;
  };
  getProviderDescriptor(providerId: ProviderId): Promise<{ models: import('../../shared/domain').ProviderModel[] }>;
  resolveUsableModelId(providerId: ProviderId, modelId: string): Promise<string>;
  decryptApiKey(encryptedApiKey: string): string;
  resolveOllamaTransportMode(providerId: ProviderId): import('../../shared/domain').OllamaTransportMode | undefined;
}

export class ProviderSummaryTextService {
  constructor(private readonly host: ProviderSummaryTextServiceHost) {}

  async generateCollaborationThreadSummary(threadId: string): Promise<ThreadCollaborationSummary> {
    const thread = this.host.db.getThread(threadId);
    const fallback = deriveCollaborationThreadSummary(thread);
    const output = await runUtilityTextGeneration(
      {
        providerId: thread.providerId,
        modelId: thread.modelId,
        prompt: buildCollaborationSummaryPrompt(thread),
        fallback: null,
        timeoutMs: 5_000
      },
      this.createUtilityDependencies()
    );

    if (!output) {
      return fallback;
    }

    return parseCollaborationSummaryOutput(output, fallback);
  }

  async generateSubagentTerminalSummary(input: {
    threadId: string;
    providerId: ProviderId;
    modelId: string;
    status: 'completed' | 'failed' | 'cancelled';
    fallback?: string | null;
  }) {
    const thread = this.host.db.getThread(input.threadId);
    const fallback = input.fallback ?? deriveSubagentTerminalSummaryFallback(thread);
    const output = await runUtilityTextGeneration(
      {
        providerId: input.providerId,
        modelId: input.modelId,
        prompt: buildSubagentTerminalSummaryPrompt(thread, input.status),
        fallback,
        timeoutMs: 4_000
      },
      this.createUtilityDependencies()
    );

    return normalizeSubagentTerminalSummary(output ?? '', fallback);
  }

  private createUtilityDependencies(): UtilityTextGenerationDependencies {
    return {
      adapters: this.host.adapters,
      getProviderAccount: (providerId) => this.host.db.getProviderAccount(providerId),
      getProviderDescriptor: async (providerId) => this.host.getProviderDescriptor(providerId),
      resolveUsableModelId: (providerId, modelId) => this.host.resolveUsableModelId(providerId, modelId),
      decryptApiKey: (encryptedApiKey) => this.host.decryptApiKey(encryptedApiKey),
      resolveOllamaTransportMode: (providerId) => this.host.resolveOllamaTransportMode(providerId)
    };
  }
}
