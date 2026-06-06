import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActionButton,
  ConfirmDialog,
  IconButton,
  ModalDialog,
  PrimaryButton,
  SelectField,
  SurfaceCard,
  TextArea,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider
} from './components/ui';
import type {
  AutonomyDelegationProfile,
  AppMeta,
  AppUpdateState,
  AutonomousTaskSummary,
  AutomationDefinition,
  AutomationRun,
  BootstrapData,
  CollabBootstrap,
  ComposerMode,
  ComposerSubmitInput,
  ComposerSubmitResult,
  CustomProviderSettings,
  CustomProviderSettingsSaveInput,
  ExecutionPermission,
  HarnessIsolationMode,
  ImageAttachment,
  JobDefinition,
  LibrarySourcesSnapshot,
  OllamaPullProgress,
  PlannerPlan,
  PlannerQuestionAnswer,
  Preferences,
  Project,
  ProjectKnowledgeIndexStatus,
  ProviderDescriptor,
  ProviderId,
  ProviderReasoningEffort,
  ReviewItem,
  RunToolApprovalRequest,
  RunProgressState,
  RunEvent,
  SettingsSection,
  SkillDefinition,
  SkillSaveInput,
  StagedWorkspaceHunkApplyInput,
  StagedWorkspaceHunkRejectInput,
  StagedWorkspaceHunkRevertInput,
  StagedWorkspaceReviewInput,
  SubagentSummary,
  TextAttachment,
  ThreadDetail,
  ThreadFollowUp,
  ThreadSummary,
  WorktreeCleanupInput,
  WorktreeHunkApplyInput,
  WorktreeHunkRejectInput,
  WorktreeHunkRevertInput,
  WorktreeReviewInput
} from '../shared/domain';
import type { AppEvent } from '../shared/events';
import type {
  MicrophoneAccessStatus,
  OllamaRuntimeSnapshot,
  StorageDiagnostics
} from '../shared/ipc';
import {
  deriveRunActivityMap,
  deriveRunTranscriptItemsMap,
  type RunActivityViewModel,
  type ThinkingLineViewModel
} from './lib/run-activity';
import {
  extractThreadSkillIds,
  formatAutomationSchedule,
  formatTime,
  hasAssistantTurnForRun,
  isVisibleTranscriptTurn,
  surfaceProviders,
  upsertRecentThread
} from './lib/thread-presentation';
import {
  applyRawRunEventToThread,
  applyRunReplaceToThread,
  applyRunStartedToThread,
  applyThreadSummaryToActiveThread,
  clearRunProgressEntry
} from './lib/thread-live-event-reducer';
import {
  applyActiveThreadDeltas,
  clearActiveThreadEventBuffer,
  createActiveThreadEventBuffer,
  drainActiveThreadDeltas,
  hasActiveThreadDeltas,
  queueActiveThreadDelta,
  setActiveThreadEventBufferThread
} from './lib/active-thread-event-reducer';
import { bootstrapAppShell } from './lib/app-shell-bootstrap';
import {
  refreshAppShellBootstrapState,
  refreshCollaborationBootstrapState
} from './lib/app-shell-refresh';
import {
  openThreadInShell,
  refreshArchivedThreads as refreshArchivedThreadsInShell,
  refreshThreads as refreshThreadsInShell,
  selectRestorableProjectThread,
  selectProjectInShell,
  toggleProjectThreadsInShell
} from './lib/app-shell-thread-selection';
import { useThreadDraftSync } from './lib/use-thread-draft-sync';
import { useShellTaskSync } from './lib/use-shell-task-sync';
import {
  archiveProjectThreads as archiveProjectThreadsInShell,
  createProject as createProjectInShell,
  createThread as createThreadInShell,
  createThreadForProject as createThreadForProjectInShell,
  openProjectFromPicker as openProjectFromPickerInShell,
  removeProject as removeProjectInShell,
  renameProject as renameProjectInShell,
  repairWorkspaceProjectPath as repairWorkspaceProjectPathInShell,
  setProjectTrust as setProjectTrustInShell,
  trustWorkspaceProject
} from './lib/app-shell-project-actions';
import {
  applyStagedWorkspaceChangeInShell,
  applyStagedWorkspaceHunksInShell,
  applyWorktreeHunksInShell,
  applyWorktreeReviewInShell,
  cleanupWorktreeReviewInShell,
  rejectStagedWorkspaceChangeInShell,
  rejectStagedWorkspaceHunksInShell,
  rejectWorktreeHunksInShell,
  rejectWorktreeReviewInShell,
  revertStagedWorkspaceChangeInShell,
  revertStagedWorkspaceHunksInShell,
  revertWorktreeHunksInShell,
  revertWorktreeReviewInShell,
  type AppShellRunReviewActionsHost
} from './lib/app-shell-run-review-actions';
import {
  adoptProviderAuthInShell,
  beginProviderInstallInShell,
  clearAllProviderAuthInShell,
  clearProviderAuthInShell,
  connectProviderInShell,
  deleteCustomProviderInShell,
  deleteOllamaModelInShell,
  pullOllamaModelInShell,
  refreshCustomProvidersInShell,
  refreshOllamaRuntimeStatusInShell,
  refreshProviderInShell,
  refreshProvidersInShell,
  saveCustomProviderInShell,
  saveProviderApiKeyInShell,
  stopOllamaRuntimeInShell,
  type AppShellProviderActionsHost
} from './lib/app-shell-provider-actions';
import {
  compactRunEventsInShell,
  exportActiveThreadDiagnosticsInShell,
  exportActiveThreadReportInShell,
  exportDiagnosticsInShell,
  loadStorageDiagnosticsInShell,
  maintainStorageInShell,
  refreshStorageDiagnosticsIfVisibleInShell,
  type AppShellDiagnosticsActionsHost
} from './lib/app-shell-diagnostics-actions';
import { deriveVisiblePlannerArtifacts } from './lib/planner-visibility';
import { deriveCurrentRunId, isActiveThreadStatus } from './lib/active-run';
import { hasAnyActiveThreadRun } from './lib/app-update';
import { applyOptimisticComposerTurn, buildComposerSubmitInput } from './lib/composer-submit';
import { deriveLatestProviderContextWindowUsage, estimateContextWindow } from './lib/context-window';
import { formatUserErrorMessage, parseWorkspaceUnavailableError } from './lib/error-format';
import { resolveDefaultProviderId, resolveProviderModelId } from './lib/provider-defaults';
import {
  SIDEBAR_COLLAPSED_WIDTH,
  SIDEBAR_CONTENT_REVEAL_WIDTH,
  SIDEBAR_DEFAULT_WIDTH,
  resolveTitlebarLeadingWidth,
  resolveStoredSidebarCollapsed
} from './lib/sidebar-layout';
import { useShellSidebarState } from './lib/use-shell-sidebar-state';
import { applyResolvedAppearance, getSystemPrefersDark, resolveAppearanceMode } from './lib/theme';
import { useAppThemeSync } from './lib/use-app-theme-sync';
import { describeReviewItem } from './lib/review-presentation';
import { useTranscriptAutoFollow } from './lib/use-transcript-auto-follow';
import { useVoiceDictation } from './lib/use-voice-dictation';
import { openCreatorInComposer as openCreatorInComposerFlow } from './lib/composer-creator-flow';
import { enhanceComposerPrompt as enhanceComposerPromptFlow } from './lib/composer-prompt-enhancement';
import { executeLeadingNativeSlashCommand as executeLeadingNativeSlashCommandFlow } from './lib/composer-native-command-flow';
import {
  appendVoiceTranscript,
  normalizeVoiceTranscript
} from './lib/voice-dictation';
import { AppSidebar } from './components/AppSidebar';
import { ChatUtilityPane } from './components/ChatUtilityPane';
import { PlannerPlanCard, PlannerPlanStatusRow, PlannerQuestionCard } from './components/PlannerArtifacts';
import { ToolApprovalPanel, formatApprovalToolLabel } from './components/ToolApprovalPanel';
import type { ComposerActivityItem } from './components/ComposerActivityShelf';
import { folderLabel } from './lib/folder-label';
import { EmptyThreadHero } from './components/EmptyThreadHero';
import { LandingBeams } from './components/LandingBeams';
import { InlineNotice } from './components/InlineNotice';
import { UiDevSurface } from './components/UiDevSurface';
import { type NativeComposerCommandId } from '../shared/nativeCommands';
import { normalizeDisplayText } from '../shared/display-text';
import { COLLABORATION_ENABLED } from '../shared/product-flags';
import {
  createProviderRecord,
  providerBlockedRunMessage,
  getProviderMetadata,
  providerAuthBrand,
  providerCanRunInComposer,
  providerCapabilities,
  providerDisplayName,
  providerModelRecommendationLabel,
  providerModelTriggerSummary,
  resolveProviderThinkingDefault
} from '../shared/providers';
import {
  applyRunProgressSnapshotEvent,
  deriveRunProgressFromPlanner,
  deriveRunProgressSnapshots
} from '../shared/run-progress';
import { splitPromptMentionedSkills } from '../shared/skills';
import { WindowsTitleBar } from './components/WindowsTitleBar';
import { ThemedWolfLogo } from './components/ThemedWolfLogo';
import {
  AutomationsRouteContainer,
  SettingsRouteContainer,
  SkillsRouteContainer,
  ThreadRouteContainer,
  type AutomationDraftState,
  type AutomationTemplate
} from './routes';
import { AccessIcon, ArrowLeftIcon, BookIcon, CheckIcon, CloseIcon, FolderIcon, NoteIcon } from './components/icons';
import { cx } from './components/ui/utils';
import { createEmptyCollaborationBootstrap, type CollaborationSection } from './lib/collaboration';

type ThreadDeleteTarget = {
  id: string;
  title: string;
  projectId: string | null;
};

type Route = 'thread' | 'collab' | 'skills' | 'automations' | 'settings' | 'ui-dev';
type ComposerEffort = 'Low' | 'Medium' | 'High' | 'Extra high';

const standaloneChatProjectName = 'Chats';

interface ComposerState {
  prompt: string;
  providerId: ProviderId;
  modelId: string;
  thinkingEnabled: boolean;
  mode: ComposerMode;
  executionPermission: ExecutionPermission;
  isolationMode: HarnessIsolationMode;
  imageAttachments: ImageAttachment[];
  textAttachments: TextAttachment[];
}

interface Toast {
  level: 'info' | 'warning' | 'error';
  title?: string;
  message: string;
  sticky?: boolean;
  actions?: Array<{
    label: string;
    tone?: 'primary' | 'quiet';
    onAction: () => void;
  }>;
}

function createAutomationDraft(providerId: ProviderId, modelId: string): AutomationDraftState {
  return {
    id: null,
    name: '',
    promptTemplate: '',
    providerId,
    modelId,
    skillId: '',
    scheduleType: 'manual',
    intervalMinutes: '60'
  };
}

function upsertSubagent(items: SubagentSummary[], subagent: SubagentSummary) {
  const next = items.filter((item) => item.id !== subagent.id);
  next.unshift(subagent);
  return next;
}

function findParentThreadIdForSubagentChild(
  subagentsByThreadId: Record<string, SubagentSummary[]>,
  childThreadId: string | null
) {
  if (!childThreadId) {
    return null;
  }

  for (const [parentThreadId, subagents] of Object.entries(subagentsByThreadId)) {
    if (subagents.some((subagent) => subagent.childThreadId === childThreadId)) {
      return parentThreadId;
    }
  }

  return null;
}

function shouldShowStartupWelcome() {
  return false;
}

function isMissingThreadError(error: unknown) {
  return error instanceof Error && /^Thread not found:/u.test(error.message);
}

