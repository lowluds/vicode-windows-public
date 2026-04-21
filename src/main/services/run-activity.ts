import type { ProviderId, RunActivityInfo } from '../../shared/domain';

function clean(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

function maybeCapture(match: RegExpMatchArray, index: number) {
  const value = match[index];
  return value ? clean(value) : null;
}

export function deriveRunActivityInfo(_providerId: ProviderId, message: string): RunActivityInfo | null {
  const normalized = clean(message);
  if (!normalized) {
    return null;
  }

  if (/^Thinking$/iu.test(normalized)) {
    return { kind: 'thinking', summary: 'Thinking' };
  }

  let match = normalized.match(/^Searching web(?: for (.+))?$/iu);
  if (match) {
    const query = maybeCapture(match, 1);
    return {
      kind: 'web_search',
      phase: 'started',
      query,
      summary: query ? `Searching web for ${query}` : 'Searching web'
    };
  }

  match = normalized.match(/^Searched web(?: for (.+))?$/iu);
  if (match) {
    const query = maybeCapture(match, 1);
    return {
      kind: 'web_search',
      phase: 'completed',
      query,
      summary: query ? `Searched web for ${query}` : 'Searched web'
    };
  }

  match = normalized.match(/^(?:Loading|Loaded)\s+(?:extension|skill)\s*:\s*(.+)$/iu);
  if (match) {
    const skillName = maybeCapture(match, 1);
    if (skillName) {
      return {
        kind: 'skill',
        summary: skillName,
        text: skillName
      };
    }
  }

  match = normalized.match(/^Started background terminal(?: with (.+))?$/iu);
  if (match) {
    const command = maybeCapture(match, 1);
    return {
      kind: 'terminal_command',
      phase: 'started',
      command,
      summary: command ? `Background terminal running with ${command}` : 'Background terminal running'
    };
  }

  match = normalized.match(/^Background terminal finished(?: with (.+))?$/iu);
  if (match) {
    const command = maybeCapture(match, 1);
    return {
      kind: 'terminal_command',
      phase: 'completed',
      command,
      summary: command ? `Background terminal finished with ${command}` : 'Background terminal finished'
    };
  }

  match = normalized.match(/^Background terminal stopped(?: with (.+))?$/iu);
  if (match) {
    const command = maybeCapture(match, 1);
    return {
      kind: 'terminal_command',
      phase: 'stopped',
      command,
      summary: command ? `Background terminal stopped with ${command}` : 'Background terminal stopped'
    };
  }

  match = normalized.match(/^Running (.+?)(?: for [0-9].*)?$/iu);
  if (match) {
    const command = maybeCapture(match, 1);
    return {
      kind: 'terminal_command',
      phase: 'started',
      command,
      summary: command ? `Running ${command}` : 'Running command'
    };
  }

  match = normalized.match(/^Ran (.+?)(?: for [0-9].*)?$/iu);
  if (match) {
    const command = maybeCapture(match, 1);
    return {
      kind: 'terminal_command',
      phase: 'completed',
      command,
      summary: command ? `Ran ${command}` : 'Ran command'
    };
  }

  return null;
}
