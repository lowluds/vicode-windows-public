import type {
  AppMeta,
  AppUpdateState,
  AutomationDefinition,
  AutomationRun,
  AutomationSaveInput,
  BootstrapData,
  CollabAccount,
  CollabConfig,
  CollabContact,
  CollabHandoff,
  CollabMessage,
  CollabRoleRequest,
  CollabRoomFollower,
  CollabPresenceStatus,
  CollabProfile,
  CollabRoom,
  CollabRoomDetail,
  CollabRoomTerminalState,
  CollabSharedRun,
  CollabSharedThread,
  ComposerSubmitInput,
  ComposerSubmitResult,
  AutonomousTaskSummary,
  ExecutionPermission,
  JobDefinition,
  McpCatalogSnapshot,
  McpRecommendedSetupInput,
  McpServerSaveInput,
  McpServerView,
  PlannerAnswerInput,
  PlannerApprovePlanInput,
  PlannerCancelInput,
  PlannerSetModeInput,
  PlannerSubmitInput,
  PersonalizationSettings,
  Preferences,
  Project,
  ProjectRuntimeCommandPolicy,
  ProjectRuntimeNetworkPolicy,
  ProviderDescriptor,
  VicodeBuildLaneId,
  VicodeBuildPlanDraft,
  VicodeBuildSnapshot,
  VicodeBuildTeamId,
  VicodeBuildVerificationResult,
  ReviewItem,
  SkillInstallResult,
  SkillDetail,
  SkillDefinition,
  SkillSaveInput,
  TextAttachment,
  SubagentSpawnInput,
  SubagentSummary,
  ThreadDetail,
  ThreadFollowUp,
  ThreadSummary,
  ProviderId
} from './domain';
import type { AppEvent } from './events';

export interface WorkspaceBootstrapQuestion {
  id: string;
  prompt: string;
  targetFiles: string[];
  optional?: boolean;
}

export interface WorkspaceBootstrapStatus {
  eligible: boolean;
  reason: string | null;
  folderPath: string | null;
  existingFiles: string[];
  missingFiles: string[];
  needsBootstrap: boolean;
  dismissed: boolean;
  suggestionEligible: boolean;
}

export interface WorkspaceBootstrapAnswers {
  projectIntent?: string;
  optimizationPriority?: string;
  communicationStyle?: string;
  approvalBoundary?: string;
  repoConstraints?: string;
  wantsSoul?: boolean;
  detailLevel?: string;
  planningStyle?: string;
  deliveryStyle?: string;
  riskPosture?: string;
  testingExpectation?: string;
  dependencyPolicy?: string;
  refactorPosture?: string;
  summaryStyle?: string;
  changeStyle?: string;
  agentAssertiveness?: string;
  agentFormality?: string;
  durablePreferences?: string[];
  durableDecisions?: string[];
  todayFocus?: string;
  recentDecisions?: string[];
  openQuestions?: string[];
  followUps?: string[];
}

export type WorkspaceBootstrapFileKind = 'agents' | 'user' | 'soul' | 'memory' | 'daily_note';

export interface WorkspaceTemplateDraft {
  kind: WorkspaceBootstrapFileKind;
  fileName: string;
  relativePath: string;
  content: string;
}

export interface WorkspaceRepoInspection {
  folderPath: string;
  repoName: string;
  repoPurpose: string;
  repoStack: string;
  packageManager: string;
  installCommand: string;
  buildCommand: string | null;
  testCommand: string | null;
  lintCommand: string | null;
  platformFocus: string;
  architectureFacts: string[];
  constraints: string[];
  frameworks: string[];
  languages: string[];
}

export interface StorageDiagnostics {
  databasePath: string;
  databaseSizeBytes: number;
  walSizeBytes: number;
  shmSizeBytes: number;
  totalStorageBytes: number;
  projectCount: number;
  threadCount: number;
  archivedThreadCount: number;
  activeThreadCount: number;
  turnCount: number;
  runEventCount: number;
  compactableRunCount: number;
  compactableDeltaEventCount: number;
  compactionCutoffDays: number;
}

export interface StorageCompactionResult {
  cutoffIso: string;
  cutoffDays: number;
  runsCompacted: number;
  deltaEventsDeleted: number;
}

