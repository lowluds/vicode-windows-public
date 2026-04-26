import { useEffect, useState } from 'react';
import type { Preferences } from '../../shared/domain';
import type { NativeThemeSnapshot } from '../../shared/ipc';
import {
  applyAccentColor,
  applyResolvedAppearance,
  getSystemPrefersDark,
  resolveAccentColor,
  resolveAppearanceMode,
  subscribeToSystemAppearance
} from './theme';

export function useAppThemeSync(preferences: Preferences | null) {
  const [nativeTheme, setNativeTheme] = useState<NativeThemeSnapshot | null>(null);

  useEffect(() => {
    void window.vicode.app.getNativeTheme()
      .then((value) => {
        setNativeTheme(value);
      })
      .catch(() => {
        setNativeTheme({
          platform: 'win32',
          systemAccentColor: ''
        });
      });
  }, []);

  useEffect(() => {
    if (!preferences) {
      return;
    }

    applyResolvedAppearance(resolveAppearanceMode(preferences.appearanceMode, getSystemPrefersDark()));
    applyAccentColor(
      resolveAccentColor(preferences.accentMode, preferences.accentColor, nativeTheme?.systemAccentColor)
    );

    if (preferences.appearanceMode !== 'system') {
      return;
    }

    return subscribeToSystemAppearance((appearance) => applyResolvedAppearance(appearance));
  }, [nativeTheme?.systemAccentColor, preferences]);

  return nativeTheme;
}
