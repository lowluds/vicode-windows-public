import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import DOMPurify from 'dompurify';
import { marked } from 'marked';
import {
  ActionButton,
  DangerButton,
  IconButton,
  Menu,
  MenuContent,
  MenuItem,
  MenuItemLabel,
  MenuTrigger,
  ModalDialog,
  PrimaryButton,
  SelectableSurface,
  SelectField,
  TextArea,
  TextInput
} from './ui';
import type { McpCatalogSnapshot, McpServerView, Project, ProviderId, SkillCategory, SkillDefinition, SkillDetail, SkillSaveInput } from '../../shared/domain';
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
  installCatalogSkill as installCatalogSkillFlow,
  installSuggestedSkill as installSuggestedSkillFlow,
  refreshCurrentCatalogTab as refreshCurrentCatalogTabFlow,
  refreshPluginsCatalog as refreshPluginsCatalogFlow,
  type SkillsCatalogSyncHost
} from '../lib/skills-catalog-sync';
import {
  approveMcpLaunch as approveMcpLaunchFlow,
  refreshMcpServer as refreshMcpServerFlow,
  removeMcpServer as removeMcpServerFlow,
  setupRecommendedMcp as setupRecommendedMcpFlow,
  toggleMcpServer as toggleMcpServerFlow,
  type SkillsMcpServerActionsHost
} from '../lib/skills-mcp-server-actions';
import {
  AutomationIcon,
  BrushIcon,
  ChevronDownIcon,
  CheckIcon,
  CloseIcon,
  CopyIcon,
  CpuIcon,
  DocumentIcon,
  FolderIcon,
  GlobeIcon,
  LoadingIcon,
  MonitorIcon,
  PlayIcon,
  PlusIcon,
  RefreshIcon,
  SaveIcon,
  SettingsIcon,
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

function pluginCategoryLabel(category: (typeof officialMcpCatalog)[number]['category']) {
  switch (category) {
    case 'ui':
      return 'Coding';
    case 'design':
    case 'component-system':
      return 'Design';
    case 'deploy':
    case 'backend':
      return 'Engineering';
    case 'collaboration':
      return 'Collaboration';
    default:
      return 'Plugins';
  }
}

function isSystemSkill(skill: SkillDefinition) {
  const token = getSkillCommandToken(skill);
  return token === 'skill-creator' || token === 'plugin-creator' || token === 'skill-installer';
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

  const catalogSyncHost: SkillsCatalogSyncHost = {
    refreshSkills,
    toggleSkill,
    syncMcpImports: () => window.vicode.mcp.syncImports(),
    listMcpServers: () => window.vicode.mcp.listServers(),
    listMcpCatalog: () => window.vicode.mcp.listCatalog(),
    installSuggestedSkill: (input) => window.vicode.skills.installSuggested(input),
    setMcpServers,
    setMcpCatalog: (value) => setMcpCatalog(value),
    setInstallingSkillId,
    showToast
  };
  const mcpServerActionsHost: SkillsMcpServerActionsHost = {
    getSelectedProjectId: () => selectedProject?.id ?? null,
    getMcpServers: () => mcpServers,
    setupRecommendedMcp: (input) => window.vicode.mcp.setupRecommended(input),
    approveMcpLaunch: (serverId) => window.vicode.mcp.approveLaunch(serverId),
    refreshMcpServer: (serverId) => window.vicode.mcp.refreshServer(serverId),
    setMcpServerEnabled: (serverId, enabled) => window.vicode.mcp.setEnabled(serverId, enabled),
    removeMcpServer: (serverId) => window.vicode.mcp.removeServer(serverId),
    listMcpCatalog: () => window.vicode.mcp.listCatalog(),
    setMcpServers,
    setMcpCatalog: (value) => setMcpCatalog(value),
    setSettingUpMcpId,
    showToast
  };

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

  const pageShellClass = 'skills-page-shell';
  const headerActionsClass = 'skills-header-actions';
  const controlsRowClass = 'skills-controls-row';
  const catalogControlsClass = 'skills-catalog-controls';
  const subnavClass = 'skills-subnav';
  const catalogShellClass = 'skills-catalog-shell';
  const sectionClass = 'skills-section';
  const sectionHeadingClass = 'skills-section-heading';
  const listClass = 'skills-list';
  const listItemClass = 'skills-list-item';
  const listLeadingClass = 'skills-list-leading';
  const listCopyClass = 'skills-list-copy';
  const listTitleRowClass = 'skills-list-title-row';
  const listTrailingClass = 'skills-list-trailing';
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
    await installCatalogSkillFlow(catalogSyncHost, skill);
  }

  async function handleInstallSuggested(skill: SuggestedSkill) {
    await installSuggestedSkillFlow(catalogSyncHost, skill);
  }

  async function handleRevealPath(path: string) {
    await window.vicode.app.revealPath(path);
  }

  async function refreshPluginsCatalog(showMessage = true) {
    await refreshPluginsCatalogFlow(catalogSyncHost, showMessage);
  }

  async function handleRefreshCurrentTab() {
    await refreshCurrentCatalogTabFlow(catalogSyncHost, catalogTab);
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

  async function handleSetupRecommendedMcp(entryId: string) {
    await setupRecommendedMcpFlow(mcpServerActionsHost, entryId);
  }

  async function handleApproveMcpLaunch(serverId: string) {
    await approveMcpLaunchFlow(mcpServerActionsHost, serverId);
  }

  async function handleRefreshMcpServer(serverId: string) {
    await refreshMcpServerFlow(mcpServerActionsHost, serverId);
  }

  async function handleToggleMcpServer(server: McpServerView, enabled: boolean) {
    await toggleMcpServerFlow(mcpServerActionsHost, server, enabled);
  }

  async function handleRemoveMcpServer(serverId: string) {
    await removeMcpServerFlow(mcpServerActionsHost, serverId);
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
          </div>
        </div>
        <div className={listTrailingClass}>
          {installable ? (
            <IconButton
              size="compact"
              className="skills-row-action"
              label={`Install ${skill.name}`}
              onClick={(event) => {
                event.stopPropagation();
                void handleInstallCatalogSkill(skill);
              }}
            >
              <PlusIcon />
            </IconButton>
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
      <section key={title} className={sectionClass}>
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
                  </div>
                  <p>{skill.description}</p>
                </div>
              </div>
              <div className={listTrailingClass}>
                <IconButton
                  size="compact"
                  className="skills-row-action"
                  label={`Install ${skill.name}`}
                  disabled={installingSkillId === skill.id}
                  onClick={(event) => {
                    event.stopPropagation();
                    void handleInstallSuggested(skill);
                  }}
                >
                  {installingSkillId === skill.id ? <LoadingIcon /> : <PlusIcon />}
                </IconButton>
              </div>
            </SelectableSurface>
          ))}
        </div>
      </section>
    );
  }

  function renderPluginsSection() {
    const configuredServers = filteredConfiguredServers;
    const featuredEntries = filteredPluginEntries.filter((entry) => entry.supportState === 'supported');
    const categorizedEntries = filteredPluginEntries.filter((entry) => entry.supportState !== 'supported');
    const pluginSections = ['Design', 'Engineering', 'Collaboration', 'Plugins']
      .map((title) => ({
        title,
        entries: categorizedEntries.filter((entry) => pluginCategoryLabel(entry.category) === title)
      }))
      .filter((section) => section.entries.length > 0);

    function renderPluginEntry(entry: (typeof officialMcpCatalog)[number]) {
      const configuredServer = findConfiguredMcpServer(entry.id);
      const isConfigured = Boolean(configuredServer);
      const needsApproval = configuredServer?.state?.status === 'approval_required';

      return (
        <SelectableSurface
          key={entry.id}
          className={`skills-list-item skills-integration-item ${selectedMcpId === entry.id ? 'is-selected' : ''}`}
          selected={selectedMcpId === entry.id}
          data-testid={`mcp-official-entry-${entry.id}`}
          onPress={() => {
            setSelectedMcpId(entry.id);
            void handleBrowse(entry.docsUrl);
          }}
        >
          <div className={listLeadingClass}>
            <span className={`skills-avatar is-vicode ${isConfigured ? 'is-installed' : 'is-available'}`} aria-hidden="true">
              <GlobeIcon size={20} />
            </span>
            <div className={listCopyClass}>
              <div className={listTitleRowClass}>
                <strong>{entry.name}</strong>
              </div>
              <p>{entry.description}</p>
            </div>
          </div>
          <div className={listTrailingClass}>
            {needsApproval && configuredServer ? (
              <IconButton
                size="compact"
                className="skills-row-action"
                data-testid={`mcp-official-approve-${entry.id}`}
                label={`Approve ${entry.name}`}
                onClick={(event) => {
                  event.stopPropagation();
                  void handleApproveMcpLaunch(configuredServer.id);
                }}
                disabled={settingUpMcpId === configuredServer.id}
              >
                {settingUpMcpId === configuredServer.id ? <LoadingIcon /> : <PlayIcon />}
              </IconButton>
            ) : null}
            {entry.supportState === 'supported' && !isConfigured ? (
              <IconButton
                size="compact"
                className="skills-row-action"
                data-testid={`mcp-official-add-${entry.id}`}
                label={`Add ${entry.name}`}
                onClick={(event) => {
                  event.stopPropagation();
                  void handleSetupRecommendedMcp(entry.id);
                }}
                disabled={settingUpMcpId === entry.id}
              >
                {settingUpMcpId === entry.id ? <LoadingIcon /> : <PlusIcon />}
              </IconButton>
            ) : null}
            {isConfigured && !needsApproval ? (
              <span className="skills-card-state is-enabled">
                <CheckIcon />
              </span>
            ) : null}
            {entry.supportState !== 'supported' ? (
              <IconButton
                size="compact"
                className="skills-row-action is-disabled"
                label={`${entry.name} is planned`}
                disabled
              >
                <PlusIcon />
              </IconButton>
            ) : null}
          </div>
        </SelectableSurface>
      );
    }

    function renderConnectedPlugin(server: McpServerView) {
      const officialEntry = findOfficialEntryForServer(server);
      const isBusy = settingUpMcpId === server.id;
      const status = server.state?.status ?? 'unknown';

      return (
        <div key={server.id} className="skills-list-item skills-integration-item" data-testid={`mcp-configured-card-${server.id}`}>
          <div className={listLeadingClass}>
            <span className={`skills-avatar is-vicode ${status === 'connected' ? 'is-installed' : 'is-available'}`} aria-hidden="true">
              <GlobeIcon size={20} />
            </span>
            <div className={listCopyClass}>
              <div className={listTitleRowClass}>
                <strong>{server.name}</strong>
                <span
                  className={`skills-integration-status ${status === 'connected' ? 'is-configured' : status === 'error' ? 'is-planned' : 'is-supported'}`}
                  data-testid={`mcp-configured-state-${server.id}`}
                >
                  {status}
                </span>
              </div>
              <p>{officialEntry?.description ?? `${server.transportType} integration managed by Vicode.`}</p>
            </div>
          </div>
          <div className={listTrailingClass}>
            {status === 'approval_required' ? (
              <IconButton
                size="compact"
                className="skills-row-action"
                data-testid={`mcp-configured-approve-${server.id}`}
                label={`Approve ${server.name}`}
                onClick={() => void handleApproveMcpLaunch(server.id)}
                disabled={isBusy}
              >
                {isBusy ? <LoadingIcon /> : <PlayIcon />}
              </IconButton>
            ) : null}
            {server.enabled ? (
              <IconButton
                size="compact"
                className="skills-row-action"
                data-testid={`mcp-configured-disable-${server.id}`}
                label={`Disable ${server.name}`}
                onClick={() => void handleToggleMcpServer(server, false)}
                disabled={isBusy}
              >
                <CloseIcon />
              </IconButton>
            ) : (
              <IconButton
                size="compact"
                className="skills-row-action"
                data-testid={`mcp-configured-enable-${server.id}`}
                label={`Enable ${server.name}`}
                onClick={() => void handleToggleMcpServer(server, true)}
                disabled={isBusy}
              >
                <PlayIcon />
              </IconButton>
            )}
            <IconButton
              size="compact"
              className="skills-row-action"
              data-testid={`mcp-configured-refresh-${server.id}`}
              label={`Refresh ${server.name}`}
              onClick={() => void handleRefreshMcpServer(server.id)}
              disabled={isBusy || !server.enabled}
            >
              <RefreshIcon />
            </IconButton>
            <IconButton
              size="compact"
              className="skills-row-action"
              data-testid={`mcp-configured-remove-${server.id}`}
              label={`Remove ${server.name}`}
              onClick={() => void handleRemoveMcpServer(server.id)}
              disabled={isBusy}
            >
              <TrashIcon />
            </IconButton>
          </div>
        </div>
      );
    }

    function renderPluginCatalogSection(title: string, entries: (typeof officialMcpCatalog)[number][]) {
      if (entries.length === 0) {
        return null;
      }

      return (
        <section key={title} className={sectionClass}>
          <div className={sectionHeadingClass}>
            <h3>{title}</h3>
          </div>
          <div className={listClass}>
            {entries.map(renderPluginEntry)}
          </div>
        </section>
      );
    }

    return (
      <>
        {configuredServers.length > 0 ? (
          <section className={sectionClass}>
            <div className={sectionHeadingClass}>
              <h3>Connected</h3>
            </div>
            <div className={`${listClass} skills-list-single-column`}>
              {configuredServers.map(renderConnectedPlugin)}
            </div>
          </section>
        ) : null}
        {renderPluginCatalogSection('Featured', featuredEntries)}
        {pluginSections.map((section) => renderPluginCatalogSection(section.title, section.entries))}
        {filteredPluginEntries.length === 0 && configuredServers.length === 0 ? (
          <div className="empty-state compact">
            <p>No plugins match this search yet.</p>
          </div>
        ) : null}
      </>
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
        <header className="skills-topbar">
          <div className={subnavClass} role="tablist" aria-label="Plugin and skill catalog sections">
            <ActionButton
              size="compact"
              tone={catalogTab === 'plugins' ? 'default' : 'quiet'}
              className="skills-subnav-button"
              data-testid="skills-tab-plugins"
              role="tab"
              aria-selected={catalogTab === 'plugins'}
              onClick={() => setCatalogTab('plugins')}
            >
              Plugins
            </ActionButton>
            <ActionButton
              size="compact"
              tone={catalogTab === 'skills' ? 'default' : 'quiet'}
              className="skills-subnav-button"
              data-testid="skills-tab-skills"
              role="tab"
              aria-selected={catalogTab === 'skills'}
              onClick={() => setCatalogTab('skills')}
            >
              Skills
            </ActionButton>
          </div>
          <div className={headerActionsClass}>
            <ActionButton
              className="skills-toolbar-button"
              onClick={() => void handleRefreshCurrentTab()}
              size="compact"
              leadingIcon={<SettingsIcon />}
            >
              Manage
            </ActionButton>
            <Menu>
              <MenuTrigger asChild>
                <ActionButton
                  className="skills-toolbar-button"
                  size="compact"
                  trailingIcon={<ChevronDownIcon />}
                >
                  Create
                </ActionButton>
              </MenuTrigger>
              <MenuContent className="skills-create-menu" align="end">
                <MenuItem onSelect={() => onCreatePlugin()}>
                  <MenuItemLabel>Create plugin</MenuItemLabel>
                </MenuItem>
                <MenuItem onSelect={() => onCreateSkill()}>
                  <MenuItemLabel>Create skill</MenuItemLabel>
                </MenuItem>
              </MenuContent>
            </Menu>
            {onBack ? (
              <IconButton
                className="skills-toolbar-close"
                label="Close plugins and skills"
                size="compact"
                onClick={onBack}
              >
                <CloseIcon />
              </IconButton>
            ) : null}
          </div>
        </header>

        <main className="skills-catalog-stage">
          <div className="skills-hero">
            <h2>Make Vicode work your way</h2>
          </div>

          <div className={controlsRowClass}>
            <div className={catalogControlsClass}>
              <TextInput
                className="skills-search"
                placeholder={isPluginTab ? 'Search plugins' : 'Search skills'}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
          </div>

          <div className={catalogShellClass}>
            {catalogTab === 'plugins' ? (
              renderPluginsSection()
            ) : (
              <>
                {renderSection('Recommended', [], sectionedSkills.officialSuggestions)}
                {renderSection('System', sectionedSkills.installed.filter(isSystemSkill))}
                {renderSection('Personal', sectionedSkills.installed.filter((skill) => !isSystemSkill(skill)))}
                {sectionedSkills.categories.map((section) => renderSection(section.title, section.installed, section.suggested))}
                {filteredSkills.length === 0 && filteredSuggestedSkills.length === 0 ? (
                  <div className="empty-state compact">
                    <p>No skills match this search yet.</p>
                  </div>
                ) : null}
              </>
            )}
          </div>
        </main>
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
                  aria-pressed={draft.providerTargets.includes(providerId)}
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
                    aria-pressed={draft.syncTargets.includes(providerId)}
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
