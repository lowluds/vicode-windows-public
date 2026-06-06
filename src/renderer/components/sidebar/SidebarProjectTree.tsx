import { useEffect, useState } from "react";
import type {
  DragEvent,
  MouseEvent as ReactMouseEvent,
  MutableRefObject,
  ReactNode,
} from "react";
import type { Project, ThreadSummary } from "../../../shared/domain";
import type { AppRoute } from "../../lib/app-route";
import {
  ArchiveIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  EditIcon,
  FolderIcon,
  FolderOpenIcon,
  MoreIcon,
  NewThreadIcon,
  PlusFolderIcon,
  SidebarIcon,
  ThreadDotIcon,
  TrashIcon,
} from "../icons";
import {
  IconButton,
  Menu,
  MenuContent,
  MenuItem,
  MenuItemLabel,
  MenuLabel,
  MenuSeparator,
  MenuTrigger,
  ProjectTreeButton,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../ui";
import { cx } from "../ui/utils";
import type { BrowserCollectionId } from "../AppSidebar.collections";
import {
  getCurrentThreadActionMenuItems,
  getProjectActionMenuItems,
  sidebarProjectLabel,
} from "../AppSidebar.model";

export type SidebarProjectCollectionEntry = {
  id: string;
  kind: "project";
  label: string;
  projectId: string;
};

interface SidebarProjectTreeProps {
  projects: Project[];
  expanded: boolean;
  browserCollectionCount: number;
  route: AppRoute;
  activeThreadActions: {
    projectId: string;
    rename: () => Promise<void>;
    archive: () => Promise<void>;
    remove: () => void;
  } | null;
  removingProjectId: string | null;
  projectActionMenuId: string | null;
  projectDragActiveId: string | null;
  expandedProjectSet: ReadonlySet<string>;
  projectRowRefs: MutableRefObject<Map<string, HTMLDivElement>>;
  onToggleExpanded: () => void;
  onOpenProjectFromPicker: () => Promise<void>;
  onClearBrowserCollections: () => void;
  onToggleProjectThreads: (projectId: string) => Promise<void>;
  onCreateThreadForProject: (projectId: string) => Promise<void>;
  onOpenProjectFolderLocation: (projectId: string) => Promise<void>;
  onRenameProject: (projectId: string) => Promise<void>;
  onArchiveProjectThreads: (projectId: string) => Promise<void>;
  onRequestRemoveProject: (projectId: string) => void;
  onProjectActionMenuOpenChange: (projectId: string, open: boolean) => void;
  getTopLevelThreads: (project: Project) => ThreadSummary[];
  getProjectCollectionEntry: (project: Project) => SidebarProjectCollectionEntry;
  getBrowserEntryCollection: (id: string) => BrowserCollectionId | null;
  setBrowserEntryCollection: (id: string, collectionId: BrowserCollectionId | null) => void;
  isFavoriteBrowserEntry: (id: string) => boolean;
  renderFavoriteMarker: (id: string, className?: string) => ReactNode;
  renderThreadList: (threads: ThreadSummary[], emptyLabel: string) => ReactNode;
  renderBrowserGroupHeader: (label: string) => ReactNode;
  renderBrowserColumnHeader: (input: {
    label?: string;
    menuLabel: string;
    expanded?: boolean;
    onToggle?: () => void;
    children: ReactNode;
  }) => ReactNode;
  openBrowserContextMenu: (
    entry: SidebarProjectCollectionEntry,
    event: ReactMouseEvent<HTMLElement>,
  ) => void;
  onProjectDragStart: (projectId: string, event: DragEvent<HTMLDivElement>) => void;
  onProjectDragOver: (projectId: string, event: DragEvent<HTMLDivElement>) => void;
  onProjectDrop: (event: DragEvent<HTMLDivElement>) => void;
  onProjectDragEnd: () => void;
}

export function CollapsibleProjectThreadRegion({
  expanded,
  children,
}: {
  expanded: boolean;
  children: () => ReactNode;
}) {
  const [shouldRender, setShouldRender] = useState(expanded);

  useEffect(() => {
    if (expanded) {
      setShouldRender(true);
    }
  }, [expanded]);

  return (
    <div
      className={cx("project-thread-region", expanded && "is-expanded")}
      aria-hidden={!expanded}
      onTransitionEnd={(event) => {
        if (event.target !== event.currentTarget || expanded) {
          return;
        }
        setShouldRender(false);
      }}
    >
      <div className="project-thread-region-inner">
        {shouldRender ? children() : null}
      </div>
    </div>
  );
}

export function SidebarProjectTree({
  projects,
  expanded,
  browserCollectionCount,
  route,
  activeThreadActions,
  removingProjectId,
  projectActionMenuId,
  projectDragActiveId,
  expandedProjectSet,
  projectRowRefs,
  onToggleExpanded,
  onOpenProjectFromPicker,
  onClearBrowserCollections,
  onToggleProjectThreads,
  onCreateThreadForProject,
  onOpenProjectFolderLocation,
  onRenameProject,
  onArchiveProjectThreads,
  onRequestRemoveProject,
  onProjectActionMenuOpenChange,
  getTopLevelThreads,
  getProjectCollectionEntry,
  getBrowserEntryCollection,
  setBrowserEntryCollection,
  isFavoriteBrowserEntry,
  renderFavoriteMarker,
  renderThreadList,
  renderBrowserGroupHeader,
  renderBrowserColumnHeader,
  openBrowserContextMenu,
  onProjectDragStart,
  onProjectDragOver,
  onProjectDrop,
  onProjectDragEnd,
}: SidebarProjectTreeProps) {
  return (
    <div className="sidebar-section-block">
      {renderBrowserGroupHeader("Projects")}
      {renderBrowserColumnHeader({
        label: "Name",
        menuLabel: "Project browser options",
        expanded,
        onToggle: onToggleExpanded,
        children: (
          <>
            <MenuItem onSelect={() => void onOpenProjectFromPicker()}>
              <MenuItemLabel>Open Folder...</MenuItemLabel>
              <PlusFolderIcon />
            </MenuItem>
            {browserCollectionCount > 0 ? (
              <>
                <MenuSeparator />
                <MenuItem onSelect={onClearBrowserCollections}>
                  <MenuItemLabel>Clear Collections</MenuItemLabel>
                  <ThreadDotIcon />
                </MenuItem>
              </>
            ) : null}
          </>
        ),
      })}
      <CollapsibleProjectThreadRegion expanded={expanded}>
        {() =>
          projects.length === 0 ? (
            <div className="empty-inline nested-empty">No projects found.</div>
          ) : (
            <>
              {projects.map((project) => {
                const projectLabel = sidebarProjectLabel(project);
                const favoriteEntry = getProjectCollectionEntry(project);
                const projectIsRemoving = removingProjectId === project.id;
                const projectExpanded = expandedProjectSet.has(project.id);
                const topLevelThreads = getTopLevelThreads(project);
                const showActiveThreadActions =
                  route === "thread" &&
                  activeThreadActions?.projectId === project.id;
                const projectActionLabel = showActiveThreadActions
                  ? "Project and thread actions"
                  : "Project actions";
                return (
                  <div key={project.id} className="thread-tree-group">
                    <div
                      ref={(node) => {
                        if (node) {
                          projectRowRefs.current.set(project.id, node);
                          return;
                        }
                        projectRowRefs.current.delete(project.id);
                      }}
                      className={cx(
                        "project-row-shell",
                        projectExpanded && "is-expanded",
                        projectActionMenuId === project.id && "is-actions-open",
                        projectDragActiveId === project.id && "is-dragging",
                        projectIsRemoving && "is-removing",
                        isFavoriteBrowserEntry(favoriteEntry.id) && "is-favorite",
                      )}
                      draggable={!projectIsRemoving}
                      onContextMenu={(event) =>
                        openBrowserContextMenu(favoriteEntry, event)
                      }
                      onDragStart={(event) => onProjectDragStart(project.id, event)}
                      onDragOver={(event) => onProjectDragOver(project.id, event)}
                      onDrop={onProjectDrop}
                      onDragEnd={onProjectDragEnd}
                    >
                      <ProjectTreeButton
                        data-testid={`project-row-${project.id}`}
                        className="project-row"
                        onClick={() => {
                          if (projectIsRemoving) {
                            return;
                          }
                          void onToggleProjectThreads(project.id);
                        }}
                        title={project.folderPath ?? project.name}
                        aria-label={
                          project.folderPath
                            ? `${projectLabel} ${project.folderPath}`
                            : projectLabel
                        }
                        aria-busy={projectIsRemoving}
                        aria-expanded={projectExpanded}
                        leadingIcon={
                          <span className="project-row-icon-stack">
                            <SidebarIcon className="project-row-folder-icon">
                              {projectExpanded ? <FolderOpenIcon /> : <FolderIcon />}
                            </SidebarIcon>
                            <SidebarIcon className="project-row-arrow-icon">
                              {projectExpanded ? <ChevronDownIcon /> : <ChevronRightIcon />}
                            </SidebarIcon>
                          </span>
                        }
                      >
                        <span
                          className="project-name-with-marker"
                          title={project.folderPath ?? project.name}
                        >
                          <span className="project-name">{projectLabel}</span>
                        </span>
                      </ProjectTreeButton>
                      {renderFavoriteMarker(
                        favoriteEntry.id,
                        "is-project-favorite-marker",
                      )}

                      <div className="project-row-actions">
                        {projectIsRemoving ? (
                          <div className="project-row-pending" aria-live="polite">
                            <span>Removing project</span>
                            <span className="project-row-pending-dots" aria-hidden="true">
                              <span>.</span>
                              <span>.</span>
                              <span>.</span>
                            </span>
                          </div>
                        ) : (
                          <>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <IconButton
                                  className="project-row-action-button"
                                  label={`Start new thread for ${projectLabel}`}
                                  draggable={false}
                                  onPointerDown={(event) => event.stopPropagation()}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    void onCreateThreadForProject(project.id);
                                  }}
                                >
                                  <NewThreadIcon />
                                </IconButton>
                              </TooltipTrigger>
                              <TooltipContent>Start new thread</TooltipContent>
                            </Tooltip>
                            <Menu
                              open={projectActionMenuId === project.id}
                              onOpenChange={(open) =>
                                onProjectActionMenuOpenChange(project.id, open)
                              }
                            >
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <MenuTrigger asChild>
                                    <IconButton
                                      className="project-row-action-button"
                                      label={projectActionLabel}
                                      draggable={false}
                                      onClick={(event) => event.stopPropagation()}
                                    >
                                      <MoreIcon />
                                    </IconButton>
                                  </MenuTrigger>
                                </TooltipTrigger>
                                <TooltipContent>{projectActionLabel}</TooltipContent>
                              </Tooltip>
                              <MenuContent className="work-library-menu work-library-row-menu" align="end" sideOffset={8}>
                                <MenuItem
                                  onSelect={() =>
                                    setBrowserEntryCollection(
                                      favoriteEntry.id,
                                      getBrowserEntryCollection(favoriteEntry.id)
                                        ? null
                                        : "favorites",
                                    )
                                  }
                                >
                                  <MenuItemLabel>
                                    {isFavoriteBrowserEntry(favoriteEntry.id)
                                      ? "Remove Favorite"
                                      : "Favorite"}
                                  </MenuItemLabel>
                                  <ThreadDotIcon />
                                </MenuItem>
                                <MenuSeparator />
                                {getProjectActionMenuItems(project).map((item) => {
                                  switch (item.id) {
                                    case "open_in_explorer":
                                      return (
                                        <MenuItem key={item.id} onSelect={() => void onOpenProjectFolderLocation(project.id)}>
                                          <MenuItemLabel>{item.label}</MenuItemLabel>
                                          <FolderIcon />
                                        </MenuItem>
                                      );
                                    case "rename_project":
                                      return (
                                        <MenuItem key={item.id} onSelect={() => void onRenameProject(project.id)}>
                                          <MenuItemLabel>{item.label}</MenuItemLabel>
                                          <EditIcon />
                                        </MenuItem>
                                      );
                                    case "archive_chats":
                                      return (
                                        <MenuItem key={item.id} onSelect={() => void onArchiveProjectThreads(project.id)}>
                                          <MenuItemLabel>{item.label}</MenuItemLabel>
                                          <ArchiveIcon />
                                        </MenuItem>
                                      );
                                    case "remove_project":
                                      return (
                                        <MenuItem
                                          key={item.id}
                                          className="ui-menu-item-danger"
                                          onSelect={(event) => {
                                            event.preventDefault();
                                            onRequestRemoveProject(project.id);
                                          }}
                                        >
                                          <MenuItemLabel>{item.label}</MenuItemLabel>
                                          <TrashIcon />
                                        </MenuItem>
                                      );
                                    default:
                                      return null;
                                  }
                                })}
                                {showActiveThreadActions ? (
                                  <>
                                    <MenuSeparator />
                                    <MenuLabel>Current thread</MenuLabel>
                                    {getCurrentThreadActionMenuItems().map((item) => {
                                      switch (item.id) {
                                        case "rename_thread":
                                          return (
                                            <MenuItem key={item.id} onSelect={() => void activeThreadActions?.rename()}>
                                              <MenuItemLabel>{item.label}</MenuItemLabel>
                                              <EditIcon />
                                            </MenuItem>
                                          );
                                        case "archive_thread":
                                          return (
                                            <MenuItem key={item.id} onSelect={() => void activeThreadActions?.archive()}>
                                              <MenuItemLabel>{item.label}</MenuItemLabel>
                                              <ArchiveIcon />
                                            </MenuItem>
                                          );
                                        case "remove_thread":
                                          return (
                                            <MenuItem
                                              key={item.id}
                                              className="ui-menu-item-danger"
                                              onSelect={() => activeThreadActions?.remove()}
                                            >
                                              <MenuItemLabel>{item.label}</MenuItemLabel>
                                              <TrashIcon />
                                            </MenuItem>
                                          );
                                        default:
                                          return null;
                                      }
                                    })}
                                  </>
                                ) : null}
                              </MenuContent>
                            </Menu>
                          </>
                        )}
                      </div>
                    </div>

                    <CollapsibleProjectThreadRegion expanded={projectExpanded}>
                      {() => renderThreadList(topLevelThreads, "No saved threads yet.")}
                    </CollapsibleProjectThreadRegion>
                  </div>
                );
              })}
            </>
          )
        }
      </CollapsibleProjectThreadRegion>
    </div>
  );
}
