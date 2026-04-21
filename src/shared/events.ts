import type {
  AutomationDefinition,
  AutonomousTaskSummary,
  CollabConfig,
  CollabHandoff,
  CollabMessage,
  CollabPresence,
  CollabProfile,
  CollabRoom,
  CollabRoomMember,
  CollabSharedRun,
  CollabSharedThread,
  JobDefinition,
  McpCatalogSnapshot,
  McpServerView,
  PlannerPlan,
  PlannerQuestionSet,
  AppUpdateState,
  ProviderDescriptor,
  ReviewItem,
  OllamaPullProgress,
  RunToolApprovalDecision,
  RunToolApprovalRequest,
  RunProgressState,
  RunEvent,
  SubagentSummary,
  ThreadDetail,
  ThreadFollowUp,
  ThreadPlannerState,
  ThreadSummary
} from './domain';

export type AppEvent =
  | { type: 'run.started'; threadId: string; runId: string }
  | { type: 'run.delta'; threadId: string; runId: string; delta: string }
  | { type: 'run.replace'; threadId: string; runId: string; text: string }
  | { type: 'run.status'; threadId: string; runId: string; status: string; message?: string }
  | { type: 'run.progress'; threadId: string; runId: string; progress: RunProgressState }
  | { type: 'thread.updated'; thread: ThreadSummary }
  | { type: 'thread.detail'; thread: ThreadDetail }
  | { type: 'planner.modeChanged'; threadId: string; planner: ThreadPlannerState }
  | { type: 'planner.questionsRequested'; threadId: string; planner: ThreadPlannerState; questionSet: PlannerQuestionSet }
  | { type: 'planner.planProposed'; threadId: string; planner: ThreadPlannerState; plan: PlannerPlan }
  | { type: 'planner.planApproved'; threadId: string; planner: ThreadPlannerState; plan: PlannerPlan; runId: string }
  | { type: 'planner.parseError'; threadId: string; message: string; runId: string | null }
  | { type: 'provider.updated'; provider: ProviderDescriptor }
  | { type: 'ollama.pullProgress'; progress: OllamaPullProgress }
  | { type: 'run.approvalRequested'; approval: RunToolApprovalRequest }
  | { type: 'run.approvalResolved'; approvalId: string; threadId: string; runId: string; decision: RunToolApprovalDecision }
  | { type: 'followup.queued'; threadId: string; followUp: ThreadFollowUp }
  | { type: 'followup.updated'; threadId: string; followUp: ThreadFollowUp }
  | { type: 'followup.removed'; threadId: string; followUpId: string }
  | { type: 'followup.dispatched'; threadId: string; followUp: ThreadFollowUp; runId: string }
  | { type: 'subagent.created'; subagent: SubagentSummary }
  | { type: 'subagent.updated'; subagent: SubagentSummary }
  | { type: 'subagent.completed'; subagent: SubagentSummary }
  | { type: 'subagent.failed'; subagent: SubagentSummary }
  | { type: 'subagent.cancelled'; subagent: SubagentSummary }
  | { type: 'autonomousTasks.updated'; threadId: string; tasks: AutonomousTaskSummary[] }
  | { type: 'mcp.updated'; servers: McpServerView[]; catalog: McpCatalogSnapshot }
  | { type: 'job.updated'; job: JobDefinition }
  | { type: 'review.updated'; reviewItem: ReviewItem }
  | { type: 'automation.updated'; automation: AutomationDefinition }
  | { type: 'collab.profileUpdated'; profile: CollabProfile | null }
  | { type: 'collab.roomsUpdated'; rooms: CollabRoom[] }
  | { type: 'collab.roomUpdated'; room: CollabRoom; members: CollabRoomMember[] }
  | { type: 'collab.presenceUpdated'; roomId: string; presence: CollabPresence[] }
  | { type: 'collab.messageCreated'; roomId: string; message: CollabMessage }
  | { type: 'collab.threadShared'; roomId: string; sharedThread: CollabSharedThread }
  | { type: 'collab.runShared'; roomId: string; sharedRun: CollabSharedRun }
  | { type: 'collab.runUpdated'; roomId: string; sharedRun: CollabSharedRun }
  | { type: 'collab.handoffCreated'; roomId: string; handoff: CollabHandoff }
  | { type: 'collab.connectionChanged'; config: CollabConfig }
  | { type: 'diagnostics.ready'; path: string }
  | { type: 'app.updateStateChanged'; update: AppUpdateState }
  | { type: 'app.notification'; level: 'info' | 'warning' | 'error'; message: string }
  | { type: 'raw.event'; event: RunEvent };
