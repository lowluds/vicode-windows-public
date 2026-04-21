import { useEffect, useState } from 'react';
import type { CollabBootstrap, CollabPresenceStatus, CollabRoom } from '../../shared/domain';
import type { CollaborationSection } from '../lib/collaboration';
import { CollaborationSidebar } from './CollaborationSidebar';
import { CollaborationView } from './CollaborationView';

interface ChatUtilityPaneProps {
  section: CollaborationSection;
  standalone?: boolean;
  onBack?: () => void;
  collaboration: CollabBootstrap;
  selectedRoomId: string;
  selectedChatId: string;
  selectedContactId: string;
  onSelectSection: (section: CollaborationSection) => void;
  onSelectRoom: (roomId: string) => void;
  onSelectChat: (chatId: string) => void;
  onSelectContact: (contactId: string) => void;
  onCreateGuestProfile: (input: { displayName: string; handle?: string | null }) => Promise<void>;
  onClearIdentity: () => Promise<void>;
  onSaveProfile: (input: {
    displayName?: string;
    handle?: string | null;
    bio?: string | null;
    timezone?: string | null;
    status?: CollabPresenceStatus;
  }) => Promise<void>;
  onCreateRoom: (input: { name: string; password?: string | null; topic?: string | null }) => Promise<CollabRoom | null>;
  onJoinRoom: (input: { joinCode: string; password?: string | null }) => Promise<CollabRoom | null>;
  onCreateDirectChat: (input: { peerUserId: string }) => Promise<CollabRoom | null>;
  onSetFollowing: (roomId: string, following: boolean) => Promise<void>;
  onRequestRole: (roomId: string, requestedRole: 'contributor' | 'driver') => Promise<void>;
  onResolveRoleRequest: (roomId: string, requestId: string, status: 'approved' | 'declined') => Promise<void>;
  onSetTerminalMode: (roomId: string, mode: 'off' | 'announce_only', note?: string | null) => Promise<void>;
  onSendMessage: (roomId: string, body: string) => Promise<boolean>;
  onShareCurrentThread: (roomId?: string | null) => Promise<void>;
  onShareCurrentRun: (roomId?: string | null) => Promise<void>;
  onCreateHandoff: (roomId?: string | null) => Promise<void>;
}

export function ChatUtilityPane(props: ChatUtilityPaneProps) {
  const [isNarrowStandalone, setIsNarrowStandalone] = useState(() =>
    typeof window !== 'undefined' && props.standalone ? window.innerWidth <= 960 : false
  );

  useEffect(() => {
    if (!props.standalone) {
      setIsNarrowStandalone(false);
      return;
    }

    const syncViewport = () => {
      setIsNarrowStandalone(window.innerWidth <= 960);
    };

    syncViewport();
    window.addEventListener('resize', syncViewport);
    return () => window.removeEventListener('resize', syncViewport);
  }, [props.standalone]);

  const compactMode = !props.standalone || isNarrowStandalone;

  function handleSelectRoom(roomId: string) {
    props.onSelectSection('rooms');
    props.onSelectChat('');
    props.onSelectRoom(roomId);
  }

  function handleSelectChat(chatId: string) {
    props.onSelectSection('chats');
    props.onSelectRoom('');
    props.onSelectChat(chatId);
  }

  return (
    <aside
      className={`chat-utility-pane${props.standalone ? ' chat-utility-pane-standalone' : ''}${compactMode ? ' chat-utility-pane-compact' : ''}`}
    >
      <div
        className="chat-utility-pane-layout collab-view flex h-full min-h-0"
        data-testid="chat-utility-pane-layout"
      >
        <div className="chat-utility-pane-sidebar min-h-0 shrink-0" data-testid="chat-utility-pane-sidebar">
          <CollaborationSidebar
            compact={compactMode}
            section={props.section}
            onSelectSection={props.onSelectSection}
            collaboration={props.collaboration}
            selectedRoomId={props.selectedRoomId}
            selectedChatId={props.selectedChatId}
            selectedContactId={props.selectedContactId}
            onSelectRoom={handleSelectRoom}
            onSelectChat={handleSelectChat}
            onSelectContact={props.onSelectContact}
          />
        </div>
        <div className="chat-utility-pane-body min-h-0 min-w-0 flex-1" data-testid="chat-utility-pane-body">
        <CollaborationView
          section={props.section}
          compact={compactMode}
          onBack={props.onBack}
          collaboration={props.collaboration}
          selectedRoomId={props.selectedRoomId}
          selectedChatId={props.selectedChatId}
          selectedContactId={props.selectedContactId}
          onSelectSection={props.onSelectSection}
          onSelectRoom={handleSelectRoom}
          onSelectChat={handleSelectChat}
          onSelectContact={props.onSelectContact}
          onCreateGuestProfile={props.onCreateGuestProfile}
          onClearIdentity={props.onClearIdentity}
          onSaveProfile={props.onSaveProfile}
          onCreateRoom={props.onCreateRoom}
          onJoinRoom={props.onJoinRoom}
          onCreateDirectChat={props.onCreateDirectChat}
          onSetFollowing={props.onSetFollowing}
          onRequestRole={props.onRequestRole}
          onResolveRoleRequest={props.onResolveRoleRequest}
          onSetTerminalMode={props.onSetTerminalMode}
          onSendMessage={props.onSendMessage}
          onShareCurrentThread={props.onShareCurrentThread}
          onShareCurrentRun={props.onShareCurrentRun}
          onCreateHandoff={props.onCreateHandoff}
        />
        </div>
      </div>
    </aside>
  );
}
