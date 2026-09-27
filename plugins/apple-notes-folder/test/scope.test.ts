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
