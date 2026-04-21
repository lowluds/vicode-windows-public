import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

const server = new McpServer({
  name: 'fixture-mcp-server',
  version: '1.0.0'
});

server.registerTool(
  'echo',
  {
    title: 'Echo Tool',
    description: 'Echoes text back to the client.',
    inputSchema: {
      text: z.string().optional()
    }
  },
  async ({ text }) => ({
    content: [
      {
        type: 'text',
        text: text ?? 'echo'
      }
    ]
  })
);

server.registerTool(
  'dashboard_snapshot',
  {
    title: 'Dashboard Snapshot',
    description: 'Returns deterministic deployment and alert data for dashboard integration tests.',
    inputSchema: {}
  },
  async () => ({
    content: [
      {
        type: 'text',
        text: JSON.stringify(
          {
            environment: 'Prod / Primary',
            pipelineHealth: '3 healthy / 1 degraded',
            deployments: [
              { name: 'canary-west-17', status: 'healthy', region: 'us-west-2' },
              { name: 'ledger-sync-eu', status: 'degraded', region: 'eu-central-1' }
            ],
            alerts: ['Queue backlog > 120s', 'CPU saturation / jobs-api']
          },
          null,
          2
        )
      }
    ]
  })
);

server.registerResource(
  'fixture-readme',
  'file:///fixture/readme',
  {
    title: 'Fixture Readme',
    description: 'Fixture resource for MCP registry tests.',
    mimeType: 'text/plain'
  },
  async (uri) => ({
    contents: [
      {
        uri: typeof uri === 'string' ? uri : 'file:///fixture/readme',
        text: 'fixture resource',
        mimeType: 'text/plain'
      }
    ]
  })
);

server.registerPrompt(
  'review',
  {
    title: 'Review Prompt',
    description: 'Prompt used for review flows.',
    argsSchema: {
      topic: z.string().optional()
    }
  },
  async ({ topic }) => ({
    messages: [
      {
        role: 'user',
        content: {
          type: 'text',
          text: `Review ${topic ?? 'code'}.`
        }
      }
    ]
  })
);

await server.connect(new StdioServerTransport());
