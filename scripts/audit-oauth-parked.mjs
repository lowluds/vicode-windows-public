#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

const findings = [];

function requireMatch(name, matched, detail) {
  if (!matched) {
    findings.push({ name, detail });
  }
}

function forbidPatterns(name, relativePath, patterns) {
  const content = read(relativePath);
  for (const pattern of patterns) {
    const match = pattern.exec(content);
    if (match) {
      findings.push({
        name,
        detail: `${relativePath} contains parked OAuth token "${match[0]}". Keep remote MCP OAuth out of active runtime surfaces until the unlock gate is met.`
      });
    }
  }
}

function readInterface(content, interfaceName) {
  const start = content.indexOf(`export interface ${interfaceName} `);
  if (start === -1) {
    return '';
  }
  const next = content.indexOf('\nexport interface ', start + 1);
  return content.slice(start, next === -1 ? content.length : next);
}

const activeMcpSurfaceFiles = [
  'src/shared/domain.ts',
  'src/shared/schemas.ts',
  'src/main/services/mcp/client.ts',
  'src/main/services/mcp/registry.ts',
  'src/main/ipc.ts',
  'src/preload/index.ts',
  'src/renderer/components/PluginServerDialog.tsx',
  'src/renderer/components/SkillsView.plugins.ts',
  'src/renderer/components/SkillsView.tsx',
  'src/renderer/lib/skills-mcp-server-actions.ts'
];

const parkedOAuthPatterns = [
  /\boauth\b/iu,
  /\bpkce\b/iu,
  /\bOAuthClientProvider\b/u,
  /\bfinishAuth\b/u,
  /\bauthorization[-_ ]code\b/iu,
  /\brefresh[-_ ]token\b/iu,
  /\baccess[-_ ]token\b/iu,
  /\bclient[-_ ]secret\b/iu,
  /\bredirect[-_ ]uri\b/iu,
  /\bcallback[-_ ]url\b/iu,
  /\btoken[-_ ]store\b/iu
];

for (const relativePath of activeMcpSurfaceFiles) {
  forbidPatterns('remote MCP OAuth remains parked in active surfaces', relativePath, parkedOAuthPatterns);
}

const domainProvider = read('src/shared/domain-provider.ts');
const domainThread = read('src/shared/domain-thread.ts');
const schemas = read('src/shared/schemas.ts');
const mcpClient = read('src/main/services/mcp/client.ts');
const mcpRegistry = read('src/main/services/mcp/registry.ts');
const mcpServerViewInterface = readInterface(domainThread, 'McpServerView');
const mcpClientTest = read('src/main/services/mcp/client.test.ts');
const registryTest = read('src/main/services/mcp/registry.test.ts');
const storageTest = read('src/storage/database.test.ts');
const packageJson = read('package.json');
const boundaryDoc = read('docs/engineering/mcp-remote-transport-boundary.md');
const normalizedDoc = read('docs/engineering/normalized-provider-validation.md');
const certScript = read('scripts/certify-openai-compatible-providers.mjs');

requireMatch(
  'remote MCP transport type is limited to stdio/static remote transports',
  /export type McpServerTransportType = 'stdio' \| 'streamable_http' \| 'sse';/u.test(domainThread)
    && /export const mcpServerTransportTypeSchema = z\.enum\(\['stdio', 'streamable_http', 'sse'\]\);/u.test(schemas),
  'domain and IPC schemas must not introduce an OAuth transport/auth variant yet'
);

requireMatch(
  'custom provider transport remains OpenAI-compatible chat only',
  /export type CustomProviderTransportKind = 'openai_compatible_chat';/u.test(domainProvider)
    && /export const customProviderTransportKindSchema = z\.literal\('openai_compatible_chat'\);/u.test(schemas),
  'custom provider settings should stay name/base URL/API key/model for the OpenAI-compatible transport'
);

