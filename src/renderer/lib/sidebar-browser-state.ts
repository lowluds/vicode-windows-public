export type SidebarBrowserGroup = "projects" | "chats" | "skills" | "llm_wiki" | "tools";

export type SidebarBrowserCategory<CollectionId extends string = string> =
  | CollectionId
  | "all"
  | "projects"
  | "chats"
  | "skills"
  | "llm_wiki"
  | "tools"
  | "places";

export const sidebarBrowserGroups: Array<{ id: SidebarBrowserGroup; label: string }> = [
  { id: "projects", label: "Projects" },
  { id: "chats", label: "Chats" },
  { id: "skills", label: "Skills" },
  { id: "llm_wiki", label: "Knowledge" },
  { id: "tools", label: "Tools" },
];

export const workLibraryRailWidthStorageKey = "vicode.work-library.rail.width";
export const workLibraryRailCollapsedStorageKey = "vicode.work-library.rail.collapsed";
export const workLibraryRailMinWidth = 116;
export const workLibraryRailDefaultWidth = 152;
export const workLibraryRailMaxWidth = 260;
export const workLibraryRailCollapsedWidth = 34;
export const workLibraryRailCollapseDragThreshold = workLibraryRailCollapsedWidth + 18;

export function createDefaultVisibleSidebarBrowserGroups(): Record<SidebarBrowserGroup, boolean> {
  return {
    projects: true,
    chats: true,
    skills: true,
    llm_wiki: true,
    tools: true,
  };
}

export function normalizeSidebarBrowserQuery(query: string) {
  return query.trim().toLowerCase();
}

export function matchesSidebarBrowserQuery(
  query: string,
  ...values: Array<string | null | undefined>
) {
  const normalizedQuery = normalizeSidebarBrowserQuery(query);
  if (!normalizedQuery) {
    return true;
  }
  return values.some((value) => value?.toLowerCase().includes(normalizedQuery));
}

export function resolvePopulatedSidebarBrowserCollectionIds<CollectionId extends string>(
  assignments: Record<string, CollectionId>,
) {
  return new Set(Object.values(assignments));
}

export function resolveVisibleSidebarBrowserCollections<Collection extends { id: string }>(
  collections: readonly Collection[],
  assignments: Record<string, Collection["id"]>,
) {
  const populatedIds = resolvePopulatedSidebarBrowserCollectionIds(assignments);
  return collections.filter((collection) => populatedIds.has(collection.id));
}

export function shouldResetSidebarBrowserCollectionCategory<CollectionId extends string>(
  category: string,
  populatedCollectionIds: ReadonlySet<CollectionId>,
  isCollectionId: (value: unknown) => value is CollectionId,
) {
  return isCollectionId(category) && !populatedCollectionIds.has(category);
}

export function resolveWorkLibraryRailResizeStartWidth(input: {
  collapsed: boolean;
  width: number;
}) {
  return input.collapsed ? workLibraryRailMinWidth : input.width;
}

export function clampWorkLibraryRailWidth(width: number) {
  const parsedWidth = Number.isFinite(width) ? width : workLibraryRailDefaultWidth;
  const boundedWidth = Math.round(parsedWidth);
  return Math.min(workLibraryRailMaxWidth, Math.max(workLibraryRailMinWidth, boundedWidth));
}

export function resolveStoredWorkLibraryRailWidth(value: string | null) {
  const parsed = value === null ? Number.NaN : Number.parseInt(value, 10);
  return clampWorkLibraryRailWidth(parsed);
}

export function resolveStoredWorkLibraryRailCollapsed(value: string | null) {
  return value === "true";
}

export function resolveWorkLibraryRailResizeState(rawWidth: number) {
  if (rawWidth <= workLibraryRailCollapseDragThreshold) {
    return {
      collapsed: true,
      width: workLibraryRailMinWidth,
    };
  }

  return {
    collapsed: false,
    width: clampWorkLibraryRailWidth(rawWidth),
  };
}

export function resolveWorkLibraryRailDisplayWidth(input: {
  collapsed: boolean;
  sidebarIconOnly?: boolean;
  width: number;
}) {
  return input.collapsed || input.sidebarIconOnly ? workLibraryRailCollapsedWidth : input.width;
}
