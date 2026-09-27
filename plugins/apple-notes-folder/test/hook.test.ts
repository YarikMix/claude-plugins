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
