import { randomUUID } from 'node:crypto';
import type { ProviderAdapter } from '../../providers/types';
import type {
  ComposerSubmitInput,
  ProviderId
} from '../../shared/domain';
import { normalizeDisplayText } from '../../shared/display-text';
import {
  decodeOllamaModelId,
  providerCapabilities,
  resolveOllamaApiKeyForModel
} from '../../shared/providers';
import { ThreadProjectionService } from './thread-projection-service';

export interface PromptEnhancementInput {
  prompt: string;
  projectId?: string | null;
  providerId: ProviderId;
  modelId: string;
  reasoningEffort?: ComposerSubmitInput['reasoningEffort'];
  thinkingEnabled?: boolean;
}

export interface ProviderPromptTextServiceHost {
  adapters: Record<ProviderId, ProviderAdapter>;
  db: {
    getProject(projectId: string): {
      name: string;
      folderPath: string | null;
    };
    getProviderAccount(providerId: ProviderId): {
      encryptedApiKey?: string | null;
    } | null;
    getThread(threadId: string): {
      id: string;
      providerId: ProviderId;
      modelId: string;
      title: string;
    };
    getThreadSummary(threadId: string): {
      title: string;
    };
    renameThread(threadId: string, title: string): unknown;
  };
  threadProjection: ThreadProjectionService;
  resolveUsableModelId(providerId: ProviderId, modelId: string): Promise<string>;
  decryptApiKey(encrypted: string): string;
  resolveOllamaTransportMode(providerId: ProviderId): string | undefined;
  assertProviderRunPermission(providerId: ProviderId, executionPermission: ComposerSubmitInput['executionPermission']): void;
}

export class ProviderPromptTextService {
  constructor(private readonly host: ProviderPromptTextServiceHost) {}

  async enhancePrompt(input: PromptEnhancementInput): Promise<{ prompt: string }> {
    const trimmedPrompt = input.prompt.trim();
    if (!trimmedPrompt) {
      throw new Error('Prompt is required.');
    }

    const adapter = this.host.adapters[input.providerId];
    const account = this.host.db.getProviderAccount(input.providerId);
    const auth = await adapter.getAuthState(account);
    const providerApiKey =
      auth.authMode === 'api_key' && account?.encryptedApiKey
        ? this.host.decryptApiKey(account.encryptedApiKey)
        : null;
    const resolvedModelId = await this.host.resolveUsableModelId(input.providerId, input.modelId);
    const modelId = input.providerId === 'ollama' ? decodeOllamaModelId(resolvedModelId) : resolvedModelId;
    const apiKey =
      input.providerId === 'ollama'
        ? resolveOllamaApiKeyForModel(resolvedModelId, providerApiKey)
        : providerApiKey;
    const runId = randomUUID();
    this.host.assertProviderRunPermission(input.providerId, 'default');
    const contextPrompt = input.projectId
      ? this.buildPromptRefinementInput(input.projectId, trimmedPrompt)
      : trimmedPrompt;

    const refinedPrompt = await new Promise<string>((resolve, reject) => {
      let output = '';
      let settled = false;
      const finish = (value: string) => {
        if (settled) {
          return;
        }
        settled = true;
        resolve(value);
      };
      const fail = (error: Error) => {
        if (settled) {
          return;
        }
        settled = true;
        reject(error);
      };

      void adapter
        .startRun(
          {
            threadId: `prompt-refiner-${runId}`,
            runId,
            prompt: this.buildPromptRefinementPrompt(contextPrompt),
            modelId,
            reasoningEffort: input.reasoningEffort ?? null,
            thinkingEnabled: providerCapabilities(input.providerId).supportsThinkingToggle
              ? input.thinkingEnabled ?? false
              : undefined,
            folderPath: null,
            trusted: false,
            apiKey,
            runMode: 'plan',
            executionPermission: 'default',
            ollamaTransportMode: this.host.resolveOllamaTransportMode(input.providerId)
          },
          {
            onStart: () => {},
            onDelta: (delta) => {
              output += delta;
            },
            onInfo: () => {},
            onComplete: (value) => finish(this.normalizeEnhancedPrompt(value || output, trimmedPrompt)),
            onError: (message) => fail(new Error(message || 'Unable to enhance prompt.')),
            onAbort: () => finish(trimmedPrompt)
          }
        )
        .catch((error) => fail(error instanceof Error ? error : new Error('Unable to enhance prompt.')));
    });

    return { prompt: refinedPrompt };
  }

