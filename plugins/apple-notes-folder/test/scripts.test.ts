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
