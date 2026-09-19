# typescript-native-lsp: дизайн

Дата: 2026-09-19

## Задача

Дать Claude Code языковой сервер TypeScript 7 в любом репозитории и раздать ту же настройку студентам курса и коллегам из других организаций.

Официальный плагин `typescript-lsp@claude-plugins-official` для этого не годится. Он запускает `typescript-language-server`, а тот — обёртка над `tsserver.js`. В TypeScript 7 (нативный порт) `tsserver.js` нет: в `node_modules/typescript/lib` лежат только `tsc.js` и `getExePath.js`. Наблюдаемые последствия на проекте с TS 7.0.2:

- пока глобальный `typescript` был 6.0.3, сервер молча брал его: навигация работала, но диагностика шла от другого компилятора, чем `tsc --noEmit` проекта;
- после `npm install -g typescript@7` сервер начал выдавать ложные ошибки — `Cannot find name 'Element'`, `Cannot find name 'Node'`, `Property 'push' does not exist on type '{}'` — при чистом `tsc --noEmit` (exit 0).

У TypeScript 7 языковой сервер встроен в компилятор: `tsc --lsp --stdio`. npm-launcher пакета пробрасывает флаг в нативный бинарник — `node node_modules/typescript/bin/tsc --lsp --help` отвечает справкой LSP-режима.

## Решения

| Вопрос | Решение | Почему |
|---|---|---|
| Где живёт плагин | публичный личный репозиторий `YarikMix/claude-plugins` | маркетплейс ставится в scope `user` и не зависит от членства в организациях |
| Откуда берётся `tsc` | глобальный, из PATH | плагин остаётся одним JSON без кода; работает с любым пакетным менеджером |
| Где лежит `lspServers` | в записи `marketplace.json`, `"strict": false` | так устроены все 12 официальных LSP-плагинов; формат виден в локальной копии маркетплейса |
| Старый или отсутствующий `tsc` | только README | хук-проверка исполнялся бы на каждом старте сессии в любом репозитории, включая те, где TypeScript нет |
| Подключение к курсу | вне этой работы | имеет смысл после push и проверки плагина |

Отвергнуто: launcher в `bin/` плагина с поиском `typescript` в `node_modules` проекта (код под две ОС и непроверенная зависимость от рабочего каталога сервера); `bunx`/`npx` (привязка к пакетному менеджеру); `lspServers` в манифесте самого плагина (самодостаточность плагина пока никому не нужна).

## Имена

| Что | Значение |
|---|---|
| Репозиторий | `YarikMix/claude-plugins` |
| Маркетплейс (`name` в `marketplace.json`) | `yarikmix-plugins` |
| Плагин | `typescript-native-lsp` |
| Идентификатор для `enabledPlugins` | `typescript-native-lsp@yarikmix-plugins` |

Имя маркетплейса входит в идентификатор плагина и в `settings.json` каждого проекта, который на него сошлётся, поэтому после публикации не меняется. В имени плагина нет номера версии TypeScript: нативный сервер переживёт седьмую версию.

## Структура

```text
.gitattributes
.claude-plugin/marketplace.json
plugins/typescript-native-lsp/
  README.md
  LICENSE
README.md
docs/superpowers/specs/2026-09-19-typescript-native-lsp-design.md
```

`.gitattributes` задаёт `* text=auto eol=lf`: репозиторий собирается на Windows, а читают его и на POSIX, и без правила git подменяет LF на CRLF при checkout.

### `.claude-plugin/marketplace.json`

Поля верхнего уровня: `$schema` (`https://anthropic.com/claude-code/marketplace.schema.json`), `name`, `description`, `owner` (`name: "Yaroslav Mihalev"`), `plugins`.

Единственная запись в `plugins`:

