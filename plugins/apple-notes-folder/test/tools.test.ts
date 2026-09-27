import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { makeTools } from '../src/tools.js';
import { SCRIPTS } from '../src/scripts.js';
import { MESSAGES, ToolError, attachmentsMessage } from '../src/errors.js';
import { titleHtml, MAX_MARKDOWN_CHARS, TRUNCATION_MARKER_PREFIX } from '../src/markdown.js';
import type { Runner } from '../src/runner.js';

interface FakeNote {
  name: string;
  body: string;
  folder: string;
  modified: string;
  locked?: boolean;
  attachments?: number;
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
  const noAttachments = (n: FakeNote) => {
    const k = n.attachments ?? 0;
    if (k > 0) throw new ToolError('ATTACHMENTS', attachmentsMessage(k));
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
        return JSON.stringify({ id: a1, name: n.name, modified: n.modified, body: n.body, attachments: n.attachments ?? 0 });
      }
      case SCRIPTS.createNote: {
        const id = `NEW${++seq}`;
        notes[id] = { name: 'new', body: await readFile(a1, 'utf8'), folder: fid, modified: '2026-09-27T00:00:00.000Z' };
        return JSON.stringify({ id });
      }
      case SCRIPTS.appendNote: {
        const n = guard(fid, a1);
        noAttachments(n);
        n.body += await readFile(a2, 'utf8');
        return JSON.stringify({ id: a1 });
      }
      case SCRIPTS.updateNote: {
        const n = guard(fid, a1);
        noAttachments(n);
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
    P1: { name: 'С картинками', body: WITH_IMAGES, folder: 'F1', modified: '2026-09-05T00:00:00.000Z', attachments: 2 },
    X1: { name: 'Секретная', body: '<div><h1>Секретная</h1></div><div>про кота тоже</div>', folder: 'F2', modified: '2026-09-03T00:00:00.000Z' },
  });
  const loaded: string[] = [];
  const tools = makeTools({
    getScope: async () => ({ folderId: 'F1', folderName: 'Разрешённая' }),
    run: fake.run,
    imageSrc: async (p) => {
      loaded.push(p);
      return 'file:///private/tmp/claude-1/real.png';
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
    const d = Object.fromEntries(setup().tools.map((t) => [t.name, t.description]));
    for (const name of ['notes_append', 'notes_update']) expect(d[name]).toContain('вложения');
    for (const name of ['notes_create', 'notes_append', 'notes_update']) expect(d[name]).toContain('/private/tmp/claude-<uid>/');
    expect(d.notes_read).toContain('Вложений в заметке');
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

  it('notes_read: число вложений в конце ответа, без вложений — строки нет', async () => {
    const { tool } = setup();
    const withAtt = await tool('notes_read')({ id: 'P1' });
    expect(withAtt.endsWith('\n\n[Вложений в заметке: 2 — их содержимое сервер не показывает]')).toBe(true);
    expect(await tool('notes_read')({ id: 'N1' })).not.toContain('Вложений в заметке');
  });

  it('notes_read: длинная заметка с вложениями укладывается в лимит', async () => {
    const { tool, notes } = setup();
    notes.P1.body = `<div>${'а'.repeat(MAX_MARKDOWN_CHARS + 100)}</div>`;
    const md = await tool('notes_read')({ id: 'P1' });
    expect(md.length).toBeLessThanOrEqual(MAX_MARKDOWN_CHARS);
    expect(md).toContain('обрезано');
    expect(md.endsWith('[Вложений в заметке: 2 — их содержимое сервер не показывает]')).toBe(true);
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
    // .then attaches a rejection handler to each promise synchronously, right when it is
    // created — before the sequential await below lets any of them settle unhandled (some
    // reject slower than others because notes_append/update round-trip through real temp-file
    // I/O in withHtmlFile), avoiding spurious PromiseRejectionHandledWarning noise.
    const attempts = [
      tool('notes_read')({ id: 'X1' }),
      tool('notes_append')({ id: 'X1', markdown: 'взлом' }),
      tool('notes_update')({ id: 'X1', markdown: 'взлом' }),
      tool('notes_delete')({ id: 'X1' }),
    ].map((p) => p.then(() => null, (e: unknown) => e));
    for (const p of attempts) {
      const err = await p;
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
      imageSrc: async () => 'file:///x',
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
    expect(notes[id].body).toContain('<img src="file:///private/tmp/claude-1/real.png">');
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

  it('notes_append и notes_update у заметки с вложениями — отказ, текст не меняется', async () => {
    const { tool, notes } = setup();
    const before = notes.P1.body;
    for (const name of ['notes_append', 'notes_update']) {
      const err = await tool(name)({ id: 'P1', markdown: 'новое' }).then(() => null, (e: unknown) => e);
      expect(err).toMatchObject({ code: 'ATTACHMENTS' });
      expect((err as Error).message).toContain('(2)');
    }
    expect(notes.P1.body).toBe(before);
  });

  it('notes_append и notes_update без вложений — картинка из пути уходит в тело как file://', async () => {
    const { tool, notes, loaded } = setup();
    await tool('notes_append')({ id: 'N1', markdown: '![](/private/tmp/claude-1/a.png)' });
    expect(notes.N1.body).toContain('<img src="file:///private/tmp/claude-1/real.png">');
    await tool('notes_update')({ id: 'N2', markdown: '# Вторая\n\n![](/private/tmp/claude-1/b.png)' });
    expect(notes.N2.body).toContain('<img src="file:///private/tmp/claude-1/real.png">');
    expect(loaded).toEqual(['/private/tmp/claude-1/a.png', '/private/tmp/claude-1/b.png']);
  });

  it('notes_update: заглушка note-image во входе — ошибка до записи', async () => {
    const { tool, calls, notes } = setup();
    const before = notes.N1.body;
    await expect(tool('notes_update')({ id: 'N1', markdown: '![](note-image:1)' })).rejects.toMatchObject({
      code: 'IMAGE_REF',
    });
    expect(calls.filter((c) => c.script === SCRIPTS.updateNote)).toHaveLength(0);
    expect(notes.N1.body).toBe(before);
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

  it('notes_update: тело с пометкой обрезки notes_read — отказ TRUNCATED до записи, тело не меняется', async () => {
    const { tool, calls, notes } = setup();
    const before = notes.N1.body;
    const markdown = `Заголовок\n\nтекст${TRUNCATION_MARKER_PREFIX} ${MAX_MARKDOWN_CHARS} символов]`;
    await expect(tool('notes_update')({ id: 'N1', markdown })).rejects.toMatchObject({
      code: 'TRUNCATED',
      message: MESSAGES.TRUNCATED,
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
