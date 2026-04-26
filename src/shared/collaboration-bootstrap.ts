import type { CollabBootstrap } from './domain';

export function createEmptyCollaborationBootstrap(): CollabBootstrap {
  return {
    config: {
      supabaseUrl: null,
      hasAnonKey: false,
      connectionState: 'unconfigured',
      lastError: null
    },
    account: {
      email: null,
      userId: null,
      expiresAt: null
    },
    profile: null,
    rooms: [],
    roomMembersByRoom: {},
    messagesByRoom: {},
    presenceByRoom: {},
    sharedThreadsByRoom: {},
    sharedRunsByRoom: {},
    handoffsByRoom: {},
    followersByRoom: {},
    roleRequestsByRoom: {},
    terminalStateByRoom: {},
    contacts: []
  };
}
