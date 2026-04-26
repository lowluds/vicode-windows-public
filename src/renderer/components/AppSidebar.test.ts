import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  AppSidebar,
  getCurrentThreadActionMenuItems,
  getProjectActionMenuItems,
} from "./AppSidebar";
import { TooltipProvider } from "./ui";

describe("AppSidebar", () => {
  it("renders collapse-all tools and per-project new-thread actions in the sidebar chrome", () => {
    const html = renderToStaticMarkup(
      React.createElement(
        TooltipProvider,
        null,
        React.createElement(AppSidebar, {
          route: "thread",
          openProjectFromPicker: vi.fn(async () => {}),
          createThreadForProject: vi.fn(async () => {}),
          renameProject: vi.fn(async () => {}),
          archiveProjectThreads: vi.fn(async () => {}),
          removeProject: vi.fn(async () => {}),
          removingProjectId: null,
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
          ],
          expandedProjectIds: ["project-1"],
          toggleProjectThreads: vi.fn(async () => {}),
          collapseAllProjectThreads: vi.fn(),
          reorderProjects: vi.fn(),
          threadsByProject: { "project-1": [] },
          subagentsByThreadId: {},
          activeThreadId: null,
          activeThreadActions: null,
          openThread: vi.fn(async () => {}),
          archiveThread: vi.fn(async () => {}),
          openProjectFolderLocation: vi.fn(async () => {}),
          openSettings: vi.fn(),
          sidebarCollapsed: false,
          toggleSidebar: vi.fn(),
        }),
      ),
    );

    expect(html).toContain('aria-label="Collapse all project threads"');
    expect(html).toContain('aria-label="Start new thread for self-hosted-llm"');
    expect(html).toContain('aria-label="Project actions"');
  });
});

describe("getProjectActionMenuItems", () => {
  it("restores the expected project menu labels for filesystem-backed projects", () => {
    expect(
      getProjectActionMenuItems({
        folderPath: "D:\\Projects\\self-hosted-llm",
      }).map((item) => item.label),
    ).toEqual([
      "Open in Explorer",
      "Rename project",
      "Archive chats",
      "Remove",
    ]);
  });

  it("keeps archive and remove actions available even when a folder path is missing", () => {
    expect(
      getProjectActionMenuItems({ folderPath: null }).map((item) => item.label),
    ).toEqual(["Rename project", "Archive chats", "Remove"]);
  });
});

describe("getCurrentThreadActionMenuItems", () => {
  it("keeps only the active thread management actions in the project menu", () => {
    expect(getCurrentThreadActionMenuItems().map((item) => item.label)).toEqual(
      ["Rename thread", "Archive thread", "Delete permanently"],
    );
  });
});
