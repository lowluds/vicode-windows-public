import { describe, expect, it } from 'vitest';

import {
  clampSidebarWidth,
  SIDEBAR_COLLAPSED_WIDTH,
  SIDEBAR_DEFAULT_WIDTH,
  SIDEBAR_ICON_ONLY_WIDTH,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_CONTENT_REVEAL_WIDTH,
  SIDEBAR_MIN_MAIN_CONTENT_WIDTH,
  SIDEBAR_MIN_WIDTH,
  SIDEBAR_RESIZE_COLLAPSE_THRESHOLD,
  SIDEBAR_RESIZE_REOPEN_THRESHOLD,
  TITLEBAR_COLLAPSED_LEADING_WIDTH,
  resolveSidebarMaxWidth,
  resolveSidebarResizePreviewWidth,
  resolveStoredSidebarWidth,
  resolveTitlebarLeadingWidth
} from './sidebar-layout';

describe('sidebar-layout', () => {
  it('uses a stable titlebar leading width when the sidebar is visible', () => {
    expect(resolveTitlebarLeadingWidth(false)).toBe(SIDEBAR_DEFAULT_WIDTH);
  });

  it('uses the current sidebar width for the visible titlebar leading width', () => {
    expect(resolveTitlebarLeadingWidth(false, 340)).toBe(340);
  });

  it('uses the compact titlebar width when the sidebar is collapsed', () => {
    expect(resolveTitlebarLeadingWidth(true)).toBe(TITLEBAR_COLLAPSED_LEADING_WIDTH);
    expect(SIDEBAR_COLLAPSED_WIDTH).toBe(0);
    expect(resolveTitlebarLeadingWidth(true)).toBeGreaterThan(SIDEBAR_COLLAPSED_WIDTH);
  });

  it('clamps the sidebar width within the allowed range', () => {
    expect(clampSidebarWidth(SIDEBAR_MIN_WIDTH - 48)).toBe(SIDEBAR_MIN_WIDTH);
    expect(clampSidebarWidth(SIDEBAR_MAX_WIDTH + 64)).toBe(SIDEBAR_MAX_WIDTH);
  });

  it('uses the viewport to shrink the maximum sidebar width when space is tight', () => {
    const viewportWidth = SIDEBAR_MIN_MAIN_CONTENT_WIDTH + 400;
    expect(resolveSidebarMaxWidth(viewportWidth)).toBe(400);
    expect(clampSidebarWidth(SIDEBAR_MAX_WIDTH, viewportWidth)).toBe(400);
  });

  it('keeps a readable sidebar floor on very tight viewports', () => {
    const viewportWidth = SIDEBAR_MIN_MAIN_CONTENT_WIDTH + SIDEBAR_CONTENT_REVEAL_WIDTH - 40;
    expect(resolveSidebarMaxWidth(viewportWidth)).toBe(SIDEBAR_CONTENT_REVEAL_WIDTH);
    expect(clampSidebarWidth(SIDEBAR_ICON_ONLY_WIDTH, viewportWidth)).toBe(SIDEBAR_CONTENT_REVEAL_WIDTH);
  });

  it('restores the stored sidebar width and falls back to default for invalid values', () => {
    expect(resolveStoredSidebarWidth('336')).toBe(336);
    expect(resolveStoredSidebarWidth('280')).toBe(SIDEBAR_CONTENT_REVEAL_WIDTH);
    expect(resolveStoredSidebarWidth('not-a-number')).toBe(SIDEBAR_DEFAULT_WIDTH);
    expect(resolveStoredSidebarWidth(null)).toBe(SIDEBAR_DEFAULT_WIDTH);
  });

  it('snaps sidebar resize previews between hidden and the minimum usable width', () => {
    expect(resolveSidebarResizePreviewWidth(SIDEBAR_RESIZE_REOPEN_THRESHOLD, true)).toBe(SIDEBAR_COLLAPSED_WIDTH);
    expect(resolveSidebarResizePreviewWidth(SIDEBAR_RESIZE_REOPEN_THRESHOLD + 1, true)).toBe(SIDEBAR_ICON_ONLY_WIDTH);
    expect(resolveSidebarResizePreviewWidth(SIDEBAR_RESIZE_COLLAPSE_THRESHOLD, false)).toBe(SIDEBAR_COLLAPSED_WIDTH);
    expect(resolveSidebarResizePreviewWidth(SIDEBAR_RESIZE_COLLAPSE_THRESHOLD + 1, false)).toBe(SIDEBAR_ICON_ONLY_WIDTH);
    expect(resolveSidebarResizePreviewWidth(SIDEBAR_CONTENT_REVEAL_WIDTH, false)).toBe(SIDEBAR_CONTENT_REVEAL_WIDTH);
  });
});
