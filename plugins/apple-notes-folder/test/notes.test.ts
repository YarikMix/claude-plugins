import { describe, it, expect } from 'vitest';
import { readFile, stat } from 'node:fs/promises';
import { withHtmlFile } from '../src/notes.js';

describe('withHtmlFile', () => {
  it('файл с правами 0600 удаляется после вызова', async () => {
    let seen = '';
    await withHtmlFile('<div>x</div>', async (p) => {
      seen = p;
      expect((await stat(p)).mode & 0o777).toBe(0o600);
      expect(await readFile(p, 'utf8')).toBe('<div>x</div>');
    });
    await expect(stat(seen)).rejects.toThrow();
  });

  it('файл удаляется и при ошибке', async () => {
    let seen = '';
    await expect(
      withHtmlFile('y', async (p) => {
        seen = p;
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    await expect(stat(seen)).rejects.toThrow();
  });
});
