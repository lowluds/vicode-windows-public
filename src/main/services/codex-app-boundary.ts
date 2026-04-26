import { homedir } from 'node:os';
import { isAbsolute, relative, resolve } from 'node:path';

function normalizePathForBoundary(path: string) {
  const resolved = resolve(path);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

export function getOperatorCodexHome() {
  return resolve(homedir(), '.codex');
}

export function isPathInsideRoot(root: string, target: string) {
  const normalizedRoot = normalizePathForBoundary(root);
  const normalizedTarget = normalizePathForBoundary(target);
  const distance = relative(normalizedRoot, normalizedTarget);
  return distance === '' || (Boolean(distance) && !distance.startsWith('..') && !isAbsolute(distance));
}

export function isInsideOperatorCodexHome(target: string) {
  return isPathInsideRoot(getOperatorCodexHome(), target);
}

export function assertOutsideOperatorCodexHome(target: string, operation: string) {
  if (!isInsideOperatorCodexHome(target)) {
    return;
  }

  throw new Error(
    `Refusing to ${operation} inside the operator Codex app home: ${resolve(target)}. Vicode and Codex app state are separate; use a Vicode-owned path or an isolated Codex home instead.`
  );
}
