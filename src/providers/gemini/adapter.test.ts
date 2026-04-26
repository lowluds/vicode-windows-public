import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as providerUtil from '../util';

const { spawnMock, cpMock, mkdirMock, mkdtempMock, readFileMock, readdirMock, rmMock, writeFileMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(),
  cpMock: vi.fn(),
  mkdirMock: vi.fn(),
  mkdtempMock: vi.fn(),
  readFileMock: vi.fn(),
  readdirMock: vi.fn(),
  rmMock: vi.fn()
  ,
  writeFileMock: vi.fn()
}));

vi.mock('node:child_process', () => ({
  spawn: spawnMock
}));

vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof import('node:os')>('node:os');
  return {
    ...actual,
    homedir: () => 'C:\\Users\\test-user'
  };
});

vi.mock('node:fs/promises', async () => {
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
  return {
    ...actual,
    cp: cpMock,
    mkdir: mkdirMock,
    mkdtemp: mkdtempMock,
    readFile: readFileMock,
    readdir: readdirMock,
    rm: rmMock
    ,
    writeFile: writeFileMock
  };
});

import { GeminiAdapter } from './adapter';

class FakeChildProcess extends EventEmitter {
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly stdin = new PassThrough();
  readonly kill = vi.fn(() => {
    this.emit('close', null);
    return true;
  });
}

function expectGeminiRunSpawn(call: unknown[] | undefined, cliPath: string) {
  const executable = String(call?.[0] ?? '');
  const args = Array.isArray(call?.[1]) ? call[1].map((value) => String(value)) : [];

  if (/cmd(?:\.exe)?$/i.test(executable)) {
    expect(args).toEqual(
      expect.arrayContaining([
        '/d',
        '/s',
        '/c',
        cliPath
      ])
    );
    return;
  }

  expect(executable).toMatch(/node(?:\.exe)?$/i);
  expect(args).toEqual(
    expect.arrayContaining([
      '--no-warnings=DEP0040',
      'C:\\Users\\test-user\\AppData\\Roaming\\npm\\node_modules\\@google\\gemini-cli\\bundle\\gemini.js'
    ])
  );
}

