import { z } from 'zod';
import { MAX_COMPOSER_PROMPT_CHARS, MAX_COMPOSER_TEXT_ATTACHMENT_CHARS, PROVIDER_IDS } from './domain';

export const providerIdSchema = z.enum(PROVIDER_IDS);
export const providerAuthModeSchema = z.enum(['cli', 'api_key']);
export const skillScopeSchema = z.enum(['global', 'project']);
export const automationScheduleSchema = z.enum(['manual', 'interval_while_app_open']);
export const composerModeSchema = z.enum(['default', 'plan']);
export const executionPermissionSchema = z.enum(['default', 'full_access']);
export const harnessIsolationModeSchema = z.enum(['direct_workspace', 'patch_buffer', 'git_worktree']);
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
export const customProviderTransportKindSchema = z.literal('openai_compatible_chat');
export const mcpServerTransportTypeSchema = z.enum(['stdio', 'streamable_http', 'sse']);
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

export const projectIdValueSchema = z.string().min(1);
export const projectIdSchema = z.object({
  projectId: projectIdValueSchema
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

const agentToolPresetSchema = z.enum(['default', 'planner', 'subagent']);

const toolConstraintPolicySchema = z.object({
  preset: agentToolPresetSchema,
  allowedToolCallNames: z.array(z.string().trim().min(1).max(120)).default([]),
  disallowedToolCallNames: z.array(z.string().trim().min(1).max(120)).default([])
});

const nullableNonNegativeNumberSchema = z.number().min(0).nullable();

const agentExecutionConstraintsSchema = z.object({
  permissionMode: z.enum(['default', 'plan', 'bypassPermissions']),
  toolPolicy: toolConstraintPolicySchema,
  maxTurns: nullableNonNegativeNumberSchema,
  maxReasoningTokens: nullableNonNegativeNumberSchema,
  taskBudgetTokens: nullableNonNegativeNumberSchema,
  costBudgetUsd: nullableNonNegativeNumberSchema,
  maxDelegationDepth: nullableNonNegativeNumberSchema,
  maxAutomaticRetries: nullableNonNegativeNumberSchema,
  maxUnchangedHandoffs: nullableNonNegativeNumberSchema,
  maxSiblingDelegates: nullableNonNegativeNumberSchema
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
  isolationMode: harnessIsolationModeSchema.default('direct_workspace'),
  executionConstraints: agentExecutionConstraintsSchema.nullable().optional(),
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

export const customProviderSettingsSaveSchema = z.object({
  id: z.string().min(1).optional(),
  name: z.string().trim().min(1).max(80),
  transportKind: customProviderTransportKindSchema,
  baseUrl: z.string().trim().url().max(2048),
  apiKey: z.string().trim().min(1).max(8192),
  defaultModelId: z.string().trim().min(1).max(240),
  enabled: z.boolean()
});

export const customProviderIdSchema = z.object({
  providerId: z.string().min(1).max(160)
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

export const skillSuggestedInstallSchema = z.object({
  installKind: z.literal('github_folder'),
  providerTargets: z.array(providerIdSchema).min(1).max(2).optional(),
  token: z.string().trim().min(1).max(160),
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

const stagedWorkspaceReviewFields = {
  threadId: z.string().min(1),
  runId: z.string().min(1),
  stagedEventId: z.string().min(1).nullable().optional(),
  stagedEventIndex: z.number().int().min(0).nullable().optional()
};

function requireStagedWorkspaceSelector(
  value: {
    stagedEventId?: string | null;
    stagedEventIndex?: number | null;
  },
  context: z.RefinementCtx
) {
    if (value.stagedEventId || typeof value.stagedEventIndex === 'number') {
      return;
    }

    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'stagedEventId or stagedEventIndex is required.',
      path: ['stagedEventId']
    });
}

const hunkIdSchema = z.string().trim().min(1);
const hunkIdListSchema = z.array(hunkIdSchema).min(1);

export const stagedWorkspaceReviewSchema = z
  .object(stagedWorkspaceReviewFields)
  .superRefine(requireStagedWorkspaceSelector);

export const stagedWorkspaceHunkApplySchema = z
  .object({
    ...stagedWorkspaceReviewFields,
    acceptedHunkIds: hunkIdListSchema,
    rejectedHunkIds: z.array(hunkIdSchema).optional().default([])
  })
  .superRefine(requireStagedWorkspaceSelector);

export const stagedWorkspaceHunkRejectSchema = z
  .object({
    ...stagedWorkspaceReviewFields,
    hunkIds: hunkIdListSchema
  })
  .superRefine(requireStagedWorkspaceSelector);

export const worktreeReviewSchema = z.object({
  threadId: z.string().min(1),
  runId: z.string().min(1)
});

export const worktreeHunkApplySchema = worktreeReviewSchema.extend({
  acceptedHunkIds: hunkIdListSchema,
  rejectedHunkIds: z.array(hunkIdSchema).optional().default([])
});

export const worktreeHunkRejectSchema = worktreeReviewSchema.extend({
  hunkIds: hunkIdListSchema
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
  command: z.string().trim().max(4096).default(''),
  args: z.array(z.string().max(4096)).default([]),
  cwd: z.string().trim().min(1).max(4096).nullable().optional(),
  env: z.record(z.string().min(1).max(256), z.string().max(8192)).default({}),
  url: z.string().trim().url().max(4096).nullable().optional(),
  headers: z.record(z.string().min(1).max(256), z.string().max(8192)).default({}),
  enabled: z.boolean(),
  toolInvocationMode: mcpPermissionModeSchema.default('ask'),
  launchApproved: z.boolean().optional()
}).superRefine((input, context) => {
  if (input.transportType === 'stdio' && !input.command.trim()) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['command'],
      message: 'Command is required for stdio MCP servers.'
    });
  }
  if (input.transportType !== 'stdio' && !input.url?.trim()) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['url'],
      message: 'URL is required for remote MCP servers.'
    });
  }
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
  microphoneAllowed: z.boolean().optional(),
  userLibraryPath: z.string().trim().min(1).max(4096).nullable().optional(),
  skillsLibraryPath: z.string().trim().min(1).max(4096).nullable().optional(),
  llmWikiLibraryPath: z.string().trim().min(1).max(4096).nullable().optional()
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
