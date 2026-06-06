import type {
  RunRuntimeTraceMark,
  RunRuntimeTraceStage
} from '../../shared/domain';
import {
  booleanOrNull,
  finiteNumberOrNull,
  objectArray,
  recordOrNull,
  safeDiagnosticStringOrNull,
  stringArray
} from './diagnostics-redaction';

export function parseRuntimeTraceMark(payload: Record<string, unknown>) {
  const runtimeTrace =
    'runtimeTrace' in payload && payload.runtimeTrace && typeof payload.runtimeTrace === 'object'
      ? (payload.runtimeTrace as Record<string, unknown>)
      : null;
  if (!runtimeTrace) {
    return null;
  }

  const stage = typeof runtimeTrace.stage === 'string' ? (runtimeTrace.stage as RunRuntimeTraceStage) : null;
  const at = typeof runtimeTrace.at === 'string' ? runtimeTrace.at : null;
  if (!stage || !at) {
    return null;
  }

  return {
    stage,
    at,
    detail:
      'detail' in runtimeTrace && runtimeTrace.detail && typeof runtimeTrace.detail === 'object'
        ? sanitizeRuntimeTraceDetail(stage, runtimeTrace.detail as Record<string, unknown>)
        : null
  } satisfies RunRuntimeTraceMark;
}

const UNSAFE_WORKTREE_TRACE_DETAIL_KEYS = new Set([
  'sourceRepoRoot',
  'sourceWorkspaceRoot',
  'runtimeWorkspaceRoot',
  'worktreeRepoRoot',
  'worktreeWorkspaceRoot'
]);

export function sanitizeRuntimeTraceDetail(stage: string, detail: Record<string, unknown>) {
  if (stage === 'provider_model_harness_evidence_captured') {
    return sanitizeProviderModelHarnessEvidence(detail);
  }

  if (stage === 'provider_model_normalized_dispatch_started') {
    return sanitizeProviderModelDispatchTraceDetail(detail);
  }

  if (stage !== 'worktree_session_created' && stage !== 'worktree_session_failed') {
    return detail;
  }

  return sanitizeWorktreeTraceValue(detail) as Record<string, unknown>;
}

export function sanitizeProviderModelHarnessEvidence(value: unknown) {
  const evidence = recordOrNull(value);
  if (!evidence) {
    return null;
  }

  return {
    promptSections: objectArray(evidence.promptSections).map(sanitizePromptSectionEvidence),
    modelSelection: sanitizeModelRoutingEvidence(evidence.modelSelection),
    toolRouting: objectArray(evidence.toolRouting).map(sanitizeToolRoutingEvidence),
    infrastructure: objectArray(evidence.infrastructure).map(sanitizeInfrastructureEvidence)
  };
}

export function sanitizeProviderModelDispatchTraceDetail(value: unknown) {
  const detail = recordOrNull(value);
  if (!detail) {
    return null;
  }

  return {
    providerId: safeDiagnosticStringOrNull(detail.providerId),
    transportKind: safeDiagnosticStringOrNull(detail.transportKind),
    modelRouting: sanitizeModelRoutingEvidence(detail.modelRouting)
  };
}

export function sanitizePromptSectionEvidence(value: unknown) {
  const section = recordOrNull(value);
  return {
    id: safeDiagnosticStringOrNull(section?.id),
    title: safeDiagnosticStringOrNull(section?.title),
    placement: safeDiagnosticStringOrNull(section?.placement),
    characterCount: finiteNumberOrNull(section?.characterCount),
    reason: safeDiagnosticStringOrNull(section?.reason)
  };
}

export function sanitizeModelRoutingEvidence(value: unknown) {
  const routing = recordOrNull(value);
  return {
    modelId: safeDiagnosticStringOrNull(routing?.modelId),
    customProviderId: safeDiagnosticStringOrNull(routing?.customProviderId),
    ollamaTransportMode: safeDiagnosticStringOrNull(routing?.ollamaTransportMode),
    runMode: safeDiagnosticStringOrNull(routing?.runMode),
    providerLabel: safeDiagnosticStringOrNull(routing?.providerLabel),
    transportKind: safeDiagnosticStringOrNull(routing?.transportKind),
    runtimeAuthority: safeDiagnosticStringOrNull(routing?.runtimeAuthority),
    reason: safeDiagnosticStringOrNull(routing?.reason)
  };
}

export function sanitizeToolRoutingEvidence(value: unknown) {
  const tool = recordOrNull(value);
  return {
    id: safeDiagnosticStringOrNull(tool?.id),
    callName: safeDiagnosticStringOrNull(tool?.callName),
    name: safeDiagnosticStringOrNull(tool?.name),
    origin: safeDiagnosticStringOrNull(tool?.origin),
    visibilityGroup: safeDiagnosticStringOrNull(tool?.visibilityGroup),
    included: booleanOrNull(tool?.included),
    reason: safeDiagnosticStringOrNull(tool?.reason),
    mutatesWorkspace: booleanOrNull(tool?.mutatesWorkspace),
    requiresApproval: booleanOrNull(tool?.requiresApproval),
    readsWorkspace: booleanOrNull(tool?.readsWorkspace),
    usesNetwork: booleanOrNull(tool?.usesNetwork)
  };
}

export function sanitizeInfrastructureEvidence(value: unknown) {
  const infrastructure = recordOrNull(value);
  return {
    id: safeDiagnosticStringOrNull(infrastructure?.id),
    label: safeDiagnosticStringOrNull(infrastructure?.label),
    available: booleanOrNull(infrastructure?.available),
    reason: safeDiagnosticStringOrNull(infrastructure?.reason),
    toolCallNames: stringArray(infrastructure?.toolCallNames)
      .map((toolCallName) => safeDiagnosticStringOrNull(toolCallName) ?? '')
      .filter(Boolean)
  };
}

function sanitizeWorktreeTraceValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeWorktreeTraceValue(item));
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !UNSAFE_WORKTREE_TRACE_DETAIL_KEYS.has(key))
      .map(([key, entryValue]) => [key, sanitizeWorktreeTraceValue(entryValue)])
  );
}

function parseRuntimeTraceDetail(payload: Record<string, unknown>, expectedStage: string) {
  const runtimeTrace = recordOrNull(payload.runtimeTrace);
  if (!runtimeTrace || runtimeTrace.stage !== expectedStage) {
    return null;
  }

  return recordOrNull(runtimeTrace.detail);
}

export function parseProviderModelHarnessEvidence(payload: Record<string, unknown>) {
  return parseRuntimeTraceDetail(payload, 'provider_model_harness_evidence_captured');
}

export function parseProviderModelRoutingEvidence(payload: Record<string, unknown>) {
  const dispatchDetail = parseRuntimeTraceDetail(payload, 'provider_model_normalized_dispatch_started');
  const routing = recordOrNull(dispatchDetail?.modelRouting);
  return routing ? sanitizeModelRoutingEvidence(routing) : null;
}
