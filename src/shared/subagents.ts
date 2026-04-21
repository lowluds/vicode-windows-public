import type {
  AutonomyDelegationProfile,
  ProviderReasoningEffort,
  SubagentSummary
} from './domain';

const DEFAULT_SUBAGENT_NAMES = [
  'Smoke',
  'Low',
  'Hippy',
  'Chicken',
  'Cali',
  'Chunky',
  'Gurth',
  'Einstein',
  'Tesla',
  'Galileo',
  'Markus',
  'Donny'
] as const;

export function slugifySubagentName(name: string) {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function pickNextSubagentName(takenNames: string[]) {
  const taken = new Set(
    takenNames
      .map((name) => slugifySubagentName(name))
      .filter((value) => value.length > 0)
  );

  for (const candidate of DEFAULT_SUBAGENT_NAMES) {
    if (!taken.has(slugifySubagentName(candidate))) {
      return candidate;
    }
  }

  let counter = takenNames.length + 1;
  while (taken.has(`agent-${counter}`)) {
    counter += 1;
  }
  return `Agent ${counter}`;
}

export function resolveSubagentReasoningEffort(
  profile: AutonomyDelegationProfile,
  requestedEffort?: ProviderReasoningEffort | null
) {
  if (requestedEffort) {
    return requestedEffort;
  }

  switch (profile) {
    case 'heartbeat':
      return 'low';
    case 'research':
      return 'high';
    case 'verify':
      return 'high';
    case 'implement':
      return 'medium';
    default:
      return null;
  }
}

export function resolveLeadingSubagentMention(
  prompt: string,
  subagents: Pick<SubagentSummary, 'id' | 'name' | 'status' | 'childThreadId'>[]
) {
  const trimmedPrompt = prompt.trimStart();
  if (!trimmedPrompt.startsWith('@')) {
    return null;
  }

  const match = /^@([a-z0-9-]+)\b/i.exec(trimmedPrompt);
  if (!match) {
    return null;
  }

  const token = slugifySubagentName(match[1] ?? '');
  if (!token) {
    return null;
  }

  const subagent = subagents.find((candidate) => slugifySubagentName(candidate.name) === token) ?? null;
  if (!subagent || !subagent.childThreadId || subagent.status === 'cancelled') {
    return null;
  }

  const cleanedPrompt = trimmedPrompt.slice(match[0].length).trimStart();
  return {
    subagent,
    cleanedPrompt
  };
}
