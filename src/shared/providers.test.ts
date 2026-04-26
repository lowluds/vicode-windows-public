import { describe, expect, it } from 'vitest';
import {
  getProviderMetadata,
  providerBlockedRunMessage,
  providerCanRunInComposer,
  providerCliAuthLaunch,
  providerCliCommands,
  providerCliExecutableName,
  providerCapabilities,
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
  providerSubagentConcurrencyLimit,
  providerUsesHostedApi,
  selectPreferredOllamaModel,
  selectPreferredOllamaVisionModel,
  selectPreferredOllamaValidationModels,
  selectPreferredSubagentModel
} from './providers';

describe('shared provider helpers', () => {
  it('treats hosted Ollama api-key mode as composer-runnable without a local install', () => {
    expect(
      providerCanRunInComposer({
        id: 'ollama',
        installed: false,
        authMode: 'api_key'
      })
    ).toBe(true);
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

  it('recognizes hosted Ollama api-key mode explicitly', () => {
    expect(
      providerUsesHostedApi({
        id: 'ollama',
        authMode: 'api_key'
      })
    ).toBe(true);
  });

  it('marks Ollama as supporting runtime skill resources through prompt-backed injection', () => {
    expect(providerCapabilities('ollama').supportsRuntimeSkillResources).toBe(true);
  });

  it('declares lane authority explicitly for CLI-backed and app-hosted providers', () => {
    expect(providerCapabilities('openai')).toMatchObject({
      executionAuthority: 'provider_cli',
      approvalAuthority: 'none',
      sandboxAuthority: 'provider_cli',
      requiresTrustedWorkspace: true
    });
    expect(providerCapabilities('gemini')).toMatchObject({
      executionAuthority: 'provider_cli',
      approvalAuthority: 'provider_cli',
      sandboxAuthority: 'provider_cli',
      requiresTrustedWorkspace: true
    });
    expect(providerCapabilities('ollama')).toMatchObject({
      executionAuthority: 'app_runtime',
      approvalAuthority: 'app',
      sandboxAuthority: 'app_runtime',
      requiresTrustedWorkspace: true
    });
    expect(providerCapabilities('kimi')).toMatchObject({
      executionAuthority: 'provider_cli',
      approvalAuthority: 'none',
      sandboxAuthority: 'none',
      requiresTrustedWorkspace: true
    });
  });

  it('surfaces lane-specific permission boundaries from shared provider metadata', () => {
    expect(providerPermissionBoundaryNote('openai', 'default')).toContain('does not expose an app approval pause');
    expect(providerPermissionBoundaryNote('gemini', 'full_access')).toContain('owns approval and sandbox behavior');
    expect(providerPermissionBoundaryNote('ollama', 'default')).toContain('Vicode owns approvals in this lane');
    expect(providerPermissionBoundaryNote('kimi', 'default')).toContain('requires Full access');
  });

  it('disables invalid permission options for lanes that require full access', () => {
    expect(providerPermissionOptionDisabled('kimi', 'default')).toBe(true);
    expect(providerPermissionOptionDisabled('kimi', 'full_access')).toBe(false);
    expect(providerPermissionOptionDisabled('openai', 'default')).toBe(false);
  });

  it('prefers coder-style hosted Ollama models when available', () => {
    expect(
      selectPreferredOllamaModel([
        { id: 'llama3.1:8b' },
        { id: 'qwen3-coder-next' },
        { id: 'deepseek-r1:8b' }
      ])
    ).toEqual({ id: 'qwen3-coder-next' });
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

  it('returns a primary and alternate hosted Ollama validation set', () => {
    expect(
      selectPreferredOllamaValidationModels([
        { id: 'qwen3-coder-next' },
        { id: 'llama3.1:8b' },
        { id: 'deepseek-r1:8b' }
      ])
    ).toEqual([{ id: 'qwen3-coder-next' }, { id: 'llama3.1:8b' }]);
  });

  it('prefers lower-cost background agent models by provider', () => {
    expect(
      selectPreferredSubagentModel('openai', [
        { id: 'gpt-5.4', recommendation: 'recommended' },
        { id: 'gpt-5.4-mini', recommendation: 'fast' }
      ])
    ).toEqual({ id: 'gpt-5.4-mini', recommendation: 'fast' });

    expect(
      selectPreferredSubagentModel('gemini', [
        { id: 'gemini-2.5-pro', recommendation: 'recommended' },
        { id: 'gemini-2.5-flash', recommendation: 'fast' },
        { id: 'gemini-2.5-flash-lite' }
      ])
    ).toEqual({ id: 'gemini-2.5-flash', recommendation: 'fast' });

    expect(
      selectPreferredSubagentModel('ollama', [
        { id: 'qwen3-coder:30b', recommendation: 'recommended' },
        { id: 'qwen3-coder:7b' },
        { id: 'llama3.1:8b' }
      ])
    ).toEqual({ id: 'qwen3-coder:7b' });
  });

  it('maps recommendation flags to user-facing labels', () => {
    expect(providerModelRecommendationLabel('recommended')).toBe('Default');
    expect(providerModelRecommendationLabel('fast')).toBe('Quick');
    expect(providerModelRecommendationLabel('preview')).toBe('Preview');
    expect(providerModelRecommendationLabel(undefined)).toBeNull();
  });

  it('exposes provider-aware subagent concurrency caps', () => {
    expect(providerSubagentConcurrencyLimit('openai')).toBe(4);
    expect(providerSubagentConcurrencyLimit('gemini')).toBe(4);
    expect(providerSubagentConcurrencyLimit('qwen')).toBe(3);
    expect(providerSubagentConcurrencyLimit('kimi')).toBe(3);
    expect(providerSubagentConcurrencyLimit('ollama')).toBe(2);
  });

  it('returns provider-specific serious-coding guidance', () => {
    expect(providerRecommendedRouteSummary('openai')).toContain('Newest available');
    expect(providerRecommendedRouteSummary('gemini')).toContain('Auto Gemini 2.5');
    expect(providerRecommendedRouteSummary('ollama', { hosted: true })).toMatch(/cloud/i);
    expect(providerRecommendedRouteSummary('ollama', { hosted: false })).toMatch(/local/i);
  });

  it('summarizes transitional setup states for provider menus', () => {
    expect(providerSetupMenuSummary({ id: 'openai', installed: true, authState: 'checking', authMode: 'cli' })).toBe('Finishing sign-in');
    expect(providerSetupMenuSummary({ id: 'ollama', installed: true, authState: 'detected', authMode: null })).toBe('Start local runtime');
    expect(providerSetupMenuSummary({ id: 'gemini', installed: false, authState: 'missing_cli', authMode: 'cli' })).toContain('Gemini CLI');
  });

  it('replaces stale model labels with setup state in the composer trigger', () => {
    expect(
      providerModelTriggerSummary(
        { id: 'openai', installed: false, authState: 'missing_cli', authMode: 'cli', models: [] },
        null
      )
    ).toContain('Codex CLI');
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
    expect(providerSetupGuidance({ id: 'openai', installed: false, authState: 'missing_cli', authMode: 'cli' })).toContain('Codex CLI');
    expect(providerBlockedRunMessage({ id: 'ollama', installed: true, authState: 'detected', authMode: null })).toContain('not running yet');
    expect(providerBlockedRunMessage({ id: 'gemini', installed: true, authState: 'disconnected', authMode: 'cli' })).toContain('before sending');
  });

  it('returns shared settings labels for the main provider states', () => {
    expect(providerSettingsAuthTitle({ id: 'openai', installed: false, authState: 'missing_cli', authMode: 'cli' })).toBe('Install Codex CLI');
    expect(providerSettingsAuthDescription({ id: 'gemini', installed: false, authState: 'missing_cli', authMode: 'cli', message: undefined })).toContain('Gemini CLI');
    expect(providerSettingsAuthTitle({ id: 'gemini', installed: true, authState: 'detected', authMode: 'cli' })).toBe('Local sign-in found');
    expect(providerSettingsPillLabel({ id: 'gemini', installed: true, authState: 'detected', authMode: 'cli' })).toBe('Found locally');
    expect(providerSettingsConnectLabel({ id: 'gemini', authState: 'detected', authMode: 'cli' })).toBe('Connect');
    expect(
      providerSettingsAuthDescription({
        id: 'gemini',
        installed: true,
        authState: 'detected',
        authMode: 'cli',
        message: undefined
      })
    ).toContain('Choose Connect');
    expect(providerSettingsConnectLabel({ id: 'openai', authState: 'disconnected', authMode: null })).toBe('Connect');
    expect(providerSettingsConnectLabel({ id: 'openai', authState: 'disconnected', authMode: 'cli' })).toBe('Connect');
    expect(providerSettingsInstallActionLabel({ id: 'openai', authMode: 'cli' })).toBe('Install Codex CLI');
  });

  it('returns shared settings labels for cloud and local Ollama states', () => {
    expect(providerSettingsAuthTitle({ id: 'ollama', installed: false, authState: 'connected', authMode: 'api_key' })).toBe('Cloud models are ready');
    expect(providerSettingsPillLabel({ id: 'ollama', installed: false, authState: 'connected', authMode: 'api_key' })).toBe('Cloud ready');
    expect(providerSettingsInstallLabel({ id: 'ollama', installed: false, authMode: 'api_key' }, null)).toBe('Cloud only');
    expect(
      providerSettingsStatusSummary(
        { id: 'ollama', installed: false, authState: 'connected', authMode: 'api_key', models: [] },
        null
      )
    ).toContain('Cloud models are connected');
    expect(
      providerSettingsOllamaModeSummary(
        { id: 'ollama', installed: false, authState: 'connected', authMode: 'api_key' },
        null
      )
    ).toContain('Cloud models');

    expect(providerSettingsAuthTitle({ id: 'ollama', installed: true, authState: 'detected', authMode: null })).toBe('Local Ollama is installed');
    expect(providerSettingsPillLabel({ id: 'ollama', installed: true, authState: 'detected', authMode: null })).toBe('Needs start');
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
    ).toBe('Local Ollama is reachable, but no local models were found yet');
  });

  it('aligns the main provider defaults with the benchmark-backed starting routes', () => {
    expect(getProviderMetadata('openai').defaultModelId).toBe('gpt-5.5');
    expect(getProviderMetadata('gemini').defaultModelId).toBe('auto-gemini-2.5');
    expect(getProviderMetadata('ollama').defaultModelId).toBe('qwen3-coder');
  });

  it('centralizes CLI command resolution and auth launch metadata for shared provider setup flows', () => {
    expect(providerCliCommands('openai')).toEqual(['codex.cmd', 'codex.exe', 'codex']);
    expect(providerCliCommands('gemini')).toEqual(['gemini.cmd', 'gemini.exe', 'gemini']);
    expect(providerCliExecutableName('gemini')).toBe('gemini.cmd');
    expect(providerCliAuthLaunch('openai')).toEqual({
      title: 'OpenAI Codex Login',
      args: ['login']
    });
    expect(providerCliAuthLaunch('gemini')).toEqual({
      title: 'Gemini CLI Login',
      args: []
    });
  });
});
