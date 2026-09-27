import { describe, it, expect } from 'vitest';
import { SCRIPTS, ID_SCRIPTS, GUARD_CALL } from '../src/scripts.js';

describe('SCRIPTS', () => {
  it('заморожены', () => {
    expect(Object.isFrozen(SCRIPTS)).toBe(true);
  });

  it('каждый скрипт разбирается как JavaScript', () => {
    for (const [name, s] of Object.entries(SCRIPTS)) {
      expect(() => new Function(s), name).not.toThrow();
    }
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

  it('дописывание и замена отказывают заметке с вложениями до записи текста', () => {
    for (const s of [SCRIPTS.appendNote, SCRIPTS.updateNote]) {
      const run = s.slice(s.indexOf('function run('));
      const guardAt = run.indexOf(GUARD_CALL);
      const checkAt = run.indexOf('attachmentCount(n)');
      const failAt = run.indexOf("fail('ATTACHMENTS:' + k)");
      const writeAt = run.indexOf('n.body =');
      expect(guardAt).toBeGreaterThan(-1);
      expect(checkAt).toBeGreaterThan(guardAt);
      expect(failAt).toBeGreaterThan(checkAt);
      expect(writeAt).toBeGreaterThan(failAt);
    }
  });

  it('число вложений считается по id без повторов', () => {
    expect(SCRIPTS.readNote).toMatch(/function attachmentCount\(n\) \{[^}]*n\.attachments\.id\(\)/);
  });

  it('чтение отдаёт число вложений', () => {
    const run = SCRIPTS.readNote.slice(SCRIPTS.readNote.indexOf('function run('));
    expect(run).toContain('attachments: attachmentCount(n)');
  });

  it('поиск — без whose, пакетно по тексту и без учёта регистра', () => {
    const run = SCRIPTS.searchNotes.slice(SCRIPTS.searchNotes.indexOf('function run('));
    expect(run).not.toContain('whose');
    expect(run).toContain('folderById(argv[0])');
    expect(run).toContain('.plaintext()');
    expect(run).toContain('toLowerCase');
  });

  it('создание — только в папке по id', () => {
    expect(SCRIPTS.createNote).toContain('folderById(argv[0])');
    expect(SCRIPTS.createNote).toContain('f.notes.push(');
  });
});
