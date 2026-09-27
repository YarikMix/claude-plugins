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
// Удаление папки целиком iCloud откатывает при следующей синхронизации (папка возвращается вместе с заметками),
// а вложенная папка после удаления родителя остаётся сиротой. Поэтому: сначала заметки, потом вложенная папка,
// потом остальные; acc.folders видит и вложенные папки.
const CLEANUP = `function run(argv) {
  var app = Application('Notes'), acc = app.defaultAccount(), done = [];
  for (var i = 0; i < argv.length; i++) {
    try {
      var f = acc.folders.byName(argv[i]); f.id();
      var ids = f.notes.id();
      for (var j = 0; j < ids.length; j++) app.notes.byId(ids[j]).delete();
      f.delete();
      done.push(argv[i]);
    } catch (e) {}
  }
  return JSON.stringify(done);
}`;
const LEFTOVER = `function run(argv) {
  var names = Application('Notes').defaultAccount().folders.name(), out = [];
  for (var i = 0; i < names.length; i++) if (argv.indexOf(names[i]) >= 0) out.push(names[i]);
  return JSON.stringify(out);
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
  // Запрос с дефисом в начале не должен разбираться osascript как опция.
  const s3 = await call(c, 'notes_search', { query: `-${SECRET}` });
  check('поиск с дефисом в начале запроса', !s3.isError, s3.isError ? s3.text : `total=${JSON.parse(s3.text).total}`);

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
  const removed = await jxa(CLEANUP, SUB, ALLOWED, FOREIGN).catch((e) => `ошибка удаления: ${e.message}`);
  console.log(`Удалены тестовые папки: ${removed}`);
  // Синхронизация iCloud может вернуть папку через несколько секунд — проверить и удалить ещё раз.
  for (let round = 1; round <= 3; round++) {
    await new Promise((r) => setTimeout(r, 20_000));
    const left = JSON.parse(await jxa(LEFTOVER, SUB, ALLOWED, FOREIGN).catch(() => '[]'));
    if (!left.length) break;
    console.log(`Тестовые папки вернулись (${round}): ${JSON.stringify(left)} — удаляю снова`);
    await jxa(CLEANUP, ...left).catch(() => {});
  }
  console.log(`Осталось тестовых папок: ${await jxa(LEFTOVER, SUB, ALLOWED, FOREIGN).catch((e) => `ошибка: ${e.message}`)}`);
  await rm(IMG_DIR, { recursive: true, force: true });
}

const failed = results.filter((r) => !r.ok);
console.log(`\nПроверок: ${results.length}, не прошло: ${failed.length}`);
process.exit(failed.length ? 1 : 0);
