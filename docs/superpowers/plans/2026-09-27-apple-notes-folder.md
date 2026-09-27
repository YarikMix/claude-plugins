# Плагин `apple-notes-folder` — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** MCP-сервер Apple Notes в маркетплейсе `yarikmix-plugins`, который работает только с одной папкой, заданной пользователем, плюс хук против обхода через Bash.

**Architecture:** Node/TypeScript-сервер на официальном MCP SDK; доступ к Заметкам — постоянными JXA-скриптами через `osascript -l JavaScript` (данные только в `argv` и временном файле), каждый скрипт по id заметки начинается с проверки `container`. Markdown ↔ HTML через `marked`/`turndown`, картинки заметки заменяются заглушками `note-image:N`. Всё собирается `esbuild` в `dist/`, сборка коммитится и сверяется скриптом.

**Tech Stack:** Node ≥ 20, TypeScript, `@modelcontextprotocol/sdk`, `zod@3`, `marked`, `turndown`, `esbuild`, `vitest`.

**Spec:** `docs/superpowers/specs/2026-09-27-apple-notes-folder-design.md` — читать вместе с планом; при расхождении прав спека.

## Global Constraints

- Все команды — из каталога `plugins/apple-notes-folder/` рабочего дерева `/Users/y.mihalev/projects/tp-prepare/claude-plugins-apple-notes-folder`, если не сказано иное. Ветка `apple-notes-folder`.
- Имя плагина `apple-notes-folder`; ключ `userConfig` — `folder`; переменная окружения сервера — `NOTES_FOLDER`.
- Имена инструментов ровно: `notes_list`, `notes_search`, `notes_read`, `notes_create`, `notes_append`, `notes_update`, `notes_delete`.
- Runtime-зависимости только `@modelcontextprotocol/sdk`, `zod` (мажор 3), `marked`, `turndown`; версии точные (`--save-exact`). Dev: `typescript`, `esbuild`, `vitest`, `@types/node`, `@types/turndown`.
- Реестр npm только `https://registry.npmjs.org/` (файл `.npmrc` плагина). В `package-lock.json` не должно быть ни одного `resolved`, кроме `https://registry.npmjs.org/…`. Системный реестр npm на машине разработчика — корпоративный (`npm config get registry` в корне репозитория): его адрес в репозиторий попасть не должен.
- Сервер не делает сетевых запросов и ничего не скачивает во время работы.
- `dist/server.js` и `dist/hook.js` закоммичены; `npm run verify-build` проходит.
- Лимиты: `notes_list` `limit` 1–200 (по умолчанию 50), `offset` ≥ 0; `notes_search` `limit` 1–50 (по умолчанию 20); ответ `notes_read` не длиннее 200 000 символов (дальше обрезка с пометкой); картинка ≤ 10 МБ; таймаут `osascript` 30 с; `maxBuffer` 64 МБ.
- Картинки только из `/private/tmp/claude-<uid>/` (uid текущего пользователя) после `realpath`; сам путь не символическая ссылка; формат по первым байтам: PNG, JPEG, GIF, HEIC, WebP.
- Скрипты — постоянные строки в `src/scripts.ts`; данные никогда не подставляются в текст скрипта. Первый аргумент каждого скрипта с аргументами — id папки.
- Ошибки не содержат названий и текста заметок вне разрешённой папки.
- Тексты для пользователя и агента — на русском.
- В репозитории нет личных данных: имён реальных папок, содержимого заметок, путей конкретного пользователя (кроме шаблона `/private/tmp/claude-<uid>/`). Тестовые данные — выдуманные.
- Коммиты — в стиле репозитория: `feat(apple-notes-folder): …`, `test(…)`, `docs(…)`, на русском.

## Карта файлов

```
plugins/apple-notes-folder/
  .claude-plugin/plugin.json   # Task 8: userConfig, mcpServers
  hooks/hooks.json             # Task 8: PreToolUse → dist/hook.js
  .npmrc, .gitignore           # Task 1
  package.json, package-lock.json, tsconfig.json, vitest.config.ts   # Task 1
  src/errors.ts                # Task 1: ToolError, MESSAGES, toToolResult
  src/images.ts                # Task 2: проверка и загрузка картинок
  src/markdown.ts              # Task 3: HTML ↔ Markdown, заглушки картинок
  src/scripts.ts               # Task 4: постоянные JXA-скрипты
  src/runner.ts                # Task 4: запуск osascript, разбор ошибок
  src/scope.ts                 # Task 5: поиск папки
  src/notes.ts                 # Task 6: операции над заметками папки
  src/tools.ts                 # Task 6: инструменты и обработчики
  src/server.ts                # Task 7: MCP-сервер
  src/hook.ts                  # Task 7: хук на Bash
  scripts/build-options.mjs, scripts/build.mjs, scripts/verify-build.mjs   # Task 7
  scripts/live-check.mjs       # Task 9
  dist/server.js, dist/hook.js # Task 7–8 (сборка, коммитится)
  test/*.test.ts               # в каждой задаче
  README.md, LICENSE           # Task 8 (README дополняется в Task 9)
.claude-plugin/marketplace.json  # Task 8: запись плагина
README.md (корень)               # Task 8: строка в таблице плагинов
```

---

### Task 1: Каркас пакета и ошибки

**Files:**
- Create: `plugins/apple-notes-folder/.npmrc`, `.gitignore`, `package.json`, `tsconfig.json`, `vitest.config.ts`, `src/errors.ts`
- Test: `plugins/apple-notes-folder/test/errors.test.ts`

**Interfaces:**
- Produces:
  - `type ErrorCode = 'CONFIG' | 'OUTSIDE' | 'NOT_FOUND' | 'LOCKED' | 'PERMISSION' | 'TIMEOUT' | 'TIMEOUT_WRITE' | 'IMAGE' | 'IMAGE_REF' | 'OSA'`
  - `class ToolError extends Error { readonly code: ErrorCode; constructor(code: ErrorCode, message: string) }`
  - `const MESSAGES: { OUTSIDE, NOT_FOUND, LOCKED, PERMISSION, TIMEOUT, TIMEOUT_WRITE, FOLDER_GONE, IO }` — строки
  - `const CONFIGURE_HINT = '/plugin configure apple-notes-folder@yarikmix-plugins'`
  - `function toToolResult(e: unknown): { isError: true; content: [{ type: 'text'; text: string }] }`

- [ ] **Step 1: Создать каталог и служебные файлы**

```bash
mkdir -p /Users/y.mihalev/projects/tp-prepare/claude-plugins-apple-notes-folder/plugins/apple-notes-folder/{src,test,scripts}
cd /Users/y.mihalev/projects/tp-prepare/claude-plugins-apple-notes-folder/plugins/apple-notes-folder
printf 'registry=https://registry.npmjs.org/\n' > .npmrc
printf 'node_modules/\n' > .gitignore
```

`package.json`:

```json
{
  "name": "apple-notes-folder",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "description": "MCP-сервер Apple Notes, ограниченный одной папкой",
  "license": "MIT",
  "engines": { "node": ">=20" },
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  }
}
```

`tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022", "DOM"],
    "types": ["node"],
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "esModuleInterop": true
  },
  "include": ["src", "test"]
}
```

`vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['test/**/*.test.ts'] },
});
```

- [ ] **Step 2: Поставить зависимости из публичного реестра**

```bash
npm install --save-exact @modelcontextprotocol/sdk zod@3 marked turndown
npm install --save-exact --save-dev typescript esbuild vitest @types/node @types/turndown
grep -o '"resolved": "[^"]*"' package-lock.json | grep -vc 'https://registry.npmjs.org/' || true
```

Expected: последняя команда печатает `0`. Если печатает больше нуля или установка не может достучаться до `registry.npmjs.org` — остановиться и доложить (не переключаться на корпоративный реестр).

- [ ] **Step 3: Написать падающий тест**

`test/errors.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { ToolError, MESSAGES, toToolResult } from '../src/errors.js';

describe('toToolResult', () => {
  it('отдаёт текст ToolError как ошибку инструмента', () => {
    const r = toToolResult(new ToolError('OUTSIDE', MESSAGES.OUTSIDE));
    expect(r).toEqual({ isError: true, content: [{ type: 'text', text: MESSAGES.OUTSIDE }] });
  });

  it('помечает прочие исключения как внутреннюю ошибку', () => {
    const r = toToolResult(new Error('сломалось'));
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toBe('Внутренняя ошибка: сломалось');
  });

  it('хранит код ошибки', () => {
    expect(new ToolError('LOCKED', 'x').code).toBe('LOCKED');
  });
});
```

- [ ] **Step 4: Запустить тест и убедиться, что он падает**

Run: `npx vitest run test/errors.test.ts`
Expected: FAIL — не найден модуль `../src/errors.js`.

- [ ] **Step 5: Реализовать `src/errors.ts`**

```ts
export type ErrorCode =
  | 'CONFIG'
  | 'OUTSIDE'
  | 'NOT_FOUND'
  | 'LOCKED'
  | 'PERMISSION'
  | 'TIMEOUT'
  | 'TIMEOUT_WRITE'
  | 'IMAGE'
  | 'IMAGE_REF'
  | 'OSA';

export class ToolError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ToolError';
  }
}

export const CONFIGURE_HINT = '/plugin configure apple-notes-folder@yarikmix-plugins';

export const MESSAGES = {
  OUTSIDE: 'Заметка вне разрешённой папки.',
  NOT_FOUND: 'Заметка не найдена: неверный id или заметка удалена.',
  LOCKED: 'Заметка защищена паролем — сервер её не читает и не меняет.',
  PERMISSION:
    'Нет разрешения на управление Заметками. Выдайте его: Системные настройки → Конфиденциальность и безопасность → Автоматизация → ваш терминал → Заметки.',
  TIMEOUT: 'Заметки не ответили за 30 секунд.',
  TIMEOUT_WRITE:
    'Заметки не ответили за 30 секунд. Изменение могло примениться — перечитайте заметку перед повтором.',
  FOLDER_GONE: `Разрешённая папка больше не найдена в Заметках. Проверьте её имя (${CONFIGURE_HINT}) и перезапустите сессию.`,
  IO: 'Не удалось прочитать временный файл с текстом заметки.',
} as const;

export function toToolResult(e: unknown): { isError: true; content: [{ type: 'text'; text: string }] } {
  const text =
    e instanceof ToolError ? e.message : `Внутренняя ошибка: ${e instanceof Error ? e.message : String(e)}`;
  return { isError: true, content: [{ type: 'text', text }] };
}
```

- [ ] **Step 6: Запустить тесты и проверку типов**

Run: `npx vitest run test/errors.test.ts && npm run typecheck`
Expected: 3 теста PASS, `tsc` без ошибок.

- [ ] **Step 7: Commit**

```bash
git add .npmrc .gitignore package.json package-lock.json tsconfig.json vitest.config.ts src/errors.ts test/errors.test.ts
git commit -m "feat(apple-notes-folder): каркас пакета и ошибки инструментов"
```

---

### Task 2: Проверка и загрузка картинок

**Files:**
- Create: `plugins/apple-notes-folder/src/images.ts`
- Test: `plugins/apple-notes-folder/test/images.test.ts`

**Interfaces:**
- Consumes: `ToolError` из `src/errors.ts`.
- Produces:
  - `const MAX_IMAGE_BYTES = 10 * 1024 * 1024`
  - `function defaultImageRoot(): string` → `/private/tmp/claude-<uid>`
  - `function sniffImageMime(head: Buffer): string | null`
  - `function loadImage(path: string, root?: string): Promise<string>` → `data:<mime>;base64,<…>`; ошибки — `ToolError('IMAGE', …)`

- [ ] **Step 1: Написать падающий тест**

`test/images.test.ts`:

```ts
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
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Run: `npx vitest run test/images.test.ts`
Expected: FAIL — не найден модуль `../src/images.js`.

- [ ] **Step 3: Реализовать `src/images.ts`**

```ts
import { lstat, readFile, realpath } from 'node:fs/promises';
import { isAbsolute, sep } from 'node:path';
import { ToolError } from './errors.js';

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const HEIC_BRANDS = new Set(['heic', 'heix', 'heim', 'heis', 'hevc', 'hevx', 'mif1', 'msf1']);

