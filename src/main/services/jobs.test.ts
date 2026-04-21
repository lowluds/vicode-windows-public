import { EventEmitter } from 'node:events';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppEvent } from '../../shared/events';
import { DatabaseService } from '../../storage/database';
import {
  GeneratedMemoryService,
  getGeneratedMemoryScopeArtifactDir,
  normalizeGeneratedMemoryWorkspaceScopeKey
} from './generated-memory';
import { JobsService } from './jobs';
import { WorkspaceMemoryService } from './memory';
import { MemoryWritesService } from './memory-writes';

class ProviderManagerStub {
  private readonly emitter = new EventEmitter();
  nextSubmitError: Error | null = null;
  nextDelegatedRunError: Error | null = null;
  submitComposer = vi.fn(async (input: { projectId: string; threadId?: string }) => {
    if (this.nextSubmitError) {
      const error = this.nextSubmitError;
      this.nextSubmitError = null;
      throw error;
    }

    const thread = input.threadId
      ? dbRef!.getThread(input.threadId)
      : dbRef!.createThread({
          projectId: input.projectId,
          title: 'Generated thread',
          providerId: 'openai',
          modelId: 'gpt-5'
        });
    return {
      disposition: 'started' as const,
      thread,
      runId: 'run-1'
    };
  });
  startDelegatedBackgroundRun = vi.fn(
    async (input: { projectId: string; threadId?: string | null; title: string; providerId: string; modelId: string }) => {
      if (this.nextDelegatedRunError) {
        const error = this.nextDelegatedRunError;
        this.nextDelegatedRunError = null;
        throw error;
      }

      const thread = input.threadId
        ? dbRef!.getThread(input.threadId)
        : dbRef!.createThread({
            projectId: input.projectId,
            title: input.title,
            providerId: input.providerId as 'openai',
            modelId: input.modelId
          });

      return {
        thread,
        runId: 'delegated-run-1'
      };
    }
  );

  onEvent(listener: (event: AppEvent) => void) {
    this.emitter.on('event', listener);
    return () => this.emitter.off('event', listener);
  }

  emit(event: AppEvent) {
    this.emitter.emit('event', event);
  }
}

let dbRef: DatabaseService | null = null;

