import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { DatabaseService } from '../../storage/database';

export type WorkspaceMemoryKind = 'memory' | 'daily_note';

export interface WorkspaceMemoryContextBlock {
  kind: WorkspaceMemoryKind;
  label: string;
  fileName: string;
  path: string;
  content: string;
  score: number;
}

export interface RetrieveRelevantMemoryInput {
  projectId: string;
  folderPath: string | null;
  trusted: boolean;
  query: string;
  maxResults?: number;
}

interface CanonicalMemoryFile {
  kind: WorkspaceMemoryKind;
  fileName: string;
  path: string;
  content: string;
  sourceUpdatedAt: string;
}

interface IndexedChunk {
  heading: string | null;
  content: string;
}

function sanitizeDailyNoteContentForIndexing(content: string) {
  return content
    .split(/\r?\n/u)
    .filter((line) => {
      const trimmed = line.trim();
      if (!trimmed) {
        return true;
      }
      if (/^- Latest assistant update:/iu.test(trimmed)) {
        return false;
      }
      if (/^assistant:\s/iu.test(trimmed)) {
        return false;
      }
      return true;
    })
    .join('\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trim();
}

function normalizeQueryTerms(query: string) {
  return [...new Set(query.toLowerCase().match(/[a-z0-9]{3,}/g) ?? [])];
}

function parseMemoryChunks(content: string): IndexedChunk[] {
  return content
    .split(/\r?\n\s*\r?\n/u)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const lines = block.split(/\r?\n/u).map((line) => line.trim());
      const firstLine = lines[0] ?? '';
      const heading = firstLine.startsWith('#') ? firstLine.replace(/^#+\s*/u, '').trim() || null : null;
      const body = heading ? lines.slice(1).join('\n').trim() : block;
      return {
        heading,
        content: body || block
      };
    })
    .filter((chunk) => chunk.content.trim().length > 0);
}

function scoreChunk(queryTerms: string[], value: string) {
  if (queryTerms.length === 0) {
    return 0;
  }

  const haystack = value.toLowerCase();
  let score = 0;
  for (const term of queryTerms) {
    if (haystack.includes(term)) {
      score += 1;
    }
  }
  return score;
}

function dailyNoteTimestamp(fileName: string) {
  const isoDate = fileName.replace(/\.md$/u, '');
  return `${isoDate}T00:00:00.000Z`;
}

export class WorkspaceMemoryService {
  constructor(private readonly db: DatabaseService) {}

  refreshWorkspaceMemory(projectId: string, folderPath: string | null, trusted: boolean) {
    if (!trusted || !folderPath) {
      return;
    }
    this.indexWorkspaceMemory(projectId, folderPath);
  }

  retrieveRelevantMemory(input: RetrieveRelevantMemoryInput): WorkspaceMemoryContextBlock[] {
    if (!input.trusted || !input.folderPath || !input.query.trim()) {
      return [];
    }

    const queryTerms = normalizeQueryTerms(input.query);
    if (queryTerms.length === 0) {
      return [];
    }

    this.indexWorkspaceMemory(input.projectId, input.folderPath);

    const ranked = this.db
      .listWorkspaceMemoryChunks(input.projectId)
      .map((chunk) => {
        const combined = [chunk.heading, chunk.content].filter(Boolean).join('\n');
        return {
          ...chunk,
          score: scoreChunk(queryTerms, combined)
        };
      })
      .filter((chunk) => chunk.score > 0)
      .sort((left, right) => {
        if (right.score !== left.score) {
          return right.score - left.score;
        }
        return right.updatedAt.localeCompare(left.updatedAt);
      })
      .slice(0, input.maxResults ?? 4);

    return ranked.map((chunk) => ({
      kind: chunk.kind,
      label: chunk.kind === 'memory' ? 'Workspace MEMORY.md' : `Workspace daily note (${chunk.fileName})`,
      fileName: chunk.fileName,
      path: chunk.path,
      content: chunk.heading ? `## ${chunk.heading}\n${chunk.content}` : chunk.content,
      score: chunk.score
    }));
  }

  private indexWorkspaceMemory(projectId: string, folderPath: string) {
    const files = this.discoverCanonicalFiles(folderPath);
    this.db.deleteWorkspaceMemoryFilesNotInPaths(
      projectId,
      ['memory', 'daily_note'],
      files.map((file) => file.path)
    );

    for (const file of files) {
      const checksum = createHash('sha1').update(file.content).digest('hex');
      const existing =
        typeof (this.db as DatabaseService & {
          getWorkspaceMemoryFile?: (projectId: string, path: string) => {
            id: string;
            checksum: string | null;
            lastIndexedAt: string | null;
            updatedAt: string;
          } | null;
        }).getWorkspaceMemoryFile === 'function'
          ? (this.db as DatabaseService & {
              getWorkspaceMemoryFile: (projectId: string, path: string) => {
                id: string;
                checksum: string | null;
                lastIndexedAt: string | null;
                updatedAt: string;
              } | null;
            }).getWorkspaceMemoryFile(projectId, file.path)
          : null;

      if (
        existing &&
        existing.checksum === checksum &&
        existing.updatedAt === file.sourceUpdatedAt
      ) {
        continue;
      }

      const memoryFileId = this.db.upsertWorkspaceMemoryFile({
        projectId,
        kind: file.kind,
        path: file.path,
        fileName: file.fileName,
        checksum,
        lastIndexedAt: new Date().toISOString(),
        updatedAt: file.sourceUpdatedAt
      });
      const chunks = parseMemoryChunks(file.content);
      this.db.replaceWorkspaceMemoryChunks(
        memoryFileId,
        projectId,
        chunks.map((chunk, index) => ({
          ordinal: index,
          heading: chunk.heading,
          content: chunk.content,
          updatedAt: file.sourceUpdatedAt
        }))
      );
    }
  }

  private discoverCanonicalFiles(folderPath: string): CanonicalMemoryFile[] {
    const files: CanonicalMemoryFile[] = [];
    const memoryPath = join(folderPath, 'MEMORY.md');
    if (existsSync(memoryPath)) {
      const content = readFileSync(memoryPath, 'utf8').trim();
      if (content) {
        files.push({
          kind: 'memory',
          fileName: 'MEMORY.md',
          path: memoryPath,
          content,
          sourceUpdatedAt: statSync(memoryPath).mtime.toISOString()
        });
      }
    }

    const dailyNotesDir = join(folderPath, 'memory');
    if (!existsSync(dailyNotesDir)) {
      return files;
    }

    const noteFiles = readdirSync(dailyNotesDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && /^\d{4}-\d{2}-\d{2}\.md$/u.test(entry.name))
      .map((entry) => entry.name)
      .sort((left, right) => right.localeCompare(left));

    for (const fileName of noteFiles) {
      const path = join(dailyNotesDir, fileName);
      const content = sanitizeDailyNoteContentForIndexing(readFileSync(path, 'utf8').trim());
      if (!content) {
        continue;
      }
      files.push({
        kind: 'daily_note',
        fileName: basename(path),
        path,
        content,
        sourceUpdatedAt: dailyNoteTimestamp(fileName)
      });
    }

    return files;
  }
}
