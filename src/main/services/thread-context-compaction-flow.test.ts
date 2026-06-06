import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DatabaseService } from '../../storage/database';
import { deriveRunTranscriptItemsMap } from '../../renderer/lib/run-activity';
import { buildEffectivePrompt } from './provider-manager-prompt-builder';
import { ThreadContextCompactionService } from './thread-context-compaction-service';
import { ThreadContextCompactionTriggerService } from './thread-context-compaction-trigger';
import type { WorkspaceContextResult } from './workspace-context';

const cleanupPaths: string[] = [];
const cleanupDatabases: DatabaseService[] = [];

afterEach(async () => {
  while (cleanupDatabases.length > 0) {
    cleanupDatabases.pop()?.close();
  }

  while (cleanupPaths.length > 0) {
    const target = cleanupPaths.pop();
    if (target) {
      await rm(target, { recursive: true, force: true });
    }
  }
});

async function createTestDatabase() {
  const dir = await mkdtemp(join(tmpdir(), 'vicode-thread-compaction-flow-'));
  cleanupPaths.push(dir);
  const db = new DatabaseService(join(dir, 'vicode.sqlite'));
  db.migrate();
  cleanupDatabases.push(db);
  return db;
}

function createWorkspaceContextResult(): WorkspaceContextResult {
  return {
    folderPath: null,
    trusted: false,
    providerId: 'ollama',
    blocks: [],
    memoryBlocks: [],
    generatedMemoryBlocks: [],
    projectKnowledgeBlocks: [],
    skillBlocks: [],
    runtimeSkillResources: [],
    selectedSkillIds: [],
    mentionedSkillIds: [],
    diagnostics: {
      durationMs: 0,
      workspaceInstructionReadMs: 0,
      skillResolutionMs: 0,
      runtimeSkillResolutionMs: 0,
      memoryRetrievalMs: 0,
      generatedMemoryRetrievalMs: 0,
      projectKnowledgeRetrievalMs: 0,
      blockCount: 0,
      memoryBlockCount: 0,
      generatedMemoryBlockCount: 0,
      projectKnowledgeBlockCount: 0,
      skillBlockCount: 0,
      runtimeSkillResourceCount: 0
    }
  };
}

describe('thread context compaction flow', () => {
  it('keeps trigger, storage, prompt overlay, transcript marker, and thread scope aligned', async () => {
    const db = await createTestDatabase();
    const project = db.createProject({
      name: 'Project',
      folderPath: 'C:\\workspace',
      trusted: true
    });
    const thread = db.createThread({
      projectId: project.id,
      providerId: 'ollama',
      modelId: 'qwen3-coder'
    });
    const otherThread = db.createThread({
      projectId: project.id,
      providerId: 'ollama',
      modelId: 'qwen3-coder'
    });

    db.appendTurn(thread.id, 'user', 'Older user request that should be represented by compact state.', null, 'run-old');
    for (let index = 0; index < 12; index += 1) {
      db.addRunEvent(thread.id, 'run-1', 'info', {
        activity: {
          kind: 'thinking',
          summary: `Older event ${index + 1}`,
          text: `Older event ${index + 1}`
        }
      });
    }

    db.createThreadCompaction({
      threadId: otherThread.id,
      sourceStartEventId: 'other-start',
      sourceEndEventId: 'other-end',
      summary: 'Other thread compact state should never leak.',
      providerId: 'ollama',
      modelId: 'qwen3-coder'
    });

    const summarize = vi.fn(async () => 'Thread compact state: keep the parser fix objective and pending verification.');
    const compactionService = new ThreadContextCompactionService({
      db,
      summarize
    });
    const trigger = new ThreadContextCompactionTriggerService({
      compactionService,
      onCompacted: ({ threadId, runId, compaction }) => {
        db.addRunEvent(threadId, runId, 'info', {
          message: 'Context automatically compacted',
          eventKind: 'tool_activity',
          transcriptVisible: true,
          activity: {
            kind: 'context_compaction',
            summary: 'Context automatically compacted',
            text: 'Older thread context was summarized so the run can continue within the model context window.',
            providerEventType: 'vicode_thread_context_compaction'
          },
          threadCompaction: {
            id: compaction.id,
            sourceStartEventId: compaction.sourceStartEventId,
            sourceEndEventId: compaction.sourceEndEventId
          }
        });
      }
    });

    const result = await trigger.maybeCreateFromContextUsage({
      threadId: thread.id,
      runId: 'run-1',
      providerId: 'ollama',
      modelId: 'qwen3-coder',
      contextWindow: {
        usedTokens: 30_200,
        inputTokens: 30_000,
        outputTokens: 200,
        providerEventType: 'ollama_chat_context_window_usage'
      }
    });

    expect(result.status).toBe('compacted');
    const latest = db.getLatestThreadCompaction(thread.id);
    expect(latest?.summary).toBe('Thread compact state: keep the parser fix objective and pending verification.');
    expect(db.getLatestThreadCompaction(otherThread.id)?.summary).toBe('Other thread compact state should never leak.');
    expect(summarize).toHaveBeenCalledWith(expect.objectContaining({
      thread: expect.objectContaining({ id: thread.id }),
      sourceEvents: expect.arrayContaining([
        expect.objectContaining({ threadId: thread.id })
      ])
    }));

    const prompt = buildEffectivePrompt(
      {
        providerId: 'ollama',
        prompt: 'Continue the work.'
      },
      createWorkspaceContextResult(),
      {
        thread: db.getThread(thread.id),
        threadCompaction: latest
      }
    );

    expect(prompt).toContain('Compacted thread state:');
    expect(prompt).toContain('Thread compact state: keep the parser fix objective and pending verification.');
    expect(prompt).not.toContain('Other thread compact state should never leak.');

    const transcriptItems = deriveRunTranscriptItemsMap(db.getThread(thread.id))['run-1'];
    expect(transcriptItems).toContainEqual(expect.objectContaining({
      kind: 'activity_line',
      activityKind: 'context_compaction',
      label: 'Context automatically compacted'
    }));
    expect(deriveRunTranscriptItemsMap(db.getThread(otherThread.id))['run-1']).toBeUndefined();
  });
});
