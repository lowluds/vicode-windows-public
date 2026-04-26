import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import { builtInSkillSeeds } from '../shared/builtInSkills';
import { normalizeDisplayText } from '../shared/display-text';
import type { StorageCompactionResult, StorageDiagnostics, StorageMaintenanceResult } from '../shared/ipc';
import { createProviderRecord, getProviderMetadata } from '../shared/providers';
import { pickNextSubagentName } from '../shared/subagents';
import { normalizeThreadSources } from '../shared/thread-sources';
import { AutomationRepository } from './automation-repository';
import { AutonomousTaskRepository } from './autonomous-task-repository';
import { BuildControlRepository } from './build-control-repository';
import { BootstrapRepository } from './bootstrap-repository';
import { CollabIdentityRepository } from './collab-identity-repository';
import { CollabRoomCacheRepository } from './collab-room-cache-repository';
import { CollabSharedCacheRepository } from './collab-shared-cache-repository';
import { GeneratedMemoryRepository } from './generated-memory-repository';
import { JobsReviewRepository } from './jobs-review-repository';
import { McpServerRepository } from './mcp-server-repository';
import { PlannerStateRepository } from './planner-state-repository';
import { ProviderStateRepository } from './provider-state-repository';
import { DEFAULT_PERSONALIZATION, DEFAULT_PREFERENCES, SettingsRepository } from './settings-repository';
import { SkillsRepository } from './skills-repository';
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
  PersonalizationSettings,
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

const DEFAULT_PROJECT_RUNTIME_COMMAND_POLICY: ProjectRuntimeCommandPolicy =
  "approval_required";
const DEFAULT_PROJECT_RUNTIME_NETWORK_POLICY: ProjectRuntimeNetworkPolicy =
  "disabled";

const DEFAULT_COLLAB_CONFIG: CollabConfig = {
  supabaseUrl: null,
  hasAnonKey: false,
  connectionState: "unconfigured",
  lastError: null,
};

const DEFAULT_COLLAB_ACCOUNT: CollabAccount = {
  email: null,
  userId: null,
  expiresAt: null,
};

