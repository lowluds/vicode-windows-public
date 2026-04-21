import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import DOMPurify from 'dompurify';
import { marked } from 'marked';
import {
  ActionButton,
  DangerButton,
  IconButton,
  InlineActionButton,
  ModalDialog,
  PrimaryButton,
  SelectableSurface,
  SelectField,
  TextArea,
  TextInput
} from './ui';
import type { McpServerView, Project, ProviderId, SkillCategory, SkillDefinition, SkillDetail, SkillSaveInput } from '../../shared/domain';
import type { CuratedSkillCatalogEntry } from '../../shared/curatedCatalog';
import { curatedSkillCatalog, officialMcpCatalog, officialSkillPack } from '../../shared/curatedCatalog';
import {
  buildSkillDocument,
  getSkillAttachMode,
  getSkillCategory,
  getSkillCommandToken,
  getSkillKind,
  getSkillProviderOrigin,
  getSkillSyncState,
  getSkillSyncTargets
} from '../../shared/skills';
import {
  AutomationIcon,
  BookIcon,
  BrushIcon,
  CheckIcon,
  CloseIcon,
  CopyIcon,
  CpuIcon,
  DocumentIcon,
  FolderIcon,
  GlobeIcon,
  MonitorIcon,
  PlayIcon,
  PlusIcon,
  RefreshIcon,
  SaveIcon,
  ShieldIcon,
  SkillsIcon,
  TaskIcon,
  TrashIcon
} from './icons';
import { resolveSkillIcon } from './skillIcons';

type SkillDraft = {
  id?: string;
  name: string;
  description: string;
  instructions: string;
  scope: 'global' | 'project';
  providerTargets: ProviderId[];
  syncTargets: ProviderId[];
  enabled: boolean;
};

type CatalogTab = 'plugins' | 'skills';

type SuggestedSkill = {
  id: string;
  name: string;
  publisher?: string;
  official?: boolean;
  description: string;
  installKind: 'provider_native' | 'github_folder';
  providerId?: ProviderId;
  providerTargets: ProviderId[];
  browseUrl: string;
  installTarget?: string;
  owner?: string;
  repo?: string;
  path?: string;
  token: string;
  category: SkillCategory;
  icon: typeof SkillsIcon;
  status: CuratedSkillCatalogEntry['status'];
  verification: CuratedSkillCatalogEntry['verification'];
  notes: string[];
  starterPack?: boolean;
  featured?: boolean;
};

const CATALOG_LINKS: Record<ProviderId, string> = {
  openai: 'https://github.com/openai/skills/tree/main/skills/.curated',
  gemini: 'https://geminicli.com/extensions/',
  ollama: 'https://ollama.com/library',
  kimi: 'https://moonshotai.github.io/kimi-cli/en/',
  qwen: 'https://qwenlm.github.io/qwen-code-docs/en/users/overview/'
};

const PROVIDER_OPTIONS: ProviderId[] = ['openai', 'gemini', 'qwen'];

const CATEGORY_LABELS: Record<SkillCategory, string> = {
  frontend: 'Frontend',
  backend: 'Backend',
  engineering: 'Engineering',
  documents: 'Documents',
  design: 'Design',
  testing: 'Testing',
  automation: 'Automation',
  mcp: 'MCP & Plugins',
  templates: 'Templates',
  provider: 'Provider Runtime'
};

const BUILT_IN_SKILL_CATEGORIES: Partial<Record<string, SkillCategory>> = {
  'doc-writer': 'documents',
  'pdf-toolkit': 'documents',
  'slide-writer': 'documents',
  'spreadsheet-analyst': 'documents',
  'cloudflare-deploy': 'automation',
  'openai-docs': 'engineering',
  'playwright-interactive': 'testing',
  'premium-frontend-build': 'frontend',
  'premium-reference-frontend': 'design',
  'reference-to-system': 'design',
  'ui-polish-pass': 'design',
  'vercel-deploy': 'automation',
  'web-ship-review': 'testing',
  imagegen: 'design',
  screenshot: 'testing',
  sora: 'design',
  'skill-creator': 'templates'
};

function resolveSuggestedSkillIcon(skill: Pick<SuggestedSkill, 'category'>) {
  switch (skill.category) {
    case 'frontend':
      return MonitorIcon;
    case 'backend':
      return CpuIcon;
    case 'engineering':
      return SkillsIcon;
    case 'documents':
      return DocumentIcon;
    case 'design':
      return BrushIcon;
    case 'testing':
      return PlayIcon;
    case 'automation':
      return AutomationIcon;
    case 'mcp':
      return GlobeIcon;
    case 'templates':
      return CopyIcon;
    case 'provider':
      return ShieldIcon;
    default:
      return SkillsIcon;
  }
}

function createSuggestedSkill(seed: CuratedSkillCatalogEntry): SuggestedSkill {
  return {
    ...seed,
    icon: resolveSuggestedSkillIcon(seed),
    featured: seed.featured,
    official: seed.official
  };
}

const SUGGESTED_SKILLS: SuggestedSkill[] = [
  ...curatedSkillCatalog.map(createSuggestedSkill)
];

function buildSuggestedSkillDocument(skill: SuggestedSkill) {
  const installText =
    skill.installKind === 'provider_native'
      ? 'Install this provider-managed skill or extension to make it available inside the provider runtime.'
      : 'Import this skill into Vicode to attach it in the composer and use its instructions during runs.';
  const statusLabel = skill.status === 'keep' ? 'Curated for Vicode' : 'Experimental in Vicode';
  const notes = skill.notes.map((note) => `- ${note}`).join('\n');

  return `# ${skill.name}

${skill.description}

## Publisher
${skill.publisher ?? 'External'}

## Compatibility
${compatibilityLabel(skill.providerTargets)}

## Vicode Status
${statusLabel}

## Verification
${skill.verification}

## Install
${installText}

## Token
\`${skill.token}\`

## Notes
${notes}
`;
}

function providerLabel(providerId: ProviderId) {
  switch (providerId) {
    case 'openai':
      return 'Codex';
    case 'gemini':
      return 'Gemini';
    case 'ollama':
      return 'Ollama';
    case 'kimi':
      return 'Kimi';
    case 'qwen':
    default:
      return 'Qwen';
  }
}

function skillCategoryLabel(category: SkillCategory) {
  return CATEGORY_LABELS[category];
}

function compatibilityLabel(providerTargets: ProviderId[]) {
  if (providerTargets.length > 1) {
    return providerTargets.map((providerId) => providerLabel(providerId)).join(' + ');
  }
  return providerTargets[0] ? providerLabel(providerTargets[0]) : 'Provider';
}

function resolveSkillCategoryLabel(skill: SkillDefinition) {
  const explicitCategory = getSkillCategory(skill);
  if (explicitCategory) {
    return skillCategoryLabel(explicitCategory);
  }

  const tokenCategory = BUILT_IN_SKILL_CATEGORIES[getSkillCommandToken(skill)];
  if (tokenCategory) {
    return skillCategoryLabel(tokenCategory);
  }

  if (getSkillKind(skill) === 'extension') {
    return skillCategoryLabel('provider');
  }

  return skillCategoryLabel('engineering');
}

function emptyDraft(selectedProject: Project | null = null): SkillDraft {
  return {
    name: '',
    description: '',
    instructions: '',
    scope: selectedProject ? 'project' : 'global',
    providerTargets: ['openai', 'gemini', 'qwen'],
    syncTargets: [],
    enabled: true
  };
}

function createDraftFromSkill(skill: SkillDefinition): SkillDraft {
  return {
    id: skill.id,
    name: skill.name,
    description: skill.description,
    instructions: skill.instructions,
    scope: skill.scope,
    providerTargets: [...skill.providerTargets],
    syncTargets: getSkillSyncTargets(skill),
    enabled: skill.enabled
  };
}

function renderMarkdown(markdown: string) {
  return DOMPurify.sanitize(marked.parse(markdown) as string);
}

function skillScopeLabel(skill: SkillDefinition) {
  return skill.scope === 'project' ? 'Project' : 'Global';
}

function skillOriginLabel(skill: SkillDefinition) {
  if (skill.origin === 'built_in_style') {
    return 'Built-in';
  }

  if (skill.origin === 'custom_local') {
    return 'Custom';
  }

  const providerOrigin = getSkillProviderOrigin(skill);
  return `${providerOrigin ? providerLabel(providerOrigin) : 'Provider'} ${getSkillKind(skill) === 'extension' ? 'extension' : 'skill'}`;
}

