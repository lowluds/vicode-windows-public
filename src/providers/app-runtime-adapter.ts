import type {
  ProviderAdapter,
  ProviderRunCallbacks,
  ProviderRunContext,
  ProviderRunHandle
} from './types';
import type {
  ProviderAccount,
  ProviderAuthMode,
  ProviderId,
  ProviderModel
} from '../shared/domain';
import { providerDisplayName } from '../shared/providers';

export class AppRuntimeProviderAdapter implements ProviderAdapter {
  readonly label: string;

  constructor(readonly id: ProviderId) {
    this.label = providerDisplayName(id);
  }

  listStaticModels(): ProviderModel[] {
    return [];
  }

  getPlannerCapability() {
    return {
      supported: false,
      executionMode: 'workspace-write' as const,
      enforcement: 'best-effort' as const,
      message: `${this.label} runs through Vicode's app-owned normalized runtime.`
    };
  }

  async discoverApiModels() {
    return null;
  }

  async discoverRuntimeModels() {
    return null;
  }

  async detectInstall() {
    return {
      installed: true,
      cliPath: null
    };
  }

  async getAuthState(_account: ProviderAccount | null) {
    return {
      authState: 'connected' as const,
      authMode: 'api_key' as const,
      message: `${this.label} uses saved custom provider settings.`
    };
  }

  async startAuth(_mode?: ProviderAuthMode, _cliPath?: string | null) {}

  async clearAuth() {}

  validateProjectContext() {
    return { valid: true };
  }

  async startRun(context: ProviderRunContext, callbacks: ProviderRunCallbacks): Promise<ProviderRunHandle> {
    callbacks.onStart();
    callbacks.onError(`${this.label} requires a normalized app-runtime transport.`);
    return {
      runId: context.runId,
      cancel: async () => {}
    };
  }
}
