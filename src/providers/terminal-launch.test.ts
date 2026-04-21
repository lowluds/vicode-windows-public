import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { spawnMock } = vi.hoisted(() => ({
  spawnMock: vi.fn()
}));

vi.mock('node:child_process', () => ({
  spawn: spawnMock
}));

import { launchTerminalExecutable } from './util';

class FakeDetachedProcess extends EventEmitter {
  readonly unref = vi.fn();
}

describe('launchTerminalExecutable', () => {
  afterEach(() => {
    spawnMock.mockReset();
    vi.restoreAllMocks();
  });

  it('forces cmd shim auth flows into a visible cmd window on Windows', async () => {
    const child = new FakeDetachedProcess();
    spawnMock.mockImplementation(() => {
      queueMicrotask(() => child.emit('spawn'));
      return child;
    });

    await launchTerminalExecutable('Gemini CLI Login', 'C:\\Users\\test-user\\AppData\\Roaming\\npm\\gemini.cmd');

    expect(spawnMock).toHaveBeenCalledTimes(1);
    const [executable, args, options] = spawnMock.mock.calls[0] ?? [];
    expect(String(executable)).toMatch(/(?:powershell|pwsh)\.exe$/iu);
    expect(args).toEqual(expect.arrayContaining(['-NoLogo', '-NonInteractive', '-Command']));

    const launcherCommand = String(Array.isArray(args) ? args[3] : '');
    expect(launcherCommand).toContain('Start-Process -FilePath');
    expect(launcherCommand).toContain('cmd.exe');
    expect(launcherCommand).toContain('-WindowStyle Normal');
    expect(launcherCommand).toContain('Gemini CLI Login');
    expect(launcherCommand).toContain('gemini.cmd');
    expect(launcherCommand).toContain('/k');

    expect(options).toEqual(
      expect.objectContaining({
        shell: false,
        windowsHide: true,
        detached: true,
        stdio: 'ignore',
        env: expect.objectContaining({
          SystemRoot: expect.any(String)
        })
      })
    );
    expect(child.unref).toHaveBeenCalledTimes(1);
  });
});
