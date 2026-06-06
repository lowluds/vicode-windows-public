export const SIDEBAR_WIDTH_STORAGE_KEY = 'vicode.sidebar.width';
export const SIDEBAR_COLLAPSED_STORAGE_KEY = 'vicode.sidebar.collapsed';
export const SIDEBAR_DEFAULT_WIDTH = 420;
export const SIDEBAR_COLLAPSED_WIDTH = 0;
export const SIDEBAR_ICON_ONLY_WIDTH = 56;
export const SIDEBAR_CONTENT_REVEAL_WIDTH = 320;
export const SIDEBAR_MIN_WIDTH = SIDEBAR_CONTENT_REVEAL_WIDTH;
export const SIDEBAR_MAX_WIDTH = 560;
export const SIDEBAR_RESIZE_COLLAPSE_THRESHOLD = 18;
export const SIDEBAR_RESIZE_REOPEN_THRESHOLD = 18;
export const SIDEBAR_MIN_MAIN_CONTENT_WIDTH = 520;
export const TITLEBAR_COLLAPSED_LEADING_WIDTH = 56;

export function resolveStoredSidebarCollapsed(value: string | null) {
  return value === 'true';
}

export function resolveSidebarMaxWidth(viewportWidth?: number) {
  if (typeof viewportWidth !== 'number' || !Number.isFinite(viewportWidth)) {
    return SIDEBAR_MAX_WIDTH;
  }

  return Math.max(SIDEBAR_CONTENT_REVEAL_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, Math.round(viewportWidth - SIDEBAR_MIN_MAIN_CONTENT_WIDTH)));
}

export function clampSidebarWidth(width: number, viewportWidth?: number) {
  const parsedWidth = Number.isFinite(width) ? width : SIDEBAR_DEFAULT_WIDTH;
  const boundedWidth = Math.round(parsedWidth);
  return Math.min(resolveSidebarMaxWidth(viewportWidth), Math.max(SIDEBAR_MIN_WIDTH, boundedWidth));
}

export function resolveStoredSidebarWidth(value: string | null, viewportWidth?: number) {
  const parsed = value === null ? Number.NaN : Number.parseInt(value, 10);
  return clampSidebarWidth(parsed, viewportWidth);
}

export function resolveSidebarResizePreviewWidth(
  rawWidth: number,
  startedCollapsed: boolean,
  viewportWidth?: number
) {
  if (startedCollapsed && rawWidth <= SIDEBAR_RESIZE_REOPEN_THRESHOLD) {
    return SIDEBAR_COLLAPSED_WIDTH;
  }

  if (rawWidth <= SIDEBAR_RESIZE_COLLAPSE_THRESHOLD) {
    return SIDEBAR_COLLAPSED_WIDTH;
  }

  if (rawWidth < SIDEBAR_CONTENT_REVEAL_WIDTH) {
    return SIDEBAR_ICON_ONLY_WIDTH;
  }

  return clampSidebarWidth(rawWidth, viewportWidth);
}

export function resolveTitlebarLeadingWidth(collapsed: boolean, sidebarWidth = SIDEBAR_DEFAULT_WIDTH) {
  if (collapsed) {
    return TITLEBAR_COLLAPSED_LEADING_WIDTH;
  }
  return clampSidebarWidth(sidebarWidth);
}
