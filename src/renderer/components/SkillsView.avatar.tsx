import type { SkillDefinition } from '../../shared/domain';
import { skillAvatarClass } from './SkillsView.activeSkills';
import { resolveSkillIcon } from './skillIcons';

export function SkillAvatar({ skill, size = 'default' }: { skill: SkillDefinition; size?: 'default' | 'large' }) {
  const Icon = resolveSkillIcon(skill);

  return (
    <span className={`${skillAvatarClass(skill)} ${size === 'large' ? 'is-large' : ''}`} aria-hidden="true">
      <Icon size={size === 'large' ? 24 : 20} />
    </span>
  );
}
