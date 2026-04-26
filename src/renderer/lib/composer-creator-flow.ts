import type {
  ExecutionPermission,
  Preferences,
  Project,
  ProviderId,
  SkillDefinition,
  ThreadDetail,
  ThreadSummary
} from '../../shared/domain';
import { buildPluginCreatorPrompt, buildSkillCreatorPrompt } from '../../shared/creatorImports';
import { upsertRecentThread } from './thread-presentation';

type ToastLevel = 'info' | 'warning' | 'error';

type CreatorKind = 'skill' | 'plugin';

export interface ComposerCreatorFlowHost {
  getWorkspaceProject(): Project | null;
  getSelectedProjectId(): string | null;
  getComposerState(): {
    providerId: ProviderId;
    modelId: string;
    executionPermission: ExecutionPermission;
  };
  listSkills(): Promise<SkillDefinition[]>;
  listThreads(projectId: string): Promise<ThreadSummary[]>;
  createThread(input: {
    projectId: string;
    title: string;
    providerId: ProviderId;
    modelId: string;
    executionPermission: ExecutionPermission;
  }): Promise<ThreadDetail>;
  saveDraft(threadId: string, prompt: string): Promise<void>;
  savePreferences(input: Partial<Preferences>): Promise<Preferences>;
  applyOpenedThread(detail: ThreadDetail): void;
  showToast(level: ToastLevel, message: string): void;
  focusComposer(): void;
  setSkills(value: SkillDefinition[]): void;
  setThreadsByProject(
    value:
      | Record<string, ThreadSummary[]>
      | ((current: Record<string, ThreadSummary[]>) => Record<string, ThreadSummary[]>)
  ): void;
  setRecentThreads(value: ThreadSummary[] | ((current: ThreadSummary[]) => ThreadSummary[])): void;
  setSelectedProjectId(value: string | null): void;
  setPreferences(value: Preferences): void;
  setExpandedProjectIds(value: string[] | ((current: string[]) => string[])): void;
  setShowStartupWelcome(value: boolean): void;
  setEditingFollowUpId(value: string | null): void;
  setPendingNativeCommandId(value: null): void;
  setAttachedSkillIds(value: string[]): void;
  prepareComposerForCreator(prompt: string): void;
  setRoute(route: 'thread'): void;
}

function resolveCreatorSkillId(
  availableSkills: SkillDefinition[],
  kind: CreatorKind
) {
  const slug = kind === 'skill' ? 'skill-creator' : 'plugin-creator';
  const fallbackId = kind === 'skill' ? 'built-in-skill-creator' : 'built-in-plugin-creator';
  return availableSkills.find((skill) => skill.id === fallbackId || skill.metadata.slug === slug)?.id ?? null;
}

export async function openCreatorInComposer(
  host: ComposerCreatorFlowHost,
  kind: CreatorKind
) {
  const targetProject = host.getWorkspaceProject();
  if (!targetProject) {
    host.showToast('warning', 'Select a project first.');
    return;
  }

  const nextSkills = await host.listSkills();
  host.setSkills(nextSkills);

  const creatorSkillId = resolveCreatorSkillId(nextSkills, kind);
  if (!creatorSkillId) {
    host.showToast(
      'warning',
      `${kind === 'skill' ? 'Skill' : 'Plugin'} creator is unavailable. Restart Vicode once if this app was already open before the update.`
    );
    return;
  }

  const prompt =
    kind === 'skill'
      ? buildSkillCreatorPrompt()
      : buildPluginCreatorPrompt();

  if (host.getSelectedProjectId() !== targetProject.id) {
    host.setSelectedProjectId(targetProject.id);
    host.setPreferences(await host.savePreferences({ selectedProjectId: targetProject.id }));
  }

  host.setExpandedProjectIds((current) =>
    current.includes(targetProject.id) ? current : [...current, targetProject.id]
  );

  const composer = host.getComposerState();
  const createdThread = await host.createThread({
    projectId: targetProject.id,
    title: kind === 'skill' ? 'Create skill' : 'Create plugin',
    providerId: composer.providerId,
    modelId: composer.modelId,
    executionPermission: composer.executionPermission
  });
  await host.saveDraft(createdThread.id, prompt);
  const nextThreads = await host.listThreads(targetProject.id);
  host.setThreadsByProject((current) => ({ ...current, [targetProject.id]: nextThreads }));
  host.setRecentThreads((current) => upsertRecentThread(current, createdThread));
  host.applyOpenedThread(createdThread);

  host.setShowStartupWelcome(false);
  host.setEditingFollowUpId(null);
  host.setPendingNativeCommandId(null);
  host.setAttachedSkillIds([creatorSkillId]);
  host.prepareComposerForCreator(prompt);
  host.setRoute('thread');
  host.showToast(
    'info',
    kind === 'skill'
      ? 'Opened a new thread with the skill creator ready.'
      : 'Opened a new thread with the plugin creator ready.'
  );
  host.focusComposer();
}
