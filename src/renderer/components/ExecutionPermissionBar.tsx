import { IconButton, Menu, MenuButton, MenuCheckboxItem, MenuContent, MenuItemLabel, MenuTrigger, Tooltip, TooltipContent, TooltipTrigger } from './ui';
import type {
  ExecutionPermission,
  ProjectRuntimeCommandPolicy,
  ProjectRuntimeNetworkPolicy,
  ProviderId
} from '../../shared/domain';
import { providerPermissionBoundaryNote, providerPermissionOptionDisabled } from '../../shared/providers';
import { deriveRuntimePolicy } from '../../shared/runtime-policy';
import {
  deriveContextWindowMeterPercent,
  formatContextTokenCount,
  formatContextUsagePercent,
  type ContextWindowEstimate
} from '../lib/context-window';
import { CheckIcon, ChevronDownIcon, CodeIcon, ShieldIcon } from './icons';
import { cx } from './ui/utils';

interface ExecutionPermissionBarProps {
  providerId: ProviderId;
  contextWindow: ContextWindowEstimate | null;
  executionPermission: ExecutionPermission;
  runtimeCommandPolicy?: ProjectRuntimeCommandPolicy | null;
  runtimeNetworkPolicy?: ProjectRuntimeNetworkPolicy | null;
  onSelectPermission: (executionPermission: ExecutionPermission) => void;
}

const OPTIONS: Array<{ id: ExecutionPermission; label: string }> = [
  { id: 'default', label: 'Default permissions' },
  { id: 'full_access', label: 'Full access' }
];

const CONTEXT_RING_RADIUS = 7;
const CONTEXT_RING_CIRCUMFERENCE = 2 * Math.PI * CONTEXT_RING_RADIUS;
const CONTEXT_RING_CENTER = 10;

