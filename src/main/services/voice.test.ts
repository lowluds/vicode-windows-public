import { describe, expect, it } from 'vitest';
import { resolveVoiceWorkingDirectory } from './voice';

describe('resolveVoiceWorkingDirectory', () => {
  it('keeps whisper subprocess writes inside the managed temp directory', () => {
    expect(resolveVoiceWorkingDirectory('C:/Users/test/AppData/Roaming/Vicode/state/voice/whisper.cpp/temp')).toBe(
      'C:/Users/test/AppData/Roaming/Vicode/state/voice/whisper.cpp/temp'
    );
  });
});
