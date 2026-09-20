# Serena `typescript_native` Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Добавить в Serena бэкенд `typescript_native`, который запускает нативный языковой сервер TypeScript 7 (`tsc --lsp --stdio`), и довести его до состояния, пригодного для PR в `oraios/serena`.

**Architecture:** Отдельный класс `TypeScriptNativeLanguageServer(SolidLanguageServer)` с `DependencyProvider` на `LanguageServerDependencyProviderSinglePath`: ставит зафиксированный `typescript@7.x` через npm в каталог ресурсов Serena и запускает `[<node_modules/.bin/tsc>, "--lsp", "--stdio"]`. Штатный бэкенд `typescript` не меняется. Тесты — существующие TypeScript-тесты, параметризованные вторым бэкендом; диагностика идёт через уже имеющийся общий pull-код Serena.

**Tech Stack:** Python 3.13, `uv`, `poe` (ruff, ty), pytest; Node.js + npm; TypeScript 7.0.2 (`typescript-go`).

**Spec:** `F:\Github\claude-plugins\docs\superpowers\specs\2026-09-20-serena-typescript-native-design.md`

## Global Constraints

- Рабочий клон: `F:\Github\serena` (в Git Bash — `/f/Github/serena`). Remote `origin` — `YarikMix/serena`, `upstream` — `oraios/serena`. Ветка `typescript-native-ls` от `upstream/main`.
- Коммиты в ветку разрешены. `git push` и открытие PR — только по отдельной команде владельца. CLA принимает владелец.
- Спека и план живут в `F:\Github\claude-plugins`; в клон Serena они не попадают.
- Имя бэкенда: `typescript_native`; enum `LanguageServerId.TYPESCRIPT_NATIVE`; класс `TypeScriptNativeLanguageServer`; файл `src/solidlsp/language_servers/typescript_native_language_server.py`.
- Версии: `INITIAL_TYPESCRIPT_NATIVE_VERSION = "7.0.2"`, `DEFAULT_TYPESCRIPT_NATIVE_VERSION = "7.0.2"`. Каталог установки: `ts-native-lsp` для `INITIAL_*`, `ts-native-lsp-<версия>` для остальных.
- Настройки в `ls_specific_settings["typescript_native"]`: `typescript_version`, `npm_registry`, стандартный `ls_path`.
- Команда запуска: `[<core_path>, "--lsp", "--stdio"]`.
- `is_ignored_dirname` отбрасывает ровно `node_modules`, `dist`, `build`. Каталог `coverage` не игнорируется.
- Штатный бэкенд `typescript` (`typescript_language_server.py`) не редактируется.
- Отдельного файла тестов для нового бэкенда нет: он добавляется в параметризацию существующих тестов (требование ревью PR #1406).
- Новый исходный файл начинается с docstring и строки `# SPDX-License-Identifier: MIT`, как соседние файлы `src/solidlsp`.
- Тексты, попадающие в upstream (код, docstring, документация, changelog, сообщения коммитов), — по-английски. Сообщения коммитов — в стиле upstream: одна повелительная строка без префикса-типа, например `Add typescript_native language server backend`.
- Каждое сообщение коммита заканчивается строкой `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Upstream активно меняется (2026-09 влит PR #2057 «Reify language backends»). Места правок ищутся по якорям-строкам, приведённым в задачах, а не по номерам строк. Если якорь не найден — остановиться и перечитать файл, а не править наугад.
- Репозиторий курса `F:\Github\TP-Prepare\react-from-scratch-course` не изменяется. Пробы на его коде идут на копии в scratchpad.
- `<scratchpad>` в командах — абсолютный путь каталога scratchpad текущей сессии (он назван в системном промпте сессии); перед запуском подставляется целиком. Временные файлы — только там; кеш `uv` остаётся стандартным (переопределение `UV_CACHE_DIR` в глубокий каталог ломает git на Windows: `Filename too long`).

## File Structure

| Файл (в клоне Serena) | Ответственность |
|---|---|
| `src/solidlsp/language_servers/typescript_native_language_server.py` (создать) | класс бэкенда: проверка версии, установка через npm, команда запуска, initialize, старт |
| `src/solidlsp/ls_config.py` (править) | enum-значение, признак «экспериментальный/вторичный», matcher расширений, привязка класса |
| `test/conftest.py` (править) | алиас тестового репозитория, список бэкендов TypeScript, маркер pytest |
| `test/solidlsp/typescript/test_typescript_basic.py` (править) | параметризация вторым бэкендом + тест проверки версии |
| `test/solidlsp/typescript/test_typescript_diagnostics.py` (править) | параметризация вторым бэкендом |
| `test/solidlsp/typescript/test_typescript_ignored_dirs.py` (править) | параметризация вторым бэкендом |
| `docs/01-about/020_programming-languages.md` (править) | описание `typescript_native` |
| `CHANGELOG.md` (править) | запись в разделе «Language Servers» |

Вне плана: `test_typescript_cross_package.py` и `test_typescript_automatic_type_acquisition.py` — они создают сервер вручную и проверяют поведение tsserver (ATA, кросс-пакетные ссылки штатного бэкенда).

---

### Task 1: Рабочий клон и зелёная база

**Files:** нет изменений в репозитории.

**Interfaces:**
- Consumes: форк `YarikMix/serena`.
- Produces: клон `F:\Github\serena` на ветке `typescript-native-ls` с окружением `.venv`; зафиксированный результат прогона существующих TypeScript-тестов на Windows — база, с которой сравниваются все следующие прогоны.

- [ ] **Step 1: Клонировать форк и подключить upstream**

```bash
cd /f/Github
git clone git@github.com:YarikMix/serena.git serena
cd serena
git remote add upstream https://github.com/oraios/serena.git
git fetch upstream
git checkout -b typescript-native-ls upstream/main
git log --oneline -1
```

Expected: ветка `typescript-native-ls` создана, последняя строка — верхний коммит `upstream/main`.

- [ ] **Step 2: Собрать окружение разработки** (по `CONTRIBUTING.md`)

```bash
cd /f/Github/serena
uv venv -p 3.13
uv sync --extra dev
uv run python -c "import solidlsp, serena; print('ok')"
```

Expected: `ok`.

- [ ] **Step 3: Проверить инструменты**

```bash
node --version && npm --version && tsc --version
```

Expected: Node ≥ 18, npm есть, `tsc` — `Version 7.0.2` или новее.

- [ ] **Step 4: Прогнать существующие TypeScript-тесты — база**

```bash
cd /f/Github/serena
uv run pytest test/solidlsp/typescript/test_typescript_basic.py test/solidlsp/typescript/test_typescript_diagnostics.py test/solidlsp/typescript/test_typescript_ignored_dirs.py -v 2>&1 | tail -25
```

Expected: все тесты `PASSED` с идентификатором `[typescript]`. Если на Windows что-то падает ещё до наших правок — записать имена упавших тестов и текст ошибки в спеку (раздел «Результаты»), не чинить: это база, а не наша работа. Дальнейшие прогоны сравниваются с ней.

- [ ] **Step 5: Сверить якоря с живым кодом**

```bash
cd /f/Github/serena
grep -n "TYPESCRIPT_VTS" src/solidlsp/ls_config.py
grep -n "_LANGUAGE_REPO_ALIASES\|PYTHON_LANGUAGE_BACKENDS\|LanguageServerId.TYPESCRIPT: \[pytest.mark.typescript\]" test/conftest.py
grep -n "class DependencyProvider\|def _create_launch_command\|def _create_dependency_provider" src/solidlsp/language_servers/typescript_language_server.py
```

Expected: `TYPESCRIPT_VTS` встречается в `ls_config.py` четыре раза (enum, `is_experimental`, matcher, привязка класса); в `conftest.py` есть словарь `_LANGUAGE_REPO_ALIASES`, список `PYTHON_LANGUAGE_BACKENDS` и строка маркера для `TYPESCRIPT`; в штатном бэкенде есть вложенный `DependencyProvider` с `_create_launch_command`. Если чего-то нет — upstream переехал (PR #2057 и соседние): перечитать файлы и перенести правки задач 3 на новые места, сохранив смысл.

Коммита в этой задаче нет.

---

### Task 2: Измерения нативного сервера

Три факта, от которых зависит код. Измеряются напрямую у `tsc --lsp`, без Serena: проба не должна делить предположения с кодом, который по ней будет написан.

**Files:**
- Create (scratchpad, не в репозитории): `<scratchpad>/ts-native-measure/measure.py`
- Create (scratchpad): копия `test/resources/repos/typescript/test_repo` + файл `reexport.ts`
- Modify: `F:\Github\claude-plugins\docs\superpowers\specs\2026-09-20-serena-typescript-native-design.md` (новый раздел «Результаты измерений»)

**Interfaces:**
- Consumes: клон из Task 1, глобальный `tsc` 7.x.
- Produces: три записанных решения — `NEED_REFERENCES_WORKAROUND` (да/нет), `NEED_READINESS_WAIT` (да/нет), список событий `$/progress`. Task 3 и Task 4 читают их из спеки.

- [ ] **Step 1: Собрать фикстуру с реэкспортом**

В тестовом репозитории Serena реэкспортов нет (`use_helper.ts` импортирует `helperFunction` из `./index`, `index.ts` вызывает её сам), поэтому разница в `includeDeclaration` на нём не видна. Фикстура дополняется в копии, upstream-фикстура не трогается.

```bash
M="<scratchpad>/ts-native-measure"
rm -rf "$M" && mkdir -p "$M"
cp -r /f/Github/serena/test/resources/repos/typescript/test_repo "$M/repo"
printf 'export { helperFunction } from "./index";\n' > "$M/repo/reexport.ts"
ls "$M/repo"
```

Expected: в списке есть `index.ts`, `use_helper.ts`, `reexport.ts`, `tsconfig.json`.

- [ ] **Step 2: Написать `measure.py`**

```python
import json
import pathlib
import shutil
import subprocess
import sys
import threading
import time

repo = pathlib.Path(sys.argv[1]).resolve()
tsc = shutil.which("tsc")
assert tsc is not None, "tsc not found on PATH"

proc = subprocess.Popen([tsc, "--lsp", "--stdio"], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, cwd=repo)
started = time.time()
responses: dict[int, dict] = {}
notifications: list[tuple[float, str, dict]] = []
lock = threading.Condition()
next_id = 0


def send(message: dict) -> None:
    body = json.dumps({"jsonrpc": "2.0", **message}).encode("utf-8")
    proc.stdin.write(b"Content-Length: %d\r\n\r\n" % len(body) + body)
    proc.stdin.flush()


def reader() -> None:
    while True:
        length = None
        while True:
            line = proc.stdout.readline()
            if not line:
                return
            line = line.strip()
            if not line:
                break
            if line.lower().startswith(b"content-length:"):
                length = int(line.split(b":")[1])
        message = json.loads(proc.stdout.read(length))
        if "method" in message and "id" in message:
            items = message.get("params", {}).get("items")
            send({"id": message["id"], "result": [None for _ in items] if items is not None else None})
        elif "method" in message:
            notifications.append((time.time() - started, message["method"], message.get("params", {})))
        else:
            with lock:
                responses[message["id"]] = message
                lock.notify_all()


threading.Thread(target=reader, daemon=True).start()


def request(method: str, params: dict, timeout: float = 30.0) -> dict:
    global next_id
    next_id += 1
    request_id = next_id
    send({"id": request_id, "method": method, "params": params})
    with lock:
        lock.wait_for(lambda: request_id in responses, timeout=timeout)
    return responses.get(request_id, {"timeout": True})


def uri(name: str) -> str:
    return (repo / name).as_uri()


def position_of(name: str, needle: str, identifier: str) -> dict:
    for line_number, line in enumerate((repo / name).read_text(encoding="utf-8").splitlines()):
        if needle in line:
            return {"line": line_number, "character": line.index(identifier)}
    raise AssertionError(f"{needle!r} not found in {name}")


def references(name: str, position: dict, include_declaration: bool) -> list[str]:
    result = request(
        "textDocument/references",
        {"textDocument": {"uri": uri(name)}, "position": position, "context": {"includeDeclaration": include_declaration}},
    )
    locations = result.get("result") or []
    return sorted(f"{loc['uri'].rsplit('/', 1)[-1]}:{loc['range']['start']['line'] + 1}" for loc in locations)


init = request(
    "initialize",
    {
        "processId": None,
        "rootUri": repo.as_uri(),
        "workspaceFolders": [{"uri": repo.as_uri(), "name": repo.name}],
        "capabilities": {
            "textDocument": {"references": {}, "publishDiagnostics": {"relatedInformation": True}},
            "workspace": {"workspaceFolders": True, "configuration": True},
            "window": {"workDoneProgress": True},
        },
    },
)
capabilities = init["result"]["capabilities"]
print("serverInfo:", json.dumps(init["result"].get("serverInfo")))
print("capability keys:", sorted(capabilities))
print("implementationProvider:", json.dumps(capabilities.get("implementationProvider")))
print("renameProvider:", json.dumps(capabilities.get("renameProvider")))
print("diagnosticProvider:", json.dumps(capabilities.get("diagnosticProvider")))

send({"method": "initialized", "params": {}})
send(
    {
        "method": "textDocument/didOpen",
        "params": {"textDocument": {"uri": uri("index.ts"), "languageId": "typescript", "version": 1, "text": (repo / "index.ts").read_text(encoding="utf-8")}},
    }
)

definition = position_of("index.ts", "export function helperFunction", "helperFunction")
cold = references("index.ts", definition, False)
print("COLD  includeDeclaration=False:", cold)
time.sleep(6)
warm = references("index.ts", definition, False)
print("WARM  includeDeclaration=False:", warm)
print("WARM  includeDeclaration=True :", references("index.ts", definition, True))

print("notifications in first 6s:")
for at, method, params in notifications:
    detail = params.get("value", {}).get("kind") if method == "$/progress" else ""
    print(f"  {at:5.2f}s {method} {detail}")

proc.kill()
```

- [ ] **Step 3: Запустить и сохранить вывод**

```bash
cd "<scratchpad>/ts-native-measure" && python measure.py repo | tee measure.out
```

Expected: скрипт печатает `serverInfo` с `typescript-go`, три строки со списками ссылок и перечень уведомлений. Если скрипт виснет дольше минуты — прервать, проверить `tsc --version`.

- [ ] **Step 4: Вывести решения по записанным критериям**

Ожидаемый полный набор мест, где упоминается `helperFunction`, кроме самого определения `index.ts:13`: вызов `index.ts:21`, импорт `use_helper.ts:1`, вызов `use_helper.ts:5`, реэкспорт `reexport.ts:1`. Номера строк сверить с файлами копии командой `grep -n helperFunction repo/*.ts` — это независимый от LSP источник.

| Решение | Правило |
|---|---|
| `NEED_REFERENCES_WORKAROUND = да` | в `WARM includeDeclaration=False` нет импорта `use_helper.ts:1` **или** нет любого из вызовов. Потеря только реэкспорта `reexport.ts:1` = `нет` (описывается в документации) |
| `NEED_READINESS_WAIT = да` | список `COLD` короче списка `WARM` |
| `implementation` поддержан | `implementationProvider` не `null` — иначе два теста на implementations в Task 3 остаются только на штатном бэкенде |

- [ ] **Step 5: Записать результаты в спеку**

В `2026-09-20-serena-typescript-native-design.md` после раздела «Измерения до кода» добавить раздел «Результаты измерений» с датой, версией сервера из `serverInfo`, тремя списками ссылок дословно, списком уведомлений и тремя решениями из Step 4.

- [ ] **Step 6: Commit (в `claude-plugins`)**

```bash
cd /f/Github/claude-plugins
git add docs/superpowers/specs/2026-09-20-serena-typescript-native-design.md
git commit -F - <<'EOF'
docs(spec): результаты измерений typescript-go для бэкенда Serena

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
```

---

### Task 3: Бэкенд, регистрация и параметризация тестов

**Files:**
- Create: `src/solidlsp/language_servers/typescript_native_language_server.py`
- Modify: `src/solidlsp/ls_config.py` (четыре места с якорем `TYPESCRIPT_VTS`)
- Modify: `test/conftest.py` (якоря `_LANGUAGE_REPO_ALIASES`, `PYTHON_LANGUAGE_BACKENDS`, строка маркера `TYPESCRIPT`)
- Modify: `test/solidlsp/typescript/test_typescript_basic.py`, `test_typescript_diagnostics.py`, `test_typescript_ignored_dirs.py`

**Interfaces:**
- Consumes: решения `NEED_READINESS_WAIT` и «`implementation` поддержан» из Task 2.
- Produces: `LanguageServerId.TYPESCRIPT_NATIVE`; класс `TypeScriptNativeLanguageServer`; функция `ensure_native_lsp_version(version: str) -> None` (бросает `ValueError`); список `TYPESCRIPT_LANGUAGE_BACKENDS` в `test/conftest.py`. Task 4 переопределяет в классе `_send_references_request`.

- [ ] **Step 1: Параметризовать тесты — они должны покраснеть**

В `test/conftest.py`:

1. В словарь `_LANGUAGE_REPO_ALIASES` добавить строку:

```python
    LanguageServerId.TYPESCRIPT_NATIVE: LanguageServerId.TYPESCRIPT,
```

2. Сразу после строки `PYTHON_LANGUAGE_BACKENDS = [...]` добавить:

```python
TYPESCRIPT_LANGUAGE_BACKENDS = [LanguageServerId.TYPESCRIPT, LanguageServerId.TYPESCRIPT_NATIVE]
```

3. В словарь маркеров, сразу после строки `LanguageServerId.TYPESCRIPT: [pytest.mark.typescript],`, добавить:

```python
    LanguageServerId.TYPESCRIPT_NATIVE: [pytest.mark.typescript],
```

В трёх тестовых файлах добавить импорт `TYPESCRIPT_LANGUAGE_BACKENDS` из `test.conftest` и заменить в декораторах

```python
@pytest.mark.parametrize("language_server", [LanguageServerId.TYPESCRIPT], indirect=True)
```

на

```python
@pytest.mark.parametrize("language_server", TYPESCRIPT_LANGUAGE_BACKENDS, indirect=True)
```

Исключение — `test_find_implementations` и `test_request_implementing_symbols` в `test_typescript_basic.py`: если Task 2 показал `implementationProvider: null`, их декораторы остаются на `[LanguageServerId.TYPESCRIPT]`. Иначе заменяются тоже, а `LanguageServerId.TYPESCRIPT_NATIVE` добавляется в множество `_VERIFIED_IMPLEMENTATION_LANGUAGES` в `test/conftest.py`.

В конец `test_typescript_basic.py` добавить тест проверки версии:

```python
@pytest.mark.typescript
def test_native_backend_rejects_typescript_without_native_lsp() -> None:
    from solidlsp.language_servers.typescript_native_language_server import ensure_native_lsp_version

    with pytest.raises(ValueError, match="typescript_version"):
        ensure_native_lsp_version("5.9.3")
    with pytest.raises(ValueError, match="typescript_version"):
        ensure_native_lsp_version("^6.0.3")
    ensure_native_lsp_version("7.0.2")
    ensure_native_lsp_version("~7.1.0")
    ensure_native_lsp_version("latest")
```

- [ ] **Step 2: Убедиться, что тесты красные**

```bash
cd /f/Github/serena
uv run pytest test/solidlsp/typescript/test_typescript_basic.py -q 2>&1 | tail -5
```

Expected: ошибка сбора `AttributeError: TYPESCRIPT_NATIVE` (enum-значения ещё нет).

- [ ] **Step 3: Зарегистрировать бэкенд в `src/solidlsp/ls_config.py`**

Четыре правки, каждая рядом с якорем `TYPESCRIPT_VTS`:

1. В enum, сразу после docstring значения `TYPESCRIPT_VTS`:

```python
    TYPESCRIPT_NATIVE = "typescript_native"
    """Use the native TypeScript language server that ships with TypeScript 7+ (``tsc --lsp``),
    see https://github.com/microsoft/typescript-go"""
```

2. В множестве внутри `is_experimental`, после `self.TYPESCRIPT_VTS,`:

```python
            self.TYPESCRIPT_NATIVE,
```

3. В matcher расширений заменить

```python
            case self.TYPESCRIPT | self.TYPESCRIPT_VTS:
```

на

```python
            case self.TYPESCRIPT | self.TYPESCRIPT_VTS | self.TYPESCRIPT_NATIVE:
```

4. В сопоставлении id → класс, сразу после ветки `case self.TYPESCRIPT_VTS:`:

```python
            case self.TYPESCRIPT_NATIVE:
                from solidlsp.language_servers.typescript_native_language_server import TypeScriptNativeLanguageServer

                return TypeScriptNativeLanguageServer
```

- [ ] **Step 4: Создать `src/solidlsp/language_servers/typescript_native_language_server.py`**

```python
"""
Language Server implementation for TypeScript/JavaScript using the native language server
that ships with TypeScript 7+ (``tsc --lsp``), see https://github.com/microsoft/typescript-go.
Contrary to typescript-language-server, it speaks LSP directly and does not depend on tsserver.
"""
# SPDX-License-Identifier: MIT

import logging
import os
import re
import shutil

from overrides import override
from sensai.util.logging import LogTime

from solidlsp.ls import LanguageServerDependencyProvider, LanguageServerDependencyProviderSinglePath, SolidLanguageServer
from solidlsp.ls_config import LanguageServerConfig
from solidlsp.settings import SolidLSPSettings

from .common import RuntimeDependency, RuntimeDependencyCollection, build_npm_install_command

log = logging.getLogger(__name__)

# Version pinning convention (see eclipse_jdtls.py for the full spec):
#   INITIAL_* — frozen forever; legacy unversioned install dir is reserved for it.
#   DEFAULT_* — bumped on upgrades; goes into a versioned subdir.
INITIAL_TYPESCRIPT_NATIVE_VERSION = "7.0.2"
DEFAULT_TYPESCRIPT_NATIVE_VERSION = "7.0.2"

MINIMUM_NATIVE_LSP_MAJOR_VERSION = 7


def ensure_native_lsp_version(version: str) -> None:
    """
    Reject TypeScript versions that do not ship the native language server.

    :param version: the npm version specifier configured via ``typescript_version``;
        specifiers without a leading number (e.g. ``latest``) are accepted as they are.
    :raises ValueError: if the specifier names a major version below 7.
    """
    match = re.match(r"\s*[\^~]?(\d+)", version)
    if match is None:
        return
    if int(match.group(1)) < MINIMUM_NATIVE_LSP_MAJOR_VERSION:
        raise ValueError(
            f"typescript_version={version!r} does not provide the native language server: `tsc --lsp` exists only in "
            f"TypeScript {MINIMUM_NATIVE_LSP_MAJOR_VERSION}+. Set typescript_version to {MINIMUM_NATIVE_LSP_MAJOR_VERSION}.x "
            "or use the `typescript` language server instead."
        )


class TypeScriptNativeLanguageServer(SolidLanguageServer):
    """
    Provides TypeScript specific instantiation of the LanguageServer class using the native
    TypeScript language server (``tsc --lsp --stdio``).

    Supported entries in ``ls_specific_settings["typescript_native"]``:
        - ``typescript_version``: version of the ``typescript`` package to install (default: ``"7.0.2"``);
          must be 7 or newer.
        - ``npm_registry``: custom npm registry for the managed install.
        - ``ls_path``: path to an existing ``tsc`` executable (e.g. the project's
          ``node_modules/.bin/tsc``), used instead of the managed install.
    """

    def __init__(self, config: LanguageServerConfig, repository_root_path: str, solidlsp_settings: SolidLSPSettings):
        """
        Creates a TypeScriptNativeLanguageServer instance. This class is not meant to be instantiated directly.
        Use LanguageServer.create() instead.
        """
        super().__init__(
            config,
            repository_root_path,
            None,
            "typescript",
            solidlsp_settings,
        )

    def _create_dependency_provider(self) -> LanguageServerDependencyProvider:
        return self.DependencyProvider(self._custom_settings, self._ls_resources_dir)

    @override
    def is_ignored_dirname(self, dirname: str) -> bool:
        return super().is_ignored_dirname(dirname) or dirname in [
            "node_modules",
            "dist",
            "build",
        ]

    class DependencyProvider(LanguageServerDependencyProviderSinglePath):
        def _get_or_install_core_dependency(self) -> str:
            """
            Setup runtime dependencies for the native TypeScript language server and return the path to ``tsc``.
            """
            typescript_version = self._custom_settings.get("typescript_version", DEFAULT_TYPESCRIPT_NATIVE_VERSION)
            ensure_native_lsp_version(typescript_version)
            npm_registry = self._custom_settings.get("npm_registry")

            deps = RuntimeDependencyCollection(
                [
                    RuntimeDependency(
                        id="typescript",
                        description="typescript package",
                        command=build_npm_install_command("typescript", typescript_version, npm_registry),
                        platform_id="any",
                    ),
                ]
            )

            is_node_installed = shutil.which("node") is not None
            assert is_node_installed, "node is not installed or isn't in PATH. Please install NodeJS and try again."
            is_npm_installed = shutil.which("npm") is not None
            assert is_npm_installed, "npm is not installed or isn't in PATH. Please install npm and try again."

            # legacy unversioned dir reserved for INITIAL; every other version goes into a versioned subdir
            ls_dirname = "ts-native-lsp" if typescript_version == INITIAL_TYPESCRIPT_NATIVE_VERSION else f"ts-native-lsp-{typescript_version}"
            ls_dir = os.path.join(self._ls_resources_dir, ls_dirname)
            tsc_executable_path = os.path.join(ls_dir, "node_modules", ".bin", "tsc")

            if not os.path.exists(tsc_executable_path):
                log.info(f"TypeScript compiler executable not found at {tsc_executable_path}. Installing...")
                with LogTime("Installation of native TypeScript language server dependencies", logger=log):
                    deps.install(ls_dir)

            if not os.path.exists(tsc_executable_path):
                raise FileNotFoundError(f"tsc executable not found at {tsc_executable_path}, something went wrong with the installation.")
            return tsc_executable_path

        def _create_launch_command(self, core_path: str) -> list[str]:
            return [core_path, "--lsp", "--stdio"]

    def _get_language_id_for_file(self, relative_file_path: str) -> str:
        if relative_file_path.endswith(".tsx"):
            return "typescriptreact"
        if relative_file_path.endswith(".jsx"):
            return "javascriptreact"
        return self.language_id

    def _create_base_initialize_params(self) -> dict:
        """
        Returns the initialize params for the native TypeScript Language Server.
        """
        initialize_params = {
            "locale": "en",
            "capabilities": {
                "textDocument": {
                    "synchronization": {"didSave": True, "dynamicRegistration": True},
                    "completion": {"dynamicRegistration": True, "completionItem": {"snippetSupport": True}},
                    "definition": {"dynamicRegistration": True},
                    "references": {"dynamicRegistration": True},
                    "documentSymbol": {
                        "dynamicRegistration": True,
                        "hierarchicalDocumentSymbolSupport": True,
                        "symbolKind": {"valueSet": list(range(1, 27))},
                    },
                    "hover": {"dynamicRegistration": True, "contentFormat": ["markdown", "plaintext"]},
                    "signatureHelp": {"dynamicRegistration": True},
                    "codeAction": {"dynamicRegistration": True},
                    "rename": {"dynamicRegistration": True, "prepareSupport": True},
                    "publishDiagnostics": {"relatedInformation": True},
                },
                "workspace": {
                    "workspaceFolders": True,
                    "configuration": True,
                    "didChangeConfiguration": {"dynamicRegistration": True},
                    "symbol": {"dynamicRegistration": True},
                },
                "window": {
                    "workDoneProgress": True,
                },
            },
        }
        return initialize_params

    def _start_server(self) -> None:
        """
        Starts the native TypeScript Language Server.
        """

        def register_capability_handler(params: dict) -> None:
            return

        def configuration_handler(params: dict) -> list:
            return [{} for _ in params.get("items", [])]

        def work_done_progress_create(params: dict) -> dict:
            return {}

        def do_nothing(params: dict) -> None:
            return

        def window_log_message(msg: dict) -> None:
            log.info(f"LSP: window/logMessage: {msg}")

        self.server.on_request("client/registerCapability", register_capability_handler)
        self.server.on_request("workspace/configuration", configuration_handler)
        self.server.on_request("window/workDoneProgress/create", work_done_progress_create)
        self.server.on_notification("window/logMessage", window_log_message)
        self.server.on_notification("$/progress", do_nothing)
        self.server.on_notification("textDocument/publishDiagnostics", do_nothing)

        log.info("Starting native TypeScript server process")
        self.server.start()

        log.info("Sending initialize request from LSP client to LSP server and awaiting response")
        init_response = self.server.send.initialize(self._create_initialize_params())
        assert "textDocumentSync" in init_response["capabilities"]

        self.server.notify.initialized({})
```

Если Task 2 дал `NEED_READINESS_WAIT = да`, добавить в класс (после `_start_server`) переопределение — базовое значение `2` секунды остаётся, если `нет`, ничего не добавлять:

```python
    @override
    def _get_wait_time_for_cross_file_referencing(self) -> float:
        return 5
```

Обработчик `textDocument/publishDiagnostics` зарегистрирован пустым по образцу штатного бэкенда: сами опубликованные диагностики перехватывает базовый класс (`_store_published_diagnostics`), пустой обработчик лишь гасит предупреждение о необработанном уведомлении.

- [ ] **Step 5: Прогнать тесты**

```bash
cd /f/Github/serena
uv run pytest test/solidlsp/typescript/test_typescript_basic.py test/solidlsp/typescript/test_typescript_diagnostics.py test/solidlsp/typescript/test_typescript_ignored_dirs.py -v 2>&1 | tee <scratchpad>/ts-native-tests.out | tail -30
```

Expected: всё `PASSED`. Первый прогон дольше: бэкенд ставит `typescript@7.0.2` через npm.

- [ ] **Step 6: Убедиться, что новый бэкенд действительно исполнялся, а не был пропущен**

Зелёный итог ничего не значит, если параметр `typescript_native` был `SKIPPED` или не собран.

```bash
grep -c "\[typescript_native\].*PASSED" <scratchpad>/ts-native-tests.out
grep -c "\[typescript_native\].*SKIPPED" <scratchpad>/ts-native-tests.out
grep -c "\[typescript\].*PASSED" <scratchpad>/ts-native-tests.out
```

Expected: первое число ≥ 7 (6 тестов basic при поддержанном `implementation` или 4 без него, плюс diagnostics и два теста ignored_dirs), второе — `0`, третье равно числу из базы Task 1. Если новый бэкенд падает на отдельных тестах — не ослаблять тесты: записать имя теста и ошибку, разобраться в причине (capabilities из Task 2, логи сервера), и только если это подтверждённое отличие сервера, оставить этот тест на `[LanguageServerId.TYPESCRIPT]` с записью в документации (Task 5).

- [ ] **Step 7: Убедиться, что проверка версии умеет краснеть**

Временно, на копии файла: заменить в `ensure_native_lsp_version` условие `< MINIMUM_NATIVE_LSP_MAJOR_VERSION` на `< 0`, прогнать тест, вернуть файл из копии.

```bash
cd /f/Github/serena
F=src/solidlsp/language_servers/typescript_native_language_server.py
cp "$F" <scratchpad>/ts-native-backup.py
sed -i 's/< MINIMUM_NATIVE_LSP_MAJOR_VERSION:/< 0:/' "$F"
uv run pytest test/solidlsp/typescript/test_typescript_basic.py -q -k rejects 2>&1 | tail -3
cp <scratchpad>/ts-native-backup.py "$F"
uv run pytest test/solidlsp/typescript/test_typescript_basic.py -q -k rejects 2>&1 | tail -2
git diff --stat -- "$F" | tail -1
```

Expected: первый прогон — `1 failed` (`DID NOT RAISE`), второй — `1 passed`; файл после восстановления отличается от индекса только как новый (в `git status` он `??`, `git diff --stat` пуст).

- [ ] **Step 8: Форматирование и типы**

```bash
cd /f/Github/serena
uv run poe format
uv run poe type-check 2>&1 | tail -5
```

Expected: `poe format` без ошибок, `type-check` — без новых ошибок в изменённых файлах.

- [ ] **Step 9: Commit**

```bash
cd /f/Github/serena
git add src/solidlsp/language_servers/typescript_native_language_server.py src/solidlsp/ls_config.py test/conftest.py test/solidlsp/typescript/test_typescript_basic.py test/solidlsp/typescript/test_typescript_diagnostics.py test/solidlsp/typescript/test_typescript_ignored_dirs.py
git commit -F - <<'EOF'
Add typescript_native language server backend (TypeScript 7 native LSP)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
```

---

### Task 4: Обход `includeDeclaration` — только при `NEED_REFERENCES_WORKAROUND = да`

Если Task 2 дал `нет`, задача пропускается целиком; в отчёте об исполнении написать «Task 4 пропущен: правило из Task 2 Step 4 дало `нет`», а отличие по реэкспортам уходит в документацию (Task 5).

**Files:**
- Modify: `src/solidlsp/language_servers/typescript_native_language_server.py`
- Create: `test/resources/repos/typescript/test_repo/reexport.ts`
- Modify: `test/solidlsp/typescript/test_typescript_basic.py`

**Interfaces:**
- Consumes: класс из Task 3; базовый метод `SolidLanguageServer._send_references_request(self, relative_file_path: str, line: int, column: int) -> list[lsp_types.Location] | None`, который шлёт запрос с `includeDeclaration: False`.
- Produces: переопределённый `_send_references_request` в `TypeScriptNativeLanguageServer`.

- [ ] **Step 1: Добавить фикстуру и тест — он должен покраснеть на новом бэкенде**

`test/resources/repos/typescript/test_repo/reexport.ts`:

```ts
export { helperFunction } from "./index";
```

В класс `TestTypescriptLanguageServer` в `test_typescript_basic.py`:

```python
    @pytest.mark.parametrize("language_server", TYPESCRIPT_LANGUAGE_BACKENDS, indirect=True)
    def test_references_include_imports_and_reexports(self, language_server: SolidLanguageServer) -> None:
        pos = find_identifier_position(get_repo_path(LanguageServerId.TYPESCRIPT) / "index.ts", "helperFunction")
        assert pos is not None, "Could not find helperFunction in fixture"
        refs = language_server.request_references("index.ts", pos[0], pos[1])
        ref_files = {ref.get("relativePath", "").replace("\\", "/") for ref in refs}
        assert "use_helper.ts" in ref_files, f"import/call in use_helper.ts not reported: {ref_files}"
        assert "reexport.ts" in ref_files, f"re-export in reexport.ts not reported: {ref_files}"
```

`find_identifier_position` возвращает первую позицию идентификатора в файле; в `index.ts` первое вхождение `helperFunction` — определение на строке 13. Проверить это до запуска: `grep -n helperFunction test/resources/repos/typescript/test_repo/index.ts` — первая строка вывода обязана быть `export function helperFunction`.

- [ ] **Step 2: Убедиться, что тест красный на `typescript_native` и зелёный на `typescript`**

```bash
cd /f/Github/serena
uv run pytest test/solidlsp/typescript/test_typescript_basic.py -v -k imports_and_reexports 2>&1 | tail -6
```

Expected: `[typescript]` — `PASSED`, `[typescript_native]` — `FAILED`. Если штатный бэкенд тоже красный — фикстура или ожидание неверны; поправить тест, а не реализацию.

- [ ] **Step 3: Переопределить запрос ссылок**

Сначала сверить имена по живому коду: `grep -n "def definition\|def references" src/solidlsp/ls_request.py` — оба метода обязаны существовать; `grep -n "^from.*lsp_types\|^import.*lsp_types" src/solidlsp/ls.py` — взять оттуда точную строку импорта `lsp_types` и перенести её в блок импортов нового файла. Затем добавить в `TypeScriptNativeLanguageServer`:

```python
    @override
    def _send_references_request(self, relative_file_path: str, line: int, column: int) -> list[lsp_types.Location] | None:
        # With includeDeclaration=False the native server drops import and re-export specifiers along with
        # the definition itself, so request everything and remove only the definition location(s).
        uri = self._resolve_file_uri(relative_file_path)
        position = {"line": line, "character": column}
        locations = self.server.send.references(
            {"textDocument": {"uri": uri}, "position": position, "context": {"includeDeclaration": True}}
        )
        if not locations:
            return locations
        definitions = self.server.send.definition({"textDocument": {"uri": uri}, "position": position}) or []
        if isinstance(definitions, dict):
            definitions = [definitions]
        definition_keys = set()
        for definition in definitions:
            target_uri = definition.get("uri") or definition.get("targetUri")
            target_range = definition.get("range") or definition.get("targetSelectionRange")
            if target_uri is not None and target_range is not None:
                definition_keys.add((target_uri.lower(), target_range["start"]["line"], target_range["start"]["character"]))
        return [
            location
            for location in locations
            if (location["uri"].lower(), location["range"]["start"]["line"], location["range"]["start"]["character"]) not in definition_keys
        ]
```

URI сравниваются в нижнем регистре: нативный сервер возвращает `file:///c%3A/...`, а запрос уходит с `file:///C:/...`.

- [ ] **Step 4: Прогнать весь набор**

```bash
cd /f/Github/serena
uv run pytest test/solidlsp/typescript/test_typescript_basic.py test/solidlsp/typescript/test_typescript_diagnostics.py test/solidlsp/typescript/test_typescript_ignored_dirs.py -v 2>&1 | tee <scratchpad>/ts-native-tests.out | tail -30
grep -c "\[typescript_native\].*PASSED" <scratchpad>/ts-native-tests.out
grep -c "FAILED" <scratchpad>/ts-native-tests.out
```

Expected: всё `PASSED`, `FAILED` — `0`. Новая фикстура `reexport.ts` могла изменить ожидания других тестов (дерево символов) — если упал старый тест, значит он считал файлы; поправить фикстуру так, чтобы она не вносила новых символов верхнего уровня, кроме реэкспорта.

- [ ] **Step 5: Форматирование, типы, коммит**

```bash
cd /f/Github/serena
uv run poe format && uv run poe type-check 2>&1 | tail -3
git add src/solidlsp/language_servers/typescript_native_language_server.py test/resources/repos/typescript/test_repo/reexport.ts test/solidlsp/typescript/test_typescript_basic.py
git commit -F - <<'EOF'
Keep import and re-export references in typescript_native

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
```

---

### Task 5: Документация, changelog и полная проверка

**Files:**
- Modify: `docs/01-about/020_programming-languages.md` (якорь — строка `* **TypeScript**`)
- Modify: `CHANGELOG.md` (якорь — первая строка `* Language Servers:` в разделе `# Unreleased (main)`)

**Interfaces:**
- Consumes: итог Task 3 и Task 4 — какие тесты остались только на штатном бэкенде и применён ли обход ссылок.
- Produces: ветка, готовая к push.

- [ ] **Step 1: Документация**

Заменить строку `* **TypeScript**` на:

```markdown
* **TypeScript**  
  (requires Node.js and npm;
  alternative: the native language server that ships with TypeScript 7+ (`tsc --lsp`, language `typescript_native`),
  which does not depend on `tsserver`. It installs `typescript` 7.x on the fly; set
  `ls_specific_settings.typescript_native.ls_path` to the project's `node_modules/.bin/tsc` to analyse the project
  with exactly the compiler version it is built with)
```

Если по итогам Task 2–4 есть отличия от штатного бэкенда (тесты implementations остались только на `typescript`; реэкспорты не входят в ссылки, потому что Task 4 пропущен) — дописать их одной фразой в конец скобок, по факту, например: `; re-export specifiers are not reported as references`.

- [ ] **Step 2: Changelog**

Первой строкой списка под `* Language Servers:` в разделе `# Unreleased (main)`:

```markdown
  - Add `typescript_native` as an alternative TypeScript language server, using the native language server
    that ships with TypeScript 7+ (`tsc --lsp`); `typescript` 7.x is installed on the fly, `ls_path` can point
    to the project's own `tsc` #1402
```

- [ ] **Step 3: Проверить, что документация и код называют одно и то же**

Имена берутся из кода, а не вписываются в проверку второй раз:

```bash
cd /f/Github/serena
KEY=$(uv run python -c "from solidlsp.ls_config import LanguageServerId; print(LanguageServerId.TYPESCRIPT_NATIVE.get_key())")
echo "key=$KEY"
grep -c "\`$KEY\`" docs/01-about/020_programming-languages.md CHANGELOG.md
grep -c "ls_path" docs/01-about/020_programming-languages.md
```

Expected: `key=typescript_native`; в обоих файлах ≥ 1 вхождения ключа; `ls_path` в документации ≥ 1.

- [ ] **Step 4: Полный прогон TypeScript-тестов, включая не тронутые файлы**

```bash
cd /f/Github/serena
uv run pytest test/solidlsp/typescript -v 2>&1 | tee <scratchpad>/ts-native-full.out | tail -15
grep -c "FAILED\|ERROR" <scratchpad>/ts-native-full.out
```

Expected: `0` упавших сверх базы из Task 1. `test_typescript_cross_package.py` и `test_typescript_automatic_type_acquisition.py` обязаны вести себя как в базе: мы их не трогали.

- [ ] **Step 5: Линтер, типы, пробелы**

```bash
cd /f/Github/serena
uv run poe lint && uv run poe type-check 2>&1 | tail -3
git diff --check upstream/main...HEAD
```

Expected: без ошибок.

- [ ] **Step 6: Commit**

```bash
cd /f/Github/serena
git add docs/01-about/020_programming-languages.md CHANGELOG.md
git commit -F - <<'EOF'
Document the typescript_native language server

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
git log --oneline upstream/main..HEAD
```

Expected: два или три коммита (Task 3, опционально Task 4, Task 5).

---

### Task 6: Проба на реальном коде и итог

**Files:**
- Create (scratchpad): копия `23-svg/src` с пробным файлом и файлом реэкспорта уже есть в самом коде (`index.ts` реэкспортирует `createRoot`).
- Modify: `F:\Github\claude-plugins\docs\superpowers\specs\2026-09-20-serena-typescript-native-design.md` (раздел «Результаты»)

**Interfaces:**
- Consumes: ветку `typescript-native-ls` с коммитами задач 3–5.
- Produces: записанный результат пробы; решение владельца о push и PR.

- [ ] **Step 1: Собрать копию проекта**

```bash
P="<scratchpad>/ts-native-real"
rm -rf "$P" && mkdir -p "$P/project" "$P/solidlsp" "$P/projdata"
cp -r "/f/Github/TP-Prepare/react-from-scratch-course/23-svg/src" "$P/project/src"
cat > "$P/project/tsconfig.json" <<'EOF'
{
	"compilerOptions": {
		"lib": ["ESNext", "dom"], "target": "ESNext", "module": "Preserve", "moduleDetection": "force",
		"moduleResolution": "bundler", "allowImportingTsExtensions": true, "verbatimModuleSyntax": true,
		"noEmit": true, "strict": true, "skipLibCheck": true, "noUncheckedIndexedAccess": true
	},
	"include": ["src"]
}
EOF
printf 'export const lspProbe: number = "text";\n' > "$P/project/src/lsp-probe.ts"
cd "$P/project" && tsc --noEmit -p . 2>&1 | head -5
```

Expected: ровно одна ошибка — `src/lsp-probe.ts(1,14): error TS2322`. Это эталон от компилятора, независимый от Serena.

- [ ] **Step 2: Написать `real.py`**

```python
import json
import logging
import os

from solidlsp.ls import SolidLanguageServer
from solidlsp.ls_config import LanguageServerConfig, LanguageServerId
from solidlsp.settings import SolidLSPSettings

logging.basicConfig(level=logging.WARNING)
here = os.path.dirname(os.path.abspath(__file__))
project = os.path.join(here, "project")
settings = SolidLSPSettings(solidlsp_dir=os.path.join(here, "solidlsp"), project_data_path=os.path.join(here, "projdata"))
ls = SolidLanguageServer.create(LanguageServerConfig(ls_id=LanguageServerId.TYPESCRIPT_NATIVE), project, solidlsp_settings=settings)

with ls.start_server_context():
    for rel in ["src/lsp-probe.ts", "src/render.ts", "src/commit.ts"]:
        diagnostics = ls.request_text_document_diagnostics(rel)
        print(rel, "->", json.dumps([d.get("code") for d in diagnostics]))
    create_root = ls.request_references("src/render.ts", 44, 16)
    print("createRoot refs:", sorted({r.get("relativePath", "").replace("\\", "/") for r in create_root}))
    create_fiber_root = ls.request_references("src/renderer-state.ts", 9, 16)
    print("createFiberRoot refs:", sorted({r.get("relativePath", "").replace("\\", "/") for r in create_fiber_root}))
```

Позиции `44, 16` и `9, 16` — нулевые координаты `createRoot` в `render.ts:45` и `createFiberRoot` в `renderer-state.ts:10`. Перед запуском сверить их с копией: `grep -n "export function createRoot" project/src/render.ts` и `grep -n "export function createFiberRoot" project/src/renderer-state.ts`; при расхождении поправить числа.

- [ ] **Step 3: Запустить на окружении клона**

```bash
cd "<scratchpad>/ts-native-real" && uv run --project /f/Github/serena python real.py
```

Expected:
- `src/lsp-probe.ts -> [2322]`, `src/render.ts -> []`, `src/commit.ts -> []` — совпадает с эталоном Step 1;
- `createFiberRoot refs: ['src/render.ts']`;
- `createRoot refs`: при применённом Task 4 — `['src/index.ts']` (реэкспорт), при пропущенном — `[]`. Этот символ выбран намеренно: у него единственная ссылка — реэкспорт, и именно на нём поведение серверов расходится.

- [ ] **Step 4: Убрать за собой и проверить следы**

```bash
rm -rf "<scratchpad>/ts-native-real" "<scratchpad>/ts-native-measure"
ls -d ~/.solidlsp ~/.serena 2>/dev/null || echo "home clean"
cd /f/Github/TP-Prepare/react-from-scratch-course && git status --short | grep -iE "lsp-probe|serena|solidlsp" || echo "course clean"
```

Expected: `home clean` и `course clean`. (`~/.solidlsp` мог появиться после тестов Task 3: тесты Serena ставят серверы в каталог по умолчанию. Это ожидаемо; тогда записать его наличие в отчёт, не удалять.)

- [ ] **Step 5: Записать результаты в спеку и закоммитить**

Добавить раздел «Результаты» в спеку: база Task 1, итоги тестов по бэкендам (числа `PASSED`), применён ли Task 4, вывод `real.py` дословно. Затем:

```bash
cd /f/Github/claude-plugins
git add docs/superpowers/specs/2026-09-20-serena-typescript-native-design.md
git commit -F - <<'EOF'
docs(spec): результаты реализации typescript_native для Serena

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
```

- [ ] **Step 6: Остановиться и отдать ход владельцу**

Не выполнять `git push` и не открывать PR. Сообщить владельцу: ветку, список коммитов, итоги тестов и пробы, известные отличия от штатного бэкенда, и что для PR нужно: `git push -u origin typescript-native-ls`, открыть PR в `oraios/serena` со ссылкой на #1402 и #1406, принять CLA по ссылке бота. Отдельно сообщить, что локально проверена только Windows: Linux и macOS проверит CI upstream после открытия PR, и `.github/workflows/pytest.yml` не менялся, потому что новому бэкенду нужны только `node` и `npm`, которые CI уже ставит для штатного. Сквозная проверка через MCP с Claude Code — отдельным шагом после решения владельца, во временном проекте: Serena ставится из ветки форка (`uvx --from git+https://github.com/YarikMix/serena@typescript-native-ls`), точная команда запуска MCP-сервера берётся из README Serena на момент проверки, в `.serena/project.yml` проекта указывается язык `typescript_native`.
