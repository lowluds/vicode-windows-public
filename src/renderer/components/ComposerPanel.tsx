import { startTransition, useEffect, useLayoutEffect, useMemo, useRef, useState, type ChangeEvent, type ClipboardEvent, type KeyboardEvent, type ReactElement } from 'react';
import { flushSync } from 'react-dom';
import { ActionButton, IconButton, MenuButton, SelectableRowButton } from './ui';
import {
  Menu,
  MenuCheckboxItem,
  MenuContent,
  MenuItem,
  MenuItemLabel,
  MenuSeparator,
  MenuSub,
  MenuSubContent,
  MenuSubTrigger,
  MenuTrigger,
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from './ui';
import {
  COMPOSER_TEXT_ATTACHMENT_PROMOTION_CHARS,
  MAX_COMPOSER_PROMPT_CHARS,
  type ComposerMode,
  type ImageAttachment,
  type ProjectRuntimeCommandPolicy,
  type ProjectRuntimeNetworkPolicy,
  type ProviderDescriptor,
  type ProviderId,
  type SkillDefinition,
  type TextAttachment
} from '../../shared/domain';
import { nativeComposerCommands, searchNativeComposerCommands, type NativeComposerCommand } from '../../shared/nativeCommands';
import {
  providerCanRunInComposer,
  providerCapabilities,
  providerDisplayName,
  providerModelRecommendationLabel,
  providerModelTriggerSummary,
  providerSetupGuidance,
  providerSetupMenuSummary,
  providerUsesHostedApi
} from '../../shared/providers';
import { resolvePreferredProviderModel } from '../lib/provider-defaults';
import type { VoiceState } from '../lib/voice-dictation';
import { getSkillCommandToken, getSkillProviderOrigin } from '../../shared/skills';
import { getLastSkillMentionState, getSkillMentionState, getSlashCommandState, replaceMentionWithToken } from '../lib/composer-input';
import { CheckIcon, ChevronDownIcon, ChevronRightIcon, CloseIcon, DocumentIcon, LoadingIcon, MagicPenIcon, MicIcon, PlusIcon, RefreshIcon, SendIcon, TaskIcon } from './icons';
import { resolveSkillIcon } from './skillIcons';
import { cx } from './ui/utils';
import { ExecutionPermissionBar } from './ExecutionPermissionBar';
import { ComposerActivityShelf, type ComposerActivityItem } from './ComposerActivityShelf';
import type { ContextWindowEstimate } from '../lib/context-window';
import {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  PromptInputHeader,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools
} from './ai-elements/prompt-input';

function providerModelMessage(provider: ProviderDescriptor) {
  return providerSetupGuidance(provider);
}

function providerInstallActionLabel(provider: ProviderDescriptor) {
  if (!provider.installed && !providerUsesHostedApi(provider)) {
    return `Set up ${providerDisplayName(provider.id)} in Settings`;
  }
  return 'Open Settings > Providers';
}

function providerMenuSummary(
  providers: ProviderDescriptor[],
  provider: ProviderDescriptor,
  selectedProviderId: ProviderId,
  activeModelLabel: string | null
) {
  if (selectedProviderId === provider.id) {
    return providerModelTriggerSummary(provider, activeModelLabel);
  }

  const setupSummary = providerSetupMenuSummary(provider);
  if (setupSummary) {
    return setupSummary;
  }

  return resolvePreferredProviderModel(providers, provider.id)?.label ?? 'Refresh models';
}

function modelBadgeClassName(recommendation: string | null) {
  if (recommendation === 'Default') {
    return 'border-[color:var(--ui-brand-border)] bg-[color:var(--ui-brand-soft)] text-[color:var(--ui-brand-text)]';
  }
  if (recommendation === 'Quick') {
    return 'border-[color:var(--ui-border-soft)] bg-[color:var(--ui-surface-3)] text-[color:var(--ui-text)]';
  }
  if (recommendation === 'Preview') {
    return 'border-[color:var(--ui-warning-border)] bg-[color:var(--ui-warning-soft)] text-[color:var(--ui-warning-text)]';
  }
  return 'border-[color:var(--ui-border-soft)] bg-[color:var(--ui-alpha-04)] text-[color:var(--ui-text-muted)]';
}

function ComposerTooltip({ label, children }: { label: string; children: ReactElement }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent className="composer-tooltip">{label}</TooltipContent>
    </Tooltip>
  );
}

