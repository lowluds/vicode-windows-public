import { describe, expect, it } from 'vitest';
import { selectRestorableProjectThread } from './app-shell-thread-selection';

describe('app shell thread selection', () => {
  it('restores the preferred thread when it belongs to the target project', () => {
    expect(
      selectRestorableProjectThread(
        [
          { id: 'thread-recent' },
          { id: 'thread-older' }
        ],
        'thread-older'
      )
    ).toBe('thread-older');
  });

  it('falls back to the most recent project thread', () => {
    expect(
      selectRestorableProjectThread(
        [
          { id: 'thread-recent' },
          { id: 'thread-older' }
        ],
        'missing-thread'
      )
    ).toBe('thread-recent');
  });

  it('returns null when there is no project thread to restore', () => {
    expect(selectRestorableProjectThread([], 'missing-thread')).toBeNull();
  });
});
