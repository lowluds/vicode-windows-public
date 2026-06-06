import type Database from 'better-sqlite3';
import type {
  CollabConfig,
  Preferences,
  ProjectRuntimeCommandPolicy,
  ProjectRuntimeNetworkPolicy
} from '../shared/domain';
import { pickNextSubagentName } from '../shared/subagents';
import { ensureProjectKnowledgeIndexSchema } from './database-schema';

type Row = Record<string, unknown>;

export interface DatabaseMigrationDefaults {
  preferences: Preferences;
  projectRuntimeCommandPolicy: ProjectRuntimeCommandPolicy;
  projectRuntimeNetworkPolicy: ProjectRuntimeNetworkPolicy;
  collabConnectionState: CollabConfig['connectionState'];
  nowIso?: () => string;
}

export interface PostSeedDatabaseBackfillHooks {
  onLegacyWelcomeProjectsRemoved?: () => void;
}

export function runDatabaseMigrations(
  db: Database.Database,
  defaults: DatabaseMigrationDefaults
) {
  ensureProjectKnowledgeIndexSchema(db);
  ensureColumn(
    db,
    'threads',
    'execution_permission',
    "TEXT NOT NULL DEFAULT 'default'"
  );
  ensureColumn(
    db,
    'preferences',
    'default_execution_permission',
    "TEXT NOT NULL DEFAULT 'default'"
  );
  ensureColumn(db, 'preferences', 'default_reasoning_effort_openai', 'TEXT');
  ensureColumn(db, 'preferences', 'default_reasoning_effort_gemini', 'TEXT');
  ensureColumn(
    db,
    'preferences',
    'default_model_qwen',
    `TEXT NOT NULL DEFAULT '${defaults.preferences.defaultModelByProvider.qwen}'`
  );
  ensureColumn(
    db,
    'preferences',
    'default_model_ollama',
    `TEXT NOT NULL DEFAULT '${defaults.preferences.defaultModelByProvider.ollama}'`
  );
  ensureColumn(
    db,
    'preferences',
    'default_model_kimi',
    `TEXT NOT NULL DEFAULT '${defaults.preferences.defaultModelByProvider.kimi}'`
  );
  ensureColumn(db, 'preferences', 'default_reasoning_effort_qwen', 'TEXT');
  ensureColumn(db, 'preferences', 'default_reasoning_effort_ollama', 'TEXT');
  ensureColumn(db, 'preferences', 'default_reasoning_effort_kimi', 'TEXT');
  ensureColumn(
    db,
    'preferences',
    'default_thinking_openai',
    'INTEGER NOT NULL DEFAULT 0'
  );
  ensureColumn(
    db,
    'preferences',
    'default_thinking_gemini',
    'INTEGER NOT NULL DEFAULT 0'
  );
  ensureColumn(
    db,
    'preferences',
    'default_thinking_qwen',
    'INTEGER NOT NULL DEFAULT 1'
  );
  ensureColumn(
    db,
    'preferences',
    'default_thinking_ollama',
    'INTEGER NOT NULL DEFAULT 0'
  );
  ensureColumn(
    db,
    'preferences',
    'default_thinking_kimi',
    'INTEGER NOT NULL DEFAULT 0'
  );
  ensureColumn(
    db,
    'preferences',
    'ollama_transport_mode',
    `TEXT NOT NULL DEFAULT '${defaults.preferences.ollamaTransportMode}'`
  );
  ensureColumn(
    db,
    'preferences',
    'follow_up_behavior',
    `TEXT NOT NULL DEFAULT '${defaults.preferences.followUpBehavior}'`
  );
  ensureColumn(
    db,
    'preferences',
    'generated_memory_use_enabled',
    'INTEGER NOT NULL DEFAULT 0'
  );
  ensureColumn(
    db,
    'preferences',
    'generated_memory_generation_enabled',
    'INTEGER NOT NULL DEFAULT 1'
  );
  ensureColumn(
    db,
    'preferences',
    'appearance_mode',
    `TEXT NOT NULL DEFAULT '${defaults.preferences.appearanceMode}'`
  );
  ensureColumn(
    db,
    'preferences',
    'accent_mode',
    `TEXT NOT NULL DEFAULT '${defaults.preferences.accentMode}'`
  );
  ensureColumn(db, 'preferences', 'accent_color', 'TEXT');
  ensureColumn(
    db,
    'preferences',
    'microphone_allowed',
    'INTEGER NOT NULL DEFAULT 0'
  );
  ensureColumn(db, 'preferences', 'user_library_path', 'TEXT');
  ensureColumn(db, 'preferences', 'skills_library_path', 'TEXT');
  ensureColumn(db, 'preferences', 'llm_wiki_library_path', 'TEXT');
  ensureColumn(
    db,
    'projects',
    'default_model_qwen',
    `TEXT NOT NULL DEFAULT '${defaults.preferences.defaultModelByProvider.qwen}'`
  );
  ensureColumn(
    db,
    'projects',
    'default_model_ollama',
    `TEXT NOT NULL DEFAULT '${defaults.preferences.defaultModelByProvider.ollama}'`
  );
  ensureColumn(
    db,
    'projects',
    'default_model_kimi',
    `TEXT NOT NULL DEFAULT '${defaults.preferences.defaultModelByProvider.kimi}'`
  );
  ensureColumn(
    db,
    'projects',
    'runtime_command_policy',
    `TEXT NOT NULL DEFAULT '${defaults.projectRuntimeCommandPolicy}'`
  );
  ensureColumn(
    db,
    'projects',
    'runtime_network_policy',
    `TEXT NOT NULL DEFAULT '${defaults.projectRuntimeNetworkPolicy}'`
  );
  ensureColumn(db, 'automations', 'next_run_at', 'TEXT');
  ensureColumn(
    db,
    'mcp_servers',
    'launch_approved',
    'INTEGER NOT NULL DEFAULT 0'
  );
  ensureColumn(db, 'mcp_servers', 'scope', "TEXT NOT NULL DEFAULT 'global'");
  ensureColumn(db, 'mcp_servers', 'project_id', 'TEXT');
  ensureColumn(db, 'mcp_servers', 'url', 'TEXT');
  ensureColumn(db, 'mcp_servers', 'headers_json', "TEXT NOT NULL DEFAULT '{}'");
  ensureColumn(db, 'collab_rooms', 'join_code', 'TEXT');
  ensureColumn(db, 'thread_followups', 'metadata_json', 'TEXT');
  ensureColumn(db, 'subagents', 'name', "TEXT NOT NULL DEFAULT 'Agent'");

  ensurePlannerQuestionSetCallIdIsThreadScoped(db);
  backfillSubagentNames(db);
  ensureDefaultPreferences(db, defaults.preferences);
  ensureDefaultCollabSettings(db, defaults);
}