interface ComposerPanelProps {
  activityItems: ComposerActivityItem[];
  prompt: string;
  setPrompt: (prompt: string) => void;
  imageAttachments: ImageAttachment[];
  textAttachments: TextAttachment[];
  canCreateTextAttachments: boolean;
  addImageFiles: (files: File[]) => Promise<void>;
  addTextAttachmentFromPaste: (content: string, fileName?: string | null) => Promise<boolean>;
  removeImageAttachment: (attachmentId: string) => void;
  removeTextAttachment: (attachmentId: string) => Promise<void>;
  composerRef: React.RefObject<HTMLTextAreaElement | null>;
  providers: ProviderDescriptor[];
  providerId: ProviderId;
  modelId: string;
  composerMode: ComposerMode;
  contextWindow: ContextWindowEstimate | null;
  executionPermission: ExecutionPermission;
  runtimeCommandPolicy?: ProjectRuntimeCommandPolicy | null;
  runtimeNetworkPolicy?: ProjectRuntimeNetworkPolicy | null;
  onSelectPermission: (executionPermission: ExecutionPermission) => void;
  effort: 'Low' | 'Medium' | 'High' | 'Extra high';
  thinkingEnabled: boolean;
  installedSkills: SkillDefinition[];
  availableSkills: SkillDefinition[];
  attachedSkillIds: string[];
  toggleAttachedSkill: (skillId: string) => void;
  selectComposerModel: (providerId: ProviderId, modelId: string) => void;
  selectComposerEffort: (effort: 'Low' | 'Medium' | 'High' | 'Extra high') => void;
  selectProviderThinking: (thinkingEnabled: boolean) => void;
  refreshProvider: (providerId: ProviderId) => Promise<void>;
  openProviderSettings: () => void;
  toggleComposerMode: () => Promise<void>;
  handleComposerVoice: () => void;
  voiceState: VoiceState;
  voiceAvailable: boolean;
  voiceElapsedLabel: string;
  voiceLevel: number;
  pendingNativeCommandId: NativeComposerCommand['id'] | null;
  setPendingNativeCommandId: (commandId: NativeComposerCommand['id'] | null) => void;
  stopPrompt: () => Promise<void>;
  enhancePrompt: () => Promise<void>;
  enhancingPrompt: boolean;
  submittingPrompt: boolean;
  submitPrompt: (promptOverride?: string) => Promise<void>;
  activeRunId: string | null;
  showToast: (level: 'info' | 'warning' | 'error', message: string) => void;
}

