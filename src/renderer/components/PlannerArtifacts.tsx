import { useEffect, useMemo, useState } from 'react';
import type {
  PlannerPlan,
  PlannerQuestionAnswer,
  PlannerQuestionSet,
  ProviderPlannerPolicy,
  RunProgressState,
  RunTaskStatus
} from '../../shared/domain';
import { derivePlannerTaskLabels } from '../../shared/run-progress';
import { ActionButton, PrimaryButton, SelectableRowButton, TextArea, TextInput } from './ui';
import { MessageResponse } from './ai-elements/message';
import { ArrowLeftIcon, CheckIcon, ChevronRightIcon, TaskIcon } from './icons';
import { cx } from './ui/utils';

const PLANNER_OTHER_OPTION_ID = '__other__';
const PLANNER_PLAN_PREVIEW_LIMIT = 8;

type PlannerChecklistItem = {
  label: string;
  status: RunTaskStatus;
};

function formatPlannerDisplayTitle(value: string | null | undefined, fallback: string) {
  const cleaned = (value ?? '')
    .replace(/^[\s`"'*_#-]+/gu, '')
    .replace(/^title\s*:\s*/iu, '')
    .replace(/^[\s`"'*_#-]+/gu, '')
    .replace(/\s*(?:##\s*)?(?:summary|key changes|implementation changes|test plan|assumptions)\b.*$/iu, '')
    .replace(/\s*(?:target outcome|goal|problem|context)\s*:\s*.*$/iu, '')
    .replace(/\s*(?:[-*]|\d+\.)\s+.*$/u, '')
    .replace(/[\s`"'*_#-]+$/gu, '')
    .replace(/\s+/gu, ' ')
    .trim();

  return cleaned || fallback;
}

function normalizePlannerTaskKey(value: string) {
  return value
    .replace(/^\d+[.)]\s+/u, '')
    .trim()
    .toLowerCase();
}

function derivePlannerChecklistItems(plan: PlannerPlan, runProgress: RunProgressState | null | undefined): PlannerChecklistItem[] {
  const progressByLabel = new Map(
    (runProgress?.items ?? []).map((item) => [normalizePlannerTaskKey(item.label), item])
  );

  return derivePlannerTaskLabels(plan).map((label, index) => {
    const progressItem = runProgress?.items[index] ?? progressByLabel.get(normalizePlannerTaskKey(label)) ?? null;
    return {
      label,
      status: progressItem?.status ?? 'pending'
    };
  });
}

function PlannerPlanChecklist({
  plan,
  runProgress,
  limit,
  showHiddenCount,
  showAssumptions,
  renderedMarkdown
}: {
  plan: PlannerPlan;
  runProgress?: RunProgressState | null;
  limit?: number;
  showHiddenCount?: boolean;
  showAssumptions?: boolean;
  renderedMarkdown?: string;
}) {
  const allTasks = useMemo(() => derivePlannerChecklistItems(plan, runProgress), [plan, runProgress]);
  const visibleTasks = typeof limit === 'number' ? allTasks.slice(0, limit) : allTasks;
  const hiddenTaskCount = Math.max(allTasks.length - visibleTasks.length, 0);
  const assumptionSummary = showAssumptions
    ? plan.structuredPlan?.assumptions.filter(Boolean).slice(0, 2).join(' · ') || null
    : null;

  return (
    <div className="planner-plan-preview">
      <ol className="planner-plan-preview-list" data-testid="planner-plan-preview-list">
        {visibleTasks.map((item, index) => (
          <li
            key={`${plan.id}-task-${index}`}
            className={cx('planner-plan-preview-item', `is-${item.status}`)}
            data-task-status={item.status}
          >
            <span className="planner-plan-preview-marker" aria-hidden="true" />
            <span className="planner-plan-preview-label">{`${index + 1}. ${item.label}`}</span>
          </li>
        ))}
      </ol>
      {showHiddenCount && hiddenTaskCount > 0 ? (
        <p className="planner-plan-preview-footnote">{`+ ${hiddenTaskCount} more task${hiddenTaskCount === 1 ? '' : 's'} in this draft`}</p>
      ) : null}
      {assumptionSummary ? (
        <p className="planner-plan-preview-footnote">{`Assumptions: ${assumptionSummary}`}</p>
      ) : null}
      {!plan.structuredPlan && renderedMarkdown?.trim().length ? (
        <MessageResponse className="planner-plan-markdown">
          {renderedMarkdown}
        </MessageResponse>
      ) : null}
    </div>
  );
}

function buildQuestionAnswerPayload(
  questionSet: PlannerQuestionSet,
  selectedOptions: Record<string, string>,
  otherAnswers: Record<string, string>
) {
  const answers: Record<string, PlannerQuestionAnswer> = {};

  for (const question of questionSet.questions) {
    const otherValue = otherAnswers[question.id]?.trim();
    if (otherValue) {
      answers[question.id] = { answers: [otherValue] };
      continue;
    }

    const selectedOptionId = selectedOptions[question.id];
    const option = question.options.find((candidate) => candidate.id === selectedOptionId);
    if (option) {
      answers[question.id] = { answers: [option.label] };
    }
  }

  return answers;
}

export function PlannerQuestionCard({
  questionSet,
  plannerPolicy,
  submitting,
  onSubmit,
  onCancelPlan
}: {
  questionSet: PlannerQuestionSet;
  plannerPolicy: ProviderPlannerPolicy | null;
  submitting: boolean;
  onSubmit: (answers: Record<string, PlannerQuestionAnswer>) => Promise<void>;
  onCancelPlan: () => Promise<void>;
}) {
  const [selectedOptions, setSelectedOptions] = useState<Record<string, string>>({});
  const [otherAnswers, setOtherAnswers] = useState<Record<string, string>>({});
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);

  useEffect(() => {
    setSelectedOptions({});
    setOtherAnswers({});
    setCurrentQuestionIndex(0);
  }, [questionSet.id]);

  const payload = useMemo(
    () => buildQuestionAnswerPayload(questionSet, selectedOptions, otherAnswers),
    [otherAnswers, questionSet, selectedOptions]
  );
  const allQuestionsAnswered = questionSet.questions.every((question) => Boolean(payload[question.id]?.answers?.[0]?.trim()));
  const currentQuestion = questionSet.questions[currentQuestionIndex];
  const isLastQuestion = currentQuestionIndex === questionSet.questions.length - 1;
  const currentQuestionAnswered = currentQuestion ? Boolean(payload[currentQuestion.id]?.answers?.[0]?.trim()) : false;
  const visibleOptions = currentQuestion?.options.slice(0, 3) ?? [];
  const currentSelection = currentQuestion ? selectedOptions[currentQuestion.id] ?? '' : '';
  const currentOtherValue = currentQuestion ? otherAnswers[currentQuestion.id] ?? '' : '';
  const otherSelected = Boolean(currentQuestion?.allowOther && currentSelection === PLANNER_OTHER_OPTION_ID);
  const showOtherField = Boolean(currentQuestion?.allowOther && (otherSelected || currentOtherValue.trim()));

  const selectOption = (questionId: string, optionId: string) => {
    setSelectedOptions((current) => ({ ...current, [questionId]: optionId }));
    setOtherAnswers((current) => ({ ...current, [questionId]: '' }));
  };

  const selectOther = (questionId: string) => {
    setSelectedOptions((current) => ({ ...current, [questionId]: PLANNER_OTHER_OPTION_ID }));
  };

  const dismissCurrentQuestion = () => {
    if (!currentQuestion) {
      return;
    }
    setSelectedOptions((current) => ({ ...current, [currentQuestion.id]: '' }));
    setOtherAnswers((current) => ({ ...current, [currentQuestion.id]: '' }));
  };

  const goToNextQuestion = () => {
    if (currentQuestionIndex < questionSet.questions.length - 1) {
      setCurrentQuestionIndex((value) => Math.min(value + 1, questionSet.questions.length - 1));
    }
  };

  const goNext = () => {
    if (currentQuestionIndex < questionSet.questions.length - 1) {
      goToNextQuestion();
      return;
    }
    if (allQuestionsAnswered) {
      void onSubmit(payload);
    }
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (submitting) {
        return;
      }

      if (currentQuestion && /^[1-4]$/u.test(event.key)) {
        const optionIndex = Number(event.key) - 1;
        const option = visibleOptions[optionIndex];
        if (option) {
          event.preventDefault();
          selectOption(currentQuestion.id, option.id);
          return;
        }
        if (optionIndex === 3 && currentQuestion.allowOther) {
          event.preventDefault();
          selectOther(currentQuestion.id);
        }
      }

      if (event.key === 'Enter' && currentQuestionAnswered) {
        event.preventDefault();
        goNext();
      }

      if (event.key === 'Escape') {
        event.preventDefault();
        dismissCurrentQuestion();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [allQuestionsAnswered, currentQuestion, currentQuestionAnswered, dismissCurrentQuestion, goNext, onSubmit, payload, questionSet.questions, submitting, visibleOptions]);

  if (!currentQuestion) {
    return null;
  }

  return (
    <div
      className="planner-inline-question"
      data-testid="planner-question-card"
    >
      <div className="planner-inline-question-header flex flex-wrap items-start justify-between gap-4">
        <div className="planner-inline-question-copy flex min-w-0 flex-1 flex-col gap-1">
          <h3 className="text-[18px] font-semibold tracking-[-0.01em] text-[color:var(--ui-text-title)]">{currentQuestion.question}</h3>
        </div>
        <div className="planner-inline-question-progress">
          <ActionButton
            className="planner-question-stepper-action"
            size="compact"
            tone="quiet"
            onClick={() => setCurrentQuestionIndex((value) => Math.max(value - 1, 0))}
            disabled={submitting || currentQuestionIndex === 0}
            aria-label="Previous question"
          >
            <ArrowLeftIcon />
          </ActionButton>
          <span>{`${currentQuestionIndex + 1} of ${questionSet.questions.length}`}</span>
          <ActionButton
            className="planner-question-stepper-action"
            size="compact"
            tone="quiet"
            onClick={goToNextQuestion}
            disabled={submitting || isLastQuestion || !currentQuestionAnswered}
            aria-label="Next question"
          >
            <ChevronRightIcon />
          </ActionButton>
        </div>
      </div>
      <div className="planner-inline-option-list">
        {visibleOptions.map((option, index) => {
          const selected = currentSelection === option.id && !currentOtherValue.trim();
          const recommended = currentQuestion.recommendedOptionId === option.id;
          return (
            <SelectableRowButton
              key={option.id}
              data-testid={`planner-option-${currentQuestion.id}-${option.id}`}
              selected={selected}
              className={cx('planner-option-row', selected && 'is-selected')}
              onClick={() => selectOption(currentQuestion.id, option.id)}
            >
              <span className="planner-option-number" aria-hidden="true">{`${index + 1}.`}</span>
              <span className="planner-option-copy">
                <span className="planner-option-line">
                  <span className="planner-option-primary">
                    {recommended ? `${option.label} (Recommended)` : option.label}
                  </span>
                </span>
                <span className="planner-option-secondary">{option.description}</span>
              </span>
            </SelectableRowButton>
          );
        })}
        {currentQuestion.allowOther ? (
          <SelectableRowButton
            data-testid={`planner-option-${currentQuestion.id}-other`}
            selected={otherSelected || Boolean(currentOtherValue.trim())}
            className={cx(
              'planner-option-row planner-option-row-other',
              (otherSelected || Boolean(currentOtherValue.trim())) && 'is-selected'
            )}
            onClick={() => selectOther(currentQuestion.id)}
          >
            <span className="planner-option-number" aria-hidden="true">{`${visibleOptions.length + 1}.`}</span>
            <span className="planner-option-copy">
              <span className="planner-option-line">
                <span className="planner-option-primary">No, and tell Vicode what to do differently</span>
              </span>
            </span>
          </SelectableRowButton>
        ) : null}
      </div>
      {showOtherField ? (
        <div className="planner-inline-other-panel">
          <TextInput
            data-testid={`planner-other-${currentQuestion.id}`}
            value={currentOtherValue}
            placeholder="Tell Vicode what to do differently"
            onChange={(event) => {
              const value = event.target.value;
              setOtherAnswers((current) => ({ ...current, [currentQuestion.id]: value }));
              if (value.trim()) {
                setSelectedOptions((current) => ({ ...current, [currentQuestion.id]: PLANNER_OTHER_OPTION_ID }));
              }
            }}
          />
        </div>
      ) : null}
      <div className="planner-inline-question-footer">
        <ActionButton
          className="planner-secondary-action"
          data-testid="planner-cancel-plan"
          size="compact"
          tone="quiet"
          onClick={() => void onCancelPlan()}
          disabled={submitting}
        >
          Cancel plan
        </ActionButton>
        <PrimaryButton
          className="planner-primary-action"
          data-testid="planner-submit-answers"
          size="compact"
          onClick={goNext}
          disabled={submitting || !currentQuestionAnswered || (!isLastQuestion && !currentQuestionAnswered) || (isLastQuestion && !allQuestionsAnswered)}
        >
          {submitting ? 'Planning…' : isLastQuestion ? 'Create plan' : 'Continue'}
        </PrimaryButton>
      </div>
    </div>
  );
}

export function PlannerPlanCard({
  plan,
  plannerPolicy,
  renderedMarkdown,
  approving,
  submitting,
  approveLabel,
  approvedCardText,
  onApprove,
  onRequestChanges,
  onCancelPlan
}: {
  plan: PlannerPlan;
  plannerPolicy: ProviderPlannerPolicy | null;
  renderedMarkdown: string;
  approving: boolean;
  submitting: boolean;
  approveLabel?: string;
  approvedCardText?: string;
  onApprove: () => Promise<void>;
  onRequestChanges: (instructions: string) => Promise<void>;
  onCancelPlan: () => Promise<void>;
}) {
  const [revisionOpen, setRevisionOpen] = useState(false);
  const [revisionInstructions, setRevisionInstructions] = useState('');

  useEffect(() => {
    setRevisionOpen(false);
    setRevisionInstructions('');
  }, [plan.id]);
  const displayTitle = formatPlannerDisplayTitle(plan.structuredPlan?.title, 'Proposed plan');
  const allTaskLabels = useMemo(() => derivePlannerTaskLabels(plan), [plan]);
  const taskCountLabel = `${allTaskLabels.length} planned item${allTaskLabels.length === 1 ? '' : 's'}`;

  return (
    <section className="planner-card planner-plan-card" data-testid="planner-plan-card">
      <div className="planner-card-header flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="planner-card-eyebrow text-[11px] font-semibold uppercase tracking-[0.12em] text-[color:var(--ui-text-subtle)]">
            {`Execution checklist · ${taskCountLabel}`}
          </p>
          <h3 className="mt-1 text-[15px] font-semibold tracking-[-0.01em] text-[color:var(--ui-text-title)]">{displayTitle}</h3>
        </div>
        <div className="planner-card-statuses flex items-center gap-2">
          <span className={`planner-status-text is-${plan.status}`}>{plan.status}</span>
        </div>
      </div>
      <PlannerPlanChecklist
        plan={plan}
        limit={PLANNER_PLAN_PREVIEW_LIMIT}
        showHiddenCount
        showAssumptions
        renderedMarkdown={renderedMarkdown}
      />
      {plan.status !== 'approved' && revisionOpen ? (
        <div className="planner-revision-panel">
          <label className="planner-other-field planner-revision-field flex flex-col gap-2">
            <span className="text-[12px] font-medium text-[color:var(--ui-text-muted)]">Tell the agent what to adjust</span>
            <TextArea
              data-testid="planner-revision-input"
              value={revisionInstructions}
              rows={3}
              placeholder="Example: Make the hero feel denser, keep the hacker theme subtle, and prioritize a single CTA."
              onChange={(event) => setRevisionInstructions(event.target.value)}
            />
          </label>
          <div className="planner-revision-actions mt-4 flex items-center justify-end gap-2">
            <ActionButton
              className="planner-secondary-action"
              size="compact"
              onClick={() => {
                setRevisionOpen(false);
                setRevisionInstructions('');
              }}
              disabled={submitting}
            >
              Close revision
            </ActionButton>
            <PrimaryButton
              className="planner-primary-action"
              data-testid="planner-send-revision"
              size="compact"
              onClick={() => void onRequestChanges(revisionInstructions)}
              disabled={submitting || !revisionInstructions.trim()}
            >
              {submitting ? 'Replanning…' : 'Send revision'}
            </PrimaryButton>
          </div>
        </div>
      ) : null}
      <div className="planner-card-actions flex flex-wrap items-start justify-between gap-4 border-t border-[color:var(--ui-border-soft)] pt-4">
        <p className="max-w-[560px] text-[13px] leading-6 text-[color:var(--ui-text-muted)]">
          {plan.status === 'approved'
            ? (approvedCardText ?? 'This plan has already been approved for execution.')
            : 'Accept to start execution. The agent will work through each item and run verification before the final response.'}
        </p>
        <div className="planner-action-group flex items-center gap-2">
          {plan.status !== 'approved' ? (
            <ActionButton
              className="planner-secondary-action"
              data-testid="planner-cancel-plan"
              size="compact"
              onClick={() => void onCancelPlan()}
              disabled={submitting || approving}
            >
              Cancel plan
            </ActionButton>
          ) : null}
          {plan.status !== 'approved' ? (
            <ActionButton
              className="planner-secondary-action"
              data-testid="planner-request-changes"
              size="compact"
              onClick={() => setRevisionOpen((current) => !current)}
              disabled={submitting || approving}
            >
              {revisionOpen ? 'Close revision' : 'Not yet'}
            </ActionButton>
          ) : null}
          <PrimaryButton
            className="planner-primary-action"
            data-testid="planner-approve-button"
            size="compact"
            leadingIcon={<CheckIcon />}
            onClick={() => void onApprove()}
            disabled={approving || submitting || plan.status === 'approved'}
          >
            {approving ? 'Starting…' : plan.status === 'approved' ? 'Approved' : (approveLabel ?? 'Accept and continue')}
          </PrimaryButton>
        </div>
      </div>
    </section>
  );
}

export function PlannerPlanStatusRow({
  plan,
  runProgress,
  approvedStatusText
}: {
  plan: PlannerPlan;
  runProgress?: RunProgressState | null;
  approvedStatusText?: string;
}) {
  const title = formatPlannerDisplayTitle(plan.structuredPlan?.title, 'Planner status');
  const tasks = useMemo(() => derivePlannerChecklistItems(plan, runProgress), [plan, runProgress]);
  const completedCount = tasks.filter((item) => item.status === 'completed').length;
  const progressLabel = tasks.length > 0 ? `${completedCount}/${tasks.length} complete` : null;
  const statusLabel =
    plan.status === 'approved'
      ? (approvedStatusText ?? 'Approved and moved into execution.')
      : plan.status === 'superseded'
        ? 'Replaced by a newer planner draft.'
        : 'Planner draft is ready.';

  return (
    <div className="planner-status-row" data-testid="planner-plan-status-row">
      <div className="planner-status-row-summary">
        <div className="planner-status-row-copy">
          <p className="planner-status-row-eyebrow">Planner</p>
          <div className="planner-status-row-title">{title}</div>
          <p className="planner-status-row-text">{progressLabel ? `${statusLabel} ${progressLabel}.` : statusLabel}</p>
        </div>
        <span className={`planner-status-text planner-status-row-state is-${plan.status}`}>{plan.status}</span>
      </div>
      <PlannerPlanChecklist plan={plan} runProgress={runProgress} />
    </div>
  );
}

export function PlannerModeBadge({ active }: { active: boolean }) {
  return (
    <span
      className={cx(
        active ? 'planner-mode-badge planner-mode-badge-active' : 'planner-mode-badge',
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.08em]',
        active ? 'border-[color:var(--ui-border-strong)] bg-[color:var(--ui-alpha-08)] text-[color:var(--ui-text-title)]' : 'border-[color:var(--ui-border)] bg-[color:var(--ui-alpha-04)] text-[color:var(--ui-text-muted)]'
      )}
    >
      <TaskIcon />
      <span>Plan</span>
    </span>
  );
}