export function runPostSeedDatabaseBackfills(
  db: Database.Database,
  hooks: PostSeedDatabaseBackfillHooks = {}
) {
  repairLegacyWelcomePlaceholderProjects(db, hooks);
  repairProjectTrustDefaults(db);
}

function ensureColumn(
  db: Database.Database,
  tableName: string,
  columnName: string,
  definition: string
) {
  const columns = db
    .prepare(`PRAGMA table_info(${tableName})`)
    .all() as Array<{ name?: string }>;
  if (columns.some((column) => column.name === columnName)) {
    return;
  }
  db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
}

function ensurePlannerQuestionSetCallIdIsThreadScoped(db: Database.Database) {
  const tableSql = db
    .prepare(
      "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'planner_question_sets'"
    )
    .get() as { sql?: string } | undefined;
  if (
    !tableSql?.sql ||
    !/call_id\s+TEXT\s+NOT\s+NULL\s+UNIQUE/i.test(tableSql.sql)
  ) {
    db
      .prepare(
        'CREATE INDEX IF NOT EXISTS idx_planner_question_sets_thread_call ON planner_question_sets(thread_id, call_id)'
      )
      .run();
    return;
  }

  db.transaction(() => {
    db.exec(`
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

function backfillSubagentNames(db: Database.Database) {
  const rows = db
    .prepare(
      `SELECT id, parent_thread_id, name, created_at
       FROM subagents
       ORDER BY parent_thread_id ASC, created_at ASC`
    )
    .all() as Array<{
    id: string;
    parent_thread_id: string;
    name?: string | null;
    created_at: string;
  }>;
  const takenNamesByThread = new Map<string, string[]>();
  const update = db.prepare('UPDATE subagents SET name = ? WHERE id = ?');

  for (const row of rows) {
    const current = (row.name ?? '').trim();
    const taken = takenNamesByThread.get(row.parent_thread_id) ?? [];
    const resolvedName =
      current && current !== 'Agent' ? current : pickNextSubagentName(taken);
    taken.push(resolvedName);
    takenNamesByThread.set(row.parent_thread_id, taken);
    if (resolvedName !== current) {
      update.run(resolvedName, row.id);
    }
  }
}

function ensureDefaultPreferences(
  db: Database.Database,
  preferences: Preferences
) {
  const existing = db
    .prepare('SELECT id FROM preferences WHERE id = 1')
    .get() as { id: number } | undefined;
  if (existing) {
    return;
  }

  db
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
        microphone_allowed,
        user_library_path,
        skills_library_path,
        llm_wiki_library_path
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
        @microphoneAllowed,
        @userLibraryPath,
        @skillsLibraryPath,
        @llmWikiLibraryPath
      )`
    )
    .run({
      selectedProjectId: preferences.selectedProjectId,
      defaultProviderId: preferences.defaultProviderId,
      openaiModel: preferences.defaultModelByProvider.openai,
      geminiModel: preferences.defaultModelByProvider.gemini,
      qwenModel: preferences.defaultModelByProvider.qwen,
      ollamaModel: preferences.defaultModelByProvider.ollama,
      kimiModel: preferences.defaultModelByProvider.kimi,
      openaiReasoningEffort:
        preferences.defaultReasoningEffortByProvider.openai,
      geminiReasoningEffort:
        preferences.defaultReasoningEffortByProvider.gemini,
      qwenReasoningEffort:
        preferences.defaultReasoningEffortByProvider.qwen,
      ollamaReasoningEffort:
        preferences.defaultReasoningEffortByProvider.ollama,
      kimiReasoningEffort:
        preferences.defaultReasoningEffortByProvider.kimi,
      openaiThinking: preferences.defaultThinkingByProvider.openai ? 1 : 0,
      geminiThinking: preferences.defaultThinkingByProvider.gemini ? 1 : 0,
      qwenThinking: preferences.defaultThinkingByProvider.qwen ? 1 : 0,
      ollamaThinking: preferences.defaultThinkingByProvider.ollama ? 1 : 0,
      kimiThinking: preferences.defaultThinkingByProvider.kimi ? 1 : 0,
      ollamaTransportMode: preferences.ollamaTransportMode,
      defaultExecutionPermission: preferences.defaultExecutionPermission,
      followUpBehavior: preferences.followUpBehavior,
      generatedMemoryUseEnabled: preferences.generatedMemoryUseEnabled ? 1 : 0,
      generatedMemoryGenerationEnabled:
        preferences.generatedMemoryGenerationEnabled ? 1 : 0,
      appearanceMode: preferences.appearanceMode,
      accentMode: preferences.accentMode,
      accentColor: preferences.accentColor,
      onboardingComplete: 0,
      lastOpenedThreadId: null,
      microphoneAllowed: 0,
      userLibraryPath: preferences.userLibraryPath,
      skillsLibraryPath: preferences.skillsLibraryPath,
      llmWikiLibraryPath: preferences.llmWikiLibraryPath,
    });
}

function ensureDefaultCollabSettings(
  db: Database.Database,
  defaults: DatabaseMigrationDefaults
) {
  const collabSettings = db
    .prepare('SELECT id FROM collab_settings WHERE id = 1')
    .get() as { id: number } | undefined;
  if (collabSettings) {
    return;
  }

  const nowIso = defaults.nowIso ?? (() => new Date().toISOString());
  db
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
      connectionState: defaults.collabConnectionState,
      updatedAt: nowIso(),
    });
}

function repairLegacyWelcomePlaceholderProjects(
  db: Database.Database,
  hooks: PostSeedDatabaseBackfillHooks
) {
  const placeholderIds = (
    db
      .prepare(
        `SELECT projects.id
           FROM projects
           LEFT JOIN threads ON threads.project_id = projects.id
          WHERE projects.name = 'My Project'
            AND projects.folder_path IS NULL
          GROUP BY projects.id
         HAVING COUNT(threads.id) = 0`
      )
      .all() as Array<{ id: string }>
  ).map((row) => String(row.id));

  if (placeholderIds.length === 0) {
    return;
  }

  const removePlaceholderProjects = db.transaction((projectIds: string[]) => {
    const deleteProject = db.prepare('DELETE FROM projects WHERE id = ?');
    for (const projectId of projectIds) {
      deleteProject.run(projectId);
    }
  });

  removePlaceholderProjects(placeholderIds);
  hooks.onLegacyWelcomeProjectsRemoved?.();
}

function repairProjectTrustDefaults(db: Database.Database) {
  db.prepare('UPDATE projects SET trusted = 1 WHERE trusted = 0').run();
}