  async generateThreadTitle(threadId: string, prompt: string) {
    const trimmedPrompt = prompt.trim();
    if (!trimmedPrompt) {
      return;
    }
    const fallbackTitle = this.deriveFallbackThreadTitle(trimmedPrompt);
    const thread = this.host.db.getThread(threadId);
    if (thread.title.trim() !== 'New thread') {
      return;
    }

    if (providerCapabilities(thread.providerId).requiresFullAccessForAppRuns) {
      if (!fallbackTitle) {
        return;
      }
      this.host.db.renameThread(thread.id, fallbackTitle);
      this.host.threadProjection.emitThread(thread.id);
      return;
    }

    const adapter = this.host.adapters[thread.providerId];
    const account = this.host.db.getProviderAccount(thread.providerId);
    const auth = await adapter.getAuthState(account);
    const providerApiKey =
      auth.authMode === 'api_key' && account?.encryptedApiKey
        ? this.host.decryptApiKey(account.encryptedApiKey)
        : null;
    const modelId = thread.providerId === 'ollama' ? decodeOllamaModelId(thread.modelId) : thread.modelId;
    const apiKey =
      thread.providerId === 'ollama'
        ? resolveOllamaApiKeyForModel(thread.modelId, providerApiKey)
        : providerApiKey;
    const runId = randomUUID();

    const resolvedTitle = await new Promise<string | null>((resolve) => {
      let settled = false;
      const timeout = setTimeout(() => {
        finish(fallbackTitle);
      }, 5_000);

      const finish = (value: string | null) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        resolve(value);
      };

      void adapter
        .startRun(
          {
            threadId: thread.id,
            runId,
            prompt: this.buildThreadTitlePrompt(trimmedPrompt),
            modelId,
            folderPath: null,
            trusted: false,
            apiKey,
            runMode: 'plan',
            executionPermission: 'default',
            ollamaTransportMode: this.host.resolveOllamaTransportMode(thread.providerId)
          },
          {
            onStart: () => {},
            onDelta: () => {},
            onInfo: () => {},
            onComplete: (output) => finish(this.normalizeSuggestedThreadTitle(output, trimmedPrompt)),
            onError: () => finish(this.deriveFallbackThreadTitle(trimmedPrompt)),
            onAbort: () => finish(null)
          }
        )
        .catch(() => finish(fallbackTitle));
    });

    if (!resolvedTitle) {
      return;
    }

    const current = this.host.db.getThreadSummary(thread.id);
    if (current.title.trim() !== 'New thread') {
      return;
    }

    this.host.db.renameThread(thread.id, resolvedTitle);
    this.host.threadProjection.emitThread(thread.id);
  }

  private buildThreadTitlePrompt(prompt: string) {
    return [
      'Generate a concise coding thread title.',
      'Return only the title text.',
      'Use 2 to 6 words.',
      'Do not use quotes, markdown, punctuation suffixes, or prefixes like "Title:".',
      'Focus on the main task or deliverable.',
      '',
      `Request: ${prompt}`
    ].join('\n');
  }

  private buildPromptRefinementInput(projectId: string, prompt: string) {
    const project = this.host.db.getProject(projectId);
    const sections = [
      `Project: ${project.name}`,
      project.folderPath ? `Active workspace folder: ${project.folderPath}` : null,
      `User draft:\n${prompt}`
    ].filter((value): value is string => Boolean(value));

    return sections.join('\n\n');
  }

  private buildPromptRefinementPrompt(prompt: string) {
    return [
      'Rewrite the user draft into a clear, efficient prompt for a coding agent.',
      'Preserve the original intent.',
      'If the draft includes an active workspace folder, keep the prompt grounded in that workspace by default.',
      'Default to that workspace for file operations unless the user explicitly asks for another location.',
      'If that workspace appears empty or lacks the requested files, tell the user instead of selecting a different workspace on your own.',
      'Do not invent product requirements, file paths, or technologies unless the user already implied them.',
      'Do not introduce or preserve stale absolute paths from earlier tasks unless the user explicitly confirmed them in the draft.',
      'Add structure only when it improves execution clarity.',
      'Prefer a compact but capable prompt over a bloated one.',
      'If assumptions are necessary, include them briefly inside the prompt as explicit assumptions.',
      'Return only the rewritten prompt text.',
      '',
      prompt
    ].join('\n');
  }

  private normalizeSuggestedThreadTitle(output: string, fallbackPrompt: string) {
    const line = output
      .split(/\r?\n/u)
      .map((value) => value.trim())
      .find(Boolean);

    const cleaned = line
      ?.replace(/^title:\s*/iu, '')
      .replace(/^["'`]+|["'`]+$/gu, '')
      .replace(/^[-*•]\s*/u, '')
      .replace(/\s+/gu, ' ')
      .trim();

    if (!cleaned || cleaned.length < 3 || cleaned.length > 72) {
      return this.deriveFallbackThreadTitle(fallbackPrompt);
    }

    if (/responding to:/iu.test(cleaned) || cleaned.toLowerCase().includes('generate a concise coding thread title')) {
      return this.deriveFallbackThreadTitle(fallbackPrompt);
    }

    return normalizeDisplayText(cleaned);
  }

  private deriveFallbackThreadTitle(prompt: string) {
    const cleaned = normalizeDisplayText(prompt)
      .replace(/\s+/gu, ' ')
      .replace(/^[^\p{L}\p{N}]+/gu, '')
      .trim();

    if (!cleaned) {
      return null;
    }

    return cleaned.slice(0, 56).trim();
  }

  private normalizeEnhancedPrompt(output: string, fallbackPrompt: string) {
    const cleaned = output
      .replace(/^```[a-z0-9_-]*\s*/iu, '')
      .replace(/```$/u, '')
      .replace(/^refined prompt:\s*/iu, '')
      .replace(/^improved prompt:\s*/iu, '')
      .trim();

    if (!cleaned) {
      return fallbackPrompt;
    }

    return cleaned;
  }
}
