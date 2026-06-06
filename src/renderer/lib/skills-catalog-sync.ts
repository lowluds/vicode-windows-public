import type {
  McpCatalogSnapshot,
  McpServerView,
  ProviderId,
  SkillCategory,
  SkillDefinition
} from '../../shared/domain';

type ToastLevel = 'info' | 'warning' | 'error';

type SuggestedSkillInstallInput = {
  id: string;
  name: string;
  description: string;
  installKind: 'provider_reference' | 'github_folder';
  providerId?: ProviderId;
  providerTargets: ProviderId[];
  browseUrl: string;
  owner?: string;
  repo?: string;
  path?: string;
  token: string;
  category: SkillCategory;
};

export interface SkillsCatalogSyncHost {
  refreshSkills(): Promise<void>;
  toggleSkill(skillId: string, enabled: boolean): Promise<SkillDefinition>;
  syncMcpImports(): Promise<void>;
  listMcpServers(): Promise<McpServerView[]>;
  listMcpCatalog(): Promise<McpCatalogSnapshot>;
  installSuggestedSkill(input: {
    installKind: 'github_folder';
    providerTargets: ProviderId[];
    token: string;
    owner: string | null;
    repo: string | null;
    path: string | null;
    name: string;
    description: string;
    browseUrl: string;
    category: SkillCategory;
  }): Promise<{ status: 'completed' | 'blocked'; message?: string | null }>;
  setMcpServers(value: McpServerView[]): void;
  setMcpCatalog(value: McpCatalogSnapshot): void;
  setInstallingSkillId(value: string | null): void;
  showToast(level: ToastLevel, message: string): void;
}

export async function installCatalogSkill(
  host: SkillsCatalogSyncHost,
  skill: SkillDefinition
) {
  try {
    await host.toggleSkill(skill.id, true);
    host.showToast('info', `Installed ${skill.name}.`);
  } catch (error) {
    host.showToast('error', error instanceof Error ? error.message : `Failed to install ${skill.name}.`);
  }
}

export async function installSuggestedSkill(
  host: SkillsCatalogSyncHost,
  skill: SuggestedSkillInstallInput
) {
  if (skill.installKind !== 'github_folder') {
    host.showToast('info', 'Provider-managed resources are browse-only in Vicode. Use Browse to inspect the source.');
    return;
  }

  host.setInstallingSkillId(skill.id);

  try {
    const result = await host.installSuggestedSkill({
      installKind: skill.installKind,
      providerTargets: skill.providerTargets,
      token: skill.token,
      owner: skill.owner ?? null,
      repo: skill.repo ?? null,
      path: skill.path ?? null,
      name: skill.name,
      description: skill.description,
      browseUrl: skill.browseUrl,
      category: skill.category
    });
    if (result.status === 'completed') {
      await host.refreshSkills();
    }
    host.showToast('info', result.message || `Installed ${skill.name}.`);
  } catch (error) {
    host.showToast('error', error instanceof Error ? error.message : `Failed to install ${skill.name}.`);
  } finally {
    host.setInstallingSkillId(null);
  }
}

export async function refreshPluginsCatalog(
  host: SkillsCatalogSyncHost,
  showMessage = true
) {
  await host.syncMcpImports();
  const [servers, catalog] = await Promise.all([host.listMcpServers(), host.listMcpCatalog()]);
  host.setMcpServers(servers);
  host.setMcpCatalog(catalog);
  if (showMessage) {
    host.showToast('info', 'Plugins refreshed.');
  }
}

export async function refreshCurrentCatalogTab(
  host: SkillsCatalogSyncHost,
  catalogTab: 'plugins' | 'skills'
) {
  try {
    if (catalogTab === 'plugins') {
      await refreshPluginsCatalog(host);
    } else {
      await host.refreshSkills();
      host.showToast('info', 'Skills refreshed.');
    }
  } catch (error) {
    host.showToast('error', error instanceof Error ? error.message : `Failed to refresh ${catalogTab}.`);
  }
}
