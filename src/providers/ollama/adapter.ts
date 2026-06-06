import { getProviderFallbackModels } from '../catalog';
import type { AgentRuntime } from '../agent-runtime';
import type { ProviderAdapter, ProviderRunCallbacks, ProviderRunContext, ProviderRunHandle } from '../types';
import type { ProviderAccount, ProviderModel } from '../../shared/domain';
import { cleanFinalAssistantDisplayText } from '../../shared/assistant-text/final-display-cleanup';
import { OLLAMA_DEFAULT_LOCAL_MODEL_ID } from '../../shared/providers';
import { LocalOllamaRuntime, type OllamaRuntime, type OllamaShowResponse, type OllamaTagResponse } from './runtime';
import { mapOllamaDiscoveredModels } from './model-metadata';
import {
  startOllamaPlainChatRun,
  startOllamaPlainResponsesRun
} from './plain-runners';
import { fetchOllamaWithRetry } from './transport';

const MODELS: ProviderModel[] = getProviderFallbackModels('ollama');

export class OllamaAdapter implements ProviderAdapter {
  readonly id = 'ollama' as const;
  readonly label = 'Ollama';

  constructor(
    private readonly runtime: OllamaRuntime = new LocalOllamaRuntime(),
    private readonly agentRuntime: AgentRuntime | null = null,
    private readonly fetchImpl: typeof globalThis.fetch = globalThis.fetch
  ) {}

  listStaticModels(): ProviderModel[] {
    return MODELS;
  }

  getPlannerCapability() {
    return {
      supported: true,
      executionMode: 'workspace-write' as const,
      enforcement: 'best-effort' as const,
      message: 'Ollama planner runs through the app-owned planning mode.'
    };
  }

  async discoverApiModels(input: {
    account: ProviderAccount | null;
    authMode: ProviderAccount['authMode'];
    apiKey: string | null;
    cliPath: string | null;
  }) {
    return null;
  }

  private async mapDiscoveredModels(
    payload: OllamaTagResponse | null,
    loadModelDetails: ((modelId: string) => Promise<OllamaShowResponse | null>) | null
  ) {
    return mapOllamaDiscoveredModels(payload, loadModelDetails);
  }

  async discoverRuntimeModels(_input: {
    account: ProviderAccount | null;
    authMode: ProviderAccount['authMode'];
    cliPath: string | null;
  }) {
    return await this.mapDiscoveredModels(await this.runtime.listTags(), (modelId) => this.runtime.showModel(modelId));
  }

  async detectInstall() {
    return this.runtime.detectInstall();
  }

  async getAuthState(_account: ProviderAccount | null) {
    const status = await this.runtime.getStatus();
    const models = await this.mapDiscoveredModels(status.tags, null);

    if (models !== null) {
      if (models.length === 0) {
        return {
          authState: 'connected' as const,
          authMode: null,
          message: `Ollama local runtime is ready, but no local models were found. Pull a model like \`ollama pull ${OLLAMA_DEFAULT_LOCAL_MODEL_ID}\` first.`
        };
      }

      return {
        authState: 'connected' as const,
        authMode: null,
        message: `Ollama local runtime is ready with ${models.length} local model${models.length === 1 ? '' : 's'}.`
      };
    }

    if (!status.installed) {
      return {
        authState: 'disconnected' as const,
        authMode: null,
        message: 'Install the Ollama local runtime to use local models in Vicode.'
      };
    }

    return {
      authState: 'detected' as const,
      authMode: null,
      message: 'Ollama local runtime is installed, but not reachable yet. Open Ollama or start the local runtime, then refresh.'
    };
  }

  async startAuth(_mode?: 'cli' | 'api_key', cliPath?: string | null) {
    await this.runtime.start(cliPath);
  }

  async clearAuth() {
    return;
  }

  validateProjectContext(_folderPath: string | null, _trusted: boolean) {
    return { valid: true };
  }

  private async finalizeAssistantOutput(context: ProviderRunContext, output: string) {
    const trimmed = output.trim();
    if (!trimmed) {
      return trimmed;
    }
    return cleanFinalAssistantDisplayText(trimmed, {
      stripXmlFunctionCallMarkup: !context.apiKey,
      stripReasoningLabels: !context.apiKey && context.runMode !== 'plan'
    });
  }

  async startRun(context: ProviderRunContext, callbacks: ProviderRunCallbacks): Promise<ProviderRunHandle> {
    callbacks.onStart();

    if (context.ollamaTransportMode === 'responses') {
      return this.startPlainResponsesRun(context, callbacks);
    }
    return this.startPlainChatRun(context, callbacks);
  }

  private async fetchOllamaWithRetry(
    baseUrl: string,
    path: string,
    options: RequestInit,
    apiKey: string | null,
    timeoutMs: number
  ) {
    return fetchOllamaWithRetry({
      runtime: this.runtime,
      fetchImpl: this.fetchImpl,
      baseUrl,
      path,
      options,
      apiKey,
      timeoutMs
    });
  }

  private async startPlainChatRun(context: ProviderRunContext, callbacks: ProviderRunCallbacks): Promise<ProviderRunHandle> {
    return startOllamaPlainChatRun({
      context,
      callbacks,
      runtimeBaseUrl: this.runtime.baseUrl,
      fetchWithRetry: (baseUrl, path, options, apiKey, timeoutMs) =>
        this.fetchOllamaWithRetry(baseUrl, path, options, apiKey, timeoutMs),
      finalizeAssistantOutput: (runContext, output) => this.finalizeAssistantOutput(runContext, output)
    });
  }

  private async startPlainResponsesRun(context: ProviderRunContext, callbacks: ProviderRunCallbacks): Promise<ProviderRunHandle> {
    return startOllamaPlainResponsesRun({
      context,
      callbacks,
      runtimeBaseUrl: this.runtime.baseUrl,
      fetchWithRetry: (baseUrl, path, options, apiKey, timeoutMs) =>
        this.fetchOllamaWithRetry(baseUrl, path, options, apiKey, timeoutMs),
      finalizeAssistantOutput: (runContext, output) => this.finalizeAssistantOutput(runContext, output),
      fallbackToPlainChat: (fallbackContext, fallbackCallbacks) =>
        this.startPlainChatRun(fallbackContext, fallbackCallbacks)
    });
  }

}
