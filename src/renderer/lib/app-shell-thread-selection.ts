import type { Preferences, ThreadDetail, ThreadSummary } from '../../shared/domain';

type ToastLevel = 'info' | 'warning' | 'error';

type ComposerStateLike = {
  imageAttachments: unknown[];
  textAttachments: unknown[];
};

export interface AppShellThreadSelectionHost {
  findParentThreadId(threadId: string): string | null;
  openThread(threadId: string): Promise<ThreadDetail>;
  listProjectThreads(projectId: string): Promise<ThreadSummary[]>;
  listArchivedThreads(projectId?: string | null): Promise<ThreadSummary[]>;
  savePreferences(input: Partial<Preferences>): Promise<Preferences>;
  getSelectedProjectId(): string | null;
  getPreferences(): Preferences | null;
  isMissingThreadError(error: unknown): boolean;
  applyOpenedThread(detail: ThreadDetail): void;
  showToast(level: ToastLevel, message: string): void;
  setPreferences(value: Preferences): void;
  setSelectedProjectId(value: string | null): void;
  setSelectedProjectIdRef(value: string | null): void;
  setExpandedProjectIds(value: string[] | ((current: string[]) => string[])): void;
  setThreadsByProject(
    value:
      | Record<string, ThreadSummary[]>
      | ((current: Record<string, ThreadSummary[]>) => Record<string, ThreadSummary[]>)
  ): void;
  setArchivedThreads(value: ThreadSummary[]): void;
  setShowStartupWelcome(value: boolean): void;
  setActiveThread(value: ThreadDetail | null): void;
  setActiveThreadIdRef(value: string | null): void;
  setActiveRunId(value: string | null): void;
  setComposer(
    value: ComposerStateLike | ((current: ComposerStateLike) => ComposerStateLike)
  ): void;
  setRoute(value: 'thread'): void;
}

export async function refreshThreads(host: AppShellThreadSelectionHost, projectId: string | null) {
  if (!projectId) {
    return;
  }
  const nextThreads = await host.listProjectThreads(projectId);
  host.setThreadsByProject((current) => ({ ...current, [projectId]: nextThreads }));
}

export async function refreshArchivedThreads(
  host: AppShellThreadSelectionHost,
  projectId: string | null = null
) {
  host.setArchivedThreads(await host.listArchivedThreads(projectId));
}

export function selectRestorableProjectThread(
  threads: readonly Pick<ThreadSummary, 'id'>[],
  preferredThreadId: string | null | undefined
) {
  if (preferredThreadId && threads.some((thread) => thread.id === preferredThreadId)) {
    return preferredThreadId;
  }

  return threads[0]?.id ?? null;
}

export async function openThreadInShell(host: AppShellThreadSelectionHost, threadId: string) {
  try {
    const targetThreadId = host.findParentThreadId(threadId) ?? threadId;
    const detail = await host.openThread(targetThreadId);
    if (detail.projectId !== host.getSelectedProjectId()) {
      host.setSelectedProjectId(detail.projectId);
      host.setExpandedProjectIds((current) =>
        current.includes(detail.projectId) ? current : [...current, detail.projectId]
      );
      const nextThreads = await host.listProjectThreads(detail.projectId);
      host.setThreadsByProject((current) => ({ ...current, [detail.projectId]: nextThreads }));
      host.setPreferences(
        await host.savePreferences({ selectedProjectId: detail.projectId, lastOpenedThreadId: detail.id })
      );
    } else {
      host.setPreferences(await host.savePreferences({ lastOpenedThreadId: detail.id }));
    }
    host.applyOpenedThread(detail);
  } catch (error) {
    if (host.isMissingThreadError(error) && host.getPreferences()?.lastOpenedThreadId === threadId) {
      host.setPreferences(await host.savePreferences({ lastOpenedThreadId: null }));
    }
    host.showToast('error', error instanceof Error ? error.message : 'Failed to open thread.');
  }
}

export async function selectProjectInShell(
  host: AppShellThreadSelectionHost,
  projectId: string,
  options?: { preserveMainView?: boolean }
) {
  host.setSelectedProjectIdRef(projectId);
  host.setSelectedProjectId(projectId);
  host.setPreferences(await host.savePreferences({ selectedProjectId: projectId }));
  const nextThreads = await host.listProjectThreads(projectId);
  host.setThreadsByProject((current) => ({ ...current, [projectId]: nextThreads }));
  if (!options?.preserveMainView) {
    host.setActiveThreadIdRef(null);
    host.setShowStartupWelcome(false);
    host.setActiveThread(null);
    host.setActiveRunId(null);
    host.setComposer((current) => ({ ...current, imageAttachments: [], textAttachments: [] }));
    host.setRoute('thread');
  }
}

export async function toggleProjectThreadsInShell(
  host: AppShellThreadSelectionHost,
  projectId: string,
  expandedProjectIds: string[]
) {
  if (expandedProjectIds.includes(projectId)) {
    host.setExpandedProjectIds((current) => current.filter((id) => id !== projectId));
    return;
  }

  host.setExpandedProjectIds((current) => (current.includes(projectId) ? current : [...current, projectId]));
  try {
    await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
    await selectProjectInShell(host, projectId, { preserveMainView: true });
  } catch (error) {
    host.setExpandedProjectIds((current) => current.filter((id) => id !== projectId));
    host.showToast(
      'error',
      error instanceof Error ? error.message : 'Could not open project threads.'
    );
  }
}
