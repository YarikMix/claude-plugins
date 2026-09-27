import { build } from 'esbuild';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildOptions } from './build-options.mjs';

const out = await mkdtemp(join(tmpdir(), 'apple-notes-folder-build-'));
try {
  await build(buildOptions(out));
  const built = (await readdir(out)).sort();
  const committed = (await readdir('dist').catch(() => [])).sort();
  let ok = JSON.stringify(built) === JSON.stringify(committed);
  if (!ok) console.error(`Состав dist не совпадает: собрано [${built.join(', ')}], в dist [${committed.join(', ')}]`);
  for (const f of built) {
    const fresh = await readFile(join(out, f));
    const saved = await readFile(join('dist', f)).catch(() => null);
    if (!saved || !fresh.equals(saved)) {
      console.error(`dist/${f} не совпадает со сборкой из исходников`);
      ok = false;
    }
  }
  if (!ok) process.exit(1);
  console.log(`dist совпадает со сборкой из исходников: файлов ${built.length}`);
} finally {
  await rm(out, { recursive: true, force: true });
}
