import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type {
  AutomationDefinition,
  Preferences,
  Project,
  SkillDefinition,
  ThreadDetail,
  ThreadSummary,
  ThreadTurn
} from '../shared/domain';

function now(): string {
  return new Date().toISOString();
}

function parseJson<T>(value: string): T {
  return JSON.parse(value) as T;
}

export class AppRepository {
  constructor(private readonly db: Database.Database) {}

  getPreferences(): Preferences & { selectedProjectId: string | null } {
    const row = this.db
      .prepare(
        `
          SELECT
            default_provider AS defaultProvider,
            default_openai_model AS defaultOpenAiModel,
            default_gemini_model AS defaultGeminiModel,
            selected_project_id AS selectedProjectId,
            storage_path AS storagePath
          FROM preferences
          WHERE id = 1
        `
      )
      .get() as Preferences & { selectedProjectId: string | null };

    return row;
  }

  setSelectedProjectId(projectId: string | null): void {
    this.db
      .prepare('UPDATE preferences SET selected_project_id = ? WHERE id = 1')
      .run(projectId);
  }

  listProjects(): Project[] {
    const rows = this.db
      .prepare(
        `
          SELECT
            id,
            name,
            folder_path AS folderPath,
            CAST(is_trusted AS INTEGER) AS isTrusted,
            default_provider AS defaultProvider,
            default_model AS defaultModel,
            created_at AS createdAt,
            updated_at AS updatedAt
          FROM projects
          ORDER BY updated_at DESC
        `
      )
      .all() as Array<Project & { isTrusted: number }>;

    return rows.map((row) => ({
      ...row,
      isTrusted: Boolean(row.isTrusted)
    }));
  }

  getProject(projectId: string): Project {
    const project = this.listProjects().find((item) => item.id === projectId);
    if (!project) {
      throw new Error(`Project not found: ${projectId}`);
    }
    return project;
  }

  createProject(input: Omit<Project, 'id' | 'createdAt' | 'updatedAt' | 'defaultProvider' | 'defaultModel'>): Project {
    const project: Project = {
      id: randomUUID(),
      name: input.name,
      folderPath: input.folderPath,
      isTrusted: input.isTrusted,
      defaultProvider: null,
      defaultModel: null,
      createdAt: now(),
      updatedAt: now()
    };

    this.db
      .prepare(
        `
          INSERT INTO projects (
            id, name, folder_path, is_trusted, default_provider, default_model, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `
      )
      .run(
        project.id,
        project.name,
        project.folderPath,
        project.isTrusted ? 1 : 0,
        project.defaultProvider,
        project.defaultModel,
        project.createdAt,
        project.updatedAt
      );

    this.setSelectedProjectId(project.id);
    return project;
  }

  updateProject(project: Project): Project {
    const updatedProject = { ...project, updatedAt: now() };
    this.db
      .prepare(
        `
          UPDATE projects
          SET name = ?, folder_path = ?, is_trusted = ?, default_provider = ?, default_model = ?, updated_at = ?
          WHERE id = ?
        `
      )
      .run(
        updatedProject.name,
        updatedProject.folderPath,
        updatedProject.isTrusted ? 1 : 0,
        updatedProject.defaultProvider,
        updatedProject.defaultModel,
        updatedProject.updatedAt,
        updatedProject.id
      );

    return updatedProject;
  }

  removeProject(projectId: string): void {
    this.db.prepare('DELETE FROM projects WHERE id = ?').run(projectId);
    const selectedProjectId = this.getPreferences().selectedProjectId;
    if (selectedProjectId === projectId) {
      this.setSelectedProjectId(null);
    }
  }

  listThreads(projectId: string | null): ThreadSummary[] {
    const baseQuery = `
      SELECT
        id,
        project_id AS projectId,
        title,
        provider,
        model,
        status,
        CAST(is_archived AS INTEGER) AS isArchived,
        last_message_at AS lastMessageAt,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM threads
      WHERE is_archived = 0
    `;

    if (!projectId) {
      const rows = this.db.prepare(`${baseQuery} ORDER BY updated_at DESC`).all() as Array<
        ThreadSummary & { isArchived: number }
      >;
      return rows.map((row) => ({
        ...row,
        isArchived: Boolean(row.isArchived)
      }));
    }

    const rows = this.db
      .prepare(`${baseQuery} AND project_id = ? ORDER BY updated_at DESC`)
      .all(projectId) as Array<ThreadSummary & { isArchived: number }>;

    return rows.map((row) => ({
      ...row,
      isArchived: Boolean(row.isArchived)
    }));
  }

