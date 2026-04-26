import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';

export class WorkspaceMemoryRepository {
  constructor(private readonly db: Database.Database) {}

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

  getWorkspaceMemoryFile(projectId: string, path: string) {
    const row = this.db
      .prepare(
        `SELECT id, checksum, last_indexed_at AS lastIndexedAt, updated_at AS updatedAt
         FROM workspace_memory_files
         WHERE project_id = ? AND path = ?`
      )
      .get(projectId, path) as
      | {
          id: string;
          checksum: string | null;
          lastIndexedAt: string | null;
          updatedAt: string;
        }
      | undefined;

    return row ?? null;
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
        WHERE files.project_id = ?
        ORDER BY files.updated_at DESC, files.file_name ASC, chunks.ordinal ASC`
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
}
