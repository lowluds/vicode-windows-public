import type {
  ComposerMode,
  ExecutionPermission,
  Preferences,
  Project,
  ProviderId,
  ThreadDetail,
  ThreadSummary
} from '../../shared/domain';
import { upsertRecentThread } from './thread-presentation';
import { folderLabel } from './folder-label';

type ToastLevel = 'info' | 'warning' | 'error';

type ProjectDraftLike = {
  name: string;
  folderPath: string;
  trusted: boolean;
};

type WorkspaceBootstrapStatusLike = unknown;

export interface AppShellProjectActionsHost {
  getProjects(): Project[];
  getSelectedProjectId(): string | null;
  getActiveThread(): ThreadDetail | null;
  getRoute(): 'thread' | string;
  getComposerState(): {
    providerId: ProviderId;
    modelId: string;
    executionPermission: ExecutionPermission;
    mode: ComposerMode;
  };
  getProjectDraft(): ProjectDraftLike;
  getWorkspaceProject(): Project | null;
  pickFolder(): Promise<string | null>;
  createProject(input: { name: string; folderPath: string | null; trusted: boolean }): Promise<Project>;
  updateProject(input: { id: string; name?: string; folderPath?: string; trusted?: boolean }): Promise<Project>;
  removeProject(projectId: string): Promise<void>;
  createThread(input: {
    projectId: string;
    title: string;
    providerId: ProviderId;
    modelId: string;
    executionPermission: ExecutionPermission;
  }): Promise<ThreadDetail>;
  setPlannerMode(input: { threadId: string; mode: 'plan' }): Promise<ThreadDetail>;
  archiveThread(threadId: string): Promise<void>;
  getWorkspaceBootstrapStatus(projectId: string): Promise<WorkspaceBootstrapStatusLike>;
  savePreferences(input: Partial<Preferences>): Promise<Preferences>;
  refreshThreads(projectId: string | null): Promise<void>;
  refreshArchivedThreads(projectId?: string | null): Promise<void>;
  refreshStorageDiagnosticsIfVisible(): Promise<void>;
  selectProject(projectId: string, options?: { preserveMainView?: boolean }): Promise<void>;
  applyOpenedThread(detail: ThreadDetail): void;
  showToast(level: ToastLevel, message: string): void;
  setProjects(value: Project[] | ((current: Project[]) => Project[])): void;
  setThreadsByProject(
    value:
      | Record<string, ThreadSummary[]>
      | ((current: Record<string, ThreadSummary[]>) => Record<string, ThreadSummary[]>)
  ): void;
  listProjectThreads(projectId: string): Promise<ThreadSummary[]>;
  setRecentThreads(value: ThreadSummary[] | ((current: ThreadSummary[]) => ThreadSummary[])): void;
  setShowStartupWelcome(value: boolean): void;
  setMissingWorkspaceProjectId(value: string | null | ((current: string | null) => string | null)): void;
  setExpandedProjectIds(value: string[] | ((current: string[]) => string[])): void;
  setProjectDraft(value: ProjectDraftLike): void;
  setWorkspaceBootstrapStatus(value: WorkspaceBootstrapStatusLike | null): void;
  setRemovingProjectId(value: string | null | ((current: string | null) => string | null)): void;
  setArchivedThreads(value: ThreadSummary[] | ((current: ThreadSummary[]) => ThreadSummary[])): void;
  setPreferences(value: Preferences | null | ((current: Preferences | null) => Preferences | null)): void;
  setSelectedProjectId(value: string | null): void;
  setActiveThread(value: ThreadDetail | null): void;
  setActiveRunId(value: string | null): void;
  setAttachedSkillIds(value: string[]): void;
  setWorkspaceBootstrapModalOpen(value: boolean): void;
  setWorkspaceBootstrapDraftBundle(value: unknown | null): void;
  setWorkspaceBootstrapSelectedDraftPaths(value: string[]): void;
  setWorkspaceBootstrapActiveDraftPath(value: string | null): void;
}

function insertProjectLocally(host: AppShellProjectActionsHost, project: Project) {
  host.setProjects((current) => [project, ...current.filter((item) => item.id !== project.id)]);
  host.setThreadsByProject((current) => (current[project.id] ? current : { ...current, [project.id]: [] }));
}

