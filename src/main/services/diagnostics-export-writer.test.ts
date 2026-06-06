import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createDiagnosticsReportDir,
  sanitizeDiagnosticsFileName,
  writeDiagnosticsJsonInDir,
  writeDiagnosticsTextFile
} from './diagnostics-export-writer';

const createdDirs: string[] = [];

async function createTempDir() {
  const dir = await mkdtemp(join(tmpdir(), 'vicode-diagnostics-writer-test-'));
  createdDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(createdDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('diagnostics export writer', () => {
  it('sanitizes file-name segments', () => {
    expect(sanitizeDiagnosticsFileName('thread:one / unsafe')).toBe('thread-one-unsafe');
    expect(sanitizeDiagnosticsFileName('***')).toBe('thread');
  });

  it('writes formatted diagnostics JSON inside an export directory', async () => {
    const exportsDir = await createTempDir();
    const filePath = await writeDiagnosticsJsonInDir(exportsDir, 'diagnostics.json', {
      exportedAt: '2026-06-02T00:00:00.000Z',
      ok: true
    });

    expect(await readFile(filePath, 'utf8')).toBe([
      '{',
      '  "exportedAt": "2026-06-02T00:00:00.000Z",',
      '  "ok": true',
      '}'
    ].join('\n'));
  });

  it('creates report directories with sanitized ids and writes text files', async () => {
    const exportsDir = await createTempDir();
    const reportDir = await createDiagnosticsReportDir(exportsDir, 'thread:one / unsafe', 1770000000000);
    expect(basename(reportDir)).toBe('thread-report-thread-one-unsafe-1770000000000');
    expect((await stat(reportDir)).isDirectory()).toBe(true);

    const readmePath = join(reportDir, 'README.txt');
    await writeDiagnosticsTextFile(readmePath, 'Support report');
    expect(await readFile(readmePath, 'utf8')).toBe('Support report');
  });
});
