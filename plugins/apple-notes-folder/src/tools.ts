import { z } from 'zod';
import { MAX_MARKDOWN_CHARS, htmlToMarkdown, makeResolver, markdownToHtml, titleHtml } from './markdown.js';
import { NotesService, type NoteSummary } from './notes.js';
import type { Runner } from './runner.js';
import type { Scope } from './scope.js';

export interface ToolDeps {
  getScope: () => Promise<Scope>;
  run: Runner;
  imageSrc: (path: string) => Promise<string>;
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
  'Картинка: ![подпись](/абсолютный/путь) — только файлы из /private/tmp/claude-<uid>/ (картинки, вставленные в промпт Claude Code, и scratchpad сессии); PNG, JPEG, GIF, HEIC или WebP до 10 МБ; в заметке она становится вложением. Путь с пробелами — в угловых скобках: ![](<путь>).';
const ATTACHMENTS_RULE =
  'У заметки с вложениями (картинками, файлами) — отказ: Заметки портят вложения при любом изменении текста. Такую заметку можно только читать и удалять; новый текст и картинки — в новую заметку.';

export function attachmentsLine(n: number): string {
  return `\n\n[Вложений в заметке: ${n} — их содержимое сервер не показывает]`;
}

const byModifiedDesc = (a: NoteSummary, b: NoteSummary) => b.modified.localeCompare(a.modified);
const json = (v: unknown) => JSON.stringify(v, null, 2);

export function makeTools(deps: ToolDeps): ToolDef[] {
  const service = async () => new NotesService(deps.run, (await deps.getScope()).folderId);
  const noteId = z.string().min(1).describe('id заметки из notes_list или notes_search');
  const newImages = () => makeResolver(null, deps.imageSrc);

  return [
    {
      name: 'notes_list',
      description: `Заметки папки: id, заголовок, дата изменения; новые сверху. ${SCOPE_NOTE}`,
      shape: {
        limit: z.number().int().min(1).max(200).default(50),
        offset: z.number().int().min(0).default(0),
      },
      annotations: { readOnlyHint: true },
      handler: async ({ limit, offset }: { limit: number; offset: number }) => {
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
      handler: async ({ query, limit }: { query: string; limit: number }) => {
        const hits = (await (await service()).search(query)).sort(byModifiedDesc);
        return json({ total: hits.length, notes: hits.slice(0, limit) });
      },
    },
    {
      name: 'notes_read',
      description: `Заметка целиком в Markdown; первая строка — заголовок. Картинки заметки показаны заглушками ![картинка N](note-image:N). Если у заметки есть вложения, последняя строка ответа — «[Вложений в заметке: N — их содержимое сервер не показывает]». ${SCOPE_NOTE}`,
      shape: { id: noteId },
      annotations: { readOnlyHint: true },
      handler: async ({ id }: { id: string }) => {
        const note = await (await service()).read(id);
        const tail = note.attachments > 0 ? attachmentsLine(note.attachments) : '';
        return htmlToMarkdown(note.body, MAX_MARKDOWN_CHARS - tail.length).markdown + tail;
      },
    },
    {
      name: 'notes_create',
      description: `Новая заметка в папке. title — заголовок, markdown — текст. ${IMAGES_HELP} ${SCOPE_NOTE}`,
      shape: { title: z.string().min(1), markdown: z.string() },
      annotations: {},
      handler: async ({ title, markdown }: { title: string; markdown: string }) => {
        const html = titleHtml(title) + (await markdownToHtml(markdown, newImages()));
        return json({ id: await (await service()).create(html) });
      },
    },
    {
      name: 'notes_append',
      description: `Дописать Markdown в конец заметки; существующий текст не меняется. ${ATTACHMENTS_RULE} ${IMAGES_HELP} ${SCOPE_NOTE}`,
      shape: { id: noteId, markdown: z.string().min(1) },
      annotations: {},
      handler: async ({ id, markdown }: { id: string; markdown: string }) => {
        const html = await markdownToHtml(markdown, newImages());
        await (await service()).append(id, html);
        return json({ id });
      },
    },
    {
      name: 'notes_update',
      description: `Заменить текст заметки целиком — в формате notes_read, с заголовком первой строкой. ${ATTACHMENTS_RULE} Заглушки ![…](note-image:N) во входе не принимаются. ${IMAGES_HELP} ${SCOPE_NOTE}`,
      shape: { id: noteId, markdown: z.string().min(1) },
      annotations: { destructiveHint: true },
      handler: async ({ id, markdown }: { id: string; markdown: string }) => {
        const html = await markdownToHtml(markdown, newImages());
        await (await service()).update(id, html);
        return json({ id });
      },
    },
    {
      name: 'notes_delete',
      description: `Удалить заметку; она уходит в «Недавно удалённые». ${SCOPE_NOTE}`,
      shape: { id: noteId },
      annotations: { destructiveHint: true },
      handler: async ({ id }: { id: string }) => {
        await (await service()).delete(id);
        return json({ id, deleted: true });
      },
    },
  ];
}
