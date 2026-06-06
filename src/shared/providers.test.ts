import { describe, expect, it } from 'vitest';
import {
  decodeOllamaModelId,
  encodeOllamaLocalModelId,
  getProviderMetadata,
  isOllamaLocalModelId,
  isRetiredProviderId,
  OLLAMA_DEFAULT_LOCAL_MODEL_ID,
  OLLAMA_LIGHTWEIGHT_SMOKE_MODEL_ID,
  providerBlockedRunMessage,
  providerCanRunInComposer,
  providerCapabilities,
  providerCliAuthLaunch,
  providerCliCommands,
  providerPermissionBoundaryNote,
  providerPermissionOptionDisabled,
  providerModelTriggerSummary,
  providerSettingsAuthDescription,
  providerSettingsAuthTitle,
  providerSettingsConnectLabel,
  providerSettingsInstallActionLabel,
  providerSettingsInstallLabel,
  providerSettingsOllamaModeSummary,
  providerSettingsPillLabel,
  providerSettingsStatusSummary,
  providerSetupGuidance,
  providerSetupMenuSummary,
  providerModelRecommendationLabel,
  providerRecommendedRouteSummary,
  providerRetiredMessage,
  resolveProviderThinkingDefault,
  resolveOllamaApiKeyForModel,
  providerSubagentConcurrencyLimit,
  providerUsesHostedApi,
  selectPreferredOllamaModel,
  selectPreferredOllamaVisionModel,
  selectPreferredOllamaValidationModels,
  selectPreferredSubagentModel
} from './providers';

