export const transcriptAutoFollowThreshold = 120;

export function isTranscriptNearBottomPosition(
  input: { scrollHeight: number; scrollTop: number; clientHeight: number },
  threshold = transcriptAutoFollowThreshold
) {
  return input.scrollHeight - input.scrollTop - input.clientHeight <= threshold;
}

export function shouldAutoFollowTranscript(input: { threadChanged: boolean; autoFollow: boolean }) {
  return input.threadChanged || input.autoFollow;
}
