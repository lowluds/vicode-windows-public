import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DatabaseService } from '../../storage/database';
import { AutonomyInboxService } from './autonomy-inbox';
import { HeartbeatService } from './heartbeat';

describe('HeartbeatService', () => {
  const tempDirs: string[] = [];

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  function createDb() {
    const dir = mkdtempSync(join(tmpdir(), 'vicode-heartbeat-'));
    tempDirs.push(dir);
    const db = new DatabaseService(join(dir, 'vicode.sqlite'));
    db.migrate();
    return { db, dir };
  }

  it('starts the next heartbeat task for trusted projects when idle', async () => {
    const { db, dir } = createDb();
    const workspaceDir = mkdtempSync(join(dir, 'workspace-'));
    tempDirs.push(workspaceDir);
    const project = db.createProject({
      name: 'Trusted workspace',
      folderPath: workspaceDir,
      trusted: true
    });
    writeFileSync(join(workspaceDir, 'HEARTBEAT.md'), '- [ ] Validate onboarding copy\n', 'utf8');
    const inbox = new AutonomyInboxService(db);
    const jobs = {
      startAutonomyTask: vi.fn(async () => ({ job: null, runId: 'run-1', threadId: 'thread-1' }))
    };
    const heartbeat = new HeartbeatService(db, inbox, jobs as never, 60_000);

    await heartbeat.runNow();

    expect(jobs.startAutonomyTask).toHaveBeenCalledTimes(1);
    expect(jobs.startAutonomyTask).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: project.id,
        title: 'Validate onboarding copy'
      }),
      'heartbeat'
    );

    heartbeat.dispose();
    db.close();
  });

  it('skips heartbeat dispatch while the project already has an active thread', async () => {
    const { db, dir } = createDb();
    const workspaceDir = mkdtempSync(join(dir, 'workspace-'));
    tempDirs.push(workspaceDir);
    const project = db.createProject({
      name: 'Trusted workspace',
      folderPath: workspaceDir,
      trusted: true
    });
    writeFileSync(join(workspaceDir, 'HEARTBEAT.md'), '- [ ] Validate onboarding copy\n', 'utf8');
    const thread = db.createThread({
      projectId: project.id,
      title: 'Busy thread',
      providerId: 'openai',
      modelId: 'gpt-5'
    });
    db.updateThreadStatus(thread.id, 'running');
    const jobs = {
      startAutonomyTask: vi.fn(async () => ({ job: null, runId: 'run-1', threadId: 'thread-1' }))
    };
    const heartbeat = new HeartbeatService(db, new AutonomyInboxService(db), jobs as never, 60_000);

    await heartbeat.runNow();

    expect(jobs.startAutonomyTask).not.toHaveBeenCalled();

    heartbeat.dispose();
    db.close();
  });
});