export async function openProjectFromPicker(host: AppShellProjectActionsHost) {
  const folderPath = await host.pickFolder();
  if (!folderPath) {
    return;
  }

  const existingProject = host.getProjects().find((project) => project.folderPath === folderPath);
  if (existingProject) {
    if (!host.getActiveThread() && host.getRoute() === 'thread') {
      await createThreadForProject(host, existingProject.id);
    } else {
      await host.selectProject(existingProject.id);
    }
    host.setMissingWorkspaceProjectId((current) => (current === existingProject.id ? null : current));
    host.showToast('info', `Opened ${existingProject.name}.`);
    return;
  }

  const project = await host.createProject({
    name: folderLabel(folderPath),
    folderPath,
    trusted: false
  });
  insertProjectLocally(host, project);
  if (!host.getActiveThread() && host.getRoute() === 'thread') {
    await createThreadForProject(host, project.id);
  } else {
    await host.selectProject(project.id);
    host.setExpandedProjectIds((current) => (current.includes(project.id) ? current : [...current, project.id]));
  }
  host.setMissingWorkspaceProjectId((current) => (current === project.id ? null : current));
  host.showToast('info', `Opened ${project.name}.`);
}

export async function repairWorkspaceProjectPath(host: AppShellProjectActionsHost, project: Project | null) {
  if (!project) {
    await openProjectFromPicker(host);
    return;
  }

  const folderPath = await host.pickFolder();
  if (!folderPath) {
    return;
  }

  const updatedProject = await host.updateProject({
    id: project.id,
    folderPath
  });

  host.setProjects((current) => current.map((item) => (item.id === updatedProject.id ? updatedProject : item)));
  host.setMissingWorkspaceProjectId((current) => (current === updatedProject.id ? null : current));

  if (host.getSelectedProjectId() === updatedProject.id) {
    try {
      const status = await host.getWorkspaceBootstrapStatus(updatedProject.id);
      host.setWorkspaceBootstrapStatus(status);
    } catch {
      host.setWorkspaceBootstrapStatus(null);
    }
  }

  host.showToast('info', `Repaired workspace path for ${updatedProject.name}.`);
}

export async function createProject(host: AppShellProjectActionsHost) {
  const projectDraft = host.getProjectDraft();
  if (!projectDraft.name.trim()) {
    host.showToast('warning', 'Project name is required.');
    return;
  }
  const project = await host.createProject({
    name: projectDraft.name,
    folderPath: projectDraft.folderPath || null,
    trusted: projectDraft.trusted
  });
  insertProjectLocally(host, project);
  await host.selectProject(project.id);
  host.setProjectDraft({ name: '', folderPath: '', trusted: false });
}

export async function trustWorkspaceProject(host: AppShellProjectActionsHost, trusted: boolean) {
  const workspaceProject = host.getWorkspaceProject();
  if (!workspaceProject) {
    return;
  }
  const project = await host.updateProject({
    id: workspaceProject.id,
    trusted
  });
  host.setProjects((current) => current.map((item) => (item.id === project.id ? project : item)));
  if (workspaceProject.id === project.id) {
    try {
      const status = await host.getWorkspaceBootstrapStatus(project.id);
      host.setWorkspaceBootstrapStatus(status);
    } catch {
      host.setWorkspaceBootstrapStatus(null);
    }
  }
}

export async function setProjectTrust(host: AppShellProjectActionsHost, projectId: string, trusted: boolean) {
  const project = await host.updateProject({
    id: projectId,
    trusted
  });
  host.setProjects((current) => current.map((item) => (item.id === project.id ? project : item)));
  if (host.getSelectedProjectId() === project.id) {
    try {
      const status = await host.getWorkspaceBootstrapStatus(project.id);
      host.setWorkspaceBootstrapStatus(status);
    } catch {
      host.setWorkspaceBootstrapStatus(null);
    }
  }
  host.showToast('info', trusted ? `${project.name} is now trusted.` : `${project.name} is now untrusted.`);
}

export async function createThread(host: AppShellProjectActionsHost) {
  const selectedProjectId = host.getSelectedProjectId();
  if (!selectedProjectId) {
    host.showToast('warning', 'Create a project first.');
    return;
  }
  const composer = host.getComposerState();
  const createdThread = await host.createThread({
    projectId: selectedProjectId,
    title: 'New thread',
    providerId: composer.providerId,
    modelId: composer.modelId,
    executionPermission: composer.executionPermission
  });
  const thread =
    composer.mode === 'plan'
      ? await host.setPlannerMode({ threadId: createdThread.id, mode: 'plan' })
      : createdThread;
  await host.refreshThreads(selectedProjectId);
  host.setRecentThreads((current) => upsertRecentThread(current, thread));
  host.setShowStartupWelcome(false);
  host.applyOpenedThread(thread);
  host.setActiveRunId(null);
}

