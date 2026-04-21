import { PROVIDER_IDS, type ProviderId, type SkillAttachMode, type SkillCategory, type SkillDefinition, type SkillKind } from './domain';

export interface SkillSyncState {
  exported: boolean;
  path: string | null;
  updatedAt: string | null;
  error?: string | null;
}

export interface SkillMetadataShape {
  manifestVersion: number;
  slug: string;
  folderName: string | null;
  syncTargets: ProviderId[];
  syncState: Partial<Record<ProviderId, SkillSyncState>>;
  providerOrigin: ProviderId | null;
  kind: SkillKind;
  attachMode: SkillAttachMode;
  iconPath: string | null;
  examplePrompt: string | null;
  browseUrl: string | null;
  detailMarkdown: string | null;
  category: SkillCategory | null;
}

function isProviderId(value: unknown): value is ProviderId {
  return typeof value === 'string' && PROVIDER_IDS.includes(value as ProviderId);
}

function isSkillCategory(value: unknown): value is SkillCategory {
  return (
    value === 'frontend' ||
    value === 'backend' ||
    value === 'engineering' ||
    value === 'documents' ||
    value === 'design' ||
    value === 'testing' ||
    value === 'automation' ||
    value === 'mcp' ||
    value === 'templates' ||
    value === 'provider'
  );
}

export function skillSlug(value: string) {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return normalized || 'skill';
}

export function normalizeSkillMetadata(
  metadata: Record<string, unknown> | null | undefined,
  fallbackName: string,
  fallbackFolderName: string | null = null
): SkillMetadataShape {
  const syncTargets = Array.isArray(metadata?.syncTargets)
    ? metadata.syncTargets.filter(isProviderId)
    : [];
  const rawSyncState = metadata?.syncState;
  const syncState: Partial<Record<ProviderId, SkillSyncState>> = {};

  if (rawSyncState && typeof rawSyncState === 'object') {
    for (const providerId of PROVIDER_IDS) {
      const candidate = (rawSyncState as Record<string, unknown>)[providerId];
      if (!candidate || typeof candidate !== 'object') {
        continue;
      }
      const value = candidate as Record<string, unknown>;
      syncState[providerId] = {
        exported: Boolean(value.exported),
        path: typeof value.path === 'string' ? value.path : null,
        updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : null,
        error: typeof value.error === 'string' ? value.error : null
      };
    }
  }

  return {
    manifestVersion:
      typeof metadata?.manifestVersion === 'number' && Number.isFinite(metadata.manifestVersion)
        ? metadata.manifestVersion
        : 1,
    slug: typeof metadata?.slug === 'string' && metadata.slug.trim() ? metadata.slug : skillSlug(fallbackName),
    folderName:
      typeof metadata?.folderName === 'string' && metadata.folderName.trim()
        ? metadata.folderName
        : fallbackFolderName,
    syncTargets,
    syncState,
    providerOrigin: isProviderId(metadata?.providerOrigin) ? metadata.providerOrigin : null,
    kind: metadata?.kind === 'extension' ? 'extension' : 'skill',
    attachMode: metadata?.attachMode === 'runtime' ? 'runtime' : 'prompt',
    iconPath: typeof metadata?.iconPath === 'string' && metadata.iconPath.trim() ? metadata.iconPath : null,
    examplePrompt:
      typeof metadata?.examplePrompt === 'string' && metadata.examplePrompt.trim() ? metadata.examplePrompt : null,
    browseUrl: typeof metadata?.browseUrl === 'string' && metadata.browseUrl.trim() ? metadata.browseUrl : null,
    detailMarkdown:
      typeof metadata?.detailMarkdown === 'string' && metadata.detailMarkdown.trim() ? metadata.detailMarkdown : null,
    category: isSkillCategory(metadata?.category) ? metadata.category : null
  };
}

export function getSkillSyncTargets(skill: SkillDefinition) {
  return normalizeSkillMetadata(skill.metadata, skill.name).syncTargets;
}

export function getSkillSyncState(skill: SkillDefinition, providerId: ProviderId) {
  return normalizeSkillMetadata(skill.metadata, skill.name).syncState[providerId] ?? null;
}

