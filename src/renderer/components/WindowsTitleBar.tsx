import type { ReactNode } from 'react';
import { ActionButton, IconButton, Menu, MenuContent, MenuItem, MenuItemLabel, MenuLabel, MenuSeparator, MenuTrigger, Tooltip, TooltipContent, TooltipTrigger } from './ui';
import type { AppUpdateState, CollabBootstrap, SettingsSection } from '../../shared/domain';
import { normalizeDisplayText } from '../../shared/display-text';
import { AccountIcon, AutomationIcon, SettingsIcon, SkillsIcon } from './icons';
import { TitleBarUpdateAction } from './TitleBarUpdateAction';
import { cx } from './ui/utils';
import appIcon from '../assets/app-icon.png';
import wolfRun from '../assets/wolf-run.svg';

type Route = 'thread' | 'collab' | 'skills' | 'build-control' | 'automations' | 'settings' | 'ui-dev';

interface WindowsTitleBarProps {
  route: Route;
  selectedProjectName: string | null;
  activeThreadTitle: string | null;
  workspaceAction: {
    label: string;
    tooltip: string;
    icon: ReactNode;
    onClick: () => void;
    testId?: string;
    tone: 'default' | 'warning';
  } | null;
  isAgentWorking: boolean;
  collaboration: CollabBootstrap;
  appUpdateState: AppUpdateState | null;
  openSettings: (section?: SettingsSection) => void;
  openAutomations: () => void;
  openSkills: () => void;
  pressUpdateAction: () => void;
}

function buildInitials(value: string) {
  const parts = value.trim().split(/\s+/u).filter(Boolean);
  if (parts.length === 0) {
    return 'V';
  }
  if (parts.length === 1) {
    return parts[0]!.slice(0, 1).toUpperCase();
  }
  return `${parts[0]!.slice(0, 1)}${parts[1]!.slice(0, 1)}`.toUpperCase();
}

function avatarTone(seed: string) {
  const tones = [
    'border border-[color:var(--ui-border-soft)] bg-[color:var(--ui-surface-2)] text-[color:var(--ui-text-title)]',
    'border border-[color:var(--ui-border-soft)] bg-[color:var(--ui-surface-3)] text-[color:var(--ui-text-title)]',
    'border border-[color:var(--ui-border-soft)] bg-[color:var(--ui-hover)] text-[color:var(--ui-text-title)]'
  ];
  let hash = 0;
  for (const char of seed) {
    hash = (hash + char.charCodeAt(0)) % tones.length;
  }
  return tones[hash]!;
}

export function WindowsTitleBar(props: WindowsTitleBarProps) {
  const profileName = props.collaboration.profile?.displayName ?? props.collaboration.account.userId ?? 'Vicode';
  const settingsActive = props.route === 'settings';

  return (
    <header
      className="windows-titlebar"
      style={{
        WebkitAppRegion: 'drag'
      }}
    >
      <div className="windows-titlebar-brand">
        <div className={cx('windows-titlebar-mark', props.isAgentWorking && 'is-working')} aria-hidden="true">
          <img
            src={props.isAgentWorking ? wolfRun : appIcon}
            alt=""
            className={cx('windows-titlebar-mark-image', props.isAgentWorking && 'is-working')}
          />
        </div>
        <div className="windows-titlebar-copy">
          <strong>Vicode</strong>
        </div>
      </div>

      <div className="windows-titlebar-center">
        <div className="windows-titlebar-context">
          <span className="windows-titlebar-context-project">{normalizeDisplayText(props.selectedProjectName ?? 'Workspace')}</span>
          {props.activeThreadTitle ? <span className="windows-titlebar-context-separator">/</span> : null}
          {props.activeThreadTitle ? <span className="windows-titlebar-context-thread">{normalizeDisplayText(props.activeThreadTitle)}</span> : null}
        </div>
      </div>

      <div className="windows-titlebar-actions" style={{ WebkitAppRegion: 'no-drag' }}>
        {props.workspaceAction ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <ActionButton
                size="compact"
                tone="quiet"
                data-testid={props.workspaceAction.testId}
                className={cx('windows-titlebar-workspace-action', props.workspaceAction.tone === 'warning' && 'is-warning')}
                leadingIcon={props.workspaceAction.icon}
                onClick={props.workspaceAction.onClick}
              >
                {props.workspaceAction.label}
              </ActionButton>
            </TooltipTrigger>
            <TooltipContent className="windows-titlebar-tooltip windows-titlebar-workspace-tooltip">
              {props.workspaceAction.tooltip}
            </TooltipContent>
          </Tooltip>
        ) : null}

        <TitleBarUpdateAction
          appUpdateState={props.appUpdateState}
          onPress={props.pressUpdateAction}
        />

        <Tooltip>
          <TooltipTrigger asChild>
            <IconButton
              data-testid="nav-automations"
              className={cx('windows-titlebar-action', props.route === 'automations' && 'is-active')}
              label="Automations"
              onClick={props.openAutomations}
            >
              <AutomationIcon />
            </IconButton>
          </TooltipTrigger>
          <TooltipContent className="windows-titlebar-tooltip">Automations</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <IconButton
              data-testid="nav-plugins"
              className={cx('windows-titlebar-action', props.route === 'skills' && 'is-active')}
              label="Plugins"
              onClick={props.openSkills}
            >
              <SkillsIcon />
            </IconButton>
          </TooltipTrigger>
          <TooltipContent className="windows-titlebar-tooltip">Plugins</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <IconButton
              data-testid="nav-settings"
              className={cx('windows-titlebar-action', settingsActive && 'is-active')}
              label="Settings"
              onClick={() => props.openSettings('general')}
            >
              <SettingsIcon />
            </IconButton>
          </TooltipTrigger>
          <TooltipContent className="windows-titlebar-tooltip">Settings</TooltipContent>
        </Tooltip>

        <Menu>
          <MenuTrigger asChild>
            <IconButton className="windows-profile-trigger" label="Account">
              <span className={cx('windows-profile-avatar', avatarTone(profileName))}>{buildInitials(profileName)}</span>
            </IconButton>
          </MenuTrigger>
          <MenuContent align="end" className="windows-profile-menu">
            <MenuLabel>Profile</MenuLabel>
            <div className="windows-profile-menu-header">
              <span className={cx('windows-profile-avatar windows-profile-avatar-large', avatarTone(profileName))}>
                {buildInitials(profileName)}
              </span>
              <div className="windows-profile-menu-copy">
                <strong>{profileName}</strong>
                <span>{props.collaboration.profile?.handle ?? 'Guest collaboration profile'}</span>
              </div>
            </div>
            <MenuSeparator />
            <MenuItem onSelect={() => props.openSettings('personalization')}>
              <MenuItemLabel>Instructions</MenuItemLabel>
              <AccountIcon />
            </MenuItem>
            <MenuItem onSelect={props.openSkills}>
              <MenuItemLabel>Plugins</MenuItemLabel>
              <SkillsIcon />
            </MenuItem>
            <MenuItem onSelect={props.openAutomations}>
              <MenuItemLabel>Automations</MenuItemLabel>
              <AutomationIcon />
            </MenuItem>
          </MenuContent>
        </Menu>
      </div>
    </header>
  );
}