function skillAvatarClass(skill: SkillDefinition) {
  let providerClass = 'is-vicode';
  const providerOrigin = getSkillProviderOrigin(skill);

  if (skill.scope === 'project') {
    providerClass = 'is-project';
  } else if (providerOrigin === 'openai' || (skill.providerTargets.length === 1 && skill.providerTargets[0] === 'openai')) {
    providerClass = 'is-openai';
  } else if (providerOrigin === 'gemini' || (skill.providerTargets.length === 1 && skill.providerTargets[0] === 'gemini')) {
    providerClass = 'is-gemini';
  } else if (providerOrigin === 'qwen' || (skill.providerTargets.length === 1 && skill.providerTargets[0] === 'qwen')) {
    providerClass = 'is-vicode';
  } else if (skill.origin === 'custom_local') {
    providerClass = 'is-custom';
  } else if (skill.origin === 'built_in_style') {
    providerClass = 'is-built-in';
  }

  return `skills-avatar ${providerClass} ${skill.enabled ? 'is-installed' : 'is-available'}`;
}

function SkillAvatar({ skill, size = 'default' }: { skill: SkillDefinition; size?: 'default' | 'large' }) {
  const Icon = resolveSkillIcon(skill);

  return (
    <span className={`${skillAvatarClass(skill)} ${size === 'large' ? 'is-large' : ''}`} aria-hidden="true">
      <Icon size={size === 'large' ? 24 : 20} />
    </span>
  );
}

function sortSkills(items: SkillDefinition[]) {
  const providerRank = (skill: SkillDefinition) => {
    if (skill.origin === 'built_in_style') {
      return 0;
    }
    const providerOrigin = getSkillProviderOrigin(skill);
    if (providerOrigin === 'openai') {
      return 1;
    }
    if (providerOrigin === 'gemini') {
      return 2;
    }
    if (skill.providerTargets.length === 1 && skill.providerTargets[0] === 'openai') {
      return 1;
    }
    if (skill.providerTargets.length === 1 && skill.providerTargets[0] === 'gemini') {
      return 2;
    }
    return 3;
  };

  return [...items].sort((left, right) => {
    const providerDelta = providerRank(left) - providerRank(right);
    if (providerDelta !== 0) {
      return providerDelta;
    }
    return left.name.localeCompare(right.name, undefined, { sensitivity: 'base' });
  });
}

function hasMatchingInstalledSkill(skill: SuggestedSkill, installedSkills: SkillDefinition[]) {
  const expectedTargets = [...skill.providerTargets].sort();
  return installedSkills.some((item) => {
    const token = getSkillCommandToken(item);
    const sameTargets =
      [...item.providerTargets].sort().join('|') === expectedTargets.join('|');
    return sameTargets && (token === skill.token || item.name.localeCompare(skill.name, undefined, { sensitivity: 'base' }) === 0);
  });
}

interface SkillsViewProps {
  skills: SkillDefinition[];
  selectedProject: Project | null;
  composerProviderId: ProviderId;
  attachedSkillIds: string[];
  refreshSkills: () => Promise<void>;
  saveSkill: (input: SkillSaveInput) => Promise<SkillDefinition>;
  onCreateSkill: () => void;
  onCreatePlugin: () => void;
  onBack: () => void;
  toggleSkill: (skillId: string, enabled: boolean) => Promise<SkillDefinition>;
  syncSkill: (skillId: string, providerId: ProviderId, enabled: boolean) => Promise<SkillDefinition>;
  removeSkill: (skillId: string) => Promise<void>;
  toggleAttachedSkill: (skillId: string) => void;
  showToast: (level: 'info' | 'warning' | 'error', message: string) => void;
}

