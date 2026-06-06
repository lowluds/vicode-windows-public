import { createHash, randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import Database from 'better-sqlite3';

type Row = Record<string, unknown>;
type ProjectKnowledgeDiagnosticSeverity = 'info' | 'warning' | 'error';

export interface ProjectKnowledgeIndexSourceInput {
  path: string;
  relativePath: string;
  fileName: string;
  fileSize: number;
  modifiedTimeMs: number;
  contentHash: string | null;
  title: string;
  aliases: string[];
  tags: string[];
  headingCount: number;
  skippedReason: string | null;
}

export interface ProjectKnowledgeIndexSectionInput {
  sourceRelativePath: string;
  ordinal: number;
  heading: string | null;
  headingDepth: number;
  startLine: number | null;
  endLine: number | null;
  previewText: string;
  content: string;
  contentHash: string;
}

export interface ProjectKnowledgeIndexDiagnosticInput {
  severity: ProjectKnowledgeDiagnosticSeverity;
  code: string;
  relativePath: string | null;
  message: string;
  suggestedAction: string | null;
}

export interface ProjectKnowledgeRootRecord {
  id: string;
  rootPath: string;
  rootPathHash: string;
  displayName: string;
  status: string;
  lastRefreshId: string | null;
  lastRefreshedAt: string | null;
  lastError: string | null;
  fileCount: number;
  sectionCount: number;
  diagnosticCount: number;
  warningCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectKnowledgeSourceRecord {
  id: string;
  rootId: string;
  relativePath: string;
  fileName: string;
  fileSize: number;
  modifiedTimeMs: number;
  contentHash: string | null;
  title: string;
  aliases: string[];
  tags: string[];
  headingCount: number;
  skippedReason: string | null;
  indexedAt: string;
  updatedAt: string;
}

export interface ProjectKnowledgeSectionRecord {
  id: string;
  rootId: string;
  sourceId: string;
  ordinal: number;
  heading: string | null;
  headingDepth: number;
  startLine: number | null;
  endLine: number | null;
  previewText: string;
  indexedText: string;
  contentHash: string;
  updatedAt: string;
}

export interface ProjectKnowledgeDiagnosticRecord {
  id: string;
  rootId: string;
  sourceId: string | null;
  relativePath: string | null;
  severity: ProjectKnowledgeDiagnosticSeverity;
  code: string;
  message: string;
  suggestedAction: string | null;
  createdAt: string;
}

export interface ProjectKnowledgeRefreshRecord {
  id: string;
  rootId: string;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  fileCount: number;
  skippedFileCount: number;
  sectionCount: number;
  diagnosticCount: number;
  warningCount: number;
  errorCount: number;
  fts5Available: boolean;
  errorMessage: string | null;
}

export interface ProjectKnowledgeIndexSnapshot {
  root: ProjectKnowledgeRootRecord;
  latestRefresh: ProjectKnowledgeRefreshRecord | null;
  sources: ProjectKnowledgeSourceRecord[];
  sections: ProjectKnowledgeSectionRecord[];
  diagnostics: ProjectKnowledgeDiagnosticRecord[];
}

export interface ProjectKnowledgeReplaceRootIndexInput {
  rootPath: string;
  displayName?: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  fts5Available: boolean;
  sources: ProjectKnowledgeIndexSourceInput[];
  sections: ProjectKnowledgeIndexSectionInput[];
  diagnostics: ProjectKnowledgeIndexDiagnosticInput[];
}

export class ProjectKnowledgeIndexRepository {
  constructor(private readonly db: Database.Database) {}

  isFts5Available() {
    try {
      this.db.exec(`
        CREATE VIRTUAL TABLE temp.vicode_project_knowledge_fts5_probe USING fts5(content);
        DROP TABLE temp.vicode_project_knowledge_fts5_probe;
      `);
      return true;
    } catch {
      try {
        this.db.exec('DROP TABLE IF EXISTS temp.vicode_project_knowledge_fts5_probe');
      } catch {
        // Best-effort cleanup after a feature probe failure.
      }
      return false;
    }
  }

  replaceRootIndex(input: ProjectKnowledgeReplaceRootIndexInput): ProjectKnowledgeIndexSnapshot {
    const rootId = createStableId('project_knowledge_root', normalizeRootPath(input.rootPath));
    const rootPathHash = createStableHash(normalizeRootPath(input.rootPath));
    const refreshId = randomUUID();
    const displayName = input.displayName?.trim() || basename(input.rootPath) || input.rootPath;
    const indexedSources = input.sources.filter((source) => !source.skippedReason);
    const skippedSources = input.sources.length - indexedSources.length;
    const warningCount = input.diagnostics.filter((diagnostic) => diagnostic.severity === 'warning').length;
    const errorCount = input.diagnostics.filter((diagnostic) => diagnostic.severity === 'error').length;

    const transaction = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO project_knowledge_roots (
            id, root_path, root_path_hash, display_name, status, last_refresh_id, last_refreshed_at,
            last_error, file_count, section_count, diagnostic_count, warning_count, created_at, updated_at
          ) VALUES (
            @id, @rootPath, @rootPathHash, @displayName, 'ready', @lastRefreshId, @lastRefreshedAt,
            NULL, @fileCount, @sectionCount, @diagnosticCount, @warningCount, @createdAt, @updatedAt
          )
          ON CONFLICT(id) DO UPDATE SET
            root_path = excluded.root_path,
            root_path_hash = excluded.root_path_hash,
            display_name = excluded.display_name,
            status = excluded.status,
            last_refresh_id = excluded.last_refresh_id,
            last_refreshed_at = excluded.last_refreshed_at,
            last_error = excluded.last_error,
            file_count = excluded.file_count,
            section_count = excluded.section_count,
            diagnostic_count = excluded.diagnostic_count,
            warning_count = excluded.warning_count,
            updated_at = excluded.updated_at`
        )
        .run({
          id: rootId,
          rootPath: input.rootPath,
          rootPathHash,
          displayName,
          lastRefreshId: refreshId,
          lastRefreshedAt: input.finishedAt,
          fileCount: indexedSources.length,
          sectionCount: input.sections.length,
          diagnosticCount: input.diagnostics.length,
          warningCount,
          createdAt: input.startedAt,
          updatedAt: input.finishedAt
        });

      this.db.prepare('DELETE FROM project_knowledge_diagnostics WHERE root_id = ?').run(rootId);
      this.db.prepare('DELETE FROM project_knowledge_sections WHERE root_id = ?').run(rootId);
      this.db.prepare('DELETE FROM project_knowledge_sources WHERE root_id = ?').run(rootId);

      const sourceIdByRelativePath = new Map<string, string>();
      const insertSource = this.db.prepare(
        `INSERT INTO project_knowledge_sources (
          id, root_id, relative_path, file_name, file_size, modified_time_ms, content_hash, title,
          aliases_json, tags_json, heading_count, skipped_reason, indexed_at, updated_at
        ) VALUES (
          @id, @rootId, @relativePath, @fileName, @fileSize, @modifiedTimeMs, @contentHash, @title,
          @aliasesJson, @tagsJson, @headingCount, @skippedReason, @indexedAt, @updatedAt
        )`
      );
      for (const source of input.sources) {
        const sourceId = createStableId('project_knowledge_source', rootId, source.relativePath);
        sourceIdByRelativePath.set(source.relativePath, sourceId);
        insertSource.run({
          id: sourceId,
          rootId,
          relativePath: source.relativePath,
          fileName: source.fileName,
          fileSize: source.fileSize,
          modifiedTimeMs: source.modifiedTimeMs,
          contentHash: source.contentHash,
          title: source.title,
          aliasesJson: JSON.stringify(source.aliases),
          tagsJson: JSON.stringify(source.tags),
          headingCount: source.headingCount,
          skippedReason: source.skippedReason,
          indexedAt: input.finishedAt,
          updatedAt: input.finishedAt
        });
      }

      const insertSection = this.db.prepare(
        `INSERT INTO project_knowledge_sections (
          id, root_id, source_id, ordinal, heading, heading_depth, start_line, end_line,
          preview_text, indexed_text, content_hash, updated_at
        ) VALUES (
          @id, @rootId, @sourceId, @ordinal, @heading, @headingDepth, @startLine, @endLine,
          @previewText, @indexedText, @contentHash, @updatedAt
        )`
      );
      for (const section of input.sections) {
        const sourceId = sourceIdByRelativePath.get(section.sourceRelativePath);
        if (!sourceId) {
          continue;
        }
        insertSection.run({
          id: createStableId('project_knowledge_section', sourceId, String(section.ordinal)),
          rootId,
          sourceId,
          ordinal: section.ordinal,
          heading: section.heading,
          headingDepth: section.headingDepth,
          startLine: section.startLine,
          endLine: section.endLine,
          previewText: section.previewText,
          indexedText: section.content,
          contentHash: section.contentHash,
          updatedAt: input.finishedAt
        });
      }

      const insertDiagnostic = this.db.prepare(
        `INSERT INTO project_knowledge_diagnostics (
          id, root_id, source_id, relative_path, severity, code, message, suggested_action, created_at
        ) VALUES (
          @id, @rootId, @sourceId, @relativePath, @severity, @code, @message, @suggestedAction, @createdAt
        )`
      );
      input.diagnostics.forEach((diagnostic, index) => {
        const sourceId = diagnostic.relativePath
          ? sourceIdByRelativePath.get(diagnostic.relativePath) ?? null
          : null;
        insertDiagnostic.run({
          id: createStableId('project_knowledge_diagnostic', refreshId, String(index), diagnostic.code, diagnostic.relativePath ?? ''),
          rootId,
          sourceId,
          relativePath: diagnostic.relativePath,
          severity: diagnostic.severity,
          code: diagnostic.code,
          message: diagnostic.message,
          suggestedAction: diagnostic.suggestedAction,
          createdAt: input.finishedAt
        });
      });

      this.db
        .prepare(
          `INSERT INTO project_knowledge_refreshes (
            id, root_id, status, started_at, finished_at, duration_ms, file_count, skipped_file_count,
            section_count, diagnostic_count, warning_count, error_count, fts5_available, error_message
          ) VALUES (
            @id, @rootId, 'completed', @startedAt, @finishedAt, @durationMs, @fileCount, @skippedFileCount,
            @sectionCount, @diagnosticCount, @warningCount, @errorCount, @fts5Available, NULL
          )`
        )
        .run({
          id: refreshId,
          rootId,
          startedAt: input.startedAt,
          finishedAt: input.finishedAt,
          durationMs: input.durationMs,
          fileCount: indexedSources.length,
          skippedFileCount: skippedSources,
          sectionCount: input.sections.length,
          diagnosticCount: input.diagnostics.length,
          warningCount,
          errorCount,
          fts5Available: input.fts5Available ? 1 : 0
        });
    });

    transaction();
    return this.getSnapshot(rootId)!;
  }

  getRootByPath(rootPath: string): ProjectKnowledgeRootRecord | null {
    const row = this.db
      .prepare('SELECT * FROM project_knowledge_roots WHERE root_path_hash = ?')
      .get(createStableHash(normalizeRootPath(rootPath))) as Row | undefined;
    return row ? mapRoot(row) : null;
  }

  getSnapshotByRootPath(rootPath: string): ProjectKnowledgeIndexSnapshot | null {
    const root = this.getRootByPath(rootPath);
    return root ? this.getSnapshot(root.id) : null;
  }

  getSnapshot(rootId: string): ProjectKnowledgeIndexSnapshot | null {
    const rootRow = this.db
      .prepare('SELECT * FROM project_knowledge_roots WHERE id = ?')
      .get(rootId) as Row | undefined;
    if (!rootRow) {
      return null;
    }

    return {
      root: mapRoot(rootRow),
      latestRefresh: this.getLatestRefresh(rootId),
      sources: this.listSources(rootId),
      sections: this.listSections(rootId),
      diagnostics: this.listDiagnostics(rootId)
    };
  }

  getLatestRefresh(rootId: string): ProjectKnowledgeRefreshRecord | null {
    const row = this.db
      .prepare(
        `SELECT *
         FROM project_knowledge_refreshes
         WHERE root_id = ?
         ORDER BY started_at DESC, id DESC
         LIMIT 1`
      )
      .get(rootId) as Row | undefined;
    return row ? mapRefresh(row) : null;
  }

  listSources(rootId: string): ProjectKnowledgeSourceRecord[] {
    return this.db
      .prepare(
        `SELECT *
         FROM project_knowledge_sources
         WHERE root_id = ?
         ORDER BY relative_path ASC`
      )
      .all(rootId)
      .map((row) => mapSource(row as Row));
  }

  listSections(rootId: string): ProjectKnowledgeSectionRecord[] {
    return this.db
      .prepare(
        `SELECT *
         FROM project_knowledge_sections
         WHERE root_id = ?
         ORDER BY source_id ASC, ordinal ASC`
      )
      .all(rootId)
      .map((row) => mapSection(row as Row));
  }

  listDiagnostics(rootId: string): ProjectKnowledgeDiagnosticRecord[] {
    return this.db
      .prepare(
        `SELECT *
         FROM project_knowledge_diagnostics
         WHERE root_id = ?
         ORDER BY severity DESC, relative_path ASC, code ASC`
      )
      .all(rootId)
      .map((row) => mapDiagnostic(row as Row));
  }
}

function mapRoot(row: Row): ProjectKnowledgeRootRecord {
  return {
    id: String(row.id),
    rootPath: String(row.root_path),
    rootPathHash: String(row.root_path_hash),
    displayName: String(row.display_name),
    status: String(row.status),
    lastRefreshId: (row.last_refresh_id as string | null) ?? null,
    lastRefreshedAt: (row.last_refreshed_at as string | null) ?? null,
    lastError: (row.last_error as string | null) ?? null,
    fileCount: Number(row.file_count),
    sectionCount: Number(row.section_count),
    diagnosticCount: Number(row.diagnostic_count),
    warningCount: Number(row.warning_count),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function mapSource(row: Row): ProjectKnowledgeSourceRecord {
  return {
    id: String(row.id),
    rootId: String(row.root_id),
    relativePath: String(row.relative_path),
    fileName: String(row.file_name),
    fileSize: Number(row.file_size),
    modifiedTimeMs: Number(row.modified_time_ms),
    contentHash: (row.content_hash as string | null) ?? null,
    title: String(row.title),
    aliases: parseJsonArray(row.aliases_json),
    tags: parseJsonArray(row.tags_json),
    headingCount: Number(row.heading_count),
    skippedReason: (row.skipped_reason as string | null) ?? null,
    indexedAt: String(row.indexed_at),
    updatedAt: String(row.updated_at)
  };
}

function mapSection(row: Row): ProjectKnowledgeSectionRecord {
  return {
    id: String(row.id),
    rootId: String(row.root_id),
    sourceId: String(row.source_id),
    ordinal: Number(row.ordinal),
    heading: (row.heading as string | null) ?? null,
    headingDepth: Number(row.heading_depth),
    startLine: row.start_line === null ? null : Number(row.start_line),
    endLine: row.end_line === null ? null : Number(row.end_line),
    previewText: String(row.preview_text),
    indexedText: String(row.indexed_text),
    contentHash: String(row.content_hash),
    updatedAt: String(row.updated_at)
  };
}

function mapDiagnostic(row: Row): ProjectKnowledgeDiagnosticRecord {
  return {
    id: String(row.id),
    rootId: String(row.root_id),
    sourceId: (row.source_id as string | null) ?? null,
    relativePath: (row.relative_path as string | null) ?? null,
    severity: row.severity as ProjectKnowledgeDiagnosticSeverity,
    code: String(row.code),
    message: String(row.message),
    suggestedAction: (row.suggested_action as string | null) ?? null,
    createdAt: String(row.created_at)
  };
}

function mapRefresh(row: Row): ProjectKnowledgeRefreshRecord {
  return {
    id: String(row.id),
    rootId: String(row.root_id),
    status: String(row.status),
    startedAt: String(row.started_at),
    finishedAt: (row.finished_at as string | null) ?? null,
    durationMs: row.duration_ms === null ? null : Number(row.duration_ms),
    fileCount: Number(row.file_count),
    skippedFileCount: Number(row.skipped_file_count),
    sectionCount: Number(row.section_count),
    diagnosticCount: Number(row.diagnostic_count),
    warningCount: Number(row.warning_count),
    errorCount: Number(row.error_count),
    fts5Available: Number(row.fts5_available) === 1,
    errorMessage: (row.error_message as string | null) ?? null
  };
}

function parseJsonArray(value: unknown): string[] {
  if (typeof value !== 'string') {
    return [];
  }
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.map((item) => String(item)).filter(Boolean)
      : [];
  } catch {
    return [];
  }
}

function createStableId(...parts: string[]) {
  return createHash('sha256').update(parts.join('\0')).digest('hex').slice(0, 32);
}

function createStableHash(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function normalizeRootPath(rootPath: string) {
  return rootPath.trim().replace(/\\/gu, '/').toLowerCase();
}
