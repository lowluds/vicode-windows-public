import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { RunTranscriptItem } from '../lib/run-activity';
import { RunTranscriptTimeline } from './RunTranscriptTimeline';

describe('RunTranscriptTimeline streaming assistant rendering', () => {
  function createActivityItem(
    id: string,
    activityKind: Extract<RunTranscriptItem, { kind: 'activity_line' }>['activityKind'],
    overrides: Partial<Extract<RunTranscriptItem, { kind: 'activity_line' }>> = {}
  ): Extract<RunTranscriptItem, { kind: 'activity_line' }> {
    return {
      id,
      kind: 'activity_line',
      activityKind,
      providerEventType: overrides.providerEventType ?? null,
      toolName: overrides.toolName ?? null,
      label: overrides.label ?? id,
      text: overrides.text ?? id,
      url: overrides.url ?? null,
      path: overrides.path ?? null,
      command: overrides.command ?? null,
      cwd: overrides.cwd ?? null,
      isolationMode: overrides.isolationMode ?? null,
      status: overrides.status ?? null,
      startedAt: overrides.startedAt ?? null,
      finishedAt: overrides.finishedAt ?? null,
      durationLabel: overrides.durationLabel ?? null,
      outputLines: overrides.outputLines ?? []
    };
  }

  it('keeps in-progress assistant text on the lightweight plain-text path while streaming', () => {
    const html = renderToStaticMarkup(
      <RunTranscriptTimeline
        items={[
          {
            id: 'assistant',
            kind: 'assistant_text',
            text: 'Streaming **bold** output'
          } satisfies RunTranscriptItem
        ]}
        skills={[]}
        runState="running"
      />
    );

    expect(html).toContain('Streaming **bold** output');
    expect(html).not.toContain('<strong>');
  });

  it('renders running reasoning and keeps the reasoning content open', () => {
    const html = renderToStaticMarkup(
      <RunTranscriptTimeline
        items={[
          createActivityItem('tool-call', 'tool_call', {
            toolName: 'run_command',
            label: 'Calling run command',
            text: 'command: npm test'
          }),
          createActivityItem('reasoning', 'thinking', {
            label: 'Inspecting timeline behavior before using tools.',
            text: 'Inspecting timeline behavior before using tools.'
          }),
          createActivityItem('tool-result', 'tool_result', {
            toolName: 'run_command',
            label: 'Completed run command',
            text: 'exit_code: 0'
          })
        ]}
        skills={[]}
        runState="running"
      />
    );

    expect(html).toContain('Reasoning');
    expect(html).toContain('Inspecting timeline behavior before using tools.');
    expect(html).toContain('data-state="open"');
  });

  it('keeps completed reasoning collapsed into the worked summary path', () => {
    const html = renderToStaticMarkup(
      <RunTranscriptTimeline
        items={[
          createActivityItem('reasoning', 'thinking', {
            label: 'Reviewing results.',
            text: 'Reviewing results.'
          }),
          {
            id: 'worked-for',
            kind: 'worked_for',
            label: 'Worked for 14s'
          } satisfies RunTranscriptItem,
          {
            id: 'assistant-final',
            kind: 'assistant_text',
            text: 'The run completed.'
          } satisfies RunTranscriptItem
        ]}
        skills={[]}
        runState="completed"
      />
    );

    expect(html).toContain('Worked for 14s');
    expect(html).toContain('1 previous step');
    expect(html).toContain('The run completed.');
    expect(html).not.toContain('Reviewing results.');
  });

  it('renders memory checkpoints without exposing backend file paths', () => {
    const html = renderToStaticMarkup(
      <RunTranscriptTimeline
        items={[
          {
            id: 'checkpoint',
            kind: 'activity_line',
            activityKind: 'memory_checkpoint',
            providerEventType: null,
            toolName: null,
            label: 'Project checkpoint saved',
            text: 'Project checkpoint saved',
            url: null,
            path: 'C:\\workspace\\memory\\2026-05-23.md',
            command: null,
            cwd: null,
            isolationMode: null,
            status: null,
            startedAt: null,
            finishedAt: null,
            durationLabel: null,
            outputLines: []
          } satisfies RunTranscriptItem
        ]}
        skills={[]}
        runState="completed"
        compactActivity={false}
      />
    );

    expect(html).toContain('Project checkpoint saved');
    expect(html).not.toContain('C:\\workspace');
    expect(html).not.toContain('2026-05-23.md');
  });

  it('marks Project Knowledge context with a subdued transcript class', () => {
    const html = renderToStaticMarkup(
      <RunTranscriptTimeline
        items={[
          createActivityItem('knowledge', 'guidance', {
            label: 'Context: Runtime Patterns',
            text: 'Context: Runtime Patterns',
            providerEventType: 'project_knowledge_context',
            path: 'C:\\knowledge\\runtime.md'
          })
        ]}
        skills={[]}
        runState="running"
        compactActivity={false}
      />
    );

    expect(html).toContain('run-transcript-activity-line-project-knowledge');
    expect(html).toContain('Context: Runtime Patterns');
    expect(html).not.toContain('C:\\knowledge\\runtime.md');
  });

  it('marks used skills with a subdued transcript class', () => {
    const html = renderToStaticMarkup(
      <RunTranscriptTimeline
        items={[
          createActivityItem('skills', 'skill', {
            label: 'Using: Reviewer',
            text: 'Using: Reviewer',
            providerEventType: 'skills_using'
          })
        ]}
        skills={[]}
        runState="running"
        compactActivity={false}
      />
    );

    expect(html).toContain('run-transcript-activity-line-skill');
    expect(html).toContain('Using: Reviewer');
  });
});
