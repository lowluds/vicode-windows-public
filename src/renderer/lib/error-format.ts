function normalizeMessageText(value: string) {
  let message = value.trim();
  const remoteInvokeMatch = message.match(/^Error invoking remote method '[^']+':\s*(.+)$/u);
  if (remoteInvokeMatch) {
    message = remoteInvokeMatch[1]?.trim() ?? message;
  }

  while (/^Error:\s*/u.test(message)) {
    message = message.replace(/^Error:\s*/u, '').trim();
  }

  const envelopeMessage = readJsonErrorEnvelopeMessage(message);
  if (envelopeMessage) {
    message = envelopeMessage;
  }

  message = message.replace(/\s*\((?:ref|reference|request id):\s*[^)]+\)\s*$/iu, '').trim();

  return message;
}

function readJsonErrorEnvelopeMessage(value: string) {
  const trimmed = value.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) {
    return null;
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }

    const record = parsed as Record<string, unknown>;
    for (const key of ['error', 'message', 'detail']) {
      const candidate = record[key];
      if (typeof candidate === 'string' && candidate.trim()) {
        return candidate.trim();
      }
    }
  } catch {
    return null;
  }

  return null;
}

function normalizeErrorMessage(error: unknown) {
  if (!(error instanceof Error)) {
    return null;
  }

  return normalizeMessageText(error.message);
}

function isGenericFetchFailure(message: string) {
  const normalized = message.trim().toLowerCase();
  return normalized === 'fetch failed' || normalized === 'failed to fetch' || normalized.includes('fetch failed');
}

export function formatVisibleRunErrorMessage(message: string | null | undefined) {
  const normalized = message ? normalizeMessageText(message) : '';
  if (!normalized) {
    return 'The run failed. Open the thread details for more information.';
  }

  if (/model does not support image input/iu.test(normalized)) {
    return 'This model does not support image input. Choose a model with image support and try again.';
  }

  return normalized;
}

export function formatRunFailureToastMessage(message: string | null | undefined) {
  const normalized = formatVisibleRunErrorMessage(message);
  if (!normalized) {
    return 'The run failed. Open the thread details for more information.';
  }

  if (
    /\bhunk\s+\d+\b/iu.test(normalized)
    || /hunk at line|line count did not match|failed to apply patch|patch .*failed|apply_patch/iu.test(normalized)
  ) {
    return 'Patch could not be applied. The file likely changed or the generated patch was stale; details are in the thread.';
  }

  if (isGenericFetchFailure(normalized)) {
    return 'A provider request failed. Check that the selected provider is reachable, then retry. Details are in the thread.';
  }

  return normalized;
}

export function parseWorkspaceUnavailableError(error: unknown) {
  const message = normalizeErrorMessage(error);
  if (!message) {
    return null;
  }

  const workspaceUnavailableMatch = message.match(
    /^Workspace folder is unavailable:\s*(.+?)\.\s*Re-open or repair the project path before running\s+(.+?)\.?$/u
  );
  if (!workspaceUnavailableMatch) {
    return null;
  }

  return {
    folderPath: workspaceUnavailableMatch[1]?.trim() ?? '',
    provider: workspaceUnavailableMatch[2]?.trim() ?? 'this provider'
  };
}

export function formatUserErrorMessage(error: unknown, fallback: string) {
  const message = normalizeErrorMessage(error);
  if (!message) {
    return fallback;
  }

  if (/ZodError/u.test(message) && /password/u.test(message)) {
    return 'Room passwords must be at least 3 characters when set.';
  }

  if (/function (?:extensions\.)?(?:gen_random_bytes|crypt|gen_salt)\b/iu.test(message)) {
    return 'Your collaboration Supabase schema is out of date. Rerun the latest supabase-collab-schema.sql in Supabase, then try again.';
  }

  const legacyTrustMatch = message.match(/^Project folder must be trusted before (.+) provider runs\.$/u);
  if (legacyTrustMatch) {
    const provider = legacyTrustMatch[1];
    return `This workspace was blocked by an older access rule. Re-open the folder and retry ${provider}.`;
  }

  const untrustedWorkspaceMatch = message.match(/^(.+?) cannot run against an untrusted workspace\. Trust the project and retry\.?$/u);
  if (untrustedWorkspaceMatch) {
    const provider = untrustedWorkspaceMatch[1];
    return `This workspace was blocked by an older access rule. Re-open the folder and retry ${provider}.`;
  }

  const workspaceUnavailable = parseWorkspaceUnavailableError(error);
  if (workspaceUnavailable) {
    return `This workspace folder is missing. Repair the project path in the header before running ${workspaceUnavailable.provider}.`;
  }

  if (isGenericFetchFailure(message)) {
    return fallback;
  }

  return message || fallback;
}
