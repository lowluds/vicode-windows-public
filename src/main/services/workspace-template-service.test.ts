import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { WorkspaceTemplateService } from './workspace-template-service';

describe('WorkspaceTemplateService', () => {
  const service = new WorkspaceTemplateService();

  const inspection = {
    folderPath: 'C:/workspace/project',
    repoName: 'vicode-windows',
    repoPurpose: 'Build a focused desktop shell for AI-assisted coding workflows.',
    repoStack: 'Electron, React, Vite, TypeScript',
    packageManager: 'npm',
    installCommand: 'npm install',
    buildCommand: 'npm run build',
    testCommand: 'npm run test',
    lintCommand: null,
    platformFocus: 'Windows-first',
    architectureFacts: [
      'The app is split into main, preload, and renderer process boundaries.',
      'Persistence is owned locally by the app.',
      'SQLite via better-sqlite3 is part of the core application architecture.'
    ],
    constraints: ['Optimize process spawning, path handling, and native module behavior for Windows first.'],
    frameworks: ['Electron', 'React', 'Vite'],
    languages: ['TypeScript']
  };

  it('renders core drafts with repo facts and questionnaire answers', () => {
    const drafts = service.renderDrafts({
      inspection,
      answers: {
        projectIntent: 'Improve Vicode into a durable agent system.',
        optimizationPriority: 'correctness and durable workflow quality',
        communicationStyle: 'direct and concise',
        approvalBoundary: 'destructive changes or risky actions',
        repoConstraints: 'Do not expand into a generic IDE.'
      },
      date: new Date('2026-03-17T12:00:00.000Z')
    });

    expect(drafts.map((draft) => draft.fileName)).toEqual(['AGENTS.md', 'USER.md', 'MEMORY.md']);
    expect(drafts[0]?.content).toContain('Improve Vicode into a durable agent system.');
    expect(drafts[0]?.content).toContain('npm run build');
    expect(drafts[0]?.content).not.toContain('{{');
    expect(drafts[1]?.content).toContain('destructive changes or risky actions');
    expect(drafts[2]?.content).toContain('Do not expand into a generic IDE.');
  });

  it('can include SOUL.md and a dated daily note when requested', () => {
    const drafts = service.renderDrafts({
      inspection,
      answers: {
        communicationStyle: 'calm and direct',
        wantsSoul: true,
        todayFocus: 'Bootstrap durable workspace files.'
      },
      includeSoul: true,
      includeDailyNote: true,
      date: new Date('2026-03-17T12:00:00.000Z')
    });

    expect(drafts.map((draft) => draft.relativePath)).toEqual([
      'AGENTS.md',
      'USER.md',
      'MEMORY.md',
      'SOUL.md',
      join('memory', '2026-03-17.md')
    ]);
    expect(drafts[3]?.content).toContain('calm and direct');
    expect(drafts[4]?.content).toContain('Bootstrap durable workspace files.');
  });
});
