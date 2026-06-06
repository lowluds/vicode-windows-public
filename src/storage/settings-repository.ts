import type Database from 'better-sqlite3';
import { createProviderRecord, getProviderMetadata } from '../shared/providers';
import type {
  AppearanceMode,
  ExecutionPermission,
  Preferences,
  ProviderId
} from '../shared/domain';

export const DEFAULT_PREFERENCES: Preferences = {
  selectedProjectId: null,
  defaultProviderId: 'ollama',
  defaultModelByProvider: createProviderRecord((providerId) => getProviderMetadata(providerId).defaultModelId),
  defaultReasoningEffortByProvider: createProviderRecord((providerId) => getProviderMetadata(providerId).defaultReasoningEffort),
  defaultThinkingByProvider: createProviderRecord((providerId) => getProviderMetadata(providerId).defaultThinking),
  ollamaTransportMode: 'chat',
  defaultExecutionPermission: 'default',
  followUpBehavior: 'queue',
  generatedMemoryUseEnabled: false,
  generatedMemoryGenerationEnabled: true,
  appearanceMode: 'system',
  accentMode: 'system',
  accentColor: null,
  onboardingComplete: false,
  lastOpenedThreadId: null,
  microphoneAllowed: false,
  userLibraryPath: null,
  skillsLibraryPath: null,
  llmWikiLibraryPath: null
};

type Row = Record<string, unknown>;

export class SettingsRepository {
  constructor(
    private readonly db: Database.Database
  ) {}

  getPreferences(): Preferences {
    const row = this.db.prepare('SELECT * FROM preferences WHERE id = 1').get() as Row;
    const next: Preferences = {
      selectedProjectId: (row.selected_project_id as string | null) ?? null,
      defaultProviderId: row.default_provider_id as ProviderId,
      defaultModelByProvider: createProviderRecord((providerId) => {
        const value = row[`default_model_${providerId}`];
        return typeof value === 'string' && value.trim() ? value : DEFAULT_PREFERENCES.defaultModelByProvider[providerId];
      }),
      defaultReasoningEffortByProvider: createProviderRecord((providerId) => {
        const value = row[`default_reasoning_effort_${providerId}`];
        return (value as Preferences['defaultReasoningEffortByProvider'][ProviderId] | null) ?? DEFAULT_PREFERENCES.defaultReasoningEffortByProvider[providerId];
      }),
      defaultThinkingByProvider: createProviderRecord((providerId) => {
        const value = row[`default_thinking_${providerId}`];
        return value === null || value === undefined ? DEFAULT_PREFERENCES.defaultThinkingByProvider[providerId] : Boolean(value);
      }),
      ollamaTransportMode:
        (row.ollama_transport_mode as Preferences['ollamaTransportMode'] | null) ?? DEFAULT_PREFERENCES.ollamaTransportMode,
      defaultExecutionPermission: (row.default_execution_permission as ExecutionPermission | null) ?? 'default',
      followUpBehavior: (row.follow_up_behavior as Preferences['followUpBehavior'] | null) ?? DEFAULT_PREFERENCES.followUpBehavior,
      generatedMemoryUseEnabled:
        row.generated_memory_use_enabled === null || row.generated_memory_use_enabled === undefined
          ? DEFAULT_PREFERENCES.generatedMemoryUseEnabled
          : Boolean(row.generated_memory_use_enabled),
      generatedMemoryGenerationEnabled:
        row.generated_memory_generation_enabled === null || row.generated_memory_generation_enabled === undefined
          ? DEFAULT_PREFERENCES.generatedMemoryGenerationEnabled
          : Boolean(row.generated_memory_generation_enabled),
      appearanceMode: (row.appearance_mode as AppearanceMode | null) ?? DEFAULT_PREFERENCES.appearanceMode,
      accentMode: (row.accent_mode as Preferences['accentMode'] | null) ?? DEFAULT_PREFERENCES.accentMode,
      accentColor: typeof row.accent_color === 'string' && row.accent_color.trim() ? (row.accent_color as string) : null,
      onboardingComplete: Boolean(row.onboarding_complete),
      lastOpenedThreadId: (row.last_opened_thread_id as string | null) ?? null,
      microphoneAllowed: Boolean(row.microphone_allowed),
      userLibraryPath: typeof row.user_library_path === 'string' && row.user_library_path.trim() ? row.user_library_path as string : null,
      skillsLibraryPath: typeof row.skills_library_path === 'string' && row.skills_library_path.trim() ? row.skills_library_path as string : null,
      llmWikiLibraryPath: typeof row.llm_wiki_library_path === 'string' && row.llm_wiki_library_path.trim() ? row.llm_wiki_library_path as string : null
    };
    return this.sanitizePreferenceReferences(next);
  }

