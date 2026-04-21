import type { SkillDefinition } from '../../shared/domain';
import { getSkillCommandToken, getSkillProviderOrigin } from '../../shared/skills';
import {
  AutomationIcon,
  BookIcon,
  BrushIcon,
  CameraIcon,
  ClipboardIcon,
  CloudIcon,
  CodeIcon,
  CpuIcon,
  DocumentIcon,
  FigmaIcon,
  FolderIcon,
  GlobeIcon,
  ImageIcon,
  MagicPenIcon,
  MonitorIcon,
  NoteIcon,
  PlayIcon,
  ShieldIcon,
  SkillsIcon,
  TaskIcon
} from './icons';

export function resolveSkillIcon(skill: SkillDefinition) {
  const token = getSkillCommandToken(skill);
  const explicit = resolveSkillIconByToken(token);
  if (explicit) {
    return explicit;
  }

  const haystack = `${skill.name} ${skill.description}`.toLowerCase();
  if (haystack.includes('figma')) {
    return FigmaIcon;
  }
  if (haystack.includes('security')) {
    return ShieldIcon;
  }
  if (haystack.includes('browser') || haystack.includes('playwright') || haystack.includes('automation')) {
    return AutomationIcon;
  }
  if (haystack.includes('doc') || haystack.includes('reference')) {
    return BookIcon;
  }
  if (haystack.includes('deploy') || haystack.includes('cloud') || haystack.includes('ship')) {
    return GlobeIcon;
  }
  if (haystack.includes('frontend') || haystack.includes('design') || haystack.includes('polish')) {
    return BrushIcon;
  }
  if (skill.scope === 'project') {
    return FolderIcon;
  }
  if (skill.origin === 'provider_native') {
    return getSkillProviderOrigin(skill) === 'openai' ? CodeIcon : AutomationIcon;
  }
  return SkillsIcon;
}

export function resolveSkillIconByToken(token: string) {
  const explicitIcons: Record<string, typeof SkillsIcon> = {
    concise: NoteIcon,
    'doc-writer': DocumentIcon,
    'pdf-toolkit': DocumentIcon,
    reviewer: ClipboardIcon,
    planner: CpuIcon,
    'slide-writer': MonitorIcon,
    'spreadsheet-analyst': BookIcon,
    teacher: BookIcon,
    'cloudflare-deploy': CloudIcon,
    imagegen: ImageIcon,
    'openai-docs': DocumentIcon,
    playwright: CodeIcon,
    'playwright-interactive': MonitorIcon,
    'premium-frontend-build': BrushIcon,
    'premium-reference-frontend': FigmaIcon,
    'reference-to-system': SkillsIcon,
    screenshot: CameraIcon,
    'security-best-practices': ShieldIcon,
    sora: PlayIcon,
    'ui-polish-pass': MagicPenIcon,
    'vercel-deploy': GlobeIcon,
    'web-ship-review': TaskIcon
  };

  return explicitIcons[token.toLowerCase()] ?? null;
}
