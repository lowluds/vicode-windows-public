import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import type { RepoInspectionResult } from './repo-inspection';

export type WorkspaceBootstrapFileKind = 'agents' | 'user' | 'soul' | 'memory' | 'daily_note';

export interface WorkspaceBootstrapAnswers {
  projectIntent?: string;
  optimizationPriority?: string;
  communicationStyle?: string;
  approvalBoundary?: string;
  repoConstraints?: string;
  wantsSoul?: boolean;
  detailLevel?: string;
  planningStyle?: string;
  deliveryStyle?: string;
  riskPosture?: string;
  testingExpectation?: string;
  dependencyPolicy?: string;
  refactorPosture?: string;
  summaryStyle?: string;
  changeStyle?: string;
  agentAssertiveness?: string;
  agentFormality?: string;
  durablePreferences?: string[];
  durableDecisions?: string[];
  todayFocus?: string;
  recentDecisions?: string[];
  openQuestions?: string[];
  followUps?: string[];
}

export interface WorkspaceTemplateDraft {
  kind: WorkspaceBootstrapFileKind;
  fileName: string;
  relativePath: string;
  content: string;
}

export interface WorkspaceTemplateDraftInput {
  inspection: RepoInspectionResult;
  answers: WorkspaceBootstrapAnswers;
  includeSoul?: boolean;
  includeDailyNote?: boolean;
  date?: Date;
}

const TEMPLATE_FILES: Record<WorkspaceBootstrapFileKind, string> = {
  agents: 'AGENTS.md',
  user: 'USER.md',
  soul: 'SOUL.md',
  memory: 'MEMORY.md',
  daily_note: 'daily-note.md'
};

function uniqueNonEmpty(values: Array<string | null | undefined>) {
  return [...new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))];
}

function pad(values: string[], size: number, fallback: string) {
  const output = [...values];
  while (output.length < size) {
    output.push(fallback);
  }
  return output.slice(0, size);
}

