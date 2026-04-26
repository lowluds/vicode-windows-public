import { join } from 'node:path';
import { app } from 'electron';
import { AgentRuntimeService } from './services/agent-runtime';
import { createAgentRuntimeVicodeCreatorBridge } from './services/agent-runtime-vicode-creators';
import { AppUpdaterService } from './services/app-updater';
import { AutonomousTaskService } from './services/autonomous-tasks';
import { AutomationScheduler } from './services/automation-scheduler';
import { CollaborationService } from './services/collab';
import { ComposerTextAttachmentService } from './services/composer-text-attachments';
import { DiagnosticsService } from './services/diagnostics';
import { GeneratedMemoryService } from './services/generated-memory';
import { HeartbeatService } from './services/heartbeat';
import { JobsService } from './services/jobs';
import { WorkspaceMemoryService } from './services/memory';
import { MemoryWritesService } from './services/memory-writes';
import { McpRegistryService } from './services/mcp/registry';
import { OllamaRuntimeService } from './services/ollama-runtime';
import { ProviderManager } from './services/provider-manager';
import { SkillCatalogService } from './services/skills';
import { AutonomyInboxService } from './services/autonomy-inbox';
import { NativeWebResearchService } from './services/web-research';
import { VicodeBuildControlService } from './services/vicode-build-control';
import { VoiceService } from './services/voice';
import { WorkspaceBootstrapService } from './services/workspace-bootstrap';
import { SubagentOrchestratorService } from './services/subagents';
import { DatabaseService } from '../storage/database';
import { COLLABORATION_ENABLED } from '../shared/product-flags';

export interface AppServices {
  db: DatabaseService;
  updater: AppUpdaterService;
  providers: ProviderManager;
  ollamaRuntime: OllamaRuntimeService;
  skills: SkillCatalogService;
  automations: AutomationScheduler;
  vicodeBuild: VicodeBuildControlService;
  diagnostics: DiagnosticsService;
  mcp: McpRegistryService;
  jobs: JobsService;
  autonomousTasks: AutonomousTaskService;
  subagents: SubagentOrchestratorService;
  workspaceBootstrap: WorkspaceBootstrapService;
  voice: VoiceService;
  collab: CollaborationService | null;
  composerTextAttachments: ComposerTextAttachmentService;
  heartbeat: HeartbeatService | null;
}

export type DeferredStartupScope = 'updater' | 'providers' | 'mcp' | 'collab' | 'automations' | 'heartbeat';
export type DeferredStartupErrorReporter = (scope: DeferredStartupScope, error: unknown) => void;
export type DeferredStartupTimingReporter = (scope: DeferredStartupScope, durationMs: number) => void;

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
  const ollamaRuntime = new OllamaRuntimeService();
  const mcp = new McpRegistryService(db, { name: 'vicode', version: app.getVersion() }, {
    appRoot: app.getAppPath(),
    statePath: input.stateDir
  });
  const webResearch = new NativeWebResearchService();
  const agentRuntime = new AgentRuntimeService(mcp, webResearch);
  const providers = new ProviderManager(db, undefined, undefined, ollamaRuntime, agentRuntime);
  const memory = new WorkspaceMemoryService(db);
  const memoryWrites = new MemoryWritesService(db, memory);
  const generatedMemory = new GeneratedMemoryService(db, join(input.stateDir, 'generated-memory'));
  const jobs = new JobsService(db, providers, memoryWrites, generatedMemory);
  const heartbeat = input.heartbeatAutonomyEnabled ? new HeartbeatService(db, new AutonomyInboxService(db), jobs) : null;
  const workspaceBootstrap = new WorkspaceBootstrapService(undefined, undefined, {
    isDismissed: (projectId) => db.isWorkspaceBootstrapDismissed(projectId),
    dismiss: (projectId) => db.dismissWorkspaceBootstrap(projectId),
    clearDismissal: (projectId) => db.clearWorkspaceBootstrapDismissal(projectId)
  });
  const skills = new SkillCatalogService(db, input.stateDir);
  skills.refreshSkillsFromDisk();
  const automations = new AutomationScheduler(db, jobs);
  const vicodeBuild = new VicodeBuildControlService(db, providers);
  const exportsDir = join(input.stateDir, 'exports');
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
    })
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
  const autonomousTasks = new AutonomousTaskService(db, jobs, vicodeBuild, subagents);
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
    automations,
    vicodeBuild,
    diagnostics,
    mcp,
    jobs,
    autonomousTasks,
    subagents,
    workspaceBootstrap,
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
  services: Pick<AppServices, 'updater' | 'providers' | 'mcp' | 'collab' | 'automations' | 'heartbeat'>,
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
  if (services.heartbeat) {
    void runDeferredStartupStep('heartbeat', () => services.heartbeat?.refresh(), options);
  }

  return () => {
    unsubscribeProviderRelay();
  };
}
