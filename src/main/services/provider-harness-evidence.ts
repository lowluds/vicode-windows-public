import type { VerificationArtifact, VerificationPlan } from '../../shared/harness-verification';

export function firstLineOf(text: string) {
  return text.split('\n').find(Boolean) ?? text;
}

export function shortSummaryOf(text: string) {
  const normalized = text.trim().replace(/\s+/gu, ' ');
  return normalized.length > 240 ? `${normalized.slice(0, 237)}...` : normalized;
}

export function appendUnique(target: string[], value: string | null) {
  if (!value || target.includes(value)) {
    return;
  }
  target.push(value);
}

function parseRunCommandVerificationResult(content: string) {
  const normalizedContent = content.replace(/\r\n/gu, '\n');
  const match = /^exit_code:\s*(-?\d+)\n\ncwd:\s*(.*?)\n\nstdout:\n([\s\S]*?)\n\nstderr:\n([\s\S]*)$/u.exec(normalizedContent);

  if (!match) {
    return {
      exitCode: null,
      cwd: null,
      stdout: content,
      stderr: ''
    };
  }

  const stdout = match[3] === '[empty]' ? '' : match[3] ?? '';
  const stderr = match[4] === '[empty]' ? '' : match[4] ?? '';

  return {
    exitCode: Number.parseInt(match[1] ?? '-1', 10),
    cwd: match[2]?.trim() || null,
    stdout,
    stderr
  };
}

export function createVerificationArtifactFromRunCommandResult(input: {
  command: string;
  durationMs: number;
  finishedAt: string;
  isError: boolean;
  plan: VerificationPlan;
  resultContent: string;
  startedAt: string;
}): VerificationArtifact {
  const parsed = parseRunCommandVerificationResult(input.resultContent);
  const status =
    parsed.exitCode === 0 && !input.isError
      ? 'passed'
      : 'failed';

  return {
    command: input.command,
    cwd: parsed.cwd ?? input.plan.cwd,
    permissionProfile: input.plan.permissionProfile,
    networkPolicy: input.plan.networkPolicy,
    status,
    exitCode: parsed.exitCode,
    stdout: parsed.stdout,
    stderr: parsed.stderr,
    startedAt: input.startedAt,
    finishedAt: input.finishedAt,
    durationMs: input.durationMs,
    reason: input.plan.reason,
    skippedReason: null
  };
}

