import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Project } from '../../shared/domain';
import type { RepoInspectionResult } from './repo-inspection';
import { RepoInspectionService } from './repo-inspection';
import {
  WorkspaceTemplateService,
  type WorkspaceBootstrapAnswers,
  type WorkspaceBootstrapFileKind,
  type WorkspaceTemplateDraft
} from './workspace-template-service';

export interface WorkspaceBootstrapQuestion {
  id: string;
  prompt: string;
  targetFiles: string[];
  optional?: boolean;
}

export interface WorkspaceBootstrapStatus {
  eligible: boolean;
  reason: string | null;
  folderPath: string | null;
  existingFiles: string[];
  missingFiles: string[];
  needsBootstrap: boolean;
  dismissed: boolean;
  suggestionEligible: boolean;
}

export interface WorkspaceBootstrapDraftBundle {
  status: WorkspaceBootstrapStatus;
  inspection: RepoInspectionResult;
  drafts: WorkspaceTemplateDraft[];
}

const REQUIRED_CONTRACT_FILES = ['AGENTS.md'] as const;
const OPTIONAL_CONTRACT_FILES = ['SOUL.md'] as const;

function draftKindToFileName(kind: WorkspaceBootstrapFileKind, date: Date) {
  switch (kind) {
    case 'agents':
      return 'AGENTS.md';
    case 'user':
      return 'USER.md';
    case 'soul':
      return 'SOUL.md';
    case 'memory':
      return 'MEMORY.md';
    case 'daily_note':
      return join('memory', `${date.toISOString().slice(0, 10)}.md`);
  }
}

export class WorkspaceBootstrapService {
  constructor(
    private readonly repoInspection = new RepoInspectionService(),
    private readonly templates = new WorkspaceTemplateService(),
    private readonly options: {
      isDismissed?: (projectId: string) => boolean;
      dismiss?: (projectId: string) => void;
      clearDismissal?: (projectId: string) => void;
    } = {}
  ) {}

  getQuestionnaire(): WorkspaceBootstrapQuestion[] {
    return [
      {
        id: 'projectIntent',
        prompt: 'What are you building here?',
        targetFiles: ['MEMORY.md', 'AGENTS.md']
      },
      {
        id: 'optimizationPriority',
        prompt: 'What should the agent optimize for first?',
        targetFiles: ['AGENTS.md', 'USER.md']
      },
      {
        id: 'communicationStyle',
        prompt: 'How should the agent communicate with you?',
        targetFiles: ['USER.md']
      },
      {
        id: 'approvalBoundary',
        prompt: 'When should the agent ask before acting?',
        targetFiles: ['USER.md', 'AGENTS.md']
      },
      {
        id: 'repoConstraints',
        prompt: 'What repo-specific rules or constraints matter most?',
        targetFiles: ['AGENTS.md', 'MEMORY.md']
      },
      {
        id: 'wantsSoul',
        prompt: 'Do you want a strong persistent agent identity layer for this workspace?',
        targetFiles: ['SOUL.md'],
        optional: true
      }
    ];
  }

  getStatus(project: Pick<Project, 'id' | 'folderPath' | 'trusted'>): WorkspaceBootstrapStatus {
    if (!project.folderPath) {
      return {
        eligible: false,
        reason: 'Workspace bootstrap requires a real project folder.',
        folderPath: null,
        existingFiles: [],
        missingFiles: [...REQUIRED_CONTRACT_FILES],
        needsBootstrap: false,
        dismissed: false,
        suggestionEligible: false
      };
    }

    if (!project.trusted) {
      return {
        eligible: false,
        reason: 'Workspace bootstrap is only available for trusted projects.',
        folderPath: project.folderPath,
        existingFiles: [],
        missingFiles: [...REQUIRED_CONTRACT_FILES],
        needsBootstrap: false,
        dismissed: false,
        suggestionEligible: false
      };
    }

    const allFiles = [...REQUIRED_CONTRACT_FILES, ...OPTIONAL_CONTRACT_FILES];
    const existingFiles = allFiles.filter((fileName) => existsSync(join(project.folderPath as string, fileName)));
    const missingFiles = allFiles.filter((fileName) => !existingFiles.includes(fileName));

    const needsBootstrap = missingFiles.some((fileName) =>
      REQUIRED_CONTRACT_FILES.includes(fileName as (typeof REQUIRED_CONTRACT_FILES)[number])
    );
    const dismissed = this.options.isDismissed?.(project.id) ?? false;

    return {
      eligible: true,
      reason: null,
      folderPath: project.folderPath,
      existingFiles,
      missingFiles,
      needsBootstrap,
      dismissed,
      suggestionEligible: needsBootstrap && !dismissed
    };
  }

  createDrafts(
    project: Pick<Project, 'id' | 'folderPath' | 'trusted'>,
    answers: WorkspaceBootstrapAnswers,
    options: {
      includeSoul?: boolean;
      includeDailyNote?: boolean;
      overwriteExisting?: boolean;
      date?: Date;
    } = {}
  ): WorkspaceBootstrapDraftBundle {
    const status = this.getStatus(project);
    if (!status.eligible || !status.folderPath) {
      throw new Error(status.reason ?? 'Workspace bootstrap is not available.');
    }

    const inspection = this.repoInspection.inspect(status.folderPath);
    const drafts = this.templates
      .renderDrafts({
        inspection,
        answers,
        includeSoul: options.includeSoul,
        includeDailyNote: options.includeDailyNote,
        date: options.date
      })
      .filter((draft) => {
        if (options.overwriteExisting) {
          return true;
        }
        return !existsSync(join(status.folderPath as string, draft.relativePath));
      });

    return {
      status,
      inspection,
      drafts
    };
  }

  writeDrafts(
    project: Pick<Project, 'id' | 'folderPath' | 'trusted'>,
    drafts: WorkspaceTemplateDraft[],
    options: { overwriteExisting?: boolean } = {}
  ) {
    const status = this.getStatus(project);
    if (!status.eligible || !status.folderPath) {
      throw new Error(status.reason ?? 'Workspace bootstrap is not available.');
    }

    const writtenPaths: string[] = [];

    for (const draft of drafts) {
      const targetPath = join(status.folderPath, draft.relativePath);
      if (!options.overwriteExisting && existsSync(targetPath)) {
        continue;
      }

      mkdirSync(dirname(targetPath), { recursive: true });
      writeFileSync(targetPath, `${draft.content.trim()}\n`, 'utf8');
      writtenPaths.push(targetPath);
    }

    if (writtenPaths.length > 0) {
      this.options.clearDismissal?.(project.id);
    }

    return writtenPaths;
  }

  getSuggestedMissingFiles(
    project: Pick<Project, 'id' | 'folderPath' | 'trusted'>,
    options: { includeSoul?: boolean; includeDailyNote?: boolean; date?: Date } = {}
  ) {
    const status = this.getStatus(project);
    if (!status.folderPath) {
      return [];
    }

    const date = options.date ?? new Date();
    const expected = [
      draftKindToFileName('agents', date),
      draftKindToFileName('user', date),
      draftKindToFileName('memory', date),
      ...(options.includeSoul ? [draftKindToFileName('soul', date)] : []),
      ...(options.includeDailyNote ? [draftKindToFileName('daily_note', date)] : [])
    ];

    return expected.filter((relativePath) => !existsSync(join(status.folderPath as string, relativePath)));
  }

  dismissSuggestion(project: Pick<Project, 'id'>) {
    this.options.dismiss?.(project.id);
  }
}
