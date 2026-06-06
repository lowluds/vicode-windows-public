export type ModelSamplingLane = 'plain_chat' | 'tool_loop' | 'final_summary';

export interface ModelSamplingProfileInput {
  lane: ModelSamplingLane;
}

export interface ModelSamplingProfile {
  temperature?: number;
  top_p?: number;
  top_k?: number;
  repeat_penalty?: number;
}

export function resolveModelSamplingProfile(input: ModelSamplingProfileInput): ModelSamplingProfile | null {
  switch (input.lane) {
    case 'tool_loop':
      return {
        temperature: 0.2,
        top_p: 0.8,
        top_k: 20,
        repeat_penalty: 1.05
      };
    case 'final_summary':
      return {
        temperature: 0.1,
        top_p: 0.8,
        top_k: 20,
        repeat_penalty: 1.05
      };
    case 'plain_chat':
      return null;
    default:
      return null;
  }
}

export function resolveOllamaSamplingOptions(profile: ModelSamplingProfile | null | undefined) {
  return profile ? { ...profile } : null;
}