export async function createThreadForProject(host: AppShellProjectActionsHost, projectId: string) {
  if (!projectId) {
    return;
  }

  const composer = host.getComposerState();
  if (host.getSelectedProjectId() !== projectId) {
    host.setSelectedProjectId(projectId);
    host.setPreferences(await host.savePreferences({ selectedProjectId: projectId }));
  }

  host.setExpandedProjectIds((current) => (current.includes(projectId) ? current : [...current, projectId]));
  const createdThread = await host.createThread({
    projectId,
    title: 'New thread',
    providerId: composer.providerId,
    modelId: composer.modelId,
    executionPermission: composer.executionPermission
  });
  const thread =
    composer.mode === 'plan'
      ? await host.setPlannerMode({ threadId: createdThread.id, mode: 'plan' })
      : createdThread;
  const nextThreads = await host.listProjectThreads(projectId);
  host.setThreadsByProject((current) => ({ ...current, [projectId]: nextThreads }));
  host.setRecentThreads((current) => upsertRecentThread(current, thread));
  host.setShowStartupWelcome(false);
  host.applyOpenedThread(thread);
  host.setActiveRunId(null);
}

export async function renameProject(host: AppShellProjectActionsHost, projectId: string) {
  const project = host.getProjects().find((item) => item.id === projectId);
  if (!project) {
    return;
  }
  const name = window.prompt('Edit project name', project.name)?.trim();
  if (!name || name === project.name) {
    return;
  }
  await host.updateProject({ id: projectId, name });
}

export async function archiveProjectThreads(host: AppShellProjectActionsHost, projectId: string) {
  const project = host.getProjects().find((item) => item.id === projectId);
  if (!project) {
    return;
  }

  const projectThreads = await host.listProjectThreads(projectId);
  if (projectThreads.length === 0) {
    host.showToast('info', `No active chats to archive in "${project.name}".`);
    return;
  }

  const archivedThreadIds = new Set(projectThreads.map((thread) => thread.id));

  try {
    await Promise.all(projectThreads.map((thread) => host.archiveThread(thread.id)));
    host.setRecentThreads((current) => current.filter((item) => !archivedThreadIds.has(item.id)));
    if (host.getActiveThread()?.id && archivedThreadIds.has(host.getActiveThread()!.id)) {
      host.setActiveThreadIdRef(null);
      host.setActiveRunId(null);
      host.setActiveThread(null);
    }
    await host.refreshThreads(projectId);
    await host.refreshArchivedThreads();
    await host.refreshStorageDiagnosticsIfVisible();
    host.showToast(
      'info',
      projectThreads.length === 1
        ? `Archived 1 chat in "${project.name}".`
        : `Archived ${projectThreads.length} chats in "${project.name}".`
    );
  } catch (error) {
    host.showToast(
      'error',
      error instanceof Error ? error.message : 'Failed to archive the project chats.'
    );
  }
}

export async function removeProject(host: AppShellProjectActionsHost, projectId: string) {
  const project = host.getProjects().find((item) => item.id === projectId);
  if (!project) {
    return;
  }

  const remainingProjects = host.getProjects().filter((item) => item.id !== projectId);
  const nextSelectedProjectId =
    host.getSelectedProjectId() === projectId
      ? remainingProjects[0]?.id ?? null
      : host.getSelectedProjectId();
  const deletingSelectedProject = host.getSelectedProjectId() === projectId;
  const deletingActiveThreadProject = host.getActiveThread()?.projectId === projectId;

  host.setRemovingProjectId(projectId);

  try {
    await host.removeProject(projectId);

    host.setProjects(remainingProjects);
    host.setRecentThreads((current) => current.filter((item) => item.projectId !== projectId));
    host.setArchivedThreads((current) => current.filter((item) => item.projectId !== projectId));
    host.setPreferences((current) =>
      current
        ? {
            ...current,
            selectedProjectId: nextSelectedProjectId,
            lastOpenedThreadId: null
          }
        : current
    );
    host.setExpandedProjectIds((current) => current.filter((id) => id !== projectId));
    host.setThreadsByProject((current) => {
      const next = { ...current };
      delete next[projectId];
      return next;
    });

    if (deletingSelectedProject) {
      host.setSelectedProjectId(nextSelectedProjectId);
      host.setExpandedProjectIds((current) =>
        nextSelectedProjectId && !current.includes(nextSelectedProjectId) ? [...current, nextSelectedProjectId] : current
      );
    }

    if (deletingActiveThreadProject) {
      host.setActiveThread(null);
      host.setActiveRunId(null);
      host.setAttachedSkillIds([]);
      host.setWorkspaceBootstrapStatus(null);
      host.setWorkspaceBootstrapModalOpen(false);
      host.setWorkspaceBootstrapDraftBundle(null);
      host.setWorkspaceBootstrapSelectedDraftPaths([]);
      host.setWorkspaceBootstrapActiveDraftPath(null);
    }

    if (deletingSelectedProject && nextSelectedProjectId) {
      await host.refreshThreads(nextSelectedProjectId);
    }

    await host.refreshStorageDiagnosticsIfVisible();
  } finally {
    host.setRemovingProjectId((current) => (current === projectId ? null : current));
  }
}
