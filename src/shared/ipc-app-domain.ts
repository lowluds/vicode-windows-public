import type {
  AppMeta,
  AppUpdateState,
  BootstrapData,
  JobDefinition,
  Preferences,
  Project,
  ProviderId,
  ReviewItem
} from './domain';
import type {
  AppZoomAction,
  MicrophoneAccessStatus,
  NativeThemeSnapshot,
  WorkspaceBootstrapAnswers,
  WorkspaceBootstrapDraftBundle,
  WorkspaceBootstrapQuestion,
  WorkspaceBootstrapStatus
} from './ipc-bootstrap-types';

export interface AppDomainApi {
  app: {
    getBootstrap(): Promise<BootstrapData>;
    pickFolder(): Promise<string | null>;
    openExternal(url: string): Promise<void>;
    revealPath(path: string): Promise<void>;
    getMeta(): Promise<AppMeta>;
    getNativeTheme(): Promise<NativeThemeSnapshot>;
    adjustZoom(action: AppZoomAction): Promise<number>;
  };
  updates: {
    getState(): Promise<AppUpdateState>;
    checkForUpdates(): Promise<AppUpdateState>;
    restartToUpdate(): Promise<void>;
  };
  voice: {
    getMicrophoneAccessStatus(): Promise<MicrophoneAccessStatus>;
    transcribe(input: { audioBase64: string; mimeType: string; fileName?: string | null }): Promise<{ text: string }>;
  };
  projects: {
    create(input: {
      name: string;
      folderPath?: string | null;
      trusted?: boolean;
      runtimeCommandPolicy?: string;
      runtimeNetworkPolicy?: string;
    }): Promise<Project>;
    update(input: {
      id: string;
      name?: string;
      folderPath?: string | null;
      trusted?: boolean;
      runtimeCommandPolicy?: string;
      runtimeNetworkPolicy?: string;
      defaultProviderId?: ProviderId;
      defaultModelId?: string;
    }): Promise<Project>;
    remove(projectId: string): Promise<void>;
  };
  workspaceBootstrap: {
    getStatus(projectId: string): Promise<WorkspaceBootstrapStatus>;
    getQuestionnaire(): Promise<WorkspaceBootstrapQuestion[]>;
    dismissSuggestion(projectId: string): Promise<WorkspaceBootstrapStatus>;
    createDrafts(input: {
      projectId: string;
      answers: WorkspaceBootstrapAnswers;
      includeSoul?: boolean;
      includeDailyNote?: boolean;
      overwriteExisting?: boolean;
    }): Promise<WorkspaceBootstrapDraftBundle>;
    writeDrafts(input: {
      projectId: string;
      drafts: WorkspaceBootstrapDraftBundle['drafts'];
      overwriteExisting?: boolean;
    }): Promise<string[]>;
  };
  memoryWrites: {
    createDailyNoteReview(threadId: string): Promise<{ job: JobDefinition; reviewItem: ReviewItem; alreadyPending: boolean }>;
    createMemoryPromotionReview(threadId: string): Promise<{ job: JobDefinition; reviewItem: ReviewItem; alreadyPending: boolean }>;
    createUserPreferenceReview(threadId: string): Promise<{ job: JobDefinition; reviewItem: ReviewItem; alreadyPending: boolean }>;
  };
}
