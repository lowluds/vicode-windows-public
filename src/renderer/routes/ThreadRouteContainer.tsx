import type { ReactNode, RefObject } from 'react';
import type {
  ExecutionPermission,
  HarnessIsolationMode,
  ImageAttachment,
  Project,
  ProviderDescriptor,
  ProviderId,
  SkillDefinition,
  StagedWorkspaceHunkApplyInput,
  StagedWorkspaceHunkRejectInput,
  StagedWorkspaceHunkRevertInput,
  StagedWorkspaceReviewInput,
  SubagentSummary,
  TextAttachment,
  ThreadDetail,
  ThreadTurn,
  WorktreeCleanupInput,
  WorktreeHunkApplyInput,
  WorktreeHunkRejectInput,
  WorktreeHunkRevertInput,
  WorktreeReviewInput
} from '../../shared/domain';
import type { NativeComposerCommandId } from '../../shared/nativeCommands';
import type { RunActivityViewModel, RunTranscriptItem } from '../lib/run-activity';
import type { VoiceState } from '../lib/voice-dictation';
import type { ComposerActivityItem } from '../components/ComposerActivityShelf';
import { extractTurnImageAttachments, extractTurnTextAttachments, hasAssistantTurnForRun } from '../lib/thread-presentation';
import { ComposerPanel } from '../components/ComposerPanel';
import { ThreadSubagentActivityCard } from '../components/ThreadSubagentActivityCard';
import { RunActivityPanel } from '../components/RunActivityPanel';
import { RunTranscriptTimeline } from '../components/RunTranscriptTimeline';
import { LiveRunStatus } from '../components/LiveRunStatus';
import { MessageResponse } from '../components/ai-elements/message';
import { BookIcon } from '../components/icons';
import { cx } from '../components/ui/utils';

type ComposerMode = 'default' | 'plan';
type ComposerEffort = 'Low' | 'Medium' | 'High' | 'Extra high';

interface ComposerState {
  prompt: string;
  providerId: ProviderId;
  modelId: string;
  thinkingEnabled: boolean;
  mode: ComposerMode;
  executionPermission: ExecutionPermission;
  isolationMode: HarnessIsolationMode;
  imageAttachments: ImageAttachment[];
  textAttachments: TextAttachment[];
}

