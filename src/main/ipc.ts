import { app, dialog, ipcMain, shell, systemPreferences } from 'electron';
import { join } from 'node:path';
import type { BrowserWindow } from 'electron';
import type { ProviderId } from '../shared/domain';
import type { MicrophoneAccessStatus } from '../shared/ipc';
import {
  archivedThreadsListSchema,
  automationIdSchema,
  automationSaveSchema,
  automationToggleSchema,
  vicodeBuildLaneActionSchema,
  vicodeBuildClearPlansSchema,
  vicodeBuildPlanCreateSchema,
  vicodeBuildPlanDraftSchema,
  vicodeBuildPlanFromThreadSchema,
  vicodeBuildProjectSchema,
  vicodeBuildTeamPauseSchema,
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
  personalizationSaveSchema,
  preferenceSaveSchema,
  projectCreateSchema,
  projectIdSchema,
  projectUpdateSchema,
  providerAuthAdoptSchema,
  providerApiKeySchema,
  providerAuthStartSchema,
  ollamaModelMutationSchema,
  renameThreadSchema,
  reviewDraftUpdateSchema,
  runToolApprovalIdSchema,
  runStopSchema,
  reviewItemIdSchema,
  skillIdSchema,
  skillSaveSchema,
  skillSuggestedInstallSchema,
  skillSyncSchema,
  skillToggleSchema,
  voiceTranscriptionSchema,
  threadDraftSaveSchema,
  threadFollowUpCreateSchema,
  threadFollowUpIdSchema,
  threadFollowUpUpdateSchema,
  threadCreateSchema,
  threadExecutionPermissionSchema,
  memoryWriteThreadSchema,
  mcpServerIdSchema,
  mcpRecommendedSetupSchema,
  mcpServerEnabledSchema,
  mcpServerSaveSchema,
  subagentIdSchema,
  subagentListSchema,
  subagentSpawnSchema,
  threadIdSchema,
  workspaceBootstrapCreateDraftsSchema,
  workspaceBootstrapStatusSchema,
  workspaceBootstrapWriteDraftsSchema
} from '../shared/schemas';
import type { AppEvent } from '../shared/events';
import { DatabaseService } from '../storage/database';
import { AutomationScheduler } from './services/automation-scheduler';
import { AppUpdaterService } from './services/app-updater';
import { DiagnosticsService } from './services/diagnostics';
import { JobsService } from './services/jobs';
import { OllamaRuntimeService } from './services/ollama-runtime';
import { ProviderManager } from './services/provider-manager';
import { SkillCatalogService } from './services/skills';
import { CollaborationService } from './services/collab';
import { ComposerTextAttachmentService } from './services/composer-text-attachments';
import { AutonomousTaskService } from './services/autonomous-tasks';
import { McpRegistryService } from './services/mcp/registry';
import { WorkspaceBootstrapService } from './services/workspace-bootstrap';
import { VicodeBuildControlService } from './services/vicode-build-control';
import { VoiceService } from './services/voice';
import { SubagentOrchestratorService } from './services/subagents';

interface Services {
  db: DatabaseService;
  updater: AppUpdaterService;
  providers: ProviderManager;
  ollamaRuntime: OllamaRuntimeService;
  skills: SkillCatalogService;
  automations: AutomationScheduler;
  vicodeBuild: VicodeBuildControlService;
  diagnostics: DiagnosticsService;
  mcp: McpRegistryService;
  jobs: JobsService;
  autonomousTasks?: AutonomousTaskService;
  subagents?: SubagentOrchestratorService;
  workspaceBootstrap: WorkspaceBootstrapService;
  voice: VoiceService;
  collab?: CollaborationService;
  composerTextAttachments: ComposerTextAttachmentService;
}

const DEFAULT_WINDOWS_ACCENT = '#0078d4';
const APP_ZOOM_STEP = 0.1;
const APP_ZOOM_MIN = 0.75;
const APP_ZOOM_MAX = 1.6;

