import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const [bridgeUrl, bridgeToken] = process.argv.slice(2);

if (!bridgeUrl || !bridgeToken) {
  console.error('Gemini runtime bridge requires a bridge URL and token.');
  process.exit(1);
}

const server = new McpServer({
  name: 'vicode-gemini-runtime-bridge',
  version: '0.0.0'
});

server.registerTool(
  'spawn_subagents',
  {
    description: 'Launch one or more bounded background explorer or verifier helpers inside the Vicode parent thread.',
    inputSchema: {
      tasks: z
        .array(
          z.object({
            name: z.string().optional(),
            title: z.string(),
            prompt: z.string(),
            delegation_profile: z.enum(['research', 'verify', 'heartbeat']).optional(),
            reasoning_effort: z.enum(['none', 'minimal', 'low', 'medium', 'high', 'xhigh']).optional()
          })
        )
        .min(1)
        .max(3)
    }
  },
  async (args) => {
    try {
      const response = await fetch(bridgeUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${bridgeToken}`
        },
        body: JSON.stringify({
          name: 'spawn_subagents',
          arguments: args
        })
      });

      const result = await response.json();
      return {
        content: [
          {
            type: 'text',
            text:
              typeof result?.content === 'string' && result.content.trim()
                ? result.content
                : 'Delegated helper request completed.'
          }
        ],
        isError: Boolean(result?.isError)
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: error instanceof Error && error.message ? error.message : 'Gemini runtime bridge failed.'
          }
        ],
        isError: true
      };
    }
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
