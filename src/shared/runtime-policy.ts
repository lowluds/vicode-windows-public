import type {
  ExecutionPermission,
  ProjectRuntimeCommandPolicy,
  ProjectRuntimeNetworkPolicy
} from './domain';
import { listAgentToolPolicies } from './agent-tool-policy';

export const PROJECT_RUNTIME_COMMAND_POLICY_OPTIONS = [
  {
    value: 'approval_required' as const,
    label: 'Require approval',
    description:
      'Allow local shell commands only after explicit per-command approval.'
  },
  {
    value: 'auto_approve' as const,
    label: 'Auto-approve commands',
    description:
      'Allow local shell commands to start immediately in this workspace without a per-command approval prompt.'
  },
  {
    value: 'disabled' as const,
    label: 'Disable commands',
    description:
      'Keep the runtime on workspace file tools only, even under Full access.'
  }
];

export const PROJECT_RUNTIME_NETWORK_POLICY_OPTIONS = [
  {
    value: 'disabled' as const,
    label: 'Block host network',
    description:
      'Block clearly network-oriented shell commands in this workspace, even under Full access.'
  },
  {
    value: 'enabled' as const,
    label: 'Allow host network',
    description:
      'Allow approved shell commands to use this machine network access. Vicode still does not sandbox host network activity.'
  }
];

export interface RuntimePolicy {
  executionPermission: ExecutionPermission;
  runtimeCommandPolicy: ProjectRuntimeCommandPolicy;
  runtimeNetworkPolicy: ProjectRuntimeNetworkPolicy;
  defaultToolLabels: string[];
  elevatedToolLabels: string[];
  commandAccess: 'blocked' | 'approval_required' | 'auto_approve';
  networkAccess: 'disabled' | 'web_tools' | 'host_local';
  summary: string;
  commandSummary: string;
  networkSummary: string;
  modelInstruction: string;
  commandDeniedMessage: string | null;
}

export interface RuntimeCommandAccessEvaluation {
  access: RuntimePolicy['commandAccess'];
  requiresApproval: boolean;
  deniedReason: string | null;
  networkAccess: RuntimePolicy['networkAccess'];
  commandSummary: string;
  networkSummary: string;
}

export interface RuntimeNetworkAccessEvaluation {
  access: RuntimePolicy['networkAccess'];
  deniedReason: string | null;
  networkSummary: string;
}

export interface RuntimeNetworkCommandClassification {
  requiresHostNetwork: boolean;
  matchedPattern: string | null;
}

export interface RuntimeCommandLaunchClassification {
  executable: string | null;
  family:
    | 'standard'
    | 'nested_shell'
    | 'inline_interpreter'
    | 'remote_shell';
  matchedToken: string | null;
}

export interface RuntimeCommandExecutionEvaluation
  extends RuntimeCommandAccessEvaluation {
  launchClassification: RuntimeCommandLaunchClassification;
  launchDeniedReason: string | null;
  networkDeniedReason: string | null;
  pathDeniedReason: string | null;
}

export interface RuntimeCommandPathClassification {
  access:
    | 'allowed'
    | 'blocked_outside_workspace_absolute_path'
    | 'blocked_outside_workspace_relative_path';
  matchedToken: string | null;
  resolvedPath: string | null;
}

