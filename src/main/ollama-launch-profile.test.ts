import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_PREFERENCES } from '../storage/settings-repository';
import type { Preferences, ProviderAccount } from '../shared/domain';
import {
  applyOllamaLaunchProfile,
  createOllamaLaunchController,
  getOllamaLaunchMarkerPath,
  getOllamaLaunchPendingMarkerPath,
  readOllamaLaunchDiagnostics,
  restoreOllamaLaunchProfile,
  validateOllamaLaunchProfile
} from './ollama-launch-profile';

const cleanupPaths: string[] = [];

afterEach(async () => {
  while (cleanupPaths.length > 0) {
    const target = cleanupPaths.pop();
    if (target) {
      await rm(target, { recursive: true, force: true });
    }
  }
});

function createPreferences(input: Partial<Preferences> = {}): Preferences {
  return {
    ...DEFAULT_PREFERENCES,
    defaultModelByProvider: {
      ...DEFAULT_PREFERENCES.defaultModelByProvider,
      ollama: 'previous-ollama-model',
      openai: 'gpt-5'
    },
    defaultProviderId: 'openai',
    ollamaTransportMode: 'chat',
    defaultExecutionPermission: 'full_access',
    selectedProjectId: 'project-1',
    lastOpenedThreadId: 'thread-1',
    ...input
  };
}

function createFakeDb(input: {
  preferences?: Preferences;
  ollamaAccount?: ProviderAccount | null;
} = {}) {
  let preferences = input.preferences ?? createPreferences();
  const getPreferences = vi.fn(() => preferences);
  const savePreferences = vi.fn((next: Partial<Preferences>) => {
    preferences = {
      ...preferences,
      ...next,
      defaultModelByProvider: {
        ...preferences.defaultModelByProvider,
        ...next.defaultModelByProvider
      },
      defaultReasoningEffortByProvider: {
        ...preferences.defaultReasoningEffortByProvider,
        ...next.defaultReasoningEffortByProvider
      },
      defaultThinkingByProvider: {
        ...preferences.defaultThinkingByProvider,
        ...next.defaultThinkingByProvider
      }
    };
    return preferences;
  });
  const getProviderAccount = vi.fn(() => input.ollamaAccount ?? null);

  return {
    db: {
      getPreferences,
      savePreferences,
      getProviderAccount
    },
    get preferences() {
      return preferences;
    }
  };
}

async function createStateDir() {
  const dir = await mkdtemp(join(tmpdir(), 'vicode-ollama-launch-'));
  cleanupPaths.push(dir);
  return dir;
}

describe('validateOllamaLaunchProfile', () => {
  it('accepts the first supported Ollama launch profile shape', () => {
    const profile = validateOllamaLaunchProfile({
      version: 1,
      source: 'ollama-launch',
      providerId: 'ollama',
      modelId: ' qwen2.5-coder:7b ',
      modelSource: 'local',
      baseUrl: ' http://127.0.0.1:11434 ',
      transportMode: 'responses',
      configureOnly: true,
      restore: false,
      createdAt: '2026-06-03T00:00:00.000Z'
    });

    expect(profile).toMatchObject({
      version: 1,
      source: 'ollama-launch',
      providerId: 'ollama',
      modelId: 'qwen2.5-coder:7b',
      modelSource: 'local',
      baseUrl: 'http://127.0.0.1:11434',
      transportMode: 'responses',
      configureOnly: true,
      restore: false
    });
  });

  it('rejects profiles that try to carry credentials', () => {
    expect(() =>
      validateOllamaLaunchProfile({
        version: 1,
        source: 'ollama-launch',
        providerId: 'ollama',
        modelId: 'qwen2.5-coder:7b',
        modelSource: 'cloud',
        apiKey: 'fixture-secret'
      })
    ).toThrow(/credential/i);

    expect(() =>
      validateOllamaLaunchProfile({
        version: 1,
        source: 'ollama-launch',
        providerId: 'ollama',
        modelId: 'qwen2.5-coder:7b',
        modelSource: 'cloud',
        headers: {
          Authorization: 'Bearer fixture-secret'
        }
      })
    ).toThrow(/credential/i);
  });
});

