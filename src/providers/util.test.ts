import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  appendAssistantTextChunk,
  createIsolatedCommandEnv,
  createRestrictedCommandEnv,
  createTransportableCommandEnv,
  spawnIsolatedCommand
} from './util';

describe('provider util command environment', () => {
  it('preserves raw provider chunks instead of inventing spaces or word joins', () => {
    expect(appendAssistantTextChunk('O', 'llama assisted live test passed.')).toBe('Ollama assisted live test passed.');
    expect(appendAssistantTextChunk('Yes,', '“the 21st night of September”')).toBe('Yes,“the 21st night of September”');
    expect(appendAssistantTextChunk('Wind', '&Fire')).toBe('Wind&Fire');
    expect(appendAssistantTextChunk('Charles Babbage', "'s Analytical Engine")).toBe("Charles Babbage's Analytical Engine");
  });

  it('preserves operational shell variables while stripping unrelated secrets', () => {
    const env = createRestrictedCommandEnv({
      Path: 'C:\\Windows\\System32',
      TEMP: 'C:\\Temp',
      USERPROFILE: 'C:\\Users\\test-user',
      OPENAI_API_KEY: 'secret',
      VICODE_TEST_SECRET: 'hidden'
    });

    expect(env.Path).toBe('C:\\Windows\\System32');
    expect(env.TEMP).toBe('C:\\Temp');
    expect(env.USERPROFILE).toBe('C:\\Users\\test-user');
    expect(env.OPENAI_API_KEY).toBeUndefined();
    expect(env.VICODE_TEST_SECRET).toBeUndefined();
    expect(typeof env.ComSpec === 'string' || typeof env.COMSPEC === 'string').toBe(true);
    expect(typeof env.SystemRoot).toBe('string');
  });

  it('creates an isolated temp profile tree for command execution', async () => {
    const isolated = await createIsolatedCommandEnv({
      Path: 'C:\\Windows\\System32',
      TEMP: 'C:\\Temp',
      USERPROFILE: 'C:\\Users\\test-user',
      APPDATA: 'C:\\Users\\test-user\\AppData\\Roaming',
      LOCALAPPDATA: 'C:\\Users\\test-user\\AppData\\Local'
    });

    expect(isolated.env.Path).toBe('C:\\Windows\\System32');
    expect(isolated.env.USERPROFILE).not.toBe('C:\\Users\\test-user');
    expect(isolated.env.APPDATA).not.toBe('C:\\Users\\test-user\\AppData\\Roaming');
    expect(isolated.env.LOCALAPPDATA).not.toBe('C:\\Users\\test-user\\AppData\\Local');
    expect(isolated.env.TEMP).toContain('vicode-agent-runtime-');
    expect(isolated.env.GIT_CONFIG_GLOBAL).toContain('vicode-agent-runtime-');
    expect(isolated.env.NPM_CONFIG_USERCONFIG).toContain('vicode-agent-runtime-');
    expect(isolated.env.PIP_CONFIG_FILE).toContain('vicode-agent-runtime-');
    expect(isolated.env.BUNDLE_USER_CONFIG).toContain('vicode-agent-runtime-');
    expect(isolated.env.COMPOSER_HOME).toContain('vicode-agent-runtime-');
    expect(existsSync(isolated.rootDir)).toBe(true);

    await isolated.cleanup();

    expect(existsSync(isolated.rootDir)).toBe(false);
  });

  it('creates a plain transport-safe env for the utility process boundary', () => {
    const source = Object.create(process.env) as NodeJS.ProcessEnv & {
      INVALID_OBJECT?: unknown;
      INVALID_NUMBER?: unknown;
    };
    source.Path = 'C:\\Windows\\System32';
    source.SystemRoot = 'C:\\Windows';
    source.INVALID_OBJECT = { secret: true };
    source.INVALID_NUMBER = 42;

    const env = createTransportableCommandEnv(source);

    expect(env).not.toBe(source);
    expect(Object.getPrototypeOf(env)).toBe(Object.prototype);
    expect(env.Path).toBe('C:\\Windows\\System32');
    expect(env.SystemRoot).toBe('C:\\Windows');
    expect('INVALID_OBJECT' in env).toBe(false);
    expect('INVALID_NUMBER' in env).toBe(false);
  });

  it('spawns an isolated command session with canonical cleanup metadata', async () => {
    const session = await spawnIsolatedCommand('cmd.exe', ['/d', '/s', '/c', 'ping -n 2 127.0.0.1 >nul && echo ready'], {
      env: {
        Path: 'C:\\Windows\\System32',
        TEMP: 'C:\\Temp',
        USERPROFILE: 'C:\\Users\\test-user',
        APPDATA: 'C:\\Users\\test-user\\AppData\\Roaming',
        LOCALAPPDATA: 'C:\\Users\\test-user\\AppData\\Local'
      }
    });

    expect(['host_job_object_temp_profile', 'host_isolated_temp_profile']).toContain(session.isolationMode);
    expect(session.rootDir).toContain('vicode-agent-runtime-');
    expect(existsSync(session.rootDir)).toBe(true);

    await new Promise<void>((resolve, reject) => {
      session.child.on('error', reject);
      session.child.on('close', () => resolve());
    });

    await session.cleanup();

    expect(existsSync(session.rootDir)).toBe(false);
  });
});
