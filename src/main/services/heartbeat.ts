import { EventEmitter } from 'node:events';
import type { AppEvent } from '../../shared/events';
import { DatabaseService } from '../../storage/database';
import { AutonomyInboxService } from './autonomy-inbox';
import { JobsService } from './jobs';

const DEFAULT_HEARTBEAT_INTERVAL_MS = 30 * 60_000;

export class HeartbeatService {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private readonly emitter = new EventEmitter();

  constructor(
    private readonly db: DatabaseService,
    private readonly inbox: AutonomyInboxService,
    private readonly jobs: JobsService,
    private readonly intervalMs = DEFAULT_HEARTBEAT_INTERVAL_MS
  ) {}

  refresh() {
    this.disposeTimer();
    this.timer = setInterval(() => {
      void this.runNow();
    }, this.intervalMs);
    void this.runNow();
  }

  onEvent(listener: (event: AppEvent) => void) {
    this.emitter.on('event', listener);
    return () => this.emitter.off('event', listener);
  }

  dispose() {
    this.disposeTimer();
    this.emitter.removeAllListeners('event');
  }

  async runNow() {
    if (this.running) {
      return;
    }

    this.running = true;
    try {
      for (const project of this.db.listProjects()) {
        if (!project.trusted || !project.folderPath) {
          continue;
        }
        if (this.hasActiveThread(project.id)) {
          continue;
        }
        const item = this.inbox.selectNextProjectItem(project);
        if (!item) {
          continue;
        }
        const started = await this.jobs.startAutonomyTask(item, 'heartbeat');
        if (started) {
          this.emitter.emit('event', {
            type: 'app.notification',
            level: 'info',
            message: `Heartbeat started: ${item.title}`
          } satisfies AppEvent);
        }
      }
    } finally {
      this.running = false;
    }
  }

  private hasActiveThread(projectId: string) {
    return this.db
      .listThreads(projectId)
      .some((thread) => thread.status === 'queued' || thread.status === 'running' || thread.status === 'stopping' || thread.status === 'auth_required');
  }

  private disposeTimer() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
