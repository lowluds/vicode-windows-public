import type { ThreadTurn } from './domain';
import { stripNonMutatingTaskDirectives, type HarnessTaskContract } from './harness-task-contract';
import type { HarnessTaskPlanPhase, HarnessTaskPlanStepStatus } from './harness-task-plan';

export type ResolvedConversationTaskTrigger = 'direct_task' | 'inferred_proceed';
export type ResolvedConversationTaskPhase = HarnessTaskPlanPhase | 'verify';
export type ConversationTaskExecutionPolicy =
  | 'auto_execute'
  | 'ask_clarifying_question'
  | 'plan_mode_wait'
  | 'approval_required'
  | 'scope_replan';
export type ResolvedConversationTaskConfidence = 'low' | 'medium' | 'high';
export type ResolvedConversationTaskToolGroup =
  | 'workspace_read'
  | 'workspace_write'
  | 'web_research'
  | 'command'
  | 'verification';

export interface ResolvedConversationTaskSlice {
  id: string;
  title: string;
  status: HarnessTaskPlanStepStatus;
  detail: string | null;
  rationale: string;
  expectedOutcome: string;
  sourceTurnIds: string[];
}

export interface ResolvedConversationTaskPacket {
  trigger: ResolvedConversationTaskTrigger;
  phase: ResolvedConversationTaskPhase;
  executionPolicy: ConversationTaskExecutionPolicy;
  confidence: ResolvedConversationTaskConfidence;
  objective: string;
  sourceTurnIds: string[];
  decisionsUsed: string[];
  /**
   * Compatibility alias for the first inferred-task slice. New code should read decisionsUsed.
   */
  decisions: string[];
  rejectedOptions: string[];
  constraints: string[];
  nonGoals: string[];
  acceptanceCriteria: string[];
  expectedToolGroups: ResolvedConversationTaskToolGroup[];
  slices: ResolvedConversationTaskSlice[];
  verification: string[];
  clarificationQuestion?: string;
  riskReason?: string;
}

export interface ResolveConversationTaskPacketInput {
  prompt: string;
  turns: ThreadTurn[];
  taskContract: HarnessTaskContract;
}

const MAX_CONTEXT_TURNS = 8;
const MAX_TEXT_LENGTH = 500;
const MAX_SHORT_LIST_ITEMS = 8;

