import type { Project, ThreadSummary } from "../../shared/domain";

export type ProjectDropPlacement = "before" | "after";

export type ProjectActionMenuId =
  | "open_in_explorer"
  | "rename_project"
  | "archive_chats"
  | "remove_project";

export type CurrentThreadActionMenuId =
  | "rename_thread"
  | "archive_thread"
  | "remove_thread";

export function getProjectActionMenuItems(
  project: Pick<Project, "folderPath">,
): Array<{ id: ProjectActionMenuId; label: string }> {
  const items: Array<{ id: ProjectActionMenuId; label: string }> = [];
  if (project.folderPath) {
    items.push({ id: "open_in_explorer", label: "Open in Explorer" });
  }
  items.push(
    { id: "rename_project", label: "Rename project" },
    { id: "archive_chats", label: "Archive chats" },
    { id: "remove_project", label: "Remove" },
  );
  return items;
}

export function getCurrentThreadActionMenuItems(): Array<{
  id: CurrentThreadActionMenuId;
  label: string;
}> {
  return [
    { id: "rename_thread", label: "Rename thread" },
    { id: "archive_thread", label: "Archive thread" },
    { id: "remove_thread", label: "Delete permanently" },
  ];
}

export function formatRelativeTime(
  value: string | null,
  now = Date.now(),
) {
  if (!value) {
    return "";
  }
  const delta = now - new Date(value).getTime();
  const minutes = Math.max(1, Math.floor(delta / 60000));
  if (minutes < 60) {
    return `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h`;
  }
  return `${Math.floor(hours / 24)}d`;
}

export function sidebarProjectLabel(
  project: Pick<Project, "folderPath" | "name">,
) {
  if (!project.folderPath) {
    return project.name;
  }

  const normalized = project.folderPath.replace(/[\\\/]+$/u, "");
  const segments = normalized.split(/[\\\/]/u).filter(Boolean);
  return segments.at(-1) ?? project.name;
}

export function isThreadProcessing(status: ThreadSummary["status"]) {
  return status === "running";
}

export function projectCollectionEntryId(projectId: string) {
  return `project:${projectId}`;
}

export function threadCollectionEntryId(threadId: string) {
  return `thread:${threadId}`;
}

export function deriveCollectionThreadGroups<
  ProjectLike extends Pick<Project, "id" | "folderPath">,
  ThreadLike extends Pick<ThreadSummary, "id" | "projectId">,
>(
  projects: ProjectLike[],
  threads: ThreadLike[],
  isEntryInCollection: (entryId: string) => boolean,
) {
  const projectById = new Map(projects.map((project) => [project.id, project]));
  const collectionProjectIds = new Set(
    projects
      .filter(
        (project) =>
          project.folderPath &&
          isEntryInCollection(projectCollectionEntryId(project.id)),
      )
      .map((project) => project.id),
  );
  const pairedThreadsByProjectId = new Map<string, ThreadLike[]>();
  const unpairedProjectThreads: ThreadLike[] = [];
  const chatThreads: ThreadLike[] = [];

  for (const thread of threads) {
    if (!isEntryInCollection(threadCollectionEntryId(thread.id))) {
      continue;
    }

    const project = projectById.get(thread.projectId);
    if (!project?.folderPath) {
      chatThreads.push(thread);
      continue;
    }

    if (!collectionProjectIds.has(project.id)) {
      unpairedProjectThreads.push(thread);
      continue;
    }

    const projectThreads = pairedThreadsByProjectId.get(project.id) ?? [];
    projectThreads.push(thread);
    pairedThreadsByProjectId.set(project.id, projectThreads);
  }

  return {
    pairedThreadsByProjectId,
    unpairedProjectThreads,
    chatThreads,
  };
}

export function projectIdsMatch(left: string[], right: string[]) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

export function reorderProjectIds(
  projectIds: string[],
  draggedProjectId: string,
  targetProjectId: string,
  placement: ProjectDropPlacement,
) {
  if (
    !draggedProjectId ||
    !targetProjectId ||
    draggedProjectId === targetProjectId
  ) {
    return projectIds;
  }

  const nextOrder = projectIds.filter(
    (projectId) => projectId !== draggedProjectId,
  );
  const targetIndex = nextOrder.indexOf(targetProjectId);
  if (targetIndex < 0) {
    return projectIds;
  }

  nextOrder.splice(
    placement === "after" ? targetIndex + 1 : targetIndex,
    0,
    draggedProjectId,
  );
  return nextOrder;
}

export function resolveProjectDropPlacement(
  clientY: number,
  rect: Pick<DOMRect, "height" | "top">,
): ProjectDropPlacement {
  return clientY >= rect.top + rect.height / 2 ? "after" : "before";
}

export function createProjectDragImage(source: HTMLDivElement) {
  const rect = source.getBoundingClientRect();
  const dragImage = source.cloneNode(true) as HTMLDivElement;
  dragImage.classList.add("project-row-drag-image");
  dragImage.style.width = `${rect.width}px`;
  dragImage.style.position = "fixed";
  dragImage.style.top = "0";
  dragImage.style.left = "0";
  dragImage.style.pointerEvents = "none";
  dragImage.style.transform = "translate(-200vw, -200vh)";
  dragImage.style.zIndex = "9999";
  document.body.appendChild(dragImage);

  return {
    dragImage,
    offsetX: rect.width / 2,
    offsetY: rect.height / 2,
  };
}
