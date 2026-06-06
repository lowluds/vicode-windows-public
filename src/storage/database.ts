import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import {
  mapCollabProfile,
  mapCollabRoom,
  mapCollabRoomMember,
  mapCollabInvite,
  mapCollabMessage,
  mapCollabPresence,
  mapCollabSharedThread,
  mapCollabSharedRun,
  mapCollabHandoff,
  mapCollabRoomFollower,
  mapCollabRoleRequest,
  mapCollabRoomTerminalState
} from './database-collab-mappers';
import {
  mapProject,
  mapGeneratedMemoryCandidate,
  mapGeneratedMemoryItem,
  mapGeneratedMemoryEvidence,
  mapThreadSummary,
  mapTurn,
  mapRunEvent,
  mapThreadFollowUp,
  mapSubagent,
  mapAutonomousTask,
  mapPlannerQuestionSet,
  mapPlannerPlan,
  mapProviderAccount,
  mapProviderModel,
  mapCustomProvider,
  mapSkill,
  mapAutomation,
  mapJob,
  mapJobRun,
  mapReviewItem,
  mapMcpServerRecord
} from './database-mappers';
import {
  runDatabaseMigrations,
  runPostSeedDatabaseBackfills
} from './database-migrations';
import { ensureDatabaseSchema } from './database-schema';
import { builtInSkillSeeds } from '../shared/builtInSkills';
import { normalizeDisplayText } from '../shared/display-text';
import type { StorageCompactionResult, StorageDiagnostics, StorageMaintenanceResult } from '../shared/ipc';
import { pickNextSubagentName } from '../shared/subagents';
import { AutomationRepository } from './automation-repository';
import { AutonomousTaskRepository } from './autonomous-task-repository';
import { BootstrapRepository } from './bootstrap-repository';
import { CollabIdentityRepository } from './collab-identity-repository';
import { CollabRoomCacheRepository } from './collab-room-cache-repository';
import { CollabSharedCacheRepository } from './collab-shared-cache-repository';
import { CustomProviderRepository } from './custom-provider-repository';
import { GeneratedMemoryRepository } from './generated-memory-repository';
import { JobsReviewRepository } from './jobs-review-repository';
import { McpServerRepository } from './mcp-server-repository';
import { PlannerStateRepository } from './planner-state-repository';
import {
  ProjectKnowledgeIndexRepository,
  type ProjectKnowledgeReplaceRootIndexInput
} from './project-knowledge-index-repository';
import { ProviderStateRepository } from './provider-state-repository';
import { DEFAULT_PREFERENCES, SettingsRepository } from './settings-repository';
import { SkillsRepository } from './skills-repository';
import {
  compactOldTerminalRunEvents,
  getStorageDiagnostics,
  maintainStorage
} from './storage-maintenance';
import {
  DEFAULT_COLLAB_ACCOUNT,
  DEFAULT_COLLAB_CONFIG,
  DEFAULT_PROJECT_RUNTIME_COMMAND_POLICY,
  DEFAULT_PROJECT_RUNTIME_NETWORK_POLICY
} from './storage-defaults';
import { ThreadCompactionRepository, type ThreadCompactionCreateInput } from './thread-compaction-repository';
import { ThreadRepository } from './thread-repository';
import { WorkspaceMemoryRepository } from './workspace-memory-repository';
import type {
  AutonomousTaskRecord,
  AppearanceMode,
  AutomationDefinition,
  AutomationRun,
  AutomationSaveInput,
  CollabAccount,
  ShellBootstrapData,
  CollabBootstrap,
  CollabConfig,
  CollabContact,
  CollabHandoff,
  CollabMessage,
  CollabPresence,
  CollabProfile,
  CollabRoleRequest,
  CollabRoom,
  CollabRoomFollower,
  CollabRoomDetail,
  CollabRoomMember,
  CollabRoomSession,
  CollabRoomTerminalState,
  CollabSharedRun,
  CollabSharedThread,
  ComposerMode,
  CustomProviderDefinition,
  CustomProviderSaveInput,
  ExecutionPermission,
  GeneratedMemoryCandidate,
  GeneratedMemoryCandidateKind,
  GeneratedMemoryCandidateStatus,
  GeneratedMemoryEvidence,
  GeneratedMemoryItem,
  GeneratedMemoryItemAuthority,
  JobDefinition,
  JobRun,
  McpServerDefinition,
  McpServerRecord,
  McpServerSaveInput,
  McpServerState,
  PlannerPlan,
  PlannerPlanStatus,
  PlannerQuestionAnswer,
  PlannerQuestionSet,
  PlanTurnState,
  Preferences,
  Project,
  ProjectRuntimeCommandPolicy,
  ProjectRuntimeNetworkPolicy,
  ProviderAccount,
  ProviderId,
  ProviderModel,
  ProviderModelSource,
  ReviewItem,
  RunEvent,
  SkillDefinition,
  SkillSaveInput,
  StructuredPlannerPlan,
  SubagentSummary,
  ThreadCreateInput,
  ThreadDetail,
  ThreadFollowUp,
  ThreadFollowUpKind,
  ThreadFollowUpStatus,
  ThreadPlannerState,
  ThreadSummary,
  ThreadTurn,
} from "../shared/domain";

type Row = Record<string, unknown>;

export class DatabaseService {
  private readonly db: Database.Database;
  private readonly databasePath: string;
  private latestBootstrapDiagnostics: {
    capturedAt: string;
    durationMs: number;
    projectCount: number;
    threadGroupCount: number;
  } | null = null;
  private readonly bootstrapRepo: BootstrapRepository;
  private readonly threads: ThreadRepository;
  private readonly settings: SettingsRepository;
  private readonly skillsRepo: SkillsRepository;
  private readonly autonomousTasks: AutonomousTaskRepository;
  private readonly workspaceMemory: WorkspaceMemoryRepository;
  private readonly projectKnowledgeIndex: ProjectKnowledgeIndexRepository;
  private readonly generatedMemory: GeneratedMemoryRepository;
  private readonly plannerState: PlannerStateRepository;
  private readonly providerState: ProviderStateRepository;
  private readonly customProviders: CustomProviderRepository;
  private readonly jobsReview: JobsReviewRepository;
  private readonly automationsRepo: AutomationRepository;
  private readonly mcpServers: McpServerRepository;
  private readonly collabIdentity: CollabIdentityRepository;
  private readonly collabRoomCache: CollabRoomCacheRepository;
  private readonly collabSharedCache: CollabSharedCacheRepository;
  private readonly threadCompactions: ThreadCompactionRepository;

