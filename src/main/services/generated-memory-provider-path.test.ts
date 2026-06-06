import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProviderAdapter, ProviderRunCallbacks, ProviderRunHandle } from '../../providers/types';
import type { ProviderId, ProviderModel } from '../../shared/domain';
import { DatabaseService } from '../../storage/database';
import { getProviderFallbackModels } from '../../providers/catalog';
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

function createProviderModel(id: string, label = id): ProviderModel {
  return { id, label, description: '' };
}

function createAdapter(overrides: Partial<ProviderAdapter> = {}): ProviderAdapter {
  const providerId = (overrides.id ?? 'openai') as ProviderId;
  return {
    id: providerId,
    label: providerId === 'gemini' ? 'Gemini' : 'OpenAI',
    listStaticModels: () => getProviderFallbackModels(providerId),
    getPlannerCapability: () => ({
      supported: true,
      executionMode: 'read-only',
      enforcement: 'hard-enforced'
    }),
    discoverApiModels: async () => null,
    discoverRuntimeModels: async () => null,
    detectInstall: async () => ({ installed: true, cliPath: 'codex.cmd' }),
    getAuthState: async () => ({ authState: 'disconnected', authMode: null, message: 'Disconnected' }),
    startAuth: async () => {},
    clearAuth: async () => {},
    validateProjectContext: () => ({ valid: true }),
    startRun: async () =>
      ({
        runId: 'run-1',
        cancel: async () => {}
      }) satisfies ProviderRunHandle,
    ...overrides
  };
}

