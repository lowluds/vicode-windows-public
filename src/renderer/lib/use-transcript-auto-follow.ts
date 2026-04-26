import { useLayoutEffect, useRef } from 'react';
import { isTranscriptNearBottomPosition, shouldAutoFollowTranscript, transcriptAutoFollowThreshold } from './transcript-scroll';

type UseTranscriptAutoFollowInput = {
  transcriptRef: React.RefObject<HTMLElement | null>;
  route: string;
  activeThreadId: string | null;
  dependencyKey: string;
};

function isTranscriptNearBottom(element: HTMLElement, threshold = transcriptAutoFollowThreshold) {
  return isTranscriptNearBottomPosition({
    scrollHeight: element.scrollHeight,
    scrollTop: element.scrollTop,
    clientHeight: element.clientHeight
  }, threshold);
}

export function useTranscriptAutoFollow(input: UseTranscriptAutoFollowInput) {
  const transcriptAutoFollowRef = useRef(true);
  const transcriptProgrammaticScrollRef = useRef(false);
  const transcriptUserScrollIntentRef = useRef(false);
  const transcriptUserScrollIntentTimeoutRef = useRef<number | null>(null);
  const transcriptThreadIdRef = useRef<string | null>(null);

  function markTranscriptUserScrollIntent() {
    transcriptUserScrollIntentRef.current = true;
    if (transcriptUserScrollIntentTimeoutRef.current !== null) {
      window.clearTimeout(transcriptUserScrollIntentTimeoutRef.current);
    }
    transcriptUserScrollIntentTimeoutRef.current = window.setTimeout(() => {
      transcriptUserScrollIntentRef.current = false;
      transcriptUserScrollIntentTimeoutRef.current = null;
    }, 180);
  }

  function updateTranscriptAutoFollow(element: HTMLElement) {
    if (transcriptProgrammaticScrollRef.current) {
      return;
    }
    if (!transcriptUserScrollIntentRef.current) {
      return;
    }
    transcriptAutoFollowRef.current = isTranscriptNearBottom(element);
  }

  useLayoutEffect(() => {
    const element = input.transcriptRef.current;
    if (!element || input.route !== 'thread') {
      return;
    }

    const threadId = input.activeThreadId;
    const threadChanged = transcriptThreadIdRef.current !== threadId;
    transcriptThreadIdRef.current = threadId;
    const shouldStickToBottom = shouldAutoFollowTranscript({
      threadChanged,
      autoFollow: transcriptAutoFollowRef.current
    });

    if (!shouldStickToBottom) {
      return;
    }

    const scrollToBottom = () => {
      transcriptProgrammaticScrollRef.current = true;
      element.scrollTop = element.scrollHeight;
      transcriptAutoFollowRef.current = true;
    };

    let nestedFrame: number | null = null;
    let releaseProgrammaticScrollFrame: number | null = null;
    const frame = window.requestAnimationFrame(() => {
      if (!shouldAutoFollowTranscript({ threadChanged, autoFollow: transcriptAutoFollowRef.current })) {
        return;
      }
      scrollToBottom();
      nestedFrame = window.requestAnimationFrame(() => {
        if (!shouldAutoFollowTranscript({ threadChanged, autoFollow: transcriptAutoFollowRef.current })) {
          return;
        }
        scrollToBottom();
        releaseProgrammaticScrollFrame = window.requestAnimationFrame(() => {
          transcriptProgrammaticScrollRef.current = false;
        });
      });
    });

    return () => {
      transcriptProgrammaticScrollRef.current = false;
      transcriptUserScrollIntentRef.current = false;
      if (transcriptUserScrollIntentTimeoutRef.current !== null) {
        window.clearTimeout(transcriptUserScrollIntentTimeoutRef.current);
        transcriptUserScrollIntentTimeoutRef.current = null;
      }
      window.cancelAnimationFrame(frame);
      if (nestedFrame !== null) {
        window.cancelAnimationFrame(nestedFrame);
      }
      if (releaseProgrammaticScrollFrame !== null) {
        window.cancelAnimationFrame(releaseProgrammaticScrollFrame);
      }
    };
  }, [input.activeThreadId, input.dependencyKey, input.route, input.transcriptRef]);

  return {
    markTranscriptUserScrollIntent,
    updateTranscriptAutoFollow
  };
}
