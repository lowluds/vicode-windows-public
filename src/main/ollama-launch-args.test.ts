import { describe, expect, it } from 'vitest';
import { parseOllamaLaunchArgv } from './ollama-launch-args';

describe('parseOllamaLaunchArgv', () => {
  it('returns null when no Ollama launch profile flag is present', () => {
    expect(parseOllamaLaunchArgv(['electron.exe', 'app'])).toBeNull();
  });

  it('parses a launch profile path from split argv', () => {
    expect(parseOllamaLaunchArgv([
      'electron.exe',
      'app',
      '--ollama-launch-profile',
      'C:/Temp/vicode-profile.json',
      '--some-vicode-arg'
    ])).toEqual({
      profilePath: 'C:/Temp/vicode-profile.json'
    });
  });

  it('parses a launch profile path from equals argv', () => {
    expect(parseOllamaLaunchArgv([
      'electron.exe',
      'app',
      '--ollama-launch-profile=C:/Temp/vicode-profile.json'
    ])).toEqual({
      profilePath: 'C:/Temp/vicode-profile.json'
    });
  });

  it('rejects a missing launch profile path', () => {
    expect(() => parseOllamaLaunchArgv([
      'electron.exe',
      'app',
      '--ollama-launch-profile'
    ])).toThrow(/requires a profile path/i);
  });
});