export interface StorageMaintenanceResult extends StorageCompactionResult {
  vacuumApplied: boolean;
  sizeBeforeBytes: number;
  sizeAfterBytes: number;
  reclaimedBytes: number;
}

export type MicrophoneAccessStatus = 'not-determined' | 'granted' | 'denied' | 'restricted' | 'unknown';

export interface NativeThemeSnapshot {
  platform: NodeJS.Platform;
  systemAccentColor: string;
}

export type AppZoomAction = 'in' | 'out' | 'reset';

export interface OllamaRuntimeSnapshot {
  installed: boolean;
  reachable: boolean;
  cliPath: string | null;
  baseUrl: string;
  models: string[];
  managedByApp: boolean;
  canManageProcess: boolean;
  canStop: boolean;
  starting: boolean;
}

export interface OllamaModelMutationResult {
  model: string;
  models: string[];
}

export interface WorkspaceBootstrapDraftBundle {
  status: WorkspaceBootstrapStatus;
  inspection: WorkspaceRepoInspection;
  drafts: WorkspaceTemplateDraft[];
}

export interface ThreadCollaborationSummary {
  lastPromptSummary: string | null;
  latestAssistantSummary: string | null;
  handoffSummary: string | null;
  recommendedNextPrompt: string | null;
}

export interface VicodeApi {
  app: {
    getBootstrap(): Promise<BootstrapData>;
    pickFolder(): Promise<string | null>;
    openExternal(url: string): Promise<void>;
    revealPath(path: string): Promise<void>;
    getMeta(): Promise<AppMeta>;
    getNativeTheme(): Promise<NativeThemeSnapshot>;
    adjustZoom(action: AppZoomAction): Promise<number>;
  };
  updates: {
    getState(): Promise<AppUpdateState>;
    checkForUpdates(): Promise<AppUpdateState>;
    restartToUpdate(): Promise<void>;
  };
  voice: {
    getMicrophoneAccessStatus(): Promise<MicrophoneAccessStatus>;
    transcribe(input: { audioBase64: string; mimeType: string; fileName?: string | null }): Promise<{ text: string }>;
  };
  projects: {
    create(input: {
      name: string;
      folderPath?: string | null;
      trusted?: boolean;
      runtimeCommandPolicy?: ProjectRuntimeCommandPolicy;
      runtimeNetworkPolicy?: ProjectRuntimeNetworkPolicy;
    }): Promise<Project>;
    update(input: {
      id: string;
      name?: string;
      folderPath?: string | null;
      trusted?: boolean;
      runtimeCommandPolicy?: ProjectRuntimeCommandPolicy;
      runtimeNetworkPolicy?: ProjectRuntimeNetworkPolicy;
      defaultProviderId?: ProviderId;
      defaultModelId?: string;
    }): Promise<Project>;
    remove(projectId: string): Promise<void>;
  };
  workspaceBootstrap: {
    getStatus(projectId: string): Promise<WorkspaceBootstrapStatus>;
    getQuestionnaire(): Promise<WorkspaceBootstrapQuestion[]>;
    dismissSuggestion(projectId: string): Promise<WorkspaceBootstrapStatus>;
    createDrafts(input: {
      projectId: string;
      answers: WorkspaceBootstrapAnswers;
      includeSoul?: boolean;
      includeDailyNote?: boolean;
      overwriteExisting?: boolean;
    }): Promise<WorkspaceBootstrapDraftBundle>;
    writeDrafts(input: {
      projectId: string;
      drafts: WorkspaceTemplateDraft[];
      overwriteExisting?: boolean;
    }): Promise<string[]>;
  };
  memoryWrites: {
    createDailyNoteReview(threadId: string): Promise<{ job: JobDefinition; reviewItem: ReviewItem; alreadyPending: boolean }>;
    createMemoryPromotionReview(threadId: string): Promise<{ job: JobDefinition; reviewItem: ReviewItem; alreadyPending: boolean }>;
    createUserPreferenceReview(threadId: string): Promise<{ job: JobDefinition; reviewItem: ReviewItem; alreadyPending: boolean }>;
  };
  threads: {
    list(projectId: string): Promise<ThreadSummary[]>;
    open(threadId: string): Promise<ThreadDetail>;
    summarizeForCollaboration(threadId: string): Promise<ThreadCollaborationSummary>;
    listAutonomousTasks(threadId: string): Promise<AutonomousTaskSummary[]>;
    createFollowUp(input: { threadId: string; content: string; kind?: 'follow_up' | 'steer' }): Promise<ThreadFollowUp>;
    updateFollowUp(followUpId: string, content: string): Promise<ThreadFollowUp>;
    removeFollowUp(followUpId: string): Promise<void>;
    getDraft(threadId: string): Promise<string>;
    saveDraft(threadId: string, prompt: string): Promise<string>;
    clearDraft(threadId: string): Promise<void>;
    create(input: {
      projectId: string;
      title?: string;
      providerId: ProviderId;
      modelId: string;
      executionPermission?: ExecutionPermission;
    }): Promise<ThreadDetail>;
    rename(threadId: string, title: string): Promise<ThreadSummary>;
    setExecutionPermission(threadId: string, executionPermission: ExecutionPermission): Promise<ThreadDetail>;
    archive(threadId: string): Promise<void>;
    listArchived(projectId?: string | null): Promise<ThreadSummary[]>;
    restore(threadId: string): Promise<ThreadSummary>;
    remove(threadId: string): Promise<void>;
    duplicate(threadId: string, fromTurnId?: string | null): Promise<ThreadDetail>;
    retry(threadId: string): Promise<{ runId: string }>;
  };
  composer: {
    submit(input: ComposerSubmitInput): Promise<ComposerSubmitResult>;
    createTextAttachment(input: {
      projectId: string;
      content: string;
      fileName?: string | null;
    }): Promise<TextAttachment>;
    deleteTextAttachment(input: {
      projectId: string;
      attachment: TextAttachment;
    }): Promise<void>;
    enhancePrompt(input: {
      prompt: string;
      projectId?: string | null;
      providerId: ProviderId;
      modelId: string;
      reasoningEffort?: 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'none' | null;
      thinkingEnabled?: boolean;
    }): Promise<{ prompt: string }>;
    stop(runId: string): Promise<void>;
  };
  runs: {
    approveToolApproval(approvalId: string): Promise<void>;
    rejectToolApproval(approvalId: string): Promise<void>;
  };
  subagents: {
    list(threadId: string): Promise<SubagentSummary[]>;
    spawn(input: SubagentSpawnInput): Promise<SubagentSummary>;
    cancel(subagentId: string): Promise<SubagentSummary>;
    getDetail(subagentId: string): Promise<SubagentSummary>;
  };
  planner: {
    setMode(input: PlannerSetModeInput): Promise<ThreadDetail>;
    submit(input: PlannerSubmitInput): Promise<{ thread: ThreadDetail; runId: string }>;
    answer(input: PlannerAnswerInput): Promise<{ thread: ThreadDetail; runId: string }>;
    approvePlan(input: PlannerApprovePlanInput): Promise<{ thread: ThreadDetail; runId: string }>;
    cancel(input: PlannerCancelInput): Promise<ThreadDetail>;
  };
  providers: {
    list(): Promise<ProviderDescriptor[]>;
    startAuth(providerId: ProviderId, mode?: 'cli' | 'api_key', options?: { force?: boolean }): Promise<ProviderDescriptor>;
    adoptAuth(providerId: ProviderId): Promise<ProviderDescriptor>;
    clearAuth(providerId: ProviderId): Promise<ProviderDescriptor>;
    saveApiKey(providerId: ProviderId, apiKey: string): Promise<ProviderDescriptor>;
    refresh(providerId: ProviderId): Promise<ProviderDescriptor>;
  };
  ollamaRuntime: {
    getStatus(): Promise<OllamaRuntimeSnapshot>;
    start(): Promise<OllamaRuntimeSnapshot>;
    stop(): Promise<OllamaRuntimeSnapshot>;
    listModels(): Promise<string[]>;
    pullModel(model: string): Promise<OllamaModelMutationResult>;
    deleteModel(model: string): Promise<OllamaModelMutationResult>;
  };
  skills: {
    list(): Promise<SkillDefinition[]>;
    detail(skillId: string): Promise<SkillDetail>;
    save(input: SkillSaveInput): Promise<SkillDefinition>;
    toggle(skillId: string, enabled: boolean): Promise<SkillDefinition>;
    sync(skillId: string, providerId: ProviderId, enabled: boolean): Promise<SkillDefinition>;
    installSuggested(input: {
      installKind: 'provider_native' | 'github_folder';
      providerId?: ProviderId | null;
      providerTargets?: ProviderId[];
      token: string;
      installTarget?: string | null;
      owner?: string | null;
      repo?: string | null;
      path?: string | null;
      name?: string | null;
      description?: string | null;
      browseUrl?: string | null;
      category?: 'frontend' | 'backend' | 'engineering' | 'documents' | 'design' | 'testing' | 'automation' | 'mcp' | 'templates' | 'provider' | null;
    }): Promise<SkillInstallResult>;
    remove(skillId: string): Promise<void>;
  };
  automations: {
    list(): Promise<AutomationDefinition[]>;
    listRuns(automationId: string): Promise<AutomationRun[]>;
    save(input: AutomationSaveInput): Promise<AutomationDefinition>;
    toggle(automationId: string, enabled: boolean): Promise<AutomationDefinition>;
    remove(automationId: string): Promise<void>;
    runNow(automationId: string): Promise<{ job: JobDefinition; reviewItem: ReviewItem; alreadyPending: boolean }>;
  };
  vicodeBuild: {
    getSnapshot(projectId: string | null): Promise<VicodeBuildSnapshot>;
    generatePlanDraft(input: { projectId: string; goal: string }): Promise<VicodeBuildPlanDraft>;
    createPlan(input: { projectId: string; goal: string; name?: string; worktreePath?: string }): Promise<VicodeBuildSnapshot>;
    createPlanFromThread(threadId: string): Promise<VicodeBuildSnapshot>;
    setTeamPaused(input: { projectId: string; teamId: VicodeBuildTeamId; paused: boolean }): Promise<VicodeBuildSnapshot>;
    wakeLane(input: { projectId: string; teamId: VicodeBuildTeamId; laneId: VicodeBuildLaneId }): Promise<VicodeBuildSnapshot>;
    retryLane(input: { projectId: string; teamId: VicodeBuildTeamId; laneId: VicodeBuildLaneId }): Promise<VicodeBuildSnapshot>;
    clearInactivePlans(projectId: string): Promise<VicodeBuildSnapshot>;
    runVerification(projectId: string): Promise<VicodeBuildVerificationResult>;
  };
  jobs: {
    list(): Promise<JobDefinition[]>;
    listPendingReviews(): Promise<ReviewItem[]>;
    updateReviewDraft(reviewItemId: string, content: string): Promise<ReviewItem>;
    approveReview(reviewItemId: string): Promise<{ job: JobDefinition; reviewItem: ReviewItem; runId: string | null; threadId: string | null }>;
    rejectReview(reviewItemId: string): Promise<{ job: JobDefinition; reviewItem: ReviewItem }>;
  };
  mcp: {
    syncImports(): Promise<void>;
    listServers(): Promise<McpServerView[]>;
    listCatalog(): Promise<McpCatalogSnapshot>;
    saveServer(input: McpServerSaveInput): Promise<McpServerView>;
    setupRecommended(input: McpRecommendedSetupInput): Promise<McpServerView>;
    refreshServer(serverId: string): Promise<McpServerView>;
    approveLaunch(serverId: string): Promise<McpServerView>;
    setEnabled(serverId: string, enabled: boolean): Promise<McpServerView>;
    removeServer(serverId: string): Promise<void>;
  };
  subagents: {
    list(threadId: string): Promise<SubagentSummary[]>;
    spawn(input: SubagentSpawnInput): Promise<SubagentSummary>;
    cancel(subagentId: string): Promise<SubagentSummary>;
    getDetail(subagentId: string): Promise<SubagentSummary>;
  };
  settings: {
    get(): Promise<Preferences>;
    save(input: Partial<Preferences>): Promise<Preferences>;
    getPersonalization(): Promise<PersonalizationSettings>;
    savePersonalization(input: Partial<PersonalizationSettings>): Promise<PersonalizationSettings>;
  };
  diagnostics: {
    export(): Promise<string>;
    exportThread(threadId: string): Promise<string>;
    getStorage(): Promise<StorageDiagnostics>;
    compactRunEvents(): Promise<StorageMaintenanceResult>;
    maintainStorage(input?: { vacuum?: boolean }): Promise<StorageMaintenanceResult>;
  };
  collab: {
    getBootstrap(): Promise<BootstrapData['collaboration']>;
    configure(input: { supabaseUrl: string; supabaseAnonKey: string }): Promise<CollabConfig>;
    clearConfig(): Promise<CollabConfig>;
    createGuestProfile(input: {
      displayName: string;
      handle?: string | null;
      avatarUrl?: string | null;
    }): Promise<CollabProfile>;
    clearIdentity(): Promise<CollabAccount>;
    updateProfile(input: {
      displayName?: string;
      handle?: string | null;
      avatarUrl?: string | null;
      bio?: string | null;
      timezone?: string | null;
      status?: CollabPresenceStatus;
    }): Promise<CollabProfile>;
    createRoom(input: { name: string; password?: string | null; topic?: string | null; projectLabel?: string | null }): Promise<CollabRoom>;
    joinRoom(input: { joinCode: string; password?: string | null }): Promise<CollabRoom>;
    createDirectChat(input: { peerUserId: string }): Promise<CollabRoom>;
    listRooms(): Promise<CollabRoom[]>;
    openRoom(roomId: string): Promise<CollabRoomDetail>;
    listChats(): Promise<CollabRoom[]>;
    openChat(chatId: string): Promise<CollabRoomDetail>;
    listContacts(): Promise<CollabContact[]>;
    setFollowing(input: { roomId: string; following: boolean }): Promise<CollabRoomFollower[]>;
    requestRole(input: { roomId: string; requestedRole: 'contributor' | 'driver' }): Promise<CollabRoleRequest>;
    resolveRoleRequest(input: { roomId: string; requestId: string; status: 'approved' | 'declined' }): Promise<CollabRoleRequest>;
    setTerminalMode(input: { roomId: string; mode: 'off' | 'announce_only'; note?: string | null }): Promise<CollabRoomTerminalState | null>;
    sendMessage(input: { roomId: string; body: string }): Promise<CollabMessage>;
    setPresence(input: {
      roomId: string;
      status: CollabPresenceStatus;
      currentThreadId?: string | null;
      currentThreadTitle?: string | null;
      branchName?: string | null;
      worktreeName?: string | null;
      activeRunId?: string | null;
      activeRunTitle?: string | null;
      dirtyFileCount?: number;
      stagedFileCount?: number;
    }): Promise<void>;
    shareThread(input: {
      roomId: string;
      threadId: string;
      title: string;
      projectId?: string | null;
      projectLabel?: string | null;
      status?: 'idle' | 'active' | 'completed' | 'failed';
      providerId: ProviderId;
      modelId: string;
      lastPromptSummary?: string | null;
      latestAssistantSummary?: string | null;
      runId?: string | null;
    }): Promise<CollabSharedThread>;
    shareRun(input: {
      roomId: string;
      threadId: string;
      threadTitle: string;
      runId: string;
      providerId: ProviderId;
      modelId: string;
      executionPermission: ExecutionPermission;
      status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
      taskTitle?: string | null;
      summary?: string | null;
      changedFiles?: string[];
      diffStats?: { filesChanged: number; insertions: number; deletions: number } | null;
      testsSummary?: string | null;
      resultLabel?: string | null;
      completedAt?: string | null;
    }): Promise<CollabSharedRun>;
    createHandoff(input: {
      roomId: string;
      threadId: string;
      runId?: string | null;
      title: string;
      summary: string;
      branchName?: string | null;
      dirtyFileCount?: number;
      stagedFileCount?: number;
      changedFiles?: string[];
      outstandingTasks?: string[];
      recommendedNextPrompt?: string | null;
    }): Promise<CollabHandoff>;
  };
  events: {
    subscribe(listener: (event: AppEvent) => void): () => void;
  };
}

declare global {
  interface Window {
    vicode: VicodeApi;
  }
}