const RUN_EVENT_COMPACTION_CUTOFF_DAYS = 30;

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
  private readonly buildControl: BuildControlRepository;
  private readonly autonomousTasks: AutonomousTaskRepository;
  private readonly workspaceMemory: WorkspaceMemoryRepository;
  private readonly generatedMemory: GeneratedMemoryRepository;
  private readonly plannerState: PlannerStateRepository;
  private readonly providerState: ProviderStateRepository;
  private readonly jobsReview: JobsReviewRepository;
  private readonly automationsRepo: AutomationRepository;
  private readonly mcpServers: McpServerRepository;
  private readonly collabIdentity: CollabIdentityRepository;
  private readonly collabRoomCache: CollabRoomCacheRepository;
  private readonly collabSharedCache: CollabSharedCacheRepository;

  constructor(databasePath: string) {
    this.databasePath = databasePath;
    mkdirSync(dirname(databasePath), { recursive: true });
    this.db = new Database(databasePath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.bootstrapRepo = new BootstrapRepository(
      () => this.listProjects(),
      (projectId) => this.listThreads(projectId),
      () => this.getPreferences(),
      () => this.getPersonalization()
    );
    this.settings = new SettingsRepository(this.db);
    this.skillsRepo = new SkillsRepository(
      this.db,
      (row) => this.mapSkill(row)
    );
    this.buildControl = new BuildControlRepository(this.db);
    this.autonomousTasks = new AutonomousTaskRepository(
      this.db,
      (row) => this.mapAutonomousTask(row)
    );
    this.workspaceMemory = new WorkspaceMemoryRepository(this.db);
    this.generatedMemory = new GeneratedMemoryRepository(
      this.db,
      (row) => this.mapGeneratedMemoryCandidate(row),
      (row) => this.mapGeneratedMemoryItem(row),
      (row) => this.mapGeneratedMemoryEvidence(row)
    );
    this.plannerState = new PlannerStateRepository(
      this.db,
      (row) => this.mapThreadPlannerState(row),
      (row) => this.mapPlannerQuestionSet(row),
      (row) => this.mapPlannerPlan(row)
    );
    this.providerState = new ProviderStateRepository(
      this.db,
      (row) => this.mapProviderAccount(row),
      (row) => this.mapProviderModel(row)
    );
    this.jobsReview = new JobsReviewRepository(
      this.db,
      (row) => this.mapJob(row),
      (row) => this.mapJobRun(row),
      (row) => this.mapReviewItem(row)
    );
    this.automationsRepo = new AutomationRepository(
      this.db,
      (row) => this.mapAutomation(row),
      (intervalMinutes, from) => this.computeAutomationNextRunAt(intervalMinutes, from),
      (input, current, now) => this.resolveAutomationNextRunAt(input, current, now)
    );
    this.mcpServers = new McpServerRepository(
      this.db,
      (row) => this.mapMcpServerRecord(row)
    );
    this.collabIdentity = new CollabIdentityRepository(
      this.db,
      DEFAULT_COLLAB_CONFIG,
      DEFAULT_COLLAB_ACCOUNT,
      (row) => this.mapCollabProfile(row)
    );
    this.collabRoomCache = new CollabRoomCacheRepository(
      this.db,
      (row) => this.mapCollabRoom(row),
      (row) => this.mapCollabRoomMember(row),
      (row) => this.mapCollabInvite(row),
      (row) => this.mapCollabMessage(row),
      (row) => this.mapCollabPresence(row),
      (profile) => this.collabIdentity.upsertCollabProfile(profile)
    );
    this.collabSharedCache = new CollabSharedCacheRepository(
      this.db,
      (row) => this.mapCollabSharedThread(row),
      (row) => this.mapCollabSharedRun(row),
      (row) => this.mapCollabHandoff(row),
      (row) => this.mapCollabRoomFollower(row),
      (row) => this.mapCollabRoleRequest(row),
      (row) => this.mapCollabRoomTerminalState(row),
      (profile) => this.collabIdentity.upsertCollabProfile(profile),
      () => this.collabIdentity.getCollabAccount().userId
    );
    this.threads = new ThreadRepository(
      this.db,
      () => this.getPreferences(),
      (threadId) => this.plannerState.ensureThreadPlannerState(threadId),
      (input) => {
        this.savePreferences(input);
      },
      (row) => this.mapThreadSummary(row),
      (row) => this.mapTurn(row),
      (row) => this.mapRunEvent(row),
      (threadId) => this.plannerState.getThreadPlannerState(threadId),
      (threadId) => this.listThreadFollowUps(threadId)
    );
  }

  migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        folder_path TEXT,
        trusted INTEGER NOT NULL DEFAULT 1,
        runtime_command_policy TEXT NOT NULL DEFAULT 'approval_required',
        runtime_network_policy TEXT NOT NULL DEFAULT 'disabled',
        default_provider_id TEXT NOT NULL,
        default_model_openai TEXT NOT NULL,
        default_model_gemini TEXT NOT NULL,
        default_model_qwen TEXT NOT NULL,
        default_model_ollama TEXT NOT NULL,
        default_model_kimi TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS threads (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        provider_id TEXT NOT NULL,
        model_id TEXT NOT NULL,
        execution_permission TEXT NOT NULL DEFAULT 'default',
        status TEXT NOT NULL,
        archived INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_message_at TEXT NOT NULL,
        last_preview TEXT
      );
      CREATE TABLE IF NOT EXISTS thread_turns (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
        run_id TEXT,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        metadata_json TEXT,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS thread_followups (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
        content TEXT NOT NULL,
        metadata_json TEXT,
        kind TEXT NOT NULL,
        status TEXT NOT NULL,
        priority INTEGER NOT NULL DEFAULT 0,
        target_run_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        dispatched_at TEXT,
        cancelled_at TEXT
      );
      CREATE TABLE IF NOT EXISTS subagents (
        id TEXT PRIMARY KEY,
        parent_thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
        parent_run_id TEXT,
        child_thread_id TEXT REFERENCES threads(id) ON DELETE SET NULL,
        child_run_id TEXT,
        name TEXT NOT NULL,
        title TEXT NOT NULL,
        prompt TEXT NOT NULL,
        provider_id TEXT NOT NULL,
        model_id TEXT NOT NULL,
        execution_permission TEXT NOT NULL,
        delegation_profile TEXT NOT NULL,
        status TEXT NOT NULL,
        output_summary TEXT,
        last_error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        started_at TEXT,
        completed_at TEXT
      );
      CREATE TABLE IF NOT EXISTS thread_drafts (
        thread_id TEXT PRIMARY KEY REFERENCES threads(id) ON DELETE CASCADE,
        prompt TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS planner_plans (
        plan_id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
        created_turn_id TEXT NOT NULL REFERENCES thread_turns(id) ON DELETE CASCADE,
        proposed_plan_markdown TEXT NOT NULL,
        structured_plan_json TEXT,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS planner_question_sets (
        question_set_id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
        prompt_turn_id TEXT NOT NULL REFERENCES thread_turns(id) ON DELETE CASCADE,
        call_id TEXT NOT NULL,
        questions_json TEXT NOT NULL,
        answers_json TEXT,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS thread_planner_state (
        thread_id TEXT PRIMARY KEY REFERENCES threads(id) ON DELETE CASCADE,
        composer_mode TEXT NOT NULL DEFAULT 'default',
        turn_state TEXT NOT NULL DEFAULT 'idle',
        active_plan_id TEXT REFERENCES planner_plans(plan_id) ON DELETE SET NULL,
        pending_question_call_id TEXT,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS run_events (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
        run_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS provider_accounts (
        provider_id TEXT PRIMARY KEY,
        auth_state TEXT NOT NULL,
        auth_mode TEXT,
        encrypted_api_key TEXT,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS provider_models_cache (
        provider_id TEXT NOT NULL,
        model_id TEXT NOT NULL,
        label TEXT NOT NULL,
        description TEXT NOT NULL,
        supports_vision INTEGER NOT NULL DEFAULT 0,
        sort_order INTEGER NOT NULL,
        source TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (provider_id, model_id)
      );
      CREATE TABLE IF NOT EXISTS skills (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL,
        instructions TEXT NOT NULL,
        origin TEXT NOT NULL,
        scope TEXT NOT NULL,
        provider_targets_json TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        project_id TEXT,
        metadata_json TEXT NOT NULL,
        path TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS automations (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        provider_id TEXT NOT NULL,
        model_id TEXT NOT NULL,
        prompt_template TEXT NOT NULL,
        skill_id TEXT,
        enabled INTEGER NOT NULL DEFAULT 1,
        schedule_type TEXT NOT NULL,
        interval_minutes INTEGER,
        last_run_at TEXT,
        next_run_at TEXT,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS automation_runs (
        id TEXT PRIMARY KEY,
        automation_id TEXT NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
        thread_id TEXT,
        status TEXT NOT NULL,
        message TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS vicode_build_lanes (
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        team_id TEXT NOT NULL,
        lane_id TEXT NOT NULL,
        thread_id TEXT REFERENCES threads(id) ON DELETE SET NULL,
        paused INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (project_id, team_id, lane_id)
      );
      CREATE TABLE IF NOT EXISTS vicode_build_events (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        team_id TEXT NOT NULL,
        lane_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        trigger_kind TEXT NOT NULL,
        summary TEXT NOT NULL,
        detail TEXT,
        source_lane_id TEXT,
        target_lane_id TEXT,
        thread_id TEXT REFERENCES threads(id) ON DELETE SET NULL,
        run_id TEXT,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS autonomous_tasks (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        thread_id TEXT REFERENCES threads(id) ON DELETE SET NULL,
        run_id TEXT,
        source_id TEXT NOT NULL,
        title TEXT NOT NULL,
        summary TEXT NOT NULL,
        owner_label TEXT NOT NULL,
        provenance_label TEXT NOT NULL,
        trust_label TEXT,
        approval_label TEXT,
        status TEXT NOT NULL,
        status_label TEXT NOT NULL,
        blocked_by TEXT,
        blocking TEXT,
        last_error TEXT,
        metadata_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        started_at TEXT,
        completed_at TEXT
      );
      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        source_type TEXT NOT NULL,
        source_id TEXT,
        title TEXT NOT NULL,
        status TEXT NOT NULL,
        thread_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS job_runs (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
        provider_id TEXT,
        model_id TEXT,
        status TEXT NOT NULL,
        run_id TEXT,
        checkpoint_json TEXT,
        started_at TEXT,
        finished_at TEXT,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS review_items (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
        job_run_id TEXT REFERENCES job_runs(id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        status TEXT NOT NULL,
        summary TEXT NOT NULL,
        details_json TEXT NOT NULL,
        decision_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS preferences (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        selected_project_id TEXT,
        default_provider_id TEXT NOT NULL,
        default_model_openai TEXT NOT NULL,
        default_model_gemini TEXT NOT NULL,
        default_model_qwen TEXT NOT NULL,
        default_model_ollama TEXT NOT NULL,
        default_model_kimi TEXT NOT NULL,
        default_reasoning_effort_openai TEXT,
        default_reasoning_effort_gemini TEXT,
        default_reasoning_effort_qwen TEXT,
        default_reasoning_effort_ollama TEXT,
        default_reasoning_effort_kimi TEXT,
        default_thinking_openai INTEGER NOT NULL DEFAULT 0,
        default_thinking_gemini INTEGER NOT NULL DEFAULT 0,
        default_thinking_qwen INTEGER NOT NULL DEFAULT 1,
        default_thinking_ollama INTEGER NOT NULL DEFAULT 0,
        default_thinking_kimi INTEGER NOT NULL DEFAULT 0,
        ollama_transport_mode TEXT NOT NULL DEFAULT 'chat',
        default_execution_permission TEXT NOT NULL DEFAULT 'default',
        follow_up_behavior TEXT NOT NULL DEFAULT 'queue',
        generated_memory_use_enabled INTEGER NOT NULL DEFAULT 0,
        generated_memory_generation_enabled INTEGER NOT NULL DEFAULT 1,
        appearance_mode TEXT NOT NULL DEFAULT 'system',
        accent_mode TEXT NOT NULL DEFAULT 'system',
        accent_color TEXT,
        onboarding_complete INTEGER NOT NULL DEFAULT 0,
        last_opened_thread_id TEXT,
        microphone_allowed INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS personalization (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS workspace_bootstrap_dismissals (
        project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
        dismissed_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS collab_settings (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        supabase_url TEXT,
        supabase_anon_key TEXT,
        encrypted_session_json TEXT,
        current_user_id TEXT,
        current_email TEXT,
        session_expires_at TEXT,
        connection_state TEXT NOT NULL DEFAULT 'unconfigured',
        last_error TEXT,
        updated_at TEXT NOT NULL,
        last_synced_at TEXT
      );
      CREATE TABLE IF NOT EXISTS collab_profiles (
        id TEXT PRIMARY KEY,
        email TEXT,
        display_name TEXT NOT NULL,
        handle TEXT,
        avatar_url TEXT,
        status TEXT NOT NULL,
        bio TEXT,
        timezone TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS collab_rooms (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        name TEXT NOT NULL,
        join_code TEXT,
        slug TEXT,
        topic TEXT,
        project_label TEXT,
        direct_user_id TEXT,
        unread_count INTEGER NOT NULL DEFAULT 0,
        member_count INTEGER NOT NULL DEFAULT 0,
        last_activity_at TEXT NOT NULL,
        last_message_preview TEXT,
        created_by TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS collab_room_members (
        room_id TEXT NOT NULL REFERENCES collab_rooms(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES collab_profiles(id) ON DELETE CASCADE,
        role TEXT NOT NULL,
        membership_state TEXT NOT NULL,
        joined_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (room_id, user_id)
      );
      CREATE TABLE IF NOT EXISTS collab_room_sessions (
        room_id TEXT NOT NULL REFERENCES collab_rooms(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES collab_profiles(id) ON DELETE CASCADE,
        session_token TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        expires_at TEXT,
        PRIMARY KEY (room_id, user_id)
      );
      CREATE TABLE IF NOT EXISTS collab_invites (
        id TEXT PRIMARY KEY,
        room_id TEXT NOT NULL REFERENCES collab_rooms(id) ON DELETE CASCADE,
        code TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL,
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT
      );
      CREATE TABLE IF NOT EXISTS collab_messages (
        id TEXT PRIMARY KEY,
        room_id TEXT NOT NULL REFERENCES collab_rooms(id) ON DELETE CASCADE,
        author_id TEXT NOT NULL REFERENCES collab_profiles(id) ON DELETE CASCADE,
        body TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS collab_presences (
        room_id TEXT NOT NULL REFERENCES collab_rooms(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES collab_profiles(id) ON DELETE CASCADE,
        status TEXT NOT NULL,
        current_thread_id TEXT,
        current_thread_title TEXT,
        branch_name TEXT,
        worktree_name TEXT,
        active_run_id TEXT,
        active_run_title TEXT,
        dirty_file_count INTEGER NOT NULL DEFAULT 0,
        staged_file_count INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (room_id, user_id)
      );
      CREATE TABLE IF NOT EXISTS collab_shared_threads (
        id TEXT PRIMARY KEY,
        room_id TEXT NOT NULL REFERENCES collab_rooms(id) ON DELETE CASCADE,
        thread_id TEXT NOT NULL,
        project_id TEXT,
        project_label TEXT,
        title TEXT NOT NULL,
        status TEXT NOT NULL,
        driver_user_id TEXT NOT NULL REFERENCES collab_profiles(id) ON DELETE CASCADE,
        provider_id TEXT NOT NULL,
        model_id TEXT NOT NULL,
        last_prompt_summary TEXT,
        latest_assistant_summary TEXT,
        run_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS collab_shared_runs (
        id TEXT PRIMARY KEY,
        room_id TEXT NOT NULL REFERENCES collab_rooms(id) ON DELETE CASCADE,
        thread_id TEXT NOT NULL,
        thread_title TEXT NOT NULL,
        run_id TEXT NOT NULL,
        driver_user_id TEXT NOT NULL REFERENCES collab_profiles(id) ON DELETE CASCADE,
        provider_id TEXT NOT NULL,
        model_id TEXT NOT NULL,
        execution_permission TEXT NOT NULL,
        status TEXT NOT NULL,
        task_title TEXT,
        summary TEXT,
        changed_files_json TEXT NOT NULL,
        diff_stats_json TEXT,
        tests_summary TEXT,
        result_label TEXT,
        started_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        completed_at TEXT
      );
      CREATE TABLE IF NOT EXISTS collab_handoffs (
        id TEXT PRIMARY KEY,
        room_id TEXT NOT NULL REFERENCES collab_rooms(id) ON DELETE CASCADE,
        thread_id TEXT NOT NULL,
        run_id TEXT,
        author_user_id TEXT NOT NULL REFERENCES collab_profiles(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        summary TEXT NOT NULL,
        branch_name TEXT,
        dirty_file_count INTEGER NOT NULL DEFAULT 0,
        staged_file_count INTEGER NOT NULL DEFAULT 0,
        changed_files_json TEXT NOT NULL,
        outstanding_tasks_json TEXT NOT NULL,
        recommended_next_prompt TEXT,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS collab_room_followers (
        room_id TEXT NOT NULL REFERENCES collab_rooms(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES collab_profiles(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        PRIMARY KEY (room_id, user_id)
      );
      CREATE TABLE IF NOT EXISTS collab_role_requests (
        id TEXT PRIMARY KEY,
        room_id TEXT NOT NULL REFERENCES collab_rooms(id) ON DELETE CASCADE,
        requester_user_id TEXT NOT NULL REFERENCES collab_profiles(id) ON DELETE CASCADE,
        requested_role TEXT NOT NULL,
        status TEXT NOT NULL,
        resolved_by_user_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS collab_room_terminal_states (
        room_id TEXT PRIMARY KEY REFERENCES collab_rooms(id) ON DELETE CASCADE,
        mode TEXT NOT NULL,
        enabled_by_user_id TEXT REFERENCES collab_profiles(id) ON DELETE SET NULL,
        note TEXT,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS workspace_memory_files (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        path TEXT NOT NULL,
        file_name TEXT NOT NULL,
        checksum TEXT,
        last_indexed_at TEXT,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS workspace_memory_chunks (
        id TEXT PRIMARY KEY,
        memory_file_id TEXT NOT NULL REFERENCES workspace_memory_files(id) ON DELETE CASCADE,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        ordinal INTEGER NOT NULL,
        heading TEXT,
        content TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS generated_memory_candidates (
        id TEXT PRIMARY KEY,
        workspace_scope_key TEXT NOT NULL,
        project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
        source_thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
        source_run_id TEXT,
        source_turn_ids_json TEXT NOT NULL,
        kind TEXT NOT NULL,
        summary TEXT NOT NULL,
        detail TEXT NOT NULL,
        evidence_excerpt TEXT NOT NULL,
        dedupe_key TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS generated_memory_items (
        id TEXT PRIMARY KEY,
        workspace_scope_key TEXT NOT NULL,
        project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        summary TEXT NOT NULL,
        detail TEXT NOT NULL,
        authority TEXT NOT NULL,
        evidence_count INTEGER NOT NULL DEFAULT 0,
        source_candidate_ids_json TEXT NOT NULL,
        source_thread_ids_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_used_at TEXT,
        use_count INTEGER NOT NULL DEFAULT 0,
        disabled_at TEXT
      );
      CREATE TABLE IF NOT EXISTS generated_memory_evidence (
        id TEXT PRIMARY KEY,
        workspace_scope_key TEXT NOT NULL,
        project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
        candidate_id TEXT REFERENCES generated_memory_candidates(id) ON DELETE CASCADE,
        item_id TEXT REFERENCES generated_memory_items(id) ON DELETE CASCADE,
        source_thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
        source_turn_ids_json TEXT NOT NULL,
        role TEXT NOT NULL,
        excerpt TEXT NOT NULL,
        captured_at TEXT NOT NULL,
        CHECK (candidate_id IS NOT NULL OR item_id IS NOT NULL)
      );
      CREATE TABLE IF NOT EXISTS mcp_servers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        scope TEXT NOT NULL DEFAULT 'global',
        project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
        transport_type TEXT NOT NULL,
        command TEXT NOT NULL,
        args_json TEXT NOT NULL,
        cwd TEXT,
        env_json TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        tool_invocation_mode TEXT NOT NULL DEFAULT 'ask',
        launch_approved INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS mcp_server_state (
        server_id TEXT PRIMARY KEY REFERENCES mcp_servers(id) ON DELETE CASCADE,
        status TEXT NOT NULL,
        capabilities_json TEXT,
        last_seen_at TEXT,
        last_error TEXT,
        tool_count INTEGER NOT NULL DEFAULT 0,
        resource_count INTEGER NOT NULL DEFAULT 0,
        prompt_count INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_workspace_memory_files_project
        ON workspace_memory_files(project_id, kind);
      CREATE INDEX IF NOT EXISTS idx_workspace_memory_chunks_project
        ON workspace_memory_chunks(project_id, memory_file_id);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_generated_memory_candidates_scope_dedupe
        ON generated_memory_candidates(workspace_scope_key, dedupe_key);
      CREATE INDEX IF NOT EXISTS idx_generated_memory_candidates_scope_status
        ON generated_memory_candidates(workspace_scope_key, status, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_generated_memory_items_scope_disabled
        ON generated_memory_items(workspace_scope_key, disabled_at, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_generated_memory_evidence_candidate
        ON generated_memory_evidence(candidate_id);
      CREATE INDEX IF NOT EXISTS idx_generated_memory_evidence_item
        ON generated_memory_evidence(item_id);
      CREATE INDEX IF NOT EXISTS idx_generated_memory_evidence_scope
        ON generated_memory_evidence(workspace_scope_key, captured_at DESC);
      CREATE INDEX IF NOT EXISTS idx_subagents_parent_thread_created
        ON subagents(parent_thread_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_subagents_child_thread
        ON subagents(child_thread_id);
      CREATE INDEX IF NOT EXISTS idx_subagents_child_run
        ON subagents(child_run_id);
      CREATE INDEX IF NOT EXISTS idx_subagents_parent_run
        ON subagents(parent_run_id);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_autonomous_tasks_kind_source
        ON autonomous_tasks(kind, source_id);
      CREATE INDEX IF NOT EXISTS idx_autonomous_tasks_project_kind_updated
        ON autonomous_tasks(project_id, kind, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_autonomous_tasks_thread_updated
        ON autonomous_tasks(thread_id, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_mcp_servers_enabled
        ON mcp_servers(enabled, updated_at);
      CREATE INDEX IF NOT EXISTS idx_jobs_project_status
        ON jobs(project_id, status, updated_at);
      CREATE INDEX IF NOT EXISTS idx_job_runs_job
        ON job_runs(job_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_job_runs_run
        ON job_runs(run_id);
      CREATE INDEX IF NOT EXISTS idx_review_items_status
        ON review_items(status, updated_at DESC);
    `);

    this.ensureColumn(
      "threads",
      "execution_permission",
      "TEXT NOT NULL DEFAULT 'default'",
    );
    this.ensureColumn(
      "preferences",
      "default_execution_permission",
      "TEXT NOT NULL DEFAULT 'default'",
    );
    this.ensureColumn("preferences", "default_reasoning_effort_openai", "TEXT");
    this.ensureColumn("preferences", "default_reasoning_effort_gemini", "TEXT");
    this.ensureColumn(
      "preferences",
      "default_model_qwen",
      `TEXT NOT NULL DEFAULT '${DEFAULT_PREFERENCES.defaultModelByProvider.qwen}'`,
    );
    this.ensureColumn(
      "preferences",
      "default_model_ollama",
      `TEXT NOT NULL DEFAULT '${DEFAULT_PREFERENCES.defaultModelByProvider.ollama}'`,
    );
    this.ensureColumn(
      "preferences",
      "default_model_kimi",
      `TEXT NOT NULL DEFAULT '${DEFAULT_PREFERENCES.defaultModelByProvider.kimi}'`,
    );
    this.ensureColumn("preferences", "default_reasoning_effort_qwen", "TEXT");
    this.ensureColumn("preferences", "default_reasoning_effort_ollama", "TEXT");
    this.ensureColumn("preferences", "default_reasoning_effort_kimi", "TEXT");
    this.ensureColumn(
      "preferences",
      "default_thinking_openai",
      "INTEGER NOT NULL DEFAULT 0",
    );
    this.ensureColumn(
      "preferences",
      "default_thinking_gemini",
      "INTEGER NOT NULL DEFAULT 0",
    );
    this.ensureColumn(
      "preferences",
      "default_thinking_qwen",
      "INTEGER NOT NULL DEFAULT 1",
    );
    this.ensureColumn(
      "preferences",
      "default_thinking_ollama",
      "INTEGER NOT NULL DEFAULT 0",
    );
    this.ensureColumn(
      "preferences",
      "default_thinking_kimi",
      "INTEGER NOT NULL DEFAULT 0",
    );
    this.ensureColumn(
      "preferences",
      "ollama_transport_mode",
      `TEXT NOT NULL DEFAULT '${DEFAULT_PREFERENCES.ollamaTransportMode}'`,
    );
    this.ensureColumn(
      "preferences",
      "follow_up_behavior",
      `TEXT NOT NULL DEFAULT '${DEFAULT_PREFERENCES.followUpBehavior}'`,
    );
    this.ensureColumn(
      "preferences",
      "generated_memory_use_enabled",
      "INTEGER NOT NULL DEFAULT 0",
    );
    this.ensureColumn(
      "preferences",
      "generated_memory_generation_enabled",
      "INTEGER NOT NULL DEFAULT 1",
    );
    this.ensureColumn(
      "preferences",
      "appearance_mode",
      `TEXT NOT NULL DEFAULT '${DEFAULT_PREFERENCES.appearanceMode}'`,
    );
    this.ensureColumn(
      "preferences",
      "accent_mode",
      `TEXT NOT NULL DEFAULT '${DEFAULT_PREFERENCES.accentMode}'`,
    );
    this.ensureColumn("preferences", "accent_color", "TEXT");
    this.ensureColumn(
      "preferences",
      "microphone_allowed",
      "INTEGER NOT NULL DEFAULT 0",
    );
    this.ensureColumn(
      "projects",
      "default_model_qwen",
      `TEXT NOT NULL DEFAULT '${DEFAULT_PREFERENCES.defaultModelByProvider.qwen}'`,
    );
    this.ensureColumn(
      "projects",
      "default_model_ollama",
      `TEXT NOT NULL DEFAULT '${DEFAULT_PREFERENCES.defaultModelByProvider.ollama}'`,
    );
    this.ensureColumn(
      "projects",
      "default_model_kimi",
      `TEXT NOT NULL DEFAULT '${DEFAULT_PREFERENCES.defaultModelByProvider.kimi}'`,
    );
    this.ensureColumn(
      "projects",
      "runtime_command_policy",
      `TEXT NOT NULL DEFAULT '${DEFAULT_PROJECT_RUNTIME_COMMAND_POLICY}'`,
    );
    this.ensureColumn(
      "projects",
      "runtime_network_policy",
      `TEXT NOT NULL DEFAULT '${DEFAULT_PROJECT_RUNTIME_NETWORK_POLICY}'`,
    );
    this.ensureColumn("automations", "next_run_at", "TEXT");
    this.ensureColumn(
      "mcp_servers",
      "launch_approved",
      "INTEGER NOT NULL DEFAULT 0",
    );
    this.ensureColumn("mcp_servers", "scope", "TEXT NOT NULL DEFAULT 'global'");
    this.ensureColumn("mcp_servers", "project_id", "TEXT");
    this.ensureColumn("collab_rooms", "join_code", "TEXT");
    this.ensureColumn("thread_followups", "metadata_json", "TEXT");
    this.ensureColumn("subagents", "name", "TEXT NOT NULL DEFAULT 'Agent'");
    this.ensurePlannerQuestionSetCallIdIsThreadScoped();
    this.backfillSubagentNames();

    const existing = this.db
      .prepare("SELECT id FROM preferences WHERE id = 1")
      .get() as { id: number } | undefined;
    if (!existing) {
      this.db
        .prepare(
          `INSERT INTO preferences (
            id,
            selected_project_id,
            default_provider_id,
            default_model_openai,
            default_model_gemini,
            default_model_qwen,
            default_model_ollama,
            default_model_kimi,
            default_reasoning_effort_openai,
            default_reasoning_effort_gemini,
            default_reasoning_effort_qwen,
            default_reasoning_effort_ollama,
            default_reasoning_effort_kimi,
            default_thinking_openai,
            default_thinking_gemini,
            default_thinking_qwen,
            default_thinking_ollama,
            default_thinking_kimi,
            ollama_transport_mode,
            default_execution_permission,
            follow_up_behavior,
            generated_memory_use_enabled,
            generated_memory_generation_enabled,
            appearance_mode,
            accent_mode,
            accent_color,
            onboarding_complete,
            last_opened_thread_id,
            microphone_allowed
          ) VALUES (
            1,
            @selectedProjectId,
            @defaultProviderId,
            @openaiModel,
            @geminiModel,
            @qwenModel,
            @ollamaModel,
            @kimiModel,
            @openaiReasoningEffort,
            @geminiReasoningEffort,
            @qwenReasoningEffort,
            @ollamaReasoningEffort,
            @kimiReasoningEffort,
            @openaiThinking,
            @geminiThinking,
            @qwenThinking,
            @ollamaThinking,
            @kimiThinking,
            @ollamaTransportMode,
            @defaultExecutionPermission,
            @followUpBehavior,
            @generatedMemoryUseEnabled,
            @generatedMemoryGenerationEnabled,
            @appearanceMode,
            @accentMode,
            @accentColor,
            @onboardingComplete,
            @lastOpenedThreadId,
            @microphoneAllowed
          )`,
        )
        .run({
          selectedProjectId: DEFAULT_PREFERENCES.selectedProjectId,
          defaultProviderId: DEFAULT_PREFERENCES.defaultProviderId,
          openaiModel: DEFAULT_PREFERENCES.defaultModelByProvider.openai,
          geminiModel: DEFAULT_PREFERENCES.defaultModelByProvider.gemini,
          qwenModel: DEFAULT_PREFERENCES.defaultModelByProvider.qwen,
          ollamaModel: DEFAULT_PREFERENCES.defaultModelByProvider.ollama,
          kimiModel: DEFAULT_PREFERENCES.defaultModelByProvider.kimi,
          openaiReasoningEffort:
            DEFAULT_PREFERENCES.defaultReasoningEffortByProvider.openai,
          geminiReasoningEffort:
            DEFAULT_PREFERENCES.defaultReasoningEffortByProvider.gemini,
          qwenReasoningEffort:
            DEFAULT_PREFERENCES.defaultReasoningEffortByProvider.qwen,
          ollamaReasoningEffort:
            DEFAULT_PREFERENCES.defaultReasoningEffortByProvider.ollama,
          kimiReasoningEffort:
            DEFAULT_PREFERENCES.defaultReasoningEffortByProvider.kimi,
          openaiThinking: DEFAULT_PREFERENCES.defaultThinkingByProvider.openai
            ? 1
            : 0,
          geminiThinking: DEFAULT_PREFERENCES.defaultThinkingByProvider.gemini
            ? 1
            : 0,
          qwenThinking: DEFAULT_PREFERENCES.defaultThinkingByProvider.qwen
            ? 1
            : 0,
          ollamaThinking: DEFAULT_PREFERENCES.defaultThinkingByProvider.ollama
            ? 1
            : 0,
          kimiThinking: DEFAULT_PREFERENCES.defaultThinkingByProvider.kimi
            ? 1
            : 0,
          ollamaTransportMode: DEFAULT_PREFERENCES.ollamaTransportMode,
          defaultExecutionPermission:
            DEFAULT_PREFERENCES.defaultExecutionPermission,
          followUpBehavior: DEFAULT_PREFERENCES.followUpBehavior,
          generatedMemoryUseEnabled:
            DEFAULT_PREFERENCES.generatedMemoryUseEnabled ? 1 : 0,
          generatedMemoryGenerationEnabled:
            DEFAULT_PREFERENCES.generatedMemoryGenerationEnabled ? 1 : 0,
          appearanceMode: DEFAULT_PREFERENCES.appearanceMode,
          accentMode: DEFAULT_PREFERENCES.accentMode,
          accentColor: DEFAULT_PREFERENCES.accentColor,
          onboardingComplete: 0,
          lastOpenedThreadId: null,
          microphoneAllowed: 0,
        });
    }

    const collabSettings = this.db
      .prepare("SELECT id FROM collab_settings WHERE id = 1")
      .get() as { id: number } | undefined;
    if (!collabSettings) {
      this.db
        .prepare(
          `INSERT INTO collab_settings (
            id,
            supabase_url,
            supabase_anon_key,
            encrypted_session_json,
            current_user_id,
            current_email,
            session_expires_at,
            connection_state,
            last_error,
            updated_at,
            last_synced_at
          ) VALUES (
            1,
            NULL,
            NULL,
            NULL,
            NULL,
            NULL,
            NULL,
            @connectionState,
            NULL,
            @updatedAt,
            NULL
          )`,
        )
        .run({
          connectionState: DEFAULT_COLLAB_CONFIG.connectionState,
          updatedAt: new Date().toISOString(),
        });
    }

    this.seedDefaultPersonalization();

    this.seedBuiltInSkills();
    this.repairLegacyWelcomePlaceholderProjects();
    this.repairProjectTrustDefaults();
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
      .map((row) => this.mapProject(row as Row));
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
    return this.mapProject(row);
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
        .map((row) => this.mapThreadSummary(row as Row));
    }

    return this.db
      .prepare(
        `SELECT * FROM threads
         WHERE archived = 1
         ORDER BY updated_at DESC`,
      )
      .all()
      .map((row) => this.mapThreadSummary(row as Row));
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
      .map((row) => this.mapThreadFollowUp(row as Row));
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
    return this.mapThreadFollowUp(row);
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
      return claimed ? this.mapThreadFollowUp(claimed) : null;
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
      .map((row) => this.mapSubagent(row as Row));
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
    return this.mapSubagent(row);
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
    return row ? this.mapSubagent(row) : null;
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

  listVicodeBuildLaneStates(projectId: string): Array<{
    projectId: string;
    teamId: string;
    laneId: string;
    threadId: string | null;
    paused: boolean;
    updatedAt: string;
  }> {
    return this.buildControl.listVicodeBuildLaneStates(projectId);
  }

  getVicodeBuildLaneState(
    projectId: string,
    teamId: string,
    laneId: string,
  ): {
    projectId: string;
    teamId: string;
    laneId: string;
    threadId: string | null;
    paused: boolean;
    updatedAt: string;
  } {
    return this.buildControl.getVicodeBuildLaneState(projectId, teamId, laneId);
  }

  findVicodeBuildLaneByThread(threadId: string): {
    projectId: string;
    teamId: string;
    laneId: string;
    threadId: string | null;
    paused: boolean;
    updatedAt: string;
  } | null {
    return this.buildControl.findVicodeBuildLaneByThread(threadId);
  }

  saveVicodeBuildLaneState(input: {
    projectId: string;
    teamId: string;
    laneId: string;
    threadId?: string | null;
    paused?: boolean;
  }) {
    return this.buildControl.saveVicodeBuildLaneState(input);
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

  listVicodeBuildEvents(input: {
    projectId: string;
    teamId?: string;
    laneId?: string;
    limit?: number;
  }): Array<{
    id: string;
    projectId: string;
    teamId: string;
    laneId: string;
    kind: string;
    trigger: string;
    summary: string;
    detail: string | null;
    sourceLaneId: string | null;
    targetLaneId: string | null;
    threadId: string | null;
    runId: string | null;
    createdAt: string;
  }> {
    return this.buildControl.listVicodeBuildEvents(input);
  }

  addVicodeBuildEvent(input: {
    projectId: string;
    teamId: string;
    laneId: string;
    kind: string;
    trigger: string;
    summary: string;
    detail?: string | null;
    sourceLaneId?: string | null;
    targetLaneId?: string | null;
    threadId?: string | null;
    runId?: string | null;
  }) {
    return this.buildControl.addVicodeBuildEvent(input);
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
    const readSize = (path: string) =>
      existsSync(path) ? statSync(path).size : 0;
    const count = (table: string, where?: string) =>
      (
        this.db
          .prepare(
            `SELECT COUNT(*) as total FROM ${table}${where ? ` WHERE ${where}` : ""}`,
          )
          .get() as { total: number }
      ).total;
    const databaseSizeBytes = readSize(this.databasePath);
    const walSizeBytes = readSize(`${this.databasePath}-wal`);
    const shmSizeBytes = readSize(`${this.databasePath}-shm`);
    const threadCount = count("threads");
    const archivedThreadCount = count("threads", "archived = 1");
    const compactableRuns = this.listCompactableRunEvents(
      this.getRunEventCompactionCutoffIso(),
    );

    return {
      databasePath: this.databasePath,
      databaseSizeBytes,
      walSizeBytes,
      shmSizeBytes,
      totalStorageBytes: databaseSizeBytes + walSizeBytes + shmSizeBytes,
      projectCount: count("projects"),
      threadCount,
      archivedThreadCount,
      activeThreadCount: threadCount - archivedThreadCount,
      turnCount: count("thread_turns"),
      runEventCount: count("run_events"),
      compactableRunCount: compactableRuns.length,
      compactableDeltaEventCount: compactableRuns.reduce(
        (total, run) => total + run.deltaCount,
        0,
      ),
      compactionCutoffDays: RUN_EVENT_COMPACTION_CUTOFF_DAYS,
    };
  }

  compactOldTerminalRunEvents(
    _input?: Record<string, never>,
  ): StorageCompactionResult {
    const cutoffIso = this.getRunEventCompactionCutoffIso();
    const candidates = this.listCompactableRunEvents(cutoffIso);
    if (candidates.length === 0) {
      return {
        cutoffIso,
        cutoffDays: RUN_EVENT_COMPACTION_CUTOFF_DAYS,
        runsCompacted: 0,
        deltaEventsDeleted: 0,
      };
    }

    const deleteDeltaEvents = this.db.prepare(
      `DELETE FROM run_events
       WHERE thread_id = ?
         AND run_id = ?
         AND event_type = 'delta'`,
    );

    const deltaEventsDeleted = this.db.transaction(() => {
      let deleted = 0;
      for (const candidate of candidates) {
        deleted += deleteDeltaEvents.run(
          candidate.threadId,
          candidate.runId,
        ).changes;
      }
      return deleted;
    })();

    return {
      cutoffIso,
      cutoffDays: RUN_EVENT_COMPACTION_CUTOFF_DAYS,
      runsCompacted: candidates.length,
      deltaEventsDeleted,
    };
  }

  maintainStorage(input?: { vacuum?: boolean }): StorageMaintenanceResult {
    const before = this.getStorageDiagnostics();
    const compaction = this.compactOldTerminalRunEvents();
    this.db.pragma("wal_checkpoint(TRUNCATE)");

    if (input?.vacuum) {
      this.db.exec("VACUUM");
    }

    const after = this.getStorageDiagnostics();
    return {
      ...compaction,
      vacuumApplied: input?.vacuum === true,
      sizeBeforeBytes: before.totalStorageBytes,
      sizeAfterBytes: after.totalStorageBytes,
      reclaimedBytes: Math.max(
        0,
        before.totalStorageBytes - after.totalStorageBytes,
      ),
    };
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

  isWorkspaceBootstrapDismissed(projectId: string) {
    const row = this.db
      .prepare(
        "SELECT dismissed_at FROM workspace_bootstrap_dismissals WHERE project_id = ?",
      )
      .get(projectId) as Row | undefined;
    return Boolean(row?.dismissed_at);
  }

  dismissWorkspaceBootstrap(projectId: string) {
    this.getProject(projectId);
    this.db
      .prepare(
        `INSERT INTO workspace_bootstrap_dismissals (project_id, dismissed_at)
         VALUES (@projectId, @dismissedAt)
         ON CONFLICT(project_id) DO UPDATE SET dismissed_at = excluded.dismissed_at`,
      )
      .run({
        projectId,
        dismissedAt: new Date().toISOString(),
      });
  }

  clearWorkspaceBootstrapDismissal(projectId: string) {
    this.db
      .prepare(
        "DELETE FROM workspace_bootstrap_dismissals WHERE project_id = ?",
      )
      .run(projectId);
  }

  getPersonalization(): PersonalizationSettings {
    return this.settings.getPersonalization();
  }

  savePersonalization(input: Partial<PersonalizationSettings>): PersonalizationSettings {
    return this.settings.savePersonalization(input);
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

  private getRunEventCompactionCutoffIso() {
    return new Date(
      Date.now() - RUN_EVENT_COMPACTION_CUTOFF_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString();
  }

  private listCompactableRunEvents(cutoffIso: string) {
    return this.db
      .prepare(
        `SELECT
          events.thread_id AS thread_id,
          events.run_id AS run_id,
          SUM(CASE WHEN events.event_type = 'delta' THEN 1 ELSE 0 END) AS delta_count
         FROM run_events events
         INNER JOIN threads thread ON thread.id = events.thread_id
         LEFT JOIN thread_planner_state planner ON planner.thread_id = thread.id
         WHERE thread.archived = 1
           AND COALESCE(planner.turn_state, 'idle') = 'idle'
           AND NOT EXISTS (
             SELECT 1
             FROM jobs job
             INNER JOIN review_items review ON review.job_id = job.id
             WHERE job.thread_id = events.thread_id
               AND review.status = 'pending'
           )
         GROUP BY events.thread_id, events.run_id
         HAVING SUM(CASE WHEN events.event_type = 'delta' THEN 1 ELSE 0 END) > 0
            AND SUM(CASE WHEN events.event_type IN ('completed', 'failed', 'aborted') THEN 1 ELSE 0 END) > 0
            AND MAX(events.created_at) < @cutoffIso`,
      )
      .all({ cutoffIso })
      .map((row) => ({
        threadId: String((row as Row).thread_id),
        runId: String((row as Row).run_id),
        deltaCount: Number((row as Row).delta_count ?? 0),
      }));
  }

  private seedBuiltInSkills() {
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

  private repairLegacyWelcomePlaceholderProjects() {
    const placeholderIds = (
      this.db
        .prepare(
          `SELECT projects.id
             FROM projects
             LEFT JOIN threads ON threads.project_id = projects.id
            WHERE projects.name = 'My Project'
              AND projects.folder_path IS NULL
            GROUP BY projects.id
           HAVING COUNT(threads.id) = 0`,
        )
        .all() as Array<{ id: string }>
    ).map((row) => String(row.id));

    if (placeholderIds.length === 0) {
      return;
    }

    const removePlaceholderProjects = this.db.transaction(
      (projectIds: string[]) => {
        const deleteProject = this.db.prepare(
          "DELETE FROM projects WHERE id = ?",
        );
        for (const projectId of projectIds) {
          deleteProject.run(projectId);
        }
      },
    );

    removePlaceholderProjects(placeholderIds);
    this.getPreferences();
  }

  private repairProjectTrustDefaults() {
    this.db.prepare('UPDATE projects SET trusted = 1 WHERE trusted = 0').run();
  }

  private seedDefaultPersonalization() {
    if (
      (
        this.db
          .prepare("SELECT COUNT(*) as count FROM personalization")
          .get() as { count: number }
      ).count > 0
    ) {
      return;
    }

    this.savePersonalization(DEFAULT_PERSONALIZATION);
  }

  private mapCollabProfile(row: Row): CollabProfile {
    return {
      id: String(row.id),
      email: (row.email as string | null) ?? null,
      displayName: String(row.display_name),
      handle: (row.handle as string | null) ?? null,
      avatarUrl: (row.avatar_url as string | null) ?? null,
      status: row.status as CollabProfile["status"],
      bio: (row.bio as string | null) ?? null,
      timezone: (row.timezone as string | null) ?? null,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  private mapCollabRoom(row: Row): CollabRoom {
    return {
      id: String(row.id),
      type: row.type as CollabRoom["type"],
      name: String(row.name),
      joinCode: (row.join_code as string | null) ?? null,
      slug: (row.slug as string | null) ?? null,
      topic: (row.topic as string | null) ?? null,
      projectLabel: (row.project_label as string | null) ?? null,
      directUserId: (row.direct_user_id as string | null) ?? null,
      unreadCount: Number(row.unread_count ?? 0),
      memberCount: Number(row.member_count ?? 0),
      lastActivityAt: String(row.last_activity_at),
      lastMessagePreview: (row.last_message_preview as string | null) ?? null,
      createdBy: (row.created_by as string | null) ?? null,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  private mapCollabRoomMember(row: Row): CollabRoomMember {
    return {
      roomId: String(row.room_id),
      userId: String(row.user_id),
      role: row.role as CollabRoomMember["role"],
      membershipState:
        row.membership_state as CollabRoomMember["membershipState"],
      joinedAt: (row.joined_at as string | null) ?? null,
      displayName: String(row.display_name),
      handle: (row.handle as string | null) ?? null,
      avatarUrl: (row.avatar_url as string | null) ?? null,
      status: row.status as CollabRoomMember["status"],
    };
  }

  private mapCollabInvite(row: Row) {
    return {
      id: String(row.id),
      roomId: String(row.room_id),
      code: String(row.code),
      status: row.status as "active" | "redeemed" | "expired" | "revoked",
      createdBy: String(row.created_by),
      createdAt: String(row.created_at),
      expiresAt: (row.expires_at as string | null) ?? null,
    };
  }

  private mapCollabMessage(row: Row): CollabMessage {
    return {
      id: String(row.id),
      roomId: String(row.room_id),
      authorId: String(row.author_id),
      authorDisplayName: String(row.display_name),
      authorHandle: (row.handle as string | null) ?? null,
      body: String(row.body),
      createdAt: String(row.created_at),
    };
  }

  private mapCollabPresence(row: Row): CollabPresence {
    return {
      roomId: String(row.room_id),
      userId: String(row.user_id),
      status: row.status as CollabPresence["status"],
      currentThreadId: (row.current_thread_id as string | null) ?? null,
      currentThreadTitle: (row.current_thread_title as string | null) ?? null,
      branchName: (row.branch_name as string | null) ?? null,
      worktreeName: (row.worktree_name as string | null) ?? null,
      activeRunId: (row.active_run_id as string | null) ?? null,
      activeRunTitle: (row.active_run_title as string | null) ?? null,
      dirtyFileCount: Number(row.dirty_file_count ?? 0),
      stagedFileCount: Number(row.staged_file_count ?? 0),
      updatedAt: String(row.updated_at),
    };
  }

  private mapCollabSharedThread(row: Row): CollabSharedThread {
    return {
      id: String(row.id),
      roomId: String(row.room_id),
      threadId: String(row.thread_id),
      projectId: (row.project_id as string | null) ?? null,
      projectLabel: (row.project_label as string | null) ?? null,
      title: String(row.title),
      status: row.status as CollabSharedThread["status"],
      driverUserId: String(row.driver_user_id),
      driverDisplayName: String(row.display_name),
      providerId: row.provider_id as ProviderId,
      modelId: String(row.model_id),
      lastPromptSummary: (row.last_prompt_summary as string | null) ?? null,
      latestAssistantSummary:
        (row.latest_assistant_summary as string | null) ?? null,
      runId: (row.run_id as string | null) ?? null,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  private mapCollabSharedRun(row: Row): CollabSharedRun {
    return {
      id: String(row.id),
      roomId: String(row.room_id),
      threadId: String(row.thread_id),
      threadTitle: String(row.thread_title),
      runId: String(row.run_id),
      driverUserId: String(row.driver_user_id),
      driverDisplayName: String(row.display_name),
      providerId: row.provider_id as ProviderId,
      modelId: String(row.model_id),
      executionPermission: row.execution_permission as ExecutionPermission,
      status: row.status as CollabSharedRun["status"],
      taskTitle: (row.task_title as string | null) ?? null,
      summary: (row.summary as string | null) ?? null,
      changedFiles: JSON.parse(String(row.changed_files_json)) as string[],
      diffStats: row.diff_stats_json
        ? (JSON.parse(
            String(row.diff_stats_json),
          ) as CollabSharedRun["diffStats"])
        : null,
      testsSummary: (row.tests_summary as string | null) ?? null,
      resultLabel: (row.result_label as string | null) ?? null,
      startedAt: String(row.started_at),
      updatedAt: String(row.updated_at),
      completedAt: (row.completed_at as string | null) ?? null,
    };
  }

  private mapCollabHandoff(row: Row): CollabHandoff {
    return {
      id: String(row.id),
      roomId: String(row.room_id),
      threadId: String(row.thread_id),
      runId: (row.run_id as string | null) ?? null,
      authorUserId: String(row.author_user_id),
      authorDisplayName: String(row.display_name),
      title: String(row.title),
      summary: String(row.summary),
      branchName: (row.branch_name as string | null) ?? null,
      dirtyFileCount: Number(row.dirty_file_count ?? 0),
      stagedFileCount: Number(row.staged_file_count ?? 0),
      changedFiles: JSON.parse(String(row.changed_files_json)) as string[],
      outstandingTasks: JSON.parse(
        String(row.outstanding_tasks_json),
      ) as string[],
      recommendedNextPrompt:
        (row.recommended_next_prompt as string | null) ?? null,
      createdAt: String(row.created_at),
    };
  }

  private mapCollabRoomFollower(row: Row): CollabRoomFollower {
    return {
      roomId: String(row.room_id),
      userId: String(row.user_id),
      displayName: String(row.display_name),
      handle: (row.handle as string | null) ?? null,
      avatarUrl: (row.avatar_url as string | null) ?? null,
      status: row.status as CollabRoomFollower["status"],
      createdAt: String(row.created_at),
    };
  }

  private mapCollabRoleRequest(row: Row): CollabRoleRequest {
    return {
      id: String(row.id),
      roomId: String(row.room_id),
      requesterUserId: String(row.requester_user_id),
      requesterDisplayName: String(row.display_name),
      requesterHandle: (row.handle as string | null) ?? null,
      requestedRole: row.requested_role as CollabRoleRequest["requestedRole"],
      status: row.status as CollabRoleRequest["status"],
      resolvedByUserId: (row.resolved_by_user_id as string | null) ?? null,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  private mapCollabRoomTerminalState(row: Row): CollabRoomTerminalState {
    return {
      roomId: String(row.room_id),
      mode: row.mode as CollabRoomTerminalState["mode"],
      enabledByUserId: (row.enabled_by_user_id as string | null) ?? null,
      enabledByDisplayName: (row.display_name as string | null) ?? null,
      note: (row.note as string | null) ?? null,
      updatedAt: String(row.updated_at),
    };
  }

  private mapProject(row: Row): Project {
    return {
      id: String(row.id),
      name: String(row.name),
      folderPath: (row.folder_path as string | null) ?? null,
      trusted: Boolean(row.trusted),
      runtimeCommandPolicy:
        (row.runtime_command_policy as ProjectRuntimeCommandPolicy | null) ??
        DEFAULT_PROJECT_RUNTIME_COMMAND_POLICY,
      runtimeNetworkPolicy:
        (row.runtime_network_policy as ProjectRuntimeNetworkPolicy | null) ??
        DEFAULT_PROJECT_RUNTIME_NETWORK_POLICY,
      defaultProviderId: row.default_provider_id as ProviderId,
      defaultModelByProvider: createProviderRecord((providerId) => {
        const value = row[`default_model_${providerId}`];
        return typeof value === "string" && value.trim()
          ? value
          : DEFAULT_PREFERENCES.defaultModelByProvider[providerId];
      }),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  private mapGeneratedMemoryCandidate(row: Row): GeneratedMemoryCandidate {
    return {
      id: String(row.id),
      workspaceScopeKey: String(row.workspace_scope_key),
      projectId: (row.project_id as string | null) ?? null,
      sourceThreadId: String(row.source_thread_id),
      sourceRunId: (row.source_run_id as string | null) ?? null,
      sourceTurnIds: JSON.parse(String(row.source_turn_ids_json)) as string[],
      kind: row.kind as GeneratedMemoryCandidateKind,
      summary: String(row.summary),
      detail: String(row.detail),
      evidenceExcerpt: String(row.evidence_excerpt),
      dedupeKey: String(row.dedupe_key),
      status: row.status as GeneratedMemoryCandidateStatus,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  private mapGeneratedMemoryItem(row: Row): GeneratedMemoryItem {
    return {
      id: String(row.id),
      workspaceScopeKey: String(row.workspace_scope_key),
      projectId: (row.project_id as string | null) ?? null,
      kind: row.kind as GeneratedMemoryCandidateKind,
      summary: String(row.summary),
      detail: String(row.detail),
      authority: row.authority as GeneratedMemoryItemAuthority,
      evidenceCount: Number(row.evidence_count ?? 0),
      sourceCandidateIds: JSON.parse(
        String(row.source_candidate_ids_json),
      ) as string[],
      sourceThreadIds: JSON.parse(
        String(row.source_thread_ids_json),
      ) as string[],
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
      lastUsedAt: (row.last_used_at as string | null) ?? null,
      useCount: Number(row.use_count ?? 0),
      disabledAt: (row.disabled_at as string | null) ?? null,
    };
  }

  private mapGeneratedMemoryEvidence(row: Row): GeneratedMemoryEvidence {
    return {
      id: String(row.id),
      workspaceScopeKey: String(row.workspace_scope_key),
      projectId: (row.project_id as string | null) ?? null,
      candidateId: (row.candidate_id as string | null) ?? null,
      itemId: (row.item_id as string | null) ?? null,
      sourceThreadId: String(row.source_thread_id),
      sourceTurnIds: JSON.parse(String(row.source_turn_ids_json)) as string[],
      role: row.role as GeneratedMemoryEvidence["role"],
      excerpt: String(row.excerpt),
      capturedAt: String(row.captured_at),
    };
  }

  private mapThreadSummary(row: Row): ThreadSummary {
    return {
      id: String(row.id),
      projectId: String(row.project_id),
      title: String(row.title),
      providerId: row.provider_id as ProviderId,
      modelId: String(row.model_id),
      executionPermission:
        ((row.execution_permission as ExecutionPermission | null) ??
          "default") as ExecutionPermission,
      status: row.status as ThreadSummary["status"],
      archived: Boolean(row.archived),
      lastMessageAt: String(row.last_message_at),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
      lastPreview: String((row.last_preview as string | null) ?? ""),
    };
  }

  private ensureColumn(
    tableName: string,
    columnName: string,
    definition: string,
  ) {
    const columns = this.db
      .prepare(`PRAGMA table_info(${tableName})`)
      .all() as Array<{ name?: string }>;
    if (columns.some((column) => column.name === columnName)) {
      return;
    }
    this.db.exec(
      `ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`,
    );
  }

  private allocateSubagentName(parentThreadId: string) {
    return pickNextSubagentName(
      this.listSubagentsByParentThread(parentThreadId).map(
        (subagent) => subagent.name,
      ),
    );
  }

  private backfillSubagentNames() {
    const rows = this.db
      .prepare(
        `SELECT id, parent_thread_id, name, created_at
         FROM subagents
         ORDER BY parent_thread_id ASC, created_at ASC`,
      )
      .all() as Array<{
      id: string;
      parent_thread_id: string;
      name?: string | null;
      created_at: string;
    }>;
    const takenNamesByThread = new Map<string, string[]>();
    const update = this.db.prepare(
      "UPDATE subagents SET name = ? WHERE id = ?",
    );

    for (const row of rows) {
      const current = (row.name ?? "").trim();
      const taken = takenNamesByThread.get(row.parent_thread_id) ?? [];
      const resolvedName =
        current && current !== "Agent" ? current : pickNextSubagentName(taken);
      taken.push(resolvedName);
      takenNamesByThread.set(row.parent_thread_id, taken);
      if (resolvedName !== current) {
        update.run(resolvedName, row.id);
      }
    }
  }

  private ensurePlannerQuestionSetCallIdIsThreadScoped() {
    const tableSql = this.db
      .prepare(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'planner_question_sets'",
      )
      .get() as { sql?: string } | undefined;
    if (
      !tableSql?.sql ||
      !/call_id\s+TEXT\s+NOT\s+NULL\s+UNIQUE/i.test(tableSql.sql)
    ) {
      this.db
        .prepare(
          "CREATE INDEX IF NOT EXISTS idx_planner_question_sets_thread_call ON planner_question_sets(thread_id, call_id)",
        )
        .run();
      return;
    }

    this.db.transaction(() => {
      this.db.exec(`
        CREATE TABLE planner_question_sets_new (
          question_set_id TEXT PRIMARY KEY,
          thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
          prompt_turn_id TEXT NOT NULL REFERENCES thread_turns(id) ON DELETE CASCADE,
          call_id TEXT NOT NULL,
          questions_json TEXT NOT NULL,
          answers_json TEXT,
          created_at TEXT NOT NULL
        );
        INSERT INTO planner_question_sets_new (
          question_set_id, thread_id, prompt_turn_id, call_id, questions_json, answers_json, created_at
        )
        SELECT question_set_id, thread_id, prompt_turn_id, call_id, questions_json, answers_json, created_at
        FROM planner_question_sets;
        DROP TABLE planner_question_sets;
        ALTER TABLE planner_question_sets_new RENAME TO planner_question_sets;
        CREATE INDEX idx_planner_question_sets_thread_call ON planner_question_sets(thread_id, call_id);
      `);
    })();
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
        ? this.mapPlannerPlan(
            this.db
              .prepare("SELECT * FROM planner_plans WHERE plan_id = ?")
              .get(activePlanId) as Row,
          )
        : null;
    const pendingQuestionSet = pendingQuestionRow
      ? this.mapPlannerQuestionSet(pendingQuestionRow)
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

  private mapTurn(row: Row): ThreadTurn {
    const metadata = row.metadata_json
      ? (JSON.parse(String(row.metadata_json)) as Record<string, unknown>)
      : null;
    return {
      id: String(row.id),
      threadId: String(row.thread_id),
      runId: (row.run_id as string | null) ?? null,
      role: row.role as ThreadTurn["role"],
      content: String(row.content),
      sources: metadata ? normalizeThreadSources(metadata.sources) : [],
      metadata,
      createdAt: String(row.created_at),
    };
  }

  private mapRunEvent(row: Row): RunEvent {
    return {
      id: String(row.id),
      threadId: String(row.thread_id),
      runId: String(row.run_id),
      eventType: row.event_type as RunEvent["eventType"],
      payload: JSON.parse(String(row.payload_json)) as Record<string, unknown>,
      createdAt: String(row.created_at),
    };
  }

  private mapThreadFollowUp(row: Row): ThreadFollowUp {
    return {
      id: String(row.id),
      threadId: String(row.thread_id),
      content: String(row.content),
      metadata: row.metadata_json
        ? (JSON.parse(String(row.metadata_json)) as Record<string, unknown>)
        : null,
      kind: row.kind as ThreadFollowUpKind,
      status: row.status as ThreadFollowUpStatus,
      priority: Number(row.priority ?? 0),
      targetRunId: (row.target_run_id as string | null) ?? null,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
      dispatchedAt: (row.dispatched_at as string | null) ?? null,
      cancelledAt: (row.cancelled_at as string | null) ?? null,
    };
  }

  private mapSubagent(row: Row): SubagentSummary {
    return {
      id: String(row.id),
      parentThreadId: String(row.parent_thread_id),
      parentRunId: (row.parent_run_id as string | null) ?? null,
      childThreadId: (row.child_thread_id as string | null) ?? null,
      childRunId: (row.child_run_id as string | null) ?? null,
      name:
        typeof row.name === "string" && row.name.trim() ? row.name : "Agent",
      title: String(row.title),
      prompt: String(row.prompt),
      providerId: row.provider_id as ProviderId,
      modelId: String(row.model_id),
      executionPermission: row.execution_permission as ExecutionPermission,
      delegationProfile:
        row.delegation_profile as SubagentSummary["delegationProfile"],
      status: row.status as SubagentSummary["status"],
      outputSummary: (row.output_summary as string | null) ?? null,
      lastError: (row.last_error as string | null) ?? null,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
      startedAt: (row.started_at as string | null) ?? null,
      completedAt: (row.completed_at as string | null) ?? null,
    };
  }

  private mapAutonomousTask(row: Row): AutonomousTaskRecord {
    return {
      id: String(row.id),
      kind: row.kind as AutonomousTaskRecord["kind"],
      projectId: String(row.project_id),
      threadId: (row.thread_id as string | null) ?? null,
      runId: (row.run_id as string | null) ?? null,
      sourceId: String(row.source_id),
      title: String(row.title),
      summary: String(row.summary),
      ownerLabel: String(row.owner_label),
      provenanceLabel: String(row.provenance_label),
      trustLabel: (row.trust_label as string | null) ?? null,
      approvalLabel: (row.approval_label as string | null) ?? null,
      status: row.status as AutonomousTaskRecord["status"],
      statusLabel: String(row.status_label),
      blockedBy: (row.blocked_by as string | null) ?? null,
      blocking: (row.blocking as string | null) ?? null,
      lastError: (row.last_error as string | null) ?? null,
      metadata: row.metadata_json
        ? (JSON.parse(String(row.metadata_json)) as Record<string, unknown>)
        : {},
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
      startedAt: (row.started_at as string | null) ?? null,
      completedAt: (row.completed_at as string | null) ?? null,
    };
  }

  private mapPlannerQuestionSet(row: Row): PlannerQuestionSet {
    return {
      id: String(row.question_set_id),
      threadId: String(row.thread_id),
      promptTurnId: String(row.prompt_turn_id),
      callId: String(row.call_id),
      questions: JSON.parse(
        String(row.questions_json),
      ) as PlannerQuestionSet["questions"],
      answers: row.answers_json
        ? (JSON.parse(String(row.answers_json)) as Record<
            string,
            PlannerQuestionAnswer
          >)
        : null,
      createdAt: String(row.created_at),
    };
  }

  private mapPlannerPlan(row: Row): PlannerPlan {
    return {
      id: String(row.plan_id),
      threadId: String(row.thread_id),
      createdTurnId: String(row.created_turn_id),
      proposedPlanMarkdown: String(row.proposed_plan_markdown),
      structuredPlan: row.structured_plan_json
        ? (JSON.parse(
            String(row.structured_plan_json),
          ) as StructuredPlannerPlan)
        : null,
      status: row.status as PlannerPlanStatus,
      createdAt: String(row.created_at),
    };
  }

  private mapProviderAccount(row: Row): ProviderAccount {
    return {
      providerId: row.provider_id as ProviderId,
      authState: row.auth_state as ProviderAccount["authState"],
      authMode: (row.auth_mode as ProviderAccount["authMode"]) ?? null,
      encryptedApiKey: (row.encrypted_api_key as string | null) ?? null,
      updatedAt: String(row.updated_at),
    };
  }

  private mapProviderModel(row: Row): ProviderModel {
    return {
      id: String(row.model_id),
      label: String(row.label),
      description: String(row.description),
      supportsVision: Boolean(row.supports_vision),
    };
  }

  private mapSkill(row: Row): SkillDefinition {
    return {
      id: String(row.id),
      name: String(row.name),
      description: String(row.description),
      instructions: String(row.instructions),
      origin: row.origin as SkillDefinition["origin"],
      scope: row.scope as SkillDefinition["scope"],
      providerTargets: JSON.parse(
        String(row.provider_targets_json),
      ) as SkillDefinition["providerTargets"],
      enabled: Boolean(row.enabled),
      projectId: (row.project_id as string | null) ?? null,
      metadata: JSON.parse(String(row.metadata_json)) as Record<
        string,
        unknown
      >,
      path: (row.path as string | null) ?? null,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  private mapAutomation(row: Row): AutomationDefinition {
    return {
      id: String(row.id),
      name: String(row.name),
      projectId: String(row.project_id),
      providerId: row.provider_id as ProviderId,
      modelId: String(row.model_id),
      promptTemplate: String(row.prompt_template),
      skillId: (row.skill_id as string | null) ?? null,
      enabled: Boolean(row.enabled),
      scheduleType: row.schedule_type as AutomationDefinition["scheduleType"],
      intervalMinutes: (row.interval_minutes as number | null) ?? null,
      lastRunAt: (row.last_run_at as string | null) ?? null,
      nextRunAt: (row.next_run_at as string | null) ?? null,
      status: row.status as AutomationDefinition["status"],
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
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

  private mapJob(row: Row): JobDefinition {
    return {
      id: String(row.id),
      projectId: String(row.project_id),
      sourceType: row.source_type as JobDefinition["sourceType"],
      sourceId: (row.source_id as string | null) ?? null,
      title: String(row.title),
      status: row.status as JobDefinition["status"],
      threadId: (row.thread_id as string | null) ?? null,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  private mapJobRun(row: Row): JobRun {
    return {
      id: String(row.id),
      jobId: String(row.job_id),
      providerId: (row.provider_id as ProviderId | null) ?? null,
      modelId: (row.model_id as string | null) ?? null,
      status: row.status as JobRun["status"],
      runId: (row.run_id as string | null) ?? null,
      checkpoint: row.checkpoint_json
        ? (JSON.parse(String(row.checkpoint_json)) as Record<string, unknown>)
        : null,
      startedAt: (row.started_at as string | null) ?? null,
      finishedAt: (row.finished_at as string | null) ?? null,
      createdAt: String(row.created_at),
    };
  }

  private mapReviewItem(row: Row): ReviewItem {
    return {
      id: String(row.id),
      jobId: String(row.job_id),
      jobRunId: (row.job_run_id as string | null) ?? null,
      kind: row.kind as ReviewItem["kind"],
      status: row.status as ReviewItem["status"],
      summary: String(row.summary),
      details: JSON.parse(String(row.details_json)) as Record<string, unknown>,
      decision: row.decision_json
        ? (JSON.parse(String(row.decision_json)) as Record<string, unknown>)
        : null,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  private mapMcpServerDefinition(row: Row): McpServerDefinition {
    return {
      id: String(row.id),
      name: String(row.name),
      scope: (row.scope as McpServerDefinition["scope"] | null) ?? "global",
      projectId: (row.project_id as string | null) ?? null,
      transportType: row.transport_type as McpServerDefinition["transportType"],
      command: String(row.command),
      args: JSON.parse(String(row.args_json)) as string[],
      cwd: (row.cwd as string | null) ?? null,
      env: JSON.parse(String(row.env_json)) as Record<string, string>,
      enabled: Boolean(row.enabled),
      toolInvocationMode:
        row.tool_invocation_mode as McpServerDefinition["toolInvocationMode"],
      launchApproved: Boolean(row.launch_approved),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  private mapMcpServerRecord(row: Row): McpServerRecord {
    return {
      definition: this.mapMcpServerDefinition(row),
      state: row.state_server_id
        ? {
            serverId: String(row.state_server_id),
            status: row.state_status as McpServerState["status"],
            capabilities: row.state_capabilities_json
              ? (JSON.parse(String(row.state_capabilities_json)) as Record<
                  string,
                  unknown
                >)
              : null,
            lastSeenAt: (row.state_last_seen_at as string | null) ?? null,
            lastError: (row.state_last_error as string | null) ?? null,
            toolCount: Number(row.state_tool_count ?? 0),
            resourceCount: Number(row.state_resource_count ?? 0),
            promptCount: Number(row.state_prompt_count ?? 0),
            updatedAt: String(row.state_updated_at),
          }
        : null,
    };
  }
}