  constructor(databasePath: string) {
    this.databasePath = databasePath;
    mkdirSync(dirname(databasePath), { recursive: true });
    this.db = new Database(databasePath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.bootstrapRepo = new BootstrapRepository(
      () => this.listProjects(),
      (projectId) => this.listThreads(projectId),
      () => this.getPreferences()
    );
    this.settings = new SettingsRepository(this.db);
    this.skillsRepo = new SkillsRepository(
      this.db,
      (row) => mapSkill(row)
    );
    this.autonomousTasks = new AutonomousTaskRepository(
      this.db,
      (row) => mapAutonomousTask(row)
    );
    this.workspaceMemory = new WorkspaceMemoryRepository(this.db);
    this.projectKnowledgeIndex = new ProjectKnowledgeIndexRepository(this.db);
    this.generatedMemory = new GeneratedMemoryRepository(
      this.db,
      (row) => mapGeneratedMemoryCandidate(row),
      (row) => mapGeneratedMemoryItem(row),
      (row) => mapGeneratedMemoryEvidence(row)
    );
    this.plannerState = new PlannerStateRepository(
      this.db,
      (row) => this.mapThreadPlannerState(row),
      (row) => mapPlannerQuestionSet(row),
      (row) => mapPlannerPlan(row)
    );
    this.providerState = new ProviderStateRepository(
      this.db,
      (row) => mapProviderAccount(row),
      (row) => mapProviderModel(row)
    );
    this.customProviders = new CustomProviderRepository(
      this.db,
      (row) => mapCustomProvider(row)
    );
    this.jobsReview = new JobsReviewRepository(
      this.db,
      (row) => mapJob(row),
      (row) => mapJobRun(row),
      (row) => mapReviewItem(row)
    );
    this.automationsRepo = new AutomationRepository(
      this.db,
      (row) => mapAutomation(row),
      (intervalMinutes, from) => this.computeAutomationNextRunAt(intervalMinutes, from),
      (input, current, now) => this.resolveAutomationNextRunAt(input, current, now)
    );
    this.mcpServers = new McpServerRepository(
      this.db,
      (row) => mapMcpServerRecord(row)
    );
    this.collabIdentity = new CollabIdentityRepository(
      this.db,
      DEFAULT_COLLAB_CONFIG,
      DEFAULT_COLLAB_ACCOUNT,
      (row) => mapCollabProfile(row)
    );
    this.collabRoomCache = new CollabRoomCacheRepository(
      this.db,
      (row) => mapCollabRoom(row),
      (row) => mapCollabRoomMember(row),
      (row) => mapCollabInvite(row),
      (row) => mapCollabMessage(row),
      (row) => mapCollabPresence(row),
      (profile) => this.collabIdentity.upsertCollabProfile(profile)
    );
    this.collabSharedCache = new CollabSharedCacheRepository(
      this.db,
      (row) => mapCollabSharedThread(row),
      (row) => mapCollabSharedRun(row),
      (row) => mapCollabHandoff(row),
      (row) => mapCollabRoomFollower(row),
      (row) => mapCollabRoleRequest(row),
      (row) => mapCollabRoomTerminalState(row),
      (profile) => this.collabIdentity.upsertCollabProfile(profile),
      () => this.collabIdentity.getCollabAccount().userId
    );
    this.threadCompactions = new ThreadCompactionRepository(this.db);
    this.threads = new ThreadRepository(
      this.db,
      () => this.getPreferences(),
      (threadId) => this.plannerState.ensureThreadPlannerState(threadId),
      (input) => {
        this.savePreferences(input);
      },
      (row) => mapThreadSummary(row),
      (row) => mapTurn(row),
      (row) => mapRunEvent(row),
      (threadId) => this.plannerState.getThreadPlannerState(threadId),
      (threadId) => this.listThreadFollowUps(threadId)
    );
  }

  migrate() {
    ensureDatabaseSchema(this.db);

    runDatabaseMigrations(this.db, {
      preferences: DEFAULT_PREFERENCES,
      projectRuntimeCommandPolicy: DEFAULT_PROJECT_RUNTIME_COMMAND_POLICY,
      projectRuntimeNetworkPolicy: DEFAULT_PROJECT_RUNTIME_NETWORK_POLICY,
      collabConnectionState: DEFAULT_COLLAB_CONFIG.connectionState,
      nowIso: () => new Date().toISOString()
    });
    this.seedBuiltInSkills();
    runPostSeedDatabaseBackfills(this.db, {
      onLegacyWelcomeProjectsRemoved: () => {
        this.getPreferences();
      }
    });
  }

  close() {
    this.db.close();
  }

  getDatabasePath() {
    return this.databasePath;
  }

  recoverInterruptedThreads() {
    const activeThreads = this.db
      .prepare(
        `SELECT id
         FROM threads
         WHERE archived = 0
           AND status IN ('queued', 'running', 'stopping')
         ORDER BY updated_at ASC`,
      )
      .all() as Array<{ id: string }>;

    const recovered: ThreadSummary[] = [];

    for (const candidate of activeThreads) {
      const threadId = String(candidate.id);
      const detail = this.getThread(threadId);
      const latestEvent = [...detail.rawOutput].reverse()[0] ?? null;
      const nextStatus =
        latestEvent?.eventType === "completed" ||
        latestEvent?.eventType === "failed" ||
        latestEvent?.eventType === "aborted"
          ? latestEvent.eventType
          : "aborted";

      if (nextStatus === "aborted" && latestEvent?.runId) {
        this.addRunEvent(threadId, latestEvent.runId, "aborted", {
          message: "Run interrupted when the app closed.",
        });
      }

      this.updateThreadStatus(threadId, nextStatus);
      recovered.push(this.getThreadSummary(threadId));
    }

    return recovered;
  }

  getBootstrapData(): ShellBootstrapData {
    const startedAt = Date.now();
    const bootstrap = this.bootstrapRepo.getBootstrapData();
    this.latestBootstrapDiagnostics = {
      capturedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
      projectCount: bootstrap.projects.length,
      threadGroupCount: Object.keys(bootstrap.threadsByProject).length
    };
    return bootstrap;
  }

  getBootstrapDiagnostics() {
    return this.latestBootstrapDiagnostics;
  }

  getCollabBootstrap(): CollabBootstrap {
    const rooms = this.listCollabRooms();
    return {
      config: this.getCollabConfig(),
      account: this.getCollabAccount(),
      profile: this.getActiveCollabProfile(),
      rooms,
      roomMembersByRoom: Object.fromEntries(
        rooms.map((room) => [room.id, this.listCollabRoomMembers(room.id)]),
      ),
      messagesByRoom: Object.fromEntries(
        rooms.map((room) => [room.id, this.listCollabMessages(room.id)]),
      ),
      presenceByRoom: Object.fromEntries(
        rooms.map((room) => [room.id, this.listCollabPresence(room.id)]),
      ),
      sharedThreadsByRoom: Object.fromEntries(
        rooms.map((room) => [room.id, this.listCollabSharedThreads(room.id)]),
      ),
      sharedRunsByRoom: Object.fromEntries(
        rooms.map((room) => [room.id, this.listCollabSharedRuns(room.id)]),
      ),
      handoffsByRoom: Object.fromEntries(
        rooms.map((room) => [room.id, this.listCollabHandoffs(room.id)]),
      ),
      followersByRoom: Object.fromEntries(
        rooms.map((room) => [room.id, this.listCollabRoomFollowers(room.id)]),
      ),
      roleRequestsByRoom: Object.fromEntries(
        rooms.map((room) => [room.id, this.listCollabRoleRequests(room.id)]),
      ),
      terminalStateByRoom: Object.fromEntries(
        rooms.map((room) => [
          room.id,
          this.getCollabRoomTerminalState(room.id),
        ]),
      ),
      contacts: this.listCollabContacts(),
    };
  }

  getCollabConfig(): CollabConfig {
    return this.collabIdentity.getCollabConfig();
  }

  getCollabServiceConfig(): { supabaseUrl: string | null; supabaseAnonKey: string | null } {
    return this.collabIdentity.getCollabServiceConfig();
  }

  saveCollabConfig(input: { supabaseUrl: string; supabaseAnonKey: string }): CollabConfig {
    return this.collabIdentity.saveCollabConfig(input);
  }

  clearCollabConfig(): CollabConfig {
    return this.collabIdentity.clearCollabConfig();
  }

  setCollabConnectionState(connectionState: CollabConfig['connectionState'], lastError: string | null = null): CollabConfig {
    return this.collabIdentity.setCollabConnectionState(connectionState, lastError);
  }

  getCollabEncryptedSession(): string | null {
    return this.collabIdentity.getCollabEncryptedSession();
  }

  getCollabAccount(): CollabAccount {
    return this.collabIdentity.getCollabAccount();
  }

  setCollabIdentity(input: { userId: string | null; connectionState: CollabConfig['connectionState'] }): CollabAccount {
    return this.collabIdentity.setCollabIdentity(input);
  }

  saveCollabSession(input: {
    encryptedSessionJson: string | null;
    currentUserId: string | null;
    currentEmail: string | null;
    expiresAt: string | null;
    connectionState: CollabConfig["connectionState"];
  }): CollabAccount {
    return this.collabIdentity.saveCollabSession(input);
  }

  clearCollabSession() {
    this.collabIdentity.clearCollabSession();
  }

  touchCollabSync(timestamp = new Date().toISOString()) {
    this.collabIdentity.touchCollabSync(timestamp);
  }

  clearCollabCache() {
    this.collabIdentity.clearCollabCache();
  }

  clearCollabRoomCache() {
    this.collabIdentity.clearCollabRoomCache();
  }

  getActiveCollabProfile(): CollabProfile | null {
    return this.collabIdentity.getActiveCollabProfile();
  }

  getCollabProfile(userId: string): CollabProfile | null {
    return this.collabIdentity.getCollabProfile(userId);
  }

  upsertCollabRoomSession(session: CollabRoomSession): CollabRoomSession {
    return this.collabIdentity.upsertCollabRoomSession(session);
  }

  getCollabRoomSession(roomId: string, userId?: string | null): CollabRoomSession | null {
    return this.collabIdentity.getCollabRoomSession(roomId, userId);
  }

  listCollabRoomSessions(userId?: string | null): CollabRoomSession[] {
    return this.collabIdentity.listCollabRoomSessions(userId);
  }

  removeCollabRoomSession(roomId: string, userId?: string | null) {
    this.collabIdentity.removeCollabRoomSession(roomId, userId);
  }

  upsertCollabProfile(profile: CollabProfile): CollabProfile {
    return this.collabIdentity.upsertCollabProfile(profile);
  }

  listCollabRooms(type?: CollabRoom['type']): CollabRoom[] {
    return this.collabRoomCache.listCollabRooms(type);
  }

  listCollabChats(): CollabRoom[] {
    return this.listCollabRooms("dm");
  }

  getCollabRoom(roomId: string): CollabRoom {
    return this.collabRoomCache.getCollabRoom(roomId);
  }

  upsertCollabRoom(room: CollabRoom): CollabRoom {
    return this.collabRoomCache.upsertCollabRoom(room);
  }

  listCollabRoomMembers(roomId: string): CollabRoomMember[] {
    return this.collabRoomCache.listCollabRoomMembers(roomId);
  }

  replaceCollabRoomMembers(roomId: string, members: CollabRoomMember[]) {
    this.collabRoomCache.replaceCollabRoomMembers(roomId, members);
  }

  listCollabInvites(roomId: string): Array<{
    id: string;
    roomId: string;
    code: string;
    status: "active" | "redeemed" | "expired" | "revoked";
    createdBy: string;
    createdAt: string;
    expiresAt: string | null;
  }> {
    return this.collabRoomCache.listCollabInvites(roomId);
  }

  upsertCollabInvite(invite: {
    id: string;
    roomId: string;
    code: string;
    status: "active" | "redeemed" | "expired" | "revoked";
    createdBy: string;
    createdAt: string;
    expiresAt: string | null;
  }) {
    return this.collabRoomCache.upsertCollabInvite(invite);
  }

  listCollabMessages(roomId: string): CollabMessage[] {
    return this.collabRoomCache.listCollabMessages(roomId);
  }

  upsertCollabMessage(message: CollabMessage): CollabMessage {
    return this.collabRoomCache.upsertCollabMessage(message);
  }

  replaceCollabMessages(roomId: string, messages: CollabMessage[]) {
    this.collabRoomCache.replaceCollabMessages(roomId, messages);
  }

  listCollabPresence(roomId: string): CollabPresence[] {
    return this.collabRoomCache.listCollabPresence(roomId);
  }

  upsertCollabPresence(presence: CollabPresence): CollabPresence {
    return this.collabRoomCache.upsertCollabPresence(presence);
  }

  replaceCollabPresence(roomId: string, presence: CollabPresence[]) {
    this.collabRoomCache.replaceCollabPresence(roomId, presence);
  }

  listCollabSharedThreads(roomId: string): CollabSharedThread[] {
    return this.collabSharedCache.listCollabSharedThreads(roomId);
  }

  upsertCollabSharedThread(sharedThread: CollabSharedThread): CollabSharedThread {
    return this.collabSharedCache.upsertCollabSharedThread(sharedThread);
  }

  listCollabSharedRuns(roomId: string): CollabSharedRun[] {
    return this.collabSharedCache.listCollabSharedRuns(roomId);
  }

  getCollabSharedRunByRunId(runId: string): CollabSharedRun | null {
    return this.collabSharedCache.getCollabSharedRunByRunId(runId);
  }

  upsertCollabSharedRun(sharedRun: CollabSharedRun): CollabSharedRun {
    return this.collabSharedCache.upsertCollabSharedRun(sharedRun);
  }

  listCollabHandoffs(roomId: string): CollabHandoff[] {
    return this.collabSharedCache.listCollabHandoffs(roomId);
  }

  upsertCollabHandoff(handoff: CollabHandoff): CollabHandoff {
    return this.collabSharedCache.upsertCollabHandoff(handoff);
  }

  listCollabRoomFollowers(roomId: string): CollabRoomFollower[] {
    return this.collabSharedCache.listCollabRoomFollowers(roomId);
  }

  replaceCollabRoomFollowers(roomId: string, followers: CollabRoomFollower[]) {
    this.collabSharedCache.replaceCollabRoomFollowers(roomId, followers);
  }

  listCollabRoleRequests(roomId: string): CollabRoleRequest[] {
    return this.collabSharedCache.listCollabRoleRequests(roomId);
  }

  upsertCollabRoleRequest(request: CollabRoleRequest): CollabRoleRequest {
    return this.collabSharedCache.upsertCollabRoleRequest(request);
  }

  replaceCollabRoleRequests(roomId: string, requests: CollabRoleRequest[]) {
    this.collabSharedCache.replaceCollabRoleRequests(roomId, requests);
  }

  getCollabRoomTerminalState(roomId: string): CollabRoomTerminalState | null {
    return this.collabSharedCache.getCollabRoomTerminalState(roomId);
  }

  upsertCollabRoomTerminalState(state: CollabRoomTerminalState): CollabRoomTerminalState {
    return this.collabSharedCache.upsertCollabRoomTerminalState(state);
  }

  clearCollabRoomTerminalState(roomId: string) {
    this.collabSharedCache.clearCollabRoomTerminalState(roomId);
  }

  listCollabContacts(): CollabContact[] {
    return this.collabSharedCache.listCollabContacts();
  }

  getCollabRoomDetail(roomId: string): CollabRoomDetail {
    return {
      room: this.getCollabRoom(roomId),
      members: this.listCollabRoomMembers(roomId),
      messages: this.listCollabMessages(roomId),
      presence: this.listCollabPresence(roomId),
      sharedThreads: this.listCollabSharedThreads(roomId),
      sharedRuns: this.listCollabSharedRuns(roomId),
      handoffs: this.listCollabHandoffs(roomId),
      followers: this.listCollabRoomFollowers(roomId),
      roleRequests: this.listCollabRoleRequests(roomId),
      terminalState: this.getCollabRoomTerminalState(roomId),
    };
  }

  listProjects(): Project[] {
    return this.db
      .prepare("SELECT * FROM projects ORDER BY updated_at DESC")
      .all()
      .map((row) => mapProject(row as Row));
  }

  createProject(input: {
    name: string;
    folderPath?: string | null;
    trusted?: boolean;
    runtimeCommandPolicy?: ProjectRuntimeCommandPolicy;
    runtimeNetworkPolicy?: ProjectRuntimeNetworkPolicy;
  }): Project {
    const now = new Date().toISOString();
    const id = randomUUID();
    const preferences = this.getPreferences();
    this.db
      .prepare(
        `INSERT INTO projects (
          id, name, folder_path, trusted, runtime_command_policy, runtime_network_policy, default_provider_id, default_model_openai, default_model_gemini, default_model_qwen, default_model_ollama, default_model_kimi, created_at, updated_at
        ) VALUES (@id, @name, @folderPath, @trusted, @runtimeCommandPolicy, @runtimeNetworkPolicy, @defaultProviderId, @openaiModel, @geminiModel, @qwenModel, @ollamaModel, @kimiModel, @createdAt, @updatedAt)`,
      )
      .run({
        id,
        name: input.name,
        folderPath: input.folderPath ?? null,
        trusted: 1,
        runtimeCommandPolicy:
          input.runtimeCommandPolicy ?? DEFAULT_PROJECT_RUNTIME_COMMAND_POLICY,
        runtimeNetworkPolicy:
          input.runtimeNetworkPolicy ?? DEFAULT_PROJECT_RUNTIME_NETWORK_POLICY,
        defaultProviderId: preferences.defaultProviderId,
        openaiModel: preferences.defaultModelByProvider.openai,
        geminiModel: preferences.defaultModelByProvider.gemini,
        qwenModel: preferences.defaultModelByProvider.qwen,
        ollamaModel: preferences.defaultModelByProvider.ollama,
        kimiModel: preferences.defaultModelByProvider.kimi,
        createdAt: now,
        updatedAt: now,
      });

    const project = this.getProject(id);
    if (!preferences.selectedProjectId) {
      this.savePreferences({ selectedProjectId: id });
    }
    return project;
  }

  updateProject(input: {
    id: string;
    name?: string;
    folderPath?: string | null;
    trusted?: boolean;
    runtimeCommandPolicy?: ProjectRuntimeCommandPolicy;
    runtimeNetworkPolicy?: ProjectRuntimeNetworkPolicy;
    defaultProviderId?: ProviderId;
    defaultModelId?: string;
  }): Project {
    const current = this.getProject(input.id);
    const provider = input.defaultProviderId ?? current.defaultProviderId;
    const defaults = { ...current.defaultModelByProvider };
    if (input.defaultModelId) {
      defaults[provider] = input.defaultModelId;
    }
    this.db
      .prepare(
        `UPDATE projects
         SET name = @name,
             folder_path = @folderPath,
             trusted = @trusted,
             runtime_command_policy = @runtimeCommandPolicy,
             runtime_network_policy = @runtimeNetworkPolicy,
             default_provider_id = @defaultProviderId,
             default_model_openai = @openaiModel,
             default_model_gemini = @geminiModel,
             default_model_qwen = @qwenModel,
             default_model_ollama = @ollamaModel,
             default_model_kimi = @kimiModel,
             updated_at = @updatedAt
         WHERE id = @id`,
      )
      .run({
        id: current.id,
        name: input.name ?? current.name,
        folderPath:
          input.folderPath === undefined
            ? current.folderPath
            : input.folderPath,
        trusted: 1,
        runtimeCommandPolicy:
          input.runtimeCommandPolicy ?? current.runtimeCommandPolicy,
        runtimeNetworkPolicy:
          input.runtimeNetworkPolicy ?? current.runtimeNetworkPolicy,
        defaultProviderId: provider,
        openaiModel: defaults.openai,
        geminiModel: defaults.gemini,
        qwenModel: defaults.qwen,
        ollamaModel: defaults.ollama,
        kimiModel: defaults.kimi,
        updatedAt: new Date().toISOString(),
      });
    return this.getProject(current.id);
  }

  getProject(id: string): Project {
    const row = this.db
      .prepare("SELECT * FROM projects WHERE id = ?")
      .get(id) as Row | undefined;
    if (!row) {
      throw new Error(`Project not found: ${id}`);
    }
    return mapProject(row);
  }

  deleteProject(projectId: string) {
    this.getProject(projectId);
    this.db.prepare("DELETE FROM projects WHERE id = ?").run(projectId);

    const remainingProjects = this.listProjects();
    const currentPreferences = this.getPreferences();
    const nextSelectedProjectId =
      currentPreferences.selectedProjectId === projectId
        ? (remainingProjects[0]?.id ?? null)
        : currentPreferences.selectedProjectId;

    this.savePreferences({
      selectedProjectId: nextSelectedProjectId,
      lastOpenedThreadId: null,
    });
  }

  createThread(input: ThreadCreateInput): ThreadDetail {
    return this.threads.createThread(input);
  }

  listThreads(projectId: string): ThreadSummary[] {
    return this.threads.listThreads(projectId);
  }

  listArchivedThreads(projectId: string | null = null): ThreadSummary[] {
    if (projectId) {
      return this.db
        .prepare(
          `SELECT * FROM threads
           WHERE project_id = ? AND archived = 1
           ORDER BY updated_at DESC`,
        )
        .all(projectId)
        .map((row) => mapThreadSummary(row as Row));
    }

    return this.db
      .prepare(
        `SELECT * FROM threads
         WHERE archived = 1
         ORDER BY updated_at DESC`,
      )
      .all()
      .map((row) => mapThreadSummary(row as Row));
  }

  getThread(threadId: string): ThreadDetail {
    return this.threads.getThread(threadId);
  }

  listThreadFollowUps(threadId: string): ThreadFollowUp[] {
    return this.db
      .prepare(
        `SELECT * FROM thread_followups
         WHERE thread_id = ?
           AND status IN ('queued', 'dispatching')
         ORDER BY priority DESC, created_at ASC`,
      )
      .all(threadId)
      .map((row) => mapThreadFollowUp(row as Row));
  }

  createThreadFollowUp(input: {
    threadId: string;
    content: string;
    metadata?: Record<string, unknown> | null;
    kind: ThreadFollowUpKind;
    priority?: number;
    targetRunId?: string | null;
  }): ThreadFollowUp {
    this.getThreadSummary(input.threadId);
    const now = new Date().toISOString();
    const followUp: ThreadFollowUp = {
      id: randomUUID(),
      threadId: input.threadId,
      content: input.content,
      metadata: input.metadata ?? null,
      kind: input.kind,
      status: "queued",
      priority: input.priority ?? 0,
      targetRunId: input.targetRunId ?? null,
      createdAt: now,
      updatedAt: now,
      dispatchedAt: null,
      cancelledAt: null,
    };

    this.db
      .prepare(
        `INSERT INTO thread_followups (
          id, thread_id, content, metadata_json, kind, status, priority, target_run_id, created_at, updated_at, dispatched_at, cancelled_at
        ) VALUES (
          @id, @threadId, @content, @metadataJson, @kind, @status, @priority, @targetRunId, @createdAt, @updatedAt, @dispatchedAt, @cancelledAt
        )`,
      )
      .run({
        ...followUp,
        metadataJson: followUp.metadata
          ? JSON.stringify(followUp.metadata)
          : null,
      });

    return followUp;
  }

  updateThreadFollowUp(followUpId: string, content: string): ThreadFollowUp {
    const current = this.getThreadFollowUp(followUpId);
    if (current.status !== "queued") {
      throw new Error("Only queued follow-ups can be edited.");
    }

    const next: ThreadFollowUp = {
      ...current,
      content,
      updatedAt: new Date().toISOString(),
    };

    this.db
      .prepare(
        `UPDATE thread_followups
         SET content = @content,
             updated_at = @updatedAt
         WHERE id = @id`,
      )
      .run({
        id: next.id,
        content: next.content,
        updatedAt: next.updatedAt,
      });

    return this.getThreadFollowUp(followUpId);
  }

  cancelThreadFollowUp(followUpId: string): ThreadFollowUp {
    const current = this.getThreadFollowUp(followUpId);
    if (current.status !== "queued") {
      throw new Error("Only queued follow-ups can be deleted.");
    }

    const cancelledAt = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE thread_followups
         SET status = 'cancelled',
             updated_at = @updatedAt,
             cancelled_at = @cancelledAt
         WHERE id = @id`,
      )
      .run({
        id: current.id,
        updatedAt: cancelledAt,
        cancelledAt,
      });

    return this.getThreadFollowUp(followUpId);
  }

  getThreadFollowUp(followUpId: string): ThreadFollowUp {
    const row = this.db
      .prepare("SELECT * FROM thread_followups WHERE id = ?")
      .get(followUpId) as Row | undefined;
    if (!row) {
      throw new Error(`Queued follow-up not found: ${followUpId}`);
    }
    return mapThreadFollowUp(row);
  }

  claimNextThreadFollowUp(threadId: string): ThreadFollowUp | null {
    const transaction = this.db.transaction(() => {
      const row = this.db
        .prepare(
          `SELECT * FROM thread_followups
           WHERE thread_id = ?
             AND status = 'queued'
           ORDER BY priority DESC, created_at ASC
           LIMIT 1`,
        )
        .get(threadId) as Row | undefined;
      if (!row) {
        return null;
      }

      const claimedAt = new Date().toISOString();
      this.db
        .prepare(
          `UPDATE thread_followups
           SET status = 'dispatching',
               updated_at = @updatedAt
           WHERE id = @id
             AND status = 'queued'`,
        )
        .run({
          id: String(row.id),
          updatedAt: claimedAt,
        });

      const claimed = this.db
        .prepare("SELECT * FROM thread_followups WHERE id = ?")
        .get(String(row.id)) as Row | undefined;
      return claimed ? mapThreadFollowUp(claimed) : null;
    });

    return transaction();
  }

  markThreadFollowUpDispatched(followUpId: string): ThreadFollowUp {
    const current = this.getThreadFollowUp(followUpId);
    const now = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE thread_followups
         SET status = 'dispatched',
             updated_at = @updatedAt,
             dispatched_at = @dispatchedAt
         WHERE id = @id`,
      )
      .run({
        id: current.id,
        updatedAt: now,
        dispatchedAt: now,
      });
    return this.getThreadFollowUp(followUpId);
  }

