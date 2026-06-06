import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface VicodeGuidanceDocument {
  title: string;
  relativePath: string;
  obsidianRoute?: string;
  aliases?: string[];
  content: string;
}

export interface VicodeGuidanceContext {
  using: string[];
  documents: VicodeGuidanceDocument[];
}

interface GuidanceRoute {
  pattern: RegExp;
  files: string[];
}

interface GuidanceManifestPage {
  title: string;
  path: string;
  obsidianRoute?: string;
  aliases?: string[];
  aliasRoutes?: string[];
}

interface GuidanceManifest {
  pages?: GuidanceManifestPage[];
}

const BASE_GUIDANCE_FILES = ['VICODE.md'];

const CASUAL_PROMPT_PATTERN =
  /^(?:(?:hi|hello|hey|yo|sup)[,\s]*)?(?:hi|hello|hey|yo|sup|how(?:'s|s| is) it going|how are you|what'?s up|thanks|thank you|ok|okay|cool|nice|great|got it|sounds good|all good)[\s.?!]*$/iu;

const TASK_INTENT_PATTERN =
  /\b(?:add|analy[sz]e|audit|build|change|check|configure|create|debug|deploy|design|diagnose|document|draft|edit|fix|implement|improve|inspect|install|integrate|investigate|migrate|package|patch|plan|polish|refactor|release|repair|review|run|setup|ship|test|troubleshoot|update|verify|write)\b|(?:^|[\s`"'(])(?:src|docs|test|scripts|resources|package\.json|tsconfig|vite|electron|react|typescript|css|tsx|api|database|provider|adapter|renderer|main process|preload|ollama|project knowledge|knowledge base|retrieval|rag|agents\.md|memory\.md|json schema|structured outputs)(?:[\s`"',).:]|$)|(?:[A-Za-z]:\\|\/|\\)[^\s]+/iu;

const OBSIDIAN_LINK_PATTERN = /\[\[([^\]]+)\]\]/giu;

const GUIDANCE_ROUTES: GuidanceRoute[] = [
  {
    pattern: /\b(?:ollama|local\s+(?:model|models|llm|llms)|model freshness|context window|embedding|embeddings)\b/iu,
    files: [
      'wiki/Ollama And Local Models.md',
      'wiki/Retrieval For Coding Projects.md',
      'wiki/Structured Outputs And Evals.md'
    ]
  },
  {
    pattern: /\b(?:agents|agents\.md|memory\.md|project knowledge|knowledge base|retrieval|rag|wiki|memory|context|guidance|guardrail|instructions|skill|skills)\b/iu,
    files: [
      'wiki/Retrieval For Coding Projects.md',
      'wiki/Source Quality And Grounding.md',
      'wiki/Markdown KB Retrieval Design.md',
      'wiki/Search And Retrieval.md',
      'wiki/Capability Routing Standard.md'
    ]
  },
  {
    pattern: /\b(?:tool|tools|permission|permissions|trust|sandbox|prompt injection|secret|secrets|mcp)\b/iu,
    files: [
      'wiki/Tool Use And Trust.md',
      'wiki/Security And Secrets.md',
      'wiki/Agent Runtime Patterns.md'
    ]
  },
  {
    pattern: /\b(?:structured output|structured outputs|json schema|schema|schemas|eval|evals|evaluate|benchmark|deterministic|validation|temperature)\b/iu,
    files: [
      'wiki/Structured Outputs And Evals.md',
      'wiki/Source Quality And Grounding.md',
      'wiki/Verification Standards.md'
    ]
  },
  {
    pattern: /\b(?:add|build|change|debug|fix|implement|inspect|patch|refactor|repair|run|test|troubleshoot|update|verify)\b/iu,
    files: [
      'wiki/Coding Agent Workflows.md',
      'wiki/Source-Backed Workflow.md',
      'wiki/Execution Discipline.md',
      'wiki/Verification Standards.md'
    ]
  },
  {
    pattern: /\b(frontend|ui|ux|react|tsx|css|layout|component|settings|composer|visual|responsive|design)\b/iu,
    files: [
      'wiki/Frontend Standards.md',
      'wiki/Design Taste Translation.md',
      'wiki/Frontend Quality Gate.md'
    ]
  },
  {
    pattern: /\b(copy|writing|wording|language|message|messaging|label|labels|microcopy|tone)\b/iu,
    files: [
      'wiki/UX Writing Standards.md',
      'wiki/Writing Anti-Patterns.md'
    ]
  },
  {
    pattern: /\b(backend|api|server|service|database|storage|module|modular|architecture|runtime|provider|adapter|mcp|tool)\b/iu,
    files: [
      'wiki/Agent Runtime Patterns.md',
      'wiki/Code Organization Standard.md'
    ]
  },
  {
    pattern: /\b(security|secret|credential|auth|token|key|permission|trust|sandbox|customer|public|ship|release)\b/iu,
    files: [
      'wiki/Security And Secrets.md',
      'wiki/Verification Standards.md'
    ]
  },
  {
    pattern: /\b(plan|ambiguous|scope|packet|handoff|subagent|delegate|large|complex)\b/iu,
    files: [
      'wiki/Prompt To Execution Packet.md',
      'wiki/Context Packet Standard.md',
      'wiki/Execution Discipline.md'
    ]
  },
  {
    pattern: /\b(cleanup|stale|artifact|docs|documentation|readme|worklog)\b/iu,
    files: [
      'wiki/Cleanup And Stale Artifact Discipline.md',
      'wiki/Docs As Code.md'
    ]
  }
];

function hasExplicitGuidanceRoute(prompt: string) {
  OBSIDIAN_LINK_PATTERN.lastIndex = 0;
  const hasRoute = OBSIDIAN_LINK_PATTERN.test(prompt);
  OBSIDIAN_LINK_PATTERN.lastIndex = 0;
  return hasRoute;
}

function shouldUseGuidanceForPrompt(prompt: string) {
  const normalizedPrompt = prompt.trim();
  if (!normalizedPrompt) {
    return false;
  }

  OBSIDIAN_LINK_PATTERN.lastIndex = 0;
  if (hasExplicitGuidanceRoute(normalizedPrompt)) {
    return true;
  }

  if (CASUAL_PROMPT_PATTERN.test(normalizedPrompt)) {
    return false;
  }

  return TASK_INTENT_PATTERN.test(normalizedPrompt);
}

function resolveGuidanceRoot(explicitRoot?: string) {
  if (explicitRoot) {
    return explicitRoot;
  }

  const moduleRoot = resolve(fileURLToPath(new URL('../../../resources/vicode-guidance', import.meta.url)));
  const candidates = [
    moduleRoot,
    join(process.cwd(), 'resources', 'vicode-guidance'),
    join(process.resourcesPath ?? '', 'resources', 'vicode-guidance'),
    join(process.resourcesPath ?? '', 'vicode-guidance')
  ];

  return candidates.find((candidate) => candidate && existsSync(candidate)) ?? moduleRoot;
}

function extractTitle(relativePath: string, content: string) {
  const heading = content.match(/^#\s+(.+)$/mu)?.[1]?.trim();
  if (heading) {
    return heading;
  }

  return relativePath.replace(/^wiki[\\/]/u, '').replace(/\.md$/iu, '');
}

function unique(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function normalizeRouteKey(value: string) {
  return value
    .trim()
    .replace(/^\[\[/u, '')
    .replace(/\]\]$/u, '')
    .replace(/\.md$/iu, '')
    .replace(/^wiki[\\/]/iu, '')
    .replace(/[\\/]/gu, '/')
    .toLowerCase();
}

function normalizeRelativePath(value: string) {
  return value.replace(/\\/gu, '/');
}

function readManifest(guidanceRoot: string): GuidanceManifest | null {
  const manifestPath = join(guidanceRoot, 'manifest.json');
  if (!existsSync(manifestPath)) {
    return null;
  }

  try {
    return JSON.parse(readFileSync(manifestPath, 'utf8')) as GuidanceManifest;
  } catch {
    return null;
  }
}

export class VicodeGuidanceService {
  private readonly guidanceRoot: string;
  private readonly pageByPath = new Map<string, GuidanceManifestPage>();
  private readonly pathByRouteKey = new Map<string, string>();

  constructor(options: { guidanceRoot?: string } = {}) {
    this.guidanceRoot = resolveGuidanceRoot(options.guidanceRoot);
    this.loadManifestRoutes();
  }

  resolveForPrompt(input: {
    prompt: string;
    selectedSkillIds?: string[];
  }): VicodeGuidanceContext | null {
    const prompt = input.prompt.trim();
    if (!shouldUseGuidanceForPrompt(prompt)) {
      return null;
    }

    const selectedFiles = [...BASE_GUIDANCE_FILES];
    selectedFiles.push(...this.extractPromptObsidianRoutes(prompt));

    for (const route of GUIDANCE_ROUTES) {
      if (route.pattern.test(prompt)) {
        selectedFiles.push(...route.files);
      }
    }

    const documents = unique(selectedFiles)
      .map((relativePath) => this.readDocument(relativePath))
      .filter((document): document is VicodeGuidanceDocument => Boolean(document));

    if (documents.length === 0) {
      return null;
    }

    const skillReferences = unique(input.selectedSkillIds ?? []).map((skillId) => `skill:${skillId}`);
    return {
      using: unique([...documents.map((document) => document.title), ...skillReferences]),
      documents
    };
  }

  private loadManifestRoutes() {
    const manifest = readManifest(this.guidanceRoot);
    for (const page of manifest?.pages ?? []) {
      if (!page.path) {
        continue;
      }

      const relativePath = normalizeRelativePath(page.path);
      this.pageByPath.set(relativePath, {
        ...page,
        path: relativePath
      });

      const routeValues = [
        page.path,
        page.title,
        page.obsidianRoute,
        ...(page.aliases ?? []),
        ...(page.aliasRoutes ?? [])
      ].filter((value): value is string => Boolean(value));

      for (const routeValue of routeValues) {
        this.pathByRouteKey.set(normalizeRouteKey(routeValue), relativePath);
      }
    }
  }

  private extractPromptObsidianRoutes(prompt: string) {
    const files: string[] = [];
    for (const match of prompt.matchAll(OBSIDIAN_LINK_PATTERN)) {
      const routeTarget = match[1]?.trim();
      if (!routeTarget) {
        continue;
      }
      const resolvedPath = this.pathByRouteKey.get(normalizeRouteKey(routeTarget));
      if (resolvedPath) {
        files.push(resolvedPath);
      }
    }
    return files;
  }

  private readDocument(relativePath: string): VicodeGuidanceDocument | null {
    const normalizedRelativePath = normalizeRelativePath(relativePath);
    const path = join(this.guidanceRoot, normalizedRelativePath);
    if (!existsSync(path)) {
      return null;
    }

    const content = readFileSync(path, 'utf8').trim();
    if (!content) {
      return null;
    }

    const page = this.pageByPath.get(normalizedRelativePath);

    return {
      title: page?.title ?? extractTitle(normalizedRelativePath, content),
      relativePath: normalizedRelativePath,
      obsidianRoute: page?.obsidianRoute,
      aliases: page?.aliases,
      content
    };
  }
}
