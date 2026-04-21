import type { AccentMode, AppearanceMode } from '../../shared/domain';

export type ResolvedAppearance = 'dark' | 'light';

const SYSTEM_DARK_MEDIA = '(prefers-color-scheme: dark)';
const hardFallbackAccent = ['#', '0078', 'd4'].join('');

type MatchMediaCapable = {
  matchMedia(query: string): MediaQueryList;
};

function getWindowTarget() {
  return window as unknown as MatchMediaCapable;
}

function getRootTarget() {
  return document.documentElement;
}

function readThemeToken(name: string, root?: HTMLElement) {
  const resolvedRoot = root ?? (typeof document !== 'undefined' ? getRootTarget() : null);
  if (!resolvedRoot || typeof getComputedStyle !== 'function') {
    return '';
  }

  return getComputedStyle(resolvedRoot).getPropertyValue(name).trim();
}

export function resolveAppearanceMode(appearanceMode: AppearanceMode, systemPrefersDark: boolean): ResolvedAppearance {
  if (appearanceMode === 'dark') {
    return 'dark';
  }
  if (appearanceMode === 'light') {
    return 'light';
  }
  return systemPrefersDark ? 'dark' : 'light';
}

export function getSystemPrefersDark(target: MatchMediaCapable = getWindowTarget()) {
  return target.matchMedia(SYSTEM_DARK_MEDIA).matches;
}

export function applyResolvedAppearance(appearance: ResolvedAppearance, root: HTMLElement = getRootTarget()) {
  root.classList.toggle('dark', appearance === 'dark');
  root.classList.toggle('light', appearance === 'light');
  root.dataset.theme = appearance;
  root.style.colorScheme = appearance;
}

export function normalizeHexColor(value: string | null | undefined) {
  const trimmed = value?.trim() ?? '';
  return /^#[0-9a-fA-F]{6}$/u.test(trimmed) ? trimmed.toLowerCase() : null;
}

export function resolveAccentColor(accentMode: AccentMode, accentColor: string | null | undefined, systemAccentColor: string | null | undefined) {
  const fallbackAccent = readThemeToken('--ui-default-accent') || hardFallbackAccent;

  if (accentMode === 'custom') {
    return normalizeHexColor(accentColor) ?? fallbackAccent;
  }

  return normalizeHexColor(systemAccentColor) ?? fallbackAccent;
}

function hexChannelPairs(hexColor: string) {
  return [
    Number.parseInt(hexColor.slice(1, 3), 16),
    Number.parseInt(hexColor.slice(3, 5), 16),
    Number.parseInt(hexColor.slice(5, 7), 16)
  ] as const;
}

function relativeLuminance(hexColor: string) {
  const [red, green, blue] = hexChannelPairs(hexColor).map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  });

  return (0.2126 * red) + (0.7152 * green) + (0.0722 * blue);
}

export function resolveAccentForeground(hexColor: string) {
  return relativeLuminance(hexColor) > 0.4
    ? 'var(--ui-accent-foreground-dark)'
    : 'var(--ui-accent-foreground-light)';
}

export function applyAccentColor(accentColor: string, root: HTMLElement = getRootTarget()) {
  const fallbackAccent = readThemeToken('--ui-default-accent', root) || hardFallbackAccent;
  const normalized = normalizeHexColor(accentColor) ?? fallbackAccent;
  const foreground = resolveAccentForeground(normalized);

  root.dataset.accent = normalized;
  root.style.setProperty('--ui-theme-accent', normalized);
  root.style.setProperty('--primary', normalized);
  root.style.setProperty('--ring', normalized);
  root.style.setProperty('--sidebar-primary', normalized);
  root.style.setProperty('--primary-foreground', foreground);
  root.style.setProperty('--sidebar-primary-foreground', foreground);
  root.style.setProperty('--chart-1', normalized);
  root.style.setProperty('--chart-2', normalized);
}

export function initializeDocumentTheme() {
  applyResolvedAppearance(resolveAppearanceMode('system', getSystemPrefersDark()));
  applyAccentColor(readThemeToken('--ui-default-accent'));
}

export function subscribeToSystemAppearance(
  onChange: (appearance: ResolvedAppearance) => void,
  target: MatchMediaCapable = getWindowTarget()
) {
  const mediaQuery = target.matchMedia(SYSTEM_DARK_MEDIA);
  const listener = (event: MediaQueryListEvent) => {
    onChange(resolveAppearanceMode('system', event.matches));
  };

  if (typeof mediaQuery.addEventListener === 'function') {
    mediaQuery.addEventListener('change', listener);
    return () => mediaQuery.removeEventListener('change', listener);
  }

  mediaQuery.addListener(listener);
  return () => mediaQuery.removeListener(listener);
}
