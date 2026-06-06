import { describe, expect, it } from 'vitest';
import type { ProviderDescriptor, ProviderId, SkillDefinition } from '../../shared/domain';
import {
  compareComposerSkills,
  getAttachedComposerSkills,
  getMentionSkillSuggestions,
  providerInstallActionLabel,
  providerMenuSummary,
  shouldClearPromptOptimistically,
  shouldPromotePastedTextToAttachment,
  suggestedPastedTextAttachmentName
} from './ComposerPanel.model';

function createProvider(input: Partial<ProviderDescriptor> & { id: ProviderId }): ProviderDescriptor {
  return {
    id: input.id,
    label: input.label ?? input.id,
    authState: input.authState ?? 'authenticated',
    authMode: input.authMode ?? 'oauth',
    installed: input.installed ?? true,
    models: input.models ?? [],
    modelSource: input.modelSource ?? 'static',
    modelsUpdatedAt: input.modelsUpdatedAt ?? null,
    canLiveDiscoverModels: input.canLiveDiscoverModels ?? true,
    cliPath: input.cliPath ?? null,
    capabilities: input.capabilities ?? {
      supportsImages: false,
      supportsPromptCache: false,
      supportsReasoningEffort: false,
      supportsThinkingToggle: false,
      supportsPlanMode: false,
      supportsNativeTools: true,
      supportsStructuredJson: false
    },
    plannerPolicy: input.plannerPolicy ?? {
      defaultPlannerMode: 'disabled',
      supportsPlanMode: false,
      requiresPlanMode: false
    },
    message: input.message
  };
}

function createSkill(input: {
  id: string;
  name: string;
  providerTargets: ProviderId[];
  scope?: SkillDefinition['scope'];
  providerOrigin?: ProviderId | null;
}): SkillDefinition {
  return {
    id: input.id,
    name: input.name,
    description: `${input.name} description`,
    instructions: `Use ${input.name}.`,
    origin: input.providerOrigin ? 'provider_native' : 'custom_local',
    scope: input.scope ?? 'global',
    providerTargets: input.providerTargets,
    enabled: true,
    projectId: input.scope === 'project' ? 'project-1' : null,
    metadata: {
      slug: input.name.toLowerCase().replace(/\s+/g, '-'),
      providerOrigin: input.providerOrigin ?? null
    },
    path: null,
    createdAt: '2026-05-23T00:00:00.000Z',
    updatedAt: '2026-05-23T00:00:00.000Z'
  };
}

describe('ComposerPanel model helpers', () => {
  it('summarizes selected and unselected providers for the model menu', () => {
    const openai = createProvider({
      id: 'openai',
      models: [{ id: 'gpt-5', label: 'GPT-5', description: 'Default model.' }]
    });
    const gemini = createProvider({
      id: 'gemini',
      installed: false,
      authState: 'missing_cli',
      authMode: null
    });

    expect(providerMenuSummary([openai, gemini], openai, 'openai', 'GPT-5')).toBe('GPT-5');
    expect(providerMenuSummary([openai, gemini], gemini, 'openai', null)).toBe('Provider retired');
    expect(providerInstallActionLabel(gemini)).toBe('Unavailable');
  });

  it('orders composer skills by Vicode/project first, then provider-origin skills', () => {
    const projectSkill = createSkill({ id: 'project', name: 'Project Review', scope: 'project', providerTargets: ['openai'] });
    const globalSkill = createSkill({ id: 'global', name: 'Global Review', providerTargets: ['openai'] });
    const providerSkill = createSkill({ id: 'provider', name: 'Gemini Native', providerTargets: ['gemini'], providerOrigin: 'gemini' });

    expect([providerSkill, globalSkill, projectSkill].sort(compareComposerSkills).map((skill) => skill.id)).toEqual([
      'project',
      'global',
      'provider'
    ]);
  });

  it('derives attached and mentionable skills without leaking incompatible providers', () => {
    const openaiSkill = createSkill({ id: 'openai-skill', name: 'Frontend Polish', providerTargets: ['openai'] });
    const geminiSkill = createSkill({ id: 'gemini-skill', name: 'Gemini Notes', providerTargets: ['gemini'] });
    const installedSkills = [openaiSkill, geminiSkill];

    expect(getAttachedComposerSkills(['missing', 'openai-skill'], installedSkills)).toEqual([openaiSkill]);
    expect(getMentionSkillSuggestions(installedSkills, 'front')).toEqual([openaiSkill]);
    expect(getMentionSkillSuggestions(installedSkills, '')).toEqual(installedSkills);
  });

  it('keeps slash commands from clearing prompt drafts until the command resolves', () => {
    expect(shouldClearPromptOptimistically(null, 'Fix the tests')).toBe(true);
    expect(shouldClearPromptOptimistically('enhance', 'Fix the tests')).toBe(false);
    expect(shouldClearPromptOptimistically(null, '/plan Fix the tests')).toBe(false);
  });

  it('promotes large pasted context into text attachments with a stable suggested name', () => {
    expect(shouldPromotePastedTextToAttachment('short paste', 10, true)).toBe(false);
    expect(shouldPromotePastedTextToAttachment('x'.repeat(100_000), 10, true)).toBe(true);
    expect(shouldPromotePastedTextToAttachment('x'.repeat(100_000), 10, false)).toBe(false);
    expect(suggestedPastedTextAttachmentName('Long heading for context\nrest')).toBe('Long heading for context.txt');
    expect(suggestedPastedTextAttachmentName('\n')).toBe('pasted-context.txt');
  });
});
