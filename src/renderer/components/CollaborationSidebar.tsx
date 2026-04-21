import { useMemo, useState } from 'react';
import { ActionButton, SelectableRowButton, StatusPill, TextInput } from './ui';
import type { CollabBootstrap } from '../../shared/domain';
import type { CollaborationSection } from '../lib/collaboration';
import { collaborationSectionLabels } from '../lib/collaboration';
import { cx } from './ui/utils';

interface CollaborationSidebarProps {
  compact?: boolean;
  section: CollaborationSection;
  onSelectSection: (section: CollaborationSection) => void;
  collaboration: CollabBootstrap;
  selectedRoomId: string;
  selectedChatId: string;
  selectedContactId: string;
  onSelectRoom: (roomId: string) => void;
  onSelectChat: (chatId: string) => void;
  onSelectContact: (contactId: string) => void;
}

function toneForStatus(status: string) {
  switch (status) {
    case 'online':
    case 'connected':
      return 'connected';
    case 'away':
    case 'identity_required':
    case 'connecting':
      return 'warning';
    case 'busy':
    case 'error':
      return 'failed';
    default:
      return 'default';
  }
}

function sectionSearchPlaceholder(section: CollaborationSection) {
  switch (section) {
    case 'chat':
      return 'Search conversations';
    case 'rooms':
      return 'Search conversations';
    case 'chats':
      return 'Search conversations';
    case 'contacts':
      return 'Search contacts';
    case 'profile':
      return 'Search profile';
  }
}

function matchesSearch(value: string, query: string) {
  return value.toLowerCase().includes(query.trim().toLowerCase());
}

function formatRelativeTime(value: string | null) {
  if (!value) return '';
  const deltaMinutes = Math.max(1, Math.floor((Date.now() - new Date(value).getTime()) / 60000));
  if (deltaMinutes < 60) return `${deltaMinutes}m`;
  const deltaHours = Math.floor(deltaMinutes / 60);
  if (deltaHours < 24) return `${deltaHours}h`;
  return `${Math.floor(deltaHours / 24)}d`;
}

function roomPreview(room: CollabBootstrap['rooms'][number]) {
  const parts = [room.joinCode, room.topic ?? room.projectLabel].filter(Boolean);
  return parts.length > 0 ? parts.join(' • ') : 'No topic yet';
}

function statusLabel(status: string) {
  return status
    .split('_')
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(' ');
}

function buildInitials(value: string) {
  const parts = value.trim().split(/\s+/u).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 1).toUpperCase();
  return `${parts[0]!.slice(0, 1)}${parts[1]!.slice(0, 1)}`.toUpperCase();
}

function avatarTone(seed: string) {
  const tones = [
    'border-[color:var(--ui-border-soft)] bg-[color:var(--ui-surface-2)] text-[color:var(--ui-text-title)]',
    'border-[color:var(--ui-border-soft)] bg-[color:var(--ui-surface-3)] text-[color:var(--ui-text-title)]',
    'border-[color:var(--ui-alpha-08)] bg-[color:var(--ui-alpha-06)] text-[color:var(--ui-text-title)]',
    'border-[color:var(--ui-border-soft)] bg-[color:var(--ui-surface-2)] text-[color:var(--ui-text-muted)]'
  ];
  let hash = 0;
  for (const char of seed) {
    hash = (hash + char.charCodeAt(0)) % tones.length;
  }
  return tones[hash]!;
}

function PresenceDot({ status }: { status: string }) {
  return (
    <span
      className={cx(
        'inline-flex size-2 rounded-full',
        status === 'online' || status === 'connected'
          ? 'bg-[color:var(--ui-success)]'
          : status === 'busy'
            ? 'bg-[color:var(--ui-warning)]'
            : 'bg-[color:var(--ui-text-subtle)]'
      )}
    />
  );
}

