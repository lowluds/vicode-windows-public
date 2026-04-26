import { useEffect, useRef, type MutableRefObject } from 'react';

type UseThreadDraftSyncInput = {
  activeThreadId: string | null;
  activeThreadIdRef: MutableRefObject<string | null>;
  prompt: string;
  readLivePrompt?: () => string;
  setPrompt: (updater: (current: string) => string) => void;
  loadDraft: (threadId: string) => Promise<string>;
  saveDraft: (threadId: string, prompt: string) => Promise<void>;
};

export function useThreadDraftSync(input: UseThreadDraftSyncInput) {
  const hydratedDraftThreadIdRef = useRef<string | null>(null);
  const latestPromptRef = useRef(input.prompt);
  const readLivePromptRef = useRef(input.readLivePrompt);
  const setPromptRef = useRef(input.setPrompt);
  const loadDraftRef = useRef(input.loadDraft);
  const saveDraftRef = useRef(input.saveDraft);

  latestPromptRef.current = input.prompt;
  readLivePromptRef.current = input.readLivePrompt;
  setPromptRef.current = input.setPrompt;
  loadDraftRef.current = input.loadDraft;
  saveDraftRef.current = input.saveDraft;

  useEffect(() => {
    const threadId = input.activeThreadId;
    const promptAtLoadStart = readLivePromptRef.current?.() ?? latestPromptRef.current;
    hydratedDraftThreadIdRef.current = null;

    if (!threadId) {
      return;
    }

    let cancelled = false;
    void loadDraftRef.current(threadId).then((draft) => {
      if (cancelled || input.activeThreadIdRef.current !== threadId) {
        return;
      }

      if ((readLivePromptRef.current?.() ?? latestPromptRef.current) !== promptAtLoadStart) {
        return;
      }
      hydratedDraftThreadIdRef.current = threadId;
      setPromptRef.current(() => draft);
    });

    return () => {
      cancelled = true;
    };
  }, [input.activeThreadId, input.activeThreadIdRef]);

  useEffect(() => {
    const threadId = input.activeThreadId;
    if (!threadId || hydratedDraftThreadIdRef.current !== threadId) {
      return;
    }

    const timeout = window.setTimeout(() => {
      void saveDraftRef.current(threadId, input.prompt);
    }, 280);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [input.activeThreadId, input.prompt]);
}
