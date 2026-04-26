import type { ComposerMode } from './domain';

const GENERIC_INSTRUCTIONAL_PREFIX_PATTERN =
  /^(?:how do i|how can i|what is|what does|why does|explain|tell me about)\b/u;

const WORKSPACE_PATH_QUESTION_PATTERNS = [
  /\bfull path\b/u,
  /\b(?:which|what)\s+(?:workspace|folder|directory)\b/u,
  /\b(?:workspace|project)\s+root\b/u,
  /\broot (?:folder|directory|path)\b/u,
  /\bcurrent (?:folder|directory|workspace|path|cwd)\b/u,
  /\bon my (?:pc|computer)\b/u,
  /\binside (?:the )?(?:root|folder|directory|workspace)\b/u
] as const;

const WORKSPACE_ACTION_PATTERN =
  /\b(?:create|write|make|add|edit|update|modify|rewrite|replace|rename|delete|remove|save|open|read|search|find|list|show|inspect|run|execute|mkdir|touch)\b/u;

const WORKSPACE_TARGET_PATTERN =
  /\b(?:file|folder|directory|workspace|repo(?:sitory)?|project|path|root|cwd|current working directory|terminal|command|shell)\b/u;

const FILE_NAME_HINT_PATTERN =
  /(?:^|[\s"'`(])[\w.-]+\.[a-z0-9]{1,8}\b/u;

export function promptRequiresAttachedWorkspace(
  prompt: string,
  mode: ComposerMode = 'default'
) {
  const normalized = prompt.trim().toLowerCase();
  if (!normalized || mode === 'plan') {
    return false;
  }

  if (
    GENERIC_INSTRUCTIONAL_PREFIX_PATTERN.test(normalized)
    && !/\b(?:my|this|current|active|here)\b/u.test(normalized)
  ) {
    return false;
  }

  if (WORKSPACE_PATH_QUESTION_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return true;
  }

  if (!WORKSPACE_ACTION_PATTERN.test(normalized)) {
    return false;
  }

  return WORKSPACE_TARGET_PATTERN.test(normalized) || FILE_NAME_HINT_PATTERN.test(normalized);
}
