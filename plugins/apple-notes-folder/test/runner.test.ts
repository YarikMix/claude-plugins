import { describe, it, expect } from 'vitest';
import { mapOsaFailure, makeOsascriptRunner, OSA_TIMEOUT_MS } from '../src/runner.js';
import { MESSAGES, attachmentsMessage } from '../src/errors.js';

describe('mapOsaFailure', () => {
  it('разбирает коды APN из stderr', () => {
    const stderr = 'execution error: Error: APN:OUTSIDE (-2700)';
    expect(mapOsaFailure({}, stderr, false)).toMatchObject({ code: 'OUTSIDE', message: MESSAGES.OUTSIDE });
    expect(mapOsaFailure({}, 'Error: APN:NOT_FOUND', false).code).toBe('NOT_FOUND');
    expect(mapOsaFailure({}, 'Error: APN:LOCKED', false).code).toBe('LOCKED');
    expect(mapOsaFailure({}, 'Error: APN:FOLDER_GONE', false).code).toBe('CONFIG');
    expect(mapOsaFailure({}, 'Error: APN:IO', true).code).toBe('OSA');
  });

  it('вложения: код ATTACHMENTS с числом вложений', () => {
    const e = mapOsaFailure({}, 'execution error: Error: APN:ATTACHMENTS:3 (-2700)', true);
    expect(e.code).toBe('ATTACHMENTS');
    expect(e.message).toContain('(3)');
    expect(e.message).toBe(attachmentsMessage(3));
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
