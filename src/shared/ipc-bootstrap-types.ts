import type { CollabBootstrap } from './domain';

export interface StorageDiagnostics {
  databasePath: string;
  databaseSizeBytes: number;
  walSizeBytes: number;
  shmSizeBytes: number;
  totalStorageBytes: number;
  projectCount: number;
  threadCount: number;
  archivedThreadCount: number;
  activeThreadCount: number;
  turnCount: number;
  runEventCount: number;
  compactableRunCount: number;
  compactableDeltaEventCount: number;
  compactionCutoffDays: number;
}

export interface StorageCompactionResult {
  cutoffIso: string;
  cutoffDays: number;
  runsCompacted: number;
  deltaEventsDeleted: number;
}

export interface StorageMaintenanceResult extends StorageCompactionResult {
  vacuumApplied: boolean;
  sizeBeforeBytes: number;
  sizeAfterBytes: number;
  reclaimedBytes: number;
}

export type MicrophoneAccessStatus = 'not-determined' | 'granted' | 'denied' | 'restricted' | 'unknown';

export interface NativeThemeSnapshot {
  platform: NodeJS.Platform;
  systemAccentColor: string;
}

export type AppZoomAction = 'in' | 'out' | 'reset';

export interface OllamaRuntimeSnapshot {
  installed: boolean;
  reachable: boolean;
  cliPath: string | null;
  baseUrl: string;
  models: string[];
  managedByApp: boolean;
  canManageProcess: boolean;
  canStop: boolean;
  starting: boolean;
}

export interface OllamaModelMutationResult {
  model: string;
  models: string[];
}

export interface ThreadCollaborationSummary {
  lastPromptSummary: string | null;
  latestAssistantSummary: string | null;
  handoffSummary: string | null;
  recommendedNextPrompt: string | null;
}

export type CollabBootstrapPayload = CollabBootstrap;
