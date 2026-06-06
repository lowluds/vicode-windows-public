import { describe, expect, it } from "vitest";
import {
  clampWorkLibraryRailWidth,
  createDefaultVisibleSidebarBrowserGroups,
  matchesSidebarBrowserQuery,
  resolvePopulatedSidebarBrowserCollectionIds,
  resolveStoredWorkLibraryRailCollapsed,
  resolveStoredWorkLibraryRailWidth,
  resolveVisibleSidebarBrowserCollections,
  resolveWorkLibraryRailDisplayWidth,
  resolveWorkLibraryRailResizeStartWidth,
  resolveWorkLibraryRailResizeState,
  shouldResetSidebarBrowserCollectionCategory,
  workLibraryRailCollapsedWidth,
  workLibraryRailDefaultWidth,
  workLibraryRailMaxWidth,
  workLibraryRailMinWidth,
} from "./sidebar-browser-state";

describe("sidebar browser state", () => {
  it("creates an enabled visibility map for each browser group", () => {
    expect(createDefaultVisibleSidebarBrowserGroups()).toEqual({
      projects: true,
      chats: true,
      skills: true,
      llm_wiki: true,
      tools: true,
    });
  });

  it("matches browser queries against visible labels and metadata", () => {
    expect(matchesSidebarBrowserQuery("", "Vicode")).toBe(true);
    expect(matchesSidebarBrowserQuery("  CODE  ", "Vicode")).toBe(true);
    expect(matchesSidebarBrowserQuery("llama", "Vicode", "Ollama runner")).toBe(true);
    expect(matchesSidebarBrowserQuery("missing", "Vicode", null)).toBe(false);
  });

  it("derives populated collections without showing empty collections", () => {
    const collections = [
      { id: "favorites", label: "Favorites" },
      { id: "blue", label: "Blue" },
      { id: "gray", label: "Gray" },
    ] as const;
    const assignments = {
      "project:one": "favorites",
      "thread:two": "blue",
    } as const;

    expect([...resolvePopulatedSidebarBrowserCollectionIds(assignments)]).toEqual([
      "favorites",
      "blue",
    ]);
    expect(resolveVisibleSidebarBrowserCollections(collections, assignments)).toEqual([
      { id: "favorites", label: "Favorites" },
      { id: "blue", label: "Blue" },
    ]);
  });

  it("resets only collection categories that no longer have entries", () => {
    const populatedIds = new Set(["favorites"]);
    const isCollectionId = (value: unknown): value is "favorites" | "blue" =>
      value === "favorites" || value === "blue";

    expect(
      shouldResetSidebarBrowserCollectionCategory("blue", populatedIds, isCollectionId),
    ).toBe(true);
    expect(
      shouldResetSidebarBrowserCollectionCategory("favorites", populatedIds, isCollectionId),
    ).toBe(false);
    expect(
      shouldResetSidebarBrowserCollectionCategory("projects", populatedIds, isCollectionId),
    ).toBe(false);
  });

  it("keeps rail resize state bounded and collapsible", () => {
    expect(
      resolveWorkLibraryRailResizeStartWidth({
        collapsed: true,
        width: workLibraryRailDefaultWidth,
      }),
    ).toBe(workLibraryRailMinWidth);
    expect(resolveWorkLibraryRailResizeState(workLibraryRailCollapsedWidth)).toEqual({
      collapsed: true,
      width: workLibraryRailMinWidth,
    });
    expect(resolveWorkLibraryRailResizeState(workLibraryRailMinWidth - 1)).toEqual({
      collapsed: false,
      width: workLibraryRailMinWidth,
    });
    expect(resolveWorkLibraryRailResizeState(workLibraryRailMaxWidth + 100)).toEqual({
      collapsed: false,
      width: workLibraryRailMaxWidth,
    });
  });

  it("restores persisted rail size while clamping stale cramped values", () => {
    expect(resolveStoredWorkLibraryRailWidth("188")).toBe(188);
    expect(resolveStoredWorkLibraryRailWidth("88")).toBe(workLibraryRailMinWidth);
    expect(resolveStoredWorkLibraryRailWidth(String(workLibraryRailMaxWidth + 32))).toBe(
      workLibraryRailMaxWidth,
    );
    expect(resolveStoredWorkLibraryRailWidth("not-a-number")).toBe(
      workLibraryRailDefaultWidth,
    );
    expect(resolveStoredWorkLibraryRailWidth(null)).toBe(workLibraryRailDefaultWidth);
    expect(clampWorkLibraryRailWidth(workLibraryRailMinWidth - 1)).toBe(
      workLibraryRailMinWidth,
    );
  });

  it("restores persisted rail collapsed state", () => {
    expect(resolveStoredWorkLibraryRailCollapsed("true")).toBe(true);
    expect(resolveStoredWorkLibraryRailCollapsed("false")).toBe(false);
    expect(resolveStoredWorkLibraryRailCollapsed(null)).toBe(false);
  });

  it("uses the compact rail width when collapsed or icon-only", () => {
    expect(
      resolveWorkLibraryRailDisplayWidth({
        collapsed: true,
        width: workLibraryRailDefaultWidth,
      }),
    ).toBe(workLibraryRailCollapsedWidth);
    expect(
      resolveWorkLibraryRailDisplayWidth({
        collapsed: false,
        sidebarIconOnly: true,
        width: workLibraryRailDefaultWidth,
      }),
    ).toBe(workLibraryRailCollapsedWidth);
    expect(
      resolveWorkLibraryRailDisplayWidth({
        collapsed: false,
        width: workLibraryRailDefaultWidth,
      }),
    ).toBe(workLibraryRailDefaultWidth);
  });
});
