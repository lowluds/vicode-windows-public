import type { ProviderId, SkillDefinition } from './domain';
import { SURFACED_PROVIDER_IDS } from './providers';
import type { SkillMetadataShape } from './skills';

const providerTargets: ProviderId[] = [...SURFACED_PROVIDER_IDS];

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
    id: 'built-in-skill-creator',
    name: 'Skill Creator',
    description: 'Creates or updates reusable Vicode skills when the user wants a new skill, a refined skill, or a repeatable workflow packaged as SKILL.md.',
    instructions:
      'When the user wants a new Vicode skill and the advanced creator tool is available, prefer `create_skill_bundle` so the final bundle lands in Vicode app state without using workspace file tools for app-owned folders. Prefer one folder per skill. Include SKILL.md with frontmatter for name and description, then concise operational instructions in the body. Add .vicode-skill.json only when the request needs non-default metadata such as slug, scope, providerTargets, enabled state, or category. Keep the instructions tight, practical, and easy for another agent to follow. Do not add provider-folder export metadata; Vicode skills stay app-managed and provider-compatible through runtime context. Fall back to direct folder writes only when the request explicitly points at a writable workspace folder. When finished, summarize the folder name, intended use, and any non-default metadata you chose.',
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
      'When the user wants a new Vicode plugin and the advanced creator tool is available, prefer `create_plugin_bundle` so the final bundle lands in Vicode app state without using workspace file tools for app-owned folders. Follow a simple plugin bundle layout with .codex-plugin/plugin.json and, for Vicode today, an accompanying .mcp.json for the MCP server definition. Keep the configuration minimal and safe: default to enabled true, toolInvocationMode ask, launchApproved false, and global scope unless the request clearly needs project scope. Keep helper scripts or assets inside the plugin bundle when the command depends on them. Never hardcode secrets into the plugin bundle. Fall back to direct folder writes only when the request explicitly points at a writable workspace folder. When finished, summarize the folder name, the command that will run, and any scope or approval assumptions you made.',
    providerTargets,
    metadata: {
      slug: 'plugin-creator',
      category: 'mcp',
      examplePrompt: 'Help me create a new Vicode plugin for a local stdio MCP server.'
    }
  },
  {
    id: 'built-in-llm-wiki',
    name: 'Project Knowledge',
    description: 'Routes work through Vicode Project Knowledge when the task needs durable guidance, retrieval, operating standards, or agent workflow context.',
    instructions:
      'Use Vicode packaged Project Knowledge as the source of truth for agent operating standards. Start from VICODE.md and the manifest, choose only the smallest relevant knowledge pages, and cite the pages actually used. Treat Project Knowledge as Vicode-owned guidance, not as Codex, Gemini, or another provider app database. Do not claim to read unavailable knowledge pages. When the user asks to improve a Project Knowledge folder, propose curation changes as reviewable drafts: aliases, tags, frontmatter titles, clearer headings, route pages, and INDEX.md drafts. Do not mutate the user knowledge files unless the user explicitly asks for a specific write.',
    providerTargets,
    metadata: {
      slug: 'llm-wiki',
      category: 'engineering',
      examplePrompt: 'Use Vicode Project Knowledge to route this implementation task and choose the right verification standard.'
    }
  },
  {
    id: 'built-in-ux-writing',
    name: 'UX Writing',
    description: 'Improves interface copy when the user asks for clearer labels, error messages, empty states, onboarding copy, or product voice.',
    instructions:
      'Write user-centered interface copy that is purposeful, concise, conversational, and clear. Prefer specific verbs, sentence case, user language, and accessible text. For destructive actions, use precise language such as Delete when the action is permanent or removes something from the catalog. Avoid cleverness that obscures the action.',
    providerTargets,
    metadata: {
      slug: 'ux-writing',
      category: 'design',
      examplePrompt: 'Rewrite these empty states and button labels so they are clear, concise, and accessible.'
    }
  },
  {
    id: 'built-in-content-strategy',
    name: 'Content Strategy',
    description: 'Plans content systems when the user needs messaging pillars, editorial calendars, campaign narrative, or reusable content workflows.',
    instructions:
      'Build a practical content strategy from the user goal, audience, channel, offer, and constraints. Define the core message, content pillars, priority formats, publishing rhythm, and feedback loop. Keep recommendations executable and avoid generic marketing filler.',
    providerTargets,
    metadata: {
      slug: 'content-strategy',
      category: 'design',
      examplePrompt: 'Create a content strategy for this beta launch with pillars, channels, and a weekly publishing plan.'
    }
  },
  {
    id: 'built-in-copywriting',
    name: 'Copywriting',
    description: 'Writes or improves marketing copy when the user needs stronger page copy, CTAs, launch messaging, email copy, or offer positioning.',
    instructions:
      'Write conversion-focused copy grounded in the product, audience, problem, and proof. Lead with the customer outcome, keep CTAs concrete, remove vague claims, and preserve factual constraints. If the offer or audience is unclear, state the assumption briefly before drafting.',
    providerTargets,
    metadata: {
      slug: 'copywriting',
      category: 'design',
      examplePrompt: 'Rewrite this landing-page section with a sharper headline, subcopy, and CTA.'
    }
  },
  {
    id: 'built-in-marketing-strategy-pmm',
    name: 'Marketing Strategy PMM',
    description: 'Builds product marketing strategy when the user needs positioning, GTM planning, competitive intelligence, ICP work, or sales enablement.',
    instructions:
      'Approach the task like a product marketer. Clarify the ICP, positioning, value proposition, proof points, launch motion, competitive frame, sales enablement needs, and success metrics. Keep the output useful for Series A+ or beta-stage software teams without overbuilding the plan.',
    providerTargets,
    metadata: {
      slug: 'marketing-strategy-pmm',
      category: 'design',
      examplePrompt: 'Create a product marketing plan for this Windows beta, including positioning, ICP, launch motion, and reviewer notes.'
    }
  }
];
