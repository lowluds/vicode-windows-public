import type { CollabBootstrap } from '../../shared/domain';

export type CollaborationSection = 'chat' | 'rooms' | 'chats' | 'contacts' | 'profile';

export const collaborationSectionLabels: Record<CollaborationSection, string> = {
  chat: 'Chat',
  rooms: 'Chat',
  chats: 'Chat',
  contacts: 'Contacts',
  profile: 'Profile'
};

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
