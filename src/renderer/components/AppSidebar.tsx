import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { DragEvent } from 'react';
import type { ReactNode } from 'react';
import { ActionButton, ConfirmDialog, IconButton, Menu, MenuContent, MenuItem, MenuItemLabel, MenuTrigger, ProjectTreeButton, ThreadTreeButton, Tooltip, TooltipContent, TooltipTrigger } from './ui';
import type { Project, SubagentSummary, ThreadSummary } from '../../shared/domain';
import { normalizeDisplayText } from '../../shared/display-text';
import { ArchiveIcon, ChevronDownIcon, ChevronRightIcon, FolderIcon, FolderOpenIcon, LoadingIcon, MoreIcon, NewThreadIcon, PanelLeftCloseIcon, PanelLeftOpenIcon, PlusFolderIcon, SettingsIcon, SidebarIcon, ThreadDotIcon } from './icons';
import { cx } from './ui/utils';

type Route = 'thread' | 'collab' | 'skills' | 'build-control' | 'automations' | 'settings' | 'ui-dev';
type ProjectDropPlacement = 'before' | 'after';

interface ProjectDragState {
  activeProjectId: string;
  originProjectIds: string[];
  previewProjectIds: string[];
}

interface AppSidebarProps {
  route: Route;
  openProjectFromPicker: () => Promise<void>;
  createThreadForProject: (projectId: string) => Promise<void>;
  renameProject: (projectId: string) => Promise<void>;
  removeProject: (projectId: string) => Promise<void>;
  removingProjectId: string | null;
  setProjectTrust: (projectId: string, trusted: boolean) => Promise<void>;
  projects: Project[];
  selectedProjectId: string | null;
  expandedProjectIds: string[];
  toggleProjectThreads: (projectId: string) => Promise<void>;
  reorderProjects: (projectIds: string[]) => void;
  threadsByProject: Record<string, ThreadSummary[]>;
  subagentsByThreadId: Record<string, SubagentSummary[]>;
  activeThreadId: string | null;
  openThread: (threadId: string) => Promise<void>;
  archiveThread: (threadId: string) => Promise<void>;
  openProjectFolderLocation: (projectId: string) => Promise<void>;
  openSettings: () => void;
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
}

const visibleThreadBatchSize = 8;