  getThread(threadId: string): ThreadDetail {
    const thread = this.db
      .prepare(
        `
          SELECT
            id,
            project_id AS projectId,
            title,
            provider,
            model,
            status,
            CAST(is_archived AS INTEGER) AS isArchived,
            last_message_at AS lastMessageAt,
            created_at AS createdAt,
            updated_at AS updatedAt
          FROM threads
          WHERE id = ?
        `
      )
      .get(threadId) as (ThreadSummary & { isArchived: number }) | undefined;

    if (!thread) {
      throw new Error(`Thread not found: ${threadId}`);
    }

    const turns = this.db
      .prepare(
        `
          SELECT
            id,
            thread_id AS threadId,
            role,
            content,
            provider,
            model,
            status,
            created_at AS createdAt
          FROM thread_turns
          WHERE thread_id = ?
          ORDER BY created_at ASC
        `
      )
      .all(threadId) as ThreadTurn[];

    return { ...thread, isArchived: Boolean(thread.isArchived), turns };
  }

  createThread(input: {
    projectId: string;
    title: string;
    provider: string;
    model: string;
  }): ThreadDetail {
    const createdAt = now();
    const thread: ThreadSummary = {
      id: randomUUID(),
      projectId: input.projectId,
      title: input.title,
      provider: input.provider as ThreadSummary['provider'],
      model: input.model,
      status: 'draft',
      isArchived: false,
      lastMessageAt: null,
      createdAt,
      updatedAt: createdAt
    };

    this.db
      .prepare(
        `
          INSERT INTO threads (
            id, project_id, title, provider, model, status, is_archived, last_message_at, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?)
        `
      )
      .run(
        thread.id,
        thread.projectId,
        thread.title,
        thread.provider,
        thread.model,
        thread.status,
        thread.lastMessageAt,
        thread.createdAt,
        thread.updatedAt
      );

    this.setSelectedProjectId(thread.projectId);
    return { ...thread, turns: [] };
  }

  renameThread(threadId: string, title: string): ThreadDetail {
    this.db
      .prepare('UPDATE threads SET title = ?, updated_at = ? WHERE id = ?')
      .run(title, now(), threadId);
    return this.getThread(threadId);
  }

  archiveThread(threadId: string): void {
    this.db
      .prepare("UPDATE threads SET is_archived = 1, status = 'archived', updated_at = ? WHERE id = ?")
      .run(now(), threadId);
  }

  removeThread(threadId: string): void {
    this.db.prepare('DELETE FROM threads WHERE id = ?').run(threadId);
  }

  duplicateThread(threadId: string): ThreadDetail {
    const source = this.getThread(threadId);
    const duplicated = this.createThread({
      projectId: source.projectId,
      title: `${source.title} Copy`,
      provider: source.provider,
      model: source.model
    });

    const insertTurn = this.db.prepare(
      `
        INSERT INTO thread_turns (id, thread_id, role, content, provider, model, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `
    );

    for (const turn of source.turns) {
      insertTurn.run(
        randomUUID(),
        duplicated.id,
        turn.role,
        turn.content,
        turn.provider,
        turn.model,
        turn.status,
        now()
      );
    }

    return this.getThread(duplicated.id);
  }

  appendTurn(input: {
    threadId: string;
    role: ThreadTurn['role'];
    content: string;
    provider: string | null;
    model: string | null;
    status: ThreadTurn['status'];
  }): ThreadTurn {
    const turn: ThreadTurn = {
      id: randomUUID(),
      threadId: input.threadId,
      role: input.role,
      content: input.content,
      provider: input.provider as ThreadTurn['provider'],
      model: input.model,
      status: input.status,
      createdAt: now()
    };

    this.db
      .prepare(
        `
          INSERT INTO thread_turns (id, thread_id, role, content, provider, model, status, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `
      )
      .run(
        turn.id,
        turn.threadId,
        turn.role,
        turn.content,
        turn.provider,
        turn.model,
        turn.status,
        turn.createdAt
      );

    this.updateThreadMetadata(turn.threadId, turn.status ?? 'completed');
    return turn;
  }

  updateTurnContent(turnId: string, content: string, status: ThreadTurn['status']): void {
    this.db
      .prepare('UPDATE thread_turns SET content = ?, status = ? WHERE id = ?')
      .run(content, status, turnId);
  }

  updateThreadMetadata(threadId: string, status: ThreadSummary['status']): void {
    const timestamp = now();
    this.db
      .prepare('UPDATE threads SET status = ?, last_message_at = ?, updated_at = ? WHERE id = ?')
      .run(status, timestamp, timestamp, threadId);
  }

