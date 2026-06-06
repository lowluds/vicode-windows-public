import type { AgentToolCall } from '../agent-runtime';
import type { ProviderModelToolDefinition } from '../types';
import { classifyOllamaToolCallContent, isRecord } from './tool-loop-model';

export const OLLAMA_TOOL_INTENT_ADAPTER_SOURCE = 'adapter_json' as const;

type OllamaToolIntentAdapterRejectionReason =
  | 'no_candidate'
  | 'malformed_json'
  | 'multiple_candidates'
  | 'inactive_tool'
  | 'missing_required_arguments'
  | 'surrounding_prose'
  | 'final_answer_outside_envelope'
  | 'unlabeled_fence_with_surrounding_prose'
  | 'candidate_requires_reemit';

export type OllamaToolIntentAdapterDecision =
  | {
      status: 'accepted';
      source: typeof OLLAMA_TOOL_INTENT_ADAPTER_SOURCE;
      toolCalls: AgentToolCall[];
      sanitizedContent: string;
    }
  | {
      status: 'rejected';
      reason: OllamaToolIntentAdapterRejectionReason;
      candidateToolName: string | null;
      toolCalls: [];
      sanitizedContent: string;
    };

export function createOllamaToolIntentAdapterFormat(
  toolDefinitions: ProviderModelToolDefinition[]
) {
  const toolNames = toolDefinitions
    .map((definition) => definition.function.name.trim())
    .filter(Boolean);

  return {
    type: 'object',
    properties: {
      name: toolNames.length > 0
        ? {
            type: 'string',
            enum: toolNames
          }
        : {
            type: 'string'
          },
      arguments: {
        type: 'object'
      },
      reason: {
        type: 'string'
      }
    },
    required: ['name', 'arguments'],
    additionalProperties: false
  };
}

function readCandidateToolName(value: unknown) {
  if (!isRecord(value)) {
    return null;
  }
  return typeof value.name === 'string' && value.name.trim()
    ? value.name.trim()
    : null;
}

function rejectedAdapterDecision(
  reason: OllamaToolIntentAdapterRejectionReason,
  sanitizedContent: string,
  candidateToolName: string | null = null
): OllamaToolIntentAdapterDecision {
  return {
    status: 'rejected',
    reason,
    candidateToolName,
    toolCalls: [],
    sanitizedContent
  };
}

export function classifyOllamaToolIntentAdapterResponse(
  content: string,
  toolDefinitions: ProviderModelToolDefinition[]
): OllamaToolIntentAdapterDecision {
  const trimmed = content.trim();
  if (!trimmed || (!trimmed.startsWith('{') && !trimmed.startsWith('['))) {
    return rejectedAdapterDecision('no_candidate', trimmed);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return rejectedAdapterDecision('malformed_json', trimmed);
  }

  if (Array.isArray(parsed)) {
    return rejectedAdapterDecision(
      parsed.length > 1 ? 'multiple_candidates' : 'no_candidate',
      trimmed
    );
  }

  if (!isRecord(parsed)) {
    return rejectedAdapterDecision('no_candidate', trimmed);
  }

  const candidateToolName = readCandidateToolName(parsed);
  const decision = classifyOllamaToolCallContent(
    {
      content: JSON.stringify(parsed)
    },
    {
      toolDefinitions
    }
  );

  if (decision.status === 'accepted') {
    if (decision.toolCalls.length !== 1) {
      return rejectedAdapterDecision('multiple_candidates', trimmed, candidateToolName);
    }
    return {
      status: 'accepted',
      source: OLLAMA_TOOL_INTENT_ADAPTER_SOURCE,
      toolCalls: decision.toolCalls,
      sanitizedContent: ''
    };
  }

  if (decision.status === 'recoverable_contract_violation') {
    return rejectedAdapterDecision(
      decision.reason,
      trimmed,
      decision.candidateToolName ?? candidateToolName
    );
  }

  return rejectedAdapterDecision(decision.reason, trimmed, candidateToolName);
}
