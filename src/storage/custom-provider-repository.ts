import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type {
  CustomProviderDefinition,
  CustomProviderSaveInput
} from '../shared/domain';

type Row = Record<string, unknown>;

export class CustomProviderRepository {
  constructor(
    private readonly db: Database.Database,
    private readonly mapProvider: (row: Row) => CustomProviderDefinition
  ) {}

  listCustomProviders(): CustomProviderDefinition[] {
    return this.db
      .prepare('SELECT * FROM custom_providers ORDER BY updated_at DESC, name ASC')
      .all()
      .map((row) => this.mapProvider(row as Row));
  }

  getCustomProvider(providerId: string): CustomProviderDefinition {
    const row = this.db
      .prepare('SELECT * FROM custom_providers WHERE id = ?')
      .get(providerId) as Row | undefined;
    if (!row) {
      throw new Error(`Custom provider not found: ${providerId}`);
    }
    return this.mapProvider(row);
  }

  saveCustomProvider(input: CustomProviderSaveInput): CustomProviderDefinition {
    const now = new Date().toISOString();
    const id = input.id ?? `custom-provider-${randomUUID()}`;
    const exists = input.id
      ? this.db.prepare('SELECT id FROM custom_providers WHERE id = ?').get(input.id)
      : undefined;

    if (exists) {
      this.db
        .prepare(
          `UPDATE custom_providers
           SET name = @name,
               transport_kind = @transportKind,
               base_url = @baseUrl,
               encrypted_api_key = @encryptedApiKey,
               default_model_id = @defaultModelId,
               enabled = @enabled,
               updated_at = @updatedAt
           WHERE id = @id`
        )
        .run({
          id,
          name: input.name,
          transportKind: input.transportKind,
          baseUrl: input.baseUrl,
          encryptedApiKey: input.encryptedApiKey,
          defaultModelId: input.defaultModelId,
          enabled: input.enabled ? 1 : 0,
          updatedAt: now
        });
    } else {
      this.db
        .prepare(
          `INSERT INTO custom_providers (
            id, name, transport_kind, base_url, encrypted_api_key, default_model_id, enabled, created_at, updated_at
          ) VALUES (
            @id, @name, @transportKind, @baseUrl, @encryptedApiKey, @defaultModelId, @enabled, @createdAt, @updatedAt
          )`
        )
        .run({
          id,
          name: input.name,
          transportKind: input.transportKind,
          baseUrl: input.baseUrl,
          encryptedApiKey: input.encryptedApiKey,
          defaultModelId: input.defaultModelId,
          enabled: input.enabled ? 1 : 0,
          createdAt: now,
          updatedAt: now
        });
    }

    return this.getCustomProvider(id);
  }

  deleteCustomProvider(providerId: string) {
    this.db.prepare('DELETE FROM custom_providers WHERE id = ?').run(providerId);
  }
}
