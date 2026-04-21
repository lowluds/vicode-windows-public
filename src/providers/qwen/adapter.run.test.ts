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

describe('QwenAdapter run path', () => {
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
    vi.spyOn(providerUtil, 'fileExists').mockResolvedValue(false);
  });

  it('streams raw assistant chunks from qwen json events and leaves readability repair to the shared provider-manager seam', async () => {
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);

    const onStart = vi.fn();
    const onDelta = vi.fn();
    const onInfo = vi.fn();
    const onComplete = vi.fn();
    const onError = vi.fn();
    const onAbort = vi.fn();

    const adapter = new QwenAdapter();
    vi.spyOn(adapter, 'detectInstall').mockResolvedValue({
      installed: true,
      cliPath: 'C:\\Users\\test-user\\AppData\\Roaming\\npm\\qwen.cmd'
    });

    await adapter.startRun(
      {
        threadId: 'thread-1',
        runId: 'run-1',
        prompt: 'Create hello.txt',
        modelId: 'qwen3.5-plus',
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
    child.stdout.write('{"type":"assistant","text":" Added a friendly greeting."}\n');
    child.emit('close', 0);

    expect(onStart).toHaveBeenCalledTimes(1);
    expect(onDelta).toHaveBeenNthCalledWith(1, 'Created hello.txt.');
    expect(onDelta).toHaveBeenNthCalledWith(2, ' Added a friendly greeting.');
    expect(onComplete).toHaveBeenCalledWith('Created hello.txt. Added a friendly greeting.');
    expect(onError).not.toHaveBeenCalled();
    expect(onAbort).not.toHaveBeenCalled();
  });

  it('uses plan approval mode when qwen runs in plan mode', async () => {
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);

    const adapter = new QwenAdapter();
    vi.spyOn(adapter, 'detectInstall').mockResolvedValue({
      installed: true,
      cliPath: 'C:\\Users\\test-user\\AppData\\Roaming\\npm\\qwen.cmd'
    });

    await adapter.startRun(
      {
        threadId: 'thread-1',
        runId: 'run-1',
        prompt: 'Plan this task',
        modelId: 'qwen3.5-plus',
        folderPath: 'C:\\Users\\test-user\\Desktop\\vicode-project\\vicode-windows',
        trusted: true,
        apiKey: null,
        runMode: 'plan',
        executionPermission: 'default',
        thinkingEnabled: false
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

    expect(spawnMock.mock.calls[0]?.[1]).toEqual(expect.arrayContaining(['--approval-mode', 'plan']));
    child.emit('close', 0);
  });
});
