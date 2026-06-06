import { describe, expect, it } from "vitest";
import {
  deriveCollectionThreadGroups,
  formatRelativeTime,
  getCurrentThreadActionMenuItems,
  getProjectActionMenuItems,
  isThreadProcessing,
  projectIdsMatch,
  projectCollectionEntryId,
  reorderProjectIds,
  sidebarProjectLabel,
  threadCollectionEntryId,
} from "./AppSidebar.model";

describe("AppSidebar model helpers", () => {
  it("derives compact project labels from Windows and POSIX folder paths", () => {
    expect(
      sidebarProjectLabel({
        name: "Fallback",
        folderPath: "D:\\Projects\\self-hosted-llm\\",
      }),
    ).toBe("self-hosted-llm");
    expect(
      sidebarProjectLabel({
        name: "Fallback",
        folderPath: "/home/kyle/vicode",
      }),
    ).toBe("vicode");
    expect(sidebarProjectLabel({ name: "Fallback", folderPath: null })).toBe(
      "Fallback",
    );
  });

  it("keeps sidebar action menu labels narrow and predictable", () => {
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
    expect(
      getProjectActionMenuItems({ folderPath: null }).map(
        (item) => item.label,
      ),
    ).toEqual(["Rename project", "Archive chats", "Remove"]);
    expect(getCurrentThreadActionMenuItems().map((item) => item.label)).toEqual(
      ["Rename thread", "Archive thread", "Delete permanently"],
    );
  });

  it("formats thread recency and status without renderer state", () => {
    const now = new Date("2026-05-23T12:00:00.000Z").getTime();

    expect(formatRelativeTime(null, now)).toBe("");
    expect(formatRelativeTime("2026-05-23T11:58:00.000Z", now)).toBe("2m");
    expect(formatRelativeTime("2026-05-23T09:00:00.000Z", now)).toBe("3h");
    expect(formatRelativeTime("2026-05-21T12:00:00.000Z", now)).toBe("2d");
    expect(isThreadProcessing("running")).toBe(true);
    expect(isThreadProcessing("completed")).toBe(false);
  });

  it("reorders dragged projects only when the target and placement are valid", () => {
    expect(reorderProjectIds(["a", "b", "c"], "a", "c", "after")).toEqual([
      "b",
      "c",
      "a",
    ]);
    expect(reorderProjectIds(["a", "b", "c"], "c", "a", "before")).toEqual([
      "c",
      "a",
      "b",
    ]);
    expect(reorderProjectIds(["a", "b", "c"], "a", "missing", "after")).toEqual(
      ["a", "b", "c"],
    );
    expect(projectIdsMatch(["a", "b"], ["a", "b"])).toBe(true);
    expect(projectIdsMatch(["a", "b"], ["b", "a"])).toBe(false);
  });

  it("pairs collection threads under favorited folder projects only", () => {
    const projects = [
      { id: "project-1", folderPath: "D:\\Projects\\vicode" },
      { id: "project-2", folderPath: "D:\\Projects\\tools" },
      { id: "chat-project", folderPath: null },
    ];
    const threads = [
      { id: "paired-thread", projectId: "project-1" },
      { id: "unpaired-thread", projectId: "project-2" },
      { id: "standalone-chat", projectId: "chat-project" },
    ];
    const assignedEntryIds = new Set([
      projectCollectionEntryId("project-1"),
      threadCollectionEntryId("paired-thread"),
      threadCollectionEntryId("unpaired-thread"),
      threadCollectionEntryId("standalone-chat"),
    ]);

    const groups = deriveCollectionThreadGroups(
      projects,
      threads,
      (entryId) => assignedEntryIds.has(entryId),
    );

    expect(groups.pairedThreadsByProjectId.get("project-1")).toEqual([
      { id: "paired-thread", projectId: "project-1" },
    ]);
    expect(groups.unpairedProjectThreads).toEqual([
      { id: "unpaired-thread", projectId: "project-2" },
    ]);
    expect(groups.chatThreads).toEqual([
      { id: "standalone-chat", projectId: "chat-project" },
    ]);
  });
});
