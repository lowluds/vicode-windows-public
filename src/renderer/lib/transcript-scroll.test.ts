import { describe, expect, it } from 'vitest';
import { isTranscriptNearBottomPosition, shouldAutoFollowTranscript, transcriptAutoFollowThreshold } from './transcript-scroll';

describe('transcript scroll helpers', () => {
  it('treats the transcript as near the bottom within the follow threshold', () => {
    expect(
      isTranscriptNearBottomPosition({
        scrollHeight: 1000,
        scrollTop: 620,
        clientHeight: 300
      })
    ).toBe(true);
  });

  it('treats the transcript as not near the bottom outside the follow threshold', () => {
    expect(
      isTranscriptNearBottomPosition(
        {
          scrollHeight: 1000,
          scrollTop: 500,
          clientHeight: 300
        },
        transcriptAutoFollowThreshold
      )
    ).toBe(false);
  });

  it('keeps auto-follow enabled on thread changes even if the previous view was not pinned', () => {
    expect(
      shouldAutoFollowTranscript({
        threadChanged: true,
        autoFollow: false
      })
    ).toBe(true);
  });

  it('stops auto-following when the user has scrolled away in the current thread', () => {
    expect(
      shouldAutoFollowTranscript({
        threadChanged: false,
        autoFollow: false
      })
    ).toBe(false);
  });
});
