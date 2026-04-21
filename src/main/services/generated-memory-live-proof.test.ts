import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProviderAdapter } from '../../providers/types';
import { OpenAIAdapter } from '../../providers/openai/adapter';
import { getProviderFallbackModels } from '../../providers/catalog';
import type { ProviderDescriptor, ProviderId, ProviderModel, ThreadDetail } from '../../shared/domain';
import { DatabaseService } from '../../storage/database';
import { DiagnosticsService } from './diagnostics';
import { GeneratedMemoryService } from './generated-memory';
import { ProviderManager } from './provider-manager';

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (value: string) => Buffer.from(value, 'utf8'),
    decryptString: (value: Buffer) => value.toString('utf8')
  }
}));

type ScenarioId = 'workflow-command' | 'pitfall-avoidance' | 'architecture-owner';
type ScenarioVerdict = 'improved' | 'flat' | 'regressed';

interface PromptCapture {
  threadId: string;
  runId: string;
  prompt: string;
  sourcePrompt: string | null;
}

interface ScenarioModeResult {
  threadId: string;
  runId: string;
  answer: string;
  prompt: string;
  generatedMemoryUsed: boolean;
  generatedMemoryItems: Array<{
    itemId?: string;
    kind?: string;
    summary?: string;
    score?: number;
    rank?: number;
    kindGate?: string[];
    matchedTerms?: string[];
    sourceThreadIds?: string[];
  }>;
  firstSubstantiveAction: string | null;
  diagnosticsCopyPath: string;
}

interface ScenarioDefinition {
  id: ScenarioId;
  title: string;
  query: string;
  expectedAnswerFragments: string[];
  expectedPromptFragments: string[];
}

interface ScenarioResult {
  id: ScenarioId;
  title: string;
  query: string;
  verdict: ScenarioVerdict;
  notes: string[];
  baseline: ScenarioModeResult;
  experimental: ScenarioModeResult;
}

interface LiveProofResultBundle {
  executedAt: string;
  providerId: 'openai';
  modelId: string;
  workspacePath: string;
  scenarios: ScenarioResult[];
}

const BATCH_DIR = process.env.VICODE_GENERATED_MEMORY_BATCH_DIR?.trim() || null;
const SHOULD_RUN_LIVE = process.env.VICODE_RUN_GENERATED_MEMORY_LIVE_PROOF === '1';
const LIVE_TEST_TIMEOUT_MS = 1000 * 60 * 12;

const SCENARIOS: ScenarioDefinition[] = [
  {
    id: 'workflow-command',
    title: 'Workflow command recall',
    query:
      'You are about to validate this workspace after a change. Inspect the workspace if needed, then reply with the single first exact command you would run and one short reason.',
    expectedAnswerFragments: ['npm run smoke'],
    expectedPromptFragments: []
  },
  {
    id: 'pitfall-avoidance',
    title: 'Known pitfall recall',
    query:
      'Before validating this workspace, name the one specific trap to avoid here and the safer validation path. Inspect the workspace if needed, then answer in one short sentence.',
    expectedAnswerFragments: ['legacy nested smoke path'],
    expectedPromptFragments: ['legacy nested smoke path']
  },
  {
    id: 'architecture-owner',
    title: 'Architecture owner recall',
    query:
      'I need to patch prompt assembly in this workspace. Inspect the workspace if needed, then tell me the first file you would inspect and one short reason.',
    expectedAnswerFragments: ['src/main/services/provider-manager-prompt-builder.ts'],
    expectedPromptFragments: []
  }
];

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createProviderModel(id: string, label = id): ProviderModel {
  return { id, label, description: '' };
}

function createStubAdapter(overrides: Partial<ProviderAdapter> = {}): ProviderAdapter {
  const providerId = (overrides.id ?? 'gemini') as ProviderId;
  return {
    id: providerId,
    label: providerId === 'gemini' ? 'Gemini' : 'Provider',
    listStaticModels: () => getProviderFallbackModels(providerId),
    getPlannerCapability: () => ({
      supported: true,
      executionMode: 'read-only',
      enforcement: 'hard-enforced'
    }),
    discoverApiModels: async () => null,
    discoverRuntimeModels: async () => null,
    detectInstall: async () => ({ installed: true, cliPath: `${providerId}.cmd` }),
    getAuthState: async () => ({ authState: 'disconnected', authMode: null, message: 'Disconnected' }),
    startAuth: async () => {},
    clearAuth: async () => {},
    discoverNativeSkills: async () => [],
    validateProjectContext: () => ({ valid: true }),
    startRun: async () => ({
      runId: 'stub-run',
      cancel: async () => {}
    }),
    ...overrides
  };
}

