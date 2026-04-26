import { useEffect, useEffectEvent, type MutableRefObject, type RefObject } from 'react';
import type {
  AutonomousTaskSummary,
  AutomationDefinition,
  JobDefinition,
  ReviewItem,
  SubagentSummary,
  ThreadDetail,
  ThreadSummary,
  VicodeBuildSnapshot
} from '../../shared/domain';

type UseShellTaskSyncInput = {
  route: string;
  selectedProjectId: string | null;
  selectedProjectIdRef: MutableRefObject<string | null>;
  activeThread: ThreadDetail | null;
  activeThreadIdRef: MutableRefObject<string | null>;
  activeThreadParentId: string | null;
  startupThreadRestoreState: 'idle' | 'pending' | 'resolved' | 'failed';
  reviewItemsLength: number;
  threadSubagentSignature: string;
  threadsByProject: Record<string, ThreadSummary[]>;
  pendingReviewRevealRequestedRef: MutableRefObject<boolean>;
  pendingReviewSectionRef: RefObject<HTMLDivElement | null>;
  listAutomations: () => Promise<AutomationDefinition[]>;
  listJobs: () => Promise<JobDefinition[]>;
  listPendingReviews: () => Promise<ReviewItem[]>;
  getBuildSnapshot: (projectId: string | null) => Promise<VicodeBuildSnapshot | null>;
  listThreadSubagents: (threadId: string) => Promise<SubagentSummary[]>;
  listThreadAutonomousTasks: (threadId: string) => Promise<AutonomousTaskSummary[]>;
  openThread: (threadId: string) => Promise<void>;
  setAutomations: (value: AutomationDefinition[]) => void;
  setJobs: (value: JobDefinition[]) => void;
  setReviewItems: (value: ReviewItem[]) => void;
  setVicodeBuildSnapshot: (value: VicodeBuildSnapshot | null) => void;
  setSubagentsByThreadId: (
    value:
      | Record<string, SubagentSummary[]>
      | ((current: Record<string, SubagentSummary[]>) => Record<string, SubagentSummary[]>)
  ) => void;
  setAutonomousTasksByThreadId: (
    value:
      | Record<string, AutonomousTaskSummary[]>
      | ((current: Record<string, AutonomousTaskSummary[]>) => Record<string, AutonomousTaskSummary[]>)
  ) => void;
  setStartupThreadRestoreState: (value: 'idle' | 'pending' | 'resolved' | 'failed') => void;
};

export function useShellTaskSync(input: UseShellTaskSyncInput) {
  const listAutomations = useEffectEvent(input.listAutomations);
  const listJobs = useEffectEvent(input.listJobs);
  const listPendingReviews = useEffectEvent(input.listPendingReviews);
  const getBuildSnapshot = useEffectEvent(input.getBuildSnapshot);
  const listThreadSubagents = useEffectEvent(input.listThreadSubagents);
  const listThreadAutonomousTasks = useEffectEvent(input.listThreadAutonomousTasks);
  const openThread = useEffectEvent(input.openThread);

  useEffect(() => {
    let cancelled = false;
    void listPendingReviews().then((nextReviewItems) => {
      if (cancelled) {
        return;
      }
      input.setReviewItems(nextReviewItems);
    });
    void listJobs().then((nextJobs) => {
      if (cancelled) {
        return;
      }
      input.setJobs(nextJobs);
    });

    if (input.route !== 'automations' && input.route !== 'build-control') {
      return () => {
        cancelled = true;
      };
    }

    void Promise.all([listAutomations(), listJobs()]).then(([nextAutomations, nextJobs]) => {
      if (cancelled) {
        return;
      }
      input.setAutomations(nextAutomations);
      input.setJobs(nextJobs);
    });

    void getBuildSnapshot(input.selectedProjectId).then((snapshot) => {
      if (!cancelled) {
        input.setVicodeBuildSnapshot(snapshot);
      }
    });

    const refreshTimer = window.setInterval(() => {
      void getBuildSnapshot(input.selectedProjectIdRef.current).then((snapshot) => {
        if (!cancelled) {
          input.setVicodeBuildSnapshot(snapshot);
        }
      });
    }, 10000);

    return () => {
      cancelled = true;
      window.clearInterval(refreshTimer);
    };
  }, [
    input.route,
    input.selectedProjectId,
    input.selectedProjectIdRef,
    input.setAutomations,
    input.setJobs,
    input.setReviewItems,
    input.setVicodeBuildSnapshot
  ]);

  useEffect(() => {
    if (!input.pendingReviewRevealRequestedRef.current || (input.route !== 'automations' && input.route !== 'build-control')) {
      return;
    }

    if (input.reviewItemsLength === 0) {
      input.pendingReviewRevealRequestedRef.current = false;
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      input.pendingReviewSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      input.pendingReviewRevealRequestedRef.current = false;
    });

    return () => window.cancelAnimationFrame(frame);
  }, [input.pendingReviewRevealRequestedRef, input.pendingReviewSectionRef, input.reviewItemsLength, input.route]);

  useEffect(() => {
    input.selectedProjectIdRef.current = input.selectedProjectId;
  }, [input.selectedProjectId, input.selectedProjectIdRef]);

  useEffect(() => {
    input.activeThreadIdRef.current = input.activeThread?.id ?? null;
  }, [input.activeThread, input.activeThreadIdRef]);

  useEffect(() => {
    const threadEntries = Object.values(input.threadsByProject).flat();
    if (threadEntries.length === 0) {
      input.setAutonomousTasksByThreadId({});
      input.setSubagentsByThreadId({});
      return;
    }

    let cancelled = false;
    void Promise.all(
      threadEntries.map(async (thread) => [thread.id, await listThreadSubagents(thread.id)] as const)
    ).then((pairs) => {
      if (cancelled) {
        return;
      }
      const nextByThread = Object.fromEntries(pairs.filter(([, subagents]) => subagents.length > 0));
      input.setSubagentsByThreadId(nextByThread);
    });

    return () => {
      cancelled = true;
    };
  }, [input.threadSubagentSignature, input.threadsByProject, input.setAutonomousTasksByThreadId, input.setSubagentsByThreadId]);

  useEffect(() => {
    if (!input.activeThread) {
      return;
    }

    const parentThreadId = input.activeThreadParentId;
    if (!parentThreadId || parentThreadId === input.activeThread.id) {
      return;
    }

    void openThread(parentThreadId);
  }, [input.activeThread, input.activeThreadParentId]);

  useEffect(() => {
    const threadId = input.activeThread?.id ?? null;
    if (!threadId) {
      return;
    }

    let cancelled = false;
    void listThreadAutonomousTasks(threadId).then((tasks) => {
      if (cancelled || input.activeThreadIdRef.current !== threadId) {
        return;
      }
      input.setAutonomousTasksByThreadId((current) => ({
        ...current,
        [threadId]: tasks
      }));
    });

    return () => {
      cancelled = true;
    };
  }, [input.activeThread, input.activeThreadIdRef, input.setAutonomousTasksByThreadId]);

  useEffect(() => {
    if (input.startupThreadRestoreState === 'pending' && input.activeThread) {
      input.setStartupThreadRestoreState('resolved');
    }
  }, [input.activeThread, input.startupThreadRestoreState, input.setStartupThreadRestoreState]);
}