interface ThreadRouteContainerProps {
  activeDisplayedRunId: string | null;
  activeRunActivity: RunActivityViewModel | null;
  activeRunTranscriptItems: RunTranscriptItem[];
  activeSubagents: SubagentSummary[];
  activeThread: ThreadDetail | null;
  availableComposerSkills: SkillDefinition[];
  canCreateTextAttachments: boolean;
  composer: ComposerState;
  composerActivityItems: ComposerActivityItem[];
  composerEffort: ComposerEffort;
  composerProjectId: string | null;
  composerRef: RefObject<HTMLTextAreaElement | null>;
  composerSubmitting: boolean;
  emptyThreadHero: ReactNode;
  enhancingPrompt: boolean;
  handleComposerVoice: () => void;
  installedComposerSkills: SkillDefinition[];
  markTranscriptUserScrollIntent: (input?: { wheelDeltaY?: number }) => void;
  openProviderSettings: () => void;
  openProjectFromPicker: () => void | Promise<void>;
  pendingNativeCommandId: NativeComposerCommandId | null;
  plannerSubmitting: boolean;
  refreshProvider: (providerId: ProviderId) => void;
  resolveThreadTitle: (threadId: string | null) => string | null;
  restoringThreadState: ReactNode;
  runActivityByRunId: Record<string, RunActivityViewModel | undefined>;
  runTranscriptItemsByRunId: Record<string, RunTranscriptItem[] | undefined>;
  selectedProject: Project | null;
  setActiveImageAttachment: (attachment: ImageAttachment | null) => void;
  setComposerPrompt: (prompt: string) => void;
  setExecutionPermission: (executionPermission: ExecutionPermission) => void;
  setIsolationMode: (isolationMode: HarnessIsolationMode) => void;
  setPendingNativeCommandId: (commandId: NativeComposerCommandId | null) => void;
  showToast: (level: 'info' | 'warning' | 'error', message: string, title?: string) => void;
  showTranscriptRailCentered: boolean;
  skills: SkillDefinition[];
  startupThreadRestoreState: 'idle' | 'pending' | 'resolved' | 'failed';
  stagedWorkspaceReviewResolvingKey: string | null;
  worktreeReviewResolvingKey: string | null;
  stopPrompt: () => void;
  submitPrompt: (promptOverride?: string, nativeCommandIdOverride?: NativeComposerCommandId | null) => Promise<boolean>;
  toggleAttachedSkill: (skillId: string) => void;
  toggleComposerMode: () => void;
  transcriptRef: RefObject<HTMLElement | null>;
  transcriptRunAnchorTurnId: string | null;
  transcriptTurns: ThreadTurn[];
  updateTranscriptAutoFollow: (element: HTMLElement) => void;
  visibleProviders: ProviderDescriptor[];
  voiceAvailable: boolean;
  voiceElapsedLabel: string;
  voiceLevel: number;
  voiceState: VoiceState;
  workspaceProject: Project | null;
  applyStagedWorkspaceChange: (input: StagedWorkspaceReviewInput) => void | Promise<void>;
  rejectStagedWorkspaceChange: (input: StagedWorkspaceReviewInput) => void | Promise<void>;
  revertStagedWorkspaceChange: (input: StagedWorkspaceReviewInput) => void | Promise<void>;
  applyStagedWorkspaceHunks: (input: StagedWorkspaceHunkApplyInput) => void | Promise<void>;
  rejectStagedWorkspaceHunks: (input: StagedWorkspaceHunkRejectInput) => void | Promise<void>;
  revertStagedWorkspaceHunks: (input: StagedWorkspaceHunkRevertInput) => void | Promise<void>;
  applyWorktreeReview: (input: WorktreeReviewInput) => void | Promise<void>;
  rejectWorktreeReview: (input: WorktreeReviewInput) => void | Promise<void>;
  revertWorktreeReview: (input: WorktreeReviewInput) => void | Promise<void>;
  applyWorktreeHunks: (input: WorktreeHunkApplyInput) => void | Promise<void>;
  rejectWorktreeHunks: (input: WorktreeHunkRejectInput) => void | Promise<void>;
  revertWorktreeHunks: (input: WorktreeHunkRevertInput) => void | Promise<void>;
  cleanupWorktreeReview: (input: WorktreeCleanupInput) => void | Promise<void>;
  addComposerImageFiles: (files: FileList | File[] | null | undefined) => void;
  addComposerTextAttachment: (content: string, fileName?: string | null) => void;
  removeComposerImageAttachment: (attachmentId: string) => void;
  removeComposerTextAttachment: (attachmentId: string) => void;
  selectComposerEffort: (effort: ComposerEffort) => void;
  selectComposerModel: (providerId: ProviderId, modelId: string) => void;
  enhanceComposerPrompt: (promptOverride?: string) => void;
  createThread: () => void | Promise<void>;
  attachedSkillIds: string[];
}

