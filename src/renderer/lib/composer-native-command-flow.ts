import type {
  ComposerMode,
  ProviderId,
  ProviderReasoningEffort,
  SkillDefinition,
  ThreadDetail
} from '../../shared/domain';
import {
  buildNativeComposerCommandPrompt,
  nativeComposerCommands,
  parseLeadingNativeComposerCommand,
  resolveNativePlanCommand,
  type NativeComposerCommandId
} from '../../shared/nativeCommands';
import { providerDisplayName } from '../../shared/providers';
import { getBuildPlanThreadReadiness } from './build-plan';

type ToastLevel = 'info' | 'warning' | 'error';

type ComposerEffortResolver = (
  providerId: ProviderId,
  effort: 'Low' | 'Medium' | 'High' | 'Extra high'
) => ProviderReasoningEffort | null;

export interface ComposerNativeCommandFlowHost {
  enhancePromptBody(prompt: string): Promise<void>;
  startBuildPlanSetupThread(input: {
    goal: string;
    providerId: ProviderId;
    modelId: string;
    reasoningEffort: ProviderReasoningEffort | null;
    successMessage: string;
  }): Promise<void>;
  createBuildPlanFromActiveThread(): Promise<void>;
  setComposerMode(mode: ComposerMode): Promise<ComposerMode>;
  setComposerPrompt(prompt: string): void;
  clearPendingNativeCommand(): void;
  showToast(level: ToastLevel, message: string): void;
  focusComposer(): void;
}

function requiresSlashCommandBody(commandId: NativeComposerCommandId) {
  return commandId !== 'plan' && commandId !== 'autonomous-builds';
}

export async function executeLeadingNativeSlashCommand(
  host: ComposerNativeCommandFlowHost,
  input: {
    prompt: string;
    pendingNativeCommandId: NativeComposerCommandId | null;
    composer: {
      providerId: ProviderId;
      modelId: string;
      mode: ComposerMode;
    };
    composerEffort: 'Low' | 'Medium' | 'High' | 'Extra high';
    resolveComposerReasoningEffort: ComposerEffortResolver;
    activeThread: ThreadDetail | null;
    plannerSupported: boolean;
    providerLabel?: string | null;
    availableComposerSkills: SkillDefinition[];
  }
) {
  const explicitParsed = parseLeadingNativeComposerCommand(input.prompt);
  const pendingCommand =
    input.pendingNativeCommandId === null
      ? null
      : nativeComposerCommands.find(
          (command) => command.id === input.pendingNativeCommandId
        ) ?? null;
  const parsed =
    explicitParsed ??
    (pendingCommand
      ? {
          command: pendingCommand,
          body: input.prompt.trim()
        }
      : null);
  if (!parsed) {
    return false;
  }

  const { command, body } = parsed;
  if (requiresSlashCommandBody(command.id) && !body) {
    host.showToast('warning', `Add some text after /${command.token} first.`);
    return true;
  }

  if (command.id === 'autonomous-builds') {
    if (body) {
      await host.startBuildPlanSetupThread({
        goal: body,
        providerId: input.composer.providerId,
        modelId: input.composer.modelId,
        reasoningEffort: input.resolveComposerReasoningEffort(
          input.composer.providerId,
          input.composerEffort
        ),
        successMessage:
          'Autonomous Builds setup thread started from the composer.'
      });
    } else {
      const readiness = getBuildPlanThreadReadiness(input.activeThread);
      if (readiness.enabled) {
        await host.createBuildPlanFromActiveThread();
      } else {
        host.showToast(
          'warning',
          'Add a goal after /autonomous-builds, or run it inside a ready Autonomous Builds setup thread.'
        );
      }
    }
    host.clearPendingNativeCommand();
    host.focusComposer();
    return true;
  }

  if (command.id === 'enhance') {
    await host.enhancePromptBody(body);
    return true;
  }

  if (command.id === 'plan') {
    const resolution = resolveNativePlanCommand({
      body,
      plannerSupported: input.plannerSupported,
      providerLabel:
        input.providerLabel ?? providerDisplayName(input.composer.providerId)
    });
    if (resolution.kind === 'empty') {
      host.showToast('warning', resolution.toastMessage);
      return true;
    }
    if (resolution.kind === 'unsupported') {
      host.clearPendingNativeCommand();
      host.showToast('warning', resolution.toastMessage);
      host.focusComposer();
      return true;
    }

    const nextMode = await host.setComposerMode(
      input.composer.mode === 'plan' ? 'default' : resolution.nextMode
    );
    host.setComposerPrompt(resolution.prompt);
    host.clearPendingNativeCommand();
    host.showToast(
      'info',
      nextMode === 'plan' ? 'Plan mode enabled.' : 'Plan mode disabled.'
    );
    host.focusComposer();
    return true;
  }

  host.setComposerPrompt(buildNativeComposerCommandPrompt(command.id, body));
  host.clearPendingNativeCommand();
  host.showToast('info', `${command.title} applied.`);
  host.focusComposer();
  return true;
}