describe('applyOllamaLaunchProfile', () => {
  it('applies only the allowed Ollama default preferences and writes a sanitized marker', async () => {
    const stateDir = await createStateDir();
    const fake = createFakeDb();

    const result = applyOllamaLaunchProfile({
      db: fake.db,
      stateDir,
      profile: validateOllamaLaunchProfile({
        version: 1,
        source: 'ollama-launch',
        providerId: 'ollama',
        modelId: 'qwen2.5-coder:7b',
        modelSource: 'local',
        transportMode: 'responses'
      }),
      now: () => '2026-06-03T00:00:00.000Z'
    });

    expect(result.status).toBe('applied');
    expect(fake.preferences.defaultProviderId).toBe('ollama');
    expect(fake.preferences.defaultModelByProvider.ollama).toBe('qwen2.5-coder:7b');
    expect(fake.preferences.ollamaTransportMode).toBe('responses');
    expect(fake.preferences.defaultExecutionPermission).toBe('full_access');
    expect(fake.preferences.selectedProjectId).toBe('project-1');
    expect(fake.preferences.lastOpenedThreadId).toBe('thread-1');

    const markerText = await readFile(getOllamaLaunchMarkerPath(stateDir), 'utf8');
    expect(markerText).toContain('"source": "ollama-launch"');
    expect(markerText).toContain('"defaultProviderId": "openai"');
    expect(markerText).not.toMatch(/apiKey|token|secret|authorization/i);
  });

  it('encodes local model ids when a legacy Ollama API-key account already exists', async () => {
    const stateDir = await createStateDir();
    const fake = createFakeDb({
      ollamaAccount: {
        providerId: 'ollama',
        authState: 'connected',
        authMode: 'api_key',
        encryptedApiKey: 'encrypted-fixture',
        updatedAt: '2026-06-03T00:00:00.000Z'
      }
    });

    applyOllamaLaunchProfile({
      db: fake.db,
      stateDir,
      profile: validateOllamaLaunchProfile({
        version: 1,
        source: 'ollama-launch',
        providerId: 'ollama',
        modelId: 'qwen2.5-coder:7b',
        modelSource: 'local'
      })
    });

    expect(fake.preferences.defaultModelByProvider.ollama).toBe('local:qwen2.5-coder:7b');
  });
});

describe('readOllamaLaunchDiagnostics', () => {
  it('reports no active launch profile when the marker is absent', async () => {
    const stateDir = await createStateDir();

    expect(readOllamaLaunchDiagnostics(stateDir)).toEqual({
      active: false,
      markerStatus: 'missing',
      appliedAt: null,
      profile: null,
      pending: {
        status: 'missing',
        reason: null,
        deferredAt: null,
        profile: null
      }
    });
  });

  it('returns only sanitized active-profile metadata', async () => {
    const stateDir = await createStateDir();
    const fake = createFakeDb();

    applyOllamaLaunchProfile({
      db: fake.db,
      stateDir,
      profile: validateOllamaLaunchProfile({
        version: 1,
        source: 'ollama-launch',
        providerId: 'ollama',
        profileId: 'launch-qwen-local',
        modelId: 'qwen2.5-coder:7b',
        modelSource: 'local',
        baseUrl: 'http://127.0.0.1:11434',
        transportMode: 'responses',
        configureOnly: true,
        createdAt: '2026-06-03T00:00:00.000Z'
      }),
      now: () => '2026-06-03T00:00:01.000Z'
    });

    expect(readOllamaLaunchDiagnostics(stateDir)).toEqual({
      active: true,
      markerStatus: 'active',
      appliedAt: '2026-06-03T00:00:01.000Z',
      profile: {
        profileId: 'launch-qwen-local',
        providerId: 'ollama',
        modelId: 'qwen2.5-coder:7b',
        modelSource: 'local',
        baseUrlConfigured: true,
        transportMode: 'responses',
        configureOnly: true,
        restore: false,
        createdAt: '2026-06-03T00:00:00.000Z'
      },
      pending: {
        status: 'missing',
        reason: null,
        deferredAt: null,
        profile: null
      }
    });
  });

  it('reports unreadable marker state without exposing marker contents', async () => {
    const stateDir = await createStateDir();
    const markerPath = getOllamaLaunchMarkerPath(stateDir);
    await mkdir(dirname(markerPath), { recursive: true });
    await writeFile(markerPath, '{"source":"ollama-launch","apiKey":"fixture-value"}', 'utf8');

    expect(readOllamaLaunchDiagnostics(stateDir)).toEqual({
      active: false,
      markerStatus: 'unreadable',
      appliedAt: null,
      profile: null,
      pending: {
        status: 'missing',
        reason: null,
        deferredAt: null,
        profile: null
      }
    });
  });
});

