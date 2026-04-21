import type { RunToolApprovalRequest } from '../../shared/domain';
import { deriveRuntimePolicy } from '../../shared/runtime-policy';
import { ActionButton, Menu, MenuContent, MenuItem, MenuItemLabel, MenuTrigger, SurfaceCard } from './ui';
import { CloseIcon, MoreIcon, PlayIcon, ShieldIcon } from './icons';
import { Tool, ToolContent, ToolHeader, ToolSection } from './ai-elements/tool';

function formatCwdLabel(value: string | null | undefined) {
  if (!value || value === '.' || value === './' || value === '.\\') {
    return 'Workspace root';
  }

  return value;
}

function isMcpApproval(approval: RunToolApprovalRequest) {
  return approval.toolName === 'use_mcp_tool' && approval.command.startsWith('MCP ');
}

export function ToolApprovalPanel({
  approval,
  providerLabel,
  runtimeCommandPolicy,
  runtimeNetworkPolicy,
  resolving,
  onApprove,
  onAutoApprove,
  onReject
}: {
  approval: RunToolApprovalRequest;
  providerLabel: string;
  runtimeCommandPolicy?: 'approval_required' | 'auto_approve' | 'disabled';
  runtimeNetworkPolicy?: 'disabled' | 'enabled';
  resolving: boolean;
  onApprove: () => void;
  onAutoApprove: () => void;
  onReject: () => void;
}) {
  const mcpApproval = isMcpApproval(approval);
  const runtimePolicy = deriveRuntimePolicy(
    'full_access',
    runtimeCommandPolicy ?? 'approval_required',
    runtimeNetworkPolicy ?? 'disabled'
  );
  const panelTitle = mcpApproval ? 'MCP tool approval' : 'Command approval';
  const detailTitle = mcpApproval
    ? approval.command.replace(/^MCP\s+/u, '')
    : approval.toolName;
  const headline = mcpApproval
    ? 'Vicode paused an MCP tool call'
    : 'Vicode paused a command';
  const summary = mcpApproval
    ? `Vicode's app-owned runtime paused a connected MCP tool call from ${providerLabel} before it continues.`
    : `Vicode's app-owned runtime paused a local shell command from ${providerLabel} before it continues.`;
  const detail = mcpApproval
    ? 'Connected MCP tools stay inside Vicode review boundaries. Confirm the target server and tool before continuing.'
    : `${runtimePolicy.commandSummary} ${runtimePolicy.networkSummary}`;
  const neutralActionClassName =
    'border-[color:var(--ui-alpha-06)] bg-[color:var(--ui-surface-2)] text-[color:var(--ui-text-title)] shadow-[var(--ui-shadow-apple)] hover:border-[color:var(--ui-border-strong)] hover:bg-[color:var(--ui-surface-3)]';
  const approveActionClassName =
    'border-[color:var(--ui-border-strong)] bg-[color:var(--ui-surface-3)] text-[color:var(--ui-text-title)] shadow-[var(--ui-shadow-apple)] hover:bg-[color:var(--ui-surface-4)]';

  return (
    <SurfaceCard
      className="flex flex-col gap-4 border-[color:var(--ui-alpha-06)] bg-[color:var(--ui-thread-tool-surface)] shadow-[var(--ui-shadow-apple)]"
      data-testid="tool-approval-panel"
    >
      <div className="flex items-start gap-3">
        <div className="flex min-w-0 items-center gap-2 text-[13px] font-semibold text-[color:var(--ui-text-title)]">
          <ShieldIcon size={15} />
          <span>{panelTitle}</span>
        </div>
      </div>

      <div className="rounded-[16px] border border-[color:var(--ui-alpha-06)] bg-[color:var(--ui-thread-tool-section-surface)] px-4 py-3 shadow-[var(--ui-shadow-apple)]">
        <div className="text-[13px] font-semibold text-[color:var(--ui-text-title)]">{headline}</div>
        <p className="mt-2 text-[13px] leading-6 text-[color:var(--ui-text-muted)]">
          {summary}
        </p>
        <p className="mt-2 text-[12px] leading-5 text-[color:var(--ui-text-subtle)]">
          {detail}
        </p>
      </div>

      <Tool
        className="border-[color:var(--ui-alpha-06)] bg-[color:var(--ui-thread-tool-surface)] shadow-[var(--ui-shadow-apple)]"
        defaultOpen
      >
        <ToolHeader title={detailTitle} state="approval-requested" />
        <ToolContent>
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(220px,300px)]">
            <ToolSection
              className="border-[color:var(--ui-alpha-06)] bg-[color:var(--ui-thread-tool-section-surface)]"
              title={mcpApproval ? 'Call' : 'Command'}
            >
              <code className="block whitespace-pre-wrap break-all font-mono text-[12px] leading-6 text-[color:var(--ui-text-title)]">
                {approval.command}
              </code>
            </ToolSection>
            <ToolSection
              className="border-[color:var(--ui-alpha-06)] bg-[color:var(--ui-thread-tool-section-surface)]"
              title="Scope"
            >
              <div className="space-y-2 text-[12px] leading-5 text-[color:var(--ui-text-muted)]">
                <div>
                  <span className="mr-2 text-[color:var(--ui-text-subtle)]">Tool</span>
                  <code className="font-mono text-[color:var(--ui-text-title)]">{approval.toolName}</code>
                </div>
                <div>
                  <span className="mr-2 text-[color:var(--ui-text-subtle)]">Cwd</span>
                  <code className="font-mono text-[color:var(--ui-text-title)]">{formatCwdLabel(approval.cwd)}</code>
                </div>
                <div>
                  <span className="mr-2 text-[color:var(--ui-text-subtle)]">Workspace</span>
                  <code className="break-all font-mono text-[color:var(--ui-text-title)]">{approval.workspaceRoot}</code>
                </div>
              </div>
            </ToolSection>
          </div>
        </ToolContent>
      </Tool>

      <div className="flex items-center justify-end gap-2 self-end">
        <ActionButton
          size="compact"
          className={neutralActionClassName}
          leadingIcon={<CloseIcon />}
          onClick={onReject}
          disabled={resolving}
        >
          Deny
        </ActionButton>
        <ActionButton
          size="compact"
          className={approveActionClassName}
          leadingIcon={<PlayIcon />}
          onClick={onApprove}
          disabled={resolving}
        >
          {resolving ? 'Resolving...' : mcpApproval ? 'Approve tool' : 'Approve command'}
        </ActionButton>
        {!mcpApproval && runtimeCommandPolicy !== 'auto_approve' ? (
          <Menu>
            <MenuTrigger asChild>
              <ActionButton
                size="compact"
                className={neutralActionClassName}
                leadingIcon={<MoreIcon />}
                disabled={resolving}
                aria-label="More approval actions"
              >
                More
              </ActionButton>
            </MenuTrigger>
            <MenuContent align="end" className="min-w-[220px]">
              <MenuItem
                className="rounded-xl"
                onSelect={() => onAutoApprove()}
                disabled={resolving}
              >
                <MenuItemLabel>Always allow in workspace</MenuItemLabel>
                <ShieldIcon />
              </MenuItem>
            </MenuContent>
          </Menu>
        ) : null}
      </div>
    </SurfaceCard>
  );
}