function collectRuntimeTrace(thread: ReturnType<DatabaseService['getThread']>, runId: string) {
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

describe('Generated-memory provider path', () => {
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

  function createDb() {
    const dir = mkdtempSync(join(tmpdir(), 'vicode-generated-memory-provider-path-'));
    tempDirs.push(dir);
    const db = new DatabaseService(join(dir, 'vicode.sqlite'));
    db.migrate();
    dbs.push(db);
    return { db, dir };
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

  it('compares baseline and opt-in experimental runs through the normal provider path', async () => {
    const { db, dir } = createDb();
    const workspace = createWorkspace(dir, {
      'AGENTS.md': 'Use small diffs and keep validation commands workspace-scoped.',
      'src/main/services/provider-manager-prompt-builder.ts': 'prompt-builder-owner'
    });
    const artifactsRoot = join(dir, 'state', 'generated-memory');
    const exportsDir = join(dir, 'exports');
    const project = db.createProject({
      name: 'Generated-memory provider path',
      folderPath: workspace,
      trusted: true
    });
    db.savePreferences({
      selectedProjectId: project.id,
      defaultProviderId: 'openai',
      defaultModelByProvider: {
        ...db.getPreferences().defaultModelByProvider,
        openai: 'gpt-5'
      },
      generatedMemoryGenerationEnabled: true,
      generatedMemoryUseEnabled: false
    });

    const memoryThread = db.createThread({
      projectId: project.id,
      title: 'Generated memory source thread',
      providerId: 'openai',
      modelId: 'gpt-5'
    });
    db.appendTurn(
      memoryThread.id,
      'user',
      'Please keep docs source-backed with code pointers placed in repo docs.',
      null,
      'run-memory'
    );
    db.appendTurn(
      memoryThread.id,
      'assistant',
      'Use `npm run smoke` from the workspace root as the default verification command for this workspace.',
      null,
      'run-memory'
    );
    db.appendTurn(
      memoryThread.id,
      'assistant',
      'Avoid the legacy nested smoke path in this workspace because it causes drift.',
      null,
      'run-memory'
    );
    db.appendTurn(
      memoryThread.id,
      'assistant',
      'Architecture convention: prompt assembly changes belong in `src/main/services/provider-manager-prompt-builder.ts`, not `provider-manager.ts`.',
      null,
      'run-memory'
    );
    db.appendTurn(
      memoryThread.id,
      'user',
      'Keep celebratory status blurbs upbeat when summarizing progress.',
      null,
      'run-memory'
    );

    const generatedMemory = new GeneratedMemoryService(db, artifactsRoot);
    generatedMemory.captureThreadCandidates(memoryThread.id, 'run-memory');

    const query = 'Before validating this workspace, name the one specific trap to avoid and the safer path.';
    const capturedRuns: Array<{ prompt: string; sourcePrompt: string | null }> = [];
    const startRun = vi.fn(
      async (context: { prompt: string; sourcePrompt?: string | null }, callbacks: ProviderRunCallbacks) => {
      capturedRuns.push({
        prompt: context.prompt,
        sourcePrompt: context.sourcePrompt ?? null
      });
      callbacks.onStart();
      const usesGeneratedMemory = context.prompt.includes('Generated Workspace Recall (Derived, Non-Canonical)');
      callbacks.onInfo({
        activity: {
          kind: 'tool_call',
          phase: 'started',
          toolName: 'run_command',
          summary: 'Calling exec command',
          command: usesGeneratedMemory ? 'Get-ChildItem -Force' : 'Get-ChildItem -Force -Recurse -Depth 2',
          cwd: usesGeneratedMemory ? 'workspace root' : 'nested workspace area'
        }
      });
      callbacks.onComplete(
        usesGeneratedMemory
          ? 'Avoid the legacy nested smoke path; use `npm run smoke` from the workspace root.'
          : 'Inspect the workspace before choosing a validation path.'
      );
      return {
        runId: 'run-provider-path',
        cancel: async () => {}
      } satisfies ProviderRunHandle;
    });

    const manager = new ProviderManager(
      db as never,
      {
        openai: createAdapter({ startRun }),
        gemini: createAdapter({ id: 'gemini', label: 'Gemini' })
      } as never
    );

    const baseline = await manager.submitComposer({
      projectId: project.id,
      prompt: query,
      providerId: 'openai',
      modelId: 'gpt-5',
      executionPermission: 'default',
      skillIds: []
    });

    db.savePreferences({
      generatedMemoryUseEnabled: true
    });

    const experimental = await manager.submitComposer({
      projectId: project.id,
      prompt: query,
      providerId: 'openai',
      modelId: 'gpt-5',
      executionPermission: 'default',
      skillIds: []
    });

    const executionPrompts = capturedRuns
      .filter((entry) => entry.sourcePrompt === query)
      .map((entry) => entry.prompt);
    const baselinePrompt = executionPrompts[0] ?? '';
    const experimentalPrompt = executionPrompts[1] ?? '';
    const baselineThread = db.getThread(baseline.thread.id);
    const experimentalThread = db.getThread(experimental.thread.id);
    const baselineTrace = collectRuntimeTrace(baselineThread, baseline.runId);
    const experimentalTrace = collectRuntimeTrace(experimentalThread, experimental.runId);
    const baselinePromptAssembled = baselineTrace.find((trace) => trace.stage === 'prompt_assembled');
    const experimentalPromptAssembled = experimentalTrace.find((trace) => trace.stage === 'prompt_assembled');
    const baselineFirstToolCall = baselineTrace.find((trace) => trace.stage === 'first_tool_call');
    const experimentalFirstToolCall = experimentalTrace.find((trace) => trace.stage === 'first_tool_call');

    expect(baselinePrompt).not.toContain('Generated Workspace Recall (Derived, Non-Canonical)');
    expect(baselinePrompt).not.toContain('legacy nested smoke path');
    expect(experimentalPrompt).toContain('Generated Workspace Recall (Derived, Non-Canonical)');
    expect(experimentalPrompt).toContain('legacy nested smoke path');
    expect(experimentalPrompt).not.toContain('celebratory status blurbs upbeat');

    expect(baselinePromptAssembled?.detail).toEqual(
      expect.objectContaining({
        generatedMemoryEnabled: false,
        generatedMemoryGenerationEnabled: true,
        generatedMemoryUsed: false,
        generatedMemoryItemIds: [],
        generatedMemorySourceThreadIds: [],
        canonicalMemoryUsed: false,
        firstSubstantiveAction: null
      })
    );
    expect(experimentalPromptAssembled?.detail).toEqual(
      expect.objectContaining({
        workspaceScopeKey: workspace,
        generatedMemoryEnabled: true,
        generatedMemoryGenerationEnabled: true,
        generatedMemoryUsed: true,
        generatedMemorySourceThreadIds: [memoryThread.id],
        canonicalMemoryUsed: false,
        firstSubstantiveAction: null
      })
    );
    expect(experimentalPromptAssembled?.detail?.generatedMemoryItemIds).toEqual(expect.any(Array));
    expect((experimentalPromptAssembled?.detail?.generatedMemoryItemIds as unknown[] | undefined)?.length).toBeGreaterThan(0);
    expect(experimentalPromptAssembled?.detail?.generatedMemoryItems).toEqual([
      expect.objectContaining({
        kind: 'known_pitfall',
        rank: 1,
        kindGate: expect.arrayContaining(['pitfall_intent']),
        matchedTerms: expect.arrayContaining(['avoid']),
        sourceThreadIds: [memoryThread.id]
      })
    ]);

    expect(baselineFirstToolCall?.detail).toEqual(
      expect.objectContaining({
        command: 'Get-ChildItem -Force -Recurse -Depth 2',
        cwd: 'nested workspace area',
        generatedMemoryUsed: false
      })
    );
    expect(experimentalFirstToolCall?.detail).toEqual(
      expect.objectContaining({
        command: 'Get-ChildItem -Force',
        cwd: 'workspace root',
        generatedMemoryUsed: true
      })
    );
    expect(String(baselineFirstToolCall?.detail?.firstSubstantiveAction ?? '')).toBe('Calling exec command');
    expect(String(experimentalFirstToolCall?.detail?.firstSubstantiveAction ?? '')).toBe('Calling exec command');

    const diagnostics = new DiagnosticsService(db, exportsDir);
    const exportedPath = await diagnostics.exportThread(experimental.thread.id, [
      {
        id: 'openai',
        label: 'OpenAI',
        authMode: 'cli',
        configured: true
      }
    ]);
    const exported = JSON.parse(readFileSync(exportedPath, 'utf8')) as {
      runProgressDiagnostics: {
        runtimeTraceDiagnostics: Array<{
          runId: string;
          terminalStage: string | null;
          marks: Array<{
            stage: string;
            detail?: Record<string, unknown> | null;
          }>;
        }>;
      };
    };
    const runtimeTraceDiagnostic = exported.runProgressDiagnostics.runtimeTraceDiagnostics.find(
      (entry) => entry.runId === experimental.runId
    );
    const exportedPromptAssembled = runtimeTraceDiagnostic?.marks.find((mark) => mark.stage === 'prompt_assembled');
    const exportedFirstToolCall = runtimeTraceDiagnostic?.marks.find((mark) => mark.stage === 'first_tool_call');

    expect(runtimeTraceDiagnostic?.terminalStage).toBe('completed');
    expect(exportedPromptAssembled?.detail).toEqual(
      expect.objectContaining({
        generatedMemoryEnabled: true,
        generatedMemoryUsed: true
      })
    );
    expect(exportedFirstToolCall?.detail).toEqual(
      expect.objectContaining({
        command: 'Get-ChildItem -Force',
        cwd: 'workspace root',
        generatedMemoryUsed: true
      })
    );
    expect(String(exportedFirstToolCall?.detail?.firstSubstantiveAction ?? '')).toBe('Calling exec command');
  });
});