const NETWORK_COMMAND_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
  { label: 'curl', pattern: /(^|[;&|]\s*)curl(\.exe)?(\s|$)/iu },
  { label: 'wget', pattern: /(^|[;&|]\s*)wget(\.exe)?(\s|$)/iu },
  {
    label: 'Invoke-WebRequest',
    pattern:
      /(^|[;&|]\s*)(powershell|pwsh)(\.exe)?\b[^\r\n]*\b(Invoke-WebRequest|iwr|irm)\b/iu
  },
  { label: 'git remote sync', pattern: /(^|[;&|]\s*)git(\.exe)?\s+(clone|fetch|pull|push)\b/iu },
  { label: 'npm registry', pattern: /(^|[;&|]\s*)npm(\.cmd|\.exe)?\s+(install|update|publish)\b/iu },
  { label: 'pnpm registry', pattern: /(^|[;&|]\s*)pnpm(\.cmd|\.exe)?\s+(install|add|update|publish)\b/iu },
  { label: 'yarn registry', pattern: /(^|[;&|]\s*)yarn(\.cmd|\.exe)?\s+(add|install|up|upgrade|npm)\b/iu },
  { label: 'bun registry', pattern: /(^|[;&|]\s*)bun(\.exe)?\s+(add|install|update|pm)\b/iu },
  { label: 'pip install', pattern: /(^|[;&|]\s*)(pip|pip3)(\.exe)?\s+(install|download)\b/iu },
  { label: 'python -m pip', pattern: /(^|[;&|]\s*)python(\.exe)?\b[^\r\n]*\s-m\s+pip\s+(install|download)\b/iu },
  { label: 'cargo install', pattern: /(^|[;&|]\s*)cargo(\.exe)?\s+(install|search)\b/iu },
  { label: 'winget', pattern: /(^|[;&|]\s*)winget(\.exe)?\s+(install|upgrade|show|search)\b/iu },
  { label: 'scoop', pattern: /(^|[;&|]\s*)scoop(\.cmd|\.exe)?\s+(install|update|search)\b/iu },
  { label: 'choco', pattern: /(^|[;&|]\s*)(choco|chocolatey)(\.exe)?\s+(install|upgrade|search)\b/iu },
  { label: 'ping', pattern: /(^|[;&|]\s*)ping(\.exe)?\b/iu },
  { label: 'nslookup', pattern: /(^|[;&|]\s*)nslookup(\.exe)?\b/iu },
  { label: 'ssh', pattern: /(^|[;&|]\s*)ssh(\.exe)?\b/iu },
  { label: 'scp', pattern: /(^|[;&|]\s*)scp(\.exe)?\b/iu },
  { label: 'sftp', pattern: /(^|[;&|]\s*)sftp(\.exe)?\b/iu }
];

const NESTED_SHELL_EXECUTABLES = new Set([
  'cmd',
  'powershell',
  'pwsh',
  'bash',
  'wsl'
]);

const REMOTE_SHELL_EXECUTABLES = new Set(['ssh', 'scp', 'sftp']);
const INLINE_NODE_FLAGS = new Set(['-e', '--eval']);
const INLINE_PYTHON_FLAGS = new Set(['-c']);

function stripExecutableExtension(token: string) {
  return token.replace(/\.(exe|cmd|bat)$/iu, '').toLowerCase();
}

function readCommandTokens(command: string, limit = 4) {
  const tokens: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;

  for (let index = 0; index < command.length; index += 1) {
    const char = command[index];
    if (quote) {
      if (char === quote) {
        quote = null;
        continue;
      }
      current += char;
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }

    if (/\s/u.test(char)) {
      if (current) {
        tokens.push(current);
        current = '';
        if (tokens.length >= limit) {
          break;
        }
      }
      continue;
    }

    current += char;
  }

  if (current && tokens.length < limit) {
    tokens.push(current);
  }

  return tokens;
}

function trimTrailingPathSeparators(value: string) {
  return value.replace(/[\\/]+$/gu, '');
}