  markThreadFollowUpQueued(followUpId: string): ThreadFollowUp {
    const current = this.getThreadFollowUp(followUpId);
    this.db
      .prepare(
        `UPDATE thread_followups
         SET status = 'queued',
             updated_at = @updatedAt
         WHERE id = @id`,
      )
      .run({
        id: current.id,
        updatedAt: new Date().toISOString(),
      });
    return this.getThreadFollowUp(followUpId);
  }

  markThreadFollowUpFailed(followUpId: string): ThreadFollowUp {
    const current = this.getThreadFollowUp(followUpId);
    this.db
      .prepare(
        `UPDATE thread_followups
         SET status = 'failed',
             updated_at = @updatedAt
         WHERE id = @id`,
      )
      .run({
        id: current.id,
        updatedAt: new Date().toISOString(),
      });
    return this.getThreadFollowUp(followUpId);
  }

  supersedeQueuedFollowUps(input: {
    threadId: string;
    kind?: ThreadFollowUpKind;
    targetRunId?: string | null;
    excludeId?: string | null;
  }): number {
    const clauses = [`thread_id = @threadId`, `status = 'queued'`];
    if (input.kind) {
      clauses.push(`kind = @kind`);
    }
    if (input.targetRunId !== undefined) {
      clauses.push(
        input.targetRunId === null
          ? "target_run_id IS NULL"
          : "target_run_id = @targetRunId",
      );
    }
    if (input.excludeId) {
      clauses.push("id != @excludeId");
    }

    const result = this.db
      .prepare(
        `UPDATE thread_followups
         SET status = 'superseded',
             updated_at = @updatedAt
         WHERE ${clauses.join(" AND ")}`,
      )
      .run({
        threadId: input.threadId,
        kind: input.kind,
        targetRunId: input.targetRunId,
        excludeId: input.excludeId,
        updatedAt: new Date().toISOString(),
      });
    return Number(result.changes ?? 0);
  }

