import { hookOutput } from './hook.js';

let input = '';
for await (const chunk of process.stdin) input += chunk;
process.stdout.write(hookOutput(input));
