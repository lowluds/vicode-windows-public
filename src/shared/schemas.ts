import { z } from 'zod';
import { MAX_COMPOSER_PROMPT_CHARS, MAX_COMPOSER_TEXT_ATTACHMENT_CHARS, PROVIDER_IDS } from './domain';

export const providerIdSchema = z.enum(PROVIDER_IDS);
export const providerAuthModeSchema = z.enum(['cli', 'api_key']);
export const skillScopeSchema = z.enum(['global', 'project']);
export const automationScheduleSchema = z.enum(['manual', 'interval_while_app_open']);
export const composerModeSchema = z.enum(['default', 'plan']);
export const executionPermissionSchema = z.enum(['default', 'full_access']);
export const projectRuntimeCommandPolicySchema = z.enum([
  'approval_required',
  'auto_approve',
  'disabled'
]);
export const projectRuntimeNetworkPolicySchema = z.enum(['disabled', 'enabled']);
export const providerReasoningEffortSchema = z.enum(['none', 'minimal', 'low', 'medium', 'high', 'xhigh']);
export const followUpBehaviorSchema = z.enum(['queue', 'steer']);
export const appearanceModeSchema = z.enum(['system', 'dark', 'light']);
export const accentModeSchema = z.enum(['system', 'custom']);
export const ollamaTransportModeSchema = z.enum(['chat', 'responses']);
export const mcpServerTransportTypeSchema = z.enum(['stdio']);
export const mcpPermissionModeSchema = z.enum(['ask', 'allow', 'deny']);
export const collabRoomTypeSchema = z.enum(['project', 'dm']);
export const collabPresenceStatusSchema = z.enum(['online', 'away', 'busy', 'offline']);
export const collabThreadStatusSchema = z.enum(['idle', 'active', 'completed', 'failed']);
export const collabRunStatusSchema = z.enum(['queued', 'running', 'completed', 'failed', 'cancelled']);

export const projectCreateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  folderPath: z.string().trim().min(1).max(4096).nullable().optional(),
  trusted: z.boolean().default(true),
  runtimeCommandPolicy: projectRuntimeCommandPolicySchema.optional(),
  runtimeNetworkPolicy: projectRuntimeNetworkPolicySchema.optional()
});

export const projectIdSchema = z.object({
  projectId: z.string().min(1)
});

const workspaceBootstrapAnswersSchema = z.object({
  projectIntent: z.string().trim().max(4000).optional(),
  optimizationPriority: z.string().trim().max(400).optional(),
  communicationStyle: z.string().trim().max(400).optional(),
  approvalBoundary: z.string().trim().max(800).optional(),
  repoConstraints: z.string().trim().max(2000).optional(),
  wantsSoul: z.boolean().optional(),
  detailLevel: z.string().trim().max(400).optional(),
  planningStyle: z.string().trim().max(400).optional(),
  deliveryStyle: z.string().trim().max(400).optional(),
  riskPosture: z.string().trim().max(400).optional(),
  testingExpectation: z.string().trim().max(400).optional(),
  dependencyPolicy: z.string().trim().max(400).optional(),
  refactorPosture: z.string().trim().max(400).optional(),
  summaryStyle: z.string().trim().max(400).optional(),
  changeStyle: z.string().trim().max(400).optional(),
  agentAssertiveness: z.string().trim().max(400).optional(),
  agentFormality: z.string().trim().max(400).optional(),
  durablePreferences: z.array(z.string().trim().min(1).max(1000)).max(8).optional(),
  durableDecisions: z.array(z.string().trim().min(1).max(1000)).max(8).optional(),
  todayFocus: z.string().trim().max(2000).optional(),
  recentDecisions: z.array(z.string().trim().min(1).max(1000)).max(8).optional(),
  openQuestions: z.array(z.string().trim().min(1).max(1000)).max(8).optional(),
  followUps: z.array(z.string().trim().min(1).max(1000)).max(8).optional()
});

const workspaceTemplateDraftSchema = z.object({
  kind: z.enum(['agents', 'user', 'soul', 'memory', 'daily_note']),
  fileName: z.string().trim().min(1).max(260),
  relativePath: z.string().trim().min(1).max(4096),
  content: z.string().trim().min(1).max(40000)
});