/** Каталог, куда Claude Code кладёт вставленные в промпт картинки и scratchpad сессий. */
export function defaultImageRoot(): string {
  return `/private/tmp/claude-${process.getuid!()}`;
}

export function sniffImageMime(head: Buffer): string | null {
  if (head.length >= 8 && head.subarray(0, 8).equals(PNG_MAGIC)) return 'image/png';
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'image/jpeg';
  const ascii = head.subarray(0, 16).toString('latin1');
  if (ascii.startsWith('GIF87a') || ascii.startsWith('GIF89a')) return 'image/gif';
  if (ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WEBP') return 'image/webp';
  if (ascii.slice(4, 8) === 'ftyp' && HEIC_BRANDS.has(ascii.slice(8, 12))) return 'image/heic';
  return null;
}

/** Проверяет файл картинки и возвращает его как data:-URI для встраивания в HTML заметки. */
export async function loadImage(path: string, root: string = defaultImageRoot()): Promise<string> {
  const fail = (why: string) => new ToolError('IMAGE', `Картинка ${path} не принята: ${why}.`);
  if (!isAbsolute(path)) throw fail('нужен абсолютный путь');

  const st = await lstat(path).catch(() => null);
  if (!st) throw fail('файл не найден');
  if (st.isSymbolicLink()) throw fail('это символическая ссылка');
  if (!st.isFile()) throw fail('это не обычный файл');

  const realRoot = await realpath(root).catch(() => null);
  const real = await realpath(path);
  if (!realRoot || !real.startsWith(realRoot + sep)) throw fail(`файл должен лежать в ${root}`);

  if (st.size > MAX_IMAGE_BYTES) throw fail('файл больше 10 МБ');

  const data = await readFile(real);
  const mime = sniffImageMime(data);
  if (!mime) throw fail('формат не PNG, JPEG, GIF, HEIC или WebP');
  return `data:${mime};base64,${data.toString('base64')}`;
}
```

- [ ] **Step 4: Запустить тесты**

Run: `npx vitest run test/images.test.ts && npm run typecheck`
Expected: все тесты PASS (10), `tsc` без ошибок.

- [ ] **Step 5: Commit**

```bash
git add src/images.ts test/images.test.ts
git commit -m "feat(apple-notes-folder): проверка и загрузка картинок из временной папки Claude Code"
```

---

### Task 3: Markdown ↔ HTML и заглушки картинок

**Files:**
- Create: `plugins/apple-notes-folder/src/markdown.ts`
- Test: `plugins/apple-notes-folder/test/markdown.test.ts`

**Interfaces:**
- Consumes: `ToolError` из `src/errors.ts`.
- Produces:
  - `const MAX_MARKDOWN_CHARS = 200_000`
  - `function extractImages(html: string): { html: string; images: string[] }` — каждый `<img>` заменяется на `<img src="note-image:N" alt="картинка N">`, `images[N-1]` — исходный `src`
  - `function htmlToMarkdown(html: string): { markdown: string; images: string[] }`
  - `type ImageResolver = (href: string) => Promise<string>` — по `href` из Markdown возвращает `src` для `<img>`
  - `function makeResolver(existing: string[] | null, load: (path: string) => Promise<string>): ImageResolver` — `note-image:N` → `existing[N-1]` (иначе `ToolError('IMAGE_REF')`), любой другой `href` → `load(href)`
  - `function markdownToHtml(md: string, resolve: ImageResolver): Promise<string>`
  - `function titleHtml(title: string): string` → `<div><h1>…</h1></div>\n`
  - `function escapeHtml(s: string): string`

- [ ] **Step 1: Написать падающий тест**

`test/markdown.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  extractImages,
  htmlToMarkdown,
  markdownToHtml,
  makeResolver,
  titleHtml,
  MAX_MARKDOWN_CHARS,
} from '../src/markdown.js';

const noLoad = async (p: string): Promise<string> => {
  throw new Error(`load не должен вызываться: ${p}`);
};

const NOTE_HTML =
  '<div><h1>Заголовок</h1></div>' +
  '<div>Текст <b>жирный</b> и <i>курсив</i> <a href="https://example.com">ссылка</a></div>' +
  '<ul><li>один<ul><li>вложенный</li></ul></li><li>два</li></ul>' +
  '<div><strike>зачёркнуто</strike></div>' +
  '<pre><code>x &lt; y</code></pre>';

const WITH_IMAGES =
  '<div><h1>Т</h1></div><div>до</div>' +
  '<div><img src="data:image/png;base64,AAAA"></div><div>между</div>' +
  '<div><img src="data:image/png;base64,BBBB"></div>';

describe('htmlToMarkdown', () => {
  it('переводит оформление Заметок в Markdown', () => {
    const { markdown } = htmlToMarkdown(NOTE_HTML);
    expect(markdown).toMatch(/^# Заголовок/);
    expect(markdown).toContain('**жирный**');
    expect(markdown).toContain('*курсив*');
    expect(markdown).toContain('[ссылка](https://example.com)');
    expect(markdown).toMatch(/^-\s+один/m);
    expect(markdown).toMatch(/^\s{4}-\s+вложенный/m);
    expect(markdown).toContain('~~зачёркнуто~~');
    expect(markdown).toContain('x < y');
  });

  it('заменяет картинки заглушками и не отдаёт base64', () => {
    const { markdown, images } = htmlToMarkdown(WITH_IMAGES);
    expect(markdown).toContain('![картинка 1](note-image:1)');
    expect(markdown).toContain('![картинка 2](note-image:2)');
    expect(markdown).not.toContain('base64');
    expect(images).toEqual(['data:image/png;base64,AAAA', 'data:image/png;base64,BBBB']);
  });

  it('обрезает слишком длинный текст с пометкой', () => {
    const { markdown } = htmlToMarkdown(`<div>${'а'.repeat(MAX_MARKDOWN_CHARS + 50)}</div>`);
    expect(markdown.startsWith('а'.repeat(100))).toBe(true);
    expect(markdown).toMatch(/обрезано: заметка длиннее 200000 символов\]$/);
    expect(markdown.length).toBeLessThan(MAX_MARKDOWN_CHARS + 100);
  });
});

describe('extractImages', () => {
  it('понимает src в одинарных кавычках', () => {
    const { html, images } = extractImages("<img alt='x' src='data:image/gif;base64,R0'>");
    expect(images).toEqual(['data:image/gif;base64,R0']);
    expect(html).toBe('<img src="note-image:1" alt="картинка 1">');
  });
});

describe('markdownToHtml', () => {
  it('собирает разметку, которую принимают Заметки', async () => {
    const html = await markdownToHtml('# T\n\nabc **b** *i* [л](https://example.com)\n\n#### глубоко', noLoad);
    expect(html).toContain('<h1>T</h1>');
    expect(html).toContain('<div>abc <b>b</b> <i>i</i> <a href="https://example.com">л</a></div>');
    expect(html).toContain('<h3>глубоко</h3>');
  });

  it('списки и код', async () => {
    const html = await markdownToHtml('- один\n- два\n\n```\nx < y\n```', noLoad);
    expect(html).toContain('<ul>');
    expect(html).toContain('<li>один</li>');
    expect(html).toContain('<pre><code>');
    expect(html).toContain('x &lt; y');
  });

  it('сырой HTML показывается как текст', async () => {
    const html = await markdownToHtml('<script>alert(1)</script>\n\nа <b>x</b>', noLoad);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('&lt;b&gt;x&lt;/b&gt;');
  });

  it('новая картинка встраивается через load', async () => {
    const load = async (p: string) => (p === '/private/tmp/claude-1/x.png' ? 'data:image/png;base64,NEW' : 'bad');
    const html = await markdownToHtml('![](/private/tmp/claude-1/x.png)', makeResolver(null, load));
    expect(html).toContain('<img src="data:image/png;base64,NEW">');
  });

  it('update: оставленная заглушка возвращает картинку, убранная — удаляет', async () => {
    const { markdown, images } = htmlToMarkdown(WITH_IMAGES);
    const edited = markdown.replace('![картинка 1](note-image:1)', '');
    const html = await markdownToHtml(edited, makeResolver(images, noLoad));
    expect(html).toContain('<img src="data:image/png;base64,BBBB">');
    expect(html).not.toContain('AAAA');
  });

  it('заглушка без картинки — ошибка IMAGE_REF', async () => {
    await expect(markdownToHtml('![](note-image:3)', makeResolver(['data:x'], noLoad))).rejects.toMatchObject({
      code: 'IMAGE_REF',
    });
    await expect(markdownToHtml('![](note-image:1)', makeResolver(null, noLoad))).rejects.toMatchObject({
      code: 'IMAGE_REF',
    });
  });
});

describe('titleHtml', () => {
  it('экранирует заголовок', () => {
    expect(titleHtml('<a> & "b"')).toBe('<div><h1>&lt;a&gt; &amp; &quot;b&quot;</h1></div>\n');
  });
});
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Run: `npx vitest run test/markdown.test.ts`
Expected: FAIL — не найден модуль `../src/markdown.js`.

- [ ] **Step 3: Реализовать `src/markdown.ts`**

```ts
import TurndownService from 'turndown';
import { Marked, type Tokens } from 'marked';
import { ToolError } from './errors.js';

export const MAX_MARKDOWN_CHARS = 200_000;

const IMG_TAG = /<img\b[^>]*>/gi;
const SRC_ATTR = /\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)')/i;
const PLACEHOLDER = /^note-image:(\d+)$/;

export type ImageResolver = (href: string) => Promise<string>;

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Заменяет картинки тела заметки заглушками note-image:N; base64 остаётся только в images. */
export function extractImages(html: string): { html: string; images: string[] } {
  const images: string[] = [];
  const out = html.replace(IMG_TAG, (tag) => {
    const m = SRC_ATTR.exec(tag);
    images.push(m ? (m[1] ?? m[2]) : '');
    const n = images.length;
    return `<img src="note-image:${n}" alt="картинка ${n}">`;
  });
  return { html: out, images };
}

function makeTurndown(): TurndownService {
  const td = new TurndownService({
    headingStyle: 'atx',
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
    emDelimiter: '*',
  });
  td.addRule('strike', {
    filter: (node) => ['DEL', 'S', 'STRIKE'].includes(node.nodeName),
    replacement: (content) => `~~${content}~~`,
  });
  return td;
}

export function htmlToMarkdown(html: string): { markdown: string; images: string[] } {
  const { html: stripped, images } = extractImages(html);
  let markdown = makeTurndown().turndown(stripped).trim();
  if (markdown.length > MAX_MARKDOWN_CHARS) {
    markdown =
      markdown.slice(0, MAX_MARKDOWN_CHARS) +
      `\n\n[… обрезано: заметка длиннее ${MAX_MARKDOWN_CHARS} символов]`;
  }
  return { markdown, images };
}

export function makeResolver(existing: string[] | null, load: (path: string) => Promise<string>): ImageResolver {
  return async (href) => {
    const m = PLACEHOLDER.exec(href);
    if (!m) return load(href);
    const n = Number(m[1]);
    if (!existing || n < 1 || n > existing.length) {
      const has = existing ? ` (в заметке картинок: ${existing.length})` : '';
      throw new ToolError('IMAGE_REF', `Ссылка ${href} не соответствует ни одной картинке заметки${has}.`);
    }
    return existing[n - 1];
  };
}

export async function markdownToHtml(md: string, resolve: ImageResolver): Promise<string> {
  const marked = new Marked({ gfm: true });
  const tokens = marked.lexer(md);

  const hrefs: string[] = [];
  marked.walkTokens(tokens, (t) => {
    if (t.type === 'image') hrefs.push((t as Tokens.Image).href);
  });
  const srcs = new Map<string, string>();
  for (const href of hrefs) if (!srcs.has(href)) srcs.set(href, await resolve(href));

  marked.use({
    renderer: {
      html(token) {
        return escapeHtml(token.text);
      },
      image(token) {
        return `<img src="${srcs.get(token.href)}">`;
      },
      paragraph(token) {
        return `<div>${this.parser.parseInline(token.tokens)}</div>\n`;
      },
      heading(token) {
        const d = Math.min(token.depth, 3);
        return `<h${d}>${this.parser.parseInline(token.tokens)}</h${d}>\n`;
      },
      strong(token) {
        return `<b>${this.parser.parseInline(token.tokens)}</b>`;
      },
      em(token) {
        return `<i>${this.parser.parseInline(token.tokens)}</i>`;
      },
    },
  });
  return marked.parser(tokens);
}

export function titleHtml(title: string): string {
  return `<div><h1>${escapeHtml(title)}</h1></div>\n`;
}
```

