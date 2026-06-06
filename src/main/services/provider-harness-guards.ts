import type {
  AgentRuntimeToolCatalog,
  AgentToolCall
} from '../../providers/agent-runtime';
import type { VerificationPlan } from '../../shared/harness-verification';

export function isFileContentMutationToolCall(toolName: string) {
  return toolName === 'write_file' || toolName === 'apply_patch';
}

export function hasToolCallName(toolCatalog: AgentRuntimeToolCatalog, callName: string) {
  return toolCatalog.tools.some((tool) => tool.callName === callName);
}

export function readToolPathArgument(toolCall: AgentToolCall) {
  const path = toolCall.arguments.path;
  return typeof path === 'string' && path.trim() ? path.trim() : null;
}

export function readToolCommandArgument(toolCall: AgentToolCall) {
  const command = toolCall.arguments.command;
  return typeof command === 'string' && command.trim() ? command.trim() : null;
}

function normalizeVerificationCommand(command: string | null | undefined) {
  return command?.trim().replace(/\s+/gu, ' ').toLowerCase() ?? '';
}

export function isPlannedPostMutationVerificationCommand(input: {
  plan?: VerificationPlan | null;
  toolCall: AgentToolCall;
  usedMutatingTool: boolean;
}) {
  if (!input.usedMutatingTool || input.toolCall.name !== 'run_command') {
    return false;
  }

  const plannedCommand = normalizeVerificationCommand(input.plan?.command);
  const calledCommand = normalizeVerificationCommand(readToolCommandArgument(input.toolCall));

  return input.plan?.status === 'planned'
    && Boolean(plannedCommand)
    && plannedCommand === calledCommand;
}

export function listedFileExtensions(directoryListing: string) {
  const extensions = new Set<string>();
  const filePattern = /^file\s+(.+)$/gimu;
  let match: RegExpExecArray | null;
  while ((match = filePattern.exec(directoryListing)) !== null) {
    const fileName = match[1]?.trim().toLowerCase() ?? '';
    const extensionMatch = /(\.[a-z0-9]+)$/iu.exec(fileName);
    if (extensionMatch?.[1]) {
      extensions.add(extensionMatch[1]);
    }
  }
  return extensions;
}

export function writtenFilePathExtensions(paths: string[]) {
  const extensions = new Set<string>();
  for (const path of paths) {
    const extensionMatch = /(\.[a-z0-9]+)$/iu.exec(path.trim().toLowerCase());
    if (extensionMatch?.[1]) {
      extensions.add(extensionMatch[1]);
    }
  }
  return extensions;
}
