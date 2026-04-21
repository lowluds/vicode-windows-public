import { app } from 'electron';
import { join } from 'node:path';
import type { McpServerSaveInput } from '../../../shared/domain';
import { DatabaseService } from '../../../storage/database';

export const INTERNAL_ANALYSIS_MCP_ID = 'internal-analysis';
export const INTERNAL_ANALYSIS_ARG_MARKER = '--vicode-internal-analysis-server';

function resolveInternalAnalysisScriptPath(appRoot?: string) {
  if (appRoot) {
    return join(appRoot, 'scripts', 'mcp', 'internal-analysis-server.mjs');
  }

  if (typeof app?.isPackaged === 'boolean') {
    return app.isPackaged
      ? join(process.resourcesPath, 'mcp', 'internal-analysis-server.mjs')
      : join(app.getAppPath(), 'scripts', 'mcp', 'internal-analysis-server.mjs');
  }

  return join(process.cwd(), 'scripts', 'mcp', 'internal-analysis-server.mjs');
}

export function isInternalAnalysisServerInput(input: { args: string[] }) {
  return input.args.includes(INTERNAL_ANALYSIS_ARG_MARKER)
    || input.args.some((value) => value.endsWith('/scripts/mcp/internal-analysis-server.mjs') || value.endsWith('\\scripts\\mcp\\internal-analysis-server.mjs'));
}

export function buildInternalAnalysisServerInput(
  db: DatabaseService,
  projectId: string,
  existingId?: string,
  options: { appRoot?: string } = {}
): McpServerSaveInput {
  const project = db.getProject(projectId);
  return {
    id: existingId,
    name: 'Vicode Internal Analysis MCP',
    scope: 'project',
    projectId: project.id,
    transportType: 'stdio',
    command: process.execPath,
    args: [resolveInternalAnalysisScriptPath(options.appRoot), INTERNAL_ANALYSIS_ARG_MARKER],
    cwd: project.folderPath,
    env: {
      ELECTRON_RUN_AS_NODE: '1',
      VICODE_INTERNAL_ANALYSIS_ROOT: project.folderPath,
      VICODE_STATE_DB_PATH: db.getDatabasePath()
    },
    enabled: true,
    toolInvocationMode: 'ask',
    launchApproved: true
  };
}