requireMatch(
  'remote MCP client sends only static headers',
  /new StreamableHTTPClientTransport\(new URL\(this\.definition\.url\),\s*\{\s*requestInit:\s*\{\s*headers: this\.definition\.headers/su.test(mcpClient)
    && /new SSEClientTransport\(new URL\(this\.definition\.url\),\s*\{\s*requestInit:\s*\{\s*headers: this\.definition\.headers/su.test(mcpClient),
  'remote MCP transports must use static configured headers, not OAuth providers'
);

requireMatch(
  'renderer-facing MCP views expose header keys only',
  /headerKeys: Object\.keys\(server\.definition\.headers\)\.sort\(\)/u.test(mcpRegistry)
    && mcpServerViewInterface.includes('headerKeys: string[];')
    && !/\bheaders:/u.test(mcpServerViewInterface),
  'registry views must not expose remote MCP header values to the renderer'
);

requireMatch(
  'static remote MCP proof covers streamable HTTP headers',
  /connects streamable HTTP MCP servers with configured headers/u.test(mcpClientTest),
  'MCP client tests must prove static headers are passed to streamable HTTP'
);

requireMatch(
  'static remote MCP proof covers SSE headers',
  /connects legacy SSE MCP servers with configured headers/u.test(mcpClientTest)
    && /merges configured SSE headers/u.test(mcpClientTest),
  'MCP client tests must prove static headers are passed to SSE connect and fetch paths'
);

requireMatch(
  'static remote MCP proof covers redaction and auth diagnostics',
  /redacts remote MCP header values/u.test(mcpClientTest)
    && /classifies expired or rejected static header keys as authentication failures/u.test(mcpClientTest),
  'MCP client tests must prove static header secrets are redacted and auth failures are classified'
);

requireMatch(
  'storage proof covers remote MCP URL and headers',
  /persists remote MCP transport URL and headers separately from stdio command settings/u.test(storageTest),
  'storage tests must prove remote MCP URL/header persistence remains separate from stdio settings'
);

requireMatch(
  'registry proof covers header key views',
  /headerKeys/u.test(registryTest),
  'registry tests must prove renderer MCP views expose header keys rather than header values'
);

requireMatch(
  'provider harness certification script is available',
  /"certify:openai-compatible": "node scripts\/certify-openai-compatible-providers\.mjs"/u.test(packageJson)
    && /keyFile: process\.env\.VICODE_PROVIDER_KEY_FILE \|\| ''/u.test(certScript)
    && /Set --key-file <path>, VICODE_PROVIDER_KEY_FILE, or --allow-env-key/u.test(certScript)
    && /keyMaterialStoredInReport: false/u.test(certScript),
  'OpenAI-compatible certification must require an explicit operator key source and write a redacted report'
);

requireMatch(
  'normalized provider graduation audit remains available',
  /"audit:normalized-providers": "node scripts\/audit-normalized-provider-graduation\.mjs"/u.test(packageJson)
    && /OpenAI-compatible chat/u.test(normalizedDoc),
  'provider graduation must remain backed by the normalized audit and OpenAI-compatible validation notes'
);

requireMatch(
  'OAuth boundary is explicitly parked in docs',
  /interactive OAuth is intentionally not exposed as a claimed supported path yet/u.test(boundaryDoc)
    && /Current blocked boundary:[\s\S]*interactive OAuth authorization-code\/PKCE flow/u.test(boundaryDoc)
    && /OAuth must stay parked until/u.test(boundaryDoc),
  'MCP remote transport docs must state that OAuth is blocked until the proof gate is met'
);

if (findings.length > 0) {
  console.error(JSON.stringify({
    status: 'failed',
    findings
  }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({
  status: 'ok',
  checkedActiveMcpSurfaceFiles: activeMcpSurfaceFiles.length,
  providerHarnessGate: [
    'audit:normalized-providers',
    'certify:openai-compatible'
  ],
  staticMcpGate: [
    'src/main/services/mcp/client.test.ts',
    'src/main/services/mcp/registry.test.ts',
    'src/storage/database.test.ts'
  ],
  oauthState: 'parked'
}, null, 2));
