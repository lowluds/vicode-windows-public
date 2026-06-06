import { app, dialog, ipcMain, shell, systemPreferences } from 'electron';
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';
import type { BrowserWindow } from 'electron';
import type {
  LibrarySourceEntry,
  LibrarySourceSummary,
  Preferences,
  ProjectKnowledgeIndexStatus,
  ProjectKnowledgeSuggestedIndexDraft
} from '../shared/domain';
import type { MicrophoneAccessStatus } from '../shared/ipc';
import { createEmptyCollaborationBootstrap } from '../shared/collaboration-bootstrap';
import { COLLABORATION_ENABLED } from '../shared/product-flags';
import {
  archivedThreadsListSchema,
  automationIdSchema,
  automationSaveSchema,
  automationToggleSchema,
  collabConfigSaveSchema,
  collabCreateDirectChatSchema,
  collabCreateGuestProfileSchema,
  collabCreateHandoffSchema,
  collabCreateRoomSchema,
  collabJoinRoomSchema,
  collabRequestRoleSchema,
  collabResolveRoleRequestSchema,
  collabRoomIdSchema,
  collabSendMessageSchema,
  collabSetFollowingSchema,
  collabSetTerminalModeSchema,
  collabSetPresenceSchema,
  collabShareRunSchema,
  collabShareThreadSchema,
  collabUpdateProfileSchema,
  composerEnhancePromptSchema,
  composerTextAttachmentCreateSchema,
  composerTextAttachmentDeleteSchema,
  composerSubmitSchema,
  customProviderIdSchema,
  customProviderSettingsSaveSchema,
  plannerAnswerSchema,
  plannerApprovePlanSchema,
  plannerCancelSchema,
  plannerSetModeSchema,
  plannerSubmitSchema,
  duplicateThreadSchema,
  externalUrlSchema,
  appZoomActionSchema,
  filePathSchema,
  diagnosticsCompactionSchema,
  diagnosticsMaintenanceSchema,
  preferenceSaveSchema,
  projectCreateSchema,
  projectIdSchema,
  projectIdValueSchema,
  projectUpdateSchema,
  providerAuthAdoptSchema,
  providerApiKeySchema,
  providerAuthStartSchema,
  providerIdSchema,
  ollamaModelMutationSchema,
  renameThreadSchema,
  reviewDraftUpdateSchema,
  runToolApprovalIdSchema,
  runStopSchema,
  stagedWorkspaceHunkApplySchema,
  stagedWorkspaceHunkRejectSchema,
  stagedWorkspaceReviewSchema,
  worktreeHunkApplySchema,
  worktreeHunkRejectSchema,
  worktreeReviewSchema,
  reviewItemIdSchema,
  skillIdSchema,
  skillSaveSchema,
  skillSuggestedInstallSchema,
  skillToggleSchema,
  voiceTranscriptionSchema,
  threadDraftSaveSchema,
  threadFollowUpCreateSchema,
  threadFollowUpIdSchema,
  threadFollowUpUpdateSchema,
  threadCreateSchema,
  threadExecutionPermissionSchema,
  mcpServerIdSchema,
  mcpRecommendedSetupSchema,
  mcpServerEnabledSchema,
  mcpServerSaveSchema,
  subagentIdSchema,
  subagentListSchema,
  subagentSpawnSchema,
  threadIdSchema
} from '../shared/schemas';
import type { AppEvent } from '../shared/events';
import { DatabaseService } from '../storage/database';
import { AutomationScheduler } from './services/automation-scheduler';
import { AppUpdaterService } from './services/app-updater';
import { DiagnosticsService } from './services/diagnostics';
import { JobsService } from './services/jobs';
import { LibraryWatchService } from './services/library-watch-service';
import { OllamaRuntimeService } from './services/ollama-runtime';
import { ProviderManager } from './services/provider-manager';
import { SkillCatalogService } from './services/skills';
import { CollaborationService } from './services/collab';
import { ComposerTextAttachmentService } from './services/composer-text-attachments';
import { AutonomousTaskService } from './services/autonomous-tasks';
import { McpRegistryService } from './services/mcp/registry';
import { VoiceService } from './services/voice';
import { SubagentOrchestratorService } from './services/subagents';
import { ProjectKnowledgeIndexService } from './services/project-knowledge-index';
import { isProjectKnowledgeIndexFresh } from './services/project-knowledge';
import { createProjectKnowledgeSuggestedIndexDraft } from './services/project-knowledge-suggested-index';

interface Services {
  db: DatabaseService;
  updater: AppUpdaterService;
  providers: ProviderManager;
  ollamaRuntime: OllamaRuntimeService;
  skills: SkillCatalogService;
  libraryWatch?: LibraryWatchService;
  automations: AutomationScheduler;
  diagnostics: DiagnosticsService;
  mcp: McpRegistryService;
  jobs: JobsService;
  autonomousTasks?: AutonomousTaskService;
  subagents?: SubagentOrchestratorService;
  voice: VoiceService;
  collab?: CollaborationService;
  composerTextAttachments: ComposerTextAttachmentService;
}

const DEFAULT_WINDOWS_ACCENT = '#3f3f3f';
const APP_ZOOM_STEP = 0.1;
const APP_ZOOM_MIN = 0.75;
const APP_ZOOM_MAX = 1.6;
const LIBRARY_ENTRY_LIMIT = 48;
const PROJECT_KNOWLEDGE_DIAGNOSTIC_PREVIEW_LIMIT = 5;