describe('JobsService', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    dbRef?.close();
    dbRef = null;
    while (tempDirs.length > 0) {
      const current = tempDirs.pop();
      if (current) {
        rmSync(current, { recursive: true, force: true });
      }
    }
  });

  function createDb() {
    const dir = mkdtempSync(join(tmpdir(), 'vicode-jobs-'));
    tempDirs.push(dir);
    const db = new DatabaseService(join(dir, 'vicode.sqlite'));
    db.migrate();
    dbRef = db;
    return db;
  }

  it('queues manual automation runs for review before execution', async () => {
    const db = createDb();
    const project = db.listProjects()[0]!;
    const automation = db.saveAutomation({
      name: 'Review automation',
      projectId: project.id,
      providerId: 'openai',
      modelId: 'gpt-5',
      promptTemplate: 'Check the repo',
      enabled: true,
      scheduleType: 'manual'
    });
    const providers = new ProviderManagerStub();
    const jobs = new JobsService(db, providers as never);

    const queued = await jobs.enqueueAutomationJob(automation.id, 'manual');

    expect(queued.alreadyPending).toBe(false);
    expect(queued.job.status).toBe('waiting_for_review');
    expect(queued.reviewItem.status).toBe('pending');
    expect(db.getAutomation(automation.id).status).toBe('waiting_for_review');

    jobs.dispose();
  });

  it('approves a review item and completes the linked job from provider events', async () => {
    const db = createDb();
    const project = db.listProjects()[0]!;
    const automation = db.saveAutomation({
      name: 'Run automation',
      projectId: project.id,
      providerId: 'openai',
      modelId: 'gpt-5',
      promptTemplate: 'Build it',
      enabled: true,
      scheduleType: 'manual'
    });
    const providers = new ProviderManagerStub();
    const jobs = new JobsService(db, providers as never);

    const queued = await jobs.enqueueAutomationJob(automation.id, 'manual');
    const approved = await jobs.approveReview(queued.reviewItem.id);

    expect(approved.job.status).toBe('running');
    expect(approved.reviewItem.status).toBe('approved');
    expect(approved.threadId).toBeTruthy();

    providers.emit({
      type: 'run.status',
      threadId: approved.threadId!,
      runId: approved.runId!,
      status: 'completed'
    });

    expect(db.getJob(approved.job.id).status).toBe('completed');
    expect(db.getAutomation(automation.id).status).toBe('completed');

    jobs.dispose();
  });

  it('rejects a pending automation review and cancels the linked job', async () => {
    const db = createDb();
    const project = db.listProjects()[0]!;
    const automation = db.saveAutomation({
      name: 'Rejected automation',
      projectId: project.id,
      providerId: 'openai',
      modelId: 'gpt-5',
      promptTemplate: 'Build it',
      enabled: true,
      scheduleType: 'manual'
    });
    const providers = new ProviderManagerStub();
    const jobs = new JobsService(db, providers as never);

    const queued = await jobs.enqueueAutomationJob(automation.id, 'manual');
    const rejected = jobs.rejectReview(queued.reviewItem.id);

    expect(rejected.job.status).toBe('cancelled');
    expect(rejected.reviewItem.status).toBe('rejected');
    expect(rejected.reviewItem.decision?.action).toBe('rejected');
    expect(db.getAutomation(automation.id).status).toBe('cancelled');
    expect(providers.submitComposer).not.toHaveBeenCalled();

    jobs.dispose();
  });

  it('restores the job to waiting_for_review if provider startup fails during approval', async () => {
    const db = createDb();
    const project = db.listProjects()[0]!;
    const automation = db.saveAutomation({
      name: 'Failing automation',
      projectId: project.id,
      providerId: 'openai',
      modelId: 'gpt-5',
      promptTemplate: 'Build it',
      enabled: true,
      scheduleType: 'manual'
    });
    const providers = new ProviderManagerStub();
    providers.nextSubmitError = new Error('provider startup failed');
    const jobs = new JobsService(db, providers as never);

    const queued = await jobs.enqueueAutomationJob(automation.id, 'manual');

    await expect(jobs.approveReview(queued.reviewItem.id)).rejects.toThrow('provider startup failed');

    expect(db.getJob(queued.job.id).status).toBe('waiting_for_review');
    expect(db.getReviewItem(queued.reviewItem.id).status).toBe('pending');

    jobs.dispose();
  });

  it('blocks duplicate queueing while an automation job is already active', async () => {
    const db = createDb();
    const project = db.listProjects()[0]!;
    const automation = db.saveAutomation({
      name: 'Single-run automation',
      projectId: project.id,
      providerId: 'openai',
      modelId: 'gpt-5',
      promptTemplate: 'Build it',
      enabled: true,
      scheduleType: 'manual'
    });
    const providers = new ProviderManagerStub();
    const jobs = new JobsService(db, providers as never);

    const queued = await jobs.enqueueAutomationJob(automation.id, 'manual');
    await jobs.approveReview(queued.reviewItem.id);

    await expect(jobs.enqueueAutomationJob(automation.id, 'manual')).rejects.toThrow(
      'already has an active job'
    );

    jobs.dispose();
  });

  it('writes a daily note immediately without starting a provider run', async () => {
    const db = createDb();
    const workspaceDir = mkdtempSync(join(tmpdir(), 'vicode-jobs-workspace-'));
    tempDirs.push(workspaceDir);
    const project = db.createProject({
      name: 'Trusted workspace',
      folderPath: workspaceDir,
      trusted: true
    });
    const thread = db.createThread({
      projectId: project.id,
      title: 'Capture daily memory',
      providerId: 'openai',
      modelId: 'gpt-5'
    });
    db.appendTurn(thread.id, 'user', 'Please keep today\'s focus in the daily note.');
    db.appendTurn(thread.id, 'assistant', 'I will draft that memory update for review.');

    const providers = new ProviderManagerStub();
    const memoryWrites = new MemoryWritesService(db, new WorkspaceMemoryService(db));
    const jobs = new JobsService(db, providers as never, memoryWrites);

    const applied = jobs.createDailyNoteReview(thread.id);

    expect(providers.submitComposer).not.toHaveBeenCalled();
    expect(applied.job.status).toBe('completed');
    expect(applied.reviewItem.status).toBe('approved');
    expect(String(applied.reviewItem.decision?.writtenPath ?? '')).toContain('memory');
    expect(existsSync(String(applied.reviewItem.decision?.writtenPath ?? ''))).toBe(true);
    expect(readFileSync(String(applied.reviewItem.decision?.writtenPath ?? ''), 'utf8')).toContain('Capture daily memory');

    jobs.dispose();
  });

  it('writes a MEMORY.md promotion immediately without starting a provider run', async () => {
    const db = createDb();
    const workspaceDir = mkdtempSync(join(tmpdir(), 'vicode-jobs-memory-workspace-'));
    tempDirs.push(workspaceDir);
    const project = db.createProject({
      name: 'Trusted workspace',
      folderPath: workspaceDir,
      trusted: true
    });
    const thread = db.createThread({
      projectId: project.id,
      title: 'Promote architecture decision',
      providerId: 'openai',
      modelId: 'gpt-5'
    });
    db.appendTurn(thread.id, 'user', 'The durable workspace files are now the canonical source of truth.');
    db.appendTurn(thread.id, 'assistant', 'That should be reviewed and promoted into MEMORY.md.');

    const providers = new ProviderManagerStub();
    const memoryWrites = new MemoryWritesService(db, new WorkspaceMemoryService(db));
    const jobs = new JobsService(db, providers as never, memoryWrites);

    const applied = jobs.createMemoryPromotionReview(thread.id);

    expect(providers.submitComposer).not.toHaveBeenCalled();
    expect(applied.job.status).toBe('completed');
    expect(applied.reviewItem.status).toBe('approved');
    expect(String(applied.reviewItem.decision?.writtenPath ?? '')).toContain('MEMORY.md');
    expect(existsSync(String(applied.reviewItem.decision?.writtenPath ?? ''))).toBe(true);
    expect(readFileSync(String(applied.reviewItem.decision?.writtenPath ?? ''), 'utf8')).toContain('canonical source of truth');

    jobs.dispose();
  });

  it('writes USER.md immediately without starting a provider run', async () => {
    const db = createDb();
    const workspaceDir = mkdtempSync(join(tmpdir(), 'vicode-jobs-user-workspace-'));
    tempDirs.push(workspaceDir);
    const project = db.createProject({
      name: 'Trusted workspace',
      folderPath: workspaceDir,
      trusted: true
    });
    const thread = db.createThread({
      projectId: project.id,
      title: 'Capture user collaboration preference',
      providerId: 'openai',
      modelId: 'gpt-5'
    });
    db.appendTurn(thread.id, 'user', 'Please keep answers concise and explain tradeoffs when the change is risky.');
    db.appendTurn(thread.id, 'assistant', 'That sounds like a USER.md candidate.');

    const providers = new ProviderManagerStub();
    const memoryWrites = new MemoryWritesService(db, new WorkspaceMemoryService(db));
    const jobs = new JobsService(db, providers as never, memoryWrites);

    const applied = jobs.createUserPreferenceReview(thread.id);

    expect(providers.submitComposer).not.toHaveBeenCalled();
    expect(applied.job.status).toBe('completed');
    expect(applied.reviewItem.status).toBe('approved');
    expect(String(applied.reviewItem.decision?.writtenPath ?? '')).toContain('USER.md');
    expect(existsSync(String(applied.reviewItem.decision?.writtenPath ?? ''))).toBe(true);
    expect(readFileSync(String(applied.reviewItem.decision?.writtenPath ?? ''), 'utf8')).toContain('Keep answers concise.');

    jobs.dispose();
  });

  it('silently reconciles stale pending memory review items on startup', () => {
    const db = createDb();
    const workspaceDir = mkdtempSync(join(tmpdir(), 'vicode-jobs-reconcile-workspace-'));
    tempDirs.push(workspaceDir);
    const project = db.createProject({
      name: 'Trusted workspace',
      folderPath: workspaceDir,
      trusted: true
    });
    const thread = db.createThread({
      projectId: project.id,
      title: 'Legacy pending review thread',
      providerId: 'openai',
      modelId: 'gpt-5'
    });
    const pendingJob = db.saveJob({
      projectId: project.id,
      sourceType: 'manual',
      sourceId: `user-preference:${thread.id}`,
      title: `Suggest USER.md update for "${thread.title}"`,
      status: 'waiting_for_review',
      threadId: thread.id
    });
    const pendingReview = db.addReviewItem({
      jobId: pendingJob.id,
      kind: 'manual_review',
      summary: `Review USER.md update for "${thread.title}"`,
      details: {
        actionType: 'user_preference',
        projectId: project.id,
        threadId: thread.id,
        threadTitle: thread.title,
        relativePath: 'USER.md',
        targetPath: join(workspaceDir, 'USER.md'),
        content: '# User Preferences\n\n## Notes\n\n- Durable preferences:\n  - Keep answers concise.'
      }
    });

    const providers = new ProviderManagerStub();
    const jobs = new JobsService(db, providers as never, new MemoryWritesService(db, new WorkspaceMemoryService(db)));

    expect(db.listPendingReviewItems()).toHaveLength(0);
    expect(db.getReviewItem(pendingReview.id).status).toBe('approved');
    expect(db.getJob(pendingJob.id).status).toBe('completed');
    expect(readFileSync(join(workspaceDir, 'USER.md'), 'utf8')).toContain('Keep answers concise.');

    jobs.dispose();
  });

  it('updates a pending manual review draft before approval', async () => {
    const db = createDb();
    const workspaceDir = mkdtempSync(join(tmpdir(), 'vicode-jobs-edit-review-workspace-'));
    tempDirs.push(workspaceDir);
    const project = db.createProject({
      name: 'Trusted workspace',
      folderPath: workspaceDir,
      trusted: true
    });
    const thread = db.createThread({
      projectId: project.id,
      title: 'Edit daily note before approval',
      providerId: 'openai',
      modelId: 'gpt-5'
    });
    db.appendTurn(thread.id, 'user', 'Capture the current review workflow in the daily note.');
    db.appendTurn(thread.id, 'assistant', 'I will prepare a daily note draft for review.');

    const providers = new ProviderManagerStub();
    const memoryWrites = new MemoryWritesService(db, new WorkspaceMemoryService(db));
    const jobs = new JobsService(db, providers as never, memoryWrites);

    const queuedJob = db.saveJob({
      projectId: project.id,
      sourceType: 'manual',
      sourceId: `daily-note:${thread.id}:manual-test`,
      title: 'Capture daily note',
      status: 'waiting_for_review',
      threadId: thread.id
    });
    const queued = db.addReviewItem({
      jobId: queuedJob.id,
      kind: 'manual_review',
      summary: 'Review daily note update',
      details: {
        actionType: 'daily_note_capture',
        projectId: project.id,
        threadId: thread.id,
        targetPath: join(workspaceDir, 'memory', `${new Date().toISOString().slice(0, 10)}.md`),
        content: '# Daily Workspace Note\n\n## Generated draft\n- Replace me.',
        relativePath: `memory/${new Date().toISOString().slice(0, 10)}.md`
      }
    });
    const updatedReview = jobs.updateManualReviewDraft(
      queued.id,
      '# Daily Workspace Note\n\n## Edited manually\n- Keep this custom draft instead of the generated one.'
    );
    const approved = await jobs.approveReview(updatedReview.id);

    expect(updatedReview.details.content).toContain('Keep this custom draft');
    expect(String(approved.reviewItem.decision?.writtenPath ?? '')).toContain('memory');
    expect(readFileSync(String(approved.reviewItem.decision?.writtenPath ?? ''), 'utf8')).toContain(
      'Keep this custom draft instead of the generated one.'
    );

    jobs.dispose();
  });

  it('starts a future-system heartbeat task as a delegated background run', async () => {
    const db = createDb();
    const workspaceDir = mkdtempSync(join(tmpdir(), 'vicode-jobs-heartbeat-workspace-'));
    tempDirs.push(workspaceDir);
    const project = db.createProject({
      name: 'Trusted workspace',
      folderPath: workspaceDir,
      trusted: true
    });
    const providers = new ProviderManagerStub();
    const jobs = new JobsService(db, providers as never);

    const started = await jobs.startAutonomyTask(
      {
        key: 'heartbeat:project-1:test',
        projectId: project.id,
        threadId: null,
        title: 'Verify onboarding copy',
        prompt: 'Work on the task.',
        source: 'heartbeat_file',
        delegationProfile: 'heartbeat',
        sourcePath: join(workspaceDir, 'HEARTBEAT.md')
      },
      'heartbeat'
    );

    expect(started?.job.status).toBe('running');
    expect(started?.threadId).toBeTruthy();
    expect(providers.startDelegatedBackgroundRun).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: project.id,
        title: 'Autonomy: Verify onboarding copy',
        delegationProfile: 'heartbeat'
      })
    );

    jobs.dispose();
  });

  it('auto-applies a daily note update after a meaningful completed run on a trusted workspace', () => {
    const db = createDb();
    const workspaceDir = mkdtempSync(join(tmpdir(), 'vicode-jobs-auto-daily-workspace-'));
    tempDirs.push(workspaceDir);
    const project = db.createProject({
      name: 'Trusted workspace',
      folderPath: workspaceDir,
      trusted: true
    });
    const thread = db.createThread({
      projectId: project.id,
      title: 'Long implementation thread',
      providerId: 'openai',
      modelId: 'gpt-5'
    });
    db.appendTurn(thread.id, 'user', 'Build the initial feature shell.');
    db.appendTurn(thread.id, 'assistant', 'I inspected the repo and started the feature shell.');
    db.appendTurn(thread.id, 'user', 'Now refine the data flow and verify the UI states.');
    db.appendTurn(thread.id, 'assistant', 'The core flow is working and the verification pass is complete.');

    const providers = new ProviderManagerStub();
    const memoryWrites = new MemoryWritesService(db, new WorkspaceMemoryService(db));
    const jobs = new JobsService(db, providers as never, memoryWrites);

    providers.emit({
      type: 'run.status',
      threadId: thread.id,
      runId: 'run-auto-daily',
      status: 'completed'
    });

    expect(db.listPendingReviewItems()).toHaveLength(0);
    const dailyJobs = db.listJobs().filter((job) => job.sourceId === `daily-note:${thread.id}:run-auto-daily`);
    expect(dailyJobs).toHaveLength(1);
    expect(dailyJobs[0]?.status).toBe('completed');
    expect(readFileSync(join(workspaceDir, 'memory', `${new Date().toISOString().slice(0, 10)}.md`), 'utf8')).toContain('Long implementation thread');
    expect(
      db.getThread(thread.id).rawOutput.some(
        (event) =>
          event.runId === 'run-auto-daily'
          && event.eventType === 'info'
          && String(event.payload?.activity && (event.payload.activity as { kind?: unknown }).kind) === 'memory_checkpoint'
      )
    ).toBe(true);

    jobs.dispose();
  });

  it('does not silently auto-apply MEMORY.md or USER.md even when the thread contains durable signals', () => {
    const db = createDb();
    const workspaceDir = mkdtempSync(join(tmpdir(), 'vicode-jobs-auto-memory-workspace-'));
    tempDirs.push(workspaceDir);
    const project = db.createProject({
      name: 'Trusted workspace',
      folderPath: workspaceDir,
      trusted: true
    });
    const thread = db.createThread({
      projectId: project.id,
      title: 'Durable guidance thread',
      providerId: 'openai',
      modelId: 'gpt-5'
    });
    db.appendTurn(thread.id, 'user', 'Please keep answers concise and explain tradeoffs when the change is risky.');
    db.appendTurn(thread.id, 'assistant', 'Understood. I will keep answers concise and explain tradeoffs when the change is risky.');
    db.appendTurn(thread.id, 'user', 'Remember this: the workspace files are the canonical source of truth and that workflow should remain the default.');
    db.appendTurn(thread.id, 'assistant', 'I will remember that the workspace files are the canonical source of truth and keep that workflow as the default.');

    const providers = new ProviderManagerStub();
    const memoryWrites = new MemoryWritesService(db, new WorkspaceMemoryService(db));
    const jobs = new JobsService(db, providers as never, memoryWrites);

    providers.emit({
      type: 'run.status',
      threadId: thread.id,
      runId: 'run-auto-memory',
      status: 'completed'
    });

    expect(db.listPendingReviewItems()).toHaveLength(0);
    expect(existsSync(join(workspaceDir, 'MEMORY.md'))).toBe(false);
    expect(existsSync(join(workspaceDir, 'USER.md'))).toBe(false);
    expect(
      db.listJobs()
        .filter((job) => job.threadId === thread.id && job.status === 'completed')
        .map((job) => job.sourceId)
        .sort()
    ).toEqual([`daily-note:${thread.id}:run-auto-memory`]);

    jobs.dispose();
  });

  it('does not auto-apply MEMORY.md or USER.md from a single early prompt with no lifecycle pressure', () => {
    const db = createDb();
    const workspaceDir = mkdtempSync(join(tmpdir(), 'vicode-jobs-early-prompt-workspace-'));
    tempDirs.push(workspaceDir);
    const project = db.createProject({
      name: 'Trusted workspace',
      folderPath: workspaceDir,
      trusted: true
    });
    const thread = db.createThread({
      projectId: project.id,
      title: 'Single prompt guidance thread',
      providerId: 'openai',
      modelId: 'gpt-5'
    });
    db.appendTurn(thread.id, 'user', 'Please keep answers concise and treat the workspace files as the canonical source of truth.');
    db.appendTurn(thread.id, 'assistant', 'Understood.');

    const providers = new ProviderManagerStub();
    const memoryWrites = new MemoryWritesService(db, new WorkspaceMemoryService(db));
    const jobs = new JobsService(db, providers as never, memoryWrites);

    providers.emit({
      type: 'run.status',
      threadId: thread.id,
      runId: 'run-early-guidance',
      status: 'completed'
    });

    expect(existsSync(join(workspaceDir, 'MEMORY.md'))).toBe(false);
    expect(existsSync(join(workspaceDir, 'USER.md'))).toBe(false);
    expect(db.listJobs().filter((job) => job.threadId === thread.id)).toHaveLength(0);

    jobs.dispose();
  });

  it('captures generated-memory candidates in shadow mode after a meaningful completed run', () => {
    const db = createDb();
    const workspaceDir = mkdtempSync(join(tmpdir(), 'vicode-jobs-generated-memory-workspace-'));
    const artifactsRoot = mkdtempSync(join(tmpdir(), 'vicode-jobs-generated-memory-artifacts-'));
    tempDirs.push(workspaceDir);
    tempDirs.push(artifactsRoot);
    const project = db.createProject({
      name: 'Trusted workspace',
      folderPath: workspaceDir,
      trusted: true
    });
    const thread = db.createThread({
      projectId: project.id,
      title: 'Shadow generated memory thread',
      providerId: 'openai',
      modelId: 'gpt-5'
    });
    db.appendTurn(thread.id, 'user', 'Please keep answers concise and explain tradeoffs when the change is risky.');
    db.appendTurn(thread.id, 'assistant', 'Use npm run smoke from the workspace root instead of the legacy nested path.');
    db.appendTurn(
      thread.id,
      'assistant',
      'Run `npm run smoke` from the workspace root as the default verification command for this workspace.'
    );

    const providers = new ProviderManagerStub();
    const memoryWrites = new MemoryWritesService(db, new WorkspaceMemoryService(db));
    const generatedMemory = new GeneratedMemoryService(db, artifactsRoot);
    const jobs = new JobsService(db, providers as never, memoryWrites, generatedMemory);

    providers.emit({
      type: 'run.status',
      threadId: thread.id,
      runId: 'run-generated-shadow',
      status: 'completed'
    });

    const workspaceScopeKey = normalizeGeneratedMemoryWorkspaceScopeKey(workspaceDir);
    const artifactDir = getGeneratedMemoryScopeArtifactDir(artifactsRoot, workspaceScopeKey);
    const candidates = db.listGeneratedMemoryCandidates(workspaceScopeKey);
    const items = db.listGeneratedMemoryItems(workspaceScopeKey);
    expect(candidates.map((candidate) => candidate.kind).sort()).toEqual([
      'known_pitfall',
      'user_preference_workspace_scoped',
      'workflow_preference'
    ]);
    expect(candidates.every((candidate) => candidate.status === 'consolidated')).toBe(true);
    expect(items.map((item) => item.kind).sort()).toEqual([
      'known_pitfall',
      'user_preference_workspace_scoped',
      'workflow_preference'
    ]);
    expect(readFileSync(join(artifactDir, 'generated-memory-summary.md'), 'utf8')).toContain('shadow mode active');
    expect(readFileSync(join(artifactDir, 'generated-memory-summary.md'), 'utf8')).toContain('Recallable consolidated items: 3');
    expect(readFileSync(join(artifactDir, 'generated-memory-items.md'), 'utf8')).toContain('derived_noncanonical');
    expect(readFileSync(join(artifactDir, 'generated-memory-evidence', `${thread.id}.md`), 'utf8')).toContain('Artifact subject: consolidated item');
    expect(readFileSync(join(artifactDir, 'generated-memory-evidence', `${thread.id}.md`), 'utf8')).toContain('legacy nested path');
    expect(readFileSync(join(artifactDir, 'generated-memory-evidence', `${thread.id}.md`), 'utf8')).toContain('default verification command');
    expect(db.listPendingReviewItems()).toHaveLength(0);
    expect(existsSync(join(workspaceDir, 'MEMORY.md'))).toBe(false);
    expect(existsSync(join(workspaceDir, 'USER.md'))).toBe(false);

    jobs.dispose();
  });

  it('skips generated-memory capture when generated-memory generation is disabled in preferences', () => {
    const db = createDb();
    const workspaceDir = mkdtempSync(join(tmpdir(), 'vicode-jobs-generated-memory-disabled-'));
    const artifactsRoot = mkdtempSync(join(tmpdir(), 'vicode-jobs-generated-memory-disabled-artifacts-'));
    tempDirs.push(workspaceDir, artifactsRoot);

    db.savePreferences({
      generatedMemoryGenerationEnabled: false
    });

    const project = db.createProject({
      name: 'Trusted workspace',
      folderPath: workspaceDir,
      trusted: true
    });
    const thread = db.createThread({
      projectId: project.id,
      title: 'Disabled generated memory thread',
      providerId: 'openai',
      modelId: 'gpt-5'
    });
    db.appendTurn(thread.id, 'user', 'Please keep answers concise and explain tradeoffs when the change is risky.');
    db.appendTurn(thread.id, 'assistant', 'Use npm run smoke from the workspace root instead of the legacy nested path.');

    const providers = new ProviderManagerStub();
    const memoryWrites = new MemoryWritesService(db, new WorkspaceMemoryService(db));
    const generatedMemory = new GeneratedMemoryService(db, artifactsRoot);
    const jobs = new JobsService(db, providers as never, memoryWrites, generatedMemory);

    providers.emit({
      type: 'run.status',
      threadId: thread.id,
      runId: 'run-generated-disabled',
      status: 'completed'
    });

    const workspaceScopeKey = normalizeGeneratedMemoryWorkspaceScopeKey(workspaceDir);
    expect(db.listGeneratedMemoryCandidates(workspaceScopeKey)).toEqual([]);
    expect(db.listGeneratedMemoryItems(workspaceScopeKey)).toEqual([]);

    jobs.dispose();
  });

  it('auto-applies a daily note update when a completed run finishes under high context pressure', () => {
    const db = createDb();
    const workspaceDir = mkdtempSync(join(tmpdir(), 'vicode-jobs-context-pressure-workspace-'));
    tempDirs.push(workspaceDir);
    const project = db.createProject({
      name: 'Trusted workspace',
      folderPath: workspaceDir,
      trusted: true
    });
    const thread = db.createThread({
      projectId: project.id,
      title: 'Short but crowded thread',
      providerId: 'openai',
      modelId: 'gpt-5.4'
    });
    db.appendTurn(thread.id, 'user', 'Continue the controller task.');
    db.addRunEvent(thread.id, 'run-context-pressure', 'info', {
      contextWindow: {
        usedTokens: 810_000,
        providerEventType: 'result'
      }
    });

    const providers = new ProviderManagerStub();
    const memoryWrites = new MemoryWritesService(db, new WorkspaceMemoryService(db));
    const jobs = new JobsService(db, providers as never, memoryWrites);

    providers.emit({
      type: 'run.status',
      threadId: thread.id,
      runId: 'run-context-pressure',
      status: 'completed'
    });

    expect(db.listPendingReviewItems()).toHaveLength(0);
    expect(db.listJobs().some((job) => job.sourceId === `daily-note:${thread.id}:run-context-pressure` && job.status === 'completed')).toBe(true);

    jobs.dispose();
  });

  it('flushes a silent daily note before completion when context pressure reaches compaction risk', () => {
    const db = createDb();
    const workspaceDir = mkdtempSync(join(tmpdir(), 'vicode-jobs-pre-compaction-workspace-'));
    tempDirs.push(workspaceDir);
    const project = db.createProject({
      name: 'Trusted workspace',
      folderPath: workspaceDir,
      trusted: true
    });
    const thread = db.createThread({
      projectId: project.id,
      title: 'Pre-compaction memory flush thread',
      providerId: 'openai',
      modelId: 'gpt-5.4'
    });
    db.appendTurn(thread.id, 'user', 'Continue the implementation and keep the working contract intact.');
    db.appendTurn(thread.id, 'assistant', 'I am continuing the implementation and keeping the working contract intact.');

    const providers = new ProviderManagerStub();
    const memoryWrites = new MemoryWritesService(db, new WorkspaceMemoryService(db));
    const jobs = new JobsService(db, providers as never, memoryWrites);

    providers.emit({
      type: 'raw.event',
      event: db.addRunEvent(thread.id, 'run-pre-compaction', 'info', {
        contextWindow: {
          usedTokens: 810_000,
          providerEventType: 'result'
        }
      })
    });

    expect(db.listJobs().some((job) => job.sourceId === `daily-note:${thread.id}:run-pre-compaction` && job.status === 'completed')).toBe(true);
    expect(readFileSync(join(workspaceDir, 'memory', `${new Date().toISOString().slice(0, 10)}.md`), 'utf8')).toContain(
      'Pre-compaction memory flush thread'
    );

    providers.emit({
      type: 'run.status',
      threadId: thread.id,
      runId: 'run-pre-compaction',
      status: 'completed'
    });

    expect(
      db.listJobs()
        .filter((job) => job.threadId === thread.id && job.status === 'completed')
        .map((job) => job.sourceId)
        .sort()
    ).toEqual([`daily-note:${thread.id}:run-pre-compaction`]);

    jobs.dispose();
  });

  it('does not auto-queue durable reviews for untrusted workspaces even when the thread contains strong signals', () => {
    const db = createDb();
    const workspaceDir = mkdtempSync(join(tmpdir(), 'vicode-jobs-untrusted-workspace-'));
    tempDirs.push(workspaceDir);
    const project = db.createProject({
      name: 'Untrusted workspace',
      folderPath: workspaceDir,
      trusted: false
    });
    const thread = db.createThread({
      projectId: project.id,
      title: 'Untrusted durable guidance thread',
      providerId: 'openai',
      modelId: 'gpt-5'
    });
    db.appendTurn(thread.id, 'user', 'Please keep answers concise and treat MEMORY.md as canonical.');
    db.appendTurn(thread.id, 'assistant', 'That should stay the canonical source of truth.');

    const providers = new ProviderManagerStub();
    const memoryWrites = new MemoryWritesService(db, new WorkspaceMemoryService(db));
    const jobs = new JobsService(db, providers as never, memoryWrites);

    providers.emit({
      type: 'run.status',
      threadId: thread.id,
      runId: 'run-untrusted-memory',
      status: 'completed'
    });

    expect(db.listPendingReviewItems()).toHaveLength(0);
    expect(db.listJobs().filter((job) => job.threadId === thread.id)).toHaveLength(0);

    jobs.dispose();
  });

  it('does not auto-apply duplicate daily note writes when the same completed signal is emitted twice', () => {
    const db = createDb();
    const workspaceDir = mkdtempSync(join(tmpdir(), 'vicode-jobs-duplicate-completed-workspace-'));
    tempDirs.push(workspaceDir);
    const project = db.createProject({
      name: 'Trusted workspace',
      folderPath: workspaceDir,
      trusted: true
    });
    const thread = db.createThread({
      projectId: project.id,
      title: 'Repeated completed durable guidance thread',
      providerId: 'openai',
      modelId: 'gpt-5'
    });
    db.appendTurn(thread.id, 'user', 'Build the initial feature shell.');
    db.appendTurn(thread.id, 'assistant', 'I inspected the repo and started the feature shell.');
    db.appendTurn(thread.id, 'user', 'Now refine the data flow and verify the UI states.');
    db.appendTurn(thread.id, 'assistant', 'The core flow is working and the verification pass is complete.');

    const providers = new ProviderManagerStub();
    const memoryWrites = new MemoryWritesService(db, new WorkspaceMemoryService(db));
    const jobs = new JobsService(db, providers as never, memoryWrites);

    providers.emit({
      type: 'run.status',
      threadId: thread.id,
      runId: 'run-auto-daily-repeat',
      status: 'completed'
    });
    providers.emit({
      type: 'run.status',
      threadId: thread.id,
      runId: 'run-auto-daily-repeat',
      status: 'completed'
    });

    expect(db.listPendingReviewItems()).toHaveLength(0);
    expect(
      db.listJobs()
        .filter((job) => job.threadId === thread.id && job.status === 'completed')
        .map((job) => job.sourceId)
        .sort()
    ).toEqual([`daily-note:${thread.id}:run-auto-daily-repeat`]);
    expect(existsSync(join(workspaceDir, 'MEMORY.md'))).toBe(false);
    expect(existsSync(join(workspaceDir, 'USER.md'))).toBe(false);

    jobs.dispose();
  });
});
