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
import type {
  AutonomousTaskRecord,
  AppearanceMode,
  AutomationDefinition,
  AutomationRun,
  AutomationSaveInput,
  BootstrapData,
  CollabAccount,
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
  ThreadTurn
} from '../shared/domain';

const DEFAULT_PREFERENCES: Preferences = {
  selectedProjectId: null,
  defaultProviderId: 'openai',
  defaultModelByProvider: createProviderRecord((providerId) => getProviderMetadata(providerId).defaultModelId),
  defaultReasoningEffortByProvider: createProviderRecord((providerId) => getProviderMetadata(providerId).defaultReasoningEffort),
  defaultThinkingByProvider: createProviderRecord((providerId) => getProviderMetadata(providerId).defaultThinking),
  ollamaTransportMode: 'chat',
  defaultExecutionPermission: 'default',
  followUpBehavior: 'queue',
  generatedMemoryUseEnabled: false,
  generatedMemoryGenerationEnabled: true,
  appearanceMode: 'system',
  accentMode: 'system',
  accentColor: null,
  onboardingComplete: false,
  lastOpenedThreadId: null,
  microphoneAllowed: false
};

const DEFAULT_PERSONALIZATION: PersonalizationSettings = {
  globalInstructions: '',
  providerInstructions: createProviderRecord(() => ''),
  useWorkspaceInstructions: true
};

const DEFAULT_PROJECT_RUNTIME_COMMAND_POLICY: ProjectRuntimeCommandPolicy =
  'approval_required';
const DEFAULT_PROJECT_RUNTIME_NETWORK_POLICY: ProjectRuntimeNetworkPolicy =
  'disabled';

const DEFAULT_COLLAB_CONFIG: CollabConfig = {
  supabaseUrl: null,
  hasAnonKey: false,
  connectionState: 'unconfigured',
  lastError: null
};

const DEFAULT_COLLAB_ACCOUNT: CollabAccount = {
  email: null,
  userId: null,
  expiresAt: null
};

const RUN_EVENT_COMPACTION_CUTOFF_DAYS = 30;

type Row = Record<string, unknown>;

export class DatabaseService {
  private readonly db: Database.Database;
  private readonly databasePath: string;

