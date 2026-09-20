# Serena: бэкенд `typescript_native` — дизайн

Дата: 2026-09-20

## Задача

Добавить в [Serena](https://github.com/oraios/serena) языковой бэкенд для нативного сервера TypeScript 7 (`tsc --lsp --stdio`) и довести его до PR в `oraios/serena`. Работа идёт в форке `YarikMix/serena`.

Штатный бэкенд `typescript` для этого не годится: он сам ставит `typescript@5.9.3` и `typescript-language-server@5.1.3` и запускает обёртку над `tsserver.js`. В TypeScript 7 `tsserver.js` нет, поэтому с настройкой `typescript_version: 7.0.2` сервер не стартует:

```text
Could not find a valid TypeScript installation. Please ensure that the "typescript"
dependency is installed in the workspace or that a valid `tsserver.path` is specified.
```

С настройками по умолчанию Serena работает и на проекте с TS 7, но анализирует его компилятором 5.9.3, а не тем, которым проект проверяется.

## Что установлено пробами

Пробы 2026-09-20: Windows 11, Serena `main` (`c4dc91a`), копия `react-from-scratch-course/23-svg/src`, сервер `typescript-go 7.0.2`, вызов языкового слоя `solidlsp` из скрипта, без MCP.

| Проба | Результат |
|---|---|
| штатный бэкенд + `ls_path` на обёртку `tsc --lsp` | не стартует: `assert init_response["capabilities"]["textDocumentSync"] == 2` |
| то же с обходом двух `assert` на capabilities | стартует за 10,1 с; диагностика по pull — `2322` на файле с ошибкой, 0 на чистых; символы документа найдены; вызов `createFiberRoot` найден |
| capabilities нативного сервера | `textDocumentSync` — объект `{"openClose": true, "change": 2, "save": true}`; у `completionProvider` больше `triggerCharacters`, чем ждёт штатный бэкенд. Оба ответа соответствуют LSP |
| `textDocument/references` на `createRoot`, напрямую к серверу | `includeDeclaration: false` → `[]`; `true` → `render.ts:45`, `index.ts:5`. Реэкспорт `export { createRoot } from` сервер считает объявлением |

Клиент Serena умеет pull-диагностику: `request_text_document_diagnostics` сначала шлёт `textDocument/diagnostic` и только при отказе ждёт `publishDiagnostics`. Для нового бэкенда здесь ничего писать не нужно.

## Предыстория в upstream

- Issue [#1402](https://github.com/oraios/serena/issues/1402) и PR [#1406](https://github.com/oraios/serena/pull/1406) (`typescript_tsgo`, +222/−6, 8 файлов, апрель 2026). Сопровождающий: «feel free to open a PR… adding `typescript_tsgo` is not a problem».
- PR не вошёл: CI падал на `npm install @typescript/native-preview@7.0.0-dev.20250601` (несуществующая версия), автор перестал отвечать и 2026-07-13 сам закрыл issue и PR.
- Замечания ревью, обязательные и для этой работы:
  1. отдельный файл тестов не нужен — новый бэкенд добавляется в параметризацию существующих TypeScript-тестов; добавление может быть условным локально, но в CI обязано быть, через `in_ci` из `conftest.py`; при необходимости правится `pytest.yml`;
  2. зависимость ставится на лету через npm, по образцу остальных npm-серверов;
  3. документация правится по итогу.
- С июля 2026 `tsc --lsp` входит в обычный пакет `typescript@7`; превью-пакет `@typescript/native-preview` не нужен.

## Решения

| Вопрос | Решение | Почему |
|---|---|---|
| Главный результат | PR в `oraios/serena` | польза всем, форк не надо поддерживать вечно; до слияния форк ставится через `uvx --from git+https://github.com/YarikMix/serena` |
| Форма | отдельный класс на базе `SolidLanguageServer` | на это согласился сопровождающий; штатный бэкенд не меняется; не наследуется tsserver-специфика |
| Какой TypeScript запускается | свой, зафиксированной версии, + стандартный `ls_path` | шаблон всех npm-серверов Serena; точное совпадение с проектом даёт `ls_path` на `node_modules/.bin/tsc` |
| Разница в `includeDeclaration` | сначала измерить | обход попадает в PR, только если без него падают существующие тесты или теряются обычные импорты |
| Имя | `typescript_native` | `tsgo` — имя превью-пакета; «native» останется верным и для TS 8. Переименование на ревью дёшево |

Отвергнуто: наследник `TypeScriptLanguageServer` (унаследует ожидание событий индексации tsserver, разбор его аварийных сообщений и жёсткие `assert`); смягчение `assert` в штатном бэкенде (меняет существующее поведение, на Windows требует обёртку `.cmd`, сопровождающий просил отдельный бэкенд); внешний пакет через entry point `solidlsp.language_server_registration` (в upstream ничего не попадает); автоопределение TypeScript проекта (такого поведения нет ни у одного бэкенда Serena).

## Компоненты

Состав файлов повторяет PR #1406 с учётом ревью.

### `src/solidlsp/language_servers/typescript_native_language_server.py`

Класс `TypeScriptNativeLanguageServer(SolidLanguageServer)` по образцу `vts_language_server.py`.

- SPDX-заголовок, как у соседних файлов.
- Константы версий по принятой в Serena схеме: `INITIAL_TYPESCRIPT_NATIVE_VERSION = "7.0.2"`, `DEFAULT_TYPESCRIPT_NATIVE_VERSION = "7.0.2"`. Каталог установки: `ts-native-lsp` для `INITIAL_*`, `ts-native-lsp-<версия>` для остальных.
- `DependencyProvider` на `LanguageServerDependencyProviderSinglePath`:
  - проверяет наличие `node` и `npm` тем же сообщением, что у соседей;
  - ставит `typescript@<версия>` через `build_npm_install_command`, учитывает настройку `npm_registry`;
  - настройки в `ls_specific_settings["typescript_native"]`: `typescript_version`, `npm_registry`, стандартный `ls_path`;
  - команда запуска: `[<путь к node_modules/.bin/tsc>, "--lsp", "--stdio"]`.
- `_create_base_initialize_params` возвращает только специфичное для языка; общие поля задаёт `initialize_params.py`, переопределять их нельзя.
- `_start_server`: обработчики `client/registerCapability`, `workspace/configuration`, `window/logMessage`, `$/progress`; после `initialize` проверяется только наличие `textDocumentSync`, без сравнения с точными значениями; затем `initialized`.
- `is_ignored_dirname` отбрасывает `node_modules`, `dist`, `build`, как штатный бэкенд. Каталог `coverage` игнорировать нельзя: существующий тест `test_source_dirs_not_ignored` требует, чтобы исходники в каталоге с таким именем оставались видимыми.
- `_get_wait_time_for_cross_file_referencing` и ожидание готовности — по результату измерения 2 ниже; по умолчанию без ожидания.
- TypeScript ниже 7 не знает `--lsp`. Поэтому управляемая версия проверяется до установки: `typescript_version` с мажорной версией меньше 7 отклоняется исключением, которое называет причину и настройку. Нечисловые значения (`latest`, `next`) пропускаются. Версия за `ls_path` не проверяется: её Serena не знает.

### `src/solidlsp/ls_config.py`

`TYPESCRIPT_NATIVE = "typescript_native"` в разделе альтернативных серверов рядом с `TYPESCRIPT_VTS`, с docstring; те же расширения файлов, что у `TYPESCRIPT`; привязка к новому классу в том же месте, где привязан `VtsLanguageServer`.

### Тесты

- `test/solidlsp/typescript/*.py`: `LanguageServerId.TYPESCRIPT_NATIVE` добавляется в `parametrize` рядом с `LanguageServerId.TYPESCRIPT`. Новых файлов тестов нет.
- `test/conftest.py`: маркер `typescript` для нового id; участие в списках языков — там же, где участвует `TYPESCRIPT_VTS`.
- Серверу нужны только `node` и `npm` — то же, что штатному бэкенду, поэтому ожидается безусловное добавление. Условие через `in_ci` вводится, только если измерение 3 покажет локальное препятствие.
- `.github/workflows/pytest.yml` правится, только если тестам не хватает окружения.

### Документация

- `docs/01-about/020_programming-languages.md`: строка про `typescript_native` — что это, когда выбирать, требование `node`/`npm`, настройки, известные отличия от штатного бэкенда.
- `CHANGELOG.md`: запись в разделе «Language Servers».

## Измерения до кода

Выполняются первыми, результаты записываются в этот документ; от них зависит код.

1. **`includeDeclaration: false`.** На тестовом TypeScript-репозитории Serena (лежит под `test/resources/repos`, точный путь берётся из фикстуры существующих тестов) сравнить ответы сервера при `false` и `true` для символа с импортом, вызовом и реэкспортом. Критерий: обход (`_send_references_request` с `true` + отсечение определения, найденного через `textDocument/definition`) входит в PR, если без него падает хотя бы один существующий тест или теряются обычные `import`. Иначе — строка в документации.
2. **Готовность сервера.** Шлёт ли `typescript-go` `$/progress` и отвечает ли на запросы сразу после `initialized`. Критерий: ожидание вводится, только если первый запрос после старта возвращает неполный результат.
3. **Существующие тесты без правок кода.** Прогнать `test/solidlsp/typescript` на новом бэкенде сразу после минимальной реализации; список упавших определяет остаток работы.

## Результаты измерений

2026-09-20, Windows 11, сервер `typescript-go 7.0.2` (глобальный `tsc`), клон Serena на `c4dc91a7`. Сервер опрошен напрямую скриптом на стандартной библиотеке Python, без Serena. Фикстура — копия `test/resources/repos/typescript/test_repo` с добавленным `reexport.ts` (`export { helperFunction } from "./index";`). Эталон мест от `grep -n helperFunction *.ts`: определение `index.ts:13`, вызов `index.ts:21`, реэкспорт `reexport.ts:1`, импорт `use_helper.ts:1`, вызов `use_helper.ts:5`.

База (Task 1): существующие `test_typescript_basic.py`, `test_typescript_diagnostics.py`, `test_typescript_ignored_dirs.py` на штатном бэкенде — 9 passed.

| Запрос ссылок на `helperFunction` | Ответ |
|---|---|
| нативный, холодный, `includeDeclaration=False` | `index.ts:21`, `use_helper.ts:5` |
| нативный, через 6 с, `includeDeclaration=False` | `index.ts:21`, `use_helper.ts:5` |
| нативный, `includeDeclaration=True` | `index.ts:13`, `index.ts:21`, `reexport.ts:1`, `use_helper.ts:1`, `use_helper.ts:5` |
| штатный бэкенд Serena на той же фикстуре | `index.ts:21`, `reexport.ts:1`, `use_helper.ts:1`, `use_helper.ts:5` |

Решения:

- **`NEED_REFERENCES_WORKAROUND` = да.** При `False` нативный сервер отбрасывает не только реэкспорт, но и обычный импорт `use_helper.ts:1`. Ответ при `True` без определения совпадает с ответом штатного бэкенда место в место, то есть обход даёт точный паритет.
- **`NEED_READINESS_WAIT` = нет.** Холодный ответ равен тёплому. Уведомлений `$/progress` сервер не присылает вовсе, хотя клиент объявил `window.workDoneProgress`.
- **`implementation` поддержан:** `implementationProvider: true`. Тесты на implementations параметризуются обоими бэкендами. `renameProvider`: `{"prepareProvider": true}`.
- **Поток `window/logMessage`.** Сервер шлёт сообщения уровня Info (`type: 3`) непрерывно: пара «Scheduling new diagnostics refresh… / Running scheduled diagnostics refresh» каждые 0,5 с — 24 строки за 6 с. Объявление клиентом `textDocument.diagnostic` на это не влияет (24 и 24). Отклонение от плана: обработчик пишет сообщения уровней Info и Log на `debug`, а Error и Warning — на `info`, иначе лог Serena забивается.

## Результаты реализации

2026-09-20, ветка `typescript-native-ls` клона `F:\Github\serena`, три коммита поверх `upstream/main` (`c4dc91a7`):

| Коммит | Содержание |
|---|---|
| `58a669af` | класс `TypeScriptNativeLanguageServer`, регистрация в `ls_config.py`, параметризация трёх тестовых файлов, тест проверки версии |
| `d14739eb` | переопределение `_send_references_request`, фикстура `reexport.ts`, тест `test_references_include_imports_and_reexports` |
| `725d1d91` | документация и changelog |

Итог: 9 файлов, +304/−13. Штатный бэкенд `typescript` не изменён.

Тесты на Windows: `pytest test/solidlsp/typescript` — 32 passed, 0 failed, 0 skipped (база до правок по трём файлам — 9 passed). В трёх параметризованных файлах: `[typescript_native]` — 10 PASSED, `[typescript]` — 10 PASSED, плюс тест проверки версии. `poe lint`, `poe format`, `poe type-check` — чисто.

Проверено, что тесты умеют краснеть: тест проверки версии падает (`DID NOT RAISE`) при условии `< 0` вместо `< 7`; тест ссылок на `typescript_native` был красным до обхода (`import in use_helper.ts not reported: {('use_helper.ts', 4), ('index.ts', 20)}`) при зелёном штатном бэкенде.

Проверено, что тесты шли на нужном сервере: бэкенд сам поставил `typescript@7.0.2` в `~/.solidlsp/language_servers/static/TypeScriptNativeLanguageServer/ts-native-lsp`, ответ `initialize` — `serverInfo: typescript-go 7.0.2`.

Проба на копии `react-from-scratch-course/23-svg/src` (эталоны — `tsc --noEmit` и `grep` по границам слова):

| Проба | Эталон | Получено |
|---|---|---|
| диагностика `src/lsp-probe.ts` | `TS2322` | `[2322]` |
| диагностика `src/render.ts`, `src/commit.ts` | ошибок нет | `[]`, `[]` |
| ссылки на `createRoot` | `src/index.ts:5` (реэкспорт) | `['src/index.ts:5']` |
| ссылки на `createFiberRoot` | `src/render.ts:6` (импорт), `src/render.ts:46` (вызов) | `['src/render.ts:46', 'src/render.ts:6']` |

Отклонения от плана:

- Поддержка implementations объявляется не в `ls_config.py`, а classmethod `supports_implementation_request` в классе бэкенда — так устроен upstream; пятого места регистрации в плане не было.
- Из `initialize` убраны `window.workDoneProgress` и обработчик `window/workDoneProgress/create`: сервер `$/progress` не присылает.
- `window/logMessage` уровней Info и Log пишется на `debug` (см. «Результаты измерений»).
- Тест ссылок строже планового: проверяет конкретные строки импорта, вызова и реэкспорта и отсутствие самого определения.
- Обход ссылок переписан под проверку типов `ty`: ответ `definition` сужается по `isinstance(..., list)`, ключ сравнения строит типизированный `_definition_start`.

Наблюдение про длинные пути Windows. Первая проба направила каталог установки (`solidlsp_dir`) в глубокий scratchpad, путь до `tsc.exe` вышел 286 символов, и сервер умер на `initialize`: Node не смог разрешить `#getExePath` из `typescript/lib/tsc.js` (`ERR_PACKAGE_IMPORT_NOT_DEFINED`). С каталогом по умолчанию та же проба прошла. Это свойство пакета `typescript@7` под Windows, а не бэкенда, но пользователь с длинным домашним путём увидит невнятную ошибку; в PR не входит.

### Сквозная проверка через MCP

2026-09-20. Ветка запушена в форк (`YarikMix/serena@typescript-native-ls`), PR не открыт по решению владельца. Временный проект — копия `23-svg/src` с пробным файлом, язык `typescript_native` задан через `serena project create --language typescript_native`.

| Проверка | Результат |
|---|---|
| `serena project health-check` | пройден: старт сервера 0,083 с; `get_symbols_overview`, `find_symbol`, `find_referencing_symbols` отработали; у `isValidElement` найдена 1 ссылка — реэкспорт `index.ts:1`, что совпадает с `grep` и подтверждает обход на уровне инструмента |
| MCP-сервер по stdio (`serena start-mcp-server --context claude-code --project <path>`), клиент на MCP SDK | 21 инструмент; `find_symbol createRoot` → `src/render.ts`, строки 44–61 |
| `find_referencing_symbols createRoot` через MCP | `src/index.ts`, строка 4 (реэкспорт) |
| `find_referencing_symbols createFiberRoot` через MCP | `src/render.ts`, строки 5 (импорт) и 45 (вызов) |
| `get_diagnostics_for_file` через MCP | `src/lsp-probe.ts` → `2322 Type 'string' is not assignable to type 'number'`; `src/render.ts`, `src/commit.ts` → `{}`. Совпадает с `tsc --noEmit` |

Найдено и закрыто по ходу: список языков в `src/serena/resources/project.template.yml` генерируется `scripts/print_language_list.py` и не содержал `typescript_native`; перегенерирован, изменились ровно две строки (коммит `7e08af72`).

Побочное наблюдение, не наше: `serena project health-check` на консоли Windows с cp1251 падает при печати итоговой строки с эмодзи (`UnicodeEncodeError`), хотя сама проверка пройдена; обходится `PYTHONIOENCODING=utf-8`.

### Живая сессия Claude Code

2026-09-20, проект `F:\Github\2026_H2\react` (TypeScript 7, 40 файлов). Serena подключена из ветки форка: `claude mcp add serena -- uvx --from git+https://github.com/YarikMix/serena@typescript-native-ls serena start-mcp-server --context claude-code --project <path>`; язык задан командой `serena project create --language typescript_native <path>` до первого запуска — при автоопределении Serena выбрала бы `typescript` и молча подняла бы штатный бэкенд. Лог сессии `~/.serena/logs/2026-09-20/mcp_20260920-131148_8148.txt` подтверждает `Starting language server typescript_native`, старт 0,079 с. Каждый ответ агента сверен независимым инструментом.

| Просьба агенту | Ответ | Сверка |
|---|---|---|
| кто ссылается на `bubbleSubtreeFlags` | определение `flags.ts:16`, импорт `fiber.ts:18`, вызов `fiber.ts:64` | `grep` по границе слова — те же три места; импорт в ответе есть, то есть обход ссылок работает в живой сессии |
| диагностика `src/hooks.ts` | пусто | контроль от обратного: временный файл с `const x: number = "text"` через тот же бэкенд на этом проекте дал `2322`, `hooks.ts` — пусто; канал жив, файл чист |
| переименовать приватную `getKey` → `getNodeKey` | 1 файл, 4 строки | `git diff`: объявление `reconcile.ts:149` и вызовы на строках 81, 104, 157; `\bgetKey\b` в `src` не осталось |
| переименовать экспортируемую `bubbleSubtreeFlags` → `bubbleChildFlags` | 2 файла, 3 строки | `git diff`: объявление `flags.ts:16`, импорт `fiber.ts:18`, вызов `fiber.ts:64`; старое имя осталось только в заметке `.serena/memories/core.md` |

Наблюдения:

- Диагностика по файлу не заменяет `typecheck`: в этом проекте `tsc --noEmit` падает с `TS2688: Cannot find type definition file for 'bun'` (зависимости не установлены), а `get_diagnostics_for_file` отвечает «пусто» — ошибка уровня конфигурации к файлу не привязана.
- Семантическое переименование не трогает заметки онбординга Serena: после рефакторинга их правят отдельно.
- В проекте одновременно подключён CodeGraph, чей `CLAUDE.md` советует идти в граф первым; в просьбах агенту Serena называлась явно.

### Инструменты редактирования

Все четыре (`replace_symbol_body`, `insert_after_symbol`, `insert_before_symbol`, `safe_delete_symbol`) находят место правки по диапазону символа из `textDocument/documentSymbol`, поэтому проверялся паритет диапазонов: на 24 файлах проекта оба бэкенда дали 523 общих символа, диапазон тела совпал у всех 523. В живой сессии `replace_symbol_body`, `insert_after_symbol` и `safe_delete_symbol` на функции `getKey` дали диффы ровно по телу функции; удаление вернуло файл к состоянию после первого шага.

`replace_symbol_body` на `export const REACT_MEMO_TYPE = …` записал `export const export const … ;;`. Диапазон символа у обоих бэкендов одинаков (`4:13–4:55`, только декларатор без `export const` и `;`), то есть это общая ошибка Serena — upstream #1956, исправление в #1972 — а не нашего бэкенда; в PR не входит.

## Доработка паритета

2026-09-20, четыре коммита поверх первых четырёх (`e1fc7d44`, `7ecdbd3a`, `7c444b9a`, `4aea635e`); PR #1 форка — 8 коммитов, 11 файлов, +474/−15. `pytest test/solidlsp/typescript` — 37 passed, 0 skipped; `poe lint`, `poe format`, `poe type-check` чисто.

Отличия нативного сервера от штатного, измеренные на 24 файлах проекта, и что с ними сделано:

| Отличие | Масштаб | Решение |
|---|---|---|
| спецификаторы `import … from` и `export … from` как корневые символы Variable | 166 из 171 лишнего символа | отфильтрованы |
| анонимные стрелочные функции `<function>`, сигнатуры перегрузок под другой позицией имени | 5 | оставлены |
| сокращённые свойства объектных литералов есть только у штатного | 10 | оставлены |
| `kind`: `const` — Variable вместо Constant (113), `type X = {…}` — Class вместо Variable (27), ещё 4 | 144 | не переводятся: перевод потребовал бы угадывать по тексту; описано в документации |
| шум при остановке в логе уровня ERROR | каждая остановка под нагрузкой | понижен до debug |
| невнятный сбой на длинных путях Windows | при пути запуска ≥ 260 | предупреждение |

**Фильтр спецификаторов.** Переопределены `_build_document_symbols_from_raw_symbols` и `_document_symbols_cache_fingerprint` (прецедент — fortran-бэкенд). Операторы ищутся по тексту строгой грамматикой клаузы: между ключевым словом и `from` допускаются имя, `* as x` или список в фигурных скобках без `;` и вложенных скобок — чтобы `import x = require("y")` не поглотил объявления до следующего `from`. Отбрасывается только корневой символ вида Variable, целиком лежащий внутри такого оператора. Отвергнутый критерий «`range` совпадает с `selectionRange`»: ловил 118 из 130 импортов и давал 18 ложных срабатываний на общих символах (`catch (error)`, `for (const child of …)`, сокращённые свойства). Итог на проекте: лишних символов 171 → 5, из 523 общих не отброшен ни один. Ссылки не теряются: штатный бэкенд приписывает ссылку из импорта символу-файлу, и нативный после фильтра делает то же. Через MCP ответы `find_symbol createRoot` (одно совпадение вместо двух) и `find_referencing_symbols` на обоих бэкендах совпали место в место.

**Шум остановки.** Воспроизводится под нагрузкой 4 раза из 4: сервер пишет в stderr `context canceled` и шлёт `window/logMessage` уровня Error `error handling method 'exit': EOF` — про запросы, брошенные при завершении. Строки со словом «error» базовый класс пишет на ERROR. Переопределён `_determine_log_level`, тот же признак учтён в обработчике `window/logMessage`. После правки при остановке под нагрузкой на уровне INFO и выше нет ни одной строки.

**Длинные пути.** Критерий уточнялся трижды по факту. «Любой файл установки ≥ 260» срабатывал там, где сервер стартует: самые длинные пути у `lib.*.d.ts`, а их читает нативный бинарник, которому длина не мешает. «Любой файл пакета-запускателя» — тоже: самый длинный лежит в `vendor/`, который режим `--lsp` не грузит. Итоговый критерий — четыре файла, которые Node загружает для запуска бинарника: `bin/tsc`, `package.json`, `lib/tsc.js`, `lib/getExePath.js`. Проверено на двух каталогах установки: в коротком предупреждения нет и сервер стартует, в длинном (280 символов) предупреждение предшествует сбою. Это предупреждение, а не запрет: поведение при включённых в системе длинных путях не проверялось.

Каждый новый тест сначала был красным: тест символов — на `typescript_native` при зелёном штатном (`import specifiers reported as document symbols: {'ConsoleGreeter', 'indexModule', 'Greeter'}`), три юнит-теста — на отсутствующих функциях или на уровне 40 вместо 10.

Побочное наблюдение: `test_cross_package_find_references` (штатный бэкенд, файл не тронут) упал один раз из пяти полных прогонов и ни разу — отдельно и на закоммиченном состоянии; нестабильный тест upstream.

Не проверено: Linux и macOS (проверит CI upstream).

## Проверка

- `pytest test/solidlsp/typescript` на Windows — оба бэкенда зелёные; штатный обязан остаться зелёным без изменений.
- `poe format`, `poe type-check`.
- Проба на копии `23-svg`: диагностика `2322`, чистые файлы без ошибок, символы, ссылки. Проба для ссылок обязана включать символ с реэкспортом — именно на нём поведение серверов расходится, и без него зелёный результат ничего не говорит.
- Сквозной запуск через MCP с Claude Code — последним шагом, во временном проекте, не в курсе.

## Git

- Клон форка: `F:\Github\serena`; remote `origin` — `YarikMix/serena`, `upstream` — `oraios/serena`.
- Ветка `typescript-native-ls` от свежего `upstream/main`. Коммиты в ветку разрешены.
- Push и открытие PR — только по отдельной команде владельца. CLA принимает владелец, когда бот попросит.
- Спека и план живут в `YarikMix/claude-plugins`, а не в ветке PR: в upstream они попасть не должны.

## Риски

- **Ревью upstream.** Сопровождающие могут попросить другое имя или иную структуру; PR может ждать долго. До слияния рабочий вариант — форк.
- **Поведение `typescript-go` меняется.** Сервер молод; решения по `includeDeclaration` и готовности привязаны к 7.0.2 и записываются с версией.
- **CI upstream.** Локально проверяется Windows; Linux и macOS проверит только CI после открытия PR.
- **Инструменты редактирования Serena** (переименование, замена тела символа) покрываются только в объёме существующих тестов.

## Вне этой работы

- Автоопределение TypeScript проекта.
- Изменения штатного бэкенда `typescript`.
- Сообщение о поведении `includeDeclaration` в `microsoft/typescript-go`.
- Подключение Serena к курсу `react-from-scratch-course`.