export const workspaceBootstrapStatusSchema = projectIdSchema;

export const workspaceBootstrapCreateDraftsSchema = z.object({
  projectId: z.string().min(1),
  answers: workspaceBootstrapAnswersSchema,
  includeSoul: z.boolean().optional(),
  includeDailyNote: z.boolean().optional(),
  overwriteExisting: z.boolean().optional()
});

export const workspaceBootstrapWriteDraftsSchema = z.object({
  projectId: z.string().min(1),
  drafts: z.array(workspaceTemplateDraftSchema).min(1).max(5),
  overwriteExisting: z.boolean().optional()
});

export const memoryWriteThreadSchema = z.object({
  threadId: z.string().min(1)
});

export const filePathSchema = z.object({
  path: z.string().trim().min(1).max(4096)
});

export const externalUrlSchema = z.object({
  url: z.string().trim().url().max(2048)
});

export const appZoomActionSchema = z.object({
  action: z.enum(['in', 'out', 'reset'])
});

export const voiceTranscriptionSchema = z.object({
  audioBase64: z.string().min(1).max(25_000_000),
  mimeType: z.string().trim().min(1).max(120),
  fileName: z.string().trim().min(1).max(260).nullable().optional()
});

export const projectUpdateSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1).max(80).optional(),
  folderPath: z.string().trim().min(1).max(4096).nullable().optional(),
  trusted: z.boolean().optional(),
  runtimeCommandPolicy: projectRuntimeCommandPolicySchema.optional(),
  runtimeNetworkPolicy: projectRuntimeNetworkPolicySchema.optional(),
  defaultProviderId: providerIdSchema.optional(),
  defaultModelId: z.string().trim().min(1).optional()
});

export const threadCreateSchema = z.object({
  projectId: z.string().min(1),
  title: z.string().trim().max(120).optional(),
  providerId: providerIdSchema,
  modelId: z.string().min(1),
  executionPermission: executionPermissionSchema.default('default')
});

export const threadIdSchema = z.object({
  threadId: z.string().min(1)
});

export const threadFollowUpKindSchema = z.enum(['follow_up', 'steer']);

export const threadFollowUpIdSchema = z.object({
  followUpId: z.string().min(1)
});

export const threadFollowUpCreateSchema = z.object({
  threadId: z.string().min(1),
  content: z.string().trim().min(1).max(40000),
  kind: threadFollowUpKindSchema.default('follow_up')
});

export const threadFollowUpUpdateSchema = z.object({
  followUpId: z.string().min(1),
  content: z.string().trim().min(1).max(40000)
});

export const threadDraftSaveSchema = z.object({
  threadId: z.string().min(1),
  prompt: z.string().max(MAX_COMPOSER_PROMPT_CHARS)
});

export const renameThreadSchema = z.object({
  threadId: z.string().min(1),
  title: z.string().trim().min(1).max(120)
});

export const duplicateThreadSchema = z.object({
  threadId: z.string().min(1),
  fromTurnId: z.string().min(1).nullable().optional()
});

const imageAttachmentSchema = z.object({
  id: z.string().min(1).max(120),
  name: z.string().trim().min(1).max(260),
  mimeType: z.string().trim().min(1).max(120),
  dataUrl: z.string().trim().startsWith('data:image/').max(8_000_000)
});

const textAttachmentSchema = z.object({
  id: z.string().min(1).max(120),
  name: z.string().trim().min(1).max(260),
  mimeType: z.literal('text/plain'),
  relativePath: z.string().trim().min(1).max(4096),
  absolutePath: z.string().trim().min(1).max(4096),
  charCount: z.number().int().min(1).max(MAX_COMPOSER_TEXT_ATTACHMENT_CHARS)
});

export const composerSubmitSchema = z.object({
  projectId: z.string().min(1),
  threadId: z.string().min(1).nullable().optional(),
  prompt: z.string().trim().min(1).max(MAX_COMPOSER_PROMPT_CHARS),
  providerId: providerIdSchema,
  modelId: z.string().min(1),
  reasoningEffort: providerReasoningEffortSchema.nullable().optional(),
  thinkingEnabled: z.boolean().optional(),
  executionPermission: executionPermissionSchema.default('default'),
  skillIds: z.array(z.string().min(1)).default([]),
  imageAttachments: z.array(imageAttachmentSchema).max(4).default([]),
  textAttachments: z.array(textAttachmentSchema).max(8).default([])
});

