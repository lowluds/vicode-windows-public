import type Database from 'better-sqlite3';

export function ensureDatabaseSchema(db: Database.Database) {
  db.exec(`
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
      CREATE TABLE IF NOT EXISTS thread_compactions (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
        source_start_event_id TEXT NOT NULL,
        source_end_event_id TEXT NOT NULL,
        summary TEXT NOT NULL,
        input_token_estimate INTEGER,
        output_token_estimate INTEGER,
        provider_id TEXT,
        model_id TEXT,
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
      CREATE TABLE IF NOT EXISTS custom_providers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        transport_kind TEXT NOT NULL,
        base_url TEXT NOT NULL,
        encrypted_api_key TEXT NOT NULL,
        default_model_id TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
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
        microphone_allowed INTEGER NOT NULL DEFAULT 0,
        user_library_path TEXT,
        skills_library_path TEXT,
        llm_wiki_library_path TEXT
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
        url TEXT,
        headers_json TEXT NOT NULL DEFAULT '{}',
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
      CREATE INDEX IF NOT EXISTS idx_thread_compactions_thread_created
        ON thread_compactions(thread_id, created_at DESC);
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
  ensureProjectKnowledgeIndexSchema(db);
}

export function ensureProjectKnowledgeIndexSchema(db: Database.Database) {
  db.exec(`
      CREATE TABLE IF NOT EXISTS project_knowledge_roots (
        id TEXT PRIMARY KEY,
        root_path TEXT NOT NULL UNIQUE,
        root_path_hash TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        status TEXT NOT NULL,
        last_refresh_id TEXT,
        last_refreshed_at TEXT,
        last_error TEXT,
        file_count INTEGER NOT NULL DEFAULT 0,
        section_count INTEGER NOT NULL DEFAULT 0,
        diagnostic_count INTEGER NOT NULL DEFAULT 0,
        warning_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS project_knowledge_refreshes (
        id TEXT PRIMARY KEY,
        root_id TEXT NOT NULL REFERENCES project_knowledge_roots(id) ON DELETE CASCADE,
        status TEXT NOT NULL,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        duration_ms INTEGER,
        file_count INTEGER NOT NULL DEFAULT 0,
        skipped_file_count INTEGER NOT NULL DEFAULT 0,
        section_count INTEGER NOT NULL DEFAULT 0,
        diagnostic_count INTEGER NOT NULL DEFAULT 0,
        warning_count INTEGER NOT NULL DEFAULT 0,
        error_count INTEGER NOT NULL DEFAULT 0,
        fts5_available INTEGER NOT NULL DEFAULT 0,
        error_message TEXT
      );
      CREATE TABLE IF NOT EXISTS project_knowledge_sources (
        id TEXT PRIMARY KEY,
        root_id TEXT NOT NULL REFERENCES project_knowledge_roots(id) ON DELETE CASCADE,
        relative_path TEXT NOT NULL,
        file_name TEXT NOT NULL,
        file_size INTEGER NOT NULL,
        modified_time_ms INTEGER NOT NULL,
        content_hash TEXT,
        title TEXT NOT NULL,
        aliases_json TEXT NOT NULL,
        tags_json TEXT NOT NULL,
        heading_count INTEGER NOT NULL DEFAULT 0,
        skipped_reason TEXT,
        indexed_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(root_id, relative_path)
      );
      CREATE TABLE IF NOT EXISTS project_knowledge_sections (
        id TEXT PRIMARY KEY,
        root_id TEXT NOT NULL REFERENCES project_knowledge_roots(id) ON DELETE CASCADE,
        source_id TEXT NOT NULL REFERENCES project_knowledge_sources(id) ON DELETE CASCADE,
        ordinal INTEGER NOT NULL,
        heading TEXT,
        heading_depth INTEGER NOT NULL DEFAULT 0,
        start_line INTEGER,
        end_line INTEGER,
        preview_text TEXT NOT NULL,
        indexed_text TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(source_id, ordinal)
      );
      CREATE TABLE IF NOT EXISTS project_knowledge_diagnostics (
        id TEXT PRIMARY KEY,
        root_id TEXT NOT NULL REFERENCES project_knowledge_roots(id) ON DELETE CASCADE,
        source_id TEXT REFERENCES project_knowledge_sources(id) ON DELETE SET NULL,
        relative_path TEXT,
        severity TEXT NOT NULL,
        code TEXT NOT NULL,
        message TEXT NOT NULL,
        suggested_action TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_project_knowledge_roots_path_hash
        ON project_knowledge_roots(root_path_hash);
      CREATE INDEX IF NOT EXISTS idx_project_knowledge_refreshes_root_started
        ON project_knowledge_refreshes(root_id, started_at DESC);
      CREATE INDEX IF NOT EXISTS idx_project_knowledge_sources_root_path
        ON project_knowledge_sources(root_id, relative_path);
      CREATE INDEX IF NOT EXISTS idx_project_knowledge_sources_root_title
        ON project_knowledge_sources(root_id, title);
      CREATE INDEX IF NOT EXISTS idx_project_knowledge_sections_root_source
        ON project_knowledge_sections(root_id, source_id, ordinal);
      CREATE INDEX IF NOT EXISTS idx_project_knowledge_diagnostics_root_severity
        ON project_knowledge_diagnostics(root_id, severity, code);
  `);
}
