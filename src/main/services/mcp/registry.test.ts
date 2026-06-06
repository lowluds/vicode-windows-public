import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DatabaseService } from '../../../storage/database';
import { buildInternalAnalysisServerInput } from './internal-analysis';
import { McpRegistryService } from './registry';

describe('McpRegistryService', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    while (tempDirs.length > 0) {
      const current = tempDirs.pop();
      if (current) {
        rmSync(current, { recursive: true, force: true });
      }
    }
  });

  function createTempDir() {
    const dir = mkdtempSync(join(tmpdir(), 'vicode-mcp-'));
    tempDirs.push(dir);
    return dir;
  }

  function seedInternalAnalysisWorkspace(root: string) {
    mkdirSync(join(root, 'docs', 'engineering'), { recursive: true });
    writeFileSync(join(root, 'docs', 'engineering', 'README.md'), '# Engineering README\n');
    writeFileSync(join(root, 'docs', 'engineering', 'WORKLOG.md'), '# Worklog\n');
  }

  it('registers a stdio MCP server, refreshes catalogs, and persists connection state', async () => {
    const dir = createTempDir();
    const db = new DatabaseService(join(dir, 'vicode.sqlite'));
    db.migrate();
    const registry = new McpRegistryService(db, { name: 'vicode-test', version: '0.0.0' });

    const server = await registry.saveServer({
      name: 'Fixture MCP',
      command: process.execPath,
      args: [join(process.cwd(), 'test', 'fixtures', 'mcp', 'stdio-server.mjs')],
      enabled: true,
      toolInvocationMode: 'ask',
      launchApproved: true
    });

    const catalog = await registry.listCatalog();

    expect(server.state?.status).toBe('connected');
    expect(server.state?.toolCount).toBe(2);
    expect(server.state?.resourceCount).toBe(1);
    expect(server.state?.promptCount).toBe(1);
    expect(catalog.tools.map((tool) => tool.name)).toContain('echo');
    expect(catalog.tools.map((tool) => tool.name)).toContain('dashboard_snapshot');
    expect(catalog.resources.map((resource) => resource.uri)).toContain('file:///fixture/readme');
    expect(catalog.prompts.map((prompt) => prompt.name)).toContain('review');

    await registry.dispose();
    db.close();
  });

  it('persists project-scoped MCP ownership in server views', async () => {
    const dir = createTempDir();
    const db = new DatabaseService(join(dir, 'vicode.sqlite'));
    db.migrate();
    const registry = new McpRegistryService(db, { name: 'vicode-test', version: '0.0.0' });
    const project = db.createProject({ name: 'Scoped project', trusted: true });

    const server = await registry.saveServer({
      name: 'Project MCP',
      scope: 'project',
      projectId: project.id,
      command: process.execPath,
      args: [join(process.cwd(), 'test', 'fixtures', 'mcp', 'stdio-server.mjs')],
      enabled: false,
      toolInvocationMode: 'ask',
      launchApproved: false
    });

    const view = registry.listServerViews()[0];

    expect(server.definition.scope).toBe('project');
    expect(server.definition.projectId).toBe(project.id);
    expect(view?.scope).toBe('project');
    expect(view?.projectId).toBe(project.id);

    await registry.dispose();
    db.close();
  });

  it('imports file-backed plugin bundles from the Vicode state folder', async () => {
    const dir = createTempDir();
    const statePath = join(dir, 'state');
    const bundleRoot = join(statePath, 'plugins', 'user', 'local-fixture-plugin');
    mkdirSync(join(bundleRoot, '.codex-plugin'), { recursive: true });
    writeFileSync(
      join(bundleRoot, '.codex-plugin', 'plugin.json'),
      JSON.stringify(
        {
          name: 'Local Fixture Plugin',
          description: 'File-backed MCP bundle for tests.'
        },
        null,
        2
      )
    );
    writeFileSync(
      join(bundleRoot, '.mcp.json'),
      JSON.stringify(
        {
          command: process.execPath,
          args: ['--version'],
          enabled: false,
          toolInvocationMode: 'ask',
          launchApproved: false
        },
        null,
        2
      )
    );

    const db = new DatabaseService(join(dir, 'vicode.sqlite'));
    db.migrate();
    const registry = new McpRegistryService(db, { name: 'vicode-test', version: '0.0.0' }, { statePath });

    await registry.syncImports();

    const views = registry.listServerViews();
    expect(views).toHaveLength(1);
    expect(views[0]?.id).toBe('file-plugin:global:local-fixture-plugin');
    expect(views[0]?.name).toBe('Local Fixture Plugin');
    expect(views[0]?.scope).toBe('global');
    expect(views[0]?.command).toBe(process.execPath);
    expect(views[0]?.cwd).toBe(bundleRoot);
    expect(views[0]?.enabled).toBe(false);

    await registry.dispose();
    db.close();
  });

  it('approves a pending MCP server launch and connects it to the catalog', async () => {
    const dir = createTempDir();
    const db = new DatabaseService(join(dir, 'vicode.sqlite'));
    db.migrate();
    const registry = new McpRegistryService(db, { name: 'vicode-test', version: '0.0.0' });

    const pending = await registry.saveServer({
      name: 'Fixture MCP',
      command: process.execPath,
      args: [join(process.cwd(), 'test', 'fixtures', 'mcp', 'stdio-server.mjs')],
      enabled: true,
      toolInvocationMode: 'ask',
      launchApproved: false
    });

    expect(pending.state?.status).toBe('approval_required');

    const approved = await registry.approveServerLaunch(pending.definition.id);
    const catalog = await registry.listCatalog();

    expect(approved.state?.status).toBe('connected');
    expect(catalog.tools.map((tool) => tool.name)).toContain('echo');

    await registry.dispose();
    db.close();
  });

  it('disconnects and clears catalog state when a server is disabled', async () => {
    const dir = createTempDir();
    const db = new DatabaseService(join(dir, 'vicode.sqlite'));
    db.migrate();
    const registry = new McpRegistryService(db, { name: 'vicode-test', version: '0.0.0' });

    const enabled = await registry.saveServer({
      name: 'Fixture MCP',
      command: process.execPath,
      args: [join(process.cwd(), 'test', 'fixtures', 'mcp', 'stdio-server.mjs')],
      enabled: true,
      toolInvocationMode: 'ask',
      launchApproved: true
    });

    const disabled = await registry.saveServer({
      id: enabled.definition.id,
      name: enabled.definition.name,
      transportType: enabled.definition.transportType,
      command: enabled.definition.command,
      args: enabled.definition.args,
      cwd: enabled.definition.cwd,
      env: enabled.definition.env,
      enabled: false,
      toolInvocationMode: enabled.definition.toolInvocationMode,
      launchApproved: enabled.definition.launchApproved
    });
    const catalog = await registry.listCatalog();

    expect(disabled.state?.status).toBe('disabled');
    expect(catalog.tools).toEqual([]);

    await registry.dispose();
    db.close();
  });

  it('can re-enable a disabled MCP server and reconnect its catalog', async () => {
    const dir = createTempDir();
    const db = new DatabaseService(join(dir, 'vicode.sqlite'));
    db.migrate();
    const registry = new McpRegistryService(db, { name: 'vicode-test', version: '0.0.0' });

    const enabled = await registry.saveServer({
      name: 'Fixture MCP',
      command: process.execPath,
      args: [join(process.cwd(), 'test', 'fixtures', 'mcp', 'stdio-server.mjs')],
      enabled: true,
      toolInvocationMode: 'ask',
      launchApproved: true
    });

    const disabled = await registry.setServerEnabled(enabled.definition.id, false);
    expect(disabled.state?.status).toBe('disabled');

    const reenabled = await registry.setServerEnabled(enabled.definition.id, true);
    const catalog = await registry.listCatalog();

    expect(reenabled.state?.status).toBe('connected');
    expect(catalog.tools.map((tool) => tool.name)).toContain('echo');

    await registry.dispose();
    db.close();
  });

  it('requires launch approval before starting an enabled MCP server', async () => {
    const dir = createTempDir();
    const db = new DatabaseService(join(dir, 'vicode.sqlite'));
    db.migrate();
    const registry = new McpRegistryService(db, { name: 'vicode-test', version: '0.0.0' });

    const server = await registry.saveServer({
      name: 'Fixture MCP',
      command: process.execPath,
      args: [join(process.cwd(), 'test', 'fixtures', 'mcp', 'stdio-server.mjs')],
      env: { FIXTURE_TOKEN: 'secret-token' },
      enabled: true,
      toolInvocationMode: 'ask'
    });

    const catalog = await registry.listCatalog();
    const views = registry.listServerViews();

    expect(server.state?.status).toBe('approval_required');
    expect(server.state?.toolCount).toBe(0);
    expect(catalog.tools).toEqual([]);
    expect(views[0]?.envKeys).toEqual(['FIXTURE_TOKEN']);

    await registry.dispose();
    db.close();
  });

  it('stores remote MCP servers as approval-gated integrations with redacted header keys', async () => {
    const dir = createTempDir();
    const db = new DatabaseService(join(dir, 'vicode.sqlite'));
    db.migrate();
    const registry = new McpRegistryService(db, { name: 'vicode-test', version: '0.0.0' });

    const server = await registry.saveServer({
      name: 'Remote MCP',
      transportType: 'streamable_http',
      command: '',
      url: 'https://mcp.example.com/mcp',
      headers: {
        Authorization: 'Bearer test-token'
      },
      enabled: true,
      toolInvocationMode: 'ask',
      launchApproved: false
    });

    const view = registry.listServerViews()[0];

    expect(server.state?.status).toBe('approval_required');
    expect(view).toMatchObject({
      name: 'Remote MCP',
      transportType: 'streamable_http',
      command: '',
      url: 'https://mcp.example.com/mcp',
      headerKeys: ['Authorization']
    });
    expect(JSON.stringify(view)).not.toContain('test-token');

    await registry.dispose();
    db.close();
  });

  it('persists and restores enabled approved MCP servers during registry initialization', async () => {
    const dir = createTempDir();
    const db = new DatabaseService(join(dir, 'vicode.sqlite'));
    db.migrate();

    {
      const registry = new McpRegistryService(db, { name: 'vicode-test', version: '0.0.0' });
      await registry.saveServer({
        name: 'Fixture MCP',
        command: process.execPath,
        args: [join(process.cwd(), 'test', 'fixtures', 'mcp', 'stdio-server.mjs')],
        enabled: true,
        toolInvocationMode: 'ask',
        launchApproved: true
      });
      await registry.dispose();
    }

    const restarted = new McpRegistryService(db, { name: 'vicode-test', version: '0.0.0' });
    await restarted.initialize();
    const views = restarted.listServerViews();
    const catalog = await restarted.listCatalog();

    expect(views).toHaveLength(1);
    expect(views[0]?.state?.status).toBe('connected');
    expect(catalog.prompts.map((prompt) => prompt.name)).toContain('review');

    await restarted.dispose();
    db.close();
  });

  it('restores a connected internal analysis MCP server during registry initialization', async () => {
    const dir = createTempDir();
    const workspaceDir = join(dir, 'workspace');
    mkdirSync(workspaceDir, { recursive: true });
    seedInternalAnalysisWorkspace(workspaceDir);
    const db = new DatabaseService(join(dir, 'vicode.sqlite'));
    db.migrate();
    const project = db.createProject({
      name: 'Internal analysis workspace',
      folderPath: workspaceDir,
      trusted: true
    });

    {
      const registry = new McpRegistryService(db, { name: 'vicode-test', version: '0.0.0' });
      await registry.saveServer(buildInternalAnalysisServerInput(db, project.id));
      await registry.dispose();
    }

    const registry = new McpRegistryService(db, { name: 'vicode-test', version: '0.0.0' });
    await registry.initialize();

    const views = registry.listServerViews();
    const catalog = await registry.listCatalog();

    expect(views.some((view) => view.name === 'Vicode Internal Analysis MCP')).toBe(true);
    expect(catalog.tools.map((tool) => tool.name)).toContain('list_projects');
    expect(catalog.tools.map((tool) => tool.name)).toContain('get_project_threads');
    expect(catalog.tools.map((tool) => tool.name)).not.toContain('get_build_control_summary');
    expect(catalog.resources.map((resource) => resource.uri)).toContain('vicode://engineering/readme');
    expect(catalog.resources.map((resource) => resource.uri)).toContain('vicode://engineering/worklog');
    expect(catalog.resources.map((resource) => resource.uri)).toContain('vicode://app/projects');
    expect(catalog.resources.map((resource) => resource.uri)).not.toContain('vicode://build-control/summary');

    await registry.dispose();
    db.close();
  });

  it('stores an error state when the MCP command cannot be launched', async () => {
    const dir = createTempDir();
    const db = new DatabaseService(join(dir, 'vicode.sqlite'));
    db.migrate();
    const registry = new McpRegistryService(db, { name: 'vicode-test', version: '0.0.0' });

    const server = await registry.saveServer({
      name: 'Broken MCP',
      command: 'vicode-missing-mcp-command',
      args: [],
      enabled: true,
      toolInvocationMode: 'ask',
      launchApproved: true
    });

    expect(server.state?.status).toBe('error');
    expect(String(server.state?.lastError ?? '')).toContain('spawn');

    await registry.dispose();
    db.close();
  });

  it('removes a configured MCP server and clears its catalog state', async () => {
    const dir = createTempDir();
    const db = new DatabaseService(join(dir, 'vicode.sqlite'));
    db.migrate();
    const registry = new McpRegistryService(db, { name: 'vicode-test', version: '0.0.0' });

    const server = await registry.saveServer({
      name: 'Fixture MCP',
      command: process.execPath,
      args: [join(process.cwd(), 'test', 'fixtures', 'mcp', 'stdio-server.mjs')],
      enabled: true,
      toolInvocationMode: 'ask',
      launchApproved: true
    });

    await registry.removeServerView(server.definition.id);

    expect(registry.listServerViews()).toEqual([]);
    expect((await registry.listCatalog()).tools).toEqual([]);

    await registry.dispose();
    db.close();
  });

  it('sets up the recommended shadcn MCP server as approval-gated', async () => {
    const dir = createTempDir();
    const db = new DatabaseService(join(dir, 'vicode.sqlite'));
    db.migrate();
    const registry = new McpRegistryService(db, { name: 'vicode-test', version: '0.0.0' });

    const server = await registry.setupRecommendedServer('shadcn');

    expect(server.name).toBe('shadcn MCP');
    expect(server.command).toBe('npx');
    expect(server.args).toEqual(['shadcn@latest', 'mcp']);
    expect(server.enabled).toBe(true);
    expect(server.launchApproved).toBe(false);
    expect(server.state?.status).toBe('approval_required');

    await registry.dispose();
    db.close();
  });

  it('sets up the recommended Playwright MCP server as approval-gated', async () => {
    const dir = createTempDir();
    const db = new DatabaseService(join(dir, 'vicode.sqlite'));
    db.migrate();
    const registry = new McpRegistryService(db, { name: 'vicode-test', version: '0.0.0' });

    const server = await registry.setupRecommendedServer('playwright');

    expect(server.name).toBe('Playwright MCP');
    expect(server.command).toBe('npx');
    expect(server.args).toEqual(['@playwright/mcp@latest']);
    expect(server.enabled).toBe(true);
    expect(server.launchApproved).toBe(false);
    expect(server.state?.status).toBe('approval_required');

    await registry.dispose();
    db.close();
  });

  it('sets up the internal analysis MCP server as a connected project-scoped integration', async () => {
    const dir = createTempDir();
    const workspaceDir = join(dir, 'workspace');
    mkdirSync(workspaceDir, { recursive: true });
    seedInternalAnalysisWorkspace(workspaceDir);
    const db = new DatabaseService(join(dir, 'vicode.sqlite'));
    db.migrate();
    const registry = new McpRegistryService(db, { name: 'vicode-test', version: '0.0.0' });
    const project = db.createProject({
      name: 'Internal analysis workspace',
      folderPath: workspaceDir,
      trusted: true
    });

    const server = await registry.setupRecommendedServer('internal-analysis', project.id);
    const catalog = await registry.listCatalog();

    expect(server.scope).toBe('project');
    expect(server.projectId).toBe(project.id);
    expect(server.launchApproved).toBe(true);
    expect(server.state?.status).toBe('connected');
    expect(catalog.tools.map((tool) => tool.name)).toContain('list_projects');
    expect(catalog.tools.map((tool) => tool.name)).toContain('get_project_autonomous_tasks');
    expect(catalog.tools.map((tool) => tool.name)).not.toContain('get_build_control_summary');
    expect(catalog.resources.map((resource) => resource.uri)).toContain('vicode://engineering/worklog');
    expect(catalog.resources.map((resource) => resource.uri)).toContain('vicode://app/projects');
    expect(catalog.resources.map((resource) => resource.uri)).not.toContain('vicode://build-control/summary');

    await registry.dispose();
    db.close();
  });
});
