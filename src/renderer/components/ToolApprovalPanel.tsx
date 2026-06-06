import type { RunToolApprovalRequest } from '../../shared/domain';
import { deriveRuntimePolicy } from '../../shared/runtime-policy';
import {
  ActionButton,
  Menu,
  MenuContent,
  MenuItem,
  MenuItemLabel,
  MenuTrigger,
  SurfaceCard,
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from './ui';
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

function isWorkspaceChangeApproval(approval: RunToolApprovalRequest) {
  return approval.approvalKind === 'workspace_change' && Boolean(approval.workspaceChange);
}

export function formatApprovalToolLabel(approval: RunToolApprovalRequest) {
  if (isWorkspaceChangeApproval(approval)) {
    return approval.workspaceChange?.sourceToolName ?? approval.toolName;
  }

  if (isMcpApproval(approval)) {
    return approval.command.replace(/^MCP\s+/u, '');
  }

  if (approval.toolName === 'run_command' || approval.toolName === 'exec_command') {
    return 'Shell command';
  }

  return approval.toolName;
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
  const workspaceChangeApproval = isWorkspaceChangeApproval(approval);
  const workspaceChange = approval.workspaceChange ?? null;
  const runtimePolicy = deriveRuntimePolicy(
    'full_access',
    runtimeCommandPolicy ?? 'approval_required',
    runtimeNetworkPolicy ?? 'disabled'
  );
  const panelTitle = workspaceChangeApproval ? 'File change approval' : mcpApproval ? 'MCP tool approval' : 'Command approval';
  const detailTitle = formatApprovalToolLabel(approval);
  const headline = workspaceChangeApproval
    ? 'Vicode paused a file change'
    : mcpApproval
    ? 'Vicode paused an MCP tool call'
    : 'Vicode paused a command';
  const summary = workspaceChangeApproval
    ? `${providerLabel} requested a workspace patch. Review the diff before continuing.`
    : mcpApproval
    ? `${providerLabel} requested a connected MCP tool. Review the target before continuing.`
    : `${providerLabel} requested a local shell command. Review the command before continuing.`;
  const detail = workspaceChangeApproval
    ? 'The patch will not write to the workspace unless you approve this request.'
    : mcpApproval
    ? 'MCP calls stay inside Vicode review boundaries.'
    : `${runtimePolicy.commandSummary} ${runtimePolicy.networkSummary}`;
  const neutralActionClassName =
    'tool-approval-action border-[color:var(--ui-alpha-06)] bg-transparent text-[color:var(--ui-text-title)] shadow-none hover:border-[color:var(--ui-border-strong)] hover:bg-[color:var(--ui-alpha-06)]';
  const approveActionClassName =
    'tool-approval-action border-[color:var(--ui-border-strong)] bg-[color:var(--ui-text-title)] text-[color:var(--ui-app-bg)] shadow-none hover:bg-[color:var(--ui-text-title-soft)]';

  return (
    <SurfaceCard
      className="tool-approval-panel flex flex-col gap-3 border-[color:var(--ui-alpha-08)] bg-[color:var(--ui-alpha-025)] shadow-none"
      data-testid="tool-approval-panel"
    >
      <div className="tool-approval-heading flex min-w-0 items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2 text-[12px] font-semibold text-[color:var(--ui-text-title)]">
          <ShieldIcon size={15} />
          <span>{panelTitle}</span>
        </div>
        <span className="tool-approval-status">Pending approval</span>
      </div>

      <div className="tool-approval-summary">
        <div className="text-[13px] font-semibold text-[color:var(--ui-text-title)]">{headline}</div>
        <p className="mt-1 text-[13px] leading-5 text-[color:var(--ui-text-muted)]">
          {summary}
        </p>
        <p className="mt-1 text-[12px] leading-5 text-[color:var(--ui-text-subtle)]">
          {detail}
        </p>
      </div>

      <Tool
        className="tool-approval-detail border-[color:var(--ui-alpha-08)] bg-transparent shadow-none"
        defaultOpen
      >
        <ToolHeader title={detailTitle} state="approval-requested" />
        <ToolContent>
          <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_minmax(220px,280px)]">
            <ToolSection
              className="tool-approval-section"
              title={workspaceChangeApproval ? 'Change' : mcpApproval ? 'Call' : 'Command'}
            >
              {workspaceChange ? (
                <div className="space-y-3 text-[12px] leading-5 text-[color:var(--ui-text-muted)]">
                  <div>
                    <span className="mr-2 text-[color:var(--ui-text-subtle)]">Summary</span>
                    <code className="font-mono text-[color:var(--ui-text-title)]">
                      {workspaceChange.summary.filesChanged} files, +{workspaceChange.summary.insertions} -{workspaceChange.summary.deletions}
                    </code>
                  </div>
                  <div className="space-y-2">
                    {workspaceChange.preview.files.map((file) => (
                      <div key={file.path} className="rounded-md border border-[color:var(--ui-alpha-08)] bg-[color:var(--ui-alpha-025)] p-2">
                        <div className="flex min-w-0 items-center justify-between gap-2">
                          <code className="break-all font-mono text-[12px] text-[color:var(--ui-text-title)]">{file.path}</code>
                          <span className="shrink-0 text-[11px] uppercase tracking-normal text-[color:var(--ui-text-subtle)]">{file.status}</span>
                        </div>
                        <div className="mt-2 max-h-36 overflow-hidden rounded bg-[color:var(--ui-app-bg)] px-2 py-1 font-mono text-[11px] leading-5 text-[color:var(--ui-text-muted)]">
                          {file.previewLines.slice(0, 8).map((line, index) => (
                            <div key={`${file.path}-${index}`} className="whitespace-pre-wrap break-all">
                              {line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' '}
                              {line.text}
                            </div>
                          ))}
                          {file.previewTruncated || file.previewLines.length > 8 ? (
                            <div className="text-[color:var(--ui-text-subtle)]">...</div>
                          ) : null}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <code className="block whitespace-pre-wrap break-all font-mono text-[12px] leading-6 text-[color:var(--ui-text-title)]">
                  {approval.command}
                </code>
              )}
            </ToolSection>
            <ToolSection
              className="tool-approval-section"
              title="Scope"
            >
              <div className="space-y-2 text-[12px] leading-5 text-[color:var(--ui-text-muted)]">
                <div>
                  <span className="mr-2 text-[color:var(--ui-text-subtle)]">Type</span>
                  <code className="font-mono text-[color:var(--ui-text-title)]">{formatApprovalToolLabel(approval)}</code>
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

      <div className="tool-approval-actions flex items-center justify-end gap-2 self-end">
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
          {resolving ? 'Resolving...' : workspaceChangeApproval ? 'Approve change' : mcpApproval ? 'Approve tool' : 'Approve command'}
        </ActionButton>
        {!mcpApproval && !workspaceChangeApproval && runtimeCommandPolicy !== 'auto_approve' ? (
          <Menu>
            <Tooltip>
              <TooltipTrigger asChild>
                <MenuTrigger asChild>
                  <ActionButton
                    size="compact"
                    className={`${neutralActionClassName} tool-approval-icon-action`}
                    leadingIcon={<MoreIcon />}
                    disabled={resolving}
                    aria-label="More approval actions"
                  >
                    <span className="sr-only">More approval actions</span>
                  </ActionButton>
                </MenuTrigger>
              </TooltipTrigger>
              <TooltipContent>More approval actions</TooltipContent>
            </Tooltip>
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
