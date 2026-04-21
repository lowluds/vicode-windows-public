import { describe, expect, it } from 'vitest';
import { extractCodexCliInfoMessages, extractGeminiCliInfoMessages } from './run-activity';

describe('provider run activity helpers', () => {
  it('extracts OpenAI/Codex search and command summaries from JSON events', () => {
    expect(extractCodexCliInfoMessages({ type: 'web_search_begin', query: 'hero section examples' })).toEqual([
      {
        message: 'Calling web search',
        activity: {
          kind: 'tool_call',
          summary: 'Calling web search',
          toolName: 'web_search',
          status: 'started',
          text: 'query: hero section examples',
          providerEventType: 'web_search_begin'
        }
      },
      {
        message: 'Searching web for hero section examples',
        activity: {
          kind: 'web_search',
          phase: 'started',
          summary: 'Searching web for hero section examples',
          query: 'hero section examples',
          url: null,
          status: 'started',
          providerEventType: 'web_search_begin'
        }
      }
    ]);
    expect(extractCodexCliInfoMessages({ type: 'exec_command_begin', command: ['npm', 'test'] })).toEqual([
      {
        message: 'Calling exec command',
        activity: {
          kind: 'tool_call',
          summary: 'Calling exec command',
          toolName: 'exec_command',
          command: 'npm test',
          cwd: null,
          status: 'started',
          text: 'command: npm test',
          providerEventType: 'exec_command_begin'
        }
      },
      {
        message: 'Running npm test',
        activity: {
          kind: 'terminal_command',
          phase: 'started',
          summary: 'Running npm test',
          command: 'npm test',
          cwd: null,
          status: 'started',
          providerEventType: 'exec_command_begin',
          background: false
        }
      }
    ]);
    expect(extractCodexCliInfoMessages({ type: 'exec_command_begin', command: ['npm', '--version'], cwd: '.' })).toEqual([
      {
        message: 'Calling exec command',
        activity: {
          kind: 'tool_call',
          summary: 'Calling exec command',
          toolName: 'exec_command',
          command: 'npm --version',
          cwd: '.',
          status: 'started',
          text: 'command: npm --version\ncwd: .',
          providerEventType: 'exec_command_begin'
        }
      },
      {
        message: 'Running npm --version · Workspace root',
        activity: {
          kind: 'terminal_command',
          phase: 'started',
          summary: 'Running npm --version · Workspace root',
          command: 'npm --version',
          cwd: '.',
          status: 'started',
          providerEventType: 'exec_command_begin',
          background: false
        }
      }
    ]);
    expect(extractCodexCliInfoMessages({ type: 'exec_command_end', command: ['npm', 'test'] })).toEqual([
      {
        message: 'Completed exec command',
        activity: {
          kind: 'tool_result',
          summary: 'Completed exec command',
          toolName: 'exec_command',
          command: 'npm test',
          cwd: null,
          status: 'completed',
          text: 'command: npm test',
          providerEventType: 'exec_command_end'
        }
      },
      {
        message: 'Ran npm test',
        activity: {
          kind: 'terminal_command',
          phase: 'completed',
          summary: 'Ran npm test',
          command: 'npm test',
          cwd: null,
          status: 'completed',
          providerEventType: 'exec_command_end',
          background: false
        }
      }
    ]);
    expect(
      extractCodexCliInfoMessages({
        type: 'item.started',
        item: {
          id: 'item_1',
          type: 'command_execution',
          command: '"pwsh.exe" -Command pwd',
          aggregated_output: '',
          exit_code: null,
          status: 'in_progress'
        }
      })
    ).toEqual([
      {
        message: 'Calling exec command',
        activity: {
          kind: 'tool_call',
          summary: 'Calling exec command',
          toolName: 'exec_command',
          command: '"pwsh.exe" -Command pwd',
          cwd: null,
          status: 'in_progress',
          text: 'command: "pwsh.exe" -Command pwd',
          providerEventType: 'command_execution'
        }
      },
      {
        message: 'Running "pwsh.exe" -Command pwd',
        activity: {
          kind: 'terminal_command',
          phase: 'started',
          summary: 'Running "pwsh.exe" -Command pwd',
          command: '"pwsh.exe" -Command pwd',
          cwd: null,
          status: 'in_progress',
          providerEventType: 'command_execution',
          background: false
        }
      }
    ]);
    expect(
      extractCodexCliInfoMessages({
        type: 'item.completed',
        item: {
          id: 'item_1',
          type: 'command_execution',
          command: '"pwsh.exe" -Command pwd',
          aggregated_output: '\r\nPath\r\n----\r\nD:\\Workspace\\vicode-windows\r\n\r\n',
          exit_code: 0,
          status: 'completed'
        }
      })
    ).toEqual([
      {
        message: 'Completed exec command',
        activity: {
          kind: 'tool_result',
          summary: 'Completed exec command',
          toolName: 'exec_command',
          command: '"pwsh.exe" -Command pwd',
          cwd: null,
          status: 'completed',
          text: 'command: "pwsh.exe" -Command pwd',
          providerEventType: 'command_execution'
        }
      },
      {
        message: 'Ran "pwsh.exe" -Command pwd',
        activity: {
          kind: 'terminal_command',
          phase: 'completed',
          summary: 'Ran "pwsh.exe" -Command pwd',
          command: '"pwsh.exe" -Command pwd',
          cwd: null,
          status: 'completed',
          providerEventType: 'command_execution',
          background: false
        }
      }
    ]);
    expect(
      extractCodexCliInfoMessages({
        type: 'patch_apply_end',
        status: 'completed',
        changes: {
          'src/app.tsx': {
            type: 'update',
            unified_diff: '--- src/app.tsx\n+++ src/app.tsx\n@@\n-old\n+new\n'
          },
          'src/new.ts': {
            type: 'add',
            content: 'export const x = 1;\n'
          },
          'src/old.ts': {
            type: 'delete',
            content: 'legacy\n'
          }
        },
        stdout: 'applied 3 changes'
      })
    ).toEqual([
      {
        message: 'Completed apply patch',
        activity: {
          kind: 'tool_result',
          summary: 'Completed apply patch',
          toolName: 'apply_patch',
          status: 'completed',
          text: 'files: src/app.tsx, src/new.ts, src/old.ts\nresult: applied 3 changes',
          providerEventType: 'patch_apply_end'
        }
      },
      {
        message: 'Wrote src/app.tsx',
        activity: {
          kind: 'file_write',
          summary: 'Wrote src/app.tsx',
          path: 'src/app.tsx',
          status: 'completed',
          providerEventType: 'patch_apply_end'
        }
      },
      {
        message: 'Wrote src/new.ts',
        activity: {
          kind: 'file_write',
          summary: 'Wrote src/new.ts',
          path: 'src/new.ts',
          status: 'completed',
          providerEventType: 'patch_apply_end'
        }
      },
      {
        message: 'Deleted src/old.ts',
        activity: {
          kind: 'file_write',
          summary: 'Deleted src/old.ts',
          path: 'src/old.ts',
          status: 'completed',
          providerEventType: 'patch_apply_end'
        }
      }
    ]);
    expect(
      extractCodexCliInfoMessages({
        type: 'agent_reasoning_raw_content',
        text: 'Checking the current files before editing.'
      })
    ).toEqual([
      {
        message: 'Checking the current files before editing.',
        activity: {
          kind: 'thinking',
          summary: 'Checking the current files before editing.',
          text: 'Checking the current files before editing.',
          providerEventType: 'agent_reasoning_raw_content'
        }
      }
    ]);

    expect(
      extractCodexCliInfoMessages({
        type: 'read_file_begin',
        path: 'src/renderer/app.tsx'
      })
    ).toEqual([
      {
        message: 'Calling read file',
        activity: {
          kind: 'tool_call',
          summary: 'Calling read file',
          toolName: 'read_file',
          status: 'started',
          text: 'path: src/renderer/app.tsx',
          providerEventType: 'read_file_begin'
        }
      },
      {
        message: 'Reading src/renderer/app.tsx',
        activity: {
          kind: 'file_read',
          summary: 'Reading src/renderer/app.tsx',
          path: 'src/renderer/app.tsx',
          status: 'started',
          providerEventType: 'read_file_begin'
        }
      }
    ]);

    expect(
      extractCodexCliInfoMessages({
        type: 'list_directory_end',
        path: 'src/renderer',
        status: 'completed'
      })
    ).toEqual([
      {
        message: 'Completed list directory',
        activity: {
          kind: 'tool_result',
          summary: 'Completed list directory',
          toolName: 'list_directory',
          status: 'completed',
          text: 'path: src/renderer',
          providerEventType: 'list_directory_end'
        }
      },
      {
        message: 'Opened src/renderer',
        activity: {
          kind: 'file_open',
          summary: 'Opened src/renderer',
          path: 'src/renderer',
          status: 'completed',
          providerEventType: 'list_directory_end'
        }
      }
    ]);

    expect(
      extractCodexCliInfoMessages({
        type: 'list_directory_end',
        path: '.',
        status: 'completed'
      })
    ).toEqual([
      {
        message: 'Completed list directory',
        activity: {
          kind: 'tool_result',
          summary: 'Completed list directory',
          toolName: 'list_directory',
          status: 'completed',
          text: 'path: .',
          providerEventType: 'list_directory_end'
        }
      },
      {
        message: 'Opened Workspace root',
        activity: {
          kind: 'file_open',
          summary: 'Opened Workspace root',
          path: 'Workspace root',
          status: 'completed',
          providerEventType: 'list_directory_end'
        }
      }
    ]);

    expect(
      extractCodexCliInfoMessages({
        type: 'grep_begin',
        pattern: 'tool_result',
        path: 'src/providers',
        status: 'started'
      })
    ).toEqual([
      {
        message: 'Calling grep',
        activity: {
          kind: 'tool_call',
          summary: 'Calling grep',
          toolName: 'grep',
          status: 'started',
          text: 'query: tool_result\npath: src/providers',
          providerEventType: 'grep_begin'
        }
      },
      {
        message: 'Searching files for tool_result',
        activity: {
          kind: 'file_search',
          summary: 'Searching files for tool_result',
          query: 'tool_result',
          path: 'src/providers',
          status: 'started',
          providerEventType: 'grep_begin'
        }
      }
    ]);

    expect(
      extractCodexCliInfoMessages({
        type: 'tool_use',
        tool_name: 'write_file',
        path: 'src/generated.ts'
      })
    ).toEqual([
      {
        message: 'Calling write file',
        activity: {
          kind: 'tool_call',
          summary: 'Calling write file',
          toolName: 'write_file',
          status: 'started',
          text: 'path: src/generated.ts',
          providerEventType: 'tool_use'
        }
      },
      {
        message: 'Writing src/generated.ts',
        activity: {
          kind: 'file_write',
          summary: 'Writing src/generated.ts',
          path: 'src/generated.ts',
          status: 'started',
          providerEventType: 'tool_use'
        }
      }
    ]);

    expect(
      extractCodexCliInfoMessages({
        type: 'tool_result',
        tool_name: 'mkdir',
        path: 'src/generated',
        status: 'success',
        result: 'created directory'
      })
    ).toEqual([
      {
        message: 'Completed mkdir',
        activity: {
          kind: 'tool_result',
          summary: 'Completed mkdir',
          toolName: 'mkdir',
          status: 'success',
          text: 'path: src/generated\nresult: created directory',
          providerEventType: 'tool_result'
        }
      },
      {
        message: 'Created folder',
        activity: {
          kind: 'mkdir',
          summary: 'Created folder',
          path: 'src/generated',
          status: 'success',
          providerEventType: 'tool_result'
        }
      }
    ]);
  });

  it('extracts Gemini shell and web-search summaries from structured tool events', () => {
    expect(
      extractGeminiCliInfoMessages({
        type: 'tool',
        toolName: 'google_web_search',
        status: 'in_progress',
        query: 'hero section examples'
      })
    ).toEqual([
      {
        message: 'Calling google web search',
        activity: {
          kind: 'tool_call',
          summary: 'Calling google web search',
          toolName: 'google_web_search',
          status: 'in_progress',
          text: 'query: hero section examples',
          providerEventType: 'tool'
        }
      },
      {
        message: 'Searching web for hero section examples',
        activity: {
          kind: 'web_search',
          phase: 'started',
          summary: 'Searching web for hero section examples',
          query: 'hero section examples',
          url: null,
          toolName: 'google_web_search',
          status: 'in_progress',
          providerEventType: 'tool'
        }
      }
    ]);

    expect(
      extractGeminiCliInfoMessages({
        type: 'tool',
        toolName: 'run_shell_command',
        status: 'completed',
        command: 'npm test',
        stdout: '> vitest run'
      })
    ).toEqual([
      {
        message: 'Completed run shell command',
        activity: {
          kind: 'tool_result',
          summary: 'Completed run shell command',
          toolName: 'run_shell_command',
          command: 'npm test',
          cwd: null,
          status: 'completed',
          text: 'command: npm test\nresult: > vitest run',
          providerEventType: 'tool'
        }
      },
      {
        message: 'Ran npm test',
        activity: {
          kind: 'terminal_command',
          phase: 'completed',
          summary: 'Ran npm test',
          command: 'npm test',
          cwd: null,
          toolName: 'run_shell_command',
          status: 'completed',
          providerEventType: 'tool',
          background: false
        }
      },
      {
        message: '> vitest run',
        activity: {
          kind: 'terminal_output',
          summary: '> vitest run',
          text: '> vitest run',
          outputLines: ['> vitest run'],
          providerEventType: 'tool'
        }
      }
    ]);

    expect(
      extractGeminiCliInfoMessages({
        type: 'tool',
        toolName: 'read_file',
        status: 'completed',
        path: 'src/renderer/app.tsx'
      })
    ).toEqual([
      {
        message: 'Completed read file',
        activity: {
          kind: 'tool_result',
          summary: 'Completed read file',
          toolName: 'read_file',
          status: 'completed',
          text: 'path: src/renderer/app.tsx',
          providerEventType: 'tool'
        }
      },
      {
        message: 'Read src/renderer/app.tsx',
        activity: {
          kind: 'file_read',
          summary: 'Read src/renderer/app.tsx',
          path: 'src/renderer/app.tsx',
          toolName: 'read_file',
          status: 'completed',
          providerEventType: 'tool'
        }
      }
    ]);

    expect(
      extractGeminiCliInfoMessages({
        type: 'tool_use',
        tool_name: 'list_directory',
        tool_id: 'list_directory_1',
        parameters: {
          dir_path: 'C:\\Users\\test-user\\Desktop\\vitest'
        }
      })
    ).toEqual([
      {
        message: 'Calling list directory',
        activity: {
          kind: 'tool_call',
          summary: 'Calling list directory',
          toolName: 'list_directory',
          status: 'started',
          text: 'path: C:\\Users\\test-user\\Desktop\\vitest',
          providerEventType: 'tool_use'
        }
      },
      {
        message: 'Opened C:\\Users\\test-user\\Desktop\\vitest',
        activity: {
          kind: 'file_open',
          summary: 'Opened C:\\Users\\test-user\\Desktop\\vitest',
          path: 'C:\\Users\\test-user\\Desktop\\vitest',
          toolName: 'list_directory',
          status: '',
          providerEventType: 'tool_use'
        }
      }
    ]);

    expect(
      extractGeminiCliInfoMessages({
        type: 'tool_use',
        tool_name: 'read_file',
        tool_id: 'read_file_1',
        parameters: {
          file_path: 'src/renderer/app.tsx'
        }
      })
    ).toEqual([
      {
        message: 'Calling read file',
        activity: {
          kind: 'tool_call',
          summary: 'Calling read file',
          toolName: 'read_file',
          status: 'started',
          text: 'path: src/renderer/app.tsx',
          providerEventType: 'tool_use'
        }
      },
      {
        message: 'Read src/renderer/app.tsx',
        activity: {
          kind: 'file_read',
          summary: 'Read src/renderer/app.tsx',
          path: 'src/renderer/app.tsx',
          toolName: 'read_file',
          status: '',
          providerEventType: 'tool_use'
        }
      }
    ]);

    expect(
      extractGeminiCliInfoMessages({
        type: 'reasoning_delta',
        delta: 'Reviewing the current workspace before editing.'
      })
    ).toEqual([
      {
        message: 'Reviewing the current workspace before editing.',
        activity: {
          kind: 'thinking',
          summary: 'Reviewing the current workspace before editing.',
          text: 'Reviewing the current workspace before editing.',
          providerEventType: 'reasoning_delta'
        }
      }
    ]);

    expect(
      extractGeminiCliInfoMessages({
        type: 'tool_use',
        tool_name: 'write_file',
        path: 'src/main.tsx'
      })
    ).toEqual([
      {
        message: 'Calling write file',
        activity: {
          kind: 'tool_call',
          summary: 'Calling write file',
          toolName: 'write_file',
          status: 'started',
          text: 'path: src/main.tsx',
          providerEventType: 'tool_use'
        }
      },
      {
        message: 'Writing src/main.tsx',
        activity: {
          kind: 'file_write',
          summary: 'Writing src/main.tsx',
          path: 'src/main.tsx',
          toolName: 'write_file',
          status: 'started',
          providerEventType: 'tool_use'
        }
      }
    ]);
  });

  it('ignores Gemini chat message events so user prompts and assistant replies do not duplicate in activity rows', () => {
    expect(
      extractGeminiCliInfoMessages({
        type: 'message',
        role: 'user',
        content: 'Reply with exactly PASS and nothing else.'
      })
    ).toEqual([]);

    expect(
      extractGeminiCliInfoMessages({
        type: 'message',
        role: 'assistant',
        content: 'PASS',
        delta: true
      })
    ).toEqual([]);

    expect(
      extractGeminiCliInfoMessages({
        type: 'result',
        status: 'success',
        usageMetadata: {
          promptTokenCount: 1200,
          candidatesTokenCount: 340,
          totalTokenCount: 1540
        }
      })
    ).toEqual([
      {
        contextWindow: {
          usedTokens: 1540,
          inputTokens: 1200,
          outputTokens: 340,
          providerEventType: 'result'
        }
      }
    ]);
  });

  it('converts Gemini extension loading lines into a dedupeable skill activity', () => {
    expect(
      extractGeminiCliInfoMessages({
        type: 'status',
        message: 'Loading extension: superpowers'
      })
    ).toEqual([
      {
        message: 'superpowers',
        activity: {
          kind: 'skill',
          summary: 'superpowers',
          text: 'superpowers',
          toolName: null,
          status: null,
          providerEventType: 'status'
        }
      }
    ]);
  });

  it('ignores generic Gemini tool_use payloads so raw generated code does not leak into chat activity', () => {
    expect(
      extractGeminiCliInfoMessages({
        type: 'tool_use',
        message:
          'import { Button } from "@/components/ui/button"; export default function Hero() { return <Button>Enter</Button>; }'
      })
    ).toEqual([]);
  });
});
