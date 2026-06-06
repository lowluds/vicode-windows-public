import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import {
  clampSidebarWidth,
  SIDEBAR_COLLAPSED_STORAGE_KEY,
  SIDEBAR_COLLAPSED_WIDTH,
  SIDEBAR_DEFAULT_WIDTH,
  SIDEBAR_WIDTH_STORAGE_KEY,
  resolveStoredSidebarCollapsed,
  resolveStoredSidebarWidth,
  resolveSidebarResizePreviewWidth,
  resolveSidebarMaxWidth
} from './sidebar-layout';

type UseShellSidebarStateInput = {
  appShellRef: RefObject<HTMLDivElement | null>;
  sidebarShellRef: RefObject<HTMLDivElement | null>;
};

export function useShellSidebarState(input: UseShellSidebarStateInput) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    if (typeof window === 'undefined') {
      return false;
    }
    return resolveStoredSidebarCollapsed(window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY));
  });
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    if (typeof window === 'undefined') {
      return SIDEBAR_DEFAULT_WIDTH;
    }
    return resolveStoredSidebarWidth(window.localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY), window.innerWidth);
  });
  const [sidebarResizing, setSidebarResizing] = useState(false);
  const sidebarResizeStateRef = useRef<{ startX: number; startWidth: number; startedCollapsed: boolean } | null>(null);
  const liveSidebarWidthRef = useRef(SIDEBAR_DEFAULT_WIDTH);
  const liveSidebarCollapsedRef = useRef(sidebarCollapsed);
  const sidebarResizeFrameRef = useRef<number | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    window.localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, String(sidebarCollapsed));
  }, [sidebarCollapsed]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    window.localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(sidebarWidth));
  }, [sidebarWidth]);

  useEffect(() => {
    liveSidebarWidthRef.current = sidebarWidth;
  }, [sidebarWidth]);

  useEffect(() => {
    liveSidebarCollapsedRef.current = sidebarCollapsed;
  }, [sidebarCollapsed]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    return () => {
      if (sidebarResizeFrameRef.current !== null) {
        window.cancelAnimationFrame(sidebarResizeFrameRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    function syncSidebarWidthToViewport() {
      setSidebarWidth((current) => clampSidebarWidth(current, window.innerWidth));
    }

    window.addEventListener('resize', syncSidebarWidthToViewport);
    return () => window.removeEventListener('resize', syncSidebarWidthToViewport);
  }, []);

  function paintSidebarWidth(nextWidth: number) {
    liveSidebarWidthRef.current = nextWidth;
    if (typeof window === 'undefined') {
      return;
    }
    if (sidebarResizeFrameRef.current !== null) {
      return;
    }
    sidebarResizeFrameRef.current = window.requestAnimationFrame(() => {
      sidebarResizeFrameRef.current = null;
      const width = liveSidebarWidthRef.current;
      const appShell = input.appShellRef.current;
      if (appShell) {
        appShell.style.setProperty('--vicode-sidebar-width', `${width}px`);
        appShell.style.setProperty('--windows-titlebar-leading-width', `${width}px`);
      }
      const sidebarShell = input.sidebarShellRef.current;
      if (sidebarShell) {
        sidebarShell.style.width = `${width}px`;
        sidebarShell.style.minWidth = `${width}px`;
        sidebarShell.style.maxWidth = `${width}px`;
      }
    });
  }

  useEffect(() => {
    if (!sidebarResizing || typeof window === 'undefined') {
      return;
    }

    function finishSidebarResize() {
      const committedWidth = liveSidebarWidthRef.current;
      const currentResize = sidebarResizeStateRef.current;
      sidebarResizeStateRef.current = null;
      setSidebarResizing(false);
      if (committedWidth <= SIDEBAR_COLLAPSED_WIDTH) {
        setSidebarCollapsed(true);
        const restoredWidth = clampSidebarWidth(
          currentResize?.startWidth ?? sidebarWidth,
          window.innerWidth
        );
        liveSidebarWidthRef.current = restoredWidth;
        setSidebarWidth(restoredWidth);
        return;
      }
      setSidebarCollapsed(false);
      setSidebarWidth(clampSidebarWidth(committedWidth, window.innerWidth));
    }

    function handleSidebarResize(event: PointerEvent) {
      const currentResize = sidebarResizeStateRef.current;
      if (!currentResize) {
        return;
      }
      const nextWidth = currentResize.startWidth + (event.clientX - currentResize.startX);
      const liveWidth = resolveSidebarResizePreviewWidth(
        nextWidth,
        currentResize.startedCollapsed,
        window.innerWidth
      );
      const nextCollapsed = liveWidth <= SIDEBAR_COLLAPSED_WIDTH;
      if (nextCollapsed !== liveSidebarCollapsedRef.current) {
        liveSidebarCollapsedRef.current = nextCollapsed;
        setSidebarCollapsed(nextCollapsed);
      }
      if (!nextCollapsed) {
        setSidebarWidth((currentWidth) => (currentWidth === liveWidth ? currentWidth : liveWidth));
      }
      paintSidebarWidth(liveWidth);
    }

    document.body.classList.add('is-sidebar-resizing');
    window.addEventListener('pointermove', handleSidebarResize);
    window.addEventListener('pointerup', finishSidebarResize);
    window.addEventListener('blur', finishSidebarResize);

    return () => {
      document.body.classList.remove('is-sidebar-resizing');
      window.removeEventListener('pointermove', handleSidebarResize);
      window.removeEventListener('pointerup', finishSidebarResize);
      window.removeEventListener('blur', finishSidebarResize);
    };
  }, [sidebarResizing, input.appShellRef, input.sidebarShellRef]);

  function toggleSidebarCollapsed() {
    setSidebarCollapsed((current) => !current);
  }

  function startSidebarResize(event: ReactPointerEvent<HTMLDivElement>) {
    if (typeof window === 'undefined') {
      return;
    }
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const startWidth = sidebarCollapsed ? SIDEBAR_COLLAPSED_WIDTH : sidebarWidth;
    liveSidebarWidthRef.current = startWidth;
    sidebarResizeStateRef.current = {
      startX: event.clientX,
      startWidth,
      startedCollapsed: sidebarCollapsed
    };
    setSidebarResizing(true);
  }

  const sidebarResizeMaxWidth = useMemo(
    () => (typeof window === 'undefined' ? SIDEBAR_DEFAULT_WIDTH : resolveSidebarMaxWidth(window.innerWidth)),
    [sidebarWidth]
  );

  return {
    sidebarCollapsed,
    sidebarWidth,
    sidebarResizing,
    sidebarResizeMaxWidth,
    toggleSidebarCollapsed,
    startSidebarResize
  };
}