export function SkillsView({
  skills,
  selectedProject,
  composerProviderId,
  attachedSkillIds,
  refreshSkills,
  saveSkill,
  onCreateSkill,
  onCreatePlugin,
  onBack,
  toggleSkill,
  syncSkill,
  removeSkill,
  toggleAttachedSkill,
  showToast
}: SkillsViewProps) {
  const [catalogTab, setCatalogTab] = useState<CatalogTab>('plugins');
  const [selectedMcpId, setSelectedMcpId] = useState<string>('shadcn');
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const [selectedSkillId, setSelectedSkillId] = useState<string | null>(null);
  const [selectedSuggestedSkillId, setSelectedSuggestedSkillId] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detail, setDetail] = useState<SkillDetail | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [draft, setDraft] = useState<SkillDraft>(emptyDraft(selectedProject));
  const [installingSkillId, setInstallingSkillId] = useState<string | null>(null);
  const [mcpServers, setMcpServers] = useState<McpServerView[]>([]);
  const [mcpCatalog, setMcpCatalog] = useState<McpCatalogSnapshot | null>(null);
  const [settingUpMcpId, setSettingUpMcpId] = useState<string | null>(null);

  const filteredSkills = useMemo(() => {
    const needle = deferredQuery.trim().toLowerCase();
    if (!needle) {
      return skills;
    }

    return skills.filter((skill) =>
      [
        skill.name,
        skill.description,
        skill.instructions,
        getSkillCommandToken(skill),
        skillOriginLabel(skill),
        resolveSkillCategoryLabel(skill),
        compatibilityLabel(skill.providerTargets)
      ].some((value) => value.toLowerCase().includes(needle))
    );
  }, [deferredQuery, skills]);

  const filteredSuggestedSkills = useMemo(() => {
    const needle = deferredQuery.trim().toLowerCase();
    const all = SUGGESTED_SKILLS;
    if (!needle) {
      return [...all].sort((left, right) => {
        const featuredDelta = Number(Boolean(right.featured)) - Number(Boolean(left.featured));
        if (featuredDelta !== 0) {
          return featuredDelta;
        }
        return left.name.localeCompare(right.name, undefined, { sensitivity: 'base' });
      });
    }

    return all
      .filter((skill) =>
        `${skill.name} ${skill.description} ${skill.token} ${skill.publisher ?? ''} ${skillCategoryLabel(skill.category)} ${compatibilityLabel(skill.providerTargets)}`
        .toLowerCase()
        .includes(needle)
      )
      .sort((left, right) => {
        const featuredDelta = Number(Boolean(right.featured)) - Number(Boolean(left.featured));
        if (featuredDelta !== 0) {
          return featuredDelta;
        }
        return left.name.localeCompare(right.name, undefined, { sensitivity: 'base' });
      });
  }, [deferredQuery]);

  const filteredPluginEntries = useMemo(() => {
    const needle = deferredQuery.trim().toLowerCase();
    if (!needle) {
      return officialMcpCatalog;
    }

    return officialMcpCatalog.filter((entry) =>
      `${entry.name} ${entry.description} ${entry.category} ${entry.publisher} ${entry.command ?? ''} ${(entry.args ?? []).join(' ')}`
        .toLowerCase()
        .includes(needle)
    );
  }, [deferredQuery]);

  const filteredConfiguredServers = useMemo(() => {
    const sortedServers = [...mcpServers].sort((left, right) =>
      left.name.localeCompare(right.name, undefined, { sensitivity: 'base' })
    );
    const needle = deferredQuery.trim().toLowerCase();
    if (!needle) {
      return sortedServers;
    }

    return sortedServers.filter((server) => {
      const officialEntry = officialMcpCatalog.find((entry) => {
        if (server.args.includes('--vicode-internal-analysis-server')) {
          return entry.id === 'internal-analysis';
        }
        return entry.command
          ? server.command.toLowerCase() === entry.command.toLowerCase() &&
              JSON.stringify(server.args) === JSON.stringify(entry.args ?? [])
          : false;
      });
      const serverCatalog = [
        ...(mcpCatalog?.tools ?? []).filter((tool) => tool.serverId === server.id).map((tool) => tool.name),
        ...(mcpCatalog?.resources ?? []).filter((resource) => resource.serverId === server.id).map((resource) => resource.name || resource.uri),
        ...(mcpCatalog?.prompts ?? []).filter((prompt) => prompt.serverId === server.id).map((prompt) => prompt.name)
      ];
      return `${server.name} ${server.command} ${server.args.join(' ')} ${officialEntry?.description ?? ''} ${officialEntry?.category ?? 'custom'} ${server.toolInvocationMode} ${serverCatalog.join(' ')}`
        .toLowerCase()
        .includes(needle);
    });
  }, [deferredQuery, mcpCatalog, mcpServers]);

  const sectionedSkills = useMemo(() => {
    const installed = sortSkills(filteredSkills.filter((skill) => skill.enabled));
    const available = filteredSkills.filter((skill) => !skill.enabled);
    const officialSuggestions = filteredSuggestedSkills.filter(
      (skill) => officialSkillPack.some((entry) => entry.id === skill.id && entry.starterPack) && !hasMatchingInstalledSkill(skill, installed)
    );
    const officialSuggestionIds = new Set(officialSuggestions.map((skill) => skill.id));
    const categoryOrder: SkillCategory[] = ['frontend', 'backend', 'engineering', 'documents', 'design', 'testing', 'automation', 'mcp', 'templates', 'provider'];
    const categories = categoryOrder.map((category) => ({
      category,
      title: skillCategoryLabel(category),
      installed: sortSkills(available.filter((skill) => resolveSkillCategoryLabel(skill) === skillCategoryLabel(category))),
      suggested: filteredSuggestedSkills.filter(
        (skill) =>
          skill.category === category &&
          !officialSuggestionIds.has(skill.id) &&
          !hasMatchingInstalledSkill(skill, installed)
      )
    }));

    return {
      installed,
      officialSuggestions,
      categories
    };
  }, [filteredSkills, filteredSuggestedSkills]);

  const selectedSkill = useMemo(
    () => skills.find((skill) => skill.id === selectedSkillId) ?? null,
    [selectedSkillId, skills]
  );
  const selectedSuggestedSkill = useMemo(
    () => SUGGESTED_SKILLS.find((skill) => skill.id === selectedSuggestedSkillId) ?? null,
    [selectedSuggestedSkillId]
  );

  useEffect(() => {
    if (!selectedSkill && !selectedSuggestedSkill && detailOpen) {
      setDetailOpen(false);
      setDetail(null);
    }
  }, [detailOpen, selectedSkill, selectedSuggestedSkill]);

  useEffect(() => {
    if (catalogTab !== 'plugins') {
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        await window.vicode.mcp.syncImports();
      } catch (error) {
        if (!cancelled) {
          showToast('warning', error instanceof Error ? error.message : 'Failed to import file-backed plugins.');
        }
      }

      const [servers, catalog] = await Promise.all([window.vicode.mcp.listServers(), window.vicode.mcp.listCatalog()]);
      if (!cancelled) {
        setMcpServers(servers);
        setMcpCatalog(catalog);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [catalogTab]);

  useEffect(() => {
    if (!officialMcpCatalog.some((entry) => entry.id === selectedMcpId)) {
      setSelectedMcpId(officialMcpCatalog[0]?.id ?? '');
    }
  }, [selectedMcpId]);

  const pageShellClass = 'skills-page-shell flex h-full min-h-0 w-full max-w-[1160px] flex-1 flex-col overflow-y-auto px-6';
  const pageHeaderClass = 'view-header skills-page-header flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between';
  const pageTitleClass = 'text-[28px] font-semibold tracking-[-0.04em] text-[color:var(--ui-text-title)]';
  const pageCopyClass = 'max-w-4xl text-[14px] leading-6 text-[color:var(--ui-text-muted)]';
  const inlineLinkClass =
    'skills-inline-link text-[color:var(--ui-text)] underline underline-offset-4 transition-colors hover:text-[color:var(--ui-text-title)]';
  const headerActionsClass = 'skills-header-actions flex items-center gap-3';
  const controlsRowClass = 'skills-controls-row flex flex-wrap items-center justify-between gap-3';
  const catalogControlsClass = 'skills-catalog-controls flex flex-wrap items-center gap-3';
  const subnavClass = 'skills-subnav inline-flex w-fit items-center gap-1 rounded-2xl border border-[color:var(--ui-border-soft)] bg-[color:var(--ui-alpha-03)] p-1';
  const catalogShellClass = 'skills-catalog-shell flex flex-col gap-6 pb-6';
  const sectionClass = 'skills-section flex flex-col gap-4';
  const sectionHeadingClass = 'skills-section-heading flex items-start justify-between gap-3';
  const listClass = 'skills-list flex flex-col gap-3';
  const listItemClass =
    'skills-list-item flex items-start justify-between gap-4 rounded-[24px] border border-[color:var(--ui-border-soft)] bg-[color:var(--ui-surface-2)] p-5 text-left transition-colors hover:border-[color:var(--ui-border)] hover:bg-[color:var(--ui-surface-3)]';
  const listLeadingClass = 'skills-list-leading flex min-w-0 flex-1 items-start gap-4';
  const listCopyClass = 'skills-list-copy flex min-w-0 flex-1 flex-col gap-2';
  const listTitleRowClass = 'skills-list-title-row flex flex-wrap items-center gap-2';
  const listTrailingClass = 'skills-list-trailing flex shrink-0 items-center gap-2';
  const isPluginTab = catalogTab === 'plugins';

  function updateDraft(patch: Partial<SkillDraft>) {
    setDraft((current) => ({ ...current, ...patch }));
  }

  function toggleDraftProvider(providerId: ProviderId) {
    setDraft((current) => {
      const providerTargets = current.providerTargets.includes(providerId)
        ? current.providerTargets.filter((target) => target !== providerId)
        : [...current.providerTargets, providerId];
      return {
        ...current,
        providerTargets,
        syncTargets: current.syncTargets.filter((target) => providerTargets.includes(target))
      };
    });
  }

  function toggleDraftSync(providerId: ProviderId) {
    setDraft((current) => ({
      ...current,
      syncTargets: current.syncTargets.includes(providerId)
        ? current.syncTargets.filter((target) => target !== providerId)
        : [...current.syncTargets, providerId]
    }));
  }

  async function openSkill(skill: SkillDefinition) {
    setSelectedSuggestedSkillId(null);
    setSelectedSkillId(skill.id);
    setDetailOpen(true);
    setDetailLoading(true);

    try {
      setDetail(await window.vicode.skills.detail(skill.id));
    } finally {
      setDetailLoading(false);
    }
  }

  function openSuggestedSkill(skill: SuggestedSkill) {
    setSelectedSkillId(null);
    setSelectedSuggestedSkillId(skill.id);
    setDetail({
      skillId: skill.id,
      markdown: buildSuggestedSkillDocument(skill),
      examplePrompt: null,
      iconPath: null,
      folderPath: null,
      browseUrl: skill.browseUrl,
      attachMode: skill.installKind === 'provider_native' ? 'runtime' : 'prompt',
      kind: skill.installKind === 'provider_native' ? 'extension' : 'skill'
    });
    setDetailLoading(false);
    setDetailOpen(true);
  }

  function openEditSkill(skill: SkillDefinition) {
    setDraft(createDraftFromSkill(skill));
    setEditorOpen(true);
  }

  async function handleSave() {
    if (!draft.name.trim() || !draft.description.trim() || !draft.instructions.trim() || draft.providerTargets.length === 0) {
      return;
    }
    if (draft.scope === 'project' && !selectedProject) {
      showToast('error', 'Project skills require an active project.');
      return;
    }

    const saved = await saveSkill({
      id: draft.id,
      name: draft.name,
      description: draft.description,
      instructions: draft.instructions,
      scope: draft.scope,
      providerTargets: draft.providerTargets,
      syncTargets: draft.scope === 'global' ? draft.syncTargets : [],
      enabled: draft.enabled,
      projectId: draft.scope === 'project' ? selectedProject?.id ?? null : null
    });

    setEditorOpen(false);
    await openSkill(saved);
  }

  async function handleRemove(skill: SkillDefinition) {
    if (skill.origin === 'built_in_style') {
      return;
    }

    const actionLabel = skill.origin === 'provider_native' ? 'Uninstall' : 'Remove';
    if (!window.confirm(`${actionLabel} "${skill.name}"?`)) {
      return;
    }
    await removeSkill(skill.id);
    setDetailOpen(false);
    setDetail(null);
    setSelectedSkillId(null);
    setSelectedSuggestedSkillId(null);
  }

  async function copyExamplePrompt() {
    if (!detail?.examplePrompt) {
      return;
    }
    await navigator.clipboard.writeText(detail.examplePrompt);
  }

  async function handleBrowse(url: string) {
    await window.vicode.app.openExternal(url);
  }

  async function handleInstallCatalogSkill(skill: SkillDefinition) {
    try {
      await toggleSkill(skill.id, true);
      showToast('info', `Installed ${skill.name}.`);
    } catch (error) {
      showToast('error', error instanceof Error ? error.message : `Failed to install ${skill.name}.`);
    }
  }

  async function handleInstallSuggested(skill: SuggestedSkill) {
    setInstallingSkillId(skill.id);

    try {
      const result = await window.vicode.skills.installSuggested({
        installKind: skill.installKind,
        providerId: skill.providerId ?? null,
        providerTargets: skill.providerTargets,
        token: skill.token,
        installTarget: skill.installTarget ?? skill.browseUrl,
        owner: skill.owner ?? null,
        repo: skill.repo ?? null,
        path: skill.path ?? null,
        name: skill.name,
        description: skill.description,
        browseUrl: skill.browseUrl,
        category: skill.category
      });
      if (result.status === 'completed') {
        await refreshSkills();
      }
      showToast('info', result.message || `Installed ${skill.name}.`);
    } catch (error) {
      showToast('error', error instanceof Error ? error.message : `Failed to install ${skill.name}.`);
    } finally {
      setInstallingSkillId(null);
    }
  }

  async function handleRevealPath(path: string) {
    await window.vicode.app.revealPath(path);
  }

  async function refreshPluginsCatalog(showMessage = true) {
    await window.vicode.mcp.syncImports();
    const [servers, catalog] = await Promise.all([window.vicode.mcp.listServers(), window.vicode.mcp.listCatalog()]);
    setMcpServers(servers);
    setMcpCatalog(catalog);
    if (showMessage) {
      showToast('info', 'Plugins refreshed.');
    }
  }

  async function handleRefreshCurrentTab() {
    try {
      if (catalogTab === 'plugins') {
        await refreshPluginsCatalog();
      } else {
        await refreshSkills();
        showToast('info', 'Skills refreshed.');
      }
    } catch (error) {
      showToast('error', error instanceof Error ? error.message : `Failed to refresh ${catalogTab}.`);
    }
  }

  function isAttachable(skill: SkillDefinition) {
    return skill.enabled && skill.providerTargets.includes(composerProviderId) && (skill.scope === 'global' || skill.projectId === selectedProject?.id);
  }

  function findConfiguredMcpServer(entryId: string) {
    const entry = officialMcpCatalog.find((candidate) => candidate.id === entryId);
    if (!entry) {
      return null;
    }

    if (entry.id === 'internal-analysis') {
      return (
        mcpServers.find((server) =>
          server.projectId === selectedProject?.id && server.args.includes('--vicode-internal-analysis-server')
        ) ?? null
      );
    }

    if (!entry.command) {
      return null;
    }

    return (
      mcpServers.find((server) => {
        return (
          server.command.toLowerCase() === entry.command.toLowerCase() &&
          JSON.stringify(server.args) === JSON.stringify(entry.args ?? [])
        );
      }) ?? null
    );
  }

  function findOfficialEntryForServer(server: McpServerView) {
    if (server.args.includes('--vicode-internal-analysis-server')) {
      return officialMcpCatalog.find((entry) => entry.id === 'internal-analysis') ?? null;
    }

    return (
      officialMcpCatalog.find((entry) => {
        return entry.command
          ? server.command.toLowerCase() === entry.command.toLowerCase() &&
              JSON.stringify(server.args) === JSON.stringify(entry.args ?? [])
          : false;
      }) ?? null
    );
  }

  function upsertMcpServer(server: McpServerView) {
    setMcpServers((current) => {
      const next = current.filter((item) => item.id !== server.id);
      next.push(server);
      return next.sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: 'base' }));
    });
  }

  async function handleSetupRecommendedMcp(entryId: string) {
    setSettingUpMcpId(entryId);
    try {
      const server = await window.vicode.mcp.setupRecommended({
        entryId,
        projectId: entryId === 'internal-analysis' ? selectedProject?.id ?? null : null
      });
      upsertMcpServer(server);
      setMcpCatalog(await window.vicode.mcp.listCatalog());
      showToast(
        'info',
        server.launchApproved
          ? `${server.name} added and started.`
          : `${server.name} added. Launch remains approval-gated.`
      );
    } catch (error) {
      showToast('error', error instanceof Error ? error.message : 'Failed to configure MCP integration.');
    } finally {
      setSettingUpMcpId(null);
    }
  }

  async function handleApproveMcpLaunch(serverId: string) {
    setSettingUpMcpId(serverId);
    try {
      const server = await window.vicode.mcp.approveLaunch(serverId);
      upsertMcpServer(server);
      setMcpCatalog(await window.vicode.mcp.listCatalog());
      showToast('info', `${server.name} approved and started.`);
    } catch (error) {
      showToast('error', error instanceof Error ? error.message : 'Failed to approve MCP server launch.');
    } finally {
      setSettingUpMcpId(null);
    }
  }

  async function handleRefreshMcpServer(serverId: string) {
    setSettingUpMcpId(serverId);
    try {
      const server = await window.vicode.mcp.refreshServer(serverId);
      upsertMcpServer(server);
      setMcpCatalog(await window.vicode.mcp.listCatalog());
      showToast('info', `${server.name} refreshed.`);
    } catch (error) {
      showToast('error', error instanceof Error ? error.message : 'Failed to refresh MCP server.');
    } finally {
      setSettingUpMcpId(null);
    }
  }

  async function handleToggleMcpServer(server: McpServerView, enabled: boolean) {
    setSettingUpMcpId(server.id);
    try {
      const updated = await window.vicode.mcp.setEnabled(server.id, enabled);
      upsertMcpServer(updated);
      setMcpCatalog(await window.vicode.mcp.listCatalog());
      showToast('info', `${server.name} ${enabled ? 'enabled' : 'disabled'}.`);
    } catch (error) {
      showToast('error', error instanceof Error ? error.message : `Failed to ${enabled ? 'enable' : 'disable'} MCP server.`);
    } finally {
      setSettingUpMcpId(null);
    }
  }

  async function handleRemoveMcpServer(serverId: string) {
    setSettingUpMcpId(serverId);
    try {
      const server = mcpServers.find((item) => item.id === serverId) ?? null;
      await window.vicode.mcp.removeServer(serverId);
      setMcpServers((current) => current.filter((item) => item.id !== serverId));
      setMcpCatalog(await window.vicode.mcp.listCatalog());
      showToast('info', `${server?.name ?? 'Integration'} removed.`);
    } catch (error) {
      showToast('error', error instanceof Error ? error.message : 'Failed to remove MCP server.');
    } finally {
      setSettingUpMcpId(null);
    }
  }

  function renderSkillCard(skill: SkillDefinition) {
    const attached = attachedSkillIds.includes(skill.id);
    const installable = !skill.enabled;
    return (
      <SelectableSurface
        key={skill.id}
        className={listItemClass}
        onPress={() => void openSkill(skill)}
      >
        <div className={listLeadingClass}>
          <SkillAvatar skill={skill} />
              <div className={listCopyClass}>
                <div className={listTitleRowClass}>
                  <strong>{skill.name}</strong>
                </div>
                  <p>{skill.description}</p>
                  <div className="skill-meta">
                    <span className="skill-meta-category">{resolveSkillCategoryLabel(skill)}</span>
                    <span className="skill-meta-compatibility">{compatibilityLabel(skill.providerTargets)}</span>
                </div>
              </div>
        </div>
        <div className={listTrailingClass}>
          {installable ? (
            <PrimaryButton
              size="compact"
              className="min-w-[88px]"
              leadingIcon={<PlusIcon />}
              aria-label={`Install ${skill.name}`}
              onClick={(event) => {
                event.stopPropagation();
                void handleInstallCatalogSkill(skill);
              }}
            >
              Install
            </PrimaryButton>
          ) : attached ? (
            <span className="skills-card-state is-attached">
              <CheckIcon />
            </span>
          ) : skill.enabled ? (
            <span className="skills-card-state is-enabled">
              <CheckIcon />
            </span>
          ) : (
            <span className="skills-card-state">Disabled</span>
          )}
        </div>
      </SelectableSurface>
    );
  }

  function renderSection(title: string, items: SkillDefinition[], suggestedItems: SuggestedSkill[] = []) {
    if (items.length === 0 && suggestedItems.length === 0) {
      return null;
    }

    return (
      <section className={sectionClass}>
        <div className={sectionHeadingClass}>
          <h3>{title}</h3>
        </div>
                  <div className={listClass}>
          {items.map(renderSkillCard)}
          {suggestedItems.map((skill) => (
            <SelectableSurface
              key={skill.id}
              className={listItemClass}
              onPress={() => openSuggestedSkill(skill)}
            >
              <div className={listLeadingClass}>
                <span className={`skills-avatar ${skill.providerTargets.length > 1 ? 'is-vicode' : skill.providerTargets[0] === 'openai' ? 'is-openai' : skill.providerTargets[0] === 'gemini' ? 'is-gemini' : 'is-vicode'} is-available`} aria-hidden="true">
                  <skill.icon size={20} />
                </span>
                <div className={listCopyClass}>
                  <div className={listTitleRowClass}>
                    <strong>{skill.name}</strong>
                    {skill.official ? <span className="skills-official-badge">Official</span> : null}
                    {skill.status === 'experimental' ? <span className="skills-experimental-badge">Experimental</span> : null}
                    {skill.publisher ? <span className="skills-publisher-badge">{skill.publisher}</span> : null}
                  </div>
                  <p>{skill.description}</p>
                  <div className="skill-meta">
                    <span className="skill-meta-category">{skillCategoryLabel(skill.category)}</span>
                    <span className="skill-meta-compatibility">{compatibilityLabel(skill.providerTargets)}</span>
                  </div>
                </div>
              </div>
              <div className={listTrailingClass}>
                <PrimaryButton
                  size="compact"
                  className="min-w-[88px]"
                  leadingIcon={<PlusIcon />}
                  aria-label={`Install ${skill.name}`}
                  disabled={installingSkillId === skill.id}
                  onClick={(event) => {
                    event.stopPropagation();
                    void handleInstallSuggested(skill);
                  }}
                >
                  {installingSkillId === skill.id ? 'Installing…' : 'Install'}
                </PrimaryButton>
              </div>
            </SelectableSurface>
          ))}
        </div>
      </section>
    );
  }

  function renderPluginsSection() {
    const selectedEntry =
      filteredPluginEntries.find((entry) => entry.id === selectedMcpId) ?? filteredPluginEntries[0] ?? null;
    const selectedConfiguredServer = selectedEntry ? findConfiguredMcpServer(selectedEntry.id) : null;
    const selectedToolPreview = selectedConfiguredServer
      ? (mcpCatalog?.tools ?? []).filter((tool) => tool.serverId === selectedConfiguredServer.id).slice(0, 4)
      : [];
    const selectedResourcePreview = selectedConfiguredServer
      ? (mcpCatalog?.resources ?? []).filter((resource) => resource.serverId === selectedConfiguredServer.id).slice(0, 3)
      : [];
    const selectedPromptPreview = selectedConfiguredServer
      ? (mcpCatalog?.prompts ?? []).filter((prompt) => prompt.serverId === selectedConfiguredServer.id).slice(0, 3)
      : [];
    const configuredServers = filteredConfiguredServers;

    return (
      <section className={sectionClass}>
        <div className="skills-section-heading is-stack flex flex-col gap-2">
          <div>
            <h3>Recommended plugins</h3>
            <p className="skills-section-note max-w-4xl text-[14px] leading-6 text-[color:var(--ui-text-muted)]">
              Connect app-managed MCP plugins from the same shell as your skills. Recommended entries are Vicode-vetted
              stdio servers, and custom plugins can be added here too. Live Vicode-managed MCP execution is currently
              verified on the app-owned runtime lane.
            </p>
          </div>
        </div>
        <div className="skills-list">
          {filteredPluginEntries.map((entry) => {
            const configuredServer = findConfiguredMcpServer(entry.id);
            const isConfigured = Boolean(configuredServer);
            const statusLabel = isConfigured ? 'Configured' : entry.supportState === 'supported' ? 'Supported now' : 'Planned';
            const needsApproval = configuredServer?.state?.status === 'approval_required';

            return (
              <SelectableSurface
                key={entry.id}
                className={`skills-list-item skills-integration-item ${selectedMcpId === entry.id ? 'is-selected' : ''}`}
                selected={selectedMcpId === entry.id}
                data-testid={`mcp-official-entry-${entry.id}`}
                onPress={() => setSelectedMcpId(entry.id)}
              >
                <div className="skills-list-leading">
                  <span className={`skills-avatar is-vicode ${isConfigured ? 'is-installed' : 'is-available'}`} aria-hidden="true">
                    <GlobeIcon size={20} />
                  </span>
                  <div className="skills-list-copy">
                    <div className="skills-list-title-row">
                      <strong>{entry.name}</strong>
                      <span
                        className={`skills-integration-status ${isConfigured ? 'is-configured' : entry.supportState === 'supported' ? 'is-supported' : 'is-planned'}`}
                      >
                        {statusLabel}
                      </span>
                    </div>
                    <p>{entry.description}</p>
                    <div className="skill-meta">
                      <span className="skill-meta-category">{entry.category}</span>
                      <span className="skill-meta-compatibility">{entry.publisher}</span>
                    </div>
                    <ul className="skills-integration-notes">
                      {entry.setupNotes.slice(0, 2).map((note) => (
                        <li key={note}>{note}</li>
                      ))}
                    </ul>
                    {isConfigured && configuredServer ? (
                      <p className="skills-integration-footnote">
                        Connected as <code>{configuredServer.name}</code>.
                      </p>
                    ) : entry.command && entry.args?.length ? (
                      <p className="skills-integration-footnote">
                        Default command: <code>{[entry.command, ...entry.args].join(' ')}</code>
                      </p>
                    ) : null}
                  </div>
                </div>
                <div className="skills-list-trailing">
                  {needsApproval && configuredServer ? (
                    <PrimaryButton
                      size="compact"
                      data-testid={`mcp-official-approve-${entry.id}`}
                      leadingIcon={<PlayIcon />}
                      onClick={(event) => {
                        event.stopPropagation();
                        void handleApproveMcpLaunch(configuredServer.id);
                      }}
                      disabled={settingUpMcpId === configuredServer.id}
                    >
                      {settingUpMcpId === configuredServer.id ? 'Starting…' : 'Approve'}
                    </PrimaryButton>
                  ) : null}
                  {entry.supportState === 'supported' && !isConfigured ? (
                    <PrimaryButton
                      size="compact"
                      data-testid={`mcp-official-add-${entry.id}`}
                      leadingIcon={<PlusIcon />}
                      onClick={(event) => {
                        event.stopPropagation();
                        void handleSetupRecommendedMcp(entry.id);
                      }}
                      disabled={settingUpMcpId === entry.id}
                    >
                      {settingUpMcpId === entry.id ? 'Adding…' : 'Add'}
                    </PrimaryButton>
                  ) : null}
                  <ActionButton
                    size="compact"
                    tone="quiet"
                    leadingIcon={<BookIcon />}
                    onClick={(event) => {
                      event.stopPropagation();
                      void handleBrowse(entry.docsUrl);
                    }}
                  >
                    Docs
                  </ActionButton>
                </div>
              </SelectableSurface>
            );
          })}
        </div>
        {filteredPluginEntries.length === 0 && configuredServers.length === 0 ? (
          <div className="empty-state compact">
            <p>No plugins match this search yet.</p>
          </div>
        ) : null}
        {selectedEntry ? (
          <div className="skills-integration-detail skills-plugin-detail flex flex-col gap-4 rounded-[28px] border border-[color:var(--ui-border-soft)] p-6">
            <div className="skills-integration-detail-header flex items-start justify-between gap-4">
              <div>
                <h4>{selectedEntry.name}</h4>
                <p>{selectedEntry.description}</p>
              </div>
              <div className="skills-detail-meta">
                <span>{selectedEntry.publisher}</span>
                <span>{selectedEntry.category}</span>
                <span>{selectedConfiguredServer?.state?.status ?? (selectedEntry.supportState === 'supported' ? 'not configured' : 'planned')}</span>
              </div>
            </div>
            <div className="skills-integration-detail-grid">
              <div className="skills-integration-detail-card">
                <strong>Command</strong>
                <p>
                  {selectedEntry.command ? <code>{[selectedEntry.command, ...(selectedEntry.args ?? [])].join(' ')}</code> : 'No local stdio command yet.'}
                </p>
              </div>
              <div className="skills-integration-detail-card">
                <strong>Environment</strong>
                <p>
                  {selectedEntry.envVars.length > 0 ? selectedEntry.envVars.join(', ') : 'No required environment variables documented.'}
                </p>
              </div>
              <div className="skills-integration-detail-card">
                <strong>Connection</strong>
                <p>
                  {selectedConfiguredServer
                    ? `${selectedConfiguredServer.state?.status ?? 'configured'}`
                    : 'Not configured in this app yet.'}
                </p>
              </div>
              <div className="skills-integration-detail-card">
                <strong>Catalog counts</strong>
                <p>
                  {selectedConfiguredServer?.state
                    ? `${selectedConfiguredServer.state.toolCount} tools, ${selectedConfiguredServer.state.resourceCount} resources, ${selectedConfiguredServer.state.promptCount} prompts`
                    : 'No live catalog data yet.'}
                </p>
              </div>
            </div>
            {selectedConfiguredServer?.envKeys.length ? (
              <p className="skills-integration-footnote">
                Configured env keys: <code>{selectedConfiguredServer.envKeys.join(', ')}</code>
              </p>
            ) : null}
            <p className="skills-integration-footnote">
              Plugins are app-managed MCP servers. They do not appear in the composer <code>$skill</code> picker because
              skills and plugins are separate surfaces.
            </p>
            {selectedConfiguredServer ? (
              <div className="skills-integration-preview-grid grid grid-cols-1 gap-3 xl:grid-cols-3">
                <div className="skills-integration-preview-card rounded-2xl border border-[color:var(--ui-border-soft)] bg-[color:var(--ui-alpha-03)] p-4">
                  <strong>Tools</strong>
                  {selectedToolPreview.length > 0 ? (
                    <ul>
                      {selectedToolPreview.map((tool) => (
                        <li key={`${tool.serverId}:${tool.name}`}>
                          <code>{tool.name}</code>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p>No tools discovered yet.</p>
                  )}
                </div>
                <div className="skills-integration-preview-card rounded-2xl border border-[color:var(--ui-border-soft)] bg-[color:var(--ui-alpha-03)] p-4">
                  <strong>Resources</strong>
                  {selectedResourcePreview.length > 0 ? (
                    <ul>
                      {selectedResourcePreview.map((resource) => (
                        <li key={`${resource.serverId}:${resource.uri}`}>
                          <code>{resource.name || resource.uri}</code>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p>No resources discovered yet.</p>
                  )}
                </div>
                <div className="skills-integration-preview-card rounded-2xl border border-[color:var(--ui-border-soft)] bg-[color:var(--ui-alpha-03)] p-4">
                  <strong>Prompts</strong>
                  {selectedPromptPreview.length > 0 ? (
                    <ul>
                      {selectedPromptPreview.map((prompt) => (
                        <li key={`${prompt.serverId}:${prompt.name}`}>
                          <code>{prompt.name}</code>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p>No prompts discovered yet.</p>
                  )}
                </div>
              </div>
            ) : null}
            {selectedConfiguredServer ? (
              <div className="skills-integration-detail-actions">
                <ActionButton
                  size="compact"
                  leadingIcon={<RefreshIcon />}
                  onClick={() => void handleRefreshMcpServer(selectedConfiguredServer.id)}
                  disabled={settingUpMcpId === selectedConfiguredServer.id}
                >
                  {settingUpMcpId === selectedConfiguredServer.id ? 'Refreshing…' : 'Refresh'}
                </ActionButton>
                <ActionButton size="compact" tone="quiet" leadingIcon={<BookIcon />} onClick={() => void handleBrowse(selectedEntry.docsUrl)}>
                  Open docs
                </ActionButton>
              </div>
            ) : null}
          </div>
        ) : null}
        {configuredServers.length > 0 ? (
          <div className="skills-integration-configured flex flex-col gap-4">
            <div className="skills-integration-detail-header flex items-start justify-between gap-4">
              <div>
                <h4>Connected plugins</h4>
                <p>App-managed MCP connections that currently exist in this workspace state.</p>
              </div>
            </div>
            <div className={`${listClass} skills-list-single-column`}>
              {configuredServers.map((server) => {
                const officialEntry = findOfficialEntryForServer(server);
                const serverTools = (mcpCatalog?.tools ?? []).filter((tool) => tool.serverId === server.id).slice(0, 3);
                const serverResources = (mcpCatalog?.resources ?? []).filter((resource) => resource.serverId === server.id).slice(0, 2);
                const serverPrompts = (mcpCatalog?.prompts ?? []).filter((prompt) => prompt.serverId === server.id).slice(0, 2);
                const isBusy = settingUpMcpId === server.id;
                const status = server.state?.status ?? 'unknown';

                return (
                  <div key={server.id} className="skills-list-item skills-integration-item" data-testid={`mcp-configured-card-${server.id}`}>
                    <div className="skills-list-leading">
                      <span className={`skills-avatar is-vicode ${status === 'connected' ? 'is-installed' : 'is-available'}`} aria-hidden="true">
                        <GlobeIcon size={20} />
                      </span>
                      <div className="skills-list-copy">
                        <div className="skills-list-title-row">
                          <strong>{server.name}</strong>
                          <span
                            className={`skills-integration-status ${status === 'connected' ? 'is-configured' : status === 'error' ? 'is-planned' : 'is-supported'}`}
                            data-testid={`mcp-configured-state-${server.id}`}
                          >
                            {status}
                          </span>
                        </div>
                        <p>{officialEntry?.description ?? `${server.transportType} integration managed by Vicode.`}</p>
                        <div className="skill-meta">
                          <span className="skill-meta-category">{officialEntry?.category ?? 'custom'}</span>
                          <span className="skill-meta-compatibility">{server.toolInvocationMode}</span>
                        </div>
                        <p className="skills-integration-footnote">
                          <code>{[server.command, ...server.args].join(' ')}</code>
                        </p>
                        <p className="skills-integration-footnote">
                          {server.state
                            ? `${server.state.toolCount} tools, ${server.state.resourceCount} resources, ${server.state.promptCount} prompts`
                            : 'No live catalog data yet.'}
                        </p>
                        {serverTools.length > 0 || serverResources.length > 0 || serverPrompts.length > 0 ? (
                          <ul className="skills-integration-notes">
                            {serverTools.map((tool) => (
                              <li key={`${server.id}:tool:${tool.name}`} data-testid={`mcp-configured-tool-${server.id}-${tool.name}`}>
                                Tool: <code>{tool.name}</code>
                              </li>
                            ))}
                            {serverResources.map((resource) => (
                              <li key={`${server.id}:resource:${resource.uri}`} data-testid={`mcp-configured-resource-${server.id}-${resource.uri}`}>
                                Resource: <code>{resource.name || resource.uri}</code>
                              </li>
                            ))}
                            {serverPrompts.map((prompt) => (
                              <li key={`${server.id}:prompt:${prompt.name}`} data-testid={`mcp-configured-prompt-${server.id}-${prompt.name}`}>
                                Prompt: <code>{prompt.name}</code>
                              </li>
                            ))}
                          </ul>
                        ) : null}
                      </div>
                    </div>
                    <div className="skills-list-trailing">
                      {status === 'approval_required' ? (
                        <PrimaryButton
                          size="compact"
                          data-testid={`mcp-configured-approve-${server.id}`}
                          leadingIcon={<PlayIcon />}
                          onClick={() => void handleApproveMcpLaunch(server.id)}
                          disabled={isBusy}
                        >
                          {isBusy ? 'Starting…' : 'Approve'}
                        </PrimaryButton>
                      ) : null}
                      {server.enabled ? (
                        <ActionButton
                          size="compact"
                          data-testid={`mcp-configured-disable-${server.id}`}
                          leadingIcon={<CloseIcon />}
                          onClick={() => void handleToggleMcpServer(server, false)}
                          disabled={isBusy}
                        >
                          {isBusy ? 'Updating…' : 'Disable'}
                        </ActionButton>
                      ) : (
                        <ActionButton
                          size="compact"
                          data-testid={`mcp-configured-enable-${server.id}`}
                          leadingIcon={<PlayIcon />}
                          onClick={() => void handleToggleMcpServer(server, true)}
                          disabled={isBusy}
                        >
                          {isBusy ? 'Updating…' : 'Enable'}
                        </ActionButton>
                      )}
                      <ActionButton
                        size="compact"
                        data-testid={`mcp-configured-refresh-${server.id}`}
                        leadingIcon={<RefreshIcon />}
                        onClick={() => void handleRefreshMcpServer(server.id)}
                        disabled={isBusy || !server.enabled}
                      >
                        {isBusy ? 'Refreshing…' : 'Refresh'}
                      </ActionButton>
                      <ActionButton
                        size="compact"
                        tone="quiet"
                        data-testid={`mcp-configured-remove-${server.id}`}
                        leadingIcon={<TrashIcon />}
                        onClick={() => void handleRemoveMcpServer(server.id)}
                        disabled={isBusy}
                      >
                        Remove
                      </ActionButton>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}
      </section>
    );
  }

  const detailSkill = selectedSkill;
  const detailSuggestedSkill = selectedSuggestedSkill;
  const attachable = detailSkill ? isAttachable(detailSkill) : false;
  const attached = detailSkill ? attachedSkillIds.includes(detailSkill.id) : false;
  const detailSyncTargets = detailSkill ? getSkillSyncTargets(detailSkill) : [];
  const detailIsProviderNative = detailSkill?.origin === 'provider_native';
  const detailIsCustom = detailSkill?.origin === 'custom_local';
  const detailIsBuiltIn = detailSkill?.origin === 'built_in_style';

  return (
    <section className="catalog-view skills-view">
      <div className={pageShellClass}>
        <header className={pageHeaderClass}>
          <div>
            <h2 className={pageTitleClass}>Plugins</h2>
            {isPluginTab ? (
              <p className={pageCopyClass}>
                Connect app-managed MCP plugins and inspect their live catalogs from one place. Recommended plugins stay
                aligned with Vicode&apos;s current host, while custom stdio plugins let you bring your own server commands
                into the app.
              </p>
            ) : (
              <p className={pageCopyClass}>
                Browse skills by type, then attach them from the composer when they support that provider. Provider-owned
                runtime installs are currently curated around Codex and Gemini from here. Browse{' '}
                <InlineActionButton className={inlineLinkClass} onClick={() => void handleBrowse(CATALOG_LINKS.openai)}>
                  Codex skills
                </InlineActionButton>{' '}
                and{' '}
                <InlineActionButton className={inlineLinkClass} onClick={() => void handleBrowse(CATALOG_LINKS.gemini)}>
                  Gemini extensions
                </InlineActionButton>
                .
              </p>
            )}
          </div>
          {onBack ? (
            <IconButton className="skills-toolbar-close" label="Close plugins" onClick={onBack}>
              <CloseIcon />
            </IconButton>
          ) : null}
        </header>

        <div className={controlsRowClass}>
          <div className={catalogControlsClass}>
            <div className={subnavClass} role="tablist" aria-label="Plugin and skill catalog sections">
              <ActionButton
                size="compact"
                tone={catalogTab === 'plugins' ? 'default' : 'quiet'}
                className="skills-subnav-button rounded-xl px-3"
                data-testid="skills-tab-plugins"
                aria-selected={catalogTab === 'plugins'}
                onClick={() => setCatalogTab('plugins')}
                leadingIcon={<CpuIcon />}
              >
                Plugins
                <span className="skills-subnav-count">{officialMcpCatalog.length}</span>
              </ActionButton>
              <ActionButton
                size="compact"
                tone={catalogTab === 'skills' ? 'default' : 'quiet'}
                className="skills-subnav-button rounded-xl px-3"
                data-testid="skills-tab-skills"
                aria-selected={catalogTab === 'skills'}
                onClick={() => setCatalogTab('skills')}
                leadingIcon={<SkillsIcon />}
              >
                Skills
                <span className="skills-subnav-count">{skills.length}</span>
              </ActionButton>
            </div>
            <TextInput
              className="skills-search min-w-[240px] max-w-sm"
              placeholder={isPluginTab ? 'Search plugins' : 'Search skills'}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <div className={headerActionsClass}>
            <ActionButton
              className="skills-toolbar-button skills-toolbar-button-refresh"
              onClick={() => void handleRefreshCurrentTab()}
              size="compact"
              leadingIcon={<RefreshIcon />}
            >
              Refresh
            </ActionButton>
            <ActionButton
              className="skills-toolbar-button"
              onClick={isPluginTab ? onCreatePlugin : onCreateSkill}
              size="compact"
              leadingIcon={<PlusIcon />}
            >
              {isPluginTab ? 'Create plugin' : 'Create skill'}
            </ActionButton>
          </div>
        </div>

        <div className={catalogShellClass}>
          {catalogTab === 'plugins' ? (
            renderPluginsSection()
          ) : (
            <>
              {renderSection('Installed', sectionedSkills.installed)}
              {renderSection('Official starter pack', [], sectionedSkills.officialSuggestions)}
              {sectionedSkills.categories.map((section) => renderSection(section.title, section.installed, section.suggested))}
              {filteredSkills.length === 0 && filteredSuggestedSkills.length === 0 ? (
                <div className="empty-state compact">
                  <p>No skills match this search yet.</p>
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>

      <ModalDialog open={detailOpen} onOpenChange={setDetailOpen} className="skills-dialog-content w-[min(980px,calc(100vw-32px))]">
        {detailSkill || detailSuggestedSkill ? (
          <div className="skills-dialog-body">
            <div className="skills-dialog-top">
              <div className="skills-dialog-heading">
                {detailSkill ? (
                  <SkillAvatar skill={detailSkill} size="large" />
                ) : detailSuggestedSkill ? (
                  <span
                    className={`skills-avatar ${detailSuggestedSkill.providerTargets.length > 1 ? 'is-vicode' : detailSuggestedSkill.providerTargets[0] === 'openai' ? 'is-openai' : detailSuggestedSkill.providerTargets[0] === 'gemini' ? 'is-gemini' : 'is-vicode'} is-available is-large`}
                    aria-hidden="true"
                  >
                    <detailSuggestedSkill.icon size={24} />
                  </span>
                ) : null}
                <div className="skills-dialog-title-group">
                  <div className="skills-dialog-title-row">
                    <h3>{detailSkill?.name ?? detailSuggestedSkill?.name}</h3>
                    <IconButton
                      className="skills-dialog-close-button"
                      label="Close"
                      size="compact"
                      onClick={() => setDetailOpen(false)}
                    >
                      <CloseIcon />
                    </IconButton>
                  </div>
                  <p>{detailSkill?.description ?? detailSuggestedSkill?.description}</p>
                  {detailSkill ? (
                    <div className="skills-detail-meta">
                      <span>{skillScopeLabel(detailSkill)}</span>
                      <span>{skillOriginLabel(detailSkill)}</span>
                      <span>{resolveSkillCategoryLabel(detailSkill)}</span>
                      <span>${getSkillCommandToken(detailSkill)}</span>
                      {detailSkill.providerTargets.map((providerId) => (
                        <span key={`${detailSkill.id}-${providerId}`}>{providerLabel(providerId)}</span>
                      ))}
                    </div>
                  ) : detailSuggestedSkill ? (
                    <div className="skills-detail-meta">
                      <span>{skillCategoryLabel(detailSuggestedSkill.category)}</span>
                      <span>{detailSuggestedSkill.installKind === 'provider_native' ? 'Available to install' : 'Importable skill'}</span>
                      <span>{detailSuggestedSkill.status === 'keep' ? 'Curated for Vicode' : 'Experimental in Vicode'}</span>
                      <span>${detailSuggestedSkill.token}</span>
                      {detailSuggestedSkill.providerTargets.map((providerId) => (
                        <span key={`${detailSuggestedSkill.id}-${providerId}`}>{providerLabel(providerId)}</span>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
              <div className="skills-dialog-header-actions">
                {detail?.browseUrl ? (
                  <ActionButton size="compact" tone="quiet" leadingIcon={<GlobeIcon />} onClick={() => void handleBrowse(detail.browseUrl!)}>
                    Browse
                  </ActionButton>
                ) : null}
                {detail?.folderPath ? (
                  <ActionButton size="compact" tone="quiet" leadingIcon={<FolderIcon />} onClick={() => void handleRevealPath(detail.folderPath!)}>
                    Open folder
                  </ActionButton>
                ) : null}
              </div>
            </div>

            {detailLoading ? (
              <div className="skills-dialog-loading">Loading skill details…</div>
            ) : (
              <>
                {detail?.examplePrompt ? (
                  <div className="skills-example-card">
                    <div className="skills-example-header">
                      <span>Example prompt</span>
                      <ActionButton size="compact" tone="quiet" leadingIcon={<CopyIcon />} onClick={() => void copyExamplePrompt()}>
                        Copy
                      </ActionButton>
                    </div>
                    <pre>{detail.examplePrompt}</pre>
                  </div>
                ) : null}

                {detailIsProviderNative ? (
                  <div className="skills-runtime-note">
                    {getSkillKind(detailSkill) === 'extension'
                      ? `${providerLabel(detailSkill.providerTargets[0] ?? composerProviderId)} loads this extension through its own runtime. Vicode detected it in the provider folder and will include it in Gemini runs while it stays enabled here. You can disable it for Vicode or uninstall it from the provider folder here.`
                      : `${providerLabel(detailSkill.providerTargets[0] ?? composerProviderId)} already manages this skill on disk. You can disable it for Vicode or uninstall it from the provider folder here.`}
                  </div>
                ) : null}

                {detailSuggestedSkill ? (
                  <div className="skills-runtime-note">
                    {detailSuggestedSkill.status === 'experimental'
                      ? 'This skill is source-reviewed but still experimental in Vicode. Review the notes here before installing it.'
                      : 'Review what this skill does here first. Use Browse only if you want to inspect the source repository directly.'}
                  </div>
                ) : null}

                <div
                  className="skills-markdown"
                  dangerouslySetInnerHTML={{
                    __html: renderMarkdown(detail?.markdown ?? buildSkillDocument(detailSkill))
                  }}
                />

                {detailIsCustom && detailSkill.scope === 'global' ? (
                  <div className="skills-sync-panel">
                    <h4>Optional export</h4>
                    <div className="skills-sync-grid">
                      {PROVIDER_OPTIONS
                        .filter((providerId) => detailSkill.providerTargets.includes(providerId))
                        .map((providerId) => {
                          const syncState = getSkillSyncState(detailSkill, providerId);
                          const exported = detailSyncTargets.includes(providerId) && syncState?.exported;
                          return (
                            <div key={`${detailSkill.id}-${providerId}-sync`} className="skills-sync-item">
                              <div>
                                <strong>{providerLabel(providerId)}</strong>
                                <p>{exported ? syncState?.path ?? 'Exported' : 'Not exported'}</p>
                              </div>
                              <ActionButton
                                size="compact"
                                onClick={() => void syncSkill(detailSkill.id, providerId, !detailSyncTargets.includes(providerId))}
                              >
                                {detailSyncTargets.includes(providerId) ? 'Stop export' : 'Export'}
                              </ActionButton>
                            </div>
                          );
                        })}
                    </div>
                  </div>
                ) : null}
              </>
            )}

            <div className="skills-dialog-actions">
              <div className="skills-dialog-actions-left">
                {detailIsCustom ? (
                  <ActionButton size="compact" tone="quiet" leadingIcon={<SaveIcon />} onClick={() => openEditSkill(detailSkill)}>
                    Edit
                  </ActionButton>
                ) : null}
                {!detailSuggestedSkill && !detailIsBuiltIn ? (
                  <ActionButton
                    size="compact"
                    tone="quiet"
                    leadingIcon={detailSkill.enabled ? <CloseIcon /> : <PlusIcon />}
                    onClick={() => void toggleSkill(detailSkill.id, !detailSkill.enabled)}
                  >
                    {detailSkill.enabled ? 'Disable' : 'Enable'}
                  </ActionButton>
                ) : null}
                {!detailSuggestedSkill && !detailIsBuiltIn ? (
                  <DangerButton size="compact" leadingIcon={<TrashIcon />} onClick={() => void handleRemove(detailSkill)}>
                    {detailIsProviderNative ? 'Uninstall' : 'Remove'}
                  </DangerButton>
                ) : null}
                {detailSuggestedSkill ? (
                  <ActionButton
                    size="compact"
                    tone="quiet"
                    leadingIcon={<PlusIcon />}
                    disabled={installingSkillId === detailSuggestedSkill.id}
                    onClick={() => void handleInstallSuggested(detailSuggestedSkill)}
                  >
                    {installingSkillId === detailSuggestedSkill.id ? 'Installing…' : 'Install'}
                  </ActionButton>
                ) : null}
              </div>
              {!detailSuggestedSkill ? (
                <PrimaryButton
                  size="compact"
                  leadingIcon={attached ? <CheckIcon /> : <PlayIcon />}
                  onClick={() => toggleAttachedSkill(detailSkill.id)}
                  disabled={!attachable}
                >
                  {attached ? 'Attached' : detail?.attachMode === 'runtime' ? 'Try in composer' : 'Attach to composer'}
                </PrimaryButton>
              ) : null}
            </div>

            {!detailSuggestedSkill && !attachable ? (
              <p className="skills-dialog-footnote">
                {detailSkill.scope === 'project' && detailSkill.projectId !== selectedProject?.id
                  ? 'Switch to the matching project before attaching this project skill.'
                  : `This skill is not available for the current ${providerLabel(composerProviderId)} composer.`}
              </p>
            ) : null}
            {detailIsBuiltIn ? (
              <p className="skills-dialog-footnote">Vicode skills are optional. Install them here, then attach them from the composer when needed.</p>
            ) : null}
          </div>
        ) : null}
      </ModalDialog>

      <ModalDialog
        open={editorOpen}
        onOpenChange={setEditorOpen}
        className="skills-editor-dialog w-[min(760px,calc(100vw-32px))]"
        title={draft.id ? 'Edit skill' : 'New skill'}
        description="Create a Vicode-managed skill. It can be attached in the composer and optionally exported to provider folders."
        actions={
          <>
            <ActionButton tone="quiet" onClick={() => setEditorOpen(false)}>
              Cancel
            </ActionButton>
            <PrimaryButton onClick={() => void handleSave()} leadingIcon={<SaveIcon />}>
              {draft.id ? 'Save changes' : 'Save skill'}
            </PrimaryButton>
          </>
        }
      >
        <div className="skills-editor-form">
          <TextInput
            data-testid="skill-dialog-name"
            placeholder="Skill name"
            value={draft.name}
            onChange={(event) => updateDraft({ name: event.target.value })}
          />
          <TextInput
            data-testid="skill-dialog-description"
            placeholder="Short description"
            value={draft.description}
            onChange={(event) => updateDraft({ description: event.target.value })}
          />
          <div className="skills-form-group">
            <span className="skills-form-label">Scope</span>
            <SelectField
              data-testid="skill-dialog-scope"
              value={draft.scope}
              onChange={(event) =>
                updateDraft({
                  scope: event.target.value as 'global' | 'project',
                  syncTargets: event.target.value === 'global' ? draft.syncTargets : []
                })
              }
            >
              <option value="project" disabled={!selectedProject}>
                Project
              </option>
              <option value="global">Personal across all projects</option>
            </SelectField>
            <p className="skills-form-help">
              {draft.scope === 'project'
                ? selectedProject
                  ? `Only available in ${selectedProject.name}. This is the safer default for new skills.`
                  : 'Project skills require an active project.'
                : 'Available in every project and thread on this device. Use this only for stable personal workflows.'}
            </p>
          </div>

          <div className="skills-form-group">
            <span className="skills-form-label">Available for</span>
            <div className="skills-toggle-row">
              {PROVIDER_OPTIONS.map((providerId) => (
                <ActionButton
                  key={`provider-target-${providerId}`}
                  size="compact"
                  className={draft.providerTargets.includes(providerId) ? 'skills-toggle-button is-active' : 'skills-toggle-button'}
                  onClick={() => toggleDraftProvider(providerId)}
                >
                  {providerLabel(providerId)}
                </ActionButton>
              ))}
            </div>
          </div>

          <div className="skills-form-group">
            <span className="skills-form-label">Optional export</span>
            <p className="skills-form-help">
              Export is only available for personal skills that live across all projects.
            </p>
            <div className="skills-toggle-row">
              {PROVIDER_OPTIONS.map((providerId) => {
                const disabled = draft.scope !== 'global' || !draft.providerTargets.includes(providerId);
                return (
                  <ActionButton
                    key={`provider-sync-${providerId}`}
                    size="compact"
                    className={draft.syncTargets.includes(providerId) ? 'skills-toggle-button is-active' : 'skills-toggle-button'}
                    onClick={() => toggleDraftSync(providerId)}
                    disabled={disabled}
                  >
                    Export to {providerLabel(providerId)}
                  </ActionButton>
                );
              })}
            </div>
          </div>

          <TextArea
            data-testid="skill-dialog-instructions"
            className="skills-editor-area"
            placeholder="Write the skill instructions that should be injected when this skill is attached."
            value={draft.instructions}
            onChange={(event) => updateDraft({ instructions: event.target.value })}
          />
        </div>
      </ModalDialog>
    </section>
  );
}
