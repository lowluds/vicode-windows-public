import type { ProviderId } from '../../shared/domain';
import type { DatabaseService } from '../../storage/database';
import { OllamaFinalAnswerFormatter } from './ollama-final-answer-formatter';
import { formatProviderCompletionOutput } from './provider-completion-output';

type WorkspaceSnapshot = {
  entries: Array<{
    path: string;
    type: 'file' | 'directory' | 'missing';
    size: number | null;
    mtimeMs: number | null;
  }>;
};

type FinalizeExecutionInput = {
  threadId: string;
  runId: string;
  output: string;
  workspaceSnapshot: WorkspaceSnapshot | null;
  projectFolderPath: string | null;
  approvedPlan: boolean;
  titlePrompt: string | null;
};

type ProviderCleanupInput = FinalizeExecutionInput & {
  providerId: ProviderId;
  modelId: string;
};

export class ProviderRunOutputService {
  constructor(
    private readonly db: Pick<DatabaseService, 'getThread'>,
    private readonly ollamaFinalAnswerFormatter: OllamaFinalAnswerFormatter
  ) {}

  collectAssistantText(threadId: string, runId: string) {
    const thread = this.db.getThread(threadId);
    return [...thread.turns].reverse().find((turn) => turn.runId === runId && turn.role === 'assistant')?.content ?? '';
  }

  collectRunDeltaText(threadId: string, runId: string) {
    const thread = this.db.getThread(threadId);
    return thread.rawOutput
      .filter((event) => event.runId === runId && event.eventType === 'delta')
      .map((event) => (typeof event.payload?.delta === 'string' ? event.payload.delta : ''))
      .join('');
  }

  async finalizeSuccessfulExecutionRunWithProviderCleanup(
    input: ProviderCleanupInput,
    finalizeSuccessfulExecutionRun: (input: FinalizeExecutionInput) => void,
    isDisposed: () => boolean
  ) {
    const fallbackOutput = formatProviderCompletionOutput(input.providerId, input.output);
    let nextOutput = fallbackOutput;
    if (!nextOutput || isDisposed()) {
      return;
    }

    if (input.providerId === 'ollama') {
      try {
        const rewritten = await this.ollamaFinalAnswerFormatter.rewrite(input.modelId, input.output);
        if (rewritten?.trim()) {
          nextOutput = rewritten.trim();
        }
      } catch {
        nextOutput = fallbackOutput;
      }
    }

    if (isDisposed() || !nextOutput) {
      return;
    }

    finalizeSuccessfulExecutionRun({
      threadId: input.threadId,
      runId: input.runId,
      output: nextOutput,
      workspaceSnapshot: input.workspaceSnapshot,
      projectFolderPath: input.projectFolderPath,
      approvedPlan: input.approvedPlan,
      titlePrompt: input.titlePrompt
    });
  }
}
