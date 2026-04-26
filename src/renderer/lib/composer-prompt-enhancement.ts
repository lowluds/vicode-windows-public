import type {
  ProviderId,
  ProviderReasoningEffort,
  SkillDefinition
} from '../../shared/domain';
import { splitPromptMentionedSkills } from '../../shared/skills';

type ToastLevel = 'info' | 'warning' | 'error';

export interface ComposerPromptEnhancementHost {
  enhancePrompt(input: {
    prompt: string;
    projectId: string;
    providerId: ProviderId;
    modelId: string;
    reasoningEffort: ProviderReasoningEffort | null;
    thinkingEnabled?: boolean;
  }): Promise<{ prompt: string }>;
  setEnhancingPrompt(value: boolean): void;
  setComposerPrompt(prompt: string): void;
  clearPendingNativeCommand(): void;
  showToast(level: ToastLevel, message: string): void;
  focusComposer(): void;
}

function appendMentionedSkillTokens(prompt: string, mentionedTokens: string[]) {
  if (mentionedTokens.length === 0) {
    return prompt.trim();
  }

  const trimmedPrompt = prompt.trim();
  return `${trimmedPrompt}${trimmedPrompt ? '\n\n' : ''}${mentionedTokens.join('\n')}`;
}

export async function enhanceComposerPrompt(
  host: ComposerPromptEnhancementHost,
  input: {
    prompt: string;
    projectId: string | null;
    providerId: ProviderId;
    modelId: string;
    reasoningEffort: ProviderReasoningEffort | null;
    thinkingEnabled?: boolean;
    availableComposerSkills: SkillDefinition[];
    emptyPromptMessage: string;
  }
) {
  if (!input.prompt.trim()) {
    host.showToast('warning', input.emptyPromptMessage);
    return;
  }
  if (!input.projectId) {
    host.showToast('warning', 'Create or select a project first.');
    return;
  }

  const { promptWithoutMentions, mentionedTokens } = splitPromptMentionedSkills(
    input.prompt,
    input.availableComposerSkills
  );
  if (!promptWithoutMentions) {
    host.showToast('warning', 'Add some prose before enhancing the prompt.');
    return;
  }

  host.setEnhancingPrompt(true);
  try {
    const result = await host.enhancePrompt({
      prompt: promptWithoutMentions,
      projectId: input.projectId,
      providerId: input.providerId,
      modelId: input.modelId,
      reasoningEffort: input.reasoningEffort,
      thinkingEnabled: input.thinkingEnabled
    });
    host.setComposerPrompt(
      appendMentionedSkillTokens(result.prompt, mentionedTokens)
    );
    host.clearPendingNativeCommand();
    host.showToast('info', 'Prompt enhanced.');
    host.focusComposer();
  } catch (error) {
    host.clearPendingNativeCommand();
    host.showToast(
      'warning',
      error instanceof Error ? error.message : 'Unable to enhance prompt.'
    );
  } finally {
    host.setEnhancingPrompt(false);
  }
}
