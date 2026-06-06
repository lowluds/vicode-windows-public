import type { RunEvent } from '../../shared/domain';

export function createDiagnosticsFailedRunEvents(): RunEvent[] {
  return [
      {
        id: 'event-6a',
        threadId: 'thread-1',
        runId: 'run-2',
        eventType: 'info',
        payload: {
          runtimeTrace: {
            stage: 'submit_received',
            at: '2026-03-17T00:01:00.000Z'
          }
        },
        createdAt: '2026-03-17T00:01:00.000Z'
      },
      {
        id: 'event-6b',
        threadId: 'thread-1',
        runId: 'run-2',
        eventType: 'info',
        payload: {
          runtimeTrace: {
            stage: 'run_started',
            at: '2026-03-17T00:01:00.100Z'
          }
        },
        createdAt: '2026-03-17T00:01:00.100Z'
      },
      {
        id: 'event-6c',
        threadId: 'thread-1',
        runId: 'run-2',
        eventType: 'info',
        payload: {
          providerDiagnostics: {
            kind: 'provider_event_classification',
            source: 'ollama_chat_json',
            providerEventType: 'message/tool_calls',
            itemType: 'read_file',
            itemKeys: ['path'],
            paths: ['index.html'],
            decision: null,
            status: 'started',
            taskLike: false,
            classification: 'evidence_candidate_unparsed'
          },
          message: 'Thinking about the next step',
          activity: {
            kind: 'thinking',
            summary: 'Thinking about the next step'
          }
        },
        createdAt: '2026-03-17T00:01:00.200Z'
      },
      {
        id: 'event-6d',
        threadId: 'thread-1',
        runId: 'run-2',
        eventType: 'info',
        payload: {
          activity: {
            kind: 'tool_call',
            toolName: 'read_file',
            phase: 'started',
            summary: 'Calling read_file'
          }
        },
        createdAt: '2026-03-17T00:01:00.250Z'
      },
      {
        id: 'event-6e',
        threadId: 'thread-1',
        runId: 'run-2',
        eventType: 'info',
        payload: {
          activity: {
            kind: 'tool_result',
            toolName: 'read_file',
            phase: 'completed',
            status: 'completed',
            summary: 'Completed read_file'
          }
        },
        createdAt: '2026-03-17T00:01:00.300Z'
      },
      {
        id: 'event-6f',
        threadId: 'thread-1',
        runId: 'run-2',
        eventType: 'info',
        payload: {
          runtimeTrace: {
            stage: 'failed',
            at: '2026-03-17T00:01:01.000Z',
            detail: {
              message: 'Ollama completed without producing assistant output.',
              reason: 'empty_output'
            }
          }
        },
        createdAt: '2026-03-17T00:01:01.000Z'
      },
      {
        id: 'event-6g',
        threadId: 'thread-1',
        runId: 'run-2',
        eventType: 'failed',
        payload: {
          message: 'Ollama completed without producing assistant output.'
        },
        createdAt: '2026-03-17T00:01:01.001Z'
      }
  ];
}
