import { createProviderRecord } from '../shared/providers';
import { normalizeThreadSources } from '../shared/thread-sources';
import type {
  AutonomousTaskRecord,
  AutomationDefinition,
  CustomProviderDefinition,
  ExecutionPermission,
  GeneratedMemoryCandidate,
  GeneratedMemoryCandidateKind,
  GeneratedMemoryCandidateStatus,
  GeneratedMemoryEvidence,
  GeneratedMemoryItem,
  GeneratedMemoryItemAuthority,
  JobDefinition,
  JobRun,
  McpServerDefinition,
  McpServerRecord,
  McpServerState,
  PlannerPlan,
  PlannerPlanStatus,
  PlannerQuestionAnswer,
  PlannerQuestionSet,
  Project,
  ProjectRuntimeCommandPolicy,
  ProjectRuntimeNetworkPolicy,
  ProviderAccount,
  ProviderId,
  ProviderModel,
  ReviewItem,
  RunEvent,
  SkillDefinition,
  StructuredPlannerPlan,
  SubagentSummary,
  ThreadFollowUp,
  ThreadFollowUpKind,
  ThreadFollowUpStatus,
  ThreadSummary,
  ThreadTurn
} from '../shared/domain';
import { DEFAULT_PREFERENCES } from './settings-repository';
import {
  DEFAULT_PROJECT_RUNTIME_COMMAND_POLICY,
  DEFAULT_PROJECT_RUNTIME_NETWORK_POLICY
} from './storage-defaults';

type Row = Record<string, unknown>;

