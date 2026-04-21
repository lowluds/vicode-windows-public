import { describe, expect, it } from 'vitest';
import { formatUserErrorMessage, parseWorkspaceUnavailableError } from './error-format';

describe('formatUserErrorMessage', () => {
  it('unwraps Electron invoke prefixes and maps untrusted workspace errors', () => {
    const error = new Error(
      "Error invoking remote method 'composer:submit': Error: Codex cannot run against an untrusted workspace. Trust the project and retry."
    );

    expect(formatUserErrorMessage(error, 'fallback')).toBe(
      'This workspace is not trusted yet. Click Enable workspace in the header before running Codex.'
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

  it('maps Gemini no-output failures to a retry-oriented message', () => {
    const error = new Error("Error invoking remote method 'composer:submit': Error: Gemini CLI exited successfully without producing assistant output.");

    expect(formatUserErrorMessage(error, 'fallback')).toBe(
      'Gemini finished the run without returning a reply. Retry once. If it keeps happening, switch the model to Auto Gemini 2.5 or Gemini 2.5 Flash.'
    );
  });
});