export const composerEnhancePromptSchema = z.object({
  prompt: z.string().trim().min(1).max(MAX_COMPOSER_PROMPT_CHARS),
  projectId: z.string().min(1).nullable().optional(),
  providerId: providerIdSchema,
  modelId: z.string().min(1),
  reasoningEffort: providerReasoningEffortSchema.nullable().optional(),
  thinkingEnabled: z.boolean().optional()
});

export const plannerSubmitSchema = composerSubmitSchema;

export const composerTextAttachmentCreateSchema = z.object({
  projectId: z.string().min(1),
  content: z.string().min(1).max(MAX_COMPOSER_TEXT_ATTACHMENT_CHARS),
  fileName: z.string().trim().min(1).max(260).nullable().optional()
});

export const composerTextAttachmentDeleteSchema = z.object({
  projectId: z.string().min(1),
  attachment: textAttachmentSchema
});

export const plannerSetModeSchema = z.object({
  threadId: z.string().min(1),
  mode: composerModeSchema
});

const plannerQuestionAnswerSchema = z.object({
  answers: z.array(z.string().trim().min(1).max(2000)).min(1).max(4)
});

export const plannerAnswerSchema = z.object({
  threadId: z.string().min(1),
  callId: z.string().trim().min(1).max(200),
  answers: z.record(z.string().min(1), plannerQuestionAnswerSchema)
});

export const plannerApprovePlanSchema = z.object({
  threadId: z.string().min(1),
  planId: z.string().min(1)
});

export const plannerCancelSchema = z.object({
  threadId: z.string().min(1)
});

export const runStopSchema = z.object({
  runId: z.string().min(1)
});

export const threadExecutionPermissionSchema = z.object({
  threadId: z.string().min(1),
  executionPermission: executionPermissionSchema
});

export const providerAuthStartSchema = z.object({
  providerId: providerIdSchema,
  mode: providerAuthModeSchema.optional(),
  force: z.boolean().optional()
});

export const providerAuthAdoptSchema = z.object({
  providerId: providerIdSchema
});

export const providerApiKeySchema = z.object({
  providerId: providerIdSchema,
  apiKey: z.string().trim().min(1).max(4096)
});

export const ollamaModelMutationSchema = z.object({
  model: z.string().trim().min(1).max(200)
});

export const skillSaveSchema = z.object({
  id: z.string().min(1).optional(),
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().min(1).max(240),
  instructions: z.string().trim().min(1).max(10000),
  scope: skillScopeSchema,
  providerTargets: z.array(providerIdSchema).min(1),
  syncTargets: z.array(providerIdSchema).optional(),
  enabled: z.boolean(),
  projectId: z.string().min(1).nullable().optional()
});

export const skillToggleSchema = z.object({
  skillId: z.string().min(1),
  enabled: z.boolean()
});

export const skillIdSchema = z.object({
  skillId: z.string().min(1)
});

export const skillSyncSchema = z.object({
  skillId: z.string().min(1),
  providerId: providerIdSchema,
  enabled: z.boolean()
});

export const skillSuggestedInstallSchema = z.object({
  installKind: z.enum(['provider_native', 'github_folder']),
  providerId: providerIdSchema.nullable().optional(),
  providerTargets: z.array(providerIdSchema).min(1).max(2).optional(),
  token: z.string().trim().min(1).max(160),
  installTarget: z.string().trim().min(1).max(2048).nullable().optional(),
  owner: z.string().trim().min(1).max(120).nullable().optional(),
  repo: z.string().trim().min(1).max(120).nullable().optional(),
  path: z.string().trim().min(1).max(512).nullable().optional(),
  name: z.string().trim().min(1).max(120).nullable().optional(),
  description: z.string().trim().min(1).max(400).nullable().optional(),
  browseUrl: z.string().trim().url().max(2048).nullable().optional(),
  category: z
    .enum(['frontend', 'backend', 'engineering', 'documents', 'design', 'testing', 'automation', 'mcp', 'templates', 'provider'])
    .nullable()
    .optional()
});