  listSkills(): SkillDefinition[] {
    const rows = this.db
      .prepare(
        `
          SELECT
            id,
            name,
            description,
            instructions,
            origin,
            scope,
            provider_targets AS providerTargets,
            CAST(enabled AS INTEGER) AS enabled,
            project_id AS projectId,
            metadata_json AS metadata,
            path,
            created_at AS createdAt,
            updated_at AS updatedAt
          FROM skills
          ORDER BY origin ASC, updated_at DESC
        `
      )
      .all() as Array<Omit<SkillDefinition, 'providerTargets' | 'metadata'> & { providerTargets: string; metadata: string }>;

    return rows.map((row) => ({
      ...row,
      providerTargets: parseJson(row.providerTargets),
      enabled: Boolean(row.enabled),
      metadata: parseJson(row.metadata)
    }));
  }

  upsertSkill(skill: Omit<SkillDefinition, 'createdAt' | 'updatedAt'> & { createdAt?: string }): SkillDefinition {
    const createdAt = skill.createdAt ?? now();
    const updatedAt = now();
    const payload = {
      ...skill,
      createdAt,
      updatedAt
    };

    this.db
      .prepare(
        `
          INSERT INTO skills (
            id, name, description, instructions, origin, scope, provider_targets, enabled, project_id,
            metadata_json, path, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            description = excluded.description,
            instructions = excluded.instructions,
            origin = excluded.origin,
            scope = excluded.scope,
            provider_targets = excluded.provider_targets,
            enabled = excluded.enabled,
            project_id = excluded.project_id,
            metadata_json = excluded.metadata_json,
            path = excluded.path,
            updated_at = excluded.updated_at
        `
      )
      .run(
        payload.id,
        payload.name,
        payload.description,
        payload.instructions,
        payload.origin,
        payload.scope,
        JSON.stringify(payload.providerTargets),
        payload.enabled ? 1 : 0,
        payload.projectId,
        JSON.stringify(payload.metadata),
        payload.path,
        payload.createdAt,
        payload.updatedAt
      );

    return this.listSkills().find((item) => item.id === payload.id)!;
  }

  removeSkill(skillId: string): void {
    this.db.prepare('DELETE FROM skills WHERE id = ?').run(skillId);
  }

  listAutomations(): AutomationDefinition[] {
    const rows = this.db
      .prepare(
        `
          SELECT
            id,
            name,
            prompt_template AS promptTemplate,
            type,
            project_id AS projectId,
            provider,
            model,
            skill_id AS skillId,
            interval_minutes AS intervalMinutes,
            CAST(enabled AS INTEGER) AS enabled,
            last_run_at AS lastRunAt,
            created_at AS createdAt,
            updated_at AS updatedAt
          FROM automations
          ORDER BY updated_at DESC
        `
      )
      .all() as Array<AutomationDefinition & { enabled: number }>;

    return rows.map((row) => ({
      ...row,
      enabled: Boolean(row.enabled)
    }));
  }

  upsertAutomation(
    automation: Omit<AutomationDefinition, 'createdAt' | 'updatedAt' | 'lastRunAt'> & {
      createdAt?: string;
      lastRunAt?: string | null;
    }
  ): AutomationDefinition {
    const payload = {
      ...automation,
      createdAt: automation.createdAt ?? now(),
      lastRunAt: automation.lastRunAt ?? null,
      updatedAt: now()
    };

    this.db
      .prepare(
        `
          INSERT INTO automations (
            id, name, prompt_template, type, project_id, provider, model, skill_id, interval_minutes,
            enabled, last_run_at, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            prompt_template = excluded.prompt_template,
            type = excluded.type,
            project_id = excluded.project_id,
            provider = excluded.provider,
            model = excluded.model,
            skill_id = excluded.skill_id,
            interval_minutes = excluded.interval_minutes,
            enabled = excluded.enabled,
            last_run_at = excluded.last_run_at,
            updated_at = excluded.updated_at
        `
      )
      .run(
        payload.id,
        payload.name,
        payload.promptTemplate,
        payload.type,
        payload.projectId,
        payload.provider,
        payload.model,
        payload.skillId,
        payload.intervalMinutes,
        payload.enabled ? 1 : 0,
        payload.lastRunAt,
        payload.createdAt,
        payload.updatedAt
      );

    return this.listAutomations().find((item) => item.id === payload.id)!;
  }

  markAutomationRun(automationId: string): void {
    this.db
      .prepare('UPDATE automations SET last_run_at = ?, updated_at = ? WHERE id = ?')
      .run(now(), now(), automationId);
  }

  removeAutomation(automationId: string): void {
    this.db.prepare('DELETE FROM automations WHERE id = ?').run(automationId);
  }
}