export function ThreadRouteContainer({
  activeDisplayedRunId,
  activeRunActivity,
  activeRunTranscriptItems,
  activeSubagents,
  activeThread,
  addComposerImageFiles,
  addComposerTextAttachment,
  applyStagedWorkspaceChange,
  applyStagedWorkspaceHunks,
  applyWorktreeReview,
  applyWorktreeHunks,
  attachedSkillIds,
  cleanupWorktreeReview,
  availableComposerSkills,
  canCreateTextAttachments,
  composer,
  composerActivityItems,
  composerEffort,
  composerProjectId,
  composerRef,
  composerSubmitting,
  createThread,
  emptyThreadHero,
  enhanceComposerPrompt,
  enhancingPrompt,
  handleComposerVoice,
  installedComposerSkills,
  markTranscriptUserScrollIntent,
  openProviderSettings,
  openProjectFromPicker,
  pendingNativeCommandId,
  plannerSubmitting,
  refreshProvider,
  rejectStagedWorkspaceChange,
  rejectStagedWorkspaceHunks,
  rejectWorktreeReview,
  rejectWorktreeHunks,
  revertStagedWorkspaceChange,
  revertStagedWorkspaceHunks,
  revertWorktreeReview,
  revertWorktreeHunks,
  removeComposerImageAttachment,
  removeComposerTextAttachment,
  resolveThreadTitle,
  restoringThreadState,
  runActivityByRunId,
  runTranscriptItemsByRunId,
  selectedProject,
  selectComposerEffort,
  selectComposerModel,
  setActiveImageAttachment,
  setComposerPrompt,
  setExecutionPermission,
  setIsolationMode,
  setPendingNativeCommandId,
  showToast,
  showTranscriptRailCentered,
  skills,
  startupThreadRestoreState,
  stagedWorkspaceReviewResolvingKey,
  worktreeReviewResolvingKey,
  stopPrompt,
  submitPrompt,
  toggleAttachedSkill,
  toggleComposerMode,
  transcriptRef,
  transcriptRunAnchorTurnId,
  transcriptTurns,
  updateTranscriptAutoFollow,
  visibleProviders,
  voiceAvailable,
  voiceElapsedLabel,
  voiceLevel,
  voiceState,
  workspaceProject
}: ThreadRouteContainerProps) {
  const transcriptWorkspaceRoot = workspaceProject?.folderPath ?? selectedProject?.folderPath ?? null;

  function resolveTranscriptRunState(runId: string) {
    const derivedState = runActivityByRunId[runId]?.state ?? null;
    const threadStatus = activeThread?.status ?? null;
    if (
      activeThread &&
      (threadStatus === 'queued' || threadStatus === 'running' || threadStatus === 'stopping') &&
      activeThread.rawOutput.some((event) => event.runId === runId) &&
      !activeThread.rawOutput.some((event) =>
        event.runId === runId &&
        (event.eventType === 'completed' || event.eventType === 'failed' || event.eventType === 'aborted')
      )
    ) {
      return 'running' as const;
    }

    return derivedState;
  }

  function shouldShowTerminalOutcomeForRun(runId: string | null) {
    if (!runId) {
      return false;
    }

    const activity = runActivityByRunId[runId] ?? null;
    if (!activity || (activity.state !== 'failed' && activity.state !== 'aborted') || !activity.outcomeMessage) {
      return false;
    }

    return true;
  }

  function renderTerminalOutcomeForRun(runId: string | null) {
    if (!shouldShowTerminalOutcomeForRun(runId)) {
      return null;
    }

    const activity = runId ? runActivityByRunId[runId] ?? null : null;
    if (!activity) {
      return null;
    }

    return <RunActivityPanel activity={activity} showTimeline={false} />;
  }

  return (
    <section className="flex h-full min-h-0 flex-1 flex-col xl:flex-row">
      <section className="thread-view flex min-h-0 min-w-0 flex-1 flex-col gap-0">
        <div className="thread-column flex min-h-0 flex-1 flex-col overflow-hidden">
          <section
            className={cx(
              'transcript flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden px-7 pb-6 pt-5',
              showTranscriptRailCentered && 'items-center justify-center pb-0 pt-0'
            )}
            ref={transcriptRef}
            onWheelCapture={(event) => markTranscriptUserScrollIntent({ wheelDeltaY: event.deltaY })}
            onTouchMoveCapture={markTranscriptUserScrollIntent}
            onScroll={(event) => {
              updateTranscriptAutoFollow(event.currentTarget);
            }}
          >
            <div
              className={cx(
                'thread-transcript-rail mx-auto flex w-full max-w-[980px] flex-col gap-5',
                showTranscriptRailCentered && 'min-h-full flex-1 items-center justify-center'
              )}
            >
              {activeThread ? (
                <>
                  {transcriptTurns.length > 0 ? transcriptTurns.map((turn) => (
                    <div key={turn.id} className="thread-transcript-entry flex flex-col gap-4">
                      {turn.role === 'assistant' && turn.runId && runTranscriptItemsByRunId[turn.runId]?.length ? (
                        <>
                          <RunTranscriptTimeline
                            items={runTranscriptItemsByRunId[turn.runId] ?? []}
                            skills={skills}
                            runState={resolveTranscriptRunState(turn.runId)}
                            activityStartedAt={runActivityByRunId[turn.runId]?.startedAt ?? null}
                            suppressResolutionOutcome={shouldShowTerminalOutcomeForRun(turn.runId)}
                            stagedWorkspaceReviewResolvingKey={stagedWorkspaceReviewResolvingKey}
                            worktreeReviewResolvingKey={worktreeReviewResolvingKey}
                            onApplyStagedWorkspaceChange={applyStagedWorkspaceChange}
                            onRejectStagedWorkspaceChange={rejectStagedWorkspaceChange}
                            onRevertStagedWorkspaceChange={revertStagedWorkspaceChange}
                            onApplyStagedWorkspaceHunks={applyStagedWorkspaceHunks}
                            onRejectStagedWorkspaceHunks={rejectStagedWorkspaceHunks}
                            onRevertStagedWorkspaceHunks={revertStagedWorkspaceHunks}
                            onApplyWorktreeReview={applyWorktreeReview}
                            onRejectWorktreeReview={rejectWorktreeReview}
                            onRevertWorktreeReview={revertWorktreeReview}
                            onApplyWorktreeHunks={applyWorktreeHunks}
                            onRejectWorktreeHunks={rejectWorktreeHunks}
                            onRevertWorktreeHunks={revertWorktreeHunks}
                            onCleanupWorktreeReview={cleanupWorktreeReview}
                            workspaceRoot={transcriptWorkspaceRoot}
                          />
                          {renderTerminalOutcomeForRun(turn.runId)}
                        </>
                      ) : turn.role === 'assistant' && !turn.content.trim() ? null : (
                        <article
                          className={cx(
                            `turn turn-${turn.role}`,
                            'flex flex-col gap-1',
                            turn.role === 'user' && 'items-end'
                          )}
                        >
                          {turn.role === 'assistant' ? (
                            <MessageResponse
                              className="turn-content turn-content-assistant text-[15px] leading-7 text-[color:var(--ui-text-title)]"
                              normalizeSource
                              workspaceRoot={transcriptWorkspaceRoot}
                            >
                              {turn.content || ''}
                            </MessageResponse>
                          ) : (
                            <div className="turn-user-stack flex w-full max-w-[860px] flex-col items-end gap-3">
                              {extractTurnImageAttachments(turn.metadata).length > 0 ? (
                                <div className="turn-image-strip flex flex-wrap justify-end gap-2">
                                  {extractTurnImageAttachments(turn.metadata).map((attachment) => (
                                    <button
                                      key={attachment.id}
                                      type="button"
                                      className="turn-image-thumb overflow-hidden rounded-[18px] border border-[color:var(--ui-border)] bg-[color:var(--ui-alpha-04)] p-0 transition-colors hover:border-[color:var(--ui-border-strong)] hover:bg-[color:var(--ui-alpha-06)]"
                                      onClick={() => setActiveImageAttachment(attachment)}
                                      aria-label={`Open ${attachment.name}`}
                                    >
                                      <img className="block h-24 w-24 object-cover" src={attachment.dataUrl} alt={attachment.name} />
                                    </button>
                                  ))}
                                </div>
                              ) : null}
                              {extractTurnTextAttachments(turn.metadata).length > 0 ? (
                                <div className="turn-text-attachment-strip flex flex-wrap justify-end gap-2">
                                  {extractTurnTextAttachments(turn.metadata).map((attachment) => (
                                    <button
                                      key={attachment.id}
                                      type="button"
                                      className="turn-text-attachment-chip inline-flex max-w-[360px] items-center gap-2 rounded-[18px] border border-[color:var(--ui-border)] bg-[color:var(--ui-alpha-04)] px-3 py-2 text-left transition-colors hover:border-[color:var(--ui-border-strong)] hover:bg-[color:var(--ui-alpha-06)]"
                                      onClick={() => void window.vicode.app.revealPath(attachment.absolutePath)}
                                      aria-label={`Reveal ${attachment.name}`}
                                    >
                                      <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-xl border border-[color:var(--ui-border-soft)] bg-[color:var(--ui-alpha-04)] text-[color:var(--ui-text-muted)]">
                                        <BookIcon />
                                      </span>
                                      <span className="flex min-w-0 flex-1 flex-col">
                                        <span className="truncate text-[12px] font-medium text-[color:var(--ui-text-title)]">{attachment.name}</span>
                                        <span className="truncate text-[11px] text-[color:var(--ui-text-muted)]">
                                          {attachment.relativePath} · {attachment.charCount.toLocaleString()} chars
                                        </span>
                                      </span>
                                    </button>
                                  ))}
                                </div>
                              ) : null}
                              <MessageResponse className="turn-content turn-content-user" workspaceRoot={transcriptWorkspaceRoot}>
                                {turn.content}
                              </MessageResponse>
                            </div>
                          )}
                        </article>
                      )}
                      {turn.role === 'user' &&
                      activeRunActivity &&
                      (activeRunActivity.state === 'running' ||
                        activeRunActivity.state === 'failed' ||
                        activeRunActivity.state === 'aborted') &&
                      !hasAssistantTurnForRun(activeThread, activeDisplayedRunId) &&
                      turn.id === transcriptRunAnchorTurnId ? (
                        activeRunTranscriptItems.length > 0 ? (
                          <>
                            <RunTranscriptTimeline
                              items={activeRunTranscriptItems}
                              skills={skills}
                              runState={activeRunActivity.state}
                              activityStartedAt={activeRunActivity.startedAt}
                              suppressResolutionOutcome={shouldShowTerminalOutcomeForRun(activeDisplayedRunId)}
                              stagedWorkspaceReviewResolvingKey={stagedWorkspaceReviewResolvingKey}
                              worktreeReviewResolvingKey={worktreeReviewResolvingKey}
                              onApplyStagedWorkspaceChange={applyStagedWorkspaceChange}
                              onRejectStagedWorkspaceChange={rejectStagedWorkspaceChange}
                              onRevertStagedWorkspaceChange={revertStagedWorkspaceChange}
                              onApplyStagedWorkspaceHunks={applyStagedWorkspaceHunks}
                              onRejectStagedWorkspaceHunks={rejectStagedWorkspaceHunks}
                              onRevertStagedWorkspaceHunks={revertStagedWorkspaceHunks}
                              onApplyWorktreeReview={applyWorktreeReview}
                              onRejectWorktreeReview={rejectWorktreeReview}
                              onRevertWorktreeReview={revertWorktreeReview}
                              onApplyWorktreeHunks={applyWorktreeHunks}
                              onRejectWorktreeHunks={rejectWorktreeHunks}
                              onRevertWorktreeHunks={revertWorktreeHunks}
                              onCleanupWorktreeReview={cleanupWorktreeReview}
                              workspaceRoot={transcriptWorkspaceRoot}
                            />
                            {renderTerminalOutcomeForRun(activeDisplayedRunId)}
                          </>
                        ) : (
                          <RunActivityPanel activity={activeRunActivity} />
                        )
                      ) : null}
                    </div>
                  )) : activeRunActivity &&
                    (activeRunActivity.state === 'running' ||
                      activeRunActivity.state === 'failed' ||
                      activeRunActivity.state === 'aborted') ? (
                    <div className="thread-transcript-entry flex flex-col gap-4">
                      {activeRunTranscriptItems.length > 0 ? (
                        <>
                          <RunTranscriptTimeline
                            items={activeRunTranscriptItems}
                            skills={skills}
                            runState={activeRunActivity.state}
                            activityStartedAt={activeRunActivity.startedAt}
                            suppressResolutionOutcome={shouldShowTerminalOutcomeForRun(activeDisplayedRunId)}
                            stagedWorkspaceReviewResolvingKey={stagedWorkspaceReviewResolvingKey}
                            worktreeReviewResolvingKey={worktreeReviewResolvingKey}
                            onApplyStagedWorkspaceChange={applyStagedWorkspaceChange}
                            onRejectStagedWorkspaceChange={rejectStagedWorkspaceChange}
                            onRevertStagedWorkspaceChange={revertStagedWorkspaceChange}
                            onApplyStagedWorkspaceHunks={applyStagedWorkspaceHunks}
                            onRejectStagedWorkspaceHunks={rejectStagedWorkspaceHunks}
                            onRevertStagedWorkspaceHunks={revertStagedWorkspaceHunks}
                            onApplyWorktreeReview={applyWorktreeReview}
                            onRejectWorktreeReview={rejectWorktreeReview}
                            onRevertWorktreeReview={revertWorktreeReview}
                            onApplyWorktreeHunks={applyWorktreeHunks}
                            onRejectWorktreeHunks={rejectWorktreeHunks}
                            onRevertWorktreeHunks={revertWorktreeHunks}
                            onCleanupWorktreeReview={cleanupWorktreeReview}
                            workspaceRoot={transcriptWorkspaceRoot}
                          />
                          {renderTerminalOutcomeForRun(activeDisplayedRunId)}
                        </>
                      ) : (
                        <RunActivityPanel activity={activeRunActivity} />
                      )}
                    </div>
                  ) : emptyThreadHero}
                  {activeSubagents.length > 0 ? (
                    <div className="thread-transcript-entry thread-transcript-subagent-entry flex flex-col gap-4">
                      <ThreadSubagentActivityCard
                        subagents={activeSubagents}
                        resolveThreadTitle={resolveThreadTitle}
                      />
                    </div>
                  ) : null}
                </>
              ) : startupThreadRestoreState === 'pending' ? (
                restoringThreadState
              ) : (
                emptyThreadHero
              )}
            </div>
          </section>

          <div className="thread-composer-stack flex shrink-0 flex-col px-7 py-5">
            <div className="thread-composer-rail flex flex-col gap-3">
              <LiveRunStatus activity={activeRunActivity} />
              {selectedProject ? (
                <ComposerPanel
                  activityItems={composerActivityItems}
                  prompt={composer.prompt}
                  setPrompt={setComposerPrompt}
                  imageAttachments={composer.imageAttachments}
                  textAttachments={composer.textAttachments}
                  canCreateTextAttachments={canCreateTextAttachments}
                  addImageFiles={addComposerImageFiles}
                  addTextAttachmentFromPaste={addComposerTextAttachment}
                  removeImageAttachment={removeComposerImageAttachment}
                  removeTextAttachment={removeComposerTextAttachment}
                  composerRef={composerRef}
                  providers={visibleProviders}
                  providerId={composer.providerId}
                  modelId={composer.modelId}
                  composerMode={composer.mode}
                  executionPermission={composer.executionPermission}
                  isolationMode={composer.isolationMode}
                  runtimeCommandPolicy={workspaceProject?.runtimeCommandPolicy}
                  runtimeNetworkPolicy={workspaceProject?.runtimeNetworkPolicy}
                  onSelectPermission={(executionPermission) => void setExecutionPermission(executionPermission)}
                  onSelectIsolationMode={setIsolationMode}
                  effort={composerEffort}
                  installedSkills={installedComposerSkills}
                  availableSkills={availableComposerSkills}
                  attachedSkillIds={attachedSkillIds}
                  toggleAttachedSkill={toggleAttachedSkill}
                  selectComposerModel={selectComposerModel}
                  selectComposerEffort={selectComposerEffort}
                  refreshProvider={refreshProvider}
                  openProviderSettings={openProviderSettings}
                  openProjectFromPicker={openProjectFromPicker}
                  createThread={createThread}
                  toggleComposerMode={toggleComposerMode}
                  handleComposerVoice={handleComposerVoice}
                  voiceState={voiceState}
                  voiceAvailable={voiceAvailable}
                  voiceElapsedLabel={voiceElapsedLabel}
                  voiceLevel={voiceLevel}
                  pendingNativeCommandId={pendingNativeCommandId}
                  setPendingNativeCommandId={setPendingNativeCommandId}
                  stopPrompt={stopPrompt}
                  enhancePrompt={enhanceComposerPrompt}
                  enhancingPrompt={enhancingPrompt}
                  submittingPrompt={composerSubmitting || plannerSubmitting}
                  submitPrompt={submitPrompt}
                  activeRunId={activeRunActivity?.state === 'running' ? activeDisplayedRunId : null}
                  showToast={showToast}
                />
              ) : null}
            </div>
          </div>
        </div>
      </section>
    </section>
  );
}
