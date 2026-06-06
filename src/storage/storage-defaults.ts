import type {
  CollabAccount,
  CollabConfig,
  ProjectRuntimeCommandPolicy,
  ProjectRuntimeNetworkPolicy
} from '../shared/domain';

export const DEFAULT_PROJECT_RUNTIME_COMMAND_POLICY: ProjectRuntimeCommandPolicy =
  'approval_required';
export const DEFAULT_PROJECT_RUNTIME_NETWORK_POLICY: ProjectRuntimeNetworkPolicy =
  'disabled';

export const DEFAULT_COLLAB_CONFIG: CollabConfig = {
  supabaseUrl: null,
  hasAnonKey: false,
  connectionState: 'unconfigured',
  lastError: null,
};

export const DEFAULT_COLLAB_ACCOUNT: CollabAccount = {
  email: null,
  userId: null,
  expiresAt: null,
};
