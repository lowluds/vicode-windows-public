import { useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import {
  ActionButton,
  ConfirmDialog,
  DangerButton,
  MenuButton,
  ModalDialog,
  IconButton,
  Menu,
  MenuCheckboxItem,
  MenuContent,
  MenuItem,
  MenuItemLabel,
  MenuSeparator,
  MenuSub,
  MenuSubContent,
  MenuSubTrigger,
  MenuTrigger,
  PrimaryButton,
  SelectField,
  StatusPill,
  SurfaceCard,
  TextInput,
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
  ExecutionPermission,
  ImageAttachment,
  JobDefinition,
  OllamaPullProgress,
  PersonalizationSettings,
  PlannerPlan,
  PlannerQuestionAnswer,
  Preferences,
  Project,
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
  SubagentSummary,
  TextAttachment,
  ThreadDetail,
  ThreadFollowUp,
  ThreadSummary,
  VicodeBuildLaneId,
  VicodeBuildSnapshot,
  VicodeBuildVerificationResult
} from '../shared/domain';
import type { AppEvent } from '../shared/events';
import type {
  MicrophoneAccessStatus,
  NativeThemeSnapshot,
  OllamaRuntimeSnapshot,
  StorageDiagnostics,
  WorkspaceBootstrapAnswers,
  WorkspaceBootstrapDraftBundle,
  WorkspaceBootstrapQuestion,
  WorkspaceBootstrapStatus
} from '../shared/ipc';
import {
  deriveRunActivityMap,
  deriveRunReviewEvidence,
  deriveRunTranscriptItemsMap,
  type RunActivityViewModel,
  type ThinkingLineViewModel
} from './lib/run-activity';
import {
  appendRunEvent,
  deriveRecentThreads,
  extractThreadSkillIds,
  extractTurnImageAttachments,
  extractTurnTextAttachments,
  formatAutomationSchedule,
  formatTime,
  hasAssistantTurnForRun,
  isVisibleTranscriptTurn,
  mergeBootstrapRecords,
  surfaceProviders,
  upsertRecentThread
} from './lib/thread-presentation';
import {
  buildPlanReasoningLabel,
  buildPlanSetupPrompt,
  deriveBuildPlanSetupTitle,
  getBuildPlanThreadReadiness,
  isBuildPlanSetupThread,
  modelBadgeClassName
} from './lib/build-plan';
import { deriveVisiblePlannerArtifacts } from './lib/planner-visibility';
import { deriveCurrentRunId, isActiveThreadStatus } from './lib/active-run';
import { getDownloadedUpdateKey, hasAnyActiveThreadRun, isQueuedUpdateInstall } from './lib/app-update';
import { isTranscriptNearBottomPosition, shouldAutoFollowTranscript, transcriptAutoFollowThreshold } from './lib/transcript-scroll';
import { applyOptimisticComposerTurn } from './lib/composer-submit';
import { deriveLatestProviderContextWindowUsage, estimateContextWindow } from './lib/context-window';
import { formatUserErrorMessage, parseWorkspaceUnavailableError } from './lib/error-format';
import { resolveDefaultProviderId, resolveProviderModelId } from './lib/provider-defaults';
import {
  clampSidebarWidth,
  SIDEBAR_COLLAPSED_STORAGE_KEY,
  SIDEBAR_COLLAPSED_WIDTH,
  SIDEBAR_DEFAULT_WIDTH,
  SIDEBAR_MIN_WIDTH,
  SIDEBAR_WIDTH_STORAGE_KEY,
  resolveTitlebarLeadingWidth,
  resolveStoredSidebarCollapsed,
  resolveStoredSidebarWidth,
  resolveSidebarMaxWidth
} from './lib/sidebar-layout';
import { applyAccentColor, applyResolvedAppearance, getSystemPrefersDark, resolveAccentColor, resolveAppearanceMode, subscribeToSystemAppearance } from './lib/theme';
import {
  appendVoiceTranscript,
  blobToBase64,
  isVoiceDictationSupported,
  normalizeVoiceTranscript,
  resolveVoiceRecorderMimeType,
  transcodeVoiceBlobToWav,
  type VoiceState
} from './lib/voice-dictation';
import { AppSidebar } from './components/AppSidebar';
import { ChatUtilityPane } from './components/ChatUtilityPane';
import { ComposerPanel } from './components/ComposerPanel';
import { ThreadSubagentActivityCard } from './components/ThreadSubagentActivityCard';
import { PlannerPlanCard, PlannerPlanStatusRow, PlannerQuestionCard } from './components/PlannerArtifacts';
import { RunProgressPanel } from './components/RunProgressPanel';
import { RunReviewPanel } from './components/RunReviewPanel';
import { ToolApprovalPanel } from './components/ToolApprovalPanel';
import { RunActivityPanel } from './components/RunActivityPanel';
import { RunTranscriptTimeline } from './components/RunTranscriptTimeline';
import { VicodeBuildControlView } from './components/VicodeBuildControlView';
import type { ComposerActivityItem } from './components/ComposerActivityShelf';
import { folderLabel } from './lib/folder-label';
import { LandingPage } from './components/LandingPage';
import { EmptyThreadHero } from './components/EmptyThreadHero';
import { LandingBeams } from './components/LandingBeams';
import { InlineNotice } from './components/InlineNotice';
import { UiDevSurface } from './components/UiDevSurface';
import { LiveRunStatus } from './components/LiveRunStatus';
import {
  buildNativeComposerCommandPrompt,
  nativeComposerCommands,
  parseLeadingNativeComposerCommand,
  resolveNativePlanCommand,
  type NativeComposerCommandId
} from '../shared/nativeCommands';
import { normalizeDisplayText } from '../shared/display-text';
import {
  createProviderRecord,
  providerBlockedRunMessage,
  getProviderMetadata,
  providerAuthBrand,
  providerCanRunInComposer,
  providerCapabilities,
  providerDisplayName,
  providerModelRecommendationLabel,
  providerModelTriggerSummary
} from '../shared/providers';
import {
  applyRunProgressSnapshotEvent,
  countCompletedRunProgressItems,
  deriveRunProgressFromPlanner,
  deriveRunProgressSnapshots
} from '../shared/run-progress';
import { buildPluginCreatorPrompt, buildSkillCreatorPrompt } from '../shared/creatorImports';
import { splitPromptMentionedSkills } from '../shared/skills';
import { SettingsView } from './components/SettingsView';
import { SkillsView } from './components/SkillsView';
import { WindowsTitleBar } from './components/WindowsTitleBar';
import { MessageResponse } from './components/ai-elements/message';
import { AccessIcon, AccountIcon, ArchiveIcon, ArrowLeftIcon, BookIcon, CheckIcon, ChevronDownIcon, CloseIcon, CopyIcon, EditIcon, FolderIcon, MoreIcon, NoteIcon, PlayIcon, PlusIcon, RefreshIcon, SaveIcon, TaskIcon, TrashIcon } from './components/icons';
import { cx } from './components/ui/utils';
import wolfLogo from './assets/wolf-logo.png';
import { createEmptyCollaborationBootstrap, type CollaborationSection } from './lib/collaboration';

type Route = 'thread' | 'collab' | 'skills' | 'build-control' | 'automations' | 'settings' | 'ui-dev';
type ComposerEffort = 'Low' | 'Medium' | 'High' | 'Extra high';

const COLLABORATION_SHELL_ENABLED = false;

interface ComposerState {
  prompt: string;
  providerId: ProviderId;
  modelId: string;
  thinkingEnabled: boolean;
  mode: ComposerMode;
  executionPermission: ExecutionPermission;
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

type AutomationDraftState = {
  id: string | null;
  name: string;
  promptTemplate: string;
  providerId: ProviderId;
  modelId: string;
  skillId: string;
  scheduleType: 'manual' | 'interval_while_app_open';
  intervalMinutes: string;
};

type BuildPlanLaunchState = {
  goal: string;
  providerId: ProviderId;
  modelId: string;
  reasoningEffort: ProviderReasoningEffort | null;
};

type AutomationTemplate = {
  id: string;
  name: string;
  summary: string;
  promptTemplate: string;
  group: 'Status reports' | 'Release prep' | 'Incidents & triage' | 'Code quality';
};

const AUTOMATION_TEMPLATES: AutomationTemplate[] = [
  {
    id: 'repo-health-check',
    group: 'Status reports',
    name: 'Repo health check',
    summary: 'Summarize the latest repo activity and flag anything that needs attention.',
    promptTemplate:
      'Review the recent activity in this project and produce a concise status report. Ground statements in commits, changed files, PRs, and test results when available. Highlight blockers, risky areas, and the most useful next step.'
  },
  {
    id: 'weekly-change-summary',
    group: 'Status reports',
    name: 'Weekly change summary',
    summary: 'Synthesize the latest merged work into a readable weekly update.',
    promptTemplate:
      'Summarize the most important changes made in this project recently. Organize by theme, mention notable files or PRs when available, and call out anything that still needs follow-up.'
  },
  {
    id: 'release-notes-draft',
    group: 'Release prep',
    name: 'Draft release notes',
    summary: 'Turn merged work into a release-ready notes draft.',
    promptTemplate:
      'Draft release notes for the latest shipped changes in this project. Group items into user-facing improvements, fixes, and internal changes. Keep it concise and readable, and include references to relevant files or PRs when available.'
  },
  {
    id: 'pre-release-check',
    group: 'Release prep',
    name: 'Pre-release check',
    summary: 'Verify changelog, migrations, tests, and risky flags before release.',
    promptTemplate:
      'Inspect this project before release and report whether it looks ready to ship. Check for recent test failures, pending migrations, changelog gaps, risky configuration changes, and obvious release blockers. End with a clear go/no-go recommendation.'
  },
  {
    id: 'incident-triage',
    group: 'Incidents & triage',
    name: 'Incident triage',
    summary: 'Group current failures by likely root cause and suggest the smallest useful fix.',
    promptTemplate:
      'Review recent failures, incidents, or unstable areas in this project and group them by likely root cause. Suggest the smallest high-leverage fixes first and call out the evidence for each recommendation.'
  },
  {
    id: 'issue-triage',
    group: 'Incidents & triage',
    name: 'Issue triage',
    summary: 'Triage new issues and propose priority, owner, and next action.',
    promptTemplate:
      'Review recent open issues or project pain points and triage them. Suggest likely priority, probable owner, and the best next action for each item. Keep the output concise and operational.'
  },
  {
    id: 'dependency-audit',
    group: 'Code quality',
    name: 'Dependency audit',
    summary: 'Look for outdated, risky, or high-noise dependencies and propose cleanup.',
    promptTemplate:
      'Audit this project for dependency risk and maintenance issues. Identify outdated, noisy, or risky dependencies, explain the impact, and suggest the most practical cleanup plan.'
  },
  {
    id: 'quality-review',
    group: 'Code quality',
    name: 'Quality review',
    summary: 'Scan for obvious hotspots, flaky areas, and code paths worth tightening.',
    promptTemplate:
      'Review this project for code quality risks. Focus on fragile areas, repeated patterns, weak testing coverage, and obvious maintainability issues. Prioritize the findings and suggest the most valuable follow-up work.'
  }
];

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

function shouldShowStartupWelcome(payload: BootstrapData) {
  return !payload.preferences.onboardingComplete && payload.projects.length === 0 && !payload.preferences.lastOpenedThreadId;
}

function createEmptyWorkspaceBootstrapAnswers(): WorkspaceBootstrapAnswers {
  return {
    projectIntent: '',
    optimizationPriority: '',
    communicationStyle: '',
    approvalBoundary: '',
    repoConstraints: '',
    wantsSoul: false,
    todayFocus: '',
    recentDecisions: [],
    openQuestions: [],
    followUps: []
  };
}

function compactBootstrapPrefill(value: string | null | undefined, maxLength = 180) {
  const normalized = value?.replace(/\s+/gu, ' ').trim() ?? '';
  if (!normalized) {
    return '';
  }
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength).trimEnd()}...`;
}

function deriveApprovalBoundaryPrefill(executionPermission: ExecutionPermission | null | undefined) {
  if (executionPermission === 'full_access') {
    return 'destructive changes, dependency installs, or actions outside the workspace';
  }
  return 'risky actions, destructive changes, or large refactors';
}

function createWorkspaceBootstrapAnswerDefaults(input: {
  selectedProject: Project | null;
  preferences: Preferences | null;
  personalization: PersonalizationSettings;
}): WorkspaceBootstrapAnswers {
  const preferredProviderId = input.selectedProject?.defaultProviderId ?? input.preferences?.defaultProviderId ?? null;
  const preferredModelId = preferredProviderId
    ? input.selectedProject?.defaultModelByProvider[preferredProviderId]
      ?? input.preferences?.defaultModelByProvider[preferredProviderId]
      ?? null
    : null;
  const durablePreferences = [
    preferredProviderId ? `Default provider for this workspace: ${preferredProviderId}.` : null,
    preferredModelId && preferredProviderId ? `Preferred ${preferredProviderId} model: ${preferredModelId}.` : null,
    `Workspace instructions are ${input.personalization.useWorkspaceInstructions ? 'enabled' : 'disabled'} in app settings.`
  ].filter((value): value is string => Boolean(value));

  return {
    ...createEmptyWorkspaceBootstrapAnswers(),
    projectIntent: compactBootstrapPrefill(input.selectedProject?.name),
    communicationStyle: compactBootstrapPrefill(input.personalization.globalInstructions),
    approvalBoundary: deriveApprovalBoundaryPrefill(input.preferences?.defaultExecutionPermission),
    durablePreferences
  };
}

function splitDraftList(value: string) {
  return value
    .split(/\r?\n/u)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function isMissingThreadError(error: unknown) {
  return error instanceof Error && /^Thread not found:/u.test(error.message);
}

type ReviewPresentation = {
  icon: 'note' | 'memory' | 'user' | 'automation';
  kindLabel: string;
  title: string;
  summary: string;
  meta: Array<{ label: string; value: string }>;
  isManualWrite: boolean;
};

function describeReviewItem(reviewItem: ReviewItem, job: JobDefinition | null): ReviewPresentation {
  if (reviewItem.details.actionType === 'daily_note_capture') {
    return {
      icon: 'note',
      kindLabel: 'Daily note draft',
      title: normalizeDisplayText(job?.title ?? 'Review daily note write'),
      summary: normalizeDisplayText(reviewItem.summary),
      meta: [
        { label: 'File', value: String(reviewItem.details.relativePath ?? 'memory') },
        { label: 'Thread', value: normalizeDisplayText(String(reviewItem.details.threadTitle ?? 'thread capture')) }
      ],
      isManualWrite: true
    };
  }

  if (reviewItem.details.actionType === 'memory_promotion') {
    return {
      icon: 'memory',
      kindLabel: 'Durable memory update',
      title: normalizeDisplayText(job?.title ?? 'Review MEMORY.md update'),
      summary: normalizeDisplayText(reviewItem.summary),
      meta: [
        { label: 'File', value: String(reviewItem.details.relativePath ?? 'MEMORY.md') },
        { label: 'Thread', value: normalizeDisplayText(String(reviewItem.details.threadTitle ?? 'memory promotion')) }
      ],
      isManualWrite: true
    };
  }

  if (reviewItem.details.actionType === 'user_preference') {
    return {
      icon: 'user',
      kindLabel: 'USER.md suggestion',
      title: normalizeDisplayText(job?.title ?? 'Review USER.md update'),
      summary: normalizeDisplayText(reviewItem.summary),
      meta: [
        { label: 'File', value: String(reviewItem.details.relativePath ?? 'USER.md') },
        { label: 'Thread', value: normalizeDisplayText(String(reviewItem.details.threadTitle ?? 'user preference')) }
      ],
      isManualWrite: true
    };
  }

  return {
    icon: 'automation',
    kindLabel: 'Automation approval',
    title: normalizeDisplayText(job?.title ?? reviewItem.summary),
    summary: normalizeDisplayText(reviewItem.summary),
    meta: [
      { label: 'Trigger', value: String(reviewItem.details.trigger ?? 'manual') },
      { label: 'Provider', value: String(reviewItem.details.providerId ?? 'unknown') },
      { label: 'Model', value: String(reviewItem.details.modelId ?? 'unknown') }
    ],
    isManualWrite: false
  };
}

function renderReviewIcon(icon: ReviewPresentation['icon']) {
  switch (icon) {
    case 'note':
      return <NoteIcon />;
    case 'memory':
      return <BookIcon />;
    case 'user':
      return <AccountIcon />;
    case 'automation':
    default:
      return <TaskIcon />;
  }
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

function isTranscriptNearBottom(element: HTMLElement, threshold = transcriptAutoFollowThreshold) {
  return isTranscriptNearBottomPosition({
    scrollHeight: element.scrollHeight,
    scrollTop: element.scrollTop,
    clientHeight: element.clientHeight
  }, threshold);
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

function requiresSlashCommandBody(commandId: NativeComposerCommandId) {
  return commandId !== 'plan' && commandId !== 'autonomous-builds';
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
  const [vicodeBuildSnapshot, setVicodeBuildSnapshot] = useState<VicodeBuildSnapshot | null>(null);
  const [vicodeBuildVerification, setVicodeBuildVerification] = useState<VicodeBuildVerificationResult | null>(null);
  const [vicodeBuildBusyAction, setVicodeBuildBusyAction] = useState<string | null>(null);
  const [buildPlanDialogOpen, setBuildPlanDialogOpen] = useState(false);
  const [buildPlanLaunch, setBuildPlanLaunch] = useState<BuildPlanLaunchState>({
    goal: '',
    providerId: 'openai',
    modelId: getProviderMetadata('openai').defaultModelId,
    reasoningEffort: getProviderMetadata('openai').defaultReasoningEffort
  });
  const [jobs, setJobs] = useState<JobDefinition[]>([]);
  const [reviewItems, setReviewItems] = useState<ReviewItem[]>([]);
  const [providers, setProviders] = useState<ProviderDescriptor[]>([]);
  const [preferences, setPreferences] = useState<Preferences | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    if (typeof window === 'undefined') {
      return false;
    }
    return resolveStoredSidebarCollapsed(window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY));
  });
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    if (typeof window === 'undefined') {
      return SIDEBAR_DEFAULT_WIDTH;
    }
    return resolveStoredSidebarWidth(window.localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY), window.innerWidth);
  });
  const [sidebarResizing, setSidebarResizing] = useState(false);
  const [nativeTheme, setNativeTheme] = useState<NativeThemeSnapshot | null>(null);
  const [personalization, setPersonalization] = useState<PersonalizationSettings>({
    globalInstructions: '',
    providerInstructions: createProviderRecord(() => ''),
    useWorkspaceInstructions: true
  });
  const [appMeta, setAppMeta] = useState<AppMeta | null>(null);
  const [appUpdateState, setAppUpdateState] = useState<AppUpdateState | null>(null);
  const [queuedUpdateInstallKey, setQueuedUpdateInstallKey] = useState<string | null>(null);
  const [storageDiagnostics, setStorageDiagnostics] = useState<StorageDiagnostics | null>(null);
  const [archivedThreads, setArchivedThreads] = useState<ThreadSummary[]>([]);
  const [removingProjectId, setRemovingProjectId] = useState<string | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [expandedProjectIds, setExpandedProjectIds] = useState<string[]>([]);
  const [missingWorkspaceProjectId, setMissingWorkspaceProjectId] = useState<string | null>(null);
  const [settingsSection, setSettingsSection] = useState<SettingsSection>('general');
  const [lastContentRoute, setLastContentRoute] = useState<Exclude<Route, 'settings'>>('thread');
  const [composerEffort, setComposerEffort] = useState<ComposerEffort>('High');
  const [voiceState, setVoiceState] = useState<VoiceState>('idle');
  const [voiceElapsedMs, setVoiceElapsedMs] = useState(0);
  const [voiceLevel, setVoiceLevel] = useState(0);
  const [enhancingPrompt, setEnhancingPrompt] = useState(false);
  const [pendingNativeCommandId, setPendingNativeCommandId] = useState<NativeComposerCommandId | null>(null);
  const [composer, setComposer] = useState<ComposerState>({
    prompt: '',
    providerId: 'openai',
    modelId: getProviderMetadata('openai').defaultModelId,
    thinkingEnabled: true,
    mode: 'default',
    executionPermission: 'default',
    imageAttachments: [],
    textAttachments: []
  });
  const [attachedSkillIds, setAttachedSkillIds] = useState<string[]>([]);
  const [editingFollowUpId, setEditingFollowUpId] = useState<string | null>(null);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [runProgressByRunId, setRunProgressByRunId] = useState<Record<string, RunProgressState>>({});
  const [pendingRunToolApprovals, setPendingRunToolApprovals] = useState<RunToolApprovalRequest[]>([]);
  const [toolApprovalResolvingId, setToolApprovalResolvingId] = useState<string | null>(null);
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
  const [workspaceBootstrapStatus, setWorkspaceBootstrapStatus] = useState<WorkspaceBootstrapStatus | null>(null);
  const [workspaceBootstrapQuestions, setWorkspaceBootstrapQuestions] = useState<WorkspaceBootstrapQuestion[]>([]);
  const [workspaceBootstrapModalOpen, setWorkspaceBootstrapModalOpen] = useState(false);
  const [workspaceBootstrapDraftBundle, setWorkspaceBootstrapDraftBundle] = useState<WorkspaceBootstrapDraftBundle | null>(null);
  const [workspaceBootstrapAnswers, setWorkspaceBootstrapAnswers] = useState<WorkspaceBootstrapAnswers>(() => createEmptyWorkspaceBootstrapAnswers());
  const [workspaceBootstrapIncludeSoul, setWorkspaceBootstrapIncludeSoul] = useState(false);
  const [workspaceBootstrapIncludeDailyNote, setWorkspaceBootstrapIncludeDailyNote] = useState(false);
  const [workspaceBootstrapSelectedDraftPaths, setWorkspaceBootstrapSelectedDraftPaths] = useState<string[]>([]);
  const [workspaceBootstrapActiveDraftPath, setWorkspaceBootstrapActiveDraftPath] = useState<string | null>(null);
  const [workspaceBootstrapBusy, setWorkspaceBootstrapBusy] = useState(false);
  const [reviewDraftEdits, setReviewDraftEdits] = useState<Record<string, string>>({});
  const [reviewDraftSavingId, setReviewDraftSavingId] = useState<string | null>(null);
  const [microphoneConsentOpen, setMicrophoneConsentOpen] = useState(false);
  const [automationDraft, setAutomationDraft] = useState<AutomationDraftState>(() =>
    createAutomationDraft('openai', getProviderMetadata('openai').defaultModelId)
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
  const transcriptAutoFollowRef = useRef(true);
  const transcriptProgrammaticScrollRef = useRef(false);
  const transcriptUserScrollIntentRef = useRef(false);
  const transcriptUserScrollIntentTimeoutRef = useRef<number | null>(null);
  const transcriptThreadIdRef = useRef<string | null>(null);
  const installPollingRef = useRef<Partial<Record<ProviderId, number>>>({});
  const sidebarResizeStateRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const liveSidebarWidthRef = useRef(SIDEBAR_DEFAULT_WIDTH);
  const sidebarResizeFrameRef = useRef<number | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const voiceChunksRef = useRef<Blob[]>([]);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const analyserFrameRef = useRef<number | null>(null);
  const voiceTimerRef = useRef<number | null>(null);
  const voiceRecordingStartedAtRef = useRef<number | null>(null);
  const selectedProjectIdRef = useRef<string | null>(null);
  const activeThreadIdRef = useRef<string | null>(null);
  const hydratedDraftThreadIdRef = useRef<string | null>(null);
  const pendingReviewSectionRef = useRef<HTMLDivElement | null>(null);
  const pendingReviewToastShownRef = useRef(false);
  const pendingReviewRevealRequestedRef = useRef(false);
  const downloadedUpdateToastVersionRef = useRef<string | null>(null);
  const reviewItemsRef = useRef<ReviewItem[]>([]);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  function markTranscriptUserScrollIntent() {
    transcriptUserScrollIntentRef.current = true;
    if (transcriptUserScrollIntentTimeoutRef.current !== null) {
      window.clearTimeout(transcriptUserScrollIntentTimeoutRef.current);
    }
    transcriptUserScrollIntentTimeoutRef.current = window.setTimeout(() => {
      transcriptUserScrollIntentRef.current = false;
      transcriptUserScrollIntentTimeoutRef.current = null;
    }, 180);
  }

  useEffect(() => {
    reviewItemsRef.current = reviewItems;
  }, [reviewItems]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    window.localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, String(sidebarCollapsed));
  }, [sidebarCollapsed]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    window.localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(sidebarWidth));
  }, [sidebarWidth]);

  useEffect(() => {
    liveSidebarWidthRef.current = sidebarWidth;
  }, [sidebarWidth]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    return () => {
      if (sidebarResizeFrameRef.current !== null) {
        window.cancelAnimationFrame(sidebarResizeFrameRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    function syncSidebarWidthToViewport() {
      setSidebarWidth((current) => clampSidebarWidth(current, window.innerWidth));
    }

    window.addEventListener('resize', syncSidebarWidthToViewport);
    return () => window.removeEventListener('resize', syncSidebarWidthToViewport);
  }, []);

  function paintSidebarWidth(nextWidth: number) {
    liveSidebarWidthRef.current = nextWidth;
    if (typeof window === 'undefined') {
      return;
    }
    if (sidebarResizeFrameRef.current !== null) {
      return;
    }
    sidebarResizeFrameRef.current = window.requestAnimationFrame(() => {
      sidebarResizeFrameRef.current = null;
      const width = liveSidebarWidthRef.current;
      const appShell = appShellRef.current;
      if (appShell) {
        appShell.style.setProperty('--vicode-sidebar-width', `${width}px`);
        appShell.style.setProperty('--windows-titlebar-leading-width', `${width}px`);
      }
      const sidebarShell = sidebarShellRef.current;
      if (sidebarShell) {
        sidebarShell.style.width = `${width}px`;
        sidebarShell.style.minWidth = `${width}px`;
        sidebarShell.style.maxWidth = `${width}px`;
      }
    });
  }

  useEffect(() => {
    if (!sidebarResizing || typeof window === 'undefined') {
      return;
    }

    function finishSidebarResize() {
      const committedWidth = liveSidebarWidthRef.current;
      sidebarResizeStateRef.current = null;
      setSidebarResizing(false);
      setSidebarWidth(committedWidth);
    }

    function handleSidebarResize(event: PointerEvent) {
      const currentResize = sidebarResizeStateRef.current;
      if (!currentResize) {
        return;
      }
      const nextWidth = currentResize.startWidth + (event.clientX - currentResize.startX);
      paintSidebarWidth(clampSidebarWidth(nextWidth, window.innerWidth));
    }

    document.body.classList.add('is-sidebar-resizing');
    window.addEventListener('pointermove', handleSidebarResize);
    window.addEventListener('pointerup', finishSidebarResize);
    window.addEventListener('blur', finishSidebarResize);

    return () => {
      document.body.classList.remove('is-sidebar-resizing');
      window.removeEventListener('pointermove', handleSidebarResize);
      window.removeEventListener('pointerup', finishSidebarResize);
      window.removeEventListener('blur', finishSidebarResize);
    };
  }, [sidebarResizing]);

  function toggleSidebarCollapsed() {
    setSidebarCollapsed((current) => !current);
  }

  function startSidebarResize(event: ReactPointerEvent<HTMLDivElement>) {
    if (sidebarCollapsed || typeof window === 'undefined') {
      return;
    }
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    liveSidebarWidthRef.current = sidebarWidth;
    sidebarResizeStateRef.current = {
      startX: event.clientX,
      startWidth: sidebarWidth
    };
    setSidebarResizing(true);
  }

  const shellReady = ready && !loading;
  const showWelcomeScreen =
    shellReady &&
    route === 'thread' &&
    showStartupWelcome &&
    !activeThread;
  const effectiveSidebarWidth = shellReady && !showWelcomeScreen
    ? sidebarCollapsed
      ? SIDEBAR_COLLAPSED_WIDTH
      : sidebarWidth
    : 0;
  const titlebarLeadingWidth = resolveTitlebarLeadingWidth(sidebarCollapsed || showWelcomeScreen || !shellReady, sidebarWidth);
  const sidebarResizeMaxWidth =
    typeof window === 'undefined'
      ? SIDEBAR_DEFAULT_WIDTH
      : resolveSidebarMaxWidth(window.innerWidth);

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
  const buildPlanLaunchProvider = useMemo(
    () => visibleProviders.find((provider) => provider.id === buildPlanLaunch.providerId) ?? null,
    [buildPlanLaunch.providerId, visibleProviders]
  );
  const buildPlanLaunchModelOptions = buildPlanLaunchProvider?.models ?? [];
  const automationDeleteTarget = automationDeleteId
    ? automations.find((automation) => automation.id === automationDeleteId) ?? null
    : null;
  const automationHistoryTarget = automationHistoryId
    ? automations.find((automation) => automation.id === automationHistoryId) ?? null
    : null;
  const automationTemplateGroups = useMemo(() => {
    const groups = new Map<AutomationTemplate['group'], AutomationTemplate[]>();
    for (const template of AUTOMATION_TEMPLATES) {
      const current = groups.get(template.group) ?? [];
      current.push(template);
      groups.set(template.group, current);
    }
    return Array.from(groups.entries());
  }, []);
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

  useEffect(() => {
    setBuildPlanLaunch((current) => {
      const nextProviderId = visibleProviders.some((provider) => provider.id === current.providerId)
        ? current.providerId
        : resolveDefaultProviderId(visibleProviders, composer.providerId);
      const nextModelId = resolveProviderModelId(visibleProviders, nextProviderId, current.modelId);
      const nextReasoningEffort =
        nextProviderId === current.providerId
          ? current.reasoningEffort
          : getProviderMetadata(nextProviderId).defaultReasoningEffort;
      if (
        nextProviderId === current.providerId
        && nextModelId === current.modelId
        && nextReasoningEffort === current.reasoningEffort
      ) {
        return current;
      }
      return {
        ...current,
        providerId: nextProviderId,
        modelId: nextModelId,
        reasoningEffort: nextReasoningEffort
      };
    });
  }, [composer.providerId, visibleProviders]);

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
    if (activePlannerTurnState === 'executing_from_plan' && activePlannerPlan?.createdTurnId) {
      return activePlannerPlan.createdTurnId;
    }
    if (activeDisplayedRunId && activeThread && hasAssistantTurnForRun(activeThread, activeDisplayedRunId)) {
      return [...activeThread.turns].reverse().find((turn) => turn.role === 'assistant' && turn.runId === activeDisplayedRunId)?.id ?? lastVisibleUserTurnId;
    }
    return lastVisibleUserTurnId;
  }, [activeDisplayedRunId, activePlannerPlan?.createdTurnId, activePlannerTurnState, activeThread, lastVisibleUserTurnId]);
  const activeRunProgress = useMemo(
    () =>
      (activeDisplayedRunId ? runProgressByRunId[activeDisplayedRunId] ?? null : null) ??
      (activeDisplayedRunId && activeThread
        ? deriveRunProgressFromPlanner(activePlannerPlan, activePlannerTurnState, activeDisplayedRunId, activeThread.id)
        : null),
    [activeDisplayedRunId, activePlannerPlan, activePlannerTurnState, activeThread, runProgressByRunId]
  );
  const activeRunReviewEvidence = useMemo(
    () => deriveRunReviewEvidence(activeRunActivity, activeRunProgress),
    [activeRunActivity, activeRunProgress]
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
      items.push({
        id: 'planner-plan',
        title: 'Build plan',
        summary: '',
        defaultOpen: activePlannerPlan.status !== 'approved',
        variant: 'plain',
        content:
          activePlannerPlan.status === 'approved' ? (
            <PlannerPlanStatusRow
              plan={activePlannerPlan}
              approvedStatusText={
                isBuildPlanSetupThread(activeThread)
                  ? 'Approved. Autonomous Builds handoff started from this setup thread.'
                  : undefined
              }
            />
          ) : (
            <PlannerPlanCard
              plan={activePlannerPlan}
              plannerPolicy={activeThreadProvider?.plannerPolicy ?? null}
              renderedMarkdown={activePlannerPlan.proposedPlanMarkdown}
              approving={planApproving || vicodeBuildBusyAction === 'create-plan-from-thread'}
              submitting={plannerSubmitting}
              approveLabel={
                isBuildPlanSetupThread(activeThread)
                  ? 'Accept and start Autonomous Builds'
                  : undefined
              }
              approvedCardText={
                isBuildPlanSetupThread(activeThread)
                  ? 'This plan was approved and handed off into Autonomous Builds.'
                  : undefined
              }
              onApprove={
                isBuildPlanSetupThread(activeThread)
                  ? createBuildPlanFromActiveThread
                  : () => approvePlannerPlan(activePlannerPlan)
              }
              onRequestChanges={requestPlannerChanges}
              onCancelPlan={cancelPlannerSession}
            />
          )
      });
    }

    if (activeRunToolApproval) {
      const approvalSummary =
        activeRunToolApproval.toolName === 'use_mcp_tool' && activeRunToolApproval.command.startsWith('MCP ')
          ? activeRunToolApproval.command.replace(/^MCP\s+/u, '')
          : activeRunToolApproval.toolName;
      items.push({
        id: 'tool-approval',
        title: 'Pending approval',
        summary: approvalSummary,
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

    if (activeRunProgress && activeRunActivity?.state !== 'running') {
      const completedCount = countCompletedRunProgressItems(activeRunProgress);
        items.push({
          id: 'run-progress',
          title: 'Current run',
          summary: `${completedCount} of ${activeRunProgress.items.length} tasks completed`,
          content: <RunProgressPanel progress={activeRunProgress} />
        });
      }

    if (activeRunReviewEvidence && activeRunReviewEvidence.state !== 'running') {
      const changedFileCount = activeRunReviewEvidence.changeArtifact?.summary.filesChanged ?? 0;
      const thoughtCount = activeRunReviewEvidence.thoughtEvidence.length;
      const fileEvidenceCount = activeRunReviewEvidence.fileEvidence.length;
      const commandCount = activeRunReviewEvidence.terminalCommands.length;
      const summaryParts = [
        thoughtCount > 0 ? `${thoughtCount} thought${thoughtCount === 1 ? '' : 's'}` : null,
        commandCount > 0 ? `${commandCount} command${commandCount === 1 ? '' : 's'}` : null,
        changedFileCount > 0
          ? `${changedFileCount} file${changedFileCount === 1 ? '' : 's'} changed`
          : fileEvidenceCount > 0
            ? `${fileEvidenceCount} file action${fileEvidenceCount === 1 ? '' : 's'}`
            : null
      ].filter((value): value is string => Boolean(value));
      items.push({
        id: 'run-review',
        title: activeRunReviewEvidence.workedForLabel ? `Worked for ${activeRunReviewEvidence.workedForLabel}` : 'Run details',
        summary: summaryParts.join(' · '),
        content: <RunReviewPanel evidence={activeRunReviewEvidence} />
      });
    }

    return items;
  }, [
    activePlannerPlan,
    activePlannerQuestions,
    activeRunProgress,
    activeRunReviewEvidence,
    activeRunToolApproval,
    activeThread,
    activeThreadProvider?.plannerPolicy,
    approveRunToolApproval,
    createBuildPlanFromActiveThread,
    enableWorkspaceAutoApproveAndApprove,
    plannerSubmitting,
    planApproving,
    rejectRunToolApproval,
    requestPlannerChanges,
    skills,
    submitPlannerAnswers,
    toolApprovalResolvingId,
    vicodeBuildBusyAction,
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
          return `${item.kind}:${item.id}:${item.label}`;
        })
        .join('|'),
    [activeRunTranscriptItems]
  );

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
      workspaceProject?.defaultModelByProvider[nextProviderId] ?? preferences.defaultModelByProvider[nextProviderId]
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
    if (!COLLABORATION_SHELL_ENABLED && route === 'collab') {
      setRoute('thread');
    }
  }, [route]);

  useEffect(() => {
    if (route !== 'automations' && route !== 'build-control') {
      return;
    }

    let cancelled = false;
    void Promise.all([
      window.vicode.automations.list(),
      window.vicode.jobs.list(),
      window.vicode.jobs.listPendingReviews()
    ]).then(([nextAutomations, nextJobs, nextReviewItems]) => {
      if (cancelled) {
        return;
      }
      setAutomations(nextAutomations);
      setJobs(nextJobs);
      setReviewItems(nextReviewItems);
    });

    void window.vicode.vicodeBuild.getSnapshot(selectedProjectId).then((snapshot) => {
      if (!cancelled) {
        setVicodeBuildSnapshot(snapshot);
      }
    });

    const refreshTimer = window.setInterval(() => {
      void window.vicode.vicodeBuild.getSnapshot(selectedProjectIdRef.current).then((snapshot) => {
        if (!cancelled) {
          setVicodeBuildSnapshot(snapshot);
        }
      });
    }, 10000);

    return () => {
      cancelled = true;
      window.clearInterval(refreshTimer);
    };
  }, [route, selectedProjectId]);

  useEffect(() => {
    if (!pendingReviewRevealRequestedRef.current || (route !== 'automations' && route !== 'build-control')) {
      return;
    }

    if (reviewItems.length === 0) {
      pendingReviewRevealRequestedRef.current = false;
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      pendingReviewSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      pendingReviewRevealRequestedRef.current = false;
    });

    return () => window.cancelAnimationFrame(frame);
  }, [reviewItems.length, route]);

  useEffect(() => {
    setComposer((current) => ({
      ...current,
      modelId: resolveProviderModelId(visibleProviders, current.providerId, current.modelId)
    }));
  }, [visibleProviders]);

  useEffect(() => {
    setAttachedSkillIds((current) =>
      current.filter((skillId) => availableComposerSkills.some((skill) => skill.id === skillId))
    );
  }, [availableComposerSkills]);

  useEffect(() => {
    selectedProjectIdRef.current = selectedProjectId;
  }, [selectedProjectId]);

  useEffect(() => {
    activeThreadIdRef.current = activeThread?.id ?? null;
  }, [activeThread]);

  useEffect(() => {
    const threadEntries = Object.values(threadsByProject).flat();
    if (threadEntries.length === 0) {
      setAutonomousTasksByThreadId({});
      setSubagentsByThreadId({});
      return;
    }

    let cancelled = false;
    void Promise.all(
      threadEntries.map(async (thread) => [thread.id, await window.vicode.subagents.list(thread.id)] as const)
    ).then((pairs) => {
      if (cancelled) {
        return;
      }
      const nextByThread = Object.fromEntries(pairs.filter(([, subagents]) => subagents.length > 0));
      setSubagentsByThreadId(nextByThread);
    });

    return () => {
      cancelled = true;
    };
  }, [threadSubagentSignature, threadsByProject]);

  useEffect(() => {
    if (!activeThread) {
      return;
    }

    const parentThreadId = findParentThreadIdForSubagentChild(subagentsByThreadId, activeThread.id);
    if (!parentThreadId || parentThreadId === activeThread.id) {
      return;
    }

    void openThread(parentThreadId);
  }, [activeThread, subagentsByThreadId]);

  useEffect(() => {
    const threadId = activeThread?.id ?? null;
    if (!threadId) {
      return;
    }

    let cancelled = false;
    void window.vicode.threads.listAutonomousTasks(threadId).then((tasks) => {
      if (cancelled || activeThreadIdRef.current !== threadId) {
        return;
      }
      setAutonomousTasksByThreadId((current) => ({
        ...current,
        [threadId]: tasks
      }));
    });

    return () => {
      cancelled = true;
    };
  }, [activeThread]);

  useEffect(() => {
    if (startupThreadRestoreState === 'pending' && activeThread) {
      setStartupThreadRestoreState('resolved');
    }
  }, [activeThread, startupThreadRestoreState]);

  useEffect(() => {
    const threadId = activeThread?.id ?? null;
    hydratedDraftThreadIdRef.current = null;

    if (!threadId) {
      return;
    }

    let cancelled = false;
    void window.vicode.threads.getDraft(threadId).then((draft) => {
      if (cancelled || activeThreadIdRef.current !== threadId) {
        return;
      }

      hydratedDraftThreadIdRef.current = threadId;
      setComposer((current) => ({ ...current, prompt: draft }));
    });

    return () => {
      cancelled = true;
    };
  }, [activeThread?.id]);

  useEffect(() => {
    const threadId = activeThread?.id ?? null;
    if (!threadId || hydratedDraftThreadIdRef.current !== threadId) {
      return;
    }

    const timeout = window.setTimeout(() => {
      void window.vicode.threads.saveDraft(threadId, composer.prompt);
    }, 280);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [activeThread?.id, composer.prompt]);

  useLayoutEffect(() => {
    const element = transcriptRef.current;
    if (!element || route !== 'thread') {
      return;
    }

    const threadId = activeThread?.id ?? null;
    const threadChanged = transcriptThreadIdRef.current !== threadId;
    transcriptThreadIdRef.current = threadId;
    const shouldStickToBottom = shouldAutoFollowTranscript({
      threadChanged,
      autoFollow: transcriptAutoFollowRef.current
    });

    if (!shouldStickToBottom) {
      return;
    }

    const scrollToBottom = () => {
      transcriptProgrammaticScrollRef.current = true;
      element.scrollTop = element.scrollHeight;
      transcriptAutoFollowRef.current = true;
    };

    let nestedFrame: number | null = null;
    let releaseProgrammaticScrollFrame: number | null = null;
    const frame = window.requestAnimationFrame(() => {
      if (!shouldAutoFollowTranscript({ threadChanged, autoFollow: transcriptAutoFollowRef.current })) {
        return;
      }
      scrollToBottom();
      nestedFrame = window.requestAnimationFrame(() => {
        if (!shouldAutoFollowTranscript({ threadChanged, autoFollow: transcriptAutoFollowRef.current })) {
          return;
        }
        scrollToBottom();
        releaseProgrammaticScrollFrame = window.requestAnimationFrame(() => {
          transcriptProgrammaticScrollRef.current = false;
        });
      });
    });

    return () => {
      transcriptProgrammaticScrollRef.current = false;
      transcriptUserScrollIntentRef.current = false;
      if (transcriptUserScrollIntentTimeoutRef.current !== null) {
        window.clearTimeout(transcriptUserScrollIntentTimeoutRef.current);
        transcriptUserScrollIntentTimeoutRef.current = null;
      }
      window.cancelAnimationFrame(frame);
      if (nestedFrame !== null) {
        window.cancelAnimationFrame(nestedFrame);
      }
      if (releaseProgrammaticScrollFrame !== null) {
        window.cancelAnimationFrame(releaseProgrammaticScrollFrame);
      }
    };
  }, [
    route,
    activeThread?.id,
    transcriptTurns.length,
    transcriptTurns[transcriptTurns.length - 1]?.id,
    transcriptTurns[transcriptTurns.length - 1]?.content,
    activeDisplayedRunId,
    activeRunTranscriptAutoFollowKey,
    activeRunActivity?.state,
    activeRunActivity?.timelineItems.length,
    activeRunActivity?.terminalCommands.length,
    activePlannerQuestions?.id,
    activePlannerPlan?.id
  ]);

  useEffect(() => {
    void bootstrap();
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
      const recorder = mediaRecorderRef.current;
      if (recorder) {
        recorder.ondataavailable = null;
        recorder.onerror = null;
        recorder.onstop = null;
        if (recorder.state !== 'inactive') {
          try {
            recorder.stop();
          } catch {
            // Ignore teardown failures from the media recorder.
          }
        }
        mediaRecorderRef.current = null;
      }
      mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
      voiceChunksRef.current = [];
      stopVoiceVisualization();
    };
  }, []);

  useEffect(() => {
    void window.vicode.app.getNativeTheme()
      .then((value) => {
        setNativeTheme(value);
      })
      .catch(() => {
        setNativeTheme({
          platform: 'win32',
          systemAccentColor: ''
        });
      });
  }, []);

  useEffect(() => {
    if (!preferences) {
      return;
    }

    applyResolvedAppearance(resolveAppearanceMode(preferences.appearanceMode, getSystemPrefersDark()));
    applyAccentColor(
      resolveAccentColor(preferences.accentMode, preferences.accentColor, nativeTheme?.systemAccentColor)
    );

    if (preferences.appearanceMode !== 'system') {
      return;
    }

    return subscribeToSystemAppearance((appearance) => applyResolvedAppearance(appearance));
  }, [nativeTheme?.systemAccentColor, preferences]);

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
        setRoute('build-control');
      } else if (event.key === '4') {
        event.preventDefault();
        setSettingsSection('general');
        toggleSettingsRoute();
      } else if (COLLABORATION_SHELL_ENABLED && event.key === '5') {
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

  async function bootstrap() {
    setLoading(true);
    try {
      const payload = await window.vicode.app.getBootstrap();
      applyResolvedAppearance(resolveAppearanceMode(payload.preferences.appearanceMode, getSystemPrefersDark()));
      applyBootstrap(payload);
      setReady(true);
      setLoading(false);

      void window.vicode.app.getMeta()
        .then((value) => {
          setAppMeta(value);
        })
        .catch(() => {
          setAppMeta(null);
          showToast('warning', 'App metadata is unavailable from the current main-process build.');
        });

      void window.vicode.updates.getState()
        .then((value) => {
          setAppUpdateState(value);
        })
        .catch(() => {
          setAppUpdateState(null);
        });

      void window.vicode.threads.listArchived(null)
        .then((archived) => {
          setArchivedThreads(archived);
        })
        .catch(() => {});

      void window.vicode.skills.list()
        .then((nextSkills) => {
          setSkills(nextSkills);
        })
        .catch(() => {});

      if (payload.preferences.lastOpenedThreadId) {
        setStartupThreadRestoreState('pending');
        try {
          const detail = await window.vicode.threads.open(payload.preferences.lastOpenedThreadId);
          applyOpenedThread(detail);
          setStartupThreadRestoreState('resolved');
        } catch (error) {
          if (isMissingThreadError(error)) {
            setPreferences(await window.vicode.settings.save({ lastOpenedThreadId: null }));
          }
          setStartupThreadRestoreState('failed');
          setShowStartupWelcome(shouldShowStartupWelcome(payload));
        }
      } else {
        setStartupThreadRestoreState('resolved');
      }
    } catch (error) {
      setStartupThreadRestoreState('failed');
      setLoading(false);
      showToast('error', error instanceof Error ? error.message : 'Failed to bootstrap the app.');
    }
  }

  function applyBootstrap(payload: BootstrapData) {
    const surfacedProviders = surfaceProviders(payload.providers);
    const projectId = payload.preferences.selectedProjectId ?? payload.projects[0]?.id ?? null;
    const defaultProviderId = resolveDefaultProviderId(surfacedProviders, payload.preferences.defaultProviderId);
    const defaultModelId = resolveProviderModelId(
      surfacedProviders,
      defaultProviderId,
      payload.preferences.defaultModelByProvider[defaultProviderId]
    );
    const defaultComposerEffort = composerEffortFromPreference(
      defaultProviderId,
      payload.preferences.defaultReasoningEffortByProvider[defaultProviderId]
    );

    setProjects(payload.projects);
    setSkills(payload.skills);
    setAutomations((current) => mergeBootstrapRecords(current, payload.automations));
    setJobs((current) => mergeBootstrapRecords(current, payload.jobs));
    setReviewItems((current) => mergeBootstrapRecords(current, payload.reviewItems));
    setProviders(surfacedProviders);
    setPendingRunToolApprovals(payload.pendingRunToolApprovals);
    setToolApprovalResolvingId((current) =>
      current && payload.pendingRunToolApprovals.some((approval) => approval.id === current) ? current : null
    );
    setPreferences(payload.preferences);
    setPersonalization(payload.personalization);
    setSelectedProjectId(projectId);
    setExpandedProjectIds((current) => {
      const availableProjectIds = new Set(payload.projects.map((project) => project.id));
      const nextExpandedProjectIds = current.filter((id) => availableProjectIds.has(id));
      if (projectId && !nextExpandedProjectIds.includes(projectId)) {
        nextExpandedProjectIds.push(projectId);
      }
      return nextExpandedProjectIds;
    });
    setThreadsByProject(payload.threadsByProject);
    setRecentThreads(deriveRecentThreads(payload.threadsByProject));
    setShowStartupWelcome(shouldShowStartupWelcome(payload));
    applyCollaborationBootstrap(payload.collaboration);
    setComposerEffort(defaultComposerEffort);
    setComposer((current) => ({
      ...current,
      providerId: defaultProviderId,
      modelId: defaultModelId,
      thinkingEnabled: payload.preferences.defaultThinkingByProvider[defaultProviderId],
      mode: 'default',
      executionPermission: payload.preferences.defaultExecutionPermission,
      imageAttachments: [],
      textAttachments: []
    }));
    setActiveThread(null);
    setActiveRunId(null);
  }

  function applyCollaborationBootstrap(payload: CollabBootstrap) {
    const projectRooms = payload.rooms.filter((room) => room.type !== 'dm');
    const directChats = payload.rooms.filter((room) => room.type === 'dm');

    setCollaboration(payload);
    setSelectedCollaborationRoomId((current) =>
      projectRooms.some((room) => room.id === current) ? current : projectRooms[0]?.id ?? ''
    );
    setSelectedCollaborationChatId((current) =>
      directChats.some((room) => room.id === current) ? current : directChats[0]?.id ?? ''
    );
    setSelectedCollaborationContactId((current) =>
      payload.contacts.some((contact) => contact.userId === current) ? current : payload.contacts[0]?.userId ?? ''
    );
  }

  async function refreshCollaborationBootstrap() {
    applyCollaborationBootstrap(await window.vicode.collab.getBootstrap());
  }

  async function createCollaborationGuestProfile(input: { displayName: string; handle?: string | null }) {
    try {
      await window.vicode.collab.createGuestProfile(input);
      await refreshCollaborationBootstrap();
      showToast('info', 'Collaboration identity created.');
    } catch (error) {
      showToast('error', formatUserErrorMessage(error, 'Failed to create collaboration identity.'));
    }
  }

  async function clearCollaborationIdentity() {
    try {
      await window.vicode.collab.clearIdentity();
      await refreshCollaborationBootstrap();
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
      await refreshCollaborationBootstrap();
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
      await refreshCollaborationBootstrap();
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
      await refreshCollaborationBootstrap();
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
      await refreshCollaborationBootstrap();
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
      await refreshCollaborationBootstrap();
      showToast('info', following ? 'Follower mode enabled.' : 'Follower mode cleared.');
    } catch (error) {
      showToast('error', formatUserErrorMessage(error, 'Failed to update follower mode.'));
    }
  }

  async function requestCollaborationRole(roomId: string, requestedRole: 'contributor' | 'driver') {
    try {
      await window.vicode.collab.requestRole({ roomId, requestedRole });
      await refreshCollaborationBootstrap();
      showToast('info', requestedRole === 'driver' ? 'Driver handoff requested.' : 'Contributor access requested.');
    } catch (error) {
      showToast('error', formatUserErrorMessage(error, 'Failed to submit the role request.'));
    }
  }

  async function resolveCollaborationRoleRequest(roomId: string, requestId: string, status: 'approved' | 'declined') {
    try {
      await window.vicode.collab.resolveRoleRequest({ roomId, requestId, status });
      await refreshCollaborationBootstrap();
      showToast('info', status === 'approved' ? 'Role request approved.' : 'Role request declined.');
    } catch (error) {
      showToast('error', formatUserErrorMessage(error, 'Failed to update the role request.'));
    }
  }

  async function setCollaborationTerminalMode(roomId: string, mode: 'off' | 'announce_only', note?: string | null) {
    try {
      await window.vicode.collab.setTerminalMode({ roomId, mode, note: note ?? null });
      await refreshCollaborationBootstrap();
      showToast('info', mode === 'off' ? 'Shared terminal mode disabled.' : 'Shared terminal mode enabled.');
    } catch (error) {
      showToast('error', formatUserErrorMessage(error, 'Failed to update shared terminal mode.'));
    }
  }

  async function sendCollaborationMessage(roomId: string, body: string) {
    try {
      await window.vicode.collab.sendMessage({ roomId, body });
      await refreshCollaborationBootstrap();
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
      await refreshCollaborationBootstrap();
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
      await refreshCollaborationBootstrap();
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
      await refreshCollaborationBootstrap();
      showToast('info', 'Handoff published.');
    } catch (error) {
      showToast('error', formatUserErrorMessage(error, 'Failed to publish the handoff.'));
    }
  }

  async function refreshThreads(projectId: string | null) {
    if (!projectId) {
      return;
    }
    const nextThreads = await window.vicode.threads.list(projectId);
    setThreadsByProject((current) => ({ ...current, [projectId]: nextThreads }));
  }

  async function refreshArchivedThreads(projectId: string | null = null) {
    setArchivedThreads(await window.vicode.threads.listArchived(projectId));
  }

  function syncThreadProjectSelection(projectId: string) {
    selectedProjectIdRef.current = projectId;
    setSelectedProjectId(projectId);
    setExpandedProjectIds((current) =>
      current.includes(projectId) ? current : [...current, projectId]
    );
  }

  function applyOpenedThread(detail: ThreadDetail) {
    syncThreadProjectSelection(detail.projectId);
    activeThreadIdRef.current = detail.id;
    setShowStartupWelcome(false);
    setActiveThread(detail);
    setRunProgressByRunId(deriveRunProgressSnapshots(detail.rawOutput));
    setActiveRunId(deriveCurrentRunId(detail, null));
    setAttachedSkillIds(extractThreadSkillIds(detail));
    setRoute('thread');
    setComposerEffort(
      composerEffortFromPreference(
        detail.providerId,
        preferences?.defaultReasoningEffortByProvider[detail.providerId]
      )
    );
    setComposer((current) => ({
      ...current,
      prompt: '',
      providerId: detail.providerId,
      modelId: resolveProviderModelId(visibleProviders, detail.providerId, detail.modelId),
      thinkingEnabled: preferences?.defaultThinkingByProvider[detail.providerId] ?? current.thinkingEnabled,
      mode: detail.planner.composerMode,
      imageAttachments: [],
      textAttachments: []
    }));
  }

  async function openThread(threadId: string) {
    try {
      const targetThreadId = findParentThreadIdForSubagentChild(subagentsByThreadId, threadId) ?? threadId;
      const detail = await window.vicode.threads.open(targetThreadId);
      if (detail.projectId !== selectedProjectId) {
        setSelectedProjectId(detail.projectId);
        setExpandedProjectIds((current) =>
          current.includes(detail.projectId) ? current : [...current, detail.projectId]
        );
        const nextThreads = await window.vicode.threads.list(detail.projectId);
        setThreadsByProject((current) => ({ ...current, [detail.projectId]: nextThreads }));
        setPreferences(await window.vicode.settings.save({ selectedProjectId: detail.projectId, lastOpenedThreadId: detail.id }));
      } else {
        setPreferences(await window.vicode.settings.save({ lastOpenedThreadId: detail.id }));
      }
      applyOpenedThread(detail);
    } catch (error) {
      if (isMissingThreadError(error) && preferences?.lastOpenedThreadId === threadId) {
        setPreferences(await window.vicode.settings.save({ lastOpenedThreadId: null }));
      }
      showToast('error', error instanceof Error ? error.message : 'Failed to open thread.');
    }
  }

  async function selectProject(projectId: string, options?: { preserveMainView?: boolean }) {
    selectedProjectIdRef.current = projectId;
    setSelectedProjectId(projectId);
    setPreferences(await window.vicode.settings.save({ selectedProjectId: projectId }));
    const nextThreads = await window.vicode.threads.list(projectId);
    setThreadsByProject((current) => ({ ...current, [projectId]: nextThreads }));
    if (!options?.preserveMainView) {
      activeThreadIdRef.current = null;
      setShowStartupWelcome(false);
      setActiveThread(null);
      setActiveRunId(null);
      setComposer((current) => ({ ...current, imageAttachments: [], textAttachments: [] }));
      setRoute('thread');
    }
  }

  async function toggleProjectThreads(projectId: string) {
    if (expandedProjectIds.includes(projectId)) {
      setExpandedProjectIds((current) => current.filter((id) => id !== projectId));
      return;
    }

    setExpandedProjectIds((current) => (current.includes(projectId) ? current : [...current, projectId]));
    try {
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
      await selectProject(projectId, { preserveMainView: true });
    } catch (error) {
      setExpandedProjectIds((current) => current.filter((id) => id !== projectId));
      showToast('error', formatUserErrorMessage(error, 'Could not open project threads.'));
    }
  }

  function insertProjectLocally(project: Project) {
    setProjects((current) => [project, ...current.filter((item) => item.id !== project.id)]);
    setThreadsByProject((current) => (current[project.id] ? current : { ...current, [project.id]: [] }));
  }

  async function openProjectFromPicker() {
    const folderPath = await window.vicode.app.pickFolder();
    if (!folderPath) {
      return;
    }

    const existingProject = projects.find((project) => project.folderPath === folderPath);
    if (existingProject) {
      if (!activeThread && route === 'thread') {
        await createThreadForProject(existingProject.id);
      } else {
        await selectProject(existingProject.id);
      }
      setMissingWorkspaceProjectId((current) => (current === existingProject.id ? null : current));
      showToast('info', `Opened ${existingProject.name}.`);
      return;
    }

    const project = await window.vicode.projects.create({
      name: folderLabel(folderPath),
      folderPath,
      trusted: false
    });
    insertProjectLocally(project);
    if (!activeThread && route === 'thread') {
      await createThreadForProject(project.id);
    } else {
      await selectProject(project.id);
      setExpandedProjectIds((current) => (current.includes(project.id) ? current : [...current, project.id]));
    }
    setMissingWorkspaceProjectId((current) => (current === project.id ? null : current));
    showToast('info', `Opened ${project.name}.`);
  }

  async function repairWorkspaceProjectPath(project: Project | null) {
    if (!project) {
      await openProjectFromPicker();
      return;
    }

    const folderPath = await window.vicode.app.pickFolder();
    if (!folderPath) {
      return;
    }

    const updatedProject = await window.vicode.projects.update({
      id: project.id,
      folderPath
    });

    setProjects((current) => current.map((item) => (item.id === updatedProject.id ? updatedProject : item)));
    setMissingWorkspaceProjectId((current) => (current === updatedProject.id ? null : current));

    if (selectedProjectId === updatedProject.id) {
      try {
        const status = await window.vicode.workspaceBootstrap.getStatus(updatedProject.id);
        setWorkspaceBootstrapStatus(status);
      } catch {
        setWorkspaceBootstrapStatus(null);
      }
    }

    showToast('info', `Repaired workspace path for ${updatedProject.name}.`);
  }

  async function createProject() {
    if (!projectDraft.name.trim()) {
      showToast('warning', 'Project name is required.');
      return;
    }
    const project = await window.vicode.projects.create({
      name: projectDraft.name,
      folderPath: projectDraft.folderPath || null,
      trusted: projectDraft.trusted
    });
    insertProjectLocally(project);
    await selectProject(project.id);
    setProjectDraft({ name: '', folderPath: '', trusted: false });
  }

  async function attachFolder() {
    const folderPath = await window.vicode.app.pickFolder();
    if (folderPath) {
      setProjectDraft((current) => ({ ...current, folderPath }));
    }
  }

  async function trustProject(trusted: boolean) {
    if (!workspaceProject) {
      return;
    }
    const project = await window.vicode.projects.update({
      id: workspaceProject.id,
      trusted
    });
    setProjects((current) => current.map((item) => (item.id === project.id ? project : item)));
    if (workspaceProject.id === project.id) {
      try {
        const status = await window.vicode.workspaceBootstrap.getStatus(project.id);
        setWorkspaceBootstrapStatus(status);
      } catch {
        setWorkspaceBootstrapStatus(null);
      }
    }
  }

  async function setProjectTrust(projectId: string, trusted: boolean) {
    const project = await window.vicode.projects.update({
      id: projectId,
      trusted
    });
    setProjects((current) => current.map((item) => (item.id === project.id ? project : item)));
    if (selectedProjectId === project.id) {
      try {
        const status = await window.vicode.workspaceBootstrap.getStatus(project.id);
        setWorkspaceBootstrapStatus(status);
      } catch {
        setWorkspaceBootstrapStatus(null);
      }
    }
    showToast('info', trusted ? `${project.name} is now trusted.` : `${project.name} is now untrusted.`);
  }

  async function createThread() {
    if (!selectedProjectId) {
      showToast('warning', 'Create a project first.');
      return;
    }
    const createdThread = await window.vicode.threads.create({
      projectId: selectedProjectId,
      title: 'New thread',
      providerId: composer.providerId,
      modelId: composer.modelId,
      executionPermission: composer.executionPermission
    });
    const thread =
      composer.mode === 'plan'
        ? await window.vicode.planner.setMode({ threadId: createdThread.id, mode: 'plan' })
        : createdThread;
    await refreshThreads(selectedProjectId);
    setRecentThreads((current) => upsertRecentThread(current, thread));
    setShowStartupWelcome(false);
    applyOpenedThread(thread);
    setActiveRunId(null);
    setRoute('thread');
  }

  async function createThreadForProject(projectId: string) {
    if (!projectId) {
      return;
    }

    if (selectedProjectId !== projectId) {
      setSelectedProjectId(projectId);
      setPreferences(await window.vicode.settings.save({ selectedProjectId: projectId }));
    }

    setExpandedProjectIds((current) => (current.includes(projectId) ? current : [...current, projectId]));
    const createdThread = await window.vicode.threads.create({
      projectId,
      title: 'New thread',
      providerId: composer.providerId,
      modelId: composer.modelId,
      executionPermission: composer.executionPermission
    });
    const thread =
      composer.mode === 'plan'
        ? await window.vicode.planner.setMode({ threadId: createdThread.id, mode: 'plan' })
        : createdThread;
    const nextThreads = await window.vicode.threads.list(projectId);
    setThreadsByProject((current) => ({ ...current, [projectId]: nextThreads }));
    setRecentThreads((current) => upsertRecentThread(current, thread));
    setShowStartupWelcome(false);
    applyOpenedThread(thread);
    setActiveRunId(null);
    setRoute('thread');
  }

  async function renameProject(projectId: string) {
    const project = projects.find((item) => item.id === projectId);
    if (!project) {
      return;
    }
    const name = window.prompt('Edit project name', project.name)?.trim();
    if (!name || name === project.name) {
      return;
    }
    await window.vicode.projects.update({ id: projectId, name });
    applyBootstrap(await window.vicode.app.getBootstrap());
  }

  async function removeProject(projectId: string) {
    const project = projects.find((item) => item.id === projectId);
    if (!project) {
      return;
    }

    const remainingProjects = projects.filter((item) => item.id !== projectId);
    const nextSelectedProjectId =
      selectedProjectId === projectId
        ? remainingProjects[0]?.id ?? null
        : selectedProjectId;
    const deletingSelectedProject = selectedProjectId === projectId;
    const deletingActiveThreadProject = activeThread?.projectId === projectId;

    setRemovingProjectId(projectId);

    try {
      await window.vicode.projects.remove(projectId);

      setProjects(remainingProjects);
      setRecentThreads((current) => current.filter((item) => item.projectId !== projectId));
      setArchivedThreads((current) => current.filter((item) => item.projectId !== projectId));
      setPreferences((current) =>
        current
          ? {
              ...current,
              selectedProjectId: nextSelectedProjectId,
              lastOpenedThreadId: null
            }
          : current
      );
      setExpandedProjectIds((current) => current.filter((id) => id !== projectId));
      setThreadsByProject((current) => {
        const next = { ...current };
        delete next[projectId];
        return next;
      });

      if (deletingSelectedProject) {
        setSelectedProjectId(nextSelectedProjectId);
        setExpandedProjectIds((current) =>
          nextSelectedProjectId && !current.includes(nextSelectedProjectId) ? [...current, nextSelectedProjectId] : current
        );
      }

      if (deletingActiveThreadProject) {
        setActiveThread(null);
        setActiveRunId(null);
        setAttachedSkillIds([]);
        setWorkspaceBootstrapStatus(null);
        setWorkspaceBootstrapModalOpen(false);
        setWorkspaceBootstrapDraftBundle(null);
        setWorkspaceBootstrapSelectedDraftPaths([]);
        setWorkspaceBootstrapActiveDraftPath(null);
      }

      if (deletingSelectedProject && nextSelectedProjectId) {
        await refreshThreads(nextSelectedProjectId);
      }

      await refreshStorageDiagnosticsIfVisible();
    } finally {
      setRemovingProjectId((current) => (current === projectId ? null : current));
    }
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
    const explicitParsed = parseLeadingNativeComposerCommand(prompt);
    const pendingCommand =
      pendingNativeCommandId === null
        ? null
        : nativeComposerCommands.find((command) => command.id === pendingNativeCommandId) ?? null;
    const parsed = explicitParsed ?? (pendingCommand
      ? {
          command: pendingCommand,
          body: prompt.trim()
        }
      : null);
    if (!parsed) {
      return false;
    }

    const { command, body } = parsed;
    if (requiresSlashCommandBody(command.id) && !body) {
      showToast('warning', `Add some text after /${command.token} first.`);
      return true;
    }

    if (command.id === 'autonomous-builds') {
      if (body) {
        await startBuildPlanSetupThread({
          goal: body,
          providerId: composer.providerId,
          modelId: composer.modelId,
          reasoningEffort: resolveComposerReasoningEffort(composer.providerId, composerEffort),
          successMessage: 'Autonomous Builds setup thread started from the composer.'
        });
      } else {
        const readiness = getBuildPlanThreadReadiness(activeThread);
        if (readiness.enabled) {
          await createBuildPlanFromActiveThread();
        } else {
          showToast(
            'warning',
            'Add a goal after /autonomous-builds, or run it inside a ready Autonomous Builds setup thread.'
          );
        }
      }
      setPendingNativeCommandId(null);
      requestAnimationFrame(() => composerRef.current?.focus());
      return true;
    }

    if (command.id === 'enhance') {
      if (!composerProjectId) {
        showToast('warning', 'Create or select a project first.');
        return true;
      }
      const { promptWithoutMentions, mentionedTokens } = splitPromptMentionedSkills(body, availableComposerSkills);
      if (!promptWithoutMentions) {
        showToast('warning', 'Add some prose before enhancing the prompt.');
        return true;
      }
      setEnhancingPrompt(true);
      try {
        const result = await window.vicode.composer.enhancePrompt({
          prompt: promptWithoutMentions,
          projectId: composerProjectId,
          providerId: composer.providerId,
          modelId: composer.modelId,
          reasoningEffort: resolveComposerReasoningEffort(composer.providerId, composerEffort)
          ,
          thinkingEnabled: providerCapabilities(composer.providerId).supportsThinkingToggle ? composer.thinkingEnabled : undefined
        });
        setComposer((current) => ({
          ...current,
          prompt: appendMentionedSkillTokens(result.prompt, mentionedTokens)
        }));
        setPendingNativeCommandId(null);
        showToast('info', 'Prompt enhanced.');
        requestAnimationFrame(() => composerRef.current?.focus());
      } catch (error) {
        setPendingNativeCommandId(null);
        showToast('warning', formatUserErrorMessage(error, 'Unable to enhance prompt.'));
      } finally {
        setEnhancingPrompt(false);
      }
      return true;
    }

    if (command.id === 'plan') {
      const activeComposerProvider = visibleProviders.find((provider) => provider.id === composer.providerId) ?? null;
      const resolution = resolveNativePlanCommand({
        body,
        plannerSupported: Boolean(activeComposerProvider?.plannerPolicy.supported),
        providerLabel: activeComposerProvider?.label ?? providerDisplayName(composer.providerId)
      });
      if (resolution.kind === 'empty') {
        showToast('warning', resolution.toastMessage);
        return true;
      }
      if (resolution.kind === 'unsupported') {
        setPendingNativeCommandId(null);
        showToast('warning', resolution.toastMessage);
        requestAnimationFrame(() => composerRef.current?.focus());
        return true;
      }

      const nextMode = await setComposerMode(composer.mode === 'plan' ? 'default' : resolution.nextMode);
      setComposer((current) => ({
        ...current,
        prompt: resolution.prompt
      }));
      setPendingNativeCommandId(null);
      showToast('info', nextMode === 'plan' ? 'Plan mode enabled.' : 'Plan mode disabled.');
      requestAnimationFrame(() => composerRef.current?.focus());
      return true;
    }

    const nextPrompt = buildNativeComposerCommandPrompt(command.id, body);
    setComposer((current) => ({
      ...current,
      prompt: nextPrompt
    }));
    setPendingNativeCommandId(null);
    showToast('info', `${command.title} applied.`);
    requestAnimationFrame(() => composerRef.current?.focus());
    return true;
  }

  async function submitPrompt(promptOverride?: string) {
    const effectivePrompt = promptOverride ?? composer.prompt;
    if (!composerProjectId || !effectivePrompt.trim() || composerSubmitting || plannerSubmitting) {
      return;
    }
    if (editingFollowUpId) {
      await saveQueuedFollowUpEdit(editingFollowUpId);
      return;
    }
    if (await executeLeadingNativeSlashCommand(effectivePrompt)) {
      return;
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
      return;
    }
    if (activeProvider.authState === 'checking') {
      showToast('info', providerBlockedRunMessage(activeProvider));
      return;
    }
    if (activeProvider.authState === 'detected') {
      showToast('warning', providerBlockedRunMessage(activeProvider));
      return;
    }
    if (activeProvider.authState === 'disconnected' || activeProvider.authState === 'missing_cli') {
      showToast('warning', providerBlockedRunMessage(activeProvider));
      return;
    }
    if (workspaceProject?.folderPath && !workspaceProject.trusted) {
      showToast(
        'warning',
        `This workspace is not trusted yet. Click Enable workspace in the header before running ${providerDisplayName(composer.providerId)}.`
      );
      return;
    }
    if (
      composer.mode === 'default' &&
      isBuildPlanSetupThread(activeThread) &&
      getBuildPlanThreadReadiness(activeThread).enabled
    ) {
      showToast(
        'warning',
        'This setup thread is ready for Autonomous Builds handoff. Use Accept and start Autonomous Builds, or Create build plan from this thread, instead of running normal execution here.'
      );
      return;
    }
    if (composer.providerId !== 'ollama' && composer.imageAttachments.length > 0 && activeModel?.supportsVision === false) {
      showToast('warning', `${activeModel.label} does not support image input. Choose a vision-capable model first.`);
      return;
    }
    const input: ComposerSubmitInput = {
      projectId: composerProjectId,
      threadId: activeThreadIdRef.current ?? activeThread?.id ?? null,
      prompt: effectivePrompt.trim(),
      providerId: composer.providerId,
      modelId: composer.modelId,
      reasoningEffort: resolveComposerReasoningEffort(composer.providerId, composerEffort),
      thinkingEnabled: providerCapabilities(composer.providerId).supportsThinkingToggle ? composer.thinkingEnabled : undefined,
      executionPermission: composer.executionPermission,
      skillIds: mergeComposerSkillIds(
        attachedSkillIds,
        splitPromptMentionedSkills(effectivePrompt, availableComposerSkills).mentionedSkillIds
      ),
      imageAttachments: composer.imageAttachments,
      textAttachments: composer.textAttachments
    };
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
        return;
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
      return;
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
      return;
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

  async function enhanceComposerPrompt() {
    if (!composer.prompt.trim()) {
      showToast('warning', 'Write something first, then enhance it.');
      return;
    }
    if (!composerProjectId) {
      showToast('warning', 'Create or select a project first.');
      return;
    }

    const { promptWithoutMentions, mentionedTokens } = splitPromptMentionedSkills(composer.prompt, availableComposerSkills);
    if (!promptWithoutMentions) {
      showToast('warning', 'Add some prose before enhancing the prompt.');
      return;
    }

    setEnhancingPrompt(true);
    try {
      const result = await window.vicode.composer.enhancePrompt({
        prompt: promptWithoutMentions,
        projectId: composerProjectId,
        providerId: composer.providerId,
        modelId: composer.modelId,
        reasoningEffort: resolveComposerReasoningEffort(composer.providerId, composerEffort)
        ,
        thinkingEnabled: providerCapabilities(composer.providerId).supportsThinkingToggle ? composer.thinkingEnabled : undefined
      });
      setComposer((current) => ({
        ...current,
        prompt: appendMentionedSkillTokens(result.prompt, mentionedTokens)
      }));
      setPendingNativeCommandId(null);
      showToast('info', 'Prompt enhanced.');
      requestAnimationFrame(() => composerRef.current?.focus());
    } catch (error) {
      setPendingNativeCommandId(null);
      showToast('warning', formatUserErrorMessage(error, 'Unable to enhance prompt.'));
    } finally {
      setEnhancingPrompt(false);
    }
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
          'info',
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
    await setComposerMode(composer.mode === 'plan' ? 'default' : 'plan');
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
      if (isBuildPlanSetupThread(activeThread) && getBuildPlanThreadReadiness(activeThread).enabled) {
        const snapshot = await window.vicode.vicodeBuild.createPlanFromThread(activeThread.id);
        setVicodeBuildSnapshot(snapshot);
        await refreshThreads(activeThread.projectId);
        await openThread(activeThread.id);
        showToast('info', 'Build plan created from this setup thread. Planner started in Autonomous Builds.');
        return;
      }

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

  function selectProviderThinking(thinkingEnabled: boolean) {
    setComposer((current) => ({
      ...current,
      thinkingEnabled
    }));

    if (!providerCapabilities(composer.providerId).supportsThinkingToggle) {
      return;
    }

    void saveDefaultPreferences({
      defaultThinkingByProvider: createProviderRecord((providerId) =>
        composer.providerId === providerId
          ? thinkingEnabled
          : preferences?.defaultThinkingByProvider[providerId] ?? getProviderMetadata(providerId).defaultThinking
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

  function stopVoiceVisualization() {
    if (analyserFrameRef.current !== null) {
      window.cancelAnimationFrame(analyserFrameRef.current);
      analyserFrameRef.current = null;
    }
    if (voiceTimerRef.current !== null) {
      window.clearInterval(voiceTimerRef.current);
      voiceTimerRef.current = null;
    }
    analyserRef.current = null;
    if (audioContextRef.current) {
      void audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    voiceRecordingStartedAtRef.current = null;
    setVoiceElapsedMs(0);
    setVoiceLevel(0);
  }

  async function startVoiceVisualization(stream: MediaStream) {
    stopVoiceVisualization();

    const audioContext = new AudioContext();
    const source = audioContext.createMediaStreamSource(stream);
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.82;
    source.connect(analyser);

    const data = new Uint8Array(analyser.frequencyBinCount);
    audioContextRef.current = audioContext;
    analyserRef.current = analyser;
    voiceRecordingStartedAtRef.current = Date.now();
    setVoiceElapsedMs(0);

    const updateLevel = () => {
      const activeAnalyser = analyserRef.current;
      if (!activeAnalyser) {
        return;
      }

      activeAnalyser.getByteTimeDomainData(data);
      let sum = 0;
      for (let index = 0; index < data.length; index += 1) {
        const normalized = (data[index] - 128) / 128;
        sum += normalized * normalized;
      }
      const rms = Math.sqrt(sum / data.length);
      setVoiceLevel(Math.min(1, rms * 4.5));
      analyserFrameRef.current = window.requestAnimationFrame(updateLevel);
    };

    voiceTimerRef.current = window.setInterval(() => {
      const startedAt = voiceRecordingStartedAtRef.current;
      if (!startedAt) {
        return;
      }
      setVoiceElapsedMs(Date.now() - startedAt);
    }, 250);

    analyserFrameRef.current = window.requestAnimationFrame(updateLevel);
  }

  function startVoiceRecording() {
    void (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaStreamRef.current = stream;
        voiceChunksRef.current = [];

        const preferredMimeType = resolveVoiceRecorderMimeType();
        const recorder = preferredMimeType
          ? new MediaRecorder(stream, { mimeType: preferredMimeType })
          : new MediaRecorder(stream);
        mediaRecorderRef.current = recorder;
        await startVoiceVisualization(stream);

        recorder.ondataavailable = (event) => {
          if (event.data.size > 0) {
            voiceChunksRef.current.push(event.data);
          }
        };

        recorder.onerror = () => {
          mediaRecorderRef.current = null;
          mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
          mediaStreamRef.current = null;
          voiceChunksRef.current = [];
          stopVoiceVisualization();
          setVoiceState('idle');
          showToast('error', 'Voice recording failed. Check your microphone and try again.');
        };

        recorder.onstart = () => {
          setVoiceState('recording');
        };

        recorder.onstop = async () => {
          const chunks = [...voiceChunksRef.current];
          voiceChunksRef.current = [];
          mediaRecorderRef.current = null;
          mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
          mediaStreamRef.current = null;
          stopVoiceVisualization();

          if (chunks.length === 0) {
            setVoiceState('idle');
            showToast('info', 'No speech detected. Try again.');
            return;
          }

          try {
            const mimeType = recorder.mimeType || preferredMimeType || 'audio/webm';
            const blob = new Blob(chunks, { type: mimeType });
            const wavBlob = await transcodeVoiceBlobToWav(blob);
            const audioBase64 = await blobToBase64(wavBlob);
            const result = await window.vicode.voice.transcribe({
              audioBase64,
              mimeType: 'audio/wav',
              fileName: 'dictation.wav'
            });
            setVoiceState('idle');
            const appended = appendDictationToComposer(normalizeVoiceTranscript(result.text));
            if (!appended) {
              showToast('info', 'No speech detected. Try again.');
            }
          } catch (error) {
            setVoiceState('idle');
            showToast('error', formatUserErrorMessage(error, 'Voice dictation failed. Try again.'));
          }
        };

        recorder.start();
      } catch (error) {
        mediaRecorderRef.current = null;
        mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
        mediaStreamRef.current = null;
        voiceChunksRef.current = [];
        stopVoiceVisualization();
        setVoiceState('idle');
        showToast(
          'error',
          formatUserErrorMessage(
            error,
            'Voice recording could not start. Check microphone permissions and try again.'
          )
        );
      }
    })();
  }

  async function syncMicrophoneConsentPreference() {
    if (preferences?.microphoneAllowed) {
      return;
    }

    try {
      const nextPreferences = await window.vicode.settings.save({ microphoneAllowed: true });
      setPreferences(nextPreferences);
    } catch {
      // Keep dictation usable even if the local preference write fails.
    }
  }

  async function handleComposerVoice() {
    if (!isVoiceDictationSupported()) {
      showToast('warning', 'Voice dictation is not available in this app runtime.');
      return;
    }

    if (voiceState === 'transcribing') {
      return;
    }

    if (voiceState === 'recording') {
      setVoiceState('transcribing');
      mediaRecorderRef.current?.stop();
      return;
    }

    const microphoneAccessStatus = await window.vicode.voice.getMicrophoneAccessStatus();
    if (isMicrophoneAccessBlocked(microphoneAccessStatus)) {
      setMicrophoneConsentOpen(false);
      showToast('error', formatMicrophoneAccessMessage(microphoneAccessStatus));
      return;
    }

    if (!preferences?.microphoneAllowed) {
      if (microphoneAccessStatus === 'granted') {
        void syncMicrophoneConsentPreference();
        startVoiceRecording();
        return;
      }

      setMicrophoneConsentOpen(true);
      return;
    }

    startVoiceRecording();
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

  async function renameThread() {
    if (!activeThread) {
      return;
    }
    const title = window.prompt('Rename thread', activeThread.title)?.trim();
    if (!title) {
      return;
    }
    const thread = await window.vicode.threads.rename(activeThread.id, title);
    setRecentThreads((current) => upsertRecentThread(current, thread));
    await refreshThreads(selectedProjectId);
    await openThread(activeThread.id);
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

  async function deleteThread() {
    if (!activeThread) {
      return;
    }
    await window.vicode.threads.remove(activeThread.id);
    setRecentThreads((current) => current.filter((item) => item.id !== activeThread.id));
    await refreshThreads(selectedProjectId);
    await refreshArchivedThreads();
    await refreshStorageDiagnosticsIfVisible();
    setActiveThread(null);
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

  async function syncSkill(skillId: string, providerId: ProviderId, enabled: boolean) {
    const skill = await window.vicode.skills.sync(skillId, providerId, enabled);
    setSkills((current) => current.map((item) => (item.id === skill.id ? skill : item)));
    showToast('info', `${skill.name} ${enabled ? `exported to ${providerDisplayName(providerId)}` : 'export removed'}.`);
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

  function resolveCreatorSkillId(
    availableSkills: SkillDefinition[],
    kind: 'skill' | 'plugin'
  ) {
    const slug = kind === 'skill' ? 'skill-creator' : 'plugin-creator';
    const fallbackId = kind === 'skill' ? 'built-in-skill-creator' : 'built-in-plugin-creator';
    return availableSkills.find((skill) => skill.id === fallbackId || skill.metadata.slug === slug)?.id ?? null;
  }

  async function openCreatorInComposer(kind: 'skill' | 'plugin') {
    const targetProject = workspaceProject;
    if (!targetProject) {
      showToast('warning', 'Select a project first.');
      return;
    }
    if (!appMeta?.statePath) {
      showToast('warning', 'App metadata is unavailable right now. Refresh Vicode and try again.');
      return;
    }

    const nextSkills = await window.vicode.skills.list();
    setSkills(nextSkills);

    const creatorSkillId = resolveCreatorSkillId(nextSkills, kind);
    if (!creatorSkillId) {
      showToast(
        'warning',
        `${kind === 'skill' ? 'Skill' : 'Plugin'} creator is unavailable. Restart Vicode once if this app was already open before the update.`
      );
      return;
    }

    const prompt =
      kind === 'skill'
        ? buildSkillCreatorPrompt({
            statePath: appMeta.statePath,
            projectName: targetProject.name,
            projectId: targetProject.id
          })
        : buildPluginCreatorPrompt({
            statePath: appMeta.statePath,
            projectName: targetProject.name,
            projectId: targetProject.id
          });

    if (selectedProjectId !== targetProject.id) {
      setSelectedProjectId(targetProject.id);
      setPreferences(await window.vicode.settings.save({ selectedProjectId: targetProject.id }));
    }
    setExpandedProjectIds((current) =>
      current.includes(targetProject.id) ? current : [...current, targetProject.id]
    );

    const createdThread = await window.vicode.threads.create({
      projectId: targetProject.id,
      title: kind === 'skill' ? 'Create skill' : 'Create plugin',
      providerId: composer.providerId,
      modelId: composer.modelId,
      executionPermission: composer.executionPermission
    });
    const nextThreads = await window.vicode.threads.list(targetProject.id);
    setThreadsByProject((current) => ({ ...current, [targetProject.id]: nextThreads }));
    setRecentThreads((current) => upsertRecentThread(current, createdThread));
    applyOpenedThread(createdThread);

    setShowStartupWelcome(false);
    setEditingFollowUpId(null);
    setPendingNativeCommandId(null);
    setAttachedSkillIds([creatorSkillId]);
    setComposer((current) => ({
      ...current,
      prompt,
      mode: 'default',
      imageAttachments: [],
      textAttachments: []
    }));
    setRoute('thread');
    showToast(
      'info',
      kind === 'skill' ? 'Opened a new thread with the skill creator ready.' : 'Opened a new thread with the plugin creator ready.'
    );
    requestAnimationFrame(() => composerRef.current?.focus());
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

  async function refreshVicodeBuildSnapshot() {
    setVicodeBuildSnapshot(await window.vicode.vicodeBuild.getSnapshot(selectedProjectId));
  }

  function openBuildPlanDialog() {
    setBuildPlanLaunch({
      goal: '',
      providerId: composer.providerId,
      modelId: resolveProviderModelId(visibleProviders, composer.providerId, composer.modelId),
      reasoningEffort: resolveComposerReasoningEffort(composer.providerId, composerEffort)
    });
    setBuildPlanDialogOpen(true);
  }

  function closeBuildPlanDialog() {
    setBuildPlanDialogOpen(false);
  }

  async function startBuildPlanSetupThread(input: {
    goal: string;
    providerId: ProviderId;
    modelId: string;
    reasoningEffort: ProviderReasoningEffort | null;
    closeDialog?: boolean;
    successMessage?: string;
    errorMessage?: string;
  }) {
    if (!selectedProjectId) {
      showToast('warning', 'Select a project before starting Autonomous Builds.');
      return;
    }
    if (!input.goal.trim()) {
      showToast('warning', 'Describe the goal for Autonomous Builds first.');
      return;
    }

    const setupProvider = visibleProviders.find((provider) => provider.id === input.providerId) ?? null;
    if (!setupProvider?.plannerPolicy.supported) {
      showToast(
        'warning',
        `${setupProvider?.label ?? providerDisplayName(input.providerId)} does not support native Plan mode for Autonomous Builds setup yet.`
      );
      return;
    }

    setVicodeBuildBusyAction('launch-plan');
    try {
      const createdThread = await window.vicode.threads.create({
        projectId: selectedProjectId,
        title: deriveBuildPlanSetupTitle(input.goal),
        providerId: input.providerId,
        modelId: input.modelId,
        executionPermission: composer.executionPermission
      });
      const result = await window.vicode.planner.submit({
        projectId: selectedProjectId,
        threadId: createdThread.id,
        prompt: buildPlanSetupPrompt(input.goal),
        providerId: input.providerId,
        modelId: input.modelId,
        reasoningEffort: input.reasoningEffort,
        thinkingEnabled: providerCapabilities(input.providerId).supportsThinkingToggle
          ? composer.thinkingEnabled
          : undefined,
        executionPermission: composer.executionPermission,
        skillIds: [],
        imageAttachments: [],
        textAttachments: []
      });
      setShowStartupWelcome(false);
      syncThreadProjectSelection(result.thread.projectId);
      setActiveThread(result.thread);
      setRecentThreads((current) => upsertRecentThread(current, result.thread));
      setActiveRunId(result.runId);
      setComposer((current) => ({
        ...current,
        mode: result.thread.planner.composerMode,
        executionPermission: result.thread.executionPermission
      }));
      await refreshThreads(result.thread.projectId);
      if (input.closeDialog) {
        closeBuildPlanDialog();
      }
      showToast('info', input.successMessage ?? 'Autonomous Builds setup thread started in Plan mode.');
    } catch (error) {
      showToast('warning', formatUserErrorMessage(error, input.errorMessage ?? 'Unable to start the Autonomous Builds setup thread.'));
    } finally {
      setVicodeBuildBusyAction(null);
    }
  }

  async function launchBuildPlanSetupThread() {
    await startBuildPlanSetupThread({
      goal: buildPlanLaunch.goal,
      providerId: buildPlanLaunch.providerId,
      modelId: buildPlanLaunch.modelId,
      reasoningEffort: buildPlanLaunch.reasoningEffort,
      closeDialog: true
    });
  }

  async function createBuildPlanFromActiveThread() {
    const readiness = getBuildPlanThreadReadiness(activeThread);
    if (!readiness.enabled) {
      showToast('warning', readiness.reason);
      return;
    }

    setVicodeBuildBusyAction('create-plan-from-thread');
    try {
      const snapshot = await window.vicode.vicodeBuild.createPlanFromThread(activeThread.id);
      setVicodeBuildSnapshot(snapshot);
      await refreshThreads(activeThread.projectId);
      await openThread(activeThread.id);
      showToast('info', 'Build plan created from this thread. Planner started in the same thread.');
    } catch (error) {
      showToast('warning', formatUserErrorMessage(error, 'Unable to create the build plan from this thread.'));
    } finally {
      setVicodeBuildBusyAction(null);
    }
  }

  async function setVicodeBuildTeamPaused(teamId: string, paused: boolean) {
    if (!selectedProjectId) {
      showToast('warning', 'Select the Vicode project before controlling build lanes.');
      return;
    }
    const actionKey = `${paused ? 'pause' : 'resume'}:${teamId}`;
    setVicodeBuildBusyAction(actionKey);
    try {
      const snapshot = await window.vicode.vicodeBuild.setTeamPaused({
        projectId: selectedProjectId,
        teamId: teamId as never,
        paused
      });
      setVicodeBuildSnapshot(snapshot);
      showToast('info', paused ? 'Build team paused.' : 'Build team resumed.');
    } catch (error) {
      showToast('warning', formatUserErrorMessage(error, 'Unable to update build team state.'));
    } finally {
      setVicodeBuildBusyAction(null);
    }
  }

  async function wakeVicodeBuildLane(teamId: string, laneId: VicodeBuildLaneId) {
    if (!selectedProjectId) {
      showToast('warning', 'Select the Vicode project before waking build lanes.');
      return;
    }
    const actionKey = `wake:${teamId}:${laneId}`;
    setVicodeBuildBusyAction(actionKey);
    try {
      const snapshot = await window.vicode.vicodeBuild.wakeLane({
        projectId: selectedProjectId,
        teamId: teamId as never,
        laneId
      });
      setVicodeBuildSnapshot(snapshot);
      showToast('info', 'Lane wake submitted. Open the lane thread to inspect the run.');
    } catch (error) {
      showToast('warning', formatUserErrorMessage(error, 'Unable to wake build lane.'));
    } finally {
      setVicodeBuildBusyAction(null);
    }
  }

  async function retryVicodeBuildLane(teamId: string, laneId: VicodeBuildLaneId) {
    if (!selectedProjectId) {
      return;
    }
    const actionKey = `retry:${teamId}:${laneId}`;
    setVicodeBuildBusyAction(actionKey);
    try {
      const snapshot = await window.vicode.vicodeBuild.retryLane({
        projectId: selectedProjectId,
        teamId,
        laneId
      });
      setVicodeBuildSnapshot(snapshot);
    } finally {
      setVicodeBuildBusyAction(null);
    }
  }

  async function openVicodeBuildLaneThread(threadId: string) {
    try {
      await openThread(threadId);
    } catch (error) {
      showToast('warning', formatUserErrorMessage(error, 'Unable to open the lane thread.'));
    }
  }

  async function runVicodeBuildVerification() {
    if (!selectedProjectId) {
      showToast('warning', 'Select the Vicode project before running verification.');
      return;
    }
    setVicodeBuildBusyAction('verify');
    try {
      const result = await window.vicode.vicodeBuild.runVerification(selectedProjectId);
      setVicodeBuildVerification(result);
      showToast('info', result.ok ? 'Autonomous build verification passed.' : 'Autonomous build verification needs attention.');
      await refreshVicodeBuildSnapshot();
    } catch (error) {
      showToast('warning', formatUserErrorMessage(error, 'Unable to run autonomous build verification.'));
    } finally {
      setVicodeBuildBusyAction(null);
    }
  }

  async function clearInactiveVicodeBuildPlans() {
    if (!selectedProjectId) {
      showToast('warning', 'Select the Vicode project before clearing old build plans.');
      return;
    }
    setVicodeBuildBusyAction('clear-inactive');
    try {
      const snapshot = await window.vicode.vicodeBuild.clearInactivePlans(selectedProjectId);
      setVicodeBuildSnapshot(snapshot);
      showToast('info', 'Old inactive build plans were cleared from this workspace.');
    } catch (error) {
      showToast('warning', formatUserErrorMessage(error, 'Unable to clear old build plans.'));
    } finally {
      setVicodeBuildBusyAction(null);
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
    if (providerId === 'ollama') {
      const snapshot = await window.vicode.ollamaRuntime.start();
      setOllamaRuntimeStatus(snapshot);
      const provider = await window.vicode.providers.refresh(providerId);
      setProviders((current) => current.map((item) => (item.id === provider.id ? provider : item)));
      showToast(
        'info',
        snapshot.managedByApp
          ? 'Local Ollama is starting in Vicode.'
          : provider.message ?? 'Local Ollama start requested.'
      );
      return;
    }

    const provider = await window.vicode.providers.startAuth(providerId, mode, options);
    setProviders((current) => current.map((item) => (item.id === provider.id ? provider : item)));
    showToast(provider.authState === 'missing_cli' ? 'warning' : 'info', provider.message ?? `${provider.label} auth flow started.`);
  }

  async function adoptProviderAuth(providerId: ProviderId) {
    const provider = await window.vicode.providers.adoptAuth(providerId);
    setProviders((current) => current.map((item) => (item.id === provider.id ? provider : item)));
    showToast(provider.authState === 'connected' ? 'info' : 'warning', provider.message ?? `${provider.label} setup updated.`);
  }

  function providerInstallUrl(providerId: ProviderId) {
    return providerId === 'openai'
      ? 'https://github.com/openai/codex'
      : providerId === 'gemini'
        ? 'https://github.com/google-gemini/gemini-cli'
        : providerId === 'ollama'
          ? 'https://docs.ollama.com/windows'
        : providerId === 'qwen'
          ? 'https://qwenlm.github.io/qwen-code-docs/en/users/quickstart/'
          : 'https://moonshotai.github.io/kimi-cli/en/';
  }

  function beginProviderInstall(providerId: ProviderId) {
    window.open(providerInstallUrl(providerId), '_blank', 'noopener,noreferrer');
    const providerName = providerDisplayName(providerId);
    showToast(
      'info',
      providerId === 'qwen'
        ? 'Install Qwen Code with `npm install -g @qwen-code/qwen-code@latest`, then return to Vicode. The app will keep checking for it.'
        : providerId === 'ollama'
          ? 'Install Ollama, then return to Vicode.'
        : providerId === 'kimi'
          ? 'Install Kimi Code with `npm install -g @moonshot-ai/kimi-code@latest`, then return to Vicode. The app will keep checking for it.'
        : `Install ${providerName}, then return to Vicode.`
    );

    const existingTimer = installPollingRef.current[providerId];
    if (existingTimer) {
      window.clearInterval(existingTimer);
    }

    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      void window.vicode.providers
        .refresh(providerId)
        .then((provider) => {
          setProviders((current) => current.map((item) => (item.id === provider.id ? provider : item)));

          if (!provider.installed && Date.now() - startedAt < 60_000) {
            return;
          }

          window.clearInterval(timer);
          delete installPollingRef.current[providerId];

          if (provider.installed) {
            showToast(
              'info',
              providerId === 'ollama'
                ? provider.authState === 'connected'
                  ? 'Ollama is installed and ready.'
                  : 'Ollama was found. Start it or refresh to load models.'
                : provider.authState === 'connected'
                  ? `${providerName} was found and is ready.`
                  : `${providerName} was found. You can sign in now.`
            );
          }
        })
        .catch(() => {
          if (Date.now() - startedAt >= 60_000) {
            window.clearInterval(timer);
            delete installPollingRef.current[providerId];
          }
        });
    }, 2500);

    installPollingRef.current[providerId] = timer;
  }

  async function clearProviderAuth(providerId: ProviderId) {
    const provider = await window.vicode.providers.clearAuth(providerId);
    setProviders((current) => current.map((item) => (item.id === provider.id ? provider : item)));
    showToast('info', `${provider.label} disconnected.`);
  }

  async function refreshProvider(providerId: ProviderId) {
    const provider = await window.vicode.providers.refresh(providerId);
    setProviders((current) => current.map((item) => (item.id === provider.id ? provider : item)));
    if (providerId === 'ollama') {
      await refreshOllamaRuntimeStatus();
    }
    const previousModelId = composer.providerId === provider.id ? composer.modelId : null;
    const nextModelId = previousModelId ? resolveProviderModelId([provider], provider.id, previousModelId) : null;
    setComposer((current) => (nextModelId && current.providerId === provider.id ? { ...current, modelId: nextModelId } : current));
    if (previousModelId && nextModelId && previousModelId !== nextModelId) {
      showToast('info', `${provider.label} switched to ${provider.models.find((model) => model.id === nextModelId)?.label ?? nextModelId}.`);
      return;
    }
    showToast('info', `${provider.label} refreshed.`);
  }

  async function refreshOllamaRuntimeStatus() {
    try {
      setOllamaRuntimeStatus(await window.vicode.ollamaRuntime.getStatus());
    } catch {
      setOllamaRuntimeStatus(null);
    }
  }

  async function pullOllamaModel(model: string) {
    const trimmedModel = model.trim();
    if (!trimmedModel) {
      showToast('warning', 'Model name is required.');
      return;
    }

    try {
      setOllamaPullProgress(null);
      const result = await window.vicode.ollamaRuntime.pullModel(trimmedModel);
      const provider = await window.vicode.providers.refresh('ollama');
      setProviders((current) => current.map((item) => (item.id === provider.id ? provider : item)));
      showToast('info', `Pulled ${result.model}. ${result.models.length} local model${result.models.length === 1 ? '' : 's'} available.`);
    } catch (error) {
      showToast('error', formatUserErrorMessage(error, `Unable to pull ${trimmedModel}.`));
    } finally {
      setOllamaPullProgress(null);
    }
  }

  async function deleteOllamaModel(model: string) {
    const trimmedModel = model.trim();
    if (!trimmedModel) {
      showToast('warning', 'Model name is required.');
      return;
    }

    try {
      const result = await window.vicode.ollamaRuntime.deleteModel(trimmedModel);
      const provider = await window.vicode.providers.refresh('ollama');
      setProviders((current) => current.map((item) => (item.id === provider.id ? provider : item)));
      showToast('info', `Deleted ${result.model}. ${result.models.length} local model${result.models.length === 1 ? '' : 's'} remain.`);
    } catch (error) {
      showToast('error', formatUserErrorMessage(error, `Unable to delete ${trimmedModel}.`));
    }
  }

  async function stopOllamaRuntime() {
    try {
      const snapshot = await window.vicode.ollamaRuntime.stop();
      setOllamaRuntimeStatus(snapshot);
      const provider = await window.vicode.providers.refresh('ollama');
      setProviders((current) => current.map((item) => (item.id === provider.id ? provider : item)));
      showToast(
        'info',
        snapshot.reachable
          ? 'Ollama is still reachable outside Vicode control.'
          : 'Stopped the Vicode-managed Ollama runtime.'
      );
    } catch (error) {
      showToast('error', formatUserErrorMessage(error, 'Unable to stop the Ollama local runtime.'));
    }
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

  async function clearAllProviderAuth() {
    const clearedProviders = await Promise.all(visibleProviders.map((provider) => window.vicode.providers.clearAuth(provider.id)));
    setProviders((current) =>
      current.map((item) => clearedProviders.find((provider) => provider.id === item.id) ?? item)
    );
    showToast('info', 'Providers disconnected.');
  }

  async function saveProviderApiKey(providerId: ProviderId) {
    if (!apiKeys[providerId].trim()) {
      showToast('warning', 'API key is required.');
      return;
    }
    const provider = await window.vicode.providers.saveApiKey(providerId, apiKeys[providerId]);
    setProviders((current) => current.map((item) => (item.id === provider.id ? provider : item)));
    setApiKeys((current) => ({ ...current, [providerId]: '' }));
    showToast(
      'info',
      providerId === 'ollama'
        ? 'Ollama API key stored. Hosted Ollama models can run without a local install.'
        : `${provider.label} API key stored as a local fallback.`
    );
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

    setPreferences(
      await window.vicode.settings.save({
        defaultProviderId: input.defaultProviderId ?? preferences?.defaultProviderId ?? 'openai',
        defaultModelByProvider: {
          openai: openAIModel,
          gemini: geminiModel,
          qwen: qwenModel,
          ollama: ollamaModel,
          kimi: kimiModel
        },
        defaultReasoningEffortByProvider: {
          openai: openAIReasoningEffort,
          gemini: geminiReasoningEffort,
          qwen: qwenReasoningEffort,
          ollama: ollamaReasoningEffort,
          kimi: kimiReasoningEffort
        },
        defaultThinkingByProvider: {
          openai: openAIThinking,
          gemini: geminiThinking,
          qwen: qwenThinking,
          ollama: ollamaThinking,
          kimi: kimiThinking
        },
        defaultExecutionPermission: input.defaultExecutionPermission ?? preferences?.defaultExecutionPermission ?? 'default',
        followUpBehavior: input.followUpBehavior ?? preferences?.followUpBehavior ?? 'queue',
        appearanceMode: input.appearanceMode ?? preferences?.appearanceMode ?? 'system',
        accentMode: input.accentMode ?? preferences?.accentMode ?? 'system',
        accentColor: input.accentColor ?? preferences?.accentColor ?? null,
        onboardingComplete: input.onboardingComplete ?? preferences?.onboardingComplete ?? false
      })
    );
  }

  async function allowMicrophoneForApp() {
    const microphoneAccessStatus = await window.vicode.voice.getMicrophoneAccessStatus();
    if (isMicrophoneAccessBlocked(microphoneAccessStatus)) {
      setMicrophoneConsentOpen(false);
      showToast('error', formatMicrophoneAccessMessage(microphoneAccessStatus));
      return;
    }

    try {
      const nextPreferences = await window.vicode.settings.save({ microphoneAllowed: true });
      setPreferences(nextPreferences);
      setMicrophoneConsentOpen(false);
      startVoiceRecording();
    } catch (error) {
      showToast('error', formatUserErrorMessage(error, 'Unable to save microphone permission.'));
    }
  }

  async function exportDiagnostics() {
    showToast('info', `Diagnostics exported to ${await window.vicode.diagnostics.export()}`);
  }

  async function exportActiveThreadDiagnostics() {
    if (!activeThread) {
      showToast('warning', 'Open a thread first.');
      return;
    }

    try {
      const path = await window.vicode.diagnostics.exportThread(activeThread.id);
      showToast('info', `Thread diagnostics exported to ${path}`);
    } catch (error) {
      showToast('error', formatUserErrorMessage(error, 'Failed to export thread diagnostics.'));
    }
  }

  async function loadStorageDiagnostics() {
    try {
      setStorageDiagnostics(await window.vicode.diagnostics.getStorage());
    } catch {
      setStorageDiagnostics(null);
    }
  }

  async function refreshStorageDiagnosticsIfVisible() {
    if ((route === 'settings' && settingsSection === 'general') || storageDiagnostics !== null) {
      await loadStorageDiagnostics();
    }
  }

  async function compactRunEvents() {
    try {
      const result = await window.vicode.diagnostics.compactRunEvents();
      await loadStorageDiagnostics();
      showToast(
        'info',
        result.deltaEventsDeleted > 0
          ? `Compacted ${result.deltaEventsDeleted} delta events across ${result.runsCompacted} archived runs and checkpointed SQLite. Reclaimed ${result.reclaimedBytes.toLocaleString()} bytes immediately.`
          : result.reclaimedBytes > 0
            ? `No archived terminal runs older than ${result.cutoffDays} days were eligible for compaction, but SQLite checkpointing still reclaimed ${result.reclaimedBytes.toLocaleString()} bytes.`
          : `No archived terminal runs older than ${result.cutoffDays} days were eligible for compaction.`
      );
    } catch (error) {
      showToast('error', formatUserErrorMessage(error, 'Failed to compact old run events.'));
    }
  }

  async function maintainStorage(input?: { vacuum?: boolean }) {
    try {
      const result = await window.vicode.diagnostics.maintainStorage(input);
      await loadStorageDiagnostics();
      showToast(
        'info',
        result.vacuumApplied
          ? `Deep cleanup finished. Reclaimed ${result.reclaimedBytes.toLocaleString()} bytes after compaction, WAL checkpoint, and VACUUM.`
          : `SQLite maintenance finished. Reclaimed ${result.reclaimedBytes.toLocaleString()} bytes.`
      );
    } catch (error) {
      showToast('error', formatUserErrorMessage(error, 'Failed to run SQLite maintenance.'));
    }
  }

  useEffect(() => {
    if (loading || route !== 'settings' || settingsSection !== 'general' || storageDiagnostics !== null) {
      return;
    }

    void loadStorageDiagnostics();
  }, [loading, route, settingsSection, storageDiagnostics]);

  const hasProjects = projects.length > 0;
  const showEmptyThreadOpenProjectAction = !hasProjects;
  const showWorkspaceRepairAction = Boolean(workspaceProject?.folderPath && workspaceProject.id === missingWorkspaceProjectId);
  const showWorkspaceTrustAction = Boolean(workspaceProject?.folderPath && !workspaceProject.trusted);
  const showWorkspaceBootstrapAction = Boolean(workspaceProject?.folderPath && workspaceBootstrapStatus?.needsBootstrap);
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

  async function savePersonalization(input: Partial<PersonalizationSettings>) {
    const next = await window.vicode.settings.savePersonalization(input);
    setPersonalization(next);
    showToast('info', 'Personalization saved.');
  }

  async function resetPersonalization() {
    setPersonalization(await window.vicode.settings.getPersonalization());
    showToast('info', 'Personalization reset.');
  }

  async function openWorkspaceBootstrap() {
    if (!workspaceProject) {
      showToast('warning', 'Select a trusted project first.');
      return;
    }

    try {
      const [status, questions] = await Promise.all([
        window.vicode.workspaceBootstrap.getStatus(workspaceProject.id),
        workspaceBootstrapQuestions.length > 0
          ? Promise.resolve(workspaceBootstrapQuestions)
          : window.vicode.workspaceBootstrap.getQuestionnaire()
      ]);
      setWorkspaceBootstrapStatus(status);
      setWorkspaceBootstrapQuestions(questions);
      setWorkspaceBootstrapAnswers(
        createWorkspaceBootstrapAnswerDefaults({
          selectedProject: workspaceProject,
          preferences,
          personalization
        })
      );
      setWorkspaceBootstrapIncludeSoul(false);
      setWorkspaceBootstrapIncludeDailyNote(false);
      setWorkspaceBootstrapDraftBundle(null);
      setWorkspaceBootstrapSelectedDraftPaths([]);
      setWorkspaceBootstrapActiveDraftPath(null);
      setWorkspaceBootstrapModalOpen(true);
    } catch (error) {
      showToast('error', formatUserErrorMessage(error, 'Unable to open workspace bootstrap.'));
    }
  }

  async function dismissWorkspaceBootstrapSuggestion() {
    if (!selectedProject) {
      return;
    }

    try {
      const status = await window.vicode.workspaceBootstrap.dismissSuggestion(selectedProject.id);
      setWorkspaceBootstrapStatus(status);
      showToast('info', 'Workspace bootstrap suggestion dismissed for this project.');
    } catch (error) {
      showToast('error', formatUserErrorMessage(error, 'Unable to dismiss workspace bootstrap suggestion.'));
    }
  }

  function updateWorkspaceBootstrapAnswer<K extends keyof WorkspaceBootstrapAnswers>(key: K, value: WorkspaceBootstrapAnswers[K]) {
    setWorkspaceBootstrapAnswers((current) => ({ ...current, [key]: value }));
  }

  function updateWorkspaceBootstrapDraft(relativePath: string, content: string) {
    setWorkspaceBootstrapDraftBundle((current) => {
      if (!current) {
        return current;
      }

      return {
        ...current,
        drafts: current.drafts.map((draft) => (draft.relativePath === relativePath ? { ...draft, content } : draft))
      };
    });
  }

  async function generateWorkspaceBootstrapDrafts() {
    if (!selectedProject) {
      return;
    }

    setWorkspaceBootstrapBusy(true);
    try {
      const bundle = await window.vicode.workspaceBootstrap.createDrafts({
        projectId: selectedProject.id,
        answers: {
          ...workspaceBootstrapAnswers,
          wantsSoul: workspaceBootstrapIncludeSoul,
          recentDecisions: splitDraftList((workspaceBootstrapAnswers.recentDecisions ?? []).join('\n')),
          openQuestions: splitDraftList((workspaceBootstrapAnswers.openQuestions ?? []).join('\n')),
          followUps: splitDraftList((workspaceBootstrapAnswers.followUps ?? []).join('\n'))
        },
        includeSoul: workspaceBootstrapIncludeSoul,
        includeDailyNote: workspaceBootstrapIncludeDailyNote
      });
      setWorkspaceBootstrapDraftBundle(bundle);
      setWorkspaceBootstrapSelectedDraftPaths(bundle.drafts.map((draft) => draft.relativePath));
      setWorkspaceBootstrapActiveDraftPath(bundle.drafts[0]?.relativePath ?? null);
    } catch (error) {
      showToast('error', formatUserErrorMessage(error, 'Unable to generate workspace drafts.'));
    } finally {
      setWorkspaceBootstrapBusy(false);
    }
  }

  async function regenerateWorkspaceBootstrapDraft(relativePath: string) {
    if (!selectedProject || !workspaceBootstrapDraftBundle) {
      return;
    }

    setWorkspaceBootstrapBusy(true);
    try {
      const regeneratedBundle = await window.vicode.workspaceBootstrap.createDrafts({
        projectId: selectedProject.id,
        answers: {
          ...workspaceBootstrapAnswers,
          wantsSoul: workspaceBootstrapIncludeSoul,
          recentDecisions: splitDraftList((workspaceBootstrapAnswers.recentDecisions ?? []).join('\n')),
          openQuestions: splitDraftList((workspaceBootstrapAnswers.openQuestions ?? []).join('\n')),
          followUps: splitDraftList((workspaceBootstrapAnswers.followUps ?? []).join('\n'))
        },
        includeSoul: workspaceBootstrapIncludeSoul,
        includeDailyNote: workspaceBootstrapIncludeDailyNote,
        overwriteExisting: true
      });
      const regeneratedDraft = regeneratedBundle.drafts.find((draft) => draft.relativePath === relativePath);
      if (!regeneratedDraft) {
        showToast('warning', 'Unable to regenerate that draft with the current bootstrap options.');
        return;
      }

      setWorkspaceBootstrapDraftBundle((current) => {
        if (!current) {
          return current;
        }
        return {
          ...current,
          status: regeneratedBundle.status,
          inspection: regeneratedBundle.inspection,
          drafts: current.drafts.map((draft) => (draft.relativePath === relativePath ? regeneratedDraft : draft))
        };
      });
      showToast('info', `Regenerated ${regeneratedDraft.fileName}.`);
    } catch (error) {
      showToast('error', formatUserErrorMessage(error, 'Unable to regenerate workspace draft.'));
    } finally {
      setWorkspaceBootstrapBusy(false);
    }
  }

  async function writeWorkspaceBootstrapDrafts() {
    if (!selectedProject || !workspaceBootstrapDraftBundle) {
      return;
    }

    const drafts = workspaceBootstrapDraftBundle.drafts.filter((draft) =>
      workspaceBootstrapSelectedDraftPaths.includes(draft.relativePath)
    );
    if (drafts.length === 0) {
      showToast('warning', 'Select at least one workspace file to write.');
      return;
    }

    setWorkspaceBootstrapBusy(true);
    try {
      const writtenPaths = await window.vicode.workspaceBootstrap.writeDrafts({
        projectId: selectedProject.id,
        drafts
      });
      setWorkspaceBootstrapModalOpen(false);
      setWorkspaceBootstrapDraftBundle(null);
      const status = await window.vicode.workspaceBootstrap.getStatus(selectedProject.id);
      setWorkspaceBootstrapStatus(status);
      showToast('info', writtenPaths.length === 1 ? 'Workspace file written.' : `Wrote ${writtenPaths.length} workspace files.`);
    } catch (error) {
      showToast('error', formatUserErrorMessage(error, 'Unable to write workspace files.'));
    } finally {
      setWorkspaceBootstrapBusy(false);
    }
  }

  async function captureDailyNoteFromThread() {
    if (!activeThread) {
      return;
    }

    try {
      const result = await window.vicode.memoryWrites.createDailyNoteReview(activeThread.id);
      setJobs((current) => [result.job, ...current.filter((item) => item.id !== result.job.id)]);
      if (result.reviewItem.status === 'pending') {
        setReviewItems((current) => [result.reviewItem, ...current.filter((item) => item.id !== result.reviewItem.id)]);
        showPendingReviewToast(result.reviewItem, result.alreadyPending ? reviewItemsRef.current.length : reviewItemsRef.current.length + 1);
      } else {
        showToast('info', result.reviewItem.decision?.alreadyApplied ? 'Daily note was already saved.' : 'Daily note saved.');
      }
    } catch (error) {
      showToast('error', formatUserErrorMessage(error, 'Unable to save a daily note from this thread.'));
    }
  }

  async function promoteThreadToMemory() {
    if (!activeThread) {
      return;
    }

    try {
      const result = await window.vicode.memoryWrites.createMemoryPromotionReview(activeThread.id);
      setJobs((current) => [result.job, ...current.filter((item) => item.id !== result.job.id)]);
      if (result.reviewItem.status === 'pending') {
        setReviewItems((current) => [result.reviewItem, ...current.filter((item) => item.id !== result.reviewItem.id)]);
        showPendingReviewToast(result.reviewItem, result.alreadyPending ? reviewItemsRef.current.length : reviewItemsRef.current.length + 1);
      } else {
        showToast(
          'info',
          result.reviewItem.decision?.alreadyApplied ? 'MEMORY.md was already updated.' : 'Updated MEMORY.md.'
        );
      }
    } catch (error) {
      showToast('error', formatUserErrorMessage(error, 'Unable to update MEMORY.md from this thread.'));
    }
  }

  async function suggestUserPreferenceFromThread() {
    if (!activeThread) {
      return;
    }

    try {
      const result = await window.vicode.memoryWrites.createUserPreferenceReview(activeThread.id);
      setJobs((current) => [result.job, ...current.filter((item) => item.id !== result.job.id)]);
      if (result.reviewItem.status === 'pending') {
        setReviewItems((current) => [result.reviewItem, ...current.filter((item) => item.id !== result.reviewItem.id)]);
        showPendingReviewToast(result.reviewItem, result.alreadyPending ? reviewItemsRef.current.length : reviewItemsRef.current.length + 1);
      } else {
        showToast(
          'info',
          result.reviewItem.decision?.alreadyApplied ? 'USER.md was already updated.' : 'Updated USER.md.'
        );
      }
    } catch (error) {
      showToast('error', formatUserErrorMessage(error, 'Unable to update USER.md from this thread.'));
    }
  }

  async function openSelectedProjectFolder() {
    if (!selectedProject?.folderPath) {
      showToast('warning', 'This project does not have a folder location yet.');
      return;
    }

    await window.vicode.app.revealPath(selectedProject.folderPath);
  }

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

  function openSkillsRoute() {
    setRoute('skills');
  }

  function openBuildControlRoute() {
    setRoute('build-control');
  }

  function openAutomationsRoute() {
    setRoute('automations');
  }

  function openCollaborationSection(section: CollaborationSection) {
    if (!COLLABORATION_SHELL_ENABLED) {
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

  function dismissWelcomeScreen() {
    setShowStartupWelcome(false);
    setRoute('thread');
    if (!preferences?.onboardingComplete) {
      void saveDefaultPreferences({ onboardingComplete: true });
    }
  }

  async function handleEvent(event: AppEvent) {
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
    if (event.type.startsWith('collab.')) {
      applyCollaborationBootstrap(await window.vicode.collab.getBootstrap());
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
        setActiveThread((current) =>
          current
            ? {
                ...current,
                ...event.thread,
                turns: current.turns,
                rawOutput: current.rawOutput,
                planner: current.planner
              }
            : current
        );
      }
      return;
    }
    if (event.type === 'thread.detail' && activeThreadIdRef.current === event.thread.id) {
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
          current
            ? {
                ...current,
                status: 'running',
                rawOutput: appendRunEvent(current.rawOutput, {
                  id: `${event.runId}:started:${current.rawOutput.length}`,
                  threadId: event.threadId,
                  runId: event.runId,
                  eventType: 'started',
                  payload: {},
                  createdAt: new Date().toISOString()
                })
              }
            : current
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
      setActiveThread((current) => {
        if (!current) {
          return current;
        }
        const turns = [...current.turns];
        const reverseIndex = [...turns]
          .reverse()
          .findIndex((turn) => turn.runId === event.runId && turn.role === 'assistant');
        const realIndex = reverseIndex >= 0 ? turns.length - 1 - reverseIndex : -1;
        if (realIndex >= 0) {
          turns[realIndex] = { ...turns[realIndex], content: turns[realIndex].content + event.delta };
        } else {
          turns.push({
            id: `${event.runId}-assistant`,
            threadId: event.threadId,
            runId: event.runId,
            role: 'assistant',
            content: event.delta,
            metadata: null,
            createdAt: new Date().toISOString()
          });
        }
        return {
          ...current,
          turns,
          rawOutput: appendRunEvent(current.rawOutput, {
            id: `${event.runId}:delta:${current.rawOutput.length}`,
            threadId: event.threadId,
            runId: event.runId,
            eventType: 'delta',
            payload: { delta: event.delta },
            createdAt: new Date().toISOString()
          })
        };
      });
      return;
    }
    if (event.type === 'run.replace' && activeThreadIdRef.current === event.threadId) {
      setActiveThread((current) => {
        if (!current) {
          return current;
        }
        const turns = [...current.turns];
        const reverseIndex = [...turns]
          .reverse()
          .findIndex((turn) => turn.runId === event.runId && turn.role === 'assistant');
        const realIndex = reverseIndex >= 0 ? turns.length - 1 - reverseIndex : -1;
        if (realIndex >= 0) {
          turns[realIndex] = { ...turns[realIndex], content: event.text };
        } else {
          turns.push({
            id: `${event.runId}-assistant`,
            threadId: event.threadId,
            runId: event.runId,
            role: 'assistant',
            content: event.text,
            metadata: null,
            createdAt: new Date().toISOString()
          });
        }
        return {
          ...current,
          turns
        };
      });
      return;
    }
    if (event.type === 'raw.event' && activeThreadIdRef.current === event.event.threadId) {
      setRunProgressByRunId((current) => applyRunProgressSnapshotEvent(current, event.event));
      setActiveThread((current) =>
        current
          ? {
              ...current,
              rawOutput: appendRunEvent(current.rawOutput, event.event)
            }
          : current
      );
      return;
    }
    if (event.type === 'run.status' && ['completed', 'failed', 'aborted'].includes(event.status)) {
      if (event.threadId === activeThreadIdRef.current) {
        if (event.status === 'failed' && event.message) {
          showToast('error', event.message);
        }
        if (event.status === 'aborted') {
          showToast('warning', event.message ?? 'Run stopped before completion.');
        }
      }
      setRunProgressByRunId((current) => {
        if (!(event.runId in current)) {
          return current;
        }
        const next = { ...current };
        delete next[event.runId];
        return next;
      });
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
          label: isManualWrite ? 'Approve and write' : 'Approve and run',
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

  const activeWorkspaceBootstrapDraft = workspaceBootstrapDraftBundle?.drafts.find(
    (draft) => draft.relativePath === workspaceBootstrapActiveDraftPath
  ) ?? null;

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

  useEffect(() => {
    let cancelled = false;

    async function loadWorkspaceBootstrapStatus() {
      if (!workspaceProject) {
        setWorkspaceBootstrapStatus(null);
        return;
      }

      try {
        const status = await window.vicode.workspaceBootstrap.getStatus(workspaceProject.id);
        if (!cancelled) {
          setWorkspaceBootstrapStatus(status);
        }
      } catch {
        if (!cancelled) {
          setWorkspaceBootstrapStatus(null);
        }
      }
    }

    void loadWorkspaceBootstrapStatus();

    return () => {
      cancelled = true;
    };
  }, [workspaceProject]);

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

    const downloadedUpdateKey = getDownloadedUpdateKey(appUpdateState);
    const versionLabel = appUpdateState.availableVersion
      ? `Version ${appUpdateState.availableVersion}`
      : 'The downloaded desktop update';

    if (downloadedUpdateKey && isQueuedUpdateInstall(appUpdateState, queuedUpdateInstallKey)) {
      showToast('warning', `${versionLabel} is already queued and will install when the current run finishes.`, {
        title: 'Update queued',
        sticky: true
      });
      return;
    }

    if (hasActiveRun) {
      if (downloadedUpdateKey) {
        setQueuedUpdateInstallKey(downloadedUpdateKey);
      }
      showToast('warning', `${versionLabel} will install when the current run finishes.`, {
        title: 'Update queued',
        sticky: true
      });
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
    if (!queuedUpdateInstallKey) {
      return;
    }

    if (!isQueuedUpdateInstall(appUpdateState, queuedUpdateInstallKey)) {
      setQueuedUpdateInstallKey(null);
    }
  }, [appUpdateState, queuedUpdateInstallKey]);

  useEffect(() => {
    if (!queuedUpdateInstallKey || hasActiveRun || !isQueuedUpdateInstall(appUpdateState, queuedUpdateInstallKey)) {
      return;
    }

    setQueuedUpdateInstallKey(null);
    void restartToUpdate();
  }, [appUpdateState, hasActiveRun, queuedUpdateInstallKey]);

  useEffect(() => {
    const downloadedUpdateKey = getDownloadedUpdateKey(appUpdateState);
    if (!downloadedUpdateKey) {
      return;
    }

    if (downloadedUpdateToastVersionRef.current === downloadedUpdateKey) {
      return;
    }

    downloadedUpdateToastVersionRef.current = downloadedUpdateKey;
    const versionLabel = appUpdateState?.availableVersion
      ? `Version ${appUpdateState.availableVersion} is ready to install.`
      : 'The latest desktop update is ready to install.';
    showToast('warning', `${versionLabel} ${hasActiveRun ? 'Vicode can install it when the current run finishes.' : 'Restart Vicode to finish updating.'}`, {
      title: 'Update ready',
      sticky: true,
      actions: [
        {
          label: 'Later',
          tone: 'quiet',
          onAction: () => dismissToast()
        },
        {
          label: hasActiveRun ? 'Install when idle' : 'Restart now',
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
      className={`app-shell h-screen min-h-screen w-full overflow-hidden bg-[color:var(--ui-app-bg)] text-[color:var(--ui-text-title)]${showWelcomeScreen ? ' app-shell-welcome' : ''}${shellReady && !showWelcomeScreen && (route === 'thread' || route === 'collab') ? ' app-shell-thread' : ''}`}
      style={{
        ['--vicode-sidebar-width' as string]: `${effectiveSidebarWidth}px`,
        ['--windows-titlebar-leading-width' as string]: `${titlebarLeadingWidth}px`
      }}
    >
      {!showWelcomeScreen ? (
        <WindowsTitleBar
          route={route}
          selectedProjectName={selectedProject?.name ?? null}
          activeThreadTitle={activeThread?.title ?? null}
          isAgentWorking={Boolean(activeRunId)}
          collaboration={collaboration}
          appUpdateState={appUpdateState}
          hasActiveRun={hasActiveRun}
          queuedUpdateInstallKey={queuedUpdateInstallKey}
          openSettings={openSettingsSection}
          openSkills={openSkillsRoute}
          pressUpdateAction={pressTitlebarUpdateAction}
        />
      ) : null}

      <div className="app-workspace-shell">
        {shellReady && !showWelcomeScreen ? (
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
              createThreadForProject={createThreadForProject}
              renameProject={renameProject}
              removeProject={removeProject}
              removingProjectId={removingProjectId}
              setProjectTrust={setProjectTrust}
              projects={projects}
              selectedProjectId={selectedProjectId}
              expandedProjectIds={expandedProjectIds}
              toggleProjectThreads={toggleProjectThreads}
              reorderProjects={reorderProjects}
              threadsByProject={threadsByProject}
              subagentsByThreadId={subagentsByThreadId}
              activeThreadId={activeThread?.id ?? null}
              openThread={openThread}
              archiveThread={archiveThread}
              openProjectFolderLocation={openProjectFolderLocation}
              openSettings={() => openSettingsSection('general')}
              sidebarCollapsed={sidebarCollapsed}
              toggleSidebar={toggleSidebarCollapsed}
            />
          </div>
        ) : null}
        {shellReady && !showWelcomeScreen && !sidebarCollapsed ? (
          <div
            data-testid="sidebar-resize-rail"
            className={cx('sidebar-resize-rail', sidebarResizing && 'is-active')}
            role="separator"
            aria-label="Resize sidebar"
            aria-orientation="vertical"
            aria-valuemin={SIDEBAR_MIN_WIDTH}
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
          className={`main-surface min-w-0 flex-1 overflow-hidden${loading ? ' main-surface-loading' : ''}${showWelcomeScreen ? ' main-surface-welcome' : ''}${shellReady && !showWelcomeScreen && (route === 'thread' || route === 'collab') ? ' main-surface-thread' : ''}${shellReady && !showWelcomeScreen && route === 'settings' ? ' main-surface-settings' : ''}`}
        >
        {loading ? (
          <div className="loading-state loading-state-boot">
            <div className="loading-boot-card" aria-label="Vicode is loading">
              <LandingBeams />
              <div className="loading-boot-overlay" aria-hidden="true" />
              <div className="loading-boot-content">
                <div className="loading-boot-brand">
                  <img className="loading-boot-logo" src={wolfLogo} alt="Vicode logo" />
                  <h1 className="loading-boot-title">Vicode</h1>
                </div>
                <div className="loading-boot-status">
                  Loading<span className="loading-boot-ellipsis" aria-hidden="true" />
                </div>
              </div>
            </div>
          </div>
        ) : null}
        {showWelcomeScreen ? (
          <LandingPage onGetStarted={dismissWelcomeScreen} />
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
        {shellReady && !showWelcomeScreen && route === 'thread' ? (
          <section className="flex h-full min-h-0 flex-1 flex-col xl:flex-row">
          <section className="thread-view flex min-h-0 min-w-0 flex-1 flex-col gap-0">
            {activeThread || workspaceProject ? (
              <header className="thread-header flex items-start justify-between gap-4 px-7 py-5">
                <div className="thread-header-main min-w-0 flex-1">
                  <div className="thread-title-row flex min-w-0 items-center gap-2">
                    {activeThread ? (
                      <>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <h2 className="truncate text-[28px] font-semibold tracking-[-0.04em] text-[color:var(--ui-text-title)]">{normalizeDisplayText(activeThread.title)}</h2>
                          </TooltipTrigger>
                          <TooltipContent>{normalizeDisplayText(activeThread.title)}</TooltipContent>
                        </Tooltip>
                        <span className="thread-title-separator text-[color:var(--ui-text-subtle)]" aria-hidden="true">·</span>
                      </>
                    ) : (
                      <h2 className="truncate text-[28px] font-semibold tracking-[-0.04em] text-[color:var(--ui-text-title)]">New thread</h2>
                    )}
                    {workspaceProject?.folderPath ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <p
                            className={cx(
                              'thread-eyebrow truncate text-[13px] font-medium text-[color:var(--ui-text-muted)]',
                              showWorkspaceRepairAction && 'thread-eyebrow-missing'
                            )}
                          >
                            {workspaceProject.name}
                          </p>
                        </TooltipTrigger>
                        <TooltipContent>{workspaceProject.folderPath}</TooltipContent>
                      </Tooltip>
                    ) : (
                      <p className="thread-eyebrow truncate text-[13px] font-medium text-[color:var(--ui-text-muted)]">{workspaceProject?.name ?? 'Workspace'}</p>
                    )}
                  </div>
                </div>
                {showWorkspaceRepairAction ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <ActionButton
                        size="compact"
                        tone="quiet"
                        className="thread-header-trust-button"
                        leadingIcon={<FolderIcon />}
                        onClick={() => void repairWorkspaceProjectPath(workspaceProject)}
                      >
                        Repair path
                      </ActionButton>
                    </TooltipTrigger>
                    <TooltipContent className="thread-header-trust-tooltip">
                      This thread still points to a missing workspace folder. Pick the current folder for this project before running tools again.
                    </TooltipContent>
                  </Tooltip>
                ) : showWorkspaceTrustAction ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <ActionButton
                        size="compact"
                        tone="quiet"
                        className="thread-header-trust-button"
                        leadingIcon={<AccessIcon />}
                        onClick={() => void trustProject(true)}
                      >
                        Trust workspace
                      </ActionButton>
                    </TooltipTrigger>
                    <TooltipContent className="thread-header-trust-tooltip">
                      Allow Vicode to work with files in this project folder, run coding tasks here, and set up workspace files like AGENTS.md and MEMORY.md. This applies to the whole project, not just this thread.
                    </TooltipContent>
                  </Tooltip>
                ) : showWorkspaceBootstrapAction ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <ActionButton
                        size="compact"
                        tone="quiet"
                        className="thread-header-trust-button"
                        data-testid="workspace-bootstrap-open"
                        onClick={() => void openWorkspaceBootstrap()}
                      >
                        Workspace
                      </ActionButton>
                    </TooltipTrigger>
                    <TooltipContent className="thread-header-trust-tooltip">
                      Vicode will automatically draft workspace instruction and memory files for this trusted project workspace. You can review and edit them before saving, but that is optional.
                    </TooltipContent>
                  </Tooltip>
                ) : null}
                {activeThread ? (
                  <Menu>
                    <MenuTrigger asChild>
                      <IconButton className="thread-header-menu-button" label="Thread actions">
                        <MoreIcon />
                      </IconButton>
                    </MenuTrigger>
                    <MenuContent align="end" className="thread-header-menu">
                      {selectedProject?.folderPath ? (
                        <MenuItem onSelect={() => void openSelectedProjectFolder()}>
                          <MenuItemLabel>Open folder location</MenuItemLabel>
                          <FolderIcon />
                        </MenuItem>
                      ) : null}
                      <MenuItem onSelect={() => void renameThread()}>
                        <MenuItemLabel>Rename thread</MenuItemLabel>
                        <EditIcon />
                      </MenuItem>
                      <MenuItem onSelect={() => void duplicateThread()}>
                        <MenuItemLabel>Duplicate thread</MenuItemLabel>
                        <CopyIcon />
                      </MenuItem>
                      <MenuItem onSelect={() => void retryThread()}>
                        <MenuItemLabel>Retry last prompt</MenuItemLabel>
                        <RefreshIcon />
                      </MenuItem>
                      <MenuSeparator />
                      <MenuItem onSelect={() => void archiveThread()}>
                        <MenuItemLabel>Archive thread</MenuItemLabel>
                        <ArchiveIcon />
                      </MenuItem>
                      <MenuItem className="ui-menu-item-danger" onSelect={() => setDeleteDialogOpen(true)}>
                        <MenuItemLabel>Delete permanently</MenuItemLabel>
                        <TrashIcon />
                      </MenuItem>
                    </MenuContent>
                  </Menu>
                ) : null}
              </header>
            ) : null}

            <div className="thread-column flex min-h-0 flex-1 flex-col overflow-hidden">
              <section
                className={cx(
                  'transcript flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden px-7 pb-6 pt-5',
                  showTranscriptRailCentered && 'items-center justify-center pb-0 pt-0'
                )}
                ref={transcriptRef}
                onWheelCapture={() => {
                  markTranscriptUserScrollIntent();
                }}
                onTouchMoveCapture={() => {
                  markTranscriptUserScrollIntent();
                }}
                onScroll={(event) => {
                  if (transcriptProgrammaticScrollRef.current) {
                    return;
                  }
                  if (!transcriptUserScrollIntentRef.current) {
                    return;
                  }
                  transcriptAutoFollowRef.current = isTranscriptNearBottom(event.currentTarget);
                }}
              >
                <div
                  className={cx(
                    'thread-transcript-rail mx-auto flex w-full max-w-[980px] flex-col gap-5',
                    showTranscriptRailCentered && 'min-h-full flex-1 items-center justify-center'
                  )}
                >
                  {activeThread ? (
                    <>
                      {transcriptTurns.length > 0 ? transcriptTurns.map((turn) => (
                        <div key={turn.id} className="thread-transcript-entry flex flex-col gap-4">
                          {turn.role === 'assistant' && turn.runId && runTranscriptItemsByRunId[turn.runId]?.length > 0 ? (
                            <RunTranscriptTimeline
                              items={runTranscriptItemsByRunId[turn.runId]}
                              skills={skills}
                              runState={runActivityByRunId[turn.runId]?.state ?? null}
                            />
                          ) : turn.role === 'assistant' && !turn.content.trim() ? null : (
                            <article
                              className={cx(
                                `turn turn-${turn.role}`,
                                'flex flex-col gap-1',
                                turn.role === 'user' && 'items-end'
                              )}
                            >
                              {turn.role === 'assistant' ? (
                                <MessageResponse
                                  className="turn-content turn-content-assistant text-[15px] leading-7 text-[color:var(--ui-text-title)]"
                                  normalizeSource
                                >
                                  {turn.content || ''}
                                </MessageResponse>
                              ) : (
                                <div className="turn-user-stack flex w-full max-w-[860px] flex-col items-end gap-3">
                                    {extractTurnImageAttachments(turn.metadata).length > 0 ? (
                                      <div className="turn-image-strip flex flex-wrap justify-end gap-2">
                                        {extractTurnImageAttachments(turn.metadata).map((attachment) => (
                                          <button
                                            key={attachment.id}
                                            type="button"
                                            className="turn-image-thumb overflow-hidden rounded-[18px] border border-[color:var(--ui-border)] bg-[color:var(--ui-alpha-04)] p-0 transition-colors hover:border-[color:var(--ui-border-strong)] hover:bg-[color:var(--ui-alpha-06)]"
                                            onClick={() => setActiveImageAttachment(attachment)}
                                            aria-label={`Open ${attachment.name}`}
                                          >
                                            <img className="block h-24 w-24 object-cover" src={attachment.dataUrl} alt={attachment.name} />
                                          </button>
                                        ))}
                                      </div>
                                    ) : null}
                                    {extractTurnTextAttachments(turn.metadata).length > 0 ? (
                                      <div className="turn-text-attachment-strip flex flex-wrap justify-end gap-2">
                                        {extractTurnTextAttachments(turn.metadata).map((attachment) => (
                                          <button
                                            key={attachment.id}
                                            type="button"
                                            className="turn-text-attachment-chip inline-flex max-w-[360px] items-center gap-2 rounded-[18px] border border-[color:var(--ui-border)] bg-[color:var(--ui-alpha-04)] px-3 py-2 text-left transition-colors hover:border-[color:var(--ui-border-strong)] hover:bg-[color:var(--ui-alpha-06)]"
                                            onClick={() => void window.vicode.app.revealPath(attachment.absolutePath)}
                                            aria-label={`Reveal ${attachment.name}`}
                                          >
                                            <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-xl border border-white/8 bg-white/[0.04] text-zinc-300">
                                              <BookIcon />
                                            </span>
                                            <span className="flex min-w-0 flex-1 flex-col">
                                              <span className="truncate text-[12px] font-medium text-[color:var(--ui-text-title)]">{attachment.name}</span>
                                              <span className="truncate text-[11px] text-[color:var(--ui-text-muted)]">
                                                {attachment.relativePath} · {attachment.charCount.toLocaleString()} chars
                                              </span>
                                            </span>
                                          </button>
                                        ))}
                                      </div>
                                    ) : null}
                                    <MessageResponse className="turn-content turn-content-user rounded-[22px] bg-[image:var(--ui-panel-gradient-strong)] px-5 py-4 text-[15px] leading-7 text-[color:var(--ui-text-title)]">
                                      {turn.content}
                                    </MessageResponse>
                                  </div>
                                )}
                              </article>
                            )
                          }
                          {turn.role === 'user' &&
                          activeRunActivity &&
                          activeRunActivity.state === 'running' &&
                          !hasAssistantTurnForRun(activeThread, activeDisplayedRunId) &&
                          turn.id === transcriptRunAnchorTurnId ? (
                            activeRunTranscriptItems.length > 0 ? (
                              <RunTranscriptTimeline
                                items={activeRunTranscriptItems}
                                skills={skills}
                                runState={activeRunActivity.state}
                              />
                            ) : (
                              <RunActivityPanel activity={activeRunActivity} />
                            )
                          ) : null}
                        </div>
                      )) : emptyActiveThreadState}
                      {activeSubagents.length > 0 ? (
                        <div className="thread-transcript-entry thread-transcript-subagent-entry flex flex-col gap-4">
                          <ThreadSubagentActivityCard
                            subagents={activeSubagents}
                            resolveThreadTitle={resolveThreadTitle}
                          />
                        </div>
                      ) : null}
                    </>
                  ) : startupThreadRestoreState === 'pending' ? (
                    restoringThreadState
                  ) : (
                    emptyThreadHero
                  )}
                </div>
              </section>

              <div className="thread-composer-stack flex shrink-0 flex-col px-7 py-5">
                <div className="thread-composer-rail flex w-full max-w-[980px] flex-col gap-3">
                  {activeRunActivity && (activeRunActivity.state === 'failed' || activeRunActivity.state === 'aborted') ? (
                    <RunActivityPanel activity={activeRunActivity} showTimeline={false} />
                  ) : null}
                  <LiveRunStatus activity={activeRunActivity} />
                  {selectedProject ? (
                    <>
                      <ComposerPanel
                        activityItems={composerActivityItems}
                        prompt={composer.prompt}
                        setPrompt={(prompt) => setComposer((current) => ({ ...current, prompt }))}
                        imageAttachments={composer.imageAttachments}
                        textAttachments={composer.textAttachments}
                        canCreateTextAttachments={Boolean(composerProjectId && workspaceProject?.folderPath && workspaceProject.trusted)}
                        addImageFiles={addComposerImageFiles}
                        addTextAttachmentFromPaste={addComposerTextAttachment}
                        removeImageAttachment={removeComposerImageAttachment}
                        removeTextAttachment={removeComposerTextAttachment}
                        composerRef={composerRef}
                        providers={visibleProviders}
                        providerId={composer.providerId}
                        modelId={composer.modelId}
                        composerMode={composer.mode}
                        contextWindow={composerContextWindow}
                        executionPermission={composer.executionPermission}
                        runtimeCommandPolicy={workspaceProject?.runtimeCommandPolicy}
                        runtimeNetworkPolicy={workspaceProject?.runtimeNetworkPolicy}
                        onSelectPermission={(executionPermission) => void setExecutionPermission(executionPermission)}
                        effort={composerEffort}
                        thinkingEnabled={composer.thinkingEnabled}
                        installedSkills={installedComposerSkills}
                        availableSkills={availableComposerSkills}
                        attachedSkillIds={attachedSkillIds}
                        toggleAttachedSkill={toggleAttachedSkill}
                        selectComposerModel={selectComposerModel}
                        selectComposerEffort={selectComposerEffort}
                        selectProviderThinking={selectProviderThinking}
                        refreshProvider={refreshProvider}
                        openProviderSettings={() => openSettingsSection('providers')}
                        openProjectFromPicker={openProjectFromPicker}
                        createThread={createThread}
                        toggleComposerMode={toggleComposerMode}
                        handleComposerVoice={handleComposerVoice}
                        voiceState={voiceState}
                        voiceAvailable={isVoiceDictationSupported()}
                        voiceElapsedLabel={formatVoiceElapsed(voiceElapsedMs)}
                        voiceLevel={voiceLevel}
                        pendingNativeCommandId={pendingNativeCommandId}
                        setPendingNativeCommandId={setPendingNativeCommandId}
                        stopPrompt={stopPrompt}
                        enhancePrompt={enhanceComposerPrompt}
                        enhancingPrompt={enhancingPrompt}
                        submittingPrompt={composerSubmitting || plannerSubmitting}
                        submitPrompt={submitPrompt}
                        activeRunId={activeDisplayedRunId}
                        showToast={showToast}
                      />
                    </>
                  ) : null}
                </div>
              </div>
            </div>
          </section>
          </section>
        ) : null}
        {COLLABORATION_SHELL_ENABLED && shellReady && !showWelcomeScreen && route === 'collab' ? (
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
        {shellReady && route === 'settings' ? (
        <SettingsView
            section={settingsSection}
            setSection={setSettingsSection}
            onBack={toggleSettingsRoute}
            providers={visibleProviders}
            preferences={preferences}
            personalization={personalization}
            savePreferences={saveDefaultPreferences}
            savePersonalization={savePersonalization}
            resetPersonalization={resetPersonalization}
            apiKeys={apiKeys}
            setApiKeys={setApiKeys}
          connectProvider={connectProvider}
          adoptProviderAuth={adoptProviderAuth}
          beginProviderInstall={beginProviderInstall}
            clearProviderAuth={clearProviderAuth}
            refreshProvider={refreshProvider}
            pullOllamaModel={pullOllamaModel}
            ollamaPullProgress={ollamaPullProgress}
            ollamaRuntimeStatus={ollamaRuntimeStatus}
            stopOllamaRuntime={stopOllamaRuntime}
            deleteOllamaModel={deleteOllamaModel}
            saveProviderApiKey={saveProviderApiKey}
            exportDiagnostics={exportDiagnostics}
            clearAllProviderAuth={clearAllProviderAuth}
            appMeta={appMeta}
            appUpdateState={appUpdateState}
            hasActiveRun={hasActiveRun}
            queuedUpdateInstallKey={queuedUpdateInstallKey}
            checkForAppUpdates={checkForAppUpdates}
            restartToUpdate={requestRestartToUpdate}
            storageDiagnostics={storageDiagnostics}
            refreshStorageDiagnostics={loadStorageDiagnostics}
            compactRunEvents={compactRunEvents}
            maintainStorage={maintainStorage}
            selectedProject={workspaceProject}
            saveProjectRuntimeCommandPolicy={saveProjectRuntimeCommandPolicy}
            saveProjectRuntimeNetworkPolicy={saveProjectRuntimeNetworkPolicy}
            workspaceBootstrapStatus={workspaceBootstrapStatus}
            openWorkspaceBootstrap={openWorkspaceBootstrap}
            archivedThreads={archivedThreads}
            projects={projects}
            restoreArchivedThread={restoreArchivedThread}
            deleteArchivedThread={deleteArchivedThread}
          />
        ) : null}
        {shellReady && route === 'ui-dev' && import.meta.env.DEV ? <UiDevSurface /> : null}

        {shellReady && route === 'skills' ? (
          <SkillsView
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
            syncSkill={syncSkill}
            removeSkill={removeSkill}
            toggleAttachedSkill={toggleAttachedSkill}
            showToast={showToast}
          />
        ) : null}
        {shellReady && (route === 'automations' || route === 'build-control') ? (
          <section className="catalog-view automation-view">
            <div className="automation-page-shell">
              <header className="view-header automation-view-header flex items-start justify-between gap-4">
                <div>
                  <h2>{route === 'build-control' ? 'Autonomous Builds' : 'Automations'}</h2>
                  <p>{route === 'build-control' ? 'Prompt-driven build plans with visible planner, builder, and finisher threads.' : 'Manual and while-open schedules in v1.'}</p>
                </div>
                <div className="automation-view-header-actions">
                  {route === 'automations' ? (
                    <PrimaryButton className="automation-toolbar-primary" size="compact" leadingIcon={<PlusIcon />} onClick={openAutomationEditor}>
                      Create automation
                    </PrimaryButton>
                  ) : route === 'build-control' ? (
                    <PrimaryButton className="automation-toolbar-primary" size="compact" leadingIcon={<PlayIcon />} onClick={openBuildPlanDialog}>
                      New build plan
                    </PrimaryButton>
                  ) : null}
                  <IconButton className="automation-toolbar-close rounded-xl" label="Close autonomous builds" onClick={() => setRoute('thread')}>
                    <CloseIcon />
                  </IconButton>
                </div>
              </header>
              <div className="automation-route-shell">
                <section className="automation-main-column">
                  {route === 'build-control' ? (
                    <VicodeBuildControlView
                      snapshot={vicodeBuildSnapshot}
                      verification={vicodeBuildVerification}
              busyAction={vicodeBuildBusyAction}
              onRefresh={() => void refreshVicodeBuildSnapshot()}
              onCreatePlan={openBuildPlanDialog}
                      onClearInactivePlans={clearInactiveVicodeBuildPlans}
                      onSetTeamPaused={setVicodeBuildTeamPaused}
                      onWakeLane={wakeVicodeBuildLane}
                      onRetryLane={retryVicodeBuildLane}
                      onOpenThread={openVicodeBuildLaneThread}
                      onRunVerification={runVicodeBuildVerification}
                    />
                  ) : (
                    <>
                      <section className="automation-template-group">
                        <div className="automation-template-group-header">
                          <h3>Manual automations</h3>
                        </div>
                      </section>
                      <section className="automation-template-section">
                        {automationTemplateGroups.map(([group, templates]) => (
                          <div key={group} className="automation-template-group">
                            <div className="automation-template-group-header">
                              <h3>{group}</h3>
                            </div>
                            <div className="automation-template-grid">
                              {templates.map((template) => (
                                <article key={template.id} className="automation-template-card">
                                  <div className="automation-template-copy">
                                    <strong>{template.name}</strong>
                                    <p>{template.summary}</p>
                                  </div>
                                  <ActionButton className="automation-template-action" size="compact" tone="quiet" onClick={() => applyAutomationTemplate(template)}>
                                    Use template
                                  </ActionButton>
                                </article>
                              ))}
                            </div>
                          </div>
                        ))}
                      </section>
                      <section className="automation-list">
                {reviewItems.length > 0 ? (
                  <div ref={pendingReviewSectionRef} className="panel pending-review-panel" data-testid="pending-review-section">
                    <div className="pending-review-header">
                      <div className="pending-review-header-copy">
                        <h3>Pending review</h3>
                        <p>Approve queued automation runs and any remaining manual review items.</p>
                      </div>
                      <StatusPill tone="warning">{reviewItems.length} pending</StatusPill>
                    </div>
                    {reviewItems.map((reviewItem) => {
                      const job = jobs.find((item) => item.id === reviewItem.jobId) ?? null;
                      const presentation = describeReviewItem(reviewItem, job);
                      const persistedDraftContent = String(reviewItem.details.content ?? '');
                      const draftContent = reviewDraftEdits[reviewItem.id] ?? persistedDraftContent;
                      const hasUnsavedDraftChanges = presentation.isManualWrite && draftContent.trim() !== persistedDraftContent.trim();
                      return (
                        <article
                          key={reviewItem.id}
                          className="automation-card review-card"
                          data-testid={`pending-review-card-${reviewItem.id}`}
                        >
                          <div className="skill-card-top review-card-top">
                            <div className="review-card-copy">
                              <div className="review-card-eyebrow">
                                <span className="review-card-eyebrow-icon" aria-hidden="true">
                                  {renderReviewIcon(presentation.icon)}
                                </span>
                                <span>{presentation.kindLabel}</span>
                              </div>
                              <h3>{presentation.title}</h3>
                              <p>{presentation.summary}</p>
                            </div>
                            <StatusPill tone="warning">pending review</StatusPill>
                          </div>
                          <div className="review-card-meta-list">
                            {presentation.meta.map((entry) => (
                              <div key={`${reviewItem.id}-${entry.label}-${entry.value}`} className="review-card-meta-pill">
                                <span className="review-card-meta-label">{entry.label}</span>
                                <span className="review-card-meta-value">{entry.value}</span>
                              </div>
                            ))}
                          </div>
                          {presentation.isManualWrite ? (
                            <SurfaceCard className="review-card-draft">
                              <div className="review-card-draft-header">
                                <div className="review-card-draft-copy">
                                  <strong>Proposed contents</strong>
                                  <span>{String(reviewItem.details.relativePath ?? 'workspace file')}</span>
                                </div>
                                <div className="review-card-draft-actions">
                                  {hasUnsavedDraftChanges ? (
                                    <span className="review-card-draft-status">Edited locally</span>
                                  ) : null}
                                  <ActionButton
                                    size="compact"
                                    tone="quiet"
                                    onClick={() => void saveReviewDraft(reviewItem)}
                                    leadingIcon={<SaveIcon />}
                                    disabled={!hasUnsavedDraftChanges || reviewDraftSavingId === reviewItem.id}
                                  >
                                    {reviewDraftSavingId === reviewItem.id ? 'Saving...' : 'Save draft changes'}
                                  </ActionButton>
                                </div>
                              </div>
                              <TextArea
                                rows={8}
                                className="workspace-bootstrap-editor review-card-editor"
                                value={draftContent}
                                onChange={(event) =>
                                  setReviewDraftEdits((current) => ({
                                    ...current,
                                    [reviewItem.id]: event.target.value
                                  }))
                                }
                              />
                            </SurfaceCard>
                          ) : null}
                          <div className="automation-actions">
                            <ActionButton onClick={() => void rejectReview(reviewItem.id)} leadingIcon={<CloseIcon />}>
                              Reject
                            </ActionButton>
                            <PrimaryButton
                              onClick={() => void approveReview(reviewItem.id)}
                              leadingIcon={<PlayIcon />}
                              disabled={hasUnsavedDraftChanges}
                            >
                              {presentation.isManualWrite
                                ? 'Approve and write'
                                : 'Approve and run'}
                            </PrimaryButton>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                ) : null}
                {automations.map((automation) => (
                  <article key={automation.id} className="automation-card">
                    <div className="skill-card-top">
                      <div>
                        <h3>{automation.name}</h3>
                        <p>{automation.promptTemplate}</p>
                      </div>
                      <StatusPill tone={automation.enabled ? 'connected' : 'disconnected'}>{automation.enabled ? 'enabled' : 'disabled'}</StatusPill>
                    </div>
                    <div className="skill-meta">
                      <span>{selectedProject?.id === automation.projectId ? selectedProject.name : automation.projectId}</span>
                      <span>{automation.providerId}</span>
                      <span>{automation.modelId}</span>
                      {automation.skillId ? (
                        <span>{skills.find((skill) => skill.id === automation.skillId)?.name ?? 'Attached skill'}</span>
                      ) : null}
                      <span>{formatAutomationSchedule(automation)}</span>
                      <span>{`Last ${formatTime(automation.lastRunAt)}`}</span>
                      {automation.scheduleType === 'interval_while_app_open' ? (
                        <span>{`Next ${formatTime(automation.nextRunAt)}`}</span>
                      ) : null}
                    </div>
                    <div className="automation-actions">
                      <ActionButton onClick={() => void toggleAutomation(automation.id, !automation.enabled)} leadingIcon={automation.enabled ? <CloseIcon /> : <CheckIcon />}>
                        {automation.enabled ? 'Disable' : 'Enable'}
                      </ActionButton>
                      <ActionButton onClick={() => editAutomation(automation)} leadingIcon={<EditIcon />}>
                        Edit
                      </ActionButton>
                      <ActionButton onClick={() => void openAutomationHistory(automation.id)} leadingIcon={<TaskIcon />}>
                        History
                      </ActionButton>
                      <PrimaryButton onClick={() => void runAutomation(automation.id)} leadingIcon={<PlayIcon />}>Run now</PrimaryButton>
                      <DangerButton onClick={() => setAutomationDeleteId(automation.id)} leadingIcon={<TrashIcon />}>
                        Delete
                      </DangerButton>
                    </div>
                  </article>
                ))}
                      </section>
                    </>
                  )}
                </section>
              </div>
            </div>
          </section>
        ) : null}
      </main>
      </div>

      <ModalDialog
        open={buildPlanDialogOpen}
        onOpenChange={(open) => {
          if (!open) {
            closeBuildPlanDialog();
            return;
          }
          setBuildPlanDialogOpen(true);
        }}
        title="Start build plan"
        description="Launch a dedicated setup thread. That thread will ask clarifying questions if needed, then shape the planner, builder, and finisher flow."
        className="automation-editor-dialog build-plan-launch-dialog"
        actions={
          <>
            <ActionButton tone="quiet" onClick={closeBuildPlanDialog}>
              Cancel
            </ActionButton>
            <PrimaryButton
              onClick={() => void launchBuildPlanSetupThread()}
              leadingIcon={<PlayIcon />}
              disabled={vicodeBuildBusyAction === 'launch-plan'}
            >
              {vicodeBuildBusyAction === 'launch-plan' ? 'Starting...' : 'Start setup thread'}
            </PrimaryButton>
          </>
        }
      >
        <div className="automation-editor-form">
          <label className="settings-field">
            <span>Goal</span>
          <TextArea
            rows={7}
            value={buildPlanLaunch.goal}
            onChange={(event) =>
              setBuildPlanLaunch((current) => ({
                ...current,
                goal: event.target.value
              }))
            }
            placeholder="Describe what you want this build plan to accomplish. The setup thread will turn this into a concrete planner, builder, and finisher workflow."
          />
          </label>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="settings-field">
              <span>Setup provider</span>
              <Menu>
                <MenuTrigger asChild>
                  <MenuButton
                    className="h-10 w-full rounded-[var(--ui-radius-lg)] px-3 text-left"
                    trailingIcon={<ChevronDownIcon />}
                  >
                    {buildPlanLaunchProvider
                      ? `${providerDisplayName(buildPlanLaunch.providerId)} / ${providerModelTriggerSummary(buildPlanLaunchProvider, buildPlanLaunchModelOptions.find((model) => model.id === buildPlanLaunch.modelId)?.label ?? null)}`
                      : providerDisplayName(buildPlanLaunch.providerId)}
                  </MenuButton>
                </MenuTrigger>
                <MenuContent className="composer-menu composer-model-menu build-plan-menu" align="start">
                  {visibleProviders.map((provider) => (
                    <MenuSub key={provider.id}>
                      <MenuSubTrigger className={cx(buildPlanLaunch.providerId === provider.id ? 'is-selected bg-white/[0.06] text-white' : '', 'rounded-xl')}>
                        <MenuItemLabel>{providerDisplayName(provider.id)}</MenuItemLabel>
                        <span>{providerModelTriggerSummary(provider, provider.models.find((model) => model.id === buildPlanLaunch.modelId)?.label ?? null)}</span>
                      </MenuSubTrigger>
                      <MenuSubContent className="composer-menu composer-submenu composer-model-menu build-plan-menu">
                        {provider.models.length > 0 ? (
                          provider.models.map((model) => {
                            const selected = buildPlanLaunch.providerId === provider.id && buildPlanLaunch.modelId === model.id;
                            const recommendationLabel = providerModelRecommendationLabel(model.recommendation);
                            return (
                              <MenuCheckboxItem
                                key={`${provider.id}:${model.id}`}
                                className={cx(selected ? 'is-selected bg-white/[0.06] text-white' : '', 'rounded-xl')}
                                checked={selected}
                                onCheckedChange={() => {
                                  setBuildPlanLaunch((current) => ({
                                    ...current,
                                    providerId: provider.id,
                                    modelId: model.id,
                                    reasoningEffort:
                                      current.providerId === provider.id
                                        ? current.reasoningEffort
                                        : getProviderMetadata(provider.id).defaultReasoningEffort
                                  }));
                                }}
                              >
                                <MenuItemLabel>
                                  <span className="flex items-center gap-2">
                                    <span>{model.label}</span>
                                    {recommendationLabel ? (
                                      <span className={cx('inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.12em]', modelBadgeClassName(recommendationLabel))}>
                                        {recommendationLabel}
                                      </span>
                                    ) : null}
                                  </span>
                                </MenuItemLabel>
                                {selected ? <CheckIcon /> : null}
                              </MenuCheckboxItem>
                            );
                          })
                        ) : (
                          <MenuItem onSelect={(event) => event.preventDefault()} className="rounded-xl">
                            <MenuItemLabel>No models available</MenuItemLabel>
                          </MenuItem>
                        )}
                      </MenuSubContent>
                    </MenuSub>
                  ))}
                </MenuContent>
              </Menu>
            </label>
            <label className="settings-field">
              <span>Setup model</span>
              <Menu>
                <MenuTrigger asChild>
                  <MenuButton
                    className="h-10 w-full rounded-[var(--ui-radius-lg)] px-3 text-left"
                    trailingIcon={<ChevronDownIcon />}
                  >
                    {buildPlanLaunchModelOptions.find((model) => model.id === buildPlanLaunch.modelId)?.label ?? 'Select model'}
                  </MenuButton>
                </MenuTrigger>
                <MenuContent className="composer-menu composer-model-menu build-plan-menu" align="start">
                  {buildPlanLaunchModelOptions.map((model) => {
                    const selected = buildPlanLaunch.modelId === model.id;
                    const recommendationLabel = providerModelRecommendationLabel(model.recommendation);
                    return (
                      <MenuCheckboxItem
                        key={model.id}
                        className={cx(selected ? 'is-selected bg-white/[0.06] text-white' : '', 'rounded-xl')}
                        checked={selected}
                        onCheckedChange={() =>
                          setBuildPlanLaunch((current) => ({
                            ...current,
                            modelId: model.id
                          }))
                        }
                      >
                        <MenuItemLabel>
                          <span className="flex items-center gap-2">
                            <span>{model.label}</span>
                            {recommendationLabel ? (
                              <span className={cx('inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.12em]', modelBadgeClassName(recommendationLabel))}>
                                {recommendationLabel}
                              </span>
                            ) : null}
                          </span>
                        </MenuItemLabel>
                        {selected ? <CheckIcon /> : null}
                      </MenuCheckboxItem>
                    );
                  })}
                </MenuContent>
              </Menu>
            </label>
          </div>
          {buildPlanLaunch.providerId === 'openai' ? (
            <label className="settings-field">
              <span>Reasoning level</span>
              <Menu>
                <MenuTrigger asChild>
                  <MenuButton
                    className="h-10 w-full rounded-[var(--ui-radius-lg)] px-3 text-left md:w-[220px]"
                    trailingIcon={<ChevronDownIcon />}
                  >
                    {buildPlanReasoningLabel(buildPlanLaunch.reasoningEffort)}
                  </MenuButton>
                </MenuTrigger>
                <MenuContent className="composer-menu composer-submenu build-plan-menu" align="start">
                  {(['low', 'medium', 'high', 'xhigh'] as const).map((candidate) => {
                    const selected = buildPlanLaunch.reasoningEffort === candidate;
                    return (
                      <MenuCheckboxItem
                        key={candidate}
                        className={cx(selected ? 'is-selected bg-white/[0.06] text-white' : '', 'rounded-xl')}
                        checked={selected}
                        onCheckedChange={() =>
                          setBuildPlanLaunch((current) => ({
                            ...current,
                            reasoningEffort: candidate
                          }))
                        }
                      >
                        <MenuItemLabel>{buildPlanReasoningLabel(candidate)}</MenuItemLabel>
                        {selected ? <CheckIcon /> : null}
                      </MenuCheckboxItem>
                    );
                  })}
                </MenuContent>
              </Menu>
            </label>
          ) : null}
          <p className="text-sm text-[color:var(--ui-text-muted)]">
            Use the current workspace provider if you want the build-plan conversation to match the rest of the thread flow. The actual planning conversation happens in the setup thread, not in this modal.
          </p>
        </div>
      </ModalDialog>

      <ModalDialog
        open={automationEditorOpen}
        onOpenChange={(open) => {
          if (!open) {
            closeAutomationEditor();
            return;
          }
          setAutomationEditorOpen(true);
        }}
        title={automationDraft.id ? 'Edit automation' : 'Create automation'}
        description="Saved workflows queue reviewed agent runs for the current project."
        className="automation-editor-dialog"
        actions={
          <>
            <ActionButton tone="quiet" onClick={closeAutomationEditor}>
              Cancel
            </ActionButton>
            <PrimaryButton onClick={() => void createAutomation()} leadingIcon={<TaskIcon />}>
              {automationDraft.id ? 'Update automation' : 'Save automation'}
            </PrimaryButton>
          </>
        }
      >
        <div className="automation-editor-form">
          <TextInput
            placeholder="Name"
            value={automationDraft.name}
            onChange={(event) => setAutomationDraft((current) => ({ ...current, name: event.target.value }))}
          />
          <div className="automation-readonly-meta">
            <span className="automation-readonly-label">Project</span>
            <strong>{selectedProject?.name ?? 'Select a project first'}</strong>
          </div>
          <SelectField
            value={automationDraft.providerId}
            onChange={(event) => {
              const nextProviderId = event.target.value as ProviderId;
              setAutomationDraft((current) => ({
                ...current,
                providerId: nextProviderId,
                modelId: resolveProviderModelId(visibleProviders, nextProviderId, current.modelId),
                skillId: ''
              }));
            }}
          >
            {visibleProviders.map((provider) => (
              <option key={provider.id} value={provider.id}>
                {provider.label}
              </option>
            ))}
          </SelectField>
          <SelectField
            value={automationDraft.modelId}
            onChange={(event) => setAutomationDraft((current) => ({ ...current, modelId: event.target.value }))}
          >
            {automationModelOptions.map((model) => (
              <option key={model.id} value={model.id}>
                {model.label}
              </option>
            ))}
          </SelectField>
          <SelectField
            value={automationDraft.skillId}
            onChange={(event) => setAutomationDraft((current) => ({ ...current, skillId: event.target.value }))}
          >
            <option value="">No skill attached</option>
            {availableAutomationSkills.map((skill) => (
              <option key={skill.id} value={skill.id}>
                {skill.name}
              </option>
            ))}
          </SelectField>
          <SelectField
            value={automationDraft.scheduleType}
            onChange={(event) =>
              setAutomationDraft((current) => ({
                ...current,
                scheduleType: event.target.value as 'manual' | 'interval_while_app_open'
              }))
            }
          >
            <option value="manual">Manual</option>
            <option value="interval_while_app_open">While app is open</option>
          </SelectField>
          {automationDraft.scheduleType === 'interval_while_app_open' ? (
            <TextInput
              placeholder="Interval minutes"
              value={automationDraft.intervalMinutes}
              onChange={(event) => setAutomationDraft((current) => ({ ...current, intervalMinutes: event.target.value }))}
            />
          ) : null}
          <TextArea
            className="tall"
            placeholder="Describe what this automation should do when it runs."
            value={automationDraft.promptTemplate}
            onChange={(event) =>
              setAutomationDraft((current) => ({ ...current, promptTemplate: event.target.value }))
            }
          />
          <p className="automation-form-note">Automation runs enter the review queue before execution.</p>
        </div>
      </ModalDialog>

      <ModalDialog
        open={Boolean(automationHistoryId)}
        onOpenChange={(open) => {
          if (!open) {
            setAutomationHistoryId(null);
            setAutomationHistoryRuns([]);
            setAutomationHistoryLoading(false);
          }
        }}
        title={automationHistoryTarget ? `${automationHistoryTarget.name} history` : 'Automation history'}
        description="Recent review and execution events for this automation."
        className="automation-history-dialog"
      >
        <div className="automation-history-list">
          {automationHistoryLoading ? (
            <SurfaceCard className="automation-history-empty">
              <p>Loading history...</p>
            </SurfaceCard>
          ) : automationHistoryRuns.length === 0 ? (
            <SurfaceCard className="automation-history-empty">
              <p>No runs recorded yet.</p>
            </SurfaceCard>
          ) : (
            automationHistoryRuns.map((run) => (
              <SurfaceCard key={run.id} className="automation-history-item">
                <div className="automation-history-item-top">
                  <StatusPill tone={
                    run.status === 'completed'
                      ? 'connected'
                      : run.status === 'running' || run.status === 'waiting_for_review'
                        ? 'warning'
                        : run.status === 'failed'
                          ? 'disconnected'
                          : 'default'
                  }>
                    {run.status.replaceAll('_', ' ')}
                  </StatusPill>
                  <span>{formatTime(run.createdAt)}</span>
                </div>
                <p>{run.message}</p>
                {run.threadId ? (
                  <ActionButton size="compact" tone="quiet" onClick={() => void openThread(run.threadId!)}>
                    Open thread
                  </ActionButton>
                ) : null}
              </SurfaceCard>
            ))
          )}
        </div>
      </ModalDialog>
      <ModalDialog
        open={workspaceBootstrapModalOpen}
        onOpenChange={(open) => {
          setWorkspaceBootstrapModalOpen(open);
          if (!open) {
            setWorkspaceBootstrapDraftBundle(null);
            setWorkspaceBootstrapSelectedDraftPaths([]);
            setWorkspaceBootstrapActiveDraftPath(null);
          }
        }}
        title="Vicode will set up workspace files"
        description="Vicode automatically drafts project instructions and memory files for this trusted project workspace. You can review and edit them before saving, but that is optional."
        className="workspace-bootstrap-dialog"
        actions={
          <>
            <ActionButton
              tone="quiet"
              onClick={() => {
                setWorkspaceBootstrapModalOpen(false);
                setWorkspaceBootstrapDraftBundle(null);
              }}
            >
              Cancel
            </ActionButton>
            {workspaceBootstrapDraftBundle ? (
              <PrimaryButton onClick={() => void writeWorkspaceBootstrapDrafts()} disabled={workspaceBootstrapBusy} data-testid="workspace-bootstrap-write">
                Save selected files
              </PrimaryButton>
            ) : (
              <PrimaryButton onClick={() => void generateWorkspaceBootstrapDrafts()} disabled={workspaceBootstrapBusy} data-testid="workspace-bootstrap-generate">
                Draft files for me
              </PrimaryButton>
            )}
          </>
        }
      >
        <div className="workspace-bootstrap-body" data-testid="workspace-bootstrap-dialog">
          <div className="workspace-bootstrap-summary">
            <strong>{selectedProject?.name ?? 'No project selected'}</strong>
            <p>{workspaceBootstrapStatus?.reason ?? workspaceBootstrapStatus?.folderPath ?? 'A trusted project workspace is required.'}</p>
            {workspaceBootstrapStatus?.missingFiles?.length ? (
              <p className="subtle-row">Missing: {workspaceBootstrapStatus.missingFiles.join(', ')}</p>
            ) : null}
          </div>
            <div className="workspace-bootstrap-summary">
              <strong>How this works</strong>
              <p>
                Vicode checks the workspace contract files first, drafts <code>AGENTS.md</code>, optional <code>SOUL.md</code>, and can also prepare curated <code>USER.md</code> and <code>MEMORY.md</code> files from your repo plus the short answers below.
                You can leave fields blank, then review and edit each draft before saving.
              </p>
            </div>

          {!workspaceBootstrapDraftBundle ? (
            <div className="workspace-bootstrap-form">
              {workspaceBootstrapQuestions.map((question) => {
                const value = question.id === 'wantsSoul'
                  ? (workspaceBootstrapIncludeSoul ? 'yes' : 'no')
                  : String((workspaceBootstrapAnswers[question.id as keyof WorkspaceBootstrapAnswers] as string | undefined) ?? '');

                if (question.id === 'wantsSoul') {
                  return (
                    <label key={question.id} className="settings-field">
                      <span>{question.prompt}</span>
                      <SelectField
                        value={value}
                        onChange={(event) => {
                          const wantsSoul = event.target.value === 'yes';
                          setWorkspaceBootstrapIncludeSoul(wantsSoul);
                          updateWorkspaceBootstrapAnswer('wantsSoul', wantsSoul);
                        }}
                      >
                        <option value="no">No</option>
                        <option value="yes">Yes</option>
                      </SelectField>
                    </label>
                  );
                }

                return (
                  <label key={question.id} className="settings-field">
                    <span>{question.prompt}</span>
                    <TextArea
                      className="workspace-bootstrap-textarea"
                      value={value}
                      onChange={(event) =>
                        updateWorkspaceBootstrapAnswer(
                          question.id as keyof WorkspaceBootstrapAnswers,
                          event.target.value
                        )
                      }
                      placeholder="Add only the durable guidance that materially changes agent behavior."
                    />
                  </label>
                );
              })}
              <label className="settings-toggle-row">
                <input
                  type="checkbox"
                  checked={workspaceBootstrapIncludeDailyNote}
                  onChange={(event) => setWorkspaceBootstrapIncludeDailyNote(event.target.checked)}
                />
                <span>Create today's daily note draft as part of bootstrap.</span>
              </label>
            </div>
          ) : (
            <div className="workspace-bootstrap-review">
              <div className="workspace-bootstrap-inspection">
                <div className="skill-meta">
                  <span>{workspaceBootstrapDraftBundle.inspection.repoStack}</span>
                  <span>{workspaceBootstrapDraftBundle.inspection.platformFocus}</span>
                  <span>{workspaceBootstrapDraftBundle.inspection.packageManager}</span>
                </div>
                <p>{workspaceBootstrapDraftBundle.inspection.repoPurpose}</p>
                <p className="subtle-row">These first drafts were generated by Vicode. Edit any file before saving it into this workspace.</p>
              </div>
              <div className="workspace-bootstrap-draft-list">
                {workspaceBootstrapDraftBundle.drafts.map((draft) => (
                  <label key={draft.relativePath} className="workspace-bootstrap-draft-item">
                    <input
                      type="checkbox"
                      checked={workspaceBootstrapSelectedDraftPaths.includes(draft.relativePath)}
                      onChange={(event) =>
                        setWorkspaceBootstrapSelectedDraftPaths((current) =>
                          event.target.checked
                            ? [...new Set([...current, draft.relativePath])]
                            : current.filter((path) => path !== draft.relativePath)
                        )
                      }
                    />
                    <ActionButton
                      tone={workspaceBootstrapActiveDraftPath === draft.relativePath ? 'default' : 'quiet'}
                      onClick={() => setWorkspaceBootstrapActiveDraftPath(draft.relativePath)}
                    >
                      {draft.fileName}
                    </ActionButton>
                  </label>
                ))}
              </div>
              {activeWorkspaceBootstrapDraft ? (
                <label className="settings-field">
                  <div className="workspace-bootstrap-editor-header">
                    <span>{activeWorkspaceBootstrapDraft.fileName}</span>
                    <ActionButton
                      size="compact"
                      tone="quiet"
                      onClick={() => void regenerateWorkspaceBootstrapDraft(activeWorkspaceBootstrapDraft.relativePath)}
                      disabled={workspaceBootstrapBusy}
                      data-testid="workspace-bootstrap-regenerate"
                    >
                      Regenerate this file
                    </ActionButton>
                  </div>
                  <TextArea
                    className="workspace-bootstrap-editor"
                    data-testid="workspace-bootstrap-editor"
                    value={activeWorkspaceBootstrapDraft.content}
                    onChange={(event) => updateWorkspaceBootstrapDraft(activeWorkspaceBootstrapDraft.relativePath, event.target.value)}
                  />
                </label>
              ) : null}
            </div>
          )}
        </div>
      </ModalDialog>

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
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        title="Delete thread permanently?"
        description={
          activeThread
            ? `Archive keeps history and hides it from active lists. Delete permanently removes "${activeThread.title}" from Vicode's local app store and cannot be undone.`
            : 'Archive keeps history and hides it from active lists. Delete permanently removes the saved thread from Vicode and cannot be undone.'
        }
        confirmLabel="Delete permanently"
        tone="danger"
        onConfirm={() => void deleteThread()}
      />
      <ConfirmDialog
        open={Boolean(automationDeleteId)}
        onOpenChange={(open) => {
          if (!open) {
            setAutomationDeleteId(null);
          }
        }}
        title="Delete automation?"
        description={
          automationDeleteTarget
            ? `Delete "${automationDeleteTarget.name}" permanently from Vicode's local automation store?`
            : 'Delete this automation permanently from Vicode\'s local automation store?'
        }
        confirmLabel="Delete automation"
        tone="danger"
        onConfirm={() => void deleteAutomation()}
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
