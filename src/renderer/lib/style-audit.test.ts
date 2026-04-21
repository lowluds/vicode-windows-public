import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = process.cwd();
const rendererRoot = resolve(repoRoot, 'src/renderer');
const allowedThemeFiles = new Set([
  'src/renderer/styles/tokens.css',
  'src/renderer/tailwind.css'
]);
const rawColorPattern = /(#[0-9A-Fa-f]{3,8}\b|rgba?\(|oklch\()/;

function collectRendererFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const target = join(dir, entry);
    const stats = statSync(target);
    if (stats.isDirectory()) {
      return collectRendererFiles(target);
    }

    if (!/\.(css|ts|tsx)$/.test(target) || /\.test\.(ts|tsx)$/.test(target)) {
      return [];
    }

    return [target];
  });
}

describe('renderer style audit', () => {
  it('keeps raw color literals inside the canonical theme files only', () => {
    const violations: string[] = [];

    for (const file of collectRendererFiles(rendererRoot)) {
      const relativePath = relative(repoRoot, file).replaceAll('\\', '/');
      if (allowedThemeFiles.has(relativePath)) {
        continue;
      }

      const lines = readFileSync(file, 'utf8').split(/\r?\n/);
      lines.forEach((line, index) => {
        if (rawColorPattern.test(line)) {
          violations.push(`${relativePath}:${index + 1}: ${line.trim()}`);
        }
      });
    }

    expect(violations).toEqual([]);
  });
});