export const automationSaveSchema = z.object({
  id: z.string().min(1).optional(),
  name: z.string().trim().min(1).max(80),
  projectId: z.string().min(1),
  providerId: providerIdSchema,
  modelId: z.string().min(1),
  promptTemplate: z.string().trim().min(1).max(20000),
  skillId: z.string().min(1).nullable().optional(),
  enabled: z.boolean(),
  scheduleType: automationScheduleSchema,
  intervalMinutes: z.number().int().positive().max(24 * 60).nullable().optional()
});

export const automationIdSchema = z.object({
  automationId: z.string().min(1)
});

export const vicodeBuildTeamIdSchema = z.string().trim().min(1).max(80);
export const vicodeBuildLaneIdSchema = z.enum(['planner', 'builder', 'finisher']);
export const vicodeBuildProjectSchema = z.object({
  projectId: z.string().min(1).nullable()
});
export const vicodeBuildPlanCreateSchema = z.object({
  projectId: z.string().min(1),
  goal: z.string().trim().min(1).max(4000),
  name: z.string().trim().max(120).optional(),
  worktreePath: z.string().trim().max(400).optional()
});
export const vicodeBuildPlanDraftSchema = z.object({
  projectId: z.string().min(1),
  goal: z.string().trim().min(1).max(4000)
});
export const vicodeBuildPlanFromThreadSchema = z.object({
  threadId: z.string().min(1)
});
export const vicodeBuildTeamPauseSchema = z.object({
  projectId: z.string().min(1),
  teamId: vicodeBuildTeamIdSchema,
  paused: z.boolean()
});
export const vicodeBuildLaneActionSchema = z.object({
  projectId: z.string().min(1),
  teamId: vicodeBuildTeamIdSchema,
  laneId: vicodeBuildLaneIdSchema
});
export const vicodeBuildClearPlansSchema = z.object({
  projectId: z.string().min(1)
});

export const automationToggleSchema = z.object({
  automationId: z.string().min(1),
  enabled: z.boolean()
});

export const reviewItemIdSchema = z.object({
  reviewItemId: z.string().min(1)
});

export const runToolApprovalIdSchema = z.object({
  approvalId: z.string().min(1)
});

export const reviewDraftUpdateSchema = z.object({
  reviewItemId: z.string().min(1),
  content: z.string().trim().min(1).max(40000)
});

export const diagnosticsCompactionSchema = z.object({}).strict();
export const diagnosticsMaintenanceSchema = z.object({
  vacuum: z.boolean().optional()
}).strict();

export const mcpServerIdSchema = z.object({
  serverId: z.string().min(1)
});

export const mcpRecommendedSetupSchema = z.object({
  entryId: z.string().trim().min(1).max(120),
  projectId: z.string().trim().min(1).max(120).nullable().optional()
});

export const mcpServerSaveSchema = z.object({
  id: z.string().min(1).optional(),
  name: z.string().trim().min(1).max(80),
  scope: z.enum(['global', 'project']).default('global'),
  projectId: z.string().trim().min(1).max(120).nullable().optional(),
  transportType: mcpServerTransportTypeSchema.default('stdio'),
  command: z.string().trim().min(1).max(4096),
  args: z.array(z.string().max(4096)).default([]),
  cwd: z.string().trim().min(1).max(4096).nullable().optional(),
  env: z.record(z.string().min(1).max(256), z.string().max(8192)).default({}),
  enabled: z.boolean(),
  toolInvocationMode: mcpPermissionModeSchema.default('ask'),
  launchApproved: z.boolean().optional()
});

export const mcpServerEnabledSchema = z.object({
  serverId: z.string().min(1),
  enabled: z.boolean()
});

export const subagentIdSchema = z.object({
  subagentId: z.string().min(1)
});

export const subagentListSchema = z.object({
  threadId: z.string().min(1)
});

