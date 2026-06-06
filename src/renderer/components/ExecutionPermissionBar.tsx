import { Menu, MenuButton, MenuCheckboxItem, MenuContent, MenuItemLabel, MenuLabel, MenuSeparator, MenuTrigger, Tooltip, TooltipContent, TooltipTrigger } from './ui';
import type {
  ExecutionPermission,
  HarnessIsolationMode,
  ProjectRuntimeCommandPolicy,
  ProjectRuntimeNetworkPolicy,
  ProviderId
} from '../../shared/domain';
import { providerPermissionOptionDisabled } from '../../shared/providers';
import { CheckIcon, ChevronDownIcon, CodeIcon, ShieldIcon } from './icons';
import { cx } from './ui/utils';

interface ExecutionPermissionBarProps {
  providerId: ProviderId;
  executionPermission: ExecutionPermission;
  isolationMode?: HarnessIsolationMode;
  runtimeCommandPolicy?: ProjectRuntimeCommandPolicy | null;
  runtimeNetworkPolicy?: ProjectRuntimeNetworkPolicy | null;
  onSelectPermission: (executionPermission: ExecutionPermission) => void;
  onSelectIsolationMode?: (isolationMode: HarnessIsolationMode) => void;
  onMenuCloseAutoFocus?: (event: Event) => void;
}

const PERMISSION_OPTIONS: Array<{ id: ExecutionPermission; label: string; description: string }> = [
  {
    id: 'default',
    label: 'Ask first',
    description: 'Keep host-local shell commands blocked unless Full access is selected.'
  },
  {
    id: 'full_access',
    label: 'Full access',
    description: 'Edit workspace files and run commands allowed by this project.'
  }
];

const ISOLATION_OPTIONS: Array<{
  id: HarnessIsolationMode;
  label: string;
  description: string;
  tooltipDescription: string;
}> = [
  {
    id: 'direct_workspace',
    label: 'Direct edits',
    description: 'Write directly to workspace files.',
    tooltipDescription: 'Writes directly to this project.'
  },
  {
    id: 'patch_buffer',
    label: 'Proposed changes',
    description: 'Stage file changes for review.',
    tooltipDescription: 'Stages changes for review before applying them.'
  },
  {
    id: 'git_worktree',
    label: 'Isolated worktree',
    description: 'Use an app-owned Git worktree.',
    tooltipDescription: 'Uses an app-owned Git worktree for file edits.'
  }
];

function buildWorkspaceControlLabel(
  isolationMode: HarnessIsolationMode,
  executionPermission: ExecutionPermission
) {
  if (executionPermission === 'full_access') {
    const isolationLabel =
      ISOLATION_OPTIONS.find((option) => option.id === isolationMode)?.label ??
      'Direct edits';
    return isolationMode === 'direct_workspace' ? 'Full access' : `${isolationLabel} + Full access`;
  }

  const isolationLabel =
    ISOLATION_OPTIONS.find((option) => option.id === isolationMode)?.label ??
    'Ask first';

  return isolationMode === 'direct_workspace' ? 'Ask first' : isolationLabel;
}

export function ExecutionPermissionBar({
  providerId,
  executionPermission,
  isolationMode = 'direct_workspace',
  onSelectPermission,
  onSelectIsolationMode,
  onMenuCloseAutoFocus
}: ExecutionPermissionBarProps) {
  const selectedIsolation =
    ISOLATION_OPTIONS.find((option) => option.id === isolationMode) ?? ISOLATION_OPTIONS[0];
  const permissionTooltipSummary =
    executionPermission === 'full_access'
      ? 'Commands follow project approval.'
      : 'Shell commands stay off.';
  const workspaceControlLabel = buildWorkspaceControlLabel(selectedIsolation.id, executionPermission);
  const workspaceTooltipSummary =
    `${selectedIsolation.tooltipDescription} ${permissionTooltipSummary}`;

  return (
    <div className="composer-status-row flex items-center gap-2">
      <Menu>
        <Tooltip>
          <TooltipTrigger asChild>
            <MenuTrigger asChild>
              <MenuButton
                className={cx(
                  'composer-status-menu composer-workspace-status-menu',
                  isolationMode === 'patch_buffer' && 'is-patch-buffer',
                  isolationMode === 'git_worktree' && 'is-git-worktree',
                  executionPermission === 'full_access' && 'is-full-access',
                  'text-[12px]'
                )}
                data-testid="composer-workspace-select"
                aria-label={`Workspace mode: ${workspaceControlLabel}`}
                trailingIcon={<ChevronDownIcon />}
              >
                {workspaceControlLabel}
              </MenuButton>
            </MenuTrigger>
          </TooltipTrigger>
          <TooltipContent side="top" className="composer-status-tooltip max-w-[240px]">
            <div className="text-[12px] font-semibold text-[color:var(--ui-text-title)]">Workspace mode</div>
            <div className="composer-status-tooltip-note mt-1 text-[11px] leading-5 text-[color:var(--ui-text-muted)]">
              {workspaceTooltipSummary}
            </div>
          </TooltipContent>
        </Tooltip>
        <MenuContent
          className="composer-status-menu-content composer-workspace-menu-content min-w-[260px]"
          onCloseAutoFocus={onMenuCloseAutoFocus}
        >
          <MenuLabel>File edits</MenuLabel>
          {ISOLATION_OPTIONS.map((option) => {
            const selected = option.id === selectedIsolation.id;
            return (
              <MenuCheckboxItem
                key={option.id}
                checked={selected}
                className={cx(selected && 'is-selected', 'rounded-lg')}
                onCheckedChange={() => onSelectIsolationMode?.(option.id)}
              >
                <MenuItemLabel>
                  <span className="composer-status-option-label flex items-center gap-2">
                    {option.id === 'patch_buffer' || option.id === 'git_worktree' ? <ShieldIcon size={15} /> : <CodeIcon size={15} />}
                    <span>{option.label}</span>
                  </span>
                </MenuItemLabel>
                {selected ? <CheckIcon /> : null}
              </MenuCheckboxItem>
            );
          })}
          <MenuSeparator />
          <MenuLabel>Commands</MenuLabel>
          <div className="composer-status-menu-note">
            {executionPermission === 'full_access'
              ? 'Shell commands follow this workspace approval policy.'
              : 'Shell commands stay blocked unless Full access is selected.'}
          </div>
          {PERMISSION_OPTIONS.map((option) => {
            const selected = option.id === executionPermission;
            const disabled = providerPermissionOptionDisabled(providerId, option.id);
            return (
              <MenuCheckboxItem
                key={option.id}
                checked={selected}
                disabled={disabled}
                className={cx(selected && 'is-selected', 'rounded-lg')}
                onCheckedChange={() => {
                  if (!disabled) {
                    onSelectPermission(option.id);
                  }
                }}
              >
                <MenuItemLabel>
                  <span className="composer-status-option-label flex items-center gap-2">
                    {option.id === 'default' ? <CodeIcon size={15} /> : <ShieldIcon size={15} />}
                    <span>{option.label}</span>
                  </span>
                </MenuItemLabel>
                {selected ? <CheckIcon /> : null}
              </MenuCheckboxItem>
            );
          })}
          <MenuSeparator />
          <div className="composer-status-menu-note">
            Permission settings live in the project and provider settings for now.
          </div>
        </MenuContent>
      </Menu>
    </div>
  );
}
