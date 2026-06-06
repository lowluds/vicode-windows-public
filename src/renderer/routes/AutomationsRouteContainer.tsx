import { useMemo, type Dispatch, type SetStateAction } from 'react';
import type {
  AutomationDefinition,
  AutomationRun,
  JobDefinition,
  ProviderDescriptor,
  ProviderId,
  ReviewItem,
  SkillDefinition
} from '../../shared/domain';
import { normalizeDisplayText } from '../../shared/display-text';
import { resolveProviderModelId } from '../lib/provider-defaults';
import {
  describeReviewItem,
  type ReviewPresentation
} from '../lib/review-presentation';
import { formatAutomationSchedule, formatTime } from '../lib/thread-presentation';
import {
  ActionButton,
  DangerButton,
  ModalDialog,
  PrimaryButton,
  SelectField,
  StatusPill,
  SurfaceCard,
  TextArea,
  TextInput,
  ConfirmDialog
} from '../components/ui';
import {
  AccountIcon,
  BookIcon,
  CheckIcon,
  CloseIcon,
  EditIcon,
  PlayIcon,
  PlusIcon,
  SaveIcon,
  TaskIcon,
  TrashIcon,
  NoteIcon
} from '../components/icons';

export type AutomationDraftState = {
  id: string | null;
  name: string;
  promptTemplate: string;
  providerId: ProviderId;
  modelId: string;
  skillId: string;
  scheduleType: 'manual' | 'interval_while_app_open';
  intervalMinutes: string;
};

export type AutomationTemplate = {
  id: string;
  name: string;
  summary: string;
  promptTemplate: string;
  group: 'Status reports' | 'Release prep' | 'Incidents & triage' | 'Code quality';
};

const AUTOMATION_TEMPLATES: AutomationTemplate[] = [
  {
    id: 'repo-health-check',
    group: 'Status reports',
    name: 'Repo health check',
    summary: 'Summarize the latest repo activity and flag anything that needs attention.',
    promptTemplate:
      'Review the recent activity in this project and produce a concise status report. Ground statements in commits, changed files, PRs, and test results when available. Highlight blockers, risky areas, and the most useful next step.'
  },
  {
    id: 'weekly-change-summary',
    group: 'Status reports',
    name: 'Weekly change summary',
    summary: 'Synthesize the latest merged work into a readable weekly update.',
    promptTemplate:
      'Summarize the most important changes made in this project recently. Organize by theme, mention notable files or PRs when available, and call out anything that still needs follow-up.'
  },
  {
    id: 'release-notes-draft',
    group: 'Release prep',
    name: 'Draft release notes',
    summary: 'Turn merged work into a release-ready notes draft.',
    promptTemplate:
      'Draft release notes for the latest shipped changes in this project. Group items into user-facing improvements, fixes, and internal changes. Keep it concise and readable, and include references to relevant files or PRs when available.'
  },
  {
    id: 'pre-release-check',
    group: 'Release prep',
    name: 'Pre-release check',
    summary: 'Verify changelog, migrations, tests, and risky flags before release.',
    promptTemplate:
      'Inspect this project before release and report whether it looks ready to ship. Check for recent test failures, pending migrations, changelog gaps, risky configuration changes, and obvious release blockers. End with a clear go/no-go recommendation.'
  },
  {
    id: 'incident-triage',
    group: 'Incidents & triage',
    name: 'Incident triage',
    summary: 'Group current failures by likely root cause and suggest the smallest useful fix.',
    promptTemplate:
      'Review recent failures, incidents, or unstable areas in this project and group them by likely root cause. Suggest the smallest high-leverage fixes first and call out the evidence for each recommendation.'
  },
  {
    id: 'issue-triage',
    group: 'Incidents & triage',
    name: 'Issue triage',
    summary: 'Triage new issues and propose priority, owner, and next action.',
    promptTemplate:
      'Review recent open issues or project pain points and triage them. Suggest likely priority, probable owner, and the best next action for each item. Keep the output concise and operational.'
  },
  {
    id: 'dependency-audit',
    group: 'Code quality',
    name: 'Dependency audit',
    summary: 'Look for outdated, risky, or high-noise dependencies and propose cleanup.',
    promptTemplate:
      'Audit this project for dependency risk and maintenance issues. Identify outdated, noisy, or risky dependencies, explain the impact, and suggest the most practical cleanup plan.'
  },
  {
    id: 'quality-review',
    group: 'Code quality',
    name: 'Quality review',
    summary: 'Scan for obvious hotspots, flaky areas, and code paths worth tightening.',
    promptTemplate:
      'Review this project for code quality risks. Focus on fragile areas, repeated patterns, weak testing coverage, and obvious maintainability issues. Prioritize the findings and suggest the most valuable follow-up work.'
  }
];

