export type {
  AppZoomAction,
  MicrophoneAccessStatus,
  NativeThemeSnapshot,
  OllamaModelMutationResult,
  OllamaRuntimeSnapshot,
  StorageCompactionResult,
  StorageDiagnostics,
  StorageMaintenanceResult,
  ThreadCollaborationSummary
} from './ipc-bootstrap-types';
import type { AppDomainApi } from './ipc-app-domain';
import type { ThreadDomainApi } from './ipc-thread-domain';
import type { FeatureDomainApi } from './ipc-feature-domain';

export type VicodeApi = AppDomainApi & ThreadDomainApi & FeatureDomainApi;

declare global {
  interface Window {
    vicode: VicodeApi;
  }
}
