import { existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { app } from 'electron';
import { AgentRuntimeService } from './services/agent-runtime';
import { createAgentRuntimeProjectKnowledgeBridge } from './services/agent-runtime-project-knowledge';
import { createAgentRuntimeVicodeCreatorBridge } from './services/agent-runtime-vicode-creators';
import { AppUpdaterService } from './services/app-updater';
import { AutonomousTaskService } from './services/autonomous-tasks';
import { ElectronBrowserPreviewService } from './services/browser-preview';
import { AutomationScheduler } from './services/automation-scheduler';
import { CollaborationService } from './services/collab';
import { ComposerTextAttachmentService } from './services/composer-text-attachments';
import { DiagnosticsService } from './services/diagnostics';
import { GeneratedMemoryService } from './services/generated-memory';
import { HeartbeatService } from './services/heartbeat';
import { JobsService } from './services/jobs';
import { LibraryWatchService } from './services/library-watch-service';
import { WorkspaceMemoryService } from './services/memory';
import { MemoryWritesService } from './services/memory-writes';
import { McpRegistryService } from './services/mcp/registry';
import { OllamaRuntimeService } from './services/ollama-runtime';
import { ProjectKnowledgeIndexService } from './services/project-knowledge-index';
import { ProviderManager } from './services/provider-manager';
import { ProjectKnowledgeService } from './services/project-knowledge';
import { SkillCatalogService } from './services/skills';
import { AutonomyInboxService } from './services/autonomy-inbox';
import { HarnessWorktreeSessionService } from './services/harness-worktree-session';
import { NativeWebResearchService } from './services/web-research';
import { VoiceService } from './services/voice';
import { SubagentOrchestratorService } from './services/subagents';
import { readOllamaLaunchDiagnostics } from './ollama-launch-profile';
import { DatabaseService } from '../storage/database';
import { COLLABORATION_ENABLED } from '../shared/product-flags';
import { LocalOllamaRuntime } from '../providers/ollama/runtime';

export interface AppServices {
  db: DatabaseService;
  updater: AppUpdaterService;
  providers: ProviderManager;
  ollamaRuntime: OllamaRuntimeService;
  skills: SkillCatalogService;
  libraryWatch: LibraryWatchService;
  automations: AutomationScheduler;
  diagnostics: DiagnosticsService;
  mcp: McpRegistryService;
  jobs: JobsService;
  autonomousTasks: AutonomousTaskService;
  subagents: SubagentOrchestratorService;
  voice: VoiceService;
  collab: CollaborationService | null;
  composerTextAttachments: ComposerTextAttachmentService;
  heartbeat: HeartbeatService | null;
}

export type DeferredStartupScope = 'updater' | 'providers' | 'mcp' | 'collab' | 'automations' | 'heartbeat' | 'libraryWatch';
export type DeferredStartupErrorReporter = (scope: DeferredStartupScope, error: unknown) => void;
export type DeferredStartupTimingReporter = (scope: DeferredStartupScope, durationMs: number) => void;

export function createOllamaRuntimeServiceFromEnvironment() {
  const ollamaRuntimeBaseUrl = process.env.VICODE_OLLAMA_BASE_URL?.trim();
  return new OllamaRuntimeService(
    ollamaRuntimeBaseUrl ? new LocalOllamaRuntime(ollamaRuntimeBaseUrl) : undefined
  );
}

function isReadableDirectory(path: string | null): path is string {
  if (!path) {
    return false;
  }
  try {
    return existsSync(path) && statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function refreshProjectKnowledgeIndexFromPreferences(db: DatabaseService) {
  const preferences = db.getPreferences();
  const rootPath = preferences.llmWikiLibraryPath ? resolve(preferences.llmWikiLibraryPath) : null;
  if (!isReadableDirectory(rootPath)) {
    return null;
  }

  const service = new ProjectKnowledgeIndexService({
    isFts5Available: () => db.isProjectKnowledgeFts5Available(),
    replaceRootIndex: (input) => db.replaceProjectKnowledgeRootIndex(input)
  });
  service.refreshIndex({ rootPath });
  return null;
}

export function createAppServices(input: {
  stateDir: string;
  heartbeatAutonomyEnabled: boolean;
}): AppServices {
  const db = new DatabaseService(join(input.stateDir, 'vicode.sqlite'));
  db.migrate();
  db.recoverInterruptedThreads();

  const updater = new AppUpdaterService(undefined, {
    logPath: join(input.stateDir, 'updater.log')
  });
  const ollamaRuntime = createOllamaRuntimeServiceFromEnvironment();
  const mcp = new McpRegistryService(db, { name: 'vicode', version: app.getVersion() }, {
    appRoot: app.getAppPath(),
    statePath: input.stateDir
  });
  const webResearch = new NativeWebResearchService({
    searchBaseUrl: process.env.VICODE_WEB_SEARCH_BASE_URL
  });
  const exportsDir = join(input.stateDir, 'exports');
  const browserPreview = new ElectronBrowserPreviewService(exportsDir);
  const projectKnowledgeService = new ProjectKnowledgeService({ indexReader: db });
  const agentRuntime = new AgentRuntimeService(
    mcp,
    webResearch,
    browserPreview,
    createAgentRuntimeProjectKnowledgeBridge(db, projectKnowledgeService)
  );
  const harnessWorktreeSessions = new HarnessWorktreeSessionService({
    appWorktreeRoot: join(input.stateDir, 'worktrees')
  });
  const providers = new ProviderManager(
    db,
    undefined,
    undefined,
    ollamaRuntime,
    agentRuntime,
    undefined,
    harnessWorktreeSessions
  );
  const memory = new WorkspaceMemoryService(db);
  const memoryWrites = new MemoryWritesService(db, memory);
  const generatedMemory = new GeneratedMemoryService(db, join(input.stateDir, 'generated-memory'));
  const jobs = new JobsService(db, providers, memoryWrites, generatedMemory);
  const heartbeat = input.heartbeatAutonomyEnabled ? new HeartbeatService(db, new AutonomyInboxService(db), jobs) : null;
  const skills = new SkillCatalogService(db, input.stateDir);
  skills.refreshSkillsFromDisk();
  const libraryWatch = new LibraryWatchService({
    statePath: input.stateDir,
    getPreferences: () => db.getPreferences(),
    refreshSkillsFromDisk: () => skills.refreshSkillsFromDisk(),
    refreshProjectKnowledgeIndex: () => refreshProjectKnowledgeIndexFromPreferences(db)
  });
  const automations = new AutomationScheduler(db, jobs);
  const collab = COLLABORATION_ENABLED ? new CollaborationService(db) : null;
  const diagnostics = new DiagnosticsService(
    db,
    exportsDir,
    () => ({
      bootstrap: db.getCollabBootstrap(),
      roomSessions: db.listCollabRoomSessions(),
      ...(collab?.getDiagnosticsSnapshot() ?? {})
    }),
    () => ({
      bootstrapDiagnostics: db.getBootstrapDiagnostics(),
      skillCatalogDiagnostics: skills.getListDiagnostics()
    }),
    () => readOllamaLaunchDiagnostics(input.stateDir)
  );
  const voice = new VoiceService();
  const subagents = new SubagentOrchestratorService(db, providers);
  agentRuntime.setSubagents(subagents);
  agentRuntime.setCreators(
    createAgentRuntimeVicodeCreatorBridge({
      statePath: input.stateDir,
      skills,
      mcp
    })
  );
  const autonomousTasks = new AutonomousTaskService(db, jobs, subagents);
  const composerTextAttachments = new ComposerTextAttachmentService();

  providers.onEvent((event) => {
    subagents.handleProviderEvent(event);
  });

  return {
    db,
    updater,
    providers,
    ollamaRuntime,
    skills,
    libraryWatch,
    automations,
    diagnostics,
    mcp,
    jobs,
    autonomousTasks,
    subagents,
    voice,
    collab,
    composerTextAttachments,
    heartbeat
  };
}

function reportDeferredStartupError(
  scope: DeferredStartupScope,
  error: unknown,
  reportError?: DeferredStartupErrorReporter
) {
  if (reportError) {
    reportError(scope, error);
    return;
  }

  console.error(`[${scope}] Deferred startup failed`, error);
}

async function runDeferredStartupStep(
  scope: DeferredStartupScope,
  task: () => Promise<void> | void,
  options: { reportError?: DeferredStartupErrorReporter; reportTiming?: DeferredStartupTimingReporter }
) {
  const startedAt = Date.now();
  try {
    await task();
    options.reportTiming?.(scope, Date.now() - startedAt);
  } catch (error) {
    reportDeferredStartupError(scope, error, options.reportError);
  }
}

export function startDeferredAppServices(
  services: Pick<AppServices, 'updater' | 'providers' | 'mcp' | 'collab' | 'automations' | 'heartbeat' | 'libraryWatch'>,
  options: { reportError?: DeferredStartupErrorReporter; reportTiming?: DeferredStartupTimingReporter } = {}
) {
  const collabDeferredDisabled = !COLLABORATION_ENABLED || process.env.VICODE_DISABLE_DEFERRED_COLLAB === '1';
  void runDeferredStartupStep('updater', () => services.updater.initialize(), options);
  void runDeferredStartupStep('providers', () => services.providers.resumeQueuedFollowUps(), options);

  void runDeferredStartupStep('mcp', () => services.mcp.initialize(), options);

  const unsubscribeProviderRelay =
    COLLABORATION_ENABLED && services.collab
      ? services.providers.onEvent((event) => {
          void services.collab?.handleAppEvent(event);
        })
      : () => {
          return undefined;
        };

  if (!collabDeferredDisabled && services.collab) {
    void runDeferredStartupStep('collab', () => services.collab?.initialize(), options);
  }
  void runDeferredStartupStep('automations', () => services.automations.refresh(), options);
  void runDeferredStartupStep('libraryWatch', () => services.libraryWatch.start(), options);
  if (services.heartbeat) {
    void runDeferredStartupStep('heartbeat', () => services.heartbeat?.refresh(), options);
  }

  return () => {
    unsubscribeProviderRelay();
    services.libraryWatch.stop();
  };
}
