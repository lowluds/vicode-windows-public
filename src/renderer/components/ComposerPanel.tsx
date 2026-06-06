import { startTransition, useEffect, useLayoutEffect, useMemo, useRef, useState, type ChangeEvent, type ClipboardEvent, type KeyboardEvent } from 'react';
import { flushSync } from 'react-dom';
import { ActionButton, SelectableRowButton } from './ui';
import {
  MAX_COMPOSER_PROMPT_CHARS,
  type ComposerMode,
  type ExecutionPermission,
  type HarnessIsolationMode,
  type ImageAttachment,
  type ProjectRuntimeCommandPolicy,
  type ProjectRuntimeNetworkPolicy,
  type ProviderDescriptor,
  type ProviderId,
  type SkillDefinition,
  type TextAttachment
} from '../../shared/domain';
import {
  buildNativeComposerCommandPrompt,
  nativeComposerCommands,
  searchNativeComposerCommands,
  type NativeComposerCommand
} from '../../shared/nativeCommands';
import { providerDisplayName } from '../../shared/providers';
import { resolveComposerMinHeight, shouldExpandComposerPrompt } from '../lib/composer-layout';
import type { VoiceState } from '../lib/voice-dictation';
import { getSkillCommandToken } from '../../shared/skills';
import { getLastSkillMentionState, getSkillMentionState, getSlashCommandState, replaceMentionWithToken } from '../lib/composer-input';
import { ChevronRightIcon, CloseIcon, MagicPenIcon } from './icons';
import { resolveSkillIcon } from './skillIcons';
import { cx } from './ui/utils';
import { ExecutionPermissionBar } from './ExecutionPermissionBar';
import type { ComposerActivityItem } from './ComposerActivityShelf';
import {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  PromptInputTextarea,
  PromptInputTools
} from './ai-elements/prompt-input';
import {
  compareComposerSkills,
  getAttachedComposerSkills,
  getMentionSkillSuggestions,
  shouldClearPromptOptimistically,
  shouldPromotePastedTextToAttachment,
  suggestedPastedTextAttachmentName
} from './ComposerPanel.model';
import { ComposerActionMenu } from './ComposerActionMenu';
import { ComposerAttachmentsHeader } from './ComposerAttachmentsHeader';
import { ComposerPlanModePill } from './ComposerPlanModePill';
import { ComposerProviderMenu } from './ComposerProviderMenu';
import { ComposerSubmitControls } from './ComposerSubmitControls';

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
  executionPermission: ExecutionPermission;
  isolationMode: HarnessIsolationMode;
  runtimeCommandPolicy?: ProjectRuntimeCommandPolicy | null;
  runtimeNetworkPolicy?: ProjectRuntimeNetworkPolicy | null;
  onSelectPermission: (executionPermission: ExecutionPermission) => void;
  onSelectIsolationMode: (isolationMode: HarnessIsolationMode) => void;
  effort: 'Low' | 'Medium' | 'High' | 'Extra high';
  installedSkills: SkillDefinition[];
  availableSkills: SkillDefinition[];
  attachedSkillIds: string[];
  toggleAttachedSkill: (skillId: string) => void;
  selectComposerModel: (providerId: ProviderId, modelId: string) => void;
  selectComposerEffort: (effort: 'Low' | 'Medium' | 'High' | 'Extra high') => void;
  refreshProvider: (providerId: ProviderId) => Promise<void>;
  openProviderSettings: () => void;
  toggleComposerMode: () => Promise<ComposerMode>;
  handleComposerVoice: () => void;
  voiceState: VoiceState;
  voiceAvailable: boolean;
  voiceElapsedLabel: string;
  voiceLevel: number;
  pendingNativeCommandId: NativeComposerCommand['id'] | null;
  setPendingNativeCommandId: (commandId: NativeComposerCommand['id'] | null) => void;
  stopPrompt: () => Promise<void>;
  enhancePrompt: (promptOverride?: string) => Promise<void>;
  enhancingPrompt: boolean;
  submittingPrompt: boolean;
  submitPrompt: (
    promptOverride?: string,
    nativeCommandIdOverride?: NativeComposerCommand['id'] | null
  ) => Promise<boolean>;
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
  executionPermission,
  isolationMode,
  runtimeCommandPolicy,
  runtimeNetworkPolicy,
  onSelectIsolationMode,
  effort,
  installedSkills,
  availableSkills,
  attachedSkillIds,
  toggleAttachedSkill,
  selectComposerModel,
  selectComposerEffort,
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
  const [localPrompt, setLocalPrompt] = useState(prompt);
  const minComposerHeight = resolveComposerMinHeight(localPrompt);
  const maxComposerHeight = 220;
  const promptSyncTimeoutRef = useRef<number | null>(null);
  const lastDispatchedPromptRef = useRef(prompt);
  const latestLocalPromptRef = useRef(prompt);
  const pendingDispatchedPromptsRef = useRef(new Set<string>());
  const preservedLocalRewritePromptRef = useRef<string | null>(null);
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
    'composer-send-button',
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
    'composer-icon-button composer-voice-button',
    voiceState === 'recording' && 'is-recording',
    voiceState === 'transcribing' && 'is-transcribing'
  );
  const sortedSkills = useMemo(
    () => [...installedSkills].sort(compareComposerSkills),
    [installedSkills]
  );
  const providerCompatibleSkills = useMemo(
    () => sortedSkills.filter((skill) => skill.providerTargets.includes(providerId)),
    [providerId, sortedSkills]
  );
  const attachedComposerSkills = useMemo(
    () => getAttachedComposerSkills(attachedSkillIds, installedSkills),
    [attachedSkillIds, installedSkills]
  );
  latestLocalPromptRef.current = localPrompt;

  function rememberDispatchedPrompt(nextPrompt: string) {
    const pending = pendingDispatchedPromptsRef.current;
    pending.add(nextPrompt);
    if (pending.size > 8) {
      const oldest = pending.values().next().value as string | undefined;
      if (oldest !== undefined) {
        pending.delete(oldest);
      }
    }
  }

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

  async function toggleComposerModeFromComposer() {
    const nextMode = composerMode === 'plan' ? 'default' : 'plan';
    const activeProvider = providers.find((provider) => provider.id === providerId) ?? null;
    if (nextMode === 'plan' && !activeProvider?.plannerPolicy.supported) {
      showToast(
        'warning',
        `${activeProvider?.label ?? providerDisplayName(providerId)} does not support native Plan mode yet. Use /plan with a request to apply a planning prompt instead.`
      );
      return composerMode;
    }

    return await toggleComposerMode();
  }

  useEffect(() => {
    if (
      preservedLocalRewritePromptRef.current &&
      prompt === '' &&
      latestLocalPromptRef.current === preservedLocalRewritePromptRef.current
    ) {
      return;
    }

    const pending = pendingDispatchedPromptsRef.current;
    const isComposerEcho = pending.delete(prompt) || prompt === lastDispatchedPromptRef.current;
    if (isComposerEcho) {
      return;
    }

    if (prompt !== latestLocalPromptRef.current) {
      setLocalPrompt(prompt);
    }
    lastDispatchedPromptRef.current = prompt;
    if (preservedLocalRewritePromptRef.current && prompt !== preservedLocalRewritePromptRef.current) {
      preservedLocalRewritePromptRef.current = null;
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
      rememberDispatchedPrompt(localPrompt);
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
    rememberDispatchedPrompt(nextPrompt);
    flushSync(() => {
      setPrompt(nextPrompt);
    });
  }

  function clearSubmittedPromptDraft(submittedPrompt: string) {
    if (promptSyncTimeoutRef.current !== null) {
      window.clearTimeout(promptSyncTimeoutRef.current);
      promptSyncTimeoutRef.current = null;
    }

    preservedLocalRewritePromptRef.current = null;
    lastDispatchedPromptRef.current = '';
    rememberDispatchedPrompt(submittedPrompt);
    rememberDispatchedPrompt('');
    pendingSelectionRef.current = 0;
    flushSync(() => {
      setLocalPrompt('');
      setPrompt('');
      setMentionCaret(0);
      setMentionAutocompleteSuppressed(false);
    });
  }

  function restoreSubmittedPromptDraft(submittedPrompt: string) {
    if (latestLocalPromptRef.current !== '') {
      return;
    }

    if (promptSyncTimeoutRef.current !== null) {
      window.clearTimeout(promptSyncTimeoutRef.current);
      promptSyncTimeoutRef.current = null;
    }

    lastDispatchedPromptRef.current = submittedPrompt;
    rememberDispatchedPrompt(submittedPrompt);
    pendingSelectionRef.current = submittedPrompt.length;
    flushSync(() => {
      setLocalPrompt(submittedPrompt);
      setPrompt(submittedPrompt);
      setMentionCaret(submittedPrompt.length);
    });
  }

  function submitPromptFromComposer(submittedPrompt: string) {
    const shouldClearOptimistically = shouldClearPromptOptimistically(pendingNativeCommandId, submittedPrompt);

    if (shouldClearOptimistically) {
      clearSubmittedPromptDraft(submittedPrompt);
    }

    void submitPrompt(submittedPrompt, pendingNativeCommandId).then((didSubmit) => {
      if (!didSubmit && shouldClearOptimistically) {
        restoreSubmittedPromptDraft(submittedPrompt);
        return;
      }

      if (didSubmit && !shouldClearOptimistically) {
        clearSubmittedPromptDraft(submittedPrompt);
      }
    });
  }

  function updatePrompt(nextPrompt: string) {
    preservedLocalRewritePromptRef.current = null;
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

    return getMentionSkillSuggestions(providerCompatibleSkills, mentionState.query);
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
    'composer-input-wrap relative rounded-[20px] bg-transparent',
    showEnhanceStatus && 'is-enhancing',
    attachedComposerSkills.length > 0 && 'has-attached-skills'
  );
  const suggestionPanelClassName = 'composer-skill-picker rounded-[12px] border border-[color:var(--ui-border-soft)] bg-[color:var(--ui-menu-bg)] p-1';
  const suggestionItemClassName = (active: boolean) =>
    cx(
      active ? 'composer-skill-picker-item is-active' : 'composer-skill-picker-item',
      'flex w-full rounded-[8px] px-2.5 py-2 text-left transition-colors',
      active ? 'bg-[color:var(--ui-alpha-08)] text-[color:var(--ui-text-title)]' : 'text-[color:var(--ui-text-muted)] hover:bg-[color:var(--ui-alpha-04)]'
    );
  const showInlineSuggestionPanel = Boolean(slashCommandState || mentionState);
  const shouldExpandComposer = shouldExpandComposerPrompt(localPrompt);
  const composerMinHeightStyle = { minHeight: `${minComposerHeight}px` };

  useLayoutEffect(() => {
    const element = composerRef.current;
    if (!element) {
      return;
    }
    element.style.height = '0px';
    const nextHeight = shouldExpandComposer
      ? Math.min(maxComposerHeight, Math.max(minComposerHeight, element.scrollHeight))
      : minComposerHeight;
    element.style.height = `${nextHeight}px`;
    element.style.overflowY = shouldExpandComposer && element.scrollHeight > maxComposerHeight ? 'auto' : 'hidden';
  }, [composerRef, localPrompt, maxComposerHeight, minComposerHeight, shouldExpandComposer]);

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

  function renderAttachedSkillChip(skill: SkillDefinition) {
    const Icon = resolveSkillIcon(skill);

    return (
      <ActionButton
        key={skill.id}
        size="compact"
        tone="quiet"
        className="skill-pill skill-pill-removable composer-inline-skill-chip"
        data-testid={`composer-attached-skill-${getSkillCommandToken(skill)}`}
        leadingIcon={<Icon />}
        trailingIcon={<CloseIcon size={12} />}
        onClick={() => setSkillAttached(skill.id, false)}
      >
        {skill.name}
      </ActionButton>
    );
  }

  function attachMentionSkill(skill: SkillDefinition) {
    if (!skill.providerTargets.includes(providerId)) {
      showToast('info', `${skill.name} is not available for the current ${providerDisplayName(providerId)} composer.`);
      return;
    }

    const currentPrompt = composerRef.current?.value ?? localPrompt;
    const currentCaret = composerRef.current?.selectionStart ?? mentionCaret;
    const activeMentionState =
      getSkillMentionState(currentPrompt, currentCaret) ??
      mentionState ??
      getLastSkillMentionState(currentPrompt);
    if (!activeMentionState) {
      return;
    }

    const { nextPrompt, nextCaret } = replaceMentionWithToken(
      currentPrompt,
      activeMentionState,
      getSkillCommandToken(skill)
    );
    flushSync(() => {
      setLocalPrompt(nextPrompt);
      setMentionCaret(-1);
      setMentionAutocompleteSuppressed(true);
    });
    preservedLocalRewritePromptRef.current = nextPrompt;
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
      if (!shouldPromotePastedTextToAttachment(pastedText, localPrompt.length, canCreateTextAttachments)) {
        return;
      }

      event.preventDefault();
      void addTextAttachmentFromPaste(pastedText, suggestedPastedTextAttachmentName(pastedText));
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

  function applyPendingLocalRewriteCommand(submittedPrompt: string) {
    if (!pendingNativeCommand || ['enhance', 'plan'].includes(pendingNativeCommand.id)) {
      return false;
    }

    const rewrittenPrompt = buildNativeComposerCommandPrompt(pendingNativeCommand.id, submittedPrompt);
    flushSync(() => {
      setLocalPrompt(rewrittenPrompt);
      setPendingNativeCommandId(null);
    });
    commitPromptSync(rewrittenPrompt);
    preservedLocalRewritePromptRef.current = rewrittenPrompt;
    pendingSelectionRef.current = rewrittenPrompt.length;
    composerRef.current?.focus();
    composerRef.current?.setSelectionRange(rewrittenPrompt.length, rewrittenPrompt.length);
    return true;
  }

  async function applyPendingPlanCommand(submittedPrompt: string) {
    if (pendingNativeCommandId !== 'plan') {
      return false;
    }

    const nextMode = await toggleComposerModeFromComposer();
    preservedLocalRewritePromptRef.current = submittedPrompt;
    flushSync(() => {
      setLocalPrompt(submittedPrompt);
      setPendingNativeCommandId(null);
    });
    commitPromptSync(submittedPrompt);
    pendingSelectionRef.current = submittedPrompt.length;
    composerRef.current?.focus();
    composerRef.current?.setSelectionRange(submittedPrompt.length, submittedPrompt.length);
    if (nextMode !== composerMode) {
      showToast('info', nextMode === 'plan' ? 'Plan mode enabled.' : 'Plan mode disabled.');
    }
    return true;
  }

  function handlePromptKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.shiftKey && event.key === 'Tab') {
      event.preventDefault();
      void toggleComposerModeFromComposer();
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
      const submittedPrompt = event.currentTarget.value;
      if (submittedPrompt.trim()) {
        if (applyPendingLocalRewriteCommand(submittedPrompt)) {
          return;
        }
        if (pendingNativeCommandId === 'plan') {
          void applyPendingPlanCommand(submittedPrompt);
          return;
        }
        if (pendingNativeCommandId === 'enhance') {
          commitPromptSync(submittedPrompt);
          void enhancePrompt(submittedPrompt);
          return;
        }
        submitPromptFromComposer(submittedPrompt);
      }
      return;
    }

  }

  function handleSubmitButtonClick() {
    if (isRunning) {
      void stopPrompt();
      return;
    }

    const submittedPrompt = composerRef.current?.value ?? localPrompt;
    if (!submittedPrompt.trim()) {
      return;
    }
    if (applyPendingLocalRewriteCommand(submittedPrompt)) {
      return;
    }
    if (pendingNativeCommandId === 'plan') {
      void applyPendingPlanCommand(submittedPrompt);
      return;
    }
    if (pendingNativeCommandId === 'enhance') {
      commitPromptSync(submittedPrompt);
      void enhancePrompt(submittedPrompt);
      return;
    }
    submitPromptFromComposer(submittedPrompt);
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
              <div className="composer-skill-picker-empty rounded-[8px] px-2.5 py-2 text-[12px] text-[color:var(--ui-text-subtle)]">
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
              <div className="composer-skill-picker-empty flex flex-col gap-1 rounded-[8px] px-2.5 py-2 text-[12px] text-[color:var(--ui-text-subtle)]">
                <span>No matching skills found for this composer.</span>
                <span className="composer-skill-picker-empty-note leading-5 text-[color:var(--ui-text-subtle)]">
                  Skills must be enabled for the selected provider and project.
                </span>
              </div>
            )}
          </div>
        ) : null
      ) : null}
      <ComposerAttachmentsHeader
        activityItems={activityItems}
        pendingNativeCommand={pendingNativeCommand}
        clearPendingNativeCommand={() => setPendingNativeCommandId(null)}
        imageAttachments={imageAttachments}
        textAttachments={textAttachments}
        removeImageAttachment={removeImageAttachment}
        removeTextAttachment={removeTextAttachment}
      />
      <PromptInputBody>
      <div className={composerInputWrapClass} style={composerMinHeightStyle}>
        {attachedComposerSkills.length > 0 ? (
          <div className="composer-inline-skill-line" aria-label="Attached skills">
            {attachedComposerSkills.map(renderAttachedSkillChip)}
          </div>
        ) : null}
        <PromptInputTextarea
          data-testid="composer-input"
          ref={composerRef}
          style={composerMinHeightStyle}
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
          <ComposerActionMenu
            composerMode={composerMode}
            enhancingPrompt={enhancingPrompt}
            canEnhancePrompt={Boolean(localPrompt.trim())}
            openImagePicker={() => imagePickerRef.current?.click()}
            enhancePrompt={() => {
              commitPromptSync();
              void enhancePrompt(localPrompt);
            }}
            toggleComposerMode={() => void toggleComposerModeFromComposer()}
          />
          <PromptInputTools className="composer-left-controls flex-1 flex-wrap">
            <ComposerProviderMenu
              providers={providers}
              providerId={providerId}
              modelId={modelId}
              effort={effort}
              selectComposerModel={selectComposerModel}
              selectComposerEffort={selectComposerEffort}
              refreshProvider={refreshProvider}
              openProviderSettings={openProviderSettings}
              dismissComposerTriggerOverlays={dismissComposerTriggerOverlays}
              handleComposerMenuCloseAutoFocus={handleComposerMenuCloseAutoFocus}
            />
            <ExecutionPermissionBar
              providerId={providerId}
              executionPermission={executionPermission}
              isolationMode={isolationMode}
              runtimeCommandPolicy={runtimeCommandPolicy}
              runtimeNetworkPolicy={runtimeNetworkPolicy}
              onSelectPermission={onSelectPermission}
              onSelectIsolationMode={onSelectIsolationMode}
              onMenuCloseAutoFocus={handleComposerMenuCloseAutoFocus}
            />
            {composerMode === 'plan' ? (
              <ComposerPlanModePill toggleComposerMode={() => void toggleComposerModeFromComposer()} />
            ) : null}
          </PromptInputTools>
        </div>
        <ComposerSubmitControls
          voiceState={voiceState}
          voiceAvailable={voiceAvailable}
          voiceElapsedLabel={voiceElapsedLabel}
          voiceLevel={voiceLevel}
          voiceTooltipLabel={voiceTooltipLabel}
          voiceButtonClassName={voiceButtonClassName}
          handleComposerVoice={handleComposerVoice}
          submitTooltipLabel={submitTooltipLabel}
          submitButtonClassName={submitButtonClassName}
          handleSubmitButtonClick={handleSubmitButtonClick}
          isRunning={isRunning}
          enhancingPrompt={enhancingPrompt}
          isSubmitting={isSubmitting}
        />
      </PromptInputFooter>
    </PromptInput>
    </div>
  );
}