Если установленная версия `marked` старше 13 (сигнатуры рендерера не принимают объект токена) — остановиться и доложить: план рассчитан на API с объектами токенов.

- [ ] **Step 4: Запустить тесты**

Run: `npx vitest run test/markdown.test.ts && npm run typecheck`
Expected: все 11 тестов PASS, `tsc` без ошибок. Если падает только проверка точного вида строки (например, отступ вложенного списка у `turndown` или перевод строки после `<li>` у `marked`), поправить ожидание под фактический вывод библиотеки, не ослабляя смысл проверки, и записать это в отчёт задачи.

- [ ] **Step 5: Commit**

```bash
git add src/markdown.ts test/markdown.test.ts
git commit -m "feat(apple-notes-folder): Markdown ↔ HTML и заглушки картинок"
```

---

### Task 4: JXA-скрипты и запуск `osascript`

**Files:**
- Create: `plugins/apple-notes-folder/src/scripts.ts`, `plugins/apple-notes-folder/src/runner.ts`
- Test: `plugins/apple-notes-folder/test/scripts.test.ts`, `plugins/apple-notes-folder/test/runner.test.ts`

**Interfaces:**
- Consumes: `ToolError`, `MESSAGES` из `src/errors.ts`.
- Produces:
  - `const SCRIPTS: Readonly<{ listFolders; listNotes; searchNotes; readNote; createNote; appendNote; updateNote; deleteNote }>` — строки. Аргументы (`argv`):
    - `listFolders` — без аргументов → JSON `[{ id, name, account }]`
    - `listNotes` — `[folderId]` → JSON `[{ id, name, modified }]` (`modified` — ISO-строка)
    - `searchNotes` — `[folderId, query]` → JSON `[{ id, name, modified }]`
    - `readNote` — `[folderId, noteId]` → JSON `{ id, name, modified, body }`
    - `createNote` — `[folderId, htmlPath]` → JSON `{ id }`
    - `appendNote`, `updateNote` — `[folderId, noteId, htmlPath]` → JSON `{ id }`
    - `deleteNote` — `[folderId, noteId]` → JSON `{ ok: true }`
  - `const ID_SCRIPTS: readonly string[]` — `readNote`, `appendNote`, `updateNote`, `deleteNote`
  - `const GUARD_CALL = 'guardNote(argv[0], argv[1])'`
  - `interface RunOptions { write: boolean }`
  - `type Runner = (script: string, args: string[], opts: RunOptions) => Promise<string>`
  - `const OSA_TIMEOUT_MS = 30_000`
  - `function mapOsaFailure(err: { killed?: boolean; signal?: string | null }, stderr: string, write: boolean): ToolError`
  - `function makeOsascriptRunner(exec?: ExecFn): Runner` — `ExecFn` совместим с `child_process.execFile`

Почему JXA: результат отдаётся `JSON.stringify` без ручного экранирования (спека, раздел «Граница папки»). Ошибки скрипта — `throw new Error('APN:<КОД>')`; `osascript` печатает их в stderr, `mapOsaFailure` превращает в `ToolError`.

- [ ] **Step 1: Написать падающие тесты**

`test/scripts.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { SCRIPTS, ID_SCRIPTS, GUARD_CALL } from '../src/scripts.js';

describe('SCRIPTS', () => {
  it('заморожены', () => {
    expect(Object.isFrozen(SCRIPTS)).toBe(true);
  });

  it('каждый скрипт по id заметки начинает работу с проверки папки', () => {
    expect(ID_SCRIPTS).toHaveLength(4);
    for (const s of ID_SCRIPTS) {
      const run = s.slice(s.indexOf('function run('));
      expect(run).toContain(GUARD_CALL);
      const guardAt = run.indexOf(GUARD_CALL);
      const firstNoteAccess = run.search(/\bn\./);
      expect(firstNoteAccess === -1 || firstNoteAccess > guardAt).toBe(true);
    }
  });

  it('список и поиск берут заметки только из папки по id', () => {
    for (const s of [SCRIPTS.listNotes, SCRIPTS.searchNotes]) {
      const run = s.slice(s.indexOf('function run('));
      expect(run).toContain('folderById(argv[0])');
      expect(run).not.toContain('app.notes');
    }
  });

  it('создание — только в папке по id', () => {
    expect(SCRIPTS.createNote).toContain('folderById(argv[0])');
    expect(SCRIPTS.createNote).toContain('f.notes.push(');
  });
});
```

`test/runner.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { mapOsaFailure, makeOsascriptRunner, OSA_TIMEOUT_MS } from '../src/runner.js';
import { MESSAGES } from '../src/errors.js';

describe('mapOsaFailure', () => {
  it('разбирает коды APN из stderr', () => {
    const stderr = 'execution error: Error: APN:OUTSIDE (-2700)';
    expect(mapOsaFailure({}, stderr, false)).toMatchObject({ code: 'OUTSIDE', message: MESSAGES.OUTSIDE });
    expect(mapOsaFailure({}, 'Error: APN:NOT_FOUND', false).code).toBe('NOT_FOUND');
    expect(mapOsaFailure({}, 'Error: APN:LOCKED', false).code).toBe('LOCKED');
    expect(mapOsaFailure({}, 'Error: APN:FOLDER_GONE', false).code).toBe('CONFIG');
    expect(mapOsaFailure({}, 'Error: APN:IO', true).code).toBe('OSA');
  });

  it('нет разрешения на автоматизацию', () => {
    const e = mapOsaFailure({}, 'execution error: Not authorized to send Apple events to Notes. (-1743)', false);
    expect(e.code).toBe('PERMISSION');
  });

  it('таймаут: у записи — предупреждение, что изменение могло примениться', () => {
    expect(mapOsaFailure({ killed: true, signal: 'SIGTERM' }, '', true)).toMatchObject({
      code: 'TIMEOUT_WRITE',
      message: MESSAGES.TIMEOUT_WRITE,
    });
    expect(mapOsaFailure({ killed: true }, '', false).code).toBe('TIMEOUT');
    expect(mapOsaFailure({}, 'execution error: AppleEvent timed out. (-1712)', true).code).toBe('TIMEOUT_WRITE');
  });

  it('прочее — OSA с текстом stderr', () => {
    const e = mapOsaFailure({}, 'что-то странное', false);
    expect(e.code).toBe('OSA');
    expect(e.message).toContain('что-то странное');
  });
});

describe('makeOsascriptRunner', () => {
  it('запускает osascript -l JavaScript без shell, с таймаутом и буфером', async () => {
    const seen: unknown[] = [];
    const exec = (file: string, args: string[], opts: object, cb: (e: null, out: string, err: string) => void) => {
      seen.push({ file, args, opts });
      cb(null, '{"ok":true}\n', '');
    };
    const run = makeOsascriptRunner(exec);
    expect(await run('SCRIPT', ['x-coredata://F', 'q'], { write: false })).toBe('{"ok":true}');
    expect(seen).toEqual([
      {
        file: 'osascript',
        args: ['-l', 'JavaScript', '-e', 'SCRIPT', 'x-coredata://F', 'q'],
        opts: { timeout: OSA_TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024 },
      },
    ]);
  });

  it('ошибка процесса превращается в ToolError', async () => {
    const exec = (_f: string, _a: string[], _o: object, cb: (e: Error, out: string, err: string) => void) =>
      cb(new Error('exit 1'), '', 'Error: APN:OUTSIDE');
    await expect(makeOsascriptRunner(exec)('S', [], { write: true })).rejects.toMatchObject({ code: 'OUTSIDE' });
  });
});
```

- [ ] **Step 2: Запустить тесты и убедиться, что они падают**

Run: `npx vitest run test/scripts.test.ts test/runner.test.ts`
Expected: FAIL — не найдены модули `../src/scripts.js`, `../src/runner.js`.

- [ ] **Step 3: Реализовать `src/scripts.ts`**

```ts
/**
 * Постоянные JXA-скрипты для osascript -l JavaScript.
 * Данные в текст скриптов не подставляются: всё приходит через argv функции run.
 * argv[0] у всех скриптов с аргументами — id разрешённой папки.
 */

const PRELUDE = `
ObjC.import('Foundation');
var app = Application('Notes');
function fail(code) { throw new Error('APN:' + code); }
function readFile(p) {
  var s = $.NSString.stringWithContentsOfFileEncodingError(p, $.NSUTF8StringEncoding, null);
  if (s.isNil()) fail('IO');
  return ObjC.unwrap(s);
}
function folderById(id) {
  var f = app.folders.byId(id);
  try { f.id(); } catch (e) { fail('FOLDER_GONE'); }
  return f;
}
function guardNote(folderId, noteId) {
  var n = app.notes.byId(noteId), cid;
  try { cid = n.container().id(); } catch (e) { fail('NOT_FOUND'); }
  if (cid !== folderId) fail('OUTSIDE');
  if (n.passwordProtected()) fail('LOCKED');
  return n;
}
function summaries(notes) {
  var ids = notes.id(), names = notes.name(), dates = notes.modificationDate(), out = [];
  for (var i = 0; i < ids.length; i++) out.push({ id: ids[i], name: names[i], modified: dates[i].toISOString() });
  return JSON.stringify(out);
}
`;

export const GUARD_CALL = 'guardNote(argv[0], argv[1])';

const listFolders =
  PRELUDE +
  `
function run() {
  var out = [];
  function walk(folders, account) {
    for (var i = 0; i < folders.length; i++) {
      out.push({ id: folders[i].id(), name: folders[i].name(), account: account });
      walk(folders[i].folders(), account);
    }
  }
  var accounts = app.accounts();
  for (var i = 0; i < accounts.length; i++) walk(accounts[i].folders(), accounts[i].name());
  return JSON.stringify(out);
}`;

const listNotes =
  PRELUDE +
  `
function run(argv) {
  var f = folderById(argv[0]);
  return summaries(f.notes);
}`;

const searchNotes =
  PRELUDE +
  `
function run(argv) {
  var f = folderById(argv[0]), q = argv[1];
  return summaries(f.notes.whose({ _or: [ { name: { _contains: q } }, { plaintext: { _contains: q } } ] }));
}`;

const readNote =
  PRELUDE +
  `
function run(argv) {
  var n = ${GUARD_CALL};
  return JSON.stringify({ id: n.id(), name: n.name(), modified: n.modificationDate().toISOString(), body: n.body() });
}`;

const createNote =
  PRELUDE +
  `
function run(argv) {
  var f = folderById(argv[0]);
  var n = app.Note({ body: readFile(argv[1]) });
  f.notes.push(n);
  return JSON.stringify({ id: n.id() });
}`;

const appendNote =
  PRELUDE +
  `
function run(argv) {
  var n = ${GUARD_CALL};
  n.body = n.body() + readFile(argv[2]);
  return JSON.stringify({ id: n.id() });
}`;

const updateNote =
  PRELUDE +
  `
function run(argv) {
  var n = ${GUARD_CALL};
  n.body = readFile(argv[2]);
  return JSON.stringify({ id: n.id() });
}`;

const deleteNote =
  PRELUDE +
  `
function run(argv) {
  var n = ${GUARD_CALL};
  app.delete(n);
  return JSON.stringify({ ok: true });
}`;

export const SCRIPTS = Object.freeze({
  listFolders,
  listNotes,
  searchNotes,
  readNote,
  createNote,
  appendNote,
  updateNote,
  deleteNote,
});

export const ID_SCRIPTS: readonly string[] = Object.freeze([readNote, appendNote, updateNote, deleteNote]);
```

`${GUARD_CALL}` — подстановка константы на этапе загрузки модуля, не пользовательских данных; скрипты остаются постоянными строками.

- [ ] **Step 4: Реализовать `src/runner.ts`**

