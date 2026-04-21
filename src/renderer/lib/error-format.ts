function normalizeErrorMessage(error: unknown) {
  if (!(error instanceof Error)) {
    return null;
  }

  let message = error.message.trim();
  const remoteInvokeMatch = message.match(/^Error invoking remote method '[^']+':\s*(.+)$/u);
  if (remoteInvokeMatch) {
    message = remoteInvokeMatch[1]?.trim() ?? message;
  }

  while (/^Error:\s*/u.test(message)) {
    message = message.replace(/^Error:\s*/u, '').trim();
  }

  return message;
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
    return `This workspace is not trusted yet. Click Enable workspace in the header before running ${provider}.`;
  }

  const untrustedWorkspaceMatch = message.match(/^(.+?) cannot run against an untrusted workspace\. Trust the project and retry\.?$/u);
  if (untrustedWorkspaceMatch) {
    const provider = untrustedWorkspaceMatch[1];
    return `This workspace is not trusted yet. Click Enable workspace in the header before running ${provider}.`;
  }

  const workspaceUnavailable = parseWorkspaceUnavailableError(error);
  if (workspaceUnavailable) {
    return `This workspace folder is missing. Repair the project path in the header before running ${workspaceUnavailable.provider}.`;
  }

  if (message === 'Gemini CLI exited successfully without producing assistant output.') {
    return 'Gemini finished the run without returning a reply. Retry once. If it keeps happening, switch the model to Auto Gemini 2.5 or Gemini 2.5 Flash.';
  }

  return message || fallback;
}
