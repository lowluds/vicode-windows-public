import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type {
  CSSProperties,
  DragEvent,
  FormEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import type { ReactNode } from "react";
import {
  ActionButton,
  ConfirmDialog,
  IconButton,
  Menu,
  MenuCheckboxItem,
  MenuContent,
  MenuItem,
  MenuItemLabel,
  MenuLabel,
  MenuSeparator,
  MenuTrigger,
  ThreadTreeButton,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "./ui";
import type {
  LibrarySourcesSnapshot,
  Preferences,
  Project,
  SkillDefinition,
  SubagentSummary,
  ThreadSummary,
} from "../../shared/domain";
import { normalizeDisplayText } from "../../shared/display-text";
import { getSkillCommandToken } from "../../shared/skills";
import {
  formatContextTokenCount,
  formatContextUsagePercent,
  type ContextWindowEstimate,
} from "../lib/context-window";
import {
  createDefaultVisibleSidebarBrowserGroups,
  matchesSidebarBrowserQuery,
  resolvePopulatedSidebarBrowserCollectionIds,
  resolveVisibleSidebarBrowserCollections,
  resolveWorkLibraryRailDisplayWidth,
  resolveWorkLibraryRailResizeStartWidth,
  resolveWorkLibraryRailResizeState,
  resolveStoredWorkLibraryRailCollapsed,
  resolveStoredWorkLibraryRailWidth,
  shouldResetSidebarBrowserCollectionCategory,
  sidebarBrowserGroups,
  type SidebarBrowserCategory,
  type SidebarBrowserGroup,
  workLibraryRailCollapsedStorageKey,
  workLibraryRailDefaultWidth,
  workLibraryRailMinWidth,
  workLibraryRailWidthStorageKey,
} from "../lib/sidebar-browser-state";
import {
  ArchiveIcon,
  BookIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CheckIcon,
  EditIcon,
  FilterIcon,
  FolderIcon,
  FolderOpenIcon,
  GlobeIcon,
  LoadingIcon,
  MoreIcon,
  NewThreadIcon,
  PlusFolderIcon,
  PlusIcon,
  SidebarIcon,
  SkillsIcon,
  ThreadDotIcon,
  TrashIcon,
} from "./icons";
import type { AppRoute } from "../lib/app-route";
import { cx } from "./ui/utils";
import {
  browserCollectionDefaultLabel,
  browserCollectionDefinitions,
  type BrowserCollectionId,
  type BrowserCollectionState,
  isBrowserCollectionId,
  readStoredBrowserCollectionState,
  writeStoredBrowserCollectionState,
} from "./AppSidebar.collections";
import {
  createProjectDragImage,
  formatRelativeTime,
  deriveCollectionThreadGroups,
  isThreadProcessing,
  projectIdsMatch,
  projectCollectionEntryId,
  reorderProjectIds,
  resolveProjectDropPlacement,
  sidebarProjectLabel,
  threadCollectionEntryId,
  type ProjectDropPlacement,
} from "./AppSidebar.model";
import { createSidebarBrowserCollectionEntries } from "./sidebar/SidebarBrowserCollections";
import {
  SidebarRailControls,
  type SidebarRailGroup,
} from "./sidebar/SidebarRailControls";
import {
  CollapsibleProjectThreadRegion,
  SidebarProjectTree,
} from "./sidebar/SidebarProjectTree";

interface ProjectDragState {
  activeProjectId: string;
  originProjectIds: string[];
  previewProjectIds: string[];
}

type BrowserCollectionEntry =
  | { id: string; kind: "project"; label: string; projectId: string }
  | { id: string; kind: "thread"; label: string; threadId: string }
  | { id: string; kind: "skill"; label: string; skillId: string };

interface BrowserContextMenuState {
  entry: BrowserCollectionEntry;
  x: number;
  y: number;
}

interface BrowserCollectionContextMenuState {
  collectionId: BrowserCollectionId;
  x: number;
  y: number;
}

interface BrowserCollectionRenameState {
  collectionId: BrowserCollectionId;
  value: string;
  x: number;
  y: number;
}

interface AppSidebarProps {
  route: AppRoute;
  openProjectFromPicker: () => Promise<void>;
  activateChatsLibrary: () => Promise<void>;
  createChatThread: () => Promise<void>;
  createThreadForProject: (projectId: string) => Promise<void>;
  renameProject: (projectId: string) => Promise<void>;
  archiveProjectThreads: (projectId: string) => Promise<void>;
  removeProject: (projectId: string) => Promise<void>;
  setProjectTrust?: (projectId: string, trusted: boolean) => Promise<void>;
  removingProjectId: string | null;
  projects: Project[];
  preferences: Preferences | null;
  skills: SkillDefinition[];
  attachedSkillIds: string[];
  composerContextWindow: ContextWindowEstimate | null;
  librarySources: LibrarySourcesSnapshot | null;
  expandedProjectIds: string[];
  toggleProjectThreads: (projectId: string) => Promise<void>;
  collapseAllProjectThreads: () => void;
  reorderProjects: (projectIds: string[]) => void;
  threadsByProject: Record<string, ThreadSummary[]>;
  subagentsByThreadId: Record<string, SubagentSummary[]>;
  activeThreadId: string | null;
  activeThreadActions: {
    projectId: string;
    rename: () => Promise<void>;
    archive: () => Promise<void>;
    remove: () => void;
  } | null;
  openThread: (threadId: string) => Promise<void>;
  renameThread: (threadId: string) => Promise<void>;
  archiveThread: (threadId: string) => Promise<void>;
  deleteThread: (threadId: string) => void;
  toggleAttachedSkill: (skillId: string) => void;
  openSkillsRoute: () => void;
  openLibrarySettings: () => void;
  rescanSkillLibrary: () => Promise<void>;
  openProjectFolderLocation: (projectId: string) => Promise<void>;
  sidebarCollapsed: boolean;
  sidebarIconOnly?: boolean;
  toggleSidebar: () => void;
}

const visibleThreadBatchSize = 8;
const defaultKnowledgeEntryLimit = 20;

type BrowserCategory = SidebarBrowserCategory<BrowserCollectionId>;
type BrowserGroup = SidebarBrowserGroup;
type PlaceShortcut = "skills-folder" | "wiki-folder" | "current-project" | "add-folder";

const runtimeToolGroups = [
  {
    group: "Workspace",
    items: ["Read files", "Search text", "List directories", "Write files"],
  },
  {
    group: "Research",
    items: ["Web search", "Extract web page", "Map site", "Crawl site"],
  },
  {
    group: "Preview",
    items: ["Browser preview check"],
  },
  {
    group: "Runtime",
    items: ["Run command", "Spawn subagents"],
  },
];

export function AppSidebar(props: AppSidebarProps) {
  const [projectDrag, setProjectDrag] = useState<ProjectDragState | null>(null);
  const [projectActionMenuId, setProjectActionMenuId] = useState<string | null>(
    null,
  );
  const [pendingProjectDeleteId, setPendingProjectDeleteId] = useState<
    string | null
  >(null);
  const [projectDeleteId, setProjectDeleteId] = useState<string | null>(null);
  const [visibleThreadCount, setVisibleThreadCount] = useState(
    visibleThreadBatchSize,
  );
  const [browserCategory, setBrowserCategory] =
    useState<BrowserCategory>("all");
  const [browserQuery, setBrowserQuery] = useState("");
  const [activePlaceShortcut, setActivePlaceShortcut] =
    useState<PlaceShortcut>("skills-folder");
  const [visibleBrowserGroups, setVisibleBrowserGroups] = useState<
    Record<BrowserGroup, boolean>
  >(() => createDefaultVisibleSidebarBrowserGroups());
  const [projectsSectionExpanded, setProjectsSectionExpanded] = useState(true);
  const [chatsSectionExpanded, setChatsSectionExpanded] = useState(true);
  const [browserCollections, setBrowserCollections] =
    useState<BrowserCollectionState>(() => readStoredBrowserCollectionState());
  const [browserContextMenu, setBrowserContextMenu] =
    useState<BrowserContextMenuState | null>(null);
  const [browserCollectionContextMenu, setBrowserCollectionContextMenu] =
    useState<BrowserCollectionContextMenuState | null>(null);
  const [browserCollectionRename, setBrowserCollectionRename] =
    useState<BrowserCollectionRenameState | null>(null);
  const [workLibraryRailWidth, setWorkLibraryRailWidth] = useState(() => {
    if (typeof window === "undefined") {
      return workLibraryRailDefaultWidth;
    }
    return resolveStoredWorkLibraryRailWidth(
      window.localStorage.getItem(workLibraryRailWidthStorageKey),
    );
  });
  const [workLibraryRailCollapsed, setWorkLibraryRailCollapsed] =
    useState(() => {
      if (typeof window === "undefined") {
        return false;
      }
      return resolveStoredWorkLibraryRailCollapsed(
        window.localStorage.getItem(workLibraryRailCollapsedStorageKey),
      );
    });
  const [contextStatusCollapsed, setContextStatusCollapsed] = useState(false);
  const projectRowRefs = useRef(new Map<string, HTMLDivElement>());
  const previousProjectRowPositionsRef = useRef(new Map<string, number>());
  const dragImageRef = useRef<HTMLDivElement | null>(null);
  const projectDragRef = useRef<ProjectDragState | null>(null);
  const didDropProjectRef = useRef(false);
  const railResizeRef = useRef<{
    startX: number;
    startWidth: number;
  } | null>(null);

  const orderedProjects = useMemo(() => {
    if (!projectDrag) {
      return props.projects;
    }

    const projectLookup = new Map(
      props.projects.map((project) => [project.id, project]),
    );
    return projectDrag.previewProjectIds
      .map((projectId) => projectLookup.get(projectId) ?? null)
      .filter((project): project is Project => Boolean(project));
  }, [projectDrag, props.projects]);
  const projectSidebarProjects = useMemo(
    () => orderedProjects.filter((project) => project.folderPath),
    [orderedProjects],
  );
  const chatSidebarProjects = useMemo(
    () => orderedProjects.filter((project) => !project.folderPath),
    [orderedProjects],
  );
  const expandedProjectSet = useMemo(
    () => new Set(props.expandedProjectIds),
    [props.expandedProjectIds],
  );
  const projectDeleteTarget = useMemo(
    () =>
      projectDeleteId
        ? (props.projects.find((project) => project.id === projectDeleteId) ??
          null)
        : null,
    [projectDeleteId, props.projects],
  );
  const populatedBrowserCollectionIds = useMemo(
    () =>
      resolvePopulatedSidebarBrowserCollectionIds(
        browserCollections.assignments,
      ),
    [browserCollections.assignments],
  );
  const visibleBrowserCollections = useMemo(
    () =>
      resolveVisibleSidebarBrowserCollections(
        browserCollectionDefinitions,
        browserCollections.assignments,
      ),
    [browserCollections.assignments],
  );

  useEffect(
    () => () => {
      dragImageRef.current?.remove();
      dragImageRef.current = null;
    },
    [],
  );

  useEffect(() => {
    writeStoredBrowserCollectionState(browserCollections);
  }, [browserCollections]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(
      workLibraryRailWidthStorageKey,
      String(workLibraryRailWidth),
    );
  }, [workLibraryRailWidth]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(
      workLibraryRailCollapsedStorageKey,
      String(workLibraryRailCollapsed),
    );
  }, [workLibraryRailCollapsed]);

  useEffect(() => {
    if (
      shouldResetSidebarBrowserCollectionCategory(
        browserCategory,
        populatedBrowserCollectionIds,
        isBrowserCollectionId,
      )
    ) {
      setBrowserCategory("all");
    }
  }, [browserCategory, populatedBrowserCollectionIds]);

  useEffect(() => {
    if (!browserContextMenu && !browserCollectionContextMenu) {
      return undefined;
    }

    function dismissContextMenu() {
      setBrowserContextMenu(null);
      setBrowserCollectionContextMenu(null);
    }

    window.addEventListener("pointerdown", dismissContextMenu);
    window.addEventListener("keydown", dismissContextMenu);
    return () => {
      window.removeEventListener("pointerdown", dismissContextMenu);
      window.removeEventListener("keydown", dismissContextMenu);
    };
  }, [browserCollectionContextMenu, browserContextMenu]);

  useEffect(() => {
    if (!browserCollectionRename) {
      return undefined;
    }

    function dismissRename() {
      setBrowserCollectionRename(null);
    }

    window.addEventListener("pointerdown", dismissRename);
    return () => {
      window.removeEventListener("pointerdown", dismissRename);
    };
  }, [browserCollectionRename]);

  useEffect(() => {
    if (!projectActionMenuId && pendingProjectDeleteId) {
      setProjectDeleteId(pendingProjectDeleteId);
      setPendingProjectDeleteId(null);
    }
  }, [pendingProjectDeleteId, projectActionMenuId]);

  useEffect(() => {
    setVisibleThreadCount(visibleThreadBatchSize);
  }, [props.expandedProjectIds, props.threadsByProject]);

  useLayoutEffect(() => {
    const nextPositions = new Map<string, number>();

    for (const project of orderedProjects) {
      const node = projectRowRefs.current.get(project.id);
      if (!node) {
        continue;
      }

      nextPositions.set(project.id, node.getBoundingClientRect().top);
    }

    if (!projectDrag) {
      for (const project of orderedProjects) {
        const node = projectRowRefs.current.get(project.id);
        if (!node) {
          continue;
        }

        node.style.transition = "";
        node.style.transform = "";
      }

      previousProjectRowPositionsRef.current = nextPositions;
      return;
    }

    if (previousProjectRowPositionsRef.current.size > 0) {
      for (const project of orderedProjects) {
        if (projectDrag?.activeProjectId === project.id) {
          continue;
        }

        const node = projectRowRefs.current.get(project.id);
        const previousTop = previousProjectRowPositionsRef.current.get(
          project.id,
        );
        const nextTop = nextPositions.get(project.id);

        if (!node || previousTop === undefined || nextTop === undefined) {
          continue;
        }

        const deltaY = previousTop - nextTop;
        if (Math.abs(deltaY) < 1) {
          continue;
        }

        node.style.transition = "none";
        node.style.transform = `translateY(${deltaY}px)`;
        node.getBoundingClientRect();
        node.style.transition =
          "transform 180ms cubic-bezier(0.22, 1, 0.36, 1)";
        node.style.transform = "";
      }
    }

    previousProjectRowPositionsRef.current = nextPositions;
  }, [orderedProjects, projectDrag?.activeProjectId]);

  function updateProjectDrag(nextState: ProjectDragState | null) {
    projectDragRef.current = nextState;
    setProjectDrag(nextState);
  }

  function handleProjectDragStart(
    projectId: string,
    event: DragEvent<HTMLDivElement>,
  ) {
    const currentTarget = event.currentTarget;
    const originProjectIds = props.projects.map((project) => project.id);
    const { dragImage, offsetX, offsetY } =
      createProjectDragImage(currentTarget);

    dragImageRef.current = dragImage;
    didDropProjectRef.current = false;
    updateProjectDrag({
      activeProjectId: projectId,
      originProjectIds,
      previewProjectIds: originProjectIds,
    });

    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", projectId);
    event.dataTransfer.setDragImage(dragImage, offsetX, offsetY);
  }

  function handleProjectDragOver(
    projectId: string,
    event: DragEvent<HTMLDivElement>,
  ) {
    const currentDrag = projectDragRef.current;
    if (!currentDrag || currentDrag.activeProjectId === projectId) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = "move";

    const placement = resolveProjectDropPlacement(
      event.clientY,
      event.currentTarget.getBoundingClientRect(),
    );
    const nextPreviewProjectIds = reorderProjectIds(
      currentDrag.previewProjectIds,
      currentDrag.activeProjectId,
      projectId,
      placement,
    );

    if (projectIdsMatch(currentDrag.previewProjectIds, nextPreviewProjectIds)) {
      return;
    }

    updateProjectDrag({
      ...currentDrag,
      previewProjectIds: nextPreviewProjectIds,
    });
  }

  function handleProjectDrop(event: DragEvent<HTMLDivElement>) {
    if (!projectDragRef.current) {
      return;
    }

    event.preventDefault();
    didDropProjectRef.current = true;
  }

  function handleProjectDragEnd() {
    const currentDrag = projectDragRef.current;
    const didDropProject = didDropProjectRef.current;
    dragImageRef.current?.remove();
    dragImageRef.current = null;
    updateProjectDrag(null);
    didDropProjectRef.current = false;

    if (!currentDrag || !didDropProject) {
      return;
    }

    if (
      !projectIdsMatch(
        currentDrag.originProjectIds,
        currentDrag.previewProjectIds,
      )
    ) {
      props.reorderProjects(currentDrag.previewProjectIds);
    }
  }

  function setWorkLibraryRailCollapsedState(collapsed: boolean) {
    setWorkLibraryRailCollapsed(collapsed);
    if (!collapsed && workLibraryRailWidth < workLibraryRailMinWidth) {
      setWorkLibraryRailWidth(workLibraryRailDefaultWidth);
    }
  }

  function handleWorkLibraryRailResizePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (props.sidebarCollapsed) {
      return;
    }
    event.preventDefault();
    railResizeRef.current = {
      startX: event.clientX,
      startWidth: resolveWorkLibraryRailResizeStartWidth({
        collapsed: workLibraryRailCollapsed,
        width: workLibraryRailWidth,
      }),
    };
    document.body.classList.add("is-work-library-rail-resizing");

    function handlePointerMove(pointerEvent: PointerEvent) {
      const resizeState = railResizeRef.current;
      if (!resizeState) {
        return;
      }
      const nextWidth = resizeState.startWidth + pointerEvent.clientX - resizeState.startX;
      const nextRailState = resolveWorkLibraryRailResizeState(nextWidth);
      setWorkLibraryRailCollapsed(nextRailState.collapsed);
      setWorkLibraryRailWidth(nextRailState.width);
    }

    function handlePointerUp() {
      railResizeRef.current = null;
      document.body.classList.remove("is-work-library-rail-resizing");
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
  }

  function getTopLevelThreads(project: Project) {
    const projectThreads = props.threadsByProject[project.id] ?? [];
    const childThreadIds = new Set(
      projectThreads.flatMap((thread) =>
        (props.subagentsByThreadId[thread.id] ?? [])
          .map((subagent) => subagent.childThreadId)
          .filter((threadId): threadId is string => Boolean(threadId)),
      ),
    );

    return projectThreads.filter((thread) => !childThreadIds.has(thread.id));
  }

  function projectCollectionEntry(project: Project): BrowserCollectionEntry {
    return {
      id: projectCollectionEntryId(project.id),
      kind: "project",
      label: sidebarProjectLabel(project),
      projectId: project.id,
    };
  }

  function threadCollectionEntry(thread: ThreadSummary): BrowserCollectionEntry {
    return {
      id: threadCollectionEntryId(thread.id),
      kind: "thread",
      label: normalizeDisplayText(thread.title),
      threadId: thread.id,
    };
  }

  function skillCollectionEntry(skill: SkillDefinition): BrowserCollectionEntry {
    return {
      id: `skill:${skill.id}`,
      kind: "skill",
      label: skill.name,
      skillId: skill.id,
    };
  }

  function getBrowserEntryCollection(id: string) {
    return browserCollections.assignments[id] ?? null;
  }

  function isFavoriteBrowserEntry(id: string) {
    return Boolean(getBrowserEntryCollection(id));
  }

  function setBrowserEntryCollection(
    id: string,
    collectionId: BrowserCollectionId | null,
  ) {
    setBrowserCollections((current) => {
      const assignments = { ...current.assignments };
      if (collectionId) {
        assignments[id] = collectionId;
      } else {
        delete assignments[id];
      }
      return { ...current, assignments };
    });
  }

  function clearBrowserFavorites() {
    setBrowserCollections((current) => ({ ...current, assignments: {} }));
    setBrowserContextMenu(null);
    setBrowserCollectionContextMenu(null);
    setBrowserCollectionRename(null);
  }

  function openBrowserContextMenu(
    entry: BrowserCollectionEntry,
    event: ReactMouseEvent<HTMLElement>,
  ) {
    event.preventDefault();
    event.stopPropagation();
    setBrowserContextMenu({ entry, x: event.clientX, y: event.clientY });
  }

  function openBrowserCollectionContextMenu(
    collectionId: BrowserCollectionId,
    event: ReactMouseEvent<HTMLElement>,
  ) {
    event.preventDefault();
    event.stopPropagation();
    setBrowserCollectionContextMenu({
      collectionId,
      x: event.clientX,
      y: event.clientY,
    });
  }

  function getBrowserCollectionLabel(collectionId: BrowserCollectionId) {
    return (
      browserCollections.labels[collectionId] ??
      browserCollectionDefaultLabel(collectionId)
    );
  }

  function openBrowserCollectionRename(
    collectionId: BrowserCollectionId,
    x: number,
    y: number,
  ) {
    setBrowserCollectionRename({
      collectionId,
      x,
      y,
      value: getBrowserCollectionLabel(collectionId),
    });
  }

  function commitBrowserCollectionRename(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (!browserCollectionRename) {
      return;
    }
    const trimmedLabel = browserCollectionRename.value.trim().slice(0, 40);
    if (!trimmedLabel) {
      return;
    }
    const { collectionId } = browserCollectionRename;
    setBrowserCollections((current) => ({
      ...current,
      labels: {
        ...current.labels,
        [collectionId]: trimmedLabel,
      },
    }));
    setBrowserCollectionRename(null);
  }

  function renderFavoriteMarker(id: string, className?: string) {
    const collectionId = getBrowserEntryCollection(id);
    if (!collectionId) {
      return null;
    }
    const collection = browserCollectionDefinitions.find(
      (definition) => definition.id === collectionId,
    );
    if (!collection) {
      return null;
    }
    const collectionLabel = getBrowserCollectionLabel(collectionId);
    return (
      <span
        className={cx("work-library-favorite-marker", className)}
        data-collection-color={collectionId}
        aria-label={`${collectionLabel} collection`}
        style={
          {
            "--work-library-collection-color": collection.color,
          } as CSSProperties
        }
      />
    );
  }

  function renderSidebarThread(thread: ThreadSummary) {
    const isActiveThread = props.activeThreadId === thread.id;
    const favoriteEntry = threadCollectionEntry(thread);

    return (
      <div
        key={thread.id}
        className={cx(
          "sidebar-thread-shell",
          isActiveThread && "is-active-thread",
          isFavoriteBrowserEntry(favoriteEntry.id) && "is-favorite",
        )}
        onContextMenu={(event) => openBrowserContextMenu(favoriteEntry, event)}
      >
        <ThreadTreeButton
          data-testid={`thread-row-${thread.id}`}
          className={cx("sidebar-thread-row", isActiveThread && "is-active")}
          onClick={() => void props.openThread(thread.id)}
          title={normalizeDisplayText(thread.title)}
        >
          <span className="sidebar-thread-title">
            <SidebarIcon
              className={
                isThreadProcessing(thread.status)
                  ? "sidebar-thread-spinner"
                  : undefined
              }
            >
              {isThreadProcessing(thread.status) ? (
                <LoadingIcon />
              ) : (
                <ThreadDotIcon />
              )}
            </SidebarIcon>
            <span>{normalizeDisplayText(thread.title)}</span>
          </span>
        </ThreadTreeButton>
        {renderFavoriteMarker(favoriteEntry.id, "is-thread-favorite-marker")}
        <div className="sidebar-thread-trailing">
          <span className="sidebar-thread-time">
            {formatRelativeTime(thread.lastMessageAt)}
          </span>
          <Menu>
            <Tooltip>
              <TooltipTrigger asChild>
                <MenuTrigger asChild>
                  <IconButton
                    className="sidebar-thread-action-button"
                    label="Thread actions"
                    onPointerDown={(event) => {
                      event.stopPropagation();
                    }}
                    onClick={(event) => event.stopPropagation()}
                  >
                    <MoreIcon />
                  </IconButton>
                </MenuTrigger>
              </TooltipTrigger>
              <TooltipContent side="bottom" align="center">
                Thread actions
              </TooltipContent>
            </Tooltip>
            <MenuContent className="work-library-menu work-library-row-menu" align="end" sideOffset={8}>
              {renderThreadActionMenuItems(thread)}
            </MenuContent>
          </Menu>
        </div>
      </div>
    );
  }

  function renderThreadList(
    threads: ThreadSummary[],
    emptyLabel: string,
    options?: { flat?: boolean },
  ) {
    const visibleThreads = threads.slice(0, visibleThreadCount);
    const hasMoreThreads = visibleThreads.length < threads.length;

    return (
      <div
        className={cx(
          "project-thread-list",
          options?.flat && "is-flat-chat-list",
        )}
      >
        {threads.length === 0 ? (
          <div className="empty-inline nested-empty">{emptyLabel}</div>
        ) : (
          visibleThreads.map(renderSidebarThread)
        )}
        {hasMoreThreads ? (
          <ActionButton
            className="sidebar-thread-show-more"
            tone="quiet"
            size="compact"
            onClick={() =>
              setVisibleThreadCount(
                (current) => current + visibleThreadBatchSize,
              )
            }
          >
            Show more
          </ActionButton>
        ) : null}
      </div>
    );
  }

  const browserThreads = orderedProjects.flatMap(getTopLevelThreads);
  const chatThreads = chatSidebarProjects.flatMap(getTopLevelThreads);
  const wikiEntries = props.librarySources?.llmWiki.entries ?? [];
  const skillSourceEntries = props.librarySources?.skills.entries ?? [];
  const installedSkills = useMemo(
    () =>
      [...props.skills]
        .sort((left, right) =>
          left.name.localeCompare(right.name, undefined, { sensitivity: "base" }),
        ),
    [props.skills],
  );
  const enabledSkills = installedSkills.filter((skill) => skill.enabled);
  const disabledSkills = installedSkills.filter((skill) => !skill.enabled);

  function matchesSearch(...values: Array<string | null | undefined>) {
    return matchesSidebarBrowserQuery(browserQuery, ...values);
  }

  const filteredProjects = projectSidebarProjects.filter((project) =>
    matchesSearch(project.name, project.folderPath),
  );
  const filteredChatThreads = chatThreads.filter((thread) =>
    matchesSearch(thread.title, thread.lastPreview, thread.modelId),
  );
  const filteredBrowserThreads = browserThreads.filter((thread) =>
    matchesSearch(thread.title, thread.lastPreview, thread.modelId),
  );
  const filteredEnabledSkills = enabledSkills.filter((skill) =>
    matchesSearch(skill.name, skill.description, getSkillCommandToken(skill)),
  );
  const filteredDisabledSkills = disabledSkills.filter((skill) =>
    matchesSearch(skill.name, skill.description, getSkillCommandToken(skill)),
  );
  const filteredWikiEntries = wikiEntries.filter((entry) =>
    matchesSearch(entry.name, entry.path),
  );
  const filteredToolGroups = runtimeToolGroups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => matchesSearch(group.group, item)),
    }))
    .filter((group) => group.items.length > 0);
  const filteredSkills = [...filteredEnabledSkills, ...filteredDisabledSkills];
  const browserCollectionCount = Object.keys(browserCollections.assignments).length;

  function renderBrowserGroupHeader(label: string) {
    return (
      <div className="work-library-group-header">
        <span>{label}</span>
      </div>
    );
  }

  function renderBrowserColumnHeader(input: {
    label?: string;
    menuLabel: string;
    expanded?: boolean;
    onToggle?: () => void;
    children: ReactNode;
  }) {
    return (
      <div className="work-library-column-header">
        {input.onToggle ? (
          <button
            type="button"
            className="work-library-column-toggle"
            aria-expanded={input.expanded}
            onClick={input.onToggle}
          >
            {input.expanded ? <ChevronDownIcon /> : <ChevronRightIcon />}
            <span>{input.label ?? "Name"}</span>
          </button>
        ) : (
          <span className="work-library-column-title">{input.label ?? "Name"}</span>
        )}
        <Menu>
          <MenuTrigger asChild>
            <IconButton
              className="work-library-column-menu-button"
              label={input.menuLabel}
              size="compact"
            >
              <MoreIcon />
            </IconButton>
          </MenuTrigger>
          <MenuContent className="work-library-menu work-library-column-menu" align="end" sideOffset={5}>
            {input.children}
          </MenuContent>
        </Menu>
      </div>
    );
  }

  function renderSimpleEntry(input: {
    id: string;
    label: string;
    testId?: string;
    meta?: string | null;
    icon?: ReactNode;
    rawIcon?: boolean;
    marker?: ReactNode;
    active?: boolean;
    ariaExpanded?: boolean;
    expandable?: boolean;
    onClick?: () => void;
    onContextMenu?: (event: ReactMouseEvent<HTMLElement>) => void;
    action?: ReactNode;
    children?: ReactNode;
  }) {
    return (
      <div
        key={input.id}
        className={cx(
          "work-library-entry",
          input.active && "is-active",
          input.expandable && "is-expandable",
        )}
      >
        <button
          data-testid={input.testId}
          type="button"
          className="work-library-entry-button"
          onClick={input.onClick}
          onContextMenu={input.onContextMenu}
          title={input.meta ?? input.label}
          aria-expanded={input.ariaExpanded}
        >
          {input.icon
            ? input.rawIcon
              ? input.icon
              : <SidebarIcon>{input.icon}</SidebarIcon>
            : null}
          <span className="work-library-entry-title">
            <span className="work-library-entry-label">{input.label}</span>
          </span>
          {input.meta ? (
            <span className="work-library-entry-meta">{input.meta}</span>
          ) : null}
          {input.marker ? (
            <span className="work-library-entry-marker-slot">{input.marker}</span>
          ) : null}
        </button>
        {input.action ? (
          <div className="work-library-entry-actions">{input.action}</div>
        ) : null}
        {input.children}
      </div>
    );
  }

  function renderBrowserContextMenu() {
    if (!browserContextMenu) {
      return null;
    }

    const activeCollectionId = getBrowserEntryCollection(browserContextMenu.entry.id);
    const contextThread =
      browserContextMenu.entry.kind === "thread"
        ? Object.values(props.threadsByProject)
            .flat()
            .find((thread) => thread.id === browserContextMenu.entry.threadId) ?? null
        : null;
    return (
      <div
        className="work-library-context-menu"
        style={{ left: browserContextMenu.x, top: browserContextMenu.y }}
        role="menu"
        onPointerDown={(event) => event.stopPropagation()}
      >
        {contextThread ? (
          <>
            {renderThreadContextMenuItems(contextThread)}
            <div className="work-library-context-menu-separator" role="separator" />
          </>
        ) : null}
        {activeCollectionId ? (
          <button
            type="button"
            role="menuitem"
            className="work-library-context-menu-item"
            onClick={() => {
              setBrowserEntryCollection(browserContextMenu.entry.id, null);
              setBrowserContextMenu(null);
            }}
          >
            <span className="work-library-context-clear" aria-hidden="true" />
            <span>Clear Color</span>
            <span className="work-library-context-shortcut">0</span>
          </button>
        ) : null}
        {browserCollectionDefinitions.map((collection) => (
          <button
            key={collection.id}
            type="button"
            role="menuitem"
            className="work-library-context-menu-item"
            onClick={() => {
              setBrowserEntryCollection(browserContextMenu.entry.id, collection.id);
              setBrowserContextMenu(null);
            }}
          >
            <span
              className={cx(
                "work-library-context-color",
                activeCollectionId === collection.id && "is-active",
              )}
              style={
                {
                  "--work-library-collection-color": collection.color,
                } as CSSProperties
              }
              aria-hidden="true"
            />
            <span>{getBrowserCollectionLabel(collection.id)}</span>
            <span className="work-library-context-shortcut">
              {collection.shortcut}
            </span>
          </button>
        ))}
      </div>
    );
  }

  function renderBrowserCollectionContextMenu() {
    if (!browserCollectionContextMenu) {
      return null;
    }

    return (
      <div
        className="work-library-context-menu"
        style={{
          left: browserCollectionContextMenu.x,
          top: browserCollectionContextMenu.y,
        }}
        role="menu"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          role="menuitem"
          className="work-library-context-menu-item"
          onClick={() => {
            const { collectionId, x, y } = browserCollectionContextMenu;
            setBrowserCollectionContextMenu(null);
            openBrowserCollectionRename(collectionId, x, y);
          }}
        >
          <span className="work-library-context-clear" aria-hidden="true" />
          <span>Rename Collection</span>
          <span className="work-library-context-shortcut">Ctrl+R</span>
        </button>
      </div>
    );
  }

  function renderThreadActionMenuItems(thread: ThreadSummary) {
    return (
      <>
        <MenuItem onSelect={() => void props.renameThread(thread.id)}>
          <MenuItemLabel>Rename thread</MenuItemLabel>
          <EditIcon />
        </MenuItem>
        <MenuItem onSelect={() => void props.archiveThread(thread.id)}>
          <MenuItemLabel>Archive thread</MenuItemLabel>
          <ArchiveIcon />
        </MenuItem>
        <MenuItem
          className="ui-menu-item-danger"
          onSelect={() => props.deleteThread(thread.id)}
        >
          <MenuItemLabel>Delete permanently</MenuItemLabel>
          <TrashIcon />
        </MenuItem>
      </>
    );
  }

  function renderThreadContextMenuItems(thread: ThreadSummary) {
    return (
      <>
        <button
          type="button"
          role="menuitem"
          className="work-library-context-menu-item"
          onClick={() => {
            setBrowserContextMenu(null);
            void props.renameThread(thread.id);
          }}
        >
          <EditIcon className="work-library-context-action-icon" />
          <span>Rename thread</span>
          <span />
        </button>
        <button
          type="button"
          role="menuitem"
          className="work-library-context-menu-item"
          onClick={() => {
            setBrowserContextMenu(null);
            void props.archiveThread(thread.id);
          }}
        >
          <ArchiveIcon className="work-library-context-action-icon" />
          <span>Archive thread</span>
          <span />
        </button>
        <button
          type="button"
          role="menuitem"
          className="work-library-context-menu-item is-danger"
          onClick={() => {
            setBrowserContextMenu(null);
            props.deleteThread(thread.id);
          }}
        >
          <TrashIcon className="work-library-context-action-icon" />
          <span>Delete permanently</span>
          <span />
        </button>
      </>
    );
  }

  function renderBrowserCollectionRename() {
    if (!browserCollectionRename) {
      return null;
    }

    return (
      <form
        className="work-library-rename-popover"
        style={{
          left: browserCollectionRename.x,
          top: browserCollectionRename.y,
        }}
        role="dialog"
        aria-label="Rename collection"
        onSubmit={commitBrowserCollectionRename}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <input
          className="work-library-rename-input"
          aria-label="Collection name"
          autoFocus
          value={browserCollectionRename.value}
          onChange={(event) =>
            setBrowserCollectionRename((current) =>
              current ? { ...current, value: event.target.value } : current,
            )
          }
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              setBrowserCollectionRename(null);
            }
          }}
        />
        <button
          type="submit"
          className="work-library-rename-save"
        >
          Save
        </button>
      </form>
    );
  }

  function renderSkillsPanel(limit?: number) {
    const enabled = limit ? filteredEnabledSkills.slice(0, limit) : filteredEnabledSkills;
    const disabled = limit ? filteredDisabledSkills.slice(0, Math.max(0, limit - enabled.length)) : filteredDisabledSkills;

    return (
      <>
        {renderBrowserGroupHeader("Enabled")}
        <div className="work-library-entry-list">
          {enabled.length === 0 ? (
            <div className="empty-inline nested-empty">No enabled skills found.</div>
          ) : (
            enabled.map((skill) => {
              const entry = skillCollectionEntry(skill);
              return renderSimpleEntry({
                id: skill.id,
                label: skill.name,
                meta: skill.description,
                icon: <SkillsIcon />,
                marker: renderFavoriteMarker(entry.id),
                active: props.attachedSkillIds.includes(skill.id),
                onContextMenu: (event) => openBrowserContextMenu(entry, event),
                action: (
                  <IconButton
                    className="work-library-row-action"
                    label={props.attachedSkillIds.includes(skill.id) ? "Detach skill" : "Attach skill"}
                    size="compact"
                    onClick={() => props.toggleAttachedSkill(skill.id)}
                  >
                    {props.attachedSkillIds.includes(skill.id) ? <CheckIcon /> : <PlusIcon />}
                  </IconButton>
                ),
              });
            })
          )}
        </div>
        {disabled.length > 0 ? (
          <>
            {renderBrowserGroupHeader("Available")}
            <div className="work-library-entry-list">
              {disabled.map((skill) => {
                const entry = skillCollectionEntry(skill);
                return renderSimpleEntry({
                  id: skill.id,
                  label: skill.name,
                  meta: skill.description,
                  icon: <SkillsIcon />,
                  marker: renderFavoriteMarker(entry.id),
                  onClick: props.openSkillsRoute,
                  onContextMenu: (event) => openBrowserContextMenu(entry, event),
                });
              })}
            </div>
          </>
        ) : null}
      </>
    );
  }

  function renderToolsPanel() {
    return (
      <>
        {filteredToolGroups.length === 0 ? (
          <div className="empty-inline nested-empty">No tools match this search.</div>
        ) : (
          filteredToolGroups.map((group) => (
            <div key={group.group} className="work-library-tool-group">
              {renderBrowserGroupHeader(group.group)}
              <div className="work-library-entry-list">
                {group.items.map((item) =>
                  renderSimpleEntry({
                    id: `${group.group}:${item}`,
                    label: item,
                    meta: group.group,
                    icon: <ChevronRightIcon />,
                  }),
                )}
              </div>
            </div>
          ))
        )}
      </>
    );
  }

  function renderWikiPanel(limit?: number) {
    const hasQuery = browserQuery.trim().length > 0;
    const effectiveLimit = limit ?? (hasQuery ? undefined : defaultKnowledgeEntryLimit);
    const entries = effectiveLimit ? filteredWikiEntries.slice(0, effectiveLimit) : filteredWikiEntries;
    const hiddenCount = Math.max(0, filteredWikiEntries.length - entries.length);
    return (
      <>
        {renderBrowserGroupHeader("Knowledge")}
        <div className="work-library-source-summary">
          {props.librarySources?.llmWiki.message ?? "Project Knowledge folder is not configured."}
          {hiddenCount > 0 ? ` Showing ${entries.length} of ${filteredWikiEntries.length}.` : ""}
        </div>
        <div className="work-library-entry-list">
          {entries.length === 0 ? (
            <div className="empty-inline nested-empty">No knowledge entries found.</div>
          ) : (
            entries.map((entry) =>
              renderSimpleEntry({
                id: entry.id,
                label: entry.name,
                meta: entry.path,
                icon: <BookIcon />,
              }),
            )
          )}
        </div>
      </>
    );
  }

  function renderPlacesPanel() {
    const currentProject = props.projects.find((project) => project.folderPath) ?? null;
    return (
      <>
        {renderBrowserGroupHeader("Places")}
        <div className="work-library-entry-list">
          {renderSimpleEntry({
            id: "place:skills-folder",
            label: "Skills Folder",
            meta: props.preferences?.skillsLibraryPath ?? "Not configured",
            icon: <SkillsIcon />,
            onClick: props.openLibrarySettings,
          })}
          {renderSimpleEntry({
            id: "place:wiki-folder",
            label: "Project Knowledge Folder",
            meta: props.preferences?.llmWikiLibraryPath ?? "Not configured",
            icon: <FolderIcon />,
            onClick: props.openLibrarySettings,
          })}
          {renderSimpleEntry({
            id: "place:current-project",
            label: "Current Project",
            meta: currentProject?.folderPath ?? "No project folder",
            icon: <FolderOpenIcon />,
            onClick: currentProject
              ? () => void props.openProjectFolderLocation(currentProject.id)
              : undefined,
          })}
          {renderSimpleEntry({
            id: "place:add-folder",
            label: "Add Folder...",
            meta: "Open a workspace folder",
            icon: <PlusFolderIcon />,
            onClick: () => void props.openProjectFromPicker(),
          })}
        </div>
        {skillSourceEntries.length > 0 ? (
          <>
            {renderBrowserGroupHeader("Skill Sources")}
            <div className="work-library-entry-list">
              {skillSourceEntries.map((entry) =>
                renderSimpleEntry({
                  id: entry.id,
                  label: entry.name,
                  meta: entry.path,
                  icon: <SkillsIcon />,
                }),
              )}
            </div>
          </>
        ) : null}
      </>
    );
  }

  function renderCollectionPanel(collectionId: BrowserCollectionId) {
    const isEntryInCollection = (entryId: string) =>
      getBrowserEntryCollection(entryId) === collectionId;
    const collectionProjects = filteredProjects.filter(
      (project) => isEntryInCollection(projectCollectionEntry(project).id),
    );
    const collectionProjectIds = new Set(
      collectionProjects.map((project) => project.id),
    );
    const isVisibleEntryInCollection = (entryId: string) => {
      if (entryId.startsWith("project:")) {
        return collectionProjectIds.has(entryId.slice("project:".length));
      }
      return isEntryInCollection(entryId);
    };
    const {
      pairedThreadsByProjectId,
      unpairedProjectThreads,
      chatThreads: collectionChatThreads,
    } = deriveCollectionThreadGroups(
      orderedProjects,
      filteredBrowserThreads,
      isVisibleEntryInCollection,
    );
    const collectionSkills = filteredSkills.filter(
      (skill) => isEntryInCollection(skillCollectionEntry(skill).id),
    );

    if (
      collectionProjects.length === 0 &&
      unpairedProjectThreads.length === 0 &&
      collectionChatThreads.length === 0 &&
      collectionSkills.length === 0
    ) {
      return (
        <div className="empty-inline nested-empty">
          Right-click a project, chat, or skill to add it to this collection.
        </div>
      );
    }

    return (
      <div className="sidebar-section-block">
        {collectionProjects.length > 0 ? (
          <>
            {renderBrowserGroupHeader("Projects")}
            <div className="work-library-entry-list">
              {collectionProjects.map((project) => {
                const entry = projectCollectionEntry(project);
                const pairedThreads = pairedThreadsByProjectId.get(project.id) ?? [];
                const projectExpanded = expandedProjectSet.has(project.id);
                return renderSimpleEntry({
                  id: entry.id,
                  label: entry.label,
                  meta: project.folderPath,
                  icon:
                    pairedThreads.length > 0 ? (
                      <span className="project-row-icon-stack">
                        <SidebarIcon className="project-row-folder-icon">
                          {projectExpanded ? <FolderOpenIcon /> : <FolderIcon />}
                        </SidebarIcon>
                        <SidebarIcon className="project-row-arrow-icon">
                          {projectExpanded ? <ChevronDownIcon /> : <ChevronRightIcon />}
                        </SidebarIcon>
                      </span>
                    ) : (
                      <FolderIcon />
                    ),
                  rawIcon: pairedThreads.length > 0,
                  marker: renderFavoriteMarker(entry.id),
                  active: expandedProjectSet.has(project.id),
                  expandable: pairedThreads.length > 0,
                  ariaExpanded:
                    pairedThreads.length > 0 ? projectExpanded : undefined,
                  onClick: () => void props.toggleProjectThreads(project.id),
                  onContextMenu: (event) => openBrowserContextMenu(entry, event),
                  children: pairedThreads.length > 0 ? (
                    <CollapsibleProjectThreadRegion expanded={projectExpanded}>
                      {() => renderThreadList(pairedThreads, "No favorited threads yet.")}
                    </CollapsibleProjectThreadRegion>
                  ) : null,
                });
              })}
            </div>
          </>
        ) : null}
        {unpairedProjectThreads.length > 0 ? (
          <>
            {renderBrowserGroupHeader("Threads")}
            <div className="work-library-entry-list">
              {unpairedProjectThreads.map((thread) => {
                const entry = threadCollectionEntry(thread);
                return renderSimpleEntry({
                  id: entry.id,
                  testId: `thread-row-${thread.id}`,
                  label: entry.label,
                  meta: formatRelativeTime(thread.lastMessageAt),
                  icon: <ThreadDotIcon />,
                  marker: renderFavoriteMarker(entry.id),
                  active: props.activeThreadId === thread.id,
                  onClick: () => void props.openThread(thread.id),
                  onContextMenu: (event) => openBrowserContextMenu(entry, event),
                });
              })}
            </div>
          </>
        ) : null}
        {collectionChatThreads.length > 0 ? (
          <>
            {renderBrowserGroupHeader("Chats")}
            <div className="work-library-entry-list">
              {collectionChatThreads.map((thread) => {
                const entry = threadCollectionEntry(thread);
                return renderSimpleEntry({
                  id: entry.id,
                  testId: `thread-row-${thread.id}`,
                  label: entry.label,
                  meta: formatRelativeTime(thread.lastMessageAt),
                  icon: <ThreadDotIcon />,
                  marker: renderFavoriteMarker(entry.id),
                  active: props.activeThreadId === thread.id,
                  onClick: () => void props.openThread(thread.id),
                  onContextMenu: (event) => openBrowserContextMenu(entry, event),
                });
              })}
            </div>
          </>
        ) : null}
        {collectionSkills.length > 0 ? (
          <>
            {renderBrowserGroupHeader("Skills")}
            <div className="work-library-entry-list">
              {collectionSkills.map((skill) => {
                const entry = skillCollectionEntry(skill);
                return renderSimpleEntry({
                  id: entry.id,
                  label: entry.label,
                  meta: skill.description,
                  icon: <SkillsIcon />,
                  marker: renderFavoriteMarker(entry.id),
                  active: props.attachedSkillIds.includes(skill.id),
                  onClick: props.openSkillsRoute,
                  onContextMenu: (event) => openBrowserContextMenu(entry, event),
                });
              })}
            </div>
          </>
        ) : null}
      </div>
    );
  }

  function renderProjectsPanel(limit?: number) {
    const projectsToRender = limit ? filteredProjects.slice(0, limit) : filteredProjects;
    return (
      <SidebarProjectTree
        projects={projectsToRender}
        expanded={projectsSectionExpanded}
        browserCollectionCount={browserCollectionCount}
        route={props.route}
        activeThreadActions={props.activeThreadActions}
        removingProjectId={props.removingProjectId}
        projectActionMenuId={projectActionMenuId}
        projectDragActiveId={projectDrag?.activeProjectId ?? null}
        expandedProjectSet={expandedProjectSet}
        projectRowRefs={projectRowRefs}
        onToggleExpanded={() => setProjectsSectionExpanded((expanded) => !expanded)}
        onOpenProjectFromPicker={props.openProjectFromPicker}
        onClearBrowserCollections={clearBrowserFavorites}
        onToggleProjectThreads={props.toggleProjectThreads}
        onCreateThreadForProject={props.createThreadForProject}
        onOpenProjectFolderLocation={props.openProjectFolderLocation}
        onRenameProject={props.renameProject}
        onArchiveProjectThreads={props.archiveProjectThreads}
        onRequestRemoveProject={(projectId) => {
          setPendingProjectDeleteId(projectId);
          setProjectActionMenuId(null);
        }}
        onProjectActionMenuOpenChange={(projectId, open) =>
          setProjectActionMenuId((current) => {
            if (open) {
              return projectId;
            }
            return current === projectId ? null : current;
          })
        }
        getTopLevelThreads={getTopLevelThreads}
        getProjectCollectionEntry={projectCollectionEntry}
        getBrowserEntryCollection={getBrowserEntryCollection}
        setBrowserEntryCollection={setBrowserEntryCollection}
        isFavoriteBrowserEntry={isFavoriteBrowserEntry}
        renderFavoriteMarker={renderFavoriteMarker}
        renderThreadList={renderThreadList}
        renderBrowserGroupHeader={renderBrowserGroupHeader}
        renderBrowserColumnHeader={renderBrowserColumnHeader}
        openBrowserContextMenu={openBrowserContextMenu}
        onProjectDragStart={handleProjectDragStart}
        onProjectDragOver={handleProjectDragOver}
        onProjectDrop={handleProjectDrop}
        onProjectDragEnd={handleProjectDragEnd}
      />
    );
  }

  function renderChatsPanel(limit?: number) {
    const threads = limit ? filteredChatThreads.slice(0, limit) : filteredChatThreads;
    return (
      <div className="sidebar-section-block">
        {renderBrowserGroupHeader("Chats")}
        {renderBrowserColumnHeader({
          label: "Name",
          menuLabel: "Chat browser options",
          expanded: chatsSectionExpanded,
          onToggle: () => setChatsSectionExpanded((expanded) => !expanded),
          children: (
            <>
              <MenuItem onSelect={() => void props.createChatThread()}>
                <MenuItemLabel>New Chat</MenuItemLabel>
                <NewThreadIcon />
              </MenuItem>
              {browserCollectionCount > 0 ? (
                <>
                  <MenuSeparator />
                  <MenuItem onSelect={clearBrowserFavorites}>
                    <MenuItemLabel>Clear Collections</MenuItemLabel>
                    <ThreadDotIcon />
                  </MenuItem>
                </>
              ) : null}
            </>
          ),
        })}
        <CollapsibleProjectThreadRegion expanded={chatsSectionExpanded}>
          {() => renderThreadList(threads, "No chats found.", { flat: true })}
        </CollapsibleProjectThreadRegion>
      </div>
    );
  }

  function renderAllPanel() {
    return (
      <>
        {visibleBrowserGroups.projects ? renderProjectsPanel(4) : null}
        {visibleBrowserGroups.chats ? renderChatsPanel(5) : null}
        {visibleBrowserGroups.skills ? (
          <div className="sidebar-section-block">{renderSkillsPanel(6)}</div>
        ) : null}
        {visibleBrowserGroups.llm_wiki ? (
          <div className="sidebar-section-block">{renderWikiPanel(5)}</div>
        ) : null}
        {visibleBrowserGroups.tools ? (
          <div className="sidebar-section-block">{renderToolsPanel()}</div>
        ) : null}
      </>
    );
  }

  function renderBrowserContent() {
    if (isBrowserCollectionId(browserCategory)) {
      return renderCollectionPanel(browserCategory);
    }

    switch (browserCategory) {
      case "projects":
        return renderProjectsPanel();
      case "chats":
        return renderChatsPanel();
      case "skills":
        return (
          <div className="sidebar-section-block">
            {renderSkillsPanel()}
          </div>
        );
      case "llm_wiki":
        return <div className="sidebar-section-block">{renderWikiPanel()}</div>;
      case "tools":
        return <div className="sidebar-section-block">{renderToolsPanel()}</div>;
      case "places":
        return <div className="sidebar-section-block">{renderPlacesPanel()}</div>;
      case "all":
      default:
        return renderAllPanel();
    }
  }

  function renderContextStatusPanel() {
    const contextWindow = props.composerContextWindow;
    const usagePercent = contextWindow
      ? formatContextUsagePercent(contextWindow.usagePercent)
      : "0%";
    const tokenSummary = contextWindow
      ? `${formatContextTokenCount(contextWindow.usedTokens)} / ${formatContextTokenCount(contextWindow.maxTokens)}`
      : "No thread";
    const compactTitle = contextWindow
      ? `Context ${usagePercent} full, ${tokenSummary} tokens`
      : "Context ready";

    return (
      <section
        className={cx(
          "work-library-context-status",
          contextStatusCollapsed && "is-minimized",
          contextWindow && `is-${contextWindow.severity}`,
        )}
        aria-label="Current context window"
        title={compactTitle}
      >
        <button
          type="button"
          className="work-library-context-status-toggle"
          data-testid="sidebar-context-window-status"
          aria-expanded={!contextStatusCollapsed}
          aria-label={contextStatusCollapsed ? "Show context window status" : "Hide context window details"}
          onClick={() => setContextStatusCollapsed((collapsed) => !collapsed)}
        >
          <span>Ctx</span>
          <strong>{usagePercent}</strong>
          {!contextStatusCollapsed ? <em>{tokenSummary}</em> : null}
        </button>
      </section>
    );
  }

  const collectionCategoryEntries = createSidebarBrowserCollectionEntries(
    visibleBrowserCollections,
    getBrowserCollectionLabel,
  );

  const categoryGroups: Array<SidebarRailGroup<BrowserCategory>> = [
    ...(collectionCategoryEntries.length > 0
      ? [
          {
            title: "Collections",
            entries: collectionCategoryEntries,
          },
        ]
      : []),
    {
      title: "Library",
      entries: [
        { id: "all", label: "All", icon: <FolderIcon /> },
        { id: "projects", label: "Projects", icon: <FolderOpenIcon /> },
        {
          id: "chats",
          label: "Chats",
          icon: <ThreadDotIcon />,
          onClick: () => void props.activateChatsLibrary(),
        },
        { id: "skills", label: "Skills", icon: <SkillsIcon /> },
        { id: "llm_wiki", label: "Knowledge", icon: <BookIcon /> },
        { id: "tools", label: "Tools", icon: <GlobeIcon /> },
      ],
    },
    {
      title: "Places",
      entries: [
        {
          id: "places",
          label: "Skills Folder",
          icon: <SkillsIcon />,
          onClick: () => {
            setActivePlaceShortcut("skills-folder");
            props.openLibrarySettings();
          },
          active: browserCategory === "places" && activePlaceShortcut === "skills-folder",
        },
        {
          id: "places",
          label: "Project Knowledge Folder",
          icon: <BookIcon />,
          onClick: () => {
            setActivePlaceShortcut("wiki-folder");
            props.openLibrarySettings();
          },
          active: browserCategory === "places" && activePlaceShortcut === "wiki-folder",
        },
        {
          id: "places",
          label: "Current Project",
          icon: <FolderOpenIcon />,
          onClick: () => {
            const currentProject = props.projects.find((project) => project.folderPath);
            setActivePlaceShortcut("current-project");
            if (currentProject) {
              void props.openProjectFolderLocation(currentProject.id);
            }
          },
          active: browserCategory === "places" && activePlaceShortcut === "current-project",
        },
        {
          id: "places",
          label: "Add Folder...",
          icon: <PlusFolderIcon />,
          onClick: () => {
            setActivePlaceShortcut("add-folder");
            void props.openProjectFromPicker();
          },
          active: browserCategory === "places" && activePlaceShortcut === "add-folder",
        },
      ],
    },
  ];

  return (
    <>
      <aside
        className={cx(
          "workspace-sidebar",
          props.sidebarCollapsed && "is-collapsed",
          props.sidebarIconOnly && "is-icon-only",
        )}
      >
        <div
          className={cx(
            "work-library-browser",
            (workLibraryRailCollapsed || props.sidebarIconOnly) && "is-rail-collapsed",
          )}
          style={{
            ["--work-library-rail-width" as string]: `${resolveWorkLibraryRailDisplayWidth({
              collapsed: workLibraryRailCollapsed,
              sidebarIconOnly: props.sidebarIconOnly,
              width: workLibraryRailWidth,
            })}px`,
          }}
        >
          {!props.sidebarCollapsed && !props.sidebarIconOnly ? (
            <div className="work-library-searchbar">
                <input
                  className="work-library-search-input"
                  aria-label="Search library"
                  placeholder="Search (Ctrl + F)"
                  value={browserQuery}
                  onChange={(event) => setBrowserQuery(event.target.value)}
                />
                <Menu>
                  <MenuTrigger asChild>
                    <IconButton
                      className="work-library-filter-button"
                      label="Library filters"
                      size="compact"
                    >
                      <FilterIcon />
                    </IconButton>
                  </MenuTrigger>
                  <MenuContent className="work-library-menu work-library-filter-menu" align="end" sideOffset={6}>
                    <MenuLabel>Show groups</MenuLabel>
                    {sidebarBrowserGroups.map((group) => (
                      <MenuCheckboxItem
                        key={group.id}
                        checked={visibleBrowserGroups[group.id]}
                        onCheckedChange={(checked) =>
                          setVisibleBrowserGroups((current) => ({
                            ...current,
                            [group.id]: Boolean(checked),
                          }))
                        }
                      >
                        <MenuItemLabel>{group.label}</MenuItemLabel>
                      </MenuCheckboxItem>
                    ))}
                    <MenuSeparator />
                    <MenuItem onSelect={props.openLibrarySettings}>
                      <MenuItemLabel>Library settings</MenuItemLabel>
                      <FolderIcon />
                    </MenuItem>
                  </MenuContent>
                </Menu>
            </div>
          ) : null}
          <SidebarRailControls
            categoryGroups={categoryGroups}
            activeCategory={browserCategory}
            sidebarCollapsed={props.sidebarCollapsed}
            sidebarIconOnly={props.sidebarIconOnly}
            railCollapsed={workLibraryRailCollapsed}
            railWidth={workLibraryRailWidth}
            onSelectCategory={setBrowserCategory}
            onCollectionContextMenu={openBrowserCollectionContextMenu}
            onResizePointerDown={handleWorkLibraryRailResizePointerDown}
            onToggleRailCollapsed={() =>
              setWorkLibraryRailCollapsedState(!workLibraryRailCollapsed)
            }
            footer={renderContextStatusPanel()}
            content={renderBrowserContent()}
          />
        </div>
      </aside>

      {renderBrowserContextMenu()}
      {renderBrowserCollectionContextMenu()}
      {renderBrowserCollectionRename()}

      <ConfirmDialog
        open={Boolean(projectDeleteId)}
        onOpenChange={(open) => {
          if (!open) {
            setProjectDeleteId(null);
          }
        }}
        title="Remove project?"
        description={
          projectDeleteTarget
            ? `Remove "${projectDeleteTarget.name}" and its saved local threads from Vicode?`
            : "Remove this project and its saved local threads from Vicode?"
        }
        confirmLabel="Remove project"
        tone="danger"
        onConfirm={() => {
          if (!projectDeleteId) {
            return;
          }
          void props.removeProject(projectDeleteId);
          setProjectDeleteId(null);
        }}
      />
    </>
  );
}
