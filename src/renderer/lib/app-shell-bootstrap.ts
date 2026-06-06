import type {
  AppMeta,
  AppUpdateState,
  BootstrapData,
  CollabBootstrap,
  Preferences,
  Project,
  ProviderDescriptor,
  ProviderId,
  RunToolApprovalRequest,
  SkillDefinition,
  ThreadDetail,
  ThreadSummary
} from '../../shared/domain';
import { deriveRecentThreads, surfaceProviders } from './thread-presentation';
import { resolveDefaultProviderId, resolveProviderModelId } from './provider-defaults';
import { resolveProviderThinkingDefault } from '../../shared/providers';

export type BootstrapComposerEffort = 'Low' | 'Medium' | 'High' | 'Extra high';

type CollaborationSelectionState = {
  roomId: string;
  chatId: string;
  contactId: string;
};

type BootstrapComposerDefaults = {
  providerId: ProviderId;
  modelId: string;
  thinkingEnabled: boolean;
  executionPermission: Preferences['defaultExecutionPermission'];
};

export interface AppShellBootstrapHost {
  getExpandedProjectIds(): string[];
  getToolApprovalResolvingId(): string | null;
  getCollaborationSelection(): CollaborationSelectionState;
  loadBootstrap(): Promise<BootstrapData>;
  loadAppMeta(): Promise<AppMeta>;
  loadUpdateState(): Promise<AppUpdateState>;
  loadArchivedThreads(): Promise<ThreadSummary[]>;
  loadSkills(): Promise<SkillDefinition[]>;
  openThread(threadId: string): Promise<ThreadDetail>;
  clearLastOpenedThreadPreference(): Promise<Preferences>;
  applyAppearance(preferences: Preferences): void;
  applyOpenedThread(thread: ThreadDetail, options?: { preserveRoute?: boolean }): void;
  resolveComposerEffort(
    providerId: ProviderId,
    effort: Preferences['defaultReasoningEffortByProvider'][ProviderId]
  ): BootstrapComposerEffort;
  shouldShowStartupWelcome(payload: BootstrapData): boolean;
  isMissingThreadError(error: unknown): boolean;
  showToast(
    level: 'info' | 'warning' | 'error',
    message: string
  ): void;
  setLoading(value: boolean): void;
  setReady(value: boolean): void;
  setStartupThreadRestoreState(value: 'idle' | 'pending' | 'resolved' | 'failed'): void;
  setProjects(projects: Project[]): void;
  setSkills(value: SkillDefinition[] | ((current: SkillDefinition[]) => SkillDefinition[])): void;
  setProviders(providers: ProviderDescriptor[]): void;
  setPendingRunToolApprovals(approvals: RunToolApprovalRequest[]): void;
  setToolApprovalResolvingId(value: string | null | ((current: string | null) => string | null)): void;
  setPreferences(preferences: Preferences): void;
  setSelectedProjectId(projectId: string | null): void;
  setExpandedProjectIds(projectIds: string[] | ((current: string[]) => string[])): void;
  setThreadsByProject(threadsByProject: Record<string, ThreadSummary[]>): void;
  setRecentThreads(threads: ThreadSummary[]): void;
  setShowStartupWelcome(value: boolean): void;
  setCollaboration(payload: CollabBootstrap): void;
  setSelectedCollaborationRoomId(value: string | ((current: string) => string)): void;
  setSelectedCollaborationChatId(value: string | ((current: string) => string)): void;
  setSelectedCollaborationContactId(value: string | ((current: string) => string)): void;
  setComposerEffort(value: BootstrapComposerEffort): void;
  applyBootstrapComposerDefaults(input: BootstrapComposerDefaults): void;
  clearActiveThreadSelection(): void;
  setAppMeta(value: AppMeta | null): void;
  setAppUpdateState(value: AppUpdateState | null): void;
  setArchivedThreads(threads: ThreadSummary[]): void;
}

export function applyCollaborationBootstrapPayload(host: AppShellBootstrapHost, payload: CollabBootstrap) {
  const projectRooms = payload.rooms.filter((room) => room.type !== 'dm');
  const directChats = payload.rooms.filter((room) => room.type === 'dm');
  const currentSelection = host.getCollaborationSelection();

  host.setCollaboration(payload);
  host.setSelectedCollaborationRoomId(
    projectRooms.some((room) => room.id === currentSelection.roomId) ? currentSelection.roomId : projectRooms[0]?.id ?? ''
  );
  host.setSelectedCollaborationChatId(
    directChats.some((room) => room.id === currentSelection.chatId) ? currentSelection.chatId : directChats[0]?.id ?? ''
  );
  host.setSelectedCollaborationContactId(
    payload.contacts.some((contact) => contact.userId === currentSelection.contactId)
      ? currentSelection.contactId
      : payload.contacts[0]?.userId ?? ''
  );
}