export function ComposerPanel({
  activityItems,
  prompt,
  setPrompt,
  imageAttachments,
  textAttachments,
  canCreateTextAttachments,
  addImageFiles,
  addTextAttachmentFromPaste,
  removeImageAttachment,
  removeTextAttachment,
  composerRef,
  providers,
  providerId,
  modelId,
  composerMode,
  contextWindow,
  executionPermission,
  runtimeCommandPolicy,
  runtimeNetworkPolicy,
  effort,
  thinkingEnabled,
  installedSkills,
  availableSkills,
  attachedSkillIds,
  toggleAttachedSkill,
  selectComposerModel,
  selectComposerEffort,
  selectProviderThinking,
  refreshProvider,
  openProviderSettings,
  toggleComposerMode,
  handleComposerVoice,
  voiceState,
  voiceAvailable,
  voiceElapsedLabel,
  voiceLevel,
  pendingNativeCommandId,
  setPendingNativeCommandId,
  stopPrompt,
  enhancePrompt,
  enhancingPrompt,
  submittingPrompt,
  submitPrompt,
  activeRunId,
  showToast,
  onSelectPermission
}: ComposerPanelProps) {
  function compareComposerSkills(left: SkillDefinition, right: SkillDefinition) {
    const leftOrigin = getSkillProviderOrigin(left);
    const rightOrigin = getSkillProviderOrigin(right);
    const leftRank = leftOrigin ? 1 : 0;
    const rightRank = rightOrigin ? 1 : 0;
    if (leftRank !== rightRank) {
      return leftRank - rightRank;
    }

    if (left.scope !== right.scope) {
      return left.scope === 'project' ? -1 : 1;
    }

    return left.name.localeCompare(right.name, undefined, { sensitivity: 'base' });
  }

  const minComposerHeight = 56;
  const maxComposerHeight = 220;
  const [localPrompt, setLocalPrompt] = useState(prompt);
  const promptSyncTimeoutRef = useRef<number | null>(null);
  const lastDispatchedPromptRef = useRef(prompt);
  const [mentionCaret, setMentionCaret] = useState(0);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [slashCommandIndex, setSlashCommandIndex] = useState(0);
  const [mentionAutocompleteSuppressed, setMentionAutocompleteSuppressed] = useState(false);
  const mentionItemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const slashCommandItemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const imagePickerRef = useRef<HTMLInputElement | null>(null);
  const pendingSelectionRef = useRef<number | null>(null);
  const suppressMentionSyncRef = useRef(false);
  const isRunning = Boolean(activeRunId);
  const isSubmitting = submittingPrompt && !isRunning;
  const showEnhanceStatus = enhancingPrompt;
  const enhanceStatusLabel = pendingNativeCommandId === 'enhance' ? 'Rewriting prompt' : 'Enhancing prompt';
  const submitButtonClassName = cx(
    'composer-send-button rounded-full',
    isRunning && 'is-busy',
    isSubmitting && 'is-submitting',
    enhancingPrompt && 'is-enhancing'
  );
  const submitTooltipLabel = isRunning
    ? 'Stop response'
    : enhancingPrompt
      ? 'Enhancing prompt'
      : isSubmitting
        ? 'Sending message'
      : 'Send message';
  const voiceTooltipLabel =
    !voiceAvailable
      ? 'Voice dictation is unavailable in this app runtime'
      : voiceState === 'recording'
        ? 'Stop voice dictation'
        : voiceState === 'transcribing'
          ? 'Transcribing voice dictation'
          : 'Start voice dictation';
  const voiceButtonClassName = cx(
    'composer-icon-button composer-voice-button rounded-full',
    voiceState === 'recording' && 'is-recording',
    voiceState === 'transcribing' && 'is-transcribing'
  );
  const activeProvider = providers.find((provider) => provider.id === providerId) ?? null;
  const visibleModels = activeProvider?.models ?? [];
  const activeModel = visibleModels.find((model) => model.id === modelId);
  const sortedSkills = useMemo(
    () => [...installedSkills].sort(compareComposerSkills),
    [installedSkills]
  );
  const providerCompatibleSkills = useMemo(
    () => sortedSkills.filter((skill) => skill.providerTargets.includes(providerId)),
    [providerId, sortedSkills]
  );

  function dismissComposerTriggerOverlays() {
    const activeElement = document.activeElement;
    if (activeElement instanceof HTMLElement) {
      activeElement.blur();
    }
  }

  function handleComposerMenuCloseAutoFocus(event: Event) {
    event.preventDefault();
    dismissComposerTriggerOverlays();
  }

  useEffect(() => {
    if (prompt !== lastDispatchedPromptRef.current) {
      setLocalPrompt(prompt);
      lastDispatchedPromptRef.current = prompt;
    }
  }, [prompt]);

  useEffect(() => {
    if (localPrompt === lastDispatchedPromptRef.current) {
      return;
    }

    if (promptSyncTimeoutRef.current !== null) {
      window.clearTimeout(promptSyncTimeoutRef.current);
    }

    promptSyncTimeoutRef.current = window.setTimeout(() => {
      lastDispatchedPromptRef.current = localPrompt;
      startTransition(() => {
        setPrompt(localPrompt);
      });
      promptSyncTimeoutRef.current = null;
    }, 220);

    return () => {
      if (promptSyncTimeoutRef.current !== null) {
        window.clearTimeout(promptSyncTimeoutRef.current);
        promptSyncTimeoutRef.current = null;
      }
    };
  }, [localPrompt, setPrompt]);

  function commitPromptSync(nextPrompt = localPrompt) {
    if (promptSyncTimeoutRef.current !== null) {
      window.clearTimeout(promptSyncTimeoutRef.current);
      promptSyncTimeoutRef.current = null;
    }
    lastDispatchedPromptRef.current = nextPrompt;
    flushSync(() => {
      setPrompt(nextPrompt);
    });
  }

  function updatePrompt(nextPrompt: string) {
    setLocalPrompt(nextPrompt);
  }

  const mentionState = useMemo(() => {
    if (mentionAutocompleteSuppressed) {
      return null;
    }
    const nextMentionState = getSkillMentionState(localPrompt, mentionCaret);
    if (!nextMentionState) {
      return null;
    }

    const matchesCompletedSkill = providerCompatibleSkills.some(
      (skill) => getSkillCommandToken(skill).toLowerCase() === nextMentionState.query
    );
    if (matchesCompletedSkill && nextMentionState.end === mentionCaret) {
      return null;
    }

    return nextMentionState;
  }, [localPrompt, mentionAutocompleteSuppressed, mentionCaret, providerCompatibleSkills]);
  const slashCommandState = useMemo(() => getSlashCommandState(localPrompt, mentionCaret), [localPrompt, mentionCaret]);
  const mentionSkills = useMemo(() => {
    if (!mentionState) {
      return [];
    }

    const query = mentionState.query.trim();
    if (!query) {
      return providerCompatibleSkills;
    }

    return providerCompatibleSkills.filter((skill) => {
      const token = getSkillCommandToken(skill).toLowerCase();
      const haystack = `${skill.name} ${skill.description}`.toLowerCase();
      return token.includes(query) || haystack.includes(query);
    });
  }, [mentionState, providerCompatibleSkills]);
  const visibleSlashCommands = useMemo(() => {
    if (!slashCommandState) {
      return [];
    }

    const query = slashCommandState.query.trim().toLowerCase();
    if (!query) {
      return nativeComposerCommands;
    }

    return searchNativeComposerCommands(query);
  }, [slashCommandState]);
  const pendingNativeCommand = useMemo(
    () => nativeComposerCommands.find((command) => command.id === pendingNativeCommandId) ?? null,
    [pendingNativeCommandId]
  );
  const composerShellClass = cx(
    'composer-shell flex flex-col gap-3 rounded-[28px] border border-[color:var(--ui-border)] bg-[color:var(--ui-surface-2)] px-4 py-4',
    showEnhanceStatus && 'is-enhancing'
  );
  const composerInputWrapClass = cx(
    'composer-input-wrap relative min-h-[56px] rounded-[20px] bg-transparent',
    showEnhanceStatus && 'is-enhancing'
  );
  const suggestionPanelClassName = 'composer-skill-picker rounded-[22px] border border-[color:var(--ui-border-soft)] bg-[color:var(--ui-surface-1)] p-2';
  const suggestionItemClassName = (active: boolean) =>
    cx(
      active ? 'composer-skill-picker-item is-active' : 'composer-skill-picker-item',
      'flex w-full rounded-[18px] px-3 py-3 text-left transition-colors',
      active ? 'bg-[color:var(--ui-alpha-08)] text-[color:var(--ui-text-title)]' : 'text-[color:var(--ui-text-muted)] hover:bg-[color:var(--ui-alpha-04)]'
    );
  const showInlineSuggestionPanel = Boolean(slashCommandState || mentionState);

  useLayoutEffect(() => {
    const element = composerRef.current;
    if (!element) {
      return;
    }
    element.style.height = '0px';
    const nextHeight = Math.min(maxComposerHeight, Math.max(minComposerHeight, element.scrollHeight));
    element.style.height = `${nextHeight}px`;
    element.style.overflowY = element.scrollHeight > maxComposerHeight ? 'auto' : 'hidden';
  }, [composerRef, localPrompt, maxComposerHeight, minComposerHeight]);

  useLayoutEffect(() => {
    const element = composerRef.current;
    const pendingSelection = pendingSelectionRef.current;
    if (!element || pendingSelection == null) {
      return;
    }

    element.focus();
    element.setSelectionRange(pendingSelection, pendingSelection);
    pendingSelectionRef.current = null;
  }, [composerRef, localPrompt]);

  useEffect(() => {
    setMentionIndex(0);
  }, [mentionState?.query]);

  useEffect(() => {
    setSlashCommandIndex(0);
  }, [slashCommandState?.query]);

  useEffect(() => {
    if (!mentionState || mentionSkills.length === 0) {
      mentionItemRefs.current = [];
      return;
    }

    mentionItemRefs.current[mentionIndex]?.scrollIntoView({
      block: 'nearest'
    });
  }, [mentionIndex, mentionSkills.length, mentionState]);

  useEffect(() => {
    if (!slashCommandState || visibleSlashCommands.length === 0) {
      slashCommandItemRefs.current = [];
      return;
    }

    slashCommandItemRefs.current[slashCommandIndex]?.scrollIntoView({
      block: 'nearest'
    });
  }, [slashCommandIndex, slashCommandState, visibleSlashCommands.length]);

  function syncMentionCaret(nextCaret?: number | null) {
    if (suppressMentionSyncRef.current) {
      suppressMentionSyncRef.current = false;
      return;
    }
    if (pendingSelectionRef.current != null) {
      return;
    }
    setMentionCaret(nextCaret ?? composerRef.current?.selectionStart ?? 0);
  }

  function setSkillAttached(skillId: string, enabled: boolean) {
    const attached = attachedSkillIds.includes(skillId);
    if (attached !== enabled) {
      toggleAttachedSkill(skillId);
    }
  }

  function attachMentionSkill(skill: SkillDefinition) {
    if (!skill.providerTargets.includes(providerId)) {
      showToast('info', `${skill.name} is not available for the current ${providerDisplayName(providerId)} composer.`);
      return;
    }

    const currentCaret = composerRef.current?.selectionStart ?? mentionCaret;
    const activeMentionState = getSkillMentionState(localPrompt, currentCaret) ?? mentionState ?? getLastSkillMentionState(localPrompt);
    if (!activeMentionState) {
      return;
    }

    const { nextPrompt, nextCaret } = replaceMentionWithToken(localPrompt, activeMentionState, getSkillCommandToken(skill));
    flushSync(() => {
      setLocalPrompt(nextPrompt);
      setMentionCaret(-1);
      setMentionAutocompleteSuppressed(true);
    });
    commitPromptSync(nextPrompt);
    suppressMentionSyncRef.current = true;
    pendingSelectionRef.current = nextCaret;
    composerRef.current?.focus();
    composerRef.current?.setSelectionRange(nextCaret, nextCaret);
  }

  function attachSlashCommand(command: NativeComposerCommand) {
    const currentCaret = composerRef.current?.selectionStart ?? mentionCaret;
    const activeSlashCommandState = getSlashCommandState(localPrompt, currentCaret) ?? slashCommandState;
    if (!activeSlashCommandState) {
      return;
    }

    const before = localPrompt.slice(0, activeSlashCommandState.start);
    const after = localPrompt.slice(activeSlashCommandState.end).trimStart();
    const nextPrompt = `${before}${after}`;
    const nextCaret = before.length;
    flushSync(() => {
      setLocalPrompt(nextPrompt);
      setMentionCaret(-1);
      setPendingNativeCommandId(command.id);
    });
    commitPromptSync(nextPrompt);
    suppressMentionSyncRef.current = true;
    pendingSelectionRef.current = nextCaret;
    composerRef.current?.focus();
    composerRef.current?.setSelectionRange(nextCaret, nextCaret);
  }

  function handlePromptChange(nextPrompt: string, nextCaret?: number | null) {
    pendingSelectionRef.current = null;
    setMentionAutocompleteSuppressed(false);
    updatePrompt(nextPrompt);
    syncMentionCaret(nextCaret);
  }

  function handlePromptPaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const files = Array.from(event.clipboardData.items)
      .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
      .map((item) => item.getAsFile())
      .filter((file): file is File => Boolean(file));

    if (files.length === 0) {
      const pastedText = event.clipboardData.getData('text/plain');
      if (!pastedText) {
        return;
      }
      if (!canCreateTextAttachments) {
        return;
      }

      const nextPromptLength = localPrompt.length + pastedText.length;
      if (
        pastedText.length < COMPOSER_TEXT_ATTACHMENT_PROMOTION_CHARS &&
        nextPromptLength < MAX_COMPOSER_PROMPT_CHARS
      ) {
        return;
      }

      event.preventDefault();
      const firstLine = pastedText.split(/\r?\n/u, 1)[0]?.trim() ?? '';
      const suggestedName = firstLine ? `${firstLine.slice(0, 48)}.txt` : 'pasted-context.txt';
      void addTextAttachmentFromPaste(pastedText, suggestedName);
      return;
    }

    event.preventDefault();
    void addImageFiles(files);
  }

  function handleImagePickerChange(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    if (files.length > 0) {
      void addImageFiles(files);
    }
    event.target.value = '';
  }

  function handlePromptKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.shiftKey && event.key === 'Tab') {
      event.preventDefault();
      void toggleComposerMode();
      return;
    }

    if (mentionState && mentionSkills.length > 0) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setMentionIndex((current) => (current + 1) % mentionSkills.length);
        return;
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setMentionIndex((current) => (current - 1 + mentionSkills.length) % mentionSkills.length);
        return;
      }

      if (event.key === 'Escape') {
        event.preventDefault();
        setMentionCaret(-1);
        return;
      }

      if (event.key === 'Tab' || (event.key === 'Enter' && !event.shiftKey)) {
        event.preventDefault();
        attachMentionSkill(mentionSkills[mentionIndex] ?? mentionSkills[0]);
        return;
      }
    }

    if (slashCommandState && visibleSlashCommands.length > 0) {
      const highlightedCommand = visibleSlashCommands[slashCommandIndex] ?? visibleSlashCommands[0];

      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setSlashCommandIndex((current) => (current + 1) % visibleSlashCommands.length);
        return;
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setSlashCommandIndex((current) => (current - 1 + visibleSlashCommands.length) % visibleSlashCommands.length);
        return;
      }

      if (event.key === 'Escape') {
        event.preventDefault();
        setMentionCaret(-1);
        return;
      }

      if (event.key === 'Tab') {
        event.preventDefault();
        attachSlashCommand(highlightedCommand);
        return;
      }

      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        attachSlashCommand(highlightedCommand);
        return;
      }
    }

    if (slashCommandState && (event.key === 'Enter' || event.key === 'Tab')) {
      event.preventDefault();
      return;
    }

    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      if (localPrompt.trim()) {
        const submittedPrompt = localPrompt;
        commitPromptSync(submittedPrompt);
        if (pendingNativeCommandId === 'enhance') {
          void enhancePrompt();
          return;
        }
        void submitPrompt(submittedPrompt);
      }
      return;
    }

  }

  function handleSubmitButtonClick() {
    if (isRunning) {
      void stopPrompt();
      return;
    }

    const submittedPrompt = localPrompt;
    commitPromptSync(submittedPrompt);
    if (pendingNativeCommandId === 'enhance') {
      void enhancePrompt();
      return;
    }
    void submitPrompt(submittedPrompt);
  }

  return (
    <div className="composer-stack flex flex-col gap-3">
      <input
        ref={imagePickerRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        tabIndex={-1}
        aria-hidden="true"
        onChange={handleImagePickerChange}
      />
      <PromptInput className={composerShellClass}>
      {showInlineSuggestionPanel ? (
        slashCommandState ? (
          <div className={suggestionPanelClassName} role="listbox" aria-label="Available commands">
            {visibleSlashCommands.length > 0 ? (
              visibleSlashCommands.map((command, index) => {
                const active = index === slashCommandIndex;
                return (
                  <SelectableRowButton
                    key={command.id}
                    ref={(element) => {
                      slashCommandItemRefs.current[index] = element;
                    }}
                    role="option"
                    selected={active}
                    aria-selected={active}
                    className={suggestionItemClassName(active)}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => attachSlashCommand(command)}
                  >
                    <span className="composer-skill-picker-row flex min-w-0 flex-1 flex-col gap-1.5">
                      <span className="composer-skill-picker-heading flex items-center justify-between gap-3">
                        <span className="composer-skill-picker-leading flex min-w-0 items-center gap-2">
                          <span className="composer-skill-picker-title truncate text-[13px] font-semibold text-[color:var(--ui-text-title)]">/{command.token}</span>
                        </span>
                        <span className="composer-skill-picker-meta shrink-0 text-[11px] font-medium uppercase tracking-[0.08em] text-[color:var(--ui-text-subtle)]">{command.category}</span>
                      </span>
                      <span className="composer-skill-picker-description text-[12px] leading-5 text-[color:var(--ui-text-muted)]">{command.description}</span>
                    </span>
                  </SelectableRowButton>
                );
              })
            ) : (
              <div className="composer-skill-picker-empty rounded-[18px] px-3 py-3 text-[12px] text-[color:var(--ui-text-subtle)]">
                <span>No matching native commands.</span>
              </div>
            )}
          </div>
        ) : mentionState ? (
          <div className={suggestionPanelClassName} role="listbox" aria-label="Available skills">
            {mentionSkills.length > 0 ? (
              mentionSkills.map((skill, index) => {
                const Icon = resolveSkillIcon(skill);
                const active = index === mentionIndex;
                return (
                  <SelectableRowButton
                    key={skill.id}
                    ref={(element) => {
                      mentionItemRefs.current[index] = element;
                    }}
                    role="option"
                    selected={active}
                    aria-selected={active}
                    className={suggestionItemClassName(active)}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => attachMentionSkill(skill)}
                  >
                    <span className="composer-skill-picker-row flex min-w-0 flex-1 flex-col gap-1.5">
                      <span className="composer-skill-picker-heading flex items-center justify-between gap-3">
                        <span className="composer-skill-picker-leading flex min-w-0 items-center gap-2">
                          <span className="composer-skill-picker-icon inline-flex size-4 shrink-0 items-center justify-center text-[color:var(--ui-text-muted)]" aria-hidden="true">
                            <Icon />
                          </span>
                          <span className="composer-skill-picker-title truncate text-[13px] font-semibold text-[color:var(--ui-text-title)]">{skill.name}</span>
                        </span>
                        <span className="composer-skill-picker-meta shrink-0 text-[11px] font-medium uppercase tracking-[0.08em] text-[color:var(--ui-text-subtle)]">
                          {skill.scope === 'project' ? 'Project' : 'Personal'}
                        </span>
                      </span>
                      <span className="composer-skill-picker-description text-[12px] leading-5 text-[color:var(--ui-text-muted)]">
                        {skill.description}
                      </span>
                    </span>
                  </SelectableRowButton>
                );
              })
            ) : (
              <div className="composer-skill-picker-empty flex flex-col gap-1 rounded-[18px] px-3 py-3 text-[12px] text-[color:var(--ui-text-subtle)]">
                <span>No matching skills found for this composer.</span>
                <span className="composer-skill-picker-empty-note leading-5 text-[color:var(--ui-text-subtle)]">
                      App-managed MCP plugins like shadcn live in Plugins and do not appear in $skill yet.
                </span>
              </div>
            )}
          </div>
        ) : null
      ) : null}
      <PromptInputHeader>
      <ComposerActivityShelf items={activityItems} />
      {pendingNativeCommand ? (
        <div className="composer-command-strip flex">
          <div className="composer-command-chip" role="status" aria-live="polite">
            <span className="composer-command-chip-token">/{pendingNativeCommand.token}</span>
            <span className="composer-command-chip-label">{pendingNativeCommand.title}</span>
            <IconButton
              size="compact"
              className="composer-command-chip-remove"
              label={`Clear ${pendingNativeCommand.title}`}
              onClick={() => setPendingNativeCommandId(null)}
            >
              <CloseIcon size={12} />
            </IconButton>
          </div>
        </div>
      ) : null}
      {imageAttachments.length > 0 ? (
        <div className="composer-image-strip flex flex-wrap gap-2">
          {imageAttachments.map((attachment) => (
            <div key={attachment.id} className="composer-image-chip">
              <img src={attachment.dataUrl} alt={attachment.name} className="composer-image-chip-thumb size-10 rounded-xl object-cover" />
              <span className="composer-image-chip-label max-w-40 truncate text-[12px]">{attachment.name}</span>
              <IconButton
                size="compact"
                className="composer-image-chip-remove"
                label={`Remove ${attachment.name}`}
                onClick={() => removeImageAttachment(attachment.id)}
              >
                <CloseIcon size={12} />
              </IconButton>
            </div>
          ))}
        </div>
      ) : null}
      {textAttachments.length > 0 ? (
        <div className="composer-text-attachment-strip flex flex-wrap gap-2">
          {textAttachments.map((attachment) => (
            <div key={attachment.id} className="composer-text-attachment-chip flex min-w-0 items-center gap-2 rounded-2xl border border-[color:var(--ui-border-soft)] bg-[color:var(--ui-surface-2)] px-3 py-2">
              <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl border border-[color:var(--ui-border-soft)] bg-[color:var(--ui-alpha-04)] text-[color:var(--ui-text-muted)]">
                <DocumentIcon />
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="max-w-52 truncate text-[12px] text-[color:var(--ui-text-title)]">{attachment.name}</span>
                <span className="max-w-60 truncate text-[11px] text-[color:var(--ui-text-subtle)]">
                  {attachment.charCount.toLocaleString()} chars · {attachment.relativePath}
                </span>
              </span>
              <IconButton
                size="compact"
                className="composer-image-chip-remove"
                label={`Remove ${attachment.name}`}
                onClick={() => void removeTextAttachment(attachment.id)}
              >
                <CloseIcon size={12} />
              </IconButton>
            </div>
          ))}
        </div>
      ) : null}
      </PromptInputHeader>
      <PromptInputBody>
      <div className={composerInputWrapClass}>
        <PromptInputTextarea
          data-testid="composer-input"
          ref={composerRef}
          placeholder={composerMode === 'plan' ? 'Describe the plan you want to build' : 'Ask for follow-up changes'}
          maxLength={MAX_COMPOSER_PROMPT_CHARS}
          value={localPrompt}
          onChange={(event) => handlePromptChange(event.target.value, event.target.selectionStart)}
          onBlur={() => commitPromptSync()}
          onSelect={(event) => syncMentionCaret(event.currentTarget.selectionStart)}
          onClick={(event) => syncMentionCaret(event.currentTarget.selectionStart)}
          onKeyUp={(event) => syncMentionCaret(event.currentTarget.selectionStart)}
          onKeyDown={handlePromptKeyDown}
          onPaste={handlePromptPaste}
        />
      </div>
      {showEnhanceStatus ? (
        <div className="composer-enhance-status" role="status" aria-live="polite" data-testid="composer-enhance-status">
          <span className="composer-enhance-status-icon" aria-hidden="true">
            <MagicPenIcon />
          </span>
          <span className="composer-enhance-status-copy">
            <span className="composer-enhance-status-title">
              {enhanceStatusLabel}
              <span className="composer-enhance-status-dots" aria-hidden="true">
                <span className="composer-enhance-status-dot" />
                <span className="composer-enhance-status-dot" />
                <span className="composer-enhance-status-dot" />
              </span>
            </span>
            <span className="composer-enhance-status-note">Updating the prompt in place</span>
          </span>
        </div>
      ) : null}
      </PromptInputBody>
      <PromptInputFooter>
        <div className="composer-footer-leading flex flex-1 flex-wrap items-center gap-3">
          <PromptInputTools className="composer-plus-controls shrink-0">
            <Menu>
              <ComposerTooltip label="Add files and more">
                <MenuTrigger asChild>
                  <IconButton className="composer-icon-button composer-attach-button rounded-full" label="Composer actions">
                    <PlusIcon />
                  </IconButton>
                </MenuTrigger>
              </ComposerTooltip>
              <MenuContent className="composer-menu composer-attach-menu">
                <MenuItem
                  onSelect={(event) => {
                    event.preventDefault();
                    imagePickerRef.current?.click();
                  }}
                  className="composer-attach-item rounded-xl"
                >
                  <span className="composer-attach-item-icon">
                    <DocumentIcon />
                  </span>
                  <MenuItemLabel>Add images</MenuItemLabel>
                </MenuItem>
                <MenuItem
                  onSelect={() => {
                    commitPromptSync();
                    void enhancePrompt();
                  }}
                  className="composer-attach-item rounded-xl"
                  disabled={enhancingPrompt || !localPrompt.trim()}
                >
                  <span className="composer-attach-item-icon">
                    <MagicPenIcon />
                  </span>
                  <MenuItemLabel>{enhancingPrompt ? 'Enhancing prompt...' : 'Enhance prompt'}</MenuItemLabel>
                </MenuItem>
                <MenuItem
                  onSelect={() => void toggleComposerMode()}
                  className="composer-attach-item composer-attach-item-static rounded-xl"
                >
                  <span className="composer-attach-item-icon">
                    <TaskIcon />
                  </span>
                  <MenuItemLabel>Plan mode</MenuItemLabel>
                  <span
                    className={cx(
                      composerMode === 'plan' ? 'composer-inline-switch is-on' : 'composer-inline-switch',
                      'relative inline-flex h-5 w-9 rounded-full border transition-colors'
                    )}
                    aria-hidden="true"
                  >
                    <span
                      className={cx(
                        'composer-inline-switch-knob absolute top-0.5 size-4 rounded-full transition-transform',
                        composerMode === 'plan' ? 'translate-x-4' : 'translate-x-0.5'
                      )}
                    />
                  </span>
                </MenuItem>
              </MenuContent>
            </Menu>
          </PromptInputTools>
          <ExecutionPermissionBar
            providerId={providerId}
            contextWindow={contextWindow}
            executionPermission={executionPermission}
            runtimeCommandPolicy={runtimeCommandPolicy}
            runtimeNetworkPolicy={runtimeNetworkPolicy}
            onSelectPermission={onSelectPermission}
          />
          <PromptInputTools className="composer-left-controls flex-1 flex-wrap">
            <Menu>
            <ComposerTooltip label="Choose provider and model">
              <MenuTrigger asChild>
                <MenuButton
                  data-testid="composer-model-select"
                  className="composer-trigger-button composer-model-trigger h-9 rounded-full px-2.5 text-[12px]"
                  trailingIcon={<ChevronDownIcon />}
                >
                  <span className="composer-model-trigger-title truncate">
                    {`${providerDisplayName(providerId)} / ${providerModelTriggerSummary(activeProvider ?? {
                      id: providerId,
                      installed: false,
                      authState: 'missing_cli',
                      authMode: null,
                      models: []
                    }, activeModel?.label ?? null)}`}
                  </span>
                </MenuButton>
              </MenuTrigger>
            </ComposerTooltip>
            <MenuContent className="composer-menu composer-model-menu" onCloseAutoFocus={handleComposerMenuCloseAutoFocus}>
              {providers.map((provider) => (
                <MenuSub key={provider.id}>
                  <MenuSubTrigger className={cx(providerId === provider.id && 'is-selected', 'rounded-xl')}>
                    <MenuItemLabel>{providerDisplayName(provider.id)}</MenuItemLabel>
                    <span>{providerMenuSummary(providers, provider, providerId, activeModel?.label ?? null)}</span>
                  </MenuSubTrigger>
                  <MenuSubContent className="composer-menu composer-submenu composer-model-menu">
                    {providerCanRunInComposer(provider) && provider.models.length > 0 ? (
                      <>
                        {provider.models.map((model) => {
                          const selected = providerId === provider.id && modelId === model.id;
                          const recommendationLabel = providerModelRecommendationLabel(model.recommendation);
                          return (
                            <MenuCheckboxItem
                              data-testid={`composer-model-option-${provider.id}-${model.id}`}
                              key={`${provider.id}:${model.id}`}
                              className={cx(selected && 'is-selected', 'rounded-xl')}
                              checked={selected}
                              disabled={!providerCanRunInComposer(provider)}
                              onCheckedChange={() => {
                                selectComposerModel(provider.id, model.id);
                                dismissComposerTriggerOverlays();
                              }}
                            >
                              <MenuItemLabel>
                                <span className="flex items-center gap-2">
                                  <span>{model.label}</span>
                                  {recommendationLabel ? (
                                    <span
                                      className={cx(
                                        'inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.12em]',
                                        modelBadgeClassName(recommendationLabel)
                                      )}
                                    >
                                      {recommendationLabel}
                                    </span>
                                  ) : null}
                                </span>
                              </MenuItemLabel>
                              {selected ? <CheckIcon /> : null}
                            </MenuCheckboxItem>
                          );
                        })}
                      </>
                    ) : (
                      <MenuItem onSelect={(event) => event.preventDefault()}>
                        <MenuItemLabel>{providerModelMessage(provider)}</MenuItemLabel>
                      </MenuItem>
                    )}
                    <MenuSeparator />
                          <MenuItem onSelect={() => void refreshProvider(provider.id)} disabled={!providerCanRunInComposer(provider)}>
                      <MenuItemLabel>Refresh models</MenuItemLabel>
                      <RefreshIcon />
                    </MenuItem>
                          {!providerCanRunInComposer(provider) || provider.authState === 'disconnected' ? (
                      <MenuItem
                        onSelect={(event) => {
                          event.preventDefault();
                          openProviderSettings();
                        }}
                      >
                        <MenuItemLabel>{providerInstallActionLabel(provider)}</MenuItemLabel>
                      </MenuItem>
                    ) : null}
                  </MenuSubContent>
                </MenuSub>
              ))}
              {(providerId === 'openai' || providerCapabilities(providerId).supportsThinkingToggle) ? <MenuSeparator /> : null}
              {providerId === 'openai' ? (
                <MenuSub>
                  <MenuSubTrigger className="rounded-xl">
                    <MenuItemLabel>Reasoning effort</MenuItemLabel>
                    <span>{effort}</span>
                  </MenuSubTrigger>
                  <MenuSubContent className="composer-menu composer-submenu" onCloseAutoFocus={handleComposerMenuCloseAutoFocus}>
                    {(['Low', 'Medium', 'High', 'Extra high'] as const).map((candidate) => (
                      <MenuCheckboxItem
                        key={candidate}
                        className={cx(effort === candidate && 'is-selected', 'rounded-xl')}
                        checked={effort === candidate}
                        onCheckedChange={() => {
                          selectComposerEffort(candidate);
                          dismissComposerTriggerOverlays();
                        }}
                      >
                        <MenuItemLabel>{candidate}</MenuItemLabel>
                        {effort === candidate ? <CheckIcon /> : null}
                      </MenuCheckboxItem>
                    ))}
                  </MenuSubContent>
                </MenuSub>
              ) : null}
              {providerCapabilities(providerId).supportsThinkingToggle ? (
                <MenuSub>
                  <MenuSubTrigger className="rounded-xl">
                    <MenuItemLabel>Thinking</MenuItemLabel>
                    <span>{thinkingEnabled ? 'On' : 'Off'}</span>
                  </MenuSubTrigger>
                  <MenuSubContent className="composer-menu composer-submenu" onCloseAutoFocus={handleComposerMenuCloseAutoFocus}>
                    <MenuCheckboxItem
                      className={cx(thinkingEnabled && 'is-selected', 'rounded-xl')}
                      checked={thinkingEnabled}
                      onCheckedChange={() => {
                        selectProviderThinking(true);
                        dismissComposerTriggerOverlays();
                      }}
                    >
                      <MenuItemLabel>Thinking on</MenuItemLabel>
                      {thinkingEnabled ? <CheckIcon /> : null}
                    </MenuCheckboxItem>
                    <MenuCheckboxItem
                      className={cx(!thinkingEnabled && 'is-selected', 'rounded-xl')}
                      checked={!thinkingEnabled}
                      onCheckedChange={() => {
                        selectProviderThinking(false);
                        dismissComposerTriggerOverlays();
                      }}
                    >
                      <MenuItemLabel>Thinking off</MenuItemLabel>
                      {!thinkingEnabled ? <CheckIcon /> : null}
                    </MenuCheckboxItem>
                  </MenuSubContent>
                </MenuSub>
              ) : null}
            </MenuContent>
          </Menu>
          {composerMode === 'plan' ? (
            <ComposerTooltip label="Toggle Plan mode (Shift+Tab)">
              <ActionButton
                size="compact"
                className="composer-plan-pill is-active h-9 rounded-full px-3"
                onClick={() => void toggleComposerMode()}
                leadingIcon={
                  <span className="composer-plan-pill-icon relative inline-flex size-4 items-center justify-center" aria-hidden="true">
                    <span className="composer-plan-pill-icon-default inline-flex items-center justify-center">
                      <TaskIcon size={13} />
                    </span>
                    <span className="composer-plan-pill-icon-dismiss absolute inset-0 inline-flex items-center justify-center opacity-0">
                      <CloseIcon size={13} />
                    </span>
                  </span>
                }
              >
                <span className="composer-plan-pill-text">Plan</span>
              </ActionButton>
            </ComposerTooltip>
          ) : null}
          </PromptInputTools>
        </div>
        <PromptInputTools className="composer-right-controls shrink-0">
          {voiceState === 'recording' ? (
            <div className="composer-voice-status" aria-live="polite">
              <div className="composer-voice-meter inline-flex items-center gap-1" aria-hidden="true">
                {Array.from({ length: 24 }, (_, index) => {
                  const threshold = (index + 1) / 24;
                  const active = voiceLevel >= threshold;
                  return (
                    <span
                      key={`voice-meter-${index}`}
                      className={active ? 'composer-voice-meter-bar is-active h-3 w-0.5 rounded-full' : 'composer-voice-meter-bar h-3 w-0.5 rounded-full'}
                    />
                  );
                })}
              </div>
              <span className="composer-voice-timer">{voiceElapsedLabel}</span>
            </div>
          ) : null}
          <ComposerTooltip label={voiceTooltipLabel}>
            <IconButton
              className={voiceButtonClassName}
              onClick={handleComposerVoice}
              label={voiceTooltipLabel}
              disabled={!voiceAvailable || voiceState === 'transcribing'}
              aria-pressed={voiceState === 'recording'}
            >
              <MicIcon />
            </IconButton>
          </ComposerTooltip>
          <ComposerTooltip label={submitTooltipLabel}>
            <PromptInputSubmit
              data-testid="composer-submit-button"
              className={submitButtonClassName}
              onClick={handleSubmitButtonClick}
              label={isRunning ? 'Stop' : enhancingPrompt ? 'Enhancing prompt' : isSubmitting ? 'Sending' : 'Send'}
              disabled={!isRunning && (enhancingPrompt || isSubmitting)}
              aria-busy={enhancingPrompt || isSubmitting || undefined}
            >
              {isRunning ? (
                <span className="composer-stop-glyph inline-block size-3 rounded-[2px] bg-current" aria-hidden="true" />
              ) : enhancingPrompt || isSubmitting ? (
                <span className="composer-send-enhance-indicator relative inline-flex size-4 items-center justify-center" aria-hidden="true">
                  <span className="composer-send-enhance-ring absolute inset-0 rounded-full border border-current/30" />
                  <LoadingIcon size={14} strokeWidth={2.05} className="composer-send-spinner" />
                </span>
              ) : (
                <SendIcon className="composer-send-glyph" />
              )}
            </PromptInputSubmit>
          </ComposerTooltip>
        </PromptInputTools>
      </PromptInputFooter>
    </PromptInput>
    </div>
  );
}
