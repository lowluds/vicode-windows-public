export const SIDEBAR_WIDTH_STORAGE_KEY = 'vicode.sidebar.width';
export const SIDEBAR_COLLAPSED_STORAGE_KEY = 'vicode.sidebar.collapsed';
export const SIDEBAR_DEFAULT_WIDTH = 296;
export const SIDEBAR_COLLAPSED_WIDTH = 56;
export const SIDEBAR_MIN_WIDTH = 280;
export const SIDEBAR_MAX_WIDTH = 420;
export const SIDEBAR_MIN_MAIN_CONTENT_WIDTH = 560;
export const TITLEBAR_COLLAPSED_LEADING_WIDTH = 108;

export function resolveStoredSidebarCollapsed(value: string | null) {
  return value === 'true';
}

export function resolveSidebarMaxWidth(viewportWidth?: number) {
  if (typeof viewportWidth !== 'number' || !Number.isFinite(viewportWidth)) {
    return SIDEBAR_MAX_WIDTH;
  }

  return Math.max(SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, Math.round(viewportWidth - SIDEBAR_MIN_MAIN_CONTENT_WIDTH)));
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

export function resolveTitlebarLeadingWidth(collapsed: boolean, sidebarWidth = SIDEBAR_DEFAULT_WIDTH) {
  if (collapsed) {
    return TITLEBAR_COLLAPSED_LEADING_WIDTH;
  }
  return clampSidebarWidth(sidebarWidth);
}
