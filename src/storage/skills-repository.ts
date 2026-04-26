import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { SkillDefinition, SkillSaveInput } from '../shared/domain';

type Row = Record<string, unknown>;

export class SkillsRepository {
  constructor(
    private readonly db: Database.Database,
    private readonly mapSkill: (row: Row) => SkillDefinition
  ) {}

  listSkills(): SkillDefinition[] {
    return this.db
      .prepare('SELECT * FROM skills ORDER BY origin, name')
      .all()
      .map((row) => this.mapSkill(row as Row));
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
    this.db
      .prepare('UPDATE skills SET enabled = ?, updated_at = ? WHERE id = ?')
      .run(enabled ? 1 : 0, new Date().toISOString(), skillId);
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
}