function createCapturingOpenAIAdapter(captures: PromptCapture[]) {
  const adapter = new OpenAIAdapter();
  const capturing = Object.create(adapter) as ProviderAdapter;
  capturing.startRun = async (context, callbacks) => {
    captures.push({
      threadId: context.threadId,
      runId: context.runId,
      prompt: context.prompt,
      sourcePrompt: context.sourcePrompt ?? null
    });
    return await adapter.startRun(context, callbacks);
  };
  return capturing;
}

function selectOpenAILiveProofModel(models: ProviderModel[]) {
  const requestedId = process.env.VICODE_GENERATED_MEMORY_LIVE_MODEL?.trim();
  if (requestedId) {
    const requested = models.find((model) => model.id === requestedId);
    if (requested) {
      return requested;
    }
  }

  return (
    models.find((entry) => entry.id === 'gpt-5.4') ??
    models.find((entry) => entry.id === 'gpt-5.3-codex') ??
    models.find((entry) => /^gpt-5(\.|-|$)/iu.test(entry.id) && !/mini/iu.test(entry.id)) ??
    models[0] ??
    createProviderModel('gpt-5.4', 'gpt-5.4')
  );
}

function createWorkspace(root: string, files: Record<string, string>) {
  const dir = join(root, 'workspace');
  for (const [relativePath, content] of Object.entries(files)) {
    const filePath = join(dir, relativePath);
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, content, 'utf8');
  }
  return dir;
}

function collectRuntimeTrace(thread: ThreadDetail, runId: string) {
  return thread.rawOutput
    .filter(
      (event) =>
        event.runId === runId &&
        event.eventType === 'info' &&
        event.payload &&
        typeof event.payload === 'object' &&
        'runtimeTrace' in event.payload
    )
    .map(
      (event) =>
        (event.payload as { runtimeTrace: { stage: string; detail?: Record<string, unknown> | null } }).runtimeTrace
    );
}

async function waitForThreadCompletion(db: DatabaseService, threadId: string, timeoutMs = 1000 * 60 * 5) {
  const deadline = Date.now() + timeoutMs;
  let lastDetail: ThreadDetail | null = null;
  while (Date.now() < deadline) {
    const detail = db.getThread(threadId);
    lastDetail = detail;
    if (
      detail.status === 'completed' &&
      detail.turns.some((turn) => turn.role === 'assistant' && turn.content.trim().length > 0)
    ) {
      return detail;
    }
    if (detail.status === 'failed') {
      throw new Error(
        `Thread ${threadId} failed. Last events: ${JSON.stringify(detail.rawOutput.slice(-8))}`
      );
    }
    await sleep(1_000);
  }

  throw new Error(
    `Timed out waiting for thread ${threadId} to complete. Last status: ${lastDetail?.status ?? 'unknown'}. Last events: ${JSON.stringify(lastDetail?.rawOutput.slice(-5) ?? [])}`
  );
}

function getLastAssistantText(thread: ThreadDetail) {
  return (
    [...thread.turns]
      .reverse()
      .find((turn) => turn.role === 'assistant' && turn.content.trim().length > 0)
      ?.content.trim() ?? ''
  );
}

function getScenarioModeDir(mode: 'baseline' | 'experimental') {
  return mode === 'baseline'
    ? 'baseline-generated-memory-off'
    : 'experimental-generated-memory-on';
}

function sanitizeScenarioFileName(value: string) {
  return value.replace(/[^a-z0-9-]+/giu, '-').replace(/-+/gu, '-').replace(/^-|-$/gu, '');
}

function writeBatchArtifact(relativePath: string, content: string) {
  if (!BATCH_DIR) {
    return;
  }
  const filePath = join(BATCH_DIR, relativePath);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, content, 'utf8');
}

function writeSkipReason(reason: string) {
  if (!BATCH_DIR) {
    return;
  }
  writeBatchArtifact('skip-reason.txt', `${reason}\n`);
}

function writeFailureSnapshot(error: unknown, partialResults: Partial<LiveProofResultBundle> | null = null) {
  if (!BATCH_DIR) {
    return;
  }
  writeBatchArtifact(
    'failure-snapshot.json',
    `${JSON.stringify(
      {
        failedAt: new Date().toISOString(),
        message: error instanceof Error ? error.message : String(error),
        partialResults
      },
      null,
      2
    )}\n`
  );
}

function containsAllFragments(value: string, fragments: string[]) {
  const lower = value.toLowerCase();
  return fragments.every((fragment) => lower.includes(fragment.toLowerCase()));
}

function classifyVerdict(
  scenario: ScenarioDefinition,
  baseline: ScenarioModeResult,
  experimental: ScenarioModeResult
) {
  const baselineHasExpectedAnswer = containsAllFragments(baseline.answer, scenario.expectedAnswerFragments);
  const experimentalHasExpectedAnswer = containsAllFragments(
    experimental.answer,
    scenario.expectedAnswerFragments
  );

  if (experimentalHasExpectedAnswer && !baselineHasExpectedAnswer) {
    return 'improved' as const;
  }
  if (!experimentalHasExpectedAnswer && baselineHasExpectedAnswer) {
    return 'regressed' as const;
  }
  return 'flat' as const;
}

