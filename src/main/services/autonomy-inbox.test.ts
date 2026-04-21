import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DatabaseService } from '../../storage/database';
import { AutonomyInboxService } from './autonomy-inbox';

describe('AutonomyInboxService', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  function createDb() {
    const dir = mkdtempSync(join(tmpdir(), 'vicode-autonomy-inbox-'));
    tempDirs.push(dir);
    const db = new DatabaseService(join(dir, 'vicode.sqlite'));
    db.migrate();
    return { db, dir };
  }

  it('selects unchecked heartbeat tasks from HEARTBEAT.md', () => {
    const { db, dir } = createDb();
    const workspaceDir = mkdtempSync(join(dir, 'workspace-'));
    tempDirs.push(workspaceDir);
    const project = db.createProject({
      name: 'Trusted workspace',
      folderPath: workspaceDir,
      trusted: true
    });
    writeFileSync(
      join(workspaceDir, 'HEARTBEAT.md'),
      ['# Heartbeat', '- [ ] Verify the release smoke flow', '- [x] Old task'].join('\n'),
      'utf8'
    );

    const inbox = new AutonomyInboxService(db);
    const item = inbox.selectNextProjectItem(project);

    expect(item).toEqual(
      expect.objectContaining({
        projectId: project.id,
        title: 'Verify the release smoke flow',
        source: 'heartbeat_file',
        delegationProfile: 'heartbeat'
      })
    );

    db.close();
  });

  it('maps role-tagged heartbeat tickets onto delegated profiles', () => {
    const { db, dir } = createDb();
    const workspaceDir = mkdtempSync(join(dir, 'workspace-'));
    tempDirs.push(workspaceDir);
    const project = db.createProject({
      name: 'Trusted workspace',
      folderPath: workspaceDir,
      trusted: true
    });
    writeFileSync(
      join(workspaceDir, 'HEARTBEAT.md'),
      ['# Heartbeat', '- [ ] [reviewer] Audit the latest provider-manager changes'].join('\n'),
      'utf8'
    );

    const inbox = new AutonomyInboxService(db);
    const item = inbox.selectNextProjectItem(project);

    expect(item).toEqual(
      expect.objectContaining({
        projectId: project.id,
        title: 'Reviewer: Audit the latest provider-manager changes',
        source: 'heartbeat_file',
        delegationProfile: 'verify'
      })
    );
    expect(item?.prompt).toContain('Assigned role: Reviewer');
    expect(item?.prompt).toContain('review the current implementation and note concrete findings before editing');

    db.close();
  });

  it('includes structured ticket sections in the generated heartbeat prompt', () => {
    const { db, dir } = createDb();
    const workspaceDir = mkdtempSync(join(dir, 'workspace-'));
    tempDirs.push(workspaceDir);
    const project = db.createProject({
      name: 'Trusted workspace',
      folderPath: workspaceDir,
      trusted: true
    });
    writeFileSync(
      join(workspaceDir, 'HEARTBEAT.md'),
      [
        '- [ ] [research] Compare current runtime flow to OpenClaw queue semantics',
        '  Goal: Produce exact insertion points for the next runtime hardening slice.',
        '  Why now: The queue needs source-backed tickets instead of generic cleanup work.',
        '  Acceptance:',
        '    - List the exact Vicode files that need to change next.',
        '    - Capture the OpenClaw behavior being adapted.',
        '  Verify:',
        '    - npm run build',
        '  Refs:',
        '    - docs/engineering/openclaw-source-analysis-2026-03-27.md',
        '  Stop when: The next implementation ticket can be written without guessing.'
      ].join('\n'),
      'utf8'
    );

    const inbox = new AutonomyInboxService(db);
    const item = inbox.selectNextProjectItem(project);

    expect(item?.delegationProfile).toBe('research');
    expect(item?.prompt).toContain('Goal: Produce exact insertion points for the next runtime hardening slice.');
    expect(item?.prompt).toContain('Why now: The queue needs source-backed tickets instead of generic cleanup work.');
    expect(item?.prompt).toContain('- List the exact Vicode files that need to change next.');
    expect(item?.prompt).toContain('- docs/engineering/openclaw-source-analysis-2026-03-27.md');
    expect(item?.prompt).toContain('Stop when: The next implementation ticket can be written without guessing.');

    db.close();
  });

  it('skips heartbeat tasks that already have a completed future-system job', () => {
    const { db, dir } = createDb();
    const workspaceDir = mkdtempSync(join(dir, 'workspace-'));
    tempDirs.push(workspaceDir);
    const project = db.createProject({
      name: 'Trusted workspace',
      folderPath: workspaceDir,
      trusted: true
    });
    writeFileSync(join(workspaceDir, 'HEARTBEAT.md'), '- [ ] Verify the release smoke flow\n', 'utf8');

    const inbox = new AutonomyInboxService(db);
    const first = inbox.selectNextProjectItem(project);
    expect(first).not.toBeNull();
    db.saveJob({
      projectId: project.id,
      sourceType: 'future_system',
      sourceId: first!.key,
      title: first!.title,
      status: 'completed'
    });

    expect(inbox.selectNextProjectItem(project)).toBeNull();

    db.close();
  });
});
