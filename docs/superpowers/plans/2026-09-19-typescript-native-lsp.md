# typescript-native-lsp Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Опубликовать в личном маркетплейсе `YarikMix/claude-plugins` плагин Claude Code, который поднимает нативный языковой сервер TypeScript 7 командой `tsc --lsp --stdio`.

**Architecture:** Плагин не содержит кода. Вся конфигурация — блок `lspServers` в записи `.claude-plugin/marketplace.json` при `"strict": false`, как у официальных LSP-плагинов. В каталоге плагина лежат только `README.md` и `LICENSE`. `tsc` берётся из PATH.

**Tech Stack:** JSON-манифест маркетплейса Claude Code, Markdown, `jq` для статической проверки, инструмент `LSP` Claude Code для проб.

**Spec:** `docs/superpowers/specs/2026-09-19-typescript-native-lsp-design.md`

## Global Constraints

- Рабочий каталог всех команд — `F:\Github\claude-plugins` (в Git Bash — `/f/Github/claude-plugins`), если в шаге не сказано иное.
- Имя маркетплейса: `yarikmix-plugins`. Имя плагина: `typescript-native-lsp`. Идентификатор: `typescript-native-lsp@yarikmix-plugins`. Репозиторий: `YarikMix/claude-plugins`.
- Команда сервера: `tsc`, аргументы: `["--lsp", "--stdio"]`. Никаких launcher-ов, `bunx`, `npx`, хуков и каталога `bin/`.
- `"strict": false`; `lspServers` живёт в `marketplace.json`, а не в манифесте плагина.
- Карта `extensionToLanguage` дословно совпадает с картой официального `typescript-lsp`.
- README плагина — по-русски, блок установки продублирован по-английски.
- Лицензия — MIT, `Copyright (c) 2026 Yaroslav Mihalev`.
- Коммиты разрешены, `git push` не выполнять: его делает владелец.
- Каждое сообщение коммита заканчивается строкой `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Репозиторий курса `F:\Github\TP-Prepare\react-from-scratch-course` содержит незакоммиченную работу. В нём разрешено только создать и удалить один файл-пробу в Task 4. `git checkout`, `git stash`, `git add` там не выполнять.
- Официальная запись для сверки: `~/.claude/plugins/marketplaces/claude-plugins-official/.claude-plugin/marketplace.json`, элемент `plugins[]` с `"name": "typescript-lsp"`.

## File Structure

| Файл | Ответственность |
|---|---|
| `.gitattributes` | окончания строк LF на всех платформах |
| `.claude-plugin/marketplace.json` | маркетплейс и единственная запись плагина с `lspServers` |
| `plugins/typescript-native-lsp/README.md` | требования, установка, несовместимость, диагностика, ограничение |
| `plugins/typescript-native-lsp/LICENSE` | MIT |
| `README.md` | что за репозиторий, как добавить маркетплейс, таблица плагинов |
| `docs/superpowers/specs/2026-09-19-typescript-native-lsp-design.md` | дополняется строкой про `.gitattributes` |

---

### Task 1: Манифест маркетплейса

**Files:**
- Create: `.gitattributes`
- Create: `.claude-plugin/marketplace.json`
- Modify: `docs/superpowers/specs/2026-09-19-typescript-native-lsp-design.md` (блок «Структура»)

**Interfaces:**
- Consumes: ничего.
- Produces: маркетплейс `yarikmix-plugins` с плагином `typescript-native-lsp`, `source` — `./plugins/typescript-native-lsp`. Task 2 создаёт каталог по этому пути и ссылается на эти имена в README.

- [ ] **Step 1: Написать проверку и убедиться, что она падает**

Проверка намеренно не делит ничего с тем, как файл пишется: файл набирается руками, а сверяет его `jq`, читая официальный манифест как эталон.

```bash
cd /f/Github/claude-plugins
OFFICIAL=~/.claude/plugins/marketplaces/claude-plugins-official/.claude-plugin/marketplace.json
OURS=.claude-plugin/marketplace.json

jq -e '
  .name == "yarikmix-plugins"
  and (.plugins | length) == 1
  and .plugins[0].name == "typescript-native-lsp"
  and .plugins[0].source == "./plugins/typescript-native-lsp"
  and .plugins[0].strict == false
  and .plugins[0].lspServers.typescript.command == "tsc"
  and .plugins[0].lspServers.typescript.args == ["--lsp", "--stdio"]
