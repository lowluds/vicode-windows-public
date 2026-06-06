export type NativeComposerCommandId =
  | 'build-app'
  | 'enhance'
  | 'plan'
  | 'summarize-doc'
  | 'draft-doc'
  | 'analyze-sheet'
  | 'slides'
  | 'review'
  | 'explain'
  | 'release-notes'
  | 'status-update';

export interface NativeComposerCommand {
  id: NativeComposerCommandId;
  token: string;
  title: string;
  description: string;
  category: 'workflow' | 'documents' | 'analysis' | 'writing';
}

const nativeComposerCommandAliases: Partial<Record<NativeComposerCommandId, string[]>> = {
  plan: ['plan-mode']
};

export const nativeComposerCommands: NativeComposerCommand[] = [
  {
    id: 'build-app',
    token: 'build-app',
    title: 'Build app',
    description: 'Turn a rough app or website idea into a concrete builder-ready request.',
    category: 'workflow'
  },
  {
    id: 'enhance',
    token: 'enhance',
    title: 'Enhance prompt',
    description: 'Rewrite a rough draft into a clearer agent-ready prompt.',
    category: 'workflow'
  },
  {
    id: 'plan',
    token: 'plan',
    title: 'Plan mode',
    description: 'Switch the composer into plan mode and keep the draft focused on planning.',
    category: 'workflow'
  },
  {
    id: 'summarize-doc',
    token: 'summarize-doc',
    title: 'Summarize document',
    description: 'Turn rough input into a structured document-summary request.',
    category: 'documents'
  },
  {
    id: 'draft-doc',
    token: 'draft-doc',
    title: 'Draft document',
    description: 'Turn rough notes into a stronger document-writing prompt.',
    category: 'documents'
  },
  {
    id: 'analyze-sheet',
    token: 'analyze-sheet',
    title: 'Analyze spreadsheet',
    description: 'Shape the draft into a spreadsheet or table-analysis request.',
    category: 'documents'
  },
  {
    id: 'slides',
    token: 'slides',
    title: 'Create slide outline',
    description: 'Turn source material into a slide narrative or deck request.',
    category: 'documents'
  },
  {
    id: 'review',
    token: 'review',
    title: 'Review',
    description: 'Optimize the draft for bug finding, risk review, and regression checks.',
    category: 'analysis'
  },
  {
    id: 'explain',
    token: 'explain',
    title: 'Explain',
    description: 'Turn the draft into a clearer explanation or walkthrough request.',
    category: 'analysis'
  },
  {
    id: 'release-notes',
    token: 'release-notes',
    title: 'Release notes',
    description: 'Shape the draft into a release-note or changelog-writing request.',
    category: 'writing'
  },
  {
    id: 'status-update',
    token: 'status-update',
    title: 'Status update',
    description: 'Turn rough notes into a concise status or progress update request.',
    category: 'writing'
  }
];

const nativeCommandByToken = new Map(
  nativeComposerCommands.map((command) => [command.token, command] as const)
);

export function resolveNativeComposerCommand(token: string) {
  const normalized = token.trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  if (normalized === 'plan-mode') {
    return nativeCommandByToken.get('plan') ?? null;
  }

  return nativeCommandByToken.get(normalized) ?? null;
}

export function searchNativeComposerCommands(query: string) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return nativeComposerCommands;
  }

  const rankedMatches = nativeComposerCommands
    .map((command, index) => {
      const title = command.title.toLowerCase();
      const description = command.description.toLowerCase();
      const tokenTerms = [command.token, ...(nativeComposerCommandAliases[command.id] ?? [])].map((term) => term.toLowerCase());
      const tokenExact = tokenTerms.some((term) => term === normalized);
      const tokenPrefix = tokenTerms.some((term) => term.startsWith(normalized));
      const titlePrefix = title.startsWith(normalized);
      const tokenContains = tokenTerms.some((term) => term.includes(normalized));
      const titleContains = title.includes(normalized);
      const descriptionContains = description.includes(normalized);

      if (!tokenContains && !titleContains && !descriptionContains) {
        return null;
      }

      const rank = tokenExact
        ? 0
        : tokenPrefix
          ? 1
          : titlePrefix
            ? 2
            : tokenContains
              ? 3
              : titleContains
                ? 4
                : 5;

      return { command, index, rank };
    })
    .filter((entry): entry is { command: NativeComposerCommand; index: number; rank: number } => entry !== null)
    .sort((left, right) => left.rank - right.rank || left.index - right.index);

  return rankedMatches.map((entry) => entry.command);
}

