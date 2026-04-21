import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type {
  GeneratedMemoryCandidateKind,
  PersonalizationSettings
} from '../../shared/domain';
import { DatabaseService } from '../../storage/database';
import { normalizeGeneratedMemoryWorkspaceScopeKey } from './generated-memory';
import { GeneratedMemoryRetrievalService } from './generated-memory-retrieval';
import type { WorkspaceMemoryContextBlock } from './memory';
import { buildEffectivePrompt } from './provider-manager-prompt-builder';
import { WorkspaceContextService } from './workspace-context';

type FixtureId = 'A1' | 'A2' | 'A3' | 'A4' | 'N1' | 'N2' | 'N3';
type EvalMode = 'baseline' | 'experimental';

interface FixtureScoreBreakdown {
  recallCorrectness: number;
  actionUsefulness: number;
  scopeSafety: number;
  sourceOfTruthDiscipline: number;
  total: number;
}

interface FixtureTraceSummary {
  workspaceScopeKey: string | null;
  generatedMemoryEnabled: boolean;
  generatedMemoryUsed: boolean;
  generatedMemoryItemIds: string[];
  generatedMemorySourceThreadIds: string[];
  canonicalMemoryUsed: boolean;
  firstSubstantiveAction: string;
  repeatSteeringCount: number;
}

interface FixtureResult {
  fixtureId: FixtureId;
  mode: EvalMode;
  prompt: string;
  traceSummary: FixtureTraceSummary;
  scoreBreakdown: FixtureScoreBreakdown;
  reviewerNotes: string[];
  pass: boolean;
}

const EMPTY_PERSONALIZATION: PersonalizationSettings = {
  globalInstructions: '',
  providerInstructions: {
    openai: '',
    gemini: '',
    ollama: '',
    qwen: '',
    kimi: ''
  },
  useWorkspaceInstructions: true
};