```json
{
  "name": "typescript-native-lsp",
  "description": "TypeScript 7 native language server (tsc --lsp) for Claude Code",
  "version": "1.0.0",
  "author": { "name": "Yaroslav Mihalev" },
  "source": "./plugins/typescript-native-lsp",
  "category": "development",
  "strict": false,
  "lspServers": {
    "typescript": {
      "command": "tsc",
      "args": ["--lsp", "--stdio"],
      "extensionToLanguage": {
        ".ts": "typescript",
        ".tsx": "typescriptreact",
        ".js": "javascript",
        ".jsx": "javascriptreact",
        ".mts": "typescript",
        ".cts": "typescript",
        ".mjs": "javascript",
        ".cjs": "javascript"
      }
    }
  }
}
```

От официальной записи `typescript-lsp` отличаются только `name`, `description`, `author`, `source`, `command` и `args`. Карта `extensionToLanguage` совпадает дословно.

### `plugins/typescript-native-lsp/README.md`

По-русски; блок установки продублирован по-английски. Разделы:

1. Что это и зачем: одна-две фразы про `tsserver.js` и TypeScript 7.
2. Требования: `npm install -g typescript@7`, проверка `tsc --version` — ожидается `Version 7.x`.
3. Установка: `/plugin marketplace add YarikMix/claude-plugins`, `/plugin install typescript-native-lsp@yarikmix-plugins`, перезапуск Claude Code.
4. Несовместимость с `typescript-lsp@claude-plugins-official`: отключить, иначе два сервера делят одни расширения, а официальный с глобальным TS 7 даёт ложные ошибки.
5. Если LSP молчит: `tsc` старее 7 (флаг `--lsp` неизвестен, сервер не стартует), `tsc` нет в PATH, сессия не перезапущена после установки.
6. Ограничение: работает глобальный TypeScript, а не копия из `node_modules` проекта; при расхождении версий диагностика может отличаться от `tsc --noEmit` проекта.

### `plugins/typescript-native-lsp/LICENSE`

MIT, `Copyright (c) 2026 Yaroslav Mihalev`.

### Корневой `README.md`

Что за репозиторий, команда добавления маркетплейса, таблица плагинов из одной строки со ссылкой на README плагина.

## Как это работает

1. Пользователь добавляет маркетплейс и ставит плагин; запись попадает в `~/.claude/plugins/installed_plugins.json` со scope `user`.
2. На старте сессии Claude Code читает `lspServers` включённых плагинов.
3. При обращении к файлу с расширением из `extensionToLanguage` запускается `tsc --lsp --stdio`; `tsconfig.json` сервер находит сам.
4. Инструмент `LSP` (`hover`, `goToDefinition`, `findReferences`, …) и диагностика после правок идут через этот сервер.

## Проверка

Три шага; второй выполняет пользователь.

1. **Статика.** `marketplace.json` разбирается как JSON; поля записи сверяются с официальной записью `typescript-lsp` чтением обоих файлов. Общий скрипт для генерации и сверки не используется: проверка не должна делить предположения с тем, что проверяет.
2. **Установка.** `/plugin marketplace add F:\Github\claude-plugins`, `/plugin install typescript-native-lsp@yarikmix-plugins`, официальный `typescript-lsp` выключен, Claude Code перезапущен. LSP-серверы поднимаются на старте сессии, из уже идущей сессии этот шаг не выполнить.
3. **Пробы в новой сессии** на `react-from-scratch-course/23-svg`:
   - первым же вызовом, на холодном сервере: `findReferences` на `createRoot` (`src/render.ts:45:17`) — ожидаются 2 ссылки, `render.ts:45` и `index.ts:5`. С официальным плагином холодный вызов вернул 1;
   - `hover` там же — `function createRoot(container: Element): Root`;
   - диагностика по `src/render.ts` и `src/commit.ts` пуста, как и `bun run typecheck` (exit 0): ни одного `Cannot find name 'Node'`;
   - контроль от обратного: временная ошибка типа в копии файла даёт диагностику с тем же кодом, что `tsc --noEmit`.