export function CollaborationSidebar(props: CollaborationSidebarProps) {
  const [query, setQuery] = useState('');
  const isChatSurface = props.section === 'chat' || props.section === 'rooms' || props.section === 'chats';
  const projectRooms = props.collaboration.rooms.filter((room) => room.type !== 'dm');
  const chats = props.collaboration.rooms.filter((room) => room.type === 'dm');

  const filteredRooms = useMemo(
    () => projectRooms.filter((room) => matchesSearch(`${room.name} ${room.topic ?? ''} ${room.projectLabel ?? ''} ${room.joinCode ?? ''}`, query)),
    [projectRooms, query]
  );
  const filteredChats = useMemo(
    () => chats.filter((room) => matchesSearch(`${room.name} ${room.lastMessagePreview ?? ''}`, query)),
    [chats, query]
  );
  const filteredContacts = useMemo(
    () =>
      props.collaboration.contacts.filter((contact) =>
        matchesSearch(`${contact.displayName} ${contact.handle ?? ''} ${contact.lastRoomName ?? ''}`, query)
      ),
    [props.collaboration.contacts, query]
  );

  const activeIdentityLabel = props.collaboration.profile?.displayName ?? 'No guest identity';
  const activeIdentityHandle = props.collaboration.profile?.handle ?? 'Create one to enter rooms';
  const groupedContacts = useMemo(() => {
    const groups = new Map<string, typeof filteredContacts>();
    for (const contact of filteredContacts) {
      const letter = contact.displayName.slice(0, 1).toUpperCase();
      const current = groups.get(letter) ?? [];
      current.push(contact);
      groups.set(letter, current);
    }
    return [...groups.entries()].sort(([left], [right]) => left.localeCompare(right));
  }, [filteredContacts]);
  const sectionTabs = [
    { id: 'chat' as const, label: 'Chat' },
    { id: 'contacts' as const, label: 'Contacts' },
    { id: 'profile' as const, label: 'Profile' }
  ];

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 px-1 text-[color:var(--ui-text-title)]">
      <div className="px-1 py-1">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-[18px] font-semibold tracking-[-0.02em] text-[color:var(--ui-text-title)]">{isChatSurface ? 'Chat' : collaborationSectionLabels[props.section]}</h3>
            {!props.compact ? (
              <p className="mt-1 text-[13px] leading-5 text-[color:var(--ui-text-muted)]">
                {isChatSurface
                  ? 'Rooms and direct messages live in one chat surface.'
                  : props.section === 'contacts'
                    ? 'People you already collaborate with.'
                    : 'Your guest identity and collaboration defaults.'}
              </p>
            ) : null}
          </div>
          <StatusPill tone={toneForStatus(props.collaboration.config.connectionState)}>{statusLabel(props.collaboration.config.connectionState)}</StatusPill>
        </div>
      </div>

      <div className="flex gap-2 px-1">
        {sectionTabs.map((tab) => {
          const active = tab.id === 'chat' ? isChatSurface : props.section === tab.id;
          return (
            <ActionButton
              key={tab.id}
              data-testid={`collab-section-${tab.id}`}
              size="compact"
              tone={active ? 'default' : 'quiet'}
              className={cx('flex-1 rounded-[16px]', active && 'border-[color:var(--ui-border)] bg-[color:var(--ui-alpha-06)]')}
              aria-pressed={active}
              onClick={() => props.onSelectSection(tab.id)}
            >
              {tab.label}
            </ActionButton>
          );
        })}
      </div>

      <TextInput
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={sectionSearchPlaceholder(props.section)}
        className="h-11 rounded-[18px] border-[color:var(--ui-border-soft)] bg-transparent text-[color:var(--ui-text-title)] placeholder:text-[color:var(--ui-text-subtle)]"
      />

      <div data-testid="collab-sidebar-scroll" className="ui-stable-scroll flex min-h-0 flex-1 flex-col gap-4 pr-1">
        {isChatSurface ? (
          <div className="p-1">
            <div className="space-y-5">
              <div>
                <div className="mb-3 text-[12px] font-semibold uppercase tracking-[0.14em] text-[color:var(--ui-text-subtle)]">Rooms</div>
                <div className="space-y-2">
                  {filteredRooms.map((room) => (
                    <SelectableRowButton
                      key={room.id}
                      selected={room.id === props.selectedRoomId}
                      className="items-center px-3 py-2.5"
                      onClick={() => props.onSelectRoom(room.id)}
                    >
                      <div className={cx('flex size-9 shrink-0 items-center justify-center rounded-xl border', avatarTone(room.name))}>
                        {buildInitials(room.name)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[14px] font-semibold text-[color:var(--ui-text-title)]">{room.name}</div>
                        <div className="mt-0.5 truncate text-[12px] text-[color:var(--ui-text-muted)]">{roomPreview(room)}</div>
                      </div>
                      {room.unreadCount > 0 ? (
                        <span className="shrink-0 rounded-full bg-[color:var(--ui-alpha-08)] px-2 py-0.5 text-[11px] font-medium text-[color:var(--ui-text-title)]">{room.unreadCount}</span>
                      ) : (
                        <span className="shrink-0 text-[11px] text-[color:var(--ui-text-subtle)]">{room.memberCount} members</span>
                      )}
                    </SelectableRowButton>
                  ))}
                </div>
              </div>
              <div>
                <div className="mb-3 text-[12px] font-semibold uppercase tracking-[0.14em] text-[color:var(--ui-text-subtle)]">Direct messages</div>
                <div className="space-y-2">
                  {filteredChats.map((chat) => (
                    <SelectableRowButton
                      key={chat.id}
                      selected={chat.id === props.selectedChatId}
                      className="items-start px-3 py-3"
                      onClick={() => props.onSelectChat(chat.id)}
                    >
                      <div className={cx('flex size-11 shrink-0 items-center justify-center rounded-full border', avatarTone(chat.name))}>
                        {buildInitials(chat.name)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-3">
                          <span className="truncate text-[14px] font-semibold text-[color:var(--ui-text-title)]">{chat.name}</span>
                          <span className="text-[11px] text-[color:var(--ui-text-subtle)]">{formatRelativeTime(chat.lastActivityAt)}</span>
                        </div>
                        <div className="mt-1 truncate text-[12px] text-[color:var(--ui-text-muted)]">{chat.lastMessagePreview ?? 'No direct messages yet.'}</div>
                      </div>
                    </SelectableRowButton>
                  ))}
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {props.section === 'contacts' ? (
          <div className="p-1">
            <div className="space-y-5">
              {groupedContacts.map(([letter, contacts]) => (
                <div key={letter}>
                  <div className="mb-3 text-[12px] font-semibold uppercase tracking-[0.16em] text-[color:var(--ui-text-subtle)]">{letter}</div>
                  <div className="space-y-2">
                    {contacts.map((contact) => (
                      <SelectableRowButton
                        key={contact.userId}
                        selected={contact.userId === props.selectedContactId}
                        className="px-3 py-3"
                        onClick={() => props.onSelectContact(contact.userId)}
                      >
                        <div className={cx('flex size-10 shrink-0 items-center justify-center rounded-full border', avatarTone(contact.displayName))}>
                          {buildInitials(contact.displayName)}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[14px] font-semibold text-[color:var(--ui-text-title)]">{contact.displayName}</div>
                          <div className="truncate text-[12px] text-[color:var(--ui-text-muted)]">{contact.handle ?? contact.lastRoomName ?? 'Shared guest'}</div>
                        </div>
                        <PresenceDot status={contact.status} />
                      </SelectableRowButton>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {props.section === 'profile' ? (
          <div className="p-1">
            <div className="flex flex-col items-center text-center">
              <div className={cx('flex size-24 items-center justify-center rounded-full border text-[24px] font-semibold', avatarTone(activeIdentityLabel))}>
                {buildInitials(activeIdentityLabel)}
              </div>
              <div className="mt-4 text-[22px] font-semibold tracking-[-0.03em] text-[color:var(--ui-text-title)]">{activeIdentityLabel}</div>
              <div className="mt-2 inline-flex items-center gap-2 text-[13px] text-[color:var(--ui-text-muted)]">
                <PresenceDot status={props.collaboration.profile?.status ?? 'offline'} />
                <span>{props.collaboration.profile?.status ?? 'offline'}</span>
              </div>
            </div>
            <div className="mt-6 border-t border-[color:var(--ui-border-soft)] pt-5 text-[13px] leading-6 text-[color:var(--ui-text-muted)]">
              {props.collaboration.profile?.bio ?? 'Create a guest identity, then update your handle, bio, and timezone from the profile panel.'}
            </div>
            <div className="mt-5 space-y-3 rounded-[18px] border border-[color:var(--ui-border-soft)] bg-transparent px-4 py-4">
              <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[color:var(--ui-text-subtle)]">About</div>
              <div className="space-y-3 text-[13px]">
                <div>
                  <div className="text-[color:var(--ui-text-subtle)]">Handle</div>
                  <div className="text-[color:var(--ui-text-title)]">{activeIdentityHandle}</div>
                </div>
                <div>
                  <div className="text-[color:var(--ui-text-subtle)]">Rooms</div>
                  <div className="text-[color:var(--ui-text-title)]">{projectRooms.length}</div>
                </div>
                <div>
                  <div className="text-[color:var(--ui-text-subtle)]">Contacts</div>
                  <div className="text-[color:var(--ui-text-title)]">{props.collaboration.contacts.length}</div>
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {((isChatSurface && filteredRooms.length === 0 && filteredChats.length === 0) ||
          (props.section === 'contacts' && filteredContacts.length === 0)) && (
          <div className="rounded-[20px] border border-dashed border-[color:var(--ui-border-soft)] bg-transparent px-4 py-5 text-center">
            <div className="text-[13px] font-medium text-[color:var(--ui-text-title)]">Nothing here yet</div>
            <div className="mt-1 text-[12px] leading-5 text-[color:var(--ui-text-muted)]">
              {isChatSurface
                ? 'Create a room or start a direct chat once collaboration activity exists.'
                : 'Contacts appear once you share rooms with other guests.'}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
