import type { ComponentProps } from 'react';
import { SkillsView } from '../components/SkillsView';

type SkillsRouteContainerProps = ComponentProps<typeof SkillsView>;

export function SkillsRouteContainer(props: SkillsRouteContainerProps) {
  return <SkillsView {...props} />;
}
