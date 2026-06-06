import { describe, expect, it, vi } from 'vitest';
import { handleOllamaLaunchSecondInstance } from './ollama-launch-instance';

function createWindowStub(input: { minimized?: boolean } = {}) {
  let minimized = Boolean(input.minimized);
  return {
    focus: vi.fn(),
    restore: vi.fn(() => {
      minimized = false;
    }),
    isMinimized: vi.fn(() => minimized),
    isDestroyed: vi.fn(() => false)
  };
}

describe('handleOllamaLaunchSecondInstance', () => {
  it('hands profile argv to the running app and focuses the window', async () => {
    const window = createWindowStub();
    const controller = {
      handleProfilePath: vi.fn(async () => ({ status: 'applied' as const }))
    };

    const result = await handleOllamaLaunchSecondInstance({
      argv: ['electron.exe', 'app', '--ollama-launch-profile', 'C:/Temp/profile.json'],
      controller,
      mainWindow: window
    });

    expect(result.status).toBe('applied');
    expect(controller.handleProfilePath).toHaveBeenCalledWith('C:/Temp/profile.json');
    expect(window.focus).toHaveBeenCalledOnce();
    expect(window.restore).not.toHaveBeenCalled();
  });

  it('restores a minimized window before focusing', async () => {
    const window = createWindowStub({ minimized: true });
    const controller = {
      handleProfilePath: vi.fn(async () => ({ status: 'restored' as const }))
    };

    const result = await handleOllamaLaunchSecondInstance({
      argv: ['electron.exe', 'app', '--ollama-launch-profile=C:/Temp/profile.json'],
      controller,
      mainWindow: window
    });

    expect(result.status).toBe('restored');
    expect(window.restore).toHaveBeenCalledOnce();
    expect(window.focus).toHaveBeenCalledOnce();
  });

  it('focuses the running app without changing state when no profile flag is present', async () => {
    const window = createWindowStub();
    const controller = {
      handleProfilePath: vi.fn(async () => ({ status: 'applied' as const }))
    };

    const result = await handleOllamaLaunchSecondInstance({
      argv: ['electron.exe', 'app'],
      controller,
      mainWindow: window
    });

    expect(result.status).toBe('ignored');
    expect(controller.handleProfilePath).not.toHaveBeenCalled();
    expect(window.focus).toHaveBeenCalledOnce();
  });
});
