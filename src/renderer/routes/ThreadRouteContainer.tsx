import type { ReactNode, RefObject } from 'react';
import type {
  ImageAttachment,
  Project,
  ProviderDescriptor,
  ProviderId,
  SkillDefinition,
  SubagentSummary,
  TextAttachment,
  ThreadDetail,
  ThreadTurn
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
type ExecutionPermission = 'default' | 'acceptEdits' | 'fullAuto';
type ComposerEffort = 'Low' | 'Medium' | 'High' | 'Extra high';

interface ComposerState {
  prompt: string;
  providerId: ProviderId;
  modelId: string;
  thinkingEnabled: boolean;
  mode: ComposerMode;
  executionPermission: ExecutionPermission;
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
  composerContextWindow: string | null;
  composerEffort: ComposerEffort;
  composerProjectId: string | null;
  composerRef: RefObject<HTMLTextAreaElement | null>;
  composerSubmitting: boolean;
  emptyThreadHero: ReactNode;
  enhancingPrompt: boolean;
  handleComposerVoice: () => void;
  installedComposerSkills: SkillDefinition[];
  markTranscriptUserScrollIntent: () => void;
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
  setPendingNativeCommandId: (commandId: NativeComposerCommandId | null) => void;
  showToast: (level: 'info' | 'warning' | 'error', message: string, title?: string) => void;
  showTranscriptRailCentered: boolean;
  skills: SkillDefinition[];
  startupThreadRestoreState: 'idle' | 'pending' | 'resolved' | 'failed';
  stopPrompt: () => void;
  submitPrompt: (promptOverride?: string, nativeCommandIdOverride?: NativeComposerCommandId | null) => Promise<boolean>;
  thinkingEnabled: boolean;
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
  addComposerImageFiles: (files: FileList | File[] | null | undefined) => void;
  addComposerTextAttachment: (content: string, fileName?: string | null) => void;
  removeComposerImageAttachment: (attachmentId: string) => void;
  removeComposerTextAttachment: (attachmentId: string) => void;
  selectComposerEffort: (effort: ComposerEffort) => void;
  selectComposerModel: (providerId: ProviderId, modelId: string) => void;
  selectProviderThinking: (thinkingEnabled: boolean) => void;
  enhanceComposerPrompt: () => void;
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
  attachedSkillIds,
  availableComposerSkills,
  canCreateTextAttachments,
  composer,
  composerActivityItems,
  composerContextWindow,
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
  removeComposerImageAttachment,
  removeComposerTextAttachment,
  resolveThreadTitle,
  restoringThreadState,
  runActivityByRunId,
  runTranscriptItemsByRunId,
  selectedProject,
  selectComposerEffort,
  selectComposerModel,
  selectProviderThinking,
  setActiveImageAttachment,
  setComposerPrompt,
  setExecutionPermission,
  setPendingNativeCommandId,
  showToast,
  showTranscriptRailCentered,
  skills,
  startupThreadRestoreState,
  stopPrompt,
  submitPrompt,
  thinkingEnabled,
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
            onWheelCapture={markTranscriptUserScrollIntent}
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
                        <RunTranscriptTimeline
                          items={runTranscriptItemsByRunId[turn.runId] ?? []}
                          skills={skills}
                          runState={runActivityByRunId[turn.runId]?.state ?? null}
                          activityStartedAt={runActivityByRunId[turn.runId]?.startedAt ?? null}
                        />
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
                              <MessageResponse className="turn-content turn-content-user rounded-[22px] bg-[image:var(--ui-panel-gradient-strong)] px-5 py-4 text-[15px] leading-7 text-[color:var(--ui-text-title)]">
                                {turn.content}
                              </MessageResponse>
                            </div>
                          )}
                        </article>
                      )}
                      {turn.role === 'user' &&
                      activeRunActivity &&
                      activeRunActivity.state === 'running' &&
                      !hasAssistantTurnForRun(activeThread, activeDisplayedRunId) &&
                      turn.id === transcriptRunAnchorTurnId ? (
                        activeRunTranscriptItems.length > 0 ? (
                          <RunTranscriptTimeline
                            items={activeRunTranscriptItems}
                            skills={skills}
                            runState={activeRunActivity.state}
                            activityStartedAt={activeRunActivity.startedAt}
                          />
                        ) : (
                          <RunActivityPanel activity={activeRunActivity} />
                        )
                      ) : null}
                    </div>
                  )) : emptyThreadHero}
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
            <div className="thread-composer-rail flex w-full max-w-[980px] flex-col gap-3">
              {activeRunActivity && (activeRunActivity.state === 'failed' || activeRunActivity.state === 'aborted') ? (
                <RunActivityPanel activity={activeRunActivity} showTimeline={false} />
              ) : null}
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
                  contextWindow={composerContextWindow}
                  executionPermission={composer.executionPermission}
                  runtimeCommandPolicy={workspaceProject?.runtimeCommandPolicy}
                  runtimeNetworkPolicy={workspaceProject?.runtimeNetworkPolicy}
                  onSelectPermission={(executionPermission) => void setExecutionPermission(executionPermission)}
                  effort={composerEffort}
                  thinkingEnabled={thinkingEnabled}
                  installedSkills={installedComposerSkills}
                  availableSkills={availableComposerSkills}
                  attachedSkillIds={attachedSkillIds}
                  toggleAttachedSkill={toggleAttachedSkill}
                  selectComposerModel={selectComposerModel}
                  selectComposerEffort={selectComposerEffort}
                  selectProviderThinking={selectProviderThinking}
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
                  activeRunId={activeDisplayedRunId}
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