export function ExecutionPermissionBar({
  providerId,
  contextWindow,
  executionPermission,
  runtimeCommandPolicy,
  runtimeNetworkPolicy,
  onSelectPermission
}: ExecutionPermissionBarProps) {
  const selectedLabel = OPTIONS.find((option) => option.id === executionPermission)?.label ?? 'Default permissions';
  const showOllamaHint = providerId === 'ollama';
  const activeRuntimeCommandPolicy =
    runtimeCommandPolicy ?? 'approval_required';
  const activeRuntimeNetworkPolicy =
    runtimeNetworkPolicy ?? 'disabled';
  const ollamaDefaultPolicy = showOllamaHint
    ? deriveRuntimePolicy('default', activeRuntimeCommandPolicy, activeRuntimeNetworkPolicy)
    : null;
  const ollamaFullAccessPolicy = showOllamaHint
    ? deriveRuntimePolicy('full_access', activeRuntimeCommandPolicy, activeRuntimeNetworkPolicy)
    : null;
  const contextWindowClassName = contextWindow
    ? `composer-context-window-button is-${contextWindow.severity}`
    : 'composer-context-window-button';
  const meterPercent = contextWindow ? deriveContextWindowMeterPercent(contextWindow.usagePercent) : 0;
  const ringOffset = CONTEXT_RING_CIRCUMFERENCE * (1 - meterPercent / 100);
  const indicatorTheta = (meterPercent / 100) * Math.PI * 2;
  const indicatorX = CONTEXT_RING_CENTER + CONTEXT_RING_RADIUS * Math.cos(indicatorTheta);
  const indicatorY = CONTEXT_RING_CENTER + CONTEXT_RING_RADIUS * Math.sin(indicatorTheta);
  const contextWindowLabel = 'Context window';
  const formattedUsagePercent = contextWindow ? formatContextUsagePercent(contextWindow.usagePercent) : '0%';
  const formattedTokenWindow = contextWindow
    ? `${formatContextTokenCount(contextWindow.usedTokens)} / ${formatContextTokenCount(contextWindow.maxTokens)} tokens used`
    : null;
  const contextWindowTriggerLabel = contextWindow ? `Context window ${formattedUsagePercent} full` : contextWindowLabel;
  const providerBoundaryNote = providerPermissionBoundaryNote(providerId, executionPermission);
  const ollamaAccessSummary =
    executionPermission === 'default'
      ? activeRuntimeNetworkPolicy === 'enabled'
        ? 'Files plus native web research. The model can inspect the trusted workspace and research online headlessly, but it cannot run shell commands.'
        : 'Files plus native web research. The model can inspect the trusted workspace and research online headlessly, but host-network shell commands stay blocked here.'
      : activeRuntimeCommandPolicy === 'disabled'
        ? 'This workspace keeps commands off, even with Full access.'
        : activeRuntimeCommandPolicy === 'auto_approve'
          ? activeRuntimeNetworkPolicy === 'enabled'
            ? 'Commands auto-run on this machine and can use internet access here.'
            : 'Commands auto-run on this machine, app-owned web research still works, but internet-style shell commands stay blocked here.'
        : activeRuntimeNetworkPolicy === 'enabled'
          ? 'Commands require approval. Approved commands run on this machine and can use internet access here.'
          : 'Commands require approval. Approved commands run on this machine, app-owned web research still works, but internet-style shell commands stay blocked here.';

  return (
    <div className="composer-status-row flex items-center gap-2">
      <Menu>
        <Tooltip>
          <TooltipTrigger asChild>
            <MenuTrigger asChild>
              <MenuButton
                className={cx(
                  executionPermission === 'full_access' ? 'composer-status-menu is-full-access' : 'composer-status-menu',
                  'h-8 rounded-full px-2.5 text-[12px]'
                )}
                trailingIcon={<ChevronDownIcon />}
              >
                {selectedLabel}
              </MenuButton>
            </MenuTrigger>
          </TooltipTrigger>
        <TooltipContent side="top" className="composer-status-tooltip max-w-[260px]">
          <div className="text-[12px] font-semibold text-[color:var(--ui-text-title)]">Change permissions</div>
          <div className="composer-status-tooltip-note mt-1 text-[11px] leading-5 text-[color:var(--ui-text-muted)]">
            {providerBoundaryNote}
          </div>
          {showOllamaHint ? (
            <div className="composer-status-tooltip-note mt-1 flex flex-col gap-2 text-[11px] leading-5 text-[color:var(--ui-text-muted)]">
              <div>{ollamaAccessSummary}</div>
                <div>
                  <span className="font-medium text-[color:var(--ui-text-title)]">Default:</span>{' '}
                  {ollamaDefaultPolicy?.defaultToolLabels.join(', ')}
                  , native web research
                </div>
                <div>
                  <span className="font-medium text-[color:var(--ui-text-title)]">Full access:</span>{' '}
                  {ollamaFullAccessPolicy?.elevatedToolLabels.join(', ') || 'nothing extra'}
                </div>
              </div>
            ) : null}
          </TooltipContent>
        </Tooltip>
        <MenuContent className="composer-status-menu-content min-w-[220px]">
          {OPTIONS.map((option) => {
            const selected = option.id === executionPermission;
            const disabled = providerPermissionOptionDisabled(providerId, option.id);
            return (
              <MenuCheckboxItem
                key={option.id}
                checked={selected}
                disabled={disabled}
                className={cx(selected && 'is-selected', 'rounded-xl')}
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
        </MenuContent>
      </Menu>
      {contextWindow ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <IconButton
              label={contextWindowTriggerLabel}
              tone="quiet"
              size="compact"
              data-testid="composer-context-window-trigger"
              className={cx(
                contextWindowClassName,
                contextWindow.severity === 'warning' && 'is-warning',
                contextWindow.severity === 'danger' && 'is-danger'
              )}
            >
              <span className="composer-context-window-ring" aria-hidden="true">
                <svg viewBox="0 0 20 20" className="composer-context-window-ring-svg size-4">
                  <circle className="composer-context-window-ring-track" cx="10" cy="10" r={CONTEXT_RING_RADIUS} fill="none" />
                  <circle
                    className="composer-context-window-ring-progress"
                    cx={CONTEXT_RING_CENTER}
                    cy={CONTEXT_RING_CENTER}
                    r={CONTEXT_RING_RADIUS}
                    fill="none"
                    style={{
                      strokeDasharray: `${CONTEXT_RING_CIRCUMFERENCE}`,
                      strokeDashoffset: ringOffset
                    }}
                  />
                  <circle className="composer-context-window-ring-indicator" cx={indicatorX} cy={indicatorY} r="1.8" />
                </svg>
              </span>
            </IconButton>
          </TooltipTrigger>
          <TooltipContent
            side="top"
            className="composer-context-window-tooltip w-[min(320px,calc(100vw-32px))] max-w-[calc(100vw-32px)] rounded-[20px] p-0"
            data-testid="composer-context-window-tooltip"
          >
            <div className="composer-context-window-tooltip-body flex flex-col px-3 py-3">
              <div className="text-[12px] font-semibold text-[color:var(--ui-text-title)]">{contextWindowLabel}</div>
              <div className="text-[22px] font-semibold leading-none text-[color:var(--ui-text-title)]">
                {formattedUsagePercent} full
              </div>
              <div className="text-[13px] font-medium text-[color:var(--ui-text-title)]">{formattedTokenWindow}</div>
              {contextWindow.autoCompactTokenLimit ? (
                <div className="text-[11px] text-[color:var(--ui-text-muted)]">
                  Auto-compact at {formatContextTokenCount(contextWindow.autoCompactTokenLimit)}
                </div>
              ) : null}
              <div
                className={cx(
                  'text-[11px] font-medium',
                  contextWindow.severity === 'danger'
                    ? 'text-[color:var(--ui-danger-text)]'
                    : contextWindow.severity === 'warning'
                      ? 'text-[color:var(--ui-warning-text)]'
                      : 'text-[color:var(--ui-brand-text)]'
                )}
              >
                {contextWindow.pressureLabel}
              </div>
            </div>
            <div className="composer-context-window-tooltip-footer flex flex-col border-t border-[color:var(--ui-border-soft)] bg-[color:var(--ui-alpha-03)] px-3 py-2.5">
              {contextWindow.sourceLabel ? (
                <div className="composer-context-window-tooltip-source">
                  <span className="composer-context-window-tooltip-stat-label">Source</span>
                  <span className="composer-context-window-tooltip-source-copy">{contextWindow.sourceLabel}</span>
                </div>
              ) : null}
              {contextWindow.note ? (
                <div className="composer-context-window-tooltip-note">{contextWindow.note}</div>
              ) : null}
            </div>
          </TooltipContent>
        </Tooltip>
      ) : null}
    </div>
  );
}
