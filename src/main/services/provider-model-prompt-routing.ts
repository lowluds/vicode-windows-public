import {
  providerPromptRequiresNativeWebResearch,
  providerPromptRequiresWorkspaceMutation
} from './provider-model-context-assembler';

export function promptIsCasualConversation(prompt: string) {
  const normalized = prompt.trim().toLowerCase();
  if (!normalized) {
    return false;
  }

  if (
    providerPromptRequiresNativeWebResearch(normalized)
    || providerPromptRequiresWorkspaceMutation(normalized)
    || normalized.startsWith('/')
    || normalized.startsWith('$')
  ) {
    return false;
  }

  if (
    /\b(?:repo|repository|workspace|project|thread|code|coding|file|folder|directory|terminal|command|shell|build|lint|test|run|fix|edit|change|update|write|read|search|research|web|site|website|app|component|ui|agent|ollama|gemini|codex)\b/u.test(normalized)
  ) {
    return false;
  }

  if (normalized.length > 80) {
    return false;
  }

  return [
    /^(?:hi|hello|hey|yo|sup|hiya|howdy)[!.?]*$/u,
    /^(?:good\s+)?(?:morning|afternoon|evening)[!.?]*$/u,
    /^how(?:'s| is)\s+it\s+going(?:\s+today)?[!?\.]*$/u,
    /^how\s+are\s+you(?:\s+doing)?(?:\s+today)?[!?\.]*$/u,
    /^(?:nice|cool|awesome|great|perfect|sounds good|looks good|okay|ok|alright|all right|thanks|thank you|got it|understood)[!.?]*$/u,
    /^(?:nice|cool|awesome|great|perfect|sounds good),?\s+thanks[!.?]*$/u
  ].some((pattern) => pattern.test(normalized));
}
