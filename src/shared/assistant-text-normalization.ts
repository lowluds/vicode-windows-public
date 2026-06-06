import { appendAssistantStreamChunk } from './assistant-text/stream-assembler';
import { findSuspiciousAssistantTextPatternLabels } from './assistant-text/text-quality-detector';
import { createAssistantVisibleTextReducer } from './assistant-text/visible-text-reducer';
import { repairSuspiciousTextBoundaries } from './assistant-text/word-boundary-repair';
import type {
  AssistantTextDeltaResolution,
  AssistantTextNormalizationOptions,
  AssistantTextSnapshotResolution
} from './assistant-text/types';

export type {
  AssistantTextDeltaResolution,
  AssistantTextInspection,
  AssistantTextNormalizationOptions,
  AssistantTextSnapshotResolution,
  AssistantVisibleTextReducer
} from './assistant-text/types';

const defaultReducer = createAssistantVisibleTextReducer();

export { createAssistantVisibleTextReducer };

export function repairSuspiciousWordSplits(content: string) {
  return repairSuspiciousTextBoundaries(content);
}

export function findSuspiciousAssistantTextPatterns(text: string) {
  return findSuspiciousAssistantTextPatternLabels(text);
}

export function normalizeAssistantVisibleTextChunk(
  content: string,
  options: AssistantTextNormalizationOptions = {}
) {
  return options.stripXmlFunctionCallMarkup || options.stripReasoningLabels || options.preserveLeadingBreaks
    ? createAssistantVisibleTextReducer(options).normalize(content)
    : defaultReducer.normalize(content);
}

export function appendAssistantTextDelta(
  current: string,
  rawChunk: string,
  options: AssistantTextNormalizationOptions = {}
): AssistantTextDeltaResolution {
  return appendAssistantStreamChunk(current, rawChunk, options);
}

export function preferNormalizedAssistantText(
  current: string,
  rawCandidate: string,
  options: AssistantTextNormalizationOptions = {}
): string {
  return createAssistantVisibleTextReducer(options).preferText(current, rawCandidate);
}

export function reconcileAssistantTextSnapshot(
  current: string,
  currentSnapshot: string,
  rawSnapshot: string,
  options: AssistantTextNormalizationOptions = {}
): AssistantTextSnapshotResolution {
  return createAssistantVisibleTextReducer(options).reconcileSnapshot(current, currentSnapshot, rawSnapshot);
}
