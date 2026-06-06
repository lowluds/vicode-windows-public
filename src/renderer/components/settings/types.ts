import type { Dispatch, SetStateAction } from 'react';
import type {
  AppMeta,
  AppUpdateState,
  CustomProviderSettings,
  CustomProviderSettingsSaveInput,
  LibrarySourcesSnapshot,
  OllamaPullProgress,
  Preferences,
  Project,
  ProjectKnowledgeIndexStatus,
  ProjectRuntimeCommandPolicy,
  ProjectRuntimeNetworkPolicy,
  ProviderDescriptor,
  ProviderId,
  SettingsSection,
  ThreadSummary
} from '../../../shared/domain';
import type { OllamaRuntimeSnapshot, StorageDiagnostics } from '../../../shared/ipc';

export interface SettingsViewProps {
  section: SettingsSection;
  setSection: (section: SettingsSection) => void;
  onBack: () => void;
  providers: ProviderDescriptor[];
  customProviders: CustomProviderSettings[];
  preferences: Preferences | null;
  librarySources: LibrarySourcesSnapshot | null;
  projectKnowledgeIndexStatus: ProjectKnowledgeIndexStatus | null;
  refreshProjectKnowledgeIndex: () => Promise<void>;
  openProjectKnowledgeSuggestedIndexDraft: () => Promise<void>;
  savePreferences: (input: Partial<Preferences>) => Promise<void>;
  refreshLibrarySources: () => Promise<void>;
  rescanSkillLibrary: () => Promise<void>;
  apiKeys: Record<ProviderId, string>;
  setApiKeys: Dispatch<SetStateAction<Record<ProviderId, string>>>;
  connectProvider: (providerId: ProviderId, mode?: 'cli' | 'api_key') => Promise<void>;
  adoptProviderAuth: (providerId: ProviderId) => Promise<void>;
  beginProviderInstall: (providerId: ProviderId) => void;
  clearProviderAuth: (providerId: ProviderId) => Promise<void>;
  refreshProvider: (providerId: ProviderId) => Promise<void>;
  saveCustomProvider: (input: CustomProviderSettingsSaveInput) => Promise<CustomProviderSettings>;
  deleteCustomProvider: (providerId: string) => Promise<void>;
  pullOllamaModel: (model: string) => Promise<void>;
  ollamaPullProgress: OllamaPullProgress | null;
  ollamaRuntimeStatus: OllamaRuntimeSnapshot | null;
  stopOllamaRuntime: () => Promise<void>;
  deleteOllamaModel: (model: string) => Promise<void>;
  saveProviderApiKey: (providerId: ProviderId) => Promise<void>;
  exportDiagnostics: () => Promise<void>;
  exportActiveThreadReport: () => Promise<void>;
  clearAllProviderAuth: () => Promise<void>;
  appMeta: AppMeta | null;
  appUpdateState: AppUpdateState | null;
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
  activeThreadTitle: string | null;
  archivedThreads: ThreadSummary[];
  projects: Project[];
  restoreArchivedThread: (threadId: string) => Promise<void>;
  deleteArchivedThread: (threadId: string) => Promise<void>;
}