function clampAppZoomFactor(value: number) {
  const bounded = Math.min(APP_ZOOM_MAX, Math.max(APP_ZOOM_MIN, value));
  return Math.round(bounded * 100) / 100;
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
  const unsubscribeCollab = services.collab?.onEvent(sendEvent) ?? (() => undefined);
  const unsubscribeUpdater = services.updater?.onEvent(sendEvent) ?? (() => undefined);

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
  ipcMain.handle('workspaceBootstrap:getStatus', (_event, input) => {
    const data = workspaceBootstrapStatusSchema.parse(input);
    return services.workspaceBootstrap.getStatus(services.db.getProject(data.projectId));
  });
  ipcMain.handle('workspaceBootstrap:getQuestionnaire', () => services.workspaceBootstrap.getQuestionnaire());
  ipcMain.handle('workspaceBootstrap:dismissSuggestion', (_event, input) => {
    const data = workspaceBootstrapStatusSchema.parse(input);
    const project = services.db.getProject(data.projectId);
    services.workspaceBootstrap.dismissSuggestion(project);
    return services.workspaceBootstrap.getStatus(project);
  });
  ipcMain.handle('workspaceBootstrap:createDrafts', (_event, input) => {
    const data = workspaceBootstrapCreateDraftsSchema.parse(input);
    return services.workspaceBootstrap.createDrafts(services.db.getProject(data.projectId), data.answers, {
      includeSoul: data.includeSoul,
      includeDailyNote: data.includeDailyNote,
      overwriteExisting: data.overwriteExisting
    });
  });
  ipcMain.handle('workspaceBootstrap:writeDrafts', (_event, input) => {
    const data = workspaceBootstrapWriteDraftsSchema.parse(input);
    return services.workspaceBootstrap.writeDrafts(services.db.getProject(data.projectId), data.drafts, {
      overwriteExisting: data.overwriteExisting
    });
  });
  ipcMain.handle('memoryWrites:createDailyNoteReview', (_event, input) =>
    services.jobs.createDailyNoteReview(memoryWriteThreadSchema.parse(input).threadId)
  );
  ipcMain.handle('memoryWrites:createMemoryPromotionReview', (_event, input) =>
    services.jobs.createMemoryPromotionReview(memoryWriteThreadSchema.parse(input).threadId)
  );
  ipcMain.handle('memoryWrites:createUserPreferenceReview', (_event, input) =>
    services.jobs.createUserPreferenceReview(memoryWriteThreadSchema.parse(input).threadId)
  );
  ipcMain.handle('threads:list', (_event, projectId: string) => services.db.listThreads(projectId));
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
    const result = await services.providers.submitComposer(composerSubmitSchema.parse(input));
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
  ipcMain.handle('providers:clearAuth', async (_event, providerId: ProviderId) => services.providers.clearAuth(providerId));
  ipcMain.handle('providers:saveApiKey', async (_event, input) => {
    const data = providerApiKeySchema.parse(input);
    return services.providers.saveApiKey(data.providerId, data.apiKey);
  });
  ipcMain.handle('providers:refresh', async (_event, providerId: ProviderId) => services.providers.getProvider(providerId, { forceRefresh: true }));
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
  ipcMain.handle('skills:sync', (_event, input) => {
    const data = skillSyncSchema.parse(input);
    return services.skills.syncSkill(data.skillId, data.providerId, data.enabled);
  });
  ipcMain.handle('skills:installSuggested', async (_event, input) => {
    const data = skillSuggestedInstallSchema.parse(input);
    return await services.skills.installSuggestedSkill(data);
  });
  ipcMain.handle('skills:remove', (_event, input) => services.skills.removeSkill(skillIdSchema.parse(input).skillId));
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
  ipcMain.handle('vicodeBuild:getSnapshot', (_event, input) =>
    services.vicodeBuild.getSnapshot(vicodeBuildProjectSchema.parse(input).projectId)
  );
  ipcMain.handle('vicodeBuild:generatePlanDraft', (_event, input) => {
    const data = vicodeBuildPlanDraftSchema.parse(input);
    return services.vicodeBuild.generatePlanDraft(data.projectId, data.goal);
  });
  ipcMain.handle('vicodeBuild:createPlan', (_event, input) => {
    const data = vicodeBuildPlanCreateSchema.parse(input);
    return services.vicodeBuild.createPlan(data.projectId, {
      goal: data.goal,
      name: data.name,
      worktreePath: data.worktreePath
    });
  });
  ipcMain.handle('vicodeBuild:createPlanFromThread', (_event, input) => {
    return services.vicodeBuild.createPlanFromThread(vicodeBuildPlanFromThreadSchema.parse(input).threadId);
  });
  ipcMain.handle('vicodeBuild:setTeamPaused', (_event, input) => {
    const data = vicodeBuildTeamPauseSchema.parse(input);
    return services.vicodeBuild.setTeamPaused(data.projectId, data.teamId, data.paused);
  });
  ipcMain.handle('vicodeBuild:wakeLane', (_event, input) => {
    const data = vicodeBuildLaneActionSchema.parse(input);
    return services.vicodeBuild.wakeLane(data.projectId, data.teamId, data.laneId);
  });
  ipcMain.handle('vicodeBuild:retryLane', (_event, input) => {
    const data = vicodeBuildLaneActionSchema.parse(input);
    return services.vicodeBuild.retryLane(data.projectId, data.teamId, data.laneId);
  });
  ipcMain.handle('vicodeBuild:clearInactivePlans', (_event, input) => {
    const data = vicodeBuildClearPlansSchema.parse(input);
    return services.vicodeBuild.clearInactivePlans(data.projectId);
  });
  ipcMain.handle('vicodeBuild:runVerification', (_event, input) => {
    const data = vicodeBuildProjectSchema.parse(input);
    if (!data.projectId) {
      throw new Error('Project is required to run build verification.');
    }
    return services.vicodeBuild.runVerification(data.projectId);
  });
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
  ipcMain.handle('settings:save', (_event, input) => services.db.savePreferences(preferenceSaveSchema.parse(input)));
  ipcMain.handle('settings:getPersonalization', () => services.db.getPersonalization());
  ipcMain.handle('settings:savePersonalization', (_event, input) => services.db.savePersonalization(personalizationSaveSchema.parse(input)));
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
  ipcMain.handle('collab:getBootstrap', () => services.collab?.getBootstrap() ?? services.db.getCollabBootstrap());
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
  };
}
