import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, writeFile, symlink, rm, mkdir, truncate } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadImage, sniffImageMime, MAX_IMAGE_BYTES, defaultImageRoot } from '../src/images.js';

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
const JPEG = Buffer.from('ffd8ffe000104a464946', 'hex');
const GIF = Buffer.from('GIF89a\x01\x00\x01\x00', 'latin1');
const WEBP = Buffer.concat([Buffer.from('RIFF', 'latin1'), Buffer.alloc(4), Buffer.from('WEBPVP8 ', 'latin1')]);
const HEIC = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypheic', 'latin1'), Buffer.alloc(8)]);

let root: string;
let outside: string;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'anf-root-'));
  outside = await mkdtemp(join(tmpdir(), 'anf-out-'));
  await writeFile(join(root, 'a.png'), PNG);
  await writeFile(join(root, 'a.jpg'), JPEG);
  await writeFile(join(root, 'a.heic'), HEIC);
  await writeFile(join(root, 'fake.png'), 'просто текст');
  await writeFile(join(outside, 'b.png'), PNG);
  await symlink(join(outside, 'b.png'), join(root, 'link.png'));
  await mkdir(join(root, 'sub'));
  await symlink(outside, join(root, 'sub', 'dirlink'));
  await writeFile(join(root, 'big.png'), PNG);
  await truncate(join(root, 'big.png'), MAX_IMAGE_BYTES + 1);
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
  await rm(outside, { recursive: true, force: true });
});

describe('sniffImageMime', () => {
  it('узнаёт форматы по первым байтам', () => {
    expect(sniffImageMime(PNG)).toBe('image/png');
    expect(sniffImageMime(JPEG)).toBe('image/jpeg');
    expect(sniffImageMime(GIF)).toBe('image/gif');
    expect(sniffImageMime(WEBP)).toBe('image/webp');
    expect(sniffImageMime(HEIC)).toBe('image/heic');
    expect(sniffImageMime(Buffer.from('просто текст'))).toBeNull();
  });
});

describe('loadImage', () => {
  it('принимает настоящие PNG, JPEG и HEIC внутри корня', async () => {
    expect(await loadImage(join(root, 'a.png'), root)).toBe(`data:image/png;base64,${PNG.toString('base64')}`);
    expect(await loadImage(join(root, 'a.jpg'), root)).toMatch(/^data:image\/jpeg;base64,/);
    expect(await loadImage(join(root, 'a.heic'), root)).toMatch(/^data:image\/heic;base64,/);
  });

  it('отказывает файлу вне корня', async () => {
    await expect(loadImage(join(outside, 'b.png'), root)).rejects.toThrow(/должен лежать/);
  });

  it('отказывает символической ссылке', async () => {
    await expect(loadImage(join(root, 'link.png'), root)).rejects.toThrow(/символическая ссылка/);
  });

  it('отказывает файлу за ссылкой на каталог вне корня', async () => {
    await expect(loadImage(join(root, 'sub', 'dirlink', 'b.png'), root)).rejects.toThrow(/должен лежать/);
  });

  it('отказывает тексту с расширением .png', async () => {
    await expect(loadImage(join(root, 'fake.png'), root)).rejects.toThrow(/формат/);
  });

  it('отказывает файлу больше 10 МБ', async () => {
    await expect(loadImage(join(root, 'big.png'), root)).rejects.toThrow(/10 МБ/);
  });

  it('отказывает относительному пути и несуществующему файлу', async () => {
    await expect(loadImage('a.png', root)).rejects.toThrow(/абсолютный путь/);
    await expect(loadImage(join(root, 'nope.png'), root)).rejects.toThrow(/не найден/);
  });

  it('все отказы — ToolError с кодом IMAGE', async () => {
    await expect(loadImage(join(root, 'fake.png'), root)).rejects.toMatchObject({ code: 'IMAGE' });
  });

  it('корень по умолчанию — временная папка Claude Code текущего пользователя', () => {
    expect(defaultImageRoot()).toBe(`/private/tmp/claude-${process.getuid!()}`);
  });
});