```ts
import { execFile } from 'node:child_process';
import { MESSAGES, ToolError } from './errors.js';

export interface RunOptions {
  write: boolean;
}
export type Runner = (script: string, args: string[], opts: RunOptions) => Promise<string>;

export const OSA_TIMEOUT_MS = 30_000;
const MAX_BUFFER = 64 * 1024 * 1024;

type ExecCallback = (err: (Error & { killed?: boolean; signal?: string | null }) | null, stdout: string, stderr: string) => void;
export type ExecFn = (file: string, args: string[], opts: { timeout: number; maxBuffer: number }, cb: ExecCallback) => unknown;

export function mapOsaFailure(err: { killed?: boolean; signal?: string | null }, stderr: string, write: boolean): ToolError {
  const timeout = () => new ToolError(write ? 'TIMEOUT_WRITE' : 'TIMEOUT', write ? MESSAGES.TIMEOUT_WRITE : MESSAGES.TIMEOUT);
  if (err.killed || err.signal === 'SIGTERM') return timeout();

  const code = /APN:([A-Z_]+)/.exec(stderr)?.[1];
  switch (code) {
    case 'OUTSIDE':
      return new ToolError('OUTSIDE', MESSAGES.OUTSIDE);
    case 'NOT_FOUND':
      return new ToolError('NOT_FOUND', MESSAGES.NOT_FOUND);
    case 'LOCKED':
      return new ToolError('LOCKED', MESSAGES.LOCKED);
    case 'FOLDER_GONE':
      return new ToolError('CONFIG', MESSAGES.FOLDER_GONE);
    case 'IO':
      return new ToolError('OSA', MESSAGES.IO);
  }
  if (/-1743|not authori[sz]ed/i.test(stderr)) return new ToolError('PERMISSION', MESSAGES.PERMISSION);
  if (/-1712/.test(stderr)) return timeout();
  return new ToolError('OSA', `Ошибка Заметок: ${stderr.trim().slice(0, 500)}`);
}

/** Запускает постоянный JXA-скрипт; args уходят в argv функции run, не в текст скрипта. */
export function makeOsascriptRunner(exec: ExecFn = execFile as unknown as ExecFn): Runner {
  return (script, args, { write }) =>
    new Promise((resolve, reject) => {
      exec(
        'osascript',
        ['-l', 'JavaScript', '-e', script, ...args],
        { timeout: OSA_TIMEOUT_MS, maxBuffer: MAX_BUFFER },
        (err, stdout, stderr) => {
          if (err) reject(mapOsaFailure(err, String(stderr ?? ''), write));
          else resolve(String(stdout).trim());
        },
      );
    });
}
```

- [ ] **Step 5: Запустить тесты**

Run: `npx vitest run test/scripts.test.ts test/runner.test.ts && npm run typecheck`
Expected: 4 + 6 тестов PASS, `tsc` без ошибок.

- [ ] **Step 6: Commit**

```bash
git add src/scripts.ts src/runner.ts test/scripts.test.ts test/runner.test.ts
git commit -m "feat(apple-notes-folder): постоянные JXA-скрипты и запуск osascript"
```

---

### Task 5: Поиск разрешённой папки

**Files:**
- Create: `plugins/apple-notes-folder/src/scope.ts`
- Test: `plugins/apple-notes-folder/test/scope.test.ts`

**Interfaces:**
- Consumes: `SCRIPTS.listFolders` (`src/scripts.ts`), `Runner` (`src/runner.ts`), `ToolError`, `CONFIGURE_HINT` (`src/errors.ts`).
- Produces:
  - `interface Scope { folderId: string; folderName: string }`
  - `function configuredFolder(env: NodeJS.ProcessEnv): string | null` — `NOTES_FOLDER` без пробелов по краям; пусто или неподставленный `${…}` → `null`
  - `function resolveScope(name: string | null, run: Runner): Promise<Scope>` — ошибки `ToolError('CONFIG', …)`
  - `function makeScopeProvider(name: string | null, run: Runner): () => Promise<Scope>` — удачный результат запоминается, неудачный — повтор при следующем вызове

- [ ] **Step 1: Написать падающий тест**

`test/scope.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { configuredFolder, resolveScope, makeScopeProvider } from '../src/scope.js';
import { SCRIPTS } from '../src/scripts.js';
import type { Runner } from '../src/runner.js';

const folders = (list: { id: string; name: string; account: string }[]): Runner => async (script, args) => {
  expect(script).toBe(SCRIPTS.listFolders);
  expect(args).toEqual([]);
  return JSON.stringify(list);
};

describe('configuredFolder', () => {
  it('пустое и неподставленное значение — не задано', () => {
    expect(configuredFolder({})).toBeNull();
    expect(configuredFolder({ NOTES_FOLDER: '' })).toBeNull();
    expect(configuredFolder({ NOTES_FOLDER: '   ' })).toBeNull();
    expect(configuredFolder({ NOTES_FOLDER: '${user_config.folder}' })).toBeNull();
    expect(configuredFolder({ NOTES_FOLDER: ' Личное ' })).toBe('Личное');
  });
});

describe('resolveScope', () => {
  it('не задано — CONFIG без обращения к Заметкам', async () => {
    const run: Runner = async () => {
      throw new Error('не должен вызываться');
    };
    await expect(resolveScope(null, run)).rejects.toMatchObject({ code: 'CONFIG' });
    await expect(resolveScope(null, run)).rejects.toThrow(/\/plugin configure/);
  });

  it('ровно одна папка — её id', async () => {
    const run = folders([
      { id: 'F1', name: 'Личное', account: 'iCloud' },
      { id: 'F2', name: 'Работа', account: 'iCloud' },
    ]);
    expect(await resolveScope('Личное', run)).toEqual({ folderId: 'F1', folderName: 'Личное' });
  });

  it('повтор одной папки при обходе вложенных — не двусмысленность', async () => {
    const run = folders([
      { id: 'F1', name: 'Личное', account: 'iCloud' },
      { id: 'F1', name: 'Личное', account: 'iCloud' },
    ]);
    expect((await resolveScope('Личное', run)).folderId).toBe('F1');
  });

  it('не найдена', async () => {
    await expect(resolveScope('Нет такой', folders([]))).rejects.toThrow(/не найдена/);
  });

  it('несколько — перечисляет аккаунты', async () => {
    const run = folders([
      { id: 'F1', name: 'Личное', account: 'iCloud' },
      { id: 'F9', name: 'Личное', account: 'На Mac' },
    ]);
    await expect(resolveScope('Личное', run)).rejects.toThrow(/несколько \(2; аккаунты: iCloud, На Mac\)/);
  });

  it('имя сравнивается точно', async () => {
    await expect(resolveScope('личное', folders([{ id: 'F1', name: 'Личное', account: 'iCloud' }]))).rejects.toThrow(
      /не найдена/,
    );
  });
});

describe('makeScopeProvider', () => {
  it('запоминает успех и повторяет после неудачи', async () => {
    let calls = 0;
    const run: Runner = async () => {
      calls += 1;
      if (calls === 1) throw new Error('Заметки не ответили');
      return JSON.stringify([{ id: 'F1', name: 'Личное', account: 'iCloud' }]);
    };
    const get = makeScopeProvider('Личное', run);
    await expect(get()).rejects.toThrow('Заметки не ответили');
    expect((await get()).folderId).toBe('F1');
    expect((await get()).folderId).toBe('F1');
    expect(calls).toBe(2);
  });
});
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Run: `npx vitest run test/scope.test.ts`
Expected: FAIL — не найден модуль `../src/scope.js`.

- [ ] **Step 3: Реализовать `src/scope.ts`**

```ts
import { CONFIGURE_HINT, ToolError } from './errors.js';
import type { Runner } from './runner.js';
import { SCRIPTS } from './scripts.js';

export interface Scope {
  folderId: string;
  folderName: string;
}

interface FolderInfo {
  id: string;
  name: string;
  account: string;
}

export function configuredFolder(env: NodeJS.ProcessEnv): string | null {
  const v = env.NOTES_FOLDER?.trim();
  if (!v || v.startsWith('${')) return null;
  return v;
}

export async function resolveScope(name: string | null, run: Runner): Promise<Scope> {
  if (!name) throw new ToolError('CONFIG', `Не задана папка Заметок. Укажите её: ${CONFIGURE_HINT}.`);

  const byId = new Map<string, FolderInfo>();
  for (const f of JSON.parse(await run(SCRIPTS.listFolders, [], { write: false })) as FolderInfo[]) byId.set(f.id, f);
  const matches = [...byId.values()].filter((f) => f.name === name);

  if (matches.length === 0) {
    throw new ToolError('CONFIG', `Папка «${name}» не найдена в Заметках. Проверьте имя: ${CONFIGURE_HINT}.`);
  }
  if (matches.length > 1) {
    const accounts = [...new Set(matches.map((m) => m.account))].join(', ');
    throw new ToolError(
      'CONFIG',
      `Папок с именем «${name}» несколько (${matches.length}; аккаунты: ${accounts}). Переименуйте лишние или укажите другую папку: ${CONFIGURE_HINT}.`,
    );
  }
  return { folderId: matches[0].id, folderName: name };
}

export function makeScopeProvider(name: string | null, run: Runner): () => Promise<Scope> {
  let pending: Promise<Scope> | null = null;
  return () => {
    if (!pending) {
      const attempt = resolveScope(name, run);
      pending = attempt;
      attempt.catch(() => {
        if (pending === attempt) pending = null;
      });
    }
    return pending;
  };
}
```

- [ ] **Step 4: Запустить тесты**

Run: `npx vitest run test/scope.test.ts && npm run typecheck`
Expected: 8 тестов PASS, `tsc` без ошибок.

- [ ] **Step 5: Commit**

```bash
git add src/scope.ts test/scope.test.ts
git commit -m "feat(apple-notes-folder): поиск разрешённой папки по имени"
```

---

### Task 6: Операции над заметками и инструменты

**Files:**
- Create: `plugins/apple-notes-folder/src/notes.ts`, `plugins/apple-notes-folder/src/tools.ts`
- Test: `plugins/apple-notes-folder/test/notes.test.ts`, `plugins/apple-notes-folder/test/tools.test.ts`

**Interfaces:**
- Consumes: `SCRIPTS` (Task 4), `Runner` (Task 4), `Scope` (Task 5), `extractImages`, `htmlToMarkdown`, `makeResolver`, `markdownToHtml`, `titleHtml` (Task 3), `ToolError`, `MESSAGES` (Task 1).
- Produces:
  - `interface NoteSummary { id: string; name: string; modified: string }`, `interface NoteFull extends NoteSummary { body: string }`
  - `function withHtmlFile<T>(html: string, fn: (path: string) => Promise<T>): Promise<T>` — временный файл `0600` в `os.tmpdir()`, удаляется в любом исходе
  - `class NotesService { constructor(run: Runner, folderId: string); list(): Promise<NoteSummary[]>; search(q: string): Promise<NoteSummary[]>; read(id: string): Promise<NoteFull>; create(html: string): Promise<string>; append(id: string, html: string): Promise<void>; update(id: string, html: string): Promise<void>; delete(id: string): Promise<void> }` — `folderId` всегда первым аргументом скрипта; запись — `{ write: true }`
  - `interface ToolDeps { getScope: () => Promise<Scope>; run: Runner; loadImage: (path: string) => Promise<string> }`
  - `interface ToolDef { name: string; description: string; shape: z.ZodRawShape; annotations: { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean }; handler: (args: any) => Promise<string> }`
  - `function makeTools(deps: ToolDeps): ToolDef[]` — семь инструментов в порядке из Global Constraints; обработчик возвращает текст ответа или бросает (`ToolError` и прочее)

Ответы инструментов:
- `notes_list` → JSON `{ total, offset, notes: NoteSummary[] }`, `notes_search` → JSON `{ total, notes }` (оба — новые сверху)
- `notes_read` → Markdown заметки
- `notes_create` → JSON `{ id }`; `notes_append`, `notes_update` → JSON `{ id }`; `notes_delete` → JSON `{ id, deleted: true }`

- [ ] **Step 1: Написать падающие тесты**

`test/notes.test.ts`:

```ts
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
```

`test/tools.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { makeTools } from '../src/tools.js';
import { SCRIPTS } from '../src/scripts.js';
import { MESSAGES, ToolError } from '../src/errors.js';
import { titleHtml } from '../src/markdown.js';
import type { Runner } from '../src/runner.js';

interface FakeNote {
  name: string;
  body: string;
  folder: string;
  modified: string;
  locked?: boolean;
}

const WITH_IMAGES =
  '<div><h1>С картинками</h1></div><div>до</div>' +
  '<div><img src="data:image/png;base64,AAAA"></div><div>между</div>' +
  '<div><img src="data:image/png;base64,BBBB"></div>';