  constructor(databasePath: string) {
    this.databasePath = databasePath;
    mkdirSync(dirname(databasePath), { recursive: true });
    this.db = new Database(databasePath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
  }

  migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        folder_path TEXT,
        trusted INTEGER NOT NULL DEFAULT 0,
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

    this.ensureColumn('threads', 'execution_permission', "TEXT NOT NULL DEFAULT 'default'");
    this.ensureColumn('preferences', 'default_execution_permission', "TEXT NOT NULL DEFAULT 'default'");
    this.ensureColumn('preferences', 'default_reasoning_effort_openai', 'TEXT');
    this.ensureColumn('preferences', 'default_reasoning_effort_gemini', 'TEXT');
    this.ensureColumn('preferences', 'default_model_qwen', `TEXT NOT NULL DEFAULT '${DEFAULT_PREFERENCES.defaultModelByProvider.qwen}'`);
    this.ensureColumn('preferences', 'default_model_ollama', `TEXT NOT NULL DEFAULT '${DEFAULT_PREFERENCES.defaultModelByProvider.ollama}'`);
    this.ensureColumn('preferences', 'default_model_kimi', `TEXT NOT NULL DEFAULT '${DEFAULT_PREFERENCES.defaultModelByProvider.kimi}'`);
    this.ensureColumn('preferences', 'default_reasoning_effort_qwen', 'TEXT');
    this.ensureColumn('preferences', 'default_reasoning_effort_ollama', 'TEXT');
    this.ensureColumn('preferences', 'default_reasoning_effort_kimi', 'TEXT');
    this.ensureColumn('preferences', 'default_thinking_openai', 'INTEGER NOT NULL DEFAULT 0');
    this.ensureColumn('preferences', 'default_thinking_gemini', 'INTEGER NOT NULL DEFAULT 0');
    this.ensureColumn('preferences', 'default_thinking_qwen', 'INTEGER NOT NULL DEFAULT 1');
    this.ensureColumn('preferences', 'default_thinking_ollama', 'INTEGER NOT NULL DEFAULT 0');
    this.ensureColumn('preferences', 'default_thinking_kimi', 'INTEGER NOT NULL DEFAULT 0');
    this.ensureColumn('preferences', 'ollama_transport_mode', `TEXT NOT NULL DEFAULT '${DEFAULT_PREFERENCES.ollamaTransportMode}'`);
    this.ensureColumn('preferences', 'follow_up_behavior', `TEXT NOT NULL DEFAULT '${DEFAULT_PREFERENCES.followUpBehavior}'`);
    this.ensureColumn('preferences', 'generated_memory_use_enabled', 'INTEGER NOT NULL DEFAULT 0');
    this.ensureColumn('preferences', 'generated_memory_generation_enabled', 'INTEGER NOT NULL DEFAULT 1');
    this.ensureColumn('preferences', 'appearance_mode', `TEXT NOT NULL DEFAULT '${DEFAULT_PREFERENCES.appearanceMode}'`);
    this.ensureColumn('preferences', 'accent_mode', `TEXT NOT NULL DEFAULT '${DEFAULT_PREFERENCES.accentMode}'`);
    this.ensureColumn('preferences', 'accent_color', 'TEXT');
    this.ensureColumn('preferences', 'microphone_allowed', 'INTEGER NOT NULL DEFAULT 0');
    this.ensureColumn('projects', 'default_model_qwen', `TEXT NOT NULL DEFAULT '${DEFAULT_PREFERENCES.defaultModelByProvider.qwen}'`);
    this.ensureColumn('projects', 'default_model_ollama', `TEXT NOT NULL DEFAULT '${DEFAULT_PREFERENCES.defaultModelByProvider.ollama}'`);
    this.ensureColumn('projects', 'default_model_kimi', `TEXT NOT NULL DEFAULT '${DEFAULT_PREFERENCES.defaultModelByProvider.kimi}'`);
    this.ensureColumn('projects', 'runtime_command_policy', `TEXT NOT NULL DEFAULT '${DEFAULT_PROJECT_RUNTIME_COMMAND_POLICY}'`);
    this.ensureColumn('projects', 'runtime_network_policy', `TEXT NOT NULL DEFAULT '${DEFAULT_PROJECT_RUNTIME_NETWORK_POLICY}'`);
    this.ensureColumn('automations', 'next_run_at', 'TEXT');
    this.ensureColumn('mcp_servers', 'launch_approved', 'INTEGER NOT NULL DEFAULT 0');
    this.ensureColumn('mcp_servers', 'scope', "TEXT NOT NULL DEFAULT 'global'");
    this.ensureColumn('mcp_servers', 'project_id', 'TEXT');
    this.ensureColumn('collab_rooms', 'join_code', 'TEXT');
    this.ensureColumn('thread_followups', 'metadata_json', 'TEXT');
    this.ensureColumn('subagents', 'name', "TEXT NOT NULL DEFAULT 'Agent'");
    this.ensurePlannerQuestionSetCallIdIsThreadScoped();
    this.backfillSubagentNames();

    const existing = this.db.prepare('SELECT id FROM preferences WHERE id = 1').get() as { id: number } | undefined;
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
          )`
        )
        .run({
          selectedProjectId: DEFAULT_PREFERENCES.selectedProjectId,
          defaultProviderId: DEFAULT_PREFERENCES.defaultProviderId,
          openaiModel: DEFAULT_PREFERENCES.defaultModelByProvider.openai,
          geminiModel: DEFAULT_PREFERENCES.defaultModelByProvider.gemini,
          qwenModel: DEFAULT_PREFERENCES.defaultModelByProvider.qwen,
          ollamaModel: DEFAULT_PREFERENCES.defaultModelByProvider.ollama,
          kimiModel: DEFAULT_PREFERENCES.defaultModelByProvider.kimi,
          openaiReasoningEffort: DEFAULT_PREFERENCES.defaultReasoningEffortByProvider.openai,
          geminiReasoningEffort: DEFAULT_PREFERENCES.defaultReasoningEffortByProvider.gemini,
          qwenReasoningEffort: DEFAULT_PREFERENCES.defaultReasoningEffortByProvider.qwen,
          ollamaReasoningEffort: DEFAULT_PREFERENCES.defaultReasoningEffortByProvider.ollama,
          kimiReasoningEffort: DEFAULT_PREFERENCES.defaultReasoningEffortByProvider.kimi,
          openaiThinking: DEFAULT_PREFERENCES.defaultThinkingByProvider.openai ? 1 : 0,
          geminiThinking: DEFAULT_PREFERENCES.defaultThinkingByProvider.gemini ? 1 : 0,
          qwenThinking: DEFAULT_PREFERENCES.defaultThinkingByProvider.qwen ? 1 : 0,
          ollamaThinking: DEFAULT_PREFERENCES.defaultThinkingByProvider.ollama ? 1 : 0,
          kimiThinking: DEFAULT_PREFERENCES.defaultThinkingByProvider.kimi ? 1 : 0,
          ollamaTransportMode: DEFAULT_PREFERENCES.ollamaTransportMode,
          defaultExecutionPermission: DEFAULT_PREFERENCES.defaultExecutionPermission,
          followUpBehavior: DEFAULT_PREFERENCES.followUpBehavior,
          generatedMemoryUseEnabled: DEFAULT_PREFERENCES.generatedMemoryUseEnabled ? 1 : 0,
          generatedMemoryGenerationEnabled: DEFAULT_PREFERENCES.generatedMemoryGenerationEnabled ? 1 : 0,
          appearanceMode: DEFAULT_PREFERENCES.appearanceMode,
          accentMode: DEFAULT_PREFERENCES.accentMode,
          accentColor: DEFAULT_PREFERENCES.accentColor,
          onboardingComplete: 0,
          lastOpenedThreadId: null,
          microphoneAllowed: 0
        });
    }

    const collabSettings = this.db.prepare('SELECT id FROM collab_settings WHERE id = 1').get() as { id: number } | undefined;
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
          )`
        )
        .run({
          connectionState: DEFAULT_COLLAB_CONFIG.connectionState,
          updatedAt: new Date().toISOString()
        });
    }

    this.seedDefaultPersonalization();

    this.seedBuiltInSkills();
    this.seedDefaultProject();
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
         ORDER BY updated_at ASC`
      )
      .all() as Array<{ id: string }>;

    const recovered: ThreadSummary[] = [];

    for (const candidate of activeThreads) {
      const threadId = String(candidate.id);
      const detail = this.getThread(threadId);
      const latestEvent = [...detail.rawOutput].reverse()[0] ?? null;
      const nextStatus =
        latestEvent?.eventType === 'completed' || latestEvent?.eventType === 'failed' || latestEvent?.eventType === 'aborted'
          ? latestEvent.eventType
          : 'aborted';

      if (nextStatus === 'aborted' && latestEvent?.runId) {
        this.addRunEvent(threadId, latestEvent.runId, 'aborted', {
          message: 'Run interrupted when the app closed.'
        });
      }

      this.updateThreadStatus(threadId, nextStatus);
      recovered.push(this.getThreadSummary(threadId));
    }

    return recovered;
  }

  getBootstrapData(): BootstrapData {
    const projects = this.listProjects();
    return {
      projects,
      threadsByProject: Object.fromEntries(projects.map((project) => [project.id, this.listThreads(project.id)])),
      skills: this.listSkills(),
      automations: this.listAutomations(),
      jobs: this.listJobs(),
      reviewItems: this.listPendingReviewItems(),
      pendingRunToolApprovals: [],
      providers: [],
      preferences: this.getPreferences(),
      personalization: this.getPersonalization(),
      collaboration: this.getCollabBootstrap()
    };
  }

  getCollabBootstrap(): CollabBootstrap {
    const rooms = this.listCollabRooms();
    return {
      config: this.getCollabConfig(),
      account: this.getCollabAccount(),
      profile: this.getActiveCollabProfile(),
      rooms,
      roomMembersByRoom: Object.fromEntries(rooms.map((room) => [room.id, this.listCollabRoomMembers(room.id)])),
      messagesByRoom: Object.fromEntries(rooms.map((room) => [room.id, this.listCollabMessages(room.id)])),
      presenceByRoom: Object.fromEntries(rooms.map((room) => [room.id, this.listCollabPresence(room.id)])),
      sharedThreadsByRoom: Object.fromEntries(rooms.map((room) => [room.id, this.listCollabSharedThreads(room.id)])),
      sharedRunsByRoom: Object.fromEntries(rooms.map((room) => [room.id, this.listCollabSharedRuns(room.id)])),
      handoffsByRoom: Object.fromEntries(rooms.map((room) => [room.id, this.listCollabHandoffs(room.id)])),
      followersByRoom: Object.fromEntries(rooms.map((room) => [room.id, this.listCollabRoomFollowers(room.id)])),
      roleRequestsByRoom: Object.fromEntries(rooms.map((room) => [room.id, this.listCollabRoleRequests(room.id)])),
      terminalStateByRoom: Object.fromEntries(rooms.map((room) => [room.id, this.getCollabRoomTerminalState(room.id)])),
      contacts: this.listCollabContacts()
    };
  }

  getCollabConfig(): CollabConfig {
    const row = this.db.prepare('SELECT * FROM collab_settings WHERE id = 1').get() as Row | undefined;
    if (!row) {
      return DEFAULT_COLLAB_CONFIG;
    }

    return {
      supabaseUrl: (row.supabase_url as string | null) ?? null,
      hasAnonKey: Boolean(row.supabase_anon_key),
      connectionState: (row.connection_state as CollabConfig['connectionState']) ?? DEFAULT_COLLAB_CONFIG.connectionState,
      lastError: (row.last_error as string | null) ?? null
    };
  }

  getCollabServiceConfig(): { supabaseUrl: string | null; supabaseAnonKey: string | null } {
    const row = this.db.prepare('SELECT supabase_url, supabase_anon_key FROM collab_settings WHERE id = 1').get() as Row | undefined;
    return {
      supabaseUrl: (row?.supabase_url as string | null) ?? null,
      supabaseAnonKey: (row?.supabase_anon_key as string | null) ?? null
    };
  }

  saveCollabConfig(input: { supabaseUrl: string; supabaseAnonKey: string }): CollabConfig {
    const currentIdentity = this.getCollabAccount();
    this.db
      .prepare(
        `UPDATE collab_settings
         SET supabase_url = @supabaseUrl,
             supabase_anon_key = @supabaseAnonKey,
             connection_state = @connectionState,
             last_error = NULL,
             updated_at = @updatedAt
         WHERE id = 1`
      )
      .run({
        supabaseUrl: input.supabaseUrl,
        supabaseAnonKey: input.supabaseAnonKey,
        connectionState: currentIdentity.userId ? 'connecting' : 'identity_required',
        updatedAt: new Date().toISOString()
      });

    return this.getCollabConfig();
  }

  clearCollabConfig(): CollabConfig {
    this.db
      .prepare(
        `UPDATE collab_settings
         SET supabase_url = NULL,
             supabase_anon_key = NULL,
             encrypted_session_json = NULL,
             current_user_id = NULL,
             current_email = NULL,
             session_expires_at = NULL,
             connection_state = 'unconfigured',
             last_error = NULL,
             updated_at = @updatedAt,
             last_synced_at = NULL
         WHERE id = 1`
      )
      .run({
        updatedAt: new Date().toISOString()
      });
    this.clearCollabCache();
    this.db.prepare('DELETE FROM collab_room_sessions').run();
    return this.getCollabConfig();
  }

  setCollabConnectionState(connectionState: CollabConfig['connectionState'], lastError: string | null = null): CollabConfig {
    this.db
      .prepare(
        `UPDATE collab_settings
         SET connection_state = @connectionState,
             last_error = @lastError,
             updated_at = @updatedAt
         WHERE id = 1`
      )
      .run({
        connectionState,
        lastError,
        updatedAt: new Date().toISOString()
      });
    return this.getCollabConfig();
  }

  getCollabEncryptedSession(): string | null {
    const row = this.db.prepare('SELECT encrypted_session_json FROM collab_settings WHERE id = 1').get() as Row | undefined;
    return (row?.encrypted_session_json as string | null) ?? null;
  }

  getCollabAccount(): CollabAccount {
    const row = this.db.prepare('SELECT current_email, current_user_id, session_expires_at FROM collab_settings WHERE id = 1').get() as Row | undefined;
    if (!row) {
      return DEFAULT_COLLAB_ACCOUNT;
    }
    return {
      email: (row.current_email as string | null) ?? null,
      userId: (row.current_user_id as string | null) ?? null,
      expiresAt: (row.session_expires_at as string | null) ?? null
    };
  }

  setCollabIdentity(input: { userId: string | null; connectionState: CollabConfig['connectionState'] }): CollabAccount {
    this.db
      .prepare(
        `UPDATE collab_settings
         SET current_user_id = @currentUserId,
             current_email = NULL,
             session_expires_at = NULL,
             encrypted_session_json = NULL,
             connection_state = @connectionState,
             last_error = NULL,
             updated_at = @updatedAt
         WHERE id = 1`
      )
      .run({
        currentUserId: input.userId,
        connectionState: input.connectionState,
        updatedAt: new Date().toISOString()
      });
    return this.getCollabAccount();
  }

  saveCollabSession(input: {
    encryptedSessionJson: string | null;
    currentUserId: string | null;
    currentEmail: string | null;
    expiresAt: string | null;
    connectionState: CollabConfig['connectionState'];
  }): CollabAccount {
    this.db
      .prepare(
        `UPDATE collab_settings
         SET encrypted_session_json = @encryptedSessionJson,
             current_user_id = @currentUserId,
             current_email = @currentEmail,
             session_expires_at = @expiresAt,
             connection_state = @connectionState,
             last_error = NULL,
             updated_at = @updatedAt
         WHERE id = 1`
      )
      .run({
        encryptedSessionJson: input.encryptedSessionJson,
        currentUserId: input.currentUserId,
        currentEmail: input.currentEmail,
        expiresAt: input.expiresAt,
        connectionState: input.connectionState,
        updatedAt: new Date().toISOString()
      });
    return this.getCollabAccount();
  }

  clearCollabSession() {
    const config = this.getCollabConfig();
    this.db
      .prepare(
        `UPDATE collab_settings
         SET encrypted_session_json = NULL,
             current_user_id = NULL,
             current_email = NULL,
             session_expires_at = NULL,
             connection_state = @connectionState,
             last_error = NULL,
             updated_at = @updatedAt
         WHERE id = 1`
      )
      .run({
        connectionState: config.hasAnonKey && config.supabaseUrl ? 'identity_required' : 'unconfigured',
        updatedAt: new Date().toISOString()
      });
  }

  touchCollabSync(timestamp = new Date().toISOString()) {
    this.db.prepare('UPDATE collab_settings SET last_synced_at = ?, updated_at = ? WHERE id = 1').run(timestamp, timestamp);
  }

  clearCollabCache() {
    this.db.exec(`
      DELETE FROM collab_handoffs;
      DELETE FROM collab_shared_runs;
      DELETE FROM collab_shared_threads;
      DELETE FROM collab_presences;
      DELETE FROM collab_messages;
      DELETE FROM collab_role_requests;
      DELETE FROM collab_room_followers;
      DELETE FROM collab_room_terminal_states;
      DELETE FROM collab_invites;
      DELETE FROM collab_room_sessions;
      DELETE FROM collab_room_members;
      DELETE FROM collab_rooms;
      DELETE FROM collab_profiles;
    `);
  }

  clearCollabRoomCache() {
    this.db.exec(`
      DELETE FROM collab_handoffs;
      DELETE FROM collab_shared_runs;
      DELETE FROM collab_shared_threads;
      DELETE FROM collab_presences;
      DELETE FROM collab_messages;
      DELETE FROM collab_role_requests;
      DELETE FROM collab_room_followers;
      DELETE FROM collab_room_terminal_states;
      DELETE FROM collab_invites;
      DELETE FROM collab_room_members;
      DELETE FROM collab_rooms;
    `);
  }

  getActiveCollabProfile(): CollabProfile | null {
    const account = this.getCollabAccount();
    if (!account.userId) {
      return null;
    }
    return this.getCollabProfile(account.userId);
  }

  getCollabProfile(userId: string): CollabProfile | null {
    const row = this.db.prepare('SELECT * FROM collab_profiles WHERE id = ?').get(userId) as Row | undefined;
    return row ? this.mapCollabProfile(row) : null;
  }

  upsertCollabRoomSession(session: CollabRoomSession): CollabRoomSession {
    this.db
      .prepare(
        `INSERT INTO collab_room_sessions (room_id, user_id, session_token, updated_at, expires_at)
         VALUES (@roomId, @userId, @sessionToken, @updatedAt, @expiresAt)
         ON CONFLICT(room_id, user_id) DO UPDATE SET
           session_token = excluded.session_token,
           updated_at = excluded.updated_at,
           expires_at = excluded.expires_at`
      )
      .run({
        roomId: session.roomId,
        userId: session.userId,
        sessionToken: session.sessionToken,
        updatedAt: session.updatedAt,
        expiresAt: session.expiresAt
      });
    return this.getCollabRoomSession(session.roomId, session.userId) ?? session;
  }

  getCollabRoomSession(roomId: string, userId?: string | null): CollabRoomSession | null {
    const resolvedUserId = userId ?? this.getCollabAccount().userId;
    if (!resolvedUserId) {
      return null;
    }
    const row = this.db
      .prepare('SELECT * FROM collab_room_sessions WHERE room_id = ? AND user_id = ?')
      .get(roomId, resolvedUserId) as Row | undefined;
    return row
      ? {
          roomId: String(row.room_id),
          userId: String(row.user_id),
          sessionToken: String(row.session_token),
          updatedAt: String(row.updated_at),
          expiresAt: (row.expires_at as string | null) ?? null
        }
      : null;
  }

  listCollabRoomSessions(userId?: string | null): CollabRoomSession[] {
    const resolvedUserId = userId ?? this.getCollabAccount().userId;
    const rows = resolvedUserId
      ? this.db.prepare('SELECT * FROM collab_room_sessions WHERE user_id = ? ORDER BY updated_at DESC').all(resolvedUserId)
      : this.db.prepare('SELECT * FROM collab_room_sessions ORDER BY updated_at DESC').all();
    return rows.map((row) => ({
      roomId: String((row as Row).room_id),
      userId: String((row as Row).user_id),
      sessionToken: String((row as Row).session_token),
      updatedAt: String((row as Row).updated_at),
      expiresAt: (((row as Row).expires_at as string | null) ?? null)
    }));
  }

  removeCollabRoomSession(roomId: string, userId?: string | null) {
    const resolvedUserId = userId ?? this.getCollabAccount().userId;
    if (resolvedUserId) {
      this.db.prepare('DELETE FROM collab_room_sessions WHERE room_id = ? AND user_id = ?').run(roomId, resolvedUserId);
      return;
    }
    this.db.prepare('DELETE FROM collab_room_sessions WHERE room_id = ?').run(roomId);
  }

  upsertCollabProfile(profile: CollabProfile): CollabProfile {
    this.db
      .prepare(
        `INSERT INTO collab_profiles (
          id, email, display_name, handle, avatar_url, status, bio, timezone, created_at, updated_at
        ) VALUES (
          @id, @email, @displayName, @handle, @avatarUrl, @status, @bio, @timezone, @createdAt, @updatedAt
        )
        ON CONFLICT(id) DO UPDATE SET
          email = excluded.email,
          display_name = excluded.display_name,
          handle = excluded.handle,
          avatar_url = excluded.avatar_url,
          status = excluded.status,
          bio = excluded.bio,
          timezone = excluded.timezone,
          created_at = excluded.created_at,
          updated_at = excluded.updated_at`
      )
      .run({
        id: profile.id,
        email: profile.email,
        displayName: profile.displayName,
        handle: profile.handle,
        avatarUrl: profile.avatarUrl,
        status: profile.status,
        bio: profile.bio,
        timezone: profile.timezone,
        createdAt: profile.createdAt,
        updatedAt: profile.updatedAt
      });
    return this.getCollabProfile(profile.id) ?? profile;
  }

  listCollabRooms(type?: CollabRoom['type']): CollabRoom[] {
    const sql = type
      ? 'SELECT * FROM collab_rooms WHERE type = ? ORDER BY last_activity_at DESC, updated_at DESC'
      : 'SELECT * FROM collab_rooms ORDER BY last_activity_at DESC, updated_at DESC';
    const rows = type ? this.db.prepare(sql).all(type) : this.db.prepare(sql).all();
    return rows.map((row) => this.mapCollabRoom(row as Row));
  }

  listCollabChats(): CollabRoom[] {
    return this.listCollabRooms('dm');
  }

  getCollabRoom(roomId: string): CollabRoom {
    const row = this.db.prepare('SELECT * FROM collab_rooms WHERE id = ?').get(roomId) as Row | undefined;
    if (!row) {
      throw new Error(`Collaboration room not found: ${roomId}`);
    }
    return this.mapCollabRoom(row);
  }

  upsertCollabRoom(room: CollabRoom): CollabRoom {
    this.db
      .prepare(
        `INSERT INTO collab_rooms (
          id, type, name, join_code, slug, topic, project_label, direct_user_id, unread_count, member_count, last_activity_at, last_message_preview, created_by, created_at, updated_at
        ) VALUES (
          @id, @type, @name, @joinCode, @slug, @topic, @projectLabel, @directUserId, @unreadCount, @memberCount, @lastActivityAt, @lastMessagePreview, @createdBy, @createdAt, @updatedAt
        )
        ON CONFLICT(id) DO UPDATE SET
          type = excluded.type,
          name = excluded.name,
          join_code = excluded.join_code,
          slug = excluded.slug,
          topic = excluded.topic,
          project_label = excluded.project_label,
          direct_user_id = excluded.direct_user_id,
          unread_count = excluded.unread_count,
          member_count = excluded.member_count,
          last_activity_at = excluded.last_activity_at,
          last_message_preview = excluded.last_message_preview,
          created_by = excluded.created_by,
          created_at = excluded.created_at,
          updated_at = excluded.updated_at`
      )
      .run({
        id: room.id,
        type: room.type,
        name: room.name,
        joinCode: room.joinCode,
        slug: room.slug,
        topic: room.topic,
        projectLabel: room.projectLabel,
        directUserId: room.directUserId,
        unreadCount: room.unreadCount,
        memberCount: room.memberCount,
        lastActivityAt: room.lastActivityAt,
        lastMessagePreview: room.lastMessagePreview,
        createdBy: room.createdBy,
        createdAt: room.createdAt,
        updatedAt: room.updatedAt
      });
    return this.getCollabRoom(room.id);
  }

  listCollabRoomMembers(roomId: string): CollabRoomMember[] {
    const rows = this.db
      .prepare(
        `SELECT
          members.*,
          profiles.display_name,
          profiles.handle,
          profiles.avatar_url,
          profiles.status
         FROM collab_room_members members
         INNER JOIN collab_profiles profiles ON profiles.id = members.user_id
         WHERE members.room_id = ?
         ORDER BY profiles.display_name COLLATE NOCASE ASC`
      )
      .all(roomId);
    return rows.map((row) => this.mapCollabRoomMember(row as Row));
  }

  replaceCollabRoomMembers(roomId: string, members: CollabRoomMember[]) {
    const transaction = this.db.transaction(() => {
      this.db.prepare('DELETE FROM collab_room_members WHERE room_id = ?').run(roomId);
      const insert = this.db.prepare(
        `INSERT INTO collab_room_members (
          room_id, user_id, role, membership_state, joined_at, created_at, updated_at
        ) VALUES (
          @roomId, @userId, @role, @membershipState, @joinedAt, @createdAt, @updatedAt
        )`
      );
      for (const member of members) {
        const now = new Date().toISOString();
        this.upsertCollabProfile({
          id: member.userId,
          email: null,
          displayName: member.displayName,
          handle: member.handle,
          avatarUrl: member.avatarUrl,
          status: member.status,
          bio: null,
          timezone: null,
          createdAt: now,
          updatedAt: now
        });
        insert.run({
          roomId: member.roomId,
          userId: member.userId,
          role: member.role,
          membershipState: member.membershipState,
          joinedAt: member.joinedAt,
          createdAt: member.joinedAt ?? now,
          updatedAt: now
        });
      }
    });
    transaction();
  }

  listCollabInvites(roomId: string): Array<{
    id: string;
    roomId: string;
    code: string;
    status: 'active' | 'redeemed' | 'expired' | 'revoked';
    createdBy: string;
    createdAt: string;
    expiresAt: string | null;
  }> {
    return this.db
      .prepare('SELECT * FROM collab_invites WHERE room_id = ? ORDER BY created_at DESC')
      .all(roomId)
      .map((row) => this.mapCollabInvite(row as Row));
  }

  upsertCollabInvite(invite: {
    id: string;
    roomId: string;
    code: string;
    status: 'active' | 'redeemed' | 'expired' | 'revoked';
    createdBy: string;
    createdAt: string;
    expiresAt: string | null;
  }) {
    this.db
      .prepare(
        `INSERT INTO collab_invites (id, room_id, code, status, created_by, created_at, expires_at)
         VALUES (@id, @roomId, @code, @status, @createdBy, @createdAt, @expiresAt)
         ON CONFLICT(id) DO UPDATE SET
           room_id = excluded.room_id,
           code = excluded.code,
           status = excluded.status,
           created_by = excluded.created_by,
           created_at = excluded.created_at,
           expires_at = excluded.expires_at`
      )
      .run({
        id: invite.id,
        roomId: invite.roomId,
        code: invite.code,
        status: invite.status,
        createdBy: invite.createdBy,
        createdAt: invite.createdAt,
        expiresAt: invite.expiresAt
      });
    return this.listCollabInvites(invite.roomId).find((candidate) => candidate.id === invite.id) ?? invite;
  }

  listCollabMessages(roomId: string): CollabMessage[] {
    return this.db
      .prepare(
        `SELECT
          messages.*,
          profiles.display_name,
          profiles.handle
         FROM collab_messages messages
         INNER JOIN collab_profiles profiles ON profiles.id = messages.author_id
         WHERE room_id = ?
         ORDER BY created_at ASC`
      )
      .all(roomId)
      .map((row) => this.mapCollabMessage(row as Row));
  }

  upsertCollabMessage(message: CollabMessage): CollabMessage {
    this.db
      .prepare(
        `INSERT INTO collab_messages (id, room_id, author_id, body, created_at)
         VALUES (@id, @roomId, @authorId, @body, @createdAt)
         ON CONFLICT(id) DO UPDATE SET
           room_id = excluded.room_id,
           author_id = excluded.author_id,
           body = excluded.body,
           created_at = excluded.created_at`
      )
      .run({
        id: message.id,
        roomId: message.roomId,
        authorId: message.authorId,
        body: message.body,
        createdAt: message.createdAt
      });
    return this.listCollabMessages(message.roomId).find((candidate) => candidate.id === message.id) ?? message;
  }

  replaceCollabMessages(roomId: string, messages: CollabMessage[]) {
    const transaction = this.db.transaction(() => {
      this.db.prepare('DELETE FROM collab_messages WHERE room_id = ?').run(roomId);
      for (const message of messages) {
        this.upsertCollabMessage(message);
      }
    });
    transaction();
  }

  listCollabPresence(roomId: string): CollabPresence[] {
    return this.db
      .prepare('SELECT * FROM collab_presences WHERE room_id = ? ORDER BY updated_at DESC')
      .all(roomId)
      .map((row) => this.mapCollabPresence(row as Row));
  }

  upsertCollabPresence(presence: CollabPresence): CollabPresence {
    this.db
      .prepare(
        `INSERT INTO collab_presences (
          room_id, user_id, status, current_thread_id, current_thread_title, branch_name, worktree_name, active_run_id, active_run_title, dirty_file_count, staged_file_count, updated_at
        ) VALUES (
          @roomId, @userId, @status, @currentThreadId, @currentThreadTitle, @branchName, @worktreeName, @activeRunId, @activeRunTitle, @dirtyFileCount, @stagedFileCount, @updatedAt
        )
        ON CONFLICT(room_id, user_id) DO UPDATE SET
          status = excluded.status,
          current_thread_id = excluded.current_thread_id,
          current_thread_title = excluded.current_thread_title,
          branch_name = excluded.branch_name,
          worktree_name = excluded.worktree_name,
          active_run_id = excluded.active_run_id,
          active_run_title = excluded.active_run_title,
          dirty_file_count = excluded.dirty_file_count,
          staged_file_count = excluded.staged_file_count,
          updated_at = excluded.updated_at`
      )
      .run({
        roomId: presence.roomId,
        userId: presence.userId,
        status: presence.status,
        currentThreadId: presence.currentThreadId,
        currentThreadTitle: presence.currentThreadTitle,
        branchName: presence.branchName,
        worktreeName: presence.worktreeName,
        activeRunId: presence.activeRunId,
        activeRunTitle: presence.activeRunTitle,
        dirtyFileCount: presence.dirtyFileCount,
        stagedFileCount: presence.stagedFileCount,
        updatedAt: presence.updatedAt
      });
    return this.listCollabPresence(presence.roomId).find((candidate) => candidate.userId === presence.userId) ?? presence;
  }

  replaceCollabPresence(roomId: string, presence: CollabPresence[]) {
    const transaction = this.db.transaction(() => {
      this.db.prepare('DELETE FROM collab_presences WHERE room_id = ?').run(roomId);
      for (const entry of presence) {
        this.upsertCollabPresence(entry);
      }
    });
    transaction();
  }

  listCollabSharedThreads(roomId: string): CollabSharedThread[] {
    return this.db
      .prepare(
        `SELECT
          shared.*,
          profiles.display_name
         FROM collab_shared_threads shared
         INNER JOIN collab_profiles profiles ON profiles.id = shared.driver_user_id
         WHERE shared.room_id = ?
         ORDER BY shared.updated_at DESC`
      )
      .all(roomId)
      .map((row) => this.mapCollabSharedThread(row as Row));
  }

  upsertCollabSharedThread(sharedThread: CollabSharedThread): CollabSharedThread {
    this.db
      .prepare(
        `INSERT INTO collab_shared_threads (
          id, room_id, thread_id, project_id, project_label, title, status, driver_user_id, provider_id, model_id, last_prompt_summary, latest_assistant_summary, run_id, created_at, updated_at
        ) VALUES (
          @id, @roomId, @threadId, @projectId, @projectLabel, @title, @status, @driverUserId, @providerId, @modelId, @lastPromptSummary, @latestAssistantSummary, @runId, @createdAt, @updatedAt
        )
        ON CONFLICT(id) DO UPDATE SET
          room_id = excluded.room_id,
          thread_id = excluded.thread_id,
          project_id = excluded.project_id,
          project_label = excluded.project_label,
          title = excluded.title,
          status = excluded.status,
          driver_user_id = excluded.driver_user_id,
          provider_id = excluded.provider_id,
          model_id = excluded.model_id,
          last_prompt_summary = excluded.last_prompt_summary,
          latest_assistant_summary = excluded.latest_assistant_summary,
          run_id = excluded.run_id,
          created_at = excluded.created_at,
          updated_at = excluded.updated_at`
      )
      .run({
        id: sharedThread.id,
        roomId: sharedThread.roomId,
        threadId: sharedThread.threadId,
        projectId: sharedThread.projectId,
        projectLabel: sharedThread.projectLabel,
        title: sharedThread.title,
        status: sharedThread.status,
        driverUserId: sharedThread.driverUserId,
        providerId: sharedThread.providerId,
        modelId: sharedThread.modelId,
        lastPromptSummary: sharedThread.lastPromptSummary,
        latestAssistantSummary: sharedThread.latestAssistantSummary,
        runId: sharedThread.runId,
        createdAt: sharedThread.createdAt,
        updatedAt: sharedThread.updatedAt
      });
    return this.listCollabSharedThreads(sharedThread.roomId).find((candidate) => candidate.id === sharedThread.id) ?? sharedThread;
  }

  listCollabSharedRuns(roomId: string): CollabSharedRun[] {
    return this.db
      .prepare(
        `SELECT
          runs.*,
          profiles.display_name
         FROM collab_shared_runs runs
         INNER JOIN collab_profiles profiles ON profiles.id = runs.driver_user_id
         WHERE runs.room_id = ?
         ORDER BY runs.updated_at DESC`
      )
      .all(roomId)
      .map((row) => this.mapCollabSharedRun(row as Row));
  }

  getCollabSharedRunByRunId(runId: string): CollabSharedRun | null {
    const row = this.db
      .prepare(
        `SELECT
          runs.*,
          profiles.display_name
         FROM collab_shared_runs runs
         INNER JOIN collab_profiles profiles ON profiles.id = runs.driver_user_id
         WHERE runs.run_id = ?
         ORDER BY runs.updated_at DESC
         LIMIT 1`
      )
      .get(runId) as Row | undefined;
    return row ? this.mapCollabSharedRun(row) : null;
  }

  upsertCollabSharedRun(sharedRun: CollabSharedRun): CollabSharedRun {
    this.db
      .prepare(
        `INSERT INTO collab_shared_runs (
          id, room_id, thread_id, thread_title, run_id, driver_user_id, provider_id, model_id, execution_permission, status, task_title, summary, changed_files_json, diff_stats_json, tests_summary, result_label, started_at, updated_at, completed_at
        ) VALUES (
          @id, @roomId, @threadId, @threadTitle, @runId, @driverUserId, @providerId, @modelId, @executionPermission, @status, @taskTitle, @summary, @changedFilesJson, @diffStatsJson, @testsSummary, @resultLabel, @startedAt, @updatedAt, @completedAt
        )
        ON CONFLICT(id) DO UPDATE SET
          room_id = excluded.room_id,
          thread_id = excluded.thread_id,
          thread_title = excluded.thread_title,
          run_id = excluded.run_id,
          driver_user_id = excluded.driver_user_id,
          provider_id = excluded.provider_id,
          model_id = excluded.model_id,
          execution_permission = excluded.execution_permission,
          status = excluded.status,
          task_title = excluded.task_title,
          summary = excluded.summary,
          changed_files_json = excluded.changed_files_json,
          diff_stats_json = excluded.diff_stats_json,
          tests_summary = excluded.tests_summary,
          result_label = excluded.result_label,
          started_at = excluded.started_at,
          updated_at = excluded.updated_at,
          completed_at = excluded.completed_at`
      )
      .run({
        id: sharedRun.id,
        roomId: sharedRun.roomId,
        threadId: sharedRun.threadId,
        threadTitle: sharedRun.threadTitle,
        runId: sharedRun.runId,
        driverUserId: sharedRun.driverUserId,
        providerId: sharedRun.providerId,
        modelId: sharedRun.modelId,
        executionPermission: sharedRun.executionPermission,
        status: sharedRun.status,
        taskTitle: sharedRun.taskTitle,
        summary: sharedRun.summary,
        changedFilesJson: JSON.stringify(sharedRun.changedFiles),
        diffStatsJson: sharedRun.diffStats ? JSON.stringify(sharedRun.diffStats) : null,
        testsSummary: sharedRun.testsSummary,
        resultLabel: sharedRun.resultLabel,
        startedAt: sharedRun.startedAt,
        updatedAt: sharedRun.updatedAt,
        completedAt: sharedRun.completedAt
      });
    return this.getCollabSharedRunByRunId(sharedRun.runId) ?? sharedRun;
  }

  listCollabHandoffs(roomId: string): CollabHandoff[] {
    return this.db
      .prepare(
        `SELECT
          handoffs.*,
          profiles.display_name
         FROM collab_handoffs handoffs
         INNER JOIN collab_profiles profiles ON profiles.id = handoffs.author_user_id
         WHERE handoffs.room_id = ?
         ORDER BY handoffs.created_at DESC`
      )
      .all(roomId)
      .map((row) => this.mapCollabHandoff(row as Row));
  }

  upsertCollabHandoff(handoff: CollabHandoff): CollabHandoff {
    this.db
      .prepare(
        `INSERT INTO collab_handoffs (
          id, room_id, thread_id, run_id, author_user_id, title, summary, branch_name, dirty_file_count, staged_file_count, changed_files_json, outstanding_tasks_json, recommended_next_prompt, created_at
        ) VALUES (
          @id, @roomId, @threadId, @runId, @authorUserId, @title, @summary, @branchName, @dirtyFileCount, @stagedFileCount, @changedFilesJson, @outstandingTasksJson, @recommendedNextPrompt, @createdAt
        )
        ON CONFLICT(id) DO UPDATE SET
          room_id = excluded.room_id,
          thread_id = excluded.thread_id,
          run_id = excluded.run_id,
          author_user_id = excluded.author_user_id,
          title = excluded.title,
          summary = excluded.summary,
          branch_name = excluded.branch_name,
          dirty_file_count = excluded.dirty_file_count,
          staged_file_count = excluded.staged_file_count,
          changed_files_json = excluded.changed_files_json,
          outstanding_tasks_json = excluded.outstanding_tasks_json,
          recommended_next_prompt = excluded.recommended_next_prompt,
          created_at = excluded.created_at`
      )
      .run({
        id: handoff.id,
        roomId: handoff.roomId,
        threadId: handoff.threadId,
        runId: handoff.runId,
        authorUserId: handoff.authorUserId,
        title: handoff.title,
        summary: handoff.summary,
        branchName: handoff.branchName,
        dirtyFileCount: handoff.dirtyFileCount,
        stagedFileCount: handoff.stagedFileCount,
        changedFilesJson: JSON.stringify(handoff.changedFiles),
        outstandingTasksJson: JSON.stringify(handoff.outstandingTasks),
        recommendedNextPrompt: handoff.recommendedNextPrompt,
        createdAt: handoff.createdAt
      });
    return this.listCollabHandoffs(handoff.roomId).find((candidate) => candidate.id === handoff.id) ?? handoff;
  }

  listCollabRoomFollowers(roomId: string): CollabRoomFollower[] {
    return this.db
      .prepare(
        `SELECT
          followers.*,
          profiles.display_name,
          profiles.handle,
          profiles.avatar_url,
          profiles.status
         FROM collab_room_followers followers
         INNER JOIN collab_profiles profiles ON profiles.id = followers.user_id
         WHERE followers.room_id = ?
         ORDER BY followers.created_at DESC, profiles.display_name COLLATE NOCASE ASC`
      )
      .all(roomId)
      .map((row) => this.mapCollabRoomFollower(row as Row));
  }

  replaceCollabRoomFollowers(roomId: string, followers: CollabRoomFollower[]) {
    const transaction = this.db.transaction(() => {
      this.db.prepare('DELETE FROM collab_room_followers WHERE room_id = ?').run(roomId);
      const insert = this.db.prepare(
        `INSERT INTO collab_room_followers (room_id, user_id, created_at)
         VALUES (@roomId, @userId, @createdAt)`
      );
      for (const follower of followers) {
        const now = new Date().toISOString();
        this.upsertCollabProfile({
          id: follower.userId,
          email: null,
          displayName: follower.displayName,
          handle: follower.handle,
          avatarUrl: follower.avatarUrl,
          status: follower.status,
          bio: null,
          timezone: null,
          createdAt: now,
          updatedAt: now
        });
        insert.run({
          roomId: follower.roomId,
          userId: follower.userId,
          createdAt: follower.createdAt
        });
      }
    });
    transaction();
  }

  listCollabRoleRequests(roomId: string): CollabRoleRequest[] {
    return this.db
      .prepare(
        `SELECT
          requests.*,
          profiles.display_name,
          profiles.handle
         FROM collab_role_requests requests
         INNER JOIN collab_profiles profiles ON profiles.id = requests.requester_user_id
         WHERE requests.room_id = ?
         ORDER BY requests.updated_at DESC, requests.created_at DESC`
      )
      .all(roomId)
      .map((row) => this.mapCollabRoleRequest(row as Row));
  }

  upsertCollabRoleRequest(request: CollabRoleRequest): CollabRoleRequest {
    this.db
      .prepare(
        `INSERT INTO collab_role_requests (
          id, room_id, requester_user_id, requested_role, status, resolved_by_user_id, created_at, updated_at
        ) VALUES (
          @id, @roomId, @requesterUserId, @requestedRole, @status, @resolvedByUserId, @createdAt, @updatedAt
        )
        ON CONFLICT(id) DO UPDATE SET
          room_id = excluded.room_id,
          requester_user_id = excluded.requester_user_id,
          requested_role = excluded.requested_role,
          status = excluded.status,
          resolved_by_user_id = excluded.resolved_by_user_id,
          created_at = excluded.created_at,
          updated_at = excluded.updated_at`
      )
      .run({
        id: request.id,
        roomId: request.roomId,
        requesterUserId: request.requesterUserId,
        requestedRole: request.requestedRole,
        status: request.status,
        resolvedByUserId: request.resolvedByUserId,
        createdAt: request.createdAt,
        updatedAt: request.updatedAt
      });
    return this.listCollabRoleRequests(request.roomId).find((candidate) => candidate.id === request.id) ?? request;
  }

  replaceCollabRoleRequests(roomId: string, requests: CollabRoleRequest[]) {
    const transaction = this.db.transaction(() => {
      this.db.prepare('DELETE FROM collab_role_requests WHERE room_id = ?').run(roomId);
      for (const request of requests) {
        this.upsertCollabRoleRequest(request);
      }
    });
    transaction();
  }

  getCollabRoomTerminalState(roomId: string): CollabRoomTerminalState | null {
    const row = this.db
      .prepare(
        `SELECT
          terminal.*,
          profiles.display_name
         FROM collab_room_terminal_states terminal
         LEFT JOIN collab_profiles profiles ON profiles.id = terminal.enabled_by_user_id
         WHERE terminal.room_id = ?`
      )
      .get(roomId) as Row | undefined;
    return row ? this.mapCollabRoomTerminalState(row) : null;
  }

  upsertCollabRoomTerminalState(state: CollabRoomTerminalState): CollabRoomTerminalState {
    this.db
      .prepare(
        `INSERT INTO collab_room_terminal_states (
          room_id, mode, enabled_by_user_id, note, updated_at
        ) VALUES (
          @roomId, @mode, @enabledByUserId, @note, @updatedAt
        )
        ON CONFLICT(room_id) DO UPDATE SET
          mode = excluded.mode,
          enabled_by_user_id = excluded.enabled_by_user_id,
          note = excluded.note,
          updated_at = excluded.updated_at`
      )
      .run({
        roomId: state.roomId,
        mode: state.mode,
        enabledByUserId: state.enabledByUserId,
        note: state.note,
        updatedAt: state.updatedAt
      });
    return this.getCollabRoomTerminalState(state.roomId) ?? state;
  }

  clearCollabRoomTerminalState(roomId: string) {
    this.db.prepare('DELETE FROM collab_room_terminal_states WHERE room_id = ?').run(roomId);
  }

  listCollabContacts(): CollabContact[] {
    const currentUserId = this.getCollabAccount().userId;
    const rows = this.db
      .prepare(
        `SELECT
          profiles.id,
          profiles.display_name,
          profiles.handle,
          profiles.avatar_url,
          profiles.status,
          (
            SELECT members.room_id
            FROM collab_room_members members
            WHERE members.user_id = profiles.id
            ORDER BY members.updated_at DESC
            LIMIT 1
          ) AS last_room_id,
          (
            SELECT rooms.name
            FROM collab_room_members members
            INNER JOIN collab_rooms rooms ON rooms.id = members.room_id
            WHERE members.user_id = profiles.id
            ORDER BY members.updated_at DESC
            LIMIT 1
          ) AS last_room_name
         FROM collab_profiles profiles
         ORDER BY profiles.display_name COLLATE NOCASE ASC`
      )
      .all() as Row[];

    return rows
      .filter((row) => !currentUserId || String(row.id) !== currentUserId)
      .map((row) => ({
        userId: String(row.id),
        displayName: String(row.display_name),
        handle: (row.handle as string | null) ?? null,
        avatarUrl: (row.avatar_url as string | null) ?? null,
        status: row.status as CollabContact['status'],
        lastRoomId: (row.last_room_id as string | null) ?? null,
        lastRoomName: (row.last_room_name as string | null) ?? null
      }));
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
      terminalState: this.getCollabRoomTerminalState(roomId)
    };
  }

  listProjects(): Project[] {
    return this.db.prepare('SELECT * FROM projects ORDER BY updated_at DESC').all().map((row) => this.mapProject(row as Row));
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
        ) VALUES (@id, @name, @folderPath, @trusted, @runtimeCommandPolicy, @runtimeNetworkPolicy, @defaultProviderId, @openaiModel, @geminiModel, @qwenModel, @ollamaModel, @kimiModel, @createdAt, @updatedAt)`
      )
      .run({
        id,
        name: input.name,
        folderPath: input.folderPath ?? null,
        trusted: input.trusted ? 1 : 0,
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
        updatedAt: now
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
         WHERE id = @id`
      )
      .run({
        id: current.id,
        name: input.name ?? current.name,
        folderPath: input.folderPath === undefined ? current.folderPath : input.folderPath,
        trusted: input.trusted === undefined ? (current.trusted ? 1 : 0) : input.trusted ? 1 : 0,
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
        updatedAt: new Date().toISOString()
      });
    return this.getProject(current.id);
  }

  getProject(id: string): Project {
    const row = this.db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as Row | undefined;
    if (!row) {
      throw new Error(`Project not found: ${id}`);
    }
    return this.mapProject(row);
  }

  deleteProject(projectId: string) {
    this.getProject(projectId);
    this.db.prepare('DELETE FROM projects WHERE id = ?').run(projectId);

    const remainingProjects = this.listProjects();
    const currentPreferences = this.getPreferences();
    const nextSelectedProjectId =
      currentPreferences.selectedProjectId === projectId
        ? remainingProjects[0]?.id ?? null
        : currentPreferences.selectedProjectId;

    this.savePreferences({
      selectedProjectId: nextSelectedProjectId,
      lastOpenedThreadId: null
    });
  }

  createThread(input: ThreadCreateInput): ThreadDetail {
    const now = new Date().toISOString();
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO threads (
          id, project_id, title, provider_id, model_id, execution_permission, status, archived, created_at, updated_at, last_message_at, last_preview
        ) VALUES (@id, @projectId, @title, @providerId, @modelId, @executionPermission, 'draft', 0, @createdAt, @updatedAt, @lastMessageAt, '')`
      )
      .run({
        id,
        projectId: input.projectId,
        title: input.title?.trim() || 'New thread',
        providerId: input.providerId,
        modelId: input.modelId,
        executionPermission: input.executionPermission ?? this.getPreferences().defaultExecutionPermission,
        createdAt: now,
        updatedAt: now,
        lastMessageAt: now
      });
    this.ensureThreadPlannerState(id);
    this.savePreferences({ selectedProjectId: input.projectId, lastOpenedThreadId: id });
    return this.getThread(id);
  }

  listThreads(projectId: string): ThreadSummary[] {
    return this.db
      .prepare(
        `SELECT * FROM threads
         WHERE project_id = ? AND archived = 0
         ORDER BY updated_at DESC`
      )
      .all(projectId)
      .map((row) => this.mapThreadSummary(row as Row));
  }

  listArchivedThreads(projectId: string | null = null): ThreadSummary[] {
    if (projectId) {
      return this.db
        .prepare(
          `SELECT * FROM threads
           WHERE project_id = ? AND archived = 1
           ORDER BY updated_at DESC`
        )
        .all(projectId)
        .map((row) => this.mapThreadSummary(row as Row));
    }

    return this.db
      .prepare(
        `SELECT * FROM threads
         WHERE archived = 1
         ORDER BY updated_at DESC`
      )
      .all()
      .map((row) => this.mapThreadSummary(row as Row));
  }

  getThread(threadId: string): ThreadDetail {
    const row = this.db.prepare('SELECT * FROM threads WHERE id = ?').get(threadId) as Row | undefined;
    if (!row) {
      throw new Error(`Thread not found: ${threadId}`);
    }
    return {
      ...this.mapThreadSummary(row),
      turns: this.db
        .prepare('SELECT * FROM thread_turns WHERE thread_id = ? ORDER BY created_at ASC')
        .all(threadId)
        .map((turn) => this.mapTurn(turn as Row)),
      rawOutput: this.db
        .prepare('SELECT * FROM run_events WHERE thread_id = ? ORDER BY created_at ASC')
        .all(threadId)
        .map((event) => this.mapRunEvent(event as Row)),
      planner: this.getThreadPlannerState(threadId),
      followUps: this.listThreadFollowUps(threadId)
    };
  }

  listThreadFollowUps(threadId: string): ThreadFollowUp[] {
    return this.db
      .prepare(
        `SELECT * FROM thread_followups
         WHERE thread_id = ?
           AND status IN ('queued', 'dispatching')
         ORDER BY priority DESC, created_at ASC`
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
      status: 'queued',
      priority: input.priority ?? 0,
      targetRunId: input.targetRunId ?? null,
      createdAt: now,
      updatedAt: now,
      dispatchedAt: null,
      cancelledAt: null
    };

    this.db
      .prepare(
        `INSERT INTO thread_followups (
          id, thread_id, content, metadata_json, kind, status, priority, target_run_id, created_at, updated_at, dispatched_at, cancelled_at
        ) VALUES (
          @id, @threadId, @content, @metadataJson, @kind, @status, @priority, @targetRunId, @createdAt, @updatedAt, @dispatchedAt, @cancelledAt
        )`
      )
      .run({
        ...followUp,
        metadataJson: followUp.metadata ? JSON.stringify(followUp.metadata) : null
      });

    return followUp;
  }

  updateThreadFollowUp(followUpId: string, content: string): ThreadFollowUp {
    const current = this.getThreadFollowUp(followUpId);
    if (current.status !== 'queued') {
      throw new Error('Only queued follow-ups can be edited.');
    }

    const next: ThreadFollowUp = {
      ...current,
      content,
      updatedAt: new Date().toISOString()
    };

    this.db
      .prepare(
        `UPDATE thread_followups
         SET content = @content,
             updated_at = @updatedAt
         WHERE id = @id`
      )
      .run({
        id: next.id,
        content: next.content,
        updatedAt: next.updatedAt
      });

    return this.getThreadFollowUp(followUpId);
  }

  cancelThreadFollowUp(followUpId: string): ThreadFollowUp {
    const current = this.getThreadFollowUp(followUpId);
    if (current.status !== 'queued') {
      throw new Error('Only queued follow-ups can be deleted.');
    }

    const cancelledAt = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE thread_followups
         SET status = 'cancelled',
             updated_at = @updatedAt,
             cancelled_at = @cancelledAt
         WHERE id = @id`
      )
      .run({
        id: current.id,
        updatedAt: cancelledAt,
        cancelledAt
      });

    return this.getThreadFollowUp(followUpId);
  }

  getThreadFollowUp(followUpId: string): ThreadFollowUp {
    const row = this.db.prepare('SELECT * FROM thread_followups WHERE id = ?').get(followUpId) as Row | undefined;
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
           LIMIT 1`
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
             AND status = 'queued'`
        )
        .run({
          id: String(row.id),
          updatedAt: claimedAt
        });

      const claimed = this.db.prepare('SELECT * FROM thread_followups WHERE id = ?').get(String(row.id)) as Row | undefined;
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
         WHERE id = @id`
      )
      .run({
        id: current.id,
        updatedAt: now,
        dispatchedAt: now
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
         WHERE id = @id`
      )
      .run({
        id: current.id,
        updatedAt: new Date().toISOString()
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
         WHERE id = @id`
      )
      .run({
        id: current.id,
        updatedAt: new Date().toISOString()
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
      clauses.push(input.targetRunId === null ? 'target_run_id IS NULL' : 'target_run_id = @targetRunId');
    }
    if (input.excludeId) {
      clauses.push('id != @excludeId');
    }

    const result = this.db
      .prepare(
        `UPDATE thread_followups
         SET status = 'superseded',
             updated_at = @updatedAt
         WHERE ${clauses.join(' AND ')}`
      )
      .run({
        threadId: input.threadId,
        kind: input.kind,
        targetRunId: input.targetRunId,
        excludeId: input.excludeId,
        updatedAt: new Date().toISOString()
      });
    return Number(result.changes ?? 0);
  }

  listSubagentsByParentThread(threadId: string): SubagentSummary[] {
    return this.db
      .prepare(
        `SELECT * FROM subagents
         WHERE parent_thread_id = ?
         ORDER BY created_at DESC`
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
           AND status IN ('queued', 'running')`
      )
      .get(providerId) as { count?: number } | undefined;
    return Number(row?.count ?? 0);
  }

  getSubagent(subagentId: string): SubagentSummary {
    const row = this.db.prepare('SELECT * FROM subagents WHERE id = ?').get(subagentId) as Row | undefined;
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
         LIMIT 1`
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
    delegationProfile: SubagentSummary['delegationProfile'];
  }): SubagentSummary {
    this.getThreadSummary(input.parentThreadId);
    const now = new Date().toISOString();
    const subagent: SubagentSummary = {
      id: randomUUID(),
      parentThreadId: input.parentThreadId,
      parentRunId: input.parentRunId ?? null,
      childThreadId: null,
      childRunId: null,
      name: input.name?.trim() || this.allocateSubagentName(input.parentThreadId),
      title: input.title,
      prompt: input.prompt,
      providerId: input.providerId,
      modelId: input.modelId,
      executionPermission: input.executionPermission,
      delegationProfile: input.delegationProfile,
      status: 'queued',
      outputSummary: null,
      lastError: null,
      createdAt: now,
      updatedAt: now,
      startedAt: null,
      completedAt: null
    };

    this.db
      .prepare(
        `INSERT INTO subagents (
          id, parent_thread_id, parent_run_id, child_thread_id, child_run_id, name, title, prompt, provider_id, model_id, execution_permission, delegation_profile, status, output_summary, last_error, created_at, updated_at, started_at, completed_at
        ) VALUES (
          @id, @parentThreadId, @parentRunId, @childThreadId, @childRunId, @name, @title, @prompt, @providerId, @modelId, @executionPermission, @delegationProfile, @status, @outputSummary, @lastError, @createdAt, @updatedAt, @startedAt, @completedAt
        )`
      )
      .run(subagent);

    return subagent;
  }

  updateSubagent(subagentId: string, input: Partial<Omit<SubagentSummary, 'id' | 'parentThreadId' | 'createdAt'>>) {
    const current = this.getSubagent(subagentId);
    const next: SubagentSummary = {
      ...current,
      ...input,
      id: current.id,
      parentThreadId: current.parentThreadId,
      createdAt: current.createdAt,
      updatedAt: new Date().toISOString()
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
         WHERE id = @id`
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
         ORDER BY thread_id ASC`
      )
      .all()
      .map((row) => String((row as Row).thread_id));
  }

  getThreadDraft(threadId: string): string {
    const row = this.db.prepare('SELECT prompt FROM thread_drafts WHERE thread_id = ?').get(threadId) as
      | { prompt: string }
      | undefined;
    return row?.prompt ?? '';
  }

  saveThreadDraft(threadId: string, prompt: string): string {
    const now = new Date().toISOString();
    if (!prompt.trim()) {
      this.clearThreadDraft(threadId);
      return '';
    }

    this.db
      .prepare(
        `INSERT INTO thread_drafts (thread_id, prompt, updated_at)
         VALUES (@threadId, @prompt, @updatedAt)
         ON CONFLICT(thread_id) DO UPDATE
         SET prompt = excluded.prompt,
             updated_at = excluded.updated_at`
      )
      .run({
        threadId,
        prompt,
        updatedAt: now
      });

    return prompt;
  }

  clearThreadDraft(threadId: string) {
    this.db.prepare('DELETE FROM thread_drafts WHERE thread_id = ?').run(threadId);
  }

  getThreadSummary(threadId: string): ThreadSummary {
    const row = this.db.prepare('SELECT * FROM threads WHERE id = ?').get(threadId) as Row | undefined;
    if (!row) {
      throw new Error(`Thread not found: ${threadId}`);
    }
    return this.mapThreadSummary(row);
  }

  renameThread(threadId: string, title: string): ThreadSummary {
    const normalizedTitle = normalizeDisplayText(title);
    this.db.prepare('UPDATE threads SET title = ?, updated_at = ? WHERE id = ?').run(normalizedTitle, new Date().toISOString(), threadId);
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
    return this.db
      .prepare(
        `SELECT project_id, team_id, lane_id, thread_id, paused, updated_at
         FROM vicode_build_lanes
         WHERE project_id = ?
         ORDER BY team_id ASC, lane_id ASC`
      )
      .all(projectId)
      .map((row) => ({
        projectId: String((row as Row).project_id),
        teamId: String((row as Row).team_id),
        laneId: String((row as Row).lane_id),
        threadId: ((row as Row).thread_id as string | null) ?? null,
        paused: Boolean((row as Row).paused),
        updatedAt: String((row as Row).updated_at)
      }));
  }

  getVicodeBuildLaneState(projectId: string, teamId: string, laneId: string): {
    projectId: string;
    teamId: string;
    laneId: string;
    threadId: string | null;
    paused: boolean;
    updatedAt: string;
  } {
    const row = this.db
      .prepare(
        `SELECT project_id, team_id, lane_id, thread_id, paused, updated_at
         FROM vicode_build_lanes
         WHERE project_id = ? AND team_id = ? AND lane_id = ?`
      )
      .get(projectId, teamId, laneId) as Row | undefined;
    if (!row) {
      return {
        projectId,
        teamId,
        laneId,
        threadId: null,
        paused: false,
        updatedAt: new Date(0).toISOString()
      };
    }
    return {
      projectId: String(row.project_id),
      teamId: String(row.team_id),
      laneId: String(row.lane_id),
      threadId: (row.thread_id as string | null) ?? null,
      paused: Boolean(row.paused),
      updatedAt: String(row.updated_at)
    };
  }

  findVicodeBuildLaneByThread(threadId: string): {
    projectId: string;
    teamId: string;
    laneId: string;
    threadId: string | null;
    paused: boolean;
    updatedAt: string;
  } | null {
    const row = this.db
      .prepare(
        `SELECT project_id, team_id, lane_id, thread_id, paused, updated_at
         FROM vicode_build_lanes
         WHERE thread_id = ?`
      )
      .get(threadId) as Row | undefined;
    if (!row) {
      return null;
    }

    return {
      projectId: String(row.project_id),
      teamId: String(row.team_id),
      laneId: String(row.lane_id),
      threadId: (row.thread_id as string | null) ?? null,
      paused: Boolean(row.paused),
      updatedAt: String(row.updated_at)
    };
  }

  saveVicodeBuildLaneState(input: {
    projectId: string;
    teamId: string;
    laneId: string;
    threadId?: string | null;
    paused?: boolean;
  }) {
    const current = this.getVicodeBuildLaneState(input.projectId, input.teamId, input.laneId);
    const next = {
      ...current,
      threadId: input.threadId === undefined ? current.threadId : input.threadId,
      paused: input.paused ?? current.paused,
      updatedAt: new Date().toISOString()
    };
    this.db
      .prepare(
        `INSERT INTO vicode_build_lanes (project_id, team_id, lane_id, thread_id, paused, updated_at)
         VALUES (@projectId, @teamId, @laneId, @threadId, @paused, @updatedAt)
         ON CONFLICT(project_id, team_id, lane_id) DO UPDATE SET
           thread_id = excluded.thread_id,
           paused = excluded.paused,
           updated_at = excluded.updated_at`
      )
      .run({
        ...next,
        paused: next.paused ? 1 : 0
      });
    return next;
  }

  listAutonomousTasksForProject(projectId: string, kind?: AutonomousTaskRecord['kind']): AutonomousTaskRecord[] {
    const rows = (
      kind
        ? this.db
            .prepare(
              `SELECT * FROM autonomous_tasks
               WHERE project_id = ? AND kind = ?
               ORDER BY updated_at DESC`
            )
            .all(projectId, kind)
        : this.db
            .prepare(
              `SELECT * FROM autonomous_tasks
               WHERE project_id = ?
               ORDER BY updated_at DESC`
            )
            .all(projectId)
    ) as Row[];
    return rows.map((row) => this.mapAutonomousTask(row));
  }

  getAutonomousTaskByKindAndSource(kind: AutonomousTaskRecord['kind'], sourceId: string): AutonomousTaskRecord | null {
    const row = this.db
      .prepare(
        `SELECT * FROM autonomous_tasks
         WHERE kind = ? AND source_id = ?`
      )
      .get(kind, sourceId) as Row | undefined;
    return row ? this.mapAutonomousTask(row) : null;
  }

  deleteAutonomousTaskByKindAndSource(kind: AutonomousTaskRecord['kind'], sourceId: string) {
    this.db
      .prepare(
        `DELETE FROM autonomous_tasks
         WHERE kind = ? AND source_id = ?`
      )
      .run(kind, sourceId);
  }

  upsertAutonomousTask(
    input: Omit<AutonomousTaskRecord, 'createdAt' | 'updatedAt'> & { createdAt?: string; updatedAt?: string }
  ): AutonomousTaskRecord {
    const existing = this.getAutonomousTaskByKindAndSource(input.kind, input.sourceId);
    const now = new Date().toISOString();
    const next: AutonomousTaskRecord = {
      ...existing,
      ...input,
      id: existing?.id ?? input.id ?? randomUUID(),
      createdAt: existing?.createdAt ?? input.createdAt ?? now,
      updatedAt: input.updatedAt ?? now
    };

    this.db
      .prepare(
        `INSERT INTO autonomous_tasks (
          id, kind, project_id, thread_id, run_id, source_id, title, summary,
          owner_label, provenance_label, trust_label, approval_label, status,
          status_label, blocked_by, blocking, last_error, metadata_json,
          created_at, updated_at, started_at, completed_at
        ) VALUES (
          @id, @kind, @projectId, @threadId, @runId, @sourceId, @title, @summary,
          @ownerLabel, @provenanceLabel, @trustLabel, @approvalLabel, @status,
          @statusLabel, @blockedBy, @blocking, @lastError, @metadataJson,
          @createdAt, @updatedAt, @startedAt, @completedAt
        )
        ON CONFLICT(kind, source_id) DO UPDATE SET
          project_id = excluded.project_id,
          thread_id = excluded.thread_id,
          run_id = excluded.run_id,
          title = excluded.title,
          summary = excluded.summary,
          owner_label = excluded.owner_label,
          provenance_label = excluded.provenance_label,
          trust_label = excluded.trust_label,
          approval_label = excluded.approval_label,
          status = excluded.status,
          status_label = excluded.status_label,
          blocked_by = excluded.blocked_by,
          blocking = excluded.blocking,
          last_error = excluded.last_error,
          metadata_json = excluded.metadata_json,
          updated_at = excluded.updated_at,
          started_at = excluded.started_at,
          completed_at = excluded.completed_at`
      )
      .run({
        id: next.id,
        kind: next.kind,
        projectId: next.projectId,
        threadId: next.threadId,
        runId: next.runId,
        sourceId: next.sourceId,
        title: next.title,
        summary: next.summary,
        ownerLabel: next.ownerLabel,
        provenanceLabel: next.provenanceLabel,
        trustLabel: next.trustLabel,
        approvalLabel: next.approvalLabel,
        status: next.status,
        statusLabel: next.statusLabel,
        blockedBy: next.blockedBy,
        blocking: next.blocking,
        lastError: next.lastError,
        metadataJson: JSON.stringify(next.metadata ?? {}),
        createdAt: next.createdAt,
        updatedAt: next.updatedAt,
        startedAt: next.startedAt,
        completedAt: next.completedAt
      });

    return this.getAutonomousTaskByKindAndSource(next.kind, next.sourceId)!;
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
    const clauses = ['project_id = @projectId'];
    if (input.teamId) {
      clauses.push('team_id = @teamId');
    }
    if (input.laneId) {
      clauses.push('lane_id = @laneId');
    }
    const limit = Math.max(1, Math.min(200, input.limit ?? 20));
    const rows = this.db
      .prepare(
        `SELECT id, project_id, team_id, lane_id, kind, trigger_kind, summary, detail, source_lane_id, target_lane_id, thread_id, run_id, created_at
         FROM vicode_build_events
         WHERE ${clauses.join(' AND ')}
         ORDER BY created_at DESC
         LIMIT @limit`
      )
      .all({
        projectId: input.projectId,
        teamId: input.teamId ?? null,
        laneId: input.laneId ?? null,
        limit
      });

    return rows.map((row) => ({
      id: String((row as Row).id),
      projectId: String((row as Row).project_id),
      teamId: String((row as Row).team_id),
      laneId: String((row as Row).lane_id),
      kind: String((row as Row).kind),
      trigger: String((row as Row).trigger_kind),
      summary: String((row as Row).summary),
      detail: ((row as Row).detail as string | null) ?? null,
      sourceLaneId: ((row as Row).source_lane_id as string | null) ?? null,
      targetLaneId: ((row as Row).target_lane_id as string | null) ?? null,
      threadId: ((row as Row).thread_id as string | null) ?? null,
      runId: ((row as Row).run_id as string | null) ?? null,
      createdAt: String((row as Row).created_at)
    }));
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
    const event = {
      id: randomUUID(),
      projectId: input.projectId,
      teamId: input.teamId,
      laneId: input.laneId,
      kind: input.kind,
      trigger: input.trigger,
      summary: input.summary,
      detail: input.detail ?? null,
      sourceLaneId: input.sourceLaneId ?? null,
      targetLaneId: input.targetLaneId ?? null,
      threadId: input.threadId ?? null,
      runId: input.runId ?? null,
      createdAt: new Date().toISOString()
    };

    this.db
      .prepare(
        `INSERT INTO vicode_build_events (
          id, project_id, team_id, lane_id, kind, trigger_kind, summary, detail, source_lane_id, target_lane_id, thread_id, run_id, created_at
        ) VALUES (
          @id, @projectId, @teamId, @laneId, @kind, @trigger, @summary, @detail, @sourceLaneId, @targetLaneId, @threadId, @runId, @createdAt
        )`
      )
      .run(event);

    return event;
  }

  archiveThread(threadId: string) {
    this.db.prepare(`UPDATE threads SET archived = 1, status = 'archived', updated_at = ? WHERE id = ?`).run(new Date().toISOString(), threadId);
  }

  restoreThread(threadId: string): ThreadSummary {
    const current = this.getThreadSummary(threadId);
    this.db
      .prepare(`UPDATE threads SET archived = 0, status = ?, updated_at = ? WHERE id = ?`)
      .run(current.status === 'archived' ? 'completed' : current.status, new Date().toISOString(), threadId);
    return this.getThreadSummary(threadId);
  }

  deleteThread(threadId: string) {
    this.db.prepare('DELETE FROM threads WHERE id = ?').run(threadId);
  }

  duplicateThread(threadId: string, fromTurnId?: string | null): ThreadDetail {
    const source = this.getThread(threadId);
    const duplicate = this.createThread({
      projectId: source.projectId,
      title: `${source.title} Copy`,
      providerId: source.providerId,
      modelId: source.modelId,
      executionPermission: source.executionPermission
    });
    let copyTurns = source.turns;
    if (fromTurnId) {
      const untilIndex = source.turns.findIndex((turn) => turn.id === fromTurnId);
      if (untilIndex >= 0) {
        copyTurns = source.turns.slice(0, untilIndex + 1);
      }
    }
    for (const turn of copyTurns) {
      this.appendTurn(duplicate.id, turn.role, turn.content, turn.metadata, turn.runId);
    }
    return this.getThread(duplicate.id);
  }

  appendTurn(
    threadId: string,
    role: ThreadTurn['role'],
    content: string,
    metadata: Record<string, unknown> | null = null,
    runId: string | null = null
  ) {
    const now = new Date().toISOString();
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO thread_turns (id, thread_id, run_id, role, content, metadata_json, created_at)
         VALUES (@id, @threadId, @runId, @role, @content, @metadataJson, @createdAt)`
      )
      .run({
        id,
        threadId,
        runId,
        role,
        content,
        metadataJson: metadata ? JSON.stringify(metadata) : null,
        createdAt: now
      });
    this.db
      .prepare('UPDATE threads SET updated_at = ?, last_message_at = ?, last_preview = ? WHERE id = ?')
      .run(now, now, content.slice(0, 160), threadId);
    return {
      id,
      threadId,
      runId,
      role,
      content,
      sources: metadata ? normalizeThreadSources(metadata.sources) : [],
      metadata,
      createdAt: now
    } satisfies ThreadTurn;
  }

  updateAssistantTurn(runId: string, threadId: string, content: string, metadata?: Record<string, unknown> | null) {
    const existing = this.db
      .prepare('SELECT id FROM thread_turns WHERE run_id = ? AND role = ? ORDER BY created_at DESC LIMIT 1')
      .get(runId, 'assistant') as { id: string } | undefined;
    if (!existing) {
      this.appendTurn(threadId, 'assistant', content, metadata ?? null, runId);
      return;
    }
    const now = new Date().toISOString();
    if (metadata === undefined) {
      this.db.prepare('UPDATE thread_turns SET content = ?, created_at = ? WHERE id = ?').run(content, now, existing.id);
    } else {
      this.db
        .prepare('UPDATE thread_turns SET content = ?, metadata_json = ?, created_at = ? WHERE id = ?')
        .run(content, metadata ? JSON.stringify(metadata) : null, now, existing.id);
    }
    this.db.prepare('UPDATE threads SET updated_at = ?, last_message_at = ?, last_preview = ? WHERE id = ?').run(now, now, content.slice(0, 160), threadId);
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
         )`
      )
      .run(runId, threadId);
  }

  updateThreadStatus(threadId: string, status: ThreadSummary['status']) {
    this.db.prepare('UPDATE threads SET status = ?, updated_at = ? WHERE id = ?').run(status, new Date().toISOString(), threadId);
  }

  findThreadIdByRunId(runId: string): string | null {
    const runEventRow = this.db
      .prepare('SELECT thread_id FROM run_events WHERE run_id = ? ORDER BY created_at DESC LIMIT 1')
      .get(runId) as { thread_id: string } | undefined;
    if (runEventRow?.thread_id) {
      return String(runEventRow.thread_id);
    }

    const turnRow = this.db
      .prepare('SELECT thread_id FROM thread_turns WHERE run_id = ? ORDER BY created_at DESC LIMIT 1')
      .get(runId) as { thread_id: string } | undefined;
    return turnRow?.thread_id ? String(turnRow.thread_id) : null;
  }

  setThreadExecutionPermission(threadId: string, executionPermission: ExecutionPermission): ThreadDetail {
    this.getThreadSummary(threadId);
    this.db.prepare('UPDATE threads SET execution_permission = ? WHERE id = ?').run(executionPermission, threadId);
    return this.getThread(threadId);
  }

  syncThreadRunConfiguration(threadId: string, input: {
    providerId: ProviderId;
    modelId: string;
    executionPermission: ExecutionPermission;
  }): ThreadDetail {
    this.getThreadSummary(threadId);
    this.db
      .prepare(
        `UPDATE threads
         SET provider_id = @providerId,
             model_id = @modelId,
             execution_permission = @executionPermission,
             updated_at = @updatedAt
         WHERE id = @threadId`
      )
      .run({
        threadId,
        providerId: input.providerId,
        modelId: input.modelId,
        executionPermission: input.executionPermission,
        updatedAt: new Date().toISOString()
      });
    return this.getThread(threadId);
  }

  addRunEvent(threadId: string, runId: string, eventType: RunEvent['eventType'], payload: Record<string, unknown>): RunEvent {
    const now = new Date().toISOString();
    const event: RunEvent = {
      id: randomUUID(),
      threadId,
      runId,
      eventType,
      payload,
      createdAt: now
    };
    this.db
      .prepare(
        `INSERT INTO run_events (id, thread_id, run_id, event_type, payload_json, created_at)
         VALUES (@id, @threadId, @runId, @eventType, @payloadJson, @createdAt)`
      )
      .run({
        id: event.id,
        threadId,
        runId,
        eventType,
        payloadJson: JSON.stringify(payload),
        createdAt: now
      });
    return event;
  }

  getStorageDiagnostics(): StorageDiagnostics {
    const readSize = (path: string) => (existsSync(path) ? statSync(path).size : 0);
    const count = (table: string, where?: string) =>
      (this.db.prepare(`SELECT COUNT(*) as total FROM ${table}${where ? ` WHERE ${where}` : ''}`).get() as { total: number }).total;
    const databaseSizeBytes = readSize(this.databasePath);
    const walSizeBytes = readSize(`${this.databasePath}-wal`);
    const shmSizeBytes = readSize(`${this.databasePath}-shm`);
    const threadCount = count('threads');
    const archivedThreadCount = count('threads', 'archived = 1');
    const compactableRuns = this.listCompactableRunEvents(this.getRunEventCompactionCutoffIso());

    return {
      databasePath: this.databasePath,
      databaseSizeBytes,
      walSizeBytes,
      shmSizeBytes,
      totalStorageBytes: databaseSizeBytes + walSizeBytes + shmSizeBytes,
      projectCount: count('projects'),
      threadCount,
      archivedThreadCount,
      activeThreadCount: threadCount - archivedThreadCount,
      turnCount: count('thread_turns'),
      runEventCount: count('run_events'),
      compactableRunCount: compactableRuns.length,
      compactableDeltaEventCount: compactableRuns.reduce((total, run) => total + run.deltaCount, 0),
      compactionCutoffDays: RUN_EVENT_COMPACTION_CUTOFF_DAYS
    };
  }

  compactOldTerminalRunEvents(_input?: Record<string, never>): StorageCompactionResult {
    const cutoffIso = this.getRunEventCompactionCutoffIso();
    const candidates = this.listCompactableRunEvents(cutoffIso);
    if (candidates.length === 0) {
      return {
        cutoffIso,
        cutoffDays: RUN_EVENT_COMPACTION_CUTOFF_DAYS,
        runsCompacted: 0,
        deltaEventsDeleted: 0
      };
    }

    const deleteDeltaEvents = this.db.prepare(
      `DELETE FROM run_events
       WHERE thread_id = ?
         AND run_id = ?
         AND event_type = 'delta'`
    );

    const deltaEventsDeleted = this.db.transaction(() => {
      let deleted = 0;
      for (const candidate of candidates) {
        deleted += deleteDeltaEvents.run(candidate.threadId, candidate.runId).changes;
      }
      return deleted;
    })();

    return {
      cutoffIso,
      cutoffDays: RUN_EVENT_COMPACTION_CUTOFF_DAYS,
      runsCompacted: candidates.length,
      deltaEventsDeleted
    };
  }

  maintainStorage(input?: { vacuum?: boolean }): StorageMaintenanceResult {
    const before = this.getStorageDiagnostics();
    const compaction = this.compactOldTerminalRunEvents();
    this.db.pragma('wal_checkpoint(TRUNCATE)');

    if (input?.vacuum) {
      this.db.exec('VACUUM');
    }

    const after = this.getStorageDiagnostics();
    return {
      ...compaction,
      vacuumApplied: input?.vacuum === true,
      sizeBeforeBytes: before.totalStorageBytes,
      sizeAfterBytes: after.totalStorageBytes,
      reclaimedBytes: Math.max(0, before.totalStorageBytes - after.totalStorageBytes)
    };
  }

  getThreadPlannerState(threadId: string): ThreadPlannerState {
    this.ensureThreadPlannerState(threadId);
    const row = this.db.prepare('SELECT * FROM thread_planner_state WHERE thread_id = ?').get(threadId) as Row;
    return this.mapThreadPlannerState(row);
  }

  setThreadPlannerMode(threadId: string, mode: ComposerMode): ThreadPlannerState {
    return this.updateThreadPlannerState(threadId, { composerMode: mode });
  }

  setThreadPlannerTurnState(threadId: string, turnState: PlanTurnState): ThreadPlannerState {
    return this.updateThreadPlannerState(threadId, { turnState });
  }

  createPlannerQuestionSet(threadId: string, promptTurnId: string, callId: string, questions: PlannerQuestionSet['questions']) {
    this.ensureThreadPlannerState(threadId);
    const now = new Date().toISOString();
    const record: PlannerQuestionSet = {
      id: randomUUID(),
      threadId,
      promptTurnId,
      callId,
      questions,
      answers: null,
      createdAt: now
    };
    this.db
      .prepare(
        `INSERT INTO planner_question_sets (
          question_set_id, thread_id, prompt_turn_id, call_id, questions_json, answers_json, created_at
        ) VALUES (
          @id, @threadId, @promptTurnId, @callId, @questionsJson, NULL, @createdAt
        )`
      )
      .run({
        id: record.id,
        threadId,
        promptTurnId,
        callId,
        questionsJson: JSON.stringify(record.questions),
        createdAt: now
      });

      this.updateThreadPlannerState(threadId, {
        turnState: 'waiting_for_answers',
        pendingQuestionCallId: callId
      });

      return record;
    }

    answerPlannerQuestionSet(threadId: string, callId: string, answers: Record<string, PlannerQuestionAnswer>) {
      this.ensureThreadPlannerState(threadId);
      this.db.prepare('UPDATE planner_question_sets SET answers_json = ? WHERE thread_id = ? AND call_id = ?').run(JSON.stringify(answers), threadId, callId);
      return this.getPlannerQuestionSetByThreadAndCallId(threadId, callId);
    }

  createPlannerPlan(
    threadId: string,
    createdTurnId: string,
    proposedPlanMarkdown: string,
    structuredPlan: StructuredPlannerPlan | null
  ) {
    this.ensureThreadPlannerState(threadId);
    const current = this.getThreadPlannerState(threadId);
    const now = new Date().toISOString();
    const plan: PlannerPlan = {
      id: randomUUID(),
      threadId,
      createdTurnId,
      proposedPlanMarkdown,
      structuredPlan,
      status: 'draft',
      createdAt: now
    };

    const transaction = this.db.transaction(() => {
      if (current.activePlanId) {
        this.db
          .prepare(`UPDATE planner_plans SET status = 'superseded' WHERE plan_id = ? AND status != 'approved'`)
          .run(current.activePlanId);
      }

      this.db
        .prepare(
          `INSERT INTO planner_plans (
            plan_id, thread_id, created_turn_id, proposed_plan_markdown, structured_plan_json, status, created_at
          ) VALUES (
            @id, @threadId, @createdTurnId, @proposedPlanMarkdown, @structuredPlanJson, @status, @createdAt
          )`
        )
        .run({
          id: plan.id,
          threadId,
          createdTurnId,
          proposedPlanMarkdown,
          structuredPlanJson: structuredPlan ? JSON.stringify(structuredPlan) : null,
          status: plan.status,
          createdAt: now
        });

      this.db
        .prepare(
          `UPDATE thread_planner_state
           SET active_plan_id = @activePlanId,
               pending_question_call_id = NULL,
               turn_state = 'plan_ready',
               updated_at = @updatedAt
           WHERE thread_id = @threadId`
        )
        .run({
          activePlanId: plan.id,
          updatedAt: now,
          threadId
        });
    });

    transaction();
    return this.getPlannerPlan(plan.id);
  }

  approvePlannerPlan(threadId: string, planId: string) {
    this.ensureThreadPlannerState(threadId);
    const now = new Date().toISOString();
    const transaction = this.db.transaction(() => {
      this.db.prepare(`UPDATE planner_plans SET status = 'superseded' WHERE thread_id = ? AND plan_id != ? AND status != 'approved'`).run(threadId, planId);
      this.db.prepare(`UPDATE planner_plans SET status = 'approved' WHERE plan_id = ? AND thread_id = ?`).run(planId, threadId);
      this.db
        .prepare(
          `UPDATE thread_planner_state
           SET composer_mode = 'default',
               turn_state = 'executing_from_plan',
               active_plan_id = @activePlanId,
               pending_question_call_id = NULL,
               updated_at = @updatedAt
           WHERE thread_id = @threadId`
        )
        .run({
          activePlanId: planId,
          updatedAt: now,
          threadId
        });
    });

    transaction();
    return this.getPlannerPlan(planId);
  }

  clearPendingPlannerQuestions(threadId: string) {
    return this.updateThreadPlannerState(threadId, { pendingQuestionCallId: null });
  }

  clearThreadPlannerSession(threadId: string) {
    this.ensureThreadPlannerState(threadId);
    const current = this.getThreadPlannerState(threadId);
    const now = new Date().toISOString();
    const transaction = this.db.transaction(() => {
      if (current.activePlanId) {
        this.db
          .prepare(`UPDATE planner_plans SET status = 'superseded' WHERE plan_id = ? AND status != 'approved'`)
          .run(current.activePlanId);
      }
      this.db
        .prepare(
          `UPDATE thread_planner_state
           SET composer_mode = 'default',
               turn_state = 'idle',
               active_plan_id = NULL,
               pending_question_call_id = NULL,
               updated_at = @updatedAt
           WHERE thread_id = @threadId`
        )
        .run({
          threadId,
          updatedAt: now
        });
    });
    transaction();
    return this.getThreadPlannerState(threadId);
  }

  getPlannerQuestionSetByCallId(callId: string): PlannerQuestionSet {
      const row = this.db.prepare('SELECT * FROM planner_question_sets WHERE call_id = ?').get(callId) as Row | undefined;
      if (!row) {
        throw new Error(`Planner question set not found for call ${callId}.`);
      }
      return this.mapPlannerQuestionSet(row);
    }

    getPlannerQuestionSetByThreadAndCallId(threadId: string, callId: string): PlannerQuestionSet {
      const row = this.db
        .prepare('SELECT * FROM planner_question_sets WHERE thread_id = ? AND call_id = ? ORDER BY created_at DESC LIMIT 1')
        .get(threadId, callId) as Row | undefined;
      if (!row) {
        throw new Error(`Planner question set not found for thread ${threadId} and call ${callId}.`);
      }
      return this.mapPlannerQuestionSet(row);
    }

  getLatestPlannerQuestionSet(threadId: string): PlannerQuestionSet | null {
    const row = this.db
      .prepare('SELECT * FROM planner_question_sets WHERE thread_id = ? ORDER BY created_at DESC LIMIT 1')
      .get(threadId) as Row | undefined;
    return row ? this.mapPlannerQuestionSet(row) : null;
  }

  getPlannerPlan(planId: string): PlannerPlan {
    const row = this.db.prepare('SELECT * FROM planner_plans WHERE plan_id = ?').get(planId) as Row | undefined;
    if (!row) {
      throw new Error(`Planner plan not found: ${planId}`);
    }
    return this.mapPlannerPlan(row);
  }

  getProviderAccount(providerId: ProviderId): ProviderAccount | null {
    const row = this.db.prepare('SELECT * FROM provider_accounts WHERE provider_id = ?').get(providerId) as Row | undefined;
    return row ? this.mapProviderAccount(row) : null;
  }

  saveProviderAccount(account: ProviderAccount): ProviderAccount {
    this.db
      .prepare(
        `INSERT INTO provider_accounts (provider_id, auth_state, auth_mode, encrypted_api_key, updated_at)
         VALUES (@providerId, @authState, @authMode, @encryptedApiKey, @updatedAt)
         ON CONFLICT(provider_id) DO UPDATE SET
           auth_state = excluded.auth_state,
           auth_mode = excluded.auth_mode,
           encrypted_api_key = excluded.encrypted_api_key,
           updated_at = excluded.updated_at`
      )
      .run(account);
    return account;
  }

  getProviderModelCache(providerId: ProviderId): { models: ProviderModel[]; updatedAt: string | null; source: ProviderModelSource | null } {
    const rows = this.db
      .prepare(
        `SELECT provider_id, model_id, label, description, supports_vision, source, updated_at
         FROM provider_models_cache
         WHERE provider_id = ?
         ORDER BY sort_order ASC, label ASC`
      )
      .all(providerId) as Array<Row>;

    if (rows.length === 0) {
      return { models: [], updatedAt: null, source: null };
    }

    return {
      models: rows.map((row) => this.mapProviderModel(row)),
      updatedAt: String(rows[0].updated_at),
      source: String(rows[0].source)
    };
  }

  replaceProviderModels(providerId: ProviderId, models: ProviderModel[], source: Extract<ProviderModelSource, 'api' | 'runtime'>) {
    const now = new Date().toISOString();
    const transaction = this.db.transaction(() => {
      this.db.prepare('DELETE FROM provider_models_cache WHERE provider_id = ?').run(providerId);
      const insert = this.db.prepare(
        `INSERT INTO provider_models_cache (
          provider_id, model_id, label, description, supports_vision, sort_order, source, updated_at
        ) VALUES (
          @providerId, @modelId, @label, @description, @supportsVision, @sortOrder, @source, @updatedAt
        )`
      );

      models.forEach((model, index) => {
        insert.run({
          providerId,
          modelId: model.id,
          label: model.label,
          description: model.description,
          supportsVision: model.supportsVision ? 1 : 0,
          sortOrder: index,
          source,
          updatedAt: now
        });
      });
    });

    transaction();
  }

  clearProviderModelCache(providerId: ProviderId) {
    this.db.prepare('DELETE FROM provider_models_cache WHERE provider_id = ?').run(providerId);
  }

  listSkills(): SkillDefinition[] {
    return this.db.prepare('SELECT * FROM skills ORDER BY origin, name').all().map((row) => this.mapSkill(row as Row));
  }

  getSkillsByIds(skillIds: string[]): SkillDefinition[] {
    if (skillIds.length === 0) {
      return [];
    }
    const placeholders = skillIds.map(() => '?').join(', ');
    return this.db
      .prepare(`SELECT * FROM skills WHERE id IN (${placeholders}) ORDER BY name`)
      .all(...skillIds)
      .map((row) => this.mapSkill(row as Row));
  }

  upsertSkill(skill: SkillDefinition): SkillDefinition {
    this.db
      .prepare(
        `INSERT INTO skills (
          id, name, description, instructions, origin, scope, provider_targets_json, enabled, project_id, metadata_json, path, created_at, updated_at
        ) VALUES (
          @id, @name, @description, @instructions, @origin, @scope, @providerTargetsJson, @enabled, @projectId, @metadataJson, @path, @createdAt, @updatedAt
        )
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          description = excluded.description,
          instructions = excluded.instructions,
          origin = excluded.origin,
          scope = excluded.scope,
          provider_targets_json = excluded.provider_targets_json,
          enabled = excluded.enabled,
          project_id = excluded.project_id,
          metadata_json = excluded.metadata_json,
          path = excluded.path,
          created_at = excluded.created_at,
          updated_at = excluded.updated_at`
      )
      .run({
        id: skill.id,
        name: skill.name,
        description: skill.description,
        instructions: skill.instructions,
        origin: skill.origin,
        scope: skill.scope,
        providerTargetsJson: JSON.stringify(skill.providerTargets),
        enabled: skill.enabled ? 1 : 0,
        projectId: skill.projectId,
        metadataJson: JSON.stringify(skill.metadata ?? {}),
        path: skill.path,
        createdAt: skill.createdAt,
        updatedAt: skill.updatedAt
      });

    return this.getSkill(skill.id);
  }

  saveSkill(input: SkillSaveInput): SkillDefinition {
    const now = new Date().toISOString();
    const existing = input.id ? this.db.prepare('SELECT id FROM skills WHERE id = ?').get(input.id) : undefined;
    const current = existing ? this.getSkill(String((existing as { id: string }).id)) : null;

    return this.upsertSkill({
      id: current?.id ?? input.id ?? randomUUID(),
      name: input.name,
      description: input.description,
      instructions: input.instructions,
      origin: current?.origin ?? 'custom_local',
      scope: input.scope,
      providerTargets: input.providerTargets,
      enabled: input.enabled,
      projectId: input.projectId ?? null,
      metadata: current?.metadata ?? {},
      path: current?.path ?? null,
      createdAt: current?.createdAt ?? now,
      updatedAt: now
    });
  }

  toggleSkill(skillId: string, enabled: boolean): SkillDefinition {
    this.db.prepare('UPDATE skills SET enabled = ?, updated_at = ? WHERE id = ?').run(enabled ? 1 : 0, new Date().toISOString(), skillId);
    return this.getSkill(skillId);
  }

  getSkill(skillId: string): SkillDefinition {
    const row = this.db.prepare('SELECT * FROM skills WHERE id = ?').get(skillId) as Row | undefined;
    if (!row) {
      throw new Error(`Skill not found: ${skillId}`);
    }
    return this.mapSkill(row);
  }

  deleteSkill(skillId: string) {
    this.db.prepare('DELETE FROM skills WHERE id = ?').run(skillId);
  }

  listAutomations(): AutomationDefinition[] {
    return this.db.prepare('SELECT * FROM automations ORDER BY updated_at DESC').all().map((row) => this.mapAutomation(row as Row));
  }

  listMcpServers(): McpServerRecord[] {
    return this.db
      .prepare(
        `SELECT
          servers.*,
          state.server_id AS state_server_id,
          state.status AS state_status,
          state.capabilities_json AS state_capabilities_json,
          state.last_seen_at AS state_last_seen_at,
          state.last_error AS state_last_error,
          state.tool_count AS state_tool_count,
          state.resource_count AS state_resource_count,
          state.prompt_count AS state_prompt_count,
          state.updated_at AS state_updated_at
         FROM mcp_servers servers
         LEFT JOIN mcp_server_state state ON state.server_id = servers.id
         ORDER BY servers.updated_at DESC`
      )
      .all()
      .map((row) => this.mapMcpServerRecord(row as Row));
  }

  getMcpServer(serverId: string): McpServerRecord {
    const row = this.db
      .prepare(
        `SELECT
          servers.*,
          state.server_id AS state_server_id,
          state.status AS state_status,
          state.capabilities_json AS state_capabilities_json,
          state.last_seen_at AS state_last_seen_at,
          state.last_error AS state_last_error,
          state.tool_count AS state_tool_count,
          state.resource_count AS state_resource_count,
          state.prompt_count AS state_prompt_count,
          state.updated_at AS state_updated_at
         FROM mcp_servers servers
         LEFT JOIN mcp_server_state state ON state.server_id = servers.id
         WHERE servers.id = ?`
      )
      .get(serverId) as Row | undefined;
    if (!row) {
      throw new Error(`MCP server not found: ${serverId}`);
    }
    return this.mapMcpServerRecord(row);
  }

  saveMcpServer(input: McpServerSaveInput): McpServerRecord {
    const now = new Date().toISOString();
    const id = input.id ?? randomUUID();
    const exists = input.id ? this.db.prepare('SELECT id FROM mcp_servers WHERE id = ?').get(input.id) : undefined;

    if (exists) {
      this.db
        .prepare(
          `UPDATE mcp_servers
           SET name = @name,
               scope = @scope,
               project_id = @projectId,
               transport_type = @transportType,
               command = @command,
               args_json = @argsJson,
               cwd = @cwd,
               env_json = @envJson,
               enabled = @enabled,
               tool_invocation_mode = @toolInvocationMode,
               launch_approved = @launchApproved,
               updated_at = @updatedAt
           WHERE id = @id`
        )
        .run({
          id,
          name: input.name,
          scope: input.scope ?? this.getMcpServer(id).definition.scope,
          projectId: input.projectId === undefined ? this.getMcpServer(id).definition.projectId : input.projectId,
          transportType: input.transportType ?? 'stdio',
          command: input.command,
          argsJson: JSON.stringify(input.args ?? []),
          cwd: input.cwd ?? null,
          envJson: JSON.stringify(input.env ?? {}),
          enabled: input.enabled ? 1 : 0,
          toolInvocationMode: input.toolInvocationMode ?? 'ask',
          launchApproved:
            input.launchApproved === undefined ? (this.getMcpServer(id).definition.launchApproved ? 1 : 0) : input.launchApproved ? 1 : 0,
          updatedAt: now
        });
    } else {
      this.db
        .prepare(
          `INSERT INTO mcp_servers (
            id, name, scope, project_id, transport_type, command, args_json, cwd, env_json, enabled, tool_invocation_mode, launch_approved, created_at, updated_at
          ) VALUES (
            @id, @name, @scope, @projectId, @transportType, @command, @argsJson, @cwd, @envJson, @enabled, @toolInvocationMode, @launchApproved, @createdAt, @updatedAt
          )`
        )
        .run({
          id,
          name: input.name,
          scope: input.scope ?? 'global',
          projectId: input.projectId ?? null,
          transportType: input.transportType ?? 'stdio',
          command: input.command,
          argsJson: JSON.stringify(input.args ?? []),
          cwd: input.cwd ?? null,
          envJson: JSON.stringify(input.env ?? {}),
          enabled: input.enabled ? 1 : 0,
          toolInvocationMode: input.toolInvocationMode ?? 'ask',
          launchApproved: input.launchApproved ? 1 : 0,
          createdAt: now,
          updatedAt: now
        });
    }

    return this.getMcpServer(id);
  }

  deleteMcpServer(serverId: string) {
    this.db.prepare('DELETE FROM mcp_servers WHERE id = ?').run(serverId);
  }

  saveMcpServerState(input: {
    serverId: string;
    status: McpServerState['status'];
    capabilities: Record<string, unknown> | null;
    lastSeenAt: string | null;
    lastError: string | null;
    toolCount: number;
    resourceCount: number;
    promptCount: number;
    updatedAt: string;
  }) {
    this.db
      .prepare(
        `INSERT INTO mcp_server_state (
          server_id, status, capabilities_json, last_seen_at, last_error, tool_count, resource_count, prompt_count, updated_at
        ) VALUES (
          @serverId, @status, @capabilitiesJson, @lastSeenAt, @lastError, @toolCount, @resourceCount, @promptCount, @updatedAt
        )
        ON CONFLICT(server_id) DO UPDATE SET
          status = excluded.status,
          capabilities_json = excluded.capabilities_json,
          last_seen_at = excluded.last_seen_at,
          last_error = excluded.last_error,
          tool_count = excluded.tool_count,
          resource_count = excluded.resource_count,
          prompt_count = excluded.prompt_count,
          updated_at = excluded.updated_at`
      )
      .run({
        serverId: input.serverId,
        status: input.status,
        capabilitiesJson: input.capabilities ? JSON.stringify(input.capabilities) : null,
        lastSeenAt: input.lastSeenAt,
        lastError: input.lastError,
        toolCount: input.toolCount,
        resourceCount: input.resourceCount,
        promptCount: input.promptCount,
        updatedAt: input.updatedAt
      });
  }

  saveAutomation(input: AutomationSaveInput): AutomationDefinition {
    const now = new Date().toISOString();
    const id = input.id ?? randomUUID();
    const exists = input.id ? this.db.prepare('SELECT id FROM automations WHERE id = ?').get(input.id) : undefined;
    const current = exists ? this.getAutomation(id) : null;
    const nextRunAt = this.resolveAutomationNextRunAt(input, current, now);
    if (exists) {
      this.db
        .prepare(
          `UPDATE automations
           SET name = @name,
               project_id = @projectId,
               provider_id = @providerId,
               model_id = @modelId,
               prompt_template = @promptTemplate,
               skill_id = @skillId,
               enabled = @enabled,
               schedule_type = @scheduleType,
               interval_minutes = @intervalMinutes,
               next_run_at = @nextRunAt,
               updated_at = @updatedAt
           WHERE id = @id`
        )
        .run({
          id,
          name: input.name,
          projectId: input.projectId,
          providerId: input.providerId,
          modelId: input.modelId,
          promptTemplate: input.promptTemplate,
          skillId: input.skillId ?? null,
          enabled: input.enabled ? 1 : 0,
          scheduleType: input.scheduleType,
          intervalMinutes: input.intervalMinutes ?? null,
          nextRunAt,
          updatedAt: now
        });
    } else {
      this.db
        .prepare(
          `INSERT INTO automations (
             id, name, project_id, provider_id, model_id, prompt_template, skill_id, enabled, schedule_type, interval_minutes, last_run_at, next_run_at, status, created_at, updated_at
           ) VALUES (@id, @name, @projectId, @providerId, @modelId, @promptTemplate, @skillId, @enabled, @scheduleType, @intervalMinutes, NULL, @nextRunAt, 'idle', @createdAt, @updatedAt)`
        )
        .run({
          id,
          name: input.name,
          projectId: input.projectId,
          providerId: input.providerId,
          modelId: input.modelId,
          promptTemplate: input.promptTemplate,
          skillId: input.skillId ?? null,
          enabled: input.enabled ? 1 : 0,
          scheduleType: input.scheduleType,
          intervalMinutes: input.intervalMinutes ?? null,
          nextRunAt,
          createdAt: now,
          updatedAt: now
        });
    }
    return this.getAutomation(id);
  }

  getAutomation(id: string): AutomationDefinition {
    const row = this.db.prepare('SELECT * FROM automations WHERE id = ?').get(id) as Row | undefined;
    if (!row) {
      throw new Error(`Automation not found: ${id}`);
    }
    return this.mapAutomation(row);
  }

  toggleAutomation(automationId: string, enabled: boolean): AutomationDefinition {
    const automation = this.getAutomation(automationId);
    const now = new Date().toISOString();
    const nextRunAt =
      enabled && automation.scheduleType === 'interval_while_app_open' && automation.intervalMinutes
        ? this.computeAutomationNextRunAt(automation.intervalMinutes, now)
        : null;
    this.db
      .prepare('UPDATE automations SET enabled = ?, next_run_at = ?, updated_at = ? WHERE id = ?')
      .run(enabled ? 1 : 0, nextRunAt, now, automationId);
    return this.getAutomation(automationId);
  }

  setAutomationNextRunAt(automationId: string, nextRunAt: string | null): AutomationDefinition {
    this.db
      .prepare('UPDATE automations SET next_run_at = ?, updated_at = ? WHERE id = ?')
      .run(nextRunAt, new Date().toISOString(), automationId);
    return this.getAutomation(automationId);
  }

  deleteAutomation(automationId: string) {
    this.db.prepare('DELETE FROM automations WHERE id = ?').run(automationId);
  }

  listAutomationRuns(automationId: string): AutomationRun[] {
    return this.db
      .prepare('SELECT * FROM automation_runs WHERE automation_id = ? ORDER BY created_at DESC')
      .all(automationId)
      .map((row) => {
        const typed = row as Row;
        return {
          id: String(typed.id),
          automationId: String(typed.automation_id),
          threadId: typed.thread_id ? String(typed.thread_id) : null,
          status: typed.status as AutomationRun['status'],
          message: String(typed.message),
          createdAt: String(typed.created_at)
        };
      });
  }

  addAutomationRun(automationId: string, threadId: string | null, status: AutomationRun['status'], message: string): AutomationRun {
    const run: AutomationRun = {
      id: randomUUID(),
      automationId,
      threadId,
      status,
      message,
      createdAt: new Date().toISOString()
    };
    this.db
      .prepare(
        `INSERT INTO automation_runs (id, automation_id, thread_id, status, message, created_at)
         VALUES (@id, @automationId, @threadId, @status, @message, @createdAt)`
      )
      .run(run);
    this.db
      .prepare('UPDATE automations SET status = ?, last_run_at = ?, updated_at = ? WHERE id = ?')
      .run(status, run.createdAt, run.createdAt, automationId);
    return run;
  }

  listJobs(): JobDefinition[] {
    return this.db.prepare('SELECT * FROM jobs ORDER BY updated_at DESC').all().map((row) => this.mapJob(row as Row));
  }

  listJobsForThread(threadId: string): JobDefinition[] {
    return this.db
      .prepare(
        `SELECT * FROM jobs
         WHERE thread_id = ?
         ORDER BY updated_at DESC`
      )
      .all(threadId)
      .map((row) => this.mapJob(row as Row));
  }

  getJob(jobId: string): JobDefinition {
    const row = this.db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId) as Row | undefined;
    if (!row) {
      throw new Error(`Job not found: ${jobId}`);
    }
    return this.mapJob(row);
  }

  saveJob(input: {
    id?: string;
    projectId: string;
    sourceType: JobDefinition['sourceType'];
    sourceId?: string | null;
    title: string;
    status: JobDefinition['status'];
    threadId?: string | null;
  }): JobDefinition {
    const now = new Date().toISOString();
    const id = input.id ?? randomUUID();
    const exists = input.id ? this.db.prepare('SELECT id FROM jobs WHERE id = ?').get(input.id) : undefined;
    if (exists) {
      this.db
        .prepare(
          `UPDATE jobs
           SET project_id = @projectId,
               source_type = @sourceType,
               source_id = @sourceId,
               title = @title,
               status = @status,
               thread_id = @threadId,
               updated_at = @updatedAt
           WHERE id = @id`
        )
        .run({
          id,
          projectId: input.projectId,
          sourceType: input.sourceType,
          sourceId: input.sourceId ?? null,
          title: input.title,
          status: input.status,
          threadId: input.threadId ?? null,
          updatedAt: now
        });
    } else {
      this.db
        .prepare(
          `INSERT INTO jobs (
            id, project_id, source_type, source_id, title, status, thread_id, created_at, updated_at
          ) VALUES (
            @id, @projectId, @sourceType, @sourceId, @title, @status, @threadId, @createdAt, @updatedAt
          )`
        )
        .run({
          id,
          projectId: input.projectId,
          sourceType: input.sourceType,
          sourceId: input.sourceId ?? null,
          title: input.title,
          status: input.status,
          threadId: input.threadId ?? null,
          createdAt: now,
          updatedAt: now
        });
    }
    return this.getJob(id);
  }

  findActiveJobForSource(sourceType: JobDefinition['sourceType'], sourceId: string): JobDefinition | null {
    const row = this.db
      .prepare(
        `SELECT * FROM jobs
         WHERE source_type = ?
           AND source_id = ?
           AND status IN ('queued', 'running', 'waiting_for_review', 'paused', 'resumed')
         ORDER BY updated_at DESC
         LIMIT 1`
      )
      .get(sourceType, sourceId) as Row | undefined;
    return row ? this.mapJob(row) : null;
  }

  addJobRun(input: {
    jobId: string;
    providerId?: ProviderId | null;
    modelId?: string | null;
    status: JobRun['status'];
    runId?: string | null;
    checkpoint?: Record<string, unknown> | null;
    startedAt?: string | null;
    finishedAt?: string | null;
  }): JobRun {
    const run: JobRun = {
      id: randomUUID(),
      jobId: input.jobId,
      providerId: input.providerId ?? null,
      modelId: input.modelId ?? null,
      status: input.status,
      runId: input.runId ?? null,
      checkpoint: input.checkpoint ?? null,
      startedAt: input.startedAt ?? null,
      finishedAt: input.finishedAt ?? null,
      createdAt: new Date().toISOString()
    };
    this.db
      .prepare(
        `INSERT INTO job_runs (
          id, job_id, provider_id, model_id, status, run_id, checkpoint_json, started_at, finished_at, created_at
        ) VALUES (
          @id, @jobId, @providerId, @modelId, @status, @runId, @checkpointJson, @startedAt, @finishedAt, @createdAt
        )`
      )
      .run({
        ...run,
        checkpointJson: run.checkpoint ? JSON.stringify(run.checkpoint) : null
      });
    return run;
  }

  getJobRun(jobRunId: string): JobRun {
    const row = this.db.prepare('SELECT * FROM job_runs WHERE id = ?').get(jobRunId) as Row | undefined;
    if (!row) {
      throw new Error(`Job run not found: ${jobRunId}`);
    }
    return this.mapJobRun(row);
  }

  updateJobRun(jobRunId: string, input: {
    status?: JobRun['status'];
    runId?: string | null;
    checkpoint?: Record<string, unknown> | null;
    startedAt?: string | null;
    finishedAt?: string | null;
  }): JobRun {
    const current = this.getJobRun(jobRunId);
    const next: JobRun = {
      ...current,
      ...input
    };
    this.db
      .prepare(
        `UPDATE job_runs
         SET status = @status,
             run_id = @linkedRunId,
             checkpoint_json = @checkpointJson,
             started_at = @startedAt,
             finished_at = @finishedAt
         WHERE id = @id`
      )
      .run({
        id: next.id,
        status: next.status,
        linkedRunId: next.runId,
        checkpointJson: next.checkpoint ? JSON.stringify(next.checkpoint) : null,
        startedAt: next.startedAt,
        finishedAt: next.finishedAt
      });
    return this.getJobRun(next.id);
  }

  findJobRunByProviderRunId(providerRunId: string): JobRun | null {
    const row = this.db.prepare('SELECT * FROM job_runs WHERE run_id = ? ORDER BY created_at DESC LIMIT 1').get(providerRunId) as Row | undefined;
    return row ? this.mapJobRun(row) : null;
  }

  listPendingReviewItems(): ReviewItem[] {
    return this.db.prepare("SELECT * FROM review_items WHERE status = 'pending' ORDER BY updated_at DESC").all().map((row) => this.mapReviewItem(row as Row));
  }

  getReviewItem(reviewItemId: string): ReviewItem {
    const row = this.db.prepare('SELECT * FROM review_items WHERE id = ?').get(reviewItemId) as Row | undefined;
    if (!row) {
      throw new Error(`Review item not found: ${reviewItemId}`);
    }
    return this.mapReviewItem(row);
  }

  addReviewItem(input: {
    jobId: string;
    jobRunId?: string | null;
    kind: ReviewItem['kind'];
    status?: ReviewItem['status'];
    summary: string;
    details: Record<string, unknown>;
  }): ReviewItem {
    const now = new Date().toISOString();
    const review: ReviewItem = {
      id: randomUUID(),
      jobId: input.jobId,
      jobRunId: input.jobRunId ?? null,
      kind: input.kind,
      status: input.status ?? 'pending',
      summary: input.summary,
      details: input.details,
      decision: null,
      createdAt: now,
      updatedAt: now
    };
    this.db
      .prepare(
        `INSERT INTO review_items (
          id, job_id, job_run_id, kind, status, summary, details_json, decision_json, created_at, updated_at
        ) VALUES (
          @id, @jobId, @jobRunId, @kind, @status, @summary, @detailsJson, @decisionJson, @createdAt, @updatedAt
        )`
      )
      .run({
        ...review,
        detailsJson: JSON.stringify(review.details),
        decisionJson: null
      });
    return review;
  }

  updateReviewItem(reviewItemId: string, input: {
    status?: ReviewItem['status'];
    decision?: Record<string, unknown> | null;
    jobRunId?: string | null;
    details?: Record<string, unknown>;
  }): ReviewItem {
    const current = this.getReviewItem(reviewItemId);
    const next: ReviewItem = {
      ...current,
      details: input.details ?? current.details,
      ...input,
      updatedAt: new Date().toISOString()
    };
    this.db
      .prepare(
        `UPDATE review_items
         SET job_run_id = @jobRunId,
             status = @status,
             details_json = @detailsJson,
             decision_json = @decisionJson,
             updated_at = @updatedAt
         WHERE id = @id`
      )
      .run({
        id: next.id,
        jobRunId: next.jobRunId,
        status: next.status,
        detailsJson: JSON.stringify(next.details),
        decisionJson: next.decision ? JSON.stringify(next.decision) : null,
        updatedAt: next.updatedAt
      });
    return this.getReviewItem(reviewItemId);
  }

  getPreferences(): Preferences {
    const row = this.db.prepare('SELECT * FROM preferences WHERE id = 1').get() as Row;
    const next: Preferences = {
      selectedProjectId: (row.selected_project_id as string | null) ?? null,
      defaultProviderId: row.default_provider_id as ProviderId,
      defaultModelByProvider: createProviderRecord((providerId) => {
        const value = row[`default_model_${providerId}`];
        return typeof value === 'string' && value.trim() ? value : DEFAULT_PREFERENCES.defaultModelByProvider[providerId];
      }),
      defaultReasoningEffortByProvider: createProviderRecord((providerId) => {
        const value = row[`default_reasoning_effort_${providerId}`];
        return (value as Preferences['defaultReasoningEffortByProvider'][ProviderId] | null) ?? DEFAULT_PREFERENCES.defaultReasoningEffortByProvider[providerId];
      }),
      defaultThinkingByProvider: createProviderRecord((providerId) => {
        const value = row[`default_thinking_${providerId}`];
        return value === null || value === undefined ? DEFAULT_PREFERENCES.defaultThinkingByProvider[providerId] : Boolean(value);
      }),
      ollamaTransportMode:
        (row.ollama_transport_mode as Preferences['ollamaTransportMode'] | null) ?? DEFAULT_PREFERENCES.ollamaTransportMode,
      defaultExecutionPermission: (row.default_execution_permission as ExecutionPermission | null) ?? 'default',
      followUpBehavior: (row.follow_up_behavior as Preferences['followUpBehavior'] | null) ?? DEFAULT_PREFERENCES.followUpBehavior,
      generatedMemoryUseEnabled:
        row.generated_memory_use_enabled === null || row.generated_memory_use_enabled === undefined
          ? DEFAULT_PREFERENCES.generatedMemoryUseEnabled
          : Boolean(row.generated_memory_use_enabled),
      generatedMemoryGenerationEnabled:
        row.generated_memory_generation_enabled === null || row.generated_memory_generation_enabled === undefined
          ? DEFAULT_PREFERENCES.generatedMemoryGenerationEnabled
          : Boolean(row.generated_memory_generation_enabled),
      appearanceMode: (row.appearance_mode as AppearanceMode | null) ?? DEFAULT_PREFERENCES.appearanceMode,
      accentMode: (row.accent_mode as Preferences['accentMode'] | null) ?? DEFAULT_PREFERENCES.accentMode,
      accentColor: typeof row.accent_color === 'string' && row.accent_color.trim() ? (row.accent_color as string) : null,
      onboardingComplete: Boolean(row.onboarding_complete),
      lastOpenedThreadId: (row.last_opened_thread_id as string | null) ?? null,
      microphoneAllowed: Boolean(row.microphone_allowed)
    };
    return this.sanitizePreferenceReferences(next);
  }

  savePreferences(input: Partial<Preferences>): Preferences {
    const current = this.getPreferences();
    const next: Preferences = {
      ...current,
      ...input,
      defaultModelByProvider: {
        ...current.defaultModelByProvider,
        ...input.defaultModelByProvider
      },
      defaultReasoningEffortByProvider: {
        ...current.defaultReasoningEffortByProvider,
        ...input.defaultReasoningEffortByProvider
      },
      defaultThinkingByProvider: {
        ...current.defaultThinkingByProvider,
        ...input.defaultThinkingByProvider
      }
    };
    this.db
      .prepare(
        `UPDATE preferences
         SET selected_project_id = @selectedProjectId,
             default_provider_id = @defaultProviderId,
             default_model_openai = @openaiModel,
             default_model_gemini = @geminiModel,
             default_model_qwen = @qwenModel,
             default_model_ollama = @ollamaModel,
             default_model_kimi = @kimiModel,
             default_reasoning_effort_openai = @openaiReasoningEffort,
             default_reasoning_effort_gemini = @geminiReasoningEffort,
             default_reasoning_effort_qwen = @qwenReasoningEffort,
             default_reasoning_effort_ollama = @ollamaReasoningEffort,
             default_reasoning_effort_kimi = @kimiReasoningEffort,
             default_thinking_openai = @openaiThinking,
             default_thinking_gemini = @geminiThinking,
             default_thinking_qwen = @qwenThinking,
             default_thinking_ollama = @ollamaThinking,
             default_thinking_kimi = @kimiThinking,
             ollama_transport_mode = @ollamaTransportMode,
             default_execution_permission = @defaultExecutionPermission,
             follow_up_behavior = @followUpBehavior,
             generated_memory_use_enabled = @generatedMemoryUseEnabled,
             generated_memory_generation_enabled = @generatedMemoryGenerationEnabled,
             appearance_mode = @appearanceMode,
             accent_mode = @accentMode,
             accent_color = @accentColor,
             onboarding_complete = @onboardingComplete,
             last_opened_thread_id = @lastOpenedThreadId,
             microphone_allowed = @microphoneAllowed
         WHERE id = 1`
      )
      .run({
        selectedProjectId: next.selectedProjectId,
        defaultProviderId: next.defaultProviderId,
        openaiModel: next.defaultModelByProvider.openai,
        geminiModel: next.defaultModelByProvider.gemini,
        qwenModel: next.defaultModelByProvider.qwen,
        ollamaModel: next.defaultModelByProvider.ollama,
        kimiModel: next.defaultModelByProvider.kimi,
        openaiReasoningEffort: next.defaultReasoningEffortByProvider.openai,
        geminiReasoningEffort: next.defaultReasoningEffortByProvider.gemini,
        qwenReasoningEffort: next.defaultReasoningEffortByProvider.qwen,
        ollamaReasoningEffort: next.defaultReasoningEffortByProvider.ollama,
        kimiReasoningEffort: next.defaultReasoningEffortByProvider.kimi,
        openaiThinking: next.defaultThinkingByProvider.openai ? 1 : 0,
        geminiThinking: next.defaultThinkingByProvider.gemini ? 1 : 0,
        qwenThinking: next.defaultThinkingByProvider.qwen ? 1 : 0,
        ollamaThinking: next.defaultThinkingByProvider.ollama ? 1 : 0,
        kimiThinking: next.defaultThinkingByProvider.kimi ? 1 : 0,
        ollamaTransportMode: next.ollamaTransportMode,
        defaultExecutionPermission: next.defaultExecutionPermission,
        followUpBehavior: next.followUpBehavior,
        generatedMemoryUseEnabled: next.generatedMemoryUseEnabled ? 1 : 0,
        generatedMemoryGenerationEnabled: next.generatedMemoryGenerationEnabled ? 1 : 0,
        appearanceMode: next.appearanceMode,
        accentMode: next.accentMode,
        accentColor: next.accentColor,
        onboardingComplete: next.onboardingComplete ? 1 : 0,
        lastOpenedThreadId: next.lastOpenedThreadId,
        microphoneAllowed: next.microphoneAllowed ? 1 : 0
      });
    return next;
  }

  private sanitizePreferenceReferences(preferences: Preferences): Preferences {
    let selectedProjectId = preferences.selectedProjectId;
    let lastOpenedThreadId = preferences.lastOpenedThreadId;

    if (
      selectedProjectId
      && !this.db.prepare('SELECT 1 FROM projects WHERE id = ?').get(selectedProjectId)
    ) {
      selectedProjectId = null;
    }

    if (
      lastOpenedThreadId
      && !this.db.prepare('SELECT 1 FROM threads WHERE id = ?').get(lastOpenedThreadId)
    ) {
      lastOpenedThreadId = null;
    }

    if (
      selectedProjectId === preferences.selectedProjectId
      && lastOpenedThreadId === preferences.lastOpenedThreadId
    ) {
      return preferences;
    }

    const next = {
      ...preferences,
      selectedProjectId,
      lastOpenedThreadId
    };

    this.db
      .prepare(
        `UPDATE preferences
         SET selected_project_id = ?,
             last_opened_thread_id = ?
         WHERE id = 1`
      )
      .run(next.selectedProjectId, next.lastOpenedThreadId);

    return next;
  }

  isWorkspaceBootstrapDismissed(projectId: string) {
    const row = this.db
      .prepare('SELECT dismissed_at FROM workspace_bootstrap_dismissals WHERE project_id = ?')
      .get(projectId) as Row | undefined;
    return Boolean(row?.dismissed_at);
  }

  dismissWorkspaceBootstrap(projectId: string) {
    this.getProject(projectId);
    this.db
      .prepare(
        `INSERT INTO workspace_bootstrap_dismissals (project_id, dismissed_at)
         VALUES (@projectId, @dismissedAt)
         ON CONFLICT(project_id) DO UPDATE SET dismissed_at = excluded.dismissed_at`
      )
      .run({
        projectId,
        dismissedAt: new Date().toISOString()
      });
  }

  clearWorkspaceBootstrapDismissal(projectId: string) {
    this.db.prepare('DELETE FROM workspace_bootstrap_dismissals WHERE project_id = ?').run(projectId);
  }

  getPersonalization(): PersonalizationSettings {
    const rows = this.db.prepare('SELECT key, value FROM personalization').all() as Array<{ key: string; value: string }>;
    const values = Object.fromEntries(rows.map((row) => [row.key, row.value]));
    return {
      globalInstructions: values.global_instructions ?? DEFAULT_PERSONALIZATION.globalInstructions,
      providerInstructions: createProviderRecord(
        (providerId) => values[`${providerId}_instructions`] ?? DEFAULT_PERSONALIZATION.providerInstructions[providerId]
      ),
      useWorkspaceInstructions:
        values.use_workspace_instructions === undefined
          ? DEFAULT_PERSONALIZATION.useWorkspaceInstructions
          : values.use_workspace_instructions === '1'
    };
  }

  savePersonalization(input: Partial<PersonalizationSettings>): PersonalizationSettings {
    const current = this.getPersonalization();
    const next: PersonalizationSettings = {
      globalInstructions: input.globalInstructions ?? current.globalInstructions,
      providerInstructions: {
        ...current.providerInstructions,
        ...input.providerInstructions
      },
      useWorkspaceInstructions: input.useWorkspaceInstructions ?? current.useWorkspaceInstructions
    };
    const now = new Date().toISOString();
    const upsert = this.db.prepare(
      `INSERT INTO personalization (key, value, updated_at)
       VALUES (@key, @value, @updatedAt)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    );
    upsert.run({ key: 'global_instructions', value: next.globalInstructions, updatedAt: now });
    for (const [providerId, instructions] of Object.entries(next.providerInstructions) as Array<[ProviderId, string]>) {
      upsert.run({ key: `${providerId}_instructions`, value: instructions, updatedAt: now });
    }
    upsert.run({ key: 'use_workspace_instructions', value: next.useWorkspaceInstructions ? '1' : '0', updatedAt: now });
    return next;
  }

  upsertWorkspaceMemoryFile(input: {
    projectId: string;
    kind: 'memory' | 'daily_note';
    path: string;
    fileName: string;
    checksum: string;
    lastIndexedAt: string;
    updatedAt: string;
  }) {
    const existing = this.db
      .prepare('SELECT id FROM workspace_memory_files WHERE project_id = ? AND path = ?')
      .get(input.projectId, input.path) as { id?: string } | undefined;
    const id = existing?.id ?? randomUUID();

    this.db
      .prepare(
        `INSERT INTO workspace_memory_files (
          id, project_id, kind, path, file_name, checksum, last_indexed_at, updated_at
        ) VALUES (
          @id, @projectId, @kind, @path, @fileName, @checksum, @lastIndexedAt, @updatedAt
        )
        ON CONFLICT(id) DO UPDATE SET
          kind = excluded.kind,
          path = excluded.path,
          file_name = excluded.file_name,
          checksum = excluded.checksum,
          last_indexed_at = excluded.last_indexed_at,
          updated_at = excluded.updated_at`
      )
      .run({
        id,
        ...input
      });

    return id;
  }

  replaceWorkspaceMemoryChunks(
    memoryFileId: string,
    projectId: string,
    chunks: Array<{ ordinal: number; heading: string | null; content: string; updatedAt: string }>
  ) {
    const transaction = this.db.transaction(() => {
      this.db.prepare('DELETE FROM workspace_memory_chunks WHERE memory_file_id = ?').run(memoryFileId);
      const insert = this.db.prepare(
        `INSERT INTO workspace_memory_chunks (
          id, memory_file_id, project_id, ordinal, heading, content, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`
      );
      for (const chunk of chunks) {
        insert.run(randomUUID(), memoryFileId, projectId, chunk.ordinal, chunk.heading, chunk.content, chunk.updatedAt);
      }
    });

    transaction();
  }

  deleteWorkspaceMemoryFilesNotInPaths(
    projectId: string,
    kinds: Array<'memory' | 'daily_note'>,
    paths: string[]
  ) {
    if (kinds.length === 0) {
      return;
    }

    const kindPlaceholders = kinds.map(() => '?').join(', ');
    if (paths.length === 0) {
      this.db
        .prepare(`DELETE FROM workspace_memory_files WHERE project_id = ? AND kind IN (${kindPlaceholders})`)
        .run(projectId, ...kinds);
      return;
    }

    const pathPlaceholders = paths.map(() => '?').join(', ');
    this.db
      .prepare(
        `DELETE FROM workspace_memory_files
         WHERE project_id = ?
           AND kind IN (${kindPlaceholders})
           AND path NOT IN (${pathPlaceholders})`
      )
      .run(projectId, ...kinds, ...paths);
  }

  listWorkspaceMemoryChunks(projectId: string) {
    return this.db
      .prepare(
        `SELECT
          chunks.id,
          files.kind,
          files.path,
          files.file_name AS fileName,
          chunks.heading,
          chunks.content,
          chunks.updated_at AS updatedAt
        FROM workspace_memory_chunks chunks
        INNER JOIN workspace_memory_files files ON files.id = chunks.memory_file_id
        WHERE chunks.project_id = ?
        ORDER BY files.updated_at DESC, chunks.ordinal ASC`
      )
      .all(projectId) as Array<{
      id: string;
      kind: 'memory' | 'daily_note';
      path: string;
      fileName: string;
      heading: string | null;
      content: string;
      updatedAt: string;
    }>;
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
    const existing = this.db
      .prepare('SELECT id FROM generated_memory_candidates WHERE workspace_scope_key = ? AND dedupe_key = ?')
      .get(input.workspaceScopeKey, input.dedupeKey) as { id?: string } | undefined;
    const id = existing?.id ?? randomUUID();

    this.db
      .prepare(
        `INSERT INTO generated_memory_candidates (
          id, workspace_scope_key, project_id, source_thread_id, source_run_id, source_turn_ids_json, kind,
          summary, detail, evidence_excerpt, dedupe_key, status, created_at, updated_at
        ) VALUES (
          @id, @workspaceScopeKey, @projectId, @sourceThreadId, @sourceRunId, @sourceTurnIdsJson, @kind,
          @summary, @detail, @evidenceExcerpt, @dedupeKey, @status, @createdAt, @updatedAt
        )
        ON CONFLICT(id) DO UPDATE SET
          workspace_scope_key = excluded.workspace_scope_key,
          project_id = excluded.project_id,
          source_thread_id = excluded.source_thread_id,
          source_run_id = excluded.source_run_id,
          source_turn_ids_json = excluded.source_turn_ids_json,
          kind = excluded.kind,
          summary = excluded.summary,
          detail = excluded.detail,
          evidence_excerpt = excluded.evidence_excerpt,
          dedupe_key = excluded.dedupe_key,
          status = excluded.status,
          updated_at = excluded.updated_at`
      )
      .run({
        id,
        workspaceScopeKey: input.workspaceScopeKey,
        projectId: input.projectId,
        sourceThreadId: input.sourceThreadId,
        sourceRunId: input.sourceRunId,
        sourceTurnIdsJson: JSON.stringify(input.sourceTurnIds),
        kind: input.kind,
        summary: input.summary,
        detail: input.detail,
        evidenceExcerpt: input.evidenceExcerpt,
        dedupeKey: input.dedupeKey,
        status: input.status,
        createdAt: input.createdAt,
        updatedAt: input.updatedAt
      });

    return this.getGeneratedMemoryCandidate(id)!;
  }

  getGeneratedMemoryCandidate(candidateId: string): GeneratedMemoryCandidate | null {
    const row = this.db
      .prepare('SELECT * FROM generated_memory_candidates WHERE id = ?')
      .get(candidateId) as Row | undefined;
    return row ? this.mapGeneratedMemoryCandidate(row) : null;
  }

  listGeneratedMemoryCandidates(workspaceScopeKey: string): GeneratedMemoryCandidate[] {
    return this.db
      .prepare('SELECT * FROM generated_memory_candidates WHERE workspace_scope_key = ? ORDER BY updated_at DESC, created_at DESC')
      .all(workspaceScopeKey)
      .map((row) => this.mapGeneratedMemoryCandidate(row as Row));
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
    const id = input.id ?? randomUUID();

    this.db
      .prepare(
        `INSERT INTO generated_memory_items (
          id, workspace_scope_key, project_id, kind, summary, detail, authority, evidence_count,
          source_candidate_ids_json, source_thread_ids_json, created_at, updated_at, last_used_at, use_count, disabled_at
        ) VALUES (
          @id, @workspaceScopeKey, @projectId, @kind, @summary, @detail, @authority, @evidenceCount,
          @sourceCandidateIdsJson, @sourceThreadIdsJson, @createdAt, @updatedAt, @lastUsedAt, @useCount, @disabledAt
        )
        ON CONFLICT(id) DO UPDATE SET
          workspace_scope_key = excluded.workspace_scope_key,
          project_id = excluded.project_id,
          kind = excluded.kind,
          summary = excluded.summary,
          detail = excluded.detail,
          authority = excluded.authority,
          evidence_count = excluded.evidence_count,
          source_candidate_ids_json = excluded.source_candidate_ids_json,
          source_thread_ids_json = excluded.source_thread_ids_json,
          updated_at = excluded.updated_at,
          last_used_at = excluded.last_used_at,
          use_count = excluded.use_count,
          disabled_at = excluded.disabled_at`
      )
      .run({
        id,
        workspaceScopeKey: input.workspaceScopeKey,
        projectId: input.projectId,
        kind: input.kind,
        summary: input.summary,
        detail: input.detail,
        authority: input.authority,
        evidenceCount: input.evidenceCount,
        sourceCandidateIdsJson: JSON.stringify(input.sourceCandidateIds),
        sourceThreadIdsJson: JSON.stringify(input.sourceThreadIds),
        createdAt: input.createdAt,
        updatedAt: input.updatedAt,
        lastUsedAt: input.lastUsedAt,
        useCount: input.useCount,
        disabledAt: input.disabledAt
      });

    return this.getGeneratedMemoryItem(id)!;
  }

  getGeneratedMemoryItem(itemId: string): GeneratedMemoryItem | null {
    const row = this.db.prepare('SELECT * FROM generated_memory_items WHERE id = ?').get(itemId) as Row | undefined;
    return row ? this.mapGeneratedMemoryItem(row) : null;
  }

  listGeneratedMemoryItems(workspaceScopeKey: string): GeneratedMemoryItem[] {
    return this.db
      .prepare('SELECT * FROM generated_memory_items WHERE workspace_scope_key = ? ORDER BY updated_at DESC, created_at DESC')
      .all(workspaceScopeKey)
      .map((row) => this.mapGeneratedMemoryItem(row as Row));
  }

  disableGeneratedMemoryItem(itemId: string, disabledAt: string) {
    this.db
      .prepare('UPDATE generated_memory_items SET disabled_at = ?, updated_at = ? WHERE id = ?')
      .run(disabledAt, disabledAt, itemId);
    return this.getGeneratedMemoryItem(itemId);
  }

  replaceGeneratedMemoryEvidenceForCandidate(
    candidateId: string,
    evidence: Array<{
      workspaceScopeKey: string;
      projectId: string | null;
      sourceThreadId: string;
      sourceTurnIds: string[];
      role: GeneratedMemoryEvidence['role'];
      excerpt: string;
      capturedAt: string;
    }>
  ) {
    const transaction = this.db.transaction(() => {
      this.db.prepare('DELETE FROM generated_memory_evidence WHERE candidate_id = ?').run(candidateId);
      const insert = this.db.prepare(
        `INSERT INTO generated_memory_evidence (
          id, workspace_scope_key, project_id, candidate_id, item_id, source_thread_id, source_turn_ids_json, role, excerpt, captured_at
        ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)`
      );
      for (const entry of evidence) {
        insert.run(
          randomUUID(),
          entry.workspaceScopeKey,
          entry.projectId,
          candidateId,
          entry.sourceThreadId,
          JSON.stringify(entry.sourceTurnIds),
          entry.role,
          entry.excerpt,
          entry.capturedAt
        );
      }
    });

    transaction();
  }

  replaceGeneratedMemoryEvidenceForItem(
    itemId: string,
    evidence: Array<{
      workspaceScopeKey: string;
      projectId: string | null;
      sourceThreadId: string;
      sourceTurnIds: string[];
      role: GeneratedMemoryEvidence['role'];
      excerpt: string;
      capturedAt: string;
    }>
  ) {
    const transaction = this.db.transaction(() => {
      this.db.prepare('DELETE FROM generated_memory_evidence WHERE item_id = ?').run(itemId);
      const insert = this.db.prepare(
        `INSERT INTO generated_memory_evidence (
          id, workspace_scope_key, project_id, candidate_id, item_id, source_thread_id, source_turn_ids_json, role, excerpt, captured_at
        ) VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?)`
      );
      for (const entry of evidence) {
        insert.run(
          randomUUID(),
          entry.workspaceScopeKey,
          entry.projectId,
          itemId,
          entry.sourceThreadId,
          JSON.stringify(entry.sourceTurnIds),
          entry.role,
          entry.excerpt,
          entry.capturedAt
        );
      }
    });

    transaction();
  }

  listGeneratedMemoryEvidenceForCandidate(candidateId: string): GeneratedMemoryEvidence[] {
    return this.db
      .prepare('SELECT * FROM generated_memory_evidence WHERE candidate_id = ? ORDER BY captured_at ASC')
      .all(candidateId)
      .map((row) => this.mapGeneratedMemoryEvidence(row as Row));
  }

  listGeneratedMemoryEvidenceForItem(itemId: string): GeneratedMemoryEvidence[] {
    return this.db
      .prepare('SELECT * FROM generated_memory_evidence WHERE item_id = ? ORDER BY captured_at ASC')
      .all(itemId)
      .map((row) => this.mapGeneratedMemoryEvidence(row as Row));
  }

  clearGeneratedMemoryWorkspaceScope(workspaceScopeKey: string) {
    const transaction = this.db.transaction(() => {
      this.db.prepare('DELETE FROM generated_memory_evidence WHERE workspace_scope_key = ?').run(workspaceScopeKey);
      this.db.prepare('DELETE FROM generated_memory_candidates WHERE workspace_scope_key = ?').run(workspaceScopeKey);
      this.db.prepare('DELETE FROM generated_memory_items WHERE workspace_scope_key = ?').run(workspaceScopeKey);
    });

    transaction();
  }

  private ensureThreadPlannerState(threadId: string) {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT OR IGNORE INTO thread_planner_state (
          thread_id, composer_mode, turn_state, active_plan_id, pending_question_call_id, updated_at
        ) VALUES (
          @threadId, 'default', 'idle', NULL, NULL, @updatedAt
        )`
      )
      .run({
        threadId,
        updatedAt: now
      });
  }

  private updateThreadPlannerState(
    threadId: string,
    input: Partial<Pick<ThreadPlannerState, 'composerMode' | 'turnState' | 'activePlanId' | 'pendingQuestionCallId'>>
  ) {
    this.ensureThreadPlannerState(threadId);
    const current = this.getThreadPlannerState(threadId);
    const next: ThreadPlannerState = {
      ...current,
      ...input,
      updatedAt: new Date().toISOString()
    };
    this.db
      .prepare(
        `UPDATE thread_planner_state
         SET composer_mode = @composerMode,
             turn_state = @turnState,
             active_plan_id = @activePlanId,
             pending_question_call_id = @pendingQuestionCallId,
             updated_at = @updatedAt
         WHERE thread_id = @threadId`
      )
      .run({
        threadId,
        composerMode: next.composerMode,
        turnState: next.turnState,
        activePlanId: next.activePlanId,
        pendingQuestionCallId: next.pendingQuestionCallId,
        updatedAt: next.updatedAt
      });
    return this.getThreadPlannerState(threadId);
  }

  private getRunEventCompactionCutoffIso() {
    return new Date(Date.now() - RUN_EVENT_COMPACTION_CUTOFF_DAYS * 24 * 60 * 60 * 1000).toISOString();
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
            AND MAX(events.created_at) < @cutoffIso`
      )
      .all({ cutoffIso })
      .map((row) => ({
        threadId: String((row as Row).thread_id),
        runId: String((row as Row).run_id),
        deltaCount: Number((row as Row).delta_count ?? 0)
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
      WHERE skills.origin = 'built_in_style'`
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
        updatedAt: now
      });
    }
  }

  private seedDefaultProject() {
    const existing = this.db.prepare('SELECT COUNT(*) as count FROM projects').get() as { count: number };
    if (existing.count === 0) {
      this.createProject({ name: 'My Project', trusted: false });
    }
  }

  private seedDefaultPersonalization() {
    if ((this.db.prepare('SELECT COUNT(*) as count FROM personalization').get() as { count: number }).count > 0) {
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
      status: row.status as CollabProfile['status'],
      bio: (row.bio as string | null) ?? null,
      timezone: (row.timezone as string | null) ?? null,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at)
    };
  }

  private mapCollabRoom(row: Row): CollabRoom {
    return {
      id: String(row.id),
      type: row.type as CollabRoom['type'],
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
      updatedAt: String(row.updated_at)
    };
  }

  private mapCollabRoomMember(row: Row): CollabRoomMember {
    return {
      roomId: String(row.room_id),
      userId: String(row.user_id),
      role: row.role as CollabRoomMember['role'],
      membershipState: row.membership_state as CollabRoomMember['membershipState'],
      joinedAt: (row.joined_at as string | null) ?? null,
      displayName: String(row.display_name),
      handle: (row.handle as string | null) ?? null,
      avatarUrl: (row.avatar_url as string | null) ?? null,
      status: row.status as CollabRoomMember['status']
    };
  }

  private mapCollabInvite(row: Row) {
    return {
      id: String(row.id),
      roomId: String(row.room_id),
      code: String(row.code),
      status: row.status as 'active' | 'redeemed' | 'expired' | 'revoked',
      createdBy: String(row.created_by),
      createdAt: String(row.created_at),
      expiresAt: (row.expires_at as string | null) ?? null
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
      createdAt: String(row.created_at)
    };
  }

  private mapCollabPresence(row: Row): CollabPresence {
    return {
      roomId: String(row.room_id),
      userId: String(row.user_id),
      status: row.status as CollabPresence['status'],
      currentThreadId: (row.current_thread_id as string | null) ?? null,
      currentThreadTitle: (row.current_thread_title as string | null) ?? null,
      branchName: (row.branch_name as string | null) ?? null,
      worktreeName: (row.worktree_name as string | null) ?? null,
      activeRunId: (row.active_run_id as string | null) ?? null,
      activeRunTitle: (row.active_run_title as string | null) ?? null,
      dirtyFileCount: Number(row.dirty_file_count ?? 0),
      stagedFileCount: Number(row.staged_file_count ?? 0),
      updatedAt: String(row.updated_at)
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
      status: row.status as CollabSharedThread['status'],
      driverUserId: String(row.driver_user_id),
      driverDisplayName: String(row.display_name),
      providerId: row.provider_id as ProviderId,
      modelId: String(row.model_id),
      lastPromptSummary: (row.last_prompt_summary as string | null) ?? null,
      latestAssistantSummary: (row.latest_assistant_summary as string | null) ?? null,
      runId: (row.run_id as string | null) ?? null,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at)
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
      status: row.status as CollabSharedRun['status'],
      taskTitle: (row.task_title as string | null) ?? null,
      summary: (row.summary as string | null) ?? null,
      changedFiles: JSON.parse(String(row.changed_files_json)) as string[],
      diffStats: row.diff_stats_json ? (JSON.parse(String(row.diff_stats_json)) as CollabSharedRun['diffStats']) : null,
      testsSummary: (row.tests_summary as string | null) ?? null,
      resultLabel: (row.result_label as string | null) ?? null,
      startedAt: String(row.started_at),
      updatedAt: String(row.updated_at),
      completedAt: (row.completed_at as string | null) ?? null
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
      outstandingTasks: JSON.parse(String(row.outstanding_tasks_json)) as string[],
      recommendedNextPrompt: (row.recommended_next_prompt as string | null) ?? null,
      createdAt: String(row.created_at)
    };
  }

  private mapCollabRoomFollower(row: Row): CollabRoomFollower {
    return {
      roomId: String(row.room_id),
      userId: String(row.user_id),
      displayName: String(row.display_name),
      handle: (row.handle as string | null) ?? null,
      avatarUrl: (row.avatar_url as string | null) ?? null,
      status: row.status as CollabRoomFollower['status'],
      createdAt: String(row.created_at)
    };
  }

  private mapCollabRoleRequest(row: Row): CollabRoleRequest {
    return {
      id: String(row.id),
      roomId: String(row.room_id),
      requesterUserId: String(row.requester_user_id),
      requesterDisplayName: String(row.display_name),
      requesterHandle: (row.handle as string | null) ?? null,
      requestedRole: row.requested_role as CollabRoleRequest['requestedRole'],
      status: row.status as CollabRoleRequest['status'],
      resolvedByUserId: (row.resolved_by_user_id as string | null) ?? null,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at)
    };
  }

  private mapCollabRoomTerminalState(row: Row): CollabRoomTerminalState {
    return {
      roomId: String(row.room_id),
      mode: row.mode as CollabRoomTerminalState['mode'],
      enabledByUserId: (row.enabled_by_user_id as string | null) ?? null,
      enabledByDisplayName: (row.display_name as string | null) ?? null,
      note: (row.note as string | null) ?? null,
      updatedAt: String(row.updated_at)
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
        return typeof value === 'string' && value.trim() ? value : DEFAULT_PREFERENCES.defaultModelByProvider[providerId];
      }),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at)
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
      updatedAt: String(row.updated_at)
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
      sourceCandidateIds: JSON.parse(String(row.source_candidate_ids_json)) as string[],
      sourceThreadIds: JSON.parse(String(row.source_thread_ids_json)) as string[],
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
      lastUsedAt: (row.last_used_at as string | null) ?? null,
      useCount: Number(row.use_count ?? 0),
      disabledAt: (row.disabled_at as string | null) ?? null
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
      role: row.role as GeneratedMemoryEvidence['role'],
      excerpt: String(row.excerpt),
      capturedAt: String(row.captured_at)
    };
  }

  private mapThreadSummary(row: Row): ThreadSummary {
    return {
      id: String(row.id),
      projectId: String(row.project_id),
      title: String(row.title),
      providerId: row.provider_id as ProviderId,
      modelId: String(row.model_id),
      executionPermission: ((row.execution_permission as ExecutionPermission | null) ?? 'default') as ExecutionPermission,
      status: row.status as ThreadSummary['status'],
      archived: Boolean(row.archived),
      lastMessageAt: String(row.last_message_at),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
      lastPreview: String((row.last_preview as string | null) ?? '')
    };
  }

  private ensureColumn(tableName: string, columnName: string, definition: string) {
    const columns = this.db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name?: string }>;
    if (columns.some((column) => column.name === columnName)) {
      return;
    }
    this.db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  }

  private allocateSubagentName(parentThreadId: string) {
    return pickNextSubagentName(this.listSubagentsByParentThread(parentThreadId).map((subagent) => subagent.name));
  }

  private backfillSubagentNames() {
    const rows = this.db
      .prepare(
        `SELECT id, parent_thread_id, name, created_at
         FROM subagents
         ORDER BY parent_thread_id ASC, created_at ASC`
      )
      .all() as Array<{ id: string; parent_thread_id: string; name?: string | null; created_at: string }>;
    const takenNamesByThread = new Map<string, string[]>();
    const update = this.db.prepare('UPDATE subagents SET name = ? WHERE id = ?');

    for (const row of rows) {
      const current = (row.name ?? '').trim();
      const taken = takenNamesByThread.get(row.parent_thread_id) ?? [];
      const resolvedName = current && current !== 'Agent' ? current : pickNextSubagentName(taken);
      taken.push(resolvedName);
      takenNamesByThread.set(row.parent_thread_id, taken);
      if (resolvedName !== current) {
        update.run(resolvedName, row.id);
      }
    }
  }

  private ensurePlannerQuestionSetCallIdIsThreadScoped() {
    const tableSql = this.db
      .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'planner_question_sets'")
      .get() as { sql?: string } | undefined;
    if (!tableSql?.sql || !/call_id\s+TEXT\s+NOT\s+NULL\s+UNIQUE/i.test(tableSql.sql)) {
      this.db
        .prepare(
          'CREATE INDEX IF NOT EXISTS idx_planner_question_sets_thread_call ON planner_question_sets(thread_id, call_id)'
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
      const pendingQuestionCallId = (row.pending_question_call_id as string | null) ?? null;
      const pendingQuestionRow =
        pendingQuestionCallId !== null
          ? (this.db
              .prepare('SELECT * FROM planner_question_sets WHERE thread_id = ? AND call_id = ? ORDER BY created_at DESC LIMIT 1')
              .get(threadId, pendingQuestionCallId) as Row | undefined)
          : undefined;
      const activePlan =
        activePlanId && this.db.prepare('SELECT * FROM planner_plans WHERE plan_id = ?').get(activePlanId)
          ? this.mapPlannerPlan(this.db.prepare('SELECT * FROM planner_plans WHERE plan_id = ?').get(activePlanId) as Row)
          : null;
      const pendingQuestionSet = pendingQuestionRow ? this.mapPlannerQuestionSet(pendingQuestionRow) : null;

    return {
      threadId,
      composerMode: row.composer_mode as ComposerMode,
      turnState: row.turn_state as PlanTurnState,
      activePlanId,
      pendingQuestionCallId,
      updatedAt: String(row.updated_at),
      activePlan,
      pendingQuestionSet
    };
  }

  private mapTurn(row: Row): ThreadTurn {
    const metadata = row.metadata_json ? (JSON.parse(String(row.metadata_json)) as Record<string, unknown>) : null;
    return {
      id: String(row.id),
      threadId: String(row.thread_id),
      runId: (row.run_id as string | null) ?? null,
      role: row.role as ThreadTurn['role'],
      content: String(row.content),
      sources: metadata ? normalizeThreadSources(metadata.sources) : [],
      metadata,
      createdAt: String(row.created_at)
    };
  }

  private mapRunEvent(row: Row): RunEvent {
    return {
      id: String(row.id),
      threadId: String(row.thread_id),
      runId: String(row.run_id),
      eventType: row.event_type as RunEvent['eventType'],
      payload: JSON.parse(String(row.payload_json)) as Record<string, unknown>,
      createdAt: String(row.created_at)
    };
  }

  private mapThreadFollowUp(row: Row): ThreadFollowUp {
    return {
      id: String(row.id),
      threadId: String(row.thread_id),
      content: String(row.content),
      metadata: row.metadata_json ? (JSON.parse(String(row.metadata_json)) as Record<string, unknown>) : null,
      kind: row.kind as ThreadFollowUpKind,
      status: row.status as ThreadFollowUpStatus,
      priority: Number(row.priority ?? 0),
      targetRunId: (row.target_run_id as string | null) ?? null,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
      dispatchedAt: (row.dispatched_at as string | null) ?? null,
      cancelledAt: (row.cancelled_at as string | null) ?? null
    };
  }

  private mapSubagent(row: Row): SubagentSummary {
    return {
      id: String(row.id),
      parentThreadId: String(row.parent_thread_id),
      parentRunId: (row.parent_run_id as string | null) ?? null,
      childThreadId: (row.child_thread_id as string | null) ?? null,
      childRunId: (row.child_run_id as string | null) ?? null,
      name: typeof row.name === 'string' && row.name.trim() ? row.name : 'Agent',
      title: String(row.title),
      prompt: String(row.prompt),
      providerId: row.provider_id as ProviderId,
      modelId: String(row.model_id),
      executionPermission: row.execution_permission as ExecutionPermission,
      delegationProfile: row.delegation_profile as SubagentSummary['delegationProfile'],
      status: row.status as SubagentSummary['status'],
      outputSummary: (row.output_summary as string | null) ?? null,
      lastError: (row.last_error as string | null) ?? null,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
      startedAt: (row.started_at as string | null) ?? null,
      completedAt: (row.completed_at as string | null) ?? null
    };
  }

  private mapAutonomousTask(row: Row): AutonomousTaskRecord {
    return {
      id: String(row.id),
      kind: row.kind as AutonomousTaskRecord['kind'],
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
      status: row.status as AutonomousTaskRecord['status'],
      statusLabel: String(row.status_label),
      blockedBy: (row.blocked_by as string | null) ?? null,
      blocking: (row.blocking as string | null) ?? null,
      lastError: (row.last_error as string | null) ?? null,
      metadata: row.metadata_json ? (JSON.parse(String(row.metadata_json)) as Record<string, unknown>) : {},
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
      startedAt: (row.started_at as string | null) ?? null,
      completedAt: (row.completed_at as string | null) ?? null
    };
  }

  private mapPlannerQuestionSet(row: Row): PlannerQuestionSet {
    return {
      id: String(row.question_set_id),
      threadId: String(row.thread_id),
      promptTurnId: String(row.prompt_turn_id),
      callId: String(row.call_id),
      questions: JSON.parse(String(row.questions_json)) as PlannerQuestionSet['questions'],
      answers: row.answers_json ? (JSON.parse(String(row.answers_json)) as Record<string, PlannerQuestionAnswer>) : null,
      createdAt: String(row.created_at)
    };
  }

  private mapPlannerPlan(row: Row): PlannerPlan {
    return {
      id: String(row.plan_id),
      threadId: String(row.thread_id),
      createdTurnId: String(row.created_turn_id),
      proposedPlanMarkdown: String(row.proposed_plan_markdown),
      structuredPlan: row.structured_plan_json ? (JSON.parse(String(row.structured_plan_json)) as StructuredPlannerPlan) : null,
      status: row.status as PlannerPlanStatus,
      createdAt: String(row.created_at)
    };
  }

  private mapProviderAccount(row: Row): ProviderAccount {
    return {
      providerId: row.provider_id as ProviderId,
      authState: row.auth_state as ProviderAccount['authState'],
      authMode: (row.auth_mode as ProviderAccount['authMode']) ?? null,
      encryptedApiKey: (row.encrypted_api_key as string | null) ?? null,
      updatedAt: String(row.updated_at)
    };
  }

  private mapProviderModel(row: Row): ProviderModel {
    return {
      id: String(row.model_id),
      label: String(row.label),
      description: String(row.description),
      supportsVision: Boolean(row.supports_vision)
    };
  }

  private mapSkill(row: Row): SkillDefinition {
    return {
      id: String(row.id),
      name: String(row.name),
      description: String(row.description),
      instructions: String(row.instructions),
      origin: row.origin as SkillDefinition['origin'],
      scope: row.scope as SkillDefinition['scope'],
      providerTargets: JSON.parse(String(row.provider_targets_json)) as SkillDefinition['providerTargets'],
      enabled: Boolean(row.enabled),
      projectId: (row.project_id as string | null) ?? null,
      metadata: JSON.parse(String(row.metadata_json)) as Record<string, unknown>,
      path: (row.path as string | null) ?? null,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at)
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
      scheduleType: row.schedule_type as AutomationDefinition['scheduleType'],
      intervalMinutes: (row.interval_minutes as number | null) ?? null,
      lastRunAt: (row.last_run_at as string | null) ?? null,
      nextRunAt: (row.next_run_at as string | null) ?? null,
      status: row.status as AutomationDefinition['status'],
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at)
    };
  }

  private resolveAutomationNextRunAt(
    input: AutomationSaveInput,
    current: AutomationDefinition | null,
    now: string
  ) {
    const intervalMinutes = input.intervalMinutes ?? null;
    if (!input.enabled || input.scheduleType !== 'interval_while_app_open' || !intervalMinutes) {
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

  private computeAutomationNextRunAt(intervalMinutes: number, from: string | number | Date = Date.now()) {
    const base =
      typeof from === 'number'
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
      sourceType: row.source_type as JobDefinition['sourceType'],
      sourceId: (row.source_id as string | null) ?? null,
      title: String(row.title),
      status: row.status as JobDefinition['status'],
      threadId: (row.thread_id as string | null) ?? null,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at)
    };
  }

  private mapJobRun(row: Row): JobRun {
    return {
      id: String(row.id),
      jobId: String(row.job_id),
      providerId: (row.provider_id as ProviderId | null) ?? null,
      modelId: (row.model_id as string | null) ?? null,
      status: row.status as JobRun['status'],
      runId: (row.run_id as string | null) ?? null,
      checkpoint: row.checkpoint_json ? (JSON.parse(String(row.checkpoint_json)) as Record<string, unknown>) : null,
      startedAt: (row.started_at as string | null) ?? null,
      finishedAt: (row.finished_at as string | null) ?? null,
      createdAt: String(row.created_at)
    };
  }

  private mapReviewItem(row: Row): ReviewItem {
    return {
      id: String(row.id),
      jobId: String(row.job_id),
      jobRunId: (row.job_run_id as string | null) ?? null,
      kind: row.kind as ReviewItem['kind'],
      status: row.status as ReviewItem['status'],
      summary: String(row.summary),
      details: JSON.parse(String(row.details_json)) as Record<string, unknown>,
      decision: row.decision_json ? (JSON.parse(String(row.decision_json)) as Record<string, unknown>) : null,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at)
    };
  }

  private mapMcpServerDefinition(row: Row): McpServerDefinition {
    return {
      id: String(row.id),
      name: String(row.name),
      scope: (row.scope as McpServerDefinition['scope'] | null) ?? 'global',
      projectId: (row.project_id as string | null) ?? null,
      transportType: row.transport_type as McpServerDefinition['transportType'],
      command: String(row.command),
      args: JSON.parse(String(row.args_json)) as string[],
      cwd: (row.cwd as string | null) ?? null,
      env: JSON.parse(String(row.env_json)) as Record<string, string>,
      enabled: Boolean(row.enabled),
      toolInvocationMode: row.tool_invocation_mode as McpServerDefinition['toolInvocationMode'],
      launchApproved: Boolean(row.launch_approved),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at)
    };
  }

  private mapMcpServerRecord(row: Row): McpServerRecord {
    return {
      definition: this.mapMcpServerDefinition(row),
      state: row.state_server_id
        ? {
            serverId: String(row.state_server_id),
            status: row.state_status as McpServerState['status'],
            capabilities: row.state_capabilities_json
              ? (JSON.parse(String(row.state_capabilities_json)) as Record<string, unknown>)
              : null,
            lastSeenAt: (row.state_last_seen_at as string | null) ?? null,
            lastError: (row.state_last_error as string | null) ?? null,
            toolCount: Number(row.state_tool_count ?? 0),
            resourceCount: Number(row.state_resource_count ?? 0),
            promptCount: Number(row.state_prompt_count ?? 0),
            updatedAt: String(row.state_updated_at)
          }
        : null
    };
  }
}