function normalizeWindowsPath(value: string) {
  const normalizedSeparators = value.replace(/\//gu, '\\');
  const hasUncPrefix = normalizedSeparators.startsWith('\\\\');
  const driveMatch = normalizedSeparators.match(/^[a-z]:/iu);
  const hasRootPrefix =
    !hasUncPrefix && !driveMatch && normalizedSeparators.startsWith('\\');

  let prefix = '';
  let remainder = normalizedSeparators;

  if (hasUncPrefix) {
    prefix = '\\\\';
    remainder = normalizedSeparators.slice(2);
  } else if (driveMatch) {
    prefix = driveMatch[0].toUpperCase();
    remainder = normalizedSeparators.slice(prefix.length);
    if (remainder.startsWith('\\')) {
      remainder = remainder.slice(1);
    }
  } else if (hasRootPrefix) {
    prefix = '\\';
    remainder = normalizedSeparators.slice(1);
  }

  const resolvedSegments: string[] = [];
  for (const segment of remainder.split(/\\+/u)) {
    if (!segment || segment === '.') {
      continue;
    }
    if (segment === '..') {
      if (
        resolvedSegments.length > 0
        && resolvedSegments[resolvedSegments.length - 1] !== '..'
      ) {
        resolvedSegments.pop();
        continue;
      }

      if (!prefix || prefix === '\\') {
        resolvedSegments.push(segment);
      }
      continue;
    }

    resolvedSegments.push(segment);
  }

  if (prefix === '\\\\') {
    return resolvedSegments.length > 0
      ? `\\\\${resolvedSegments.join('\\')}`
      : '\\\\';
  }

  if (prefix === '\\') {
    return resolvedSegments.length > 0
      ? `\\${resolvedSegments.join('\\')}`
      : '\\';
  }

  if (prefix) {
    return resolvedSegments.length > 0
      ? `${prefix}\\${resolvedSegments.join('\\')}`
      : `${prefix}\\`;
  }

  return resolvedSegments.join('\\') || '.';
}

function resolveWindowsPath(basePath: string, targetPath: string) {
  if (isAbsoluteWindowsPath(targetPath)) {
    return normalizeWindowsPath(targetPath);
  }

  if (isDriveRelativeWindowsPath(targetPath)) {
    const drivePrefix = targetPath.slice(0, 2).toUpperCase();
    const normalizedBasePath = normalizeWindowsPath(basePath);
    const baseDrivePrefix =
      normalizedBasePath.match(/^[A-Z]:/u)?.[0] ?? null;
    const relativeTarget = targetPath.slice(2).replace(/^[\\/]+/u, '');

    if (baseDrivePrefix === drivePrefix) {
      const baseRemainder = normalizedBasePath.slice(2).replace(/^\\/u, '');
      return normalizeWindowsPath(
        `${drivePrefix}\\${baseRemainder}\\${relativeTarget}`
      );
    }

    return normalizeWindowsPath(`${drivePrefix}\\${relativeTarget}`);
  }

  return normalizeWindowsPath(`${basePath}\\${targetPath}`);
}

function isPathInsideWorkspace(workspaceRoot: string, candidatePath: string) {
  const normalizedRoot = trimTrailingPathSeparators(
    normalizeWindowsPath(workspaceRoot)
  ).toLowerCase();
  const normalizedCandidate = trimTrailingPathSeparators(
    normalizeWindowsPath(candidatePath)
  ).toLowerCase();

  return (
    normalizedCandidate === normalizedRoot
    || normalizedCandidate.startsWith(`${normalizedRoot}\\`)
  );
}

function trimPathToken(token: string) {
  return token.replace(/^[<>|&()\d]+/u, '').replace(/[<>|&(),;]+$/u, '');
}

function isLikelyUrl(token: string) {
  return /^[a-z][a-z0-9+.-]*:\/\//iu.test(token) && !/^file:\/\//iu.test(token);
}

function isLikelySwitch(token: string) {
  return /^-{1,2}[a-z0-9][\w-]*$/iu.test(token)
    || /^\/[a-z0-9][\w-]*$/iu.test(token);
}

function isAbsoluteWindowsPath(token: string) {
  return /^[a-z]:[\\/]/iu.test(token) || /^\\\\/u.test(token);
}

function isDriveRelativeWindowsPath(token: string) {
  return /^[a-z]:(?![\\/])/iu.test(token);
}

function isRelativePathToken(token: string) {
  if (token.startsWith('/')) {
    return false;
  }

  if (isLikelySwitch(token)) {
    return false;
  }

  return token === '.'
    || token === '..'
    || token.startsWith('.\\')
    || token.startsWith('./')
    || token.startsWith('..\\')
    || token.startsWith('../')
    || isDriveRelativeWindowsPath(token)
    || /[\\/]/u.test(token);
}

function readFileUrlPath(token: string) {
  if (!/^file:\/\//iu.test(token)) {
    return null;
  }

  try {
    const url = new URL(token);
    if (url.protocol !== 'file:') {
      return null;
    }

    if (url.hostname && url.hostname !== 'localhost') {
      return normalizeWindowsPath(
        `\\\\${decodeURIComponent(url.hostname)}${decodeURIComponent(url.pathname.replace(/\//gu, '\\'))}`
      );
    }

    const localPath = decodeURIComponent(url.pathname.replace(/\//gu, '\\'));
    return normalizeWindowsPath(localPath.replace(/^\\([a-z]:\\)/iu, '$1'));
  } catch {
    return null;
  }
}

function readPathCandidates(rawToken: string) {
  const candidates = [rawToken];
  if (/[<>]/u.test(rawToken)) {
    const fragments = rawToken
      .split(/(?:\d?>>?|<)/u)
      .map((fragment) => trimPathToken(fragment))
      .filter(Boolean);
    for (const fragment of fragments) {
      if (!candidates.includes(fragment)) {
        candidates.push(fragment);
      }
    }
  }

  return candidates;
}

export function deriveRuntimePolicy(
  executionPermission: ExecutionPermission,
  runtimeCommandPolicy: ProjectRuntimeCommandPolicy = 'approval_required',
  runtimeNetworkPolicy: ProjectRuntimeNetworkPolicy = 'disabled'
): RuntimePolicy {
  const policies = listAgentToolPolicies();
  const defaultToolLabels = policies
    .filter(
      (policy) =>
        policy.minimumPermission === 'default' && policy.category !== 'network'
    )
    .map((policy) => policy.label);
  const elevatedToolLabels = policies
    .filter(
      (policy) =>
        policy.minimumPermission === 'full_access' && policy.category !== 'network'
    )
    .map((policy) => policy.label);

  if (
    executionPermission === 'full_access' &&
    runtimeCommandPolicy === 'disabled'
  ) {
    return {
      executionPermission,
      runtimeCommandPolicy,
      runtimeNetworkPolicy,
      defaultToolLabels,
      elevatedToolLabels,
      commandAccess: 'blocked',
      networkAccess: 'web_tools',
      summary:
        'Workspace file tools and app-owned web research stay available, but this workspace disables local shell commands even under Full access.',
      commandSummary:
        'Update the workspace runtime policy before the runtime can request host-local shell commands here.',
      networkSummary:
        runtimeNetworkPolicy === 'enabled'
          ? 'App-owned web research tools can still reach the public web in this workspace, and approved shell commands can also use host network access here once shell commands are re-enabled.'
          : 'App-owned web research tools can still reach the public web in this workspace, but approved shell commands cannot use host network access here.',
      modelInstruction:
        runtimeNetworkPolicy === 'enabled'
          ? 'Shell commands are disabled for this workspace. Workspace file tools stay available, and app-owned web research tools can reach the public web when current or external information is needed.'
          : 'Shell commands are disabled for this workspace. Stay within workspace file tools for workspace edits, and use app-owned web research tools when the user asks for online research or when current or external facts are needed.',
      commandDeniedMessage:
        'run_command is disabled for this workspace. Update the workspace runtime policy to allow approval-gated local shell commands.'
    };
  }

  if (executionPermission === 'full_access' && runtimeCommandPolicy === 'auto_approve') {
    return {
      executionPermission,
      runtimeCommandPolicy,
      runtimeNetworkPolicy,
      defaultToolLabels,
      elevatedToolLabels,
      commandAccess: 'auto_approve',
      networkAccess: runtimeNetworkPolicy === 'enabled' ? 'host_local' : 'web_tools',
      summary:
        'Workspace file tools stay available, and local shell commands can start immediately under Full access.',
      commandSummary:
        'Commands start in the workspace, run on the local host, and use isolated temp home/appdata directories by default, but they are not sandboxed to it.',
      networkSummary:
        runtimeNetworkPolicy === 'enabled'
          ? 'Commands can use host network access in this workspace. Vicode does not isolate that network activity yet.'
          : 'App-owned web research tools can still reach the public web in this workspace, but clearly network-oriented shell commands stay blocked here. Vicode still does not sandbox arbitrary binaries or host network activity yet.',
      modelInstruction:
        runtimeNetworkPolicy === 'enabled'
          ? 'run_command can start immediately in this workspace without asking for approval. Commands start in the workspace, but they run on the local host and are not sandboxed to the workspace or its network.'
          : 'run_command can start immediately in this workspace without asking for approval. Commands start in the workspace, but this workspace blocks clearly network-oriented shell commands. Use app-owned web research tools instead when the user needs online or current information.',
      commandDeniedMessage: null
    };
  }

  if (executionPermission === 'full_access') {
    return {
      executionPermission,
      runtimeCommandPolicy,
      runtimeNetworkPolicy,
      defaultToolLabels,
      elevatedToolLabels,
      commandAccess: 'approval_required',
      networkAccess: runtimeNetworkPolicy === 'enabled' ? 'host_local' : 'web_tools',
      summary:
        'Workspace file tools stay available, and local shell commands can run after per-command approval.',
      commandSummary:
        'Approved commands start in the workspace, run on the local host, and use isolated temp home/appdata directories by default, but they are not sandboxed to it.',
      networkSummary:
        runtimeNetworkPolicy === 'enabled'
          ? 'Approved shell commands can use host network access. Vicode does not isolate that network activity yet.'
          : 'App-owned web research tools can still reach the public web in this workspace, but clearly network-oriented shell commands stay blocked here. Vicode still does not sandbox arbitrary binaries or host network activity yet.',
      modelInstruction:
        runtimeNetworkPolicy === 'enabled'
          ? 'run_command requires user approval every time. Approved commands start in the workspace, but they run on the local host and are not sandboxed to the workspace or its network.'
          : 'run_command requires user approval every time. Approved commands start in the workspace, but this workspace blocks clearly network-oriented shell commands. Use app-owned web research tools instead when the user needs online or current information.',
      commandDeniedMessage: null
    };
  }

  return {
    executionPermission,
    runtimeCommandPolicy,
    runtimeNetworkPolicy,
    defaultToolLabels,
    elevatedToolLabels,
    commandAccess: 'blocked',
    networkAccess: 'web_tools',
    summary:
      'The runtime stays on workspace file tools plus app-owned web research. Local shell commands are blocked under Default permissions.',
    commandSummary:
      'Use list_directory, search_text, read_file, mkdir, and apply_patch for workspace work.',
    networkSummary:
      runtimeNetworkPolicy === 'enabled'
        ? 'App-owned web research tools can reach the public web in this workspace, but local shell commands remain blocked under Default permissions.'
        : 'App-owned web research tools can still reach the public web in this workspace, but clearly network-oriented shell commands stay blocked here.',
    modelInstruction:
      runtimeNetworkPolicy === 'enabled'
        ? 'Shell commands are unavailable in this run. Stay within workspace file tools for workspace edits, and use app-owned web research tools when the user asks for online research or when current or external facts are needed.'
        : 'Shell commands are unavailable in this run. Stay within workspace file tools for workspace edits, and use app-owned web research tools when the user asks for online research or when current or external facts are needed.',
    commandDeniedMessage:
      'run_command requires Full access. Approved commands start in the workspace, run on the local host, and use isolated temp home/appdata directories by default, but they are not sandboxed to it.'
  };
}

export function evaluateRuntimeCommandAccess(
  executionPermission: ExecutionPermission,
  runtimeCommandPolicy: ProjectRuntimeCommandPolicy = 'approval_required',
  runtimeNetworkPolicy: ProjectRuntimeNetworkPolicy = 'disabled'
): RuntimeCommandAccessEvaluation {
  const policy = deriveRuntimePolicy(
    executionPermission,
    runtimeCommandPolicy,
    runtimeNetworkPolicy
  );

  return {
    access: policy.commandAccess,
    requiresApproval: policy.commandAccess === 'approval_required',
    deniedReason: policy.commandDeniedMessage,
    networkAccess: policy.networkAccess,
    commandSummary: policy.commandSummary,
    networkSummary: policy.networkSummary
  };
}

export function evaluateRuntimeNetworkAccess(
  executionPermission: ExecutionPermission,
  runtimeCommandPolicy: ProjectRuntimeCommandPolicy = 'approval_required',
  runtimeNetworkPolicy: ProjectRuntimeNetworkPolicy = 'disabled'
): RuntimeNetworkAccessEvaluation {
  const policy = deriveRuntimePolicy(
    executionPermission,
    runtimeCommandPolicy,
    runtimeNetworkPolicy
  );

  return {
    access: policy.networkAccess,
    deniedReason:
      policy.networkAccess === 'disabled'
        ? 'This workspace blocks app-owned web research and clearly network-oriented shell commands. Update the workspace network policy to allow network access here.'
        : null,
    networkSummary: policy.networkSummary
  };
}

export function classifyRuntimeCommandNetworkAccess(
  command: string
): RuntimeNetworkCommandClassification {
  const trimmed = command.trim();
  if (!trimmed) {
    return {
      requiresHostNetwork: false,
      matchedPattern: null
    };
  }

  const matched = NETWORK_COMMAND_PATTERNS.find((entry) =>
    entry.pattern.test(trimmed)
  );

  return {
    requiresHostNetwork: Boolean(matched),
    matchedPattern: matched?.label ?? null
  };
}

export function classifyRuntimeCommandLaunch(
  command: string
): RuntimeCommandLaunchClassification {
  const tokens = readCommandTokens(command);
  const executable = tokens[0] ? stripExecutableExtension(tokens[0]) : null;
  if (!executable) {
    return {
      executable: null,
      family: 'standard',
      matchedToken: null
    };
  }

  if (NESTED_SHELL_EXECUTABLES.has(executable)) {
    return {
      executable,
      family: 'nested_shell',
      matchedToken: tokens[0] ?? executable
    };
  }

  if (REMOTE_SHELL_EXECUTABLES.has(executable)) {
    return {
      executable,
      family: 'remote_shell',
      matchedToken: tokens[0] ?? executable
    };
  }

  const second = tokens[1]?.toLowerCase() ?? null;
  if (
    ((executable === 'node' || executable === 'deno' || executable === 'bun')
      && second
      && INLINE_NODE_FLAGS.has(second))
    || ((executable === 'python'
      || executable === 'python3'
      || executable === 'py')
      && second
      && INLINE_PYTHON_FLAGS.has(second))
  ) {
    return {
      executable,
      family: 'inline_interpreter',
      matchedToken: `${tokens[0]} ${tokens[1]}`.trim()
    };
  }

  return {
    executable,
    family: 'standard',
    matchedToken: tokens[0] ?? executable
  };
}

export function classifyRuntimeCommandPathAccess(
  command: string,
  cwdPath: string,
  workspaceRoot: string
): RuntimeCommandPathClassification {
  const tokens = readCommandTokens(command, 24);

  for (const rawToken of tokens.slice(1)) {
    for (const candidate of readPathCandidates(rawToken)) {
      const token = trimPathToken(candidate);
      if (!token || isLikelyUrl(token)) {
        continue;
      }

      const fileUrlPath = readFileUrlPath(token);
      if (fileUrlPath) {
        if (!isPathInsideWorkspace(workspaceRoot, fileUrlPath)) {
          return {
            access: 'blocked_outside_workspace_absolute_path',
            matchedToken: rawToken,
            resolvedPath: normalizeWindowsPath(fileUrlPath)
          };
        }
        continue;
      }

      if (isAbsoluteWindowsPath(token)) {
        if (!isPathInsideWorkspace(workspaceRoot, token)) {
          return {
            access: 'blocked_outside_workspace_absolute_path',
            matchedToken: rawToken,
            resolvedPath: normalizeWindowsPath(token)
          };
        }
        continue;
      }

      if (!isRelativePathToken(token)) {
        continue;
      }

      const resolvedPath = resolveWindowsPath(cwdPath, token);
      if (!isPathInsideWorkspace(workspaceRoot, resolvedPath)) {
        return {
          access: 'blocked_outside_workspace_relative_path',
          matchedToken: rawToken,
          resolvedPath
        };
      }
    }
  }

  return {
    access: 'allowed',
    matchedToken: null,
    resolvedPath: null
  };
}

export function evaluateRuntimeCommandExecution(
  executionPermission: ExecutionPermission,
  command: string,
  runtimeCommandPolicy: ProjectRuntimeCommandPolicy = 'approval_required',
  runtimeNetworkPolicy: ProjectRuntimeNetworkPolicy = 'disabled',
  options?: {
    workspaceRoot?: string | null;
    cwdPath?: string | null;
  }
): RuntimeCommandExecutionEvaluation {
  const commandAccess = evaluateRuntimeCommandAccess(
    executionPermission,
    runtimeCommandPolicy,
    runtimeNetworkPolicy
  );
  const launchClassification = classifyRuntimeCommandLaunch(command);
  const networkClassification = classifyRuntimeCommandNetworkAccess(command);

  let launchDeniedReason: string | null = null;
  if (launchClassification.family === 'nested_shell') {
    launchDeniedReason = `run_command is blocked by runtime launcher policy. Nested shell launchers such as ${launchClassification.matchedToken ?? launchClassification.executable ?? 'this command'} are not allowed in app-managed runs.`;
  } else if (launchClassification.family === 'inline_interpreter') {
    launchDeniedReason = `run_command is blocked by runtime launcher policy. Inline interpreter commands such as ${launchClassification.matchedToken ?? launchClassification.executable ?? 'this command'} are not allowed in app-managed runs.`;
  } else if (launchClassification.family === 'remote_shell') {
    launchDeniedReason = `run_command is blocked by runtime launcher policy. Remote shell commands such as ${launchClassification.matchedToken ?? launchClassification.executable ?? 'this command'} are not allowed in app-managed runs.`;
  }

  const networkEvaluation = evaluateRuntimeNetworkAccess(
    executionPermission,
    runtimeCommandPolicy,
    runtimeNetworkPolicy
  );
  const networkDeniedReason =
    runtimeNetworkPolicy === 'disabled' && networkClassification.requiresHostNetwork
      ? networkClassification.matchedPattern
        ? `run_command is blocked by this workspace network policy. The requested command looks network-oriented (${networkClassification.matchedPattern}), and approved host network access is disabled here.`
        : 'run_command is blocked by this workspace network policy. Approved host network access is disabled here.'
      : null;
  const pathClassification =
    options?.workspaceRoot && options?.cwdPath
      ? classifyRuntimeCommandPathAccess(
          command,
          options.cwdPath,
          options.workspaceRoot
        )
      : null;
  const pathDeniedReason =
    pathClassification?.access === 'blocked_outside_workspace_absolute_path'
      ? `run_command is blocked by runtime path policy. The command references an absolute path outside the workspace (${pathClassification.matchedToken ?? pathClassification.resolvedPath ?? 'unknown path'}).`
      : pathClassification?.access === 'blocked_outside_workspace_relative_path'
        ? `run_command is blocked by runtime path policy. The command references a relative path that resolves outside the workspace (${pathClassification.matchedToken ?? pathClassification.resolvedPath ?? 'unknown path'}).`
        : null;

  return {
    ...commandAccess,
    launchClassification,
    launchDeniedReason,
    networkDeniedReason,
    pathDeniedReason,
    deniedReason:
      commandAccess.deniedReason
      ?? launchDeniedReason
      ?? networkDeniedReason
      ?? pathDeniedReason
  };
}
