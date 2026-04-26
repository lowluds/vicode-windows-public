import { existsSync, mkdtempSync, readFileSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DatabaseService } from '../../storage/database';
import {
  GeneratedMemoryService,
  getGeneratedMemoryScopeArtifactDir,
  normalizeGeneratedMemoryWorkspaceScopeKey
} from './generated-memory';

describe('GeneratedMemoryService', () => {
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
    const dir = mkdtempSync(join(tmpdir(), 'vicode-generated-memory-service-'));
    tempDirs.push(dir);
    const db = new DatabaseService(join(dir, 'vicode.sqlite'));
    db.migrate();
    dbs.push(db);
    return { db, dir };
  }

  it('captures conservative generated-memory candidates and evidence for a trusted workspace thread', () => {
    const { db, dir } = createDb();
    const workspaceDir = join(dir, 'workspace');
    const artifactsRoot = join(dir, 'state', 'generated-memory');
    const project = db.createProject({
      name: 'Trusted workspace',
      folderPath: workspaceDir,
      trusted: true
    });
    const thread = db.createThread({
      projectId: project.id,
      title: 'Stable workflow guidance',
      providerId: 'openai',
      modelId: 'gpt-5'
    });
    db.appendTurn(thread.id, 'user', 'Please keep answers concise and explain tradeoffs when the change is risky.', null, 'run-1');
    db.appendTurn(thread.id, 'assistant', 'Use npm run smoke from the workspace root instead of the legacy nested path.', null, 'run-1');
    db.appendTurn(
      thread.id,
      'assistant',
      'Run `npm run smoke` from the workspace root as the default verification command for this workspace.',
      null,
      'run-1'
    );
    db.appendTurn(thread.id, 'assistant', 'The app uses Electron, React, and SQLite.', null, 'run-1');

    const service = new GeneratedMemoryService(db, artifactsRoot);
    const candidates = service.captureThreadCandidates(thread.id, 'run-1');
    const workspaceScopeKey = normalizeGeneratedMemoryWorkspaceScopeKey(workspaceDir);
    const artifactDir = getGeneratedMemoryScopeArtifactDir(artifactsRoot, workspaceScopeKey);

    expect(candidates.map((candidate) => candidate.kind).sort()).toEqual([
      'architecture_fact',
      'known_pitfall',
      'user_preference_workspace_scoped',
      'workflow_preference'
    ]);
    const storedCandidates = db.listGeneratedMemoryCandidates(workspaceScopeKey);
    const storedItems = db.listGeneratedMemoryItems(workspaceScopeKey);
    expect(storedCandidates).toHaveLength(4);
    expect(storedCandidates.every((candidate) => candidate.status === 'consolidated')).toBe(true);
    expect(storedItems).toHaveLength(4);
    expect(db.listGeneratedMemoryEvidenceForCandidate(candidates[0]!.id)).toHaveLength(1);
    expect(db.listGeneratedMemoryEvidenceForItem(storedItems[0]!.id)).toHaveLength(1);
    expect(readFileSync(join(artifactDir, 'generated-memory-summary.md'), 'utf8')).toContain('shadow mode active');
    expect(readFileSync(join(artifactDir, 'generated-memory-summary.md'), 'utf8')).toContain(workspaceScopeKey);
    expect(readFileSync(join(artifactDir, 'generated-memory-summary.md'), 'utf8')).toContain('Recallable consolidated items: 4');
    expect(readFileSync(join(artifactDir, 'generated-memory-items.md'), 'utf8')).toContain('Authority: `derived_noncanonical`');
    expect(readFileSync(join(artifactDir, 'generated-memory-items.md'), 'utf8')).toContain('Workflow preference');
    expect(readdirSync(join(artifactDir, 'generated-memory-evidence'))).toHaveLength(1);
    expect(readFileSync(join(artifactDir, 'generated-memory-evidence', `${thread.id}.md`), 'utf8')).toContain('Artifact subject: consolidated item');
    expect(readFileSync(join(artifactDir, 'generated-memory-evidence', `${thread.id}.md`), 'utf8')).toContain('Use npm run smoke from the workspace root');
    expect(readFileSync(join(artifactDir, 'generated-memory-evidence', `${thread.id}.md`), 'utf8')).toContain('default verification command');
    expect(existsSync(join(workspaceDir, 'MEMORY.md'))).toBe(false);
    expect(existsSync(join(workspaceDir, 'USER.md'))).toBe(false);
  });

  it('captures legacy false-trust projects but still skips too-short threads', () => {
    const { db, dir } = createDb();
    const untrustedWorkspaceDir = join(dir, 'workspace-untrusted');
    const trustedWorkspaceDir = join(dir, 'workspace-trusted');
    const untrustedProject = db.createProject({
      name: 'Untrusted workspace',
      folderPath: untrustedWorkspaceDir,
      trusted: false
    });
    const trustedProject = db.createProject({
      name: 'Trusted workspace',
      folderPath: trustedWorkspaceDir,
      trusted: true
    });
    const untrustedThread = db.createThread({
      projectId: untrustedProject.id,
      title: 'Untrusted thread',
      providerId: 'openai',
      modelId: 'gpt-5'
    });
    db.appendTurn(untrustedThread.id, 'user', 'Please keep answers concise.', null, 'run-untrusted');
    db.appendTurn(untrustedThread.id, 'assistant', 'Understood.', null, 'run-untrusted');
    const shortTrustedThread = db.createThread({
      projectId: trustedProject.id,
      title: 'Short trusted thread',
      providerId: 'openai',
      modelId: 'gpt-5'
    });
    db.appendTurn(shortTrustedThread.id, 'user', 'Please keep answers concise.', null, 'run-short');

    const service = new GeneratedMemoryService(db);

    expect(service.captureThreadCandidates(untrustedThread.id, 'run-untrusted')).toEqual([
      expect.objectContaining({
        kind: 'user_preference_workspace_scoped',
        detail: 'Keep answers concise.'
      })
    ]);
    expect(service.captureThreadCandidates(shortTrustedThread.id, 'run-short')).toEqual([]);
  });

  it('keeps long command workflow memory while rejecting question-shaped clauses', () => {
    const { db, dir } = createDb();
    const workspaceDir = join(dir, 'workspace');
    const project = db.createProject({
      name: 'Trusted workspace',
      folderPath: workspaceDir,
      trusted: true
    });
    const thread = db.createThread({
      projectId: project.id,
      title: 'Live signal source thread',
      providerId: 'openai',
      modelId: 'gpt-5'
    });
    db.appendTurn(
      thread.id,
      'user',
      'What first verification command should we use for generated-memory trace slices in this workspace?',
      null,
      'run-live'
    );
    db.appendTurn(
      thread.id,
      'assistant',
      'Workflow preference: for generated-memory trace slices in this workspace, start with `npx vitest run src/main/services/generated-memory-provider-path.test.ts src/main/services/provider-manager.test.ts src/main/services/diagnostics.test.ts --reporter=verbose` before broader checks.',
      null,
      'run-live'
    );
    db.appendTurn(thread.id, 'user', 'Is there anything we should avoid doing first?', null, 'run-live');
    db.appendTurn(
      thread.id,
      'assistant',
      'Known pitfall: do not start with `npm test` for generated-memory trace slices in this workspace because unrelated secondary-provider suites can fail and hide whether the trace change worked.',
      null,
      'run-live'
    );

    const service = new GeneratedMemoryService(db);
    const candidates = service.captureThreadCandidates(thread.id, 'run-live');
    const kinds = candidates.map((candidate) => candidate.kind).sort();
    const details = candidates.map((candidate) => candidate.detail);

    expect(kinds).toEqual(['known_pitfall', 'workflow_preference']);
    expect(details).not.toContain('Is there anything we should avoid doing first?');
    expect(details.some((detail) => detail.includes('generated-memory-provider-path.test.ts'))).toBe(true);
    expect(details.some((detail) => detail.includes('do not start with `npm test`'))).toBe(true);
  });

  it('merges evidence when the same generated-memory candidate reappears in a later thread', () => {
    const { db, dir } = createDb();
    const workspaceDir = join(dir, 'workspace');
    const project = db.createProject({
      name: 'Trusted workspace',
      folderPath: workspaceDir,
      trusted: true
    });
    const firstThread = db.createThread({
      projectId: project.id,
      title: 'First workflow thread',
      providerId: 'openai',
      modelId: 'gpt-5'
    });
    db.appendTurn(firstThread.id, 'user', 'Continue the release slice.', null, 'run-first');
    db.appendTurn(firstThread.id, 'assistant', 'Use npm run smoke from the workspace root instead of the legacy nested path.', null, 'run-first');

    const secondThread = db.createThread({
      projectId: project.id,
      title: 'Second workflow thread',
      providerId: 'openai',
      modelId: 'gpt-5'
    });
    db.appendTurn(secondThread.id, 'user', 'Continue the verification slice.', null, 'run-second');
    db.appendTurn(secondThread.id, 'assistant', 'Use npm run smoke from the workspace root instead of the legacy nested path.', null, 'run-second');

    const service = new GeneratedMemoryService(db);
    service.captureThreadCandidates(firstThread.id, 'run-first');
    const secondPass = service.captureThreadCandidates(secondThread.id, 'run-second');
    const workspaceScopeKey = normalizeGeneratedMemoryWorkspaceScopeKey(workspaceDir);
    const candidates = db.listGeneratedMemoryCandidates(workspaceScopeKey);
    const items = db.listGeneratedMemoryItems(workspaceScopeKey);
    const pitfallCandidate = candidates.find((candidate) => candidate.kind === 'known_pitfall');
    const pitfallItem = items.find((item) => item.kind === 'known_pitfall');

    expect(secondPass).toHaveLength(1);
    expect(candidates).toHaveLength(1);
    expect(items).toHaveLength(1);
    expect(pitfallCandidate?.status).toBe('consolidated');
    expect(pitfallCandidate?.sourceThreadId).toBe(secondThread.id);
    expect(db.listGeneratedMemoryEvidenceForCandidate(pitfallCandidate!.id)).toHaveLength(2);
    expect(pitfallItem?.sourceCandidateIds).toEqual([pitfallCandidate!.id]);
    expect(db.listGeneratedMemoryEvidenceForItem(pitfallItem!.id)).toHaveLength(2);
  });
});