export function parseLeadingNativeComposerCommand(prompt: string) {
  const trimmed = prompt.trimStart();
  const match = /^\/([a-z-]+)(?:\s+([\s\S]*))?$/.exec(trimmed);
  if (!match) {
    return null;
  }

  const command = resolveNativeComposerCommand(match[1] ?? '');
  if (!command) {
    return null;
  }

  return {
    command,
    body: (match[2] ?? '').trim()
  };
}

export function buildNativeComposerCommandPrompt(commandId: NativeComposerCommandId, input: string) {
  const trimmed = input.trim();

  switch (commandId) {
    case 'build-app':
      return `Turn the request below into a concrete build brief for a small app or website in the current workspace.\n\nRequirements:\n- choose a simple stack and file structure when the request does not specify one\n- prefer minimal dependencies and finishable scope\n- create or update real files instead of pseudocode\n- make reasonable product and UI assumptions instead of stalling on minor ambiguity\n- mention how the result should be previewed or run when relevant\n\nBuild request:\n${trimmed}`;
    case 'summarize-doc':
      return `Summarize the referenced document or source material.\n\nRequirements:\n- keep the summary structured and easy to scan\n- preserve key decisions, dates, names, and numbers when relevant\n- call out risks, open questions, and next steps\n- avoid page-by-page narration unless the request explicitly asks for it\n\nRequest or context:\n${trimmed}`;
    case 'draft-doc':
      return `Draft a polished document from the request below.\n\nRequirements:\n- choose a clear structure with useful headings\n- write for the intended audience\n- keep the tone direct and professional\n- turn rough notes into a clean, readable deliverable\n\nRequest or source material:\n${trimmed}`;
    case 'analyze-sheet':
      return `Analyze the referenced spreadsheet, table, or structured data.\n\nRequirements:\n- surface the most important trends, anomalies, and comparisons\n- separate observations from recommendations\n- call out anything that looks inconsistent or unusually important\n- keep the output concise and decision-ready\n\nRequest or data context:\n${trimmed}`;
    case 'slides':
      return `Turn the request below into a presentation-ready slide outline.\n\nRequirements:\n- organize the material into a clear slide narrative\n- keep slide text concise and presentation-friendly\n- include speaker notes only when helpful\n- optimize for executive readability over long-form prose\n\nRequest or source material:\n${trimmed}`;
    case 'review':
      return `Review the following with a senior engineer mindset.\n\nRequirements:\n- prioritize bugs, regressions, risks, and missing validation\n- lead with the highest-signal findings\n- keep the summary brief\n- call out missing tests or weak assumptions when relevant\n\nReview target:\n${trimmed}`;
    case 'explain':
      return `Explain the following clearly and concretely.\n\nRequirements:\n- explain what changed or what is happening\n- explain why it works\n- mention important tradeoffs, risks, or edge cases when relevant\n- optimize for fast comprehension, not fluff\n\nTopic:\n${trimmed}`;
    case 'release-notes':
      return `Draft release notes from the following source material.\n\nRequirements:\n- group changes into clear user-facing categories when possible\n- keep the writing concise and polished\n- call out notable fixes, improvements, and follow-up items\n- avoid internal implementation detail unless it matters to the audience\n\nSource material:\n${trimmed}`;
    case 'status-update':
      return `Turn the following into a concise status update.\n\nRequirements:\n- summarize progress, current state, blockers, and next steps\n- keep it easy to skim\n- avoid filler and repetition\n- write for a team or stakeholder audience\n\nSource material:\n${trimmed}`;
    default:
      return trimmed;
  }
}

export function resolveNativePlanCommand(input: {
  body: string;
  plannerSupported: boolean;
  providerLabel: string;
}) {
  if (input.plannerSupported) {
    return {
      kind: 'native' as const,
      prompt: input.body,
      nextMode: 'plan' as const,
      toastMessage: 'Plan mode enabled.'
    };
  }

  if (!input.body.trim()) {
    return {
      kind: 'empty' as const,
      prompt: '',
      nextMode: 'default' as const,
      toastMessage: 'Add some text after /plan first.'
    };
  }

  return {
    kind: 'unsupported' as const,
    prompt: input.body,
    nextMode: 'default' as const,
    toastMessage: `${input.providerLabel} does not support native Plan mode yet. /plan is disabled for this provider.`
  };
}
