import type {
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
} from "react";
import { SidebarIcon } from "../icons";
import { InlineActionButton, Tooltip, TooltipContent, TooltipTrigger } from "../ui";
import { cx } from "../ui/utils";
import type { BrowserCollectionId } from "../AppSidebar.collections";
import {
  resolveWorkLibraryRailDisplayWidth,
  workLibraryRailCollapsedWidth,
  workLibraryRailMaxWidth,
} from "../../lib/sidebar-browser-state";

export interface SidebarRailEntry<CategoryId extends string> {
  id: CategoryId;
  label: string;
  icon: ReactNode;
  collectionId?: BrowserCollectionId;
  onClick?: () => void;
  active?: boolean;
}

export interface SidebarRailGroup<CategoryId extends string> {
  title: string;
  entries: Array<SidebarRailEntry<CategoryId>>;
}

interface SidebarRailControlsProps<CategoryId extends string> {
  categoryGroups: Array<SidebarRailGroup<CategoryId>>;
  activeCategory: CategoryId;
  sidebarCollapsed: boolean;
  sidebarIconOnly?: boolean;
  railCollapsed: boolean;
  railWidth: number;
  onSelectCategory: (categoryId: CategoryId) => void;
  onCollectionContextMenu: (
    collectionId: BrowserCollectionId,
    event: ReactMouseEvent<HTMLElement>,
  ) => void;
  onResizePointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onToggleRailCollapsed: () => void;
  footer: ReactNode;
  content: ReactNode;
}

export function SidebarRailControls<CategoryId extends string>({
  categoryGroups,
  activeCategory,
  sidebarCollapsed,
  sidebarIconOnly,
  railCollapsed,
  railWidth,
  onSelectCategory,
  onCollectionContextMenu,
  onResizePointerDown,
  onToggleRailCollapsed,
  footer,
  content,
}: SidebarRailControlsProps<CategoryId>) {
  return (
    <div className="work-library-body">
      <nav className="work-library-rail" aria-label="Work library">
        <div className="work-library-rail-scroll">
          {categoryGroups.map((group) => (
            <div key={group.title} className="work-library-rail-group">
              <div className="work-library-rail-heading">{group.title}</div>
              {group.entries.map((entry) => (
                <Tooltip key={`${group.title}:${entry.label}`}>
                  <TooltipTrigger asChild>
                    <InlineActionButton
                      data-collection-id={entry.collectionId}
                      className={cx(
                        "work-library-category",
                        (entry.active ?? activeCategory === entry.id) && "is-active",
                      )}
                      title={entry.label}
                      aria-label={entry.label}
                      onClick={() => {
                        onSelectCategory(entry.id);
                        entry.onClick?.();
                      }}
                      onContextMenu={
                        entry.collectionId
                          ? (event) =>
                              onCollectionContextMenu(
                                entry.collectionId!,
                                event,
                              )
                          : undefined
                      }
                    >
                      <SidebarIcon>{entry.icon}</SidebarIcon>
                      <span>{entry.label}</span>
                    </InlineActionButton>
                  </TooltipTrigger>
                  {sidebarCollapsed || sidebarIconOnly || railCollapsed ? (
                    <TooltipContent side="right">{entry.label}</TooltipContent>
                  ) : null}
                </Tooltip>
              ))}
            </div>
          ))}
        </div>
        {!sidebarCollapsed ? (
          <div className="work-library-rail-footer">{footer}</div>
        ) : null}
      </nav>
      {!sidebarCollapsed && !sidebarIconOnly ? (
        <>
          <div
            className="work-library-inner-resize"
            role="separator"
            aria-label="Resize library category rail"
            aria-orientation="vertical"
            aria-valuemin={workLibraryRailCollapsedWidth}
            aria-valuemax={workLibraryRailMaxWidth}
            aria-valuenow={railCollapsed ? workLibraryRailCollapsedWidth : railWidth}
            onPointerDown={onResizePointerDown}
            onDoubleClick={onToggleRailCollapsed}
          />
          <div className="workspace-sidebar-scroll thread-tree work-library-content">
            {content}
          </div>
        </>
      ) : null}
    </div>
  );
}
