import { join } from 'node:path';
import type {
  ProviderDescriptor,
  ThreadDetail
} from '../../shared/domain';
import { DatabaseService } from '../../storage/database';
import {
  redactSupportValue,
  sanitizeDiagnosticsPayload
} from './diagnostics-redaction';
import {
  sanitizeRuntimeTraceDetail
} from './diagnostics-runtime-trace';
import {
  createDiagnosticsReportDir,
  writeDiagnosticsJsonFile,
  writeDiagnosticsJsonInDir,
  writeDiagnosticsTextFile
} from './diagnostics-export-writer';
import { collectRunProgressDiagnostics } from './diagnostics-run-progress';
import type { OllamaLaunchDiagnostics } from '../ollama-launch-profile';

function sanitizeThreadDiagnostics(thread: ThreadDetail) {
  return {
    ...thread,
    rawOutput: thread.rawOutput.map((event) => ({
      ...event,
      payload: sanitizeDiagnosticsPayload(event.payload, sanitizeRuntimeTraceDetail)
    }))
  };
}

export class DiagnosticsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly exportsDir: string,
    private readonly getCollaborationDiagnostics: (() => Record<string, unknown>) | null = null,
    private readonly getInstrumentationDiagnostics: (() => {
      bootstrapDiagnostics: Record<string, unknown> | null;
      skillCatalogDiagnostics: Record<string, unknown> | null;
    }) | null = null,
    private readonly getOllamaLaunchDiagnostics: (() => OllamaLaunchDiagnostics) | null = null
  ) {}

  async export(providers: ProviderDescriptor[]) {
    const data = {
      exportedAt: new Date().toISOString(),
      projects: this.db.listProjects(),
      preferences: this.db.getPreferences(),
      skills: this.db.listSkills(),
      automations: this.db.listAutomations(),
      providers,
      instrumentationDiagnostics: this.collectInstrumentationDiagnostics(),
      ollamaLaunchDiagnostics: this.collectOllamaLaunchDiagnostics(),
      runProgressDiagnostics: collectRunProgressDiagnostics({ db: this.db }),
      collaborationDiagnostics: this.collectCollaborationDiagnostics()
    };
    return writeDiagnosticsJsonInDir(this.exportsDir, `diagnostics-${Date.now()}.json`, data);
  }

  async exportThread(threadId: string, providers: ProviderDescriptor[]) {
    const thread = this.db.getThread(threadId);
    const project = this.db.getProject(thread.projectId);
    const data = {
      exportedAt: new Date().toISOString(),
      project,
      thread: sanitizeThreadDiagnostics(thread),
      providers,
      instrumentationDiagnostics: this.collectInstrumentationDiagnostics(),
      ollamaLaunchDiagnostics: this.collectOllamaLaunchDiagnostics(),
      runProgressDiagnostics: collectRunProgressDiagnostics({ db: this.db, threadIds: [threadId] }),
      collaborationDiagnostics: this.collectCollaborationDiagnostics()
    };
    return writeDiagnosticsJsonInDir(this.exportsDir, `thread-diagnostics-${threadId}-${Date.now()}.json`, data);
  }

  async exportThreadReport(threadId: string, providers: ProviderDescriptor[]) {
    const thread = this.db.getThread(threadId);
    const project = this.db.getProject(thread.projectId);
    const reportDir = await createDiagnosticsReportDir(this.exportsDir, threadId);

    const data = redactSupportValue({
      reportType: 'thread-support-report',
      exportedAt: new Date().toISOString(),
      project,
      thread: {
        id: thread.id,
        projectId: thread.projectId,
        title: thread.title,
        providerId: thread.providerId,
        modelId: thread.modelId,
        executionPermission: thread.executionPermission,
        status: thread.status,
        archived: thread.archived,
        createdAt: thread.createdAt,
        updatedAt: thread.updatedAt,
        lastMessageAt: thread.lastMessageAt,
        turnCount: thread.turns.length,
        runEventCount: thread.rawOutput.length,
        followUpCount: thread.followUps.length
      },
      providers,
      instrumentationDiagnostics: this.collectInstrumentationDiagnostics(),
      ollamaLaunchDiagnostics: this.collectOllamaLaunchDiagnostics(),
      runProgressDiagnostics: collectRunProgressDiagnostics({ db: this.db, threadIds: [threadId] }),
      collaborationDiagnostics: this.collectCollaborationDiagnostics()
    });

    await writeDiagnosticsTextFile(
      join(reportDir, 'README.txt'),
      [
        'Vicode thread support report',
        '',
        'Attach this folder when filing a GitHub issue, Discord report, or support request.',
        'The report is generated locally and redacts local paths, tokens, credentials, and session material.',
        'It intentionally omits full transcript text by default.'
      ].join('\n'),
    );
    await writeDiagnosticsJsonFile(join(reportDir, 'report.json'), data);
    return reportDir;
  }

  private collectCollaborationDiagnostics() {
    return this.getCollaborationDiagnostics?.() ?? null;
  }

  private collectInstrumentationDiagnostics() {
    return this.getInstrumentationDiagnostics?.() ?? {
      bootstrapDiagnostics: null,
      skillCatalogDiagnostics: null
    };
  }

  private collectOllamaLaunchDiagnostics() {
    return this.getOllamaLaunchDiagnostics?.() ?? null;
  }
}
