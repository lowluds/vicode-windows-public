import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export function sanitizeDiagnosticsFileName(value: string) {
  const sanitized = value.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return sanitized || 'thread';
}

export async function writeDiagnosticsJsonInDir(
  exportsDir: string,
  fileName: string,
  data: unknown
) {
  await mkdir(exportsDir, { recursive: true });
  const filePath = join(exportsDir, fileName);
  await writeDiagnosticsJsonFile(filePath, data);
  return filePath;
}

export async function createDiagnosticsReportDir(
  exportsDir: string,
  threadId: string,
  timestamp = Date.now()
) {
  const reportDir = join(
    exportsDir,
    `thread-report-${sanitizeDiagnosticsFileName(threadId)}-${timestamp}`
  );
  await mkdir(reportDir, { recursive: true });
  return reportDir;
}

export async function writeDiagnosticsJsonFile(filePath: string, data: unknown) {
  await writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
}

export async function writeDiagnosticsTextFile(filePath: string, content: string) {
  await writeFile(filePath, content, 'utf8');
}
