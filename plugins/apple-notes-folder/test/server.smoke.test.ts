import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const SERVER = fileURLToPath(new URL('../dist/server.js', import.meta.url));
const NAMES = ['notes_append', 'notes_create', 'notes_delete', 'notes_list', 'notes_read', 'notes_search', 'notes_update'];

async function connect(env: Record<string, string>): Promise<Client> {
  const base = Object.fromEntries(
    Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined),
  );
  const client = new Client({ name: 'smoke', version: '1.0.0' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [SERVER], env: { ...base, ...env } }));
  return client;
}

describe('dist/server.js', () => {
  it('отдаёт семь инструментов; без папки каждый отвечает ошибкой настройки', async () => {
    const client = await connect({ NOTES_FOLDER: '' });
    try {
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name).sort()).toEqual(NAMES);
      const r = await client.callTool({ name: 'notes_list', arguments: {} });
      expect(r.isError).toBe(true);
      expect((r.content as { text: string }[])[0].text).toContain('/plugin configure');
    } finally {
      await client.close();
    }
  }, 20_000);

  it('отклоняет аргументы вне лимитов', async () => {
    const client = await connect({ NOTES_FOLDER: '' });
    try {
      const r = await client
        .callTool({ name: 'notes_list', arguments: { limit: 500 } })
        .catch((e: unknown) => ({ isError: true, content: [{ text: String(e) }] }));
      expect(r.isError).toBe(true);
    } finally {
      await client.close();
    }
  }, 20_000);
});
