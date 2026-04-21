import type { ThreadDetail, ThreadTurn } from '../../shared/domain';
import type { ThreadCollaborationSummary } from '../../shared/ipc';
const RECENT_TURN_LIMIT = 12;
const TRANSCRIPT_CHAR_LIMIT = 6_000;

function compactWhitespace(value: string) {
  return value.replace(/\s+/gu, ' ').trim();
}

function normalizeTranscriptContent(value: string) {
  return value
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/gu, '\n')
    .replace(/([^#\n])(?=#{2,6}\s)/gu, '$1\n\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trim();
}

function normalizeSummaryNumericSpacing(value: string) {
  return value
    .replace(/\b(\d{1,2})\s+(\d{2,3})\b/gu, (match, left, right) =>
      `${left}${right}`.length === 4 ? `${left}${right}` : match
    )
    .replace(/\b(\d(?:\s\d){2,})\b/gu, (match) => match.replace(/\s+/gu, ''))
    .replace(/\b(\d{3,4})\s+s(?=[A-Za-z])/gu, '$1s ')
    .replace(/\b(\d{3,4})\s+s\b/gu, '$1s')
    .replace(/\b(\d+)\s+(st|nd|rd|th)(?=[A-Za-z])/giu, '$1$2 ')
    .replace(/\b(\d+)\s+(st|nd|rd|th)\b/giu, '$1$2')
    .replace(/\b(\d+(?:st|nd|rd|th))(?=[A-Za-z])/giu, '$1 ')
    .replace(/\b(\d{3,4}s)(?=[A-Za-z])/gu, '$1 ');
}

function trimSummaryLine(value: string, maxLength: number) {
  const normalized = normalizeSummaryNumericSpacing(compactWhitespace(
    value
      .replace(/^[-*•]\s*/u, '')
      .replace(/^["'`]+|["'`]+$/gu, '')
      .replace(/\s+/gu, ' ')
  ));

  if (!normalized) {
    return null;
  }

  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 3).trimEnd()}...` : normalized;
}

function findLatestTurn(thread: ThreadDetail, role: ThreadTurn['role']) {
  return [...thread.turns].reverse().find((turn) => turn.role === role) ?? null;
}

function toTranscriptBlock(thread: ThreadDetail) {
  const turns = thread.turns
    .filter((turn) => turn.role === 'user' || turn.role === 'assistant')
    .slice(-RECENT_TURN_LIMIT);
  const parts: string[] = [];
  let usedChars = 0;

  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index];
    const roleLabel = turn.role === 'user' ? 'USER' : 'ASSISTANT';
    const content = normalizeTranscriptContent(turn.content);
    if (!content) {
      continue;
    }

    const entry = `${roleLabel}:\n${content}`;
    const nextLength = usedChars + entry.length + (parts.length > 0 ? 2 : 0);
    if (nextLength > TRANSCRIPT_CHAR_LIMIT) {
      break;
    }

    parts.unshift(entry);
    usedChars = nextLength;
  }

  return parts.join('\n\n');
}

function buildFallbackHandoffSummary(thread: ThreadDetail) {
  const userSummary = summarizeTurn(findLatestTurn(thread, 'user'), 180);
  const assistantSummary =
    summarizeTurn(findLatestTurn(thread, 'assistant'), 220) ??
    trimSummaryLine(thread.lastPreview, 220);

  const lines = [userSummary, assistantSummary].filter((value): value is string => Boolean(value));
  if (lines.length === 0) {
    return null;
  }
  return lines.join(' ');
}

function summarizeTurn(turn: ThreadTurn | null, maxLength: number) {
  if (!turn) {
    return null;
  }
  return trimSummaryLine(turn.content, maxLength);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readLatestRunId(thread: ThreadDetail) {
  const latestAssistantRunId = [...thread.turns]
    .reverse()
    .find((turn) => turn.role === 'assistant' && typeof turn.runId === 'string' && turn.runId.trim().length > 0)?.runId;
  if (latestAssistantRunId) {
    return latestAssistantRunId;
  }

  return [...thread.rawOutput]
    .reverse()
    .find((event) => event.eventType === 'completed' && typeof event.runId === 'string' && event.runId.trim().length > 0)?.runId ?? null;
}

function collectLatestRunArtifactSummary(thread: ThreadDetail) {
  const latestRunId = readLatestRunId(thread);
  if (!latestRunId) {
    return null;
  }

  const files = new Set<string>();
  const verificationCommands: string[] = [];

  for (const event of thread.rawOutput) {
    if (event.runId !== latestRunId || !isRecord(event.payload)) {
      continue;
    }

    const activity = isRecord(event.payload.activity) ? event.payload.activity : null;
    if (!activity || typeof activity.kind !== 'string') {
      continue;
    }

    if (activity.kind === 'change_summary') {
      const changeArtifact = isRecord(activity.changeArtifact) ? activity.changeArtifact : null;
      const artifactFiles = Array.isArray(changeArtifact?.files) ? changeArtifact.files : [];
      for (const file of artifactFiles) {
        if (!isRecord(file) || typeof file.path !== 'string') {
          continue;
        }
        const normalizedPath = file.path.trim();
        if (normalizedPath) {
          files.add(normalizedPath);
        }
      }
      continue;
    }

    if (activity.kind === 'terminal_command' && activity.status === 'completed' && typeof activity.command === 'string') {
      const command = activity.command.trim();
      if (
        command
        && /(?:^|\s)(?:npm|pnpm|yarn|bun|npx|vitest|playwright|pytest|cargo|go|dotnet)(?:\s|$)/iu.test(command)
        && /\b(?:test|build|check|verify|lint|typecheck|smoke|e2e)\b/iu.test(command)
        && !verificationCommands.includes(command)
      ) {
        verificationCommands.push(command);
      }
    }
  }

  const parts: string[] = [];
  const fileList = [...files];

  if (fileList.length === 1) {
    parts.push(`Updated ${fileList[0]}.`);
  } else if (fileList.length > 1) {
    parts.push(`Updated ${fileList.length} files.`);
  }

  if (verificationCommands.length === 1) {
    parts.push(`Verified with ${verificationCommands[0]}.`);
  } else if (verificationCommands.length > 1) {
    parts.push(`Verified with ${verificationCommands.length} commands.`);
  }

  return parts.length > 0 ? parts.join(' ') : null;
}

function isGenericAssistantSummary(value: string | null) {
  if (!value) {
    return true;
  }

  const normalized = compactWhitespace(value).toLowerCase();
  if (!normalized) {
    return true;
  }

  return /^(?:done|completed|complete|finished|implemented|fixed|updated|resolved|repair complete|refinement complete|feature slice implemented)\.?$/iu.test(normalized);
}

function pickAssistantSummary(thread: ThreadDetail) {
  const directSummary =
    summarizeTurn(findLatestTurn(thread, 'assistant'), 220) ??
    trimSummaryLine(thread.lastPreview, 220);
  const artifactSummary = trimSummaryLine(collectLatestRunArtifactSummary(thread) ?? '', 220);

  if (artifactSummary && isGenericAssistantSummary(directSummary)) {
    return artifactSummary;
  }

  return directSummary ?? artifactSummary;
}

export function deriveCollaborationThreadSummary(thread: ThreadDetail): ThreadCollaborationSummary {
  const lastPromptSummary = summarizeTurn(findLatestTurn(thread, 'user'), 180);
  const latestAssistantSummary = pickAssistantSummary(thread);
  const artifactSummary = trimSummaryLine(collectLatestRunArtifactSummary(thread) ?? '', 260);
  const handoffSummary =
    trimSummaryLine(
      [buildFallbackHandoffSummary(thread), artifactSummary]
        .filter((value): value is string => Boolean(value))
        .join(' '),
      400
    ) ?? buildFallbackHandoffSummary(thread);

  return {
    lastPromptSummary,
    latestAssistantSummary,
    handoffSummary,
    recommendedNextPrompt: summarizeTurn(findLatestTurn(thread, 'user'), 240)
  };
}

export function buildCollaborationSummaryPrompt(thread: ThreadDetail) {
  const transcript = toTranscriptBlock(thread);
  return [
    'Prepare a collaboration summary for a coding thread.',
    'Return exactly three lines and nothing else:',
    'USER: <one short sentence describing the user\'s current high-level goal>',
    'ASSISTANT: <one short sentence describing the latest useful result or next step>',
    'HANDOFF: <1-3 short sentences describing the task, current state, and next step>',
    'Keep the wording concrete and compact.',
    'Do not use markdown, bullets, quotes, or prefixes beyond USER/ASSISTANT/HANDOFF.',
    '',
    `Thread title: ${thread.title}`,
    '',
    'Recent transcript:',
    transcript || 'No transcript available.'
  ].join('\n');
}

export function parseCollaborationSummaryOutput(
  output: string,
  fallback: ThreadCollaborationSummary
): ThreadCollaborationSummary {
  const normalized = output.replace(/\r\n/gu, '\n');
  const userMatch = normalized.match(/^USER:\s*(.+)$/imu);
  const assistantMatch = normalized.match(/^ASSISTANT:\s*(.+)$/imu);
  const handoffMatch = normalized.match(/^HANDOFF:\s*(.+)$/imu);

  return {
    lastPromptSummary: trimSummaryLine(userMatch?.[1] ?? '', 180) ?? fallback.lastPromptSummary,
    latestAssistantSummary:
      trimSummaryLine(assistantMatch?.[1] ?? '', 220) ?? fallback.latestAssistantSummary,
    handoffSummary: trimSummaryLine(handoffMatch?.[1] ?? '', 400) ?? fallback.handoffSummary,
    recommendedNextPrompt: fallback.recommendedNextPrompt
  };
}

export function deriveSubagentTerminalSummaryFallback(thread: ThreadDetail) {
  return (
    summarizeTurn(findLatestTurn(thread, 'assistant'), 80) ??
    summarizeTurn(findLatestTurn(thread, 'user'), 80) ??
    trimSummaryLine(thread.lastPreview, 80)
  );
}

export function buildSubagentTerminalSummaryPrompt(
  thread: ThreadDetail,
  status: 'completed' | 'failed' | 'cancelled'
) {
  const transcript = toTranscriptBlock(thread);
  const statusLine =
    status === 'completed'
      ? 'The delegated agent finished its task.'
      : status === 'failed'
        ? 'The delegated agent hit an error or blocker.'
        : 'The delegated agent was interrupted before finishing.';

  return [
    'Write a short status label for a delegated coding agent.',
    statusLine,
    'Return one line only.',
    'Use 3 to 7 words, around 30 to 60 characters.',
    'Prefer past tense and the most distinctive file, feature, or blocker.',
    'No markdown, bullets, quotes, or trailing punctuation.',
    'Examples:',
    'Fixed approval policy bug',
    'Updated MCP registry state',
    'Blocked on missing auth token',
    'Interrupted during build verification',
    '',
    `Thread title: ${thread.title}`,
    '',
    'Recent transcript:',
    transcript || 'No transcript available.'
  ].join('\n');
}

export function normalizeSubagentTerminalSummary(output: string, fallback: string | null) {
  return trimSummaryLine(
    output
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .find(Boolean) ?? '',
    80
  ) ?? fallback;
}