' "$OURS" && echo FIELDS_OK

diff \
  <(jq -S '.plugins[] | select(.name == "typescript-lsp") | .lspServers.typescript.extensionToLanguage' "$OFFICIAL") \
  <(jq -S '.plugins[0].lspServers.typescript.extensionToLanguage' "$OURS") \
  && echo EXTENSIONS_OK
```

Expected: `jq: error: Could not open .claude-plugin/marketplace.json`, ни `FIELDS_OK`, ни `EXTENSIONS_OK` не напечатаны.

- [ ] **Step 2: Создать `.gitattributes`**

```gitattributes
* text=auto eol=lf
```

- [ ] **Step 3: Создать `.claude-plugin/marketplace.json`**

```json
{
  "$schema": "https://anthropic.com/claude-code/marketplace.schema.json",
  "name": "yarikmix-plugins",
  "description": "Personal Claude Code plugins by Yaroslav Mihalev",
  "owner": {
    "name": "Yaroslav Mihalev"
  },
  "plugins": [
    {
      "name": "typescript-native-lsp",
      "description": "TypeScript 7 native language server (tsc --lsp) for Claude Code",
      "version": "1.0.0",
      "author": {
        "name": "Yaroslav Mihalev"
      },
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
  ]
}
```

- [ ] **Step 4: Прогнать проверку из Step 1**

Expected: напечатаны `true`, `FIELDS_OK` и `EXTENSIONS_OK`, `diff` ничего не выводит.

- [ ] **Step 5: Убедиться, что проверка умеет краснеть**

Сделать копию, сломать в ней расширение и прогнать вторую половину проверки по копии:

```bash
cd /f/Github/claude-plugins
OFFICIAL=~/.claude/plugins/marketplaces/claude-plugins-official/.claude-plugin/marketplace.json
BROKEN=$(mktemp)
cp .claude-plugin/marketplace.json "$BROKEN"
sed -i 's/"\.mts": "typescript"/"\.mts": "javascript"/' "$BROKEN"
diff \
  <(jq -S '.plugins[] | select(.name == "typescript-lsp") | .lspServers.typescript.extensionToLanguage' "$OFFICIAL") \
  <(jq -S '.plugins[0].lspServers.typescript.extensionToLanguage' "$BROKEN") \
  && echo EXTENSIONS_OK
rm "$BROKEN"
```

Expected: `diff` показывает строку с `.mts`, `EXTENSIONS_OK` не напечатан. Рабочий файл не тронут.

- [ ] **Step 6: Прочитать обе записи глазами**

Открыть официальную запись `typescript-lsp` и нашу. Отличаться должны только `name`, `description`, `author`, `source`, `command`, `args`. Поля `version`, `category`, `strict`, ключ сервера `typescript` и карта расширений — одинаковы.

- [ ] **Step 7: Дополнить спеку**

В `docs/superpowers/specs/2026-09-19-typescript-native-lsp-design.md` в блоке «Структура» добавить первой строкой дерева:

```text
.gitattributes
```

и после дерева абзац:

```markdown
`.gitattributes` задаёт `* text=auto eol=lf`: репозиторий собирается на Windows, а читают его и на POSIX, и без правила git подменяет LF на CRLF при checkout.
```

- [ ] **Step 8: Commit**

```bash
git add .gitattributes .claude-plugin/marketplace.json docs/superpowers/specs/2026-09-19-typescript-native-lsp-design.md
git commit -F - <<'EOF'
feat(marketplace): запись плагина typescript-native-lsp

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
```

---

### Task 2: README и лицензия

**Files:**
- Create: `plugins/typescript-native-lsp/README.md`
- Create: `plugins/typescript-native-lsp/LICENSE`
- Modify: `README.md` (сейчас одна строка `# claude-plugins`)

**Interfaces:**
- Consumes: из Task 1 — имя маркетплейса `yarikmix-plugins`, имя плагина `typescript-native-lsp`, путь `./plugins/typescript-native-lsp`.
- Produces: каталог плагина, на который указывает `source`. Без него установка из маркетплейса не найдёт плагин.

- [ ] **Step 1: Написать проверку и убедиться, что она падает**

Имена берутся из манифеста, а не вписываются в проверку второй раз: расхождение README с манифестом — ровно то, что она ловит.

```bash
cd /f/Github/claude-plugins
MARKET=$(jq -r '.name' .claude-plugin/marketplace.json)
PLUGIN=$(jq -r '.plugins[0].name' .claude-plugin/marketplace.json)
SOURCE=$(jq -r '.plugins[0].source' .claude-plugin/marketplace.json)

test -f "$SOURCE/README.md" && test -f "$SOURCE/LICENSE" && echo FILES_OK
grep -cF "/plugin install $PLUGIN@$MARKET" "$SOURCE/README.md" README.md
grep -cF "/plugin marketplace add YarikMix/claude-plugins" "$SOURCE/README.md" README.md
grep -cF "npm install -g typescript@7" "$SOURCE/README.md"
```

Expected: `FILES_OK` не напечатан, `grep` сообщает `No such file or directory` для README плагина и `0` для корневого.

- [ ] **Step 2: Создать `plugins/typescript-native-lsp/README.md`**

````markdown
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
````

- [ ] **Step 3: Создать `plugins/typescript-native-lsp/LICENSE`**

```text
MIT License

Copyright (c) 2026 Yaroslav Mihalev

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

- [ ] **Step 4: Заменить корневой `README.md` целиком**

````markdown
# claude-plugins

Личный маркетплейс плагинов для [Claude Code](https://claude.com/claude-code).

## Подключение

```text
/plugin marketplace add YarikMix/claude-plugins
```

Маркетплейс ставится на уровне пользователя и работает в любом репозитории.

## Плагины

| Плагин | Что делает | Установка |
|---|---|---|
| [typescript-native-lsp](plugins/typescript-native-lsp/README.md) | языковой сервер TypeScript 7 через `tsc --lsp` | `/plugin install typescript-native-lsp@yarikmix-plugins` |
````

- [ ] **Step 5: Прогнать проверку из Step 1**

Expected: `FILES_OK`; первый `grep` — `plugins/typescript-native-lsp/README.md:2` и `README.md:1`; второй — `plugins/typescript-native-lsp/README.md:2` и `README.md:1`; третий — `3` (блок «Требования», английский блок и таблица «Если LSP молчит»).

- [ ] **Step 6: Проверить относительную ссылку корневого README**

```bash
test -f plugins/typescript-native-lsp/README.md && echo LINK_OK
git diff --check
```

Expected: `LINK_OK`, `git diff --check` молчит.

- [ ] **Step 7: Commit**

```bash
git add README.md plugins/typescript-native-lsp/README.md plugins/typescript-native-lsp/LICENSE
git commit -F - <<'EOF'
docs(typescript-native-lsp): README плагина, лицензия и README маркетплейса

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
```

---

### Task 3: Локальная установка (выполняет владелец)

Агент этот шаг выполнить не может: slash-команды `/plugin` вводит пользователь, а языковые серверы поднимаются только на старте сессии.

**Files:** нет.

**Interfaces:**
- Consumes: закоммиченные Task 1 и Task 2.
- Produces: новая сессия Claude Code, в которой включён `typescript-native-lsp@yarikmix-plugins` и выключен `typescript-lsp@claude-plugins-official`.

- [ ] **Step 1: Проверить глобальный `tsc`**

```bash
tsc --version
```

Expected: `Version 7.0.2` или новее.

- [ ] **Step 2: Добавить маркетплейс из локального каталога и поставить плагин**

В Claude Code:

```text
/plugin marketplace add F:\Github\claude-plugins
/plugin install typescript-native-lsp@yarikmix-plugins
```

Expected: плагин появляется в `/plugin` как установленный. Если установка сообщает об ошибке манифеста — остановиться и принести текст ошибки: это возврат к Task 1, а не повод править наугад.

- [ ] **Step 3: Убедиться, что официальный плагин выключен**

В `~/.claude/settings.json` в `enabledPlugins` должно стоять `"typescript-lsp@claude-plugins-official": false`.

- [ ] **Step 4: Перезапустить Claude Code**

Закрыть сессию и открыть новую в `F:\Github\TP-Prepare\react-from-scratch-course`. До Task 4 не открывать и не править `.ts`-файлы: первая проба должна попасть на холодный сервер.

---

### Task 4: Пробы в новой сессии

**Files:**
- Create, затем delete: `F:\Github\TP-Prepare\react-from-scratch-course\23-svg\src\lsp-probe.ts`
- Modify: `docs/superpowers/specs/2026-09-19-typescript-native-lsp-design.md` (раздел «Риски» → результаты)

**Interfaces:**
- Consumes: сессию из Task 3.
- Produces: записанный в спеку результат проб — работает ли связка `tsc --lsp` с Claude Code.

- [ ] **Step 1: Холодная проба — самым первым вызовом LSP в сессии**

Инструмент `LSP`: `operation: findReferences`, `filePath: F:\Github\TP-Prepare\react-from-scratch-course\23-svg\src\render.ts`, `line: 45`, `character: 17`.

Expected: 2 ссылки — `23-svg/src/render.ts:45` и `23-svg/src/index.ts:5`. Если вернулась 1 — записать это как дефект холодного старта и повторить вызов; результат повтора тоже записать.

Контроль независимым инструментом (текстовый поиск по границам слова, а не LSP): `Grep` с шаблоном `\bcreateRoot\b` по `23-svg/src` должен дать те же две строки.

- [ ] **Step 2: Hover**

`operation: hover`, те же файл и позиция.

Expected: `function createRoot(container: Element): Root`.

- [ ] **Step 3: Ложная диагностика ушла**

Прочитать `23-svg/src/render.ts` и `23-svg/src/commit.ts` инструментом `Read`. В ответе не должно быть блока диагностики с `Cannot find name 'Node'`, `Cannot find name 'Element'` или `Property 'push' does not exist on type '{}'`.

Сверка с компилятором:

```bash
cd "/f/Github/TP-Prepare/react-from-scratch-course/23-svg" && bun run typecheck; echo "exit=$?"
```

Expected: `exit=0`.

- [ ] **Step 4: Контроль от обратного — сервер не просто молчит**

Пустая диагностика в Step 3 ничего не доказывает, если сервер не выдаёт диагностику вообще. Создать `23-svg/src/lsp-probe.ts`:

```ts
export const lspProbe: number = "text";
```

Expected от LSP: диагностика на этом файле с кодом `2322` (`Type 'string' is not assignable to type 'number'`).

Expected от компилятора — тот же код:

```bash
cd "/f/Github/TP-Prepare/react-from-scratch-course/23-svg" && bun run typecheck 2>&1 | grep -c "TS2322"
```

Expected: `1`.

- [ ] **Step 5: Удалить пробу и убедиться, что курс не тронут**

```bash
rm "/f/Github/TP-Prepare/react-from-scratch-course/23-svg/src/lsp-probe.ts"
cd "/f/Github/TP-Prepare/react-from-scratch-course" && git status --short -- 23-svg/src/lsp-probe.ts
cd 23-svg && bun run typecheck; echo "exit=$?"
```

Expected: `git status` по этому пути пуст, `exit=0`.

- [ ] **Step 6: Записать результат в спеку**

В `docs/superpowers/specs/2026-09-19-typescript-native-lsp-design.md` после раздела «Риски» добавить раздел «Результаты проб» с таблицей: проба, ожидалось, получено. Первый пункт «Рисков» («Связку `tsc --lsp` с Claude Code никто не запускал») переписать по факту: подтверждено или нет, с датой.

Если любая из проб 1–4 провалилась — не подгонять конфигурацию наугад. Записать наблюдение, остановиться и вернуться к дизайну: отвергнутые варианты (launcher в `bin/`, `lspServers` в манифесте плагина) перечислены в спеке.

- [ ] **Step 7: Commit**

```bash
cd /f/Github/claude-plugins
git add docs/superpowers/specs/2026-09-19-typescript-native-lsp-design.md
git commit -F - <<'EOF'
docs(spec): результаты проб typescript-native-lsp

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
```

После этого владелец выполняет `git push` и, если хочет ставить плагин с GitHub, а не из локального каталога, заменяет источник маркетплейса: `/plugin marketplace remove yarikmix-plugins`, затем `/plugin marketplace add YarikMix/claude-plugins`.
