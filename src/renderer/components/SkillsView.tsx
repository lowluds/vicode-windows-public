import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import {
  ActionButton,
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
import type { McpCatalogSnapshot, McpServerView, Project, ProviderId, SkillDefinition, SkillDetail, SkillSaveInput } from '../../shared/domain';
import { officialMcpCatalog } from '../../shared/curatedCatalog';
import {
  installCatalogSkill as installCatalogSkillFlow,
  installSuggestedSkill as installSuggestedSkillFlow,
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
  SUGGESTED_SKILLS,
  buildSuggestedSkillDocument,
  canInstallSuggestedSkill,
  type SuggestedSkill
} from './SkillsView.suggested';
import {
  PROVIDER_OPTIONS,
  compatibilityLabel,
  providerLabel
} from './SkillsView.labels';
import {
  buildSkillSaveInput,
  canSaveSkillDraft,
  createDraftFromSkill,
  emptyDraft,
  isSkillAttachable,
  skillDraftScopeHelp,
  toggleDraftProviderTargets,
  type SkillDraft
} from './SkillsView.activeSkills';
import {
  buildSkillCatalogSections,
  filterActiveSkillsForQuery,
  filterSuggestedSkillsForQuery
} from './SkillsView.catalog';
import {
  buildPluginCatalogSections,
  filterConfiguredMcpServersForQuery,
  filterOfficialMcpCatalogForQuery,
  findConfiguredMcpServer as findConfiguredMcpServerForEntry,
  findOfficialEntryForServer as findOfficialMcpEntryForServer,
  formatMcpServerConnectionDiagnostic
} from './SkillsView.plugins';
import {
  suggestedSkillAvatarClass
} from './SkillsView.detail';
import { SkillAvatar } from './SkillsView.avatar';
import { SkillDetailDialog } from './SkillsView.detailDialog';
import {
  ChevronDownIcon,
  CheckIcon,
  CloseIcon,
  GlobeIcon,
  LoadingIcon,
  PlayIcon,
  PlusIcon,
  RefreshIcon,
  SaveIcon,
  TaskIcon,
  TrashIcon
} from './icons';

type CatalogTab = 'plugins' | 'skills';

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
    return filterActiveSkillsForQuery(skills, deferredQuery);
  }, [deferredQuery, skills]);

  const filteredSuggestedSkills = useMemo(() => {
    return filterSuggestedSkillsForQuery(SUGGESTED_SKILLS, deferredQuery);
  }, [deferredQuery]);

  const filteredPluginEntries = useMemo(() => {
    return filterOfficialMcpCatalogForQuery(officialMcpCatalog, deferredQuery);
  }, [deferredQuery]);

  const filteredConfiguredServers = useMemo(() => {
    return filterConfiguredMcpServersForQuery(mcpServers, officialMcpCatalog, mcpCatalog, deferredQuery);
  }, [deferredQuery, mcpCatalog, mcpServers]);

  const sectionedSkills = useMemo(() => {
    return buildSkillCatalogSections(filteredSkills, filteredSuggestedSkills);
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
      return {
        ...current,
        providerTargets: toggleDraftProviderTargets(current.providerTargets, providerId)
      };
    });
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
      attachMode: skill.installKind === 'provider_reference' ? 'runtime' : 'prompt',
      kind: skill.installKind === 'provider_reference' ? 'extension' : 'skill'
    });
    setDetailLoading(false);
    setDetailOpen(true);
  }

  function openEditSkill(skill: SkillDefinition) {
    setDraft(createDraftFromSkill(skill));
    setEditorOpen(true);
  }

  async function handleSave() {
    if (!canSaveSkillDraft(draft)) {
      return;
    }
    if (draft.scope === 'project' && !selectedProject) {
      showToast('error', 'Project skills require an active project.');
      return;
    }

    const saved = await saveSkill(buildSkillSaveInput(draft, selectedProject));

    setEditorOpen(false);
    await openSkill(saved);
  }

  async function handleRemove(skill: SkillDefinition) {
    if (skill.origin === 'built_in_style') {
      return;
    }

    if (!window.confirm(`Delete "${skill.name}"?`)) {
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
    if (!canInstallSuggestedSkill(skill)) {
      showToast('info', 'Provider-managed resources are installed in the provider app. Use Browse to inspect the source.');
      return;
    }

    await installSuggestedSkillFlow(catalogSyncHost, skill);
  }

  async function handleRevealPath(path: string) {
    await window.vicode.app.revealPath(path);
  }

  async function refreshPluginsCatalog(showMessage = true) {
    await refreshPluginsCatalogFlow(catalogSyncHost, showMessage);
  }

  function isAttachable(skill: SkillDefinition) {
    return isSkillAttachable(skill, composerProviderId, selectedProject?.id ?? null);
  }

  function findConfiguredMcpServer(entryId: string) {
    return findConfiguredMcpServerForEntry(officialMcpCatalog, mcpServers, entryId, selectedProject?.id ?? null);
  }

  function findOfficialEntryForServer(server: McpServerView) {
    return findOfficialMcpEntryForServer(officialMcpCatalog, server);
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
                <span className={suggestedSkillAvatarClass(skill)} aria-hidden="true">
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
                {canInstallSuggestedSkill(skill) ? (
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
                ) : (
                  <span className="skills-card-state">Browse</span>
                )}
              </div>
            </SelectableSurface>
          ))}
        </div>
      </section>
    );
  }

  function renderPluginsSection() {
    const configuredServers = filteredConfiguredServers;
    const { featuredEntries, sections: pluginSections } = buildPluginCatalogSections(filteredPluginEntries);

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
            {entry.docsUrl ? (
              <IconButton
                size="compact"
                className="skills-row-action"
                label={`Open ${entry.name} docs`}
                onClick={(event) => {
                  event.stopPropagation();
                  void handleBrowse(entry.docsUrl!);
                }}
              >
                <GlobeIcon />
              </IconButton>
            ) : null}
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
      const diagnostic = formatMcpServerConnectionDiagnostic(server);

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
              {diagnostic ? (
                <p className="skills-integration-diagnostic" data-testid={`mcp-configured-diagnostic-${server.id}`}>
                  {diagnostic}
                </p>
              ) : null}
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

  return (
    <section className="catalog-view skills-view">
      <div className={pageShellClass}>
        <header className="skills-topbar">
          <div className={subnavClass} role="tablist" aria-label="Catalog sections">
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
                label="Close catalog"
                size="compact"
                onClick={onBack}
              >
                <CloseIcon />
              </IconButton>
            ) : null}
          </div>
        </header>

        <main className="skills-catalog-stage">
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
                {renderSection('System', sectionedSkills.installedSystem)}
                {renderSection('Built-in', sectionedSkills.installedBuiltIn)}
                {renderSection('Project skills', sectionedSkills.installedProject)}
                {renderSection('User skills', sectionedSkills.installedUser)}
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

      <SkillDetailDialog
        open={detailOpen}
        onOpenChange={setDetailOpen}
        detailSkill={detailSkill}
        detailSuggestedSkill={detailSuggestedSkill}
        detail={detail}
        detailLoading={detailLoading}
        composerProviderId={composerProviderId}
        selectedProjectId={selectedProject?.id ?? null}
        installingSkillId={installingSkillId}
        attached={attached}
        attachable={attachable}
        onBrowse={(url) => void handleBrowse(url)}
        onRevealPath={(path) => void handleRevealPath(path)}
        onCopyExamplePrompt={() => void copyExamplePrompt()}
        onEditSkill={openEditSkill}
        onToggleSkill={(skillId, enabled) => void toggleSkill(skillId, enabled)}
        onRemoveSkill={(skill) => void handleRemove(skill)}
        onInstallSuggested={(skill) => void handleInstallSuggested(skill)}
        onToggleAttachedSkill={toggleAttachedSkill}
      />

      <ModalDialog
        open={editorOpen}
        onOpenChange={setEditorOpen}
        className="skills-editor-dialog w-[min(760px,calc(100vw-32px))]"
        title={draft.id ? 'Edit skill' : 'New skill'}
        description="Create a Vicode-managed skill. It can be attached in the composer without writing to provider-owned skill folders."
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
                  scope: event.target.value as 'global' | 'project'
                })
              }
            >
              <option value="project" disabled={!selectedProject}>
                Project
              </option>
              <option value="global">Personal across all projects</option>
            </SelectField>
            <p className="skills-form-help">
              {skillDraftScopeHelp(draft, selectedProject)}
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
