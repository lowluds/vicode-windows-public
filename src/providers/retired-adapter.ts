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
import {
  providerDisplayName,
  providerRetiredMessage
} from '../shared/providers';
import { getProviderFallbackModels } from './catalog';

export type RetiredProviderId = Extract<ProviderId, 'openai' | 'gemini' | 'qwen' | 'kimi'>;

export class RetiredProviderAdapter implements ProviderAdapter {
  readonly label: string;

  constructor(readonly id: RetiredProviderId) {
    this.label = providerDisplayName(id);
  }

  listStaticModels(): ProviderModel[] {
    return getProviderFallbackModels(this.id);
  }

  getPlannerCapability() {
    return {
      supported: false,
      executionMode: 'read-only' as const,
      enforcement: 'hard-enforced' as const,
      message: providerRetiredMessage(this.id)
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
      installed: false,
      cliPath: null
    };
  }

  async getAuthState(_account: ProviderAccount | null) {
    return {
      authState: 'missing_cli' as const,
      authMode: null,
      message: providerRetiredMessage(this.id)
    };
  }

  async startAuth(_mode?: ProviderAuthMode, _cliPath?: string | null) {
    throw new Error(providerRetiredMessage(this.id));
  }

  async clearAuth() {}

  validateProjectContext() {
    return {
      valid: false,
      message: providerRetiredMessage(this.id)
    };
  }

  async startRun(_context: ProviderRunContext, callbacks: ProviderRunCallbacks): Promise<ProviderRunHandle> {
    callbacks.onStart();
    callbacks.onError(providerRetiredMessage(this.id));
    return {
      runId: _context.runId,
      cancel: async () => {}
    };
  }
}