async function runScenario(input: {
  db: DatabaseService;
  manager: ProviderManager;
  diagnostics: DiagnosticsService;
  provider: ProviderDescriptor;
  projectId: string;
  modelId: string;
  captures: PromptCapture[];
  scenario: ScenarioDefinition;
  mode: 'baseline' | 'experimental';
}) {
  input.db.savePreferences({
    generatedMemoryUseEnabled: input.mode === 'experimental'
  });

  const thread = input.db.createThread({
    projectId: input.projectId,
    title: `${input.scenario.title} ${input.mode}`,
    providerId: 'openai',
    modelId: input.modelId,
    executionPermission: 'full_access'
  });

  const result = await input.manager.submitComposer({
    projectId: input.projectId,
    threadId: thread.id,
    prompt: input.scenario.query,
    providerId: 'openai',
    modelId: input.modelId,
    executionPermission: 'full_access',
    skillIds: []
  });

  expect(result.disposition).toBe('started');
  const completedThread = await waitForThreadCompletion(input.db, thread.id);
  const trace = collectRuntimeTrace(completedThread, result.runId);
  const promptAssembled = trace.find((mark) => mark.stage === 'prompt_assembled');
  const firstToolCall = trace.find((mark) => mark.stage === 'first_tool_call');
  const capture = [...input.captures]
    .reverse()
    .find((entry) => entry.runId === result.runId && entry.threadId === thread.id);

  expect(capture?.prompt?.trim().length ?? 0).toBeGreaterThan(0);

  const exportedPath = await input.diagnostics.exportThread(thread.id, [input.provider]);
  const diagnosticsCopyPath = BATCH_DIR
    ? join(
        BATCH_DIR,
        getScenarioModeDir(input.mode),
        `thread-diagnostics-${sanitizeScenarioFileName(input.scenario.id)}.json`
      )
    : exportedPath;

  if (BATCH_DIR) {
    mkdirSync(dirname(diagnosticsCopyPath), { recursive: true });
    copyFileSync(exportedPath, diagnosticsCopyPath);
    writeBatchArtifact(
      join(
        getScenarioModeDir(input.mode),
        `thread-diagnostics-${sanitizeScenarioFileName(input.scenario.id)}-path.txt`
      ),
      `${exportedPath}\n`
    );
  }

  return {
    threadId: thread.id,
    runId: result.runId,
    answer: getLastAssistantText(completedThread),
    prompt: capture?.prompt ?? '',
    generatedMemoryUsed: Boolean(promptAssembled?.detail?.generatedMemoryUsed),
    generatedMemoryItems: Array.isArray(promptAssembled?.detail?.generatedMemoryItems)
      ? (promptAssembled?.detail?.generatedMemoryItems as ScenarioModeResult['generatedMemoryItems'])
      : [],
    firstSubstantiveAction:
      typeof firstToolCall?.detail?.firstSubstantiveAction === 'string'
        ? (firstToolCall.detail.firstSubstantiveAction as string)
        : null,
    diagnosticsCopyPath
  } satisfies ScenarioModeResult;
}

const liveDescribe = SHOULD_RUN_LIVE ? describe.sequential : describe.skip;