export function mapProject(row: Row): Project {
  return {
    id: String(row.id),
    name: String(row.name),
    folderPath: (row.folder_path as string | null) ?? null,
    trusted: Boolean(row.trusted),
    runtimeCommandPolicy:
      (row.runtime_command_policy as ProjectRuntimeCommandPolicy | null) ??
      DEFAULT_PROJECT_RUNTIME_COMMAND_POLICY,
    runtimeNetworkPolicy:
      (row.runtime_network_policy as ProjectRuntimeNetworkPolicy | null) ??
      DEFAULT_PROJECT_RUNTIME_NETWORK_POLICY,
    defaultProviderId: row.default_provider_id as ProviderId,
    defaultModelByProvider: createProviderRecord((providerId) => {
      const value = row[`default_model_${providerId}`];
      return typeof value === "string" && value.trim()
        ? value
        : DEFAULT_PREFERENCES.defaultModelByProvider[providerId];
    }),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}


export function mapGeneratedMemoryCandidate(row: Row): GeneratedMemoryCandidate {
  return {
    id: String(row.id),
    workspaceScopeKey: String(row.workspace_scope_key),
    projectId: (row.project_id as string | null) ?? null,
    sourceThreadId: String(row.source_thread_id),
    sourceRunId: (row.source_run_id as string | null) ?? null,
    sourceTurnIds: JSON.parse(String(row.source_turn_ids_json)) as string[],
    kind: row.kind as GeneratedMemoryCandidateKind,
    summary: String(row.summary),
    detail: String(row.detail),
    evidenceExcerpt: String(row.evidence_excerpt),
    dedupeKey: String(row.dedupe_key),
    status: row.status as GeneratedMemoryCandidateStatus,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}


export function mapGeneratedMemoryItem(row: Row): GeneratedMemoryItem {
  return {
    id: String(row.id),
    workspaceScopeKey: String(row.workspace_scope_key),
    projectId: (row.project_id as string | null) ?? null,
    kind: row.kind as GeneratedMemoryCandidateKind,
    summary: String(row.summary),
    detail: String(row.detail),
    authority: row.authority as GeneratedMemoryItemAuthority,
    evidenceCount: Number(row.evidence_count ?? 0),
    sourceCandidateIds: JSON.parse(
      String(row.source_candidate_ids_json),
    ) as string[],
    sourceThreadIds: JSON.parse(
      String(row.source_thread_ids_json),
    ) as string[],
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    lastUsedAt: (row.last_used_at as string | null) ?? null,
    useCount: Number(row.use_count ?? 0),
    disabledAt: (row.disabled_at as string | null) ?? null,
  };
}


export function mapGeneratedMemoryEvidence(row: Row): GeneratedMemoryEvidence {
  return {
    id: String(row.id),
    workspaceScopeKey: String(row.workspace_scope_key),
    projectId: (row.project_id as string | null) ?? null,
    candidateId: (row.candidate_id as string | null) ?? null,
    itemId: (row.item_id as string | null) ?? null,
    sourceThreadId: String(row.source_thread_id),
    sourceTurnIds: JSON.parse(String(row.source_turn_ids_json)) as string[],
    role: row.role as GeneratedMemoryEvidence["role"],
    excerpt: String(row.excerpt),
    capturedAt: String(row.captured_at),
  };
}


export function mapThreadSummary(row: Row): ThreadSummary {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    title: String(row.title),
    providerId: row.provider_id as ProviderId,
    modelId: String(row.model_id),
    executionPermission:
      ((row.execution_permission as ExecutionPermission | null) ??
        "default") as ExecutionPermission,
    status: row.status as ThreadSummary["status"],
    archived: Boolean(row.archived),
    lastMessageAt: String(row.last_message_at),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    lastPreview: String((row.last_preview as string | null) ?? ""),
  };
}


export function mapTurn(row: Row): ThreadTurn {
  const metadata = row.metadata_json
    ? (JSON.parse(String(row.metadata_json)) as Record<string, unknown>)
    : null;
  return {
    id: String(row.id),
    threadId: String(row.thread_id),
    runId: (row.run_id as string | null) ?? null,
    role: row.role as ThreadTurn["role"],
    content: String(row.content),
    sources: metadata ? normalizeThreadSources(metadata.sources) : [],
    metadata,
    createdAt: String(row.created_at),
  };
}


export function mapRunEvent(row: Row): RunEvent {
  return {
    id: String(row.id),
    threadId: String(row.thread_id),
    runId: String(row.run_id),
    eventType: row.event_type as RunEvent["eventType"],
    payload: JSON.parse(String(row.payload_json)) as Record<string, unknown>,
    createdAt: String(row.created_at),
  };
}


export function mapThreadFollowUp(row: Row): ThreadFollowUp {
  return {
    id: String(row.id),
    threadId: String(row.thread_id),
    content: String(row.content),
    metadata: row.metadata_json
      ? (JSON.parse(String(row.metadata_json)) as Record<string, unknown>)
      : null,
    kind: row.kind as ThreadFollowUpKind,
    status: row.status as ThreadFollowUpStatus,
    priority: Number(row.priority ?? 0),
    targetRunId: (row.target_run_id as string | null) ?? null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    dispatchedAt: (row.dispatched_at as string | null) ?? null,
    cancelledAt: (row.cancelled_at as string | null) ?? null,
  };
}


export function mapSubagent(row: Row): SubagentSummary {
  return {
    id: String(row.id),
    parentThreadId: String(row.parent_thread_id),
    parentRunId: (row.parent_run_id as string | null) ?? null,
    childThreadId: (row.child_thread_id as string | null) ?? null,
    childRunId: (row.child_run_id as string | null) ?? null,
    name:
      typeof row.name === "string" && row.name.trim() ? row.name : "Agent",
    title: String(row.title),
    prompt: String(row.prompt),
    providerId: row.provider_id as ProviderId,
    modelId: String(row.model_id),
    executionPermission: row.execution_permission as ExecutionPermission,
    delegationProfile:
      row.delegation_profile as SubagentSummary["delegationProfile"],
    status: row.status as SubagentSummary["status"],
    outputSummary: (row.output_summary as string | null) ?? null,
    lastError: (row.last_error as string | null) ?? null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    startedAt: (row.started_at as string | null) ?? null,
    completedAt: (row.completed_at as string | null) ?? null,
  };
}


export function mapAutonomousTask(row: Row): AutonomousTaskRecord {
  return {
    id: String(row.id),
    kind: row.kind as AutonomousTaskRecord["kind"],
    projectId: String(row.project_id),
    threadId: (row.thread_id as string | null) ?? null,
    runId: (row.run_id as string | null) ?? null,
    sourceId: String(row.source_id),
    title: String(row.title),
    summary: String(row.summary),
    ownerLabel: String(row.owner_label),
    provenanceLabel: String(row.provenance_label),
    trustLabel: (row.trust_label as string | null) ?? null,
    approvalLabel: (row.approval_label as string | null) ?? null,
    status: row.status as AutonomousTaskRecord["status"],
    statusLabel: String(row.status_label),
    blockedBy: (row.blocked_by as string | null) ?? null,
    blocking: (row.blocking as string | null) ?? null,
    lastError: (row.last_error as string | null) ?? null,
    metadata: row.metadata_json
      ? (JSON.parse(String(row.metadata_json)) as Record<string, unknown>)
      : {},
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    startedAt: (row.started_at as string | null) ?? null,
    completedAt: (row.completed_at as string | null) ?? null,
  };
}


export function mapPlannerQuestionSet(row: Row): PlannerQuestionSet {
  return {
    id: String(row.question_set_id),
    threadId: String(row.thread_id),
    promptTurnId: String(row.prompt_turn_id),
    callId: String(row.call_id),
    questions: JSON.parse(
      String(row.questions_json),
    ) as PlannerQuestionSet["questions"],
    answers: row.answers_json
      ? (JSON.parse(String(row.answers_json)) as Record<
          string,
          PlannerQuestionAnswer
        >)
      : null,
    createdAt: String(row.created_at),
  };
}


export function mapPlannerPlan(row: Row): PlannerPlan {
  return {
    id: String(row.plan_id),
    threadId: String(row.thread_id),
    createdTurnId: String(row.created_turn_id),
    proposedPlanMarkdown: String(row.proposed_plan_markdown),
    structuredPlan: row.structured_plan_json
      ? (JSON.parse(
          String(row.structured_plan_json),
        ) as StructuredPlannerPlan)
      : null,
    status: row.status as PlannerPlanStatus,
    createdAt: String(row.created_at),
  };
}


export function mapProviderAccount(row: Row): ProviderAccount {
  return {
    providerId: row.provider_id as ProviderId,
    authState: row.auth_state as ProviderAccount["authState"],
    authMode: (row.auth_mode as ProviderAccount["authMode"]) ?? null,
    encryptedApiKey: (row.encrypted_api_key as string | null) ?? null,
    updatedAt: String(row.updated_at),
  };
}


export function mapProviderModel(row: Row): ProviderModel {
  return {
    id: String(row.model_id),
    label: String(row.label),
    description: String(row.description),
    supportsVision: Boolean(row.supports_vision),
  };
}


export function mapCustomProvider(row: Row): CustomProviderDefinition {
  return {
    id: String(row.id),
    name: String(row.name),
    transportKind: row.transport_kind as CustomProviderDefinition["transportKind"],
    baseUrl: String(row.base_url),
    encryptedApiKey: String(row.encrypted_api_key),
    defaultModelId: String(row.default_model_id),
    enabled: Boolean(row.enabled),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}


export function mapSkill(row: Row): SkillDefinition {
  return {
    id: String(row.id),
    name: String(row.name),
    description: String(row.description),
    instructions: String(row.instructions),
    origin: row.origin as SkillDefinition["origin"],
    scope: row.scope as SkillDefinition["scope"],
    providerTargets: JSON.parse(
      String(row.provider_targets_json),
    ) as SkillDefinition["providerTargets"],
    enabled: Boolean(row.enabled),
    projectId: (row.project_id as string | null) ?? null,
    metadata: JSON.parse(String(row.metadata_json)) as Record<
      string,
      unknown
    >,
    path: (row.path as string | null) ?? null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}


export function mapAutomation(row: Row): AutomationDefinition {
  return {
    id: String(row.id),
    name: String(row.name),
    projectId: String(row.project_id),
    providerId: row.provider_id as ProviderId,
    modelId: String(row.model_id),
    promptTemplate: String(row.prompt_template),
    skillId: (row.skill_id as string | null) ?? null,
    enabled: Boolean(row.enabled),
    scheduleType: row.schedule_type as AutomationDefinition["scheduleType"],
    intervalMinutes: (row.interval_minutes as number | null) ?? null,
    lastRunAt: (row.last_run_at as string | null) ?? null,
    nextRunAt: (row.next_run_at as string | null) ?? null,
    status: row.status as AutomationDefinition["status"],
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}


export function mapJob(row: Row): JobDefinition {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    sourceType: row.source_type as JobDefinition["sourceType"],
    sourceId: (row.source_id as string | null) ?? null,
    title: String(row.title),
    status: row.status as JobDefinition["status"],
    threadId: (row.thread_id as string | null) ?? null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}


export function mapJobRun(row: Row): JobRun {
  return {
    id: String(row.id),
    jobId: String(row.job_id),
    providerId: (row.provider_id as ProviderId | null) ?? null,
    modelId: (row.model_id as string | null) ?? null,
    status: row.status as JobRun["status"],
    runId: (row.run_id as string | null) ?? null,
    checkpoint: row.checkpoint_json
      ? (JSON.parse(String(row.checkpoint_json)) as Record<string, unknown>)
      : null,
    startedAt: (row.started_at as string | null) ?? null,
    finishedAt: (row.finished_at as string | null) ?? null,
    createdAt: String(row.created_at),
  };
}


export function mapReviewItem(row: Row): ReviewItem {
  return {
    id: String(row.id),
    jobId: String(row.job_id),
    jobRunId: (row.job_run_id as string | null) ?? null,
    kind: row.kind as ReviewItem["kind"],
    status: row.status as ReviewItem["status"],
    summary: String(row.summary),
    details: JSON.parse(String(row.details_json)) as Record<string, unknown>,
    decision: row.decision_json
      ? (JSON.parse(String(row.decision_json)) as Record<string, unknown>)
      : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}


export function mapMcpServerDefinition(row: Row): McpServerDefinition {
  return {
    id: String(row.id),
    name: String(row.name),
    scope: (row.scope as McpServerDefinition["scope"] | null) ?? "global",
    projectId: (row.project_id as string | null) ?? null,
    transportType: row.transport_type as McpServerDefinition["transportType"],
    command: String(row.command),
    args: JSON.parse(String(row.args_json)) as string[],
    cwd: (row.cwd as string | null) ?? null,
    env: JSON.parse(String(row.env_json)) as Record<string, string>,
    url: (row.url as string | null) ?? null,
    headers: JSON.parse(String(row.headers_json ?? "{}")) as Record<string, string>,
    enabled: Boolean(row.enabled),
    toolInvocationMode:
      row.tool_invocation_mode as McpServerDefinition["toolInvocationMode"],
    launchApproved: Boolean(row.launch_approved),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}


export function mapMcpServerRecord(row: Row): McpServerRecord {
  return {
    definition: mapMcpServerDefinition(row),
    state: row.state_server_id
      ? {
          serverId: String(row.state_server_id),
          status: row.state_status as McpServerState["status"],
          capabilities: row.state_capabilities_json
            ? (JSON.parse(String(row.state_capabilities_json)) as Record<
                string,
                unknown
              >)
            : null,
          lastSeenAt: (row.state_last_seen_at as string | null) ?? null,
          lastError: (row.state_last_error as string | null) ?? null,
          toolCount: Number(row.state_tool_count ?? 0),
          resourceCount: Number(row.state_resource_count ?? 0),
          promptCount: Number(row.state_prompt_count ?? 0),
          updatedAt: String(row.state_updated_at),
        }
      : null,
  };
}
