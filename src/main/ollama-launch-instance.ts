import { parseOllamaLaunchArgv } from './ollama-launch-args';
import type { OllamaLaunchProfileResult } from './ollama-launch-profile';

export interface OllamaLaunchWindow {
  focus(): void;
  restore?(): void;
  isMinimized?(): boolean;
  isDestroyed?(): boolean;
}

export interface OllamaLaunchController {
  handleProfilePath(profilePath: string): Promise<OllamaLaunchProfileResult> | OllamaLaunchProfileResult;
  applyPendingProfile?(): Promise<OllamaLaunchProfileResult> | OllamaLaunchProfileResult;
}

function focusWindow(window: OllamaLaunchWindow | null) {
  if (!window || window.isDestroyed?.()) {
    return;
  }

  if (window.isMinimized?.()) {
    window.restore?.();
  }
  window.focus();
}

export async function handleOllamaLaunchSecondInstance(input: {
  argv: readonly string[];
  controller: OllamaLaunchController;
  mainWindow: OllamaLaunchWindow | null;
}): Promise<OllamaLaunchProfileResult | { status: 'ignored' }> {
  const request = parseOllamaLaunchArgv(input.argv);
  if (!request) {
    focusWindow(input.mainWindow);
    return { status: 'ignored' };
  }

  const result = await input.controller.handleProfilePath(request.profilePath);
  focusWindow(input.mainWindow);
  return result;
}
