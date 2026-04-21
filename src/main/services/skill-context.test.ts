import { describe, expect, it, vi } from 'vitest';
import type { SkillDefinition } from '../../shared/domain';
import { SkillContextService } from './skill-context';

function createSkill(overrides: Partial<SkillDefinition> = {}): SkillDefinition {
  return {
    id: 'skill-1',
    name: 'Reviewer',
    description: 'Review the patch.',
    instructions: 'Look for regressions.',
    origin: 'custom_local',
    scope: 'project',
    providerTargets: ['openai'],
    enabled: true,
    projectId: 'project-1',
    metadata: { slug: 'reviewer', attachMode: 'prompt', kind: 'skill' },
    path: null,
    createdAt: '2026-03-17T00:00:00.000Z',
    updatedAt: '2026-03-17T00:00:00.000Z',
    ...overrides
  };
}

describe('SkillContextService', () => {
  it('resolves explicit and mentioned skills using provider, scope, and enabled filters', () => {
    const reviewer = createSkill();
    const browserHelper = createSkill({
      id: 'skill-2',
      name: 'Browser Helper',
      description: 'Use browser helper.',
      metadata: {
        slug: 'browser-helper',
        attachMode: 'runtime',
        kind: 'extension',
        providerOrigin: 'openai'
      },
      path: 'C:/skills/browser-helper'
    });
    const disabled = createSkill({
      id: 'skill-3',
      name: 'Disabled',
      enabled: false,
      metadata: { slug: 'disabled', attachMode: 'prompt', kind: 'skill' }
    });
    const otherProject = createSkill({
      id: 'skill-4',
      name: 'Other Project',
      projectId: 'project-2',
      metadata: { slug: 'other-project', attachMode: 'prompt', kind: 'skill' }
    });
    const db = {
      listSkills: vi.fn(() => [reviewer, browserHelper, disabled, otherProject])
    };
    const service = new SkillContextService(db as never);

    const resolved = service.resolve({
      projectId: 'project-1',
      providerId: 'openai',
      prompt: 'Use $reviewer and $browser-helper.',
      explicitSkillIds: ['skill-1']
    });

    expect(resolved.selectedSkillIds).toEqual(['skill-1', 'skill-2']);
    expect(resolved.mentionedSkillIds).toEqual(['skill-1', 'skill-2']);
    expect(resolved.promptSkills.map((skill) => skill.id)).toEqual(['skill-1']);
    expect(resolved.runtimeSkills.map((skill) => skill.id)).toEqual(['skill-2']);
  });

  it('formats and resolves provider-native runtime skill resources', () => {
    const browserHelper = createSkill({
      id: 'skill-2',
      name: 'Browser Helper',
      description: 'Use browser helper.',
      metadata: {
        slug: 'browser-helper',
        attachMode: 'runtime',
        kind: 'extension',
        providerOrigin: 'openai'
      },
      path: 'C:/skills/browser-helper'
    });
    const db = {
      listSkills: vi.fn(() => [browserHelper])
    };
    const service = new SkillContextService(db as never);

    expect(service.formatPromptSkillSection([createSkill()])).toContain('## Reviewer ($reviewer)');
    expect(service.formatPromptSkillSection([createSkill()])).toContain(
      'These instructions are already attached to this run. Do not call provider CLIs, shell commands, or activation commands to enable them.'
    );
    expect(service.formatRuntimeSkillSection('openai', [browserHelper])).toContain('Browser Helper ($browser-helper)');
    expect(service.resolveRuntimeSkillResources([browserHelper], 'openai')).toEqual([
      {
        kind: 'extension',
        path: 'C:/skills/browser-helper'
      }
    ]);
  });

  it('drops runtime skill resources that cannot be attached for the active provider', () => {
    const valid = createSkill({
      id: 'skill-valid',
      name: 'Browser Helper',
      metadata: {
        slug: 'browser-helper',
        attachMode: 'runtime',
        kind: 'extension',
        providerOrigin: 'openai'
      },
      path: 'C:/skills/browser-helper'
    });
    const wrongProvider = createSkill({
      id: 'skill-gemini',
      name: 'Gemini Helper',
      metadata: {
        slug: 'gemini-helper',
        attachMode: 'runtime',
        kind: 'extension',
        providerOrigin: 'gemini'
      },
      path: 'C:/skills/gemini-helper'
    });
    const missingPath = createSkill({
      id: 'skill-missing',
      name: 'Missing Helper',
      metadata: {
        slug: 'missing-helper',
        attachMode: 'runtime',
        kind: 'extension',
        providerOrigin: 'openai'
      },
      path: null
    });
    const blankPath = createSkill({
      id: 'skill-blank',
      name: 'Blank Helper',
      metadata: {
        slug: 'blank-helper',
        attachMode: 'runtime',
        kind: 'extension',
        providerOrigin: 'openai'
      },
      path: '   '
    });
    const db = {
      listSkills: vi.fn(() => [valid, wrongProvider, missingPath, blankPath])
    };
    const service = new SkillContextService(db as never);

    expect(service.resolveRuntimeSkillResources([valid, wrongProvider, missingPath, blankPath], 'openai')).toEqual([
      {
        kind: 'extension',
        path: 'C:/skills/browser-helper'
      }
    ]);
  });
});
