import type { Dispatch, SetStateAction } from 'react';
import type {
  AppMeta,
  AppUpdateState,
  OllamaPullProgress,
  PersonalizationSettings,
  Preferences,
  Project,
  ProjectRuntimeCommandPolicy,
  ProjectRuntimeNetworkPolicy,
  ProviderDescriptor,
  ProviderId,
  SettingsSection,
  ThreadSummary
} from '../../../shared/domain';
import type { OllamaRuntimeSnapshot, StorageDiagnostics, WorkspaceBootstrapStatus } from '../../../shared/ipc';

export interface SettingsViewProps {
  section: SettingsSection;
  setSection: (section: SettingsSection) => void;
  onBack: () => void;
  providers: ProviderDescriptor[];
  preferences: Preferences | null;
  savePreferences: (input: Partial<Preferences>) => Promise<void>;
  personalization: PersonalizationSettings;
  savePersonalization: (input: Partial<PersonalizationSettings>) => Promise<void>;
  resetPersonalization: () => Promise<void>;
  apiKeys: Record<ProviderId, string>;
  setApiKeys: Dispatch<SetStateAction<Record<ProviderId, string>>>;
  connectProvider: (providerId: ProviderId, mode?: 'cli' | 'api_key') => Promise<void>;
  adoptProviderAuth: (providerId: ProviderId) => Promise<void>;
  beginProviderInstall: (providerId: ProviderId) => void;
  clearProviderAuth: (providerId: ProviderId) => Promise<void>;
  refreshProvider: (providerId: ProviderId) => Promise<void>;
  pullOllamaModel: (model: string) => Promise<void>;
  ollamaPullProgress: OllamaPullProgress | null;
  ollamaRuntimeStatus: OllamaRuntimeSnapshot | null;
  stopOllamaRuntime: () => Promise<void>;
  deleteOllamaModel: (model: string) => Promise<void>;
  saveProviderApiKey: (providerId: ProviderId) => Promise<void>;
  exportDiagnostics: () => Promise<void>;
  clearAllProviderAuth: () => Promise<void>;
  appMeta: AppMeta | null;
  appUpdateState: AppUpdateState | null;
  hasActiveRun: boolean;
  queuedUpdateInstallKey: string | null;
  checkForAppUpdates: () => Promise<void>;
  restartToUpdate: () => Promise<void>;
  storageDiagnostics: StorageDiagnostics | null;
  refreshStorageDiagnostics: () => Promise<void>;
  compactRunEvents: () => Promise<void>;
  maintainStorage: (input?: { vacuum?: boolean }) => Promise<void>;
  selectedProject: Project | null;
  saveProjectRuntimeCommandPolicy: (
    projectId: string,
    runtimeCommandPolicy: ProjectRuntimeCommandPolicy
  ) => Promise<void>;
  saveProjectRuntimeNetworkPolicy: (
    projectId: string,
    runtimeNetworkPolicy: ProjectRuntimeNetworkPolicy
  ) => Promise<void>;
  workspaceBootstrapStatus: WorkspaceBootstrapStatus | null;
  openWorkspaceBootstrap: () => Promise<void>;
  archivedThreads: ThreadSummary[];
  projects: Project[];
  restoreArchivedThread: (threadId: string) => Promise<void>;
  deleteArchivedThread: (threadId: string) => Promise<void>;
}
