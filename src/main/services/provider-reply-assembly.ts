import type { ProviderId } from '../../shared/domain';
import {
  normalizeProviderAssistantDelta,
  reconcileProviderAssistantSnapshot
} from './provider-run-event-normalizer';

interface ProviderReplyAssemblyOptions {
  providerId: ProviderId;
  readCurrentText: () => string;
  onFirstDelta?: (input: { deltaLength: number; textLength: number }) => void;
  persistDelta: (delta: string) => void;
  persistText?: (text: string) => void;
  emitDelta?: (delta: string) => void;
  emitReplace?: (text: string) => void;
}

export interface ProviderReplyAssembly {
  handleDelta: (delta: string) => void;
  handleSnapshot: (snapshot: string) => void;
}

export function createProviderReplyAssembly(options: ProviderReplyAssemblyOptions): ProviderReplyAssembly {
  let snapshotText = '';
  let sawFirstDelta = false;

  const markFirstDelta = (deltaLength: number, textLength: number) => {
    if (sawFirstDelta || textLength === 0) {
      return;
    }
    sawFirstDelta = true;
    options.onFirstDelta?.({ deltaLength, textLength });
  };

  return {
    handleDelta(delta) {
      const currentText = options.readCurrentText();
      const normalized = normalizeProviderAssistantDelta(options.providerId, currentText, delta);
      if (!normalized.delta && normalized.text === currentText) {
        return;
      }

      markFirstDelta(normalized.delta.length, normalized.text.trim().length);
      options.persistText?.(normalized.text);
      if (normalized.replace && options.persistText && options.emitReplace) {
        options.emitReplace(normalized.text);
        return;
      }

      if (!normalized.delta) {
        return;
      }

      options.persistDelta(normalized.delta);
      options.emitDelta?.(normalized.delta);
    },
    handleSnapshot(snapshot) {
      const currentText = options.readCurrentText();
      const reconciled = reconcileProviderAssistantSnapshot(
        options.providerId,
        currentText,
        snapshotText,
        snapshot
      );
      snapshotText = reconciled.snapshotText;

      if (!reconciled.delta && (!options.persistText || reconciled.text === currentText)) {
        return;
      }

      markFirstDelta(reconciled.delta.length || reconciled.text.length, reconciled.text.trim().length);
      options.persistText?.(reconciled.text);
      if (reconciled.replace && options.persistText && options.emitReplace) {
        options.emitReplace(reconciled.text);
        return;
      }
      if (reconciled.delta) {
        options.persistDelta(reconciled.delta);
        options.emitDelta?.(reconciled.delta);
      }
    }
  };
}