  savePreferences(input: Partial<Preferences>): Preferences {
    const current = this.getPreferences();
    const next: Preferences = {
      ...current,
      ...input,
      defaultModelByProvider: {
        ...current.defaultModelByProvider,
        ...input.defaultModelByProvider
      },
      defaultReasoningEffortByProvider: {
        ...current.defaultReasoningEffortByProvider,
        ...input.defaultReasoningEffortByProvider
      },
      defaultThinkingByProvider: {
        ...current.defaultThinkingByProvider,
        ...input.defaultThinkingByProvider
      }
    };
    this.db
      .prepare(
        `UPDATE preferences
         SET selected_project_id = @selectedProjectId,
             default_provider_id = @defaultProviderId,
             default_model_openai = @openaiModel,
             default_model_gemini = @geminiModel,
             default_model_qwen = @qwenModel,
             default_model_ollama = @ollamaModel,
             default_model_kimi = @kimiModel,
             default_reasoning_effort_openai = @openaiReasoningEffort,
             default_reasoning_effort_gemini = @geminiReasoningEffort,
             default_reasoning_effort_qwen = @qwenReasoningEffort,
             default_reasoning_effort_ollama = @ollamaReasoningEffort,
             default_reasoning_effort_kimi = @kimiReasoningEffort,
             default_thinking_openai = @openaiThinking,
             default_thinking_gemini = @geminiThinking,
             default_thinking_qwen = @qwenThinking,
             default_thinking_ollama = @ollamaThinking,
             default_thinking_kimi = @kimiThinking,
             ollama_transport_mode = @ollamaTransportMode,
             default_execution_permission = @defaultExecutionPermission,
             follow_up_behavior = @followUpBehavior,
             generated_memory_use_enabled = @generatedMemoryUseEnabled,
             generated_memory_generation_enabled = @generatedMemoryGenerationEnabled,
             appearance_mode = @appearanceMode,
             accent_mode = @accentMode,
             accent_color = @accentColor,
             onboarding_complete = @onboardingComplete,
             last_opened_thread_id = @lastOpenedThreadId,
             microphone_allowed = @microphoneAllowed,
             user_library_path = @userLibraryPath,
             skills_library_path = @skillsLibraryPath,
             llm_wiki_library_path = @llmWikiLibraryPath
         WHERE id = 1`
      )
      .run({
        selectedProjectId: next.selectedProjectId,
        defaultProviderId: next.defaultProviderId,
        openaiModel: next.defaultModelByProvider.openai,
        geminiModel: next.defaultModelByProvider.gemini,
        qwenModel: next.defaultModelByProvider.qwen,
        ollamaModel: next.defaultModelByProvider.ollama,
        kimiModel: next.defaultModelByProvider.kimi,
        openaiReasoningEffort: next.defaultReasoningEffortByProvider.openai,
        geminiReasoningEffort: next.defaultReasoningEffortByProvider.gemini,
        qwenReasoningEffort: next.defaultReasoningEffortByProvider.qwen,
        ollamaReasoningEffort: next.defaultReasoningEffortByProvider.ollama,
        kimiReasoningEffort: next.defaultReasoningEffortByProvider.kimi,
        openaiThinking: next.defaultThinkingByProvider.openai ? 1 : 0,
        geminiThinking: next.defaultThinkingByProvider.gemini ? 1 : 0,
        qwenThinking: next.defaultThinkingByProvider.qwen ? 1 : 0,
        ollamaThinking: next.defaultThinkingByProvider.ollama ? 1 : 0,
        kimiThinking: next.defaultThinkingByProvider.kimi ? 1 : 0,
        ollamaTransportMode: next.ollamaTransportMode,
        defaultExecutionPermission: next.defaultExecutionPermission,
        followUpBehavior: next.followUpBehavior,
        generatedMemoryUseEnabled: next.generatedMemoryUseEnabled ? 1 : 0,
        generatedMemoryGenerationEnabled: next.generatedMemoryGenerationEnabled ? 1 : 0,
        appearanceMode: next.appearanceMode,
        accentMode: next.accentMode,
        accentColor: next.accentColor,
        onboardingComplete: next.onboardingComplete ? 1 : 0,
        lastOpenedThreadId: next.lastOpenedThreadId,
        microphoneAllowed: next.microphoneAllowed ? 1 : 0,
        userLibraryPath: next.userLibraryPath,
        skillsLibraryPath: next.skillsLibraryPath,
        llmWikiLibraryPath: next.llmWikiLibraryPath
      });
    return next;
  }

  private sanitizePreferenceReferences(preferences: Preferences): Preferences {
    let selectedProjectId = preferences.selectedProjectId;
    let lastOpenedThreadId = preferences.lastOpenedThreadId;

    if (
      selectedProjectId
      && !this.db.prepare('SELECT 1 FROM projects WHERE id = ?').get(selectedProjectId)
    ) {
      selectedProjectId = null;
    }

    if (
      lastOpenedThreadId
      && !this.db.prepare('SELECT 1 FROM threads WHERE id = ?').get(lastOpenedThreadId)
    ) {
      lastOpenedThreadId = null;
    }

    if (
      selectedProjectId === preferences.selectedProjectId
      && lastOpenedThreadId === preferences.lastOpenedThreadId
    ) {
      return preferences;
    }

    const next = {
      ...preferences,
      selectedProjectId,
      lastOpenedThreadId
    };

    this.db
      .prepare(
        `UPDATE preferences
         SET selected_project_id = ?,
             last_opened_thread_id = ?
         WHERE id = 1`
      )
      .run(next.selectedProjectId, next.lastOpenedThreadId);

    return next;
  }
}
