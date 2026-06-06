import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { BrowserWindow } from 'electron';

const DEFAULT_PREVIEW_TIMEOUT_MS = 10_000;
const MAX_VISIBLE_TEXT_CHARS = 1_000;
const LOCAL_PREVIEW_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '::1',
  '[::1]'
]);

export interface BrowserPreviewSelectorResult {
  selector: string;
  found: boolean;
}

export interface BrowserPreviewCheckInput {
  url: string;
  expectedText?: string | null;
  expectedSelectors?: string[];
  captureScreenshot?: boolean;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface BrowserPreviewCheckResult {
  url: string;
  finalUrl: string;
  title: string;
  loaded: boolean;
  expectedTextFound: boolean | null;
  selectorResults: BrowserPreviewSelectorResult[];
  consoleErrors: string[];
  loadErrors: string[];
  failedRequests: string[];
  screenshotPath: string | null;
  visibleTextExcerpt: string;
}

export interface BrowserPreviewService {
  checkPreview(input: BrowserPreviewCheckInput): Promise<BrowserPreviewCheckResult>;
}

function assertLocalPreviewUrl(rawUrl: string) {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error('browser_preview_check requires a valid HTTP or HTTPS URL.');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('browser_preview_check only supports HTTP or HTTPS preview URLs.');
  }

  const host = parsed.hostname.toLowerCase();
  const isLoopbackV4 = /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/u.test(host);
  if (!LOCAL_PREVIEW_HOSTS.has(host) && !isLoopbackV4) {
    throw new Error('browser_preview_check is limited to local preview URLs for this beta.');
  }

  return parsed.toString();
}

function withTimeout<T>(
  task: Promise<T>,
  timeoutMs: number,
  onTimeout: () => void
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      onTimeout();
      reject(new Error(`Preview did not finish loading within ${timeoutMs}ms.`));
    }, timeoutMs);

    task.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error) => {
        clearTimeout(timeout);
        reject(error);
      }
    );
  });
}

function normalizeExpectedSelectors(value: string[] | undefined) {
  return (value ?? [])
    .map((selector) => selector.trim())
    .filter((selector) => selector.length > 0)
    .slice(0, 8);
}

export class ElectronBrowserPreviewService implements BrowserPreviewService {
  constructor(private readonly exportsDir: string) {}

  async checkPreview(input: BrowserPreviewCheckInput): Promise<BrowserPreviewCheckResult> {
    const url = assertLocalPreviewUrl(input.url);
    const timeoutMs = Math.min(
      Math.max(input.timeoutMs ?? DEFAULT_PREVIEW_TIMEOUT_MS, 1_000),
      30_000
    );
    const expectedText = input.expectedText?.trim() || null;
    const expectedSelectors = normalizeExpectedSelectors(input.expectedSelectors);
    const consoleErrors: string[] = [];
    const loadErrors: string[] = [];
    const failedRequests: string[] = [];
    const window = new BrowserWindow({
      show: false,
      width: 1280,
      height: 900,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true
      }
    });

    const abortHandler = () => {
      window.webContents.stop();
    };
    input.signal?.addEventListener('abort', abortHandler, { once: true });

    window.webContents.on('console-message', (_event, level, message, line, sourceId) => {
      if (level >= 2) {
        consoleErrors.push(`${message}${sourceId ? ` (${sourceId}:${line})` : ''}`);
      }
    });
    window.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedUrl) => {
      loadErrors.push(`${errorCode} ${errorDescription}${validatedUrl ? ` ${validatedUrl}` : ''}`.trim());
    });
    window.webContents.on('did-fail-provisional-load', (_event, errorCode, errorDescription, validatedUrl) => {
      failedRequests.push(`${errorCode} ${errorDescription}${validatedUrl ? ` ${validatedUrl}` : ''}`.trim());
    });

    try {
      if (input.signal?.aborted) {
        throw new Error('Preview check was aborted before loading.');
      }

      await withTimeout(window.loadURL(url), timeoutMs, () => {
        window.webContents.stop();
      });

      const pageSnapshot = await window.webContents.executeJavaScript(
        `(() => {
          const selectors = ${JSON.stringify(expectedSelectors)};
          const bodyText = document.body?.innerText || '';
          return {
            title: document.title || '',
            text: bodyText.slice(0, ${MAX_VISIBLE_TEXT_CHARS}),
            fullText: bodyText,
            selectors: selectors.map((selector) => ({
              selector,
              found: Boolean(document.querySelector(selector))
            }))
          };
        })()`,
        true
      ) as {
        title?: string;
        text?: string;
        fullText?: string;
        selectors?: BrowserPreviewSelectorResult[];
      };

      let screenshotPath: string | null = null;
      if (input.captureScreenshot) {
        const artifactDir = join(this.exportsDir, 'browser-preview');
        await mkdir(artifactDir, { recursive: true });
        screenshotPath = join(artifactDir, `preview-${Date.now()}.png`);
        const image = await window.webContents.capturePage();
        await writeFile(screenshotPath, image.toPNG());
      }

      return {
        url,
        finalUrl: window.webContents.getURL() || url,
        title: pageSnapshot.title ?? '',
        loaded: loadErrors.length === 0,
        expectedTextFound: expectedText
          ? (pageSnapshot.fullText ?? '').toLowerCase().includes(expectedText.toLowerCase())
          : null,
        selectorResults: pageSnapshot.selectors ?? [],
        consoleErrors,
        loadErrors,
        failedRequests,
        screenshotPath,
        visibleTextExcerpt: pageSnapshot.text ?? ''
      };
    } finally {
      input.signal?.removeEventListener('abort', abortHandler);
      if (!window.isDestroyed()) {
        window.close();
      }
    }
  }
}
