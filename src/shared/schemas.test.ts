import { describe, expect, it } from 'vitest';
import {
  automationSaveSchema,
  composerSubmitSchema,
  executionPermissionSchema,
  plannerAnswerSchema,
  plannerSetModeSchema,
  preferenceSaveSchema,
  projectCreateSchema,
  skillSaveSchema,
  skillSyncSchema,
  threadFollowUpCreateSchema,
  threadFollowUpIdSchema,
  threadFollowUpUpdateSchema,
  threadCreateSchema
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
        providerTargets: ['openai', 'gemini'],
        syncTargets: ['openai']
      }).providerTargets
    ).toHaveLength(2);

    expect(
      skillSyncSchema.parse({
        skillId: crypto.randomUUID(),
        providerId: 'qwen',
        enabled: true
      }).providerId
    ).toBe('qwen');
  });

  it('accepts qwen and kimi-specific preference and personalization payloads', () => {
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
        providerTargets: ['qwen'],
        syncTargets: []
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
