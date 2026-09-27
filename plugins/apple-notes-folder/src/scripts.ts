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