liveDescribe('Generated-memory live proof', () => {
  const tempDirs: string[] = [];
  const dbs: DatabaseService[] = [];

  afterEach(() => {
    while (dbs.length > 0) {
      dbs.pop()?.close();
    }
    while (tempDirs.length > 0) {
      const current = tempDirs.pop();
      if (current) {
        rmSync(current, { recursive: true, force: true });
      }
    }
  });

  it(
    'records baseline vs experimental live proof scenarios through the real OpenAI provider-manager lane',
    async () => {
      const rootDir = mkdtempSync(join(tmpdir(), 'vicode-generated-memory-live-proof-'));
      tempDirs.push(rootDir);

      const workspace = createWorkspace(rootDir, {
        'AGENTS.md': 'Use small diffs and keep answers grounded in the active workspace.',
        'README.md': '# Live proof workspace\n\nThis workspace is intentionally minimal.',
        'package.json': JSON.stringify(
          {
            name: 'generated-memory-live-proof',
            private: true,
            scripts: {
              smoke: 'node smoke-check.mjs',
              test: 'node generic-test.mjs'
            }
          },
          null,
          2
        ),
        'smoke-check.mjs': "console.log('smoke ok');\n",
        'generic-test.mjs': "console.log('generic test ok');\n",
        'src/main/services/provider-manager.ts': 'export const providerManagerOwner = true;\n',
        'src/main/services/provider-manager-prompt-builder.ts':
          'export const promptBuilderOwner = true;\n'
      });

      const db = new DatabaseService(join(rootDir, 'vicode.sqlite'));
      db.migrate();
      dbs.push(db);

      const project = db.createProject({
        name: 'Generated-memory live proof',
        folderPath: workspace,
        trusted: true
      });

      db.savePreferences({
        selectedProjectId: project.id,
        defaultProviderId: 'openai',
        defaultModelByProvider: {
          ...db.getPreferences().defaultModelByProvider,
          openai: 'gpt-5.4'
        },
        generatedMemoryGenerationEnabled: true,
        generatedMemoryUseEnabled: false
      });

      const sourceThread = db.createThread({
        projectId: project.id,
        title: 'Generated-memory source thread',
        providerId: 'openai',
        modelId: 'gpt-5.4',
        executionPermission: 'full_access'
      });
      db.appendTurn(
        sourceThread.id,
        'user',
        'Keep workspace guidance narrow and action-oriented across threads.',
        null,
        'run-memory-source'
      );
      db.appendTurn(
        sourceThread.id,
        'assistant',
        'Use `npm run smoke` from the workspace root as the default first validation command for this workspace.',
        null,
        'run-memory-source'
      );
      db.appendTurn(
        sourceThread.id,
        'assistant',
        'Known pitfall: avoid the legacy nested smoke path in this workspace because it checks the wrong surface.',
        null,
        'run-memory-source'
      );
      db.appendTurn(
        sourceThread.id,
        'assistant',
        'Architecture convention: prompt assembly changes belong in `src/main/services/provider-manager-prompt-builder.ts`, not `provider-manager.ts`.',
        null,
        'run-memory-source'
      );

      const generatedMemory = new GeneratedMemoryService(db, join(rootDir, 'generated-memory'));
      generatedMemory.captureThreadCandidates(sourceThread.id, 'run-memory-source');

      const promptCaptures: PromptCapture[] = [];
      const manager = new ProviderManager(
        db as never,
        {
          openai: createCapturingOpenAIAdapter(promptCaptures),
          gemini: createStubAdapter({ id: 'gemini', label: 'Gemini' })
        } as never
      );

      const diagnostics = new DiagnosticsService(db, join(rootDir, 'exports'));
      let provider = await manager.getProvider('openai', { forceRefresh: true });
      if (provider.authState === 'detected') {
        provider = await manager.adoptAuth('openai');
      }

      if (!provider.installed || provider.authState !== 'connected') {
        writeSkipReason(
          !provider.installed
            ? 'OpenAI/Codex CLI is not installed for generated-memory live proof.'
            : `OpenAI/Codex CLI is not connected for generated-memory live proof. Current auth state: ${provider.authState}.`
        );
        return;
      }

      if (provider.models.length === 0) {
        writeSkipReason('OpenAI/Codex CLI exposed no live models for generated-memory live proof.');
        return;
      }

      const model = selectOpenAILiveProofModel(provider.models);
      const partialResults: Partial<LiveProofResultBundle> = {
        executedAt: new Date().toISOString(),
        providerId: 'openai',
        modelId: model.id,
        workspacePath: workspace,
        scenarios: []
      };

      try {
        for (const scenario of SCENARIOS) {
          const baseline = await runScenario({
            db,
            manager,
            diagnostics,
            provider,
            projectId: project.id,
            modelId: model.id,
            captures: promptCaptures,
            scenario,
            mode: 'baseline'
          });

          const experimental = await runScenario({
            db,
            manager,
            diagnostics,
            provider,
            projectId: project.id,
            modelId: model.id,
            captures: promptCaptures,
            scenario,
            mode: 'experimental'
          });

          const verdict = classifyVerdict(scenario, baseline, experimental);
          const notes = [
            `Baseline first substantive action: ${baseline.firstSubstantiveAction ?? 'none recorded'}`,
            `Experimental first substantive action: ${experimental.firstSubstantiveAction ?? 'none recorded'}`,
            `Baseline generated-memory items: ${baseline.generatedMemoryItems.length}`,
            `Experimental generated-memory items: ${experimental.generatedMemoryItems.length}`
          ];

          expect(containsAllFragments(experimental.prompt, scenario.expectedPromptFragments)).toBe(true);

          partialResults.scenarios?.push({
            id: scenario.id,
            title: scenario.title,
            query: scenario.query,
            verdict,
            notes,
            baseline,
            experimental
          });
        }

        writeBatchArtifact(
          'live-proof-results.json',
          `${JSON.stringify(partialResults satisfies LiveProofResultBundle, null, 2)}\n`
        );
      } catch (error) {
        writeFailureSnapshot(error, partialResults);
        throw error;
      }
    },
    LIVE_TEST_TIMEOUT_MS
  );
});
