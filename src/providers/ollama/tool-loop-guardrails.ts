export const TOOL_LOOP_RESPONSE_TIMEOUT_MS = 1000 * 60 * 5;
export const MAX_TOOL_LOOP_TURNS = 96;
export const MAX_STALLED_TOOL_TURNS = 6;
export const MAX_TOOL_LOOP_RUNTIME_MS = 1000 * 60 * 30;
export const MAX_REQUIRED_WEB_RESEARCH_REMINDERS = 2;
export const MAX_REQUIRED_MUTATION_REMINDERS = 2;

export function formatToolLoopLimitError() {
  return `Ollama agent runtime exceeded ${MAX_TOOL_LOOP_TURNS} tool turns without reaching a final answer. Continue the task in the same thread to let the model finish from its current workspace progress.`;
}

export function formatToolLoopRuntimeError() {
  return `Ollama agent runtime exceeded ${Math.round(MAX_TOOL_LOOP_RUNTIME_MS / 60_000)} minutes without reaching a final answer. Continue the task in the same thread to let the model finish from its current workspace progress.`;
}

export function formatToolLoopStallError() {
  return 'Ollama kept requesting the same tool work without making visible progress. Continue the task in the same thread or adjust the prompt to break the loop.';
}

export function formatMissingRequiredWebResearchError() {
  return 'Ollama was explicitly asked to research online but kept answering without using the available native web research tools. Continue the thread with a direct instruction to use the research tool, or try a different provider if this repeats.';
}

export function formatMissingRequiredMutationError() {
  return 'Ollama stopped before writing the required file contents. Continue the thread and ask it to write the missing files, or try a different provider if this repeats.';
}