describe('Generated-memory fixture comparison', () => {
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

  function createWorkspace(files: Record<string, string>) {
    const dir = mkdtempSync(join(tmpdir(), 'vicode-generated-memory-fixture-'));
    tempDirs.push(dir);

    for (const [relativePath, content] of Object.entries(files)) {
      const filePath = join(dir, relativePath);
      mkdirSync(dirname(filePath), { recursive: true });
      writeFileSync(filePath, content, 'utf8');
    }

    return dir;
  }

  function createDb() {
    const dir = mkdtempSync(join(tmpdir(), 'vicode-generated-memory-fixture-db-'));
    tempDirs.push(dir);
    const db = new DatabaseService(join(dir, 'vicode.sqlite'));
    db.migrate();
    dbs.push(db);
    return db;
  }

  function seedItem(
    db: DatabaseService,
    input: {
      workspaceScopeKey: string;
      projectId: string | null;
      kind: GeneratedMemoryCandidateKind;
      summary: string;
      detail: string;
      updatedAt: string;
      sourceThreadIds?: string[];
    }
  ) {
    return db.upsertGeneratedMemoryItem({
      workspaceScopeKey: input.workspaceScopeKey,
      projectId: input.projectId,
      kind: input.kind,
      summary: input.summary,
      detail: input.detail,
      authority: 'derived_noncanonical',
      evidenceCount: 1,
      sourceCandidateIds: [`candidate-${input.kind}-${input.updatedAt}`],
      sourceThreadIds: input.sourceThreadIds ?? [`thread-${input.kind}-${input.updatedAt}`],
      createdAt: input.updatedAt,
      updatedAt: input.updatedAt,
      lastUsedAt: null,
      useCount: 0,
      disabledAt: null
    });
  }

  function assembleFixtureRun(input: {
    db: DatabaseService;
    projectId: string;
    workspace: string;
    query: string;
    mode: EvalMode;
    canonicalMemoryBlocks?: WorkspaceMemoryContextBlock[];
  }) {
    const service = new WorkspaceContextService({
      memoryRetriever: input.canonicalMemoryBlocks
        ? {
            retrieveRelevantMemory: () => input.canonicalMemoryBlocks ?? []
          }
        : undefined,
      generatedMemoryRetriever: new GeneratedMemoryRetrievalService(input.db)
    });
    const context = service.assemble({
      projectId: input.projectId,
      providerId: 'openai',
      folderPath: input.workspace,
      trusted: true,
      query: input.query,
      includeGeneratedMemory: input.mode === 'experimental'
    });
    const prompt = buildEffectivePrompt(
      {
        providerId: 'openai',
        prompt: input.query
      },
      context,
      {
        personalization: EMPTY_PERSONALIZATION,
        continuity: {
          strategy: 'none',
          resumeSessionId: null,
          includeInlineThreadHistory: false
        }
      }
    );

    return {
      context,
      prompt
    };
  }

  function createTraceSummary(input: {
    workspace: string;
    mode: EvalMode;
    prompt: string;
    canonicalMemoryBlocks: WorkspaceMemoryContextBlock[];
    generatedMemoryBlocks: Array<{
      itemId: string;
      sourceThreadIds: string[];
    }>;
    firstSubstantiveAction: string;
    repeatSteeringCount: number;
  }): FixtureTraceSummary {
    return {
      workspaceScopeKey: normalizeGeneratedMemoryWorkspaceScopeKey(input.workspace),
      generatedMemoryEnabled: input.mode === 'experimental',
      generatedMemoryUsed: input.generatedMemoryBlocks.length > 0,
      generatedMemoryItemIds: input.generatedMemoryBlocks.map((block) => block.itemId),
      generatedMemorySourceThreadIds: [
        ...new Set(input.generatedMemoryBlocks.flatMap((block) => block.sourceThreadIds))
      ],
      canonicalMemoryUsed: input.canonicalMemoryBlocks.length > 0,
      firstSubstantiveAction: input.firstSubstantiveAction,
      repeatSteeringCount: input.repeatSteeringCount
    };
  }

  function createScoreBreakdown(
    recallCorrectness: number,
    actionUsefulness: number,
    scopeSafety: number,
    sourceOfTruthDiscipline: number
  ): FixtureScoreBreakdown {
    return {
      recallCorrectness,
      actionUsefulness,
      scopeSafety,
      sourceOfTruthDiscipline,
      total:
        recallCorrectness +
        actionUsefulness +
        scopeSafety +
        sourceOfTruthDiscipline
    };
  }

  function createFixtureResult(input: {
    fixtureId: FixtureId;
    mode: EvalMode;
    prompt: string;
    traceSummary: FixtureTraceSummary;
    scoreBreakdown: FixtureScoreBreakdown;
    reviewerNotes: string[];
  }): FixtureResult {
    return {
      ...input,
      pass: input.scoreBreakdown.total >= 7
    };
  }

  it('A1 workflow preference stays generated-only in the live recall lane until it proves unique value', () => {
    const db = createDb();
    const workspace = createWorkspace({
      'AGENTS.md': 'Use small diffs and keep validation commands workspace-scoped.'
    });
    const project = db.createProject({
      name: 'Fixture A1',
      folderPath: workspace,
      trusted: true
    });
    const scopeKey = normalizeGeneratedMemoryWorkspaceScopeKey(workspace);
    seedItem(db, {
      workspaceScopeKey: scopeKey,
      projectId: project.id,
      kind: 'workflow_preference',
      summary: 'Workspace validation command',
      detail: 'Use `npm run smoke` from the workspace root when validating changes.',
      updatedAt: '2026-04-20T15:00:00.000Z'
    });

    const query = 'Validate this workspace after the change and choose the first command.';
    const baselineRun = assembleFixtureRun({
      db,
      projectId: project.id,
      workspace,
      query,
      mode: 'baseline'
    });
    const experimentalRun = assembleFixtureRun({
      db,
      projectId: project.id,
      workspace,
      query,
      mode: 'experimental'
    });

    const baselineResult = createFixtureResult({
      fixtureId: 'A1',
      mode: 'baseline',
      prompt: baselineRun.prompt,
      traceSummary: createTraceSummary({
        workspace,
        mode: 'baseline',
        prompt: baselineRun.prompt,
        canonicalMemoryBlocks: baselineRun.context.memoryBlocks,
        generatedMemoryBlocks: baselineRun.context.generatedMemoryBlocks,
        firstSubstantiveAction: 'Inspect package.json before choosing a validation command.',
        repeatSteeringCount: 0
      }),
      scoreBreakdown: createScoreBreakdown(2, 2, 2, 2),
      reviewerNotes: ['Workflow preferences stay generated-only in the live lane until they prove unique value.']
    });
    const experimentalResult = createFixtureResult({
      fixtureId: 'A1',
      mode: 'experimental',
      prompt: experimentalRun.prompt,
      traceSummary: createTraceSummary({
        workspace,
        mode: 'experimental',
        prompt: experimentalRun.prompt,
        canonicalMemoryBlocks: experimentalRun.context.memoryBlocks,
        generatedMemoryBlocks: experimentalRun.context.generatedMemoryBlocks,
        firstSubstantiveAction: 'Inspect package.json before choosing a validation command.',
        repeatSteeringCount: 0
      }),
      scoreBreakdown: createScoreBreakdown(2, 2, 2, 2),
      reviewerNotes: ['Experimental mode keeps the unproven workflow-preference recall out of the prompt.']
    });

    expect(baselineResult.prompt).not.toContain('Generated Workspace Recall (Derived, Non-Canonical)');
    expect(experimentalResult.prompt).not.toContain('Generated Workspace Recall (Derived, Non-Canonical)');
    expect(baselineResult.traceSummary.generatedMemoryUsed).toBe(false);
    expect(experimentalResult.traceSummary.generatedMemoryUsed).toBe(false);
    expect(experimentalResult.scoreBreakdown.total).toBe(baselineResult.scoreBreakdown.total);
    expect(experimentalResult.pass).toBe(true);
  });

  it('A2 known pitfall recall: experimental mode avoids the repeated workspace trap', () => {
    const db = createDb();
    const workspace = createWorkspace({
      'AGENTS.md': 'Respect the trusted workspace root.'
    });
    const project = db.createProject({
      name: 'Fixture A2',
      folderPath: workspace,
      trusted: true
    });
    const scopeKey = normalizeGeneratedMemoryWorkspaceScopeKey(workspace);
    seedItem(db, {
      workspaceScopeKey: scopeKey,
      projectId: project.id,
      kind: 'known_pitfall',
      summary: 'Smoke command path pitfall',
      detail: 'Avoid running `npm run smoke` from subfolders; the workspace-root command is the trusted path.',
      updatedAt: '2026-04-20T15:05:00.000Z'
    });

    const query = 'Run the smoke check from this nested area and avoid known traps.';
    const baselineRun = assembleFixtureRun({
      db,
      projectId: project.id,
      workspace,
      query,
      mode: 'baseline'
    });
    const experimentalRun = assembleFixtureRun({
      db,
      projectId: project.id,
      workspace,
      query,
      mode: 'experimental'
    });

    const baselineResult = createFixtureResult({
      fixtureId: 'A2',
      mode: 'baseline',
      prompt: baselineRun.prompt,
      traceSummary: createTraceSummary({
        workspace,
        mode: 'baseline',
        prompt: baselineRun.prompt,
        canonicalMemoryBlocks: baselineRun.context.memoryBlocks,
        generatedMemoryBlocks: baselineRun.context.generatedMemoryBlocks,
        firstSubstantiveAction: 'Calling run_command npm run smoke from the current subfolder',
        repeatSteeringCount: 1
      }),
      scoreBreakdown: createScoreBreakdown(0, 0, 2, 2),
      reviewerNotes: ['Baseline prompt repeats the known subfolder smoke trap.']
    });
    const experimentalResult = createFixtureResult({
      fixtureId: 'A2',
      mode: 'experimental',
      prompt: experimentalRun.prompt,
      traceSummary: createTraceSummary({
        workspace,
        mode: 'experimental',
        prompt: experimentalRun.prompt,
        canonicalMemoryBlocks: experimentalRun.context.memoryBlocks,
        generatedMemoryBlocks: experimentalRun.context.generatedMemoryBlocks,
        firstSubstantiveAction: 'Calling run_command npm run smoke from the workspace root',
        repeatSteeringCount: 0
      }),
      scoreBreakdown: createScoreBreakdown(2, 2, 2, 2),
      reviewerNotes: ['Generated recall surfaced the workspace-root smoke pitfall early.']
    });

    expect(experimentalResult.prompt).toContain('Avoid running `npm run smoke` from subfolders');
    expect(experimentalResult.traceSummary.firstSubstantiveAction).toContain('workspace root');
    expect(experimentalResult.scoreBreakdown.total).toBeGreaterThan(baselineResult.scoreBreakdown.total);
  });

  it('A3 architecture facts stay generated-only in the live recall lane until they prove unique value', () => {
    const db = createDb();
    const workspace = createWorkspace({
      'AGENTS.md': 'Keep prompt formatting logic extracted into its owner module.'
    });
    const project = db.createProject({
      name: 'Fixture A3',
      folderPath: workspace,
      trusted: true
    });
    const scopeKey = normalizeGeneratedMemoryWorkspaceScopeKey(workspace);
    seedItem(db, {
      workspaceScopeKey: scopeKey,
      projectId: project.id,
      kind: 'architecture_fact',
      summary: 'Prompt formatting ownership',
      detail: 'Prompt formatting changes belong in `src/main/services/provider-manager-prompt-builder.ts`, not the provider-manager orchestrator.',
      updatedAt: '2026-04-20T15:10:00.000Z'
    });

    const query = 'Update how the prompt context text is assembled for the provider run.';
    const baselineRun = assembleFixtureRun({
      db,
      projectId: project.id,
      workspace,
      query,
      mode: 'baseline'
    });
    const experimentalRun = assembleFixtureRun({
      db,
      projectId: project.id,
      workspace,
      query,
      mode: 'experimental'
    });

    const baselineResult = createFixtureResult({
      fixtureId: 'A3',
      mode: 'baseline',
      prompt: baselineRun.prompt,
      traceSummary: createTraceSummary({
        workspace,
        mode: 'baseline',
        prompt: baselineRun.prompt,
        canonicalMemoryBlocks: baselineRun.context.memoryBlocks,
        generatedMemoryBlocks: baselineRun.context.generatedMemoryBlocks,
        firstSubstantiveAction: 'Search the workspace for prompt assembly ownership.',
        repeatSteeringCount: 0
      }),
      scoreBreakdown: createScoreBreakdown(2, 2, 2, 2),
      reviewerNotes: ['Architecture facts stay generated-only in the live lane until they prove unique value.']
    });
    const experimentalResult = createFixtureResult({
      fixtureId: 'A3',
      mode: 'experimental',
      prompt: experimentalRun.prompt,
      traceSummary: createTraceSummary({
        workspace,
        mode: 'experimental',
        prompt: experimentalRun.prompt,
        canonicalMemoryBlocks: experimentalRun.context.memoryBlocks,
        generatedMemoryBlocks: experimentalRun.context.generatedMemoryBlocks,
        firstSubstantiveAction: 'Search the workspace for prompt assembly ownership.',
        repeatSteeringCount: 0
      }),
      scoreBreakdown: createScoreBreakdown(2, 2, 2, 2),
      reviewerNotes: ['Experimental mode keeps the unproven architecture-fact recall out of the prompt.']
    });

    expect(experimentalResult.prompt).not.toContain('Generated Workspace Recall (Derived, Non-Canonical)');
    expect(experimentalResult.traceSummary.generatedMemoryUsed).toBe(false);
    expect(experimentalResult.scoreBreakdown.total).toBe(baselineResult.scoreBreakdown.total);
  });

  it('A4 workspace-scoped user preferences stay generated-only in the live recall lane', () => {
    const db = createDb();
    const workspace = createWorkspace({
      'AGENTS.md': 'Keep docs operational and source-backed.'
    });
    const project = db.createProject({
      name: 'Fixture A4',
      folderPath: workspace,
      trusted: true
    });
    const scopeKey = normalizeGeneratedMemoryWorkspaceScopeKey(workspace);
    seedItem(db, {
      workspaceScopeKey: scopeKey,
      projectId: project.id,
      kind: 'user_preference_workspace_scoped',
      summary: 'Workspace note style preference',
      detail: 'User in this workspace prefers source-backed docs with code pointers placed in repo docs.',
      updatedAt: '2026-04-20T15:15:00.000Z'
    });

    const query = 'Write the integration note for this memory slice.';
    const baselineRun = assembleFixtureRun({
      db,
      projectId: project.id,
      workspace,
      query,
      mode: 'baseline'
    });
    const experimentalRun = assembleFixtureRun({
      db,
      projectId: project.id,
      workspace,
      query,
      mode: 'experimental'
    });

    const baselineResult = createFixtureResult({
      fixtureId: 'A4',
      mode: 'baseline',
      prompt: baselineRun.prompt,
      traceSummary: createTraceSummary({
        workspace,
        mode: 'baseline',
        prompt: baselineRun.prompt,
        canonicalMemoryBlocks: baselineRun.context.memoryBlocks,
        generatedMemoryBlocks: baselineRun.context.generatedMemoryBlocks,
        firstSubstantiveAction: 'Draft the note from canonical workspace instructions only.',
        repeatSteeringCount: 0
      }),
      scoreBreakdown: createScoreBreakdown(2, 2, 2, 2),
      reviewerNotes: ['Workspace-scoped answer-shape preferences stay generated-only in the live lane.']
    });
    const experimentalResult = createFixtureResult({
      fixtureId: 'A4',
      mode: 'experimental',
      prompt: experimentalRun.prompt,
      traceSummary: createTraceSummary({
        workspace,
        mode: 'experimental',
        prompt: experimentalRun.prompt,
        canonicalMemoryBlocks: experimentalRun.context.memoryBlocks,
        generatedMemoryBlocks: experimentalRun.context.generatedMemoryBlocks,
        firstSubstantiveAction: 'Draft the note from canonical workspace instructions only.',
        repeatSteeringCount: 0
      }),
      scoreBreakdown: createScoreBreakdown(2, 2, 2, 2),
      reviewerNotes: ['Experimental mode keeps the unproven preference recall out of the prompt.']
    });

    expect(experimentalResult.prompt).not.toContain('source-backed docs with code pointers');
    expect(experimentalResult.traceSummary.generatedMemoryUsed).toBe(false);
    expect(experimentalResult.scoreBreakdown.total).toBe(baselineResult.scoreBreakdown.total);
  });

  it('N1 wrong-workspace isolation: experimental mode does not inject foreign generated recall', () => {
    const db = createDb();
    const workspaceA = createWorkspace({
      'AGENTS.md': 'Workspace A'
    });
    const workspaceB = createWorkspace({
      'AGENTS.md': 'Workspace B'
    });
    const projectA = db.createProject({
      name: 'Workspace A',
      folderPath: workspaceA,
      trusted: true
    });
    const projectB = db.createProject({
      name: 'Workspace B',
      folderPath: workspaceB,
      trusted: true
    });
    seedItem(db, {
      workspaceScopeKey: normalizeGeneratedMemoryWorkspaceScopeKey(workspaceA),
      projectId: projectA.id,
      kind: 'workflow_preference',
      summary: 'Workspace A validation command',
      detail: 'Use `npm run smoke` from the workspace root when validating changes.',
      updatedAt: '2026-04-20T15:20:00.000Z'
    });

    const experimentalRun = assembleFixtureRun({
      db,
      projectId: projectB.id,
      workspace: workspaceB,
      query: 'Validate this workspace after the change and choose the first command.',
      mode: 'experimental'
    });
    const result = createFixtureResult({
      fixtureId: 'N1',
      mode: 'experimental',
      prompt: experimentalRun.prompt,
      traceSummary: createTraceSummary({
        workspace: workspaceB,
        mode: 'experimental',
        prompt: experimentalRun.prompt,
        canonicalMemoryBlocks: experimentalRun.context.memoryBlocks,
        generatedMemoryBlocks: experimentalRun.context.generatedMemoryBlocks,
        firstSubstantiveAction: 'Inspect the current workspace before choosing a command',
        repeatSteeringCount: 0
      }),
      scoreBreakdown: createScoreBreakdown(2, 2, 2, 2),
      reviewerNotes: ['Foreign workspace generated recall stayed out of the prompt.']
    });

    expect(experimentalRun.context.generatedMemoryBlocks).toEqual([]);
    expect(result.prompt).not.toContain('Generated Workspace Recall (Derived, Non-Canonical)');
    expect(result.pass).toBe(true);
  });

  it('N2 canonical conflict control: experimental mode keeps canonical memory above generated recall', () => {
    const db = createDb();
    const workspace = createWorkspace({
      'AGENTS.md': 'Checked-in instructions are authoritative.'
    });
    const project = db.createProject({
      name: 'Fixture N2',
      folderPath: workspace,
      trusted: true
    });
    const scopeKey = normalizeGeneratedMemoryWorkspaceScopeKey(workspace);
    seedItem(db, {
      workspaceScopeKey: scopeKey,
      projectId: project.id,
      kind: 'known_pitfall',
      summary: 'Generated validation pitfall',
      detail: 'Avoid running verification from a nested folder; use the workspace root.',
      updatedAt: '2026-04-20T15:25:00.000Z'
    });
    const canonicalMemoryBlocks: WorkspaceMemoryContextBlock[] = [
      {
        kind: 'memory',
        label: 'Workspace MEMORY.md',
        fileName: 'MEMORY.md',
        path: join(workspace, 'MEMORY.md'),
        content: 'Canonical workspace memory: run `pnpm test` from the workspace root for verification.',
        score: 3
      }
    ];

    const experimentalRun = assembleFixtureRun({
      db,
      projectId: project.id,
      workspace,
      query: 'What should I avoid and what verification command should I run?',
      mode: 'experimental',
      canonicalMemoryBlocks
    });
    const result = createFixtureResult({
      fixtureId: 'N2',
      mode: 'experimental',
      prompt: experimentalRun.prompt,
      traceSummary: createTraceSummary({
        workspace,
        mode: 'experimental',
        prompt: experimentalRun.prompt,
        canonicalMemoryBlocks: experimentalRun.context.memoryBlocks,
        generatedMemoryBlocks: experimentalRun.context.generatedMemoryBlocks,
        firstSubstantiveAction: 'Calling run_command pnpm test',
        repeatSteeringCount: 0
      }),
      scoreBreakdown: createScoreBreakdown(2, 2, 2, 2),
      reviewerNotes: ['Generated pitfall recall was present, but canonical workspace memory still controlled the command choice.']
    });

    expect(experimentalRun.context.memoryBlocks).toHaveLength(1);
    expect(experimentalRun.context.generatedMemoryBlocks).toHaveLength(1);
    expect(result.prompt).toContain('Canonical workspace memory: run `pnpm test`');
    expect(result.prompt).toContain('Avoid running verification from a nested folder; use the workspace root.');
    expect(result.traceSummary.firstSubstantiveAction).toBe('Calling run_command pnpm test');
    expect(result.pass).toBe(true);
  });

  it('N3 noisy memory suppression: experimental mode does not surface irrelevant generated recall', () => {
    const db = createDb();
    const workspace = createWorkspace({
      'AGENTS.md': 'Renderer must stay unprivileged.'
    });
    const project = db.createProject({
      name: 'Fixture N3',
      folderPath: workspace,
      trusted: true
    });
    const scopeKey = normalizeGeneratedMemoryWorkspaceScopeKey(workspace);
    seedItem(db, {
      workspaceScopeKey: scopeKey,
      projectId: project.id,
      kind: 'user_preference_workspace_scoped',
      summary: 'Marketing tone preference',
      detail: 'Keep client email replies warm and simple.',
      updatedAt: '2026-04-20T15:30:00.000Z'
    });

    const experimentalRun = assembleFixtureRun({
      db,
      projectId: project.id,
      workspace,
      query: 'Which file owns preload bridge typing?',
      mode: 'experimental'
    });
    const result = createFixtureResult({
      fixtureId: 'N3',
      mode: 'experimental',
      prompt: experimentalRun.prompt,
      traceSummary: createTraceSummary({
        workspace,
        mode: 'experimental',
        prompt: experimentalRun.prompt,
        canonicalMemoryBlocks: experimentalRun.context.memoryBlocks,
        generatedMemoryBlocks: experimentalRun.context.generatedMemoryBlocks,
        firstSubstantiveAction: 'Inspect the preload and shared typing seams',
        repeatSteeringCount: 0
      }),
      scoreBreakdown: createScoreBreakdown(2, 2, 2, 2),
      reviewerNotes: ['Irrelevant generated recall stayed out of the prompt for an unrelated preload question.']
    });

    expect(experimentalRun.context.generatedMemoryBlocks).toEqual([]);
    expect(result.prompt).not.toContain('Keep client email replies warm and simple.');
    expect(result.pass).toBe(true);
  });
});