describe('GeminiAdapter planner policy', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    spawnMock.mockReset();
    cpMock.mockReset();
    mkdirMock.mockReset();
    mkdtempMock.mockReset();
    readFileMock.mockReset();
    rmMock.mockReset();
    writeFileMock.mockReset();
    cpMock.mockResolvedValue(undefined);
    mkdirMock.mockResolvedValue(undefined);
    mkdtempMock.mockResolvedValue('C:\\temp\\vicode-gemini-test');
    readFileMock.mockRejectedValue(Object.assign(new Error('missing'), { code: 'ENOENT' }));
    readdirMock.mockRejectedValue(Object.assign(new Error('missing'), { code: 'ENOENT' }));
    rmMock.mockResolvedValue(undefined);
    writeFileMock.mockResolvedValue(undefined);
    vi.spyOn(providerUtil, 'fileExists').mockImplementation(async (path: string) => {
      return /(?:^|[\\/])bundle[\\/]gemini\.js$/iu.test(path);
    });
  });

  it('reports planner support as best-effort full access', () => {
    const adapter = new GeminiAdapter();

    expect(adapter.getPlannerCapability()).toEqual({
      supported: true,
      executionMode: 'full-access',
      enforcement: 'best-effort',
      message: 'Gemini planner runs through the native Gemini CLI plan mode. Approval enforcement still depends on the CLI runtime.'
    });
  });

  it('falls back to the repo-owned Gemini model catalog for CLI auth', async () => {
    const adapter = new GeminiAdapter();

    await expect(
      adapter.discoverRuntimeModels({
        account: null,
        authMode: 'cli',
        cliPath: 'C:\\Users\\test-user\\AppData\\Roaming\\npm\\gemini.cmd'
      })
    ).resolves.toBeNull();
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('launches Gemini sign-in with an isolated browser-auth settings override and auto-confirms the browser handoff', async () => {
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);
    const adapter = new GeminiAdapter();
    let stdinWrites = '';
    child.stdin.on('data', (chunk) => {
      stdinWrites += String(chunk);
    });

    await adapter.startAuth('cli', 'C:\\Users\\test-user\\AppData\\Roaming\\npm\\gemini.cmd');

    expect(spawnMock).toHaveBeenCalledTimes(1);
    expectGeminiRunSpawn(spawnMock.mock.calls[0], 'C:\\Users\\test-user\\AppData\\Roaming\\npm\\gemini.cmd');
    expect(spawnMock.mock.calls[0]?.[2]).toEqual(
      expect.objectContaining({
        env: expect.objectContaining({
          GEMINI_CLI_NO_RELAUNCH: 'true',
          GEMINI_CLI_SYSTEM_SETTINGS_PATH: 'C:\\temp\\vicode-gemini-test\\settings.json'
        })
      })
    );

    const settingsWrite = writeFileMock.mock.calls.find(
      ([targetPath]) => targetPath === 'C:\\temp\\vicode-gemini-test\\settings.json'
    );
    expect(settingsWrite).toBeTruthy();
    expect(JSON.parse(String(settingsWrite?.[1]))).toMatchObject({
      security: {
        auth: {
          enforcedType: 'oauth-personal',
          selectedType: 'oauth-personal',
          useExternal: true
        }
      }
    });

    child.stdout.write('Opening authentication page in your browser. Do you want to continue? [Y/n]: ');
    await new Promise((resolve) => setImmediate(resolve));
    expect(stdinWrites).toContain('y');

    child.emit('close', 0);
    await new Promise((resolve) => setImmediate(resolve));
    expect(rmMock).toHaveBeenCalledWith('C:\\temp\\vicode-gemini-test', { recursive: true, force: true });
  });

  it('uses README markdown for Gemini extensions when no GEMINI.md is present', async () => {
    readdirMock.mockResolvedValue([
      {
        name: 'Stitch',
        isDirectory: () => true
      }
    ]);

    readFileMock.mockImplementation(async (path: string) => {
      if (path.endsWith('gemini-extension.json')) {
        return JSON.stringify({
          name: 'Stitch',
          version: '0.1.4',
          description: 'Integrate Stitch into your workflow.'
        });
      }

      if (path.endsWith('README.md')) {
        return '# Stitch Extension\n\nGenerate UI from text and images.\n';
      }

      throw Object.assign(new Error('missing'), { code: 'ENOENT' });
    });

    const fileExistsSpy = vi.spyOn(providerUtil, 'fileExists').mockImplementation(async (path: string) => {
      return path.endsWith('gemini-extension.json') || path.endsWith('README.md');
    });

    const adapter = new GeminiAdapter();
    const skills = await adapter.discoverNativeSkills();

    expect(skills).toHaveLength(1);
    expect(skills[0]).toMatchObject({
      id: 'provider-native:gemini:extension:Stitch',
      name: 'Stitch',
      description: 'Integrate Stitch into your workflow.',
      path: expect.stringMatching(/README\.md$/),
      metadata: expect.objectContaining({
        providerOrigin: 'gemini',
        kind: 'extension',
        attachMode: 'runtime',
        detailMarkdown: expect.stringContaining('# Stitch Extension')
      })
    });
    expect(String((skills[0].metadata as Record<string, unknown>).detailMarkdown ?? '')).toContain('## Runtime');
    fileExistsSpy.mockRestore();
  });

  it('uses Gemini native plan approval mode for planner runs', async () => {
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);

    const adapter = new GeminiAdapter();
    vi.spyOn(adapter, 'detectInstall').mockResolvedValue({
      installed: true,
      cliPath: 'C:\\Users\\test-user\\AppData\\Roaming\\npm\\gemini.cmd'
    });

    await adapter.startRun(
      {
        threadId: 'thread-1',
        runId: 'run-1',
        prompt: 'Create a plan',
        modelId: 'gemini-2.5-pro',
        folderPath: 'C:\\Users\\test-user\\Desktop\\vicode-project\\vicode-windows',
        trusted: true,
        apiKey: null,
        runMode: 'plan',
        executionPermission: 'default'
      },
      {
        onStart: vi.fn(),
        onDelta: vi.fn(),
        onInfo: vi.fn(),
        onComplete: vi.fn(),
        onError: vi.fn(),
        onAbort: vi.fn()
      }
    );

    expectGeminiRunSpawn(spawnMock.mock.calls[0], 'C:\\Users\\test-user\\AppData\\Roaming\\npm\\gemini.cmd');
    expect(spawnMock.mock.calls[0]?.[1]?.join(' ')).toContain('--approval-mode plan');
    expect(spawnMock.mock.calls[0]?.[2]).toEqual(
      expect.objectContaining({
        env: expect.objectContaining({
          HOME: 'C:\\temp\\vicode-gemini-test',
          USERPROFILE: 'C:\\temp\\vicode-gemini-test',
          APPDATA: 'C:\\temp\\vicode-gemini-test\\AppData\\Roaming',
          LOCALAPPDATA: 'C:\\temp\\vicode-gemini-test\\AppData\\Local',
          TEMP: 'C:\\temp\\vicode-gemini-test\\AppData\\Local\\Temp',
          TMP: 'C:\\temp\\vicode-gemini-test\\AppData\\Local\\Temp',
          PSModuleAnalysisCachePath: 'C:\\temp\\vicode-gemini-test\\AppData\\Local\\Microsoft\\Windows\\PowerShell\\ModuleAnalysisCache',
          GEMINI_CLI_NO_RELAUNCH: 'true'
        }),
        windowsHide: true
      })
    );
  });

  it('emits an execution session signal when the Gemini stream exposes a session id', async () => {
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);

    const adapter = new GeminiAdapter();
    vi.spyOn(adapter, 'detectInstall').mockResolvedValue({
      installed: true,
      cliPath: 'C:\\Users\\test-user\\AppData\\Roaming\\npm\\gemini.cmd'
    });

    const onInfo = vi.fn();
    const handle = await adapter.startRun(
      {
        threadId: 'thread-1',
        runId: 'run-1',
        prompt: 'Continue the session',
        modelId: 'gemini-2.5-pro',
        folderPath: 'C:\\Users\\test-user\\Desktop\\vicode-project\\vicode-windows',
        trusted: true,
        apiKey: null,
        runMode: 'default',
        executionPermission: 'default'
      },
      {
        onStart: vi.fn(),
        onDelta: vi.fn(),
        onInfo,
        onComplete: vi.fn(),
        onError: vi.fn(),
        onAbort: vi.fn()
      }
    );

    child.stdout.write(`${JSON.stringify({ sessionId: 'gemini-session-1', type: 'status' })}\n`);
    await Promise.resolve();

    expect(onInfo).toHaveBeenCalledWith({
      session: {
        kind: 'execution',
        providerId: 'gemini',
        sessionId: 'gemini-session-1'
      }
    });

    await handle.cancel('stop');
  });

  it('emits provider diagnostics for parsed Gemini CLI JSON events', async () => {
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);

    const adapter = new GeminiAdapter();
    vi.spyOn(adapter, 'detectInstall').mockResolvedValue({
      installed: true,
      cliPath: 'C:\\Users\\test-user\\AppData\\Roaming\\npm\\gemini.cmd'
    });

    const onInfo = vi.fn();

    await adapter.startRun(
      {
        threadId: 'thread-1',
        runId: 'run-1',
        prompt: 'Inspect the current page title',
        modelId: 'gemini-2.5-pro',
        folderPath: 'C:\\Users\\test-user\\Desktop\\vicode-project\\vicode-windows',
        trusted: true,
        apiKey: null,
        runMode: 'default',
        executionPermission: 'default'
      },
      {
        onStart: vi.fn(),
        onDelta: vi.fn(),
        onInfo,
        onComplete: vi.fn(),
        onError: vi.fn(),
        onAbort: vi.fn()
      }
    );

    child.stdout.write('{"type":"tool_use","tool_id":"read-1","tool_name":"read_file","path":"src/renderer/app.tsx"}\n');

    await vi.waitFor(() => {
      expect(onInfo).toHaveBeenCalledWith({
        providerDiagnostics: {
          kind: 'provider_event_classification',
          source: 'gemini_cli_json',
          providerEventType: 'tool_use',
          itemType: 'read_file',
          itemKeys: ['type', 'tool_id', 'tool_name', 'path'],
          paths: ['src/renderer/app.tsx'],
          decision: null,
          status: null,
          taskLike: false,
          classification: 'evidence_candidate_unparsed'
        }
      });
    });
  });

  it('suppresses raw planner chatter and missing-tool diagnostics during Gemini plan runs', async () => {
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);

    const adapter = new GeminiAdapter();
    vi.spyOn(adapter, 'detectInstall').mockResolvedValue({
      installed: true,
      cliPath: 'C:\\Users\\test-user\\AppData\\Roaming\\npm\\gemini.cmd'
    });

    const onInfo = vi.fn();
    const onComplete = vi.fn();

    await adapter.startRun(
      {
        threadId: 'thread-1',
        runId: 'run-1',
        prompt: 'Create a plan',
        modelId: 'gemini-2.5-pro',
        folderPath: 'C:\\Users\\test-user\\Desktop\\vicode-project\\vicode-windows',
        trusted: true,
        apiKey: null,
        runMode: 'plan',
        executionPermission: 'default'
      },
      {
        onStart: vi.fn(),
        onDelta: vi.fn(),
        onInfo,
        onComplete,
        onError: vi.fn(),
        onAbort: vi.fn()
      }
    );

    child.stdout.write('{"type":"status","message":"# Plan for Hacking AI Website Home Page"}\n');
    child.stdout.write('{"type":"status","message":"Tool \\"investigate\\" not found. Did you mean one of: \\"read_file\\", \\"grep_search\\", \\"glob\\"?"}\n');
    child.stdout.write('{"type":"status","message":"Tool \\"write_file\\" not found. Did you mean one of: \\"read_file\\"?"}\n');
    child.stdout.write('{"type":"status","message":"Error executing tool exit_plan_mode: Tool \\"exit_plan_mode\\" not found."}\n');
    child.stdout.write('{"type":"message","role":"assistant","content":"# Clean Plan\\n\\n## Summary\\n- Keep it clean","delta":false}\n');
    child.emit('close', 0);

    await vi.waitFor(() => {
      expect(onComplete).toHaveBeenCalledWith('# Clean Plan\n\n## Summary\n- Keep it clean');
    });

    expect(onInfo).not.toHaveBeenCalled();
  });

  it('keeps structured Gemini thinking activity visible during planner runs', async () => {
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);

    const adapter = new GeminiAdapter();
    vi.spyOn(adapter, 'detectInstall').mockResolvedValue({
      installed: true,
      cliPath: 'C:\\Users\\test-user\\AppData\\Roaming\\npm\\gemini.cmd'
    });

    const onInfo = vi.fn();

    await adapter.startRun(
      {
        threadId: 'thread-1',
        runId: 'run-1',
        prompt: 'Create a plan',
        modelId: 'gemini-2.5-pro',
        folderPath: 'C:\\Users\\test-user\\Desktop\\vicode-project\\vicode-windows',
        trusted: true,
        apiKey: null,
        runMode: 'plan',
        executionPermission: 'default'
      },
      {
        onStart: vi.fn(),
        onDelta: vi.fn(),
        onInfo,
        onComplete: vi.fn(),
        onError: vi.fn(),
        onAbort: vi.fn()
      }
    );

    child.stdout.write('{"type":"reasoning_delta","delta":"Reviewing the codebase before writing the plan."}\n');

    await vi.waitFor(() => {
      expect(onInfo).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Reviewing the codebase before writing the plan.',
          activity: expect.objectContaining({
            kind: 'thinking',
            providerEventType: 'reasoning_delta'
          })
        })
      );
    });
  });

  it('uses a headless run for default-permission chat runs', async () => {
    const child = new FakeChildProcess();
    const killProcessTreeSpy = vi.spyOn(providerUtil, 'killProcessTree').mockResolvedValue(undefined);
    spawnMock.mockReturnValue(child);

    const adapter = new GeminiAdapter();
    vi.spyOn(adapter, 'detectInstall').mockResolvedValue({
      installed: true,
      cliPath: 'C:\\Users\\test-user\\AppData\\Roaming\\npm\\gemini.cmd'
    });
    const onInfo = vi.fn();
    const onComplete = vi.fn();
    const onError = vi.fn();

    await adapter.startRun(
      {
        threadId: 'thread-1',
        runId: 'run-1',
        prompt: 'Implement the change',
        modelId: 'gemini-2.5-pro',
        folderPath: 'C:\\Users\\test-user\\Desktop\\vicode-project\\vicode-windows',
        trusted: true,
        apiKey: null,
        runMode: 'default',
        executionPermission: 'default',
        runtimeSkillResources: []
      },
      {
        onStart: vi.fn(),
        onDelta: vi.fn(),
        onInfo,
        onComplete,
        onError,
        onAbort: vi.fn()
      }
    );

    expectGeminiRunSpawn(spawnMock.mock.calls[0], 'C:\\Users\\test-user\\AppData\\Roaming\\npm\\gemini.cmd');
    expect(spawnMock.mock.calls[0]?.[1]?.join(' ')).toContain('--output-format stream-json');
    expect(spawnMock.mock.calls[0]?.[2]).toEqual(
      expect.objectContaining({
        env: expect.objectContaining({
          HOME: 'C:\\temp\\vicode-gemini-test',
          USERPROFILE: 'C:\\temp\\vicode-gemini-test',
          APPDATA: 'C:\\temp\\vicode-gemini-test\\AppData\\Roaming',
          LOCALAPPDATA: 'C:\\temp\\vicode-gemini-test\\AppData\\Local',
          TEMP: 'C:\\temp\\vicode-gemini-test\\AppData\\Local\\Temp',
          TMP: 'C:\\temp\\vicode-gemini-test\\AppData\\Local\\Temp',
          PSModuleAnalysisCachePath: 'C:\\temp\\vicode-gemini-test\\AppData\\Local\\Microsoft\\Windows\\PowerShell\\ModuleAnalysisCache',
          GEMINI_CLI_NO_RELAUNCH: 'true'
        }),
        windowsHide: true
      })
    );
    expect(spawnMock.mock.calls[0]?.[1]?.join(' ')).not.toContain('--approval-mode yolo');
    expect(onInfo).not.toHaveBeenCalled();

    child.stderr.write('C:\\Users\\test-user\\AppData\\Roaming\\npm\\node_modules\\@google\\gemini-cli\\node_modules\\@lydell\\node-pty\\conpty_console_list_agent.js:11\n');
    child.stderr.write('var consoleProcessList = getConsoleProcessList(shellPid);\n');
    child.stderr.write('^\n');
    child.stderr.write('Error: AttachConsole failed\n');
    child.stderr.write('Node.js v24.13.0\n');
    child.stderr.write('at Module._compile (node:internal/modules/cjs/loader:1761:14)\n');
    child.stderr.write('at Object..js (node:internal/modules/cjs/loader:1893:10)\n');
    child.stderr.write('at Module.load (node:internal/modules/cjs/loader:1481:32)\n');
    child.stderr.write('at Module._load (node:internal/modules/cjs/loader:1300:12)\n');
    child.stderr.write('at TracingChannel.traceSync (node:diagnostics_channel:328:14)\n');
    child.stderr.write('at wrapModuleLoad (node:internal/modules/cjs/loader:245:24)\n');
    child.stderr.write('at Module.executeUserEntryPoint [as runMain] (node:internal/modules/run_main:154:5)\n');
    child.stderr.write('at node:internal/main/run_main_module:33:47\n');
    child.stdout.write('{"type":"message","role":"assistant","content":"Approved change","delta":false}\n');

    await vi.waitFor(() => {
      expect(onError).toHaveBeenCalledWith('Gemini CLI failed while attaching its Windows console helper.');
    });
    expect(killProcessTreeSpy).toHaveBeenCalledWith(child);
    expect(onInfo).not.toHaveBeenCalled();
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('emits provider-native progress when Gemini writes todos in stream-json mode', async () => {
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);

    const adapter = new GeminiAdapter();
    vi.spyOn(adapter, 'detectInstall').mockResolvedValue({
      installed: true,
      cliPath: 'C:\\Users\\test-user\\AppData\\Roaming\\npm\\gemini.cmd'
    });

    const onInfo = vi.fn();

    await adapter.startRun(
      {
        threadId: 'thread-1',
        runId: 'run-1',
        prompt: 'Implement the change',
        modelId: 'gemini-2.5-pro',
        folderPath: 'C:\\Users\\test-user\\Desktop\\vicode-project\\vicode-windows',
        trusted: true,
        apiKey: null,
        runMode: 'default',
        executionPermission: 'default',
        runtimeSkillResources: []
      },
      {
        onStart: vi.fn(),
        onDelta: vi.fn(),
        onInfo,
        onComplete: vi.fn(),
        onError: vi.fn(),
        onAbort: vi.fn()
      }
    );

    child.stdout.write('{"type":"tool_use","tool_name":"write_todos","tool_id":"todo-1","parameters":{"todos":[]}}\n');
    child.stdout.write(
      '{"type":"tool_result","tool_id":"todo-1","status":"success","output":{"todos":[{"description":"Inspect repo state","status":"completed"},{"description":"Wire Gemini progress","status":"in_progress"},{"description":"Run validation","status":"pending"}]}}\n'
    );

    await vi.waitFor(() => {
      expect(onInfo).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Gemini updated its task list.',
          progress: expect.objectContaining({
            runId: 'run-1',
            threadId: 'thread-1',
            title: 'Gemini tasks',
            items: [
              expect.objectContaining({ label: 'Inspect repo state', status: 'completed' }),
              expect.objectContaining({ label: 'Wire Gemini progress', status: 'in_progress' }),
              expect.objectContaining({ label: 'Run validation', status: 'pending' })
            ]
          })
        })
      );
    });
  });

  it('surfaces Gemini tool_use events as live activity breadcrumbs plus generic tool calls', async () => {
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);

    const adapter = new GeminiAdapter();
    vi.spyOn(adapter, 'detectInstall').mockResolvedValue({
      installed: true,
      cliPath: 'C:\\Users\\test-user\\AppData\\Roaming\\npm\\gemini.cmd'
    });

    const onInfo = vi.fn();

    await adapter.startRun(
      {
        threadId: 'thread-1',
        runId: 'run-1',
        prompt: 'Implement the change',
        modelId: 'gemini-2.5-pro',
        folderPath: 'C:\\Users\\test-user\\Desktop\\vicode-project\\vicode-windows',
        trusted: true,
        apiKey: null,
        runMode: 'default',
        executionPermission: 'default',
        runtimeSkillResources: []
      },
      {
        onStart: vi.fn(),
        onDelta: vi.fn(),
        onInfo,
        onComplete: vi.fn(),
        onError: vi.fn(),
        onAbort: vi.fn()
      }
    );

    child.stdout.write(
      '{"type":"tool_use","tool_name":"list_directory","tool_id":"list-directory-1","parameters":{"dir_path":"C:\\\\Users\\\\test-user\\\\Desktop\\\\vitest"}}\n'
    );

    await vi.waitFor(() => {
      expect(onInfo).toHaveBeenCalledWith(
        expect.objectContaining({
          activity: expect.objectContaining({
            kind: 'tool_call',
            toolName: 'list_directory',
            providerEventType: 'tool_use'
          })
        })
      );
      expect(onInfo).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Opened C:\\Users\\test-user\\Desktop\\vitest',
          activity: expect.objectContaining({
            kind: 'file_open',
            path: 'C:\\Users\\test-user\\Desktop\\vitest',
            providerEventType: 'tool_use'
          })
        })
      );
    });
    expect(onInfo).toHaveBeenCalledTimes(3);
  });

  it('surfaces Gemini tool_result events as generic tool results alongside terminal evidence', async () => {
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);

    const adapter = new GeminiAdapter();
    vi.spyOn(adapter, 'detectInstall').mockResolvedValue({
      installed: true,
      cliPath: 'C:\\Users\\test-user\\AppData\\Roaming\\npm\\gemini.cmd'
    });

    const onInfo = vi.fn();
    const handle = await adapter.startRun(
      {
        threadId: 'thread-1',
        runId: 'run-1',
        prompt: 'Implement the change',
        modelId: 'gemini-2.5-pro',
        folderPath: 'C:\\Users\\test-user\\Desktop\\vicode-project\\vicode-windows',
        trusted: true,
        apiKey: null,
        runMode: 'default',
        executionPermission: 'full_access',
        runtimeSkillResources: []
      },
      {
        onStart: vi.fn(),
        onDelta: vi.fn(),
        onInfo,
        onComplete: vi.fn(),
        onError: vi.fn(),
        onAbort: vi.fn()
      }
    );

    child.stdout.write(
      '{"type":"tool_use","tool_name":"run_shell_command","tool_id":"shell-1","parameters":{"command":"npm test","cwd":"C:/repo"}}\n'
    );
    child.stdout.write(
      '{"type":"tool_result","tool_id":"shell-1","status":"success","output":"1 passed"}\n'
    );

    await vi.waitFor(() => {
      expect(onInfo).toHaveBeenCalledWith(
        expect.objectContaining({
          activity: expect.objectContaining({
            kind: 'tool_result',
            toolName: 'run_shell_command',
            status: 'success',
            providerEventType: 'tool_result'
          })
        })
      );
      expect(onInfo).toHaveBeenCalledWith(
        expect.objectContaining({
          activity: expect.objectContaining({
            kind: 'terminal_command',
            phase: 'completed',
            summary: 'Ran npm test · C:/repo',
            command: 'npm test'
          })
        })
      );
    });

    await handle.cancel('Stopped by user.');
  });

  it('stages pasted images into the workspace and references them with multimodal @ paths', async () => {
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);

    const adapter = new GeminiAdapter();
    vi.spyOn(adapter, 'detectInstall').mockResolvedValue({
      installed: true,
      cliPath: 'C:\\Users\\test-user\\AppData\\Roaming\\npm\\gemini.cmd'
    });

    await adapter.startRun(
      {
        threadId: 'thread-1',
        runId: 'run-1',
        prompt: 'Implement from this screenshot.',
        imageAttachments: [
          {
            id: 'image-1',
            name: 'mockup.png',
            mimeType: 'image/png',
            dataUrl: 'data:image/png;base64,QUJD'
          }
        ],
        modelId: 'gemini-2.5-pro',
        folderPath: 'C:\\Users\\test-user\\Desktop\\vicode-project\\vicode-windows',
        trusted: true,
        apiKey: null,
        runMode: 'default',
        executionPermission: 'default',
        runtimeSkillResources: []
      },
      {
        onStart: vi.fn(),
        onDelta: vi.fn(),
        onInfo: vi.fn(),
        onComplete: vi.fn(),
        onError: vi.fn(),
        onAbort: vi.fn()
      }
    );

    expect(writeFileMock).toHaveBeenCalledWith(
      'C:\\Users\\test-user\\Desktop\\vicode-project\\vicode-windows\\.vicode\\composer-images\\run-1\\mockup.png',
      expect.any(Buffer)
    );
    expect(spawnMock.mock.calls[0]?.[1]?.join(' ')).toContain(
      '@{C:\\Users\\test-user\\Desktop\\vicode-project\\vicode-windows\\.vicode\\composer-images\\run-1\\mockup.png}'
    );
  });

  it('surfaces a concise capacity error instead of completing with no output', async () => {
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);

    const adapter = new GeminiAdapter();
    vi.spyOn(adapter, 'detectInstall').mockResolvedValue({
      installed: true,
      cliPath: 'C:\\Users\\test-user\\AppData\\Roaming\\npm\\gemini.cmd'
    });

    const onComplete = vi.fn();
    const onError = vi.fn();

    await adapter.startRun(
      {
        threadId: 'thread-1',
        runId: 'run-1',
        prompt: 'Build the hero section',
        modelId: 'gemini-2.5-flash-lite',
        folderPath: 'C:\\Users\\test-user\\Desktop\\vicode-project\\vicode-windows',
        trusted: true,
        apiKey: null,
        runMode: 'default',
        executionPermission: 'default',
        runtimeSkillResources: []
      },
      {
        onStart: vi.fn(),
        onDelta: vi.fn(),
        onInfo: vi.fn(),
        onComplete,
        onError,
        onAbort: vi.fn()
      }
    );

    child.stderr.write('Attempt 1 failed with status 429. Retrying with backoff...\n');
    child.stderr.write('No capacity available for model gemini-2.5-flash-lite on the server\n');
    child.stderr.write('at async GeminiChat.streamWithRetries (file:///tmp/geminiChat.js:265:40)\n');
    child.emit('close', 0);

    await vi.waitFor(() => {
      expect(onError).toHaveBeenCalledWith(
        'Gemini could not run because gemini-2.5-flash-lite is currently rate limited or out of capacity. Try Gemini 2.5 Flash or Gemini 2.5 Pro and retry.'
      );
    });
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('fails fast when Gemini reports capacity exhaustion before the process exits', async () => {
    const child = new FakeChildProcess();
    const killProcessTreeSpy = vi.spyOn(providerUtil, 'killProcessTree').mockResolvedValue(undefined);
    spawnMock.mockReturnValue(child);

    const adapter = new GeminiAdapter();
    vi.spyOn(adapter, 'detectInstall').mockResolvedValue({
      installed: true,
      cliPath: 'C:\\Users\\test-user\\AppData\\Roaming\\npm\\gemini.cmd'
    });

    const onError = vi.fn();
    const onComplete = vi.fn();

    await adapter.startRun(
      {
        threadId: 'thread-1',
        runId: 'run-1',
        prompt: 'Ask one clarifying question before proposing a plan.',
        modelId: 'gemini-3-flash-preview',
        folderPath: 'C:\\Users\\test-user\\Desktop\\vicode-project\\vicode-windows',
        trusted: true,
        apiKey: null,
        runMode: 'plan',
        executionPermission: 'default',
        runtimeSkillResources: []
      },
      {
        onStart: vi.fn(),
        onDelta: vi.fn(),
        onInfo: vi.fn(),
        onComplete,
        onError,
        onAbort: vi.fn()
      }
    );

    child.stderr.write('Attempt 1 failed with status 429. Retrying with backoff...\n');
    child.stderr.write('No capacity available for model gemini-3-flash-preview on the server\n');

    await vi.waitFor(() => {
      expect(onError).toHaveBeenCalledWith(
        'Gemini could not run because gemini-3-flash-preview is currently rate limited or out of capacity. Try Gemini 2.5 Flash or Gemini 2.5 Pro and retry. Gemini 3 auto and preview routes are less reliable when capacity is tight.'
      );
    });

    expect(killProcessTreeSpy).toHaveBeenCalledWith(child);
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('does not surface raw Node stack frames as thread info while Gemini is failing', async () => {
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);

    const adapter = new GeminiAdapter();
    vi.spyOn(adapter, 'detectInstall').mockResolvedValue({
      installed: true,
      cliPath: 'C:\\Users\\test-user\\AppData\\Roaming\\npm\\gemini.cmd'
    });

    const onInfo = vi.fn();
    const onError = vi.fn();

    await adapter.startRun(
      {
        threadId: 'thread-1',
        runId: 'run-1',
        prompt: 'Build the hero section',
        modelId: 'auto-gemini-3',
        folderPath: 'C:\\Users\\test-user\\Desktop\\vicode-project\\vicode-windows',
        trusted: true,
        apiKey: null,
        runMode: 'default',
        executionPermission: 'default',
        runtimeSkillResources: []
      },
      {
        onStart: vi.fn(),
        onDelta: vi.fn(),
        onInfo,
        onComplete: vi.fn(),
        onError,
        onAbort: vi.fn()
      }
    );

    child.stderr.write('at Module._compile (node:internal/modules/cjs/loader:1761:14)\n');
    child.stderr.write('at Object..js (node:internal/modules/cjs/loader:1893:10)\n');
    child.stderr.write('Attempt 1 failed with status 429. Retrying with backoff...\n');
    child.stderr.write('No capacity available for model auto-gemini-3 on the server\n');

    await vi.waitFor(() => {
      expect(onError).toHaveBeenCalledWith(
        'Gemini could not run because auto-gemini-3 is currently rate limited or out of capacity. Try Gemini 2.5 Flash or Gemini 2.5 Pro and retry. Gemini 3 auto and preview routes are less reliable when capacity is tight.'
      );
    });

    const surfacedInfoMessages = onInfo.mock.calls
      .map(([payload]) => (typeof payload === 'string' ? payload : payload?.message))
      .filter((value): value is string => typeof value === 'string');

    expect(surfacedInfoMessages).not.toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^at Module\./u),
        expect.stringMatching(/^at Object\.\.js/u)
      ])
    );
  });

  it('aborts a headless Gemini run when it exceeds the app timeout', async () => {
    vi.useFakeTimers();
    try {
      const child = new FakeChildProcess();
      const killProcessTreeSpy = vi.spyOn(providerUtil, 'killProcessTree').mockResolvedValue(undefined);
      spawnMock.mockReturnValue(child);

      const adapter = new GeminiAdapter() as GeminiAdapter & { headlessRunTimeoutMs: number };
      adapter.headlessRunTimeoutMs = 1_000;
      vi.spyOn(adapter, 'detectInstall').mockResolvedValue({
        installed: true,
        cliPath: 'C:\\Users\\test-user\\AppData\\Roaming\\npm\\gemini.cmd'
      });

      const onError = vi.fn();
      const onComplete = vi.fn();

      await adapter.startRun(
        {
          threadId: 'thread-1',
          runId: 'run-1',
          prompt: 'Build the hero section',
          modelId: 'gemini-2.5-pro',
          folderPath: 'C:\\Users\\test-user\\Desktop\\vicode-project\\vicode-windows',
          trusted: true,
          apiKey: null,
          runMode: 'default',
          executionPermission: 'default',
          runtimeSkillResources: []
        },
        {
          onStart: vi.fn(),
          onDelta: vi.fn(),
          onInfo: vi.fn(),
          onComplete,
          onError,
          onAbort: vi.fn()
        }
      );

      await vi.advanceTimersByTimeAsync(1_001);

      expect(onError).toHaveBeenCalledWith(
        "Gemini did not finish before Vicode's run timeout elapsed. Vicode ended the run to avoid leaving the thread stuck indefinitely."
      );
      expect(onComplete).not.toHaveBeenCalled();
      expect(killProcessTreeSpy).toHaveBeenCalledWith(child);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not fall back to simulated Gemini output when runtime setup fails', async () => {
    mkdtempMock.mockRejectedValueOnce(new Error('mkdtemp failed'));

    const adapter = new GeminiAdapter();
    const onDelta = vi.fn();
    const onError = vi.fn();

    await adapter.startRun(
      {
        threadId: 'thread-1',
        runId: 'run-1',
        prompt: 'Build the hero section',
        modelId: 'gemini-2.5-pro',
        folderPath: 'C:\\Users\\test-user\\Desktop\\vicode-project\\vicode-windows',
        trusted: true,
        apiKey: null,
        runMode: 'default',
        executionPermission: 'default',
        runtimeSkillResources: []
      },
      {
        onStart: vi.fn(),
        onDelta,
        onInfo: vi.fn(),
        onComplete: vi.fn(),
        onError,
        onAbort: vi.fn()
      }
    );

    await vi.waitFor(() => {
      expect(onError).toHaveBeenCalledWith('mkdtemp failed');
    });
    expect(onDelta).not.toHaveBeenCalled();
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('accepts legacy false-trust workspaces through project validation', () => {
    const adapter = new GeminiAdapter();
    expect(
      adapter.validateProjectContext('C:\\Users\\test-user\\Desktop\\vicode-project\\vicode-windows', false)
    ).toEqual({ valid: true });
  });

  it('uses yolo approval flags for full-access runs', async () => {
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);

    const adapter = new GeminiAdapter();
    vi.spyOn(adapter, 'detectInstall').mockResolvedValue({
      installed: true,
      cliPath: 'C:\\Users\\test-user\\AppData\\Roaming\\npm\\gemini.cmd'
    });

    await adapter.startRun(
      {
        threadId: 'thread-1',
        runId: 'run-1',
        prompt: 'Implement the change',
        modelId: 'gemini-2.5-pro',
        folderPath: 'C:\\Users\\test-user\\Desktop\\vicode-project\\vicode-windows',
        trusted: true,
        apiKey: null,
        runMode: 'default',
        executionPermission: 'full_access',
        runtimeSkillResources: []
      },
      {
        onStart: vi.fn(),
        onDelta: vi.fn(),
        onInfo: vi.fn(),
        onComplete: vi.fn(),
        onError: vi.fn(),
        onAbort: vi.fn()
      }
    );

    expect(spawnMock.mock.calls[0]?.[1]?.join(' ')).toContain('--approval-mode yolo');
  });

  it('suppresses raw ask_user tool failures from Gemini planner activity', async () => {
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);

    const adapter = new GeminiAdapter();
    vi.spyOn(adapter, 'detectInstall').mockResolvedValue({
      installed: true,
      cliPath: 'C:\\Users\\test-user\\AppData\\Roaming\\npm\\gemini.cmd'
    });
    const onInfo = vi.fn();
    const onComplete = vi.fn();

    await adapter.startRun(
      {
        threadId: 'thread-1',
        runId: 'run-1',
        prompt: 'Create a plan',
        modelId: 'gemini-2.5-pro',
        folderPath: 'C:\\Users\\test-user\\Desktop\\vicode-project\\vicode-windows',
        trusted: true,
        apiKey: null,
        runMode: 'plan',
        executionPermission: 'default',
        runtimeSkillResources: []
      },
      {
        onStart: vi.fn(),
        onDelta: vi.fn(),
        onInfo,
        onComplete,
        onError: vi.fn(),
        onAbort: vi.fn()
      }
    );

    child.stderr.write('Tool "ask_user" not found. Did you mean one of: "cli_help", "read_file", "grep_search"?\n');
    child.stdout.write(
      '{"type":"tool_result","tool_name":"ask_user","status":"error","message":"Error executing tool ask_user: Tool \\"ask_user\\" not found."}\n'
    );
    child.stdout.write('{"type":"message","role":"assistant","content":"Plan body","delta":false}\n');
    child.emit('close', 0);

    await vi.waitFor(() => {
      expect(onComplete).toHaveBeenCalledWith('Plan body');
    });
    expect(onInfo).not.toHaveBeenCalled();
  });

  it('retries once before failing when Gemini exits successfully without producing assistant output for a normal run', async () => {
    const firstChild = new FakeChildProcess();
    const secondChild = new FakeChildProcess();
    spawnMock.mockReturnValueOnce(firstChild).mockReturnValueOnce(secondChild);

    const adapter = new GeminiAdapter();
    vi.spyOn(adapter, 'detectInstall').mockResolvedValue({
      installed: true,
      cliPath: 'C:\\Users\\test-user\\AppData\\Roaming\\npm\\gemini.cmd'
    });
    const onComplete = vi.fn();
    const onError = vi.fn();
    const onInfo = vi.fn();

    await adapter.startRun(
      {
        threadId: 'thread-1',
        runId: 'run-1',
        prompt: 'Reply with exactly: ok',
        modelId: 'gemini-2.5-pro',
        folderPath: 'C:\\Users\\test-user\\Desktop\\vicode-project\\vicode-windows',
        trusted: true,
        apiKey: null,
        runMode: 'default',
        executionPermission: 'default',
        runtimeSkillResources: []
      },
      {
        onStart: vi.fn(),
        onDelta: vi.fn(),
        onInfo,
        onComplete,
        onError,
        onAbort: vi.fn()
      }
    );

    firstChild.emit('close', 0);

    await vi.waitFor(() => {
      expect(onInfo).toHaveBeenCalledWith('Gemini finished without a reply. Retrying once.');
    });

    secondChild.emit('close', 0);

    await vi.waitFor(() => {
      expect(onError).toHaveBeenCalledWith('Gemini CLI exited successfully without producing assistant output.');
    });
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('retries once and accepts the next successful Gemini result payload after an empty-output attempt', async () => {
    const firstChild = new FakeChildProcess();
    const secondChild = new FakeChildProcess();
    spawnMock.mockReturnValueOnce(firstChild).mockReturnValueOnce(secondChild);

    const adapter = new GeminiAdapter();
    vi.spyOn(adapter, 'detectInstall').mockResolvedValue({
      installed: true,
      cliPath: 'C:\\Users\\test-user\\AppData\\Roaming\\npm\\gemini.cmd'
    });
    const onComplete = vi.fn();
    const onError = vi.fn();
    const onInfo = vi.fn();

    await adapter.startRun(
      {
        threadId: 'thread-1',
        runId: 'run-1',
        prompt: 'Reply with exactly: ok',
        modelId: 'auto-gemini-2.5',
        folderPath: 'C:\\Users\\test-user\\Desktop\\vicode-project\\vicode-windows',
        trusted: true,
        apiKey: null,
        runMode: 'default',
        executionPermission: 'default',
        runtimeSkillResources: []
      },
      {
        onStart: vi.fn(),
        onDelta: vi.fn(),
        onInfo,
        onComplete,
        onError,
        onAbort: vi.fn()
      }
    );

    firstChild.emit('close', 0);

    await vi.waitFor(() => {
      expect(onInfo).toHaveBeenCalledWith('Gemini finished without a reply. Retrying once.');
    });

    secondChild.stdout.write('{"type":"result","status":"success","response":{"content":"ok"}}\n');
    secondChild.emit('close', 0);

    await vi.waitFor(() => {
      expect(onComplete).toHaveBeenCalledWith('ok');
    });
    expect(onError).not.toHaveBeenCalled();
  });

  it('accepts a successful Gemini result payload as assistant output when no message delta arrives', async () => {
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);

    const adapter = new GeminiAdapter();
    vi.spyOn(adapter, 'detectInstall').mockResolvedValue({
      installed: true,
      cliPath: 'C:\\Users\\test-user\\AppData\\Roaming\\npm\\gemini.cmd'
    });
    const onComplete = vi.fn();
    const onError = vi.fn();

    await adapter.startRun(
      {
        threadId: 'thread-1',
        runId: 'run-1',
        prompt: 'Fix the animation',
        modelId: 'gemini-3.1-pro-preview',
        folderPath: 'C:\\Users\\test-user\\Desktop\\vicode-project\\vicode-windows',
        trusted: true,
        apiKey: null,
        runMode: 'default',
        executionPermission: 'default',
        runtimeSkillResources: []
      },
      {
        onStart: vi.fn(),
        onDelta: vi.fn(),
        onInfo: vi.fn(),
        onComplete,
        onError,
        onAbort: vi.fn()
      }
    );

    child.stdout.write('{"type":"tool_use","tool_name":"read_file","tool_id":"read-1","parameters":{"path":"index.html"}}\n');
    child.stdout.write('{"type":"tool_result","tool_id":"read-1","status":"success","output":"<html></html>"}\n');
    child.stdout.write('{"type":"result","status":"success","response":{"content":"Updated the walk cycle and tightened the animation timing."}}\n');
    child.emit('close', 0);

    await vi.waitFor(() => {
      expect(onComplete).toHaveBeenCalledWith('Updated the walk cycle and tightened the animation timing.');
    });
    expect(onError).not.toHaveBeenCalled();
  });

  it('surfaces structured Gemini API error messages for failed runs', async () => {
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);

    const adapter = new GeminiAdapter();
    vi.spyOn(adapter, 'detectInstall').mockResolvedValue({
      installed: true,
      cliPath: 'C:\\Users\\test-user\\AppData\\Roaming\\npm\\gemini.cmd'
    });
    const onError = vi.fn();

    await adapter.startRun(
      {
        threadId: 'thread-1',
        runId: 'run-1',
        prompt: 'Reply with exactly: ok',
        modelId: 'gemini-2.5-pro',
        folderPath: 'C:\\Users\\test-user\\Desktop\\vicode-project\\vicode-windows',
        trusted: true,
        apiKey: null,
        runMode: 'default',
        executionPermission: 'default',
        runtimeSkillResources: []
      },
      {
        onStart: vi.fn(),
        onDelta: vi.fn(),
        onInfo: vi.fn(),
        onComplete: vi.fn(),
        onError,
        onAbort: vi.fn()
      }
    );

    child.stdout.write(
      '{"type":"result","status":"error","error":{"type":"Error","message":"[API Error: You have exhausted your capacity on this model.]"}}\n'
    );
    child.emit('close', 1);

    await vi.waitFor(() => {
      expect(onError).toHaveBeenCalledWith('You have exhausted your capacity on this model.');
    });
  });

  it('emits raw Gemini thought chunks and leaves readable reconstruction to the shared provider-manager seam', async () => {
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);

    const adapter = new GeminiAdapter();
    vi.spyOn(adapter, 'detectInstall').mockResolvedValue({
      installed: true,
      cliPath: 'C:\\Users\\test-user\\AppData\\Roaming\\npm\\gemini.cmd'
    });
    const onDelta = vi.fn();
    const onComplete = vi.fn();

    await adapter.startRun(
      {
        threadId: 'thread-1',
        runId: 'run-1',
        prompt: 'Build a hero section',
        modelId: 'gemini-2.5-pro',
        folderPath: 'C:\\Users\\test-user\\Desktop\\vicode-project\\vicode-windows',
        trusted: true,
        apiKey: null,
        runMode: 'default',
        executionPermission: 'default',
        runtimeSkillResources: []
      },
      {
        onStart: vi.fn(),
        onDelta,
        onInfo: vi.fn(),
        onComplete,
        onError: vi.fn(),
        onAbort: vi.fn()
      }
    );

    child.stdout.write('{"type":"message","role":"assistant","content":"I will inspect the file structure.","delta":true}\n');
    child.stdout.write('{"type":"message","role":"assistant","content":"I\\u2019ll update the hero section with cleaner spacing.","delta":true}\n');
    child.emit('close', 0);

    await vi.waitFor(() => {
      expect(onComplete).toHaveBeenCalledWith(
        'I will inspect the file structure.I’ll update the hero section with cleaner spacing.'
      );
    });

    expect(onDelta).toHaveBeenNthCalledWith(1, 'I will inspect the file structure.');
    expect(onDelta).toHaveBeenNthCalledWith(
      2,
      'I’ll update the hero section with cleaner spacing.'
    );
  });

  it('emits raw adjacent Gemini text chunks and leaves readability repair to the shared provider-manager seam', async () => {
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);

    const adapter = new GeminiAdapter();
    vi.spyOn(adapter, 'detectInstall').mockResolvedValue({
      installed: true,
      cliPath: 'C:\\Users\\test-user\\AppData\\Roaming\\npm\\gemini.cmd'
    });

    const onDelta = vi.fn();
    const onComplete = vi.fn();

    await adapter.startRun(
      {
        threadId: 'thread-1',
        runId: 'run-1',
        prompt: 'Say hello',
        modelId: 'gemini-3-flash-preview',
        folderPath: null,
        trusted: false,
        apiKey: null,
        runMode: 'default',
        executionPermission: 'default'
      },
      {
        onStart: vi.fn(),
        onDelta,
        onInfo: vi.fn(),
        onComplete,
        onError: vi.fn(),
        onAbort: vi.fn()
      }
    );

    child.stdout.write('{"type":"message","role":"assistant","content":"Hey!I\'m doing","delta":true}\n');
    child.stdout.write('{"type":"message","role":"assistant","content":"well,thanks","delta":true}\n');
    child.stdout.write('{"type":"message","role":"assistant","content":"for asking.How are","delta":true}\n');
    child.stdout.write('{"type":"message","role":"assistant","content":"you?","delta":true}\n');
    child.emit('close', 0);

    await vi.waitFor(() => {
      expect(onComplete).toHaveBeenCalledWith("Hey!I'm doingwell,thanksfor asking.How areyou?");
    });

    expect(onDelta).toHaveBeenNthCalledWith(1, "Hey!I'm doing");
    expect(onDelta).toHaveBeenNthCalledWith(2, 'well,thanks');
    expect(onDelta).toHaveBeenNthCalledWith(3, 'for asking.How are');
    expect(onDelta).toHaveBeenNthCalledWith(4, 'you?');
  });

  it('does not insert spaces into sentence-initial mid-word continuations for Gemini output', async () => {
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);

    const adapter = new GeminiAdapter();
    vi.spyOn(adapter, 'detectInstall').mockResolvedValue({
      installed: true,
      cliPath: 'C:\\Users\\test-user\\AppData\\Roaming\\npm\\gemini.cmd'
    });

    const onComplete = vi.fn();

    await adapter.startRun(
      {
        threadId: 'thread-1',
        runId: 'run-1',
        prompt: 'Finish the sentence',
        modelId: 'gemini-3-flash-preview',
        folderPath: null,
        trusted: false,
        apiKey: null,
        runMode: 'default',
        executionPermission: 'default'
      },
      {
        onStart: vi.fn(),
        onDelta: vi.fn(),
        onInfo: vi.fn(),
        onComplete,
        onError: vi.fn(),
        onAbort: vi.fn()
      }
    );

    child.stdout.write('{"type":"message","role":"assistant","content":"Ref","delta":true}\n');
    child.stdout.write('{"type":"message","role":"assistant","content":"inement complete.","delta":true}\n');
    child.emit('close', 0);

    await vi.waitFor(() => {
      expect(onComplete).toHaveBeenCalledWith('Refinement complete.');
    });
  });

  it('emits raw Gemini full assistant snapshots through the snapshot callback', async () => {
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);

    const adapter = new GeminiAdapter();
    vi.spyOn(adapter, 'detectInstall').mockResolvedValue({
      installed: true,
      cliPath: 'C:\\Users\\test-user\\AppData\\Roaming\\npm\\gemini.cmd'
    });

    const onDelta = vi.fn();
    const onAssistantSnapshot = vi.fn();
    const onComplete = vi.fn();

    await adapter.startRun(
      {
        threadId: 'thread-1',
        runId: 'run-1',
        prompt: 'Explain model selection',
        modelId: 'gemini-3-flash-preview',
        folderPath: null,
        trusted: false,
        apiKey: null,
        runMode: 'default',
        executionPermission: 'default'
      },
      {
        onStart: vi.fn(),
        onDelta,
        onAssistantSnapshot,
        onInfo: vi.fn(),
        onComplete,
        onError: vi.fn(),
        onAbort: vi.fn()
      }
    );

    child.stdout.write('{"type":"message","role":"assistant","content":"Amb iguous requirements or design decisions","delta":false}\n');
    child.emit('close', 0);

    await vi.waitFor(() => {
      expect(onComplete).toHaveBeenCalledWith('Amb iguous requirements or design decisions');
    });

    expect(onAssistantSnapshot).toHaveBeenCalledWith('Amb iguous requirements or design decisions');
    expect(onDelta).not.toHaveBeenCalled();
  });

  it('only copies explicitly attached Gemini runtime helpers into the isolated runtime home', async () => {
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);

    const adapter = new GeminiAdapter();
    vi.spyOn(adapter, 'detectInstall').mockResolvedValue({
      installed: true,
      cliPath: 'C:\\Users\\test-user\\AppData\\Roaming\\npm\\gemini.cmd'
    });

    await adapter.startRun(
      {
        threadId: 'thread-1',
        runId: 'run-1',
        prompt: 'Implement the change',
        modelId: 'gemini-2.5-pro',
        folderPath: 'C:\\Users\\test-user\\Desktop\\vicode-project\\vicode-windows',
        trusted: true,
        apiKey: null,
        runMode: 'default',
        executionPermission: 'default',
        runtimeSkillResources: [
          {
            kind: 'extension',
            path: 'C:\\Users\\test-user\\.gemini\\extensions\\context7\\GEMINI.md'
          }
        ]
      },
      {
        onStart: vi.fn(),
        onDelta: vi.fn(),
        onInfo: vi.fn(),
        onComplete: vi.fn(),
        onError: vi.fn(),
        onAbort: vi.fn()
      }
    );

    expect(cpMock).not.toHaveBeenCalledWith(
      'C:\\Users\\test-user\\.gemini\\extensions',
      'C:\\temp\\vicode-gemini-test\\.gemini\\extensions',
      expect.any(Object)
    );
    expect(cpMock).toHaveBeenCalledWith(
      'C:\\Users\\test-user\\.gemini\\extensions\\context7',
      'C:\\temp\\vicode-gemini-test\\.gemini\\extensions\\context7',
      expect.objectContaining({ recursive: true, force: true })
    );
    expect(spawnMock.mock.calls[0]?.[2]).toEqual(
      expect.objectContaining({
        env: expect.objectContaining({
          HOME: 'C:\\temp\\vicode-gemini-test',
          USERPROFILE: 'C:\\temp\\vicode-gemini-test',
          APPDATA: 'C:\\temp\\vicode-gemini-test\\AppData\\Roaming',
          LOCALAPPDATA: 'C:\\temp\\vicode-gemini-test\\AppData\\Local',
          TEMP: 'C:\\temp\\vicode-gemini-test\\AppData\\Local\\Temp',
          TMP: 'C:\\temp\\vicode-gemini-test\\AppData\\Local\\Temp',
          PSModuleAnalysisCachePath: 'C:\\temp\\vicode-gemini-test\\AppData\\Local\\Microsoft\\Windows\\PowerShell\\ModuleAnalysisCache',
          GEMINI_CLI_NO_RELAUNCH: 'true'
        })
      })
    );
  });

  it('injects a run-scoped Gemini runtime bridge extension when runtime tool callbacks are available', async () => {
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);

    vi.spyOn(providerUtil, 'fileExists').mockImplementation(async (candidate: string) => {
      return /(?:bundle[\\/]gemini\.js|resources[\\/]mcp[\\/]gemini-runtime-tool-bridge\.mjs)$/iu.test(candidate);
    });

    const adapter = new GeminiAdapter();
    vi.spyOn(adapter, 'detectInstall').mockResolvedValue({
      installed: true,
      cliPath: 'C:\\Users\\test-user\\AppData\\Roaming\\npm\\gemini.cmd'
    });

    const handle = await adapter.startRun(
      {
        threadId: 'thread-1',
        runId: 'run-1',
        prompt: 'Inspect the repo in parallel',
        modelId: 'gemini-2.5-pro',
        folderPath: 'C:\\Users\\test-user\\Desktop\\vicode-project\\vicode-windows',
        trusted: true,
        apiKey: null,
        runMode: 'default',
        executionPermission: 'default',
        runtimeSkillResources: []
      },
      {
        onStart: vi.fn(),
        onDelta: vi.fn(),
        onInfo: vi.fn(),
        invokeRuntimeTool: vi.fn().mockResolvedValue({
          toolName: 'spawn_subagents',
          content: 'Spawned 1 delegated helper.'
        }),
        onComplete: vi.fn(),
        onError: vi.fn(),
        onAbort: vi.fn()
      }
    );

    expect(writeFileMock).toHaveBeenCalledWith(
      expect.stringContaining('vicode-runtime-bridge\\gemini-extension.json'),
      expect.stringContaining('"vicode-runtime-bridge"'),
      'utf8'
    );
    expect(writeFileMock).toHaveBeenCalledWith(
      expect.stringContaining('vicode-runtime-bridge\\GEMINI.md'),
      expect.stringContaining('spawn_subagents'),
      'utf8'
    );
    expect(cpMock).toHaveBeenCalledWith(
      expect.stringContaining('vicode-runtime-bridge'),
      expect.stringContaining('.gemini\\extensions\\vicode-runtime-bridge'),
      expect.objectContaining({ recursive: true, force: true })
    );

    await handle.cancel('cancel test bridge run');
  });

  it('forces Gemini shell tools onto child_process execution inside the isolated runtime', async () => {
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);
    readFileMock.mockImplementation(async (candidate: string) => {
      if (candidate.endsWith('settings.json')) {
        return JSON.stringify({
          security: {
            auth: {
              selectedType: 'oauth-personal'
            }
          },
          tools: {
            shell: {
              enableInteractiveShell: true,
              showColor: true
            }
          }
        });
      }
      throw Object.assign(new Error('missing'), { code: 'ENOENT' });
    });

    const adapter = new GeminiAdapter();
    vi.spyOn(adapter, 'detectInstall').mockResolvedValue({
      installed: true,
      cliPath: 'C:\\Users\\test-user\\AppData\\Roaming\\npm\\gemini.cmd'
    });

    await adapter.startRun(
      {
        threadId: 'thread-1',
        runId: 'run-1',
        prompt: 'Run npm test and fix the CSS issue.',
        modelId: 'gemini-2.5-flash',
        folderPath: 'C:\\Users\\test-user\\Desktop\\vicode-project\\vicode-windows',
        trusted: true,
        apiKey: null,
        runMode: 'default',
        executionPermission: 'default',
        runtimeSkillResources: []
      },
      {
        onStart: vi.fn(),
        onDelta: vi.fn(),
        onInfo: vi.fn(),
        onComplete: vi.fn(),
        onError: vi.fn(),
        onAbort: vi.fn()
      }
    );

    const settingsWrite = writeFileMock.mock.calls.find(
      ([targetPath]) => targetPath === 'C:\\temp\\vicode-gemini-test\\.gemini\\settings.json'
    );

    expect(settingsWrite).toBeTruthy();
    expect(typeof settingsWrite?.[1]).toBe('string');
    expect(JSON.parse(String(settingsWrite?.[1]))).toMatchObject({
      security: {
        auth: {
          selectedType: 'oauth-personal'
        }
      },
      tools: {
        shell: {
          enableInteractiveShell: false,
          showColor: true
        }
      }
    });
  });

  it('copies Gemini trust and policy state into the isolated runtime home', async () => {
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);
    readFileMock.mockImplementation(async (candidate: string) => {
      if (candidate.endsWith('settings.json')) {
        return JSON.stringify({});
      }
      if (
        candidate.endsWith('installation_id') ||
        candidate.endsWith('projects.json') ||
        candidate.endsWith('state.json') ||
        candidate.endsWith('trustedFolders.json') ||
        candidate.endsWith('oauth_creds.json') ||
        candidate.endsWith('google_accounts.json')
      ) {
        return '{}';
      }
      throw Object.assign(new Error('missing'), { code: 'ENOENT' });
    });

    const adapter = new GeminiAdapter();
    vi.spyOn(adapter, 'detectInstall').mockResolvedValue({
      installed: true,
      cliPath: 'C:\\Users\\test-user\\AppData\\Roaming\\npm\\gemini.cmd'
    });

    await adapter.startRun(
      {
        threadId: 'thread-1',
        runId: 'run-1',
        prompt: 'Run npm test and fix the CSS issue.',
        modelId: 'gemini-2.5-flash',
        folderPath: 'C:\\Users\\test-user\\Desktop\\vicode-project\\vicode-windows',
        trusted: true,
        apiKey: null,
        runMode: 'default',
        executionPermission: 'default',
        runtimeSkillResources: []
      },
      {
        onStart: vi.fn(),
        onDelta: vi.fn(),
        onInfo: vi.fn(),
        onComplete: vi.fn(),
        onError: vi.fn(),
        onAbort: vi.fn()
      }
    );

    expect(writeFileMock).toHaveBeenCalledWith('C:\\temp\\vicode-gemini-test\\.gemini\\installation_id', '{}');
    expect(writeFileMock).toHaveBeenCalledWith('C:\\temp\\vicode-gemini-test\\.gemini\\projects.json', '{}');
    expect(writeFileMock).toHaveBeenCalledWith('C:\\temp\\vicode-gemini-test\\.gemini\\state.json', '{}');
    expect(writeFileMock).toHaveBeenCalledWith('C:\\temp\\vicode-gemini-test\\.gemini\\trustedFolders.json', '{}');
    expect(cpMock).toHaveBeenCalledWith(
      'C:\\Users\\test-user\\.gemini\\policies',
      'C:\\temp\\vicode-gemini-test\\.gemini\\policies',
      expect.objectContaining({ recursive: true, force: true })
    );
  });

  it('reports detected auth when Gemini CLI auth files are only partially present', async () => {
    const fileExistsSpy = vi.spyOn(providerUtil, 'fileExists').mockImplementation(async (candidate: string) =>
      candidate.endsWith('oauth_creds.json')
    );
    const adapter = new GeminiAdapter();

    await expect(adapter.getAuthState(null)).resolves.toEqual({
      authState: 'detected',
      authMode: 'cli',
      message: 'Gemini auth files were detected. Refresh after sign-in or repair the CLI if Vicode cannot use it yet.'
    });

    fileExistsSpy.mockRestore();
  });

  it('uses the stored Gemini API key when CLI auth is absent', async () => {
    const fileExistsSpy = vi.spyOn(providerUtil, 'fileExists').mockResolvedValue(false);
    const adapter = new GeminiAdapter();

    await expect(adapter.getAuthState({ encryptedApiKey: Buffer.from('secret') } as never)).resolves.toEqual({
      authState: 'connected',
      authMode: 'api_key',
      message: 'Using encrypted Gemini API key as fallback.'
    });

    fileExistsSpy.mockRestore();
  });

  it('returns null for Gemini CLI quota status until Google exposes a supported runtime quota surface', async () => {
    const adapter = new GeminiAdapter();

    await expect(
      adapter.getQuotaStatus({
        account: null,
        authMode: 'cli',
        cliPath: 'C:\\Users\\test-user\\AppData\\Roaming\\npm\\gemini.cmd',
        apiKey: null,
        modelId: 'gemini-3.1-pro-preview'
      })
    ).resolves.toBeNull();
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('aborts active Gemini runs through the returned cancel handle', async () => {
    const child = new FakeChildProcess();
    const killProcessTreeSpy = vi.spyOn(providerUtil, 'killProcessTree').mockResolvedValue(undefined);
    spawnMock.mockReturnValue(child);

    const adapter = new GeminiAdapter();
    vi.spyOn(adapter, 'detectInstall').mockResolvedValue({
      installed: true,
      cliPath: 'C:\\Users\\test-user\\AppData\\Roaming\\npm\\gemini.cmd'
    });
    const onAbort = vi.fn();

    const handle = await adapter.startRun(
      {
        threadId: 'thread-1',
        runId: 'run-1',
        prompt: 'Implement the change',
        modelId: 'gemini-2.5-pro',
        folderPath: 'C:\\Users\\test-user\\Desktop\\vicode-project\\vicode-windows',
        trusted: true,
        apiKey: null,
        runMode: 'default',
        executionPermission: 'default',
        runtimeSkillResources: []
      },
      {
        onStart: vi.fn(),
        onDelta: vi.fn(),
        onInfo: vi.fn(),
        onComplete: vi.fn(),
        onError: vi.fn(),
        onAbort
      }
    );

    await handle.cancel('Stopped by user.');

    expect(killProcessTreeSpy).toHaveBeenCalledWith(child);
    expect(onAbort).toHaveBeenCalledWith('Stopped by user.');
  });

  it('fails stalled Gemini runs after session init with no meaningful progress', async () => {
    vi.useFakeTimers();
    const child = new FakeChildProcess();
    const killProcessTreeSpy = vi.spyOn(providerUtil, 'killProcessTree').mockResolvedValue(undefined);
    spawnMock.mockReturnValue(child);

    const adapter = new GeminiAdapter();
    vi.spyOn(adapter, 'detectInstall').mockResolvedValue({
      installed: true,
      cliPath: 'C:\\Users\\test-user\\AppData\\Roaming\\npm\\gemini.cmd'
    });
    const onError = vi.fn();

    await adapter.startRun(
      {
        threadId: 'thread-1',
        runId: 'run-1',
        prompt: 'Implement the change',
        modelId: 'gemini-3.1-pro-preview',
        folderPath: 'C:\\Users\\test-user\\Desktop\\vicode-project\\vicode-windows',
        trusted: true,
        apiKey: null,
        runMode: 'default',
        executionPermission: 'default',
        runtimeSkillResources: []
      },
      {
        onStart: vi.fn(),
        onDelta: vi.fn(),
        onInfo: vi.fn(),
        onComplete: vi.fn(),
        onError,
        onAbort: vi.fn()
      }
    );

    child.stdout.write('{"type":"init","timestamp":"2026-03-27T17:56:12.221Z","session_id":"session-1","model":"gemini-3.1-pro-preview"}\n');

    await vi.advanceTimersByTimeAsync(46_000);

    expect(killProcessTreeSpy).toHaveBeenCalledWith(child);
    expect(onError).toHaveBeenCalledWith('Gemini CLI started a session but produced no useful progress before timing out.');

    vi.useRealTimers();
  });
});
