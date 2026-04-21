import { PROVIDER_IDS, type ProviderId, type SkillDefinition } from './domain';
import type { SkillMetadataShape } from './skills';

const providerTargets: ProviderId[] = [...PROVIDER_IDS];

type BuiltInSeed = Pick<
  SkillDefinition,
  'id' | 'name' | 'description' | 'instructions' | 'providerTargets'
> & {
  metadata?: Partial<SkillMetadataShape>;
};

export const builtInSkillSeeds: BuiltInSeed[] = [
  {
    id: 'built-in-concise',
    name: 'Concise',
    description: 'Produces brief, direct responses when the user wants the fastest high-signal answer without extra framing.',
    instructions:
      'Answer with the minimum detail needed for the request. Keep phrasing direct, trim filler and repetition, and preserve required commands, dates, caveats, and risks when they matter.',
    providerTargets,
    metadata: {
      category: 'engineering',
      examplePrompt: 'Review this diff and give me only the highest-signal findings.'
    }
  },
  {
    id: 'built-in-reviewer',
    name: 'Reviewer',
    description: 'Performs engineering review when the task is to find bugs, regressions, weak assumptions, or missing validation.',
    instructions:
      'Review like a senior engineer. Lead with the highest-signal findings, prioritize correctness and behavioral regressions, cite missing tests or validation, and keep the summary brief. Do not drift into a rewrite plan unless the user asks for one.',
    providerTargets,
    metadata: {
      category: 'engineering',
      examplePrompt: 'Review this PR and call out the most important regressions or missing tests.'
    }
  },
  {
    id: 'built-in-planner',
    name: 'Planner',
    description: 'Produces an execution plan when the user needs scope, sequencing, assumptions, or next steps clarified before implementation.',
    instructions:
      'Clarify goals, constraints, tradeoffs, dependencies, and next steps. Prefer a small actionable plan over brainstorming. Use this as a planning overlay only; do not replace or fake the provider-native planner state machine when native plan mode is available.',
    providerTargets,
    metadata: {
      category: 'templates',
      examplePrompt: 'Take this rough request and turn it into a focused step-by-step implementation plan.'
    }
  },
  {
    id: 'built-in-teacher',
    name: 'Teacher',
    description: 'Explains code, architecture, or decisions when the user needs a clear walkthrough without tutorial filler.',
    instructions:
      'Explain with concrete language, short steps, and focused examples. Optimize for fast comprehension over completeness, and avoid motivational filler or generic tutorial padding.',
    providerTargets,
    metadata: {
      category: 'engineering',
      examplePrompt: 'Explain this code change and why it works in a way another engineer can skim quickly.'
    }
  },
  {
    id: 'built-in-pdf-toolkit',
    name: 'PDF Toolkit',
    description: 'Handles PDF reading, summarization, or PDF-ready drafting when a PDF file, export, or layout-sensitive deliverable is explicitly part of the task.',
    instructions:
      'Use for tasks that explicitly mention PDFs, exports, or layout-sensitive deliverables. Summarize provided PDF content, extract structured details, or draft PDF-ready text while flagging layout-sensitive sections. If no PDF or source file is available, say so and fall back to drafting text only. Do not imply that a file was inspected when it was not provided.',
    providerTargets,
    metadata: {
      category: 'documents',
      examplePrompt: 'Summarize this PDF into an executive brief with key decisions, risks, and next steps.'
    }
  },
  {
    id: 'built-in-spreadsheet-analyst',
    name: 'Spreadsheet Analyst',
    description: 'Analyzes spreadsheets, CSVs, tables, or tabular metrics when structured data is provided or explicitly referenced.',
    instructions:
      'Approach spreadsheet work like an analyst. Organize tabular information, compare rows and trends, surface anomalies, separate observations from recommendations, and produce concise decision-ready outputs. Do not invent columns, formulas, or certainty that the provided data does not support.',
    providerTargets,
    metadata: {
      category: 'documents',
      examplePrompt: 'Analyze this spreadsheet data, highlight anomalies, and summarize the most important trends.'
    }
  },
  {
    id: 'built-in-doc-writer',
    name: 'Doc Writer',
    description: 'Drafts polished docs, briefs, and writeups when the user wants a concrete written deliverable from notes, changes, or source material.',
    instructions:
      'Turn raw notes, project context, or findings into a clear written deliverable with useful structure and readable headings. Tune the tone to the requested audience, preserve the source intent, and avoid inventing missing facts or rewriting away important constraints.',
    providerTargets,
    metadata: {
      category: 'documents',
      examplePrompt: 'Turn these rough notes into a polished product brief with clear headings and action items.'
    }
  },
  {
    id: 'built-in-slide-writer',
    name: 'Slide Writer',
    description: 'Builds presentation-ready slide structure when the user needs a deck outline, executive narrative, or speaker-ready summary from supplied material.',
    instructions:
      'Think in presentation structure. Break material into a strong slide narrative, concise bullets, and optional speaker notes with a clear executive flow. Prefer slide-ready structure over long prose, and if the source material is thin, note the gap instead of fabricating detail.',
    providerTargets,
    metadata: {
      category: 'documents',
      examplePrompt: 'Turn this update into a 6-slide narrative with title, key points, and speaker notes.'
    }
  },
  {
    id: 'built-in-skill-creator',
    name: 'Skill Creator',
    description: 'Creates or updates reusable Vicode skills when the user wants a new skill, a refined skill, or a repeatable workflow packaged as SKILL.md.',
    instructions:
      'When the user wants a new Vicode skill, create or update the files directly in the folder path named in the request. Prefer one folder per skill. Write SKILL.md with frontmatter for name and description, then concise operational instructions in the body. Add .vicode-skill.json only when the request needs non-default metadata such as slug, scope, providerTargets, syncTargets, enabled state, or category. Keep the instructions tight, practical, and easy for another agent to follow. Do not tell the user to copy text into a manual form when you can write the files directly. When finished, summarize the folder name, intended use, and any non-default metadata you chose.',
    providerTargets,
    metadata: {
      slug: 'skill-creator',
      category: 'templates',
      examplePrompt: 'Help me create a new Vicode skill for triaging flaky CI issues.'
    }
  },
  {
    id: 'built-in-plugin-creator',
    name: 'Plugin Creator',
    description: 'Creates or updates simple Vicode plugin bundles when the user wants a new MCP-backed plugin or a reusable tool integration packaged for the local app.',
    instructions:
      'When the user wants a new Vicode plugin, create or update the files directly in the folder path named in the request. Follow a simple plugin bundle layout with .codex-plugin/plugin.json and, for Vicode today, prefer an accompanying .mcp.json for the MCP server definition. Keep the configuration minimal and safe: default to enabled true, toolInvocationMode ask, launchApproved false, and global scope unless the request clearly needs project scope. Keep helper scripts or assets inside the plugin folder when the command depends on them. Never hardcode secrets into the plugin bundle. When finished, summarize the folder name, the command that will run, and any scope or approval assumptions you made.',
    providerTargets,
    metadata: {
      slug: 'plugin-creator',
      category: 'mcp',
      examplePrompt: 'Help me create a new Vicode plugin for a local stdio MCP server.'
    }
  }
];
