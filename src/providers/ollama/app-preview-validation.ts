import type {
  AgentRuntime,
  AgentRuntimeToolCatalog,
  AgentToolCall,
  AgentToolExecutionResult
} from '../agent-runtime';
import type { ProviderRunCallbacks, ProviderRunContext } from '../types';

function extractLocalPreviewUrlForValidation(prompt: string) {
  const candidates = prompt.match(/https?:\/\/[^\s"'<>)]{1,300}/giu) ?? [];
  for (const candidate of candidates) {
    const normalizedCandidate = candidate.replace(/[.,;:!?]+$/u, '');
    try {
      const parsed = new URL(normalizedCandidate);
      const hostname = parsed.hostname.toLowerCase();
      if (
        hostname === 'localhost'
        || hostname === '127.0.0.1'
        || hostname === '0.0.0.0'
        || hostname === '[::1]'
      ) {
        return parsed.href;
      }
    } catch {
      // Ignore malformed URL-like text in the prompt.
    }
  }

  return null;
}

function extractPreviewExpectedText(prompt: string) {
  const match = prompt.match(/expected_text\s*[:=]?\s*["']([^"'\r\n]{1,160})["']/iu);
  return match?.[1]?.trim() || null;
}

function extractPreviewExpectedSelectors(prompt: string) {
  const match = prompt.match(/expected_selectors\s*[:=]?\s*\[([^\]]{1,300})\]/iu);
  if (!match?.[1]) {
    return [];
  }

  return [...match[1].matchAll(/["']([^"']{1,120})["']/gu)]
    .map((entry) => entry[1]?.trim())
    .filter((selector): selector is string => Boolean(selector))
    .slice(0, 8);
}

function promptRequestsPreviewValidation(prompt: string) {
  return /\b(browser_preview_check|preview validation|verify (?:the )?(?:rendered|preview)|check (?:the )?(?:preview|rendered page)|local preview)\b/iu.test(prompt);
}

export function buildPreviewValidationSummaryPrompt(result: AgentToolExecutionResult) {
  return result.isError
    ? 'Vicode ran browser preview validation and found a problem. Reply now with one short final assistant answer that mentions the preview issue and the files changed.'
    : 'Vicode ran browser preview validation successfully. Reply now with one short final assistant answer describing the files changed and that the preview passed.';
}

export async function maybeRunAppOwnedPreviewValidation(input: {
  agentRuntime: AgentRuntime | null;
  context: ProviderRunContext;
  callbacks: ProviderRunCallbacks;
  activeToolCatalog: AgentRuntimeToolCatalog;
  usedMutatingTool: boolean;
  usedBrowserPreviewTool: boolean;
  signal: AbortSignal;
}) {
  if (!input.agentRuntime || !input.usedMutatingTool || input.usedBrowserPreviewTool) {
    return null;
  }

  if (!input.activeToolCatalog.tools.some((tool) => tool.callName === 'browser_preview_check')) {
    return null;
  }

  const sourcePrompt = input.context.sourcePrompt || input.context.prompt;
  if (!promptRequestsPreviewValidation(sourcePrompt)) {
    return null;
  }

  const previewUrl = extractLocalPreviewUrlForValidation(sourcePrompt);
  if (!previewUrl) {
    return null;
  }

  const toolCall: AgentToolCall = {
    name: 'browser_preview_check',
    arguments: {
      url: previewUrl,
      capture_screenshot: false
    }
  };
  const expectedText = extractPreviewExpectedText(sourcePrompt);
  if (expectedText) {
    toolCall.arguments.expected_text = expectedText;
  }
  const expectedSelectors = extractPreviewExpectedSelectors(sourcePrompt);
  if (expectedSelectors.length > 0) {
    toolCall.arguments.expected_selectors = expectedSelectors;
  }

  input.callbacks.onInfo({
    message: 'Calling browser preview check',
    activity: {
      kind: 'tool_call',
      summary: 'Calling browser preview check',
      toolName: 'browser_preview_check',
      status: 'started',
      providerEventType: 'ollama_tool_loop_app_preview'
    }
  });

  const result = await input.agentRuntime.executeToolCall(toolCall, {
    workspaceRoot: input.context.folderPath as string,
    threadId: input.context.threadId,
    runId: input.context.runId,
    executionPermission: input.context.executionPermission,
    executionConstraints: input.context.executionConstraints ?? null,
    runtimeCommandPolicy: input.context.runtimeCommandPolicy,
    runtimeNetworkPolicy: input.context.runtimeNetworkPolicy,
    signal: input.signal,
    requestApproval: input.callbacks.requestToolApproval
      ? (request) => input.callbacks.requestToolApproval!(request)
      : undefined,
    onInfo: (payload) => {
      input.callbacks.onInfo({
        message: payload.message ?? payload.activity?.summary ?? '',
        activity: payload.activity ?? null
      });
    }
  });

  input.callbacks.onInfo({
    message: `${result.isError ? 'Failed' : 'Completed'} browser preview check`,
    activity: {
      kind: 'tool_result',
      summary: `${result.isError ? 'Failed' : 'Completed'} browser preview check`,
      toolName: 'browser_preview_check',
      status: result.isError ? 'error' : 'completed',
      text: result.isError ? result.content : null,
      sources: [],
      providerEventType: 'ollama_tool_loop_app_preview'
    }
  });

  return result;
}
