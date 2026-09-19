# typescript-native-lsp

Языковой сервер TypeScript 7 для Claude Code: переход к определению, поиск ссылок, hover и диагностика после правок.

Официальный плагин `typescript-lsp` запускает `typescript-language-server` — обёртку над `tsserver.js`. В TypeScript 7 `tsserver.js` нет: языковой сервер встроен в сам компилятор и запускается командой `tsc --lsp --stdio`. Этот плагин подключает именно его.

## Требования

TypeScript 7 или новее, установленный глобально:

```bash
npm install -g typescript@7
tsc --version
```

Ожидается `Version 7.x`. С TypeScript 6 и старше плагин не работает: флаг `--lsp` им неизвестен.

## Установка

```text
/plugin marketplace add YarikMix/claude-plugins
/plugin install typescript-native-lsp@yarikmix-plugins
```

После установки перезапустите Claude Code: языковые серверы поднимаются на старте сессии.

## Installation

Requires TypeScript 7+ installed globally (`npm install -g typescript@7`; `tsc --version` must print `Version 7.x`).

```text
/plugin marketplace add YarikMix/claude-plugins
/plugin install typescript-native-lsp@yarikmix-plugins
```

Restart Claude Code afterwards. Disable the official `typescript-lsp` plugin: both claim the same file extensions.

## Несовместимость с `typescript-lsp`

Отключите официальный плагин `typescript-lsp@claude-plugins-official`: оба претендуют на одни и те же расширения файлов. Кроме того, с глобальным TypeScript 7 официальный плагин выдаёт ложные ошибки — `Cannot find name 'Element'`, `Cannot find name 'Node'`, `Property 'push' does not exist on type '{}'` — при чистом `tsc --noEmit`.

В `~/.claude/settings.json`:

```json
{
  "enabledPlugins": {
    "typescript-lsp@claude-plugins-official": false,
    "typescript-native-lsp@yarikmix-plugins": true
  }
}
```

## Если LSP молчит

| Симптом | Причина | Что сделать |
|---|---|---|
| `tsc --version` печатает 6.x или ниже | флаг `--lsp` неизвестен, сервер не стартует | `npm install -g typescript@7` |
| `tsc: command not found` | глобальный каталог npm не в PATH | добавить в PATH каталог из `npm prefix -g` (на POSIX — его подкаталог `bin`) |
| всё установлено, но ссылок и hover нет | сессия запущена до установки плагина | перезапустить Claude Code |

## Ограничение

Работает глобальный TypeScript, а не копия из `node_modules` проекта. Если версии расходятся, диагностика сервера может отличаться от `tsc --noEmit` проекта. Держите глобальную версию не ниже той, что записана в `package.json`.

Расширения файлов: `.ts`, `.tsx`, `.js`, `.jsx`, `.mts`, `.cts`, `.mjs`, `.cjs`.
