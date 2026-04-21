import { describe, expect, it } from 'vitest';

import {
  clampSidebarWidth,
  SIDEBAR_DEFAULT_WIDTH,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_MAIN_CONTENT_WIDTH,
  SIDEBAR_MIN_WIDTH,
  TITLEBAR_COLLAPSED_LEADING_WIDTH,
  resolveSidebarMaxWidth,
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
  });

  it('clamps the sidebar width within the allowed range', () => {
    expect(clampSidebarWidth(SIDEBAR_MIN_WIDTH - 48)).toBe(SIDEBAR_MIN_WIDTH);
    expect(clampSidebarWidth(SIDEBAR_MAX_WIDTH + 64)).toBe(SIDEBAR_MAX_WIDTH);
  });

  it('uses the viewport to shrink the maximum sidebar width when space is tight', () => {
    const viewportWidth = SIDEBAR_MIN_MAIN_CONTENT_WIDTH + 300;
    expect(resolveSidebarMaxWidth(viewportWidth)).toBe(300);
    expect(clampSidebarWidth(SIDEBAR_MAX_WIDTH, viewportWidth)).toBe(300);
  });

  it('restores the stored sidebar width and falls back to default for invalid values', () => {
    expect(resolveStoredSidebarWidth('336')).toBe(336);
    expect(resolveStoredSidebarWidth('not-a-number')).toBe(SIDEBAR_DEFAULT_WIDTH);
    expect(resolveStoredSidebarWidth(null)).toBe(SIDEBAR_DEFAULT_WIDTH);
  });
});
