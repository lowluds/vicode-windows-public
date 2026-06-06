import { describe, expect, it } from 'vitest';
import {
  automationSaveSchema,
  composerSubmitSchema,
  executionPermissionSchema,
  plannerAnswerSchema,
  plannerSetModeSchema,
  preferenceSaveSchema,
  projectCreateSchema,
  projectIdValueSchema,
  providerIdSchema,
  skillSaveSchema,
  skillSuggestedInstallSchema,
  threadFollowUpCreateSchema,
  threadFollowUpIdSchema,
  threadFollowUpUpdateSchema,
  threadCreateSchema,
  worktreeHunkApplySchema,
  worktreeHunkRejectSchema,
  worktreeReviewSchema
} from './schemas';
import { MAX_COMPOSER_PROMPT_CHARS } from './domain';

describe('shared schemas', () => {
  it('accepts valid project input', () => {
    const result = projectCreateSchema.parse({
      name: 'Workspace',
      folderPath: 'C:/code/workspace',
      trusted: true,
      runtimeCommandPolicy: 'auto_approve'
    });

    expect(result.name).toBe('Workspace');
    expect(result.runtimeCommandPolicy).toBe('auto_approve');
  });

  it('validates raw IPC identifier values', () => {
    expect(projectIdValueSchema.parse('project-1')).toBe('project-1');
    expect(providerIdSchema.parse('openai')).toBe('openai');
    expect(() => projectIdValueSchema.parse('')).toThrow();
    expect(() => providerIdSchema.parse('anthropic')).toThrow();
  });

  it('accepts planner mode and answer payloads', () => {
    expect(executionPermissionSchema.parse('full_access')).toBe('full_access');

    expect(
      plannerSetModeSchema.parse({
        threadId: crypto.randomUUID(),
        mode: 'plan'
      }).mode
    ).toBe('plan');

    expect(
      plannerAnswerSchema.parse({
        threadId: crypto.randomUUID(),
        callId: 'call-1',
        answers: {
          scope: {
            answers: ['Quality']
          }
        }
      }).callId
    ).toBe('call-1');
  });

  it('rejects blank prompt input', () => {
    expect(() =>
      composerSubmitSchema.parse({
        projectId: crypto.randomUUID(),
        providerId: 'gemini',
        modelId: 'gemini-2.5-pro',
        executionPermission: 'default',
        prompt: ''
      })
    ).toThrow();
  });

  it('accepts large composer prompts up to the shared limit', () => {
    const prompt = 'a'.repeat(MAX_COMPOSER_PROMPT_CHARS);
    expect(
      composerSubmitSchema.parse({
        projectId: crypto.randomUUID(),
        providerId: 'openai',
        modelId: 'gpt-5',
        executionPermission: 'default',
        prompt
      }).prompt
    ).toHaveLength(MAX_COMPOSER_PROMPT_CHARS);
  });

  it('preserves composer execution constraints for provider tool policy', () => {
    const parsed = composerSubmitSchema.parse({
      projectId: crypto.randomUUID(),
      providerId: 'ollama',
      modelId: 'qwen2.5-coder:7b',
      executionPermission: 'full_access',
      prompt: 'Run npm test only.',
      executionConstraints: {
        permissionMode: 'default',
        toolPolicy: {
          preset: 'default',
          allowedToolCallNames: ['run_command'],
          disallowedToolCallNames: []
        },
        maxTurns: null,
        maxReasoningTokens: null,
        taskBudgetTokens: null,
        costBudgetUsd: null,
        maxDelegationDepth: 0,
        maxAutomaticRetries: null,
        maxUnchangedHandoffs: null,
        maxSiblingDelegates: null
      }
    });

    expect(parsed.executionConstraints?.toolPolicy.allowedToolCallNames).toEqual(['run_command']);
    expect(parsed.executionConstraints?.maxDelegationDepth).toBe(0);
  });

  it('defaults composer isolation mode to direct workspace and accepts explicit isolation modes', () => {
    expect(
      composerSubmitSchema.parse({
        projectId: crypto.randomUUID(),
        providerId: 'openai',
        modelId: 'gpt-5',
        executionPermission: 'default',
        prompt: 'Update the helper.'
      }).isolationMode
    ).toBe('direct_workspace');

    expect(
      composerSubmitSchema.parse({
        projectId: crypto.randomUUID(),
        providerId: 'openai',
        modelId: 'gpt-5',
        executionPermission: 'default',
        isolationMode: 'patch_buffer',
        prompt: 'Update the helper.'
      }).isolationMode
    ).toBe('patch_buffer');

    expect(
      composerSubmitSchema.parse({
        projectId: crypto.randomUUID(),
        providerId: 'openai',
        modelId: 'gpt-5',
        executionPermission: 'default',
        isolationMode: 'git_worktree',
        prompt: 'Update the helper.'
      }).isolationMode
    ).toBe('git_worktree');
  });

  it('validates worktree hunk review actions without accepting file contents or roots', () => {
    expect(
      worktreeHunkApplySchema.parse({
        threadId: 'thread-1',
        runId: 'run-1',
        acceptedHunkIds: ['hunk-1'],
        rejectedHunkIds: ['hunk-2'],
        sourceWorkspaceRoot: 'C:/must-not-cross',
        beforeContent: 'must-not-cross'
      })
    ).toEqual({
      threadId: 'thread-1',
      runId: 'run-1',
      acceptedHunkIds: ['hunk-1'],
      rejectedHunkIds: ['hunk-2']
    });

    expect(
      worktreeHunkApplySchema.parse({
        threadId: 'thread-1',
        runId: 'run-1',
        acceptedHunkIds: ['hunk-1']
      }).rejectedHunkIds
    ).toEqual([]);

    expect(
      worktreeHunkRejectSchema.parse({
        threadId: 'thread-1',
        runId: 'run-1',
        hunkIds: ['hunk-1'],
        afterContent: 'must-not-cross'
      })
    ).toEqual({
      threadId: 'thread-1',
      runId: 'run-1',
      hunkIds: ['hunk-1']
    });

    expect(
      worktreeReviewSchema.parse({
        threadId: 'thread-1',
        runId: 'run-1',
        worktreeWorkspaceRoot: 'C:/must-not-cross'
      })
    ).toEqual({
      threadId: 'thread-1',
      runId: 'run-1'
    });

    expect(() =>
      worktreeHunkApplySchema.parse({
        threadId: 'thread-1',
        runId: 'run-1',
        acceptedHunkIds: []
      })
    ).toThrow();
    expect(() =>
      worktreeHunkRejectSchema.parse({
        threadId: 'thread-1',
        runId: 'run-1',
        hunkIds: []
      })
    ).toThrow();
  });

  it('rejects composer prompts above the shared limit', () => {
    const prompt = 'a'.repeat(MAX_COMPOSER_PROMPT_CHARS + 1);
    expect(() =>
      composerSubmitSchema.parse({
        projectId: crypto.randomUUID(),
        providerId: 'openai',
        modelId: 'gpt-5',
        executionPermission: 'default',
        prompt
      })
    ).toThrow();
  });

  it('accepts thread and skill payloads', () => {
    expect(
      threadCreateSchema.parse({
        projectId: crypto.randomUUID(),
        title: 'New thread',
        providerId: 'openai',
        modelId: 'gpt-5',
        executionPermission: 'full_access'
      }).providerId
    ).toBe('openai');

    expect(
      skillSaveSchema.parse({
        name: 'Reviewer',
        description: 'Finds issues',
        instructions: 'Review code critically.',
        scope: 'global',
        projectId: null,
        enabled: true,
        providerTargets: ['openai', 'gemini']
      }).providerTargets
    ).toHaveLength(2);

  });

  it('accepts qwen and kimi-specific preference payloads', () => {
    expect(
      composerSubmitSchema.parse({
        projectId: crypto.randomUUID(),
        providerId: 'qwen',
        modelId: 'qwen3.5-plus',
        executionPermission: 'default',
        prompt: 'Explain the repo structure.',
        thinkingEnabled: true
      }).thinkingEnabled
    ).toBe(true);

    expect(
      preferenceSaveSchema.parse({
        defaultThinkingByProvider: {
          openai: false,
          gemini: false,
          qwen: true,
          ollama: false,
          kimi: false
        }
      }).defaultThinkingByProvider?.qwen
    ).toBe(true);

    expect(
      preferenceSaveSchema.parse({
        defaultModelByProvider: {
          openai: 'gpt-5',
          gemini: 'auto-gemini-2.5',
          qwen: 'qwen3.5-plus',
          ollama: 'qwen3',
          kimi: 'kimi-k2-thinking'
        }
      }).defaultModelByProvider?.kimi
    ).toBe('kimi-k2-thinking');

    expect(
      preferenceSaveSchema.parse({
        followUpBehavior: 'steer'
      }).followUpBehavior
    ).toBe('steer');

    expect(
      preferenceSaveSchema.parse({
        appearanceMode: 'light'
      }).appearanceMode
    ).toBe('light');

    expect(
      skillSaveSchema.parse({
        name: 'Qwen Helper',
        description: 'Assist Qwen runs',
        instructions: 'Be concise.',
        scope: 'global',
        projectId: null,
        enabled: true,
        providerTargets: ['qwen']
      }).providerTargets
    ).toEqual(['qwen']);

    expect(
      automationSaveSchema.parse({
        name: 'Qwen audit',
        promptTemplate: 'Summarize the repo state.',
        scheduleType: 'manual',
        projectId: crypto.randomUUID(),
        providerId: 'qwen',
        modelId: 'qwen3.5-plus',
        skillId: null,
        enabled: true
      }).providerId
    ).toBe('qwen');

    expect(
      automationSaveSchema.parse({
        name: 'Kimi audit',
        promptTemplate: 'Summarize the repo state.',
        scheduleType: 'manual',
        projectId: crypto.randomUUID(),
        providerId: 'kimi',
        modelId: 'kimi-k2-thinking',
        skillId: null,
        enabled: true
      }).providerId
    ).toBe('kimi');
  });

  it('accepts while-open automation payloads', () => {
    expect(
      automationSaveSchema.parse({
        name: 'Morning check',
        promptTemplate: 'Summarize open work.',
        scheduleType: 'interval_while_app_open',
        projectId: crypto.randomUUID(),
        providerId: 'gemini',
        modelId: 'gemini-2.5-flash',
        skillId: null,
        intervalMinutes: 60,
        enabled: true
      }).intervalMinutes
    ).toBe(60);
  });

  it('accepts only Vicode-managed suggested skill imports', () => {
    const parsed = skillSuggestedInstallSchema.parse({
      installKind: 'github_folder',
      providerId: 'openai',
      providerTargets: ['openai', 'gemini'],
      token: 'react-best-practices',
      installTarget: 'https://github.com/vercel-labs/agent-skills/tree/main/skills/react-best-practices',
      owner: 'vercel-labs',
      repo: 'agent-skills',
      path: 'skills/react-best-practices',
      name: 'React Best Practices',
      description: 'React and Next.js guidance.',
      browseUrl: 'https://github.com/vercel-labs/agent-skills/tree/main/skills/react-best-practices'
    });
    expect(parsed.installKind).toBe('github_folder');
    expect(parsed).not.toHaveProperty('providerId');
    expect(parsed).not.toHaveProperty('installTarget');

    expect(() =>
      skillSuggestedInstallSchema.parse({
        installKind: 'provider_native',
        providerId: 'openai',
        token: 'pdf'
      })
    ).toThrow();

    expect(() =>
      skillSuggestedInstallSchema.parse({
        installKind: 'provider_reference',
        providerId: 'gemini',
        token: 'context7'
      })
    ).toThrow();
  });

  it('accepts follow-up queue payloads', () => {
    expect(
      threadFollowUpCreateSchema.parse({
        threadId: crypto.randomUUID(),
        content: 'Queue this for the next turn.'
      }).kind
    ).toBe('follow_up');

    expect(
      threadFollowUpCreateSchema.parse({
        threadId: crypto.randomUUID(),
        content: 'Steer toward tests.',
        kind: 'steer'
      }).kind
    ).toBe('steer');

    expect(
      threadFollowUpUpdateSchema.parse({
        followUpId: crypto.randomUUID(),
        content: 'Updated queued message.'
      }).content
    ).toBe('Updated queued message.');

    expect(
      threadFollowUpIdSchema.parse({
        followUpId: crypto.randomUUID()
      }).followUpId
    ).toBeTypeOf('string');
  });

  it('rejects blank follow-up queue payloads', () => {
    expect(() =>
      threadFollowUpCreateSchema.parse({
        threadId: crypto.randomUUID(),
        content: '   '
      })
    ).toThrow();

    expect(() =>
      threadFollowUpUpdateSchema.parse({
        followUpId: crypto.randomUUID(),
        content: ''
      })
    ).toThrow();
  });
});
