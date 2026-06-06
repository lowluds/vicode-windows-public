import type {
  AppEvent,
} from './events';
import type {
  AutomationDefinition,
  AutomationRun,
  AutomationSaveInput,
  BootstrapData,
  CollabAccount,
  CollabConfig,
  CollabContact,
  CollabHandoff,
  CollabMessage,
  CollabPresenceStatus,
  CollabProfile,
  CollabRoleRequest,
  CollabRoom,
  CollabRoomDetail,
  CollabRoomFollower,
  CollabRoomTerminalState,
  CollabSharedRun,
  CollabSharedThread,
  CustomProviderSettings,
  CustomProviderSettingsSaveInput,
  ExecutionPermission,
  JobDefinition,
  LibrarySourcesSnapshot,
  McpCatalogSnapshot,
  McpRecommendedSetupInput,
  McpServerSaveInput,
  McpServerView,
  Preferences,
  ProjectKnowledgeIndexStatus,
  ProjectKnowledgeSuggestedIndexDraftFile,
  ProjectKnowledgeSuggestedIndexDraft,
  ProviderDescriptor,
  ProviderId,
  ReviewItem,
  SkillDetail,
  SkillDefinition,
  SkillInstallResult,
  SkillSaveInput
} from './domain';
import type {
  CollabBootstrapPayload,
  OllamaModelMutationResult,
  OllamaRuntimeSnapshot,
  StorageDiagnostics,
  StorageMaintenanceResult
} from './ipc-bootstrap-types';

export interface FeatureDomainApi {
  providers: {
    list(): Promise<ProviderDescriptor[]>;
    startAuth(providerId: ProviderId, mode?: 'cli' | 'api_key', options?: { force?: boolean }): Promise<ProviderDescriptor>;
    adoptAuth(providerId: ProviderId): Promise<ProviderDescriptor>;
    clearAuth(providerId: ProviderId): Promise<ProviderDescriptor>;
    saveApiKey(providerId: ProviderId, apiKey: string): Promise<ProviderDescriptor>;
    refresh(providerId: ProviderId): Promise<ProviderDescriptor>;
    listCustom(): Promise<CustomProviderSettings[]>;
    saveCustom(input: CustomProviderSettingsSaveInput): Promise<CustomProviderSettings>;
    removeCustom(providerId: string): Promise<void>;
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
    installSuggested(input: {
      installKind: 'github_folder';
      providerTargets?: ProviderId[];
      token: string;
      owner?: string | null;
      repo?: string | null;
      path?: string | null;
      name?: string | null;
      description?: string | null;
      browseUrl?: string | null;
      category?: 'frontend' | 'backend' | 'engineering' | 'documents' | 'design' | 'testing' | 'automation' | 'mcp' | 'templates' | 'provider' | null;
    }): Promise<SkillInstallResult>;
    rescanLibrary(): Promise<SkillDefinition[]>;
    remove(skillId: string): Promise<void>;
  };
  library: {
    getSources(): Promise<LibrarySourcesSnapshot>;
  };
  projectKnowledge: {
    getIndexStatus(): Promise<ProjectKnowledgeIndexStatus>;
    refreshIndex(): Promise<ProjectKnowledgeIndexStatus>;
    suggestIndex(): Promise<ProjectKnowledgeSuggestedIndexDraft>;
    openSuggestedIndexDraft(): Promise<ProjectKnowledgeSuggestedIndexDraftFile>;
  };
  automations: {
    list(): Promise<AutomationDefinition[]>;
    listRuns(automationId: string): Promise<AutomationRun[]>;
    save(input: AutomationSaveInput): Promise<AutomationDefinition>;
    toggle(automationId: string, enabled: boolean): Promise<AutomationDefinition>;
    remove(automationId: string): Promise<void>;
    runNow(automationId: string): Promise<{ job: JobDefinition; reviewItem: ReviewItem; alreadyPending: boolean }>;
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
  settings: {
    get(): Promise<Preferences>;
    save(input: Partial<Preferences>): Promise<Preferences>;
  };
  diagnostics: {
    export(): Promise<string>;
    exportThread(threadId: string): Promise<string>;
    exportThreadReport(threadId: string): Promise<string>;
    getStorage(): Promise<StorageDiagnostics>;
    compactRunEvents(): Promise<StorageMaintenanceResult>;
    maintainStorage(input?: { vacuum?: boolean }): Promise<StorageMaintenanceResult>;
  };
  collab: {
    getBootstrap(): Promise<CollabBootstrapPayload>;
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