function renderReviewIcon(icon: ReviewPresentation['icon']) {
  switch (icon) {
    case 'note':
      return <NoteIcon />;
    case 'memory':
      return <BookIcon />;
    case 'user':
      return <AccountIcon />;
    case 'automation':
    default:
      return <TaskIcon />;
  }
}

interface AutomationsRouteContainerProps {
  onBack: () => void;
  selectedProject: { id: string; name: string } | null;
  automations: AutomationDefinition[];
  skills: SkillDefinition[];
  reviewItems: ReviewItem[];
  jobs: JobDefinition[];
  reviewDraftEdits: Record<string, string>;
  setReviewDraftEdits: Dispatch<SetStateAction<Record<string, string>>>;
  reviewDraftSavingId: string | null;
  saveReviewDraft: (reviewItem: ReviewItem) => Promise<void>;
  approveReview: (reviewItemId: string) => Promise<void>;
  rejectReview: (reviewItemId: string) => Promise<void>;
  openAutomationEditor: () => void;
  editAutomation: (automation: AutomationDefinition) => void;
  openAutomationHistory: (automationId: string) => Promise<void>;
  toggleAutomation: (automationId: string, enabled: boolean) => Promise<void>;
  runAutomation: (automationId: string) => Promise<void>;
  automationEditorOpen: boolean;
  closeAutomationEditor: () => void;
  setAutomationEditorOpen: (open: boolean) => void;
  automationDraft: AutomationDraftState;
  setAutomationDraft: Dispatch<SetStateAction<AutomationDraftState>>;
  createAutomation: () => Promise<void>;
  visibleProviders: ProviderDescriptor[];
  automationModelOptions: ProviderDescriptor['models'];
  availableAutomationSkills: SkillDefinition[];
  automationHistoryId: string | null;
  setAutomationHistoryId: (value: string | null) => void;
  automationHistoryTarget: AutomationDefinition | null;
  automationHistoryRuns: AutomationRun[];
  setAutomationHistoryRuns: Dispatch<SetStateAction<AutomationRun[]>>;
  automationHistoryLoading: boolean;
  setAutomationHistoryLoading: (loading: boolean) => void;
  openThread: (threadId: string) => Promise<void>;
  automationDeleteId: string | null;
  setAutomationDeleteId: (value: string | null) => void;
  automationDeleteTarget: AutomationDefinition | null;
  deleteAutomation: () => Promise<void>;
  applyAutomationTemplate: (template: AutomationTemplate) => void;
}

