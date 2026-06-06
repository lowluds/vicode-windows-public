import type { DatabaseService } from '../../storage/database';
import type { AgentRuntimeProjectKnowledgeBridge } from './agent-runtime';
import {
  listProjectKnowledgeSources,
  ProjectKnowledgeService,
  readProjectKnowledgeSection
} from './project-knowledge';

export function createAgentRuntimeProjectKnowledgeBridge(
  db: DatabaseService,
  service = new ProjectKnowledgeService()
): AgentRuntimeProjectKnowledgeBridge {
  const resolveRootPath = () => db.getPreferences().llmWikiLibraryPath?.trim() ?? '';

  return {
    isConfigured: () => Boolean(resolveRootPath()),
    search: (query, maxResults) =>
      service.retrieveRelevantKnowledge({
        rootPath: resolveRootPath(),
        query,
        maxResults
      }),
    read: (path, heading) => readProjectKnowledgeSection(resolveRootPath(), path, heading),
    list: (maxResults) => listProjectKnowledgeSources(resolveRootPath(), maxResults)
  };
}