/** Подставной исполнитель: ведёт себя как скрипты из SCRIPTS над заметками в памяти. */
function fakeNotes(notes: Record<string, FakeNote>) {
  const known = Object.values(SCRIPTS);
  const calls: { script: string; args: string[]; write: boolean }[] = [];
  let seq = 0;
  const guard = (fid: string, nid: string) => {
    const n = notes[nid];
    if (!n) throw new ToolError('NOT_FOUND', MESSAGES.NOT_FOUND);
    if (n.folder !== fid) throw new ToolError('OUTSIDE', MESSAGES.OUTSIDE);
    if (n.locked) throw new ToolError('LOCKED', MESSAGES.LOCKED);
    return n;
  };
  const summaries = (entries: [string, FakeNote][]) =>
    JSON.stringify(entries.map(([id, n]) => ({ id, name: n.name, modified: n.modified })));

  const run: Runner = async (script, args, { write }) => {
    if (!known.includes(script)) throw new Error('скрипт собран динамически');
    calls.push({ script, args, write });
    const [fid, a1, a2] = args;
    switch (script) {
      case SCRIPTS.listNotes:
        return summaries(Object.entries(notes).filter(([, n]) => n.folder === fid));
      case SCRIPTS.searchNotes: {
        const q = a1.toLowerCase();
        return summaries(
          Object.entries(notes).filter(([, n]) => n.folder === fid && (n.name + n.body).toLowerCase().includes(q)),
        );
      }
      case SCRIPTS.readNote: {
        const n = guard(fid, a1);
        return JSON.stringify({ id: a1, name: n.name, modified: n.modified, body: n.body });
      }
      case SCRIPTS.createNote: {
        const id = `NEW${++seq}`;
        notes[id] = { name: 'new', body: await readFile(a1, 'utf8'), folder: fid, modified: '2026-09-27T00:00:00.000Z' };
        return JSON.stringify({ id });
      }
      case SCRIPTS.appendNote: {
        const n = guard(fid, a1);
        n.body += await readFile(a2, 'utf8');
        return JSON.stringify({ id: a1 });
      }
      case SCRIPTS.updateNote: {
        const n = guard(fid, a1);
        n.body = await readFile(a2, 'utf8');
        return JSON.stringify({ id: a1 });
      }
      case SCRIPTS.deleteNote:
        guard(fid, a1);
        delete notes[a1];
        return JSON.stringify({ ok: true });
    }
    throw new Error('неизвестный скрипт');
  };
  return { run, calls, notes };
}

function setup() {
  const fake = fakeNotes({
    N1: { name: 'Первая', body: '<div><h1>Первая</h1></div><div>про кота</div>', folder: 'F1', modified: '2026-09-01T00:00:00.000Z' },
    N2: { name: 'Вторая', body: '<div><h1>Вторая</h1></div><div>про собаку</div>', folder: 'F1', modified: '2026-09-02T00:00:00.000Z' },
    L1: { name: 'Под паролем', body: '<div>закрыто</div>', folder: 'F1', modified: '2026-09-04T00:00:00.000Z', locked: true },
    P1: { name: 'С картинками', body: WITH_IMAGES, folder: 'F1', modified: '2026-09-05T00:00:00.000Z' },
    X1: { name: 'Секретная', body: '<div><h1>Секретная</h1></div><div>про кота тоже</div>', folder: 'F2', modified: '2026-09-03T00:00:00.000Z' },
  });
  const loaded: string[] = [];
  const tools = makeTools({
    getScope: async () => ({ folderId: 'F1', folderName: 'Разрешённая' }),
    run: fake.run,
    loadImage: async (p) => {
      loaded.push(p);
      return 'data:image/png;base64,NEW';
    },
  });
  const tool = (name: string) => {
    const t = tools.find((x) => x.name === name);
    if (!t) throw new Error(`нет инструмента ${name}`);
    return t.handler;
  };
  return { ...fake, tools, tool, loaded };
}

describe('набор инструментов', () => {
  it('ровно семь инструментов с нужными именами', () => {
    expect(setup().tools.map((t) => t.name)).toEqual([
      'notes_list',
      'notes_search',
      'notes_read',
      'notes_create',
      'notes_append',
      'notes_update',
      'notes_delete',
    ]);
  });

  it('чтение помечено readOnly, удаление и замена — destructive', () => {
    const a = Object.fromEntries(setup().tools.map((t) => [t.name, t.annotations]));
    expect(a.notes_list.readOnlyHint && a.notes_search.readOnlyHint && a.notes_read.readOnlyHint).toBe(true);
    expect(a.notes_delete.destructiveHint && a.notes_update.destructiveHint).toBe(true);
  });
});