export function AutomationsRouteContainer({
  onBack,
  selectedProject,
  automations,
  skills,
  reviewItems,
  jobs,
  reviewDraftEdits,
  setReviewDraftEdits,
  reviewDraftSavingId,
  saveReviewDraft,
  approveReview,
  rejectReview,
  openAutomationEditor,
  editAutomation,
  openAutomationHistory,
  toggleAutomation,
  runAutomation,
  automationEditorOpen,
  closeAutomationEditor,
  setAutomationEditorOpen,
  automationDraft,
  setAutomationDraft,
  createAutomation,
  visibleProviders,
  automationModelOptions,
  availableAutomationSkills,
  automationHistoryId,
  setAutomationHistoryId,
  automationHistoryTarget,
  automationHistoryRuns,
  setAutomationHistoryRuns,
  automationHistoryLoading,
  setAutomationHistoryLoading,
  openThread,
  automationDeleteId,
  setAutomationDeleteId,
  automationDeleteTarget,
  deleteAutomation,
  applyAutomationTemplate
}: AutomationsRouteContainerProps) {
  const automationTemplateGroups = useMemo(() => {
    const groups = new Map<AutomationTemplate['group'], AutomationTemplate[]>();
    for (const template of AUTOMATION_TEMPLATES) {
      const current = groups.get(template.group) ?? [];
      current.push(template);
      groups.set(template.group, current);
    }
    return [...groups.entries()];
  }, []);

  return (
    <>
      <section className="catalog-view automation-view">
        <div className="automation-page-shell">
          <header className="view-header automation-view-header flex items-start justify-between gap-4">
            <div>
              <h2>Automations</h2>
              <p>Manual and while-open schedules in v1.</p>
            </div>
            <div className="automation-view-header-actions">
              <PrimaryButton className="automation-toolbar-primary" size="compact" leadingIcon={<PlusIcon />} onClick={openAutomationEditor}>
                Create automation
              </PrimaryButton>
              <ActionButton className="automation-toolbar-close rounded-xl" size="compact" tone="quiet" leadingIcon={<CloseIcon />} onClick={onBack}>
                Close
              </ActionButton>
            </div>
          </header>
          <div className="automation-route-shell">
            <section className="automation-main-column">
              <section className="automation-template-group">
                <div className="automation-template-group-header">
                  <h3>Manual automations</h3>
                </div>
              </section>
              <section className="automation-template-section">
                {automationTemplateGroups.map(([group, templates]) => (
                  <div key={group} className="automation-template-group">
                    <div className="automation-template-group-header">
                      <h3>{group}</h3>
                    </div>
                    <div className="automation-template-grid">
                      {templates.map((template) => (
                        <article key={template.id} className="automation-template-card">
                          <div className="automation-template-copy">
                            <strong>{template.name}</strong>
                            <p>{template.summary}</p>
                          </div>
                          <ActionButton className="automation-template-action" size="compact" tone="quiet" onClick={() => applyAutomationTemplate(template)}>
                            Use template
                          </ActionButton>
                        </article>
                      ))}
                    </div>
                  </div>
                ))}
              </section>
              <section className="automation-list">
                {reviewItems.length > 0 ? (
                  <div className="panel pending-review-panel" data-testid="pending-review-section">
                    <div className="pending-review-header">
                      <div className="pending-review-header-copy">
                        <h3>Pending review</h3>
                        <p>Approve queued automation runs and app-managed review items.</p>
                      </div>
                      <StatusPill tone="warning">{reviewItems.length} pending</StatusPill>
                    </div>
                    {reviewItems.map((reviewItem) => {
                      const job = jobs.find((item) => item.id === reviewItem.jobId) ?? null;
                      const presentation = describeReviewItem(reviewItem, job);
                      const persistedDraftContent = String(reviewItem.details.content ?? '');
                      const draftContent = reviewDraftEdits[reviewItem.id] ?? persistedDraftContent;
                      const hasUnsavedDraftChanges = presentation.isManualWrite && draftContent.trim() !== persistedDraftContent.trim();
                      return (
                        <article
                          key={reviewItem.id}
                          className="automation-card review-card"
                          data-testid={`pending-review-card-${reviewItem.id}`}
                        >
                          <div className="skill-card-top review-card-top">
                            <div className="review-card-copy">
                              <div className="review-card-eyebrow">
                                <span className="review-card-eyebrow-icon" aria-hidden="true">
                                  {renderReviewIcon(presentation.icon)}
                                </span>
                                <span>{presentation.kindLabel}</span>
                              </div>
                              <h3>{presentation.title}</h3>
                              <p>{presentation.summary}</p>
                            </div>
                            <StatusPill tone="warning">pending review</StatusPill>
                          </div>
                          <div className="review-card-meta-list">
                            {presentation.meta.map((entry) => (
                              <div key={`${reviewItem.id}-${entry.label}-${entry.value}`} className="review-card-meta-pill">
                                <span className="review-card-meta-label">{entry.label}</span>
                                <span className="review-card-meta-value">{entry.value}</span>
                              </div>
                            ))}
                          </div>
                          {presentation.isManualWrite ? (
                            <SurfaceCard className="review-card-draft">
                              <div className="review-card-draft-header">
                                <div className="review-card-draft-copy">
                                  <strong>Review draft</strong>
                                  <span>App-managed memory</span>
                                </div>
                                <div className="review-card-draft-actions">
                                  {hasUnsavedDraftChanges ? <span className="review-card-draft-status">Edited locally</span> : null}
                                  <ActionButton
                                    size="compact"
                                    tone="quiet"
                                    onClick={() => void saveReviewDraft(reviewItem)}
                                    leadingIcon={<SaveIcon />}
                                    disabled={!hasUnsavedDraftChanges || reviewDraftSavingId === reviewItem.id}
                                  >
                                    {reviewDraftSavingId === reviewItem.id ? 'Saving...' : 'Save draft changes'}
                                  </ActionButton>
                                </div>
                              </div>
                              <TextArea
                                rows={8}
                                className="app-managed-memory-editor review-card-editor"
                                value={draftContent}
                                onChange={(event) =>
                                  setReviewDraftEdits((current) => ({
                                    ...current,
                                    [reviewItem.id]: event.target.value
                                  }))
                                }
                              />
                            </SurfaceCard>
                          ) : null}
                          <div className="automation-actions">
                            <ActionButton onClick={() => void rejectReview(reviewItem.id)} leadingIcon={<CloseIcon />}>
                              Reject
                            </ActionButton>
                            <PrimaryButton
                              onClick={() => void approveReview(reviewItem.id)}
                              leadingIcon={<PlayIcon />}
                              disabled={hasUnsavedDraftChanges}
                            >
                              {presentation.isManualWrite ? 'Approve' : 'Approve and run'}
                            </PrimaryButton>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                ) : null}
                {automations.map((automation) => (
                  <article key={automation.id} className="automation-card">
                    <div className="skill-card-top">
                      <div>
                        <h3>{automation.name}</h3>
                        <p>{automation.promptTemplate}</p>
                      </div>
                      <StatusPill tone={automation.enabled ? 'connected' : 'disconnected'}>
                        {automation.enabled ? 'enabled' : 'disabled'}
                      </StatusPill>
                    </div>
                    <div className="skill-meta">
                      <span>{selectedProject?.id === automation.projectId ? selectedProject.name : automation.projectId}</span>
                      <span>{automation.providerId}</span>
                      <span>{automation.modelId}</span>
                      {automation.skillId ? (
                        <span>{skills.find((skill) => skill.id === automation.skillId)?.name ?? 'Attached skill'}</span>
                      ) : null}
                      <span>{formatAutomationSchedule(automation)}</span>
                      <span>{`Last ${formatTime(automation.lastRunAt)}`}</span>
                      {automation.scheduleType === 'interval_while_app_open' ? (
                        <span>{`Next ${formatTime(automation.nextRunAt)}`}</span>
                      ) : null}
                    </div>
                    <div className="automation-actions">
                      <ActionButton onClick={() => void toggleAutomation(automation.id, !automation.enabled)} leadingIcon={automation.enabled ? <CloseIcon /> : <CheckIcon />}>
                        {automation.enabled ? 'Disable' : 'Enable'}
                      </ActionButton>
                      <ActionButton onClick={() => editAutomation(automation)} leadingIcon={<EditIcon />}>
                        Edit
                      </ActionButton>
                      <ActionButton onClick={() => void openAutomationHistory(automation.id)} leadingIcon={<TaskIcon />}>
                        History
                      </ActionButton>
                      <PrimaryButton onClick={() => void runAutomation(automation.id)} leadingIcon={<PlayIcon />}>
                        Run now
                      </PrimaryButton>
                      <DangerButton onClick={() => setAutomationDeleteId(automation.id)} leadingIcon={<TrashIcon />}>
                        Delete
                      </DangerButton>
                    </div>
                  </article>
                ))}
              </section>
            </section>
          </div>
        </div>
      </section>

      <ModalDialog
        open={automationEditorOpen}
        onOpenChange={(open) => {
          if (!open) {
            closeAutomationEditor();
            return;
          }
          setAutomationEditorOpen(true);
        }}
        title={automationDraft.id ? 'Edit automation' : 'Create automation'}
        description="Saved workflows queue reviewed agent runs for the current project."
        className="automation-editor-dialog"
        actions={
          <>
            <ActionButton tone="quiet" onClick={closeAutomationEditor}>
              Cancel
            </ActionButton>
            <PrimaryButton onClick={() => void createAutomation()} leadingIcon={<TaskIcon />}>
              {automationDraft.id ? 'Update automation' : 'Save automation'}
            </PrimaryButton>
          </>
        }
      >
        <div className="automation-editor-form">
          <TextInput
            placeholder="Name"
            value={automationDraft.name}
            onChange={(event) => setAutomationDraft((current) => ({ ...current, name: event.target.value }))}
          />
          <div className="automation-readonly-meta">
            <span className="automation-readonly-label">Project</span>
            <strong>{selectedProject?.name ?? 'Select a project first'}</strong>
          </div>
          <SelectField
            value={automationDraft.providerId}
            onChange={(event) => {
              const nextProviderId = event.target.value as ProviderId;
              setAutomationDraft((current) => ({
                ...current,
                providerId: nextProviderId,
                modelId: resolveProviderModelId(visibleProviders, nextProviderId, current.modelId),
                skillId: ''
              }));
            }}
          >
            {visibleProviders.map((provider) => (
              <option key={provider.id} value={provider.id}>
                {provider.label}
              </option>
            ))}
          </SelectField>
          <SelectField
            value={automationDraft.modelId}
            onChange={(event) => setAutomationDraft((current) => ({ ...current, modelId: event.target.value }))}
          >
            {automationModelOptions.map((model) => (
              <option key={model.id} value={model.id}>
                {model.label}
              </option>
            ))}
          </SelectField>
          <SelectField
            value={automationDraft.skillId}
            onChange={(event) => setAutomationDraft((current) => ({ ...current, skillId: event.target.value }))}
          >
            <option value="">No skill attached</option>
            {availableAutomationSkills.map((skill) => (
              <option key={skill.id} value={skill.id}>
                {skill.name}
              </option>
            ))}
          </SelectField>
          <SelectField
            value={automationDraft.scheduleType}
            onChange={(event) =>
              setAutomationDraft((current) => ({
                ...current,
                scheduleType: event.target.value as 'manual' | 'interval_while_app_open'
              }))
            }
          >
            <option value="manual">Manual</option>
            <option value="interval_while_app_open">While app is open</option>
          </SelectField>
          {automationDraft.scheduleType === 'interval_while_app_open' ? (
            <TextInput
              placeholder="Interval minutes"
              value={automationDraft.intervalMinutes}
              onChange={(event) => setAutomationDraft((current) => ({ ...current, intervalMinutes: event.target.value }))}
            />
          ) : null}
          <TextArea
            className="tall"
            placeholder="Describe what this automation should do when it runs."
            value={automationDraft.promptTemplate}
            onChange={(event) =>
              setAutomationDraft((current) => ({ ...current, promptTemplate: event.target.value }))
            }
          />
          <p className="automation-form-note">Automation runs enter the review queue before execution.</p>
        </div>
      </ModalDialog>

      <ModalDialog
        open={Boolean(automationHistoryId)}
        onOpenChange={(open) => {
          if (!open) {
            setAutomationHistoryId(null);
            setAutomationHistoryRuns([]);
            setAutomationHistoryLoading(false);
          }
        }}
        title={automationHistoryTarget ? `${automationHistoryTarget.name} history` : 'Automation history'}
        description="Recent review and execution events for this automation."
        className="automation-history-dialog"
      >
        <div className="automation-history-list">
          {automationHistoryLoading ? (
            <SurfaceCard className="automation-history-empty">
              <p>Loading history...</p>
            </SurfaceCard>
          ) : automationHistoryRuns.length === 0 ? (
            <SurfaceCard className="automation-history-empty">
              <p>No runs recorded yet.</p>
            </SurfaceCard>
          ) : (
            automationHistoryRuns.map((run) => (
              <SurfaceCard key={run.id} className="automation-history-item">
                <div className="automation-history-item-top">
                  <StatusPill
                    tone={
                      run.status === 'completed'
                        ? 'connected'
                        : run.status === 'running' || run.status === 'waiting_for_review'
                          ? 'warning'
                          : run.status === 'failed'
                            ? 'disconnected'
                            : 'default'
                    }
                  >
                    {run.status.replaceAll('_', ' ')}
                  </StatusPill>
                  <span>{formatTime(run.createdAt)}</span>
                </div>
                <p>{run.message}</p>
                {run.threadId ? (
                  <ActionButton size="compact" tone="quiet" onClick={() => void openThread(run.threadId!)}>
                    Open thread
                  </ActionButton>
                ) : null}
              </SurfaceCard>
            ))
          )}
        </div>
      </ModalDialog>

      <ConfirmDialog
        open={Boolean(automationDeleteId)}
        onOpenChange={(open) => {
          if (!open) {
            setAutomationDeleteId(null);
          }
        }}
        title="Delete automation?"
        description={
          automationDeleteTarget
            ? `Delete "${automationDeleteTarget.name}" permanently from Vicode's local automation store?`
            : 'Delete this automation permanently from Vicode\'s local automation store?'
        }
        confirmLabel="Delete automation"
        tone="danger"
        onConfirm={() => void deleteAutomation()}
      />
    </>
  );
}
