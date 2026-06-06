import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import type { Page, TestInfo } from '@playwright/test';
import {
  classifyRunFailureText,
  type RunFailureClass
} from '../../src/shared/run-failure-classification';

export interface RunFailureDiagnosticContext {
  label: string;
  threadId?: string | null;
  workspaceDir?: string | null;
}

export interface ExpectedRunFailure {
  expectedClass: RunFailureClass;
  message?: RegExp;
}

interface VisibleRunFailure {
  text: string;
  classification: RunFailureClass;
}

function normalizeText(text: string) {
  return text.replace(/\s+/gu, ' ').trim();
}

function safeAttachmentName(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/^-|-$/gu, '') || 'run-failure';
}

async function listWorkspaceEntries(root: string, depth = 2): Promise<string[]> {
  async function walk(current: string, prefix: string, remainingDepth: number): Promise<string[]> {
    const entries = await readdir(current).catch(() => []);
    const results: string[] = [];
    for (const entry of entries.sort()) {
      const absolutePath = path.join(current, entry);
      const relativePath = prefix ? `${prefix}/${entry}` : entry;
      results.push(relativePath);
      if (remainingDepth > 0 && (await stat(absolutePath).catch(() => null))?.isDirectory()) {
        results.push(...await walk(absolutePath, relativePath, remainingDepth - 1));
      }
    }
    return results;
  }

  return walk(root, '', depth);
}

async function readThreadSnapshot(page: Page, threadId: string | null | undefined) {
  if (!threadId) {
    return null;
  }

  return page.evaluate(async (activeThreadId) => {
    const detail = await window.vicode.threads.open(activeThreadId);
    return {
      id: detail.id,
      status: detail.status,
      title: detail.title,
      failureEvents: detail.rawOutput
        .filter((event) => event.eventType === 'failed')
        .map((event) => ({
          runId: event.runId,
          createdAt: event.createdAt,
          message: typeof event.payload.message === 'string' ? event.payload.message : null
        })),
      recentInfoEvents: detail.rawOutput
        .filter((event) => event.eventType === 'info')
        .slice(-8)
        .map((event) => ({
          runId: event.runId,
          createdAt: event.createdAt,
          message: typeof event.payload.message === 'string' ? event.payload.message : null,
          activity: event.payload.activity ?? null
        }))
    };
  }, threadId).catch((error) => ({
    error: error instanceof Error ? error.message : String(error)
  }));
}

export async function readVisibleRunFailures(page: Page): Promise<VisibleRunFailure[]> {
  const cards = page.locator('.run-activity-outcome-failed');
  const failures: VisibleRunFailure[] = [];
  const count = await cards.count().catch(() => 0);
  for (let index = 0; index < count; index += 1) {
    const text = normalizeText(await cards.nth(index).textContent().catch(() => '') ?? '');
    if (text) {
      failures.push({
        text,
        classification: classifyRunFailureText(text)
      });
    }
  }
  return failures;
}

async function attachRunFailureDiagnostics(
  page: Page,
  testInfo: TestInfo,
  context: RunFailureDiagnosticContext,
  failures: VisibleRunFailure[]
) {
  const attachmentPrefix = safeAttachmentName(context.label);
  const screenshotPath = testInfo.outputPath(`${attachmentPrefix}-visible-run-failure.png`);
  await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => undefined);
  await testInfo.attach(`${attachmentPrefix}-visible-run-failure.png`, {
    path: screenshotPath,
    contentType: 'image/png'
  }).catch(() => undefined);

  const diagnostics = {
    label: context.label,
    url: page.url(),
    visibleFailures: failures,
    thread: await readThreadSnapshot(page, context.threadId),
    workspaceEntries: context.workspaceDir ? await listWorkspaceEntries(context.workspaceDir).catch((error) => [
      `Unable to list workspace: ${error instanceof Error ? error.message : String(error)}`
    ]) : null
  };

  await testInfo.attach(`${attachmentPrefix}-run-failure-diagnostics.json`, {
    body: JSON.stringify(diagnostics, null, 2),
    contentType: 'application/json'
  }).catch(() => undefined);
}

export async function expectNoVisibleRunFailures(
  page: Page,
  testInfo: TestInfo,
  context: RunFailureDiagnosticContext
) {
  const failures = await readVisibleRunFailures(page);
  if (failures.length === 0) {
    return;
  }

  await attachRunFailureDiagnostics(page, testInfo, context, failures);
  throw new Error(
    `Unexpected visible Run Failed card during ${context.label}. `
    + `Classifications: ${failures.map((failure) => failure.classification).join(', ')}. `
    + `First failure: ${failures[0]?.text ?? 'unknown'}`
  );
}

export async function expectVisibleRunFailure(
  page: Page,
  expected: ExpectedRunFailure,
  testInfo: TestInfo,
  context: RunFailureDiagnosticContext,
  timeoutMs = 15_000
) {
  const deadline = Date.now() + timeoutMs;
  let latestFailures: VisibleRunFailure[] = [];
  while (Date.now() < deadline) {
    latestFailures = await readVisibleRunFailures(page);
    const match = latestFailures.find((failure) =>
      failure.classification === expected.expectedClass
      && (!expected.message || expected.message.test(failure.text))
    );
    if (match) {
      return match;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  await attachRunFailureDiagnostics(page, testInfo, context, latestFailures);
  throw new Error(
    `Expected visible ${expected.expectedClass} Run Failed card during ${context.label}, `
    + `but saw ${latestFailures.length === 0 ? 'no visible run failures' : latestFailures.map((failure) => `${failure.classification}: ${failure.text}`).join(' | ')}.`
  );
}
