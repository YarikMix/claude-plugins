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
