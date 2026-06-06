import { contextBridge, ipcRenderer } from 'electron';
import type { VicodeApi } from '../shared/ipc';

const api: VicodeApi = {
  app: {
    getBootstrap: () => ipcRenderer.invoke('app:getBootstrap'),
    pickFolder: () => ipcRenderer.invoke('app:pickFolder'),
    openExternal: (url) => ipcRenderer.invoke('app:openExternal', { url }),
    openPath: (path) => ipcRenderer.invoke('app:openPath', { path }),
    revealPath: (path) => ipcRenderer.invoke('app:revealPath', { path }),
    getMeta: () => ipcRenderer.invoke('app:getMeta'),
    getNativeTheme: () => ipcRenderer.invoke('app:getNativeTheme'),
    adjustZoom: (action) => ipcRenderer.invoke('app:adjustZoom', { action })
  },
  updates: {
    getState: () => ipcRenderer.invoke('updates:getState'),
    checkForUpdates: () => ipcRenderer.invoke('updates:checkForUpdates'),
    restartToUpdate: () => ipcRenderer.invoke('updates:restartToUpdate')
  },
  voice: {
    getMicrophoneAccessStatus: () => ipcRenderer.invoke('voice:getMicrophoneAccessStatus'),
    transcribe: (input) => ipcRenderer.invoke('voice:transcribe', input)
  },
  projects: {
    create: (input) => ipcRenderer.invoke('projects:create', input),
    update: (input) => ipcRenderer.invoke('projects:update', input),
    remove: (projectId) => ipcRenderer.invoke('projects:remove', { projectId })
  },
  threads: {
    list: (projectId) => ipcRenderer.invoke('threads:list', projectId),
    listArchived: (projectId) => ipcRenderer.invoke('threads:listArchived', { projectId: projectId ?? null }),
    open: (threadId) => ipcRenderer.invoke('threads:open', { threadId }),
    summarizeForCollaboration: (threadId) => ipcRenderer.invoke('threads:summarizeForCollaboration', { threadId }),
    listAutonomousTasks: (threadId) => ipcRenderer.invoke('threads:listAutonomousTasks', { threadId }),
    createFollowUp: (input) => ipcRenderer.invoke('threads:createFollowUp', input),
    updateFollowUp: (followUpId, content) => ipcRenderer.invoke('threads:updateFollowUp', { followUpId, content }),
    removeFollowUp: (followUpId) => ipcRenderer.invoke('threads:removeFollowUp', { followUpId }),
    getDraft: (threadId) => ipcRenderer.invoke('threads:getDraft', { threadId }),
    saveDraft: (threadId, prompt) => ipcRenderer.invoke('threads:saveDraft', { threadId, prompt }),
    clearDraft: (threadId) => ipcRenderer.invoke('threads:clearDraft', { threadId }),
    create: (input) => ipcRenderer.invoke('threads:create', input),
    rename: (threadId, title) => ipcRenderer.invoke('threads:rename', { threadId, title }),
    setExecutionPermission: (threadId, executionPermission) =>
      ipcRenderer.invoke('threads:setExecutionPermission', { threadId, executionPermission }),
    archive: (threadId) => ipcRenderer.invoke('threads:archive', { threadId }),
    restore: (threadId) => ipcRenderer.invoke('threads:restore', { threadId }),
    remove: (threadId) => ipcRenderer.invoke('threads:delete', { threadId }),
    duplicate: (threadId, fromTurnId) => ipcRenderer.invoke('threads:duplicate', { threadId, fromTurnId }),
    retry: (threadId) => ipcRenderer.invoke('threads:retry', { threadId })
  },
  composer: {
    submit: (input) => ipcRenderer.invoke('composer:submit', input),
    createTextAttachment: (input) => ipcRenderer.invoke('composer:createTextAttachment', input),
    deleteTextAttachment: (input) => ipcRenderer.invoke('composer:deleteTextAttachment', input),
    enhancePrompt: (input) => ipcRenderer.invoke('composer:enhancePrompt', input),
    stop: (runId) => ipcRenderer.invoke('composer:stop', { runId })
  },
  runs: {
    approveToolApproval: (approvalId) => ipcRenderer.invoke('runs:approveToolApproval', { approvalId }),
    rejectToolApproval: (approvalId) => ipcRenderer.invoke('runs:rejectToolApproval', { approvalId }),
    previewStagedWorkspaceChange: (input) => ipcRenderer.invoke('runs:previewStagedWorkspaceChange', input),
    applyStagedWorkspaceChange: (input) => ipcRenderer.invoke('runs:applyStagedWorkspaceChange', input),
    rejectStagedWorkspaceChange: (input) => ipcRenderer.invoke('runs:rejectStagedWorkspaceChange', input),
    revertStagedWorkspaceChange: (input) => ipcRenderer.invoke('runs:revertStagedWorkspaceChange', input),
    applyStagedWorkspaceHunks: (input) => ipcRenderer.invoke('runs:applyStagedWorkspaceHunks', input),
    rejectStagedWorkspaceHunks: (input) => ipcRenderer.invoke('runs:rejectStagedWorkspaceHunks', input),
    revertStagedWorkspaceHunks: (input) => ipcRenderer.invoke('runs:revertStagedWorkspaceHunks', input),
    applyWorktreeReview: (input) => ipcRenderer.invoke('runs:applyWorktreeReview', input),
    rejectWorktreeReview: (input) => ipcRenderer.invoke('runs:rejectWorktreeReview', input),
    revertWorktreeReview: (input) => ipcRenderer.invoke('runs:revertWorktreeReview', input),
    applyWorktreeHunks: (input) => ipcRenderer.invoke('runs:applyWorktreeHunks', input),
    rejectWorktreeHunks: (input) => ipcRenderer.invoke('runs:rejectWorktreeHunks', input),
    revertWorktreeHunks: (input) => ipcRenderer.invoke('runs:revertWorktreeHunks', input),
    cleanupWorktreeReview: (input) => ipcRenderer.invoke('runs:cleanupWorktreeReview', input)
  },
  planner: {
    setMode: (input) => ipcRenderer.invoke('planner:setMode', input),
    submit: (input) => ipcRenderer.invoke('planner:submit', input),
    answer: (input) => ipcRenderer.invoke('planner:answer', input),
    approvePlan: (input) => ipcRenderer.invoke('planner:approvePlan', input),
    cancel: (input) => ipcRenderer.invoke('planner:cancel', input)
  },
  providers: {
    list: () => ipcRenderer.invoke('providers:list'),
    startAuth: (providerId, mode, options) => ipcRenderer.invoke('providers:startAuth', { providerId, mode, force: options?.force }),
    adoptAuth: (providerId) => ipcRenderer.invoke('providers:adoptAuth', { providerId }),
    clearAuth: (providerId) => ipcRenderer.invoke('providers:clearAuth', providerId),
    saveApiKey: (providerId, apiKey) => ipcRenderer.invoke('providers:saveApiKey', { providerId, apiKey }),
    refresh: (providerId) => ipcRenderer.invoke('providers:refresh', providerId),
    listCustom: () => ipcRenderer.invoke('providers:listCustom'),
    saveCustom: (input) => ipcRenderer.invoke('providers:saveCustom', input),
    removeCustom: (providerId) => ipcRenderer.invoke('providers:removeCustom', { providerId })
  },
  ollamaRuntime: {
    getStatus: () => ipcRenderer.invoke('ollamaRuntime:getStatus'),
    start: () => ipcRenderer.invoke('ollamaRuntime:start'),
    stop: () => ipcRenderer.invoke('ollamaRuntime:stop'),
    listModels: () => ipcRenderer.invoke('ollamaRuntime:listModels'),
    pullModel: (model) => ipcRenderer.invoke('ollamaRuntime:pullModel', { model }),
    deleteModel: (model) => ipcRenderer.invoke('ollamaRuntime:deleteModel', { model })
  },
  skills: {
    list: () => ipcRenderer.invoke('skills:list'),
    detail: (skillId) => ipcRenderer.invoke('skills:detail', { skillId }),
    save: (input) => ipcRenderer.invoke('skills:save', input),
    toggle: (skillId, enabled) => ipcRenderer.invoke('skills:toggle', { skillId, enabled }),
    installSuggested: (input) => ipcRenderer.invoke('skills:installSuggested', input),
    rescanLibrary: () => ipcRenderer.invoke('skills:rescanLibrary'),
    remove: (skillId) => ipcRenderer.invoke('skills:remove', { skillId })
  },
  library: {
    getSources: () => ipcRenderer.invoke('library:getSources')
  },
  projectKnowledge: {
    getIndexStatus: () => ipcRenderer.invoke('projectKnowledge:getIndexStatus'),
    refreshIndex: () => ipcRenderer.invoke('projectKnowledge:refreshIndex'),
    suggestIndex: () => ipcRenderer.invoke('projectKnowledge:suggestIndex'),
    openSuggestedIndexDraft: () => ipcRenderer.invoke('projectKnowledge:openSuggestedIndexDraft')
  },
  automations: {
    list: () => ipcRenderer.invoke('automations:list'),
    listRuns: (automationId) => ipcRenderer.invoke('automations:listRuns', { automationId }),
    save: (input) => ipcRenderer.invoke('automations:save', input),
    toggle: (automationId, enabled) => ipcRenderer.invoke('automations:toggle', { automationId, enabled }),
    remove: (automationId) => ipcRenderer.invoke('automations:delete', { automationId }),
    runNow: (automationId) => ipcRenderer.invoke('automations:runNow', { automationId })
  },
  jobs: {
    list: () => ipcRenderer.invoke('jobs:list'),
    listPendingReviews: () => ipcRenderer.invoke('jobs:listPendingReviews'),
    updateReviewDraft: (reviewItemId, content) => ipcRenderer.invoke('jobs:updateReviewDraft', { reviewItemId, content }),
    approveReview: (reviewItemId) => ipcRenderer.invoke('jobs:approveReview', { reviewItemId }),
    rejectReview: (reviewItemId) => ipcRenderer.invoke('jobs:rejectReview', { reviewItemId })
  },
  mcp: {
    syncImports: () => ipcRenderer.invoke('mcp:syncImports'),
    listServers: () => ipcRenderer.invoke('mcp:listServers'),
    listCatalog: () => ipcRenderer.invoke('mcp:listCatalog'),
    saveServer: (input) => ipcRenderer.invoke('mcp:saveServer', input),
    setupRecommended: (input) => ipcRenderer.invoke('mcp:setupRecommended', input),
    refreshServer: (serverId) => ipcRenderer.invoke('mcp:refreshServer', { serverId }),
    approveLaunch: (serverId) => ipcRenderer.invoke('mcp:approveLaunch', { serverId }),
    setEnabled: (serverId, enabled) => ipcRenderer.invoke('mcp:setEnabled', { serverId, enabled }),
    removeServer: (serverId) => ipcRenderer.invoke('mcp:removeServer', { serverId })
  },
  subagents: {
    list: (threadId) => ipcRenderer.invoke('subagents:list', { threadId }),
    spawn: (input) => ipcRenderer.invoke('subagents:spawn', input),
    cancel: (subagentId) => ipcRenderer.invoke('subagents:cancel', { subagentId }),
    getDetail: (subagentId) => ipcRenderer.invoke('subagents:getDetail', { subagentId })
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    save: (input) => ipcRenderer.invoke('settings:save', input)
  },
  diagnostics: {
    export: () => ipcRenderer.invoke('diagnostics:export'),
    exportThread: (threadId) => ipcRenderer.invoke('diagnostics:exportThread', { threadId }),
    exportThreadReport: (threadId) => ipcRenderer.invoke('diagnostics:exportThreadReport', { threadId }),
    getStorage: () => ipcRenderer.invoke('diagnostics:getStorage'),
    compactRunEvents: () => ipcRenderer.invoke('diagnostics:compactRunEvents'),
    maintainStorage: (input?: { vacuum?: boolean }) => ipcRenderer.invoke('diagnostics:maintainStorage', input)
  },
  collab: {
    getBootstrap: () => ipcRenderer.invoke('collab:getBootstrap'),
    configure: (input) => ipcRenderer.invoke('collab:configure', input),
    clearConfig: () => ipcRenderer.invoke('collab:clearConfig'),
    createGuestProfile: (input) => ipcRenderer.invoke('collab:createGuestProfile', input),
    clearIdentity: () => ipcRenderer.invoke('collab:clearIdentity'),
    updateProfile: (input) => ipcRenderer.invoke('collab:updateProfile', input),
    createRoom: (input) =>
      ipcRenderer.invoke('collab:createRoom', {
        name: input.name,
        ...(input.password?.trim() ? { password: input.password.trim() } : {}),
        ...(input.topic != null ? { topic: input.topic } : {}),
        ...(input.projectLabel != null ? { projectLabel: input.projectLabel } : {})
      }),
    joinRoom: (input) =>
      ipcRenderer.invoke('collab:joinRoom', {
        joinCode: input.joinCode,
        ...(input.password?.trim() ? { password: input.password.trim() } : {})
      }),
    createDirectChat: (input) => ipcRenderer.invoke('collab:createDirectChat', input),
    listRooms: () => ipcRenderer.invoke('collab:listRooms'),
    openRoom: (roomId) => ipcRenderer.invoke('collab:openRoom', { roomId }),
    listChats: () => ipcRenderer.invoke('collab:listChats'),
    openChat: (chatId) => ipcRenderer.invoke('collab:openChat', { roomId: chatId }),
    listContacts: () => ipcRenderer.invoke('collab:listContacts'),
    setFollowing: (input) => ipcRenderer.invoke('collab:setFollowing', input),
    requestRole: (input) => ipcRenderer.invoke('collab:requestRole', input),
    resolveRoleRequest: (input) => ipcRenderer.invoke('collab:resolveRoleRequest', input),
    setTerminalMode: (input) => ipcRenderer.invoke('collab:setTerminalMode', input),
    sendMessage: (input) => ipcRenderer.invoke('collab:sendMessage', input),
    setPresence: (input) => ipcRenderer.invoke('collab:setPresence', input),
    shareThread: (input) => ipcRenderer.invoke('collab:shareThread', input),
    shareRun: (input) => ipcRenderer.invoke('collab:shareRun', input),
    createHandoff: (input) => ipcRenderer.invoke('collab:createHandoff', input)
  },
  events: {
    subscribe: (listener) => {
      const subscription = (_event: Electron.IpcRendererEvent, payload: unknown) => {
        listener(payload as never);
      };
      ipcRenderer.on('vicode:event', subscription);
      return () => ipcRenderer.removeListener('vicode:event', subscription);
    }
  }
};

contextBridge.exposeInMainWorld('vicode', api);
