import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { toToolResult } from './errors.js';
import { imageSrc } from './images.js';
import { makeOsascriptRunner } from './runner.js';
import { configuredFolder, makeScopeProvider } from './scope.js';
import { makeTools } from './tools.js';

const run = makeOsascriptRunner();
const getScope = makeScopeProvider(configuredFolder(process.env), run);

const server = new McpServer({ name: 'apple-notes-folder', version: '1.0.0' });

for (const tool of makeTools({ getScope, run, imageSrc: (p) => imageSrc(p) })) {
  server.registerTool(
    tool.name,
    { description: tool.description, inputSchema: tool.shape, annotations: tool.annotations },
    async (args: unknown) => {
      try {
        return { content: [{ type: 'text' as const, text: await tool.handler(args) }] };
      } catch (e) {
        return toToolResult(e);
      }
    },
  );
}

// Папка ищется сразу при старте; неудача не роняет сервер — инструменты повторят попытку.
getScope().catch(() => {});

await server.connect(new StdioServerTransport());