export const subagentSpawnSchema = z.object({
  parentThreadId: z.string().min(1),
  parentRunId: z.string().min(1).nullable().optional(),
  name: z.string().trim().min(1).max(48).optional(),
  title: z.string().trim().min(1).max(120),
  prompt: z.string().trim().min(1).max(16000),
  providerId: providerIdSchema.optional(),
  modelId: z.string().trim().min(1).max(240).optional(),
  reasoningEffort: providerReasoningEffortSchema.nullable().optional(),
  executionPermission: executionPermissionSchema.optional(),
  delegationProfile: z.enum(['heartbeat', 'research', 'implement', 'verify']).optional()
});

export const preferenceSaveSchema = z.object({
  selectedProjectId: z.string().min(1).nullable().optional(),
  defaultProviderId: providerIdSchema.optional(),
  defaultModelByProvider: z
    .object({
      openai: z.string().min(1),
      gemini: z.string().min(1),
      qwen: z.string().min(1),
      ollama: z.string().min(1),
      kimi: z.string().min(1)
    })
    .optional(),
  defaultReasoningEffortByProvider: z
    .object({
      openai: providerReasoningEffortSchema.nullable(),
      gemini: providerReasoningEffortSchema.nullable(),
      qwen: providerReasoningEffortSchema.nullable(),
      ollama: providerReasoningEffortSchema.nullable(),
      kimi: providerReasoningEffortSchema.nullable()
    })
    .optional(),
  defaultThinkingByProvider: z
    .object({
      openai: z.boolean(),
      gemini: z.boolean(),
      qwen: z.boolean(),
      ollama: z.boolean(),
      kimi: z.boolean()
    })
    .optional(),
  ollamaTransportMode: ollamaTransportModeSchema.optional(),
  defaultExecutionPermission: executionPermissionSchema.optional(),
  followUpBehavior: followUpBehaviorSchema.optional(),
  generatedMemoryUseEnabled: z.boolean().optional(),
  generatedMemoryGenerationEnabled: z.boolean().optional(),
  appearanceMode: appearanceModeSchema.optional(),
  accentMode: accentModeSchema.optional(),
  accentColor: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/u, 'Accent color must be a #RRGGBB value.')
    .nullable()
    .optional(),
  onboardingComplete: z.boolean().optional(),
  lastOpenedThreadId: z.string().min(1).nullable().optional(),
  microphoneAllowed: z.boolean().optional()
});

export const personalizationSaveSchema = z.object({
  globalInstructions: z.string().max(40000).optional(),
  providerInstructions: z
    .object({
      openai: z.string().max(40000).optional(),
      gemini: z.string().max(40000).optional(),
      qwen: z.string().max(40000).optional(),
      ollama: z.string().max(40000).optional(),
      kimi: z.string().max(40000).optional()
    })
    .optional(),
  useWorkspaceInstructions: z.boolean().optional()
});

export const archivedThreadsListSchema = z.object({
  projectId: z.string().min(1).nullable().optional()
});

export const collabConfigSaveSchema = z.object({
  supabaseUrl: z.string().trim().url().max(2048),
  supabaseAnonKey: z.string().trim().min(1).max(8192)
});

export const collabRoomIdSchema = z.object({
  roomId: z.string().min(1)
});

export const collabCreateGuestProfileSchema = z.object({
  displayName: z.string().trim().min(1).max(120),
  handle: z.string().trim().min(1).max(120).nullable().optional(),
  avatarUrl: z.string().trim().url().max(4096).nullable().optional()
});

export const collabUpdateProfileSchema = z.object({
  displayName: z.string().trim().min(1).max(120).optional(),
  handle: z.string().trim().min(1).max(120).nullable().optional(),
  avatarUrl: z.string().trim().url().max(4096).nullable().optional(),
  bio: z.string().trim().max(1000).nullable().optional(),
  timezone: z.string().trim().max(120).nullable().optional(),
  status: collabPresenceStatusSchema.optional()
});

export const collabCreateRoomSchema = z.object({
  name: z.string().trim().min(1).max(120),
  password: z
    .string()
    .trim()
    .max(200)
    .nullable()
    .optional()
    .refine((value) => value == null || value.length === 0 || value.length >= 3, 'Room password must be at least 3 characters when set.'),
  topic: z.string().trim().max(240).nullable().optional(),
  projectLabel: z.string().trim().max(120).nullable().optional()
});

