import { basename, resolve } from 'node:path';
import type {
  ProjectKnowledgeIndexSnapshot,
  ProjectKnowledgeReplaceRootIndexInput
} from '../../storage/project-knowledge-index-repository';
import { scanProjectKnowledgeFolder } from './project-knowledge-scanner';

export interface ProjectKnowledgeIndexStore {
  isFts5Available(): boolean;
  replaceRootIndex(input: ProjectKnowledgeReplaceRootIndexInput): ProjectKnowledgeIndexSnapshot;
}

export class ProjectKnowledgeIndexService {
  constructor(
    private readonly repository: ProjectKnowledgeIndexStore,
    private readonly options: {
      nowIso?: () => string;
      nowMs?: () => number;
    } = {}
  ) {}

  refreshIndex(input: { rootPath: string }): ProjectKnowledgeIndexSnapshot {
    const trimmedRootPath = input.rootPath.trim();
    if (!trimmedRootPath) {
      throw new Error('Project Knowledge root path is required.');
    }
    const rootPath = resolve(trimmedRootPath);
    const nowIso = this.options.nowIso ?? (() => new Date().toISOString());
    const nowMs = this.options.nowMs ?? (() => Date.now());
    const startedAt = nowIso();
    const startedMs = nowMs();
    const scan = scanProjectKnowledgeFolder(rootPath);
    const finishedAt = nowIso();
    const durationMs = Math.max(0, Math.round(nowMs() - startedMs));

    return this.repository.replaceRootIndex({
      rootPath,
      displayName: basename(rootPath),
      startedAt,
      finishedAt,
      durationMs,
      fts5Available: this.repository.isFts5Available(),
      sources: scan.sources,
      sections: scan.sections,
      diagnostics: scan.diagnostics
    });
  }
}