function formatVoiceElapsed(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function isMicrophoneAccessBlocked(status: MicrophoneAccessStatus) {
  return status === 'denied' || status === 'restricted';
}

function formatMicrophoneAccessMessage(status: MicrophoneAccessStatus) {
  if (status === 'restricted') {
    return 'Microphone access is restricted by Windows. Update your device privacy settings and try again.';
  }

  return 'Microphone access is blocked by Windows. Enable microphone access for desktop apps in Windows Settings and try again.';
}

function resolveComposerReasoningEffort(
  providerId: ProviderId,
  effort: ComposerEffort
): ProviderReasoningEffort | null {
  if (providerId !== 'openai') {
    return null;
  }

  switch (effort) {
    case 'Low':
      return 'low';
    case 'Medium':
      return 'medium';
    case 'High':
      return 'high';
    case 'Extra high':
      return 'xhigh';
    default:
      return null;
  }
}

function mergeComposerSkillIds(attachedSkillIds: string[], mentionedSkillIds: string[]) {
  return Array.from(new Set([...attachedSkillIds, ...mentionedSkillIds]));
}

function appendMentionedSkillTokens(prompt: string, mentionedTokens: string[]) {
  if (mentionedTokens.length === 0) {
    return prompt.trim();
  }

  const trimmedPrompt = prompt.trim();
  return `${trimmedPrompt}${trimmedPrompt ? '\n\n' : ''}${mentionedTokens.join('\n')}`;
}

function composerEffortFromPreference(
  providerId: ProviderId,
  effort: ProviderReasoningEffort | null | undefined
): ComposerEffort {
  if (providerId !== 'openai') {
    return 'High';
  }

  switch (effort) {
    case 'low':
    case 'minimal':
    case 'none':
      return 'Low';
    case 'medium':
      return 'Medium';
    case 'xhigh':
      return 'Extra high';
    case 'high':
    default:
      return 'High';
  }
}

export function App() {
  const [startupThreadRestoreState, setStartupThreadRestoreState] = useState<'idle' | 'pending' | 'resolved' | 'failed'>('idle');
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [route, setRoute] = useState<Route>('thread');
  const [collaborationSection, setCollaborationSection] = useState<CollaborationSection>('chat');
  const [collaboration, setCollaboration] = useState<CollabBootstrap>(createEmptyCollaborationBootstrap());
  const [selectedCollaborationRoomId, setSelectedCollaborationRoomId] = useState('');
  const [selectedCollaborationChatId, setSelectedCollaborationChatId] = useState('');
  const [selectedCollaborationContactId, setSelectedCollaborationContactId] = useState('');
  const [projects, setProjects] = useState<Project[]>([]);
  const [threadsByProject, setThreadsByProject] = useState<Record<string, ThreadSummary[]>>({});
  const [recentThreads, setRecentThreads] = useState<ThreadSummary[]>([]);
  const [activeThread, setActiveThread] = useState<ThreadDetail | null>(null);
  const [autonomousTasksByThreadId, setAutonomousTasksByThreadId] = useState<Record<string, AutonomousTaskSummary[]>>({});
  const [subagentsByThreadId, setSubagentsByThreadId] = useState<Record<string, SubagentSummary[]>>({});
  const [skills, setSkills] = useState<SkillDefinition[]>([]);
  const [automations, setAutomations] = useState<AutomationDefinition[]>([]);
  const [jobs, setJobs] = useState<JobDefinition[]>([]);
  const [reviewItems, setReviewItems] = useState<ReviewItem[]>([]);
  const [providers, setProviders] = useState<ProviderDescriptor[]>([]);
  const [customProviders, setCustomProviders] = useState<CustomProviderSettings[]>([]);
  const [preferences, setPreferences] = useState<Preferences | null>(null);
  const [appMeta, setAppMeta] = useState<AppMeta | null>(null);
  const [librarySources, setLibrarySources] = useState<LibrarySourcesSnapshot | null>(null);
  const [projectKnowledgeIndexStatus, setProjectKnowledgeIndexStatus] = useState<ProjectKnowledgeIndexStatus | null>(null);
  const [appUpdateState, setAppUpdateState] = useState<AppUpdateState | null>(null);
  const [storageDiagnostics, setStorageDiagnostics] = useState<StorageDiagnostics | null>(null);
  const [archivedThreads, setArchivedThreads] = useState<ThreadSummary[]>([]);
  const [removingProjectId, setRemovingProjectId] = useState<string | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [expandedProjectIds, setExpandedProjectIds] = useState<string[]>([]);
  const [missingWorkspaceProjectId, setMissingWorkspaceProjectId] = useState<string | null>(null);
  const [settingsSection, setSettingsSection] = useState<SettingsSection>('general');
  const [lastContentRoute, setLastContentRoute] = useState<Exclude<Route, 'settings'>>('thread');
  const [composerEffort, setComposerEffort] = useState<ComposerEffort>('High');
  const [enhancingPrompt, setEnhancingPrompt] = useState(false);
  const [pendingNativeCommandId, setPendingNativeCommandId] = useState<NativeComposerCommandId | null>(null);
  const [composer, setComposer] = useState<ComposerState>({
    prompt: '',
    providerId: 'ollama',
    modelId: getProviderMetadata('ollama').defaultModelId,
    thinkingEnabled: resolveProviderThinkingDefault('ollama'),
    mode: 'default',
    executionPermission: 'default',
    isolationMode: 'direct_workspace',
    imageAttachments: [],
    textAttachments: []
  });
  const [attachedSkillIds, setAttachedSkillIds] = useState<string[]>([]);
  const [editingFollowUpId, setEditingFollowUpId] = useState<string | null>(null);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [runProgressByRunId, setRunProgressByRunId] = useState<Record<string, RunProgressState>>({});
  const [pendingRunToolApprovals, setPendingRunToolApprovals] = useState<RunToolApprovalRequest[]>([]);
  const [toolApprovalResolvingId, setToolApprovalResolvingId] = useState<string | null>(null);
  const [stagedWorkspaceReviewResolvingKey, setStagedWorkspaceReviewResolvingKey] = useState<string | null>(null);
  const [worktreeReviewResolvingKey, setWorktreeReviewResolvingKey] = useState<string | null>(null);
  const [ollamaPullProgress, setOllamaPullProgress] = useState<OllamaPullProgress | null>(null);
  const [ollamaRuntimeStatus, setOllamaRuntimeStatus] = useState<OllamaRuntimeSnapshot | null>(null);
  const [composerSubmitting, setComposerSubmitting] = useState(false);
  const deferredComposerPrompt = useDeferredValue(composer.prompt);
  const [plannerSubmitting, setPlannerSubmitting] = useState(false);
  const [planApproving, setPlanApproving] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const [activeImageAttachment, setActiveImageAttachment] = useState<ImageAttachment | null>(null);
  const [projectDraft, setProjectDraft] = useState({
    name: '',
    folderPath: '',
    trusted: false
  });
  const [reviewDraftEdits, setReviewDraftEdits] = useState<Record<string, string>>({});
  const [reviewDraftSavingId, setReviewDraftSavingId] = useState<string | null>(null);
  const [automationDraft, setAutomationDraft] = useState<AutomationDraftState>(() =>
    createAutomationDraft('ollama', getProviderMetadata('ollama').defaultModelId)
  );
  const [automationEditorOpen, setAutomationEditorOpen] = useState(false);
  const [automationDeleteId, setAutomationDeleteId] = useState<string | null>(null);
  const [automationHistoryId, setAutomationHistoryId] = useState<string | null>(null);
  const [automationHistoryRuns, setAutomationHistoryRuns] = useState<AutomationRun[]>([]);
  const [automationHistoryLoading, setAutomationHistoryLoading] = useState(false);
  const [apiKeys, setApiKeys] = useState<Record<ProviderId, string>>(() => createProviderRecord(() => ''));
  const [showStartupWelcome, setShowStartupWelcome] = useState(true);
  const appShellRef = useRef<HTMLDivElement | null>(null);
  const sidebarShellRef = useRef<HTMLDivElement | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const transcriptRef = useRef<HTMLElement | null>(null);
  const installPollingRef = useRef<Partial<Record<ProviderId, number>>>({});
  const selectedProjectIdRef = useRef<string | null>(null);
  const activeThreadIdRef = useRef<string | null>(null);
  const activeThreadEventBufferRef = useRef(createActiveThreadEventBuffer());
  const pendingLiveRunDeltaFrameRef = useRef<number | null>(null);
  const pendingReviewSectionRef = useRef<HTMLDivElement | null>(null);
  const pendingReviewToastShownRef = useRef(false);
  const pendingReviewRevealRequestedRef = useRef(false);
  const downloadedUpdateToastVersionRef = useRef<string | null>(null);
  const reviewItemsRef = useRef<ReviewItem[]>([]);
  const [deleteThreadTarget, setDeleteThreadTarget] = useState<ThreadDeleteTarget | null>(null);

  const bootstrapHost = {
    getExpandedProjectIds: () => expandedProjectIds,
    getToolApprovalResolvingId: () => toolApprovalResolvingId,
    getCollaborationSelection: () => ({
      roomId: selectedCollaborationRoomId,
      chatId: selectedCollaborationChatId,
      contactId: selectedCollaborationContactId
    }),
    loadBootstrap: () => window.vicode.app.getBootstrap(),
    loadCollaborationBootstrap: () => window.vicode.collab.getBootstrap(),
    loadAppMeta: () => window.vicode.app.getMeta(),
    loadUpdateState: () => window.vicode.updates.getState(),
    loadArchivedThreads: () => window.vicode.threads.listArchived(null),
    loadSkills: () => window.vicode.skills.list(),
    openThread: (threadId: string) => window.vicode.threads.open(threadId),
    clearLastOpenedThreadPreference: () => window.vicode.settings.save({ lastOpenedThreadId: null }),
    applyAppearance: (nextPreferences: Preferences) => {
      applyResolvedAppearance(resolveAppearanceMode(nextPreferences.appearanceMode, getSystemPrefersDark()));
    },
    applyOpenedThread,
    resolveComposerEffort: composerEffortFromPreference,
    shouldShowStartupWelcome,
    isMissingThreadError,
    showToast: (level: 'info' | 'warning' | 'error', message: string) => showToast(level, message),
    setLoading,
    setReady,
    setStartupThreadRestoreState,
    setProjects,
    setSkills,
    setAutomations,
    setJobs,
    setReviewItems,
    setProviders,
    setPendingRunToolApprovals,
    setToolApprovalResolvingId,
    setPreferences,
    setSelectedProjectId,
    setExpandedProjectIds,
    setThreadsByProject,
    setRecentThreads,
    setShowStartupWelcome,
    setCollaboration,
    setSelectedCollaborationRoomId,
    setSelectedCollaborationChatId,
    setSelectedCollaborationContactId,
    setComposerEffort,
    applyBootstrapComposerDefaults: (input: {
      providerId: ProviderId;
      modelId: string;
      thinkingEnabled: boolean;
      executionPermission: ExecutionPermission;
    }) => {
      setComposer((current) => ({
        ...current,
        providerId: input.providerId,
        modelId: input.modelId,
        thinkingEnabled: input.thinkingEnabled,
        mode: 'default',
        executionPermission: input.executionPermission,
        isolationMode: 'direct_workspace',
        imageAttachments: [],
        textAttachments: []
      }));
    },
    clearActiveThreadSelection: () => {
      setActiveThread(null);
      setActiveRunId(null);
    },
    setAppMeta,
    setAppUpdateState,
    setArchivedThreads
  };

  const threadSelectionHost = {
    findParentThreadId: (threadId: string) =>
      findParentThreadIdForSubagentChild(subagentsByThreadId, threadId),
    openThread: (threadId: string) => window.vicode.threads.open(threadId),
    listProjectThreads: (projectId: string) => window.vicode.threads.list(projectId),
    listArchivedThreads: (projectId?: string | null) => window.vicode.threads.listArchived(projectId ?? null),
    savePreferences: (input: Partial<Preferences>) => window.vicode.settings.save(input),
    getSelectedProjectId: () => selectedProjectId,
    getPreferences: () => preferences,
    isMissingThreadError,
    applyOpenedThread,
    showToast: (level: 'info' | 'warning' | 'error', message: string) => showToast(level, message),
    setPreferences,
    setSelectedProjectId,
    setSelectedProjectIdRef: (value: string | null) => {
      selectedProjectIdRef.current = value;
    },
    setExpandedProjectIds,
    setThreadsByProject,
    setArchivedThreads,
    setShowStartupWelcome,
    setActiveThread,
    setActiveThreadIdRef: (value: string | null) => {
      activeThreadIdRef.current = value;
    },
    setActiveRunId,
    setComposer,
    setRoute
  };

  const projectActionsHost = {
    getProjects: () => projects,
    getSelectedProjectId: () => selectedProjectId,
    getActiveThread: () => activeThread,
    getRoute: () => route,
    getComposerState: () => ({
      providerId: composer.providerId,
      modelId: composer.modelId,
      executionPermission: composer.executionPermission,
      mode: composer.mode
    }),
    getProjectDraft: () => projectDraft,
    getWorkspaceProject: () => workspaceProject,
    pickFolder: () => window.vicode.app.pickFolder(),
    createProject: (input: { name: string; folderPath: string | null; trusted: boolean }) =>
      window.vicode.projects.create(input),
    updateProject: (input: { id: string; name?: string; folderPath?: string; trusted?: boolean }) =>
      window.vicode.projects.update(input),
    removeProject: (projectId: string) => window.vicode.projects.remove(projectId),
    createThread: (input: {
      projectId: string;
      title: string;
      providerId: ProviderId;
      modelId: string;
      executionPermission: ExecutionPermission;
    }) => window.vicode.threads.create(input),
    setPlannerMode: (input: { threadId: string; mode: 'plan' }) => window.vicode.planner.setMode(input),
    archiveThread: (threadId: string) => window.vicode.threads.archive(threadId),
    savePreferences: (input: Partial<Preferences>) => window.vicode.settings.save(input),
    refreshThreads,
    refreshArchivedThreads,
    refreshStorageDiagnosticsIfVisible,
    selectProject,
    applyOpenedThread,
    showToast: (level: 'info' | 'warning' | 'error', message: string) => showToast(level, message),
    setProjects,
    setThreadsByProject,
    listProjectThreads: (projectId: string) => window.vicode.threads.list(projectId),
    setRecentThreads,
    setShowStartupWelcome,
    setMissingWorkspaceProjectId,
    setExpandedProjectIds,
    setProjectDraft,
    setRemovingProjectId,
    setArchivedThreads,
    setPreferences,
    setSelectedProjectId,
    setActiveThread,
    setActiveRunId,
    setAttachedSkillIds
  };

  const runReviewActionsHost = {
    runs: {
      applyStagedWorkspaceChange: (input: StagedWorkspaceReviewInput) =>
        window.vicode.runs.applyStagedWorkspaceChange(input),
      rejectStagedWorkspaceChange: (input: StagedWorkspaceReviewInput) =>
        window.vicode.runs.rejectStagedWorkspaceChange(input),
      revertStagedWorkspaceChange: (input: StagedWorkspaceReviewInput) =>
        window.vicode.runs.revertStagedWorkspaceChange(input),
      applyStagedWorkspaceHunks: (input: StagedWorkspaceHunkApplyInput) =>
        window.vicode.runs.applyStagedWorkspaceHunks(input),
      rejectStagedWorkspaceHunks: (input: StagedWorkspaceHunkRejectInput) =>
        window.vicode.runs.rejectStagedWorkspaceHunks(input),
      revertStagedWorkspaceHunks: (input: StagedWorkspaceHunkRevertInput) =>
        window.vicode.runs.revertStagedWorkspaceHunks(input),
      applyWorktreeReview: (input: WorktreeReviewInput) => window.vicode.runs.applyWorktreeReview(input),
      rejectWorktreeReview: (input: WorktreeReviewInput) => window.vicode.runs.rejectWorktreeReview(input),
      revertWorktreeReview: (input: WorktreeReviewInput) => window.vicode.runs.revertWorktreeReview(input),
      applyWorktreeHunks: (input: WorktreeHunkApplyInput) => window.vicode.runs.applyWorktreeHunks(input),
      rejectWorktreeHunks: (input: WorktreeHunkRejectInput) => window.vicode.runs.rejectWorktreeHunks(input),
      revertWorktreeHunks: (input: WorktreeHunkRevertInput) => window.vicode.runs.revertWorktreeHunks(input),
      cleanupWorktreeReview: (input: WorktreeCleanupInput) => window.vicode.runs.cleanupWorktreeReview(input)
    },
    applyReviewThread: (thread: ThreadDetail) => {
      activeThreadIdRef.current = thread.id;
      setActiveThread(thread);
      setRunProgressByRunId(deriveRunProgressSnapshots(thread.rawOutput));
      setActiveRunId((current) => deriveCurrentRunId(thread, current));
      setAttachedSkillIds(extractThreadSkillIds(thread));
    },
    setStagedWorkspaceReviewResolvingKey,
    setWorktreeReviewResolvingKey,
    showToast: (level: 'info' | 'warning' | 'error', message: string) => showToast(level, message)
  } satisfies AppShellRunReviewActionsHost;

  const providerActionsHost = {
    providers: {
      startAuth: (providerId: ProviderId, mode?: 'cli' | 'api_key', options?: { force?: boolean }) =>
        window.vicode.providers.startAuth(providerId, mode, options),
      adoptAuth: (providerId: ProviderId) => window.vicode.providers.adoptAuth(providerId),
      clearAuth: (providerId: ProviderId) => window.vicode.providers.clearAuth(providerId),
      refresh: (providerId: ProviderId) => window.vicode.providers.refresh(providerId),
      list: () => window.vicode.providers.list(),
      listCustom: () => window.vicode.providers.listCustom(),
      saveCustom: (input: CustomProviderSettingsSaveInput) => window.vicode.providers.saveCustom(input),
      removeCustom: (providerId: string) => window.vicode.providers.removeCustom(providerId),
      saveApiKey: (providerId: ProviderId, apiKey: string) => window.vicode.providers.saveApiKey(providerId, apiKey)
    },
    ollamaRuntime: {
      getStatus: () => window.vicode.ollamaRuntime.getStatus(),
      start: () => window.vicode.ollamaRuntime.start(),
      stop: () => window.vicode.ollamaRuntime.stop(),
      pullModel: (model: string) => window.vicode.ollamaRuntime.pullModel(model),
      deleteModel: (model: string) => window.vicode.ollamaRuntime.deleteModel(model)
    },
    installPollingTimers: installPollingRef.current,
    getVisibleProviders: () => visibleProviders,
    getComposerProviderState: () => ({
      providerId: composer.providerId,
      modelId: composer.modelId
    }),
    getApiKey: (providerId: ProviderId) => apiKeys[providerId],
    now: () => Date.now(),
    openInstallUrl: (url: string) => window.open(url, '_blank', 'noopener,noreferrer'),
    setInstallPollingInterval: (callback: () => void, delayMs: number) => window.setInterval(callback, delayMs),
    clearInstallPollingInterval: (timerId: number) => window.clearInterval(timerId),
    setProviders,
    setCustomProviders,
    setApiKeys,
    setComposerModelId: (providerId: ProviderId, modelId: string) =>
      setComposer((current) => (current.providerId === providerId ? { ...current, modelId } : current)),
    setOllamaPullProgress,
    setOllamaRuntimeStatus,
    showToast: (level: 'info' | 'warning' | 'error', message: string) => showToast(level, message)
  } satisfies AppShellProviderActionsHost;

  const diagnosticsActionsHost = {
    diagnostics: {
      export: () => window.vicode.diagnostics.export(),
      exportThread: (threadId: string) => window.vicode.diagnostics.exportThread(threadId),
      exportThreadReport: (threadId: string) => window.vicode.diagnostics.exportThreadReport(threadId),
      getStorage: () => window.vicode.diagnostics.getStorage(),
      compactRunEvents: () => window.vicode.diagnostics.compactRunEvents(),
      maintainStorage: (input?: { vacuum?: boolean }) => window.vicode.diagnostics.maintainStorage(input)
    },
    getActiveThread: () => activeThread,
    getRoute: () => route,
    getSettingsSection: () => settingsSection,
    getStorageDiagnostics: () => storageDiagnostics,
    setStorageDiagnostics,
    showToast: (level: 'info' | 'warning' | 'error', message: string) => showToast(level, message)
  } satisfies AppShellDiagnosticsActionsHost;

  const nativeTheme = useAppThemeSync(preferences);

  useEffect(() => {
    if (!ready) {
      return;
    }
    void refreshLibrarySources();
  }, [
    ready,
    preferences?.userLibraryPath,
    preferences?.skillsLibraryPath,
    preferences?.llmWikiLibraryPath
  ]);

  useThreadDraftSync({
    activeThreadId: activeThread?.id ?? null,
    activeThreadIdRef,
    prompt: composer.prompt,
    readLivePrompt: () => composerRef.current?.value ?? composer.prompt,
    setPrompt: (updater) => {
      setComposer((current) => ({ ...current, prompt: updater(current.prompt) }));
    },
    loadDraft: (threadId) => window.vicode.threads.getDraft(threadId),
    saveDraft: (threadId, prompt) => window.vicode.threads.saveDraft(threadId, prompt)
  });

  const {
    voiceAvailable,
    voiceState,
    voiceElapsedMs,
    voiceLevel,
    microphoneConsentOpen,
    setMicrophoneConsentOpen,
    handleComposerVoice,
    allowMicrophoneForApp
  } = useVoiceDictation({
    preferences,
    appendTranscript: (transcript) => appendDictationToComposer(transcript),
    savePreferences: (input) => window.vicode.settings.save(input),
    setPreferences,
    showToast: (level, message) => showToast(level, message),
    formatMicrophoneAccessMessage,
    isMicrophoneAccessBlocked,
    formatUserErrorMessage
  });

  const {
    sidebarCollapsed,
    sidebarWidth,
    sidebarResizing,
    sidebarResizeMaxWidth,
    toggleSidebarCollapsed,
    startSidebarResize
  } = useShellSidebarState({
    appShellRef,
    sidebarShellRef
  });

  function clearPendingLiveRunDeltaFrame() {
    if (pendingLiveRunDeltaFrameRef.current === null) {
      return;
    }

    window.cancelAnimationFrame(pendingLiveRunDeltaFrameRef.current);
    pendingLiveRunDeltaFrameRef.current = null;
  }

  function flushPendingLiveRunDeltas() {
    clearPendingLiveRunDeltaFrame();
    setActiveThreadEventBufferThread(activeThreadEventBufferRef.current, activeThreadIdRef.current);
    if (!hasActiveThreadDeltas(activeThreadEventBufferRef.current)) {
      return;
    }

    const createdAt = new Date().toISOString();
    const pending = drainActiveThreadDeltas(activeThreadEventBufferRef.current);
    setActiveThread((current) => applyActiveThreadDeltas(current, pending, createdAt));
  }

  function queuePendingLiveRunDelta(threadId: string, runId: string, delta: string) {
    setActiveThreadEventBufferThread(activeThreadEventBufferRef.current, activeThreadIdRef.current);
    const queued = queueActiveThreadDelta(activeThreadEventBufferRef.current, { threadId, runId, delta });
    if (!queued) {
      return;
    }

    if (pendingLiveRunDeltaFrameRef.current !== null) {
      return;
    }

    pendingLiveRunDeltaFrameRef.current = window.requestAnimationFrame(() => {
      pendingLiveRunDeltaFrameRef.current = null;
      flushPendingLiveRunDeltas();
    });
  }

  useEffect(() => {
    reviewItemsRef.current = reviewItems;
  }, [reviewItems]);

  useEffect(() => {
    setActiveThreadEventBufferThread(activeThreadEventBufferRef.current, activeThread?.id ?? null);
    clearPendingLiveRunDeltaFrame();
  }, [activeThread?.id]);

  useEffect(() => () => {
    clearActiveThreadEventBuffer(activeThreadEventBufferRef.current);
    clearPendingLiveRunDeltaFrame();
  }, []);

  const shellReady = ready && !loading;
  const showWelcomeScreen =
    shellReady &&
    route === 'thread' &&
    showStartupWelcome &&
    !activeThread;
  const contentRoute = route === 'settings' ? lastContentRoute : route;
  const showPrimarySidebar = shellReady && !showWelcomeScreen;
  const effectiveSidebarWidth = shellReady && !showWelcomeScreen
    ? sidebarCollapsed
      ? SIDEBAR_COLLAPSED_WIDTH
      : sidebarWidth
    : 0;
  const sidebarIconOnly = !sidebarCollapsed && effectiveSidebarWidth < SIDEBAR_CONTENT_REVEAL_WIDTH;
  const titlebarLeadingWidth = resolveTitlebarLeadingWidth(sidebarCollapsed || showWelcomeScreen || !shellReady, sidebarWidth);
  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId) ?? null,
    [projects, selectedProjectId]
  );
  const activeThreadProject = useMemo(
    () => projects.find((project) => project.id === activeThread?.projectId) ?? null,
    [activeThread?.projectId, projects]
  );
  const composerProjectId = activeThreadProject?.id ?? selectedProjectId;
  const workspaceProject = activeThreadProject ?? selectedProject;
  const threads = useMemo(
    () => (selectedProjectId ? threadsByProject[selectedProjectId] ?? [] : []),
    [selectedProjectId, threadsByProject]
  );
  const installedComposerSkills = useMemo(
    () =>
      skills.filter(
        (skill) =>
          skill.enabled &&
          (skill.scope === 'global' || skill.projectId === composerProjectId)
      ),
    [composerProjectId, skills]
  );
  const availableComposerSkills = useMemo(
    () => installedComposerSkills.filter((skill) => skill.providerTargets.includes(composer.providerId)),
    [composer.providerId, installedComposerSkills]
  );
  const availableAutomationSkills = useMemo(
    () => installedComposerSkills.filter((skill) => skill.providerTargets.includes(automationDraft.providerId)),
    [automationDraft.providerId, installedComposerSkills]
  );
  const visibleProviders = useMemo(() => surfaceProviders(providers), [providers]);
  const automationProvider = useMemo(
    () => visibleProviders.find((provider) => provider.id === automationDraft.providerId) ?? null,
    [automationDraft.providerId, visibleProviders]
  );
  const automationModelOptions = automationProvider?.models ?? [];
  const automationDeleteTarget = automationDeleteId
    ? automations.find((automation) => automation.id === automationDeleteId) ?? null
    : null;
  const automationHistoryTarget = automationHistoryId
    ? automations.find((automation) => automation.id === automationHistoryId) ?? null
    : null;
  const attachedComposerSkills = useMemo(
    () => skills.filter((skill) => attachedSkillIds.includes(skill.id)),
    [attachedSkillIds, skills]
  );
  const activeThreadProvider = useMemo(
    () => (activeThread ? visibleProviders.find((provider) => provider.id === activeThread.providerId) ?? null : null),
    [activeThread, visibleProviders]
  );
  const activeDisplayedRunId = useMemo(
    () => deriveCurrentRunId(activeThread, activeRunId),
    [activeRunId, activeThread]
  );
  const runActivityByRunId = useMemo(() => deriveRunActivityMap(activeThread), [activeThread]);
  const runTranscriptItemsByRunId = useMemo(() => deriveRunTranscriptItemsMap(activeThread), [activeThread]);
  const activeRunActivity = useMemo(
    () => (activeDisplayedRunId ? runActivityByRunId[activeDisplayedRunId] ?? null : null),
    [activeDisplayedRunId, runActivityByRunId]
  );
  const hasActiveRun = useMemo(
    () =>
      hasAnyActiveThreadRun({
        activeThread,
        threadsByProject
      }),
    [activeThread, threadsByProject]
  );
  const activePlanner = activeThread?.planner ?? null;
  const activeSubagents = useMemo(
    () => (activeThread ? subagentsByThreadId[activeThread.id] ?? [] : []),
    [activeThread, subagentsByThreadId]
  );
  const threadTitleById = useMemo(() => {
    const next = new Map<string, string>();
    for (const threads of Object.values(threadsByProject)) {
      for (const thread of threads) {
        next.set(thread.id, thread.title);
      }
    }
    if (activeThread) {
      next.set(activeThread.id, activeThread.title);
    }
    return next;
  }, [activeThread, threadsByProject]);
  const visiblePlannerArtifacts = useMemo(() => deriveVisiblePlannerArtifacts(activePlanner), [activePlanner]);
  const activePlannerQuestions = visiblePlannerArtifacts.questionSet;
  const activePlannerPlan = visiblePlannerArtifacts.plan;
  const activePlannerTurnState = activePlanner?.turnState ?? null;

  function resolveThreadTitle(threadId: string | null) {
    return threadId ? threadTitleById.get(threadId) ?? null : null;
  }

  useEffect(() => {
    setAutomationDraft((current) => {
      const preferredProviderId = current.id ? current.providerId : composer.providerId;
      const nextProviderId = visibleProviders.some((provider) => provider.id === preferredProviderId)
        ? preferredProviderId
        : composer.providerId;
      const preferredModelId = current.id ? current.modelId : composer.modelId;
      const nextModelId = resolveProviderModelId(visibleProviders, nextProviderId, preferredModelId);
      const skillStillAvailable =
        !current.skillId || installedComposerSkills.some((skill) => skill.id === current.skillId && skill.providerTargets.includes(nextProviderId));

      if (
        current.providerId === nextProviderId &&
        current.modelId === nextModelId &&
        skillStillAvailable
      ) {
        return current;
      }

      return {
        ...current,
        providerId: nextProviderId,
        modelId: nextModelId,
        skillId: skillStillAvailable ? current.skillId : ''
      };
    });
  }, [composer.modelId, composer.providerId, installedComposerSkills, visibleProviders]);

  const visibleThreadTurns = useMemo(
    () => (activeThread ? activeThread.turns.filter((turn) => isVisibleTranscriptTurn(turn)) : []),
    [activeThread]
  );
  const transcriptTurns = useMemo(
    () =>
      activeThread
        ? activeThread.turns.filter((turn) => isVisibleTranscriptTurn(turn))
        : [],
    [activeThread]
  );
  const lastVisibleUserTurnId = useMemo(
    () => [...visibleThreadTurns].reverse().find((turn) => turn.role === 'user')?.id ?? null,
    [visibleThreadTurns]
  );
  const transcriptRunAnchorTurnId = useMemo(() => {
    if (activePlannerTurnState === 'executing_from_plan') {
      return lastVisibleUserTurnId;
    }
    if (activeDisplayedRunId && activeThread && hasAssistantTurnForRun(activeThread, activeDisplayedRunId)) {
      return [...activeThread.turns].reverse().find((turn) => turn.role === 'assistant' && turn.runId === activeDisplayedRunId)?.id ?? lastVisibleUserTurnId;
    }
    return lastVisibleUserTurnId;
  }, [activeDisplayedRunId, activePlannerTurnState, activeThread, lastVisibleUserTurnId]);
  const activeRunProgress = useMemo(
    () =>
      (activeDisplayedRunId ? runProgressByRunId[activeDisplayedRunId] ?? null : null) ??
      (activeDisplayedRunId && activeThread
        ? deriveRunProgressFromPlanner(activePlannerPlan, activePlannerTurnState, activeDisplayedRunId, activeThread.id)
        : null),
    [activeDisplayedRunId, activePlannerPlan, activePlannerTurnState, activeThread, runProgressByRunId]
  );
  const activeRunToolApproval = useMemo(() => {
    if (!activeThread) {
      return null;
    }

    const approvalsForThread = pendingRunToolApprovals.filter(
      (approval) => approval.threadId === activeThread.id
    );
    if (approvalsForThread.length === 0) {
      return null;
    }

    if (activeDisplayedRunId) {
      return approvalsForThread.find((approval) => approval.runId === activeDisplayedRunId) ?? approvalsForThread[0];
    }

    return approvalsForThread[0];
  }, [activeDisplayedRunId, activeThread, pendingRunToolApprovals]);
  const composerActivityItems = useMemo<ComposerActivityItem[]>(() => {
    const items: ComposerActivityItem[] = [];

    if (activePlannerQuestions) {
      items.push({
        id: 'planner-questions',
        title: 'Build plan',
        summary: '',
        defaultOpen: true,
        variant: 'plain',
        content: (
          <PlannerQuestionCard
            questionSet={activePlannerQuestions}
            plannerPolicy={activeThreadProvider?.plannerPolicy ?? null}
            submitting={plannerSubmitting}
            onSubmit={submitPlannerAnswers}
            onCancelPlan={cancelPlannerSession}
          />
        )
      });
    } else if (activePlannerPlan) {
      const plannerProgressSummary =
        activePlannerPlan.status === 'approved' && activeRunProgress?.items.length
          ? `${activeRunProgress.items.filter((item) => item.status === 'completed').length}/${activeRunProgress.items.length} complete`
          : '';
      items.push({
        id: 'planner-plan',
        title: 'Build plan',
        summary: plannerProgressSummary,
        defaultOpen: activePlannerPlan.status !== 'approved' || activePlannerTurnState === 'executing_from_plan',
        variant: 'plain',
        content:
          activePlannerPlan.status === 'approved' ? (
            <PlannerPlanStatusRow
              plan={activePlannerPlan}
              runProgress={activeRunProgress}
            />
          ) : (
            <PlannerPlanCard
              plan={activePlannerPlan}
              plannerPolicy={activeThreadProvider?.plannerPolicy ?? null}
              renderedMarkdown={activePlannerPlan.proposedPlanMarkdown}
              approving={planApproving}
              submitting={plannerSubmitting}
              onApprove={() => approvePlannerPlan(activePlannerPlan)}
              onRequestChanges={requestPlannerChanges}
              onCancelPlan={cancelPlannerSession}
            />
          )
      });
    }

    if (activeRunToolApproval) {
      items.push({
        id: 'tool-approval',
        title: 'Pending approval',
        summary: formatApprovalToolLabel(activeRunToolApproval),
        defaultOpen: true,
        content: (
          <ToolApprovalPanel
            approval={activeRunToolApproval}
            providerLabel={providerDisplayName(activeRunToolApproval.providerId)}
            runtimeCommandPolicy={workspaceProject?.runtimeCommandPolicy}
            runtimeNetworkPolicy={workspaceProject?.runtimeNetworkPolicy}
            resolving={toolApprovalResolvingId === activeRunToolApproval.id}
            onApprove={() => void approveRunToolApproval(activeRunToolApproval.id)}
            onAutoApprove={() =>
              workspaceProject
                ? void enableWorkspaceAutoApproveAndApprove(
                    workspaceProject.id,
                    activeRunToolApproval.id
                  )
                : void approveRunToolApproval(activeRunToolApproval.id)
            }
            onReject={() => void rejectRunToolApproval(activeRunToolApproval.id)}
          />
        )
      });
    }

    return items;
  }, [
    activePlannerPlan,
    activePlannerQuestions,
    activePlannerTurnState,
    activeRunProgress,
    activeRunToolApproval,
    activeThread,
    activeThreadProvider?.plannerPolicy,
    approveRunToolApproval,
    enableWorkspaceAutoApproveAndApprove,
    plannerSubmitting,
    planApproving,
    rejectRunToolApproval,
    requestPlannerChanges,
    skills,
    submitPlannerAnswers,
    toolApprovalResolvingId,
    workspaceProject
  ]);
  const activeRunTranscriptItems = useMemo(
    () => (activeDisplayedRunId ? runTranscriptItemsByRunId[activeDisplayedRunId] ?? [] : []),
    [activeDisplayedRunId, runTranscriptItemsByRunId]
  );
  const threadSubagentSignature = useMemo(
    () =>
      Object.entries(threadsByProject)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([projectId, threads]) => `${projectId}:${threads.map((thread) => thread.id).join(',')}`)
        .join('|'),
    [threadsByProject]
  );
  const activeRunTranscriptAutoFollowKey = useMemo(
    () =>
      activeRunTranscriptItems
        .map((item) => {
          if (item.kind === 'assistant_text') {
            return `${item.kind}:${item.id}:${item.text.length}`;
          }
          if (item.kind === 'activity_line') {
            return `${item.kind}:${item.id}:${item.status ?? ''}:${item.outputLines.length}:${item.text.length}`;
          }
          if (item.kind === 'change_artifact') {
            return `${item.kind}:${item.id}:${item.artifact.files.length}:${item.label}`;
          }
          if (item.kind === 'staged_workspace_change') {
            return `${item.kind}:${item.id}:${item.change.status}:${item.change.changedPaths.length}:${item.change.insertions}:${item.change.deletions}`;
          }
          return `${item.kind}:${item.id}:${item.label}`;
        })
        .join('|'),
    [activeRunTranscriptItems]
  );

  const { markTranscriptUserScrollIntent, updateTranscriptAutoFollow } = useTranscriptAutoFollow({
    transcriptRef,
    route,
    activeThreadId: activeThread?.id ?? null,
    dependencyKey: [
      transcriptTurns.length,
      transcriptTurns[transcriptTurns.length - 1]?.id ?? '',
      transcriptTurns[transcriptTurns.length - 1]?.content ?? '',
      activeDisplayedRunId ?? '',
      activeRunTranscriptAutoFollowKey,
      activeRunActivity?.state ?? '',
      String(activeRunActivity?.timelineItems.length ?? 0),
      String(activeRunActivity?.terminalCommands.length ?? 0),
      activePlannerQuestions?.id ?? '',
      activePlannerPlan?.id ?? ''
    ].join('|')
  });

  useShellTaskSync({
    route,
    selectedProjectId,
    selectedProjectIdRef,
    activeThread,
    activeThreadIdRef,
    activeThreadParentId: activeThread ? findParentThreadIdForSubagentChild(subagentsByThreadId, activeThread.id) : null,
    startupThreadRestoreState,
    reviewItemsLength: reviewItems.length,
    threadSubagentSignature,
    threadsByProject,
    pendingReviewRevealRequestedRef,
    pendingReviewSectionRef,
    listAutomations: () => window.vicode.automations.list(),
    listJobs: () => window.vicode.jobs.list(),
    listPendingReviews: () => window.vicode.jobs.listPendingReviews(),
    listThreadSubagents: (threadId) => window.vicode.subagents.list(threadId),
    listThreadAutonomousTasks: (threadId) => window.vicode.threads.listAutonomousTasks(threadId),
    openThread,
    setAutomations,
    setJobs,
    setReviewItems,
    setSubagentsByThreadId,
    setAutonomousTasksByThreadId,
    setStartupThreadRestoreState
  });

  useEffect(() => {
    void refreshOllamaRuntimeStatus();
  }, []);

  useEffect(() => {
    if (activeThread || visibleProviders.length === 0 || !preferences) {
      return;
    }

    const currentProvider = visibleProviders.find((provider) => provider.id === composer.providerId) ?? null;
    if (currentProvider && providerCanRunInComposer(currentProvider)) {
      return;
    }

    const preferredProviderId = workspaceProject?.defaultProviderId ?? preferences.defaultProviderId;
    const nextProviderId = resolveDefaultProviderId(visibleProviders, preferredProviderId);
    const nextModelId = resolveProviderModelId(
      visibleProviders,
      nextProviderId,
      workspaceProject?.defaultModelByProvider[nextProviderId] ?? preferences.defaultModelByProvider[nextProviderId],
      { promoteStaleDefault: true }
    );
    const nextThinkingEnabled = preferences.defaultThinkingByProvider[nextProviderId];

    setComposer((current) =>
      current.providerId === nextProviderId && current.modelId === nextModelId
        ? current
        : {
          ...current,
          providerId: nextProviderId,
          modelId: nextModelId,
          thinkingEnabled: nextThinkingEnabled
        }
    );
  }, [activeThread, composer.providerId, preferences, visibleProviders, workspaceProject]);

  const composerProvider = visibleProviders.find((provider) => provider.id === composer.providerId) ?? null;
  const composerModel = composerProvider?.models.find((model) => model.id === composer.modelId) ?? null;

  const composerContextWindow = useMemo(() => {
    const providerUsage = activeThread
      ? deriveLatestProviderContextWindowUsage(activeThread.rawOutput, activeDisplayedRunId)
      : null;

    return estimateContextWindow({
      providerId: composer.providerId,
      modelId: composer.modelId,
      model: composerModel,
      turns: activeThread?.turns ?? [],
      prompt: deferredComposerPrompt,
      attachedSkills: attachedComposerSkills,
      imageAttachments: composer.imageAttachments,
      textAttachments: composer.textAttachments,
      baselineUsedTokens: providerUsage?.usedTokens ?? null
    });
  }, [
    activeDisplayedRunId,
    activeThread,
    attachedComposerSkills,
    composerModel,
    composer.imageAttachments,
    composer.textAttachments,
    composer.modelId,
    composer.providerId,
    deferredComposerPrompt
  ]);

  useEffect(() => {
    if (route !== 'settings') {
      setLastContentRoute(route);
    }
  }, [route]);

  useEffect(() => {
    if (!COLLABORATION_ENABLED && route === 'collab') {
      setRoute('thread');
    }
  }, [route]);

  useEffect(() => {
    setComposer((current) => ({
      ...current,
      modelId: resolveProviderModelId(visibleProviders, current.providerId, current.modelId, {
        promoteStaleDefault: true
      })
    }));
  }, [visibleProviders]);

  useEffect(() => {
    setAttachedSkillIds((current) =>
      current.filter((skillId) => availableComposerSkills.some((skill) => skill.id === skillId))
    );
  }, [availableComposerSkills]);

  useEffect(() => {
    void bootstrapAppShell(bootstrapHost);
    const unsubscribe = window.vicode.events.subscribe((event) => {
      void handleEvent(event);
    });
    return () => {
      unsubscribe();
      Object.values(installPollingRef.current).forEach((timer) => {
        if (timer) {
          window.clearInterval(timer);
        }
      });
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) {
        return;
      }
      const normalizedKey = event.key.toLowerCase();
      if (event.key === '1') {
        event.preventDefault();
        setRoute('thread');
      } else if (event.key === '2') {
        event.preventDefault();
        setRoute('skills');
      } else if (event.key === '3') {
        event.preventDefault();
        setSettingsSection('general');
        toggleSettingsRoute();
      } else if (COLLABORATION_ENABLED && event.key === '4') {
        event.preventDefault();
        setCollaborationSection('chat');
        setRoute('collab');
      } else if (import.meta.env.DEV && event.shiftKey && event.key.toLowerCase() === 'u') {
        event.preventDefault();
        setRoute((current) => (current === 'ui-dev' ? 'thread' : 'ui-dev'));
      } else if (event.key.toLowerCase() === 'n') {
        event.preventDefault();
        void createThread();
      } else if (event.key.toLowerCase() === 'l') {
        event.preventDefault();
        composerRef.current?.focus();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  async function createCollaborationGuestProfile(input: { displayName: string; handle?: string | null }) {
    try {
      await window.vicode.collab.createGuestProfile(input);
      await refreshCollaborationBootstrapState(bootstrapHost);
      showToast('info', 'Collaboration identity created.');
    } catch (error) {
      showToast('error', formatUserErrorMessage(error, 'Failed to create collaboration identity.'));
    }
  }

  async function clearCollaborationIdentity() {
    try {
      await window.vicode.collab.clearIdentity();
      await refreshCollaborationBootstrapState(bootstrapHost);
      showToast('info', 'Collaboration identity reset.');
    } catch (error) {
      showToast('error', formatUserErrorMessage(error, 'Failed to reset collaboration identity.'));
    }
  }

  async function saveCollaborationProfile(input: {
    displayName?: string;
    handle?: string | null;
    bio?: string | null;
    timezone?: string | null;
    status?: 'online' | 'away' | 'busy' | 'offline';
  }) {
    try {
      await window.vicode.collab.updateProfile(input);
      await refreshCollaborationBootstrapState(bootstrapHost);
      showToast('info', 'Profile updated.');
    } catch (error) {
      showToast('error', formatUserErrorMessage(error, 'Failed to update collaboration profile.'));
    }
  }

  async function createCollaborationRoom(input: { name: string; password?: string | null; topic?: string | null }) {
    try {
      const trimmedPassword = input.password?.trim();
      const room = await window.vicode.collab.createRoom({
        name: input.name,
        ...(trimmedPassword ? { password: trimmedPassword } : {}),
        topic: input.topic ?? null
      });
      await refreshCollaborationBootstrapState(bootstrapHost);
      setSelectedCollaborationRoomId(room.id);
      setSelectedCollaborationChatId('');
      setCollaborationSection('rooms');
      setRoute('collab');
      showToast('info', `Created room ${input.name}.`);
      return room;
    } catch (error) {
      showToast('error', formatUserErrorMessage(error, 'Failed to create the room.'));
      return null;
    }
  }

  async function joinCollaborationRoom(input: { joinCode: string; password?: string | null }) {
    try {
      const trimmedPassword = input.password?.trim();
      const room = await window.vicode.collab.joinRoom({
        joinCode: input.joinCode,
        ...(trimmedPassword ? { password: trimmedPassword } : {})
      });
      await refreshCollaborationBootstrapState(bootstrapHost);
      setSelectedCollaborationRoomId(room.id);
      setSelectedCollaborationChatId('');
      setCollaborationSection('rooms');
      setRoute('collab');
      showToast('info', 'Joined room.');
      return room;
    } catch (error) {
      showToast('error', formatUserErrorMessage(error, 'Failed to join the room.'));
      return null;
    }
  }

  async function createCollaborationDirectChat(input: { peerUserId: string }) {
    try {
      const room = await window.vicode.collab.createDirectChat(input);
      await refreshCollaborationBootstrapState(bootstrapHost);
      setSelectedCollaborationRoomId('');
      setSelectedCollaborationChatId(room.id);
      setSelectedCollaborationContactId(input.peerUserId);
      setCollaborationSection('chats');
      setRoute('collab');
      showToast('info', 'Direct chat opened.');
      return room;
    } catch (error) {
      showToast('error', formatUserErrorMessage(error, 'Failed to open the direct chat.'));
      return null;
    }
  }

  async function setCollaborationFollowing(roomId: string, following: boolean) {
    try {
      await window.vicode.collab.setFollowing({ roomId, following });
      await refreshCollaborationBootstrapState(bootstrapHost);
      showToast('info', following ? 'Follower mode enabled.' : 'Follower mode cleared.');
    } catch (error) {
      showToast('error', formatUserErrorMessage(error, 'Failed to update follower mode.'));
    }
  }

  async function requestCollaborationRole(roomId: string, requestedRole: 'contributor' | 'driver') {
    try {
      await window.vicode.collab.requestRole({ roomId, requestedRole });
      await refreshCollaborationBootstrapState(bootstrapHost);
      showToast('info', requestedRole === 'driver' ? 'Driver handoff requested.' : 'Contributor access requested.');
    } catch (error) {
      showToast('error', formatUserErrorMessage(error, 'Failed to submit the role request.'));
    }
  }

  async function resolveCollaborationRoleRequest(roomId: string, requestId: string, status: 'approved' | 'declined') {
    try {
      await window.vicode.collab.resolveRoleRequest({ roomId, requestId, status });
      await refreshCollaborationBootstrapState(bootstrapHost);
      showToast('info', status === 'approved' ? 'Role request approved.' : 'Role request declined.');
    } catch (error) {
      showToast('error', formatUserErrorMessage(error, 'Failed to update the role request.'));
    }
  }

  async function setCollaborationTerminalMode(roomId: string, mode: 'off' | 'announce_only', note?: string | null) {
    try {
      await window.vicode.collab.setTerminalMode({ roomId, mode, note: note ?? null });
      await refreshCollaborationBootstrapState(bootstrapHost);
      showToast('info', mode === 'off' ? 'Shared terminal mode disabled.' : 'Shared terminal mode enabled.');
    } catch (error) {
      showToast('error', formatUserErrorMessage(error, 'Failed to update shared terminal mode.'));
    }
  }

  async function sendCollaborationMessage(roomId: string, body: string) {
    try {
      await window.vicode.collab.sendMessage({ roomId, body });
      await refreshCollaborationBootstrapState(bootstrapHost);
      return true;
    } catch (error) {
      showToast('error', formatUserErrorMessage(error, 'Failed to send the message.'));
      return false;
    }
  }

  async function buildThreadCollaborationSummary(threadId: string) {
    try {
      return await window.vicode.threads.summarizeForCollaboration(threadId);
    } catch {
      return null;
    }
  }

  async function shareCurrentThreadWithRoom(roomId?: string | null) {
    if (!activeThread) {
      showToast('warning', 'Open a thread before sharing it.');
      return;
    }

    const fallbackRoomId =
      shareableCollaborationRooms.length === 1
        ? shareableCollaborationRooms[0]?.id ?? null
        : null;
    const targetRoomId = roomId ?? selectedCollaborationRoomId ?? fallbackRoomId;
    if (!targetRoomId) {
      openCollaborationSection('rooms');
      showToast(
        'warning',
        shareableCollaborationRooms.length === 0
          ? 'Create or join a collaboration room first.'
          : 'Choose a room from Collaboration or use the thread share menu.'
      );
      return;
    }

    const lastUserTurn = [...activeThread.turns].reverse().find((turn) => turn.role === 'user') ?? null;
    const lastAssistantTurn = [...activeThread.turns].reverse().find((turn) => turn.role === 'assistant') ?? null;
    const summary = await buildThreadCollaborationSummary(activeThread.id);

    try {
      await window.vicode.collab.shareThread({
        roomId: targetRoomId,
        threadId: activeThread.id,
        title: activeThread.title,
        projectId: activeThread.projectId,
        projectLabel: projects.find((project) => project.id === activeThread.projectId)?.name ?? null,
        status:
          activeThread.status === 'failed'
            ? 'failed'
            : activeThread.status === 'completed'
              ? 'completed'
              : activeThread.status === 'running'
                ? 'active'
                : 'idle',
        providerId: activeThread.providerId,
        modelId: activeThread.modelId,
        lastPromptSummary: summary?.lastPromptSummary ?? lastUserTurn?.content.slice(0, 240) ?? null,
        latestAssistantSummary: summary?.latestAssistantSummary ?? lastAssistantTurn?.content.slice(0, 240) ?? null,
        runId: activeDisplayedRunId ?? null
      });
      await refreshCollaborationBootstrapState(bootstrapHost);
      setSelectedCollaborationRoomId(targetRoomId);
      showToast('info', 'Thread shared to room.');
    } catch (error) {
      showToast('error', formatUserErrorMessage(error, 'Failed to share the thread.'));
    }
  }

  async function shareCurrentRunWithRoom(roomId?: string | null) {
    if (!activeThread || !activeDisplayedRunId) {
      showToast('warning', 'Start a run before sharing it.');
      return;
    }

    const targetRoomId = roomId ?? selectedCollaborationRoomId;
    if (!targetRoomId) {
      showToast('warning', 'Select a room first.');
      return;
    }

    const changedFiles = activeRunProgress?.changeArtifact?.files.map((file) => file.path) ?? [];
    const summary = await buildThreadCollaborationSummary(activeThread.id);
    try {
      await window.vicode.collab.shareRun({
        roomId: targetRoomId,
        threadId: activeThread.id,
        threadTitle: activeThread.title,
        runId: activeDisplayedRunId,
        providerId: activeThread.providerId,
        modelId: activeThread.modelId,
        executionPermission: activeThread.executionPermission,
        status:
          activeThread.status === 'failed'
            ? 'failed'
            : activeThread.status === 'completed'
              ? 'completed'
              : activeThread.status === 'running'
                ? 'running'
                : 'queued',
        taskTitle: activeRunProgress?.title ?? null,
        summary:
          activeRunProgress?.title ??
          summary?.latestAssistantSummary ??
          summary?.handoffSummary ??
          activeThread.lastPreview ??
          null,
        changedFiles,
        diffStats: activeRunProgress?.diffStats ?? null,
        testsSummary: null,
        resultLabel: activeThread.status,
        completedAt: activeThread.status === 'completed' || activeThread.status === 'failed' ? new Date().toISOString() : null
      });
      await refreshCollaborationBootstrapState(bootstrapHost);
      showToast('info', 'Run shared to room.');
    } catch (error) {
      showToast('error', formatUserErrorMessage(error, 'Failed to share the run.'));
    }
  }

  async function createCollaborationHandoff(roomId?: string | null) {
    if (!activeThread) {
      showToast('warning', 'Open a thread before creating a handoff.');
      return;
    }

    const targetRoomId = roomId ?? selectedCollaborationRoomId;
    if (!targetRoomId) {
      showToast('warning', 'Select a room first.');
      return;
    }

    const latestAssistantTurn = [...activeThread.turns].reverse().find((turn) => turn.role === 'assistant') ?? null;
    const summary = await buildThreadCollaborationSummary(activeThread.id);
    try {
      await window.vicode.collab.createHandoff({
        roomId: targetRoomId,
        threadId: activeThread.id,
        runId: activeDisplayedRunId ?? null,
        title: `Handoff: ${activeThread.title}`,
        summary:
          summary?.handoffSummary ??
          latestAssistantTurn?.content.slice(0, 500) ??
          activeThread.lastPreview ??
          'Continue the current task.',
        branchName: null,
        dirtyFileCount: activeRunProgress?.changeArtifact?.files.length ?? 0,
        stagedFileCount: 0,
        changedFiles: activeRunProgress?.changeArtifact?.files.map((file) => file.path) ?? [],
        outstandingTasks: activeRunProgress?.items.filter((item) => item.status !== 'completed').map((item) => item.label) ?? [],
        recommendedNextPrompt:
          summary?.recommendedNextPrompt ??
          latestAssistantTurn?.content.slice(0, 240) ??
          null
      });
      await refreshCollaborationBootstrapState(bootstrapHost);
      showToast('info', 'Handoff published.');
    } catch (error) {
      showToast('error', formatUserErrorMessage(error, 'Failed to publish the handoff.'));
    }
  }

  async function refreshThreads(projectId: string | null) {
    await refreshThreadsInShell(threadSelectionHost, projectId);
  }

  async function refreshArchivedThreads(projectId: string | null = null) {
    await refreshArchivedThreadsInShell(threadSelectionHost, projectId);
  }

  function syncThreadProjectSelection(projectId: string) {
    selectedProjectIdRef.current = projectId;
    setSelectedProjectId(projectId);
    setExpandedProjectIds((current) =>
      current.includes(projectId) ? current : [...current, projectId]
    );
  }

  function applyOpenedThread(detail: ThreadDetail, options?: { preserveRoute?: boolean }) {
    const hasLiveComposerDraft =
      (composerRef.current?.value ?? composer.prompt).trim().length > 0 ||
      composer.imageAttachments.length > 0 ||
      composer.textAttachments.length > 0;
    const preserveCurrentComposerDraft =
      activeThreadIdRef.current === detail.id && hasLiveComposerDraft;
    selectedProjectIdRef.current = detail.projectId;
    setSelectedProjectId(detail.projectId);
    setExpandedProjectIds((current) =>
      current.includes(detail.projectId) ? current : [...current, detail.projectId]
    );
    activeThreadIdRef.current = detail.id;
    setShowStartupWelcome(false);
    setActiveThread(detail);
    setRunProgressByRunId(deriveRunProgressSnapshots(detail.rawOutput));
    setActiveRunId(deriveCurrentRunId(detail, null));
    setAttachedSkillIds(extractThreadSkillIds(detail));
    if (!options?.preserveRoute) {
      setRoute('thread');
    }
    setComposerEffort(
      composerEffortFromPreference(
        detail.providerId,
        preferences?.defaultReasoningEffortByProvider[detail.providerId]
      )
    );
    setComposer((current) => ({
      ...current,
      prompt: preserveCurrentComposerDraft ? current.prompt : '',
      providerId: detail.providerId,
      modelId: resolveProviderModelId(visibleProviders, detail.providerId, detail.modelId),
      thinkingEnabled: preferences?.defaultThinkingByProvider[detail.providerId] ?? current.thinkingEnabled,
      mode: detail.planner.composerMode,
      imageAttachments: preserveCurrentComposerDraft ? current.imageAttachments : [],
      textAttachments: preserveCurrentComposerDraft ? current.textAttachments : []
    }));
  }

  async function openThread(threadId: string) {
    await openThreadInShell(threadSelectionHost, threadId);
  }

  async function selectProject(projectId: string, options?: { preserveMainView?: boolean }) {
    await selectProjectInShell(threadSelectionHost, projectId, options);
  }

  async function toggleProjectThreads(projectId: string) {
    await toggleProjectThreadsInShell(threadSelectionHost, projectId, expandedProjectIds);
  }

  function collapseAllProjectThreads() {
    setExpandedProjectIds([]);
  }

  async function openProjectFromPicker() {
    await openProjectFromPickerInShell(projectActionsHost);
  }

  async function repairWorkspaceProjectPath(project: Project | null) {
    await repairWorkspaceProjectPathInShell(projectActionsHost, project);
  }

  async function createProject() {
    await createProjectInShell(projectActionsHost);
  }

  async function attachFolder() {
    const folderPath = await window.vicode.app.pickFolder();
    if (folderPath) {
      setProjectDraft((current) => ({ ...current, folderPath }));
    }
  }

  async function trustProject(trusted: boolean) {
    await trustWorkspaceProject(projectActionsHost, trusted);
  }

  async function setProjectTrust(projectId: string, trusted: boolean) {
    await setProjectTrustInShell(projectActionsHost, projectId, trusted);
  }

  async function createThread() {
    await createThreadInShell(projectActionsHost);
  }

  async function createThreadForProject(projectId: string) {
    await createThreadForProjectInShell(projectActionsHost, projectId);
  }

  async function ensureStandaloneChatProject() {
    const existingProject = projects.find((project) => !project.folderPath) ?? null;
    if (existingProject) {
      return existingProject;
    }

    const project = await window.vicode.projects.create({
      name: standaloneChatProjectName,
      folderPath: null,
      trusted: true
    });
    setProjects((current) =>
      current.some((item) => item.id === project.id) ? current : [project, ...current]
    );
    setThreadsByProject((current) =>
      current[project.id] ? current : { ...current, [project.id]: [] }
    );
    return project;
  }

  async function activateChatsLibrary() {
    const project = await ensureStandaloneChatProject();
    await selectProject(project.id, { preserveMainView: true });
    if (activeThread?.projectId === project.id) {
      setShowStartupWelcome(false);
      setRoute('thread');
      return;
    }

    const projectThreads = await window.vicode.threads.list(project.id);
    setThreadsByProject((current) => ({ ...current, [project.id]: projectThreads }));
    const threadId = selectRestorableProjectThread(
      projectThreads,
      preferences?.lastOpenedThreadId
    );
    if (threadId) {
      await openThread(threadId);
      return;
    }

    await selectProject(project.id);
  }

  async function createChatThread() {
    const project = await ensureStandaloneChatProject();
    await createThreadForProject(project.id);
  }

  async function renameProject(projectId: string) {
    await renameProjectInShell(projectActionsHost, projectId);
    await refreshAppShellBootstrapState(bootstrapHost);
  }

  async function archiveProjectThreads(projectId: string) {
    await archiveProjectThreadsInShell(projectActionsHost, projectId);
  }

  async function removeProject(projectId: string) {
    await removeProjectInShell(projectActionsHost, projectId);
  }

  function reorderProjects(projectIds: string[]) {
    if (projectIds.length === 0) {
      return;
    }

    setProjects((current) => {
      const projectLookup = new Map(current.map((project) => [project.id, project]));
      const next = projectIds
        .map((projectId) => projectLookup.get(projectId) ?? null)
        .filter((project): project is Project => Boolean(project));

      if (next.length !== current.length) {
        return current;
      }

      if (next.every((project, index) => project.id === current[index]?.id)) {
        return current;
      }

      return next;
    });
  }

  async function executeLeadingNativeSlashCommand(prompt: string) {
    const activeComposerProvider =
      visibleProviders.find((provider) => provider.id === composer.providerId) ?? null;
    return executeLeadingNativeSlashCommandFlow(
      {
        enhancePromptBody: (body) =>
          enhanceComposerPromptFlow(
            {
              enhancePrompt: (input) => window.vicode.composer.enhancePrompt(input),
              setEnhancingPrompt,
              setComposerPrompt: (nextPrompt) =>
                setComposer((current) => ({
                  ...current,
                  prompt: nextPrompt
                })),
              clearPendingNativeCommand: () => setPendingNativeCommandId(null),
              showToast: (level, message) => showToast(level, message),
              focusComposer: () => requestAnimationFrame(() => composerRef.current?.focus())
            },
            {
              prompt: body,
              projectId: composerProjectId,
              providerId: composer.providerId,
              modelId: composer.modelId,
              reasoningEffort: resolveComposerReasoningEffort(
                composer.providerId,
                composerEffort
              ),
              thinkingEnabled: providerCapabilities(composer.providerId)
                .supportsThinkingToggle
                ? composer.thinkingEnabled
                : undefined,
              availableComposerSkills,
              emptyPromptMessage: 'Add some prose before enhancing the prompt.'
            }
          ),
        setComposerMode,
        setComposerPrompt: (nextPrompt) =>
          setComposer((current) => ({
            ...current,
            prompt: nextPrompt
          })),
        clearPendingNativeCommand: () => setPendingNativeCommandId(null),
        showToast: (level, message) => showToast(level, message),
        focusComposer: () => requestAnimationFrame(() => composerRef.current?.focus())
      },
      {
        prompt,
        pendingNativeCommandId,
        composer: {
          providerId: composer.providerId,
          modelId: composer.modelId,
          mode: composer.mode
        },
        composerEffort,
        resolveComposerReasoningEffort,
        activeThread,
        plannerSupported: Boolean(activeComposerProvider?.plannerPolicy.supported),
        providerLabel: activeComposerProvider?.label ?? null,
        availableComposerSkills
      }
    );
  }

  async function submitPrompt(
    promptOverride?: string,
    nativeCommandIdOverride?: NativeComposerCommandId | null
  ) {
    const activeComposerProvider =
      visibleProviders.find((provider) => provider.id === composer.providerId) ?? null;
    const effectivePrompt = promptOverride ?? composer.prompt;
    if (!composerProjectId || !effectivePrompt.trim() || composerSubmitting || plannerSubmitting) {
      return false;
    }
    if (editingFollowUpId) {
      await saveQueuedFollowUpEdit(editingFollowUpId);
      return true;
    }
    const handledLeadingSlashCommand =
      await executeLeadingNativeSlashCommandFlow(
        {
          enhancePromptBody: (body) =>
            enhanceComposerPromptFlow(
              {
                enhancePrompt: (input) => window.vicode.composer.enhancePrompt(input),
                setEnhancingPrompt,
                setComposerPrompt: (nextPrompt) =>
                  setComposer((current) => ({
                    ...current,
                    prompt: nextPrompt
                  })),
                clearPendingNativeCommand: () => setPendingNativeCommandId(null),
                showToast: (level, message) => showToast(level, message),
                focusComposer: () => requestAnimationFrame(() => composerRef.current?.focus())
              },
              {
                prompt: body,
                projectId: composerProjectId,
                providerId: composer.providerId,
                modelId: composer.modelId,
                reasoningEffort: resolveComposerReasoningEffort(
                  composer.providerId,
                  composerEffort
                ),
                thinkingEnabled: providerCapabilities(composer.providerId)
                  .supportsThinkingToggle
                  ? composer.thinkingEnabled
                  : undefined,
                availableComposerSkills,
                emptyPromptMessage: 'Add some prose before enhancing the prompt.'
              }
            ),
          setComposerMode,
          setComposerPrompt: (nextPrompt) =>
            setComposer((current) => ({
              ...current,
              prompt: nextPrompt
            })),
          clearPendingNativeCommand: () => setPendingNativeCommandId(null),
          showToast: (level, message) => showToast(level, message),
          focusComposer: () => requestAnimationFrame(() => composerRef.current?.focus())
        },
        {
          prompt: effectivePrompt,
          pendingNativeCommandId: nativeCommandIdOverride ?? pendingNativeCommandId,
          composer: {
            providerId: composer.providerId,
            modelId: composer.modelId,
            mode: composer.mode
          },
          composerEffort,
          resolveComposerReasoningEffort,
          activeThread,
          plannerSupported: Boolean(activeComposerProvider?.plannerPolicy.supported),
          providerLabel: activeComposerProvider?.label ?? null,
          availableComposerSkills
        }
      );
    if (handledLeadingSlashCommand) {
      return false;
    }

    const activeProvider = visibleProviders.find((provider) => provider.id === composer.providerId);
    const activeModel = activeProvider?.models.find((model) => model.id === composer.modelId) ?? null;
    if (!activeProvider || !providerCanRunInComposer(activeProvider)) {
      showToast(
        'error',
        activeProvider
          ? providerBlockedRunMessage(activeProvider)
          : 'This provider is not ready. Finish setup in Settings > Providers.'
      );
      return false;
    }
    if (activeProvider.authState === 'checking') {
      showToast('info', providerBlockedRunMessage(activeProvider));
      return false;
    }
    if (activeProvider.authState === 'detected') {
      showToast('warning', providerBlockedRunMessage(activeProvider));
      return false;
    }
    if (activeProvider.authState === 'disconnected' || activeProvider.authState === 'missing_cli') {
      showToast('warning', providerBlockedRunMessage(activeProvider));
      return false;
    }
    if (workspaceProject?.folderPath && !workspaceProject.trusted) {
      showToast(
        'warning',
        `This workspace is not trusted yet. Click Enable workspace in the header before running ${providerDisplayName(composer.providerId)}.`
      );
      return false;
    }
    if (composer.providerId !== 'ollama' && composer.imageAttachments.length > 0 && activeModel?.supportsVision === false) {
      showToast('warning', `${activeModel.label} does not support image input. Choose a vision-capable model first.`);
      return false;
    }
    const input: ComposerSubmitInput = buildComposerSubmitInput({
      projectId: composerProjectId,
      threadId: activeThreadIdRef.current ?? activeThread?.id ?? null,
      prompt: effectivePrompt,
      providerId: composer.providerId,
      modelId: composer.modelId,
      reasoningEffort: resolveComposerReasoningEffort(composer.providerId, composerEffort),
      thinkingEnabled: providerCapabilities(composer.providerId).supportsThinkingToggle ? composer.thinkingEnabled : undefined,
      executionPermission: composer.executionPermission,
      isolationMode: composer.isolationMode,
      skillIds: mergeComposerSkillIds(
        attachedSkillIds,
        splitPromptMentionedSkills(effectivePrompt, availableComposerSkills).mentionedSkillIds
      ),
      imageAttachments: composer.imageAttachments,
      textAttachments: composer.textAttachments
    });
    const submittedPrompt = input.prompt;
    const submittedImageAttachments = [...(input.imageAttachments ?? [])];
    const submittedTextAttachments = [...(input.textAttachments ?? [])];
    const previousActiveThread = activeThread;
    const optimisticThread =
      composer.mode === 'default' &&
      previousActiveThread &&
      previousActiveThread.id === input.threadId &&
      !isActiveThreadStatus(previousActiveThread.status)
        ? applyOptimisticComposerTurn(
            previousActiveThread,
            {
              prompt: input.prompt,
              executionPermission: input.executionPermission,
              isolationMode: input.isolationMode,
              skillIds: input.skillIds,
              imageAttachments: input.imageAttachments ?? [],
              textAttachments: input.textAttachments ?? []
            },
            new Date().toISOString()
          )
        : null;

    const restoreComposerDraft = () => {
      setComposer((current) => ({
        ...current,
        prompt: submittedPrompt,
        imageAttachments: submittedImageAttachments,
        textAttachments: submittedTextAttachments
      }));
      if (optimisticThread && previousActiveThread) {
        setActiveThread(previousActiveThread);
      }
    };

    setComposerSubmitting(true);
    setComposer((current) => ({
      ...current,
      prompt: '',
      imageAttachments: [],
      textAttachments: []
    }));
    if (optimisticThread) {
      setShowStartupWelcome(false);
      setActiveThread(optimisticThread.thread);
    }

    if (composer.mode === 'plan') {
      setPlannerSubmitting(true);
      let result: Awaited<ReturnType<typeof window.vicode.planner.submit>>;
      try {
        result = await window.vicode.planner.submit(input);
      } catch (error) {
        restoreComposerDraft();
        if (!showWorkspaceRepairToast(error, workspaceProject)) {
        showToast('error', formatUserErrorMessage(error, 'Failed to start Plan mode.'));
      }
      setPlannerSubmitting(false);
      setComposerSubmitting(false);
      return false;
      }
      setMissingWorkspaceProjectId((current) => (workspaceProject && current === workspaceProject.id ? null : current));
      setShowStartupWelcome(false);
      syncThreadProjectSelection(result.thread.projectId);
      setActiveThread(result.thread);
      setActiveRunId(result.runId);
      setComposer((current) => ({
        ...current,
        prompt: '',
        mode: 'plan',
        executionPermission: result.thread.executionPermission,
        imageAttachments: [],
        textAttachments: []
      }));
      void refreshThreads(result.thread.projectId).catch((error) => {
        showToast('warning', formatUserErrorMessage(error, 'Plan started, but the thread list could not refresh.'));
      });
      setPlannerSubmitting(false);
      setComposerSubmitting(false);
      return true;
    }

    let result: ComposerSubmitResult;
    try {
      result = await window.vicode.composer.submit(input);
    } catch (error) {
      restoreComposerDraft();
      if (!showWorkspaceRepairToast(error, workspaceProject)) {
        showToast('error', formatUserErrorMessage(error, 'Failed to start the run.'));
      }
      setComposerSubmitting(false);
      return false;
    }
    setMissingWorkspaceProjectId((current) => (workspaceProject && current === workspaceProject.id ? null : current));
    setShowStartupWelcome(false);
    syncThreadProjectSelection(result.thread.projectId);
    setActiveThread(result.thread);
    setComposer((current) => ({
      ...current,
      prompt: '',
      executionPermission: result.thread.executionPermission,
      imageAttachments: [],
      textAttachments: []
    }));
    if (result.disposition === 'started') {
      setActiveRunId(result.runId);
    } else {
      setEditingFollowUpId(null);
      showToast('info', result.queuedFollowUp.kind === 'steer' ? 'Steering request queued. The current run is stopping.' : 'Message queued for the next turn.');
    }
    void refreshThreads(result.thread.projectId).catch((error) => {
      showToast('warning', formatUserErrorMessage(error, 'Run started, but the thread list could not refresh.'));
    });
    setComposerSubmitting(false);
    return true;
  }

  function editQueuedFollowUp(followUp: ThreadFollowUp) {
    setEditingFollowUpId(followUp.id);
    setComposer((current) => ({
      ...current,
      prompt: followUp.content
    }));
    requestAnimationFrame(() => composerRef.current?.focus());
  }

  async function removeQueuedFollowUp(followUpId: string) {
    try {
      await window.vicode.threads.removeFollowUp(followUpId);
      if (editingFollowUpId === followUpId) {
        setEditingFollowUpId(null);
      }
      if (activeThread) {
        setActiveThread(await window.vicode.threads.open(activeThread.id));
      }
    } catch (error) {
      showToast('error', formatUserErrorMessage(error, 'Failed to delete queued message.'));
    }
  }

  async function saveQueuedFollowUpEdit(followUpId: string) {
    if (!composer.prompt.trim()) {
      showToast('warning', 'Queued message cannot be empty.');
      return;
    }

    try {
      await window.vicode.threads.updateFollowUp(followUpId, composer.prompt.trim());
      setEditingFollowUpId(null);
      setComposer((current) => ({
        ...current,
        prompt: '',
        imageAttachments: [],
        textAttachments: []
      }));
      if (activeThread) {
        setActiveThread(await window.vicode.threads.open(activeThread.id));
      }
      showToast('info', 'Queued message updated.');
    } catch (error) {
      showToast('error', formatUserErrorMessage(error, 'Failed to update queued message.'));
    }
  }

  async function enhanceComposerPrompt(promptOverride?: string) {
    const prompt = promptOverride ?? composer.prompt;
    if (composer.providerId === 'openai_compatible' && prompt.trim()) {
      showToast('warning', 'Prompt enhancement is not available for Custom API yet.');
      return;
    }

    await enhanceComposerPromptFlow(
      {
        enhancePrompt: (input) => window.vicode.composer.enhancePrompt(input),
        setEnhancingPrompt,
        setComposerPrompt: (prompt) =>
          setComposer((current) => ({
            ...current,
            prompt
          })),
        clearPendingNativeCommand: () => setPendingNativeCommandId(null),
        showToast: (level, message) => showToast(level, message),
        focusComposer: () => requestAnimationFrame(() => composerRef.current?.focus())
      },
      {
        prompt,
        projectId: composerProjectId,
        providerId: composer.providerId,
        modelId: composer.modelId,
        reasoningEffort: resolveComposerReasoningEffort(composer.providerId, composerEffort),
        thinkingEnabled: providerCapabilities(composer.providerId).supportsThinkingToggle
          ? composer.thinkingEnabled
          : undefined,
        availableComposerSkills,
        emptyPromptMessage: 'Write something first, then enhance it.'
      }
    );
  }

  async function stopPrompt() {
    if (activeRunId) {
      await window.vicode.composer.stop(activeRunId);
    }
  }

  async function setComposerMode(mode: ComposerMode): Promise<ComposerMode> {
    try {
      const activeComposerProvider = visibleProviders.find((provider) => provider.id === composer.providerId) ?? null;
      if (mode === 'plan' && !activeComposerProvider?.plannerPolicy.supported) {
        showToast(
          'warning',
          `${activeComposerProvider?.label ?? providerDisplayName(composer.providerId)} does not support native Plan mode yet. Use /plan with a request to apply a planning prompt instead.`
        );
        return composer.mode;
      }

      if (activeThread) {
        const thread = await window.vicode.planner.setMode({ threadId: activeThread.id, mode });
        setActiveThread(thread);
        setComposer((current) => ({ ...current, mode: thread.planner.composerMode }));
        return thread.planner.composerMode;
      }

      setComposer((current) => ({ ...current, mode }));
      return mode;
    } catch (error) {
      showToast('error', error instanceof Error ? error.message : 'Failed to update Plan mode.');
      return composer.mode;
    }
  }

  async function toggleComposerMode() {
    return await setComposerMode(composer.mode === 'plan' ? 'default' : 'plan');
  }

  async function cancelPlannerSession() {
    if (!activeThread) {
      return;
    }

    setPlannerSubmitting(true);
    try {
      const thread = await window.vicode.planner.cancel({ threadId: activeThread.id });
      syncThreadProjectSelection(thread.projectId);
      setActiveThread(thread);
      setActiveRunId(null);
      setComposer((current) => ({
        ...current,
        mode: thread.planner.composerMode,
        executionPermission: thread.executionPermission
      }));
      await refreshThreads(thread.projectId);
      showToast('info', 'Build plan cancelled.');
    } catch (error) {
      showToast('error', formatUserErrorMessage(error, 'Failed to cancel the plan.'));
    } finally {
      setPlannerSubmitting(false);
    }
  }

  async function submitPlannerAnswers(answers: Record<string, PlannerQuestionAnswer>) {
    if (!activeThread?.planner.pendingQuestionSet) {
      return;
    }

    setPlannerSubmitting(true);
    try {
      const result = await window.vicode.planner.answer({
        threadId: activeThread.id,
        callId: activeThread.planner.pendingQuestionSet.callId,
        answers
      });
      syncThreadProjectSelection(result.thread.projectId);
      setActiveThread(result.thread);
      setActiveRunId(result.runId);
      setComposer((current) => ({
        ...current,
        executionPermission: result.thread.executionPermission
      }));
      await refreshThreads(result.thread.projectId);
    } catch (error) {
      showToast('error', formatUserErrorMessage(error, 'Failed to submit planner answers.'));
    } finally {
      setPlannerSubmitting(false);
    }
  }

  async function approvePlannerPlan(plan: PlannerPlan) {
    if (!activeThread) {
      return;
    }

    setPlanApproving(true);
    try {
      const result = await window.vicode.planner.approvePlan({
        threadId: activeThread.id,
        planId: plan.id
      });
      syncThreadProjectSelection(result.thread.projectId);
      setActiveThread(result.thread);
      setActiveRunId(result.runId);
      setComposer((current) => ({
        ...current,
        mode: 'default',
        executionPermission: result.thread.executionPermission
      }));
      await refreshThreads(result.thread.projectId);
    } catch (error) {
      showToast('error', formatUserErrorMessage(error, 'Failed to approve the plan.'));
    } finally {
      setPlanApproving(false);
    }
  }

  async function requestPlannerChanges(instructions: string) {
    if (!activeThread) {
      return;
    }

    const nextPrompt = instructions.trim();
    if (!nextPrompt) {
      showToast('warning', 'Add a short revision request first.');
      return;
    }

    setPlannerSubmitting(true);
    try {
      const result = await window.vicode.planner.submit({
        projectId: activeThread.projectId,
        threadId: activeThread.id,
        prompt: nextPrompt,
        providerId: activeThread.providerId,
        modelId: activeThread.modelId,
        reasoningEffort: resolveComposerReasoningEffort(activeThread.providerId, composerEffort),
        thinkingEnabled: providerCapabilities(activeThread.providerId).supportsThinkingToggle ? composer.thinkingEnabled : undefined,
        executionPermission: activeThread.executionPermission,
        skillIds: mergeComposerSkillIds(
          attachedSkillIds,
          splitPromptMentionedSkills(composer.prompt, availableComposerSkills).mentionedSkillIds
        ),
        imageAttachments: [],
        textAttachments: []
      });
      syncThreadProjectSelection(result.thread.projectId);
      setActiveThread(result.thread);
      setActiveRunId(result.runId);
      setComposer((current) => ({
        ...current,
        executionPermission: result.thread.executionPermission
      }));
      await refreshThreads(result.thread.projectId);
    } catch (error) {
      showToast('error', formatUserErrorMessage(error, 'Failed to update the plan.'));
    } finally {
      setPlannerSubmitting(false);
    }
  }

  function selectComposerModel(providerId: ProviderId, modelId: string) {
    const nextModelId = resolveProviderModelId(visibleProviders, providerId, modelId);
    const providerChanged = providerId !== composer.providerId;
    if (providerId === 'openai') {
      setComposerEffort(
        composerEffortFromPreference(
          providerId,
          preferences?.defaultReasoningEffortByProvider[providerId]
        )
      );
    }
    if (providerChanged) {
      setPendingNativeCommandId(null);
    }

    setComposer((current) => ({
      ...current,
      providerId,
      modelId: nextModelId,
      mode: providerChanged ? 'default' : current.mode,
      thinkingEnabled: preferences?.defaultThinkingByProvider[providerId] ?? current.thinkingEnabled
    }));

    if (workspaceProject) {
      void window.vicode.projects
        .update({
          id: workspaceProject.id,
          defaultProviderId: providerId,
          defaultModelId: nextModelId
        })
        .then((project) => {
          setProjects((current) => current.map((item) => (item.id === project.id ? project : item)));
        })
        .catch(() => {});
    }

    void saveDefaultPreferences({
      defaultProviderId: providerId,
      defaultModelByProvider: createProviderRecord((candidateProviderId) =>
        providerId === candidateProviderId
          ? nextModelId
          : preferences?.defaultModelByProvider[candidateProviderId] ?? getProviderMetadata(candidateProviderId).defaultModelId
      )
    });
  }

  async function setExecutionPermission(executionPermission: ExecutionPermission) {
    if (composer.executionPermission === executionPermission) {
      return;
    }

    if (!activeThread) {
      setComposer((current) => ({ ...current, executionPermission }));
      void saveDefaultPreferences({
        defaultExecutionPermission: executionPermission
      });
      return;
    }

    const previous = activeThread.executionPermission;
    setComposer((current) => ({ ...current, executionPermission }));

    try {
      const thread = await window.vicode.threads.setExecutionPermission(activeThread.id, executionPermission);
      setActiveThread(thread);
      setThreadsByProject((current) => ({
        ...current,
        [thread.projectId]: (current[thread.projectId] ?? []).map((item) =>
          item.id === thread.id ? { ...item, executionPermission } : item
        )
      }));
      void saveDefaultPreferences({
        defaultExecutionPermission: executionPermission
      });
    } catch (error) {
      setComposer((current) => ({ ...current, executionPermission: previous }));
      showToast('error', formatUserErrorMessage(error, 'Failed to update execution permissions.'));
    }
  }

  function setIsolationMode(isolationMode: HarnessIsolationMode) {
    setComposer((current) => ({ ...current, isolationMode }));
  }

  function selectComposerEffort(effort: ComposerEffort) {
    setComposerEffort(effort);
    if (composer.providerId !== 'openai') {
      return;
    }

    void saveDefaultPreferences({
      defaultReasoningEffortByProvider: createProviderRecord((providerId) =>
        providerId === 'openai'
          ? resolveComposerReasoningEffort('openai', effort)
          : preferences?.defaultReasoningEffortByProvider[providerId] ?? getProviderMetadata(providerId).defaultReasoningEffort
      )
    });
  }

  function appendDictationToComposer(transcript: string) {
    const normalizedTranscript = normalizeVoiceTranscript(transcript);
    if (!normalizedTranscript) {
      return false;
    }

    setComposer((current) => ({
      ...current,
      prompt: appendVoiceTranscript(current.prompt, normalizedTranscript)
    }));
    window.setTimeout(() => composerRef.current?.focus(), 0);
    return true;
  }

  async function addComposerImageFiles(files: File[]) {
    if (files.length === 0) {
      return;
    }

    const existing = composer.imageAttachments.length;
    const remainingSlots = Math.max(0, 4 - existing);
    if (remainingSlots === 0) {
      showToast('warning', 'You can attach up to 4 images per message.');
      return;
    }

    const supportedFiles = files
      .filter((file) => file.type.startsWith('image/'))
      .slice(0, remainingSlots);

    if (supportedFiles.length === 0) {
      showToast('warning', 'Paste image files into the composer to attach them.');
      return;
    }

    const oversized = supportedFiles.find((file) => file.size > 5 * 1024 * 1024);
    if (oversized) {
      showToast('warning', `${oversized.name} is larger than 5 MB.`);
      return;
    }

    const attachments = await Promise.all(
      supportedFiles.map(
        (file) =>
          new Promise<ImageAttachment>((resolve, reject) => {
            const reader = new FileReader();
            reader.onerror = () => reject(new Error(`Failed to read ${file.name}.`));
            reader.onload = () =>
              resolve({
                id: crypto.randomUUID(),
                name: file.name || 'image.png',
                mimeType: file.type || 'image/png',
                dataUrl: String(reader.result ?? '')
              });
            reader.readAsDataURL(file);
          })
      )
    );

    setComposer((current) => ({
      ...current,
      imageAttachments: [...current.imageAttachments, ...attachments]
    }));

    if (files.length > remainingSlots) {
      showToast('warning', 'Only the first 4 pasted images were attached.');
    }
  }

  async function addComposerTextAttachment(content: string, fileName?: string | null) {
    if (!composerProjectId || !workspaceProject?.folderPath) {
      showToast('warning', 'Select a workspace project before attaching large pasted text.');
      return false;
    }
    if (!workspaceProject.trusted) {
      showToast('warning', 'Enable the workspace first so Vicode can store large pasted text as a workspace file.');
      return false;
    }

    try {
      const attachment = await window.vicode.composer.createTextAttachment({
        projectId: composerProjectId,
        content,
        fileName
      });
      setComposer((current) => ({
        ...current,
        textAttachments: [...current.textAttachments, attachment]
      }));
      showToast('info', `Attached ${attachment.name} as a workspace text file.`);
      return true;
    } catch (error) {
      showToast('error', formatUserErrorMessage(error, 'Unable to attach the pasted text as a file.'));
      return false;
    }
  }

  function removeComposerImageAttachment(attachmentId: string) {
    setComposer((current) => ({
      ...current,
      imageAttachments: current.imageAttachments.filter((attachment) => attachment.id !== attachmentId)
    }));
  }

  async function removeComposerTextAttachment(attachmentId: string) {
    const attachment = composer.textAttachments.find((item) => item.id === attachmentId);
    if (!attachment || !composerProjectId) {
      return;
    }

    setComposer((current) => ({
      ...current,
      textAttachments: current.textAttachments.filter((item) => item.id !== attachmentId)
    }));

    try {
      await window.vicode.composer.deleteTextAttachment({
        projectId: composerProjectId,
        attachment
      });
    } catch (error) {
      setComposer((current) => ({
        ...current,
        textAttachments: current.textAttachments.some((item) => item.id === attachment.id)
          ? current.textAttachments
          : [...current.textAttachments, attachment]
      }));
      showToast('warning', formatUserErrorMessage(error, 'The text attachment could not be removed from the workspace.'));
    }
  }

  function findKnownThread(threadId: string | null) {
    if (!threadId) {
      return null;
    }

    if (activeThread?.id === threadId) {
      return activeThread;
    }

    return Object.values(threadsByProject)
      .flat()
      .find((item) => item.id === threadId) ?? null;
  }

  async function renameThread(threadId: string | null = activeThread?.id ?? null) {
    if (!threadId) {
      return;
    }

    const targetThread = findKnownThread(threadId);
    const title = window.prompt('Rename thread', targetThread?.title ?? 'Untitled thread')?.trim();
    if (!title) {
      return;
    }

    const thread = await window.vicode.threads.rename(threadId, title);
    setRecentThreads((current) => upsertRecentThread(current, thread));
    if (activeThread?.id === threadId) {
      setActiveThread((current) => current ? { ...current, title } : current);
      await refreshThreads(thread.projectId);
      await openThread(threadId);
    } else {
      await refreshThreads(thread.projectId);
    }
  }

  async function archiveThread(threadId: string | null = activeThread?.id ?? null) {
    if (!threadId) {
      return;
    }
    const threadSummary =
      Object.values(threadsByProject)
        .flat()
        .find((item) => item.id === threadId) ??
      (activeThread?.id === threadId ? activeThread : null);
    const ownerProjectId = threadSummary?.projectId ?? null;

    try {
      await window.vicode.threads.archive(threadId);
      setThreadsByProject((current) =>
        Object.fromEntries(
          Object.entries(current).map(([projectId, threads]) => [
            projectId,
            threads.filter((item) => item.id !== threadId)
          ])
        )
      );
      setRecentThreads((current) => current.filter((item) => item.id !== threadId));
      if (activeThread?.id === threadId) {
        activeThreadIdRef.current = null;
        setActiveThread(null);
      }
      if (ownerProjectId) {
        await refreshThreads(ownerProjectId);
      }
      await refreshArchivedThreads();
      await refreshStorageDiagnosticsIfVisible();
    } catch (error) {
      showToast('error', formatUserErrorMessage(error, 'Failed to archive the thread.'));
    }
  }

  function requestDeleteThread(threadId: string | null = activeThread?.id ?? null) {
    if (!threadId) {
      return;
    }

    const targetThread = findKnownThread(threadId);
    setDeleteThreadTarget({
      id: threadId,
      title: targetThread?.title ?? 'this thread',
      projectId: targetThread?.projectId ?? selectedProjectId
    });
  }

  async function deleteThread(threadId: string | null = deleteThreadTarget?.id ?? activeThread?.id ?? null) {
    if (!threadId) {
      return;
    }

    const targetThread = findKnownThread(threadId);
    const ownerProjectId = targetThread?.projectId ?? selectedProjectId;

    await window.vicode.threads.remove(threadId);
    setThreadsByProject((current) =>
      Object.fromEntries(
        Object.entries(current).map(([projectId, threads]) => [
          projectId,
          threads.filter((item) => item.id !== threadId)
        ])
      )
    );
    setRecentThreads((current) => current.filter((item) => item.id !== threadId));
    if (activeThread?.id === threadId) {
      activeThreadIdRef.current = null;
      setActiveThread(null);
    }
    if (ownerProjectId) {
      await refreshThreads(ownerProjectId);
    } else {
      await refreshThreads(selectedProjectId);
    }
    await refreshArchivedThreads();
    await refreshStorageDiagnosticsIfVisible();
  }

  async function duplicateThread() {
    if (!activeThread) {
      return;
    }
    const detail = await window.vicode.threads.duplicate(activeThread.id);
    await refreshThreads(selectedProjectId);
    setRecentThreads((current) => upsertRecentThread(current, detail));
    setActiveThread(detail);
  }

  async function retryThread() {
    if (!activeThread) {
      return;
    }
    const result = await window.vicode.threads.retry(activeThread.id);
    setActiveRunId(result.runId);
  }

  async function refreshSkills() {
    setSkills(await window.vicode.skills.list());
  }

  async function refreshLibrarySources() {
    const [sourcesResult, indexStatusResult] = await Promise.allSettled([
      window.vicode.library.getSources(),
      window.vicode.projectKnowledge.getIndexStatus()
    ]);
    setLibrarySources(sourcesResult.status === 'fulfilled' ? sourcesResult.value : null);
    setProjectKnowledgeIndexStatus(indexStatusResult.status === 'fulfilled' ? indexStatusResult.value : null);
  }

  async function refreshProjectKnowledgeIndex() {
    try {
      const status = await window.vicode.projectKnowledge.refreshIndex();
      setProjectKnowledgeIndexStatus(status);
      await refreshLibrarySources();
      showToast(status.status === 'ready' ? 'info' : 'warning', status.status === 'ready' ? 'Project Knowledge index refreshed.' : status.message);
    } catch (error) {
      showToast('error', formatUserErrorMessage(error, 'Failed to refresh Project Knowledge index.'));
    }
  }

  async function openProjectKnowledgeSuggestedIndexDraft(): Promise<void> {
    try {
      await window.vicode.projectKnowledge.openSuggestedIndexDraft();
      showToast('info', 'Suggested Index draft opened as Markdown.');
    } catch (error) {
      showToast('error', formatUserErrorMessage(error, 'Failed to open Suggested Index draft.'));
    }
  }

  async function rescanSkillLibrary() {
    try {
      const nextSkills = await window.vicode.skills.rescanLibrary();
      setSkills(nextSkills);
      await refreshLibrarySources();
      showToast('info', 'Skill library rescanned.');
    } catch (error) {
      showToast('error', formatUserErrorMessage(error, 'Failed to rescan the skill library.'));
    }
  }

  async function saveSkill(input: SkillSaveInput) {
    const skill = await window.vicode.skills.save(input);
    setSkills((current) => [skill, ...current.filter((item) => item.id !== skill.id)]);
    showToast('info', `${skill.name} saved.`);
    return skill;
  }

  async function toggleSkill(skillId: string, enabled: boolean) {
    const skill = await window.vicode.skills.toggle(skillId, enabled);
    setSkills((current) => current.map((item) => (item.id === skill.id ? skill : item)));
    if (!enabled) {
      setAttachedSkillIds((current) => current.filter((item) => item !== skillId));
    }
    return skill;
  }

  async function removeSkill(skillId: string) {
    const skill = skills.find((item) => item.id === skillId);
    await window.vicode.skills.remove(skillId);
    setSkills((current) => current.filter((item) => item.id !== skillId));
    setAttachedSkillIds((current) => current.filter((item) => item !== skillId));
    showToast('info', `${skill?.name ?? 'Skill'} removed.`);
  }

  function toggleAttachedSkill(skillId: string) {
    setAttachedSkillIds((current) =>
      current.includes(skillId) ? current.filter((item) => item !== skillId) : [...current, skillId]
    );
  }

  async function openCreatorInComposer(kind: 'skill' | 'plugin') {
    await openCreatorInComposerFlow(
      {
        getWorkspaceProject: () => workspaceProject,
        getSelectedProjectId: () => selectedProjectId,
        getComposerState: () => ({
          providerId: composer.providerId,
          modelId: composer.modelId,
          executionPermission: composer.executionPermission
        }),
        listSkills: () => window.vicode.skills.list(),
        listThreads: (projectId) => window.vicode.threads.list(projectId),
        createThread: (input) => window.vicode.threads.create(input),
        saveDraft: (threadId, prompt) => window.vicode.threads.saveDraft(threadId, prompt),
        savePreferences: (input) => window.vicode.settings.save(input),
        applyOpenedThread,
        showToast,
        focusComposer: () => requestAnimationFrame(() => composerRef.current?.focus()),
        setSkills,
        setThreadsByProject,
        setRecentThreads,
        setSelectedProjectId,
        setPreferences,
        setExpandedProjectIds,
        setShowStartupWelcome,
        setEditingFollowUpId,
        setPendingNativeCommandId,
        setAttachedSkillIds,
        prepareComposerForCreator: (prompt) =>
          setComposer((current) => ({
            ...current,
            prompt,
            mode: 'default',
            imageAttachments: [],
            textAttachments: []
          })),
        setRoute
      },
      kind
    );
  }

  async function createAutomation() {
    if (!selectedProjectId || !automationDraft.name.trim() || !automationDraft.promptTemplate.trim()) {
      showToast('warning', 'Automation name and prompt are required.');
      return;
    }
    const automation = await window.vicode.automations.save({
      id: automationDraft.id ?? undefined,
      name: automationDraft.name.trim(),
      projectId: selectedProjectId,
      providerId: automationDraft.providerId,
      modelId: automationDraft.modelId,
      promptTemplate: automationDraft.promptTemplate.trim(),
      skillId: automationDraft.skillId || null,
      enabled: true,
      scheduleType: automationDraft.scheduleType,
      intervalMinutes:
        automationDraft.scheduleType === 'interval_while_app_open'
          ? Number(automationDraft.intervalMinutes || 60)
          : null
    });
    setAutomations((current) => [automation, ...current.filter((item) => item.id !== automation.id)]);
    setAutomationDraft(createAutomationDraft(composer.providerId, composer.modelId));
    setAutomationEditorOpen(false);
    showToast('info', automationDraft.id ? 'Automation updated.' : 'Automation saved.');
  }

  async function toggleAutomation(automationId: string, enabled: boolean) {
    const automation = await window.vicode.automations.toggle(automationId, enabled);
    setAutomations((current) => current.map((item) => (item.id === automation.id ? automation : item)));
  }

  async function runAutomation(automationId: string) {
    try {
      const result = await window.vicode.automations.runNow(automationId);
      setJobs((current) => [result.job, ...current.filter((item) => item.id !== result.job.id)]);
      setReviewItems((current) => [result.reviewItem, ...current.filter((item) => item.id !== result.reviewItem.id)]);
      showPendingReviewToast(result.reviewItem, result.alreadyPending ? reviewItemsRef.current.length : reviewItemsRef.current.length + 1);
    } catch (error) {
      showToast('warning', formatUserErrorMessage(error, 'Unable to queue automation.'));
    }
  }

  function editAutomation(automation: AutomationDefinition) {
    setAutomationDraft({
      id: automation.id,
      name: automation.name,
      promptTemplate: automation.promptTemplate,
      providerId: automation.providerId,
      modelId: automation.modelId,
      skillId: automation.skillId ?? '',
      scheduleType: automation.scheduleType,
      intervalMinutes: automation.intervalMinutes ? String(automation.intervalMinutes) : '60'
    });
    setAutomationEditorOpen(true);
  }

  function resetAutomationDraft() {
    setAutomationDraft(createAutomationDraft(composer.providerId, composer.modelId));
  }

  function closeAutomationEditor() {
    setAutomationEditorOpen(false);
    resetAutomationDraft();
  }

  function openAutomationEditor() {
    resetAutomationDraft();
    setAutomationEditorOpen(true);
  }

  function applyAutomationTemplate(template: AutomationTemplate) {
    setAutomationDraft((current) => ({
      ...current,
      id: null,
      name: template.name,
      promptTemplate: template.promptTemplate,
      scheduleType: 'manual',
      intervalMinutes: current.intervalMinutes || '60'
    }));
    setAutomationEditorOpen(true);
  }

  async function deleteAutomation() {
    if (!automationDeleteId) {
      return;
    }
    await window.vicode.automations.remove(automationDeleteId);
    setAutomations((current) => current.filter((automation) => automation.id !== automationDeleteId));
    if (automationDraft.id === automationDeleteId) {
      resetAutomationDraft();
    }
    setAutomationDeleteId(null);
    showToast('info', 'Automation deleted.');
  }

  async function openAutomationHistory(automationId: string) {
    setAutomationHistoryId(automationId);
    setAutomationHistoryLoading(true);
    try {
      setAutomationHistoryRuns(await window.vicode.automations.listRuns(automationId));
    } catch (error) {
      setAutomationHistoryRuns([]);
      showToast('warning', formatUserErrorMessage(error, 'Unable to load automation history.'));
    } finally {
      setAutomationHistoryLoading(false);
    }
  }

  async function approveReview(
    reviewItemId: string,
    options?: {
      openThread?: boolean;
      successMessage?: string | null;
    }
  ) {
    const result = await window.vicode.jobs.approveReview(reviewItemId);
    setJobs((current) => [result.job, ...current.filter((item) => item.id !== result.job.id)]);
    setReviewItems((current) => current.filter((item) => item.id !== reviewItemId));
    setReviewDraftEdits((current) => {
      const next = { ...current };
      delete next[reviewItemId];
      return next;
    });
    if (options?.successMessage) {
      showToast('info', options.successMessage);
    }
    if (options?.openThread !== false && result.threadId) {
      await refreshThreads(selectedProjectId);
      await openThread(result.threadId);
      setRoute('thread');
    }
  }

  async function rejectReview(
    reviewItemId: string,
    options?: {
      successMessage?: string | null;
    }
  ) {
    const result = await window.vicode.jobs.rejectReview(reviewItemId);
    setJobs((current) => [result.job, ...current.filter((item) => item.id !== result.job.id)]);
    setReviewItems((current) => current.filter((item) => item.id !== reviewItemId));
    setReviewDraftEdits((current) => {
      const next = { ...current };
      delete next[reviewItemId];
      return next;
    });
    if (options?.successMessage) {
      showToast('info', options.successMessage);
    }
  }

  async function saveReviewDraft(reviewItem: ReviewItem) {
    const draftContent = reviewDraftEdits[reviewItem.id];
    const persistedContent = String(reviewItem.details.content ?? '');
    if (!draftContent || draftContent.trim() === persistedContent.trim()) {
      return;
    }

    setReviewDraftSavingId(reviewItem.id);
    try {
      const updated = await window.vicode.jobs.updateReviewDraft(reviewItem.id, draftContent);
      setReviewItems((current) => [updated, ...current.filter((item) => item.id !== updated.id)]);
      setReviewDraftEdits((current) => {
        const next = { ...current };
        delete next[reviewItem.id];
        return next;
      });
      showToast('info', 'Review draft updated.');
    } catch (error) {
      showToast('error', formatUserErrorMessage(error, 'Unable to update the review draft.'));
    } finally {
      setReviewDraftSavingId((current) => (current === reviewItem.id ? null : current));
    }
  }

  async function connectProvider(providerId: ProviderId, mode?: 'cli' | 'api_key', options?: { force?: boolean }) {
    await connectProviderInShell(providerActionsHost, providerId, mode, options);
  }

  async function adoptProviderAuth(providerId: ProviderId) {
    await adoptProviderAuthInShell(providerActionsHost, providerId);
  }

  function beginProviderInstall(providerId: ProviderId) {
    beginProviderInstallInShell(providerActionsHost, providerId);
  }

  async function clearProviderAuth(providerId: ProviderId) {
    await clearProviderAuthInShell(providerActionsHost, providerId);
  }

  async function refreshProvider(providerId: ProviderId) {
    await refreshProviderInShell(providerActionsHost, providerId);
  }

  async function refreshOllamaRuntimeStatus() {
    await refreshOllamaRuntimeStatusInShell(providerActionsHost);
  }

  async function pullOllamaModel(model: string) {
    await pullOllamaModelInShell(providerActionsHost, model);
  }

  async function deleteOllamaModel(model: string) {
    await deleteOllamaModelInShell(providerActionsHost, model);
  }

  async function stopOllamaRuntime() {
    await stopOllamaRuntimeInShell(providerActionsHost);
  }

  async function approveRunToolApproval(approvalId: string) {
    try {
      setToolApprovalResolvingId(approvalId);
      await window.vicode.runs.approveToolApproval(approvalId);
    } catch (error) {
      setToolApprovalResolvingId((current) => (current === approvalId ? null : current));
      showToast('error', formatUserErrorMessage(error, 'Unable to approve the pending command.'));
    }
  }

  async function enableWorkspaceAutoApproveAndApprove(projectId: string, approvalId: string) {
    try {
      setToolApprovalResolvingId(approvalId);
      await saveProjectRuntimeCommandPolicy(projectId, 'auto_approve');
      await window.vicode.runs.approveToolApproval(approvalId);
      showToast('info', 'Workspace commands will now auto-approve.');
    } catch (error) {
      setToolApprovalResolvingId((current) => (current === approvalId ? null : current));
      showToast('error', formatUserErrorMessage(error, 'Unable to enable workspace auto-approve.'));
    }
  }

  async function rejectRunToolApproval(approvalId: string) {
    try {
      setToolApprovalResolvingId(approvalId);
      await window.vicode.runs.rejectToolApproval(approvalId);
    } catch (error) {
      setToolApprovalResolvingId((current) => (current === approvalId ? null : current));
      showToast('error', formatUserErrorMessage(error, 'Unable to reject the pending command.'));
    }
  }

  async function applyStagedWorkspaceChange(input: StagedWorkspaceReviewInput) {
    await applyStagedWorkspaceChangeInShell(runReviewActionsHost, input);
  }

  async function rejectStagedWorkspaceChange(input: StagedWorkspaceReviewInput) {
    await rejectStagedWorkspaceChangeInShell(runReviewActionsHost, input);
  }

  async function revertStagedWorkspaceChange(input: StagedWorkspaceReviewInput) {
    await revertStagedWorkspaceChangeInShell(runReviewActionsHost, input);
  }

  async function applyStagedWorkspaceHunks(input: StagedWorkspaceHunkApplyInput) {
    await applyStagedWorkspaceHunksInShell(runReviewActionsHost, input);
  }

  async function rejectStagedWorkspaceHunks(input: StagedWorkspaceHunkRejectInput) {
    await rejectStagedWorkspaceHunksInShell(runReviewActionsHost, input);
  }

  async function revertStagedWorkspaceHunks(input: StagedWorkspaceHunkRevertInput) {
    await revertStagedWorkspaceHunksInShell(runReviewActionsHost, input);
  }

  async function applyWorktreeReview(input: WorktreeReviewInput) {
    await applyWorktreeReviewInShell(runReviewActionsHost, input);
  }

  async function rejectWorktreeReview(input: WorktreeReviewInput) {
    await rejectWorktreeReviewInShell(runReviewActionsHost, input);
  }

  async function revertWorktreeReview(input: WorktreeReviewInput) {
    await revertWorktreeReviewInShell(runReviewActionsHost, input);
  }

  async function applyWorktreeHunks(input: WorktreeHunkApplyInput) {
    await applyWorktreeHunksInShell(runReviewActionsHost, input);
  }

  async function rejectWorktreeHunks(input: WorktreeHunkRejectInput) {
    await rejectWorktreeHunksInShell(runReviewActionsHost, input);
  }

  async function revertWorktreeHunks(input: WorktreeHunkRevertInput) {
    await revertWorktreeHunksInShell(runReviewActionsHost, input);
  }

  async function cleanupWorktreeReview(input: WorktreeCleanupInput) {
    await cleanupWorktreeReviewInShell(runReviewActionsHost, input);
  }

  async function clearAllProviderAuth() {
    await clearAllProviderAuthInShell(providerActionsHost);
  }

  async function refreshProviders() {
    await refreshProvidersInShell(providerActionsHost);
  }

  async function refreshCustomProviders() {
    await refreshCustomProvidersInShell(providerActionsHost);
  }

  async function saveCustomProvider(input: CustomProviderSettingsSaveInput) {
    return saveCustomProviderInShell(providerActionsHost, input);
  }

  async function deleteCustomProvider(providerId: string) {
    await deleteCustomProviderInShell(providerActionsHost, providerId);
  }

  async function saveProviderApiKey(providerId: ProviderId) {
    await saveProviderApiKeyInShell(providerActionsHost, providerId);
  }

  async function saveDefaultPreferences(input: Partial<Preferences>) {
    const openAIModel =
      input.defaultModelByProvider?.openai ??
      preferences?.defaultModelByProvider.openai ??
      visibleProviders.find((provider) => provider.id === 'openai')?.models[0]?.id ??
      getProviderMetadata('openai').defaultModelId;
    const geminiModel =
      input.defaultModelByProvider?.gemini ??
      preferences?.defaultModelByProvider.gemini ??
      visibleProviders.find((provider) => provider.id === 'gemini')?.models[0]?.id ??
      getProviderMetadata('gemini').defaultModelId;
    const qwenModel =
      input.defaultModelByProvider?.qwen ??
      preferences?.defaultModelByProvider.qwen ??
      visibleProviders.find((provider) => provider.id === 'qwen')?.models[0]?.id ??
      getProviderMetadata('qwen').defaultModelId;
    const ollamaModel =
      input.defaultModelByProvider?.ollama ??
      preferences?.defaultModelByProvider.ollama ??
      visibleProviders.find((provider) => provider.id === 'ollama')?.models[0]?.id ??
      getProviderMetadata('ollama').defaultModelId;
    const kimiModel =
      input.defaultModelByProvider?.kimi ??
      preferences?.defaultModelByProvider.kimi ??
      providers.find((provider) => provider.id === 'kimi')?.models[0]?.id ??
      getProviderMetadata('kimi').defaultModelId;
    const openAICompatibleModel =
      input.defaultModelByProvider?.openai_compatible ??
      preferences?.defaultModelByProvider.openai_compatible ??
      visibleProviders.find((provider) => provider.id === 'openai_compatible')?.models[0]?.id ??
      getProviderMetadata('openai_compatible').defaultModelId;
    const openAIReasoningEffort =
      input.defaultReasoningEffortByProvider?.openai ??
      preferences?.defaultReasoningEffortByProvider.openai ??
      'high';
    const geminiReasoningEffort =
      input.defaultReasoningEffortByProvider?.gemini ??
      preferences?.defaultReasoningEffortByProvider.gemini ??
      null;
    const qwenReasoningEffort =
      input.defaultReasoningEffortByProvider?.qwen ??
      preferences?.defaultReasoningEffortByProvider.qwen ??
      null;
    const ollamaReasoningEffort =
      input.defaultReasoningEffortByProvider?.ollama ??
      preferences?.defaultReasoningEffortByProvider.ollama ??
      null;
    const kimiReasoningEffort =
      input.defaultReasoningEffortByProvider?.kimi ??
      preferences?.defaultReasoningEffortByProvider.kimi ??
      null;
    const openAIThinking =
      input.defaultThinkingByProvider?.openai ??
      preferences?.defaultThinkingByProvider.openai ??
      false;
    const geminiThinking =
      input.defaultThinkingByProvider?.gemini ??
      preferences?.defaultThinkingByProvider.gemini ??
      false;
    const qwenThinking =
      input.defaultThinkingByProvider?.qwen ??
      preferences?.defaultThinkingByProvider.qwen ??
      true;
    const ollamaThinking =
      input.defaultThinkingByProvider?.ollama ??
      preferences?.defaultThinkingByProvider.ollama ??
      false;
    const kimiThinking =
      input.defaultThinkingByProvider?.kimi ??
      preferences?.defaultThinkingByProvider.kimi ??
      false;
    const hasInputKey = (key: keyof Preferences) =>
      Object.prototype.hasOwnProperty.call(input, key);
    const userLibraryPath = hasInputKey('userLibraryPath')
      ? (input.userLibraryPath ?? null)
      : (preferences?.userLibraryPath ?? null);
    const skillsLibraryPath = hasInputKey('skillsLibraryPath')
      ? (input.skillsLibraryPath ?? null)
      : (preferences?.skillsLibraryPath ?? null);
    const llmWikiLibraryPath = hasInputKey('llmWikiLibraryPath')
      ? (input.llmWikiLibraryPath ?? null)
      : (preferences?.llmWikiLibraryPath ?? null);

    setPreferences(
      await window.vicode.settings.save({
        defaultProviderId: input.defaultProviderId ?? preferences?.defaultProviderId ?? 'ollama',
        defaultModelByProvider: {
          openai: openAIModel,
          gemini: geminiModel,
          qwen: qwenModel,
          ollama: ollamaModel,
          kimi: kimiModel,
          openai_compatible: openAICompatibleModel
        },
        defaultReasoningEffortByProvider: {
          openai: openAIReasoningEffort,
          gemini: geminiReasoningEffort,
          qwen: qwenReasoningEffort,
          ollama: ollamaReasoningEffort,
          kimi: kimiReasoningEffort,
          openai_compatible: preferences?.defaultReasoningEffortByProvider.openai_compatible ?? null
        },
        defaultThinkingByProvider: {
          openai: openAIThinking,
          gemini: geminiThinking,
          qwen: qwenThinking,
          ollama: ollamaThinking,
          kimi: kimiThinking,
          openai_compatible: preferences?.defaultThinkingByProvider.openai_compatible ?? false
        },
        defaultExecutionPermission: input.defaultExecutionPermission ?? preferences?.defaultExecutionPermission ?? 'default',
        followUpBehavior: input.followUpBehavior ?? preferences?.followUpBehavior ?? 'queue',
        appearanceMode: input.appearanceMode ?? preferences?.appearanceMode ?? 'system',
        accentMode: input.accentMode ?? preferences?.accentMode ?? 'system',
        accentColor: input.accentColor ?? preferences?.accentColor ?? null,
        generatedMemoryUseEnabled: input.generatedMemoryUseEnabled ?? preferences?.generatedMemoryUseEnabled ?? false,
        generatedMemoryGenerationEnabled:
          input.generatedMemoryGenerationEnabled ?? preferences?.generatedMemoryGenerationEnabled ?? true,
        onboardingComplete: input.onboardingComplete ?? preferences?.onboardingComplete ?? false,
        lastOpenedThreadId: input.lastOpenedThreadId ?? preferences?.lastOpenedThreadId ?? null,
        microphoneAllowed: input.microphoneAllowed ?? preferences?.microphoneAllowed ?? false,
        userLibraryPath,
        skillsLibraryPath,
        llmWikiLibraryPath
      })
    );
  }

  async function exportDiagnostics() {
    await exportDiagnosticsInShell(diagnosticsActionsHost);
  }

  async function exportActiveThreadDiagnostics() {
    await exportActiveThreadDiagnosticsInShell(diagnosticsActionsHost);
  }

  async function exportActiveThreadReport() {
    await exportActiveThreadReportInShell(diagnosticsActionsHost);
  }

  async function loadStorageDiagnostics() {
    await loadStorageDiagnosticsInShell(diagnosticsActionsHost);
  }

  async function refreshStorageDiagnosticsIfVisible() {
    await refreshStorageDiagnosticsIfVisibleInShell(diagnosticsActionsHost);
  }

  async function compactRunEvents() {
    await compactRunEventsInShell(diagnosticsActionsHost);
  }

  async function maintainStorage(input?: { vacuum?: boolean }) {
    await maintainStorageInShell(diagnosticsActionsHost, input);
  }

  useEffect(() => {
    if (
      loading ||
      route !== 'settings' ||
      (settingsSection !== 'diagnostics' && settingsSection !== 'storage') ||
      storageDiagnostics !== null
    ) {
      return;
    }

    void loadStorageDiagnostics();
  }, [loading, route, settingsSection, storageDiagnostics]);

  useEffect(() => {
    if (loading || route !== 'settings' || settingsSection !== 'providers') {
      return;
    }

    void refreshCustomProviders().catch(() => {
      setCustomProviders([]);
    });
  }, [loading, route, settingsSection]);

  const hasProjects = projects.length > 0;
  const showEmptyThreadOpenProjectAction = !hasProjects;
  const showWorkspaceRepairAction = Boolean(workspaceProject?.folderPath && workspaceProject.id === missingWorkspaceProjectId);
  const showWorkspaceTrustAction = Boolean(workspaceProject?.folderPath && !workspaceProject.trusted);
  const activeThreadActions =
    activeThread && workspaceProject
      ? {
          projectId: workspaceProject.id,
          rename: renameThread,
          duplicate: duplicateThread,
          retry: retryThread,
          archive: async () => archiveThread(activeThread.id),
          remove: () => requestDeleteThread(activeThread.id)
        }
      : null;
  const titlebarWorkspaceAction = showWorkspaceRepairAction
    ? {
        label: 'Repair path',
        tooltip: 'This thread still points to a missing workspace folder. Pick the current folder for this project before running tools again.',
        icon: <FolderIcon />,
        onClick: () => void repairWorkspaceProjectPath(workspaceProject),
        tone: 'warning' as const
      }
    : showWorkspaceTrustAction
      ? {
          label: 'Trust workspace',
          tooltip: 'Allow Vicode to work with files in this project and run coding tasks here. This applies to the whole project, not just this thread.',
          icon: <AccessIcon />,
          onClick: () => void trustProject(true),
          tone: 'default' as const
        }
      : null;
  const showTranscriptRailCentered = activeThread ? transcriptTurns.length === 0 : startupThreadRestoreState !== 'pending';
  const emptyThreadHero = (
    <EmptyThreadHero
      showOpenProjectAction={showEmptyThreadOpenProjectAction}
      onOpenProject={() => void openProjectFromPicker()}
    />
  );
  const emptyActiveThreadState = emptyThreadHero;
  const restoringThreadState = (
    <div className="empty-thread-state" aria-label="Restoring thread">
      <h3>Reopening thread</h3>
      <p>Restoring your last thread for this workspace.</p>
    </div>
  );

  async function openProjectFolderLocation(projectId: string) {
    const project = projects.find((entry) => entry.id === projectId);
    if (!project?.folderPath) {
      showToast('warning', 'This project does not have a folder location yet.');
      return;
    }

    await window.vicode.app.revealPath(project.folderPath);
  }

  async function restoreArchivedThread(threadId: string) {
    const thread = await window.vicode.threads.restore(threadId);
    setRecentThreads((current) => upsertRecentThread(current, thread));
    await refreshArchivedThreads();
    if (thread.projectId === selectedProjectId) {
      await refreshThreads(thread.projectId);
    }
    await refreshStorageDiagnosticsIfVisible();
    showToast('info', `Restored "${thread.title}".`);
  }

  async function deleteArchivedThread(threadId: string) {
    const thread = archivedThreads.find((entry) => entry.id === threadId) ?? null;
    await window.vicode.threads.remove(threadId);
    setRecentThreads((current) => current.filter((item) => item.id !== threadId));
    await refreshArchivedThreads();
    if (thread?.projectId === selectedProjectId) {
      await refreshThreads(thread.projectId);
    }
    await refreshStorageDiagnosticsIfVisible();
    showToast('info', thread ? `Deleted "${thread.title}" permanently.` : 'Archived thread deleted permanently.');
  }

  function toggleSettingsRoute() {
    if (route === 'settings') {
      setRoute(lastContentRoute);
      return;
    }
    setRoute('settings');
  }

  function openSettingsSection(section: SettingsSection = 'general') {
    setSettingsSection(section);
    setRoute('settings');
  }

  function toggleTitlebarSettingsSection(section: SettingsSection = 'general') {
    if (route === 'settings' && settingsSection === section) {
      setRoute(lastContentRoute);
      return;
    }
    openSettingsSection(section);
  }

  function openSkillsRoute() {
    setRoute((current) => (current === 'skills' ? 'thread' : 'skills'));
  }

  function openAutomationsRoute() {
    setRoute((current) => (current === 'automations' ? 'thread' : 'automations'));
  }

  function openCollaborationSection(section: CollaborationSection) {
    if (!COLLABORATION_ENABLED) {
      return;
    }
    setCollaborationSection(section);
    setRoute('collab');
  }

  async function openContactChat(userId: string) {
    const existingChat = collaboration.rooms.find((room) => room.type === 'dm' && room.directUserId === userId) ?? null;
    if (existingChat) {
      setSelectedCollaborationRoomId('');
      setSelectedCollaborationChatId(existingChat.id);
      setCollaborationSection('chats');
      setRoute('collab');
      return;
    }

    const room = await createCollaborationDirectChat({ peerUserId: userId });
    if (room) {
      setSelectedCollaborationRoomId('');
      setSelectedCollaborationChatId(room.id);
      setCollaborationSection('chats');
      setRoute('collab');
    }
  }

  async function handleEvent(event: AppEvent) {
    if (event.type === 'library.skillsChanged') {
      await refreshSkills();
      await refreshLibrarySources();
      return;
    }
    if (event.type === 'library.projectKnowledgeChanged') {
      if (event.status) {
        setProjectKnowledgeIndexStatus(event.status);
      }
      await refreshLibrarySources();
      return;
    }
    if (event.type === 'ollama.pullProgress') {
      setOllamaPullProgress(event.progress);
      return;
    }
    if (event.type === 'run.approvalRequested') {
      setPendingRunToolApprovals((current) => [
        ...current.filter((approval) => approval.id !== event.approval.id),
        event.approval
      ]);
      return;
    }
    if (event.type === 'run.approvalResolved') {
      setPendingRunToolApprovals((current) =>
        current.filter((approval) => approval.id !== event.approvalId)
      );
      setToolApprovalResolvingId((current) =>
        current === event.approvalId ? null : current
      );
      return;
    }
    if (!COLLABORATION_ENABLED && event.type.startsWith('collab.')) {
      return;
    }
    if (event.type.startsWith('collab.')) {
      await refreshCollaborationBootstrapState(bootstrapHost);
      return;
    }
    if (event.type === 'provider.updated') {
      setProviders((current) => current.map((item) => (item.id === event.provider.id ? event.provider : item)));
      return;
    }
    if (event.type === 'job.updated') {
      setJobs((current) => [event.job, ...current.filter((item) => item.id !== event.job.id)]);
      return;
    }
    if (event.type === 'review.updated') {
      setReviewDraftEdits((current) => {
        const next = { ...current };
        delete next[event.reviewItem.id];
        return next;
      });
      setReviewItems((current) =>
        event.reviewItem.status === 'pending'
          ? [event.reviewItem, ...current.filter((item) => item.id !== event.reviewItem.id)]
          : current.filter((item) => item.id !== event.reviewItem.id)
      );
      return;
    }
    if (event.type === 'automation.updated') {
      setAutomations((current) => current.map((item) => (item.id === event.automation.id ? event.automation : item)));
      return;
    }
    if (
      event.type === 'subagent.created' ||
      event.type === 'subagent.updated' ||
      event.type === 'subagent.completed' ||
      event.type === 'subagent.failed' ||
      event.type === 'subagent.cancelled'
    ) {
      setSubagentsByThreadId((current) => ({
        ...current,
        [event.subagent.parentThreadId]: upsertSubagent(current[event.subagent.parentThreadId] ?? [], event.subagent)
      }));
      return;
    }
    if (event.type === 'autonomousTasks.updated') {
      setAutonomousTasksByThreadId((current) => ({
        ...current,
        [event.threadId]: event.tasks
      }));
      return;
    }
    if (event.type === 'diagnostics.ready') {
      showToast('info', `Diagnostics ready: ${event.path}`);
      return;
    }
    if (event.type === 'app.updateStateChanged') {
      setAppUpdateState(event.update);
      return;
    }
    if (event.type === 'app.notification') {
      showToast(event.level, event.message);
      return;
    }
    if (event.type === 'thread.updated') {
      setThreadsByProject((current) => ({
        ...current,
        [event.thread.projectId]: [
          event.thread,
          ...(current[event.thread.projectId] ?? []).filter((item) => item.id !== event.thread.id)
        ]
      }));
      setRecentThreads((current) => upsertRecentThread(current, event.thread));
      if (activeThreadIdRef.current === event.thread.id) {
        setActiveThread((current) => applyThreadSummaryToActiveThread(current, event.thread));
      }
      return;
    }
    if (event.type === 'thread.detail' && activeThreadIdRef.current === event.thread.id) {
      flushPendingLiveRunDeltas();
      setActiveThread(event.thread);
      setRunProgressByRunId(deriveRunProgressSnapshots(event.thread.rawOutput));
      setActiveRunId((current) => deriveCurrentRunId(event.thread, current));
      setEditingFollowUpId((current) =>
        current && !event.thread.followUps.some((followUp) => followUp.id === current) ? null : current
      );
      setAttachedSkillIds(extractThreadSkillIds(event.thread));
      setComposer((current) => ({
        ...current,
        mode: event.thread.planner.composerMode,
        executionPermission: event.thread.executionPermission
      }));
      return;
    }
    if (event.type === 'run.progress') {
      setRunProgressByRunId((current) => ({
        ...current,
        [event.runId]: event.progress
      }));
      return;
    }
    if (event.type === 'run.started') {
      if (event.threadId === activeThreadIdRef.current) {
        setActiveRunId(event.runId);
        setActiveThread((current) =>
          applyRunStartedToThread(current, { threadId: event.threadId, runId: event.runId }, new Date().toISOString())
        );
      }
      return;
    }
    if (event.type === 'planner.modeChanged' && activeThreadIdRef.current === event.threadId) {
      setComposer((current) => ({ ...current, mode: event.planner.composerMode }));
      return;
    }
    if (event.type === 'planner.parseError') {
      showToast('error', event.message);
      return;
    }
    if (event.type === 'run.delta' && activeThreadIdRef.current === event.threadId) {
      queuePendingLiveRunDelta(event.threadId, event.runId, event.delta);
      return;
    }
    if (event.type === 'run.replace' && activeThreadIdRef.current === event.threadId) {
      flushPendingLiveRunDeltas();
      setActiveThread((current) =>
        applyRunReplaceToThread(
          current,
          { threadId: event.threadId, runId: event.runId, text: event.text },
          new Date().toISOString()
        )
      );
      return;
    }
    if (event.type === 'raw.event' && activeThreadIdRef.current === event.event.threadId) {
      flushPendingLiveRunDeltas();
      setRunProgressByRunId((current) => applyRunProgressSnapshotEvent(current, event.event));
      setActiveThread((current) => applyRawRunEventToThread(current, event.event));
      return;
    }
    if (event.type === 'run.status' && ['completed', 'failed', 'aborted'].includes(event.status)) {
      if (event.threadId === activeThreadIdRef.current) {
        flushPendingLiveRunDeltas();
      }
      setRunProgressByRunId((current) => clearRunProgressEntry(current, event.runId));
      setActiveRunId((current) => (current === event.runId ? null : current));
      if (event.threadId === activeThreadIdRef.current) {
        setActiveThread(await window.vicode.threads.open(event.threadId));
      }
      await refreshThreads(selectedProjectIdRef.current);
    }
  }

  function openPendingReviewInbox() {
    pendingReviewRevealRequestedRef.current = true;
    setRoute('automations');
  }

  function dismissToast() {
    window.clearTimeout((showToast as typeof showToast & { timer?: number }).timer);
    setToast(null);
  }

  function showToast(
    level: Toast['level'],
    message: string,
    options?: Pick<Toast, 'title' | 'sticky' | 'actions'>
  ) {
    if (level === 'info' && !options?.sticky && !(options?.actions && options.actions.length > 0)) {
      return;
    }

    setToast({ level, message, ...options });
    window.clearTimeout((showToast as typeof showToast & { timer?: number }).timer);
    if (options?.sticky) {
      return;
    }
    (showToast as typeof showToast & { timer?: number }).timer = window.setTimeout(
      () => setToast(null),
      level === 'warning' || level === 'error' ? 5000 : 3500
    );
  }

  function showWorkspaceRepairToast(error: unknown, project: Project | null) {
    const unavailable = parseWorkspaceUnavailableError(error);
    if (!unavailable) {
      return false;
    }

    if (project) {
      setMissingWorkspaceProjectId(project.id);
    }

    showToast('warning', formatUserErrorMessage(error, 'This workspace folder is missing.'), {
      sticky: true,
      actions: [
        {
          label: 'Not now',
          tone: 'quiet',
          onAction: () => dismissToast()
        },
        {
          label: 'Repair path',
          tone: 'primary',
          onAction: () => {
            dismissToast();
            void repairWorkspaceProjectPath(project);
          }
        }
      ]
    });
    return true;
  }

  function getPendingReviewToastCopy(reviewItem: ReviewItem, pendingCount: number) {
    const job = jobs.find((item) => item.id === reviewItem.jobId) ?? null;
    const presentation = describeReviewItem(reviewItem, job);
    const queueLabel =
      pendingCount > 1 ? `${pendingCount} pending reviews waiting.` : '1 pending review waiting.';
    return {
      title: presentation.title,
      message: `${presentation.summary} ${queueLabel}`.trim(),
      isManualWrite: presentation.isManualWrite
    };
  }

  function focusPendingReviewToast(reviewItemId?: string | null, pendingCountOverride?: number) {
    const nextPending =
      reviewItemsRef.current.find((item) => item.id === reviewItemId) ??
      reviewItemsRef.current[0] ??
      null;
    if (!nextPending) {
      dismissToast();
      return;
    }

    const pendingCount =
      pendingCountOverride ??
      (reviewItemsRef.current.some((item) => item.id === nextPending.id)
        ? reviewItemsRef.current.length
        : reviewItemsRef.current.length + 1);
    const { title, message, isManualWrite } = getPendingReviewToastCopy(nextPending, pendingCount);
    showToast('warning', message, {
      title,
      sticky: true,
      actions: [
        {
          label: 'Reject',
          tone: 'quiet',
          onAction: () => {
            void resolveReviewFromToast(nextPending.id, 'rejected');
          }
        },
        {
          label: isManualWrite ? 'Approve' : 'Approve and run',
          tone: 'primary',
          onAction: () => {
            void resolveReviewFromToast(nextPending.id, 'approved');
          }
        },
        {
          label: 'View queue',
          tone: 'quiet',
          onAction: () => {
            dismissToast();
            openPendingReviewInbox();
          }
        }
      ]
    });
  }

  async function resolveReviewFromToast(reviewItemId: string, decision: 'approved' | 'rejected') {
    const nextPendingId = reviewItemsRef.current.find((item) => item.id !== reviewItemId)?.id ?? null;
    dismissToast();
    try {
      if (decision === 'approved') {
        await approveReview(reviewItemId, {
          openThread: false,
          successMessage: null
        });
      } else {
        await rejectReview(reviewItemId, { successMessage: null });
      }
      if (nextPendingId) {
        window.setTimeout(() => focusPendingReviewToast(nextPendingId), 150);
      }
    } catch (error) {
      showToast(
        'error',
        formatUserErrorMessage(error, decision === 'approved' ? 'Unable to approve the review.' : 'Unable to reject the review.')
      );
    }
  }

  function showPendingReviewToast(reviewItem?: ReviewItem | null, pendingCountOverride?: number) {
    const target = reviewItem ?? reviewItemsRef.current[0] ?? null;
    if (!target) {
      return;
    }
    focusPendingReviewToast(target.id, pendingCountOverride);
  }

  useEffect(() => {
    if (reviewItems.length === 0) {
      pendingReviewToastShownRef.current = false;
      return;
    }

    if (!shellReady || pendingReviewToastShownRef.current) {
      return;
    }

    pendingReviewToastShownRef.current = true;
    showPendingReviewToast(reviewItems[0]);
  }, [reviewItems.length, shellReady]);

  async function saveProjectRuntimeCommandPolicy(
    projectId: string,
    runtimeCommandPolicy: Project['runtimeCommandPolicy']
  ) {
    const project = await window.vicode.projects.update({
      id: projectId,
      runtimeCommandPolicy
    });
    setProjects((current) =>
      current.map((item) => (item.id === project.id ? project : item))
    );
  }

  async function saveProjectRuntimeNetworkPolicy(
    projectId: string,
    runtimeNetworkPolicy: Project['runtimeNetworkPolicy']
  ) {
    const project = await window.vicode.projects.update({
      id: projectId,
      runtimeNetworkPolicy
    });
    setProjects((current) =>
      current.map((item) => (item.id === project.id ? project : item))
    );
  }

  async function checkForAppUpdates() {
    try {
      setAppUpdateState(await window.vicode.updates.checkForUpdates());
    } catch (error) {
      showToast('error', formatUserErrorMessage(error, 'Unable to check for desktop updates.'));
    }
  }

  async function restartToUpdate() {
    try {
      await window.vicode.updates.restartToUpdate();
    } catch (error) {
      showToast('error', formatUserErrorMessage(error, 'Unable to restart and install the desktop update.'));
    }
  }

  async function requestRestartToUpdate() {
    if (appUpdateState?.status !== 'downloaded') {
      openSettingsSection('general');
      return;
    }

    await restartToUpdate();
  }

  function pressTitlebarUpdateAction() {
    if (appUpdateState?.status === 'downloaded') {
      void requestRestartToUpdate();
      return;
    }
    openSettingsSection('general');
  }

  useEffect(() => {
    if (appUpdateState?.status !== 'downloaded') {
      return;
    }

    const downloadedVersion =
      appUpdateState.availableVersion ?? `downloaded:${appUpdateState.currentVersion}`;

    if (downloadedUpdateToastVersionRef.current === downloadedVersion) {
      return;
    }

    downloadedUpdateToastVersionRef.current = downloadedVersion;
    const versionLabel = appUpdateState?.availableVersion
      ? `Version ${appUpdateState.availableVersion} is ready to install.`
      : 'The latest desktop update is ready to install.';
    showToast('warning', `${versionLabel} ${hasActiveRun ? 'Restarting now will stop the current run and install it immediately.' : 'Restart Vicode to finish updating.'}`, {
      title: 'Update ready',
      sticky: true,
      actions: [
        {
          label: 'Later',
          tone: 'quiet',
          onAction: () => dismissToast()
        },
        {
          label: 'Restart now',
          tone: 'primary',
          onAction: () => {
            dismissToast();
            void requestRestartToUpdate();
          }
        }
      ]
    });
  }, [appUpdateState, hasActiveRun]);

  return (
    <TooltipProvider>
    <div
      ref={appShellRef}
      className={`app-shell h-screen min-h-screen w-full overflow-hidden bg-[color:var(--ui-app-bg)] text-[color:var(--ui-text-title)]${showWelcomeScreen ? ' app-shell-welcome' : ''}${shellReady && !showWelcomeScreen && contentRoute === 'thread' ? ' app-shell-thread' : ''}${shellReady && !showWelcomeScreen && route === 'settings' ? ' app-shell-settings-overlay' : ''}`}
      style={{
        ['--vicode-sidebar-width' as string]: `${effectiveSidebarWidth}px`,
        ['--windows-titlebar-leading-width' as string]: `${titlebarLeadingWidth}px`
      }}
    >
      {!showWelcomeScreen ? (
        <WindowsTitleBar
          route={route}
          selectedProjectName={workspaceProject?.name ?? selectedProject?.name ?? null}
          activeThreadTitle={activeThread?.title ?? null}
          workspaceAction={route === 'thread' ? titlebarWorkspaceAction : null}
          isAgentWorking={Boolean(activeRunId)}
          collaboration={collaboration}
          appUpdateState={appUpdateState}
          sidebarCollapsed={sidebarCollapsed}
          toggleSidebar={toggleSidebarCollapsed}
          openSettings={toggleTitlebarSettingsSection}
          openAutomations={openAutomationsRoute}
          openSkills={openSkillsRoute}
          pressUpdateAction={pressTitlebarUpdateAction}
        />
      ) : null}

      <div className="app-workspace-shell">
        {showPrimarySidebar && (!sidebarCollapsed || sidebarResizing) ? (
          <div
            ref={sidebarShellRef}
            className={`sidebar-shell flex shrink-0${sidebarCollapsed ? ' is-collapsed' : ''}${sidebarResizing ? ' is-resizing' : ''}`}
            style={{
              width: `${effectiveSidebarWidth}px`,
              minWidth: `${effectiveSidebarWidth}px`,
              maxWidth: `${effectiveSidebarWidth}px`
            }}
          >
            <AppSidebar
              route={route}
              openProjectFromPicker={openProjectFromPicker}
              activateChatsLibrary={activateChatsLibrary}
              createChatThread={createChatThread}
              createThreadForProject={createThreadForProject}
              renameProject={renameProject}
              archiveProjectThreads={archiveProjectThreads}
              removeProject={removeProject}
              removingProjectId={removingProjectId}
              setProjectTrust={setProjectTrust}
              projects={projects}
              preferences={preferences}
              skills={skills}
              attachedSkillIds={attachedSkillIds}
              composerContextWindow={composerContextWindow}
              librarySources={librarySources}
              expandedProjectIds={expandedProjectIds}
              toggleProjectThreads={toggleProjectThreads}
              collapseAllProjectThreads={collapseAllProjectThreads}
              reorderProjects={reorderProjects}
              threadsByProject={threadsByProject}
              subagentsByThreadId={subagentsByThreadId}
              activeThreadId={activeThread?.id ?? null}
              activeThreadActions={activeThreadActions}
              openThread={openThread}
              renameThread={renameThread}
              archiveThread={archiveThread}
              deleteThread={requestDeleteThread}
              toggleAttachedSkill={toggleAttachedSkill}
              openSkillsRoute={openSkillsRoute}
              openLibrarySettings={() => openSettingsSection('library')}
              rescanSkillLibrary={rescanSkillLibrary}
              openProjectFolderLocation={openProjectFolderLocation}
              sidebarCollapsed={sidebarCollapsed}
              sidebarIconOnly={sidebarIconOnly}
              toggleSidebar={toggleSidebarCollapsed}
            />
          </div>
        ) : null}
        {showPrimarySidebar ? (
          <div
            data-testid="sidebar-resize-rail"
            className={cx('sidebar-resize-rail', sidebarResizing && 'is-active')}
            role="separator"
            aria-label="Resize sidebar"
            aria-orientation="vertical"
            aria-valuemin={SIDEBAR_COLLAPSED_WIDTH}
            aria-valuemax={sidebarResizeMaxWidth}
            aria-valuenow={sidebarWidth}
          >
            <div
              data-testid="sidebar-resize-hit-target"
              className="sidebar-resize-hit-target"
              onPointerDown={startSidebarResize}
            />
          </div>
        ) : null}

        <main
          className={`main-surface min-w-0 flex-1 overflow-hidden${loading ? ' main-surface-loading' : ''}${showWelcomeScreen ? ' main-surface-welcome' : ''}${shellReady && !showWelcomeScreen && contentRoute === 'thread' ? ' main-surface-thread' : ''}${shellReady && !showWelcomeScreen && route === 'settings' ? ' main-surface-settings-overlay' : ''}`}
        >
        {loading ? (
          <div className="loading-state loading-state-boot">
            <div className="loading-boot-card" aria-label="Vicode is loading">
              <LandingBeams />
              <div className="loading-boot-overlay" aria-hidden="true" />
              <div className="loading-boot-content">
                <div className="loading-boot-brand">
                  <ThemedWolfLogo className="loading-boot-logo" />
                  <h1 className="loading-boot-title">Vicode</h1>
                </div>
                <div className="loading-boot-status">
                  Loading<span className="loading-boot-ellipsis" aria-hidden="true" />
                </div>
              </div>
            </div>
          </div>
        ) : null}
        {shellReady && !showWelcomeScreen && toast ? (
          <InlineNotice
            actions={toast.actions}
            level={toast.level}
            message={toast.message}
            title={toast.title}
            onDismiss={dismissToast}
          />
        ) : null}
        {shellReady && !showWelcomeScreen && contentRoute === 'thread' ? (
          <ThreadRouteContainer
            activeDisplayedRunId={activeDisplayedRunId}
            activeRunActivity={activeRunActivity}
            activeRunTranscriptItems={activeRunTranscriptItems}
            activeSubagents={activeSubagents}
            activeThread={activeThread}
            addComposerImageFiles={addComposerImageFiles}
            addComposerTextAttachment={addComposerTextAttachment}
            applyStagedWorkspaceChange={applyStagedWorkspaceChange}
            applyStagedWorkspaceHunks={applyStagedWorkspaceHunks}
            applyWorktreeReview={applyWorktreeReview}
            applyWorktreeHunks={applyWorktreeHunks}
            cleanupWorktreeReview={cleanupWorktreeReview}
            attachedSkillIds={attachedSkillIds}
            availableComposerSkills={availableComposerSkills}
            canCreateTextAttachments={Boolean(composerProjectId && workspaceProject?.folderPath && workspaceProject.trusted)}
            composer={composer}
            composerActivityItems={composerActivityItems}
            composerEffort={composerEffort}
            composerProjectId={composerProjectId}
            composerRef={composerRef}
            composerSubmitting={composerSubmitting}
            createThread={createThread}
            emptyThreadHero={emptyThreadHero}
            enhanceComposerPrompt={enhanceComposerPrompt}
            enhancingPrompt={enhancingPrompt}
            handleComposerVoice={handleComposerVoice}
            installedComposerSkills={installedComposerSkills}
            markTranscriptUserScrollIntent={markTranscriptUserScrollIntent}
            openProviderSettings={() => openSettingsSection('providers')}
            openProjectFromPicker={openProjectFromPicker}
            pendingNativeCommandId={pendingNativeCommandId}
            plannerSubmitting={plannerSubmitting}
            refreshProvider={refreshProvider}
            rejectStagedWorkspaceChange={rejectStagedWorkspaceChange}
            rejectStagedWorkspaceHunks={rejectStagedWorkspaceHunks}
            rejectWorktreeReview={rejectWorktreeReview}
            rejectWorktreeHunks={rejectWorktreeHunks}
            revertStagedWorkspaceChange={revertStagedWorkspaceChange}
            revertStagedWorkspaceHunks={revertStagedWorkspaceHunks}
            revertWorktreeReview={revertWorktreeReview}
            revertWorktreeHunks={revertWorktreeHunks}
            removeComposerImageAttachment={removeComposerImageAttachment}
            removeComposerTextAttachment={removeComposerTextAttachment}
            resolveThreadTitle={resolveThreadTitle}
            restoringThreadState={restoringThreadState}
            runActivityByRunId={runActivityByRunId}
            runTranscriptItemsByRunId={runTranscriptItemsByRunId}
            selectedProject={selectedProject}
            selectComposerEffort={selectComposerEffort}
            selectComposerModel={selectComposerModel}
            setActiveImageAttachment={setActiveImageAttachment}
            setComposerPrompt={(prompt) => setComposer((current) => ({ ...current, prompt }))}
            setExecutionPermission={setExecutionPermission}
            setIsolationMode={setIsolationMode}
            setPendingNativeCommandId={setPendingNativeCommandId}
            showToast={showToast}
            showTranscriptRailCentered={showTranscriptRailCentered}
            skills={skills}
            startupThreadRestoreState={startupThreadRestoreState}
            stagedWorkspaceReviewResolvingKey={stagedWorkspaceReviewResolvingKey}
            worktreeReviewResolvingKey={worktreeReviewResolvingKey}
            stopPrompt={stopPrompt}
            submitPrompt={submitPrompt}
            toggleAttachedSkill={toggleAttachedSkill}
            toggleComposerMode={toggleComposerMode}
            transcriptRef={transcriptRef}
            transcriptRunAnchorTurnId={transcriptRunAnchorTurnId}
            transcriptTurns={transcriptTurns}
            updateTranscriptAutoFollow={updateTranscriptAutoFollow}
            visibleProviders={visibleProviders}
            voiceAvailable={voiceAvailable}
            voiceElapsedLabel={formatVoiceElapsed(voiceElapsedMs)}
            voiceLevel={voiceLevel}
            voiceState={voiceState}
            workspaceProject={workspaceProject}
          />
        ) : null}
        {COLLABORATION_ENABLED && shellReady && !showWelcomeScreen && contentRoute === 'collab' ? (
          <ChatUtilityPane
            standalone
            onBack={() => setRoute('thread')}
            section={collaborationSection}
            collaboration={collaboration}
            selectedRoomId={selectedCollaborationRoomId}
            selectedChatId={selectedCollaborationChatId}
            selectedContactId={selectedCollaborationContactId}
            onSelectSection={setCollaborationSection}
            onSelectRoom={setSelectedCollaborationRoomId}
            onSelectChat={setSelectedCollaborationChatId}
            onSelectContact={setSelectedCollaborationContactId}
            onCreateGuestProfile={createCollaborationGuestProfile}
            onClearIdentity={clearCollaborationIdentity}
            onSaveProfile={saveCollaborationProfile}
            onCreateRoom={createCollaborationRoom}
            onJoinRoom={joinCollaborationRoom}
            onCreateDirectChat={createCollaborationDirectChat}
            onSetFollowing={setCollaborationFollowing}
            onRequestRole={requestCollaborationRole}
            onResolveRoleRequest={resolveCollaborationRoleRequest}
            onSetTerminalMode={setCollaborationTerminalMode}
            onSendMessage={sendCollaborationMessage}
            onShareCurrentThread={shareCurrentThreadWithRoom}
            onShareCurrentRun={shareCurrentRunWithRoom}
            onCreateHandoff={createCollaborationHandoff}
          />
        ) : null}
        {shellReady && contentRoute === 'ui-dev' && import.meta.env.DEV ? <UiDevSurface /> : null}

        {shellReady && contentRoute === 'skills' ? (
          <SkillsRouteContainer
            skills={skills}
            selectedProject={selectedProject}
            composerProviderId={composer.providerId}
            attachedSkillIds={attachedSkillIds}
            refreshSkills={refreshSkills}
            saveSkill={saveSkill}
            onCreateSkill={() => void openCreatorInComposer('skill')}
            onCreatePlugin={() => void openCreatorInComposer('plugin')}
            onBack={() => setRoute('thread')}
            toggleSkill={toggleSkill}
            removeSkill={removeSkill}
            toggleAttachedSkill={toggleAttachedSkill}
            showToast={showToast}
          />
        ) : null}
        {shellReady && contentRoute === 'automations' ? (
          <AutomationsRouteContainer
            onBack={() => setRoute('thread')}
            selectedProject={selectedProject ? { id: selectedProject.id, name: selectedProject.name } : null}
            automations={automations}
            skills={skills}
            reviewItems={reviewItems}
            jobs={jobs}
            reviewDraftEdits={reviewDraftEdits}
            setReviewDraftEdits={setReviewDraftEdits}
            reviewDraftSavingId={reviewDraftSavingId}
            saveReviewDraft={saveReviewDraft}
            approveReview={approveReview}
            rejectReview={rejectReview}
            openAutomationEditor={openAutomationEditor}
            editAutomation={editAutomation}
            openAutomationHistory={openAutomationHistory}
            toggleAutomation={toggleAutomation}
            runAutomation={runAutomation}
            automationEditorOpen={automationEditorOpen}
            closeAutomationEditor={closeAutomationEditor}
            setAutomationEditorOpen={setAutomationEditorOpen}
            automationDraft={automationDraft}
            setAutomationDraft={setAutomationDraft}
            createAutomation={createAutomation}
            visibleProviders={visibleProviders}
            automationModelOptions={automationModelOptions}
            availableAutomationSkills={availableAutomationSkills}
            automationHistoryId={automationHistoryId}
            setAutomationHistoryId={setAutomationHistoryId}
            automationHistoryTarget={automationHistoryTarget}
            automationHistoryRuns={automationHistoryRuns}
            setAutomationHistoryRuns={setAutomationHistoryRuns}
            automationHistoryLoading={automationHistoryLoading}
            setAutomationHistoryLoading={setAutomationHistoryLoading}
            openThread={openThread}
            automationDeleteId={automationDeleteId}
            setAutomationDeleteId={setAutomationDeleteId}
            automationDeleteTarget={automationDeleteTarget}
            deleteAutomation={deleteAutomation}
            applyAutomationTemplate={applyAutomationTemplate}
          />
        ) : null}
      </main>
      {shellReady && route === 'settings' ? (
        <div className="settings-route-overlay" role="dialog" aria-label="Settings">
          <SettingsRouteContainer
            section={settingsSection}
            setSection={setSettingsSection}
            onBack={toggleSettingsRoute}
            providers={visibleProviders}
            customProviders={customProviders}
            preferences={preferences}
            librarySources={librarySources}
            projectKnowledgeIndexStatus={projectKnowledgeIndexStatus}
            savePreferences={saveDefaultPreferences}
            refreshLibrarySources={refreshLibrarySources}
            refreshProjectKnowledgeIndex={refreshProjectKnowledgeIndex}
            openProjectKnowledgeSuggestedIndexDraft={openProjectKnowledgeSuggestedIndexDraft}
            rescanSkillLibrary={rescanSkillLibrary}
            apiKeys={apiKeys}
            setApiKeys={setApiKeys}
            connectProvider={connectProvider}
            adoptProviderAuth={adoptProviderAuth}
            beginProviderInstall={beginProviderInstall}
            clearProviderAuth={clearProviderAuth}
            refreshProvider={refreshProvider}
            saveCustomProvider={saveCustomProvider}
            deleteCustomProvider={deleteCustomProvider}
            pullOllamaModel={pullOllamaModel}
            ollamaPullProgress={ollamaPullProgress}
            ollamaRuntimeStatus={ollamaRuntimeStatus}
            stopOllamaRuntime={stopOllamaRuntime}
            deleteOllamaModel={deleteOllamaModel}
            saveProviderApiKey={saveProviderApiKey}
            exportDiagnostics={exportDiagnostics}
            exportActiveThreadReport={exportActiveThreadReport}
            clearAllProviderAuth={clearAllProviderAuth}
            appMeta={appMeta}
            appUpdateState={appUpdateState}
            checkForAppUpdates={checkForAppUpdates}
            restartToUpdate={requestRestartToUpdate}
            storageDiagnostics={storageDiagnostics}
            refreshStorageDiagnostics={loadStorageDiagnostics}
            compactRunEvents={compactRunEvents}
            maintainStorage={maintainStorage}
            selectedProject={workspaceProject}
            saveProjectRuntimeCommandPolicy={saveProjectRuntimeCommandPolicy}
            saveProjectRuntimeNetworkPolicy={saveProjectRuntimeNetworkPolicy}
            activeThreadTitle={activeThread?.title ?? null}
            archivedThreads={archivedThreads}
            projects={projects}
            restoreArchivedThread={restoreArchivedThread}
            deleteArchivedThread={deleteArchivedThread}
          />
        </div>
      ) : null}
      </div>
      <ModalDialog
        open={Boolean(activeImageAttachment)}
        onOpenChange={(open) => {
          if (!open) {
            setActiveImageAttachment(null);
          }
        }}
        className="thread-image-dialog"
      >
        <button
          type="button"
          className="thread-image-dialog-close"
          onClick={() => setActiveImageAttachment(null)}
          aria-label="Close image preview"
        >
          <CloseIcon />
        </button>
        {activeImageAttachment ? (
          <div className="thread-image-dialog-body">
            <img
              src={activeImageAttachment.dataUrl}
              alt={activeImageAttachment.name}
              className="thread-image-dialog-image"
            />
          </div>
        ) : null}
      </ModalDialog>
      <ConfirmDialog
        open={Boolean(deleteThreadTarget)}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteThreadTarget(null);
          }
        }}
        title="Delete thread permanently?"
        description={
          deleteThreadTarget
            ? `Archive keeps history and hides it from active lists. Delete permanently removes "${deleteThreadTarget.title}" from Vicode's local app store and cannot be undone.`
            : 'Archive keeps history and hides it from active lists. Delete permanently removes the saved thread from Vicode and cannot be undone.'
        }
        confirmLabel="Delete permanently"
        tone="danger"
        onConfirm={() => void deleteThread(deleteThreadTarget?.id ?? null)}
      />
      <ConfirmDialog
        open={microphoneConsentOpen}
        onOpenChange={setMicrophoneConsentOpen}
        title="Allow microphone access?"
        description="Vicode can use your microphone for voice dictation into the composer. Audio is recorded only when you start it."
        confirmLabel="Allow microphone"
        cancelLabel="Not now"
        onConfirm={() => void allowMicrophoneForApp()}
      />
    </div>
    </TooltipProvider>
  );
}
