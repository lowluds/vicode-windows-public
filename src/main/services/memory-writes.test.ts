import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DatabaseService } from '../../storage/database';
import { WorkspaceMemoryService } from './memory';
import { MemoryWritesService } from './memory-writes';

describe('MemoryWritesService', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    while (tempDirs.length > 0) {
      const current = tempDirs.pop();
      if (current) {
        rmSync(current, { recursive: true, force: true });
      }
    }
  });

  function createTempDir(prefix: string) {
    const dir = mkdtempSync(join(tmpdir(), prefix));
    tempDirs.push(dir);
    return dir;
  }

  function createDb() {
    const dir = createTempDir('vicode-memory-writes-db-');
    const db = new DatabaseService(join(dir, 'vicode.sqlite'));
    db.migrate();
    return db;
  }

  it('creates a reviewable daily note draft and writes it on approval', () => {
    const db = createDb();
    const workspaceDir = createTempDir('vicode-memory-writes-workspace-');
    const project = db.createProject({
      name: 'Workspace project',
      folderPath: workspaceDir,
      trusted: true
    });
    const thread = db.createThread({
      projectId: project.id,
      title: 'Ship the memory review flow',
      providerId: 'openai',
      modelId: 'gpt-5'
    });
    db.appendTurn(thread.id, 'user', 'Please remember that this project prioritizes durable file-based memory.');
    db.appendTurn(thread.id, 'assistant', 'I will propose a daily note update for review.');

    const memory = new WorkspaceMemoryService(db);
    const refreshWorkspaceMemory = vi.spyOn(memory, 'refreshWorkspaceMemory');
    const service = new MemoryWritesService(db, memory);

    const created = service.createDailyNoteReview(thread.id);

    expect(created.alreadyPending).toBe(false);
    expect(created.job.sourceType).toBe('manual');
    expect(created.reviewItem.details.actionType).toBe('daily_note_capture');
    expect(String(created.reviewItem.details.relativePath)).toMatch(/^memory[\\/]\d{4}-\d{2}-\d{2}\.md$/u);
    expect(String(created.reviewItem.details.content)).toContain('Ship the memory review flow');
    expect(String(created.reviewItem.details.content)).toContain('## Session:');
    expect(String(created.reviewItem.details.content)).toContain('### User Context');
    expect(String(created.reviewItem.details.content)).toContain('Latest user request');
    expect(String(created.reviewItem.details.content)).toContain('- Source: vicode');
    expect(String(created.reviewItem.details.content)).not.toContain('Latest assistant update');

    const writtenPath = service.applyReview(created.reviewItem);

    expect(existsSync(writtenPath)).toBe(true);
    expect(readFileSync(writtenPath, 'utf8')).toContain('# Daily Memory Log');
    expect(readFileSync(writtenPath, 'utf8')).not.toContain('Latest assistant update');
    expect(refreshWorkspaceMemory).toHaveBeenCalledWith(project.id, workspaceDir, true);

    db.close();
  });

  it('creates a reviewable MEMORY.md promotion draft and writes it on approval', () => {
    const db = createDb();
    const workspaceDir = createTempDir('vicode-memory-promotion-workspace-');
    const project = db.createProject({
      name: 'Workspace project',
      folderPath: workspaceDir,
      trusted: true
    });
    const thread = db.createThread({
      projectId: project.id,
      title: 'Adopt durable workspace memory',
      providerId: 'openai',
      modelId: 'gpt-5'
    });
    db.appendTurn(thread.id, 'user', 'We are standardizing on Markdown files as the canonical memory source of truth.');
    db.appendTurn(thread.id, 'assistant', 'That should be promoted into durable workspace memory after review.');

    const memory = new WorkspaceMemoryService(db);
    const refreshWorkspaceMemory = vi.spyOn(memory, 'refreshWorkspaceMemory');
    const service = new MemoryWritesService(db, memory);

    const created = service.createMemoryPromotionReview(thread.id);

    expect(created.alreadyPending).toBe(false);
    expect(created.job.sourceType).toBe('manual');
    expect(created.reviewItem.details.actionType).toBe('memory_promotion');
    expect(String(created.reviewItem.details.relativePath)).toBe('MEMORY.md');
    expect(String(created.reviewItem.details.content)).toContain('# Durable Workspace Memory');
    expect(String(created.reviewItem.details.content)).toContain('## Durable Decisions');
    expect(String(created.reviewItem.details.content)).toContain('Markdown files as the canonical memory source of truth');

    const writtenPath = service.applyReview(created.reviewItem);

    expect(existsSync(writtenPath)).toBe(true);
    expect(readFileSync(writtenPath, 'utf8')).toContain('Markdown files as the canonical memory source of truth');
    expect(refreshWorkspaceMemory).toHaveBeenCalledWith(project.id, workspaceDir, true);

    db.close();
  });

  it('creates a reviewable USER.md draft and writes it on approval', () => {
    const db = createDb();
    const workspaceDir = createTempDir('vicode-user-preference-workspace-');
    const project = db.createProject({
      name: 'Workspace project',
      folderPath: workspaceDir,
      trusted: true
    });
    const thread = db.createThread({
      projectId: project.id,
      title: 'Refine collaboration style',
      providerId: 'openai',
      modelId: 'gpt-5'
    });
    db.appendTurn(thread.id, 'user', 'Please keep answers concise and explain why before larger changes.');
    db.appendTurn(thread.id, 'assistant', 'I will suggest a USER.md update for review.');

    const memory = new WorkspaceMemoryService(db);
    const refreshWorkspaceMemory = vi.spyOn(memory, 'refreshWorkspaceMemory');
    const service = new MemoryWritesService(db, memory);

    const created = service.createUserPreferenceReview(thread.id);

    expect(created.alreadyPending).toBe(false);
    expect(created.job.sourceType).toBe('manual');
    expect(created.reviewItem.details.actionType).toBe('user_preference');
    expect(String(created.reviewItem.details.relativePath)).toBe('USER.md');
    expect(String(created.reviewItem.details.content)).toContain('# User Preferences');
    expect(String(created.reviewItem.details.content)).toContain('Keep answers concise.');
    expect(String(created.reviewItem.details.content)).not.toContain('Please keep answers concise and explain why before larger changes.');

    const writtenPath = service.applyReview(created.reviewItem);

    expect(existsSync(writtenPath)).toBe(true);
    expect(readFileSync(writtenPath, 'utf8')).toContain('Keep answers concise.');
    expect(refreshWorkspaceMemory).toHaveBeenCalledWith(project.id, workspaceDir, true);

    db.close();
  });

  it('refuses to promote a raw task request into USER.md when no stable preference clause exists', () => {
    const db = createDb();
    const workspaceDir = createTempDir('vicode-user-noise-workspace-');
    const project = db.createProject({
      name: 'Workspace project',
      folderPath: workspaceDir,
      trusted: true
    });
    const thread = db.createThread({
      projectId: project.id,
      title: 'Task-only thread',
      providerId: 'openai',
      modelId: 'gpt-5'
    });
    db.appendTurn(thread.id, 'user', 'Analyze the HTML, CSS, and JS from this page and build a simple one-page parody of it.');

    const service = new MemoryWritesService(db, new WorkspaceMemoryService(db));

    expect(() => service.createUserPreferenceReview(thread.id)).toThrow(
      'Thread "Task-only thread" does not contain a user preference candidate to save.'
    );

    db.close();
  });

  it('extracts a durable workspace rule instead of copying the full latest request into MEMORY.md', () => {
    const db = createDb();
    const workspaceDir = createTempDir('vicode-memory-structured-workspace-');
    const project = db.createProject({
      name: 'Workspace project',
      folderPath: workspaceDir,
      trusted: true
    });
    const thread = db.createThread({
      projectId: project.id,
      title: 'Structured memory thread',
      providerId: 'openai',
      modelId: 'gpt-5'
    });
    db.appendTurn(
      thread.id,
      'user',
      'Please keep answers concise, explain tradeoffs, and treat the workspace files as the canonical source of truth.'
    );
    db.appendTurn(thread.id, 'assistant', 'Understood. That workflow should remain the canonical source of truth going forward.');

    const service = new MemoryWritesService(db, new WorkspaceMemoryService(db));
    const created = service.createMemoryPromotionReview(thread.id);
    const content = String(created.reviewItem.details.content);

    expect(content).toContain('Treat the workspace files as the canonical source of truth.');
    expect(content).not.toContain('Please keep answers concise, explain tradeoffs');

    db.close();
  });

  it('dedupes an existing durable memory bullet instead of appending it again', () => {
    const db = createDb();
    const workspaceDir = createTempDir('vicode-memory-dedupe-workspace-');
    writeFileSync(
      join(workspaceDir, 'MEMORY.md'),
      '# Durable Workspace Memory\n\n## Durable Decisions\n- We are standardizing on Markdown files as the canonical memory source of truth.\n',
      'utf8'
    );
    const project = db.createProject({
      name: 'Workspace project',
      folderPath: workspaceDir,
      trusted: true
    });
    const thread = db.createThread({
      projectId: project.id,
      title: 'Duplicate memory signal',
      providerId: 'openai',
      modelId: 'gpt-5'
    });
    db.appendTurn(thread.id, 'user', 'We are standardizing on Markdown files as the canonical memory source of truth.');

    const service = new MemoryWritesService(db, new WorkspaceMemoryService(db));
    const created = service.createMemoryPromotionReview(thread.id);

    expect(String(created.reviewItem.details.content).match(/canonical memory source of truth/gu)?.length ?? 0).toBe(1);

    db.close();
  });

  it('dedupes an existing USER.md preference instead of appending it again', () => {
    const db = createDb();
    const workspaceDir = createTempDir('vicode-user-dedupe-workspace-');
    writeFileSync(
      join(workspaceDir, 'USER.md'),
      '# User Preferences\n\n## Notes\n\n- Durable preferences:\n  - Please keep answers concise and explain why before larger changes.\n',
      'utf8'
    );
    const project = db.createProject({
      name: 'Workspace project',
      folderPath: workspaceDir,
      trusted: true
    });
    const thread = db.createThread({
      projectId: project.id,
      title: 'Duplicate user preference',
      providerId: 'openai',
      modelId: 'gpt-5'
    });
    db.appendTurn(thread.id, 'user', 'Please keep answers concise and explain why before larger changes.');

    const service = new MemoryWritesService(db, new WorkspaceMemoryService(db));
    const created = service.createUserPreferenceReview(thread.id);

    expect(String(created.reviewItem.details.content).match(/Please keep answers concise and explain why before larger changes/gu)?.length ?? 0).toBe(1);

    db.close();
  });

  it('creates daily note review drafts when a folder is attached, even if legacy trust is false', () => {
    const db = createDb();
    const workspaceDir = createTempDir('vicode-memory-untrusted-workspace-');
    const project = db.createProject({
      name: 'Untrusted workspace',
      folderPath: workspaceDir,
      trusted: false
    });
    const thread = db.createThread({
      projectId: project.id,
      title: 'Blocked daily note',
      providerId: 'openai',
      modelId: 'gpt-5'
    });
    db.appendTurn(thread.id, 'user', 'Please remember this in the daily note.');

    const service = new MemoryWritesService(db, new WorkspaceMemoryService(db));

    const created = service.createDailyNoteReview(thread.id);

    expect(created.alreadyPending).toBe(false);
    expect(created.reviewItem.details.actionType).toBe('daily_note_capture');
    expect(db.listJobs()).toHaveLength(1);
    expect(db.listPendingReviewItems()).toHaveLength(1);

    db.close();
  });

  it('blocks durable memory and user preference drafts when the workspace folder is missing', () => {
    const db = createDb();
    const project = db.createProject({
      name: 'No workspace folder',
      folderPath: null,
      trusted: true
    });
    const thread = db.createThread({
      projectId: project.id,
      title: 'Missing workspace folder',
      providerId: 'openai',
      modelId: 'gpt-5'
    });
    db.appendTurn(thread.id, 'user', 'Keep answers concise and explain why before larger changes.');
    db.appendTurn(thread.id, 'assistant', 'Markdown files stay canonical.');

    const service = new MemoryWritesService(db, new WorkspaceMemoryService(db));

    expect(() => service.createMemoryPromotionReview(thread.id)).toThrow(
      'Memory promotion requires a project with a real workspace folder.'
    );
    expect(() => service.createUserPreferenceReview(thread.id)).toThrow(
      'USER.md updates require a project with a real workspace folder.'
    );
    expect(db.listJobs()).toHaveLength(0);
    expect(db.listPendingReviewItems()).toHaveLength(0);

    db.close();
  });
});
