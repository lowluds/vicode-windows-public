import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as providerUtil from '../util';

const { spawnMock, readFileMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(),
  readFileMock: vi.fn()
}));

vi.mock('node:child_process', () => ({
  spawn: spawnMock
}));

vi.mock('node:fs/promises', async () => {
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
  return {
    ...actual,
    readFile: readFileMock
  };
});

import { KimiAdapter } from './adapter';

class FakeChildProcess extends EventEmitter {
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly stdin = new PassThrough();
  readonly kill = vi.fn(() => {
    this.emit('close', null);
    return true;
  });
}

describe('KimiAdapter', () => {
  beforeEach(() => {
    spawnMock.mockReset();
    readFileMock.mockReset();
    readFileMock.mockRejectedValue(Object.assign(new Error('missing'), { code: 'ENOENT' }));
  });

  it('discovers kimi runtime models from local config.toml', async () => {
    readFileMock.mockResolvedValue(`
[providers.default]
type = "kimi"
base_url = "https://api.moonshot.ai"

[models.kimi-k2-thinking]
provider = "default"
model = "kimi-k2-thinking"
capabilities = ["thinking", "image_in"]
`);

    const adapter = new KimiAdapter();
    const models = await adapter.discoverRuntimeModels();

    expect(models).toHaveLength(1);
    expect(models).toMatchObject([
      {
        id: 'kimi-k2-thinking',
        label: 'Kimi K2 Thinking',
        description: 'Model discovered from local Kimi config. Supports thinking mode. Supports image input.',
        supportsVision: true,
        contextWindowTokens: 262_144,
        contextWindowSource: 'official',
        autoCompactTokenLimit: null,
        recommendation: undefined
      }
    ]);
  });

  it('reports connected auth state when kimi provider config is present', async () => {
    readFileMock.mockResolvedValue(`
[providers.default]
type = "kimi"
base_url = "https://api.moonshot.ai"

[models.kimi-k2-thinking]
provider = "default"
model = "kimi-k2-thinking"
capabilities = ["thinking"]
`);
    vi.spyOn(providerUtil, 'fileExists').mockResolvedValue(true);

    const adapter = new KimiAdapter();
    const authState = await adapter.getAuthState(null);

    expect(authState).toEqual({
      authState: 'connected',
      authMode: 'cli',
      message:
        'Kimi Code CLI is configured on this machine. Note: Vicode uses Kimi non-interactively, and the official CLI documents that print mode implies auto-approval.'
    });
  });

  it('streams assistant output from structured json events', async () => {
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);

    const onStart = vi.fn();
    const onDelta = vi.fn();
    const onInfo = vi.fn();
    const onComplete = vi.fn();
    const onError = vi.fn();
    const onAbort = vi.fn();

    const adapter = new KimiAdapter();
    vi.spyOn(adapter, 'detectInstall').mockResolvedValue({
      installed: true,
      cliPath: 'C:\\Users\\test-user\\AppData\\Roaming\\npm\\kimi.cmd'
    });

    await adapter.startRun(
      {
        threadId: 'thread-1',
        runId: 'run-1',
        prompt: 'Write a hello file',
        modelId: 'kimi-k2-thinking',
        folderPath: 'C:\\Users\\test-user\\Desktop\\vicode-project\\vicode-windows',
        trusted: true,
        apiKey: null,
        runMode: 'default',
        executionPermission: 'full_access',
        thinkingEnabled: false
      },
      { onStart, onDelta, onInfo, onComplete, onError, onAbort }
    );

    child.stdout.write('{"type":"assistant","text":"Created hello.txt."}\n');
    child.emit('close', 0);

    expect(onStart).toHaveBeenCalledTimes(1);
    expect(onDelta).toHaveBeenCalledWith('Created hello.txt.');
    expect(onComplete).toHaveBeenCalledWith('Created hello.txt.');
    expect(onError).not.toHaveBeenCalled();
    expect(onAbort).not.toHaveBeenCalled();
    expect(spawnMock).toHaveBeenCalledWith(
      'cmd.exe',
      expect.arrayContaining([
        'C:\\Users\\test-user\\AppData\\Roaming\\npm\\kimi.cmd',
        '--print',
        '--output-format',
        'stream-json',
        '--yolo'
      ]),
      expect.objectContaining({
        cwd: 'C:\\Users\\test-user\\Desktop\\vicode-project\\vicode-windows',
        windowsHide: true
      })
    );
  });

  it('emits raw adjacent kimi text chunks and leaves readability repair to the shared provider-manager seam', async () => {
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);

    const onComplete = vi.fn();

    const adapter = new KimiAdapter();
    vi.spyOn(adapter, 'detectInstall').mockResolvedValue({
      installed: true,
      cliPath: 'C:\\Users\\test-user\\AppData\\Roaming\\npm\\kimi.cmd'
    });

    await adapter.startRun(
      {
        threadId: 'thread-1',
        runId: 'run-1',
        prompt: 'Say hello',
        modelId: 'kimi-k2-thinking',
        folderPath: null,
        trusted: false,
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
        onError: vi.fn(),
        onAbort: vi.fn()
      }
    );

    child.stdout.write('{"type":"assistant","text":"Hey!I\'m doing"}\n');
    child.stdout.write('{"type":"assistant","text":"well,thanks"}\n');
    child.stdout.write('{"type":"assistant","text":"for asking.How are"}\n');
    child.stdout.write('{"type":"assistant","text":"you?"}\n');
    child.emit('close', 0);

    expect(onComplete).toHaveBeenCalledWith("Hey!I'm doingwell,thanksfor asking.How areyou?");
  });

  it('does not insert spaces into sentence-initial mid-word continuations for kimi output', async () => {
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);

    const onComplete = vi.fn();

    const adapter = new KimiAdapter();
    vi.spyOn(adapter, 'detectInstall').mockResolvedValue({
      installed: true,
      cliPath: 'C:\\Users\\test-user\\AppData\\Roaming\\npm\\kimi.cmd'
    });

    await adapter.startRun(
      {
        threadId: 'thread-1',
        runId: 'run-1',
        prompt: 'Finish the sentence',
        modelId: 'kimi-k2-thinking',
        folderPath: null,
        trusted: false,
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
        onError: vi.fn(),
        onAbort: vi.fn()
      }
    );

    child.stdout.write('{"type":"assistant","text":"Ref"}\n');
    child.stdout.write('{"type":"assistant","text":"inement complete."}\n');
    child.emit('close', 0);

    expect(onComplete).toHaveBeenCalledWith('Refinement complete.');
  });

  it('surfaces structured error messages from kimi json events', async () => {
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);

    const adapter = new KimiAdapter();
    vi.spyOn(adapter, 'detectInstall').mockResolvedValue({
      installed: true,
      cliPath: 'C:\\Users\\test-user\\AppData\\Roaming\\npm\\kimi.cmd'
    });

    const onError = vi.fn();

    await adapter.startRun(
      {
        threadId: 'thread-1',
        runId: 'run-1',
        prompt: 'Write a hello file',
        modelId: 'kimi-k2-thinking',
        folderPath: 'C:\\Users\\test-user\\Desktop\\vicode-project\\vicode-windows',
        trusted: true,
        apiKey: null,
        runMode: 'default',
        executionPermission: 'full_access',
        thinkingEnabled: false
      },
      {
        onStart: vi.fn(),
        onDelta: vi.fn(),
        onInfo: vi.fn(),
        onComplete: vi.fn(),
        onError,
        onAbort: vi.fn()
      }
    );

    child.stdout.write('{"status":"error","error":{"message":"Kimi refused the request."}}\n');
    child.emit('close', 1);

    expect(onError).toHaveBeenCalledWith('Kimi refused the request.');
  });

  it('fails when Kimi exits successfully without producing assistant output', async () => {
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);

    const adapter = new KimiAdapter();
    vi.spyOn(adapter, 'detectInstall').mockResolvedValue({
      installed: true,
      cliPath: 'C:\\Users\\test-user\\AppData\\Roaming\\npm\\kimi.cmd'
    });

    const onComplete = vi.fn();
    const onError = vi.fn();

    await adapter.startRun(
      {
        threadId: 'thread-1',
        runId: 'run-1',
        prompt: 'Write a hello file',
        modelId: 'kimi-k2-thinking',
        folderPath: 'C:\\Users\\test-user\\Desktop\\vicode-project\\vicode-windows',
        trusted: true,
        apiKey: null,
        runMode: 'default',
        executionPermission: 'full_access',
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
    expect(onError).toHaveBeenCalledWith('Kimi CLI exited successfully without producing assistant output.');
  });
});
