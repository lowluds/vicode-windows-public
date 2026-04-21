import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ActionButton, IconButton, Menu, MenuContent, MenuItem, MenuItemLabel, MenuSeparator, MenuTrigger, PrimaryButton, StatusPill, TextArea, TextInput } from './ui';
import { AccessIcon, CloseIcon, CopyIcon, GlobeIcon, MoreIcon, PlayIcon, SendIcon, ShieldIcon, ThreadDotIcon, UsersIcon } from './icons';
import type { CollabBootstrap, CollabHandoff, CollabPresenceStatus, CollabRoom, CollabSharedRun, CollabSharedThread } from '../../shared/domain';
import type { CollaborationSection } from '../lib/collaboration';
import { collaborationSectionLabels } from '../lib/collaboration';
import { cx } from './ui/utils';
import { Suggestion, Suggestions } from './ai-elements/suggestion';

interface CollaborationViewProps {
  section: CollaborationSection;
  compact?: boolean;
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

type BusyAction = 'config' | 'identity' | 'profile' | 'create-room' | 'join-room' | 'direct-chat' | 'message' | null;
type RoomAccessMode = 'create' | 'join';

interface FollowUpSuggestion {
  id: string;
  title: string;
  detail: string;
  prompt?: string;
  action?: 'share-thread' | 'share-run' | 'create-handoff';
}

function toneForStatus(status: string) {
  switch (status) {
    case 'online':
    case 'connected':
    case 'ready':
    case 'running':
    case 'shared':
      return 'connected';
    case 'away':
    case 'identity_required':
    case 'connecting':
    case 'pending':
    case 'queued':
      return 'warning';
    case 'busy':
    case 'failed':
    case 'error':
    case 'blocked':
      return 'failed';
    default:
      return 'default';
  }
}

function sectionDescription(section: CollaborationSection) {
  switch (section) {
    case 'chat':
      return 'Rooms and direct messages now live in one simple collaboration surface.';
    case 'rooms':
      return 'Rooms and direct messages live in one focused chat surface.';
    case 'chats':
      return 'Rooms and direct messages live in one focused chat surface.';
    case 'contacts':
      return 'Contacts derive from the rooms you already share, not a separate address book.';
    case 'profile':
      return 'Your guest identity, status, and collaboration defaults.';
  }
}

function formatRelativeTime(value: string | null) {
  if (!value) return 'now';
  const minutes = Math.max(1, Math.floor((Date.now() - new Date(value).getTime()) / 60000));
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function formatProviderModel(providerId: string, modelId: string) {
  return `${providerId} / ${modelId}`;
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
    'bg-[color:var(--ui-alpha-08)] text-[color:var(--ui-text-title)] ring-[color:var(--ui-border)]',
    'bg-[color:var(--ui-alpha-08)] text-[color:var(--ui-text-title)] ring-[color:var(--ui-border)]',
    'bg-[color:var(--ui-alpha-08)] text-[color:var(--ui-text-title)] ring-[color:var(--ui-border)]',
    'bg-[color:var(--ui-alpha-08)] text-[color:var(--ui-text-title)] ring-[color:var(--ui-border-strong)]'
  ];
  let hash = 0;
  for (const char of seed) {
    hash = (hash + char.charCodeAt(0)) % tones.length;
  }
  return tones[hash]!;
}

function formatDiffSummary(
  diffStats: { filesChanged: number; insertions: number; deletions: number } | null,
  changedFilesCount: number
) {
  if (!diffStats) {
    return changedFilesCount > 0 ? `${changedFilesCount} changed file${changedFilesCount === 1 ? '' : 's'}` : 'No file changes recorded';
  }
  return `${diffStats.filesChanged} file${diffStats.filesChanged === 1 ? '' : 's'}  +${diffStats.insertions}  -${diffStats.deletions}`;
}

function buildFollowUpSuggestions(
  latestSharedThread: CollabSharedThread | null,
  latestSharedRun: CollabSharedRun | null,
  latestHandoff: CollabHandoff | null
): FollowUpSuggestion[] {
  if (!latestSharedThread) {
    return [
      {
        id: 'share-thread',
        title: 'Share the current thread',
        detail: 'Rooms become useful once everyone can see the active thread, summary, and driver.',
        action: 'share-thread'
      }
    ];
  }

  const suggestions: FollowUpSuggestion[] = [];

  if (!latestSharedRun) {
    suggestions.push({
      id: 'share-run',
      title: 'Publish the latest run',
      detail: 'Share the current run so the room can track execution status, diff size, and tests.',
      action: 'share-run'
    });
  } else if (latestSharedRun.status === 'failed') {
    suggestions.push({
      id: 'failed-run-handoff',
      title: 'Capture the failing state',
      detail: latestSharedRun.testsSummary ?? latestSharedRun.resultLabel ?? 'The latest run failed. Freeze the context before the room loses the exact failure state.',
      action: 'create-handoff'
    });
  } else if (latestSharedRun.status === 'completed' && latestSharedRun.changedFiles.length > 0 && !latestHandoff) {
    suggestions.push({
      id: 'completed-run-handoff',
      title: 'Checkpoint the completed run',
      detail: `${latestSharedRun.changedFiles.length} file${latestSharedRun.changedFiles.length === 1 ? '' : 's'} changed in the latest run. Create a handoff so the next guest can pick up from a stable checkpoint.`,
      action: 'create-handoff'
    });
  } else if (latestSharedRun.status === 'queued' || latestSharedRun.status === 'running') {
    suggestions.push({
      id: 'watch-active-run',
      title: 'Keep the room aligned while the run is active',
      detail: 'Use the room to confirm ownership and review criteria now, so the result does not land into silence.'
    });
  }

  if (latestHandoff?.recommendedNextPrompt) {
    suggestions.push({
      id: 'recommended-prompt',
      title: 'Use the latest handoff prompt',
      detail: 'The room already has a recommended continuation prompt. Reuse it instead of re-briefing from scratch.',
      prompt: latestHandoff.recommendedNextPrompt
    });
  } else if (latestHandoff?.outstandingTasks.length) {
    const nextTask = latestHandoff.outstandingTasks[0]!;
    suggestions.push({
      id: 'outstanding-task',
      title: 'Resume the top outstanding task',
      detail: nextTask,
      prompt: `Continue the room handoff. Start with this task: ${nextTask}`
    });
  } else if (latestSharedThread.status === 'failed') {
    const focus = latestSharedThread.latestAssistantSummary ?? latestSharedThread.lastPromptSummary ?? latestSharedThread.title;
    suggestions.push({
      id: 'recover-thread',
      title: 'Recover the failed thread',
      detail: 'Turn the latest failed attempt into a tighter next prompt for the room.',
      prompt: `Continue the shared thread "${latestSharedThread.title}". Recover from the last failed attempt and focus on: ${focus}`
    });
  } else if (latestSharedThread.lastPromptSummary) {
    suggestions.push({
      id: 'continue-thread',
      title: 'Queue the next room prompt',
      detail: 'The shared thread already has enough context for a clean continuation.',
      prompt: `Continue the shared thread "${latestSharedThread.title}". Use the latest room context and focus on: ${latestSharedThread.lastPromptSummary}`
    });
  }

  return suggestions.slice(0, 3);
}

function Panel({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-[28px] border border-[color:var(--ui-border-soft)] bg-[color:var(--ui-surface-2)] p-6 shadow-none ${className}`}
    >
      {children}
    </div>
  );
}

function Metric({ icon, label, value, detail }: { icon: ReactNode; label: string; value: string; detail?: string }) {
  return (
    <div className="rounded-[22px] border border-[color:var(--ui-border-soft)] bg-[color:var(--ui-alpha-05)] px-4 py-4">
      <div className="flex size-9 items-center justify-center rounded-2xl bg-[color:var(--ui-alpha-04)] text-[color:var(--ui-text)]">{icon}</div>
      <div className="mt-4 text-[11px] font-semibold uppercase tracking-[0.12em] text-[color:var(--ui-text-subtle)]">{label}</div>
      <div className="mt-2 text-[18px] font-semibold text-[color:var(--ui-text-title)]">{value}</div>
      {detail ? <div className="mt-1 text-[12px] leading-5 text-[color:var(--ui-text)]">{detail}</div> : null}
    </div>
  );
}

function DetailPill({ children }: { children: ReactNode }) {
  return <span className="inline-flex rounded-full border border-[color:var(--ui-border-soft)] bg-[color:var(--ui-alpha-05)] px-2.5 py-1 text-[11px] text-[color:var(--ui-text)]">{children}</span>;
}

function DetailRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 text-[12px] leading-5">
      <span className="text-[color:var(--ui-text-subtle)]">{label}</span>
      <span className="max-w-[70%] text-right text-[color:var(--ui-text)]">{value}</span>
    </div>
  );
}

function AvatarBadge({
  label,
  status,
  size = 'default'
}: {
  label: string;
  status?: string | null;
  size?: 'default' | 'large';
}) {
  const sizeClass = size === 'large' ? 'size-16 text-[20px]' : 'size-12 text-[15px]';
  return (
    <div className="relative shrink-0">
      <div className={cx('flex items-center justify-center rounded-full font-semibold ring-1', sizeClass, avatarTone(label))}>
        {buildInitials(label)}
      </div>
      {status ? (
        <span
          className={cx(
            'absolute bottom-0 right-0 size-3 rounded-full border-2 border-[color:var(--ui-surface-2)]',
            status === 'online' || status === 'connected'
              ? 'bg-[color:var(--ui-success)]'
              : status === 'busy'
                ? 'bg-[color:var(--ui-warning)]'
                : 'bg-[color:var(--ui-text-subtle)]'
          )}
        />
      ) : null}
    </div>
  );
}

function MessageBubble({
  authorLabel,
  body,
  createdAt,
  isSelf
}: {
  authorLabel: string;
  body: string;
  createdAt: string;
  isSelf: boolean;
}) {
  return (
    <div className={cx('flex flex-col gap-1.5', isSelf ? 'items-end' : 'items-start')}>
      {!isSelf ? (
        <div className="px-1 text-[11px] font-medium tracking-[0.01em] text-[color:var(--ui-text-subtle)]">
          {authorLabel} <span className="text-[color:var(--ui-text-muted)]">· {formatRelativeTime(createdAt)}</span>
        </div>
      ) : null}
      <div
        className={cx(
          'max-w-[78%] rounded-[22px] px-4 py-3 text-[14px] leading-6 shadow-none',
          isSelf
            ? 'rounded-br-[8px] bg-[color:var(--ui-text-title)] text-[color:var(--ui-app-bg)]'
            : 'rounded-bl-[8px] bg-[color:var(--ui-alpha-05)] text-[color:var(--ui-text-title)]'
        )}
      >
        {body}
      </div>
      {isSelf ? <div className="px-1 text-[11px] text-[color:var(--ui-text-muted)]">{formatRelativeTime(createdAt)}</div> : null}
    </div>
  );
}

function ContextItem({
  label,
  title,
  description,
  status,
  meta,
  children
}: {
  label: string;
  title: string;
  description?: string | null;
  status?: string | null;
  meta?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="rounded-[20px] border border-[color:var(--ui-border-soft)] bg-[color:var(--ui-alpha-05)] px-4 py-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[color:var(--ui-text-subtle)]">{label}</div>
          <div className="mt-1 truncate text-[15px] font-semibold text-[color:var(--ui-text-title)]">{title}</div>
          {description ? <div className="mt-2 text-[13px] leading-6 text-[color:var(--ui-text)]">{description}</div> : null}
        </div>
        {status ? <StatusPill tone={toneForStatus(status)}>{status}</StatusPill> : null}
      </div>
      {children ? <div className="mt-3 space-y-3">{children}</div> : null}
      {meta ? <div className="mt-3 flex flex-wrap gap-2">{meta}</div> : null}
    </div>
  );
}

export function CollaborationView(props: CollaborationViewProps) {
  const isCompact = props.compact ?? false;
  const isChatSurface = props.section === 'chat' || props.section === 'rooms' || props.section === 'chats';
  const [guestDisplayName, setGuestDisplayName] = useState(props.collaboration.profile?.displayName ?? '');
  const [guestHandle, setGuestHandle] = useState(props.collaboration.profile?.handle ?? '');
  const [roomName, setRoomName] = useState('');
  const [roomPassword, setRoomPassword] = useState('');
  const [roomTopic, setRoomTopic] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [joinPassword, setJoinPassword] = useState('');
  const [messageBody, setMessageBody] = useState('');
  const [busyAction, setBusyAction] = useState<BusyAction>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [recentCreatedRoom, setRecentCreatedRoom] = useState<{ roomId: string; password: string | null } | null>(null);
  const [roomAccessMode, setRoomAccessMode] = useState<RoomAccessMode>('create');
  const [profileDraft, setProfileDraft] = useState({
    displayName: props.collaboration.profile?.displayName ?? '',
    handle: props.collaboration.profile?.handle ?? '',
    bio: props.collaboration.profile?.bio ?? '',
    timezone: props.collaboration.profile?.timezone ?? '',
    status: props.collaboration.profile?.status ?? 'online'
  });

  useEffect(() => {
    setGuestDisplayName(props.collaboration.profile?.displayName ?? '');
    setGuestHandle(props.collaboration.profile?.handle ?? '');
    setProfileDraft({
      displayName: props.collaboration.profile?.displayName ?? '',
      handle: props.collaboration.profile?.handle ?? '',
      bio: props.collaboration.profile?.bio ?? '',
      timezone: props.collaboration.profile?.timezone ?? '',
      status: props.collaboration.profile?.status ?? 'online'
    });
  }, [props.collaboration.profile]);

  const rooms = useMemo(() => props.collaboration.rooms.filter((room) => room.type !== 'dm'), [props.collaboration.rooms]);
  const chats = useMemo(() => props.collaboration.rooms.filter((room) => room.type === 'dm'), [props.collaboration.rooms]);
  const activeRoom = rooms.find((room) => room.id === props.selectedRoomId) ?? rooms[0] ?? null;
  const activeChat = chats.find((room) => room.id === props.selectedChatId) ?? chats[0] ?? null;
  const activeContact = props.collaboration.contacts.find((contact) => contact.userId === props.selectedContactId) ?? props.collaboration.contacts[0] ?? null;
  const activeConversation = props.section === 'rooms'
    ? activeRoom
    : props.section === 'chats'
      ? activeChat
      : props.section === 'chat'
        ? (props.selectedChatId ? activeChat : activeRoom ?? activeChat)
        : null;
  const activeMessages = activeConversation ? props.collaboration.messagesByRoom[activeConversation.id] ?? [] : [];
  const activePresence = activeConversation ? props.collaboration.presenceByRoom[activeConversation.id] ?? [] : [];
  const activeThreads = activeConversation ? props.collaboration.sharedThreadsByRoom[activeConversation.id] ?? [] : [];
  const activeRuns = activeConversation ? props.collaboration.sharedRunsByRoom[activeConversation.id] ?? [] : [];
  const activeHandoffs = activeConversation ? props.collaboration.handoffsByRoom[activeConversation.id] ?? [] : [];
  const activeMembers = activeConversation ? props.collaboration.roomMembersByRoom[activeConversation.id] ?? [] : [];
  const activeChatPeer = activeChat
    ? (props.collaboration.roomMembersByRoom[activeChat.id] ?? []).find((member) => member.userId !== props.collaboration.account.userId) ?? null
    : null;
  const activeChatPeerRooms = activeChatPeer
    ? rooms.filter((room) => (props.collaboration.roomMembersByRoom[room.id] ?? []).some((member) => member.userId === activeChatPeer.userId))
    : [];
  const activeContactRooms = activeContact
    ? rooms.filter((room) => (props.collaboration.roomMembersByRoom[room.id] ?? []).some((member) => member.userId === activeContact.userId))
    : [];
  const activeContactChat = activeContact ? chats.find((room) => room.directUserId === activeContact.userId) ?? null : null;
  const activeContactMessages = activeContactChat ? props.collaboration.messagesByRoom[activeContactChat.id] ?? [] : [];
  const isRoomConversation = Boolean(activeConversation && activeConversation.type !== 'dm');
  const isDirectConversation = Boolean(activeConversation && activeConversation.type === 'dm');
  const showChatSetupState = isChatSurface && !activeConversation;
  const activeProfile = props.collaboration.profile;
  const totalSharedRuns = Object.values(props.collaboration.sharedRunsByRoom).reduce((sum, items) => sum + items.length, 0);
  const totalSharedThreads = Object.values(props.collaboration.sharedThreadsByRoom).reduce((sum, items) => sum + items.length, 0);
  const trimmedRoomPassword = roomPassword.trim();
  const trimmedJoinPassword = joinPassword.trim();
  const roomPasswordIsValid = trimmedRoomPassword.length === 0 || trimmedRoomPassword.length >= 3;
  const joinPasswordIsValid = trimmedJoinPassword.length === 0 || trimmedJoinPassword.length >= 3;
  const needsConfig = props.collaboration.config.connectionState === 'unconfigured' || !props.collaboration.config.hasAnonKey;
  const needsIdentity = !needsConfig && (!props.collaboration.account.userId || props.collaboration.config.connectionState === 'identity_required');
  const isHostConversation = Boolean(
    isRoomConversation &&
      activeConversation &&
      props.collaboration.account.userId &&
      activeConversation.createdBy === props.collaboration.account.userId
  );
  const latestSharedThread = activeThreads[0] ?? null;
  const latestSharedRun = activeRuns[0] ?? null;
  const latestHandoff = activeHandoffs[0] ?? null;
  const followUpSuggestions = buildFollowUpSuggestions(latestSharedThread, latestSharedRun, latestHandoff);
  const activeFollowers = activeConversation ? props.collaboration.followersByRoom[activeConversation.id] ?? [] : [];
  const activeTerminalState = activeConversation ? props.collaboration.terminalStateByRoom[activeConversation.id] ?? null : null;
  const recentCreatedRoomDetails = recentCreatedRoom ? rooms.find((room) => room.id === recentCreatedRoom.roomId) ?? null : null;
  const isFollowerMode = Boolean(
    isRoomConversation &&
      activeConversation &&
      props.collaboration.account.userId &&
      activeFollowers.some((follower) => follower.userId === props.collaboration.account.userId)
  );
  const pendingRoleRequests = (activeConversation ? props.collaboration.roleRequestsByRoom[activeConversation.id] ?? [] : []).filter(
    (request) => request.status === 'pending'
  );

  async function runBusy<T>(state: Exclude<BusyAction, null>, action: () => Promise<T>) {
    setBusyAction(state);
    try {
      return await action();
    } finally {
      setBusyAction(null);
    }
  }

  async function copyValue(key: string, value: string | null) {
    if (!value) return;
    await navigator.clipboard.writeText(value);
    setCopiedKey(key);
    window.setTimeout(() => setCopiedKey((current) => (current === key ? null : current)), 1600);
  }

  async function handleFollowUpSuggestionSelection(suggestion: FollowUpSuggestion) {
    if (suggestion.prompt) {
      await copyValue(`followup:${suggestion.id}`, suggestion.prompt);
      return;
    }

    if (isFollowerMode || !activeConversation || !suggestion.action) {
      return;
    }

    if (suggestion.action === 'share-thread') {
      await props.onShareCurrentThread(activeConversation.id);
      return;
    }

    if (suggestion.action === 'share-run') {
      await props.onShareCurrentRun(activeConversation.id);
      return;
    }

    await props.onCreateHandoff(activeConversation.id);
  }

  return (
    <section className={cx('flex h-full min-h-0 flex-col gap-5 overflow-hidden text-[color:var(--ui-text-title)]', isCompact ? 'px-5 py-5' : 'px-8 py-8')}>
      <header className="collab-view-header flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className={cx('font-semibold text-[color:var(--ui-text-title)]', isCompact ? 'text-[18px] tracking-[-0.02em]' : 'text-[30px] tracking-[-0.04em]')}>
            {isChatSurface ? 'Chat' : collaborationSectionLabels[props.section]}
          </h2>
          {!isCompact ? <p className="mt-2 max-w-3xl text-[14px] leading-6 text-[color:var(--ui-text)]">{sectionDescription(props.section)}</p> : null}
        </div>
        <div className="collab-view-header-actions flex flex-wrap items-center gap-2">
          <StatusPill tone={toneForStatus(props.collaboration.config.connectionState)}>{statusLabel(props.collaboration.config.connectionState)}</StatusPill>
          {activeProfile ? <StatusPill tone={toneForStatus(activeProfile.status)}>{activeProfile.status}</StatusPill> : null}
          {props.onBack ? (
            <IconButton className="collab-view-close" label="Close collaboration" onClick={props.onBack}>
              <CloseIcon />
            </IconButton>
          ) : null}
        </div>
      </header>

      <div className="ui-stable-scroll flex min-h-0 flex-1 flex-col overflow-x-hidden pr-1">
      {needsConfig ? (
        <div className={cx('grid gap-6', isCompact ? 'grid-cols-1' : '2xl:grid-cols-[minmax(0,1.1fr)_380px]')}>
          <Panel>
            <div className="inline-flex rounded-full border border-[color:var(--ui-border)] bg-[color:var(--ui-alpha-04)] px-3 py-1 text-[11px] uppercase tracking-[0.14em] text-[color:var(--ui-text)]">Collaboration unavailable</div>
            <h3 className="mt-5 text-[28px] font-semibold tracking-[-0.04em] text-[color:var(--ui-text-title)]">Guest collaboration is not enabled on this device</h3>
            <p className="mt-3 max-w-xl text-[14px] leading-6 text-[color:var(--ui-text)]">The intended flow is still guest identity plus room code and password. The collaboration screen intentionally avoids exposing backend or infrastructure setup to users.</p>
            <div className={cx('mt-8 grid gap-3', isCompact ? 'grid-cols-1' : 'md:grid-cols-2 2xl:grid-cols-3')}>
              <Metric icon={<ShieldIcon />} label="Identity" value="Guest profile" detail="Create a local display name instead of signing into backend auth." />
              <Metric icon={<GlobeIcon />} label="Join model" value="Room code + password" />
              <Metric icon={<UsersIcon />} label="Scope" value="Threads, runs, handoffs" />
            </div>
          </Panel>
          <Panel>
            <div className="text-[18px] font-semibold text-[color:var(--ui-text-title)]">What users should expect</div>
            <div className="mt-2 text-[13px] leading-6 text-[color:var(--ui-text)]">Once collaboration is available, users create a guest identity, create or join a room with a code and password, and share threads, runs, and handoffs without seeing transport or service details.</div>
            <div className="mt-6 rounded-[20px] border border-[color:var(--ui-border-soft)] bg-[color:var(--ui-alpha-05)] px-4 py-4 text-[13px] leading-6 text-[color:var(--ui-text)]">
              This state is intentionally product-facing only. Backend configuration belongs outside the collaboration UI.
            </div>
          </Panel>
        </div>
      ) : needsIdentity ? (
        <div className={cx('grid gap-6', isCompact ? 'grid-cols-1' : '2xl:grid-cols-[minmax(0,1.1fr)_420px]')}>
          <Panel>
            <div className="inline-flex rounded-full border border-[color:var(--ui-border)] bg-[color:var(--ui-alpha-04)] px-3 py-1 text-[11px] uppercase tracking-[0.14em] text-[color:var(--ui-text)]">Guest identity</div>
            <h3 className="mt-5 text-[28px] font-semibold tracking-[-0.04em] text-[color:var(--ui-text-title)]">Create collaboration identity</h3>
            <p className="mt-3 max-w-xl text-[14px] leading-6 text-[color:var(--ui-text)]">Use a lightweight guest identity, then create or join rooms with a room code and an optional password.</p>
            <div className={cx('mt-8 grid gap-3', isCompact ? 'grid-cols-1' : 'md:grid-cols-2 2xl:grid-cols-3')}>
              <Metric icon={<UsersIcon />} label="No OTP" value="Join as a guest" />
              <Metric icon={<AccessIcon />} label="Optional access" value="Open or protected" />
              <Metric icon={<ThreadDotIcon />} label="Control model" value="Share work, not terminals" />
            </div>
            <div className="mt-8 rounded-[22px] border border-[color:var(--ui-border-soft)] bg-[color:var(--ui-alpha-05)] px-5 py-5 text-[13px] leading-6 text-[color:var(--ui-text)]">
              Rooms stay code-driven in v1, with an optional password when the host wants protected access. No global directory, no shared editor state, no remote shell control.
            </div>
          </Panel>
          <Panel>
            <div className="text-[18px] font-semibold text-[color:var(--ui-text-title)]">Continue with guest identity</div>
            <div className="mt-2 text-[13px] leading-6 text-[color:var(--ui-text)]">Pick a display name people will see in the room. Handles are optional.</div>
            <div className="mt-6 space-y-3">
              <TextInput value={guestDisplayName} onChange={(event) => setGuestDisplayName(event.target.value)} placeholder="Display name" />
              <TextInput value={guestHandle} onChange={(event) => setGuestHandle(event.target.value)} placeholder="@handle (optional)" />
              <PrimaryButton className="w-full" onClick={() => void runBusy('identity', () => props.onCreateGuestProfile({ displayName: guestDisplayName, handle: guestHandle || null }))} disabled={!guestDisplayName.trim() || busyAction === 'identity'}>
                {busyAction === 'identity' ? 'Creating...' : 'Continue with guest identity'}
              </PrimaryButton>
            </div>
          </Panel>
        </div>
      ) : props.section === 'contacts' ? (
        <div className="flex min-h-0 flex-col gap-6">
          <Panel className="bg-[color:var(--ui-alpha-03)]">
            {activeContact ? (
              <>
                <div className="flex items-center justify-between gap-4">
                  <div className="flex min-w-0 items-center gap-4">
                    <AvatarBadge label={activeContact.displayName} status={activeContact.status} size="large" />
                    <div className="min-w-0">
                      <div className="truncate text-[22px] font-semibold tracking-[-0.03em] text-[color:var(--ui-text-title)]">{activeContact.displayName}</div>
                      <div className="mt-1 truncate text-[13px] text-[color:var(--ui-text)]">{activeContact.handle ?? 'Shared guest contact'}</div>
                    </div>
                  </div>
                  <StatusPill tone={toneForStatus(activeContact.status)}>{activeContact.status}</StatusPill>
                </div>
                <div className="mt-5 flex flex-wrap gap-3">
                  {activeContactChat ? (
                    <ActionButton
                      onClick={() => {
                        props.onSelectChat(activeContactChat.id);
                        props.onSelectSection('chats');
                      }}
                    >
                      Open direct
                    </ActionButton>
                  ) : (
                    <ActionButton
                      onClick={() => void runBusy('direct-chat', () => props.onCreateDirectChat({ peerUserId: activeContact.userId }))}
                      disabled={busyAction === 'direct-chat'}
                    >
                      {busyAction === 'direct-chat' ? 'Opening...' : 'Start direct chat'}
                    </ActionButton>
                  )}
                </div>
              </>
            ) : (
              <div className="text-[14px] leading-6 text-[color:var(--ui-text)]">Select a contact from the sidebar.</div>
            )}
          </Panel>
        </div>
      ) : props.section === 'profile' ? (
        <Panel className="bg-[color:var(--ui-alpha-05)]">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-[22px] font-semibold tracking-[-0.03em] text-[color:var(--ui-text-title)]">Edit collaboration profile</div>
              <div className="mt-2 text-[13px] leading-6 text-[color:var(--ui-text)]">Keep the profile light. Display name, handle, timezone, and a short bio are enough for room context.</div>
            </div>
            <StatusPill tone={toneForStatus(activeProfile?.status ?? 'default')}>{activeProfile?.status ?? 'offline'}</StatusPill>
          </div>
          <div className="mt-6 grid gap-3 md:grid-cols-2">
            <TextInput value={profileDraft.displayName} onChange={(event) => setProfileDraft((current) => ({ ...current, displayName: event.target.value }))} placeholder="Display name" />
            <TextInput value={profileDraft.handle} onChange={(event) => setProfileDraft((current) => ({ ...current, handle: event.target.value }))} placeholder="@handle" />
            <TextInput value={profileDraft.timezone} onChange={(event) => setProfileDraft((current) => ({ ...current, timezone: event.target.value }))} placeholder="Timezone" className="md:col-span-2" />
            <TextArea value={profileDraft.bio} onChange={(event) => setProfileDraft((current) => ({ ...current, bio: event.target.value }))} placeholder="Bio" className="min-h-[180px] md:col-span-2" />
          </div>
          <div className="mt-5 flex flex-wrap gap-3">
            <PrimaryButton onClick={() => void runBusy('profile', () => props.onSaveProfile({ displayName: profileDraft.displayName, handle: profileDraft.handle || null, bio: profileDraft.bio || null, timezone: profileDraft.timezone || null, status: profileDraft.status }))} disabled={busyAction === 'profile'}>
              {busyAction === 'profile' ? 'Saving...' : 'Save profile'}
            </PrimaryButton>
            <ActionButton tone="quiet" onClick={() => void props.onClearIdentity()}>Reset identity</ActionButton>
          </div>
        </Panel>
      ) : (
        <div
          className={cx(
            'grid min-h-0 items-start gap-6',
            isCompact
              ? 'grid-cols-1'
              : showChatSetupState
                ? 'xl:grid-cols-[minmax(0,1fr)_360px]'
                : 'lg:grid-cols-[minmax(0,1fr)_320px] xl:grid-cols-[minmax(0,1.15fr)_360px]'
          )}
        >
          <div className="flex min-h-0 min-w-0 flex-col gap-6">
            {showChatSetupState && !isCompact ? (
            <Panel className="bg-[color:var(--ui-alpha-03)]">
              <div className="max-w-2xl">
                <div className="inline-flex rounded-full border border-[color:var(--ui-border-soft)] bg-[color:var(--ui-alpha-04)] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-[color:var(--ui-text-subtle)]">
                  Start collaboration
                </div>
                <div className="mt-5 text-[30px] font-semibold tracking-[-0.04em] text-[color:var(--ui-text-title)]">
                  Create a room or open a direct chat once people are available.
                </div>
                <div className="mt-3 max-w-xl text-[14px] leading-6 text-[color:var(--ui-text)]">
                  Rooms are best for shared threads, runs, and handoffs. Direct messages stay lightweight for quick coordination.
                </div>
              </div>
              <div className="mt-8 grid gap-3 md:grid-cols-3">
                <Metric icon={<UsersIcon />} label="Rooms" value={String(rooms.length)} detail="Shared workspaces with room codes." />
                <Metric icon={<ThreadDotIcon />} label="Direct chats" value={String(chats.length)} detail="Fast one-to-one coordination." />
                <Metric icon={<GlobeIcon />} label="Contacts" value={String(props.collaboration.contacts.length)} detail="People you already collaborate with." />
              </div>
              {props.collaboration.contacts.length > 0 ? (
                <div className="mt-8">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[color:var(--ui-text-subtle)]">Quick start</div>
                  <div className="mt-3 flex flex-wrap gap-3">
                    {props.collaboration.contacts.slice(0, 3).map((contact) => (
                      <ActionButton
                        key={contact.userId}
                        tone="quiet"
                        onClick={() => void runBusy('direct-chat', () => props.onCreateDirectChat({ peerUserId: contact.userId }))}
                        disabled={busyAction === 'direct-chat'}
                      >
                        {busyAction === 'direct-chat' ? 'Opening...' : `Message ${contact.displayName}`}
                      </ActionButton>
                    ))}
                  </div>
                </div>
              ) : null}
            </Panel>
            ) : !activeConversation && isChatSurface ? null : (
            <Panel>
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  {activeConversation ? (
                    <>
                      <div className="text-[24px] font-semibold tracking-[-0.03em] text-[color:var(--ui-text-title)]">{activeConversation.name}</div>
                      {activeConversation.topic ?? activeConversation.projectLabel ? (
                        <div className="mt-2 max-w-2xl text-[14px] leading-6 text-[color:var(--ui-text)]">{activeConversation.topic ?? activeConversation.projectLabel}</div>
                      ) : null}
                    </>
                  ) : null}
                </div>
                {activeConversation ? (
                  <div className="flex flex-wrap items-center gap-2">
                    {isRoomConversation ? <StatusPill tone="default">Code {activeConversation.joinCode ?? 'pending sync'}</StatusPill> : null}
                    <StatusPill tone="default">{activeMembers.length} members</StatusPill>
                    {isHostConversation ? <StatusPill tone="connected">Host</StatusPill> : null}
                    {isFollowerMode ? <StatusPill tone="default">Following</StatusPill> : null}
                    {isRoomConversation ? (
                      <ActionButton
                        size="compact"
                        leadingIcon={<CopyIcon />}
                        onClick={() => void copyValue(`code:${activeConversation.id}`, activeConversation.joinCode)}
                        disabled={!activeConversation.joinCode}
                      >
                        {copiedKey === `code:${activeConversation.id}` ? 'Copied' : 'Copy code'}
                      </ActionButton>
                    ) : null}
                    {isRoomConversation ? (
                      <Menu>
                        <MenuTrigger asChild>
                          <ActionButton size="compact" tone="quiet" leadingIcon={<MoreIcon />}>Room actions</ActionButton>
                        </MenuTrigger>
                        <MenuContent align="end">
                          <MenuItem onSelect={() => void props.onSetFollowing(activeConversation.id, !isFollowerMode)}>
                            <MenuItemLabel>{isFollowerMode ? 'Leave follower mode' : 'Follow room'}</MenuItemLabel>
                          </MenuItem>
                          {isHostConversation ? (
                            <MenuItem
                              onSelect={() =>
                                void props.onSetTerminalMode(
                                  activeConversation.id,
                                  activeTerminalState?.mode === 'announce_only' ? 'off' : 'announce_only',
                                  activeTerminalState?.mode === 'announce_only'
                                    ? null
                                    : 'Host is narrating the current terminal flow through shared runs and room updates.'
                                )
                              }
                            >
                              <MenuItemLabel>{activeTerminalState?.mode === 'announce_only' ? 'Disable shared terminal' : 'Enable shared terminal'}</MenuItemLabel>
                            </MenuItem>
                          ) : null}
                          {!isFollowerMode ? (
                            <>
                              <MenuSeparator />
                              <MenuItem onSelect={() => void props.onShareCurrentThread(activeConversation.id)}>
                                <MenuItemLabel>Share current thread</MenuItemLabel>
                              </MenuItem>
                              <MenuItem onSelect={() => void props.onShareCurrentRun(activeConversation.id)}>
                                <MenuItemLabel>Share latest run</MenuItemLabel>
                              </MenuItem>
                              <MenuItem onSelect={() => void props.onCreateHandoff(activeConversation.id)}>
                                <MenuItemLabel>Create handoff</MenuItemLabel>
                              </MenuItem>
                            </>
                          ) : null}
                          {!isHostConversation ? (
                            <>
                              <MenuSeparator />
                              <MenuItem onSelect={() => void props.onRequestRole(activeConversation.id, 'contributor')}>
                                <MenuItemLabel>Request contributor access</MenuItemLabel>
                              </MenuItem>
                              <MenuItem onSelect={() => void props.onRequestRole(activeConversation.id, 'driver')}>
                                <MenuItemLabel>Request driver handoff</MenuItemLabel>
                              </MenuItem>
                            </>
                          ) : null}
                        </MenuContent>
                      </Menu>
                    ) : null}
                  </div>
                ) : null}
              </div>
              {isRoomConversation ? (
                <div className="mt-5 flex flex-wrap items-center gap-3 text-[12px] leading-5 text-[color:var(--ui-text-muted)]">
                  <span>{activeThreads.length} shared thread{activeThreads.length === 1 ? '' : 's'}</span>
                  <span>{activeRuns.length} shared run{activeRuns.length === 1 ? '' : 's'}</span>
                  <span>{activeHandoffs.length} handoff{activeHandoffs.length === 1 ? '' : 's'}</span>
                  {pendingRoleRequests.length > 0 ? <span>{pendingRoleRequests.length} pending role request{pendingRoleRequests.length === 1 ? '' : 's'}</span> : null}
                  {isFollowerMode ? <span>Follower mode keeps the room read-only.</span> : null}
                </div>
              ) : null}
            </Panel>
            )}
            {activeConversation ? (
              <>
                <Panel className={cx('flex flex-col bg-[color:var(--ui-alpha-03)]', isCompact ? 'min-h-[320px] p-4' : 'min-h-[440px] p-5')}>
                  {!isCompact ? (
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-[18px] font-semibold text-[color:var(--ui-text-title)]">{activeConversation.name}</div>
                      <span className="text-[12px] text-[color:var(--ui-text-muted)]">{activeMessages.length} messages</span>
                    </div>
                  ) : null}
                  <div
                    data-testid="collab-conversation-scroll"
                    className={cx('collab-conversation-scroll ui-stable-scroll flex-1 space-y-3', isCompact ? 'min-h-[120px]' : 'mt-5')}
                  >
                    {activeMessages.length > 0 ? (
                      activeMessages.slice(-10).map((message) => (
                        <MessageBubble
                          key={message.id}
                          authorLabel={message.authorDisplayName}
                          body={message.body}
                          createdAt={message.createdAt}
                          isSelf={message.authorId === props.collaboration.account.userId}
                        />
                      ))
                    ) : (
                      <div className={cx('text-[13px] leading-6', isCompact ? 'px-1 py-2 text-[color:var(--ui-text-muted)]' : 'rounded-[20px] bg-[color:var(--ui-alpha-04)] px-4 py-5 text-[color:var(--ui-text)]')}>
                        {isDirectConversation ? 'No direct messages yet.' : 'Start the conversation in this room.'}
                      </div>
                    )}
                  </div>
                  <div className={cx('mt-4 rounded-[26px] bg-[color:var(--ui-alpha-05)] px-4 py-3', isFollowerMode && 'opacity-80')}>
                    <div className="flex items-end gap-3">
                      <TextArea
                        value={messageBody}
                        onChange={(event) => setMessageBody(event.target.value)}
                        placeholder={isDirectConversation ? 'Message this conversation' : isFollowerMode ? 'Follower mode keeps room chat read-only' : 'Message this room'}
                        className={cx(
                          'min-h-[72px] flex-1 resize-none border-0 bg-transparent px-0 py-0 text-[15px] leading-6 text-[color:var(--ui-text-title)] shadow-none focus:border-transparent',
                          isCompact ? 'min-h-[88px]' : 'min-h-[72px]'
                        )}
                        disabled={isFollowerMode}
                      />
                      <IconButton
                        onClick={() =>
                          void runBusy('message', async () => {
                            const sent = await props.onSendMessage(activeConversation.id, messageBody);
                            if (!sent) return;
                            setMessageBody('');
                          })
                        }
                        className="size-10 rounded-full border border-[color:var(--ui-border-soft)] bg-[color:var(--ui-text-title)] text-[color:var(--ui-app-bg)] shadow-none hover:border-[color:var(--ui-border)] hover:bg-[color:var(--ui-text-title)] disabled:border-transparent disabled:bg-[color:var(--ui-alpha-08)] disabled:text-[color:var(--ui-text-subtle)]"
                        label={isFollowerMode ? 'Watching room' : busyAction === 'message' ? 'Sending message' : 'Send message'}
                        disabled={!messageBody.trim() || busyAction === 'message' || isFollowerMode}
                      >
                        <SendIcon size={15} />
                      </IconButton>
                    </div>
                    {!isCompact ? (
                      <div className="mt-2 text-[12px] leading-5 text-[color:var(--ui-text-muted)]">
                        {isDirectConversation
                          ? 'Direct chat stays lightweight and low-friction.'
                          : isFollowerMode
                            ? 'Follower mode tracks room context without posting updates.'
                            : 'Keep messages short and tied to the active work.'}
                      </div>
                    ) : null}
                  </div>
                </Panel>
                {isRoomConversation ? (
                  !isCompact ? <Panel className="bg-[color:var(--ui-alpha-03)]">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-[18px] font-semibold text-[color:var(--ui-text-title)]">Room context</div>
                        <div className="mt-2 text-[13px] leading-6 text-[color:var(--ui-text)]">
                          Keep the room focused on the latest thread, run, and handoff instead of spreading status across multiple cards.
                        </div>
                      </div>
                      {pendingRoleRequests.length > 0 ? <StatusPill tone="warning">{pendingRoleRequests.length} pending</StatusPill> : null}
                    </div>
                    <div className="mt-5 space-y-3">
                      <ContextItem
                        label="Shared thread"
                        title={latestSharedThread?.title ?? 'Nothing shared yet'}
                        description={latestSharedThread?.latestAssistantSummary ?? latestSharedThread?.lastPromptSummary ?? latestSharedThread?.projectLabel ?? 'Share the active thread so the room sees the working context.'}
                        status={latestSharedThread?.status ?? null}
                        meta={latestSharedThread ? (
                          <>
                            <DetailPill>{latestSharedThread.driverDisplayName}</DetailPill>
                            <DetailPill>{formatProviderModel(latestSharedThread.providerId, latestSharedThread.modelId)}</DetailPill>
                            <DetailPill>{formatRelativeTime(latestSharedThread.updatedAt)}</DetailPill>
                          </>
                        ) : null}
                      >
                        {latestSharedThread?.runId ? <DetailRow label="Run link" value={latestSharedThread.runId} /> : null}
                      </ContextItem>
                      <ContextItem
                        label="Shared run"
                        title={latestSharedRun?.taskTitle ?? latestSharedRun?.threadTitle ?? 'Nothing shared yet'}
                        description={latestSharedRun?.summary ?? 'Share the latest run when the room needs execution status and diff context.'}
                        status={latestSharedRun?.status ?? null}
                        meta={latestSharedRun ? (
                          <>
                            <DetailPill>{latestSharedRun.driverDisplayName}</DetailPill>
                            <DetailPill>{formatProviderModel(latestSharedRun.providerId, latestSharedRun.modelId)}</DetailPill>
                            <DetailPill>{latestSharedRun.executionPermission}</DetailPill>
                          </>
                        ) : null}
                      >
                        {latestSharedRun ? (
                          <>
                            <DetailRow label="Diff" value={formatDiffSummary(latestSharedRun.diffStats, latestSharedRun.changedFiles.length)} />
                            <DetailRow label="Tests" value={latestSharedRun.testsSummary ?? latestSharedRun.resultLabel ?? 'No result shared'} />
                          </>
                        ) : null}
                      </ContextItem>
                      <ContextItem
                        label="Handoff"
                        title={latestHandoff?.title ?? 'Nothing handed off yet'}
                        description={latestHandoff?.summary ?? 'Capture a handoff when the next person should continue from a stable checkpoint.'}
                        meta={latestHandoff ? (
                          <>
                            <DetailPill>{latestHandoff.authorDisplayName}</DetailPill>
                            {latestHandoff.branchName ? <DetailPill>{latestHandoff.branchName}</DetailPill> : null}
                            <DetailPill>{formatRelativeTime(latestHandoff.createdAt)}</DetailPill>
                          </>
                        ) : null}
                      >
                        {latestHandoff ? (
                          <>
                            <DetailRow label="Workspace state" value={`${latestHandoff.changedFiles.length} changed / ${latestHandoff.stagedFileCount} staged / ${latestHandoff.dirtyFileCount} dirty`} />
                            {latestHandoff.outstandingTasks.length > 0 ? (
                              <div className="text-[13px] leading-6 text-[color:var(--ui-text)]">
                                {latestHandoff.outstandingTasks.slice(0, 2).join(' • ')}
                              </div>
                            ) : null}
                          </>
                        ) : null}
                      </ContextItem>
                    </div>
                    <div className="mt-5 border-t border-[color:var(--ui-border-soft)] pt-4">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[color:var(--ui-text-subtle)]">Follow-up</div>
                      {followUpSuggestions.length > 0 ? (
                        <div className="mt-3 space-y-3">
                          <Suggestions aria-label="Room follow-up suggestions">
                            {followUpSuggestions.map((suggestion) => (
                              <Suggestion
                                key={`chip:${suggestion.id}`}
                                data-testid={`collab-followup-suggestion-${suggestion.id}`}
                                suggestion={suggestion.title}
                                onClick={() => void handleFollowUpSuggestionSelection(suggestion)}
                                aria-label={suggestion.prompt ? `Copy suggested prompt: ${suggestion.title}` : suggestion.title}
                              />
                            ))}
                          </Suggestions>
                          <div className="text-[12px] leading-5 text-[color:var(--ui-text-muted)]">
                            {followUpSuggestions[0]?.detail ?? 'Share thread context in this room and follow-up suggestions will appear automatically.'}
                          </div>
                        </div>
                      ) : (
                        <div className="mt-3 text-[12px] leading-5 text-[color:var(--ui-text-muted)]">
                          Share thread context in this room and follow-up suggestions will appear automatically.
                        </div>
                      )}
                    </div>
                  </Panel> : null
                ) : (
                  !isCompact ? <Panel className="bg-[color:var(--ui-alpha-03)]">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-[18px] font-semibold text-[color:var(--ui-text-title)]">{activeChatPeer?.displayName ?? activeConversation.name}</div>
                        <div className="mt-2 text-[13px] leading-6 text-[color:var(--ui-text)]">
                          {activeChatPeer
                            ? `${activeChatPeer.displayName} is currently ${activeChatPeer.status}. Direct messages stay lightweight and room-adjacent.`
                            : 'This direct conversation is ready once messages start flowing.'}
                        </div>
                      </div>
                      {activeChatPeer ? <StatusPill tone={toneForStatus(activeChatPeer.status)}>{activeChatPeer.status}</StatusPill> : null}
                    </div>
                    <div className="mt-5 flex flex-wrap gap-2">
                      {activeChatPeerRooms.slice(0, 4).map((room) => (
                        <DetailPill key={room.id}>{room.name}</DetailPill>
                      ))}
                      {activeChatPeerRooms.length === 0 ? <DetailPill>No shared rooms yet</DetailPill> : null}
                    </div>
                  </Panel> : null
                )}
              </>
            ) : isCompact && isChatSurface ? (
              <Panel className="bg-[color:var(--ui-alpha-03)]">
                <div className="text-[18px] font-semibold text-[color:var(--ui-text-title)]">Start or pick a conversation</div>
                <div className="mt-2 text-[14px] leading-6 text-[color:var(--ui-text)]">
                  Pick a room from the list or open a direct chat from a shared contact when collaboration activity exists.
                </div>
                {props.collaboration.contacts.length > 0 ? (
                  <div className="mt-5 flex flex-wrap gap-3">
                    {props.collaboration.contacts.slice(0, 3).map((contact) => (
                      <ActionButton
                        key={contact.userId}
                        tone="quiet"
                        onClick={() => void runBusy('direct-chat', () => props.onCreateDirectChat({ peerUserId: contact.userId }))}
                        disabled={busyAction === 'direct-chat'}
                      >
                        {busyAction === 'direct-chat' ? 'Opening...' : `Message ${contact.displayName}`}
                      </ActionButton>
                    ))}
                  </div>
                ) : null}
              </Panel>
            ) : isChatSurface ? null : (
              <Panel className={cx('border-dashed bg-[color:var(--ui-alpha-03)]', isCompact && isRoomConversation ? 'text-left' : 'text-center')}>
                <div className="text-[18px] font-semibold text-[color:var(--ui-text-title)]">Nothing selected yet</div>
                {!isChatSurface ? (
                  <div className="mt-2 text-[14px] leading-6 text-[color:var(--ui-text)]">
                    Choose a conversation from the sidebar once collaboration activity exists.
                  </div>
                ) : null}
                {isChatSurface && props.collaboration.contacts.length > 0 ? (
                  <div className="mt-5 flex flex-wrap justify-center gap-3">
                    {props.collaboration.contacts.slice(0, 3).map((contact) => (
                      <ActionButton
                        key={contact.userId}
                        tone="quiet"
                        onClick={() => void runBusy('direct-chat', () => props.onCreateDirectChat({ peerUserId: contact.userId }))}
                        disabled={busyAction === 'direct-chat'}
                      >
                        {busyAction === 'direct-chat' ? 'Opening...' : `Message ${contact.displayName}`}
                      </ActionButton>
                    ))}
                  </div>
                ) : null}
              </Panel>
            )}
          </div>
          <div className="flex min-h-0 min-w-0 flex-col gap-5">
            {isChatSurface && (!isCompact || !activeConversation || isRoomConversation) ? (
              <Panel>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-[18px] font-semibold text-[color:var(--ui-text-title)]">Room access</div>
                    <div className="mt-2 text-[13px] leading-6 text-[color:var(--ui-text)]">
                      Create a room when you are hosting, or join with a code when one is already available.
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <ActionButton size="compact" tone={roomAccessMode === 'create' ? 'default' : 'quiet'} onClick={() => setRoomAccessMode('create')}>
                      Create
                    </ActionButton>
                    <ActionButton size="compact" tone={roomAccessMode === 'join' ? 'default' : 'quiet'} onClick={() => setRoomAccessMode('join')}>
                      Join
                    </ActionButton>
                  </div>
                </div>
                <div className="mt-5 space-y-3">
                  {roomAccessMode === 'create' ? (
                    <>
                      <TextInput value={roomName} onChange={(event) => setRoomName(event.target.value)} placeholder="Room name" />
                      <TextInput value={roomTopic} onChange={(event) => setRoomTopic(event.target.value)} placeholder="Topic (optional)" />
                      <TextInput value={roomPassword} onChange={(event) => setRoomPassword(event.target.value)} placeholder="Password (optional)" />
                      <div className="text-[12px] leading-5 text-[color:var(--ui-text-subtle)]">
                        {roomPasswordIsValid ? 'Leave the password blank for an open room.' : 'Passwords must be at least 3 characters when set.'}
                      </div>
                      <PrimaryButton
                        className="w-full"
                        onClick={() =>
                          void runBusy('create-room', async () => {
                            const room = await props.onCreateRoom({ name: roomName, password: trimmedRoomPassword || undefined, topic: roomTopic || null });
                            if (!room) return;
                            setRecentCreatedRoom({ roomId: room.id, password: trimmedRoomPassword || null });
                            setRoomName('');
                            setRoomPassword('');
                            setRoomTopic('');
                          })
                        }
                        disabled={!roomName.trim() || !roomPasswordIsValid || busyAction === 'create-room'}
                      >
                        {busyAction === 'create-room' ? 'Creating...' : 'Create room'}
                      </PrimaryButton>
                    </>
                  ) : (
                    <>
                      <TextInput value={joinCode} onChange={(event) => setJoinCode(event.target.value.toUpperCase())} placeholder="Room code" />
                      <TextInput value={joinPassword} onChange={(event) => setJoinPassword(event.target.value)} placeholder="Password (optional)" />
                      <div className="text-[12px] leading-5 text-[color:var(--ui-text-subtle)]">
                        {joinPasswordIsValid ? 'Leave the password blank when joining an open room.' : 'Passwords must be at least 3 characters when set.'}
                      </div>
                      <ActionButton
                        className="w-full justify-center"
                        onClick={() =>
                          void runBusy('join-room', async () => {
                            const room = await props.onJoinRoom({ joinCode, password: trimmedJoinPassword || undefined });
                            if (!room) return;
                            setRecentCreatedRoom(null);
                            setJoinCode('');
                            setJoinPassword('');
                          })
                        }
                        disabled={!joinCode.trim() || !joinPasswordIsValid || busyAction === 'join-room'}
                      >
                        {busyAction === 'join-room' ? 'Joining...' : 'Join room'}
                      </ActionButton>
                    </>
                  )}
                </div>
                {recentCreatedRoomDetails ? (
                  <div className="mt-5 rounded-[20px] border border-[color:var(--ui-border-soft)] bg-[color:var(--ui-alpha-05)] px-4 py-4">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[color:var(--ui-text-subtle)]">Latest room</div>
                    <div className="mt-1 text-[14px] font-semibold text-[color:var(--ui-text-title)]">{recentCreatedRoomDetails.name}</div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {recentCreatedRoomDetails.joinCode ? <DetailPill>Code {recentCreatedRoomDetails.joinCode}</DetailPill> : null}
                      {recentCreatedRoom?.password ? <DetailPill>Password set</DetailPill> : <DetailPill>Open room</DetailPill>}
                    </div>
                  </div>
                ) : null}
              </Panel>
            ) : activeContact ? (
              <Panel>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-[20px] font-semibold text-[color:var(--ui-text-title)]">{activeContact.displayName}</div>
                    <div className="mt-1 text-[13px] text-[color:var(--ui-text)]">{activeContact.handle ?? 'No handle set'}</div>
                  </div>
                  <StatusPill tone={toneForStatus(activeContact.status)}>{activeContact.status}</StatusPill>
                </div>
                <div className="mt-5 rounded-[22px] border border-[color:var(--ui-border-soft)] bg-[color:var(--ui-alpha-05)] px-4 py-4">
                  <div className="text-[11px] uppercase tracking-[0.12em] text-[color:var(--ui-text-subtle)]">Recent room</div>
                  <div className="mt-2 text-[14px] text-[color:var(--ui-text-title)]">{activeContact.lastRoomName ?? 'No shared room yet.'}</div>
                </div>
                <div className="mt-5 flex flex-wrap gap-3">
                  <PrimaryButton
                    onClick={() => void runBusy('direct-chat', () => props.onCreateDirectChat({ peerUserId: activeContact.userId }))}
                    disabled={busyAction === 'direct-chat'}
                  >
                    {busyAction === 'direct-chat' ? 'Opening...' : 'Start direct chat'}
                  </PrimaryButton>
                </div>
              </Panel>
            ) : null}
          </div>
        </div>
      )}
      </div>
    </section>
  );
}