describe('чтение', () => {
  it('notes_list: только своя папка, новые сверху, постранично', async () => {
    const { tool } = setup();
    const r = JSON.parse(await tool('notes_list')({ limit: 2, offset: 1 }));
    expect(r.total).toBe(4);
    expect(r.offset).toBe(1);
    expect(r.notes.map((n: { id: string }) => n.id)).toEqual(['L1', 'N2']);
    const all = JSON.parse(await tool('notes_list')({ limit: 200, offset: 0 }));
    expect(all.notes.map((n: { id: string }) => n.id)).not.toContain('X1');
  });

  it('notes_search: не находит заметки чужой папки', async () => {
    const r = JSON.parse(await setup().tool('notes_search')({ query: 'КОТ', limit: 20 }));
    expect(r.total).toBe(1);
    expect(r.notes.map((n: { id: string }) => n.id)).toEqual(['N1']);
  });

  it('notes_read: Markdown с заголовком', async () => {
    const md = await setup().tool('notes_read')({ id: 'N1' });
    expect(md).toMatch(/^# Первая/);
    expect(md).toContain('про кота');
  });

  it('под паролем и несуществующая — разные ошибки', async () => {
    const { tool } = setup();
    await expect(tool('notes_read')({ id: 'L1' })).rejects.toMatchObject({ code: 'LOCKED' });
    await expect(tool('notes_read')({ id: 'NOPE' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('граница папки', () => {
  it('чтение, дописывание, замена и удаление чужой заметки — отказ без её названия', async () => {
    const { tool, notes } = setup();
    const before = notes.X1.body;
    const attempts = [
      tool('notes_read')({ id: 'X1' }),
      tool('notes_append')({ id: 'X1', markdown: 'взлом' }),
      tool('notes_update')({ id: 'X1', markdown: 'взлом' }),
      tool('notes_delete')({ id: 'X1' }),
    ];
    for (const p of attempts) {
      const err = await p.then(
        () => null,
        (e: unknown) => e,
      );
      expect(err).toMatchObject({ code: 'OUTSIDE' });
      expect((err as Error).message).not.toContain('Секретная');
    }
    expect(notes.X1?.body).toBe(before);
  });

  it('все вызовы — постоянные скрипты, id папки первым аргументом', async () => {
    const { tool, calls } = setup();
    await tool('notes_list')({ limit: 50, offset: 0 });
    await tool('notes_read')({ id: 'N1' });
    await tool('notes_append')({ id: 'N1', markdown: 'ещё' });
    expect(calls.length).toBe(3);
    for (const c of calls) expect(c.args[0]).toBe('F1');
  });

  it('ошибка настройки доходит до инструмента, Заметки не вызываются', async () => {
    const fake = fakeNotes({});
    const tools = makeTools({
      getScope: async () => {
        throw new ToolError('CONFIG', 'Не задана папка Заметок.');
      },
      run: fake.run,
      loadImage: async () => 'data:x',
    });
    await expect(tools[0].handler({ limit: 50, offset: 0 })).rejects.toMatchObject({ code: 'CONFIG' });
    expect(fake.calls.length).toBe(0);
  });
});

describe('запись', () => {
  it('notes_create: заголовок, текст и картинка из файла', async () => {
    const { tool, notes, loaded, calls } = setup();
    const { id } = JSON.parse(
      await tool('notes_create')({ title: 'Новая', markdown: 'текст\n\n![](/private/tmp/claude-1/a.png)' }),
    );
    expect(notes[id].folder).toBe('F1');
    expect(notes[id].body.startsWith(titleHtml('Новая'))).toBe(true);
    expect(notes[id].body).toContain('<img src="data:image/png;base64,NEW">');
    expect(loaded).toEqual(['/private/tmp/claude-1/a.png']);
    expect(calls.at(-1)?.write).toBe(true);
  });

  it('notes_create: заглушка note-image — ошибка до записи', async () => {
    const { tool, calls } = setup();
    await expect(tool('notes_create')({ title: 'Т', markdown: '![](note-image:1)' })).rejects.toMatchObject({
      code: 'IMAGE_REF',
    });
    expect(calls.filter((c) => c.script === SCRIPTS.createNote)).toHaveLength(0);
  });

  it('notes_append: старый текст не пересобирается', async () => {
    const { tool, notes } = setup();
    const before = notes.N1.body;
    await tool('notes_append')({ id: 'N1', markdown: '- ещё' });
    expect(notes.N1.body.startsWith(before)).toBe(true);
    expect(notes.N1.body).toContain('<li>ещё</li>');
  });

  it('notes_update: оставленная заглушка сохраняет картинку, убранная — удаляет', async () => {
    const { tool, notes } = setup();
    const md = await tool('notes_read')({ id: 'P1' });
    await tool('notes_update')({ id: 'P1', markdown: md.replace('![картинка 1](note-image:1)', '') });
    expect(notes.P1.body).toContain('data:image/png;base64,BBBB');
    expect(notes.P1.body).not.toContain('AAAA');
  });

  it('notes_update: неверная заглушка — ошибка до записи', async () => {
    const { tool, calls, notes } = setup();
    const before = notes.N1.body;
    await expect(tool('notes_update')({ id: 'N1', markdown: '![](note-image:5)' })).rejects.toMatchObject({
      code: 'IMAGE_REF',
    });
    expect(calls.filter((c) => c.script === SCRIPTS.updateNote)).toHaveLength(0);
    expect(notes.N1.body).toBe(before);
  });

  it('notes_delete: удаляет свою заметку', async () => {
    const { tool, notes } = setup();
    expect(JSON.parse(await tool('notes_delete')({ id: 'N1' }))).toEqual({ id: 'N1', deleted: true });
    expect(notes.N1).toBeUndefined();
  });

  it('чтение — без флага записи, изменения — с ним', async () => {
    const { tool, calls } = setup();
    await tool('notes_search')({ query: 'кот', limit: 20 });
    await tool('notes_delete')({ id: 'N2' });
    expect(calls.map((c) => c.write)).toEqual([false, true]);
  });
});
```

- [ ] **Step 2: Запустить тесты и убедиться, что они падают**

Run: `npx vitest run test/notes.test.ts test/tools.test.ts`
Expected: FAIL — не найдены модули `../src/notes.js`, `../src/tools.js`.

- [ ] **Step 3: Реализовать `src/notes.ts`**

```ts
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Runner } from './runner.js';
import { SCRIPTS } from './scripts.js';

export interface NoteSummary {
  id: string;
  name: string;
  modified: string;
}

export interface NoteFull extends NoteSummary {
  body: string;
}

/** HTML тела уходит в скрипт временным файлом, а не аргументом: так он не упирается в лимит argv. */
export async function withHtmlFile<T>(html: string, fn: (path: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'apple-notes-folder-'));
  const path = join(dir, 'body.html');
  try {
    await writeFile(path, html, { mode: 0o600 });
    return await fn(path);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export class NotesService {
  constructor(
    private readonly run: Runner,
    private readonly folderId: string,
  ) {}

  private async call<T>(script: string, args: string[], write: boolean): Promise<T> {
    return JSON.parse(await this.run(script, [this.folderId, ...args], { write })) as T;
  }

  list(): Promise<NoteSummary[]> {
    return this.call(SCRIPTS.listNotes, [], false);
  }

  search(query: string): Promise<NoteSummary[]> {
    return this.call(SCRIPTS.searchNotes, [query], false);
  }

  read(id: string): Promise<NoteFull> {
    return this.call(SCRIPTS.readNote, [id], false);
  }

  async create(html: string): Promise<string> {
    const r = await withHtmlFile(html, (p) => this.call<{ id: string }>(SCRIPTS.createNote, [p], true));
    return r.id;
  }

  async append(id: string, html: string): Promise<void> {
    await withHtmlFile(html, (p) => this.call(SCRIPTS.appendNote, [id, p], true));
  }

  async update(id: string, html: string): Promise<void> {
    await withHtmlFile(html, (p) => this.call(SCRIPTS.updateNote, [id, p], true));
  }

  async delete(id: string): Promise<void> {
    await this.call(SCRIPTS.deleteNote, [id], true);
  }
}
```

- [ ] **Step 4: Реализовать `src/tools.ts`**

```ts
import { z } from 'zod';
import { extractImages, htmlToMarkdown, makeResolver, markdownToHtml, titleHtml } from './markdown.js';
import { NotesService, type NoteSummary } from './notes.js';
import type { Runner } from './runner.js';
import type { Scope } from './scope.js';

export interface ToolDeps {
  getScope: () => Promise<Scope>;
  run: Runner;
  loadImage: (path: string) => Promise<string>;
}

export interface ToolDef {
  name: string;
  description: string;
  shape: z.ZodRawShape;
  annotations: { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean };
  handler: (args: any) => Promise<string>;
}

const SCOPE_NOTE = 'Работает только с одной разрешённой папкой Apple Notes; другие папки недоступны.';
const IMAGES_HELP =
  'Картинка: ![подпись](/абсолютный/путь) — только файлы из /private/tmp/claude-<uid>/ (картинки, вставленные в промпт Claude Code, и scratchpad сессии); PNG, JPEG, GIF, HEIC или WebP до 10 МБ. Путь с пробелами — в угловых скобках: ![](<путь>).';

const byModifiedDesc = (a: NoteSummary, b: NoteSummary) => b.modified.localeCompare(a.modified);
const json = (v: unknown) => JSON.stringify(v, null, 2);

export function makeTools(deps: ToolDeps): ToolDef[] {
  const service = async () => new NotesService(deps.run, (await deps.getScope()).folderId);
  const noteId = z.string().min(1).describe('id заметки из notes_list или notes_search');
  const newImages = () => makeResolver(null, deps.loadImage);

  return [
    {
      name: 'notes_list',
      description: `Заметки папки: id, заголовок, дата изменения; новые сверху. ${SCOPE_NOTE}`,
      shape: {
        limit: z.number().int().min(1).max(200).default(50),
        offset: z.number().int().min(0).default(0),
      },
      annotations: { readOnlyHint: true },
      handler: async ({ limit, offset }) => {
        const all = (await (await service()).list()).sort(byModifiedDesc);
        return json({ total: all.length, offset, notes: all.slice(offset, offset + limit) });
      },
    },
    {
      name: 'notes_search',
      description: `Поиск по заголовку и тексту заметок папки. ${SCOPE_NOTE}`,
      shape: {
        query: z.string().min(1),
        limit: z.number().int().min(1).max(50).default(20),
      },
      annotations: { readOnlyHint: true },
      handler: async ({ query, limit }) => {
        const hits = (await (await service()).search(query)).sort(byModifiedDesc);
        return json({ total: hits.length, notes: hits.slice(0, limit) });
      },
    },
    {
      name: 'notes_read',
      description: `Заметка целиком в Markdown; первая строка — заголовок. Картинки заметки показаны заглушками ![картинка N](note-image:N). ${SCOPE_NOTE}`,
      shape: { id: noteId },
      annotations: { readOnlyHint: true },
      handler: async ({ id }) => htmlToMarkdown((await (await service()).read(id)).body).markdown,
    },
    {
      name: 'notes_create',
      description: `Новая заметка в папке. title — заголовок, markdown — текст. ${IMAGES_HELP} ${SCOPE_NOTE}`,
      shape: { title: z.string().min(1), markdown: z.string() },
      annotations: {},
      handler: async ({ title, markdown }) => {
        const html = titleHtml(title) + (await markdownToHtml(markdown, newImages()));
        return json({ id: await (await service()).create(html) });
      },
    },
    {
      name: 'notes_append',
      description: `Дописать Markdown в конец заметки; существующий текст и картинки не меняются. ${IMAGES_HELP} ${SCOPE_NOTE}`,
      shape: { id: noteId, markdown: z.string().min(1) },
      annotations: {},
      handler: async ({ id, markdown }) => {
        const html = await markdownToHtml(markdown, newImages());
        await (await service()).append(id, html);
        return json({ id });
      },
    },
    {
      name: 'notes_update',
      description: `Заменить текст заметки целиком — в формате notes_read, с заголовком первой строкой. Заглушки ![…](note-image:N) возвращают исходные картинки на место; убранная заглушка удаляет картинку. ${IMAGES_HELP} ${SCOPE_NOTE}`,
      shape: { id: noteId, markdown: z.string().min(1) },
      annotations: { destructiveHint: true },
      handler: async ({ id, markdown }) => {
        const svc = await service();
        const { images } = extractImages((await svc.read(id)).body);
        const html = await markdownToHtml(markdown, makeResolver(images, deps.loadImage));
        await svc.update(id, html);
        return json({ id });
      },
    },
    {
      name: 'notes_delete',
      description: `Удалить заметку; она уходит в «Недавно удалённые». ${SCOPE_NOTE}`,
      shape: { id: noteId },
      annotations: { destructiveHint: true },
      handler: async ({ id }) => {
        await (await service()).delete(id);
        return json({ id, deleted: true });
      },
    },
  ];
}
```

- [ ] **Step 5: Запустить тесты**

Run: `npx vitest run && npm run typecheck`
Expected: все тесты пакета PASS (в этих двух файлах — 2 + 16), `tsc` без ошибок.

- [ ] **Step 6: Commit**

```bash
git add src/notes.ts src/tools.ts test/notes.test.ts test/tools.test.ts
git commit -m "feat(apple-notes-folder): операции над заметками папки и семь инструментов"
```

---

### Task 7: Хук, MCP-сервер и воспроизводимая сборка

**Files:**
- Create: `plugins/apple-notes-folder/src/hook.ts`, `src/server.ts`, `scripts/build-options.mjs`, `scripts/build.mjs`, `scripts/verify-build.mjs`, `dist/server.js`, `dist/hook.js` (сборкой)
- Modify: `plugins/apple-notes-folder/package.json` (scripts)
- Test: `plugins/apple-notes-folder/test/hook.test.ts`, `plugins/apple-notes-folder/test/server.smoke.test.ts`

**Interfaces:**
- Consumes: `makeTools` (Task 6), `makeOsascriptRunner` (Task 4), `configuredFolder`, `makeScopeProvider` (Task 5), `loadImage` (Task 2), `toToolResult` (Task 1).
- Produces:
  - `function shouldDeny(command: string): boolean`, `const DENY_REASON: string` (`src/hook.ts`)
  - `dist/server.js` — stdio MCP-сервер, читает `NOTES_FOLDER`
  - `dist/hook.js` — читает JSON вызова PreToolUse со stdin; для запрещённой команды печатает `{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":DENY_REASON}}`, иначе ничего; код выхода всегда 0
  - npm-скрипты `build`, `verify-build`, `pretest` (= `npm run build`)

- [ ] **Step 1: Написать падающий тест хука**

`test/hook.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { shouldDeny, DENY_REASON } from '../src/hook.js';

const DENY = [
  `osascript -e 'tell application "Notes" to get name of every note'`,
  `osascript -l JavaScript -e "Application('Notes').notes()"`,
  `sqlite3 ~/Library/Group\\ Containers/group.com.apple.notes/NoteStore.sqlite 'select 1'`,
  'echo x | OSASCRIPT - com.apple.Notes',
];
const ALLOW = [
  'git log --oneline',
  'grep Notes README.md',
  `osascript -e 'display dialog "hi"'`,
  'npm test',
  'sqlite3 app.db .tables',
];

describe('shouldDeny', () => {
  it.each(DENY)('отклоняет: %s', (c) => expect(shouldDeny(c)).toBe(true));
  it.each(ALLOW)('пропускает: %s', (c) => expect(shouldDeny(c)).toBe(false));
});

describe('dist/hook.js', () => {
  const HOOK = fileURLToPath(new URL('../dist/hook.js', import.meta.url));
  const run = (input: string) => spawnSync(process.execPath, [HOOK], { input, encoding: 'utf8' });

  it('печатает отказ для обхода через Bash', () => {
    const r = run(JSON.stringify({ tool_name: 'Bash', tool_input: { command: DENY[0] } }));
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual({
      hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: DENY_REASON },
    });
  });

  it('молчит для обычной команды и мусора на входе', () => {
    for (const input of [JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'ls' } }), 'не json', '']) {
      const r = run(input);
      expect(r.status).toBe(0);
      expect(r.stdout).toBe('');
    }
  });
});
```

- [ ] **Step 2: Написать падающий тест сервера**

`test/server.smoke.test.ts`:

```ts
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
```

С пустой `NOTES_FOLDER` сервер не обращается к Заметкам — тест безопасен на любой машине.

- [ ] **Step 3: Запустить тесты и убедиться, что они падают**

Run: `npx vitest run test/hook.test.ts test/server.smoke.test.ts`
Expected: FAIL — нет `../src/hook.js` и `dist/`.

- [ ] **Step 4: Реализовать `src/hook.ts`**

```ts
import { pathToFileURL } from 'node:url';

const SCRIPTING = /osascript|applescript|jxa|scriptingbridge/i;
const NOTES = /notes/i;
const SQLITE = /sqlite/i;
const NOTESTORE = /notestore/i;

export const DENY_REASON =
  'Прямой доступ к Apple Notes из Bash запрещён плагином apple-notes-folder. Работайте с заметками через инструменты notes_* — они ограничены разрешённой папкой.';

/** Очевидный обход сервера: скриптовый доступ к Заметкам или чтение их базы. Намеренный обход не ловится. */
export function shouldDeny(command: string): boolean {
  return (SCRIPTING.test(command) && NOTES.test(command)) || (SQLITE.test(command) && NOTESTORE.test(command));
}

async function main(): Promise<void> {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  let command = '';
  try {
    const call = JSON.parse(input);
    if (call?.tool_name === 'Bash') command = String(call?.tool_input?.command ?? '');
  } catch {
    return;
  }
  if (!shouldDeny(command)) return;
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: DENY_REASON },
    }),
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
```

- [ ] **Step 5: Реализовать `src/server.ts`**

```ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { toToolResult } from './errors.js';
import { loadImage } from './images.js';
import { makeOsascriptRunner } from './runner.js';
import { configuredFolder, makeScopeProvider } from './scope.js';
import { makeTools } from './tools.js';

const run = makeOsascriptRunner();
const getScope = makeScopeProvider(configuredFolder(process.env), run);

const server = new McpServer({ name: 'apple-notes-folder', version: '1.0.0' });

for (const tool of makeTools({ getScope, run, loadImage: (p) => loadImage(p) })) {
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
```

Если `tsc` не принимает вызов `registerTool` из-за вывода типов по широкому `z.ZodRawShape`, допустимо привести обработчик: `(async (args: unknown) => { … }) as never` — только в этом месте, с комментарием почему.

- [ ] **Step 6: Сборка**

`scripts/build-options.mjs`:

```js
/** Общие параметры esbuild для сборки и для её проверки. */
export function buildOptions(outdir) {
  return {
    entryPoints: { server: 'src/server.ts', hook: 'src/hook.ts' },
    outdir,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    // CJS-зависимости (turndown) внутри ESM-бандла зовут require.
    banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
    legalComments: 'eof',
    logLevel: 'warning',
  };
}
```

`scripts/build.mjs`:

```js
import { build } from 'esbuild';
import { buildOptions } from './build-options.mjs';

await build(buildOptions('dist'));
```

`scripts/verify-build.mjs`:

```js
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
```

В `package.json` заменить блок `scripts`:

```json
"scripts": {
  "build": "node scripts/build.mjs",
  "verify-build": "node scripts/verify-build.mjs",
  "pretest": "npm run build",
  "test": "vitest run",
  "typecheck": "tsc --noEmit"
}
```

- [ ] **Step 7: Собрать и прогнать всё**

Run: `npm test && npm run typecheck && npm run verify-build`
Expected: все тесты PASS (в двух новых файлах — 11 + 2), `tsc` без ошибок, `dist совпадает со сборкой из исходников: файлов 2`.

- [ ] **Step 8: Проверить, что сборка воспроизводима и без сетевых модулей**

```bash
before="$(shasum dist/*.js)" && npm run build && [ "$before" = "$(shasum dist/*.js)" ] && echo same
grep -cE "from ['\"](node:)?(https?|net|tls|dgram|dns)['\"]|require\(['\"](node:)?(https?|net|tls|dgram|dns)['\"]\)" dist/server.js dist/hook.js
```

Expected: `same`; обе строки второй команды — `:0`. Если сетевой модуль найден — остановиться и доложить, из какой зависимости он пришёл (`grep -n` по строке в `dist/server.js`, ближайший комментарий `// node_modules/...` выше).

- [ ] **Step 9: Commit**

```bash
git add package.json src/hook.ts src/server.ts scripts/build-options.mjs scripts/build.mjs scripts/verify-build.mjs dist/server.js dist/hook.js test/hook.test.ts test/server.smoke.test.ts
git commit -m "feat(apple-notes-folder): MCP-сервер, хук на Bash и проверяемая сборка"
```

---

### Task 8: Упаковка плагина и маркетплейс

**Files:**
- Create: `plugins/apple-notes-folder/.claude-plugin/plugin.json`, `plugins/apple-notes-folder/hooks/hooks.json`, `plugins/apple-notes-folder/README.md`, `plugins/apple-notes-folder/LICENSE`
- Modify: `.claude-plugin/marketplace.json` (корень репозитория), `README.md` (корень, таблица плагинов)

**Interfaces:**
- Consumes: `dist/server.js`, `dist/hook.js` (Task 7).
- Produces: плагин `apple-notes-folder@yarikmix-plugins`, проходящий `claude plugin validate`.

В отличие от `selectel-ops` (запись в маркетплейсе с `strict: false`, без своего манифеста), у этого плагина свой `plugin.json`: в нём `userConfig` и `mcpServers`. Хуки Claude Code подхватывает сам из `hooks/hooks.json` — **не** указывать этот путь в `plugin.json` (стандартный путь, указанный явно, даёт ошибку дублирования хуков).

- [ ] **Step 1: Манифест и хуки**

`.claude-plugin/plugin.json`:

```json
{
  "name": "apple-notes-folder",
  "version": "1.0.0",
  "description": "MCP-сервер Apple Notes, ограниченный одной папкой: чтение, поиск, создание, правка, удаление, картинки",
  "author": { "name": "Yaroslav Mihalev" },
  "license": "MIT",
  "userConfig": {
    "folder": {
      "type": "string",
      "title": "Папка Заметок",
      "description": "Имя единственной папки Apple Notes, с которой может работать агент",
      "required": true
    }
  },
  "mcpServers": {
    "apple-notes-folder": {
      "command": "node",
      "args": ["${CLAUDE_PLUGIN_ROOT}/dist/server.js"],
      "env": { "NOTES_FOLDER": "${user_config.folder}" }
    }
  }
}
```

`hooks/hooks.json`:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [{ "type": "command", "command": "node \"${CLAUDE_PLUGIN_ROOT}/dist/hook.js\"" }]
      }
    ]
  }
}
```

`LICENSE`: `cp ../selectel-ops/LICENSE LICENSE` (MIT, тот же автор и год).

- [ ] **Step 2: Запись в маркетплейсе**

В `.claude-plugin/marketplace.json` (корень репозитория) в массив `plugins` после записи `selectel-ops` добавить:

```json
{
  "name": "apple-notes-folder",
  "description": "MCP-сервер Apple Notes, ограниченный одной папкой: чтение, поиск, создание, правка, удаление, картинки",
  "version": "1.0.0",
  "author": {
    "name": "Yaroslav Mihalev"
  },
  "source": "./plugins/apple-notes-folder",
  "category": "productivity"
}
```

В корневом `README.md` в таблицу плагинов после строки `selectel-ops` добавить:

```markdown
| [apple-notes-folder](plugins/apple-notes-folder/README.md) | MCP-сервер Apple Notes в границах одной папки: чтение, поиск, правка, картинки | `/plugin install apple-notes-folder@yarikmix-plugins` |
```

- [ ] **Step 3: README плагина**

`plugins/apple-notes-folder/README.md`:

````markdown
# apple-notes-folder

MCP-сервер Apple Notes для Claude Code, который работает **только с одной папкой** — той, что вы укажете при
включении плагина. Агент может читать, искать, создавать, дописывать, править и удалять заметки этой папки
и вставлять в них картинки, вставленные в поле ввода Claude Code. Другие папки ему недоступны: ни один
инструмент не выходит за границу папки.

## Требования

- macOS с приложением «Заметки».
- Node.js 20 или новее, доступный в `PATH` как `node`.

## Установка

```text
/plugin marketplace add YarikMix/claude-plugins
/plugin install apple-notes-folder@yarikmix-plugins
```

Claude Code спросит имя папки — точно как в боковой панели Заметок. Сменить позже:
`/plugin configure apple-notes-folder@yarikmix-plugins`.

При первом обращении macOS спросит, можно ли вашему терминалу (iTerm, Terminal…) управлять «Заметками».
Нужно разрешить. Полный доступ к диску не нужен.

## Инструменты

| Инструмент | Что делает |
|---|---|
| `notes_list` | заметки папки: id, заголовок, дата изменения; новые сверху; `limit` до 200, `offset` |
| `notes_search` | поиск по заголовку и тексту внутри папки |
| `notes_read` | заметка целиком в Markdown; картинки — заглушками `![картинка N](note-image:N)` |
| `notes_create` | новая заметка: заголовок и текст в Markdown |
| `notes_append` | дописать Markdown в конец; старый текст и картинки не меняются |
| `notes_update` | заменить текст целиком; заглушки `note-image:N` возвращают картинки на место, убранная заглушка удаляет картинку |
| `notes_delete` | удалить; заметка уходит в «Недавно удалённые» |

## Картинки

В Markdown: `![подпись](/абсолютный/путь)`. Принимаются только файлы из `/private/tmp/claude-<uid>/` — туда
Claude Code кладёт картинки, вставленные в промпт, и scratchpad сессии. Формат проверяется по содержимому
(PNG, JPEG, GIF, HEIC, WebP), размер — до 10 МБ, символические ссылки не принимаются. Скриншот с рабочего
стола сначала вставьте в промпт.

<!-- Итоги живой проверки (способ встраивания картинок, время на большой папке) дописываются сюда в Task 9. -->

## Границы и что сервер не защищает

- Папка ищется по имени при старте, дальше сервер работает с ней по id. Если папок с таким именем несколько
  (например, в разных аккаунтах) или ни одной — инструменты отвечают ошибкой настройки.
- Каждое действие с заметкой по id сначала проверяет, что заметка лежит в разрешённой папке. Подпапки в
  границу не входят. Заметки под паролем не читаются и не меняются.
- Данные не подставляются в текст скриптов: всё передаётся аргументами и временным файлом.
- Сервер не делает сетевых запросов.
- **Разрешение macOS выдаётся терминалу целиком.** Любая программа из этого терминала может управлять
  Заметками в обход сервера. Плагин ставит хук, который отклоняет Bash-команды с `osascript`/AppleScript/JXA
  и упоминанием Заметок, а также `sqlite3` с базой `NoteStore`. Скрипт в отдельном файле, зашифрованную
  строку или запуск через другой язык хук не поймает — это защита от случайного обхода, не от намеренного.
- Удаление и замену текста лучше не добавлять в автоматически разрешённые инструменты.

## Проверка сборки

`dist/` закоммичен, чтобы плагин работал без установки зависимостей. Чтобы убедиться, что он собран ровно
из исходников и `package-lock.json`:

```bash
cd plugins/apple-notes-folder
npm ci && npm run verify-build
```

## Разработка

```bash
npm ci
npm test            # сборка + автотесты
npm run typecheck
npm run live-check  # ручная проверка на живых Заметках, см. scripts/live-check.mjs
```
````

- [ ] **Step 4: Проверить плагин и маркетплейс**

Run (из корня репозитория): `claude plugin validate plugins/apple-notes-folder && claude plugin validate .`
Expected: обе проверки без ошибок. Если `validate` ругается на поле манифеста — исправить по тексту ошибки, не меняя смысла (ключ `folder`, `required: true`, переменная `NOTES_FOLDER`).

Run (из каталога плагина): `npm test`
Expected: все тесты PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/y.mihalev/projects/tp-prepare/claude-plugins-apple-notes-folder
git add plugins/apple-notes-folder/.claude-plugin/plugin.json plugins/apple-notes-folder/hooks/hooks.json plugins/apple-notes-folder/README.md plugins/apple-notes-folder/LICENSE .claude-plugin/marketplace.json README.md
git commit -m "feat(apple-notes-folder): манифест плагина, хук и запись в маркетплейсе"
```

---

### Task 9: Живая проверка на Заметках

**Files:**
- Create: `plugins/apple-notes-folder/scripts/live-check.mjs`
- Modify: `plugins/apple-notes-folder/package.json` (скрипт `live-check`), `plugins/apple-notes-folder/README.md` (итоги проверки)

**Interfaces:**
- Consumes: `dist/server.js` (Task 7) — через MCP-клиент SDK, как его запускает Claude Code.
- Produces: отчёт в stdout (строки `OK`/`FAIL`, итог «Проверок: N, не прошло: M»), код выхода 0 только если всё прошло; раздел README «Итоги живой проверки».

Пользователь согласился на тестовые папки в iCloud (спека, «Живая проверка»). Скрипт трогает только папки `anf-live-*-<суффикс>`, созданные им самим, и удаляет их в `finally`. Большая реальная папка — только если задана `LIVE_BIG_FOLDER`, и только чтение (`notes_list`, `notes_search`).

- [ ] **Step 1: Написать `scripts/live-check.mjs`**

```js
/**
 * Ручная проверка на живых Заметках (спека, раздел «Живая проверка»).
 * Создаёт тестовые папки в аккаунте по умолчанию, гоняет dist/server.js через MCP-клиент и удаляет папки.
 * Реальные папки не меняет. LIVE_BIG_FOLDER (необязательно) — имя большой папки для замера времени, только чтение;
 * LIVE_BIG_QUERY — запрос для замера поиска (по умолчанию «а»).
 */
import { execFile } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const exec = promisify(execFile);
const jxa = async (script, ...args) =>
  (await exec('osascript', ['-l', 'JavaScript', '-e', script, ...args], { timeout: 60_000, maxBuffer: 64 << 20 })).stdout.trim();

const SUFFIX = Date.now().toString(36);
const ALLOWED = `anf-live-allowed-${SUFFIX}`;
const FOREIGN = `anf-live-foreign-${SUFFIX}`;
const SUB = `anf-live-sub-${SUFFIX}`;
const SECRET = `anfsecret${SUFFIX}`;
const SERVER = fileURLToPath(new URL('../dist/server.js', import.meta.url));
const IMG_DIR = `/private/tmp/claude-${process.getuid()}/apple-notes-folder-live-${SUFFIX}`;
// Настоящий PNG 1×1.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

const SETUP = `function run(argv) {
  var app = Application('Notes'), acc = app.defaultAccount();
  function mk(parent, name) { parent.folders.push(app.Folder({ name: name })); return parent.folders.byName(name); }
  var allowed = mk(acc, argv[0]), foreign = mk(acc, argv[1]), sub = mk(allowed, argv[2]);
  foreign.notes.push(app.Note({ body: '<div><h1>Чужая</h1></div><div>' + argv[3] + '</div>' }));
  sub.notes.push(app.Note({ body: '<div><h1>Во вложенной</h1></div><div>' + argv[3] + '</div>' }));
  return JSON.stringify({ foreignNote: foreign.notes[0].id(), subNote: sub.notes[0].id() });
}`;
const NOTE_CONTAINER = `function run(argv) {
  try { return Application('Notes').notes.byId(argv[0]).container().name(); } catch (e) { return 'нет'; }
}`;
const CLEANUP = `function run(argv) {
  var app = Application('Notes'), acc = app.defaultAccount(), done = [];
  for (var i = 0; i < argv.length; i++) { try { app.delete(acc.folders.byName(argv[i])); done.push(argv[i]); } catch (e) {} }
  return JSON.stringify(done);
}`;

const results = [];
function check(label, ok, detail = '') {
  results.push({ label, ok });
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
}

const clients = [];
async function connect(folder) {
  const client = new Client({ name: 'live-check', version: '1.0.0' });
  await client.connect(
    new StdioClientTransport({ command: process.execPath, args: [SERVER], env: { ...process.env, NOTES_FOLDER: folder } }),
  );
  clients.push(client);
  return client;
}
async function call(client, name, args) {
  const r = await client.callTool({ name, arguments: args });
  return { isError: Boolean(r.isError), text: r.content?.[0]?.text ?? '' };
}

try {
  await mkdir(IMG_DIR, { recursive: true });
  const png = `${IMG_DIR}/pixel.png`;
  await writeFile(png, PNG);
  const ids = JSON.parse(await jxa(SETUP, ALLOWED, FOREIGN, SUB, SECRET));
  const c = await connect(ALLOWED);

  // 1. Создание: заголовок и встраивание картинки — решения из раздела спеки «Запись».
  const created = await call(c, 'notes_create', { title: 'Проверка связи', markdown: `Текст **жирный**\n\n![](${png})` });
  check('notes_create', !created.isError, created.text);
  const id = JSON.parse(created.text).id;
  const mine = JSON.parse((await call(c, 'notes_list', {})).text).notes.find((n) => n.id === id);
  check('заголовок заметки совпал с title', mine?.name === 'Проверка связи', `name=${JSON.stringify(mine?.name)}`);
  let md = (await call(c, 'notes_read', { id })).text;
  console.log(`--- notes_read после создания ---\n${md.slice(0, 500)}\n---`);
  check('оформление сохранилось', md.includes('**жирный**'));
  check('картинка встроена в текст (note-image:1)', md.includes('note-image:1'));

  // 2. Дописывание.
  await call(c, 'notes_append', { id, markdown: '- пункт добавлен' });
  md = (await call(c, 'notes_read', { id })).text;
  check('append дописал текст', md.includes('пункт добавлен'));
  check('append сохранил картинку', md.includes('note-image:1'));

  // 3. Замена с заглушкой.
  const upd = await call(c, 'notes_update', { id, markdown: md.replace('**жирный**', '**изменён**') });
  check('notes_update', !upd.isError, upd.text);
  md = (await call(c, 'notes_read', { id })).text;
  check('update заменил текст', md.includes('**изменён**'));
  check('update сохранил картинку по заглушке', md.includes('note-image:1'));

  // 4. Поиск.
  const s1 = JSON.parse((await call(c, 'notes_search', { query: 'ИЗМЕНЁН' })).text);
  check('поиск без учёта регистра, кириллица', s1.total >= 1, `total=${s1.total}`);
  const s2 = JSON.parse((await call(c, 'notes_search', { query: SECRET })).text);
  check('поиск не видит чужую и вложенную папки', s2.total === 0, `total=${s2.total}`);

  // 5. Замена без заглушки удаляет картинку.
  await call(c, 'notes_update', { id, markdown: md.replace(/!\[[^\]]*\]\(note-image:1\)/, '') });
  md = (await call(c, 'notes_read', { id })).text;
  check('убранная заглушка удалила картинку', !md.includes('note-image:'));

  // 6. Список — только своя заметка (вложенная папка не входит).
  const list = JSON.parse((await call(c, 'notes_list', { limit: 200 })).text);
  check('список: только своя заметка', list.total === 1 && list.notes[0]?.id === id, `total=${list.total}`);

  // 7. Чужая и вложенная папки — отказ без названия заметки.
  for (const [label, nid] of [
    ['чужая папка', ids.foreignNote],
    ['вложенная папка', ids.subNote],
  ]) {
    for (const [tool, extra] of [
      ['notes_read', {}],
      ['notes_append', { markdown: 'взлом' }],
      ['notes_update', { markdown: 'взлом' }],
      ['notes_delete', {}],
    ]) {
      const r = await call(c, tool, { id: nid, ...extra });
      const clean = !r.text.includes('Чужая') && !r.text.includes('Во вложенной');
      check(`${label}: ${tool} → отказ`, r.isError && r.text.includes('вне разрешённой папки') && clean, r.text);
    }
  }
  const where = await jxa(NOTE_CONTAINER, ids.foreignNote);
  check('чужая заметка на месте после попыток', where === FOREIGN, `container=${where}`);

  // 8. Удаление своей.
  const del = await call(c, 'notes_delete', { id });
  check('notes_delete', !del.isError, del.text);
  const gone = await call(c, 'notes_read', { id });
  check('удалённая заметка недоступна', gone.isError, gone.text);

  // 9. Ошибки настройки.
  const e1 = await call(await connect(''), 'notes_list', {});
  check('папка не задана → ошибка настройки', e1.isError && e1.text.includes('/plugin configure'), e1.text);
  const e2 = await call(await connect(`anf-missing-${SUFFIX}`), 'notes_list', {});
  check('папка не существует → «не найдена»', e2.isError && e2.text.includes('не найдена'), e2.text);

  // 10. Время на большой папке — только чтение.
  if (process.env.LIVE_BIG_FOLDER) {
    const big = await connect(process.env.LIVE_BIG_FOLDER);
    let t = Date.now();
    const l = await call(big, 'notes_list', { limit: 50 });
    const tl = Date.now() - t;
    t = Date.now();
    const s = await call(big, 'notes_search', { query: process.env.LIVE_BIG_QUERY ?? 'а' });
    const ts = Date.now() - t;
    const total = (r) => (r.isError ? r.text : JSON.parse(r.text).total);
    console.log(`Большая папка: notes_list ${tl} мс (total=${total(l)}), notes_search ${ts} мс (total=${total(s)})`);
  }
} finally {
  for (const client of clients) await client.close().catch(() => {});
  const removed = await jxa(CLEANUP, ALLOWED, FOREIGN).catch((e) => `ошибка удаления: ${e.message}`);
  console.log(`Удалены тестовые папки: ${removed}`);
  await rm(IMG_DIR, { recursive: true, force: true });
}

const failed = results.filter((r) => !r.ok);
console.log(`\nПроверок: ${results.length}, не прошло: ${failed.length}`);
process.exit(failed.length ? 1 : 0);
```

В `package.json` добавить в `scripts`: `"live-check": "node scripts/live-check.mjs"`.

- [ ] **Step 2: Запустить**

Run: `npm run build && LIVE_BIG_FOLDER='<имя большой папки пользователя>' npm run live-check`

Имя большой папки спросить у пользователя (в этой сессии — папка, которую он хочет открыть агенту); в репозиторий оно не попадает.

Expected: `Проверок: 26, не прошло: 0`, строка «Большая папка: …», строка «Удалены тестовые папки: ["anf-live-allowed-…","anf-live-foreign-…"]». Проверить в Заметках, что папок `anf-live-*` не осталось.

- [ ] **Step 3: Разобрать провалы (если есть)**

Сначала `superpowers:systematic-debugging`. Известные развилки, по которым решение уже принято:
- **`заголовок заметки совпал с title` — FAIL.** В `titleHtml` (`src/markdown.ts`) заменить `<div><h1>…</h1></div>` на `<div><b>…</b></div>`, поправить ожидание в `test/markdown.test.ts` («экранирует заголовок») и тест `notes_create` в `test/tools.test.ts` не трогать (он сравнивает с `titleHtml`). Пересобрать, перезапустить live-check.
- **`картинка встроена в текст` — FAIL.** Остановиться и доложить пользователю с выводом `notes_read` после создания: запасной путь из спеки (`make new attachment` в конец, `![](путь)` в середине текста — ошибка) — это отдельная задача после его решения. Остальные проверки при этом довести до зелёного.
- **`поиск без учёта регистра, кириллица` — FAIL.** Доложить пользователю: это поведение Заметок, а не ошибка кода; варианты (оставить как есть и описать в README либо искать в Node по `plaintext` всех заметок — дорого на большой папке) выбирает он.
- **Отказ по чужой или вложенной папке не сработал, или чужая заметка изменилась/исчезла.** Это нарушение главной гарантии: остановиться, ничего не коммитить, доложить с выводом.
- Остальное (например, `app.notes.byId` или `folders.push` не работают в этой версии Заметок) — чинить в `src/scripts.ts` или в `live-check.mjs`, сохраняя правила Global Constraints: скрипты постоянные, `folderId` первым аргументом, `guardNote` перед любым доступом к заметке по id. После правки — `npm test`, `npm run verify-build`, повтор live-check.

- [ ] **Step 4: Записать итоги в README**

В `plugins/apple-notes-folder/README.md` заменить комментарий `<!-- Итоги живой проверки … -->` разделом:

```markdown
## Итоги живой проверки

Проверено `npm run live-check` <дата> на macOS <вывод `sw_vers -productVersion`>: <N> проверок, все прошли.

- Картинки встраиваются в текст заметки через `data:`-URI (`notes_create`, `notes_append`, `notes_update`).
- Заголовок заметки — первая строка тела (`<div><h1>…</h1></div>` | `<div><b>…</b></div>` — оставить фактический).
- Поиск без учёта регистра, в том числе для кириллицы.
- Папка примерно из <округлённое число> заметок: `notes_list` — <мс> мс, `notes_search` — <мс> мс.
```

Подставить фактические значения из вывода Step 2 (угловые скобки — места для значений, в README их не оставлять). Имени большой папки в README нет.

- [ ] **Step 5: Commit**

```bash
git add scripts/live-check.mjs package.json README.md
git add -u src test dist   # если в Step 3 правились исходники
git commit -m "test(apple-notes-folder): живая проверка на Заметках и её итоги"
```

---

### Task 10: PR и приёмка после слияния

**Files:** — (только git, GitHub и установка плагина).

- [ ] **Step 1: Финальная проверка ветки**

Из каталога плагина: `npm ci && npm test && npm run typecheck && npm run verify-build`
Expected: всё зелёное, `dist совпадает со сборкой из исходников: файлов 2`.

Из корня репозитория:

```bash
git status --short
grep -rnE 'verdaccio|devmail|claude-502|@corp' plugins/apple-notes-folder .claude-plugin README.md | grep -v node_modules || echo clean
grep -o '"resolved": "[^"]*"' plugins/apple-notes-folder/package-lock.json | grep -vc 'https://registry.npmjs.org/' || true
```

Expected: `git status` пуст, `clean`, `0`.

- [ ] **Step 2: Пуш и PR — только после подтверждения пользователя**

Спросить пользователя, можно ли пушить ветку `apple-notes-folder` и открывать PR в `YarikMix/claude-plugins`. После «да»:

```bash
git push -u origin apple-notes-folder
gh pr create -R YarikMix/claude-plugins --base main --head apple-notes-folder \
  --title "feat: плагин apple-notes-folder — MCP Apple Notes в границах одной папки" \
  --body-file <файл в scratchpad с описанием>
```

Описание PR: что делает плагин (одна папка, семь инструментов, картинки), что защищает и что нет (хук против очевидного обхода), как проверено (автотесты — число из вывода, `verify-build`, итоги live-check из README), ссылки на спеку и план. Последняя строка описания:

```
🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

- [ ] **Step 3: Приёмка после слияния (вместе с пользователем)**

Пользователь сливает PR и выполняет в Claude Code:

```text
/plugin marketplace update yarikmix-plugins
/plugin install apple-notes-folder@yarikmix-plugins
/reload-plugins
```

и вводит имя папки в запросе настройки. Затем агент в этой же сессии:
1. `notes_list` без аргументов — ответ без ошибки, `total` совпадает со счётчиком папки в боковой панели Заметок (пользователь сверяет; печатать сырое число).
2. `notes_search` по слову, которое пользователь назовёт из заметки **другой** папки, — `total: 0`.
3. Bash: `osascript -e 'tell application "Notes" to get name of every folder'` — вызов отклонён хуком с текстом `DENY_REASON`.

- [ ] **Step 4: Убрать sweetrb**

После успешной приёмки пользователь выполняет:

```text
/plugin uninstall apple-notes@apple-notes-mcp
/plugin marketplace remove apple-notes-mcp
/reload-plugins
```

Агент проверяет: инструментов `mcp__plugin_apple-notes_apple-notes__*` в сессии больше нет, `notes_*` на месте.

- [ ] **Step 5: Прибрать рабочее дерево**

После слияния, с подтверждения пользователя, из основного клона:

```bash
cd /Users/y.mihalev/projects/tp-prepare/claude-plugins
git pull --ff-only && git worktree remove ../claude-plugins-apple-notes-folder && git branch -d apple-notes-folder
```
