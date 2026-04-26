import type { CollabBootstrap } from '../../shared/domain';
import {
  applyBootstrapPayload,
  applyCollaborationBootstrapPayload,
  type AppShellBootstrapHost
} from './app-shell-bootstrap';

type CollaborationBootstrapHost = AppShellBootstrapHost & {
  loadCollaborationBootstrap: () => Promise<CollabBootstrap>;
};

export async function refreshAppShellBootstrapState(host: AppShellBootstrapHost) {
  applyBootstrapPayload(host, await host.loadBootstrap());
}

export async function refreshCollaborationBootstrapState(host: CollaborationBootstrapHost) {
  applyCollaborationBootstrapPayload(host, await host.loadCollaborationBootstrap());
}
