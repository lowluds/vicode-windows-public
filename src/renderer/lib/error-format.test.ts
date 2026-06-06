import { describe, expect, it } from 'vitest';
import { formatRunFailureToastMessage, formatUserErrorMessage, formatVisibleRunErrorMessage, parseWorkspaceUnavailableError } from './error-format';

describe('formatUserErrorMessage', () => {
  it('unwraps Electron invoke prefixes and maps untrusted workspace errors', () => {
    const error = new Error(
      "Error invoking remote method 'composer:submit': Error: Codex cannot run against an untrusted workspace. Trust the project and retry."
    );

    expect(formatUserErrorMessage(error, 'fallback')).toBe(
      'This workspace was blocked by an older access rule. Re-open the folder and retry Codex.'
    );
  });

  it('preserves plain provider messages after stripping nested Error prefixes', () => {
    const error = new Error("Error invoking remote method 'composer:submit': Error: Error: Gemini CLI failed.");

    expect(formatUserErrorMessage(error, 'fallback')).toBe('Gemini CLI failed.');
  });

  it('maps missing workspace paths to a repair-oriented message', () => {
    const error = new Error(
      "Error invoking remote method 'composer:submit': Error: Workspace folder is unavailable: C:\\Users\\test-user\\Desktop\\vicode-project\\vitest1. Re-open or repair the project path before running Gemini."
    );

    expect(formatUserErrorMessage(error, 'fallback')).toBe(
      'This workspace folder is missing. Repair the project path in the header before running Gemini.'
    );
    expect(parseWorkspaceUnavailableError(error)).toEqual({
      folderPath: 'C:\\Users\\test-user\\Desktop\\vicode-project\\vitest1',
      provider: 'Gemini'
    });
  });

  it('preserves retired provider CLI no-output failures without active setup advice', () => {
    const error = new Error("Error invoking remote method 'composer:submit': Error: Gemini CLI exited successfully without producing assistant output.");

    expect(formatUserErrorMessage(error, 'fallback')).toBe('Gemini CLI exited successfully without producing assistant output.');
  });

  it('uses the action fallback for generic fetch failures', () => {
    const error = new Error("Error invoking remote method 'settings:refreshProvider': TypeError: fetch failed");

    expect(formatUserErrorMessage(error, 'Unable to refresh provider models.')).toBe('Unable to refresh provider models.');
  });
});

describe('formatRunFailureToastMessage', () => {
  it('unwraps JSON error envelopes and hides provider references for unsupported image input', () => {
    const raw = '{"error":"this model does not support image input (ref: e1e07aae-e61d-45ad-b4a2-f680e2481657)"}';

    expect(formatVisibleRunErrorMessage(raw)).toBe(
      'This model does not support image input. Choose a model with image support and try again.'
    );
    expect(formatRunFailureToastMessage(raw)).toBe(
      'This model does not support image input. Choose a model with image support and try again.'
    );
  });

  it('maps patch hunk failures to a clear run failure toast', () => {
    expect(formatRunFailureToastMessage('error on hunk 3')).toBe(
      'Patch could not be applied. The file likely changed or the generated patch was stale; details are in the thread.'
    );
    expect(formatRunFailureToastMessage('Added line count did not match for hunk at line 3')).toBe(
      'Patch could not be applied. The file likely changed or the generated patch was stale; details are in the thread.'
    );
  });

  it('maps generic fetch failures to a provider reachability toast', () => {
    expect(formatRunFailureToastMessage('fetch failed')).toBe(
      'A provider request failed. Check that the selected provider is reachable, then retry. Details are in the thread.'
    );
  });

  it('preserves non-patch run failures', () => {
    expect(formatRunFailureToastMessage('Gemini CLI failed.')).toBe('Gemini CLI failed.');
  });
});