  listSubagentsByParentThread(threadId: string): SubagentSummary[] {
    return this.db
      .prepare(
        `SELECT * FROM subagents
         WHERE parent_thread_id = ?
         ORDER BY created_at DESC`,
      )
      .all(threadId)
      .map((row) => mapSubagent(row as Row));
  }

  countActiveSubagentsByProvider(providerId: ProviderId) {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS count
         FROM subagents
         WHERE provider_id = ?
           AND status IN ('queued', 'running')`,
      )
      .get(providerId) as { count?: number } | undefined;
    return Number(row?.count ?? 0);
  }

  getSubagent(subagentId: string): SubagentSummary {
    const row = this.db
      .prepare("SELECT * FROM subagents WHERE id = ?")
      .get(subagentId) as Row | undefined;
    if (!row) {
      throw new Error(`Subagent not found: ${subagentId}`);
    }
    return mapSubagent(row);
  }

  getSubagentByChildThreadId(threadId: string): SubagentSummary | null {
    const row = this.db
      .prepare(
        `SELECT * FROM subagents
         WHERE child_thread_id = ?
         ORDER BY updated_at DESC
         LIMIT 1`,
      )
      .get(threadId) as Row | undefined;
    return row ? mapSubagent(row) : null;
  }

  createSubagent(input: {
    parentThreadId: string;
    parentRunId?: string | null;
    name?: string;
    title: string;
    prompt: string;
    providerId: ProviderId;
    modelId: string;
    executionPermission: ExecutionPermission;
    delegationProfile: SubagentSummary["delegationProfile"];
  }): SubagentSummary {
    this.getThreadSummary(input.parentThreadId);
    const now = new Date().toISOString();
    const subagent: SubagentSummary = {
      id: randomUUID(),
      parentThreadId: input.parentThreadId,
      parentRunId: input.parentRunId ?? null,
      childThreadId: null,
      childRunId: null,
      name:
        input.name?.trim() || this.allocateSubagentName(input.parentThreadId),
      title: input.title,
      prompt: input.prompt,
      providerId: input.providerId,
      modelId: input.modelId,
      executionPermission: input.executionPermission,
      delegationProfile: input.delegationProfile,
      status: "queued",
      outputSummary: null,
      lastError: null,
      createdAt: now,
      updatedAt: now,
      startedAt: null,
      completedAt: null,
    };

    this.db
      .prepare(
        `INSERT INTO subagents (
          id, parent_thread_id, parent_run_id, child_thread_id, child_run_id, name, title, prompt, provider_id, model_id, execution_permission, delegation_profile, status, output_summary, last_error, created_at, updated_at, started_at, completed_at
        ) VALUES (
          @id, @parentThreadId, @parentRunId, @childThreadId, @childRunId, @name, @title, @prompt, @providerId, @modelId, @executionPermission, @delegationProfile, @status, @outputSummary, @lastError, @createdAt, @updatedAt, @startedAt, @completedAt
        )`,
      )
      .run(subagent);

    return subagent;
  }

  updateSubagent(
    subagentId: string,
    input: Partial<
      Omit<SubagentSummary, "id" | "parentThreadId" | "createdAt">
    >,
  ) {
    const current = this.getSubagent(subagentId);
    const next: SubagentSummary = {
      ...current,
      ...input,
      id: current.id,
      parentThreadId: current.parentThreadId,
      createdAt: current.createdAt,
      updatedAt: new Date().toISOString(),
    };

    this.db
      .prepare(
        `UPDATE subagents
         SET parent_run_id = @parentRunId,
             child_thread_id = @childThreadId,
             child_run_id = @childRunId,
             name = @name,
             title = @title,
             prompt = @prompt,
             provider_id = @providerId,
             model_id = @modelId,
             execution_permission = @executionPermission,
             delegation_profile = @delegationProfile,
             status = @status,
             output_summary = @outputSummary,
             last_error = @lastError,
             updated_at = @updatedAt,
             started_at = @startedAt,
             completed_at = @completedAt
         WHERE id = @id`,
      )
      .run(next);

    return this.getSubagent(subagentId);
  }

  listThreadIdsWithQueuedFollowUps(): string[] {
    return this.db
      .prepare(
        `SELECT DISTINCT thread_id
         FROM thread_followups
         WHERE status = 'queued'
         ORDER BY thread_id ASC`,
      )
      .all()
      .map((row) => String((row as Row).thread_id));
  }

  getThreadDraft(threadId: string): string {
    return this.threads.getThreadDraft(threadId);
  }

  saveThreadDraft(threadId: string, prompt: string): string {
    return this.threads.saveThreadDraft(threadId, prompt);
  }

  clearThreadDraft(threadId: string) {
    this.threads.clearThreadDraft(threadId);
  }

  getThreadSummary(threadId: string): ThreadSummary {
    return this.threads.getThreadSummary(threadId);
  }

  renameThread(threadId: string, title: string): ThreadSummary {
    const normalizedTitle = normalizeDisplayText(title);
    this.db
      .prepare("UPDATE threads SET title = ?, updated_at = ? WHERE id = ?")
      .run(normalizedTitle, new Date().toISOString(), threadId);
    return this.getThreadSummary(threadId);
  }

  listAutonomousTasksForProject(projectId: string, kind?: AutonomousTaskRecord['kind']): AutonomousTaskRecord[] {
    return this.autonomousTasks.listAutonomousTasksForProject(projectId, kind);
  }

  getAutonomousTaskByKindAndSource(kind: AutonomousTaskRecord['kind'], sourceId: string): AutonomousTaskRecord | null {
    return this.autonomousTasks.getAutonomousTaskByKindAndSource(kind, sourceId);
  }

  deleteAutonomousTaskByKindAndSource(kind: AutonomousTaskRecord['kind'], sourceId: string) {
    this.autonomousTasks.deleteAutonomousTaskByKindAndSource(kind, sourceId);
  }

  upsertAutonomousTask(
    input: Omit<AutonomousTaskRecord, "createdAt" | "updatedAt"> & {
      createdAt?: string;
      updatedAt?: string;
    },
  ): AutonomousTaskRecord {
    return this.autonomousTasks.upsertAutonomousTask(input);
  }

  archiveThread(threadId: string) {
    this.db
      .prepare(
        `UPDATE threads SET archived = 1, status = 'archived', updated_at = ? WHERE id = ?`,
      )
      .run(new Date().toISOString(), threadId);
  }

  restoreThread(threadId: string): ThreadSummary {
    const current = this.getThreadSummary(threadId);
    this.db
      .prepare(
        `UPDATE threads SET archived = 0, status = ?, updated_at = ? WHERE id = ?`,
      )
      .run(
        current.status === "archived" ? "completed" : current.status,
        new Date().toISOString(),
        threadId,
      );
    return this.getThreadSummary(threadId);
  }

  deleteThread(threadId: string) {
    this.db.prepare("DELETE FROM threads WHERE id = ?").run(threadId);
  }

  duplicateThread(threadId: string, fromTurnId?: string | null): ThreadDetail {
    const source = this.getThread(threadId);
    const duplicate = this.createThread({
      projectId: source.projectId,
      title: `${source.title} Copy`,
      providerId: source.providerId,
      modelId: source.modelId,
      executionPermission: source.executionPermission,
    });
    let copyTurns = source.turns;
    if (fromTurnId) {
      const untilIndex = source.turns.findIndex(
        (turn) => turn.id === fromTurnId,
      );
      if (untilIndex >= 0) {
        copyTurns = source.turns.slice(0, untilIndex + 1);
      }
    }
    for (const turn of copyTurns) {
      this.appendTurn(
        duplicate.id,
        turn.role,
        turn.content,
        turn.metadata,
        turn.runId,
      );
    }
    return this.getThread(duplicate.id);
  }

  appendTurn(
    threadId: string,
    role: ThreadTurn["role"],
    content: string,
    metadata: Record<string, unknown> | null = null,
    runId: string | null = null,
  ) {
    return this.threads.appendTurn(threadId, role, content, metadata, runId);
  }

  updateAssistantTurn(runId: string, threadId: string, content: string, metadata?: Record<string, unknown> | null) {
    this.threads.updateAssistantTurn(runId, threadId, content, metadata);
  }

  removeEmptyAssistantTurn(runId: string, threadId: string) {
    this.db
      .prepare(
        `DELETE FROM thread_turns
         WHERE id IN (
           SELECT id
           FROM thread_turns
           WHERE run_id = ?
             AND thread_id = ?
             AND role = 'assistant'
             AND trim(content) = ''
           ORDER BY created_at DESC
           LIMIT 1
         )`,
      )
      .run(runId, threadId);
  }

  updateThreadStatus(threadId: string, status: ThreadSummary['status']) {
    this.threads.updateThreadStatus(threadId, status);
  }

  findThreadIdByRunId(runId: string): string | null {
    const runEventRow = this.db
      .prepare(
        "SELECT thread_id FROM run_events WHERE run_id = ? ORDER BY created_at DESC LIMIT 1",
      )
      .get(runId) as { thread_id: string } | undefined;
    if (runEventRow?.thread_id) {
      return String(runEventRow.thread_id);
    }

    const turnRow = this.db
      .prepare(
        "SELECT thread_id FROM thread_turns WHERE run_id = ? ORDER BY created_at DESC LIMIT 1",
      )
      .get(runId) as { thread_id: string } | undefined;
    return turnRow?.thread_id ? String(turnRow.thread_id) : null;
  }

  setThreadExecutionPermission(threadId: string, executionPermission: ExecutionPermission): ThreadDetail {
    return this.threads.setThreadExecutionPermission(threadId, executionPermission);
  }

  syncThreadRunConfiguration(threadId: string, input: {
    providerId: ProviderId;
    modelId: string;
    executionPermission: ExecutionPermission;
  }): ThreadDetail {
    return this.threads.syncThreadRunConfiguration(threadId, input);
  }

  createThreadCompaction(input: ThreadCompactionCreateInput) {
    return this.threadCompactions.create(input);
  }

  listThreadCompactions(threadId: string) {
    return this.threadCompactions.listForThread(threadId);
  }

  getLatestThreadCompaction(threadId: string) {
    return this.threadCompactions.getLatestForThread(threadId);
  }

  deleteThreadCompactions(threadId: string) {
    this.threadCompactions.deleteForThread(threadId);
  }

  addRunEvent(
    threadId: string,
    runId: string,
    eventType: RunEvent["eventType"],
    payload: Record<string, unknown>,
  ): RunEvent {
    const now = new Date().toISOString();
    const event: RunEvent = {
      id: randomUUID(),
      threadId,
      runId,
      eventType,
      payload,
      createdAt: now,
    };
    this.db
      .prepare(
        `INSERT INTO run_events (id, thread_id, run_id, event_type, payload_json, created_at)
         VALUES (@id, @threadId, @runId, @eventType, @payloadJson, @createdAt)`,
      )
      .run({
        id: event.id,
        threadId,
        runId,
        eventType,
        payloadJson: JSON.stringify(payload),
        createdAt: now,
      });
    return event;
  }

  getStorageDiagnostics(): StorageDiagnostics {
    return getStorageDiagnostics(this.db, this.databasePath);
  }

  compactOldTerminalRunEvents(
    input?: Record<string, never>,
  ): StorageCompactionResult {
    return compactOldTerminalRunEvents(this.db, input);
  }

  maintainStorage(input?: { vacuum?: boolean }): StorageMaintenanceResult {
    return maintainStorage(this.db, this.databasePath, input);
  }

  getThreadPlannerState(threadId: string): ThreadPlannerState {
    return this.plannerState.getThreadPlannerState(threadId);
  }

  setThreadPlannerMode(threadId: string, mode: ComposerMode): ThreadPlannerState {
    return this.plannerState.setThreadPlannerMode(threadId, mode);
  }

  setThreadPlannerTurnState(threadId: string, turnState: PlanTurnState): ThreadPlannerState {
    return this.plannerState.setThreadPlannerTurnState(threadId, turnState);
  }

  createPlannerQuestionSet(threadId: string, promptTurnId: string, callId: string, questions: PlannerQuestionSet['questions']) {
    return this.plannerState.createPlannerQuestionSet(threadId, promptTurnId, callId, questions);
  }

  answerPlannerQuestionSet(threadId: string, callId: string, answers: Record<string, PlannerQuestionAnswer>) {
    return this.plannerState.answerPlannerQuestionSet(threadId, callId, answers);
  }

  createPlannerPlan(
    threadId: string,
    createdTurnId: string,
    proposedPlanMarkdown: string,
    structuredPlan: StructuredPlannerPlan | null,
  ) {
    return this.plannerState.createPlannerPlan(threadId, createdTurnId, proposedPlanMarkdown, structuredPlan);
  }

  approvePlannerPlan(threadId: string, planId: string) {
    return this.plannerState.approvePlannerPlan(threadId, planId);
  }

  clearPendingPlannerQuestions(threadId: string) {
    return this.plannerState.clearPendingPlannerQuestions(threadId);
  }

  clearThreadPlannerSession(threadId: string) {
    return this.plannerState.clearThreadPlannerSession(threadId);
  }

  getPlannerQuestionSetByCallId(callId: string): PlannerQuestionSet {
    return this.plannerState.getPlannerQuestionSetByCallId(callId);
  }

  getPlannerQuestionSetByThreadAndCallId(threadId: string, callId: string): PlannerQuestionSet {
    return this.plannerState.getPlannerQuestionSetByThreadAndCallId(threadId, callId);
  }

  getLatestPlannerQuestionSet(threadId: string): PlannerQuestionSet | null {
    return this.plannerState.getLatestPlannerQuestionSet(threadId);
  }

  getPlannerPlan(planId: string): PlannerPlan {
    return this.plannerState.getPlannerPlan(planId);
  }

  getProviderAccount(providerId: ProviderId): ProviderAccount | null {
    return this.providerState.getProviderAccount(providerId);
  }

  saveProviderAccount(account: ProviderAccount): ProviderAccount {
    return this.providerState.saveProviderAccount(account);
  }

  getProviderModelCache(providerId: ProviderId): { models: ProviderModel[]; updatedAt: string | null; source: ProviderModelSource | null } {
    return this.providerState.getProviderModelCache(providerId);
  }

  replaceProviderModels(providerId: ProviderId, models: ProviderModel[], source: Extract<ProviderModelSource, 'api' | 'runtime'>) {
    this.providerState.replaceProviderModels(providerId, models, source);
  }

  clearProviderModelCache(providerId: ProviderId) {
    this.providerState.clearProviderModelCache(providerId);
  }

  listCustomProviders(): CustomProviderDefinition[] {
    return this.customProviders.listCustomProviders();
  }

  getCustomProvider(providerId: string): CustomProviderDefinition {
    return this.customProviders.getCustomProvider(providerId);
  }

  saveCustomProvider(input: CustomProviderSaveInput): CustomProviderDefinition {
    return this.customProviders.saveCustomProvider(input);
  }

  deleteCustomProvider(providerId: string) {
    this.customProviders.deleteCustomProvider(providerId);
  }

  listSkills(): SkillDefinition[] {
    return this.skillsRepo.listSkills();
  }

  getSkillsByIds(skillIds: string[]): SkillDefinition[] {
    return this.skillsRepo.getSkillsByIds(skillIds);
  }

  upsertSkill(skill: SkillDefinition): SkillDefinition {
    return this.skillsRepo.upsertSkill(skill);
  }

  saveSkill(input: SkillSaveInput): SkillDefinition {
    return this.skillsRepo.saveSkill(input);
  }

  toggleSkill(skillId: string, enabled: boolean): SkillDefinition {
    return this.skillsRepo.toggleSkill(skillId, enabled);
  }

  getSkill(skillId: string): SkillDefinition {
    return this.skillsRepo.getSkill(skillId);
  }

  deleteSkill(skillId: string) {
    this.skillsRepo.deleteSkill(skillId);
  }

  listAutomations(): AutomationDefinition[] {
    return this.automationsRepo.listAutomations();
  }

  listMcpServers(): McpServerRecord[] {
    return this.mcpServers.listMcpServers();
  }

  getMcpServer(serverId: string): McpServerRecord {
    return this.mcpServers.getMcpServer(serverId);
  }

  saveMcpServer(input: McpServerSaveInput): McpServerRecord {
    return this.mcpServers.saveMcpServer(input);
  }

  deleteMcpServer(serverId: string) {
    this.mcpServers.deleteMcpServer(serverId);
  }

  saveMcpServerState(input: {
    serverId: string;
    status: McpServerState["status"];
    capabilities: Record<string, unknown> | null;
    lastSeenAt: string | null;
    lastError: string | null;
    toolCount: number;
    resourceCount: number;
    promptCount: number;
    updatedAt: string;
  }) {
    this.mcpServers.saveMcpServerState(input);
  }

  saveAutomation(input: AutomationSaveInput): AutomationDefinition {
    return this.automationsRepo.saveAutomation(input);
  }

  getAutomation(id: string): AutomationDefinition {
    return this.automationsRepo.getAutomation(id);
  }

  toggleAutomation(automationId: string, enabled: boolean): AutomationDefinition {
    return this.automationsRepo.toggleAutomation(automationId, enabled);
  }

  setAutomationNextRunAt(automationId: string, nextRunAt: string | null): AutomationDefinition {
    return this.automationsRepo.setAutomationNextRunAt(automationId, nextRunAt);
  }

  deleteAutomation(automationId: string) {
    this.automationsRepo.deleteAutomation(automationId);
  }

  listAutomationRuns(automationId: string): AutomationRun[] {
    return this.automationsRepo.listAutomationRuns(automationId);
  }

  addAutomationRun(automationId: string, threadId: string | null, status: AutomationRun['status'], message: string): AutomationRun {
    return this.automationsRepo.addAutomationRun(automationId, threadId, status, message);
  }

  listJobs(): JobDefinition[] {
    return this.jobsReview.listJobs();
  }

  listJobsForThread(threadId: string): JobDefinition[] {
    return this.jobsReview.listJobsForThread(threadId);
  }

  getJob(jobId: string): JobDefinition {
    return this.jobsReview.getJob(jobId);
  }

  saveJob(input: {
    id?: string;
    projectId: string;
    sourceType: JobDefinition["sourceType"];
    sourceId?: string | null;
    title: string;
    status: JobDefinition["status"];
    threadId?: string | null;
  }): JobDefinition {
    return this.jobsReview.saveJob(input);
  }

  findActiveJobForSource(sourceType: JobDefinition['sourceType'], sourceId: string): JobDefinition | null {
    return this.jobsReview.findActiveJobForSource(sourceType, sourceId);
  }

  addJobRun(input: {
    jobId: string;
    providerId?: ProviderId | null;
    modelId?: string | null;
    status: JobRun["status"];
    runId?: string | null;
    checkpoint?: Record<string, unknown> | null;
    startedAt?: string | null;
    finishedAt?: string | null;
  }): JobRun {
    return this.jobsReview.addJobRun(input);
  }

  getJobRun(jobRunId: string): JobRun {
    return this.jobsReview.getJobRun(jobRunId);
  }

  updateJobRun(jobRunId: string, input: {
    status?: JobRun['status'];
    runId?: string | null;
    checkpoint?: Record<string, unknown> | null;
    startedAt?: string | null;
    finishedAt?: string | null;
  }): JobRun {
    return this.jobsReview.updateJobRun(jobRunId, input);
  }

  findJobRunByProviderRunId(providerRunId: string): JobRun | null {
    return this.jobsReview.findJobRunByProviderRunId(providerRunId);
  }

  listPendingReviewItems(): ReviewItem[] {
    return this.jobsReview.listPendingReviewItems();
  }

  getReviewItem(reviewItemId: string): ReviewItem {
    return this.jobsReview.getReviewItem(reviewItemId);
  }

  addReviewItem(input: {
    jobId: string;
    jobRunId?: string | null;
    kind: ReviewItem["kind"];
    status?: ReviewItem["status"];
    summary: string;
    details: Record<string, unknown>;
  }): ReviewItem {
    return this.jobsReview.addReviewItem(input);
  }

  updateReviewItem(reviewItemId: string, input: {
    status?: ReviewItem['status'];
    decision?: Record<string, unknown> | null;
    jobRunId?: string | null;
    details?: Record<string, unknown>;
  }): ReviewItem {
    return this.jobsReview.updateReviewItem(reviewItemId, input);
  }

  getPreferences(): Preferences {
    return this.settings.getPreferences();
  }

  savePreferences(input: Partial<Preferences>): Preferences {
    return this.settings.savePreferences(input);
  }

  upsertWorkspaceMemoryFile(input: {
    projectId: string;
    kind: "memory" | "daily_note";
    path: string;
    fileName: string;
    checksum: string;
    lastIndexedAt: string;
    updatedAt: string;
  }) {
    return this.workspaceMemory.upsertWorkspaceMemoryFile(input);
  }

  getWorkspaceMemoryFile(projectId: string, path: string) {
    return this.workspaceMemory.getWorkspaceMemoryFile(projectId, path);
  }

  replaceWorkspaceMemoryChunks(
    memoryFileId: string,
    projectId: string,
    chunks: Array<{
      ordinal: number;
      heading: string | null;
      content: string;
      updatedAt: string;
    }>,
  ) {
    this.workspaceMemory.replaceWorkspaceMemoryChunks(memoryFileId, projectId, chunks);
  }

  deleteWorkspaceMemoryFilesNotInPaths(
    projectId: string,
    kinds: Array<"memory" | "daily_note">,
    paths: string[],
  ) {
    this.workspaceMemory.deleteWorkspaceMemoryFilesNotInPaths(projectId, kinds, paths);
  }

  listWorkspaceMemoryChunks(projectId: string) {
    return this.workspaceMemory.listWorkspaceMemoryChunks(projectId);
  }

  getProjectKnowledgeIndexSnapshotByRootPath(rootPath: string) {
    return this.projectKnowledgeIndex.getSnapshotByRootPath(rootPath);
  }

  isProjectKnowledgeFts5Available() {
    return this.projectKnowledgeIndex.isFts5Available();
  }

  replaceProjectKnowledgeRootIndex(input: ProjectKnowledgeReplaceRootIndexInput) {
    return this.projectKnowledgeIndex.replaceRootIndex(input);
  }

  upsertGeneratedMemoryCandidate(input: {
    workspaceScopeKey: string;
    projectId: string | null;
    sourceThreadId: string;
    sourceRunId: string | null;
    sourceTurnIds: string[];
    kind: GeneratedMemoryCandidateKind;
    summary: string;
    detail: string;
    evidenceExcerpt: string;
    dedupeKey: string;
    status: GeneratedMemoryCandidateStatus;
    createdAt: string;
    updatedAt: string;
  }): GeneratedMemoryCandidate {
    return this.generatedMemory.upsertGeneratedMemoryCandidate(input);
  }

  getGeneratedMemoryCandidate(candidateId: string): GeneratedMemoryCandidate | null {
    return this.generatedMemory.getGeneratedMemoryCandidate(candidateId);
  }

  listGeneratedMemoryCandidates(workspaceScopeKey: string): GeneratedMemoryCandidate[] {
    return this.generatedMemory.listGeneratedMemoryCandidates(workspaceScopeKey);
  }

  upsertGeneratedMemoryItem(input: {
    id?: string;
    workspaceScopeKey: string;
    projectId: string | null;
    kind: GeneratedMemoryCandidateKind;
    summary: string;
    detail: string;
    authority: GeneratedMemoryItemAuthority;
    evidenceCount: number;
    sourceCandidateIds: string[];
    sourceThreadIds: string[];
    createdAt: string;
    updatedAt: string;
    lastUsedAt: string | null;
    useCount: number;
    disabledAt: string | null;
  }): GeneratedMemoryItem {
    return this.generatedMemory.upsertGeneratedMemoryItem(input);
  }

  getGeneratedMemoryItem(itemId: string): GeneratedMemoryItem | null {
    return this.generatedMemory.getGeneratedMemoryItem(itemId);
  }

  listGeneratedMemoryItems(workspaceScopeKey: string): GeneratedMemoryItem[] {
    return this.generatedMemory.listGeneratedMemoryItems(workspaceScopeKey);
  }

  disableGeneratedMemoryItem(itemId: string, disabledAt: string) {
    return this.generatedMemory.disableGeneratedMemoryItem(itemId, disabledAt);
  }

  replaceGeneratedMemoryEvidenceForCandidate(
    candidateId: string,
    evidence: Array<{
      workspaceScopeKey: string;
      projectId: string | null;
      sourceThreadId: string;
      sourceTurnIds: string[];
      role: GeneratedMemoryEvidence["role"];
      excerpt: string;
      capturedAt: string;
    }>,
  ) {
    this.generatedMemory.replaceGeneratedMemoryEvidenceForCandidate(candidateId, evidence);
  }

  replaceGeneratedMemoryEvidenceForItem(
    itemId: string,
    evidence: Array<{
      workspaceScopeKey: string;
      projectId: string | null;
      sourceThreadId: string;
      sourceTurnIds: string[];
      role: GeneratedMemoryEvidence["role"];
      excerpt: string;
      capturedAt: string;
    }>,
  ) {
    this.generatedMemory.replaceGeneratedMemoryEvidenceForItem(itemId, evidence);
  }

  listGeneratedMemoryEvidenceForCandidate(candidateId: string): GeneratedMemoryEvidence[] {
    return this.generatedMemory.listGeneratedMemoryEvidenceForCandidate(candidateId);
  }

  listGeneratedMemoryEvidenceForItem(itemId: string): GeneratedMemoryEvidence[] {
    return this.generatedMemory.listGeneratedMemoryEvidenceForItem(itemId);
  }

  clearGeneratedMemoryWorkspaceScope(workspaceScopeKey: string) {
    this.generatedMemory.clearGeneratedMemoryWorkspaceScope(workspaceScopeKey);
  }

  private seedBuiltInSkills() {
    this.pruneStaleBuiltInSkills();

    const statement = this.db.prepare(
      `INSERT INTO skills (
        id, name, description, instructions, origin, scope, provider_targets_json, enabled, project_id, metadata_json, path, created_at, updated_at
      ) VALUES (@id, @name, @description, @instructions, 'built_in_style', 'global', @providerTargetsJson, 1, NULL, @metadataJson, @path, @createdAt, @updatedAt)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        description = excluded.description,
        instructions = excluded.instructions,
        provider_targets_json = excluded.provider_targets_json,
        enabled = 1,
        metadata_json = excluded.metadata_json,
        path = excluded.path,
        updated_at = excluded.updated_at
      WHERE skills.origin = 'built_in_style'`,
    );
    const now = new Date().toISOString();
    for (const skill of builtInSkillSeeds) {
      statement.run({
        id: skill.id,
        name: skill.name,
        description: skill.description,
        instructions: skill.instructions,
        providerTargetsJson: JSON.stringify(skill.providerTargets),
        metadataJson: JSON.stringify(skill.metadata ?? {}),
        path: `resources/built-in-skills/${skill.id}.md`,
        createdAt: now,
        updatedAt: now,
      });
    }
  }

  private pruneStaleBuiltInSkills() {
    const currentIds = builtInSkillSeeds.map((skill) => skill.id);
    if (currentIds.length === 0) {
      this.db.prepare("DELETE FROM skills WHERE origin = 'built_in_style'").run();
      return;
    }

    const placeholders = currentIds.map(() => "?").join(", ");
    this.db
      .prepare(
        `DELETE FROM skills
          WHERE origin = 'built_in_style'
            AND id NOT IN (${placeholders})`,
      )
      .run(...currentIds);
  }


















  private allocateSubagentName(parentThreadId: string) {
    return pickNextSubagentName(
      this.listSubagentsByParentThread(parentThreadId).map(
        (subagent) => subagent.name,
      ),
    );
  }

  private mapThreadPlannerState(row: Row): ThreadPlannerState {
    const threadId = String(row.thread_id);
    const activePlanId = (row.active_plan_id as string | null) ?? null;
    const pendingQuestionCallId =
      (row.pending_question_call_id as string | null) ?? null;
    const pendingQuestionRow =
      pendingQuestionCallId !== null
        ? (this.db
            .prepare(
              "SELECT * FROM planner_question_sets WHERE thread_id = ? AND call_id = ? ORDER BY created_at DESC LIMIT 1",
            )
            .get(threadId, pendingQuestionCallId) as Row | undefined)
        : undefined;
    const activePlan =
      activePlanId &&
      this.db
        .prepare("SELECT * FROM planner_plans WHERE plan_id = ?")
        .get(activePlanId)
        ? mapPlannerPlan(
            this.db
              .prepare("SELECT * FROM planner_plans WHERE plan_id = ?")
              .get(activePlanId) as Row,
          )
        : null;
    const pendingQuestionSet = pendingQuestionRow
      ? mapPlannerQuestionSet(pendingQuestionRow)
      : null;

    return {
      threadId,
      composerMode: row.composer_mode as ComposerMode,
      turnState: row.turn_state as PlanTurnState,
      activePlanId,
      pendingQuestionCallId,
      updatedAt: String(row.updated_at),
      activePlan,
      pendingQuestionSet,
    };
  }













  private resolveAutomationNextRunAt(
    input: AutomationSaveInput,
    current: AutomationDefinition | null,
    now: string,
  ) {
    const intervalMinutes = input.intervalMinutes ?? null;
    if (
      !input.enabled ||
      input.scheduleType !== "interval_while_app_open" ||
      !intervalMinutes
    ) {
      return null;
    }

    if (
      current &&
      current.enabled &&
      current.scheduleType === input.scheduleType &&
      current.intervalMinutes === intervalMinutes &&
      current.nextRunAt
    ) {
      return current.nextRunAt;
    }

    return this.computeAutomationNextRunAt(intervalMinutes, now);
  }

  private computeAutomationNextRunAt(
    intervalMinutes: number,
    from: string | number | Date = Date.now(),
  ) {
    const base =
      typeof from === "number"
        ? from
        : from instanceof Date
          ? from.getTime()
          : new Date(from).getTime();
    return new Date(base + intervalMinutes * 60_000).toISOString();
  }






}
