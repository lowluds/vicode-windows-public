import type { BrowserPreviewCheckResult } from './browser-preview';

export function readBrowserPreviewExpectedSelectors(args: Record<string, unknown>) {
  if (!Array.isArray(args.expected_selectors)) {
    return [];
  }

  return args.expected_selectors
    .filter((selector): selector is string => typeof selector === 'string' && selector.trim().length > 0)
    .map((selector) => selector.trim())
    .slice(0, 8);
}

export function isBrowserPreviewHealthy(result: BrowserPreviewCheckResult) {
  return (
    result.loaded
    && result.consoleErrors.length === 0
    && result.loadErrors.length === 0
    && result.failedRequests.length === 0
    && result.expectedTextFound !== false
    && result.selectorResults.every((entry) => entry.found)
  );
}

export function formatBrowserPreviewResult(result: BrowserPreviewCheckResult) {
  const healthy = isBrowserPreviewHealthy(result);
  const selectorLines = result.selectorResults.map(
    (entry) => `- ${entry.selector}: ${entry.found ? 'found' : 'missing'}`
  );
  const lines = [
    'Browser preview check',
    `Status: ${healthy ? 'passed' : 'needs_attention'}`,
    `URL: ${result.finalUrl}`,
    result.title ? `Title: ${result.title}` : null,
    result.expectedTextFound === null
      ? null
      : `Expected text: ${result.expectedTextFound ? 'found' : 'missing'}`,
    selectorLines.length > 0 ? `Selectors:\n${selectorLines.join('\n')}` : null,
    `Console errors: ${result.consoleErrors.length}`,
    `Load errors: ${result.loadErrors.length + result.failedRequests.length}`,
    result.screenshotPath ? `Screenshot: ${result.screenshotPath}` : null,
    result.consoleErrors.length > 0 ? `Console error details:\n${result.consoleErrors.slice(0, 5).join('\n')}` : null,
    result.loadErrors.length > 0 ? `Load error details:\n${result.loadErrors.slice(0, 5).join('\n')}` : null,
    result.failedRequests.length > 0 ? `Failed request details:\n${result.failedRequests.slice(0, 5).join('\n')}` : null,
    result.visibleTextExcerpt.trim()
      ? `Visible text excerpt:\n${result.visibleTextExcerpt.trim()}`
      : null
  ];

  return lines.filter((line): line is string => Boolean(line)).join('\n');
}
