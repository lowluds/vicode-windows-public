import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceMemoryService } from './memory';

describe('WorkspaceMemoryService', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    while (tempDirs.length > 0) {
      const current = tempDirs.pop();
      if (current) {
        rmSync(current, { recursive: true, force: true });
      }
    }
  });

  function createTempDir(prefix: string) {
    const dir = mkdtempSync(join(tmpdir(), prefix));
    tempDirs.push(dir);
    return dir;
  }

  function createWorkspace(files: Record<string, string>) {
    const dir = createTempDir('vicode-memory-workspace-');
    for (const [fileName, content] of Object.entries(files)) {
      const target = join(dir, fileName);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, content, 'utf8');
    }
    return dir;
  }

  it('indexes MEMORY.md and daily notes, then retrieves relevant chunks', () => {
    const workspace = createWorkspace({
      'MEMORY.md': '# Stack\nThe app uses React, Vite, and TypeScript.',
      'memory/2026-03-17.md': 'Discussed MCP integration and memory retrieval.'
    });
    const chunksStore: Array<{
      id: string;
      kind: 'memory' | 'daily_note';
      path: string;
      fileName: string;
      heading: string | null;
      content: string;
      updatedAt: string;
    }> = [];
    const fileMap = new Map<string, { id: string; kind: 'memory' | 'daily_note'; path: string; fileName: string }>();
    const db = {
      deleteWorkspaceMemoryFilesNotInPaths: vi.fn((_projectId: string, _kinds: Array<'memory' | 'daily_note'>, paths: string[]) => {
        for (const key of [...fileMap.keys()]) {
          if (!paths.includes(key)) {
            fileMap.delete(key);
          }
        }
      }),
      upsertWorkspaceMemoryFile: vi.fn((input: {
        projectId: string;
        kind: 'memory' | 'daily_note';
        path: string;
        fileName: string;
      }) => {
        const existing = fileMap.get(input.path);
        if (existing) {
          fileMap.set(input.path, { ...existing, kind: input.kind, fileName: input.fileName });
          return existing.id;
        }
        const id = `memory-file-${fileMap.size + 1}`;
        fileMap.set(input.path, { id, kind: input.kind, path: input.path, fileName: input.fileName });
        return id;
      }),
      replaceWorkspaceMemoryChunks: vi.fn(
        (memoryFileId: string, _projectId: string, chunks: Array<{ ordinal: number; heading: string | null; content: string; updatedAt: string }>) => {
          for (let index = chunksStore.length - 1; index >= 0; index -= 1) {
            if (chunksStore[index]?.id.startsWith(`${memoryFileId}:`)) {
              chunksStore.splice(index, 1);
            }
          }
          const file = [...fileMap.values()].find((value) => value.id === memoryFileId);
          if (!file) {
            return;
          }
          for (const chunk of chunks) {
            chunksStore.push({
              id: `${memoryFileId}:${chunk.ordinal}`,
              kind: file.kind,
              path: file.path,
              fileName: file.fileName,
              heading: chunk.heading,
              content: chunk.content,
              updatedAt: chunk.updatedAt
            });
          }
        }
      ),
      listWorkspaceMemoryChunks: vi.fn(() => chunksStore)
    };
    const service = new WorkspaceMemoryService(db as never);

    const results = service.retrieveRelevantMemory({
      projectId: 'project-1',
      folderPath: workspace,
      trusted: true,
      query: 'What stack does the app use?'
    });

    expect(results.length).toBeGreaterThan(0);
    expect(results[0]?.fileName).toBe('MEMORY.md');
    expect(results[0]?.content).toContain('React, Vite, and TypeScript');
  });

  it('does not recall assistant excerpt lines from daily notes', () => {
    const workspace = createWorkspace({
      'memory/2026-03-17.md': [
        '# Daily Memory Log',
        '',
        '## Session: 2026-03-17 09:00:00 UTC',
        '',
        '- Thread: Example thread',
        '- Latest user request: explain dota history',
        '- Latest assistant update: D ota 2 orig inated from Dot A and rebal ancing changes.'
      ].join('\n')
    });
    const chunksStore: Array<{
      id: string;
      kind: 'memory' | 'daily_note';
      path: string;
      fileName: string;
      heading: string | null;
      content: string;
      updatedAt: string;
    }> = [];
    const fileMap = new Map<string, { id: string; kind: 'memory' | 'daily_note'; path: string; fileName: string }>();
    const db = {
      deleteWorkspaceMemoryFilesNotInPaths: vi.fn(),
      upsertWorkspaceMemoryFile: vi.fn((input: {
        projectId: string;
        kind: 'memory' | 'daily_note';
        path: string;
        fileName: string;
      }) => {
        const existing = fileMap.get(input.path);
        if (existing) {
          return existing.id;
        }
        const id = `memory-file-${fileMap.size + 1}`;
        fileMap.set(input.path, { id, kind: input.kind, path: input.path, fileName: input.fileName });
        return id;
      }),
      replaceWorkspaceMemoryChunks: vi.fn(
        (memoryFileId: string, _projectId: string, chunks: Array<{ ordinal: number; heading: string | null; content: string; updatedAt: string }>) => {
          for (let index = chunksStore.length - 1; index >= 0; index -= 1) {
            if (chunksStore[index]?.id.startsWith(`${memoryFileId}:`)) {
              chunksStore.splice(index, 1);
            }
          }
          const file = [...fileMap.values()].find((value) => value.id === memoryFileId);
          if (!file) {
            return;
          }
          for (const chunk of chunks) {
            chunksStore.push({
              id: `${memoryFileId}:${chunk.ordinal}`,
              kind: file.kind,
              path: file.path,
              fileName: file.fileName,
              heading: chunk.heading,
              content: chunk.content,
              updatedAt: chunk.updatedAt
            });
          }
        }
      ),
      listWorkspaceMemoryChunks: vi.fn(() => chunksStore)
    };
    const service = new WorkspaceMemoryService(db as never);

    const results = service.retrieveRelevantMemory({
      projectId: 'project-1',
      folderPath: workspace,
      trusted: true,
      query: 'explain dota history'
    });

    expect(results).toHaveLength(1);
    expect(results[0]?.content).toContain('Latest user request: explain dota history');
    expect(results[0]?.content).not.toContain('Latest assistant update');
    expect(results[0]?.content).not.toContain('rebal ancing');
  });

  it('keeps older daily notes retrievable beyond the newest 14 files', () => {
    const files: Record<string, string> = {
      'MEMORY.md': '# Memory\nStable facts live here.'
    };

    for (let day = 1; day <= 16; day += 1) {
      const date = `2026-02-${String(day).padStart(2, '0')}`;
      files[`memory/${date}.md`] = day === 1 ? 'Legacy architecture decision for the billing pipeline.' : `Daily note ${day}.`;
    }

    const workspace = createWorkspace(files);
    const chunksStore: Array<{
      id: string;
      kind: 'memory' | 'daily_note';
      path: string;
      fileName: string;
      heading: string | null;
      content: string;
      updatedAt: string;
    }> = [];
    const fileMap = new Map<string, { id: string; kind: 'memory' | 'daily_note'; path: string; fileName: string }>();
    const db = {
      deleteWorkspaceMemoryFilesNotInPaths: vi.fn(),
      upsertWorkspaceMemoryFile: vi.fn((input: {
        projectId: string;
        kind: 'memory' | 'daily_note';
        path: string;
        fileName: string;
      }) => {
        const existing = fileMap.get(input.path);
        if (existing) {
          return existing.id;
        }
        const id = `memory-file-${fileMap.size + 1}`;
        fileMap.set(input.path, { id, kind: input.kind, path: input.path, fileName: input.fileName });
        return id;
      }),
      replaceWorkspaceMemoryChunks: vi.fn(
        (memoryFileId: string, _projectId: string, chunks: Array<{ ordinal: number; heading: string | null; content: string; updatedAt: string }>) => {
          for (let index = chunksStore.length - 1; index >= 0; index -= 1) {
            if (chunksStore[index]?.id.startsWith(`${memoryFileId}:`)) {
              chunksStore.splice(index, 1);
            }
          }
          const file = [...fileMap.values()].find((value) => value.id === memoryFileId);
          if (!file) {
            return;
          }
          for (const chunk of chunks) {
            chunksStore.push({
              id: `${memoryFileId}:${chunk.ordinal}`,
              kind: file.kind,
              path: file.path,
              fileName: file.fileName,
              heading: chunk.heading,
              content: chunk.content,
              updatedAt: chunk.updatedAt
            });
          }
        }
      ),
      listWorkspaceMemoryChunks: vi.fn(() => chunksStore)
    };
    const service = new WorkspaceMemoryService(db as never);

    const results = service.retrieveRelevantMemory({
      projectId: 'project-1',
      folderPath: workspace,
      trusted: true,
      query: 'What was the legacy billing pipeline decision?'
    });

    expect(results.some((result) => result.fileName === '2026-02-01.md')).toBe(true);
  });

  it('stores daily note recency from the note date instead of index time', () => {
    const workspace = createWorkspace({
      'memory/2026-03-16.md': 'Yesterday note.',
      'memory/2026-03-17.md': 'Today note.'
    });
    const upsertWorkspaceMemoryFile = vi.fn(() => 'memory-file-1');
    const replaceWorkspaceMemoryChunks = vi.fn();
    const db = {
      deleteWorkspaceMemoryFilesNotInPaths: vi.fn(),
      upsertWorkspaceMemoryFile,
      replaceWorkspaceMemoryChunks,
      listWorkspaceMemoryChunks: vi.fn(() => [])
    };
    const service = new WorkspaceMemoryService(db as never);

    service.retrieveRelevantMemory({
      projectId: 'project-1',
      folderPath: workspace,
      trusted: true,
      query: 'Today note'
    });

    expect(upsertWorkspaceMemoryFile).toHaveBeenCalledWith(
      expect.objectContaining({
        fileName: '2026-03-17.md',
        updatedAt: '2026-03-17T00:00:00.000Z'
      })
    );
    expect(replaceWorkspaceMemoryChunks).toHaveBeenCalledWith(
      'memory-file-1',
      'project-1',
      expect.arrayContaining([
        expect.objectContaining({
          updatedAt: '2026-03-17T00:00:00.000Z'
        })
      ])
    );
  });

  it('refreshes canonical files on repeated retrieval so updated daily-note indexing rules take effect', () => {
    const workspace = createWorkspace({
      'MEMORY.md': '# Stack\nThe app uses React, Vite, and TypeScript.'
    });
    const chunksStore: Array<{
      id: string;
      kind: 'memory' | 'daily_note';
      path: string;
      fileName: string;
      heading: string | null;
      content: string;
      updatedAt: string;
    }> = [];
    const fileMap = new Map<string, { id: string; kind: 'memory' | 'daily_note'; path: string; fileName: string }>();
    const db = {
      deleteWorkspaceMemoryFilesNotInPaths: vi.fn(),
      upsertWorkspaceMemoryFile: vi.fn((input: {
        projectId: string;
        kind: 'memory' | 'daily_note';
        path: string;
        fileName: string;
      }) => {
        const existing = fileMap.get(input.path);
        if (existing) {
          return existing.id;
        }
        const id = `memory-file-${fileMap.size + 1}`;
        fileMap.set(input.path, { id, kind: input.kind, path: input.path, fileName: input.fileName });
        return id;
      }),
      replaceWorkspaceMemoryChunks: vi.fn(
        (memoryFileId: string, _projectId: string, chunks: Array<{ ordinal: number; heading: string | null; content: string; updatedAt: string }>) => {
          for (let index = chunksStore.length - 1; index >= 0; index -= 1) {
            if (chunksStore[index]?.id.startsWith(`${memoryFileId}:`)) {
              chunksStore.splice(index, 1);
            }
          }
          const file = [...fileMap.values()].find((value) => value.id === memoryFileId);
          if (!file) {
            return;
          }
          for (const chunk of chunks) {
            chunksStore.push({
              id: `${memoryFileId}:${chunk.ordinal}`,
              kind: file.kind,
              path: file.path,
              fileName: file.fileName,
              heading: chunk.heading,
              content: chunk.content,
              updatedAt: chunk.updatedAt
            });
          }
        }
      ),
      listWorkspaceMemoryChunks: vi.fn(() => chunksStore)
    };
    const service = new WorkspaceMemoryService(db as never);

    service.retrieveRelevantMemory({
      projectId: 'project-1',
      folderPath: workspace,
      trusted: true,
      query: 'What stack does the app use?'
    });
    service.retrieveRelevantMemory({
      projectId: 'project-1',
      folderPath: workspace,
      trusted: true,
      query: 'Which stack is used here?'
    });

    expect(db.upsertWorkspaceMemoryFile).toHaveBeenCalledTimes(2);
    expect(db.replaceWorkspaceMemoryChunks).toHaveBeenCalledTimes(2);
  });

  it('drops deleted MEMORY.md content after an explicit workspace refresh', () => {
    const workspace = createWorkspace({
      'MEMORY.md': '# Stack\nThe app uses React, Vite, and TypeScript.',
      'memory/2026-03-17.md': 'Billing notes stay in the daily note.'
    });
    const chunksStore: Array<{
      id: string;
      kind: 'memory' | 'daily_note';
      path: string;
      fileName: string;
      heading: string | null;
      content: string;
      updatedAt: string;
    }> = [];
    const fileMap = new Map<string, { id: string; kind: 'memory' | 'daily_note'; path: string; fileName: string }>();
    const db = {
      deleteWorkspaceMemoryFilesNotInPaths: vi.fn((_projectId: string, _kinds: Array<'memory' | 'daily_note'>, paths: string[]) => {
        for (const key of [...fileMap.keys()]) {
          if (!paths.includes(key)) {
            fileMap.delete(key);
            for (let index = chunksStore.length - 1; index >= 0; index -= 1) {
              if (chunksStore[index]?.path === key) {
                chunksStore.splice(index, 1);
              }
            }
          }
        }
      }),
      upsertWorkspaceMemoryFile: vi.fn((input: {
        projectId: string;
        kind: 'memory' | 'daily_note';
        path: string;
        fileName: string;
      }) => {
        const existing = fileMap.get(input.path);
        if (existing) {
          fileMap.set(input.path, { ...existing, kind: input.kind, fileName: input.fileName });
          return existing.id;
        }
        const id = `memory-file-${fileMap.size + 1}`;
        fileMap.set(input.path, { id, kind: input.kind, path: input.path, fileName: input.fileName });
        return id;
      }),
      replaceWorkspaceMemoryChunks: vi.fn(
        (memoryFileId: string, _projectId: string, chunks: Array<{ ordinal: number; heading: string | null; content: string; updatedAt: string }>) => {
          for (let index = chunksStore.length - 1; index >= 0; index -= 1) {
            if (chunksStore[index]?.id.startsWith(`${memoryFileId}:`)) {
              chunksStore.splice(index, 1);
            }
          }
          const file = [...fileMap.values()].find((value) => value.id === memoryFileId);
          if (!file) {
            return;
          }
          for (const chunk of chunks) {
            chunksStore.push({
              id: `${memoryFileId}:${chunk.ordinal}`,
              kind: file.kind,
              path: file.path,
              fileName: file.fileName,
              heading: chunk.heading,
              content: chunk.content,
              updatedAt: chunk.updatedAt
            });
          }
        }
      ),
      listWorkspaceMemoryChunks: vi.fn(() => chunksStore)
    };
    const service = new WorkspaceMemoryService(db as never);

    service.refreshWorkspaceMemory('project-1', workspace, true);
    rmSync(join(workspace, 'MEMORY.md'));
    service.refreshWorkspaceMemory('project-1', workspace, true);

    const results = service.retrieveRelevantMemory({
      projectId: 'project-1',
      folderPath: workspace,
      trusted: true,
      query: 'What stays in the daily note billing notes?'
    });

    expect(results.some((result) => result.fileName === 'MEMORY.md')).toBe(false);
    expect(results.some((result) => result.fileName === '2026-03-17.md')).toBe(true);
  });

  it('drops emptied daily notes after an explicit workspace refresh', () => {
    const workspace = createWorkspace({
      'MEMORY.md': '# Stack\nThe app uses React, Vite, and TypeScript.',
      'memory/2026-03-17.md': 'Billing notes stay in the daily note.'
    });
    const chunksStore: Array<{
      id: string;
      kind: 'memory' | 'daily_note';
      path: string;
      fileName: string;
      heading: string | null;
      content: string;
      updatedAt: string;
    }> = [];
    const fileMap = new Map<string, { id: string; kind: 'memory' | 'daily_note'; path: string; fileName: string }>();
    const db = {
      deleteWorkspaceMemoryFilesNotInPaths: vi.fn((_projectId: string, _kinds: Array<'memory' | 'daily_note'>, paths: string[]) => {
        for (const key of [...fileMap.keys()]) {
          if (!paths.includes(key)) {
            fileMap.delete(key);
            for (let index = chunksStore.length - 1; index >= 0; index -= 1) {
              if (chunksStore[index]?.path === key) {
                chunksStore.splice(index, 1);
              }
            }
          }
        }
      }),
      upsertWorkspaceMemoryFile: vi.fn((input: {
        projectId: string;
        kind: 'memory' | 'daily_note';
        path: string;
        fileName: string;
      }) => {
        const existing = fileMap.get(input.path);
        if (existing) {
          fileMap.set(input.path, { ...existing, kind: input.kind, fileName: input.fileName });
          return existing.id;
        }
        const id = `memory-file-${fileMap.size + 1}`;
        fileMap.set(input.path, { id, kind: input.kind, path: input.path, fileName: input.fileName });
        return id;
      }),
      replaceWorkspaceMemoryChunks: vi.fn(
        (memoryFileId: string, _projectId: string, chunks: Array<{ ordinal: number; heading: string | null; content: string; updatedAt: string }>) => {
          for (let index = chunksStore.length - 1; index >= 0; index -= 1) {
            if (chunksStore[index]?.id.startsWith(`${memoryFileId}:`)) {
              chunksStore.splice(index, 1);
            }
          }
          const file = [...fileMap.values()].find((value) => value.id === memoryFileId);
          if (!file) {
            return;
          }
          for (const chunk of chunks) {
            chunksStore.push({
              id: `${memoryFileId}:${chunk.ordinal}`,
              kind: file.kind,
              path: file.path,
              fileName: file.fileName,
              heading: chunk.heading,
              content: chunk.content,
              updatedAt: chunk.updatedAt
            });
          }
        }
      ),
      listWorkspaceMemoryChunks: vi.fn(() => chunksStore)
    };
    const service = new WorkspaceMemoryService(db as never);

    service.refreshWorkspaceMemory('project-1', workspace, true);
    writeFileSync(join(workspace, 'memory/2026-03-17.md'), '\n', 'utf8');
    service.refreshWorkspaceMemory('project-1', workspace, true);

    const results = service.retrieveRelevantMemory({
      projectId: 'project-1',
      folderPath: workspace,
      trusted: true,
      query: 'What stack does the app use?'
    });

    expect(results.some((result) => result.fileName === '2026-03-17.md')).toBe(false);
    expect(results.some((result) => result.fileName === 'MEMORY.md')).toBe(true);
  });
});
