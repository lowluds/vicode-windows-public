import { describe, expect, it } from 'vitest';
import { NATIVE_AGENT_RUNTIME_TOOL_DEFINITIONS } from './agent-runtime-native-tools';

const coreToolNames = [
  'list_directory',
  'read_file',
  'search_text',
  'mkdir',
  'write_file',
  'apply_patch',
  'run_command',
  'browser_preview_check'
] as const;

function findNativeTool(callName: string) {
  const definition = NATIVE_AGENT_RUNTIME_TOOL_DEFINITIONS.find((tool) => tool.callName === callName);
  if (!definition) {
    throw new Error(`Missing native tool definition: ${callName}`);
  }
  return definition;
}

describe('native agent runtime tool definitions', () => {
  it('exposes canonical Zod schemas and provider JSON schemas for every native tool', () => {
    for (const definition of NATIVE_AGENT_RUNTIME_TOOL_DEFINITIONS) {
      expect(definition.inputSchema).toEqual(
        expect.objectContaining({
          safeParse: expect.any(Function)
        })
      );
      expect(definition.inputJsonSchema).toEqual(
        expect.objectContaining({
          type: 'object'
        })
      );
    }
  });

  it('validates the core native tooling contract before runtime dispatch', () => {
    for (const callName of coreToolNames) {
      expect(findNativeTool(callName).inputSchema.safeParse({}).success).toBe(
        callName === 'list_directory'
      );
    }

    expect(findNativeTool('read_file').inputSchema.safeParse({ path: 'src/main.ts' }).success).toBe(true);
    expect(findNativeTool('read_file').inputSchema.safeParse({ path: '' }).success).toBe(false);

    expect(findNativeTool('write_file').inputSchema.safeParse({
      path: 'src/main.ts',
      content: 'export {};\n'
    }).success).toBe(true);
    expect(findNativeTool('write_file').inputSchema.safeParse({
      path: 'src/main.ts',
      content: 123
    }).success).toBe(false);

    expect(findNativeTool('run_command').inputSchema.safeParse({
      command: 'npm test'
    }).success).toBe(true);
    expect(findNativeTool('run_command').inputSchema.safeParse({
      command: ''
    }).success).toBe(false);

    expect(findNativeTool('browser_preview_check').inputSchema.safeParse({
      url: 'http://localhost:5173',
      expected_selectors: ['#root'],
      timeout_ms: 10_000
    }).success).toBe(true);
    expect(findNativeTool('browser_preview_check').inputSchema.safeParse({
      url: 'http://localhost:5173',
      expected_selectors: ['#root', 42]
    }).success).toBe(false);

    expect(findNativeTool('apply_patch').requiresApproval).toBe(true);
  });

  it('exposes read-only Project Knowledge tools', () => {
    const toolNames = NATIVE_AGENT_RUNTIME_TOOL_DEFINITIONS.map((tool) => tool.callName);

    expect(toolNames).toEqual(expect.arrayContaining([
      'project_knowledge_search',
      'project_knowledge_read',
      'project_knowledge_list'
    ]));
    expect(findNativeTool('project_knowledge_search').inputSchema.safeParse({
      query: 'routing rules'
    }).success).toBe(true);
    expect(findNativeTool('project_knowledge_read').inputSchema.safeParse({
      path: 'runtime.md'
    }).success).toBe(true);
    expect(findNativeTool('project_knowledge_list').inputSchema.safeParse({
      max_results: 10
    }).success).toBe(true);
  });
});
