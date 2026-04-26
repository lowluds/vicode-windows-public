import { describe, expect, it, vi } from 'vitest';
import { startDeferredAppServices } from './startup';

describe('startDeferredAppServices', () => {
  it('starts deferred tasks and unsubscribes the provider relay on cleanup', async () => {
    const unsubscribe = vi.fn();
    const handleAppEvent = vi.fn();
    const reportTiming = vi.fn();
    const services = {
      updater: {
        initialize: vi.fn(async () => {})
      },
      providers: {
        resumeQueuedFollowUps: vi.fn(async () => {}),
        onEvent: vi.fn((listener: (event: unknown) => void) => {
          listener({ type: 'run.started', threadId: 'thread-1', runId: 'run-1' });
          return unsubscribe;
        })
      },
      automations: {
        refresh: vi.fn(async () => {})
      },
      heartbeat: {
        refresh: vi.fn(async () => {})
      },
      mcp: {
        initialize: vi.fn(async () => {})
      },
      collab: {
        handleAppEvent,
        initialize: vi.fn(async () => {})
      }
    };

    const cleanup = startDeferredAppServices(services as never, { reportTiming });
    await Promise.resolve();
    await Promise.resolve();

    expect(services.providers.resumeQueuedFollowUps).toHaveBeenCalledOnce();
    expect(services.updater.initialize).toHaveBeenCalledOnce();
    expect(services.mcp.initialize).toHaveBeenCalledOnce();
    expect(services.automations.refresh).toHaveBeenCalledOnce();
    expect(services.heartbeat.refresh).toHaveBeenCalledOnce();
    expect(reportTiming).toHaveBeenCalledWith('updater', expect.any(Number));
    expect(reportTiming).toHaveBeenCalledWith('providers', expect.any(Number));
    expect(reportTiming).toHaveBeenCalledWith('mcp', expect.any(Number));
    expect(reportTiming).toHaveBeenCalledWith('automations', expect.any(Number));
    expect(reportTiming).toHaveBeenCalledWith('heartbeat', expect.any(Number));
    expect(services.collab.initialize).not.toHaveBeenCalled();
    expect(handleAppEvent).not.toHaveBeenCalled();

    cleanup();
    expect(unsubscribe).not.toHaveBeenCalled();
  });

  it('reports deferred startup failures through the supplied reporter', async () => {
    const reportError = vi.fn();
    const services = {
      updater: {
        initialize: vi.fn(async () => {
          throw new Error('updater failed');
        })
      },
      providers: {
        resumeQueuedFollowUps: vi.fn(async () => {
          throw new Error('resume failed');
        }),
        onEvent: vi.fn(() => vi.fn())
      },
      automations: {
        refresh: vi.fn(async () => {
          throw new Error('automations failed');
        })
      },
      heartbeat: {
        refresh: vi.fn(async () => {
          throw new Error('heartbeat failed');
        })
      },
      mcp: {
        initialize: vi.fn(async () => {
          throw new Error('mcp failed');
        })
      },
      collab: {
        handleAppEvent: vi.fn(),
        initialize: vi.fn(async () => {
          throw new Error('collab failed');
        })
      }
    };

    const cleanup = startDeferredAppServices(services as never, { reportError });
    await Promise.resolve();
    await Promise.resolve();

    expect(reportError).toHaveBeenCalledWith('updater', expect.any(Error));
    expect(reportError).toHaveBeenCalledWith('providers', expect.any(Error));
    expect(reportError).toHaveBeenCalledWith('mcp', expect.any(Error));
    expect(reportError).toHaveBeenCalledWith('automations', expect.any(Error));
    expect(reportError).toHaveBeenCalledWith('heartbeat', expect.any(Error));
    cleanup();
  });
});
