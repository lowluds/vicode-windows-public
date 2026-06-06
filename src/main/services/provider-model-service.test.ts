import { describe, expect, it, vi } from 'vitest';
import type { ProviderAdapter } from '../../providers/types';
import type { ProviderAccount, ProviderModel } from '../../shared/domain';
import { ProviderModelService } from './provider-model-service';

function createModel(id: string): ProviderModel {
  return {
    id,
    label: id,
    description: `${id} model.`,
    supportsVision: false
  };
}

function createAdapter(input: Partial<ProviderAdapter>): ProviderAdapter {
  return {
    id: 'ollama',
    label: 'Ollama',
    listStaticModels: () => [],
    getPlannerCapability: () => ({
      supported: true,
      executionMode: 'workspace-write',
      enforcement: 'best-effort'
    }),
    discoverApiModels: async () => null,
    discoverRuntimeModels: async () => null,
    detectInstall: async () => ({ installed: true, cliPath: null }),
    getAuthState: async () => ({ authState: 'connected', authMode: null }),
    startAuth: async () => undefined,
    clearAuth: async () => undefined,
    validateProjectContext: () => ({ valid: true }),
    startRun: async () => ({
      runId: 'run-1',
      cancel: async () => undefined
    }),
    ...input
  } as ProviderAdapter;
}

describe('ProviderModelService', () => {
  it('uses local Ollama runtime models and ignores legacy API-key discovery', async () => {
    const account: ProviderAccount = {
      providerId: 'ollama',
      authState: 'connected',
      authMode: 'api_key',
      encryptedApiKey: 'encrypted-cloud-key',
      updatedAt: '2026-06-01T00:00:00.000Z'
    };
    const adapter = createAdapter({
      discoverApiModels: vi.fn(async () => [createModel('qwen3-cloud')]),
      discoverRuntimeModels: vi.fn(async () => [createModel('qwen3-local:14b')])
    });
    const db = {
      getProviderModelCache: vi.fn(() => ({ models: [], updatedAt: null, source: null })),
      replaceProviderModels: vi.fn(),
      clearProviderModelCache: vi.fn()
    };
    const service = new ProviderModelService({
      db: db as never,
      decryptApiKey: () => 'cloud-key',
      getProvider: async () => ({
        id: 'ollama',
        label: 'Ollama',
        authState: 'connected',
        authMode: 'api_key',
        installed: true,
        models: [],
        modelSource: 'api',
        modelsUpdatedAt: null,
        canLiveDiscoverModels: true,
        cliPath: null,
        capabilities: {} as never,
        plannerPolicy: {} as never
      })
    });

    const result = await service.getResolvedModels('ollama', adapter, {
      account,
      authMode: 'api_key',
      cliPath: null,
      forceRefresh: true
    });

    expect(result.models.map((model) => model.id)).toEqual(['qwen3-local:14b']);
    expect(adapter.discoverApiModels).not.toHaveBeenCalled();
    expect(db.replaceProviderModels).toHaveBeenCalledWith(
      'ollama',
      [expect.objectContaining({ id: 'qwen3-local:14b' })],
      'runtime'
    );
  });
});