describe('createOllamaLaunchController', () => {
  it('defers a second-launch profile during active runs and applies it after the run clears', async () => {
    const stateDir = await createStateDir();
    const fake = createFakeDb();
    let hasActiveRuns = true;
    const profilePath = join(stateDir, 'profile.json');
    await writeFile(
      profilePath,
      JSON.stringify({
        version: 1,
        source: 'ollama-launch',
        providerId: 'ollama',
        profileId: 'launch-qwen-local',
        modelId: 'qwen2.5-coder:7b',
        modelSource: 'local',
        baseUrl: 'http://127.0.0.1:11434',
        transportMode: 'responses',
        createdAt: '2026-06-03T00:00:00.000Z'
      }),
      'utf8'
    );
    const controller = createOllamaLaunchController({
      db: fake.db,
      stateDir,
      hasActiveRuns: () => hasActiveRuns,
      now: () => '2026-06-03T00:00:02.000Z'
    });

    const result = controller.handleProfilePath(profilePath);

    expect(result.status).toBe('deferred');
    expect(result.markerPath).toBe(getOllamaLaunchPendingMarkerPath(stateDir));
    expect(fake.db.savePreferences).not.toHaveBeenCalled();
    expect(fake.preferences.defaultProviderId).toBe('openai');
    expect(fake.preferences.defaultModelByProvider.ollama).toBe('previous-ollama-model');
    expect(fake.preferences.ollamaTransportMode).toBe('chat');

    const pendingText = await readFile(getOllamaLaunchPendingMarkerPath(stateDir), 'utf8');
    expect(pendingText).toContain('"reason": "active-run"');
    expect(pendingText).not.toMatch(/apiKey|token|secret|authorization/i);
    expect(readOllamaLaunchDiagnostics(stateDir)).toEqual({
      active: false,
      markerStatus: 'missing',
      appliedAt: null,
      profile: null,
      pending: {
        status: 'pending',
        reason: 'active-run',
        deferredAt: '2026-06-03T00:00:02.000Z',
        profile: {
          profileId: 'launch-qwen-local',
          providerId: 'ollama',
          modelId: 'qwen2.5-coder:7b',
          modelSource: 'local',
          baseUrlConfigured: true,
          transportMode: 'responses',
          configureOnly: false,
          restore: false,
          createdAt: '2026-06-03T00:00:00.000Z'
        }
      }
    });

    hasActiveRuns = false;
    const applied = controller.applyPendingProfile();

    expect(applied.status).toBe('applied');
    expect(fake.preferences.defaultProviderId).toBe('ollama');
    expect(fake.preferences.defaultModelByProvider.ollama).toBe('qwen2.5-coder:7b');
    expect(fake.preferences.ollamaTransportMode).toBe('responses');
    expect(readOllamaLaunchDiagnostics(stateDir)).toEqual({
      active: true,
      markerStatus: 'active',
      appliedAt: '2026-06-03T00:00:02.000Z',
      profile: {
        profileId: 'launch-qwen-local',
        providerId: 'ollama',
        modelId: 'qwen2.5-coder:7b',
        modelSource: 'local',
        baseUrlConfigured: true,
        transportMode: 'responses',
        configureOnly: false,
        restore: false,
        createdAt: '2026-06-03T00:00:00.000Z'
      },
      pending: {
        status: 'missing',
        reason: null,
        deferredAt: null,
        profile: null
      }
    });
  });

  it('does not defer restore profiles during active runs', async () => {
    const stateDir = await createStateDir();
    const fake = createFakeDb();
    applyOllamaLaunchProfile({
      db: fake.db,
      stateDir,
      profile: validateOllamaLaunchProfile({
        version: 1,
        source: 'ollama-launch',
        providerId: 'ollama',
        modelId: 'qwen2.5-coder:7b',
        modelSource: 'local',
        transportMode: 'responses'
      })
    });
    const profilePath = join(stateDir, 'restore-profile.json');
    await writeFile(
      profilePath,
      JSON.stringify({
        version: 1,
        source: 'ollama-launch',
        providerId: 'ollama',
        modelId: 'qwen2.5-coder:7b',
        restore: true
      }),
      'utf8'
    );
    const controller = createOllamaLaunchController({
      db: fake.db,
      stateDir,
      hasActiveRuns: () => true
    });

    const result = controller.handleProfilePath(profilePath);

    expect(result.status).toBe('restored');
    expect(fake.preferences.defaultProviderId).toBe('openai');
    expect(fake.preferences.defaultModelByProvider.ollama).toBe('previous-ollama-model');
    expect(fake.preferences.ollamaTransportMode).toBe('chat');
  });
});

describe('restoreOllamaLaunchProfile', () => {
  it('restores backed-up values and is idempotent', async () => {
    const stateDir = await createStateDir();
    const fake = createFakeDb();

    applyOllamaLaunchProfile({
      db: fake.db,
      stateDir,
      profile: validateOllamaLaunchProfile({
        version: 1,
        source: 'ollama-launch',
        providerId: 'ollama',
        modelId: 'qwen2.5-coder:7b',
        modelSource: 'local',
        transportMode: 'responses'
      })
    });

    fake.db.savePreferences({
      defaultModelByProvider: {
        ...fake.preferences.defaultModelByProvider,
        ollama: 'another-launch-model'
      }
    });

    const restored = restoreOllamaLaunchProfile({ db: fake.db, stateDir });
    expect(restored.status).toBe('restored');
    expect(fake.preferences.defaultProviderId).toBe('openai');
    expect(fake.preferences.defaultModelByProvider.ollama).toBe('previous-ollama-model');
    expect(fake.preferences.ollamaTransportMode).toBe('chat');

    const secondRestore = restoreOllamaLaunchProfile({ db: fake.db, stateDir });
    expect(secondRestore.status).toBe('noop');
  });
});
