import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as providerUtil from '../util';

const { spawnMock, cpMock, mkdirMock, mkdtempMock, readFileMock, rmMock, statMock, writeFileMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(),
  cpMock: vi.fn(),
  mkdirMock: vi.fn(),
  mkdtempMock: vi.fn(),
  readFileMock: vi.fn(),
  rmMock: vi.fn(),
  statMock: vi.fn(),
  writeFileMock: vi.fn()
}));

vi.mock('node:child_process', () => ({
  spawn: spawnMock
}));

vi.mock('node:fs/promises', async () => {
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
  return {
    ...actual,
    cp: cpMock,
    mkdir: mkdirMock,
    mkdtemp: mkdtempMock,
    readFile: readFileMock,
    rm: rmMock,
    stat: statMock,
    writeFile: writeFileMock
  };
});

import { QwenAdapter } from './adapter';

class FakeChildProcess extends EventEmitter {
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly stdin = new PassThrough();
  readonly kill = vi.fn(() => {
    this.emit('close', null);
    return true;
  });
}

describe('QwenAdapter', () => {
  beforeEach(() => {
    spawnMock.mockReset();
    cpMock.mockReset();
    mkdirMock.mockReset();
    mkdtempMock.mockReset();
    readFileMock.mockReset();
    rmMock.mockReset();
    statMock.mockReset();
    writeFileMock.mockReset();

    cpMock.mockResolvedValue(undefined);
    mkdirMock.mockResolvedValue(undefined);
    mkdtempMock.mockResolvedValue('C:\\temp\\vicode-qwen-test');
    rmMock.mockResolvedValue(undefined);
    statMock.mockRejectedValue(Object.assign(new Error('missing'), { code: 'ENOENT' }));
    writeFileMock.mockResolvedValue(undefined);
    readFileMock.mockRejectedValue(Object.assign(new Error('missing'), { code: 'ENOENT' }));
  });

  it('discovers the configured runtime model from nested Qwen settings', async () => {
    readFileMock.mockImplementation(async (path: string) => {
      if (path.endsWith('settings.json')) {
        return JSON.stringify({
          model: {
            name: 'qwen3.5-plus'
          }
        });
      }

      throw Object.assign(new Error('missing'), { code: 'ENOENT' });
    });

    const adapter = new QwenAdapter();
    const models = await adapter.discoverRuntimeModels();

    expect(models).toHaveLength(1);
    expect(models).toMatchObject([
      {
        id: 'qwen3.5-plus',
        label: 'Qwen 3.5 Plus',
        description: 'Model discovered from local Qwen settings.',
        supportsVision: true,
        contextWindowTokens: 1_000_000,
        contextWindowSource: 'official',
        autoCompactTokenLimit: null,
        recommendation: undefined
      }
    ]);
  });

  it('treats Qwen OAuth as connected only when selected auth and oauth_creds.json are both valid', async () => {
    readFileMock.mockImplementation(async (path: string) => {
      if (path.endsWith('settings.json')) {
        return JSON.stringify({
          security: {
            auth: {
              selectedType: 'qwen-oauth'
            }
          }
        });
      }

      if (path.endsWith('oauth_creds.json')) {
        return JSON.stringify({
          access_token: 'access-token',
          refresh_token: 'refresh-token',
          token_type: 'Bearer',
          expiry_date: Date.now() + 60_000
        });
      }

      throw Object.assign(new Error('missing'), { code: 'ENOENT' });
    });
    statMock.mockResolvedValue({
      mtime: new Date('2026-03-17T10:00:00.000Z')
    });
    vi.spyOn(providerUtil, 'fileExists').mockResolvedValue(true);

    const adapter = new QwenAdapter();
    const authState = await adapter.getAuthState(null);

    expect(authState).toEqual({
      authState: 'connected',
      authMode: 'cli',
      message: 'Qwen OAuth is ready on this machine.'
    });
  });

  it('reports detected when oauth credentials exist but the CLI is configured for OpenAI auth', async () => {
    readFileMock.mockImplementation(async (path: string) => {
      if (path.endsWith('settings.json')) {
        return JSON.stringify({
          security: {
            auth: {
              selectedType: 'openai'
            }
          }
        });
      }

      if (path.endsWith('oauth_creds.json')) {
        return JSON.stringify({
          access_token: 'access-token',
          refresh_token: 'refresh-token',
          token_type: 'Bearer',
          expiry_date: Date.now() + 60_000
        });
      }

      throw Object.assign(new Error('missing'), { code: 'ENOENT' });
    });
    statMock.mockResolvedValue({
      mtime: new Date('2026-03-17T10:00:00.000Z')
    });
    vi.spyOn(providerUtil, 'fileExists').mockResolvedValue(true);

    const adapter = new QwenAdapter();
    const authState = await adapter.getAuthState(null);

    expect(authState.authState).toBe('detected');
    expect(authState.authMode).toBe('cli');
    expect(authState.message).toContain('configured for OpenAI-compatible auth');
  });

  it('injects the official enable_thinking setting into the isolated runtime', async () => {
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);
    vi.spyOn(providerUtil, 'fileExists').mockResolvedValue(false);

    const adapter = new QwenAdapter();
    vi.spyOn(adapter, 'detectInstall').mockResolvedValue({
      installed: true,
      cliPath: 'C:\\Users\\test-user\\AppData\\Roaming\\npm\\qwen.cmd'
    });

    await adapter.startRun(
      {
        threadId: 'thread-1',
        runId: 'run-1',
        prompt: 'Implement the change',
        modelId: 'qwen3.5-plus',
        folderPath: 'C:\\Users\\test-user\\Desktop\\vicode-project\\vicode-windows',
        trusted: true,
        apiKey: null,
        runMode: 'default',
        executionPermission: 'default',
        thinkingEnabled: true
      },
      {
        onStart: vi.fn(),
        onDelta: vi.fn(),
        onInfo: vi.fn(),
        onComplete: vi.fn(),
        onError: vi.fn(),
        onAbort: vi.fn()
      }
    );

    expect(writeFileMock).toHaveBeenCalledWith(
      'C:\\temp\\vicode-qwen-test\\.qwen\\settings.json',
      expect.stringContaining('"enable_thinking": true'),
      'utf8'
    );
    expect(spawnMock.mock.calls[0]?.[2]).toEqual(
      expect.objectContaining({
        env: expect.objectContaining({
          HOME: 'C:\\temp\\vicode-qwen-test',
          USERPROFILE: 'C:\\temp\\vicode-qwen-test',
          APPDATA: 'C:\\temp\\vicode-qwen-test\\AppData\\Roaming',
          LOCALAPPDATA: 'C:\\temp\\vicode-qwen-test\\AppData\\Local',
          TEMP: 'C:\\temp\\vicode-qwen-test\\AppData\\Local\\Temp',
          TMP: 'C:\\temp\\vicode-qwen-test\\AppData\\Local\\Temp',
          PSModuleAnalysisCachePath: 'C:\\temp\\vicode-qwen-test\\AppData\\Local\\Microsoft\\Windows\\PowerShell\\ModuleAnalysisCache'
        }),
        windowsHide: true
      })
    );
  });

  it('fails when Qwen exits successfully without producing assistant output', async () => {
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);
    vi.spyOn(providerUtil, 'fileExists').mockResolvedValue(false);

    const adapter = new QwenAdapter();
    vi.spyOn(adapter, 'detectInstall').mockResolvedValue({
      installed: true,
      cliPath: 'C:\\Users\\test-user\\AppData\\Roaming\\npm\\qwen.cmd'
    });

    const onComplete = vi.fn();
    const onError = vi.fn();

    await adapter.startRun(
      {
        threadId: 'thread-1',
        runId: 'run-1',
        prompt: 'Implement the change',
        modelId: 'qwen3.5-plus',
        folderPath: 'C:\\Users\\test-user\\Desktop\\vicode-project\\vicode-windows',
        trusted: true,
        apiKey: null,
        runMode: 'default',
        executionPermission: 'default',
        thinkingEnabled: false
      },
      {
        onStart: vi.fn(),
        onDelta: vi.fn(),
        onInfo: vi.fn(),
        onComplete,
        onError,
        onAbort: vi.fn()
      }
    );

    child.emit('close', 0);

    expect(onComplete).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith('Qwen CLI exited successfully without producing assistant output.');
  });
});