export function applyBootstrapPayload(host: AppShellBootstrapHost, payload: BootstrapData) {
  const surfacedProviders = surfaceProviders(payload.providers);
  const projectId = payload.preferences.selectedProjectId ?? payload.projects[0]?.id ?? null;
  const defaultProviderId = resolveDefaultProviderId(surfacedProviders, payload.preferences.defaultProviderId);
  const defaultModelId = resolveProviderModelId(
    surfacedProviders,
    defaultProviderId,
    payload.preferences.defaultModelByProvider[defaultProviderId]
  );
  const defaultComposerEffort = host.resolveComposerEffort(
    defaultProviderId,
    payload.preferences.defaultReasoningEffortByProvider[defaultProviderId]
  );
  const currentExpandedProjectIds = host.getExpandedProjectIds();
  const toolApprovalResolvingId = host.getToolApprovalResolvingId();

  host.setProjects(payload.projects);
  host.setProviders(surfacedProviders);
  host.setPendingRunToolApprovals(payload.pendingRunToolApprovals);
  host.setToolApprovalResolvingId(
    toolApprovalResolvingId && payload.pendingRunToolApprovals.some((approval) => approval.id === toolApprovalResolvingId)
      ? toolApprovalResolvingId
      : null
  );
  host.setPreferences(payload.preferences);
  host.setSelectedProjectId(projectId);
  host.setExpandedProjectIds(() => {
    const availableProjectIds = new Set(payload.projects.map((project) => project.id));
    const nextExpandedProjectIds = currentExpandedProjectIds.filter((id) => availableProjectIds.has(id));
    if (projectId && !nextExpandedProjectIds.includes(projectId)) {
      nextExpandedProjectIds.push(projectId);
    }
    return nextExpandedProjectIds;
  });
  host.setThreadsByProject(payload.threadsByProject);
  host.setRecentThreads(deriveRecentThreads(payload.threadsByProject));
  host.setShowStartupWelcome(host.shouldShowStartupWelcome(payload));
  host.setComposerEffort(defaultComposerEffort);
  host.applyBootstrapComposerDefaults({
    providerId: defaultProviderId,
    modelId: defaultModelId,
    thinkingEnabled: resolveProviderThinkingDefault(defaultProviderId),
    executionPermission: payload.preferences.defaultExecutionPermission
  });
  host.clearActiveThreadSelection();
}

export async function bootstrapAppShell(host: AppShellBootstrapHost) {
  host.setLoading(true);
  try {
    const payload = await host.loadBootstrap();
    host.applyAppearance(payload.preferences);
    applyBootstrapPayload(host, payload);
    host.setReady(true);
    host.setLoading(false);

    void host.loadAppMeta()
      .then((value) => {
        host.setAppMeta(value);
      })
      .catch(() => {
        host.setAppMeta(null);
        host.showToast('warning', 'App metadata is unavailable from the current main-process build.');
      });

    void host.loadUpdateState()
      .then((value) => {
        host.setAppUpdateState(value);
      })
      .catch(() => {
        host.setAppUpdateState(null);
      });

    void host.loadArchivedThreads()
      .then((archived) => {
        host.setArchivedThreads(archived);
      })
      .catch(() => {});

    void host.loadSkills()
      .then((nextSkills) => {
        host.setSkills(nextSkills);
      })
      .catch(() => {});

    if (payload.preferences.lastOpenedThreadId) {
      host.setStartupThreadRestoreState('pending');
      try {
        const detail = await host.openThread(payload.preferences.lastOpenedThreadId);
        host.applyOpenedThread(detail, { preserveRoute: true });
        host.setStartupThreadRestoreState('resolved');
      } catch (error) {
        if (host.isMissingThreadError(error)) {
          host.setPreferences(await host.clearLastOpenedThreadPreference());
        }
        host.setStartupThreadRestoreState('failed');
        host.setShowStartupWelcome(host.shouldShowStartupWelcome(payload));
      }
    } else {
      host.setStartupThreadRestoreState('resolved');
    }
  } catch (error) {
    host.setStartupThreadRestoreState('failed');
    host.setLoading(false);
    host.showToast('error', error instanceof Error ? error.message : 'Failed to bootstrap the app.');
  }
}
