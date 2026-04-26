import type { ComponentProps } from 'react';
import { SettingsView } from '../components/SettingsView';

type SettingsRouteContainerProps = ComponentProps<typeof SettingsView>;

export function SettingsRouteContainer(props: SettingsRouteContainerProps) {
  return <SettingsView {...props} />;
}
