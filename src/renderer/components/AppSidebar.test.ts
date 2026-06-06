import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { LibrarySourcesSnapshot, Preferences } from "../../shared/domain";
import { AppSidebar } from "./AppSidebar";
import { TooltipProvider } from "./ui";

const defaultPreferences: Preferences = {
  selectedProjectId: null,
  defaultProviderId: "openai",
  defaultModelByProvider: {
    openai: "gpt-5",
    gemini: "gemini-2.5-pro",
    qwen: "qwen3.5-plus",
    ollama: "qwen3-coder",
    kimi: "kimi-k2-thinking",
  },
  defaultReasoningEffortByProvider: {
    openai: "medium",
    gemini: null,
    qwen: null,
    ollama: null,
    kimi: null,
  },
  defaultThinkingByProvider: {
    openai: true,
    gemini: true,
    qwen: true,
    ollama: true,
    kimi: true,
  },
  ollamaTransportMode: "auto",
  defaultExecutionPermission: "default",
  followUpBehavior: "ask",
  generatedMemoryUseEnabled: false,
  generatedMemoryGenerationEnabled: true,
  appearanceMode: "system",
  accentMode: "system",
  accentColor: null,
  onboardingComplete: true,
  lastOpenedThreadId: null,
  microphoneAllowed: false,
  userLibraryPath: null,
  skillsLibraryPath: null,
  llmWikiLibraryPath: null,
};

const librarySources: LibrarySourcesSnapshot = {
  userLibrary: {
    kind: "user_library",
    label: "User Library",
    path: null,
    status: "not_configured",
    message: "User Library folder is not configured.",
    entries: [],
  },
  skills: {
    kind: "skills",
    label: "Skills",
    path: null,
    status: "not_configured",
    message: "Skills folder is not configured.",
    entries: [],
  },
  llmWiki: {
    kind: "llm_wiki",
    label: "Project Knowledge Folder",
    path: null,
    status: "not_configured",
    message: "Project Knowledge folder is not configured.",
    entries: [],
  },
};

describe("AppSidebar", () => {
  it("renders primary sidebar commands and per-project actions in the sidebar chrome", () => {
    const html = renderToStaticMarkup(
      React.createElement(
        TooltipProvider,
        null,
        React.createElement(AppSidebar, {
          route: "thread",
          openProjectFromPicker: vi.fn(async () => {}),
          activateChatsLibrary: vi.fn(async () => {}),
          createChatThread: vi.fn(async () => {}),
          createThreadForProject: vi.fn(async () => {}),
          renameProject: vi.fn(async () => {}),
          archiveProjectThreads: vi.fn(async () => {}),
          removeProject: vi.fn(async () => {}),
          removingProjectId: null,
          preferences: defaultPreferences,
          skills: [
            {
              id: "skill-review",
              name: "Review Helper",
              description: "Review code with findings first.",
              instructions: "Review code.",
              origin: "custom_local",
              scope: "global",
              providerTargets: ["openai"],
              enabled: true,
              projectId: null,
              metadata: {},
              path: null,
              createdAt: "2026-04-21T00:00:00.000Z",
              updatedAt: "2026-04-21T00:00:00.000Z",
            },
          ],
          attachedSkillIds: [],
          composerContextWindow: null,
          librarySources,
          projects: [
            {
              id: "project-1",
              name: "self-hosted-llm",
              folderPath: "D:\\Projects\\self-hosted-llm",
              trusted: true,
              runtimeCommandPolicy: "approval_required",
              runtimeNetworkPolicy: "enabled",
              defaultProviderId: "openai",
              defaultModelByProvider: {
                openai: "gpt-5",
                gemini: "gemini-2.5-pro",
                qwen: "qwen3.5-plus",
                ollama: "qwen2.5-coder:14b",
                kimi: "kimi-k2-thinking",
              },
              createdAt: "2026-04-21T00:00:00.000Z",
              updatedAt: "2026-04-21T00:00:00.000Z",
            },
            {
              id: "chat-project",
              name: "Chat",
              folderPath: null,
              trusted: true,
              runtimeCommandPolicy: "approval_required",
              runtimeNetworkPolicy: "disabled",
              defaultProviderId: "ollama",
              defaultModelByProvider: {
                openai: "gpt-5",
                gemini: "gemini-2.5-pro",
                qwen: "qwen3.5-plus",
                ollama: "qwen3-coder",
                kimi: "kimi-k2-thinking",
              },
              createdAt: "2026-04-21T00:00:01.000Z",
              updatedAt: "2026-04-21T00:00:01.000Z",
            },
          ],
          expandedProjectIds: ["project-1", "chat-project"],
          toggleProjectThreads: vi.fn(async () => {}),
          collapseAllProjectThreads: vi.fn(),
          reorderProjects: vi.fn(),
          threadsByProject: {
            "project-1": [],
            "chat-project": [
              {
                id: "chat-thread",
                projectId: "chat-project",
                title: "Model comparison notes",
                providerId: "ollama",
                modelId: "qwen3-coder",
                executionPermission: "default",
                status: "draft",
                archived: false,
                createdAt: "2026-04-21T00:00:02.000Z",
                updatedAt: "2026-04-21T00:00:02.000Z",
                lastMessageAt: "2026-04-21T00:00:02.000Z",
                lastPreview: "Compare local models.",
              },
            ],
          },
          subagentsByThreadId: {},
          activeThreadId: null,
          activeThreadActions: null,
          openThread: vi.fn(async () => {}),
          renameThread: vi.fn(async () => {}),
          archiveThread: vi.fn(async () => {}),
          deleteThread: vi.fn(),
          toggleAttachedSkill: vi.fn(),
          openSkillsRoute: vi.fn(),
          openLibrarySettings: vi.fn(),
          rescanSkillLibrary: vi.fn(async () => {}),
          openProjectFolderLocation: vi.fn(async () => {}),
          sidebarCollapsed: false,
          toggleSidebar: vi.fn(),
        }),
      ),
    );

    expect(html).toContain('aria-label="Chat browser options"');
    expect(html).toContain('aria-label="Project browser options"');
    expect(html).toContain('aria-label="Search library"');
    expect(html).toContain('aria-label="Library filters"');
    expect(html).not.toContain('aria-label="Collapse all project threads"');
    expect(html).not.toContain("Show All Projects");
    expect(html).not.toContain("Hide All Projects");
    expect(html).not.toContain("Show Chats");
    expect(html).not.toContain("Hide Chats");
    expect(html).not.toMatch(/work-library-group-header"><span>Projects<\/span><span>\d+<\/span>/);
    expect(html).not.toMatch(/work-library-group-header"><span>Chats<\/span><span>\d+<\/span>/);
    expect(html).not.toMatch(/work-library-group-header"><span>Enabled<\/span><span>\d+<\/span>/);
    expect(html).not.toContain("Collections");
    expect(html).toContain("Library");
    expect(html).toContain("Places");
    expect(html).toContain("Projects");
    expect(html).toContain("Chats");
    expect(html).toContain("Name");
    expect(html).toContain("Skills");
    expect(html).toContain("Knowledge");
    expect(html).toContain("Skills Folder");
    expect(html).toContain("Project Knowledge Folder");
    expect(html).toContain("Tools");
    expect(html).not.toContain("User Library</span>");
    expect(html).not.toContain("Repositories");
    expect(html).toContain('aria-label="Start new thread for self-hosted-llm"');
    expect(html).toContain('aria-label="Project actions"');
    expect(html).toContain('aria-label="Thread actions"');
    expect(html).toContain("Model comparison notes");
    expect(html).not.toContain('nav-sidebar-settings');
  });
});