export const collabJoinRoomSchema = z.object({
  joinCode: z.string().trim().min(4).max(120),
  password: z
    .string()
    .trim()
    .max(200)
    .nullable()
    .optional()
    .refine((value) => value == null || value.length === 0 || value.length >= 3, 'Room password must be at least 3 characters when set.')
});

export const collabCreateDirectChatSchema = z.object({
  peerUserId: z.string().trim().min(1).max(200)
});

export const collabSetFollowingSchema = z.object({
  roomId: z.string().min(1),
  following: z.boolean()
});

export const collabRequestRoleSchema = z.object({
  roomId: z.string().min(1),
  requestedRole: z.enum(['contributor', 'driver'])
});

export const collabResolveRoleRequestSchema = z.object({
  roomId: z.string().min(1),
  requestId: z.string().min(1),
  status: z.enum(['approved', 'declined'])
});

export const collabSetTerminalModeSchema = z.object({
  roomId: z.string().min(1),
  mode: z.enum(['off', 'announce_only']),
  note: z.string().trim().max(400).nullable().optional()
});

export const collabSendMessageSchema = z.object({
  roomId: z.string().min(1),
  body: z.string().trim().min(1).max(4000)
});

export const collabSetPresenceSchema = z.object({
  roomId: z.string().min(1),
  status: collabPresenceStatusSchema,
  currentThreadId: z.string().min(1).nullable().optional(),
  currentThreadTitle: z.string().trim().max(200).nullable().optional(),
  branchName: z.string().trim().max(200).nullable().optional(),
  worktreeName: z.string().trim().max(200).nullable().optional(),
  activeRunId: z.string().min(1).nullable().optional(),
  activeRunTitle: z.string().trim().max(200).nullable().optional(),
  dirtyFileCount: z.number().int().min(0).max(100000).default(0),
  stagedFileCount: z.number().int().min(0).max(100000).default(0)
});

export const collabShareThreadSchema = z.object({
  roomId: z.string().min(1),
  threadId: z.string().min(1),
  title: z.string().trim().min(1).max(200),
  projectId: z.string().min(1).nullable().optional(),
  projectLabel: z.string().trim().max(120).nullable().optional(),
  status: collabThreadStatusSchema.default('active'),
  providerId: providerIdSchema,
  modelId: z.string().trim().min(1).max(200),
  lastPromptSummary: z.string().trim().max(1200).nullable().optional(),
  latestAssistantSummary: z.string().trim().max(1200).nullable().optional(),
  runId: z.string().min(1).nullable().optional()
});

const runDiffStatsSchema = z.object({
  filesChanged: z.number().int().min(0),
  insertions: z.number().int().min(0),
  deletions: z.number().int().min(0)
});

export const collabShareRunSchema = z.object({
  roomId: z.string().min(1),
  threadId: z.string().min(1),
  threadTitle: z.string().trim().min(1).max(200),
  runId: z.string().min(1),
  providerId: providerIdSchema,
  modelId: z.string().trim().min(1).max(200),
  executionPermission: executionPermissionSchema,
  status: collabRunStatusSchema,
  taskTitle: z.string().trim().max(200).nullable().optional(),
  summary: z.string().trim().max(4000).nullable().optional(),
  changedFiles: z.array(z.string().trim().min(1).max(4096)).max(200).default([]),
  diffStats: runDiffStatsSchema.nullable().optional(),
  testsSummary: z.string().trim().max(2000).nullable().optional(),
  resultLabel: z.string().trim().max(200).nullable().optional(),
  completedAt: z.string().datetime().nullable().optional()
});

export const collabCreateHandoffSchema = z.object({
  roomId: z.string().min(1),
  threadId: z.string().min(1),
  runId: z.string().min(1).nullable().optional(),
  title: z.string().trim().min(1).max(200),
  summary: z.string().trim().min(1).max(4000),
  branchName: z.string().trim().max(200).nullable().optional(),
  dirtyFileCount: z.number().int().min(0).max(100000).default(0),
  stagedFileCount: z.number().int().min(0).max(100000).default(0),
  changedFiles: z.array(z.string().trim().min(1).max(4096)).max(200).default([]),
  outstandingTasks: z.array(z.string().trim().min(1).max(1000)).max(20).default([]),
  recommendedNextPrompt: z.string().trim().max(4000).nullable().optional()
});
