import {
  findSuspiciousAssistantTextPatternLabels,
  computeAssistantTextQualityDebt
} from './text-quality-detector';
import { appendAssistantStreamChunk } from './stream-assembler';
import { normalizeAssistantVisibleDisplayText } from './final-display-cleanup';
import type {
  AssistantTextInspection,
  AssistantTextNormalizationOptions,
  AssistantVisibleTextReducer
} from './types';

function inspectAssistantVisibleText(
  value: string,
  options: AssistantTextNormalizationOptions = {}
): AssistantTextInspection {
  const normalizedText = normalizeAssistantVisibleDisplayText(value, options);
  const findings = findSuspiciousAssistantTextPatternLabels(value);
  let debt = computeAssistantTextQualityDebt(findings);
  if (normalizedText !== value) {
    debt += 1;
  }
  return {
    normalizedText,
    findings,
    debt
  };
}

function compactComparableText(value: string) {
  return value.replace(/\s+/gu, '');
}

function deriveAppendMutation(current: string, nextText: string) {
  if (!nextText || nextText === current) {
    return {
      delta: '',
      replace: false
    };
  }

  if (!current) {
    return {
      delta: nextText,
      replace: false
    };
  }

  if (nextText.startsWith(current)) {
    return {
      delta: nextText.slice(current.length),
      replace: false
    };
  }

  return {
    delta: '',
    replace: true
  };
}

export function createAssistantVisibleTextReducer(
  options: AssistantTextNormalizationOptions = {}
): AssistantVisibleTextReducer {
  return {
    normalize(value: string) {
      return normalizeAssistantVisibleDisplayText(value, options);
    },

    inspect(value: string) {
      return inspectAssistantVisibleText(value, options);
    },

    appendDelta(current: string, rawChunk: string) {
      return appendAssistantStreamChunk(current, rawChunk, options);
    },

    preferText(current: string, rawCandidate: string) {
      const normalizedCandidate = normalizeAssistantVisibleDisplayText(rawCandidate, options).trim();
      const currentText = current.trim();
      if (!normalizedCandidate) {
        return currentText;
      }
      if (!currentText) {
        return normalizedCandidate;
      }
      if (normalizedCandidate.startsWith(currentText)) {
        return normalizedCandidate;
      }
      if (currentText.startsWith(normalizedCandidate)) {
        return currentText;
      }

      if (compactComparableText(normalizedCandidate) === compactComparableText(currentText)) {
        const currentInspection = inspectAssistantVisibleText(currentText, {
          ...options,
          preserveLeadingBreaks: true
        });
        const candidateInspection = inspectAssistantVisibleText(normalizedCandidate, {
          ...options,
          preserveLeadingBreaks: true
        });

        if (candidateInspection.debt !== currentInspection.debt) {
          return candidateInspection.debt < currentInspection.debt ? normalizedCandidate : currentText;
        }

        const currentStable = currentInspection.normalizedText === currentText;
        const candidateStable = candidateInspection.normalizedText === normalizedCandidate;
        if (candidateStable !== currentStable) {
          return candidateStable ? normalizedCandidate : currentText;
        }

        return currentText;
      }

      return normalizedCandidate;
    },

    reconcileSnapshot(current: string, currentSnapshot: string, rawSnapshot: string) {
      if (!rawSnapshot) {
        return {
          text: current,
          delta: '',
          snapshotText: currentSnapshot,
          replace: false
        };
      }

      const nextSnapshot = rawSnapshot;
      if (!current) {
        const nextText = normalizeAssistantVisibleDisplayText(rawSnapshot, options).trim();
        return {
          text: nextText,
          delta: nextText,
          snapshotText: nextSnapshot,
          replace: false
        };
      }

      if (currentSnapshot && nextSnapshot === currentSnapshot) {
        return {
          text: current,
          delta: '',
          snapshotText: nextSnapshot,
          replace: false
        };
      }

      if (currentSnapshot && nextSnapshot.startsWith(currentSnapshot)) {
        const rawDelta = nextSnapshot.slice(currentSnapshot.length);
        const appended = this.appendDelta(current, rawDelta);
        return {
          text: appended.text,
          delta: appended.delta,
          snapshotText: nextSnapshot,
          replace: appended.replace
        };
      }

      const preferredText = this.preferText(current, rawSnapshot);
      const mutation = deriveAppendMutation(current, preferredText);
      return {
        text: preferredText,
        delta: mutation.delta,
        snapshotText: nextSnapshot,
        replace: mutation.replace
      };
    }
  };
}