function resolveTemplateRoot(explicitRoot?: string) {
  if (explicitRoot) {
    return explicitRoot;
  }

  const moduleRoot = resolve(fileURLToPath(new URL('../../../resources/workspace-templates', import.meta.url)));
  const candidates = [
    moduleRoot,
    join(process.cwd(), 'resources', 'workspace-templates'),
    join(process.resourcesPath ?? '', 'resources', 'workspace-templates'),
    join(process.resourcesPath ?? '', 'workspace-templates')
  ];

  return candidates.find((candidate) => candidate && existsSync(candidate)) ?? moduleRoot;
}

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function stripUnresolvedLines(template: string, replacements: Record<string, string>) {
  return template
    .split(/\r?\n/u)
    .map((line) => line.replace(/\{\{([A-Z0-9_]+)\}\}/gu, (_match, key) => replacements[key] ?? '__VICODE_MISSING__'))
    .filter((line) => !line.includes('__VICODE_MISSING__'))
    .map((line) => line.replace(/[ \t]+$/u, ''))
    .join('\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trim();
}

export class WorkspaceTemplateService {
  private readonly templateRoot: string;

  constructor(options: { templateRoot?: string } = {}) {
    this.templateRoot = resolveTemplateRoot(options.templateRoot);
  }

  renderDrafts(input: WorkspaceTemplateDraftInput): WorkspaceTemplateDraft[] {
    const replacements = this.buildReplacements(input);
    const drafts: WorkspaceTemplateDraft[] = [
      this.renderTemplate('agents', replacements),
      this.renderTemplate('user', replacements),
      this.renderTemplate('memory', replacements)
    ];

    if (input.includeSoul ?? input.answers.wantsSoul ?? false) {
      drafts.push(this.renderTemplate('soul', replacements));
    }

    if (input.includeDailyNote) {
      drafts.push(this.renderTemplate('daily_note', replacements));
    }

    return drafts;
  }

  private renderTemplate(kind: WorkspaceBootstrapFileKind, replacements: Record<string, string>): WorkspaceTemplateDraft {
    const templateFileName = TEMPLATE_FILES[kind];
    const templatePath = join(this.templateRoot, templateFileName);
    const content = stripUnresolvedLines(readFileSync(templatePath, 'utf8'), replacements);

    return {
      kind,
      fileName: kind === 'daily_note' ? `${replacements.TODAY_DATE}.md` : templateFileName,
      relativePath: kind === 'daily_note' ? join('memory', `${replacements.TODAY_DATE}.md`) : templateFileName,
      content
    };
  }

  private buildReplacements(input: WorkspaceTemplateDraftInput) {
    const date = input.date ?? new Date();
    const inspection = input.inspection;
    const answers = input.answers;
    const constraints = pad(
      uniqueNonEmpty([inspection.constraints[0], inspection.constraints[1], answers.repoConstraints]),
      2,
      'No additional durable constraint recorded yet.'
    );
    const architectureFacts = pad(
      uniqueNonEmpty(inspection.architectureFacts),
      3,
      'No additional durable architecture fact recorded yet.'
    );
    const durablePreferences = pad(
      uniqueNonEmpty([
        answers.deliveryStyle ? `Preferred delivery style: ${answers.deliveryStyle}.` : null,
        answers.testingExpectation ? `Testing expectation: ${answers.testingExpectation}.` : null,
        ...(answers.durablePreferences ?? [])
      ]),
      3,
      'No additional durable preference recorded yet.'
    );
    const durableDecisions = pad(
      uniqueNonEmpty([
        answers.projectIntent ? `Project focus: ${answers.projectIntent}.` : null,
        ...(answers.durableDecisions ?? [])
      ]),
      2,
      'No durable decision recorded yet.'
    );
    const recentDecisions = pad(answers.recentDecisions ?? [], 2, 'No recent decision recorded yet.');
    const openQuestions = pad(answers.openQuestions ?? [], 2, 'No open question recorded yet.');
    const followUps = pad(answers.followUps ?? [], 2, 'No follow-up recorded yet.');

    return {
      REPO_NAME: inspection.repoName,
      REPO_PURPOSE: answers.projectIntent?.trim() || inspection.repoPurpose,
      REPO_STACK: inspection.repoStack,
      REPO_INSTALL_COMMAND: inspection.installCommand,
      REPO_BUILD_COMMAND: inspection.buildCommand ?? 'Not yet defined',
      REPO_TEST_COMMAND: inspection.testCommand ?? 'Not yet defined',
      REPO_LINT_COMMAND: inspection.lintCommand ?? 'Not yet defined',
      REPO_PLATFORM_FOCUS: inspection.platformFocus,
      REPO_PACKAGE_MANAGER: inspection.packageManager,
      REPO_CONSTRAINT_1: constraints[0] ?? 'No additional durable constraint recorded yet.',
      REPO_CONSTRAINT_2: constraints[1] ?? 'No additional durable constraint recorded yet.',
      REPO_ARCHITECTURE_FACT_1: architectureFacts[0] ?? 'No additional durable architecture fact recorded yet.',
      REPO_ARCHITECTURE_FACT_2: architectureFacts[1] ?? 'No additional durable architecture fact recorded yet.',
      REPO_ARCHITECTURE_FACT_3: architectureFacts[2] ?? 'No additional durable architecture fact recorded yet.',
      USER_OPTIMIZATION_PRIORITY: answers.optimizationPriority?.trim() || 'correctness and momentum',
      USER_CHANGE_STYLE: answers.changeStyle?.trim() || 'small, reviewable',
      USER_COMMUNICATION_STYLE: answers.communicationStyle?.trim() || 'direct and concise',
      USER_APPROVAL_BOUNDARY: answers.approvalBoundary?.trim() || 'risky actions, destructive changes, or large refactors',
      USER_SUMMARY_STYLE: answers.summaryStyle?.trim() || 'short and implementation-focused',
      USER_DETAIL_LEVEL: answers.detailLevel?.trim() || 'concise by default, deeper when needed',
      USER_PLANNING_STYLE: answers.planningStyle?.trim() || 'implementation first once direction is clear',
      USER_DELIVERY_STYLE: answers.deliveryStyle?.trim() || 'explain what changed and why',
      USER_RISK_POSTURE: answers.riskPosture?.trim() || 'conservative about risky or destructive actions',
      USER_TESTING_EXPECTATION: answers.testingExpectation?.trim() || 'run relevant checks when behavior changes',
      USER_DEPENDENCY_POLICY: answers.dependencyPolicy?.trim() || 'avoid new dependencies unless clearly justified',
      USER_REFACTOR_POSTURE: answers.refactorPosture?.trim() || 'prefer targeted changes over broad rewrites',
      USER_REPO_CONSTRAINTS: answers.repoConstraints?.trim() || 'No additional repo-specific rule confirmed yet.',
      USER_DURABLE_PREFERENCE_1: durablePreferences[0] ?? 'No additional durable preference recorded yet.',
      USER_DURABLE_PREFERENCE_2: durablePreferences[1] ?? 'No additional durable preference recorded yet.',
      USER_DURABLE_PREFERENCE_3: durablePreferences[2] ?? 'No additional durable preference recorded yet.',
      USER_DURABLE_DECISION_1: durableDecisions[0] ?? 'No durable decision recorded yet.',
      USER_DURABLE_DECISION_2: durableDecisions[1] ?? 'No durable decision recorded yet.',
      USER_AGENT_ASSERTIVENESS: answers.agentAssertiveness?.trim() || 'balanced and pragmatic',
      USER_AGENT_FORMALITY: answers.agentFormality?.trim() || 'calm and professional',
      TODAY_DATE: isoDate(date),
      TODAY_FOCUS: answers.todayFocus?.trim() || 'Capture the current work focus once the workspace bootstrap is approved.',
      RECENT_DECISION_1: recentDecisions[0] ?? 'No recent decision recorded yet.',
      RECENT_DECISION_2: recentDecisions[1] ?? 'No recent decision recorded yet.',
      OPEN_QUESTION_1: openQuestions[0] ?? 'No open question recorded yet.',
      OPEN_QUESTION_2: openQuestions[1] ?? 'No open question recorded yet.',
      FOLLOW_UP_1: followUps[0] ?? 'No follow-up recorded yet.',
      FOLLOW_UP_2: followUps[1] ?? 'No follow-up recorded yet.'
    };
  }
}
