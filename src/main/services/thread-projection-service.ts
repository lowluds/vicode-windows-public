import type { ThreadDetail, ThreadSummary } from '../../shared/domain';
import type { AppEvent } from '../../shared/events';
import { DatabaseService } from '../../storage/database';

export class ThreadProjectionService {
  constructor(
    private readonly db: DatabaseService,
    private readonly emit: (event: AppEvent) => void
  ) {}

  getThreadDetail(threadId: string): ThreadDetail {
    return this.db.getThread(threadId);
  }

  getThreadSummary(threadId: string): ThreadSummary {
    return this.db.getThreadSummary(threadId);
  }

  emitThread(threadId: string) {
    const thread = this.db.getThread(threadId);
    const summary = this.db.getThreadSummary(threadId);
    this.emit({ type: 'thread.detail', thread });
    this.emit({ type: 'thread.updated', thread: summary });
    return { thread, summary };
  }

  emitThreadDetail(threadId: string) {
    const thread = this.db.getThread(threadId);
    this.emit({ type: 'thread.detail', thread });
    return thread;
  }

  emitThreadSummary(threadId: string) {
    const thread = this.db.getThreadSummary(threadId);
    this.emit({ type: 'thread.updated', thread });
    return thread;
  }
}
