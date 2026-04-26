import type {
  AppMeta,
  CollabBootstrap,
  ProviderId
} from './domain';

export interface WorkspaceBootstrapQuestion {
  id: string;
  prompt: string;
  targetFiles: string[];
  optional?: boolean;
}

export type WorkspaceBootstrapFileKind = 'agents' | 'user' | 'soul' | 'memory' | 'daily_note';

export interface WorkspaceContractFileStatus {
  kind: WorkspaceBootstrapFileKind;
  label: string;
  fileName: string;
  relativePath: string;
  purpose: string;
  exists: boolean;
  required: boolean;
  loadMode: 'direct_prompt' | 'memory_retrieval' | 'draft_only';
}

export interface WorkspaceBootstrapStatus {
  eligible: boolean;
  reason: string | null;
  folderPath: string | null;
  existingFiles: string[];
  missingFiles: string[];
  contractFiles?: WorkspaceContractFileStatus[];
  needsBootstrap: boolean;
  dismissed: boolean;
  suggestionEligible: boolean;
}

export interface WorkspaceBootstrapAnswers {
  projectIntent?: string;
  optimizationPriority?: string;
  communicationStyle?: string;
  approvalBoundary?: string;
  repoConstraints?: string;
  wantsSoul?: boolean;
  detailLevel?: string;
  planningStyle?: string;
  deliveryStyle?: string;
  riskPosture?: string;
  testingExpectation?: string;
  dependencyPolicy?: string;
  refactorPosture?: string;
  summaryStyle?: string;
  changeStyle?: string;
  agentAssertiveness?: string;
  agentFormality?: string;
  durablePreferences?: string[];
  durableDecisions?: string[];
  todayFocus?: string;
  recentDecisions?: string[];
  openQuestions?: string[];
  followUps?: string[];
}

export interface WorkspaceTemplateDraft {
  kind: WorkspaceBootstrapFileKind;
  fileName: string;
  relativePath: string;
  content: string;
}

export interface WorkspaceRepoInspection {
  folderPath: string;
  repoName: string;
  repoPurpose: string;
  repoStack: string;
  packageManager: string;
  installCommand: string;
  buildCommand: string | null;
  testCommand: string | null;
  lintCommand: string | null;
  platformFocus: string;
  architectureFacts: string[];
  constraints: string[];
  frameworks: string[];
  languages: string[];
}

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

export interface WorkspaceBootstrapDraftBundle {
  status: WorkspaceBootstrapStatus;
  inspection: WorkspaceRepoInspection;
  drafts: WorkspaceTemplateDraft[];
}

export interface ThreadCollaborationSummary {
  lastPromptSummary: string | null;
  latestAssistantSummary: string | null;
  handoffSummary: string | null;
  recommendedNextPrompt: string | null;
}

export type CollabBootstrapPayload = CollabBootstrap;
