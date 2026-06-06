export interface AssistantTextNormalizationOptions {
  stripXmlFunctionCallMarkup?: boolean;
  stripReasoningLabels?: boolean;
  preserveLeadingBreaks?: boolean;
}

interface AssistantTextResolution {
  text: string;
  delta: string;
}

export interface AssistantTextDeltaResolution extends AssistantTextResolution {
  normalizedChunk: string;
  replace: boolean;
}

export interface AssistantTextSnapshotResolution extends AssistantTextResolution {
  snapshotText: string;
  replace: boolean;
}

export interface AssistantTextInspection {
  normalizedText: string;
  findings: string[];
  debt: number;
}

export interface AssistantVisibleTextReducer {
  normalize: (value: string) => string;
  inspect: (value: string) => AssistantTextInspection;
  appendDelta: (current: string, rawChunk: string) => AssistantTextDeltaResolution;
  preferText: (current: string, rawCandidate: string) => string;
  reconcileSnapshot: (
    current: string,
    currentSnapshot: string,
    rawSnapshot: string
  ) => AssistantTextSnapshotResolution;
}
