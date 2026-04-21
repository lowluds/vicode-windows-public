import { describe, expect, it, vi } from 'vitest';
import { applyAccentColor, applyResolvedAppearance, getSystemPrefersDark, resolveAccentColor, resolveAppearanceMode, subscribeToSystemAppearance } from './theme';

describe('theme utilities', () => {
  it('resolves appearance mode from explicit and system settings', () => {
    expect(resolveAppearanceMode('dark', false)).toBe('dark');
    expect(resolveAppearanceMode('light', true)).toBe('light');
    expect(resolveAppearanceMode('system', true)).toBe('dark');
    expect(resolveAppearanceMode('system', false)).toBe('light');
  });

  it('reads system appearance from matchMedia', () => {
    expect(
      getSystemPrefersDark({
        matchMedia: vi.fn(() => ({ matches: true } as MediaQueryList))
      })
    ).toBe(true);
  });

  it('applies document classes and metadata for the resolved appearance', () => {
    const classes = new Set<string>();
    const root = {
      classList: {
        toggle(name: string, enabled: boolean) {
          if (enabled) {
            classes.add(name);
            return true;
          }
          classes.delete(name);
          return false;
        },
        contains(name: string) {
          return classes.has(name);
        }
      },
      dataset: {} as DOMStringMap,
      style: {} as CSSStyleDeclaration
    } as unknown as HTMLElement;

    applyResolvedAppearance('dark', root);
    expect(root.classList.contains('dark')).toBe(true);
    expect(root.classList.contains('light')).toBe(false);
    expect(root.dataset.theme).toBe('dark');
    expect(root.style.colorScheme).toBe('dark');

    applyResolvedAppearance('light', root);
    expect(root.classList.contains('dark')).toBe(false);
    expect(root.classList.contains('light')).toBe(true);
    expect(root.dataset.theme).toBe('light');
    expect(root.style.colorScheme).toBe('light');
  });

  it('subscribes to system appearance changes', () => {
    const listeners = new Set<(event: MediaQueryListEvent) => void>();
    const mediaQuery = {
      matches: false,
      addEventListener: vi.fn((_event: string, listener: (event: MediaQueryListEvent) => void) => {
        listeners.add(listener);
      }),
      removeEventListener: vi.fn((_event: string, listener: (event: MediaQueryListEvent) => void) => {
        listeners.delete(listener);
      })
    } as unknown as MediaQueryList;

    const onChange = vi.fn();
    const cleanup = subscribeToSystemAppearance(onChange, {
      matchMedia: vi.fn(() => mediaQuery)
    });

    const listener = [...listeners][0];
    listener?.({ matches: true } as MediaQueryListEvent);
    expect(onChange).toHaveBeenCalledWith('dark');

    cleanup();
    expect(listeners.size).toBe(0);
  });

  it('resolves accent color from system and custom preferences', () => {
    expect(resolveAccentColor('system', null, '#1188cc')).toBe('#1188cc');
    expect(resolveAccentColor('custom', '#223344', '#1188cc')).toBe('#223344');
    expect(resolveAccentColor('custom', 'bad', null)).toBe('#0078d4');
  });

  it('applies accent tokens to the document root', () => {
    const styleEntries = new Map<string, string>();
    const root = {
      dataset: {} as DOMStringMap,
      style: {
        setProperty(name: string, value: string) {
          styleEntries.set(name, value);
        }
      } as unknown as CSSStyleDeclaration
    } as HTMLElement;

    applyAccentColor('#3a7bd5', root);

    expect(root.dataset.accent).toBe('#3a7bd5');
    expect(styleEntries.get('--primary')).toBe('#3a7bd5');
    expect(styleEntries.get('--sidebar-primary')).toBe('#3a7bd5');
    expect(styleEntries.get('--primary-foreground')).toBe('var(--ui-accent-foreground-light)');
  });
});