const PROCEED_PATTERN =
  /\b(?:build it|create it|do it|execute (?:it|the plan|this plan)|go ahead|implement (?:it|this|the plan|this plan)|let'?s do it|make it|ship it|start(?: on)? (?:it|this|the plan|the task))\b/iu;
const OBJECTIVE_PATTERN =
  /\b(?:add-?on|api|app|application|backend|calculator|component|crawler|curseforge|dashboard|database|feature|frontend|landing page|lua|page|plugin|rag|research|scrap(?:e|er|ing)?|script|seo|tool|website|world of warcraft|wow)\b/iu;
const DECISION_PATTERN =
  /\b(?:backend|database|electron|framework|frontend|library|model|node|provider|react|rag|stack|svelte|tailwind|tooling|typescript|use|using|vue)\b/iu;
const ACCEPTANCE_PATTERN =
  /\b(?:accessible|avoid|do not|don'?t|ensure|include|keep|keyboard|make sure|must|needs? to|responsive|should|support|test|verify|without|works?)\b/iu;
const CONSTRAINT_PATTERN =
  /\b(?:avoid|do not|don'?t|keep|limit|must|non-mutating|only|permission|read-only|simple|without)\b/iu;
const WEB_RESEARCH_PATTERN =
  /\b(?:citations?|crawl(?:ing)?|online|scrap(?:e|er|ing)?|search\s+(?:the\s+)?(?:web|online|sources?)|web\s+(?:research|search|sources?)|external\s+(?:facts?|references?|research|sources?)|current\s+(?:docs?|facts?|information|sources?)|latest|seo(?:\s+(?:audit|keywords?|research|sources?))?|research\s+(?:online|the\s+web|competitors?|keywords?|seo|sources?))\b/iu;
const WRITE_PATTERN =
  /\b(?:add|apply|build|change|create|delete|edit|fix|implement|make|modify|patch|remove|replace|rewrite|save|update|write)\b/iu;
const COMMAND_PATTERN = /\b(?:command|npm|pnpm|script|shell|terminal|yarn)\b/iu;
const VERIFY_PATTERN = /\b(?:audit|build|check|lint|smoke|test|typecheck|verify|vitest)\b/iu;
const ACTION_OBJECTIVE_PATTERN =
  /^(?:add|apply|build|change|create|edit|fix|implement|make|modify|patch|replace|rewrite|save|update|write)\b/iu;
const DIRECT_TASK_PATTERN =
  /^(?:(?:please\s+)?(?:add|apply|build|change|create|edit|fix|implement|make|modify|patch|replace|rewrite|save|update|write)|(?:can you|could you|please)\s+(?:add|apply|build|change|create|edit|fix|implement|make|modify|patch|replace|rewrite|save|update|write))\b/iu;
const OBJECTIVE_LEAD_IN_PATTERN =
  /^(?:a good plan is:?\s*|can we\s+|could we\s+|goal:?\s*|i\s+(?:am looking for|need|want|would like)\s+|the goal is\s+|we\s+(?:need|want|would like)\s+)/iu;
const PROCEED_LEAD_IN_PATTERN =
  /^(?:ok(?:ay)?[, ]*)?(?:go ahead and\s+|go ahead[, ]*|please\s+|let'?s\s+|now\s+)?/iu;
const REJECTED_OPTION_PATTERN =
  /\b(?:avoid|do not|don'?t|instead of|not use|reject|rejected|skip|without)\b/iu;
const NON_GOAL_PATTERN =
  /\b(?:do not|don'?t|not trying to|not use|only|out of scope|without)\b/iu;
const TRANSIENT_CONVERSATION_DIRECTIVE_PATTERN =
  /\b(?:(?:keep\s+)?(?:this\s+)?(?:as\s+)?(?:still\s+)?(?:chat|conversation|discussion|brainstorming)[-\s]+only|still\s+(?:chat|conversation|discussion|brainstorming)[-\s]+only)\b/giu;
const NEGATED_WEB_RESEARCH_PATTERN =
  /\b(?:do\s+not|don['’]?t|no|not|without)\b.{0,80}\b(?:citations?|online|research|search|sources?|web)\b|\b(?:citations?|online|research|search|sources?|web)\b.{0,80}\b(?:is|are)?\s*(?:not\s+)?(?:needed|necessary|required)\b/iu;
const NEGATED_COMMAND_PATTERN =
  /\b(?:do\s+not|don['’]?t|no|not|without)\b.{0,80}\b(?:commands?|npm|pnpm|script|shell|terminal|yarn)\b|\b(?:commands?|npm|pnpm|script|shell|terminal|yarn)\b.{0,80}\b(?:is|are)?\s*(?:not\s+)?(?:needed|necessary|required)\b/iu;
const RISKY_ACTION_PATTERN =
  /\b(?:delete|destructive|drop|migration|remove|reset|schema change|wipe)\b/iu;
const SCOPE_REPLAN_PATTERN =
  /\b(?:change direction|change the plan|different direction|different plan|new direction|new plan|pivot|replan|instead[,:\s]+(?:build|create|implement|make|use))\b/iu;

function normalizeText(value: string): string {
  return value.trim().replace(/\s+/gu, ' ');
}

function clipText(value: string, maxLength = MAX_TEXT_LENGTH): string {
  const normalized = normalizeText(value);
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 1).trimEnd()}...`;
}

function sentenceCase(value: string): string {
  return value.length === 0 ? value : `${value[0].toUpperCase()}${value.slice(1)}`;
}

function splitSentences(value: string): string[] {
  const normalized = normalizeText(value);
  if (!normalized) {
    return [];
  }

  return (
    normalized
      .match(/[^.!?]+[.!?]?/gu)
      ?.map((sentence) => normalizeText(sentence))
      .filter(Boolean) ?? []
  );
}

function dedupe(items: string[], maxItems = MAX_SHORT_LIST_ITEMS): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const item of items) {
    const normalized = clipText(item);
    const key = normalized.toLocaleLowerCase();
    if (!normalized || seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(normalized);
    if (result.length >= maxItems) {
      break;
    }
  }

  return result;
}

function getRecentConversationTurns(turns: ThreadTurn[]): ThreadTurn[] {
  return turns
    .filter(
      (turn) =>
        (turn.role === 'user' || turn.role === 'assistant') && normalizeText(turn.content).length > 0
    )
    .slice(-MAX_CONTEXT_TURNS);
}

function getSentences(turns: ThreadTurn[]): string[] {
  return turns.flatMap((turn) => splitSentences(turn.content));
}

function extractSentences(turns: ThreadTurn[], pattern: RegExp): string[] {
  return dedupe(getSentences(turns).filter((sentence) => pattern.test(sentence)));
}

function stripTransientConversationDirectives(value: string): string {
  return normalizeText(
    stripNonMutatingTaskDirectives(value)
      .replace(TRANSIENT_CONVERSATION_DIRECTIVE_PATTERN, ' ')
  );
}

function extractTaskSentences(turns: ThreadTurn[], pattern: RegExp): string[] {
  return dedupe(
    getSentences(turns)
      .map(stripTransientConversationDirectives)
      .filter((sentence) => sentence.length > 0 && pattern.test(sentence))
  );
}

function hasPositiveSentenceIntent(value: string, positivePattern: RegExp, negatedPattern: RegExp): boolean {
  return splitSentences(value).some((sentence) => {
    const cleaned = stripTransientConversationDirectives(sentence);
    return cleaned.length > 0 && positivePattern.test(cleaned) && !negatedPattern.test(cleaned);
  });
}

function normalizeObjectiveCandidate(sentence: string): string {
  const cleaned = normalizeText(sentence)
    .replace(OBJECTIVE_LEAD_IN_PATTERN, '')
    .replace(PROCEED_LEAD_IN_PATTERN, '')
    .replace(/\s*\.$/u, '.')
    .trim();

  if (!cleaned) {
    return '';
  }

  if (ACTION_OBJECTIVE_PATTERN.test(cleaned)) {
    return sentenceCase(cleaned);
  }

  return `Implement ${cleaned[0].toLocaleLowerCase()}${cleaned.slice(1)}`;
}

function resolveObjective(input: {
  trigger: ResolvedConversationTaskTrigger;
  prompt: string;
  taskContract: HarnessTaskContract;
  contextTurns: ThreadTurn[];
}): string {
  if (input.trigger === 'direct_task') {
    return clipText(normalizeObjectiveCandidate(input.prompt));
  }

  if (input.trigger === 'inferred_proceed' && input.contextTurns.length > 0) {
    const promptCandidate = OBJECTIVE_PATTERN.test(input.prompt)
      ? normalizeObjectiveCandidate(input.prompt)
      : '';
    const userSentences = getSentences(input.contextTurns.filter((turn) => turn.role === 'user'));
    const allSentences = getSentences(input.contextTurns);
    const candidate =
      promptCandidate
      || userSentences.find((sentence) => OBJECTIVE_PATTERN.test(sentence))
      || allSentences.find((sentence) => OBJECTIVE_PATTERN.test(sentence));

    if (candidate) {
      return clipText(normalizeObjectiveCandidate(candidate));
    }
  }

  return clipText(input.taskContract.objective || input.prompt);
}

function hasUsableObjective(input: {
  prompt: string;
  contextTurns: ThreadTurn[];
  trigger: ResolvedConversationTaskTrigger;
}): boolean {
  if (input.trigger === 'direct_task') {
    return true;
  }

  const combinedText = normalizeText([
    input.prompt,
    ...input.contextTurns.map((turn) => turn.content)
  ].join(' '));
  return OBJECTIVE_PATTERN.test(combinedText) || ACTION_OBJECTIVE_PATTERN.test(input.prompt);
}

function deriveAcceptanceCriteria(input: {
  objective: string;
  contextTurns: ThreadTurn[];
  prompt: string;
  taskContract: HarnessTaskContract;
}): string[] {
  const explicitCriteria = extractTaskSentences(input.contextTurns, ACCEPTANCE_PATTERN);
  if (explicitCriteria.length > 0) {
    return explicitCriteria;
  }

  const defaults = [`${input.objective.replace(/\s*\.$/u, '')} is implemented.`];
  if (input.taskContract.verificationPolicy !== 'none' || VERIFY_PATTERN.test(input.prompt)) {
    defaults.push('Focused verification passes.');
  }

  return dedupe(defaults, 4);
}

function deriveExpectedToolGroups(input: {
  prompt: string;
  contextTurns: ThreadTurn[];
  taskContract: HarnessTaskContract;
}): ResolvedConversationTaskToolGroup[] {
  const userTaskText = normalizeText(
    [
      input.prompt,
      ...input.contextTurns
        .filter((turn) => turn.role === 'user')
        .map((turn) => stripTransientConversationDirectives(turn.content))
    ].join(' ')
  );
  const groups = new Set<ResolvedConversationTaskToolGroup>(['workspace_read']);
  const expectsWrite =
    input.taskContract.expectedMutations !== 'none' || WRITE_PATTERN.test(userTaskText);

  if (expectsWrite) {
    groups.add('workspace_write');
  }

  if (hasPositiveSentenceIntent(userTaskText, WEB_RESEARCH_PATTERN, NEGATED_WEB_RESEARCH_PATTERN)) {
    groups.add('web_research');
  }

  if (hasPositiveSentenceIntent(userTaskText, COMMAND_PATTERN, NEGATED_COMMAND_PATTERN)) {
    groups.add('command');
  }

  if (
    input.taskContract.verificationPolicy !== 'none'
    || VERIFY_PATTERN.test(userTaskText)
    || expectsWrite
  ) {
    groups.add('verification');
  }

  return ['workspace_read', 'workspace_write', 'web_research', 'command', 'verification'].filter(
    (group) => groups.has(group)
  );
}

function createDefaultSlices(sourceTurnIds: string[]): ResolvedConversationTaskSlice[] {
  return [
    {
      id: 'inspect-context',
      title: 'Inspect resolved conversation context',
      status: 'pending',
      detail: 'Review the prior discussion, constraints, and acceptance criteria before editing.',
      rationale: 'Ground the task in the conversation instead of relying only on the latest prompt.',
      expectedOutcome: 'Relevant decisions, constraints, and acceptance criteria are available for execution.',
      sourceTurnIds
    },
    {
      id: 'implement-core',
      title: 'Implement core workspace changes',
      status: 'pending',
      detail: 'Apply the resolved objective in the workspace.',
      rationale: 'Make the smallest coherent change that satisfies the resolved objective.',
      expectedOutcome: 'The requested workspace behavior or artifact exists.',
      sourceTurnIds
    },
    {
      id: 'refine-edge-cases',
      title: 'Refine UX and edge cases',
      status: 'pending',
      detail: 'Honor captured decisions and constraints before verification.',
      rationale: 'Use the captured context to avoid ignoring user preferences from earlier turns.',
      expectedOutcome: 'Captured constraints and non-goals are reflected in the result.',
      sourceTurnIds
    },
    {
      id: 'verify-result',
      title: 'Run focused verification',
      status: 'pending',
      detail: 'Run the smallest checks that prove the task outcome.',
      rationale: 'Match verification cost to the risk and mutation surface.',
      expectedOutcome: 'Focused checks pass or the remaining risk is explicit.',
      sourceTurnIds
    }
  ];
}

function deriveVerification(input: {
  objective: string;
  expectedToolGroups: ResolvedConversationTaskToolGroup[];
  taskContract: HarnessTaskContract;
}): string[] {
  if (input.taskContract.verificationPolicy === 'none' && !input.expectedToolGroups.includes('verification')) {
    return [];
  }

  return dedupe([
    `Verify that ${input.objective.replace(/\s*\.$/u, '')} is complete.`,
    'Run the smallest deterministic check that covers the changed surface.'
  ], 4);
}

function deriveExecutionPolicy(input: {
  taskContract: HarnessTaskContract;
  hasObjective: boolean;
  combinedText: string;
  prompt: string;
  contextTurnCount: number;
}): ConversationTaskExecutionPolicy {
  if (!input.hasObjective) {
    return 'ask_clarifying_question';
  }

  if (
    input.taskContract.taskIntentSource === 'composer_plan_mode'
    || input.taskContract.conversationPhase === 'task_plan'
  ) {
    return 'plan_mode_wait';
  }

  if (input.taskContract.riskLevel === 'high' || RISKY_ACTION_PATTERN.test(input.combinedText)) {
    return 'approval_required';
  }

  if (input.contextTurnCount > 0 && SCOPE_REPLAN_PATTERN.test(input.prompt)) {
    return 'scope_replan';
  }

  return 'auto_execute';
}

function deriveConfidence(input: {
  executionPolicy: ConversationTaskExecutionPolicy;
  trigger: ResolvedConversationTaskTrigger;
  hasObjective: boolean;
  contextTurns: ThreadTurn[];
}): ResolvedConversationTaskConfidence {
  if (input.executionPolicy === 'ask_clarifying_question' || !input.hasObjective) {
    return 'low';
  }

  if (input.trigger === 'direct_task' || input.contextTurns.length > 0) {
    return 'high';
  }

  return 'medium';
}

function buildClarificationQuestion(policy: ConversationTaskExecutionPolicy): string | undefined {
  return policy === 'ask_clarifying_question'
    ? 'What should I implement, and what outcome should I verify?'
    : undefined;
}

function buildRiskReason(input: {
  policy: ConversationTaskExecutionPolicy;
  taskContract: HarnessTaskContract;
}): string | undefined {
  if (input.policy !== 'approval_required') {
    return undefined;
  }

  return input.taskContract.riskLevel === 'high'
    ? 'This task may have destructive or elevated workspace risk and needs approval before execution.'
    : 'This task needs approval before execution.';
}

export function resolveConversationTaskPacket({
  prompt,
  turns,
  taskContract
}: ResolveConversationTaskPacketInput): ResolvedConversationTaskPacket | null {
  const normalizedPrompt = normalizeText(prompt);
  if (!normalizedPrompt) {
    return null;
  }

  const contextTurns = getRecentConversationTurns(turns);
  const hasProceedIntent = PROCEED_PATTERN.test(normalizedPrompt);
  const hasDirectTaskIntent =
    !hasProceedIntent
    && taskContract.conversationPhase === 'ready_to_task'
    && DIRECT_TASK_PATTERN.test(normalizedPrompt);
  if (!hasProceedIntent && !hasDirectTaskIntent) {
    return null;
  }

  const trigger: ResolvedConversationTaskTrigger = hasDirectTaskIntent
    ? 'direct_task'
    : 'inferred_proceed';
  const sourceTurnIds = contextTurns.map((turn) => turn.id);
  const combinedText = normalizeText([
    normalizedPrompt,
    ...contextTurns.map((turn) => turn.content)
  ].join(' '));
  const hasObjective = hasUsableObjective({
    prompt: normalizedPrompt,
    contextTurns,
    trigger
  });
  const executionPolicy = deriveExecutionPolicy({
    taskContract,
    hasObjective,
    combinedText,
    prompt: normalizedPrompt,
    contextTurnCount: contextTurns.length
  });
  const objective = resolveObjective({
    trigger,
    prompt: normalizedPrompt,
    taskContract,
    contextTurns
  });
  const expectedToolGroups =
    executionPolicy === 'ask_clarifying_question'
      ? (['workspace_read'] satisfies ResolvedConversationTaskToolGroup[])
      : deriveExpectedToolGroups({
          prompt: normalizedPrompt,
          contextTurns,
          taskContract
        });
  const userContextTurns = contextTurns.filter((turn) => turn.role === 'user');
  const decisionsUsed = extractTaskSentences(userContextTurns, DECISION_PATTERN);
  const rejectedOptions = extractTaskSentences(userContextTurns, REJECTED_OPTION_PATTERN);
  const nonGoals = extractTaskSentences(userContextTurns, NON_GOAL_PATTERN);
  const verification = deriveVerification({
    objective,
    expectedToolGroups,
    taskContract
  });

  return {
    trigger,
    phase: taskContract.conversationPhase === 'task_plan' ? 'task_plan' : 'ready_to_task',
    executionPolicy,
    confidence: deriveConfidence({
      executionPolicy,
      trigger,
      hasObjective,
      contextTurns
    }),
    objective,
    sourceTurnIds,
    decisionsUsed,
    decisions: decisionsUsed,
    rejectedOptions,
    constraints: extractTaskSentences(userContextTurns, CONSTRAINT_PATTERN),
    nonGoals,
    acceptanceCriteria: deriveAcceptanceCriteria({
      objective,
      contextTurns,
      prompt: normalizedPrompt,
      taskContract
    }),
    expectedToolGroups,
    slices: createDefaultSlices(sourceTurnIds),
    verification,
    clarificationQuestion: buildClarificationQuestion(executionPolicy),
    riskReason: buildRiskReason({
      policy: executionPolicy,
      taskContract
    })
  };
}
