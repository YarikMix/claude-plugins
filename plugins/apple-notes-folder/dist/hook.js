import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);

// src/hook.ts
var SCRIPTING = /osascript|applescript|jxa|scriptingbridge/i;
var NOTES = /(["'`])notes\\?\1|com\.apple\.notes|notestore/i;
var SQLITE = /sqlite/i;
var NOTESTORE = /notestore/i;
var DENY_REASON = "\u041F\u0440\u044F\u043C\u043E\u0439 \u0434\u043E\u0441\u0442\u0443\u043F \u043A Apple Notes \u0438\u0437 Bash \u0437\u0430\u043F\u0440\u0435\u0449\u0451\u043D \u043F\u043B\u0430\u0433\u0438\u043D\u043E\u043C apple-notes-folder. \u0420\u0430\u0431\u043E\u0442\u0430\u0439\u0442\u0435 \u0441 \u0437\u0430\u043C\u0435\u0442\u043A\u0430\u043C\u0438 \u0447\u0435\u0440\u0435\u0437 \u0438\u043D\u0441\u0442\u0440\u0443\u043C\u0435\u043D\u0442\u044B notes_* \u2014 \u043E\u043D\u0438 \u043E\u0433\u0440\u0430\u043D\u0438\u0447\u0435\u043D\u044B \u0440\u0430\u0437\u0440\u0435\u0448\u0451\u043D\u043D\u043E\u0439 \u043F\u0430\u043F\u043A\u043E\u0439.";
function shouldDeny(command) {
  return SCRIPTING.test(command) && NOTES.test(command) || SQLITE.test(command) && NOTESTORE.test(command);
}
function hookOutput(input2) {
  let command = "";
  try {
    const call = JSON.parse(input2);
    if (call?.tool_name === "Bash") command = String(call?.tool_input?.command ?? "");
  } catch {
    return "";
  }
  if (!shouldDeny(command)) return "";
  return JSON.stringify({
    hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: DENY_REASON }
  });
}

// src/hook-cli.ts
var input = "";
for await (const chunk of process.stdin) input += chunk;
process.stdout.write(hookOutput(input));