## Риски

- **Связка `tsc --lsp` с Claude Code.** Навигация подтверждена пробами 2026-09-19 на Windows 11, Claude Code с TypeScript 7.0.2: сервер стартует, находит `tsconfig.json`, отвечает на `findReferences` и `hover`. Диагностика не подтверждена — см. «Результаты проб».
- **Windows.** Подтверждено: команда `tsc` разрешается в `tsc.cmd`, в списке процессов видна цепочка `cmd.exe … tsc.cmd --lsp --stdio` → `node …/typescript/bin/tsc` → `tsc.exe --lsp --stdio`; процесса `typescript-language-server` нет.
- **Расхождение версий.** Глобальный TS 7.x против `~7.0.2` в проекте. Принято как ограничение и описано в README.
- **Диагностика только по запросу.** `typescript-go` 7.0.2 не рассылает ошибки исходников через `textDocument/publishDiagnostics`: сам он публикует только диагностику `tsconfig.json`, а ошибки файла отдаёт в ответ на `textDocument/diagnostic`. Клиент, который умеет только принимать push, ошибок не увидит. Умеет ли Claude Code запрашивать диагностику сам, пробами не установлено.

## Результаты проб

2026-09-19, `react-from-scratch-course/23-svg`, новая сессия после установки плагина из локального каталога.

| Проба | Ожидалось | Получено |
|---|---|---|
| `findReferences` на `createRoot`, первым вызовом LSP в сессии | 2 ссылки | 2 ссылки: `render.ts:45:17`, `index.ts:5:10`. Дефект холодного старта, наблюдавшийся с официальным плагином (1 ссылка), не воспроизвёлся |
| Контроль: `Grep` по `\bcreateRoot\b` в `23-svg/src` | те же две строки | `render.ts:45`, `index.ts:5` |
| `hover` на `createRoot` | `function createRoot(container: Element): Root` | совпало |
| Какой процесс отвечает | `tsc.exe --lsp --stdio` | он, через `tsc.cmd`; `typescript-language-server` не запущен |
| Ложная диагностика по `render.ts` и `commit.ts` | нет | нет; `bun run typecheck` — exit 0 |
| Контроль от обратного: `src/lsp-probe.ts` с `const lspProbe: number = "text"` | диагностика `2322` от LSP и `TS2322` от компилятора | компилятор — `TS2322`, одна строка. От LSP в пределах хода диагностика не пришла ни после записи файла, ни после правки |
| Проба файла удалена | `git status` по пути пуст, typecheck зелёный | пуст, exit 0 |

Отсутствие ложной диагностики само по себе ничего не доказывает: при молчащем канале она отсутствовала бы тоже. Поэтому сервер опрошен напрямую, скриптом, говорящим по LSP через stdio, в двух режимах — клиент объявляет только `publishDiagnostics` и клиент объявляет ещё и `textDocument.diagnostic`. Результат одинаков:

- `serverInfo` — `typescript-go 7.0.2`, в capabilities объявлен `diagnosticProvider` (`interFileDependencies: true`, `workspaceDiagnostics: false`);
- за 6 секунд после `didOpen` пришло одно `publishDiagnostics` — для `tsconfig.json`, пустое; для самого файла — ни одного;
- запрос `textDocument/diagnostic` вернул `2322`, `Type 'string' is not assignable to type 'number'`.

Открытый вопрос: диагностика в Claude Code приезжает не сразу после правки, а с началом следующего хода пользователя, поэтому в пределах хода проб её отсутствие не окончательно. Проба с ошибкой оставлена вне курса; итог записывается сюда же следующей правкой.

## Вне этой работы

- `.claude/settings.json` с `extraKnownMarketplaces` и `enabledPlugins` в репозитории курса, раздел в его README.
- Push в GitHub: выполняет владелец репозитория.
- Другие плагины маркетплейса.
