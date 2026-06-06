import { describe, expect, it } from 'vitest';
import {
  parseProviderModelRoutingEvidence,
  parseRuntimeTraceMark,
  sanitizeRuntimeTraceDetail
} from './diagnostics-runtime-trace';

describe('diagnostics runtime trace helpers', () => {
  it('parses valid runtime trace marks and keeps safe detail fields', () => {
    expect(parseRuntimeTraceMark({
      runtimeTrace: {
        stage: 'workspace_context_completed',
        at: '2026-06-02T00:00:00.000Z',
        detail: {
          blockCount: 2,
          promptPath: 'D:\\Projects\\private\\prompt.txt'
        }
      }
    })).toEqual({
      stage: 'workspace_context_completed',
      at: '2026-06-02T00:00:00.000Z',
      detail: {
        blockCount: 2,
        promptPath: 'D:\\Projects\\private\\prompt.txt'
      }
    });
  });

  it('returns null for malformed runtime trace payloads', () => {
    expect(parseRuntimeTraceMark({})).toBeNull();
    expect(parseRuntimeTraceMark({ runtimeTrace: { stage: 'run_started' } })).toBeNull();
    expect(parseRuntimeTraceMark({ runtimeTrace: { at: '2026-06-02T00:00:00.000Z' } })).toBeNull();
  });

  it('sanitizes normalized dispatch detail without exposing prompt text', () => {
    expect(sanitizeRuntimeTraceDetail('provider_model_normalized_dispatch_started', {
      providerId: 'openai',
      transportKind: 'responses',
      promptText: 'PRIVATE_PROMPT_TEXT',
      systemPrompt: 'PRIVATE_SYSTEM_PROMPT',
      modelRouting: {
        modelId: 'gpt-5',
        providerLabel: 'OpenAI',
        transportKind: 'responses',
        runtimeAuthority: 'app_harness',
        reason: 'normalized provider model transport selected',
        promptText: 'PRIVATE_MODEL_PROMPT'
      }
    })).toEqual({
      providerId: 'openai',
      transportKind: 'responses',
      modelRouting: {
        modelId: 'gpt-5',
        customProviderId: null,
        ollamaTransportMode: null,
        runMode: null,
        providerLabel: 'OpenAI',
        transportKind: 'responses',
        runtimeAuthority: 'app_harness',
        reason: 'normalized provider model transport selected'
      }
    });
  });

  it('sanitizes worktree trace roots recursively', () => {
    expect(sanitizeRuntimeTraceDetail('worktree_session_created', {
      sourceWorkspaceRoot: 'D:\\Projects\\private',
      nested: {
        runtimeWorkspaceRoot: 'D:\\Projects\\private\\.vicode-worktree',
        branchName: 'vicode/worktree/project/run'
      }
    })).toEqual({
      nested: {
        branchName: 'vicode/worktree/project/run'
      }
    });
  });

  it('extracts model routing evidence from normalized dispatch trace payloads', () => {
    expect(parseProviderModelRoutingEvidence({
      runtimeTrace: {
        stage: 'provider_model_normalized_dispatch_started',
        detail: {
          modelRouting: {
            modelId: 'local:qwen3-coder',
            ollamaTransportMode: 'chat',
            runMode: 'default',
            providerLabel: 'Ollama',
            transportKind: 'ollama_chat',
            runtimeAuthority: 'app_harness',
            reason: 'local Ollama chat transport selected'
          }
        }
      }
    })).toEqual({
      modelId: 'local:qwen3-coder',
      customProviderId: null,
      ollamaTransportMode: 'chat',
      runMode: 'default',
      providerLabel: 'Ollama',
      transportKind: 'ollama_chat',
      runtimeAuthority: 'app_harness',
      reason: 'local Ollama chat transport selected'
    });
  });
});
