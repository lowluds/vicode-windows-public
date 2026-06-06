import { beforeEach, describe, expect, it, vi } from 'vitest';

const exposeInMainWorldMock = vi.fn();
const invokeMock = vi.fn();

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: exposeInMainWorldMock
  },
  ipcRenderer: {
    invoke: invokeMock
  }
}));

describe('preload api', () => {
  beforeEach(() => {
    vi.resetModules();
    exposeInMainWorldMock.mockClear();
    invokeMock.mockReset();
  });

  it('exposes staged workspace preview and review actions through the runs API', async () => {
    await import('./index');

    const api = exposeInMainWorldMock.mock.calls[0]?.[1];
    expect(api).toBeTruthy();

    await api.runs.previewStagedWorkspaceChange({
      threadId: 'thread-1',
      runId: 'run-1',
      stagedEventId: 'event-staged'
    });
    expect(invokeMock).toHaveBeenCalledWith('runs:previewStagedWorkspaceChange', {
      threadId: 'thread-1',
      runId: 'run-1',
      stagedEventId: 'event-staged'
    });

    await api.runs.applyStagedWorkspaceChange({
      threadId: 'thread-1',
      runId: 'run-1',
      stagedEventId: 'event-staged'
    });
    expect(invokeMock).toHaveBeenCalledWith('runs:applyStagedWorkspaceChange', {
      threadId: 'thread-1',
      runId: 'run-1',
      stagedEventId: 'event-staged'
    });

    await api.runs.rejectStagedWorkspaceChange({
      threadId: 'thread-1',
      runId: 'run-1',
      stagedEventIndex: 0
    });
    expect(invokeMock).toHaveBeenCalledWith('runs:rejectStagedWorkspaceChange', {
      threadId: 'thread-1',
      runId: 'run-1',
      stagedEventIndex: 0
    });

    await api.runs.revertStagedWorkspaceChange({
      threadId: 'thread-1',
      runId: 'run-1',
      stagedEventId: 'event-staged'
    });
    expect(invokeMock).toHaveBeenCalledWith('runs:revertStagedWorkspaceChange', {
      threadId: 'thread-1',
      runId: 'run-1',
      stagedEventId: 'event-staged'
    });

    await api.runs.applyStagedWorkspaceHunks({
      threadId: 'thread-1',
      runId: 'run-1',
      stagedEventId: 'event-staged',
      acceptedHunkIds: ['hunk-1'],
      rejectedHunkIds: ['hunk-2']
    });
    expect(invokeMock).toHaveBeenCalledWith('runs:applyStagedWorkspaceHunks', {
      threadId: 'thread-1',
      runId: 'run-1',
      stagedEventId: 'event-staged',
      acceptedHunkIds: ['hunk-1'],
      rejectedHunkIds: ['hunk-2']
    });

    await api.runs.rejectStagedWorkspaceHunks({
      threadId: 'thread-1',
      runId: 'run-1',
      stagedEventIndex: 0,
      hunkIds: ['hunk-1']
    });
    expect(invokeMock).toHaveBeenCalledWith('runs:rejectStagedWorkspaceHunks', {
      threadId: 'thread-1',
      runId: 'run-1',
      stagedEventIndex: 0,
      hunkIds: ['hunk-1']
    });

    await api.runs.revertStagedWorkspaceHunks({
      threadId: 'thread-1',
      runId: 'run-1',
      stagedEventId: 'event-staged'
    });
    expect(invokeMock).toHaveBeenCalledWith('runs:revertStagedWorkspaceHunks', {
      threadId: 'thread-1',
      runId: 'run-1',
      stagedEventId: 'event-staged'
    });

    await api.runs.applyWorktreeReview({
      threadId: 'thread-1',
      runId: 'run-1'
    });
    expect(invokeMock).toHaveBeenCalledWith('runs:applyWorktreeReview', {
      threadId: 'thread-1',
      runId: 'run-1'
    });

    await api.runs.rejectWorktreeReview({
      threadId: 'thread-1',
      runId: 'run-1'
    });
    expect(invokeMock).toHaveBeenCalledWith('runs:rejectWorktreeReview', {
      threadId: 'thread-1',
      runId: 'run-1'
    });

    await api.runs.revertWorktreeReview({
      threadId: 'thread-1',
      runId: 'run-1'
    });
    expect(invokeMock).toHaveBeenCalledWith('runs:revertWorktreeReview', {
      threadId: 'thread-1',
      runId: 'run-1'
    });

    await api.runs.applyWorktreeHunks({
      threadId: 'thread-1',
      runId: 'run-1',
      acceptedHunkIds: ['hunk-1'],
      rejectedHunkIds: ['hunk-2']
    });
    expect(invokeMock).toHaveBeenCalledWith('runs:applyWorktreeHunks', {
      threadId: 'thread-1',
      runId: 'run-1',
      acceptedHunkIds: ['hunk-1'],
      rejectedHunkIds: ['hunk-2']
    });

    await api.runs.rejectWorktreeHunks({
      threadId: 'thread-1',
      runId: 'run-1',
      hunkIds: ['hunk-1']
    });
    expect(invokeMock).toHaveBeenCalledWith('runs:rejectWorktreeHunks', {
      threadId: 'thread-1',
      runId: 'run-1',
      hunkIds: ['hunk-1']
    });

    await api.runs.revertWorktreeHunks({
      threadId: 'thread-1',
      runId: 'run-1'
    });
    expect(invokeMock).toHaveBeenCalledWith('runs:revertWorktreeHunks', {
      threadId: 'thread-1',
      runId: 'run-1'
    });

    await api.runs.cleanupWorktreeReview({
      threadId: 'thread-1',
      runId: 'run-1'
    });
    expect(invokeMock).toHaveBeenCalledWith('runs:cleanupWorktreeReview', {
      threadId: 'thread-1',
      runId: 'run-1'
    });
  });
});