describe('shared provider helpers', () => {
  it('does not treat legacy Ollama api-key mode as composer-runnable without a local install', () => {
    expect(
      providerCanRunInComposer({
        id: 'ollama',
        installed: false,
        authMode: 'api_key'
      })
    ).toBe(false);
  });

  it('still requires a local install for Ollama cli mode', () => {
    expect(
      providerCanRunInComposer({
        id: 'ollama',
        installed: false,
        authMode: 'cli'
      })
    ).toBe(false);
  });

  it('does not expose a hosted Ollama API mode', () => {
    expect(
      providerUsesHostedApi({
        id: 'ollama',
        authMode: 'api_key'
      })
    ).toBe(false);
  });

  it('marks local Ollama model ids without routing any Ollama model through API-key auth', () => {
    const localModelId = encodeOllamaLocalModelId('qwen3-coder:30b');

    expect(localModelId).toBe('local:qwen3-coder:30b');
    expect(encodeOllamaLocalModelId(localModelId)).toBe(localModelId);
    expect(isOllamaLocalModelId(localModelId)).toBe(true);
    expect(isOllamaLocalModelId('qwen3-coder:30b')).toBe(false);
    expect(decodeOllamaModelId(localModelId)).toBe('qwen3-coder:30b');
    expect(resolveOllamaApiKeyForModel(localModelId, 'cloud-key')).toBeNull();
    expect(resolveOllamaApiKeyForModel('qwen3-coder:30b', 'cloud-key')).toBeNull();
  });

  it('marks Ollama as supporting runtime skill resources through prompt-backed injection', () => {
    expect(providerCapabilities('ollama').supportsRuntimeSkillResources).toBe(true);
  });

  it('defaults Ollama thinking on while unsupported providers stay off', () => {
    expect(providerCapabilities('ollama').supportsThinkingToggle).toBe(true);
    expect(resolveProviderThinkingDefault('ollama')).toBe(true);
    expect(resolveProviderThinkingDefault('openai')).toBe(false);
    expect(resolveProviderThinkingDefault('openai_compatible')).toBe(false);
  });

  it('declares lane authority explicitly for supported app-hosted providers', () => {
    expect(providerCapabilities('ollama')).toMatchObject({
      executionAuthority: 'app_runtime',
      approvalAuthority: 'app',
      sandboxAuthority: 'app_runtime',
      requiresTrustedWorkspace: true
    });
    expect(providerCapabilities('openai_compatible')).toMatchObject({
      executionAuthority: 'app_runtime',
      approvalAuthority: 'app',
      sandboxAuthority: 'app_runtime',
      requiresTrustedWorkspace: true
    });
  });

  it('surfaces lane-specific permission boundaries from shared provider metadata', () => {
    expect(providerPermissionBoundaryNote('openai', 'default')).toContain('OpenAI CLI has been retired');
    expect(providerPermissionBoundaryNote('gemini', 'full_access')).toContain('Gemini CLI has been retired');
    expect(providerPermissionBoundaryNote('ollama', 'default')).toContain('Vicode owns approvals in this lane');
    expect(providerPermissionBoundaryNote('kimi', 'default')).toContain('Kimi CLI has been retired');
  });

  it('disables invalid permission options for lanes that require full access or are retired', () => {
    expect(providerPermissionOptionDisabled('kimi', 'default')).toBe(true);
    expect(providerPermissionOptionDisabled('kimi', 'full_access')).toBe(true);
    expect(providerPermissionOptionDisabled('openai', 'default')).toBe(true);
    expect(providerPermissionOptionDisabled('ollama', 'default')).toBe(false);
  });

  it('prefers the GPU-safe local Ollama default even when larger coder models are present', () => {
    expect(
      selectPreferredOllamaModel([
        { id: 'qwen2.5-coder:32b-instruct-q3_K_M' },
        { id: 'llama3.1:8b' },
        { id: OLLAMA_DEFAULT_LOCAL_MODEL_ID },
        { id: 'deepseek-r1:8b' }
      ])
    ).toEqual({ id: OLLAMA_DEFAULT_LOCAL_MODEL_ID });
  });

  it('prefers a practical high-quality Ollama vision model when available', () => {
    expect(
      selectPreferredOllamaVisionModel([
        { id: 'llava:13b', supportsVision: true },
        { id: 'qwen2.5vl:7b', supportsVision: true },
        { id: 'gemma3:12b', supportsVision: true },
        { id: 'qwen3-coder:30b', supportsVision: false }
      ])
    ).toEqual({ id: 'qwen2.5vl:7b', supportsVision: true });
  });

  it('avoids very large Ollama vision models when a practical image reader is available', () => {
    expect(
      selectPreferredOllamaVisionModel([
        { id: 'qwen3-vl:235b-instruct', supportsVision: true },
        { id: 'gemma3:12b', supportsVision: true },
        { id: 'gemma3:4b', supportsVision: true },
        { id: 'deepseek-v3.1:671b', supportsVision: false }
      ])
    ).toEqual({ id: 'gemma3:4b', supportsVision: true });
  });

  it('returns the 14B default and 7B smoke Ollama validation set when available', () => {
    expect(
      selectPreferredOllamaValidationModels([
        { id: 'qwen2.5-coder:32b-instruct-q3_K_M' },
        { id: OLLAMA_DEFAULT_LOCAL_MODEL_ID },
        { id: OLLAMA_LIGHTWEIGHT_SMOKE_MODEL_ID },
        { id: 'llama3.1:8b' },
        { id: 'deepseek-r1:8b' }
      ])
    ).toEqual([{ id: OLLAMA_DEFAULT_LOCAL_MODEL_ID }, { id: OLLAMA_LIGHTWEIGHT_SMOKE_MODEL_ID }]);
  });

  it('prefers lower-cost background agent models for supported providers', () => {
    expect(
      selectPreferredSubagentModel('ollama', [
        { id: OLLAMA_DEFAULT_LOCAL_MODEL_ID, recommendation: 'recommended' },
        { id: OLLAMA_LIGHTWEIGHT_SMOKE_MODEL_ID, recommendation: 'fast' },
        { id: 'llama3.1:8b' }
      ])
    ).toEqual({ id: OLLAMA_LIGHTWEIGHT_SMOKE_MODEL_ID, recommendation: 'fast' });
  });

  it('maps recommendation flags to user-facing labels', () => {
    expect(providerModelRecommendationLabel('recommended')).toBe('Default');
    expect(providerModelRecommendationLabel('fast')).toBe('Quick');
    expect(providerModelRecommendationLabel('preview')).toBe('Preview');
    expect(providerModelRecommendationLabel(undefined)).toBeNull();
  });

  it('exposes provider-aware subagent concurrency caps', () => {
    expect(providerSubagentConcurrencyLimit('openai')).toBe(0);
    expect(providerSubagentConcurrencyLimit('gemini')).toBe(0);
    expect(providerSubagentConcurrencyLimit('qwen')).toBe(0);
    expect(providerSubagentConcurrencyLimit('kimi')).toBe(0);
    expect(providerSubagentConcurrencyLimit('ollama')).toBe(2);
    expect(providerSubagentConcurrencyLimit('openai_compatible')).toBe(2);
  });

  it('returns provider-specific serious-coding guidance', () => {
    expect(providerRecommendedRouteSummary('openai')).toContain('retired');
    expect(providerRecommendedRouteSummary('gemini')).toContain('retired');
    expect(providerRecommendedRouteSummary('ollama')).toMatch(/local/i);
    expect(providerRecommendedRouteSummary('openai_compatible')).toContain('custom OpenAI-compatible');
    expect(providerRecommendedRouteSummary('qwen')).toContain('retired');
    expect(providerRecommendedRouteSummary('kimi')).toContain('retired');
  });

  it('marks CLI-backed providers as retired provider ids', () => {
    expect(isRetiredProviderId('openai')).toBe(true);
    expect(isRetiredProviderId('gemini')).toBe(true);
    expect(isRetiredProviderId('qwen')).toBe(true);
    expect(isRetiredProviderId('kimi')).toBe(true);
    expect(isRetiredProviderId('ollama')).toBe(false);
    expect(isRetiredProviderId('openai_compatible')).toBe(false);
    expect(providerRetiredMessage('openai')).toContain('OpenAI-compatible custom API');
    expect(providerRetiredMessage('qwen')).toContain('normalized Ollama lane');
    expect(providerCanRunInComposer({ id: 'openai', installed: true, authState: 'connected', authMode: 'api_key', models: [{ id: 'gpt-5' }] })).toBe(false);
    expect(providerCanRunInComposer({ id: 'gemini', installed: true, authMode: 'cli' })).toBe(false);
    expect(providerCanRunInComposer({ id: 'qwen', installed: true, authMode: 'cli' })).toBe(false);
  });

  it('keeps retired provider CLI launch metadata inert', () => {
    for (const providerId of ['openai', 'gemini', 'qwen', 'kimi'] as const) {
      expect(providerCliCommands(providerId)).toEqual([]);
      expect(providerCliAuthLaunch(providerId)).toEqual({ title: null, args: [] });
    }
  });

  it('requires a configured custom provider for the OpenAI-compatible composer lane', () => {
    expect(
      providerCanRunInComposer({
        id: 'openai_compatible',
        installed: true,
        authState: 'connected',
        authMode: 'api_key',
        models: []
      })
    ).toBe(false);
    expect(
      providerCanRunInComposer({
        id: 'openai_compatible',
        installed: true,
        authState: 'connected',
        authMode: 'api_key',
        models: [{ id: 'custom:openai:gpt-5.4-nano' }]
      })
    ).toBe(true);
  });

  it('summarizes transitional setup states for provider menus', () => {
    expect(providerSetupMenuSummary({ id: 'openai', installed: true, authState: 'checking', authMode: 'cli' })).toBe('Provider retired');
    expect(providerSetupMenuSummary({ id: 'ollama', installed: true, authState: 'detected', authMode: null })).toBe('Start local runtime');
    expect(providerSetupMenuSummary({ id: 'openai_compatible', installed: false, authState: 'disconnected', authMode: 'api_key' })).toBe('Add custom API');
    expect(providerSetupMenuSummary({ id: 'gemini', installed: false, authState: 'missing_cli', authMode: 'cli' })).toBe('Provider retired');
  });

  it('replaces stale model labels with setup state in the composer trigger', () => {
    expect(
      providerModelTriggerSummary(
        { id: 'openai', installed: false, authState: 'missing_cli', authMode: 'cli', models: [] },
        null
      )
    ).toBe('Provider retired');
    expect(
      providerModelTriggerSummary(
        { id: 'ollama', installed: true, authState: 'detected', authMode: null, models: [] },
        null
      )
    ).toBe('Start local runtime');
    expect(
      providerModelTriggerSummary(
        { id: 'gemini', installed: true, authState: 'connected', authMode: 'cli', models: [{ id: 'gemini-2.5-pro' }] },
        'Gemini 2.5 Pro'
      )
    ).toBe('Gemini 2.5 Pro');
  });

  it('returns provider-specific setup guidance for blocked states', () => {
    expect(providerSetupGuidance({ id: 'ollama', installed: true, authState: 'detected', authMode: null })).toContain('not running yet');
    expect(providerSetupGuidance({ id: 'openai_compatible', installed: false, authState: 'disconnected', authMode: 'api_key' })).toContain('custom provider');
    expect(providerBlockedRunMessage({ id: 'ollama', installed: true, authState: 'detected', authMode: null })).toContain('not running yet');
    expect(providerBlockedRunMessage({ id: 'gemini', installed: true, authState: 'disconnected', authMode: 'cli' })).toContain('retired');
  });

  it('returns shared settings labels for the main provider states', () => {
    expect(providerSettingsAuthTitle({ id: 'openai', installed: false, authState: 'missing_cli', authMode: 'cli' })).toBe('Provider retired');
    expect(providerSettingsAuthDescription({ id: 'gemini', installed: false, authState: 'missing_cli', authMode: 'cli', message: undefined })).toContain('Gemini CLI has been retired');
    expect(providerSettingsAuthTitle({ id: 'gemini', installed: true, authState: 'detected', authMode: 'cli' })).toBe('Provider retired');
    expect(providerSettingsPillLabel({ id: 'gemini', installed: true, authState: 'detected', authMode: 'cli' })).toBe('Retired');
    expect(providerSettingsConnectLabel({ id: 'gemini', authState: 'detected', authMode: 'cli' })).toBe('Unavailable');
    expect(
      providerSettingsAuthDescription({
        id: 'gemini',
        installed: true,
        authState: 'detected',
        authMode: 'cli',
        message: undefined
      })
    ).toContain('Gemini CLI has been retired');
    expect(providerSettingsConnectLabel({ id: 'openai', authState: 'disconnected', authMode: null })).toBe('Unavailable');
    expect(providerSettingsConnectLabel({ id: 'openai', authState: 'disconnected', authMode: 'cli' })).toBe('Unavailable');
    expect(providerSettingsInstallActionLabel({ id: 'openai', authMode: 'cli' })).toBe('Unavailable');
    expect(
      providerSettingsAuthDescription({
        id: 'qwen',
        installed: true,
        authState: 'disconnected',
        authMode: null,
        message: undefined
      })
    ).toContain('Qwen CLI has been retired');
    expect(providerSettingsAuthTitle({ id: 'kimi', installed: false, authState: 'missing_cli', authMode: null })).toBe('Provider retired');
    expect(providerSettingsPillLabel({ id: 'kimi', installed: false, authState: 'missing_cli', authMode: null })).toBe('Retired');
    expect(providerSettingsConnectLabel({ id: 'kimi', authState: 'missing_cli', authMode: null })).toBe('Unavailable');
    expect(providerSettingsInstallActionLabel({ id: 'kimi', authMode: null })).toBe('Unavailable');
    expect(providerSettingsInstallLabel({ id: 'kimi', installed: false, authMode: null }, null)).toBe('Retired');
    expect(
      providerSettingsStatusSummary(
        { id: 'kimi', installed: false, authState: 'missing_cli', authMode: null, models: [] },
        null
      )
    ).toContain('Kimi CLI has been retired');
  });

  it('returns shared settings labels for local-only Ollama states', () => {
    expect(providerSettingsAuthTitle({ id: 'ollama', installed: false, authState: 'connected', authMode: 'api_key' })).toBe('Install local Ollama');
    expect(providerSettingsPillLabel({ id: 'ollama', installed: false, authState: 'connected', authMode: 'api_key' })).toBe('Not installed');
    expect(providerSettingsInstallLabel({ id: 'ollama', installed: false, authMode: 'api_key' }, null)).toBe('Local install optional');
    expect(
      providerSettingsStatusSummary(
        { id: 'ollama', installed: false, authState: 'connected', authMode: 'api_key', models: [] },
        null
      )
    ).toContain('Install Ollama and pull a local model');
    expect(
      providerSettingsStatusSummary(
        {
          id: 'ollama',
          installed: true,
          authState: 'connected',
          authMode: 'api_key',
          models: [
            { id: 'qwen3-cloud' },
            { id: encodeOllamaLocalModelId('qwen3-local:14b') }
          ]
        },
        null
      )
    ).toBe('2 local models available');
    expect(
      providerSettingsOllamaModeSummary(
        { id: 'ollama', installed: false, authState: 'connected', authMode: 'api_key' },
        null
      )
    ).toContain('Install Ollama');

    expect(providerSettingsAuthTitle({ id: 'ollama', installed: true, authState: 'detected', authMode: null })).toBe('Local Ollama is installed');
    expect(providerSettingsPillLabel({ id: 'ollama', installed: true, authState: 'detected', authMode: null })).toBe('Needs start');
    expect(providerSettingsAuthTitle({ id: 'ollama', installed: true, authState: 'connected', authMode: null })).toBe('Ollama is available');
    expect(
      providerSettingsAuthDescription({
        id: 'ollama',
        installed: true,
        authState: 'connected',
        authMode: null,
        message: 'Ollama local runtime is ready, but no local models were found. Pull a model first.'
      })
    ).toBe('Ollama local runtime is ready, but no local models were found. Pull a model first.');
    expect(
      providerSettingsStatusSummary(
        { id: 'ollama', installed: true, authState: 'detected', authMode: null, models: [] },
        null
      )
    ).toBe('Local Ollama is installed, but not running yet');
    expect(providerSettingsInstallLabel({ id: 'ollama', installed: true, authMode: null }, { installed: true })).toBe('Local install found');
  });

  it('summarizes managed and reachable Ollama runtime states without overclaiming', () => {
    expect(
      providerSettingsStatusSummary(
        { id: 'ollama', installed: true, authState: 'checking', authMode: null, models: [] },
        { managedByApp: true, reachable: false, starting: true }
      )
    ).toBe('Starting local Ollama...');
    expect(
      providerSettingsStatusSummary(
        { id: 'ollama', installed: true, authState: 'connected', authMode: null, models: [{ id: 'qwen3-coder' }] },
        { managedByApp: true, reachable: true, starting: false }
      )
    ).toBe('1 local model ready in local Ollama');
    expect(
      providerSettingsStatusSummary(
        { id: 'ollama', installed: true, authState: 'connected', authMode: null, models: [] },
        { managedByApp: false, reachable: true, starting: false }
      )
    ).toBe('No local models found. Pull a local model first.');
    expect(
      providerSettingsOllamaModeSummary(
        { id: 'ollama', installed: true, authState: 'connected', authMode: null },
        { managedByApp: false, reachable: true, starting: false }
      )
    ).toBe('Use local models from this PC.');
  });

  it('aligns supported provider defaults with the current beta routes', () => {
    expect(getProviderMetadata('ollama').defaultModelId).toBe(OLLAMA_DEFAULT_LOCAL_MODEL_ID);
    expect(getProviderMetadata('openai_compatible').defaultModelId).toBe('openai-compatible');
  });

  it('keeps the surfaced provider set to Ollama plus configured OpenAI-compatible APIs', () => {
    expect(getProviderMetadata('ollama').label).toBe('Ollama');
    expect(getProviderMetadata('openai_compatible').label).toBe('Custom API');
    expect(isRetiredProviderId('openai')).toBe(true);
    expect(isRetiredProviderId('gemini')).toBe(true);
  });
});
