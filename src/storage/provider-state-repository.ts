import type Database from 'better-sqlite3';
import type {
  ProviderAccount,
  ProviderId,
  ProviderModel,
  ProviderModelSource
} from '../shared/domain';

type Row = Record<string, unknown>;

export class ProviderStateRepository {
  constructor(
    private readonly db: Database.Database,
    private readonly mapProviderAccount: (row: Row) => ProviderAccount,
    private readonly mapProviderModel: (row: Row) => ProviderModel
  ) {}

  getProviderAccount(providerId: ProviderId): ProviderAccount | null {
    const row = this.db
      .prepare('SELECT * FROM provider_accounts WHERE provider_id = ?')
      .get(providerId) as Row | undefined;
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

  getProviderModelCache(providerId: ProviderId): {
    models: ProviderModel[];
    updatedAt: string | null;
    source: ProviderModelSource | null;
  } {
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
      source: String(rows[0].source) as ProviderModelSource
    };
  }

  replaceProviderModels(
    providerId: ProviderId,
    models: ProviderModel[],
    source: Extract<ProviderModelSource, 'api' | 'runtime'>
  ) {
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
}
