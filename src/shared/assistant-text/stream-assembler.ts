import {
  cleanFinalAssistantDisplayText,
  type AssistantFinalDisplayCleanupOptions
} from './final-display-cleanup';

export interface AssistantStreamAppendResult {
  text: string;
  delta: string;
  normalizedChunk: string;
  replace: false;
}

export function appendAssistantStreamChunk(
  current: string,
  rawChunk: string,
  options: AssistantFinalDisplayCleanupOptions = {}
): AssistantStreamAppendResult {
  const normalizedChunk = cleanFinalAssistantDisplayText(rawChunk, {
    ...options,
    preserveOuterWhitespace: true
  });

  return {
    text: current + normalizedChunk,
    delta: normalizedChunk,
    normalizedChunk,
    replace: false
  };
}
