import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as providerUtil from '../util';
import { providerCapabilities } from '../../shared/providers';

const { mkdtempMock, rmMock, spawnMock, writeFileMock } = vi.hoisted(() => ({
  mkdtempMock: vi.fn(),
  rmMock: vi.fn(),
  spawnMock: vi.fn(),
  writeFileMock: vi.fn()
}));

vi.mock('node:child_process', () => ({
  spawn: spawnMock
}));

vi.mock('node:fs/promises', async () => {
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
  return {
    ...actual,
    mkdtemp: mkdtempMock,
    rm: rmMock,
    writeFile: writeFileMock
  };
});

import { OpenAIAdapter } from './adapter';

class FakeChildProcess extends EventEmitter {
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly stdin = new PassThrough();
  readonly kill = vi.fn(() => {
    this.emit('close', null);
    return true;
  });
}

describe('OpenAIAdapter runtime discovery', () => {
  beforeEach(() => {
    spawnMock.mockReset();
    mkdtempMock.mockReset();
    rmMock.mockReset();
    writeFileMock.mockReset();
    mkdtempMock.mockResolvedValue('C:\\temp\\vicode-codex-images');
    rmMock.mockResolvedValue(undefined);
    writeFileMock.mockResolvedValue(undefined);
  });

  it('discovers runtime models from codex app-server over newline-delimited JSON', async () => {
    const writes: string[] = [];
    const child = new FakeChildProcess();
    const killProcessTreeSpy = vi.spyOn(providerUtil, 'killProcessTree').mockResolvedValue(undefined);
    let buffer = '';

    child.stdin.on('data', (chunk: Buffer | string) => {
      buffer += chunk.toString();

      while (true) {
        const newlineIndex = buffer.indexOf('\n');
        if (newlineIndex < 0) {
          return;
        }

        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        if (!line) {
          continue;
        }

        writes.push(line);
        const message = JSON.parse(line) as {
          id?: number;
          method?: string;
          params?: { cursor?: string | null };
        };

        if (message.method === 'initialize') {
          child.stdout.write(`${JSON.stringify({ id: message.id, result: { userAgent: 'codex-test' } })}\n`);
          continue;
        }

        if (message.method === 'model/list') {
          const response =
            message.params?.cursor === 'page-2'
              ? {
                  id: message.id,
                  result: {
                    data: [
                      {
                        id: 'gpt-5.3-codex',
                        model: 'gpt-5.3-codex',
                        displayName: 'GPT-5.3-Codex',
                        description: 'Frontier Codex-optimized agentic coding model.',
                        inputModalities: ['text', 'image']
                      }
                    ],
                    nextCursor: null
                  }
                }
              : {
                  id: message.id,
                  result: {
                    data: [
                      {
                        id: 'gpt-5.4',
                        model: 'gpt-5.4',
                        displayName: 'gpt-5.4',
                        description: 'Latest frontier agentic coding model.',
                        inputModalities: ['text', 'image']
                      }
                    ],
                    nextCursor: 'page-2'
                  }
                };

          child.stdout.write(`${JSON.stringify(response)}\n`);
        }
      }
    });

    spawnMock.mockReturnValue(child);

    const adapter = new OpenAIAdapter();
    const models = await adapter.discoverRuntimeModels({
      account: null,
      authMode: 'cli',
      cliPath: 'C:\\Users\\test-user\\AppData\\Roaming\\npm\\codex.cmd'
    });

    expect(spawnMock).toHaveBeenCalledWith(
      expect.stringMatching(/cmd\.exe$/i),
      ['/d', '/s', '/c', 'C:\\Users\\test-user\\AppData\\Roaming\\npm\\codex.cmd', 'app-server'],
      expect.objectContaining({
        stdio: 'pipe',
        windowsHide: true,
        cwd: undefined,
        env: expect.objectContaining({
          ComSpec: expect.stringMatching(/cmd\.exe$/i),
          COMSPEC: expect.stringMatching(/cmd\.exe$/i),
          SystemRoot: 'C:\\WINDOWS'
        })
      })
    );
    expect(models).toHaveLength(2);
    expect(models).toMatchObject([
      {
        id: 'gpt-5.4',
        label: 'GPT-5.4',
        description: 'Latest frontier agentic coding model.',
        supportsVision: true,
        recommendation: 'recommended',
        contextWindowTokens: 1_000_000,
        contextWindowSource: 'configured',
        autoCompactTokenLimit: 750_000
      },
      {
        id: 'gpt-5.3-codex',
        label: 'GPT-5.3-Codex',
        description: 'Frontier Codex-optimized agentic coding model.',
        supportsVision: true,
        recommendation: undefined,
        contextWindowTokens: 400_000,
        contextWindowSource: 'official',
        autoCompactTokenLimit: null
      }
    ]);
    expect(writes).toHaveLength(4);
    expect(writes.every((line) => !line.includes('Content-Length'))).toBe(true);
    expect(writes.every((line) => JSON.parse(line).jsonrpc === undefined)).toBe(true);
    expect(killProcessTreeSpy).toHaveBeenCalledTimes(1);
    expect(killProcessTreeSpy).toHaveBeenCalledWith(child);
  });

  it('reports native Codex planner support through app-server', () => {
    const adapter = new OpenAIAdapter();

    expect(adapter.getPlannerCapability()).toEqual({
      supported: true,
      executionMode: 'workspace-write',
      enforcement: 'hard-enforced',
      message: 'Codex planner runs through the native Codex app-server plan mode.'
    });
  });

  it('passes structured image items into Codex planner turn input', async () => {
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);
    let buffer = '';
    const writes: Array<{ id?: number; method?: string; params?: Record<string, unknown> }> = [];

    child.stdin.on('data', (chunk: Buffer | string) => {
      buffer += chunk.toString();

      while (true) {
        const newlineIndex = buffer.indexOf('\n');
        if (newlineIndex < 0) {
          return;
        }

        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        if (!line) {
          continue;
        }

        const message = JSON.parse(line) as { id?: number; method?: string; params?: Record<string, unknown> };
        writes.push(message);

        if (message.method === 'initialize') {
          child.stdout.write(`${JSON.stringify({ id: message.id, result: { userAgent: 'codex-test' } })}\n`);
          continue;
        }

        if (message.method === 'thread/start') {
          child.stdout.write(`${JSON.stringify({ id: message.id, result: { thread: { id: 'codex-thread-1' } } })}\n`);
          continue;
        }

        if (message.method === 'turn/start') {
          child.stdout.write(`${JSON.stringify({ id: message.id, result: { turn: { id: 'turn-1' } } })}\n`);
        }
      }
    });

    const adapter = new OpenAIAdapter();
    vi.spyOn(adapter, 'detectInstall').mockResolvedValue({
      installed: true,
      cliPath: 'C:\\Users\\test-user\\AppData\\Roaming\\npm\\codex.cmd'
    });

    await adapter.startRun(
      {
        threadId: 'thread-1',
        runId: 'run-1',
        prompt: 'Create a plan from this screenshot.',
        imageAttachments: [
          {
            id: 'image-1',
            name: 'screenshot.png',
            mimeType: 'image/png',
            dataUrl: 'data:image/png;base64,QUJD'
          }
        ],
        modelId: 'gpt-5',
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

    expect(writes.find((entry) => entry.method === 'turn/start')?.params?.input).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'input_image',
          image_url: 'data:image/png;base64,QUJD'
        })
      ])
    );
  });

  it('passes pasted images to Codex exec runs with native --image flags', async () => {
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);

    const adapter = new OpenAIAdapter();
    vi.spyOn(adapter, 'detectInstall').mockResolvedValue({
      installed: true,
      cliPath: 'C:\\Users\\test-user\\AppData\\Roaming\\npm\\codex.cmd'
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
        modelId: 'gpt-5',
        folderPath: 'C:\\Users\\test-user\\Desktop\\vicode-project\\vicode-windows',
        trusted: true,
        apiKey: null,
        runMode: 'default',
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

    expect(writeFileMock).toHaveBeenCalledWith('C:\\temp\\vicode-codex-images\\mockup.png', expect.any(Buffer));
    expect(spawnMock).toHaveBeenCalledWith(
      expect.stringMatching(/cmd\.exe$/i),
      expect.arrayContaining(['/d', '/s', '/c', 'C:\\Users\\test-user\\AppData\\Roaming\\npm\\codex.cmd']),
      expect.objectContaining({
        windowsHide: true
      })
    );
    const commandArgs = (spawnMock.mock.calls[0]?.[1] as string[]) ?? [];
    expect(commandArgs).toContain('exec');
    expect(commandArgs).toContain('--ephemeral');
    expect(commandArgs).toContain('--image');
    expect(commandArgs).toContain('C:\\temp\\vicode-codex-images\\mockup.png');
    expect(commandArgs.indexOf('exec')).toBeLessThan(commandArgs.indexOf('--image'));
  });

  it('starts native Codex planner sessions through app-server and surfaces planner questions', async () => {
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);
    let buffer = '';
    const writes: Array<{ id?: number; method?: string; params?: Record<string, unknown> }> = [];

    child.stdin.on('data', (chunk: Buffer | string) => {
      buffer += chunk.toString();

      while (true) {
        const newlineIndex = buffer.indexOf('\n');
        if (newlineIndex < 0) {
          return;
        }

        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        if (!line) {
          continue;
        }

        const message = JSON.parse(line) as { id?: number; method?: string; params?: Record<string, unknown> };
        writes.push(message);

        if (message.method === 'initialize') {
          child.stdout.write(`${JSON.stringify({ id: message.id, result: { userAgent: 'codex-test' } })}\n`);
          continue;
        }

        if (message.method === 'thread/start') {
          child.stdout.write(
            `${JSON.stringify({
              id: message.id,
              result: {
                thread: { id: 'codex-thread-1' },
                model: 'gpt-5',
                modelProvider: 'openai',
                serviceTier: null,
                cwd: 'C:\\Users\\test-user\\Desktop\\vicode-project\\vicode-windows',
                approvalPolicy: 'never',
                sandbox: 'workspace-write',
                reasoningEffort: null
              }
            })}\n`
          );
          continue;
        }

        if (message.method === 'turn/start') {
          child.stdout.write(`${JSON.stringify({ id: message.id, result: { turn: { id: 'turn-1' } } })}\n`);
          child.stdout.write(
            `${JSON.stringify({
              id: 101,
              method: 'item/tool/requestUserInput',
              params: {
                threadId: 'codex-thread-1',
                turnId: 'turn-1',
                itemId: 'item-1',
                questions: [
                  {
                    id: 'scope',
                    header: 'Scope',
                    question: 'How wide should the hero be?',
                    isOther: true,
                    isSecret: false,
                    options: [
                      { label: 'Single viewport', description: 'One strong first screen.' },
                      { label: 'Multiple sections', description: 'Start broader.' }
                    ]
                  }
                ]
              }
            })}\n`
          );
        }
      }
    });

    const adapter = new OpenAIAdapter();
    vi.spyOn(adapter, 'detectInstall').mockResolvedValue({
      installed: true,
      cliPath: 'C:\\Users\\test-user\\AppData\\Roaming\\npm\\codex.cmd'
    });

    const onInfo = vi.fn();

    await adapter.startRun(
      {
        threadId: 'thread-1',
        runId: 'run-1',
        prompt: 'Create a plan',
        modelId: 'gpt-5',
        folderPath: 'C:\\Users\\test-user\\Desktop\\vicode-project\\vicode-windows',
        trusted: true,
        apiKey: null,
        runMode: 'plan',
        executionPermission: 'full_access'
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

    expect(spawnMock).toHaveBeenCalledWith(
      expect.stringMatching(/cmd\.exe$/i),
      ['/d', '/s', '/c', 'C:\\Users\\test-user\\AppData\\Roaming\\npm\\codex.cmd', 'app-server'],
      expect.objectContaining({
        cwd: 'C:\\Users\\test-user\\Desktop\\vicode-project\\vicode-windows',
        stdio: 'pipe',
        windowsHide: true
      })
    );
    expect(writes.some((entry) => entry.method === 'thread/start')).toBe(true);
    expect(writes.some((entry) => entry.method === 'turn/start')).toBe(true);
    expect(writes.find((entry) => entry.method === 'thread/start')?.params).toEqual(
      expect.objectContaining({
        persistExtendedHistory: false
      })
    );
    expect(onInfo).toHaveBeenCalledWith(
      expect.objectContaining({
        planner: expect.objectContaining({
          kind: 'session',
          sessionId: 'codex-thread-1'
        })
      })
    );
    expect(onInfo).toHaveBeenCalledWith(
      expect.objectContaining({
        planner: expect.objectContaining({
          kind: 'questions',
          callId: '101'
        })
      })
    );
  });

  it('routes Codex planner runtime tool calls through the shared runtime callback', async () => {
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);
    let buffer = '';
    const writes: Array<{ id?: number; method?: string; params?: Record<string, unknown>; result?: Record<string, unknown> }> = [];

    child.stdin.on('data', (chunk: Buffer | string) => {
      buffer += chunk.toString();

      while (true) {
        const newlineIndex = buffer.indexOf('\n');
        if (newlineIndex < 0) {
          return;
        }

        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        if (!line) {
          continue;
        }

        const message = JSON.parse(line) as {
          id?: number;
          method?: string;
          params?: Record<string, unknown>;
          result?: Record<string, unknown>;
        };
        writes.push(message);

        if (message.method === 'initialize') {
          child.stdout.write(`${JSON.stringify({ id: message.id, result: { userAgent: 'codex-test' } })}\n`);
          continue;
        }

        if (message.method === 'thread/start') {
          child.stdout.write(`${JSON.stringify({ id: message.id, result: { thread: { id: 'codex-thread-1' } } })}\n`);
          continue;
        }

        if (message.method === 'turn/start') {
          child.stdout.write(`${JSON.stringify({ id: message.id, result: { turn: { id: 'turn-1' } } })}\n`);
          child.stdout.write(
            `${JSON.stringify({
              id: 202,
              method: 'item/tool/call',
              params: {
                threadId: 'codex-thread-1',
                turnId: 'turn-1',
                callId: 'call-202',
                tool: 'spawn_subagents',
                arguments: {
                  tasks: [
                    {
                      role: 'explorer',
                      instructions: 'Inspect the repo for summary bugs.'
                    }
                  ]
                }
              }
            })}\n`
          );
        }
      }
    });

    const adapter = new OpenAIAdapter();
    vi.spyOn(adapter, 'detectInstall').mockResolvedValue({
      installed: true,
      cliPath: 'C:\\Users\\test-user\\AppData\\Roaming\\npm\\codex.cmd'
    });

    const invokeRuntimeTool = vi.fn().mockResolvedValue({
      toolName: 'spawn_subagents',
      content: 'Spawned 1 delegated helper.'
    });

    await adapter.startRun(
      {
        threadId: 'thread-1',
        runId: 'run-1',
        prompt: 'Create a plan',
        modelId: 'gpt-5',
        folderPath: 'C:\\Users\\test-user\\Desktop\\vicode-project\\vicode-windows',
        trusted: true,
        apiKey: null,
        runMode: 'plan',
        executionPermission: 'full_access'
      },
      {
        onStart: vi.fn(),
        onDelta: vi.fn(),
        onInfo: vi.fn(),
        invokeRuntimeTool,
        onComplete: vi.fn(),
        onError: vi.fn(),
        onAbort: vi.fn()
      }
    );

    await vi.waitFor(() => {
      expect(invokeRuntimeTool).toHaveBeenCalledWith({
        name: 'spawn_subagents',
        arguments: {
          tasks: [
            {
              role: 'explorer',
              instructions: 'Inspect the repo for summary bugs.'
            }
          ]
        }
      });
    });

    await vi.waitFor(() => {
      expect(writes).toContainEqual({
        id: 202,
        result: {
          success: true,
          contentItems: [
            {
              type: 'inputText',
              text: 'Spawned 1 delegated helper.'
            }
          ]
        }
      });
    });
  });

  it('maps Codex planner task-list items into native run progress', async () => {
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);
    let buffer = '';

    child.stdin.on('data', (chunk: Buffer | string) => {
      buffer += chunk.toString();

      while (true) {
        const newlineIndex = buffer.indexOf('\n');
        if (newlineIndex < 0) {
          return;
        }

        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        if (!line) {
          continue;
        }

        const message = JSON.parse(line) as { id?: number; method?: string };

        if (message.method === 'initialize') {
          child.stdout.write(`${JSON.stringify({ id: message.id, result: { userAgent: 'codex-test' } })}\n`);
          continue;
        }

        if (message.method === 'thread/start') {
          child.stdout.write(`${JSON.stringify({ id: message.id, result: { thread: { id: 'codex-thread-1' } } })}\n`);
          continue;
        }

        if (message.method === 'turn/start') {
          child.stdout.write(`${JSON.stringify({ id: message.id, result: { turn: { id: 'turn-1' } } })}\n`);
          child.stdout.write(
            `${JSON.stringify({
              method: 'item/completed',
              params: {
                item: {
                  type: 'task_list',
                  tasks: [
                    { title: 'Inspect the provider flow', status: 'completed' },
                    { title: 'Wire native progress updates', status: 'in_progress' },
                    { title: 'Verify tests', status: 'pending' }
                  ]
                }
              }
            })}\n`
          );
        }
      }
    });

    const adapter = new OpenAIAdapter();
    vi.spyOn(adapter, 'detectInstall').mockResolvedValue({
      installed: true,
      cliPath: 'C:\\Users\\test-user\\AppData\\Roaming\\npm\\codex.cmd'
    });

    const onInfo = vi.fn();

    await adapter.startRun(
      {
        threadId: 'thread-1',
        runId: 'run-1',
        prompt: 'Create a plan',
        modelId: 'gpt-5',
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

    expect(onInfo).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Codex updated its task list.',
        progress: expect.objectContaining({
          title: 'Codex tasks',
          items: [
            expect.objectContaining({
              label: 'Inspect the provider flow',
              status: 'completed'
            }),
            expect.objectContaining({
              label: 'Wire native progress updates',
              status: 'in_progress'
            }),
            expect.objectContaining({
              label: 'Verify tests',
              status: 'pending'
            })
          ]
        })
      })
    );
  });

  it('maps Codex checklist plan deltas into native run progress', async () => {
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);
    let buffer = '';

    child.stdin.on('data', (chunk: Buffer | string) => {
      buffer += chunk.toString();

      while (true) {
        const newlineIndex = buffer.indexOf('\n');
        if (newlineIndex < 0) {
          return;
        }

        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        if (!line) {
          continue;
        }

        const message = JSON.parse(line) as { id?: number; method?: string };

        if (message.method === 'initialize') {
          child.stdout.write(`${JSON.stringify({ id: message.id, result: { userAgent: 'codex-test' } })}\n`);
          continue;
        }

        if (message.method === 'thread/start') {
          child.stdout.write(`${JSON.stringify({ id: message.id, result: { thread: { id: 'codex-thread-1' } } })}\n`);
          continue;
        }

        if (message.method === 'turn/start') {
          child.stdout.write(`${JSON.stringify({ id: message.id, result: { turn: { id: 'turn-1' } } })}\n`);
          child.stdout.write(
            `${JSON.stringify({
              method: 'item/plan/delta',
              params: {
                delta: '- [x] Inspect the provider flow\n- [~] Wire native progress updates\n- [ ] Verify tests\n'
              }
            })}\n`
          );
        }
      }
    });

    const adapter = new OpenAIAdapter();
    vi.spyOn(adapter, 'detectInstall').mockResolvedValue({
      installed: true,
      cliPath: 'C:\\Users\\test-user\\AppData\\Roaming\\npm\\codex.cmd'
    });

    const onInfo = vi.fn();

    await adapter.startRun(
      {
        threadId: 'thread-1',
        runId: 'run-1',
        prompt: 'Create a plan',
        modelId: 'gpt-5',
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

    expect(onInfo).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Codex updated its task list.',
        progress: expect.objectContaining({
          items: [
            expect.objectContaining({
              label: 'Inspect the provider flow',
              status: 'completed'
            }),
            expect.objectContaining({
              label: 'Wire native progress updates',
              status: 'in_progress'
            }),
            expect.objectContaining({
              label: 'Verify tests',
              status: 'pending'
            })
          ]
        })
      })
    );
  });

  it('maps nested Codex planner checklist payloads into native run progress', async () => {
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);
    let buffer = '';

    child.stdin.on('data', (chunk: Buffer | string) => {
      buffer += chunk.toString();

      while (true) {
        const newlineIndex = buffer.indexOf('\n');
        if (newlineIndex < 0) {
          return;
        }

        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        if (!line) {
          continue;
        }

        const message = JSON.parse(line) as { id?: number; method?: string };

        if (message.method === 'initialize') {
          child.stdout.write(`${JSON.stringify({ id: message.id, result: { userAgent: 'codex-test' } })}\n`);
          continue;
        }

        if (message.method === 'thread/start') {
          child.stdout.write(`${JSON.stringify({ id: message.id, result: { thread: { id: 'codex-thread-1' } } })}\n`);
          continue;
        }

        if (message.method === 'turn/start') {
          child.stdout.write(`${JSON.stringify({ id: message.id, result: { turn: { id: 'turn-1' } } })}\n`);
          child.stdout.write(
            `${JSON.stringify({
              method: 'item/completed',
              params: {
                item: {
                  type: 'planner_update',
                  content: [
                    {
                      kind: 'task_group',
                      tasks: [
                        { label: 'Inspect the provider flow', completed: true },
                        { label: 'Wire native progress updates', current: true },
                        { label: 'Verify tests', completed: false }
                      ]
                    }
                  ]
                }
              }
            })}\n`
          );
        }
      }
    });

    const adapter = new OpenAIAdapter();
    vi.spyOn(adapter, 'detectInstall').mockResolvedValue({
      installed: true,
      cliPath: 'C:\\Users\\test-user\\AppData\\Roaming\\npm\\codex.cmd'
    });

    const onInfo = vi.fn();

    await adapter.startRun(
      {
        threadId: 'thread-1',
        runId: 'run-1',
        prompt: 'Create a plan',
        modelId: 'gpt-5',
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

    expect(onInfo).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Codex updated its task list.',
        progress: expect.objectContaining({
          items: [
            expect.objectContaining({
              label: 'Inspect the provider flow',
              status: 'completed'
            }),
            expect.objectContaining({
              label: 'Wire native progress updates',
              status: 'in_progress'
            }),
            expect.objectContaining({
              label: 'Verify tests',
              status: 'pending'
            })
          ]
        })
      })
    );
  });

  it('surfaces Codex app-server fileChange items as file evidence during planner runs', async () => {
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);
    let buffer = '';

    child.stdin.on('data', (chunk: Buffer | string) => {
      buffer += chunk.toString();

      while (true) {
        const newlineIndex = buffer.indexOf('\n');
        if (newlineIndex < 0) {
          return;
        }

        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        if (!line) {
          continue;
        }

        const message = JSON.parse(line) as { id?: number; method?: string };

        if (message.method === 'initialize') {
          child.stdout.write(`${JSON.stringify({ id: message.id, result: { userAgent: 'codex-test' } })}\n`);
          continue;
        }

        if (message.method === 'thread/start') {
          child.stdout.write(`${JSON.stringify({ id: message.id, result: { thread: { id: 'codex-thread-1' } } })}\n`);
          continue;
        }

        if (message.method === 'turn/start') {
          child.stdout.write(`${JSON.stringify({ id: message.id, result: { turn: { id: 'turn-1' } } })}\n`);
          child.stdout.write(
            `${JSON.stringify({
              method: 'item/started',
              params: {
                item: {
                  type: 'fileChange',
                  id: 'file-change-1',
                  status: 'inProgress',
                  changes: [
                    {
                      path: 'src/renderer/app.tsx',
                      kind: {
                        type: 'update',
                        move_path: null
                      },
                      diff: '@@ -1 +1 @@'
                    }
                  ]
                }
              }
            })}\n`
          );
          child.stdout.write(
            `${JSON.stringify({
              method: 'item/completed',
              params: {
                item: {
                  type: 'fileChange',
                  id: 'file-change-1',
                  status: 'completed',
                  changes: [
                    {
                      path: 'src/renderer/app.tsx',
                      kind: {
                        type: 'update',
                        move_path: null
                      },
                      diff: '@@ -1 +1 @@'
                    }
                  ]
                }
              }
            })}\n`
          );
        }
      }
    });

    const adapter = new OpenAIAdapter();
    vi.spyOn(adapter, 'detectInstall').mockResolvedValue({
      installed: true,
      cliPath: 'C:\\Users\\test-user\\AppData\\Roaming\\npm\\codex.cmd'
    });

    const onInfo = vi.fn();

    await adapter.startRun(
      {
        threadId: 'thread-1',
        runId: 'run-1',
        prompt: 'Create a plan',
        modelId: 'gpt-5',
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

    expect(onInfo).toHaveBeenCalledWith(
      expect.objectContaining({
        activity: expect.objectContaining({
          kind: 'file_write',
          summary: 'Writing src/renderer/app.tsx',
          path: 'src/renderer/app.tsx',
          status: 'started',
          providerEventType: 'item/started'
        })
      })
    );
    expect(onInfo).toHaveBeenCalledWith(
      expect.objectContaining({
        activity: expect.objectContaining({
          kind: 'file_write',
          summary: 'Wrote src/renderer/app.tsx',
          path: 'src/renderer/app.tsx',
          status: 'completed',
          providerEventType: 'item/completed'
        })
      })
    );
  });

  it('classifies unparsed task-like Codex planner items as internal diagnostics', async () => {
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);
    let buffer = '';

    child.stdin.on('data', (chunk: Buffer | string) => {
      buffer += chunk.toString();

      while (true) {
        const newlineIndex = buffer.indexOf('\n');
        if (newlineIndex < 0) {
          return;
        }

        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        if (!line) {
          continue;
        }

        const message = JSON.parse(line) as { id?: number; method?: string };

        if (message.method === 'initialize') {
          child.stdout.write(`${JSON.stringify({ id: message.id, result: { userAgent: 'codex-test' } })}\n`);
          continue;
        }

        if (message.method === 'thread/start') {
          child.stdout.write(`${JSON.stringify({ id: message.id, result: { thread: { id: 'codex-thread-1' } } })}\n`);
          continue;
        }

        if (message.method === 'turn/start') {
          child.stdout.write(`${JSON.stringify({ id: message.id, result: { turn: { id: 'turn-1' } } })}\n`);
          child.stdout.write(
            `${JSON.stringify({
              method: 'item/completed',
              params: {
                item: {
                  type: 'task_group',
                  milestones: [
                    {
                      foo: 'bar'
                    }
                  ]
                }
              }
            })}\n`
          );
        }
      }
    });

    const adapter = new OpenAIAdapter();
    vi.spyOn(adapter, 'detectInstall').mockResolvedValue({
      installed: true,
      cliPath: 'C:\\Users\\test-user\\AppData\\Roaming\\npm\\codex.cmd'
    });

    const onInfo = vi.fn();

    await adapter.startRun(
      {
        threadId: 'thread-1',
        runId: 'run-1',
        prompt: 'Create a plan',
        modelId: 'gpt-5',
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

    expect(onInfo).toHaveBeenCalledWith(
      expect.objectContaining({
        providerDiagnostics: expect.objectContaining({
          kind: 'provider_event_classification',
          source: 'codex_app_server',
          providerEventType: 'item/completed',
          itemType: 'task_group',
          taskLike: true,
          classification: 'task_candidate_unparsed'
        })
      })
    );
  });

  it('surfaces approval-shaped Codex planner items as provider-reported change activity', async () => {
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);
    let buffer = '';

    child.stdin.on('data', (chunk: Buffer | string) => {
      buffer += chunk.toString();

      while (true) {
        const newlineIndex = buffer.indexOf('\n');
        if (newlineIndex < 0) {
          return;
        }

        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        if (!line) {
          continue;
        }

        const message = JSON.parse(line) as { id?: number; method?: string };

        if (message.method === 'initialize') {
          child.stdout.write(`${JSON.stringify({ id: message.id, result: { userAgent: 'codex-test' } })}\n`);
          continue;
        }

        if (message.method === 'thread/start') {
          child.stdout.write(`${JSON.stringify({ id: message.id, result: { thread: { id: 'codex-thread-1' } } })}\n`);
          continue;
        }

        if (message.method === 'turn/start') {
          child.stdout.write(`${JSON.stringify({ id: message.id, result: { turn: { id: 'turn-1' } } })}\n`);
          child.stdout.write(
            `${JSON.stringify({
              method: 'item/completed',
              params: {
                item: {
                  type: 'fileChangeApproval',
                  decision: 'pending',
                  changes: [
                    {
                      path: 'src/renderer/app.tsx'
                    }
                  ]
                }
              }
            })}\n`
          );
        }
      }
    });

    const adapter = new OpenAIAdapter();
    vi.spyOn(adapter, 'detectInstall').mockResolvedValue({
      installed: true,
      cliPath: 'C:\\Users\\test-user\\AppData\\Roaming\\npm\\codex.cmd'
    });

    const onInfo = vi.fn();

    await adapter.startRun(
      {
        threadId: 'thread-1',
        runId: 'run-1',
        prompt: 'Create a plan',
        modelId: 'gpt-5',
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

    expect(onInfo).toHaveBeenCalledWith(
      expect.objectContaining({
        activity: expect.objectContaining({
          kind: 'change_summary',
          summary: 'Pending file-change approval for src/renderer/app.tsx',
          text: 'Pending file-change approval for src/renderer/app.tsx',
          status: 'pending',
          changeArtifact: expect.objectContaining({
            source: 'provider_reported',
            summary: {
              filesChanged: 1,
              insertions: 0,
              deletions: 0
            },
            files: [
              expect.objectContaining({
                path: 'src/renderer/app.tsx',
                status: 'modified',
                previewLines: [],
                previewTruncated: true
              })
            ]
          }),
          providerEventType: 'item/completed'
        })
      })
    );
    expect(onInfo).not.toHaveBeenCalledWith(
      expect.objectContaining({
        providerDiagnostics: expect.objectContaining({
          kind: 'provider_event_classification',
          source: 'codex_app_server',
          providerEventType: 'item/completed',
          itemType: 'fileChangeApproval'
        })
      })
    );
  });

  it('preserves add and delete statuses in provider-reported approval artifacts', async () => {
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);
    let buffer = '';

    child.stdin.on('data', (chunk: Buffer | string) => {
      buffer += chunk.toString();

      while (true) {
        const newlineIndex = buffer.indexOf('\n');
        if (newlineIndex < 0) {
          return;
        }

        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        if (!line) {
          continue;
        }

        const message = JSON.parse(line) as { id?: number; method?: string };

        if (message.method === 'initialize') {
          child.stdout.write(`${JSON.stringify({ id: message.id, result: { userAgent: 'codex-test' } })}\n`);
          continue;
        }

        if (message.method === 'thread/start') {
          child.stdout.write(`${JSON.stringify({ id: message.id, result: { thread: { id: 'codex-thread-1' } } })}\n`);
          continue;
        }

        if (message.method === 'turn/start') {
          child.stdout.write(`${JSON.stringify({ id: message.id, result: { turn: { id: 'turn-1' } } })}\n`);
          child.stdout.write(
            `${JSON.stringify({
              method: 'item/completed',
              params: {
                item: {
                  type: 'fileChangeApproval',
                  decision: 'pending',
                  changes: [
                    {
                      path: 'src/new-file.ts',
                      kind: {
                        type: 'add'
                      }
                    },
                    {
                      path: 'src/old-file.ts',
                      kind: {
                        type: 'delete'
                      }
                    }
                  ]
                }
              }
            })}\n`
          );
        }
      }
    });

    const adapter = new OpenAIAdapter();
    vi.spyOn(adapter, 'detectInstall').mockResolvedValue({
      installed: true,
      cliPath: 'C:\\Users\\test-user\\AppData\\Roaming\\npm\\codex.cmd'
    });

    const onInfo = vi.fn();

    await adapter.startRun(
      {
        threadId: 'thread-1',
        runId: 'run-1',
        prompt: 'Create a plan',
        modelId: 'gpt-5',
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

    expect(onInfo).toHaveBeenCalledWith(
      expect.objectContaining({
        activity: expect.objectContaining({
          kind: 'change_summary',
          changeArtifact: expect.objectContaining({
            source: 'provider_reported',
            summary: {
              filesChanged: 2,
              insertions: 0,
              deletions: 0
            },
            files: [
              expect.objectContaining({
                path: 'src/new-file.ts',
                status: 'added'
              }),
              expect.objectContaining({
                path: 'src/old-file.ts',
                status: 'deleted'
              })
            ]
          })
        })
      })
    );
  });

  it('surfaces confirmed Codex exec file-read events as semantic activity', async () => {
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);

    const adapter = new OpenAIAdapter();
    vi.spyOn(adapter, 'detectInstall').mockResolvedValue({
      installed: true,
      cliPath: 'C:\\Users\\test-user\\AppData\\Roaming\\npm\\codex.cmd'
    });

    const onInfo = vi.fn();

    await adapter.startRun(
      {
        threadId: 'thread-1',
        runId: 'run-1',
        prompt: 'Inspect the file evidence.',
        modelId: 'gpt-5',
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

    child.stdout.write('{"type":"read_file_begin","path":"src/renderer/app.tsx"}\n');

    await vi.waitFor(() => {
      expect(onInfo).toHaveBeenCalledWith(
        expect.objectContaining({
          activity: expect.objectContaining({
            kind: 'file_read',
            summary: 'Reading src/renderer/app.tsx',
            path: 'src/renderer/app.tsx',
            status: 'started',
            providerEventType: 'read_file_begin'
          })
        })
      );
    });
  });

  it('surfaces Codex turn diff notifications as status activity while retaining diagnostics export', async () => {
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);
    let buffer = '';

    child.stdin.on('data', (chunk: Buffer | string) => {
      buffer += chunk.toString();

      while (true) {
        const newlineIndex = buffer.indexOf('\n');
        if (newlineIndex < 0) {
          return;
        }

        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        if (!line) {
          continue;
        }

        const message = JSON.parse(line) as { id?: number; method?: string };

        if (message.method === 'initialize') {
          child.stdout.write(`${JSON.stringify({ id: message.id, result: { userAgent: 'codex-test' } })}\n`);
          continue;
        }

        if (message.method === 'thread/start') {
          child.stdout.write(`${JSON.stringify({ id: message.id, result: { thread: { id: 'codex-thread-1' } } })}\n`);
          continue;
        }

        if (message.method === 'turn/start') {
          child.stdout.write(`${JSON.stringify({ id: message.id, result: { turn: { id: 'turn-1' } } })}\n`);
          child.stdout.write(
            `${JSON.stringify({
              method: 'turn/diff',
              params: {
                files: [{ path: 'src/renderer/app.tsx' }],
                changeCount: 1
              }
            })}\n`
          );
        }
      }
    });

    const adapter = new OpenAIAdapter();
    vi.spyOn(adapter, 'detectInstall').mockResolvedValue({
      installed: true,
      cliPath: 'C:\\Users\\test-user\\AppData\\Roaming\\npm\\codex.cmd'
    });

    const onInfo = vi.fn();

    await adapter.startRun(
      {
        threadId: 'thread-1',
        runId: 'run-1',
        prompt: 'Create a plan',
        modelId: 'gpt-5',
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

    expect(onInfo).toHaveBeenCalledWith(
      expect.objectContaining({
        activity: expect.objectContaining({
          kind: 'change_summary',
          summary: 'Codex reported changes for src/renderer/app.tsx',
          text: 'Codex reported changes for src/renderer/app.tsx',
          changeArtifact: expect.objectContaining({
            source: 'provider_reported',
            summary: {
              filesChanged: 1,
              insertions: 0,
              deletions: 0
            },
            files: [
              expect.objectContaining({
                path: 'src/renderer/app.tsx',
                status: 'modified',
                previewLines: [],
                previewTruncated: true
              })
            ]
          }),
          providerEventType: 'turn/diff'
        })
      })
    );
    expect(onInfo).toHaveBeenCalledWith(
      expect.objectContaining({
        providerDiagnostics: expect.objectContaining({
          kind: 'provider_event_classification',
          source: 'codex_app_server',
          providerEventType: 'turn/diff',
          itemType: null,
          paths: ['src/renderer/app.tsx'],
          decision: null,
          status: null,
          taskLike: false,
          classification: 'evidence_candidate_unparsed'
        })
      })
    );
  });

  it('preserves add and delete statuses in provider-reported turn diff artifacts', async () => {
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);
    let buffer = '';

    child.stdin.on('data', (chunk: Buffer | string) => {
      buffer += chunk.toString();

      while (true) {
        const newlineIndex = buffer.indexOf('\n');
        if (newlineIndex < 0) {
          return;
        }

        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        if (!line) {
          continue;
        }

        const message = JSON.parse(line) as { id?: number; method?: string };

        if (message.method === 'initialize') {
          child.stdout.write(`${JSON.stringify({ id: message.id, result: { userAgent: 'codex-test' } })}\n`);
          continue;
        }

        if (message.method === 'thread/start') {
          child.stdout.write(`${JSON.stringify({ id: message.id, result: { thread: { id: 'codex-thread-1' } } })}\n`);
          continue;
        }

        if (message.method === 'turn/start') {
          child.stdout.write(`${JSON.stringify({ id: message.id, result: { turn: { id: 'turn-1' } } })}\n`);
          child.stdout.write(
            `${JSON.stringify({
              method: 'turn/diff',
              params: {
                files: [
                  {
                    path: 'src/new-file.ts',
                    kind: {
                      type: 'add'
                    }
                  },
                  {
                    path: 'src/old-file.ts',
                    kind: {
                      type: 'delete'
                    }
                  }
                ],
                changeCount: 2
              }
            })}\n`
          );
        }
      }
    });

    const adapter = new OpenAIAdapter();
    vi.spyOn(adapter, 'detectInstall').mockResolvedValue({
      installed: true,
      cliPath: 'C:\\Users\\test-user\\AppData\\Roaming\\npm\\codex.cmd'
    });

    const onInfo = vi.fn();

    await adapter.startRun(
      {
        threadId: 'thread-1',
        runId: 'run-1',
        prompt: 'Create a plan',
        modelId: 'gpt-5',
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

    expect(onInfo).toHaveBeenCalledWith(
      expect.objectContaining({
        activity: expect.objectContaining({
          kind: 'change_summary',
          changeArtifact: expect.objectContaining({
            source: 'provider_reported',
            summary: {
              filesChanged: 2,
              insertions: 0,
              deletions: 0
            },
            files: [
              expect.objectContaining({
                path: 'src/new-file.ts',
                status: 'added'
              }),
              expect.objectContaining({
                path: 'src/old-file.ts',
                status: 'deleted'
              })
            ]
          })
        })
      })
    );
  });

  it('reports native run progress capability for Codex', () => {
    expect(providerCapabilities('openai').supportsNativeRunProgress).toBe(true);
  });

  it('replies to native Codex planner questions over the active app-server session', async () => {
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);
    let buffer = '';
    const writes: Array<Record<string, unknown>> = [];

    child.stdin.on('data', (chunk: Buffer | string) => {
      buffer += chunk.toString();

      while (true) {
        const newlineIndex = buffer.indexOf('\n');
        if (newlineIndex < 0) {
          return;
        }

        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        if (!line) {
          continue;
        }

        const message = JSON.parse(line) as Record<string, unknown>;
        writes.push(message);

        if (message.method === 'initialize') {
          child.stdout.write(`${JSON.stringify({ id: message.id, result: { userAgent: 'codex-test' } })}\n`);
          continue;
        }

        if (message.method === 'thread/start') {
          child.stdout.write(
            `${JSON.stringify({
              id: message.id,
              result: {
                thread: { id: 'codex-thread-1' },
                model: 'gpt-5',
                modelProvider: 'openai',
                serviceTier: null,
                cwd: 'C:\\Users\\test-user\\Desktop\\vicode-project\\vicode-windows',
                approvalPolicy: 'never',
                sandbox: 'workspace-write',
                reasoningEffort: null
              }
            })}\n`
          );
          continue;
        }

        if (message.method === 'turn/start') {
          child.stdout.write(`${JSON.stringify({ id: message.id, result: { turn: { id: 'turn-1' } } })}\n`);
        }
      }
    });

    const adapter = new OpenAIAdapter();
    vi.spyOn(adapter, 'detectInstall').mockResolvedValue({
      installed: true,
      cliPath: 'C:\\Users\\test-user\\AppData\\Roaming\\npm\\codex.cmd'
    });

    await adapter.startRun(
      {
        threadId: 'thread-1',
        runId: 'run-1',
        prompt: 'Create a plan',
        modelId: 'gpt-5',
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

    await adapter.replyPlannerQuestions?.({
      threadId: 'thread-1',
      runId: 'run-1',
      callId: '101',
      sessionId: 'codex-thread-1',
      answers: {
        scope: { answers: ['Single viewport'] }
      }
    });

    expect(writes).toContainEqual({
      id: 101,
      result: {
        answers: {
          scope: {
            answers: ['Single viewport']
          }
        }
      }
    });
  });

  it('passes Codex long-context overrides into planner app-server sessions for gpt-5.4', async () => {
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);
    let buffer = '';

    child.stdin.on('data', (chunk: Buffer | string) => {
      buffer += chunk.toString();

      while (true) {
        const newlineIndex = buffer.indexOf('\n');
        if (newlineIndex < 0) {
          return;
        }

        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        if (!line) {
          continue;
        }

        const message = JSON.parse(line) as Record<string, unknown>;

        if (message.method === 'initialize') {
          child.stdout.write(`${JSON.stringify({ id: message.id, result: { userAgent: 'codex-test' } })}\n`);
          continue;
        }

        if (message.method === 'thread/start') {
          child.stdout.write(`${JSON.stringify({ id: message.id, result: { thread: { id: 'codex-thread-1' } } })}\n`);
          continue;
        }

        if (message.method === 'turn/start') {
          child.stdout.write(`${JSON.stringify({ id: message.id, result: { turn: { id: 'turn-1' } } })}\n`);
        }
      }
    });

    const adapter = new OpenAIAdapter();
    vi.spyOn(adapter, 'detectInstall').mockResolvedValue({
      installed: true,
      cliPath: 'C:\\Users\\test-user\\AppData\\Roaming\\npm\\codex.cmd'
    });

    await adapter.startRun(
      {
        threadId: 'thread-1',
        runId: 'run-1',
        prompt: 'Create a plan',
        modelId: 'gpt-5.4',
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

    const command = spawnMock.mock.calls[0]?.[1]?.join(' ') ?? '';
    expect(command).toContain('app-server');
    expect(command).toContain('model_context_window=1000000');
    expect(command).toContain('model_auto_compact_token_limit=750000');
  });

  it('does not force long-context overrides into planner app-server sessions for smaller Codex models', async () => {
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);
    let buffer = '';

    child.stdin.on('data', (chunk: Buffer | string) => {
      buffer += chunk.toString();

      while (true) {
        const newlineIndex = buffer.indexOf('\n');
        if (newlineIndex < 0) {
          return;
        }

        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        if (!line) {
          continue;
        }

        const message = JSON.parse(line) as Record<string, unknown>;

        if (message.method === 'initialize') {
          child.stdout.write(`${JSON.stringify({ id: message.id, result: { userAgent: 'codex-test' } })}\n`);
          continue;
        }

        if (message.method === 'thread/start') {
          child.stdout.write(`${JSON.stringify({ id: message.id, result: { thread: { id: 'codex-thread-1' } } })}\n`);
          continue;
        }

        if (message.method === 'turn/start') {
          child.stdout.write(`${JSON.stringify({ id: message.id, result: { turn: { id: 'turn-1' } } })}\n`);
        }
      }
    });

    const adapter = new OpenAIAdapter();
    vi.spyOn(adapter, 'detectInstall').mockResolvedValue({
      installed: true,
      cliPath: 'C:\\Users\\test-user\\AppData\\Roaming\\npm\\codex.cmd'
    });

    await adapter.startRun(
      {
        threadId: 'thread-1',
        runId: 'run-1',
        prompt: 'Create a plan',
        modelId: 'gpt-5.4-mini',
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

    const command = spawnMock.mock.calls[0]?.[1]?.join(' ') ?? '';
    expect(command).toContain('app-server');
    expect(command).not.toContain('model_context_window=');
    expect(command).not.toContain('model_auto_compact_token_limit=');
  });

  it('uses workspace-write sandbox flags for default-permission runs', async () => {
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);

    const adapter = new OpenAIAdapter();
    vi.spyOn(adapter, 'detectInstall').mockResolvedValue({
      installed: true,
      cliPath: 'C:\\Users\\test-user\\AppData\\Roaming\\npm\\codex.cmd'
    });

    await adapter.startRun(
      {
        threadId: 'thread-1',
        runId: 'run-1',
        prompt: 'Implement the change',
        modelId: 'gpt-5',
        folderPath: 'C:\\Users\\test-user\\Desktop\\vicode-project\\vicode-windows',
        trusted: true,
        apiKey: null,
        runMode: 'default',
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

    expect(spawnMock).toHaveBeenCalledWith(
      expect.stringMatching(/cmd\.exe$/i),
      expect.arrayContaining(['/d', '/s', '/c', 'C:\\Users\\test-user\\AppData\\Roaming\\npm\\codex.cmd']),
      expect.objectContaining({
        windowsHide: true
      })
    );
    expect(spawnMock.mock.calls[0]?.[1]?.join(' ')).not.toContain('--dangerously-bypass-approvals-and-sandbox');
  });

  it('passes Codex reasoning effort overrides for normal runs', async () => {
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);

    const adapter = new OpenAIAdapter();
    vi.spyOn(adapter, 'detectInstall').mockResolvedValue({
      installed: true,
      cliPath: 'C:\\Users\\test-user\\AppData\\Roaming\\npm\\codex.cmd'
    });

    await adapter.startRun(
      {
        threadId: 'thread-1',
        runId: 'run-1',
        prompt: 'Implement the change',
        modelId: 'gpt-5',
        reasoningEffort: 'high',
        folderPath: 'C:\\Users\\test-user\\Desktop\\vicode-project\\vicode-windows',
        trusted: true,
        apiKey: null,
        runMode: 'default',
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

    expect(spawnMock.mock.calls[0]?.[1]?.join(' ')).toContain('model_reasoning_effort="high"');
  });

  it('forces the Codex long-context overrides for gpt-5.4 exec runs', async () => {
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);

    const adapter = new OpenAIAdapter();
    vi.spyOn(adapter, 'detectInstall').mockResolvedValue({
      installed: true,
      cliPath: 'C:\\Users\\test-user\\AppData\\Roaming\\npm\\codex.cmd'
    });

    await adapter.startRun(
      {
        threadId: 'thread-1',
        runId: 'run-1',
        prompt: 'Implement the change',
        modelId: 'gpt-5.4',
        folderPath: 'C:\\Users\\test-user\\Desktop\\vicode-project\\vicode-windows',
        trusted: true,
        apiKey: null,
        runMode: 'default',
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

    const command = spawnMock.mock.calls[0]?.[1]?.join(' ') ?? '';
    expect(command).toContain('model_context_window=1000000');
    expect(command).toContain('model_auto_compact_token_limit=750000');
  });

  it('does not force long-context overrides for smaller Codex models', async () => {
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);

    const adapter = new OpenAIAdapter();
    vi.spyOn(adapter, 'detectInstall').mockResolvedValue({
      installed: true,
      cliPath: 'C:\\Users\\test-user\\AppData\\Roaming\\npm\\codex.cmd'
    });

    await adapter.startRun(
      {
        threadId: 'thread-1',
        runId: 'run-1',
        prompt: 'Implement the change',
        modelId: 'gpt-5.3-codex',
        folderPath: 'C:\\Users\\test-user\\Desktop\\vicode-project\\vicode-windows',
        trusted: true,
        apiKey: null,
        runMode: 'default',
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

    const command = spawnMock.mock.calls[0]?.[1]?.join(' ') ?? '';
    expect(command).not.toContain('model_context_window=');
    expect(command).not.toContain('model_auto_compact_token_limit=');
  });

  it('rejects untrusted workspaces through project validation', () => {
    const adapter = new OpenAIAdapter();
    expect(
      adapter.validateProjectContext('C:\\Users\\test-user\\Desktop\\vicode-project\\vicode-windows', false)
    ).toEqual({
      valid: false,
      message: 'Trust the project before running Codex against this workspace.'
    });
  });

  it('keeps dangerous bypass flags for full-access runs', async () => {
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);

    const adapter = new OpenAIAdapter();
    vi.spyOn(adapter, 'detectInstall').mockResolvedValue({
      installed: true,
      cliPath: 'C:\\Users\\test-user\\AppData\\Roaming\\npm\\codex.cmd'
    });

    await adapter.startRun(
      {
        threadId: 'thread-1',
        runId: 'run-1',
        prompt: 'Implement the change',
        modelId: 'gpt-5',
        folderPath: 'C:\\Users\\test-user\\Desktop\\vicode-project\\vicode-windows',
        trusted: true,
        apiKey: null,
        runMode: 'default',
        executionPermission: 'full_access'
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

    expect(spawnMock.mock.calls[0]?.[1]?.join(' ')).toContain('--dangerously-bypass-approvals-and-sandbox');
    expect(spawnMock.mock.calls[0]?.[1]?.join(' ')).toContain('--ephemeral');
  });

  it('returns null when Codex runtime model discovery fails before initialization completes', async () => {
    const child = new FakeChildProcess();
    const killProcessTreeSpy = vi.spyOn(providerUtil, 'killProcessTree').mockResolvedValue(undefined);
    spawnMock.mockReturnValue(child);

    const adapter = new OpenAIAdapter();
    const discovery = adapter.discoverRuntimeModels({
      account: null,
      authMode: 'cli',
      cliPath: 'C:\\Users\\test-user\\AppData\\Roaming\\npm\\codex.cmd'
    });

    setTimeout(() => {
      child.stderr.write('app-server failed');
      child.emit('error', new Error('app-server failed'));
    }, 0);

    await expect(discovery).resolves.toBeNull();
    expect(killProcessTreeSpy).toHaveBeenCalledWith(child);
  });

  it('uses the stored API key when Codex CLI auth is absent', async () => {
    const fileExistsSpy = vi.spyOn(providerUtil, 'fileExists').mockResolvedValue(false);
    const adapter = new OpenAIAdapter();

    await expect(adapter.getAuthState({ encryptedApiKey: Buffer.from('secret') } as never)).resolves.toEqual({
      authState: 'connected',
      authMode: 'api_key',
      message: 'Using encrypted API key as fallback.'
    });

    fileExistsSpy.mockRestore();
  });

  it('reports disconnected auth when neither Codex CLI auth nor a stored API key is available', async () => {
    const fileExistsSpy = vi.spyOn(providerUtil, 'fileExists').mockResolvedValue(false);
    const adapter = new OpenAIAdapter();

    await expect(adapter.getAuthState(null)).resolves.toEqual({
      authState: 'disconnected',
      authMode: null,
      message: 'Launch Codex CLI login to connect your ChatGPT plan.'
    });

    fileExistsSpy.mockRestore();
  });

  it('rejects planner replies when the Codex planner session is no longer active', async () => {
    const adapter = new OpenAIAdapter();

    await expect(
      adapter.replyPlannerQuestions({
        threadId: 'thread-1',
        runId: 'run-1',
        callId: '101',
        sessionId: 'missing-session',
        answers: {
          scope: { answers: ['Single viewport'] }
        }
      })
    ).rejects.toThrow('Codex planner session is no longer active.');
  });

  it('aborts active Codex runs through the returned cancel handle', async () => {
    const child = new FakeChildProcess();
    const killProcessTreeSpy = vi.spyOn(providerUtil, 'killProcessTree').mockResolvedValue(undefined);
    spawnMock.mockReturnValue(child);

    const adapter = new OpenAIAdapter();
    vi.spyOn(adapter, 'detectInstall').mockResolvedValue({
      installed: true,
      cliPath: 'C:\\Users\\test-user\\AppData\\Roaming\\npm\\codex.cmd'
    });
    const onAbort = vi.fn();

    const handle = await adapter.startRun(
      {
        threadId: 'thread-1',
        runId: 'run-1',
        prompt: 'Implement the change',
        modelId: 'gpt-5',
        folderPath: 'C:\\Users\\test-user\\Desktop\\vicode-project\\vicode-windows',
        trusted: true,
        apiKey: null,
        runMode: 'default',
        executionPermission: 'default'
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

  it('fails a stalled Codex exec run after idle timeout once assistant output is present', async () => {
    vi.useFakeTimers();
    const child = new FakeChildProcess();
    const killProcessTreeSpy = vi.spyOn(providerUtil, 'killProcessTree').mockResolvedValue(undefined);
    spawnMock.mockReturnValue(child);

    const adapter = new OpenAIAdapter();
    vi.spyOn(adapter, 'detectInstall').mockResolvedValue({
      installed: true,
      cliPath: 'C:\\Users\\test-user\\AppData\\Roaming\\npm\\codex.cmd'
    });
    const onComplete = vi.fn();
    const onError = vi.fn();

    try {
      await adapter.startRun(
        {
          threadId: 'thread-1',
          runId: 'run-1',
          prompt: 'Reply with exactly: ok.',
          modelId: 'gpt-5',
          folderPath: 'C:\\Users\\test-user\\Desktop\\vicode-project\\vicode-windows',
          trusted: true,
          apiKey: null,
          runMode: 'default',
          executionPermission: 'default'
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

      child.stdout.write(`${JSON.stringify({ type: 'final_answer', text: 'Done.' })}\n`);
      await vi.advanceTimersByTimeAsync(300_000);

      expect(onComplete).not.toHaveBeenCalled();
      expect(onError).toHaveBeenCalledWith(
        'Codex CLI became idle after partial output and was stopped before reaching a real completion state.'
      );
      expect(killProcessTreeSpy).toHaveBeenCalledWith(child);
    } finally {
      vi.useRealTimers();
    }
  });

  it('reconciles Codex exec assistant snapshots through the shared text-normalization contract', async () => {
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);

    const adapter = new OpenAIAdapter();
    vi.spyOn(adapter, 'detectInstall').mockResolvedValue({
      installed: true,
      cliPath: 'C:\\Users\\test-user\\AppData\\Roaming\\npm\\codex.cmd'
    });
    const onDelta = vi.fn();
    const onAssistantSnapshot = vi.fn();
    const onComplete = vi.fn();

    await adapter.startRun(
      {
        threadId: 'thread-1',
        runId: 'run-1',
        prompt: 'Reply with exactly: ok.',
        modelId: 'gpt-5',
        folderPath: 'C:\\Users\\test-user\\Desktop\\vicode-project\\vicode-windows',
        trusted: true,
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

    child.stdout.write(`${JSON.stringify({ type: 'final_answer', text: 'Yes,' })}\n`);
    child.stdout.write(`${JSON.stringify({ type: 'final_answer', text: 'Yes,“the 21st night of September”' })}\n`);
    child.emit('close', 0);

    await vi.waitFor(() => {
      expect(onAssistantSnapshot.mock.calls.map((call) => call[0])).toEqual([
        'Yes,',
        'Yes,“the 21st night of September”'
      ]);
      expect(onComplete).toHaveBeenCalledWith('Yes,“the 21st night of September”');
    });
    expect(onDelta).not.toHaveBeenCalled();
  });

  it('keeps Codex app-server planner deltas and snapshots raw for the shared provider-manager seam', async () => {
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);
    let buffer = '';

    child.stdin.on('data', (chunk: Buffer | string) => {
      buffer += chunk.toString();

      while (true) {
        const newlineIndex = buffer.indexOf('\n');
        if (newlineIndex < 0) {
          return;
        }

        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        if (!line) {
          continue;
        }

        const message = JSON.parse(line) as { id?: number; method?: string };

        if (message.method === 'initialize') {
          child.stdout.write(`${JSON.stringify({ id: message.id, result: { userAgent: 'codex-test' } })}\n`);
          continue;
        }

        if (message.method === 'thread/start') {
          child.stdout.write(
            `${JSON.stringify({
              id: message.id,
              result: {
                thread: { id: 'codex-thread-1' },
                model: 'gpt-5',
                modelProvider: 'openai',
                serviceTier: null,
                cwd: 'C:\\Users\\test-user\\Desktop\\vicode-project\\vicode-windows',
                approvalPolicy: 'never',
                sandbox: 'workspace-write',
                reasoningEffort: null
              }
            })}\n`
          );
          continue;
        }

        if (message.method === 'turn/start') {
          child.stdout.write(`${JSON.stringify({ id: message.id, result: { turn: { id: 'turn-1' } } })}\n`);
          child.stdout.write(`${JSON.stringify({ method: 'item/agentMessage/delta', params: { delta: 'Yes,' } })}\n`);
          child.stdout.write(
            `${JSON.stringify({ method: 'item/agentMessage/delta', params: { delta: '“the 21st night of September”' } })}\n`
          );
          child.stdout.write(
            `${JSON.stringify({
              method: 'item/completed',
              params: {
                item: {
                  type: 'agentMessage',
                  text: 'Yes,“the 21st night of September”'
                }
              }
            })}\n`
          );
          child.stdout.write(`${JSON.stringify({ method: 'turn/completed', params: {} })}\n`);
        }
      }
    });

    const adapter = new OpenAIAdapter();
    vi.spyOn(adapter, 'detectInstall').mockResolvedValue({
      installed: true,
      cliPath: 'C:\\Users\\test-user\\AppData\\Roaming\\npm\\codex.cmd'
    });
    const onDelta = vi.fn();
    const onAssistantSnapshot = vi.fn();
    const onComplete = vi.fn();

    await adapter.startRun(
      {
        threadId: 'thread-1',
        runId: 'run-1',
        prompt: 'Create a plan',
        modelId: 'gpt-5',
        folderPath: 'C:\\Users\\test-user\\Desktop\\vicode-project\\vicode-windows',
        trusted: true,
        apiKey: null,
        runMode: 'plan',
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

    await vi.waitFor(() => {
      expect(onDelta.mock.calls.map((call) => call[0])).toEqual([
        'Yes,',
        '“the 21st night of September”'
      ]);
      expect(onAssistantSnapshot).toHaveBeenCalledWith('Yes,“the 21st night of September”');
      expect(onComplete).toHaveBeenCalledWith('Yes,“the 21st night of September”');
    });
  });

  it('reports an error when Codex spawn errors instead of simulating output', async () => {
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);

    const adapter = new OpenAIAdapter();
    vi.spyOn(adapter, 'detectInstall').mockResolvedValue({
      installed: true,
      cliPath: 'C:\\Users\\test-user\\AppData\\Roaming\\npm\\codex.cmd'
    });
    const onComplete = vi.fn();
    const onError = vi.fn();

    await adapter.startRun(
      {
        threadId: 'thread-1',
        runId: 'run-1',
        prompt: 'Reply with exactly: ok.',
        modelId: 'gpt-5',
        folderPath: 'C:\\Users\\test-user\\Desktop\\vicode-project\\vicode-windows',
        trusted: true,
        apiKey: null,
        runMode: 'default',
        executionPermission: 'default'
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

    child.emit('error', new Error('spawn failed'));
    child.emit('close', -4058);

    await vi.waitFor(() => {
      expect(onError).toHaveBeenCalledWith('Failed to launch Codex CLI: spawn failed');
    });
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('uses a Windows shell environment that resolves .cmd shims safely', async () => {
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);

    const previousComSpec = process.env.ComSpec;
    const previousCOMSPEC = process.env.COMSPEC;
    const previousSystemRoot = process.env.SystemRoot;
    process.env.ComSpec = 'cmd.exe';
    process.env.COMSPEC = 'cmd.exe';
    process.env.SystemRoot = 'C:\\Windows';

    const adapter = new OpenAIAdapter();
    vi.spyOn(adapter, 'detectInstall').mockResolvedValue({
      installed: true,
      cliPath: 'C:\\Users\\test-user\\AppData\\Roaming\\npm\\codex.cmd'
    });

    try {
      await adapter.startRun(
        {
          threadId: 'thread-1',
          runId: 'run-1',
          prompt: 'Reply with exactly: ok.',
          modelId: 'gpt-5',
          folderPath: 'C:\\Users\\test-user\\Desktop\\vicode-project\\vicode-windows',
          trusted: true,
          apiKey: null,
          runMode: 'default',
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
    } finally {
      process.env.ComSpec = previousComSpec;
      process.env.COMSPEC = previousCOMSPEC;
      process.env.SystemRoot = previousSystemRoot;
    }

    expect(String(spawnMock.mock.calls[0]?.[0] ?? '')).toMatch(/cmd\.exe$/i);
    expect(spawnMock.mock.calls[0]?.[2]).toMatchObject({
      env: expect.objectContaining({
        ComSpec: expect.stringMatching(/cmd\.exe$/i),
        COMSPEC: expect.stringMatching(/cmd\.exe$/i),
        SystemRoot: 'C:\\Windows'
      })
    });
  });

  it('fails when Codex exits successfully without producing assistant output', async () => {
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);

    const adapter = new OpenAIAdapter();
    vi.spyOn(adapter, 'detectInstall').mockResolvedValue({
      installed: true,
      cliPath: 'C:\\Users\\test-user\\AppData\\Roaming\\npm\\codex.cmd'
    });
    const onComplete = vi.fn();
    const onError = vi.fn();

    await adapter.startRun(
      {
        threadId: 'thread-1',
        runId: 'run-1',
        prompt: 'Reply with exactly: ok.',
        modelId: 'gpt-5',
        folderPath: 'C:\\Users\\test-user\\Desktop\\vicode-project\\vicode-windows',
        trusted: true,
        apiKey: null,
        runMode: 'default',
        executionPermission: 'default'
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

    child.emit('close', 0);

    await vi.waitFor(() => {
      expect(onError).toHaveBeenCalledWith('Codex CLI exited successfully without producing assistant output.');
    });
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('surfaces Codex exec command lifecycle as generic tool evidence plus terminal activity', async () => {
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);

    const adapter = new OpenAIAdapter();
    vi.spyOn(adapter, 'detectInstall').mockResolvedValue({
      installed: true,
      cliPath: 'C:\\Users\\test-user\\AppData\\Roaming\\npm\\codex.cmd'
    });
    const onInfo = vi.fn();
    const handle = await adapter.startRun(
      {
        threadId: 'thread-1',
        runId: 'run-1',
        prompt: 'Reply with exactly: ok.',
        modelId: 'gpt-5',
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

    child.stdout.write('{"type":"exec_command_begin","command":["npm","test"],"cwd":"C:/repo"}\n');
    child.stdout.write('{"type":"exec_command_end","command":["npm","test"],"cwd":"C:/repo","status":"completed","output":"1 passed"}\n');

    await vi.waitFor(() => {
      expect(onInfo).toHaveBeenCalledWith(
        expect.objectContaining({
          activity: expect.objectContaining({
            kind: 'tool_call',
            toolName: 'exec_command',
            providerEventType: 'exec_command_begin'
          })
        })
      );
      expect(onInfo).toHaveBeenCalledWith(
        expect.objectContaining({
          activity: expect.objectContaining({
            kind: 'tool_result',
            toolName: 'exec_command',
            status: 'completed',
            providerEventType: 'exec_command_end'
          })
        })
      );
      expect(onInfo).toHaveBeenCalledWith(
        expect.objectContaining({
          activity: expect.objectContaining({
            kind: 'terminal_command',
            command: 'npm test',
            cwd: 'C:/repo'
          })
        })
      );
    });

    await handle.cancel('Stopped by user.');
  });

  it('surfaces Codex patch lifecycle as apply_patch evidence plus file writes', async () => {
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);

    const adapter = new OpenAIAdapter();
    vi.spyOn(adapter, 'detectInstall').mockResolvedValue({
      installed: true,
      cliPath: 'C:\\Users\\test-user\\AppData\\Roaming\\npm\\codex.cmd'
    });
    const onInfo = vi.fn();
    const handle = await adapter.startRun(
      {
        threadId: 'thread-1',
        runId: 'run-1',
        prompt: 'Reply with exactly: ok.',
        modelId: 'gpt-5',
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

    child.stdout.write('{"type":"patch_apply_begin","changes":{"src/app.tsx":{"type":"update","unified_diff":"--- src/app.tsx\\n+++ src/app.tsx\\n@@\\n-old\\n+new\\n"}}}\n');
    child.stdout.write('{"type":"patch_apply_end","status":"completed","stdout":"applied 1 change","changes":{"src/app.tsx":{"type":"update","unified_diff":"--- src/app.tsx\\n+++ src/app.tsx\\n@@\\n-old\\n+new\\n"}}}\n');

    await vi.waitFor(() => {
      expect(onInfo).toHaveBeenCalledWith(
        expect.objectContaining({
          activity: expect.objectContaining({
            kind: 'tool_call',
            toolName: 'apply_patch',
            providerEventType: 'patch_apply_begin'
          })
        })
      );
      expect(onInfo).toHaveBeenCalledWith(
        expect.objectContaining({
          activity: expect.objectContaining({
            kind: 'tool_result',
            toolName: 'apply_patch',
            providerEventType: 'patch_apply_end'
          })
        })
      );
      expect(onInfo).toHaveBeenCalledWith(
        expect.objectContaining({
          activity: expect.objectContaining({
            kind: 'file_write',
            summary: 'Wrote src/app.tsx',
            path: 'src/app.tsx'
          })
        })
      );
    });

    await handle.cancel('Stopped by user.');
  });
});
