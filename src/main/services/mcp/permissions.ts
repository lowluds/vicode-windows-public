import type { McpPermissionMode } from '../../../shared/domain';

export function requiresToolApproval(mode: McpPermissionMode) {
  return mode === 'ask';
}