function formatRelativeTime(value: string | null) {
  if (!value) {
    return '';
  }
  const delta = Date.now() - new Date(value).getTime();
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

function sidebarProjectLabel(project: Project) {
  if (!project.folderPath) {
    return project.name;
  }

  const normalized = project.folderPath.replace(/[\\\/]+$/u, '');
  const segments = normalized.split(/[\\\/]/u).filter(Boolean);
  return segments.at(-1) ?? project.name;
}

function isThreadProcessing(status: ThreadSummary['status']) {
  return status === 'running';
}

function projectIdsMatch(left: string[], right: string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function reorderProjectIds(projectIds: string[], draggedProjectId: string, targetProjectId: string, placement: ProjectDropPlacement) {
  if (!draggedProjectId || !targetProjectId || draggedProjectId === targetProjectId) {
    return projectIds;
  }

  const nextOrder = projectIds.filter((projectId) => projectId !== draggedProjectId);
  const targetIndex = nextOrder.indexOf(targetProjectId);
  if (targetIndex < 0) {
    return projectIds;
  }

  nextOrder.splice(placement === 'after' ? targetIndex + 1 : targetIndex, 0, draggedProjectId);
  return nextOrder;
}

function resolveProjectDropPlacement(clientY: number, rect: DOMRect): ProjectDropPlacement {
  return clientY >= rect.top + rect.height / 2 ? 'after' : 'before';
}

function createProjectDragImage(source: HTMLDivElement) {
  const rect = source.getBoundingClientRect();
  const dragImage = source.cloneNode(true) as HTMLDivElement;
  dragImage.classList.add('project-row-drag-image');
  dragImage.style.width = `${rect.width}px`;
  dragImage.style.position = 'fixed';
  dragImage.style.top = '0';
  dragImage.style.left = '0';
  dragImage.style.pointerEvents = 'none';
  dragImage.style.transform = 'translate(-200vw, -200vh)';
  dragImage.style.zIndex = '9999';
  document.body.appendChild(dragImage);

  return {
    dragImage,
    offsetX: rect.width / 2,
    offsetY: rect.height / 2
  };
}

function CollapsibleProjectThreadRegion({
  expanded,
  children
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
      className={cx('project-thread-region', expanded && 'is-expanded')}
      aria-hidden={!expanded}
      onTransitionEnd={(event) => {
        if (event.target !== event.currentTarget || expanded) {
          return;
        }
        setShouldRender(false);
      }}
    >
      <div className="project-thread-region-inner">{shouldRender ? children() : null}</div>
    </div>
  );
}

export function AppSidebar(props: AppSidebarProps) {
  const [projectDrag, setProjectDrag] = useState<ProjectDragState | null>(null);
  const [projectActionMenuId, setProjectActionMenuId] = useState<string | null>(null);
  const [pendingProjectDeleteId, setPendingProjectDeleteId] = useState<string | null>(null);
  const [projectDeleteId, setProjectDeleteId] = useState<string | null>(null);
  const [sidebarFooterLocked, setSidebarFooterLocked] = useState(false);
  const [visibleThreadCount, setVisibleThreadCount] = useState(visibleThreadBatchSize);
  const projectRowRefs = useRef(new Map<string, HTMLDivElement>());
  const previousProjectRowPositionsRef = useRef(new Map<string, number>());
  const dragImageRef = useRef<HTMLDivElement | null>(null);
  const projectDragRef = useRef<ProjectDragState | null>(null);
  const didDropProjectRef = useRef(false);
  const sidebarFooterLockTimerRef = useRef<number | null>(null);

  const orderedProjects = useMemo(() => {
    if (!projectDrag) {
      return props.projects;
    }

    const projectLookup = new Map(props.projects.map((project) => [project.id, project]));
    return projectDrag.previewProjectIds
      .map((projectId) => projectLookup.get(projectId) ?? null)
      .filter((project): project is Project => Boolean(project));
  }, [projectDrag, props.projects]);

  const expandedProjectSet = useMemo(() => new Set(props.expandedProjectIds), [props.expandedProjectIds]);
  const projectDeleteTarget = useMemo(
    () => (projectDeleteId ? props.projects.find((project) => project.id === projectDeleteId) ?? null : null),
    [projectDeleteId, props.projects]
  );
  const targetProjectId = props.selectedProjectId ?? props.projects[0]?.id ?? null;

  useEffect(
    () => () => {
      dragImageRef.current?.remove();
      dragImageRef.current = null;
      if (sidebarFooterLockTimerRef.current !== null) {
        window.clearTimeout(sidebarFooterLockTimerRef.current);
      }
    },
    []
  );

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

        node.style.transition = '';
        node.style.transform = '';
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
        const previousTop = previousProjectRowPositionsRef.current.get(project.id);
        const nextTop = nextPositions.get(project.id);

        if (!node || previousTop === undefined || nextTop === undefined) {
          continue;
        }

        const deltaY = previousTop - nextTop;
        if (Math.abs(deltaY) < 1) {
          continue;
        }

        node.style.transition = 'none';
        node.style.transform = `translateY(${deltaY}px)`;
        node.getBoundingClientRect();
        node.style.transition = 'transform 180ms cubic-bezier(0.22, 1, 0.36, 1)';
        node.style.transform = '';
      }
    }

    previousProjectRowPositionsRef.current = nextPositions;
  }, [orderedProjects, projectDrag?.activeProjectId]);

  function lockSidebarFooterAfterExpand() {
    if (typeof window === 'undefined') {
      return;
    }
    if (sidebarFooterLockTimerRef.current !== null) {
      window.clearTimeout(sidebarFooterLockTimerRef.current);
    }
    setSidebarFooterLocked(true);
    sidebarFooterLockTimerRef.current = window.setTimeout(() => {
      sidebarFooterLockTimerRef.current = null;
      setSidebarFooterLocked(false);
    }, 240);
  }

  function reopenSidebarFromCollapsed() {
    lockSidebarFooterAfterExpand();
    props.toggleSidebar();
  }

  function updateProjectDrag(nextState: ProjectDragState | null) {
    projectDragRef.current = nextState;
    setProjectDrag(nextState);
  }

  function handleProjectDragStart(projectId: string, event: DragEvent<HTMLDivElement>) {
    const currentTarget = event.currentTarget;
    const originProjectIds = props.projects.map((project) => project.id);
    const { dragImage, offsetX, offsetY } = createProjectDragImage(currentTarget);

    dragImageRef.current = dragImage;
    didDropProjectRef.current = false;
    updateProjectDrag({
      activeProjectId: projectId,
      originProjectIds,
      previewProjectIds: originProjectIds
    });

    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', projectId);
    event.dataTransfer.setDragImage(dragImage, offsetX, offsetY);
  }

  function handleProjectDragOver(projectId: string, event: DragEvent<HTMLDivElement>) {
    const currentDrag = projectDragRef.current;
    if (!currentDrag || currentDrag.activeProjectId === projectId) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';

    const placement = resolveProjectDropPlacement(event.clientY, event.currentTarget.getBoundingClientRect());
    const nextPreviewProjectIds = reorderProjectIds(
      currentDrag.previewProjectIds,
      currentDrag.activeProjectId,
      projectId,
      placement
    );

    if (projectIdsMatch(currentDrag.previewProjectIds, nextPreviewProjectIds)) {
      return;
    }

    updateProjectDrag({
      ...currentDrag,
      previewProjectIds: nextPreviewProjectIds
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

    if (!projectIdsMatch(currentDrag.originProjectIds, currentDrag.previewProjectIds)) {
      props.reorderProjects(currentDrag.previewProjectIds);
    }
  }

  return (
    <>
      <aside className={cx('workspace-sidebar', props.sidebarCollapsed && 'is-collapsed')}>
        {props.sidebarCollapsed ? (
          <>
            <div className="workspace-sidebar-collapsed-tools">
              <Tooltip>
                <TooltipTrigger asChild>
                  <IconButton
                    className="workspace-sidebar-tool"
                    label="Open project"
                    onClick={() => {
                      void props.openProjectFromPicker();
                    }}
                  >
                    <PlusFolderIcon />
                  </IconButton>
                </TooltipTrigger>
                <TooltipContent side="right">Open project</TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <IconButton
                    className="workspace-sidebar-tool"
                    label="Start new thread"
                    disabled={props.projects.length === 0}
                    onClick={() => {
                      if (targetProjectId) {
                        void props.createThreadForProject(targetProjectId);
                      }
                    }}
                  >
                    <NewThreadIcon />
                  </IconButton>
                </TooltipTrigger>
                <TooltipContent side="right">Start new thread</TooltipContent>
              </Tooltip>
            </div>

            <div className="workspace-sidebar-footer is-collapsed">
              <IconButton
                data-testid="nav-sidebar-toggle"
                className="workspace-footer-icon"
                label="Show sidebar"
                onPointerDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  reopenSidebarFromCollapsed();
                }}
                onPointerUp={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                }}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  if (event.detail === 0) {
                    reopenSidebarFromCollapsed();
                  }
                }}
              >
                <PanelLeftOpenIcon />
              </IconButton>
            </div>
          </>
        ) : (
          <>
        <div className="workspace-sidebar-header">
          <div>
            <strong>Projects</strong>
          </div>
          <div className="workspace-sidebar-tools">
            <Tooltip>
              <TooltipTrigger asChild>
                <IconButton className="workspace-sidebar-tool" onClick={() => void props.openProjectFromPicker()} label="Open project">
                  <PlusFolderIcon />
                </IconButton>
              </TooltipTrigger>
              <TooltipContent>Open project</TooltipContent>
            </Tooltip>
            <Tooltip>
                <TooltipTrigger asChild>
                  <IconButton
                    className="workspace-sidebar-tool"
                    onClick={() => {
                      if (targetProjectId) {
                        void props.createThreadForProject(targetProjectId);
                      }
                  }}
                  label="Start new thread"
                  disabled={props.projects.length === 0}
                >
                  <NewThreadIcon />
                </IconButton>
              </TooltipTrigger>
              <TooltipContent>Start new thread</TooltipContent>
            </Tooltip>
          </div>
        </div>

        <div className="workspace-sidebar-scroll thread-tree">
          {props.projects.length === 0 ? (
            <div className="empty-inline">No projects yet.</div>
          ) : (
            orderedProjects.map((project) => {
              const projectLabel = sidebarProjectLabel(project);
              const projectIsRemoving = props.removingProjectId === project.id;
              const projectExpanded = expandedProjectSet.has(project.id);
              const projectThreads = props.threadsByProject[project.id] ?? [];
              const childThreadIds = new Set(
                projectThreads.flatMap((thread) =>
                  (props.subagentsByThreadId[thread.id] ?? [])
                    .map((subagent) => subagent.childThreadId)
                    .filter((threadId): threadId is string => Boolean(threadId))
                )
              );
              const topLevelThreads = projectThreads.filter((thread) => !childThreadIds.has(thread.id));
              const visibleThreads = topLevelThreads.slice(0, visibleThreadCount);
              const hasMoreThreads = visibleThreads.length < topLevelThreads.length;
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
                      'project-row-shell rounded-[12px] border border-transparent bg-transparent py-1 pr-1 pl-0 transition-colors',
                      projectExpanded && 'is-expanded',
                      projectActionMenuId === project.id && 'is-actions-open',
                      projectDrag?.activeProjectId === project.id && 'is-dragging',
                      projectIsRemoving && 'is-removing'
                    )}
                    draggable={!projectIsRemoving}
                    onDragStart={(event) => handleProjectDragStart(project.id, event)}
                    onDragOver={(event) => handleProjectDragOver(project.id, event)}
                    onDrop={handleProjectDrop}
                    onDragEnd={handleProjectDragEnd}
                  >
                    <ProjectTreeButton
                      data-testid={`project-row-${project.id}`}
                      className="project-row rounded-[10px] px-3"
                      onClick={() => {
                        if (projectIsRemoving) {
                          return;
                        }
                        void props.toggleProjectThreads(project.id);
                      }}
                      title={project.folderPath ?? project.name}
                      aria-label={project.folderPath ? `${projectLabel} ${project.folderPath}` : projectLabel}
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
                      <span className="project-name" title={project.folderPath ?? project.name}>
                        {projectLabel}
                      </span>
                    </ProjectTreeButton>

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
                          <Menu
                            open={projectActionMenuId === project.id}
                            onOpenChange={(open) =>
                              setProjectActionMenuId((current) => {
                                if (open) {
                                  return project.id;
                                }
                                return current === project.id ? null : current;
                              })
                            }
                          >
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <MenuTrigger asChild>
                                  <IconButton
                                    className="project-row-action-button"
                                    label="Project actions"
                                    draggable={false}
                                    onClick={(event) => event.stopPropagation()}
                                  >
                                    <MoreIcon />
                                  </IconButton>
                                </MenuTrigger>
                              </TooltipTrigger>
                              <TooltipContent>Project actions</TooltipContent>
                            </Tooltip>
                            <MenuContent align="end" sideOffset={8}>
                              {project.folderPath ? (
                                <MenuItem onSelect={() => void props.openProjectFolderLocation(project.id)}>
                                  <MenuItemLabel>Open folder location</MenuItemLabel>
                                  <FolderIcon />
                                </MenuItem>
                              ) : null}
                              <MenuItem onSelect={() => void props.renameProject(project.id)}>
                                <MenuItemLabel>Edit name</MenuItemLabel>
                              </MenuItem>
                              {project.folderPath ? (
                                <MenuItem onSelect={() => void props.setProjectTrust(project.id, !project.trusted)}>
                                  <MenuItemLabel>{project.trusted ? 'Mark as untrusted' : 'Trust workspace'}</MenuItemLabel>
                                </MenuItem>
                              ) : null}
                              <MenuItem
                                className="ui-menu-item-danger"
                                onSelect={(event) => {
                                  event.preventDefault();
                                  setPendingProjectDeleteId(project.id);
                                  setProjectActionMenuId(null);
                                }}
                              >
                                <MenuItemLabel>Remove</MenuItemLabel>
                              </MenuItem>
                            </MenuContent>
                          </Menu>
                        </>
                      )}
                    </div>
                  </div>

                  <CollapsibleProjectThreadRegion expanded={projectExpanded}>
                    {() => (
                      <div className="project-thread-list">
                      {projectThreads.length === 0 ? (
                        <div className="empty-inline nested-empty">No saved threads yet.</div>
                      ) : (
                        visibleThreads.map((thread) => {
                          const isActiveThread = props.activeThreadId === thread.id;

                          return (
                            <div
                              key={thread.id}
                              className={cx('sidebar-thread-shell', isActiveThread && 'is-active-thread')}
                            >
                              <ThreadTreeButton
                                data-testid={`thread-row-${thread.id}`}
                                className={cx(
                                  'sidebar-thread-row rounded-[10px] px-3 text-[12.5px]',
                                  isActiveThread && 'is-active'
                                )}
                                onClick={() => void props.openThread(thread.id)}
                                title={normalizeDisplayText(thread.title)}
                              >
                                <span className="sidebar-thread-title">
                                  <SidebarIcon className={isThreadProcessing(thread.status) ? 'sidebar-thread-spinner' : undefined}>
                                    {isThreadProcessing(thread.status) ? <LoadingIcon /> : <ThreadDotIcon />}
                                  </SidebarIcon>
                                  <span>{normalizeDisplayText(thread.title)}</span>
                                </span>
                                <span className="sidebar-thread-time">{formatRelativeTime(thread.lastMessageAt)}</span>
                              </ThreadTreeButton>
                              <div className="sidebar-thread-trailing">
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <IconButton
                                      className="sidebar-thread-archive-button size-7 rounded-lg border border-[color:var(--ui-border-soft)] bg-transparent text-[color:var(--ui-text-subtle)] shadow-none hover:bg-[color:var(--ui-alpha-06)] hover:text-[color:var(--ui-text-title)]"
                                      label="Archive thread"
                                      onPointerDown={(event) => {
                                        event.preventDefault();
                                        event.stopPropagation();
                                      }}
                                      onClick={(event) => {
                                        event.preventDefault();
                                        event.stopPropagation();
                                        void props.archiveThread(thread.id);
                                      }}
                                    >
                                      <ArchiveIcon />
                                    </IconButton>
                                  </TooltipTrigger>
                                  <TooltipContent side="bottom" align="center">
                                    Archive thread
                                  </TooltipContent>
                                </Tooltip>
                              </div>

                            </div>
                          );
                        })
                      )}
                      {hasMoreThreads ? (
                        <ActionButton
                          className="sidebar-thread-show-more mt-1 h-8 justify-center rounded-xl border border-[color:var(--ui-border-soft)] bg-transparent px-3 text-[12px] text-[color:var(--ui-text-muted)] shadow-none hover:bg-[color:var(--ui-alpha-05)] hover:text-[color:var(--ui-text-title)]"
                          tone="quiet"
                          size="compact"
                          onClick={() => setVisibleThreadCount((current) => current + visibleThreadBatchSize)}
                        >
                          Show more
                        </ActionButton>
                      ) : null}
                    </div>
                    )}
                  </CollapsibleProjectThreadRegion>
                </div>
              );
            })
          )}
        </div>

        <div className="workspace-sidebar-footer">
          <div className="workspace-sidebar-footer-action">
            <ActionButton
              data-testid="nav-sidebar-settings"
              className="workspace-footer-button"
              tone="quiet"
              leadingIcon={<SettingsIcon />}
              onClick={() => {
                if (sidebarFooterLocked) {
                  return;
                }
                props.openSettings();
              }}
            >
              Settings
            </ActionButton>
            <IconButton
              data-testid="nav-sidebar-toggle"
              className="workspace-footer-icon workspace-footer-toggle"
              label="Hide sidebar"
              onClick={() => {
                if (sidebarFooterLocked) {
                  return;
                }
                props.toggleSidebar();
              }}
            >
              <PanelLeftCloseIcon />
            </IconButton>
          </div>
        </div>
          </>
        )}
      </aside>

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
            : 'Remove this project and its saved local threads from Vicode?'
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
