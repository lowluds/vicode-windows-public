import { describe, expect, it } from 'vitest';
import {
  getAgentToolDeniedMessage,
  getAgentToolPolicy,
  isAgentToolAllowed,
  listAgentToolPolicies
} from './agent-tool-policy';

describe('agent tool policy', () => {
  it('lists the bounded Ollama tool policy matrix', () => {
    expect(listAgentToolPolicies().map((policy) => policy.name)).toEqual([
      'list_directory',
      'read_file',
      'search_text',
      'web_search',
      'extract_web_page',
      'map_site',
      'crawl_site',
      'research_topic',
      'browser_preview_check',
      'mkdir',
      'write_file',
      'apply_patch',
      'run_command'
    ]);
  });

  it('keeps shell commands gated behind full access', () => {
    expect(isAgentToolAllowed('run_command', 'default')).toBe(false);
    expect(isAgentToolAllowed('run_command', 'full_access')).toBe(true);
    expect(getAgentToolDeniedMessage('run_command', 'default')).toBe(
      'run_command requires Full access. Full access enables host-local commands according to the workspace runtime policy; commands are not contained sandbox execution.'
    );
  });

  it('allows bounded reads and writes under default permissions', () => {
    expect(isAgentToolAllowed('read_file', 'default')).toBe(true);
    expect(isAgentToolAllowed('apply_patch', 'default')).toBe(true);
    expect(isAgentToolAllowed('web_search', 'default')).toBe(true);
    expect(isAgentToolAllowed('research_topic', 'default')).toBe(true);
    expect(isAgentToolAllowed('browser_preview_check', 'default')).toBe(true);
    expect(getAgentToolPolicy('apply_patch')).toEqual(
      expect.objectContaining({
        category: 'write',
        workspaceBounded: true
      })
    );
    expect(getAgentToolPolicy('web_search')).toEqual(
      expect.objectContaining({
        category: 'network',
        workspaceBounded: false
      })
    );
    expect(getAgentToolPolicy('crawl_site')).toEqual(
      expect.objectContaining({
        category: 'network',
        workspaceBounded: false
      })
    );
    expect(getAgentToolPolicy('browser_preview_check')).toEqual(
      expect.objectContaining({
        category: 'network',
        workspaceBounded: false
      })
    );
  });
});
