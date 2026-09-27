import { pathToFileURL } from 'node:url';

const SCRIPTING = /osascript|applescript|jxa|scriptingbridge/i;
const NOTES = /notes/i;
const SQLITE = /sqlite/i;
const NOTESTORE = /notestore/i;

export const DENY_REASON =
  'Прямой доступ к Apple Notes из Bash запрещён плагином apple-notes-folder. Работайте с заметками через инструменты notes_* — они ограничены разрешённой папкой.';

/** Очевидный обход сервера: скриптовый доступ к Заметкам или чтение их базы. Намеренный обход не ловится. */
export function shouldDeny(command: string): boolean {
  return (SCRIPTING.test(command) && NOTES.test(command)) || (SQLITE.test(command) && NOTESTORE.test(command));
}

async function main(): Promise<void> {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  let command = '';
  try {
    const call = JSON.parse(input);
    if (call?.tool_name === 'Bash') command = String(call?.tool_input?.command ?? '');
  } catch {
    return;
  }
  if (!shouldDeny(command)) return;
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: DENY_REASON },
    }),
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