function clampAppZoomFactor(value: number) {
  const bounded = Math.min(APP_ZOOM_MAX, Math.max(APP_ZOOM_MIN, value));
  return Math.round(bounded * 100) / 100;
}

function isReadableDirectory(path: string | null): path is string {
  if (!path) {
    return false;
  }
  try {
    return existsSync(path) && statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function sourceSummary(
  kind: LibrarySourceSummary['kind'],
  label: string,
  path: string | null,
  entries: LibrarySourceEntry[],
  emptyMessage: string
): LibrarySourceSummary {
  if (!path) {
    return {
      kind,
      label,
      path: null,
      status: 'not_configured',
      message: `${label} is not configured.`,
      entries: []
    };
  }

  if (!isReadableDirectory(path)) {
    return {
      kind,
      label,
      path,
      status: 'missing',
      message: `${label} folder is unavailable.`,
      entries: []
    };
  }

  return {
    kind,
    label,
    path,
    status: entries.length > 0 ? 'ready' : 'empty',
    message: entries.length > 0 ? `${entries.length} item${entries.length === 1 ? '' : 's'} found.` : emptyMessage,
    entries
  };
}

function listTopLevelFolders(path: string | null): LibrarySourceEntry[] {
  if (!isReadableDirectory(path)) {
    return [];
  }

  return readdirSync(path, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .slice(0, LIBRARY_ENTRY_LIMIT)
    .map((entry) => ({
      id: `folder:${entry.name}`,
      name: entry.name,
      kind: 'folder',
      path: join(path, entry.name)
    }));
}

function listSkillBundles(path: string | null): LibrarySourceEntry[] {
  if (!isReadableDirectory(path)) {
    return [];
  }

  return readdirSync(path, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(path, entry.name, 'SKILL.md')))
    .slice(0, LIBRARY_ENTRY_LIMIT)
    .map((entry) => ({
      id: `skill:${entry.name}`,
      name: entry.name,
      kind: 'skill',
      path: join(path, entry.name, 'SKILL.md')
    }));
}

function listWikiEntries(path: string | null): LibrarySourceEntry[] {
  if (!isReadableDirectory(path)) {
    return [];
  }

  return readdirSync(path, { withFileTypes: true })
    .filter((entry) => {
      if (entry.name.startsWith('.') || entry.name.toLowerCase() === 'tmp') {
        return false;
      }
      return entry.isDirectory() || extname(entry.name).toLowerCase() === '.md';
    })
    .slice(0, LIBRARY_ENTRY_LIMIT)
    .map((entry) => ({
      id: `${entry.isDirectory() ? 'wiki-folder' : 'wiki'}:${entry.name}`,
      name: entry.isDirectory() ? entry.name : basename(entry.name, extname(entry.name)),
      kind: entry.isDirectory() ? 'folder' : 'wiki',
      path: join(path, entry.name)
    }));
}

function buildLibrarySourcesSnapshot(preferences: Preferences) {
  const userLibraryPath = preferences.userLibraryPath ? resolve(preferences.userLibraryPath) : null;
  const skillsLibraryPath = preferences.skillsLibraryPath ? resolve(preferences.skillsLibraryPath) : null;
  const llmWikiLibraryPath = preferences.llmWikiLibraryPath ? resolve(preferences.llmWikiLibraryPath) : null;

  return {
    userLibrary: sourceSummary(
      'user_library',
      'User Library',
      userLibraryPath,
      listTopLevelFolders(userLibraryPath),
      'No folders found in the user library.'
    ),
    skills: sourceSummary(
      'skills',
      'Skills Folder',
      skillsLibraryPath,
      listSkillBundles(skillsLibraryPath),
      'No SKILL.md bundles found.'
    ),
    llmWiki: sourceSummary(
      'llm_wiki',
      'Project Knowledge Folder',
      llmWikiLibraryPath,
      listWikiEntries(llmWikiLibraryPath),
      'No markdown files or knowledge folders found.'
    )
  };
}

function projectKnowledgeIndexMessage(snapshot: {
  indexedFileCount: number;
  sectionCount: number;
  diagnosticCount: number;
  warningCount: number;
}) {
  const indexed = `${snapshot.indexedFileCount} indexed file${snapshot.indexedFileCount === 1 ? '' : 's'}`;
  const sections = `${snapshot.sectionCount} section${snapshot.sectionCount === 1 ? '' : 's'}`;
  if (snapshot.diagnosticCount === 0) {
    return `${indexed}, ${sections}. No diagnostics.`;
  }
  const diagnostics = `${snapshot.diagnosticCount} diagnostic${snapshot.diagnosticCount === 1 ? '' : 's'}`;
  const warnings = snapshot.warningCount > 0
    ? `, ${snapshot.warningCount} warning${snapshot.warningCount === 1 ? '' : 's'}`
    : '';
  return `${indexed}, ${sections}. ${diagnostics}${warnings}.`;
}

function projectKnowledgeDiagnosticRank(severity: string) {
  switch (severity) {
    case 'error':
      return 0;
    case 'warning':
      return 1;
    default:
      return 2;
  }
}

function buildProjectKnowledgeIndexStatus(
  db: DatabaseService,
  preferences: Preferences = db.getPreferences()
): ProjectKnowledgeIndexStatus {
  const rootPath = preferences.llmWikiLibraryPath ? resolve(preferences.llmWikiLibraryPath) : null;
  if (!rootPath) {
    return {
      status: 'not_configured',
      path: null,
      indexedFileCount: 0,
      sectionCount: 0,
      diagnosticCount: 0,
      warningCount: 0,
      diagnostics: [],
      lastRefreshedAt: null,
      lastError: null,
      message: 'Project Knowledge index is not configured.'
    };
  }

  if (!isReadableDirectory(rootPath)) {
    return {
      status: 'missing',
      path: rootPath,
      indexedFileCount: 0,
      sectionCount: 0,
      diagnosticCount: 0,
      warningCount: 0,
      diagnostics: [],
      lastRefreshedAt: null,
      lastError: null,
      message: 'Project Knowledge folder is unavailable.'
    };
  }

  const snapshot = db.getProjectKnowledgeIndexSnapshotByRootPath(rootPath);
  if (!snapshot) {
    return {
      status: 'not_indexed',
      path: rootPath,
      indexedFileCount: 0,
      sectionCount: 0,
      diagnosticCount: 0,
      warningCount: 0,
      diagnostics: [],
      lastRefreshedAt: null,
      lastError: null,
      message: 'Project Knowledge index has not been refreshed yet.'
    };
  }

  const diagnostics = [...snapshot.diagnostics]
    .sort((first, second) =>
      projectKnowledgeDiagnosticRank(first.severity) - projectKnowledgeDiagnosticRank(second.severity)
      || (first.relativePath ?? '').localeCompare(second.relativePath ?? '')
      || first.code.localeCompare(second.code)
    )
    .slice(0, PROJECT_KNOWLEDGE_DIAGNOSTIC_PREVIEW_LIMIT)
    .map((diagnostic) => ({
      severity: diagnostic.severity,
      code: diagnostic.code,
      relativePath: diagnostic.relativePath,
      message: diagnostic.message,
      suggestedAction: diagnostic.suggestedAction
    }));

  const indexFresh = isProjectKnowledgeIndexFresh(rootPath, snapshot);
  const status: ProjectKnowledgeIndexStatus = {
    status: snapshot.root.lastError ? 'failed' : indexFresh ? 'ready' : 'stale',
    path: rootPath,
    indexedFileCount: snapshot.root.fileCount,
    sectionCount: snapshot.root.sectionCount,
    diagnosticCount: snapshot.root.diagnosticCount,
    warningCount: snapshot.root.warningCount,
    diagnostics,
    lastRefreshedAt: snapshot.root.lastRefreshedAt,
    lastError: snapshot.root.lastError,
    message: ''
  };
  status.message = status.lastError
    ?? (indexFresh
      ? projectKnowledgeIndexMessage(status)
      : 'Project Knowledge index needs refresh because the folder changed.');
  return status;
}

function refreshProjectKnowledgeIndex(db: DatabaseService): ProjectKnowledgeIndexStatus {
  const preferences = db.getPreferences();
  const rootPath = preferences.llmWikiLibraryPath ? resolve(preferences.llmWikiLibraryPath) : null;
  if (!rootPath || !isReadableDirectory(rootPath)) {
    return buildProjectKnowledgeIndexStatus(db, preferences);
  }

  const service = new ProjectKnowledgeIndexService({
    isFts5Available: () => db.isProjectKnowledgeFts5Available(),
    replaceRootIndex: (input) => db.replaceProjectKnowledgeRootIndex(input)
  });
  service.refreshIndex({ rootPath });
  return buildProjectKnowledgeIndexStatus(db, preferences);
}

function suggestProjectKnowledgeIndex(db: DatabaseService) {
  const preferences = db.getPreferences();
  const rootPath = preferences.llmWikiLibraryPath ? resolve(preferences.llmWikiLibraryPath) : null;
  if (!rootPath) {
    throw new Error('Project Knowledge folder is not configured.');
  }
  if (!isReadableDirectory(rootPath)) {
    throw new Error('Project Knowledge folder is unavailable.');
  }

  let snapshot = db.getProjectKnowledgeIndexSnapshotByRootPath(rootPath);
  if (!snapshot) {
    refreshProjectKnowledgeIndex(db);
    snapshot = db.getProjectKnowledgeIndexSnapshotByRootPath(rootPath);
  }
  if (!snapshot) {
    throw new Error('Project Knowledge index is not available.');
  }

  return createProjectKnowledgeSuggestedIndexDraft(snapshot);
}

function suggestedIndexDraftFileName(draft: ProjectKnowledgeSuggestedIndexDraft) {
  const timestamp = draft.generatedAt.replace(/[^0-9A-Za-z-]/g, '-');
  return `Suggested-Project-Knowledge-INDEX-${timestamp}.md`;
}

async function openProjectKnowledgeSuggestedIndexDraft(db: DatabaseService) {
  const draft = suggestProjectKnowledgeIndex(db);
  const draftsRoot = join(app.getPath('userData'), 'state', 'project-knowledge-drafts');
  mkdirSync(draftsRoot, { recursive: true });

  const draftPath = join(draftsRoot, suggestedIndexDraftFileName(draft));
  writeFileSync(draftPath, `${draft.content.trimEnd()}\n`, 'utf8');

  const errorMessage = await shell.openPath(draftPath);
  if (errorMessage) {
    throw new Error(errorMessage);
  }

  return {
    targetRelativePath: draft.targetRelativePath,
    generatedAt: draft.generatedAt,
    sourceCount: draft.sourceCount,
    diagnosticCount: draft.diagnosticCount,
    path: draftPath
  };
}

function getMicrophoneAccessStatus(): MicrophoneAccessStatus {
  if (process.platform !== 'win32' && process.platform !== 'darwin') {
    return 'unknown';
  }

  try {
    return systemPreferences.getMediaAccessStatus('microphone');
  } catch {
    return 'unknown';
  }
}

function getSystemAccentColor() {
  if (process.platform !== 'win32') {
    return DEFAULT_WINDOWS_ACCENT;
  }

  try {
    const raw = systemPreferences.getAccentColor().trim();
    const normalized = raw.startsWith('#') ? raw.slice(1) : raw;
    const hex = normalized.length >= 6 ? normalized.slice(-6) : normalized;
    return /^([0-9a-fA-F]{6})$/u.test(hex) ? `#${hex.toLowerCase()}` : DEFAULT_WINDOWS_ACCENT;
  } catch {
    return DEFAULT_WINDOWS_ACCENT;
  }
}

export function registerIpc(
  mainWindowOrResolver: BrowserWindow | (() => BrowserWindow | null),
  services: Services
) {
  const getMainWindow =
    typeof mainWindowOrResolver === 'function'
      ? mainWindowOrResolver
      : () => mainWindowOrResolver;
  const sendEvent = (event: AppEvent) => {
    const currentWindow = getMainWindow();
    if (!currentWindow) {
      return;
    }
    const destroyed =
      typeof (currentWindow as BrowserWindow & { isDestroyed?: () => boolean }).isDestroyed === 'function'
        ? (currentWindow as BrowserWindow & { isDestroyed: () => boolean }).isDestroyed()
        : false;
    if (destroyed) {
      return;
    }
    currentWindow.webContents.send('vicode:event', event);
  };
  const unsubscribeProviders = services.providers.onEvent(sendEvent);
  const unsubscribeMcp = services.mcp.onEvent(sendEvent);
  const unsubscribeJobs = services.jobs.onEvent(sendEvent);
  const unsubscribeAutonomousTasks = services.autonomousTasks?.onEvent(sendEvent) ?? (() => undefined);
  const unsubscribeAutomations = services.automations.onEvent(sendEvent);
  const unsubscribeSubagents = services.subagents?.onEvent(sendEvent) ?? (() => undefined);
  const unsubscribeOllamaRuntime = services.ollamaRuntime?.onEvent(sendEvent) ?? (() => undefined);
  const unsubscribeCollab = COLLABORATION_ENABLED ? services.collab?.onEvent(sendEvent) ?? (() => undefined) : (() => undefined);
  const unsubscribeUpdater = services.updater?.onEvent(sendEvent) ?? (() => undefined);
  const unsubscribeLibraryWatch = services.libraryWatch?.onEvent(sendEvent) ?? (() => undefined);

  ipcMain.handle('app:getBootstrap', async () => {
    const [bootstrap, providers] = await Promise.all([services.db.getBootstrapData(), services.providers.listProviders()]);
    return {
      ...bootstrap,
      providers,
      pendingRunToolApprovals: services.providers.listPendingToolApprovals()
    };
  });

  ipcMain.handle('app:pickFolder', async () => {
    const result = await dialog.showOpenDialog(getMainWindow() ?? undefined, { properties: ['openDirectory', 'createDirectory'] });
    return result.canceled ? null : result.filePaths[0] ?? null;
  });
  ipcMain.handle('app:openExternal', async (_event, input) => {
    await shell.openExternal(externalUrlSchema.parse(input).url);
  });
  ipcMain.handle('app:openPath', async (_event, input) => {
    const targetPath = filePathSchema.parse(input).path;
    const errorMessage = await shell.openPath(targetPath);
    if (errorMessage) {
      throw new Error(errorMessage);
    }
  });
  ipcMain.handle('app:revealPath', async (_event, input) => {
    shell.showItemInFolder(filePathSchema.parse(input).path);
  });
  ipcMain.handle('app:getMeta', async () => {
    const userDataPath = app.getPath('userData');
    const statePath = join(userDataPath, 'state');
    return {
      version: app.getVersion(),
      userDataPath,
      statePath,
      exportsPath: join(statePath, 'exports')
    };
  });
  ipcMain.handle('app:getNativeTheme', async () => ({
    platform: process.platform,
    systemAccentColor: getSystemAccentColor()
  }));
  ipcMain.handle('app:adjustZoom', async (_event, input) => {
    const currentWindow = getMainWindow();
    if (!currentWindow) {
      return 1;
    }

    const { action } = appZoomActionSchema.parse(input);
    const currentFactor = currentWindow.webContents.getZoomFactor();
    const nextFactor =
      action === 'reset'
        ? 1
        : clampAppZoomFactor(currentFactor + (action === 'in' ? APP_ZOOM_STEP : -APP_ZOOM_STEP));

    currentWindow.webContents.setZoomFactor(nextFactor);
    return nextFactor;
  });
  ipcMain.handle('updates:getState', async () => services.updater.getState());
  ipcMain.handle('updates:checkForUpdates', async () => services.updater.checkForUpdates());
  ipcMain.handle('updates:restartToUpdate', async () => services.updater.restartToUpdate());
  ipcMain.handle('voice:getMicrophoneAccessStatus', async () => getMicrophoneAccessStatus());
  ipcMain.handle('voice:transcribe', async (_event, input) => services.voice.transcribeAudio(voiceTranscriptionSchema.parse(input)));
  ipcMain.handle('projects:create', (_event, input) => services.db.createProject(projectCreateSchema.parse(input)));
  ipcMain.handle('projects:update', (_event, input) => services.db.updateProject(projectUpdateSchema.parse(input)));
  ipcMain.handle('projects:remove', (_event, input) => services.db.deleteProject(projectIdSchema.parse(input).projectId));
  ipcMain.handle('threads:list', (_event, projectId) => services.db.listThreads(projectIdValueSchema.parse(projectId)));
  ipcMain.handle('threads:listArchived', (_event, input) => services.db.listArchivedThreads(archivedThreadsListSchema.parse(input).projectId ?? null));
  ipcMain.handle('threads:open', (_event, input) => services.db.getThread(threadIdSchema.parse(input).threadId));
  ipcMain.handle('threads:summarizeForCollaboration', (_event, input) =>
    services.providers.generateCollaborationThreadSummary(threadIdSchema.parse(input).threadId)
  );
  ipcMain.handle('threads:listAutonomousTasks', (_event, input) =>
    services.autonomousTasks?.listForThread(threadIdSchema.parse(input).threadId) ?? []
  );
  ipcMain.handle('threads:createFollowUp', (_event, input) => {
    const data = threadFollowUpCreateSchema.parse(input);
    return services.db.createThreadFollowUp({
      threadId: data.threadId,
      content: data.content,
      kind: data.kind
    });
  });
  ipcMain.handle('threads:updateFollowUp', (_event, input) => {
    const data = threadFollowUpUpdateSchema.parse(input);
    return services.providers.updateQueuedFollowUp(data.followUpId, data.content);
  });
  ipcMain.handle('threads:removeFollowUp', (_event, input) => {
    return services.providers.removeQueuedFollowUp(threadFollowUpIdSchema.parse(input).followUpId);
  });
  ipcMain.handle('threads:getDraft', (_event, input) => services.db.getThreadDraft(threadIdSchema.parse(input).threadId));
  ipcMain.handle('threads:saveDraft', (_event, input) => {
    const data = threadDraftSaveSchema.parse(input);
    return services.db.saveThreadDraft(data.threadId, data.prompt);
  });
  ipcMain.handle('threads:clearDraft', (_event, input) => services.db.clearThreadDraft(threadIdSchema.parse(input).threadId));
  ipcMain.handle('threads:create', (_event, input) => services.db.createThread(threadCreateSchema.parse(input)));
  ipcMain.handle('threads:setExecutionPermission', (_event, input) => {
    const data = threadExecutionPermissionSchema.parse(input);
    return services.providers.setThreadExecutionPermission
      ? services.providers.setThreadExecutionPermission(
          data.threadId,
          data.executionPermission
        )
      : services.db.setThreadExecutionPermission(
          data.threadId,
          data.executionPermission
        );
  });
  ipcMain.handle('threads:rename', (_event, input) => {
    const data = renameThreadSchema.parse(input);
    return services.db.renameThread(data.threadId, data.title);
  });
  ipcMain.handle('threads:archive', (_event, input) => services.db.archiveThread(threadIdSchema.parse(input).threadId));
  ipcMain.handle('threads:restore', (_event, input) => services.db.restoreThread(threadIdSchema.parse(input).threadId));
  ipcMain.handle('threads:delete', (_event, input) => services.db.deleteThread(threadIdSchema.parse(input).threadId));
  ipcMain.handle('threads:duplicate', (_event, input) => {
    const data = duplicateThreadSchema.parse(input);
    return services.db.duplicateThread(data.threadId, data.fromTurnId);
  });
  ipcMain.handle('threads:retry', async (_event, input) => services.providers.retryThread(threadIdSchema.parse(input).threadId));
  ipcMain.handle('composer:submit', async (_event, input) => {
    const submission = composerSubmitSchema.parse(input);
    services.libraryWatch?.refreshSkillsIfPending();
    const result = await services.providers.submitComposer(submission);
    if (result.disposition === 'started') {
      services.subagents?.attachRunToChildThread(result.thread.id, result.runId);
    }
    return result;
  });
  ipcMain.handle('composer:createTextAttachment', async (_event, input) => {
    const data = composerTextAttachmentCreateSchema.parse(input);
    return services.composerTextAttachments.create(services.db.getProject(data.projectId), data);
  });
  ipcMain.handle('composer:deleteTextAttachment', async (_event, input) => {
    const data = composerTextAttachmentDeleteSchema.parse(input);
    services.composerTextAttachments.remove(services.db.getProject(data.projectId), data.attachment);
  });
  ipcMain.handle('composer:enhancePrompt', async (_event, input) => services.providers.enhancePrompt(composerEnhancePromptSchema.parse(input)));
  ipcMain.handle('composer:stop', async (_event, input) => services.providers.stopRun(runStopSchema.parse(input).runId));
  ipcMain.handle('runs:approveToolApproval', async (_event, input) => services.providers.approveToolApproval(runToolApprovalIdSchema.parse(input).approvalId));
  ipcMain.handle('runs:rejectToolApproval', async (_event, input) => services.providers.rejectToolApproval(runToolApprovalIdSchema.parse(input).approvalId));
  ipcMain.handle('runs:previewStagedWorkspaceChange', async (_event, input) =>
    services.providers.previewStagedWorkspaceChange(stagedWorkspaceReviewSchema.parse(input))
  );
  ipcMain.handle('runs:applyStagedWorkspaceChange', async (_event, input) =>
    services.providers.applyStagedWorkspaceChange(stagedWorkspaceReviewSchema.parse(input))
  );
  ipcMain.handle('runs:rejectStagedWorkspaceChange', async (_event, input) =>
    services.providers.rejectStagedWorkspaceChange(stagedWorkspaceReviewSchema.parse(input))
  );
  ipcMain.handle('runs:revertStagedWorkspaceChange', async (_event, input) =>
    services.providers.revertStagedWorkspaceChange(stagedWorkspaceReviewSchema.parse(input))
  );
  ipcMain.handle('runs:applyStagedWorkspaceHunks', async (_event, input) =>
    services.providers.applyStagedWorkspaceHunks(stagedWorkspaceHunkApplySchema.parse(input))
  );
  ipcMain.handle('runs:rejectStagedWorkspaceHunks', async (_event, input) =>
    services.providers.rejectStagedWorkspaceHunks(stagedWorkspaceHunkRejectSchema.parse(input))
  );
  ipcMain.handle('runs:revertStagedWorkspaceHunks', async (_event, input) =>
    services.providers.revertStagedWorkspaceHunks(stagedWorkspaceReviewSchema.parse(input))
  );
  ipcMain.handle('runs:applyWorktreeReview', async (_event, input) =>
    services.providers.applyWorktreeReview(worktreeReviewSchema.parse(input))
  );
  ipcMain.handle('runs:rejectWorktreeReview', async (_event, input) =>
    services.providers.rejectWorktreeReview(worktreeReviewSchema.parse(input))
  );
  ipcMain.handle('runs:revertWorktreeReview', async (_event, input) =>
    services.providers.revertWorktreeReview(worktreeReviewSchema.parse(input))
  );
  ipcMain.handle('runs:applyWorktreeHunks', async (_event, input) =>
    services.providers.applyWorktreeHunks(worktreeHunkApplySchema.parse(input))
  );
  ipcMain.handle('runs:rejectWorktreeHunks', async (_event, input) =>
    services.providers.rejectWorktreeHunks(worktreeHunkRejectSchema.parse(input))
  );
  ipcMain.handle('runs:revertWorktreeHunks', async (_event, input) =>
    services.providers.revertWorktreeHunks(worktreeReviewSchema.parse(input))
  );
  ipcMain.handle('runs:cleanupWorktreeReview', async (_event, input) =>
    services.providers.cleanupWorktreeReview(worktreeReviewSchema.parse(input))
  );
  ipcMain.handle('planner:setMode', async (_event, input) => services.providers.setPlannerMode(plannerSetModeSchema.parse(input)));
  ipcMain.handle('planner:submit', async (_event, input) => services.providers.submitPlanner(plannerSubmitSchema.parse(input)));
  ipcMain.handle('planner:answer', async (_event, input) => services.providers.answerPlannerQuestions(plannerAnswerSchema.parse(input)));
  ipcMain.handle('planner:approvePlan', async (_event, input) => services.providers.approvePlannerPlan(plannerApprovePlanSchema.parse(input)));
  ipcMain.handle('planner:cancel', async (_event, input) => services.providers.cancelPlannerSession(plannerCancelSchema.parse(input)));
  ipcMain.handle('providers:list', async () => services.providers.listProviders());
  ipcMain.handle('providers:startAuth', async (_event, input) => {
    const data = providerAuthStartSchema.parse(input);
    return services.providers.startAuth(data.providerId, data.mode, { force: data.force ?? false });
  });
  ipcMain.handle('providers:adoptAuth', async (_event, input) => {
    const data = providerAuthAdoptSchema.parse(input);
    return services.providers.adoptAuth(data.providerId);
  });
  ipcMain.handle('providers:clearAuth', async (_event, providerId) => services.providers.clearAuth(providerIdSchema.parse(providerId)));
  ipcMain.handle('providers:saveApiKey', async (_event, input) => {
    const data = providerApiKeySchema.parse(input);
    return services.providers.saveApiKey(data.providerId, data.apiKey);
  });
  ipcMain.handle('providers:refresh', async (_event, providerId) =>
    services.providers.getProvider(providerIdSchema.parse(providerId), { forceRefresh: true })
  );
  ipcMain.handle('providers:listCustom', () => services.providers.listCustomProviderSettings());
  ipcMain.handle('providers:saveCustom', (_event, input) =>
    services.providers.saveCustomProviderSettings(customProviderSettingsSaveSchema.parse(input))
  );
  ipcMain.handle('providers:removeCustom', (_event, input) =>
    services.providers.deleteCustomProviderSettings(customProviderIdSchema.parse(input).providerId)
  );
  ipcMain.handle('ollamaRuntime:getStatus', async () => services.ollamaRuntime.getSnapshot());
  ipcMain.handle('ollamaRuntime:start', async () => services.ollamaRuntime.startAndGetSnapshot());
  ipcMain.handle('ollamaRuntime:stop', async () => services.ollamaRuntime.stopAndGetSnapshot());
  ipcMain.handle('ollamaRuntime:listModels', async () => services.ollamaRuntime.listModels());
  ipcMain.handle('ollamaRuntime:pullModel', async (_event, input) => services.ollamaRuntime.pullModel(ollamaModelMutationSchema.parse(input).model));
  ipcMain.handle('ollamaRuntime:deleteModel', async (_event, input) => services.ollamaRuntime.deleteModel(ollamaModelMutationSchema.parse(input).model));
  ipcMain.handle('skills:list', () => services.skills.listSkills());
  ipcMain.handle('skills:detail', (_event, input) => services.skills.getSkillDetail(skillIdSchema.parse(input).skillId));
  ipcMain.handle('skills:save', (_event, input) => services.skills.saveSkill(skillSaveSchema.parse(input)));
  ipcMain.handle('skills:toggle', (_event, input) => {
    const data = skillToggleSchema.parse(input);
    return services.skills.toggleSkill(data.skillId, data.enabled);
  });
  ipcMain.handle('skills:installSuggested', async (_event, input) => {
    const data = skillSuggestedInstallSchema.parse(input);
    return await services.skills.installSuggestedSkill(data);
  });
  ipcMain.handle('skills:rescanLibrary', async () => services.skills.rescanLibrarySkills());
  ipcMain.handle('skills:remove', (_event, input) => services.skills.removeSkill(skillIdSchema.parse(input).skillId));
  ipcMain.handle('library:getSources', () => buildLibrarySourcesSnapshot(services.db.getPreferences()));
  ipcMain.handle('projectKnowledge:getIndexStatus', () => buildProjectKnowledgeIndexStatus(services.db));
  ipcMain.handle('projectKnowledge:refreshIndex', () => refreshProjectKnowledgeIndex(services.db));
  ipcMain.handle('projectKnowledge:suggestIndex', () => suggestProjectKnowledgeIndex(services.db));
  ipcMain.handle('projectKnowledge:openSuggestedIndexDraft', () => openProjectKnowledgeSuggestedIndexDraft(services.db));
  ipcMain.handle('automations:list', () => services.db.listAutomations());
  ipcMain.handle('automations:listRuns', (_event, input) => services.db.listAutomationRuns(automationIdSchema.parse(input).automationId));
  ipcMain.handle('automations:save', (_event, input) => {
    const automation = services.db.saveAutomation(automationSaveSchema.parse(input));
    services.automations.refresh();
    return automation;
  });
  ipcMain.handle('automations:toggle', (_event, input) => {
    const data = automationToggleSchema.parse(input);
    const automation = services.db.toggleAutomation(data.automationId, data.enabled);
    services.automations.refresh();
    return automation;
  });
  ipcMain.handle('automations:delete', (_event, input) => {
    services.db.deleteAutomation(automationIdSchema.parse(input).automationId);
    services.automations.refresh();
  });
  ipcMain.handle('automations:runNow', async (_event, input) => services.automations.runNow(automationIdSchema.parse(input).automationId));
  ipcMain.handle('jobs:list', () => services.jobs.listJobs());
  ipcMain.handle('jobs:listPendingReviews', () => services.jobs.listPendingReviews());
  ipcMain.handle('jobs:updateReviewDraft', (_event, input) => {
    const data = reviewDraftUpdateSchema.parse(input);
    return services.jobs.updateManualReviewDraft(data.reviewItemId, data.content);
  });
  ipcMain.handle('jobs:approveReview', async (_event, input) => services.jobs.approveReview(reviewItemIdSchema.parse(input).reviewItemId));
  ipcMain.handle('jobs:rejectReview', (_event, input) => services.jobs.rejectReview(reviewItemIdSchema.parse(input).reviewItemId));
  ipcMain.handle('mcp:syncImports', async () => services.mcp.syncImports());
  ipcMain.handle('mcp:listServers', () => services.mcp.listServerViews());
  ipcMain.handle('mcp:listCatalog', async () => services.mcp.listCatalog());
  ipcMain.handle('mcp:saveServer', (_event, input) => services.mcp.saveServerView(mcpServerSaveSchema.parse(input)));
  ipcMain.handle('mcp:setupRecommended', (_event, input) => {
    const data = mcpRecommendedSetupSchema.parse(input);
    return services.mcp.setupRecommendedServer(data.entryId, data.projectId ?? null);
  });
  ipcMain.handle('mcp:refreshServer', (_event, input) =>
    services.mcp.refreshServer(mcpServerIdSchema.parse(input).serverId).then((record) => {
      const view = services.mcp.listServerViews().find((server) => server.id === record.definition.id);
      if (!view) {
        throw new Error('Failed to refresh MCP server.');
      }
      return view;
    })
  );
  ipcMain.handle('mcp:approveLaunch', (_event, input) =>
    services.mcp.approveServerLaunch(mcpServerIdSchema.parse(input).serverId)
  );
  ipcMain.handle('mcp:setEnabled', (_event, input) => {
    const data = mcpServerEnabledSchema.parse(input);
    return services.mcp.setServerEnabled(data.serverId, data.enabled);
  });
  ipcMain.handle('mcp:removeServer', (_event, input) =>
    services.mcp.removeServerView(mcpServerIdSchema.parse(input).serverId)
  );
  ipcMain.handle('subagents:list', (_event, input) =>
    services.subagents?.listForThread(subagentListSchema.parse(input).threadId) ?? []
  );
  ipcMain.handle('subagents:spawn', (_event, input) => {
    if (!services.subagents) {
      throw new Error('Subagents are unavailable.');
    }
    return services.subagents.spawn(subagentSpawnSchema.parse(input));
  });
  ipcMain.handle('subagents:cancel', (_event, input) => {
    if (!services.subagents) {
      throw new Error('Subagents are unavailable.');
    }
    return services.subagents.cancel(subagentIdSchema.parse(input).subagentId);
  });
  ipcMain.handle('subagents:getDetail', (_event, input) => {
    if (!services.subagents) {
      throw new Error('Subagents are unavailable.');
    }
    return services.subagents.getDetail(subagentIdSchema.parse(input).subagentId);
  });
  ipcMain.handle('settings:get', () => services.db.getPreferences());
  ipcMain.handle('settings:save', (_event, input) => {
    const preferences = services.db.savePreferences(preferenceSaveSchema.parse(input));
    services.libraryWatch?.refreshWatchedRoots();
    return preferences;
  });
  ipcMain.handle('diagnostics:export', async () => {
    const path = await services.diagnostics.export(await services.providers.listProviders());
    sendEvent({ type: 'diagnostics.ready', path });
    return path;
  });
  ipcMain.handle('diagnostics:exportThread', async (_event, input) => {
    const path = await services.diagnostics.exportThread(
      threadIdSchema.parse(input).threadId,
      await services.providers.listProviders()
    );
    return path;
  });
  ipcMain.handle('diagnostics:exportThreadReport', async (_event, input) => {
    const path = await services.diagnostics.exportThreadReport(
      threadIdSchema.parse(input).threadId,
      await services.providers.listProviders()
    );
    return path;
  });
  ipcMain.handle('diagnostics:getStorage', () => services.db.getStorageDiagnostics());
  ipcMain.handle('diagnostics:compactRunEvents', (_event, input) =>
    services.db.maintainStorage({
      ...diagnosticsCompactionSchema.parse(input ?? {}),
      vacuum: false
    })
  );
  ipcMain.handle('diagnostics:maintainStorage', (_event, input) =>
    services.db.maintainStorage(diagnosticsMaintenanceSchema.parse(input ?? {}))
  );
  ipcMain.handle('collab:getBootstrap', () =>
    COLLABORATION_ENABLED ? services.collab?.getBootstrap() ?? services.db.getCollabBootstrap() : createEmptyCollaborationBootstrap()
  );
  ipcMain.handle('collab:configure', (_event, input) => services.collab?.configure(collabConfigSaveSchema.parse(input)));
  ipcMain.handle('collab:clearConfig', () => services.collab?.clearConfig());
  ipcMain.handle('collab:createGuestProfile', (_event, input) =>
    services.collab?.createGuestProfile(collabCreateGuestProfileSchema.parse(input))
  );
  ipcMain.handle('collab:clearIdentity', () => services.collab?.clearIdentity());
  ipcMain.handle('collab:updateProfile', (_event, input) => services.collab?.updateProfile(collabUpdateProfileSchema.parse(input)));
  ipcMain.handle('collab:createRoom', (_event, input) => services.collab?.createRoom(collabCreateRoomSchema.parse(input)));
  ipcMain.handle('collab:joinRoom', (_event, input) => services.collab?.joinRoom(collabJoinRoomSchema.parse(input)));
  ipcMain.handle('collab:createDirectChat', (_event, input) =>
    services.collab?.createDirectChat(collabCreateDirectChatSchema.parse(input))
  );
  ipcMain.handle('collab:listRooms', () => services.collab?.listRooms() ?? services.db.listCollabRooms().filter((room) => room.type !== 'dm'));
  ipcMain.handle('collab:openRoom', (_event, input) => services.collab?.openRoom(collabRoomIdSchema.parse(input).roomId) ?? services.db.getCollabRoomDetail(collabRoomIdSchema.parse(input).roomId));
  ipcMain.handle('collab:listChats', () => services.collab?.listChats() ?? services.db.listCollabChats());
  ipcMain.handle('collab:openChat', (_event, input) => services.collab?.openChat(collabRoomIdSchema.parse(input).roomId) ?? services.db.getCollabRoomDetail(collabRoomIdSchema.parse(input).roomId));
  ipcMain.handle('collab:listContacts', () => services.collab?.listContacts() ?? services.db.listCollabContacts());
  ipcMain.handle('collab:setFollowing', (_event, input) => services.collab?.setFollowing(collabSetFollowingSchema.parse(input)));
  ipcMain.handle('collab:requestRole', (_event, input) => services.collab?.requestRole(collabRequestRoleSchema.parse(input)));
  ipcMain.handle('collab:resolveRoleRequest', (_event, input) => services.collab?.resolveRoleRequest(collabResolveRoleRequestSchema.parse(input)));
  ipcMain.handle('collab:setTerminalMode', (_event, input) => services.collab?.setTerminalMode(collabSetTerminalModeSchema.parse(input)));
  ipcMain.handle('collab:sendMessage', (_event, input) => services.collab?.sendMessage(collabSendMessageSchema.parse(input)));
  ipcMain.handle('collab:setPresence', (_event, input) => services.collab?.setPresence(collabSetPresenceSchema.parse(input)));
  ipcMain.handle('collab:shareThread', (_event, input) => services.collab?.shareThread(collabShareThreadSchema.parse(input)));
  ipcMain.handle('collab:shareRun', (_event, input) => services.collab?.shareRun(collabShareRunSchema.parse(input)));
  ipcMain.handle('collab:createHandoff', (_event, input) => services.collab?.createHandoff(collabCreateHandoffSchema.parse(input)));

  return () => {
    unsubscribeProviders();
    unsubscribeMcp();
    unsubscribeJobs();
    unsubscribeAutonomousTasks();
    unsubscribeAutomations();
    unsubscribeSubagents();
    unsubscribeOllamaRuntime();
    unsubscribeCollab();
    unsubscribeUpdater();
    unsubscribeLibraryWatch();
  };
}