export function buildSkillDocument(skill: Pick<SkillDefinition, 'name' | 'description' | 'instructions'>) {
  return `# ${skill.name}\n\n${skill.description.trim()}\n\n## Instructions\n${skill.instructions.trim()}\n`;
}

export function getSkillCommandToken(skill: SkillDefinition) {
  return normalizeSkillMetadata(skill.metadata, skill.name).slug;
}

export function getSkillAttachMode(skill: SkillDefinition) {
  return normalizeSkillMetadata(skill.metadata, skill.name).attachMode;
}

export function getSkillKind(skill: SkillDefinition) {
  return normalizeSkillMetadata(skill.metadata, skill.name).kind;
}

export function getSkillProviderOrigin(skill: SkillDefinition) {
  return normalizeSkillMetadata(skill.metadata, skill.name).providerOrigin;
}

export function getSkillIconPath(skill: SkillDefinition) {
  return normalizeSkillMetadata(skill.metadata, skill.name).iconPath;
}

export function getSkillExamplePrompt(skill: SkillDefinition) {
  return normalizeSkillMetadata(skill.metadata, skill.name).examplePrompt;
}

export function getSkillBrowseUrl(skill: SkillDefinition) {
  return normalizeSkillMetadata(skill.metadata, skill.name).browseUrl;
}

export function getSkillDetailMarkdown(skill: SkillDefinition) {
  return normalizeSkillMetadata(skill.metadata, skill.name).detailMarkdown;
}

export function getSkillCategory(skill: SkillDefinition) {
  return normalizeSkillMetadata(skill.metadata, skill.name).category;
}

export interface PromptSkillMention {
  start: number;
  end: number;
  token: string;
  skill: SkillDefinition;
}

export function findPromptSkillMentions(prompt: string, skills: SkillDefinition[]): PromptSkillMention[] {
  if (!prompt || skills.length === 0) {
    return [];
  }

  const tokenEntries = skills
    .map((skill) => ({
      token: getSkillCommandToken(skill).toLowerCase(),
      skill
    }))
    .sort((left, right) => right.token.length - left.token.length);

  if (tokenEntries.length === 0) {
    return [];
  }

  const mentions: PromptSkillMention[] = [];

  for (let index = 0; index < prompt.length; index += 1) {
    if (prompt[index] !== '$') {
      continue;
    }

    const prefix = index === 0 ? '' : prompt[index - 1] ?? '';
    if (prefix && !/\s/.test(prefix)) {
      continue;
    }

    const remaining = prompt.slice(index + 1).toLowerCase();
    const match = tokenEntries.find((entry) => remaining.startsWith(entry.token));
    if (!match) {
      continue;
    }

    const end = index + 1 + match.token.length;
    mentions.push({
      start: index,
      end,
      token: prompt.slice(index, end),
      skill: match.skill
    });
    index = end - 1;
  }

  return mentions;
}

export function resolveMentionedSkillIds(prompt: string, skills: SkillDefinition[]) {
  return [...new Set(findPromptSkillMentions(prompt, skills).map((mention) => mention.skill.id))];
}

export function splitPromptMentionedSkills(prompt: string, skills: SkillDefinition[]) {
  const mentions = findPromptSkillMentions(prompt, skills);
  if (mentions.length === 0) {
    return {
      promptWithoutMentions: prompt.trim(),
      mentionedSkillIds: [],
      mentionedTokens: []
    };
  }

  const mentionedTokens: string[] = [];
  let lastIndex = 0;
  let promptWithoutMentions = '';

  for (const mention of mentions) {
    promptWithoutMentions += prompt.slice(lastIndex, mention.start);
    mentionedTokens.push(mention.token);
    lastIndex = mention.end;
  }

  promptWithoutMentions += prompt.slice(lastIndex);

  return {
    promptWithoutMentions: promptWithoutMentions.replace(/\n{3,}/g, '\n\n').trim(),
    mentionedSkillIds: [...new Set(mentions.map((mention) => mention.skill.id))],
    mentionedTokens
  };
}
