import type { RunEvent, ThreadDetail } from '../../shared/domain';
import { appendRunEvent } from './thread-presentation';

interface LiveRunTextInput {
  threadId: string;
  runId: string;
  createdAt: string;
}

interface LiveRunDeltaInput extends LiveRunTextInput {
  delta: string;
}

interface LiveRunReplaceInput extends LiveRunTextInput {
  text: string;
}

function findLatestAssistantTurnIndex(turns: ThreadDetail['turns'], runId: string) {
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index];
    if (turn.role === 'assistant' && turn.runId === runId) {
      return index;
    }
  }

  return -1;
}

function upsertAssistantTurn(
  turns: ThreadDetail['turns'],
  input: LiveRunTextInput,
  content: string
) {
  const nextTurns = [...turns];
  const index = findLatestAssistantTurnIndex(nextTurns, input.runId);

  if (index >= 0) {
    nextTurns[index] = {
      ...nextTurns[index],
      content
    };
    return nextTurns;
  }

  nextTurns.push({
    id: `${input.runId}-assistant`,
    threadId: input.threadId,
    runId: input.runId,
    role: 'assistant',
    content,
    metadata: null,
    createdAt: input.createdAt
  });
  return nextTurns;
}

function isDeltaRunEvent(event: RunEvent | undefined, runId: string): event is RunEvent & { eventType: 'delta' } {
  return Boolean(
    event &&
      event.runId === runId &&
      event.eventType === 'delta' &&
      typeof event.payload?.delta === 'string'
  );
}

function appendOrMergeLiveDeltaEvent(
  events: ThreadDetail['rawOutput'],
  input: LiveRunDeltaInput
) {
  const trailingEvent = events.at(-1);
  if (isDeltaRunEvent(trailingEvent, input.runId)) {
    return [
      ...events.slice(0, -1),
      {
        ...trailingEvent,
        payload: {
          ...trailingEvent.payload,
          delta: `${String(trailingEvent.payload.delta)}${input.delta}`
        },
        createdAt: input.createdAt
      }
    ];
  }

  return appendRunEvent(events, {
    id: `${input.runId}:delta:${events.length}`,
    threadId: input.threadId,
    runId: input.runId,
    eventType: 'delta',
    payload: { delta: input.delta },
    createdAt: input.createdAt
  });
}

export function applyLiveRunDelta(thread: ThreadDetail, input: LiveRunDeltaInput): ThreadDetail {
  const assistantIndex = findLatestAssistantTurnIndex(thread.turns, input.runId);
  const currentText = assistantIndex >= 0 ? thread.turns[assistantIndex]?.content ?? '' : '';
  return {
    ...thread,
    turns: upsertAssistantTurn(thread.turns, input, `${currentText}${input.delta}`),
    rawOutput: appendOrMergeLiveDeltaEvent(thread.rawOutput, input)
  };
}

export function replaceLiveRunText(thread: ThreadDetail, input: LiveRunReplaceInput): ThreadDetail {
  return {
    ...thread,
    turns: upsertAssistantTurn(thread.turns, input, input.text)
  };
}
