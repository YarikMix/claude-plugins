# Плагин `selectel-ops` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Добавить в маркетплейс `yarikmix-plugins` плагин `selectel-ops` со скиллом для работы с облаком Selectel: скрипт диагностики, справочник API и процедуры для агента, включая стык с Pulumi и Ansible.

**Architecture:** Плагин `plugins/selectel-ops/` без манифеста (метаданные в `marketplace.json`, как у `typescript-native-lsp`). Один скилл `skills/selectel-ops/` из трёх файлов: `SKILL.md` (процедуры, ~200 строк), `REFERENCE.md` (карта API, тела запросов, таблица ошибок, IaC-фрагменты) и `scripts/selectel.py` (только чтение: токен, проекты, каталог, `check`). Скрипт покрыт юнит-тестами на `unittest` с подменой HTTP-слоя, потом проверяется на живом аккаунте.

**Tech Stack:** Python ≥ 3.8, только стандартная библиотека (`certifi` и `PyYAML` — необязательные); `unittest`; Claude Code CLI 2.1.x (`claude plugin validate`, `claude --plugin-dir`).

**Spec:** `docs/superpowers/specs/2026-09-26-selectel-ops-design.md` — все факты про Selectel для `SKILL.md` и `REFERENCE.md` берутся из раздела «Что установлено на практике» этой спеки; план на них ссылается, а не пересказывает.

## Global Constraints

- Рабочий клон: `/Users/y.mihalev/projects/tp-prepare/claude-plugins`, ветка `main`, remote `origin` — `YarikMix/claude-plugins`. Коммиты в `main` разрешены после каждой задачи; `git push` — один раз в конце, по подтверждению владельца.
- Файлы в коммит добавлять только явно, по именам. `git add -A` запрещён: в клоне лежат untracked `.DS_Store`.
- Плагин для любого пользователя маркетплейса: ни в одном файле плагина, спеки и плана нет номеров аккаунта, id проектов, IP-адресов, доменов и имён чужого стенда. Все примеры — с плейсхолдерами `<ACCOUNT>`, `<USER>`, `<PROJECT_ID>`, `<ZONE_ID>`, `<имя-облака>`.
- Скрипт: Python ≥ 3.8, стандартная библиотека. `certifi` подхватывается для TLS, если импортируется. `PyYAML` нужен только для `--cloud`; без него — понятная ошибка с подсказкой про переменные окружения. Пароль не принимается аргументом командной строки и не печатается. Скрипт только читает.
- Коды выхода скрипта: `0` успех, `1` API ответил ошибкой или `check` не прошёл, `2` ошибка использования или конфигурации.
- Тесты: `cd plugins/selectel-ops && python3 -m unittest -v tests.test_selectel`. Живая проверка (задача 4) — с настоящими кредами из `clouds.yaml`, который лежит вне этого репозитория; путь к нему исполнитель получает от владельца, в план и репозиторий он не попадает.
- Язык файлов — русский, как у `typescript-native-lsp`; в README плагина — короткий английский раздел «Installation».
- `SKILL.md` — ориентир 200 строк, жёсткий потолок 230. Всё длинное — в `REFERENCE.md`.

---

## Структура файлов

| Файл | Ответственность |
|---|---|
| `plugins/selectel-ops/skills/selectel-ops/scripts/selectel.py` | креды, HTTP, токен, проекты, каталог, `check`, CLI |
| `plugins/selectel-ops/tests/__init__.py` | пустой, чтобы `tests` был пакетом |
| `plugins/selectel-ops/tests/test_selectel.py` | юнит-тесты скрипта с подменой `selectel.request` и `urlopen` |
| `plugins/selectel-ops/skills/selectel-ops/REFERENCE.md` | карта API, тела запросов, DNS v2, имена сущностей, таблица ошибок, Pulumi, Ansible, скрипт |
| `plugins/selectel-ops/skills/selectel-ops/SKILL.md` | frontmatter с триггерами, правила, развилки, фаза 0, процедуры, IaC, ошибки |
| `plugins/selectel-ops/README.md` | для человека: что даёт, требования, установка, проверка |
| `plugins/selectel-ops/LICENSE` | копия MIT из `typescript-native-lsp` |
| `.claude-plugin/marketplace.json` (modify) | запись плагина |
| `README.md` (modify) | строка в таблице плагинов |

---

### Task 1: Скрипт — креды, ошибки, HTTP, токен

**Files:**
- Create: `plugins/selectel-ops/skills/selectel-ops/scripts/selectel.py`
- Create: `plugins/selectel-ops/tests/__init__.py`
- Create: `plugins/selectel-ops/tests/test_selectel.py`

**Interfaces:**
- Produces: `UsageError`, `ApiError(status, body, url)` с `.status`, `.body`, `.url`, `.is_html`, `.message()`; `request(method, url, token=None, body=None) -> (status, headers, json)`; `load_env() -> dict`; `load_clouds_yaml(cloud, path=None) -> dict`; `load_credentials(cloud=None, clouds_file=None, ask_password=None) -> dict` с ключами `auth_url, account, username, password, project_id, region`; `issue_token(creds, scope="domain", project_id=None) -> (token, token_body)`. Константы `DEFAULT_AUTH_URL`, `DEFAULT_REGION`, `RESELL_URL`, `DNS_URL_FALLBACK`, `CLOUDS_PATHS`, `TIMEOUT`.

- [ ] **Step 1: Создать пакет тестов и написать падающие тесты**

`plugins/selectel-ops/tests/__init__.py` — пустой файл.

`plugins/selectel-ops/tests/test_selectel.py`:

```python
"""Тесты selectel.py: HTTP подменяется, в сеть тесты не ходят."""
import io
import json
import os
import sys
import tempfile
import unittest
import urllib.error
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "skills", "selectel-ops", "scripts"))
import selectel  # noqa: E402

try:
    import yaml  # noqa: F401
    HAS_YAML = True
except ImportError:
    HAS_YAML = False

ENV = {
    "SELECTEL_ACCOUNT": "12345",
    "SELECTEL_USERNAME": "svc",
    "SELECTEL_PASSWORD": "pw",
    "SELECTEL_PROJECT_ID": "abc",
    "SELECTEL_REGION": "ru-3",
}


class CredentialsTest(unittest.TestCase):
    def test_load_env_reads_variables(self):
        with mock.patch.dict(os.environ, ENV, clear=True):
            creds = selectel.load_env()
        self.assertEqual(creds["account"], "12345")
        self.assertEqual(creds["username"], "svc")
        self.assertEqual(creds["password"], "pw")
        self.assertEqual(creds["project_id"], "abc")
        self.assertEqual(creds["region"], "ru-3")
        self.assertEqual(creds["auth_url"], selectel.DEFAULT_AUTH_URL)

    def test_load_credentials_missing_account_raises_usage_error(self):
        with mock.patch.dict(os.environ, {"SELECTEL_USERNAME": "svc", "SELECTEL_PASSWORD": "pw"}, clear=True):
            with self.assertRaises(selectel.UsageError) as ctx:
                selectel.load_credentials()
        self.assertIn("account", str(ctx.exception))

    def test_load_credentials_asks_password_when_missing(self):
        with mock.patch.dict(os.environ, {"SELECTEL_ACCOUNT": "1", "SELECTEL_USERNAME": "svc"}, clear=True):
            creds = selectel.load_credentials(ask_password=lambda prompt: "typed")
        self.assertEqual(creds["password"], "typed")

    @unittest.skipUnless(HAS_YAML, "PyYAML не установлен")
    def test_load_clouds_yaml_reads_entry(self):
        text = (
            "clouds:\n  demo:\n    auth:\n      auth_url: https://cloud.api.selcloud.ru/identity/v3/\n"
            "      username: svc\n      password: pw\n      project_id: abc\n"
            "      user_domain_name: '12345'\n      project_domain_name: '12345'\n    region_name: ru-9\n"
        )
        with tempfile.NamedTemporaryFile("w", suffix=".yaml", delete=False) as f:
            f.write(text)
        try:
            creds = selectel.load_clouds_yaml("demo", f.name)
        finally:
            os.unlink(f.name)
        self.assertEqual(creds["account"], "12345")
        self.assertEqual(creds["auth_url"], "https://cloud.api.selcloud.ru/identity/v3")
        self.assertEqual(creds["project_id"], "abc")
        self.assertEqual(creds["region"], "ru-9")

    @unittest.skipUnless(HAS_YAML, "PyYAML не установлен")
    def test_load_clouds_yaml_unknown_cloud_lists_available(self):
        with tempfile.NamedTemporaryFile("w", suffix=".yaml", delete=False) as f:
            f.write("clouds:\n  one:\n    auth: {}\n")
        try:
            with self.assertRaises(selectel.UsageError) as ctx:
                selectel.load_clouds_yaml("two", f.name)
        finally:
            os.unlink(f.name)
        self.assertIn("one", str(ctx.exception))


class ApiErrorTest(unittest.TestCase):
    def test_detects_html_body(self):
        err = selectel.ApiError(500, "<html><head><title>500</title></head></html>", "https://x")
        self.assertTrue(err.is_html)
        self.assertIn("HTML", err.message())

    def test_message_from_json_error(self):
        body = json.dumps({"error": {"code": 401, "message": "The request you have made requires authentication."}})
        err = selectel.ApiError(401, body, "https://x")
        self.assertFalse(err.is_html)
        self.assertIn("requires authentication", err.message())


class _FakeResponse:
    def __init__(self, status, headers, body):
        self.status = status
        self.headers = headers
        self._body = body.encode()

    def read(self):
        return self._body

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


class RequestTest(unittest.TestCase):
    def test_returns_status_headers_json(self):
        fake = _FakeResponse(201, {"X-Subject-Token": "tok"}, '{"token": {"roles": []}}')
        with mock.patch("selectel.urllib.request.urlopen", return_value=fake):
            status, headers, data = selectel.request("POST", "https://x/auth/tokens", body={"a": 1})
        self.assertEqual(status, 201)
        self.assertEqual(headers.get("X-Subject-Token"), "tok")
        self.assertEqual(data, {"token": {"roles": []}})

    def test_http_error_becomes_api_error(self):
        err = urllib.error.HTTPError("https://x", 401, "Unauthorized", None, io.BytesIO(b'{"error":{"message":"nope"}}'))
        with mock.patch("selectel.urllib.request.urlopen", side_effect=err):
            with self.assertRaises(selectel.ApiError) as ctx:
                selectel.request("GET", "https://x")
        self.assertEqual(ctx.exception.status, 401)
        self.assertIn("nope", ctx.exception.message())

    def test_url_error_becomes_api_error_status_0(self):
        with mock.patch("selectel.urllib.request.urlopen", side_effect=urllib.error.URLError("dns down")):
            with self.assertRaises(selectel.ApiError) as ctx:
                selectel.request("GET", "https://x")
        self.assertEqual(ctx.exception.status, 0)


CREDS = {
    "auth_url": "https://cloud.api.selcloud.ru/identity/v3",
    "account": "12345",
    "username": "svc",
    "password": "pw",
    "project_id": "abc",
    "region": "ru-9",
}


class IssueTokenTest(unittest.TestCase):
    def test_domain_scope_body_and_token(self):
        calls = []

        def fake_request(method, url, token=None, body=None):
            calls.append((method, url, body))
            return 201, {"X-Subject-Token": "dtok"}, {"token": {"roles": [{"name": "member"}]}}

        with mock.patch("selectel.request", side_effect=fake_request):
            token, body = selectel.issue_token(CREDS, "domain")
        self.assertEqual(token, "dtok")
        self.assertEqual(body["roles"][0]["name"], "member")
        method, url, sent = calls[0]
        self.assertEqual((method, url), ("POST", "https://cloud.api.selcloud.ru/identity/v3/auth/tokens"))
        self.assertEqual(sent["auth"]["scope"], {"domain": {"name": "12345"}})
        self.assertEqual(sent["auth"]["identity"]["password"]["user"]["domain"], {"name": "12345"})

    def test_project_scope_uses_explicit_id(self):
        calls = []

        def fake_request(method, url, token=None, body=None):
            calls.append(body)
            return 201, {"X-Subject-Token": "ptok"}, {"token": {}}

        with mock.patch("selectel.request", side_effect=fake_request):
            selectel.issue_token(CREDS, "project", "zzz")
        self.assertEqual(calls[0]["auth"]["scope"], {"project": {"id": "zzz"}})

    def test_project_scope_without_id_raises_usage_error(self):
        creds = dict(CREDS, project_id=None)
        with self.assertRaises(selectel.UsageError):
            selectel.issue_token(creds, "project")


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Запустить тесты и убедиться, что падают**

Run: `cd plugins/selectel-ops && python3 -m unittest -v tests.test_selectel`
Expected: `ModuleNotFoundError: No module named 'selectel'`

- [ ] **Step 3: Написать `selectel.py` (креды, ошибки, HTTP, токен)**

`plugins/selectel-ops/skills/selectel-ops/scripts/selectel.py`:

```python
#!/usr/bin/env python3
"""Токен, проекты, каталог и диагностика доступа к облаку Selectel. Только чтение.

Креды: --cloud NAME из clouds.yaml (нужен PyYAML) или переменные окружения
SELECTEL_ACCOUNT, SELECTEL_USERNAME, SELECTEL_PASSWORD (необязательно
SELECTEL_PROJECT_ID, SELECTEL_REGION, SELECTEL_AUTH_URL).
Пароль в аргументы не передаётся и никогда не печатается.
"""
import argparse
import getpass
import json
import os
import ssl
import sys
import urllib.error
import urllib.request

DEFAULT_AUTH_URL = "https://cloud.api.selcloud.ru/identity/v3"
DEFAULT_REGION = "ru-9"
RESELL_URL = "https://api.selectel.ru/vpc/resell/v2"
DNS_URL_FALLBACK = "https://api.selectel.ru/domains/v2"
CLOUDS_PATHS = ("clouds.yaml", "~/.config/openstack/clouds.yaml", "/etc/openstack/clouds.yaml")
TIMEOUT = 20


class UsageError(Exception):
    """Ошибка использования или конфигурации: код выхода 2."""


class ApiError(Exception):
    """Ответ API с ошибкой или сетевой сбой: код выхода 1."""

    def __init__(self, status, body, url):
        super().__init__(f"HTTP {status} {url}")
        self.status = status
        self.body = body or ""
        self.url = url
        self.is_html = self.body.lstrip().startswith("<")

    def message(self):
        if self.status == 0:
            return f"нет соединения: {self.body}"
        if self.is_html:
            return f"сервер вернул HTML вместо JSON (код {self.status}) на {self.url}"
        try:
            data = json.loads(self.body)
        except ValueError:
            return f"HTTP {self.status} на {self.url}: {self.body[:200]}"
        err = data.get("error", data) if isinstance(data, dict) else {}
        text = err.get("message") if isinstance(err, dict) else None
        return f"HTTP {self.status} на {self.url}: {text or self.body[:200]}"


def ssl_context():
    """Python с python.org может не иметь корневых сертификатов: берём бандл certifi, если есть."""
    try:
        import certifi
        return ssl.create_default_context(cafile=certifi.where())
    except ImportError:
        return ssl.create_default_context()


def request(method, url, token=None, body=None):
    """Возвращает (status, headers, json). HTTP-ошибки и сетевые сбои -> ApiError."""
    data = json.dumps(body).encode() if body is not None else None
    headers = {"Content-Type": "application/json", "Accept": "application/json"}
    if token:
        headers["X-Auth-Token"] = token
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT, context=ssl_context()) as resp:
            raw = resp.read().decode("utf-8", "replace")
            return resp.status, resp.headers, (json.loads(raw) if raw.strip() else {})
    except urllib.error.HTTPError as e:
        raise ApiError(e.code, e.read().decode("utf-8", "replace"), url) from None
    except urllib.error.URLError as e:
        raise ApiError(0, str(e.reason), url) from None


def load_clouds_yaml(cloud, path=None):
    """Креды из записи clouds.yaml. user_domain_name в Selectel — номер аккаунта."""
    try:
        import yaml
    except ImportError:
        raise UsageError(
            "для --cloud нужен PyYAML (pip install pyyaml); иначе задайте "
            "SELECTEL_ACCOUNT, SELECTEL_USERNAME, SELECTEL_PASSWORD"
        ) from None
    candidates = [path] if path else [os.path.expanduser(p) for p in CLOUDS_PATHS]
    for p in candidates:
        if not os.path.isfile(p):
            continue
        with open(p, encoding="utf-8") as f:
            clouds = (yaml.safe_load(f) or {}).get("clouds", {}) or {}
        if cloud not in clouds:
            raise UsageError(f"облака {cloud!r} нет в {p}; есть: {', '.join(clouds) or 'ничего'}")
        entry = clouds[cloud] or {}
        auth = entry.get("auth", {}) or {}
        return {
            "auth_url": str(auth.get("auth_url") or DEFAULT_AUTH_URL).rstrip("/"),
            "account": str(auth.get("user_domain_name") or auth.get("project_domain_name") or ""),
            "username": str(auth.get("username") or ""),
            "password": str(auth.get("password") or ""),
            "project_id": auth.get("project_id") or None,
            "region": entry.get("region_name") or DEFAULT_REGION,
        }
    raise UsageError("clouds.yaml не найден: " + ", ".join(candidates))


def load_env():
    env = os.environ.get
    return {
        "auth_url": env("SELECTEL_AUTH_URL", DEFAULT_AUTH_URL).rstrip("/"),
        "account": env("SELECTEL_ACCOUNT", ""),
        "username": env("SELECTEL_USERNAME", ""),
        "password": env("SELECTEL_PASSWORD", ""),
        "project_id": env("SELECTEL_PROJECT_ID") or None,
        "region": env("SELECTEL_REGION", DEFAULT_REGION),
    }


def load_credentials(cloud=None, clouds_file=None, ask_password=None):
    """clouds.yaml (если задан --cloud) или переменные окружения; пароль — из них или запросом в TTY."""
    creds = load_clouds_yaml(cloud, clouds_file) if cloud else load_env()
    missing = [k for k in ("account", "username") if not creds[k]]
    if missing:
        raise UsageError(
            "не заданы: " + ", ".join(missing)
            + " (clouds.yaml через --cloud или SELECTEL_ACCOUNT/SELECTEL_USERNAME)"
        )
    if not creds["password"]:
        if ask_password is None and sys.stdin.isatty():
            ask_password = getpass.getpass
        if ask_password is None:
            raise UsageError("пароль не задан: SELECTEL_PASSWORD или password в clouds.yaml")
        creds["password"] = ask_password(f"Пароль {creds['username']}: ")
    return creds


def issue_token(creds, scope="domain", project_id=None):
    """Keystone-токен. scope: domain (уровень аккаунта) или project. Возвращает (token, тело token)."""
    if scope == "project":
        pid = project_id or creds.get("project_id")
        if not pid:
            raise UsageError("для scope=project нужен --project ID или project_id в кредах")
        scope_body = {"project": {"id": pid}}
    else:
        scope_body = {"domain": {"name": creds["account"]}}
    body = {
        "auth": {
            "identity": {
                "methods": ["password"],
                "password": {
                    "user": {
                        "name": creds["username"],
                        "domain": {"name": creds["account"]},
                        "password": creds["password"],
                    }
                },
            },
            "scope": scope_body,
        }
    }
    _, headers, data = request("POST", creds["auth_url"] + "/auth/tokens", body=body)
    token = headers.get("X-Subject-Token")
    if not token:
        raise ApiError(0, "в ответе Keystone нет заголовка X-Subject-Token", creds["auth_url"])
    return token, data.get("token", {})
```

- [ ] **Step 4: Запустить тесты и убедиться, что проходят**

Run: `cd plugins/selectel-ops && python3 -m unittest -v tests.test_selectel`
Expected: `OK` (13 тестов; два с пометкой skipped, если нет PyYAML)

- [ ] **Step 5: Commit**

```bash
cd /Users/y.mihalev/projects/tp-prepare/claude-plugins
git add plugins/selectel-ops/skills/selectel-ops/scripts/selectel.py plugins/selectel-ops/tests/__init__.py plugins/selectel-ops/tests/test_selectel.py
git commit -m "feat(selectel-ops): скрипт — креды, HTTP-слой, токен Keystone"
```

---

### Task 2: Скрипт — проекты, каталог, CLI `token` / `projects` / `catalog`

**Files:**
- Modify: `plugins/selectel-ops/skills/selectel-ops/scripts/selectel.py` (дописать после `issue_token`)
- Modify: `plugins/selectel-ops/tests/test_selectel.py` (дописать перед `if __name__`)

**Interfaces:**
- Consumes: `request`, `issue_token`, `load_credentials`, `UsageError`, `ApiError` из Task 1.
- Produces: `list_projects(token) -> list[dict(id, name, enabled)]`; `catalog_endpoints(token_body, type_=None, region=None, interface="public") -> list[dict(type, region, interface, url)]`; `print_table(rows, columns)`; `build_parser() -> argparse.ArgumentParser`; `main(argv=None) -> int` с подкомандами `token`, `projects`, `catalog` (Task 3 добавит `check`).

- [ ] **Step 1: Дописать падающие тесты**

Добавить в `tests/test_selectel.py` перед `if __name__ == "__main__":`:

```python
CATALOG = [
    {"type": "compute", "endpoints": [
        {"interface": "public", "region": "ru-9", "url": "https://ru-9.cloud.api.selcloud.ru/compute/v2.1"},
        {"interface": "public", "region": "ru-3", "url": "https://ru-3.cloud.api.selcloud.ru/compute/v2.1"},
        {"interface": "admin", "region": "ru-9", "url": "https://admin-ru-9.example/compute"},
    ]},
    {"type": "dnsv2", "endpoints": [
        {"interface": "public", "region": "ru-9", "url": "https://api.selectel.ru/domains/v2"},
    ]},
]


class ProjectsAndCatalogTest(unittest.TestCase):
    def test_list_projects_maps_fields(self):
        payload = {"projects": [{"id": "p1", "name": "one", "enabled": True, "extra": 1}]}
        with mock.patch("selectel.request", return_value=(200, {}, payload)) as req:
            rows = selectel.list_projects("dtok")
        self.assertEqual(rows, [{"id": "p1", "name": "one", "enabled": True}])
        self.assertEqual(req.call_args.args[:2], ("GET", selectel.RESELL_URL + "/projects"))
        self.assertEqual(req.call_args.kwargs["token"], "dtok")

    def test_catalog_filters_type_region_interface(self):
        rows = selectel.catalog_endpoints({"catalog": CATALOG}, "compute", "ru-9")
        self.assertEqual(rows, [{"type": "compute", "region": "ru-9", "interface": "public",
                                 "url": "https://ru-9.cloud.api.selcloud.ru/compute/v2.1"}])

    def test_catalog_without_filters_returns_public_sorted(self):
        rows = selectel.catalog_endpoints({"catalog": CATALOG})
        self.assertEqual([(r["type"], r["region"]) for r in rows],
                         [("compute", "ru-3"), ("compute", "ru-9"), ("dnsv2", "ru-9")])


def _fake_request_ok(method, url, token=None, body=None):
    """Успешный аккаунт: domain-токен с ролями, project-токен с каталогом, проекты, зоны."""
    if url.endswith("/auth/tokens"):
        if "domain" in body["auth"]["scope"]:
            return 201, {"X-Subject-Token": "dtok"}, {"token": {"roles": [{"name": "member"}, {"name": "iam.admin"}]}}
        return 201, {"X-Subject-Token": "ptok"}, {"token": {"catalog": CATALOG}}
    if url.endswith("/projects"):
        return 200, {}, {"projects": [{"id": "p1", "name": "one", "enabled": True}]}
    if url.endswith("/zones"):
        return 200, {}, {"count": 2, "result": [{}, {}]}
    raise AssertionError("неожиданный URL " + url)


class CliTest(unittest.TestCase):
    def run_main(self, argv):
        out = io.StringIO()
        with mock.patch.dict(os.environ, ENV, clear=True), \
             mock.patch("selectel.request", side_effect=_fake_request_ok), \
             mock.patch("sys.stdout", out):
            code = selectel.main(argv)
        return code, out.getvalue()

    def test_token_prints_only_token(self):
        code, out = self.run_main(["token"])
        self.assertEqual(code, 0)
        self.assertEqual(out, "dtok\n")

    def test_token_project_scope(self):
        code, out = self.run_main(["token", "--scope", "project"])
        self.assertEqual((code, out), (0, "ptok\n"))

    def test_projects_json(self):
        code, out = self.run_main(["--json", "projects"])
        self.assertEqual(code, 0)
        self.assertEqual(json.loads(out), [{"id": "p1", "name": "one", "enabled": True}])

    def test_projects_table_has_header(self):
        code, out = self.run_main(["projects"])
        self.assertEqual(code, 0)
        self.assertTrue(out.startswith("id"))
        self.assertIn("one", out)

    def test_catalog_filtered(self):
        code, out = self.run_main(["--json", "catalog", "--type", "dnsv2"])
        self.assertEqual(code, 0)
        self.assertEqual(json.loads(out)[0]["url"], "https://api.selectel.ru/domains/v2")

    def test_catalog_without_project_and_catalog_returns_2(self):
        env = dict(ENV)
        del env["SELECTEL_PROJECT_ID"]
        err = io.StringIO()
        with mock.patch.dict(os.environ, env, clear=True), \
             mock.patch("selectel.request", side_effect=_fake_request_ok), \
             mock.patch("sys.stderr", err):
            code = selectel.main(["catalog"])
        self.assertEqual(code, 2)
        self.assertIn("проект", err.getvalue())

    def test_api_error_returns_1(self):
        def boom(method, url, token=None, body=None):
            raise selectel.ApiError(401, '{"error":{"message":"nope"}}', url)
        err = io.StringIO()
        with mock.patch.dict(os.environ, ENV, clear=True), \
             mock.patch("selectel.request", side_effect=boom), \
             mock.patch("sys.stderr", err):
            code = selectel.main(["projects"])
        self.assertEqual(code, 1)
        self.assertIn("nope", err.getvalue())
```

- [ ] **Step 2: Запустить тесты и убедиться, что новые падают**

Run: `cd plugins/selectel-ops && python3 -m unittest -v tests.test_selectel`
Expected: `AttributeError: module 'selectel' has no attribute 'list_projects'` и аналогичные для `catalog_endpoints`, `main`

- [ ] **Step 3: Дописать реализацию**

Добавить в `selectel.py` после `issue_token`:

```python
def list_projects(token):
    """Проекты аккаунта через resell API (нужен domain-scoped токен)."""
    _, _, data = request("GET", RESELL_URL + "/projects", token=token)
    return [
        {"id": p.get("id"), "name": p.get("name"), "enabled": p.get("enabled")}
        for p in data.get("projects", [])
    ]


def catalog_endpoints(token_body, type_=None, region=None, interface="public"):
    """Эндпоинты из каталога Keystone в теле токена, с фильтрами по типу, региону, интерфейсу."""
    out = []
    for svc in token_body.get("catalog", []):
        if type_ and svc.get("type") != type_:
            continue
        for ep in svc.get("endpoints", []):
            if interface and ep.get("interface") != interface:
                continue
            if region and ep.get("region") != region:
                continue
            out.append({
                "type": svc.get("type"),
                "region": ep.get("region"),
                "interface": ep.get("interface"),
                "url": ep.get("url"),
            })
    return sorted(out, key=lambda e: (e["type"] or "", e["region"] or "", e["url"] or ""))


def print_table(rows, columns):
    widths = [max([len(c)] + [len(str(r.get(c, ""))) for r in rows]) for c in columns]
    print("  ".join(c.ljust(w) for c, w in zip(columns, widths)))
    for r in rows:
        print("  ".join(str(r.get(c, "")).ljust(w) for c, w in zip(columns, widths)))


def emit_rows(rows, columns, as_json):
    if as_json:
        print(json.dumps(rows, ensure_ascii=False, indent=2))
    else:
        print_table(rows, columns)


def build_parser():
    p = argparse.ArgumentParser(
        prog="selectel.py",
        description="Токен, проекты, каталог и диагностика доступа к Selectel (только чтение).",
    )
    p.add_argument("--cloud", help="имя облака из clouds.yaml")
    p.add_argument("--clouds-file", help="путь к clouds.yaml (по умолчанию ./, ~/.config/openstack, /etc/openstack)")
    p.add_argument("--json", action="store_true", help="машиночитаемый вывод (кроме token)")
    sub = p.add_subparsers(dest="cmd", required=True)
    t = sub.add_parser("token", help="напечатать токен, только его")
    t.add_argument("--scope", choices=("domain", "project"), default="domain")
    t.add_argument("--project", help="id проекта для scope=project")
    sub.add_parser("projects", help="проекты аккаунта (resell API)")
    c = sub.add_parser("catalog", help="эндпоинты из каталога Keystone")
    c.add_argument("--type", dest="type_", help="тип сервиса: compute, network, image, volumev3, dnsv2 ...")
    c.add_argument("--region", help="регион, например ru-9")
    c.add_argument("--project", help="id проекта; без него — из кредов")
    k = sub.add_parser("check", help="диагностика доступа и живости API")
    k.add_argument("--project", help="id проекта; без него — из кредов")
    k.add_argument("--region", help="регион для проверки compute; по умолчанию из кредов")
    return p


def main(argv=None):
    args = build_parser().parse_args(argv)
    try:
        creds = load_credentials(args.cloud, args.clouds_file)
        if args.cmd == "token":
            token, _ = issue_token(creds, args.scope, args.project)
            print(token)
            return 0
        if args.cmd == "projects":
            token, _ = issue_token(creds, "domain")
            emit_rows(list_projects(token), ["id", "name", "enabled"], args.json)
            return 0
        if args.cmd == "catalog":
            pid = args.project or creds.get("project_id")
            _, body = issue_token(creds, "project", pid) if pid else issue_token(creds, "domain")
            if not body.get("catalog"):
                raise UsageError("в токене нет каталога: укажите проект (--project ID)")
            emit_rows(catalog_endpoints(body, args.type_, args.region), ["type", "region", "interface", "url"], args.json)
            return 0
        if args.cmd == "check":
            return run_check_cli(creds, args)
    except UsageError as e:
        print(f"ошибка: {e}", file=sys.stderr)
        return 2
    except ApiError as e:
        print(f"ошибка API: {e.message()}", file=sys.stderr)
        return 1
    return 2


def run_check_cli(creds, args):
    """Заглушка до Task 3."""
    raise UsageError("check ещё не реализован")


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 4: Запустить тесты и убедиться, что проходят**

Run: `cd plugins/selectel-ops && python3 -m unittest -v tests.test_selectel`
Expected: `OK` (23 теста)

- [ ] **Step 5: Проверить `--help` и коды выхода без кредов**

Run: `python3 plugins/selectel-ops/skills/selectel-ops/scripts/selectel.py --help`
Expected: справка с четырьмя подкомандами.

Run: `env -i PATH="$PATH" python3 plugins/selectel-ops/skills/selectel-ops/scripts/selectel.py projects </dev/null; echo "exit=$?"`
Expected: `ошибка: не заданы: account, username ...` и `exit=2`

- [ ] **Step 6: Commit**

```bash
git add plugins/selectel-ops/skills/selectel-ops/scripts/selectel.py plugins/selectel-ops/tests/test_selectel.py
git commit -m "feat(selectel-ops): проекты, каталог, CLI token/projects/catalog"
```

---

### Task 3: Скрипт — `check`

**Files:**
- Modify: `plugins/selectel-ops/skills/selectel-ops/scripts/selectel.py` (заменить заглушку `run_check_cli`, добавить `explain`, `run_check`)
- Modify: `plugins/selectel-ops/tests/test_selectel.py`

**Interfaces:**
- Consumes: `issue_token`, `list_projects`, `catalog_endpoints`, `request`, `ApiError`, `DNS_URL_FALLBACK`, `DEFAULT_REGION`.
- Produces: `explain(err, context) -> str` (контексты `domain-token`, `resell`, `project-token`, `dns`); `run_check(creds, project_id=None, region=None, emit=print) -> list[dict(name, status, detail)]` со статусами `OK`/`FAIL`/`SKIP`; `run_check_cli(creds, args) -> int`.

- [ ] **Step 1: Дописать падающие тесты**

Добавить в `tests/test_selectel.py` перед `if __name__ == "__main__":`:

```python
def _failing_at(url_suffix, status, body):
    """request, который падает ApiError на URL с данным суффиксом, остальное — как _fake_request_ok."""
    def fake(method, url, token=None, body=None):
        if url.endswith(url_suffix):
            raise selectel.ApiError(status, body_text, url)
        return _fake_request_ok(method, url, token=token, body=body)
    body_text = body
    return fake


AUTH_401 = json.dumps({"error": {"code": 401, "message": "The request you have made requires authentication."}})
HTML_500 = "<html>\n<head><title>500 Internal Server Error</title></head>\n<body><center><h1>500 Internal Server Error</h1></center></body></html>"


class CheckTest(unittest.TestCase):
    def run_check(self, fake, creds=None, **kw):
        lines = []
        with mock.patch("selectel.request", side_effect=fake):
            steps = selectel.run_check(creds or CREDS, emit=lines.append, **kw)
        return steps, lines

    def test_all_ok(self):
        steps, lines = self.run_check(_fake_request_ok)
        self.assertEqual([s["status"] for s in steps], ["OK", "OK", "OK", "OK"])
        self.assertIn("member", steps[0]["detail"])
        self.assertIn("1 шт.", steps[1]["detail"])
        self.assertIn("есть", steps[2]["detail"])
        self.assertIn("2", steps[3]["detail"])
        self.assertEqual(lines[-1], "ИТОГ: OK")

    def test_bad_password_stops_after_first_step(self):
        def fake(method, url, token=None, body=None):
            raise selectel.ApiError(401, AUTH_401, url)
        steps, lines = self.run_check(fake)
        self.assertEqual(len(steps), 1)
        self.assertEqual(steps[0]["status"], "FAIL")
        self.assertIn("пароль", steps[0]["detail"])
        self.assertEqual(lines[-1], "ИТОГ: FAIL")

    def test_missing_project_is_explained(self):
        def fake(method, url, token=None, body=None):
            if url.endswith("/auth/tokens") and "project" in body["auth"]["scope"]:
                raise selectel.ApiError(401, AUTH_401, url)
            return _fake_request_ok(method, url, token=token, body=body)
        steps, _ = self.run_check(fake, project_id="nope")
        self.assertEqual(steps[2]["status"], "FAIL")
        self.assertIn("проекта нет", steps[2]["detail"])
        self.assertEqual(steps[3]["status"], "SKIP")

    def test_dns_html_500_is_explained_as_outage(self):
        steps, _ = self.run_check(_failing_at("/zones", 500, HTML_500))
        self.assertEqual(steps[3]["status"], "FAIL")
        self.assertIn("временный сбой", steps[3]["detail"])
        self.assertIn("invalid character", steps[3]["detail"])

    def test_resell_403_means_no_member_role(self):
        steps, _ = self.run_check(_failing_at("/projects", 403, '{"error":{"message":"forbidden"}}'))
        self.assertEqual(steps[1]["status"], "FAIL")
        self.assertIn("member", steps[1]["detail"])

    def test_skips_project_steps_without_project(self):
        steps, _ = self.run_check(_fake_request_ok, creds=dict(CREDS, project_id=None))
        self.assertEqual([s["status"] for s in steps], ["OK", "OK", "SKIP", "SKIP"])

    def test_compute_missing_in_region_is_reported(self):
        steps, _ = self.run_check(_fake_request_ok, region="kz-1")
        self.assertEqual(steps[2]["status"], "OK")
        self.assertIn("НЕТ", steps[2]["detail"])


class CheckCliTest(unittest.TestCase):
    def test_exit_0_and_json(self):
        out = io.StringIO()
        with mock.patch.dict(os.environ, ENV, clear=True), \
             mock.patch("selectel.request", side_effect=_fake_request_ok), \
             mock.patch("sys.stdout", out):
            code = selectel.main(["--json", "check"])
        self.assertEqual(code, 0)
        self.assertEqual([s["status"] for s in json.loads(out.getvalue())], ["OK", "OK", "OK", "OK"])

    def test_exit_1_on_fail(self):
        out = io.StringIO()
        with mock.patch.dict(os.environ, ENV, clear=True), \
             mock.patch("selectel.request", side_effect=_failing_at("/zones", 500, HTML_500)), \
             mock.patch("sys.stdout", out):
            code = selectel.main(["check"])
        self.assertEqual(code, 1)
        self.assertIn("[FAIL] DNS v2", out.getvalue())
        self.assertIn("ИТОГ: FAIL", out.getvalue())
```

- [ ] **Step 2: Запустить тесты и убедиться, что новые падают**

Run: `cd plugins/selectel-ops && python3 -m unittest -v tests.test_selectel`
Expected: `AttributeError: module 'selectel' has no attribute 'run_check'`; `CheckCliTest` падает с кодом 2 вместо 0.

- [ ] **Step 3: Реализовать `explain`, `run_check`, `run_check_cli`**

В `selectel.py` удалить заглушку `run_check_cli` и вставить перед `if __name__ == "__main__":`:

```python
def explain(err, context):
    """Объяснение ошибки API для человека с учётом шага, на котором она случилась."""
    if err.status == 0:
        return err.message()
    if err.is_html and err.status >= 500:
        return (
            f"сервер вернул HTML с кодом {err.status}: временный сбой API Selectel, повторить позже "
            "(у Pulumi это `invalid character '<' looking for beginning of value`)"
        )
    if context == "domain-token" and err.status == 401:
        return "пароль, имя пользователя или номер аккаунта неверны"
    if context == "project-token" and err.status == 401:
        return "проекта нет или у пользователя нет роли на него; список: selectel.py projects"
    if context == "resell" and err.status == 403:
        return "нет роли member на аккаунт (панель → Управление доступом → Сервисные пользователи)"
    if context == "dns" and err.status == 401:
        return "DNS v2 принимает только project-scoped токен"
    return err.message()


def run_check(creds, project_id=None, region=None, emit=print):
    """Пошаговая диагностика. Возвращает шаги {name, status, detail}; status: OK / FAIL / SKIP."""
    region = region or creds.get("region") or DEFAULT_REGION
    steps = []

    def step(name, status, detail):
        steps.append({"name": name, "status": status, "detail": detail})
        emit(f"[{status}] {name}: {detail}")

    def finish():
        ok = all(s["status"] != "FAIL" for s in steps)
        emit("ИТОГ: " + ("OK" if ok else "FAIL"))
        return steps

    try:
        dtoken, dbody = issue_token(creds, "domain")
        roles = sorted(r.get("name", "") for r in dbody.get("roles", []))
        step("domain-токен", "OK", "роли: " + (", ".join(roles) or "нет"))
    except ApiError as e:
        step("domain-токен", "FAIL", explain(e, "domain-token"))
        return finish()

    try:
        projects = list_projects(dtoken)
        step("проекты аккаунта (resell)", "OK", f"{len(projects)} шт.")
    except ApiError as e:
        step("проекты аккаунта (resell)", "FAIL", explain(e, "resell"))

    pid = project_id or creds.get("project_id")
    ptoken = pbody = None
    if not pid:
        step("project-токен", "SKIP", "проект не задан (--project ID или project_id в clouds.yaml)")
    else:
        try:
            ptoken, pbody = issue_token(creds, "project", pid)
            compute = catalog_endpoints(pbody, "compute", region)
            step(f"project-токен {pid}", "OK",
                 f"compute в {region}: " + ("есть" if compute else "НЕТ, проверьте регион"))
        except ApiError as e:
            step(f"project-токен {pid}", "FAIL", explain(e, "project-token"))

    if ptoken is None:
        step("DNS v2", "SKIP", "нужен project-токен")
    else:
        dns = catalog_endpoints(pbody, "dnsv2", region) or catalog_endpoints(pbody, "dnsv2")
        url = (dns[0]["url"] if dns else DNS_URL_FALLBACK).rstrip("/") + "/zones"
        try:
            _, _, data = request("GET", url, token=ptoken)
            count = data.get("count", len(data.get("result", [])))
            step("DNS v2", "OK", f"зон в проекте: {count}")
        except ApiError as e:
            step("DNS v2", "FAIL", explain(e, "dns"))

    return finish()


def run_check_cli(creds, args):
    quiet = (lambda line: None) if args.json else print
    steps = run_check(creds, args.project, args.region, emit=quiet)
    if args.json:
        print(json.dumps(steps, ensure_ascii=False, indent=2))
    return 0 if all(s["status"] != "FAIL" for s in steps) else 1
```

- [ ] **Step 4: Запустить тесты и убедиться, что проходят**

Run: `cd plugins/selectel-ops && python3 -m unittest -v tests.test_selectel`
Expected: `OK` (32 теста)

- [ ] **Step 5: Commit**

```bash
git add plugins/selectel-ops/skills/selectel-ops/scripts/selectel.py plugins/selectel-ops/tests/test_selectel.py
git commit -m "feat(selectel-ops): диагностика check с расшифровкой ошибок"
```

---

### Task 4: Живая проверка скрипта на аккаунте Selectel

**Files:**
- Modify (только при найденных дефектах): `plugins/selectel-ops/skills/selectel-ops/scripts/selectel.py`, `plugins/selectel-ops/tests/test_selectel.py`

**Interfaces:**
- Consumes: весь CLI из Task 1–3.
- Produces: подтверждение, что скрипт работает с настоящим Keystone, resell и DNS v2; примеры вывода для `REFERENCE.md §8` (Task 5), записанные с плейсхолдерами вместо реальных id.

Креды: `clouds.yaml` вне репозитория; путь `<DIR>` и имя облака `<CLOUD>` даёт владелец. Ничего из вывода в репозиторий не копировать дословно — только форму.

- [ ] **Step 1: `check` с проектом из `clouds.yaml`**

Run: `cd <DIR> && python3 /Users/y.mihalev/projects/tp-prepare/claude-plugins/plugins/selectel-ops/skills/selectel-ops/scripts/selectel.py --cloud <CLOUD> check; echo "exit=$?"`
Expected: четыре строки `[OK]` (роли содержат `member`; проекты `N шт.`; `compute в ru-9: есть`; `зон в проекте: N`), `ИТОГ: OK`, `exit=0`. Если DNS v2 отвечает `[FAIL] ... временный сбой` — это известный флап API, повторить через несколько минут.

- [ ] **Step 2: `token` обоих scope и `projects`**

Run: `python3 .../selectel.py --cloud <CLOUD> token | wc -c` → Expected: число больше 100, одна строка.
Run: `python3 .../selectel.py --cloud <CLOUD> token --scope project | wc -c` → Expected: то же.
Run: `python3 .../selectel.py --cloud <CLOUD> projects` → Expected: таблица `id name enabled`, среди строк — проект из `clouds.yaml`.
Run: `python3 .../selectel.py --cloud <CLOUD> --json projects | python3 -c "import json,sys; print(len(json.load(sys.stdin)))"` → Expected: то же число, что строк в таблице.

- [ ] **Step 3: `catalog`**

Run: `python3 .../selectel.py --cloud <CLOUD> catalog --type dnsv2` → Expected: строки с `https://api.selectel.ru/domains/v2` для ru-регионов и `https://api.servercore.com/domains/v2` для kz/uz/ke.
Run: `python3 .../selectel.py --cloud <CLOUD> catalog --type compute --region ru-9` → Expected: одна строка `compute ru-9 public https://ru-9.cloud.api.selcloud.ru/compute/...`.

- [ ] **Step 4: Отрицательные проверки через переменные окружения**

Run: `SELECTEL_ACCOUNT=<ACCOUNT> SELECTEL_USERNAME=<USER> SELECTEL_PASSWORD=wrong python3 .../selectel.py check; echo "exit=$?"`
Expected: `[FAIL] domain-токен: пароль, имя пользователя или номер аккаунта неверны`, `ИТОГ: FAIL`, `exit=1`.

Run: `python3 .../selectel.py --cloud <CLOUD> check --project 00000000000000000000000000000000; echo "exit=$?"`
Expected: первые два шага `OK`, третий `[FAIL] project-токен 000...: проекта нет или у пользователя нет роли на него; список: selectel.py projects`, четвёртый `[SKIP] DNS v2`, `exit=1`.

Run: `python3 .../selectel.py --cloud <CLOUD> --json check | python3 -c "import json,sys; [print(s['status'], s['name']) for s in json.load(sys.stdin)]"`
Expected: четыре строки со статусами, ничего кроме JSON в stdout.

- [ ] **Step 5: Проверить, что пароль и токен не утекают**

Run: `python3 .../selectel.py --cloud <CLOUD> check 2>&1 | grep -c -iE 'password|x-subject|gAAAA'` → Expected: `0`.
Run: `grep -n 'sys.argv' plugins/selectel-ops/skills/selectel-ops/scripts/selectel.py || echo "argv напрямую не читается"` → Expected: `argv напрямую не читается` (пароль приходит только из окружения, файла или `getpass`).

- [ ] **Step 6: Если что-то расходится с ожиданием**

Починить в `selectel.py`, добавить регрессионный тест в `tests/test_selectel.py` на конкретную форму ответа API (с обезличенными данными), прогнать `python3 -m unittest -v tests.test_selectel`, повторить шаги 1–5. Записать реальную форму вывода (с плейсхолдерами) — она пойдёт в `REFERENCE.md §8`.

- [ ] **Step 7: Commit (только если были правки)**

```bash
git add plugins/selectel-ops/skills/selectel-ops/scripts/selectel.py plugins/selectel-ops/tests/test_selectel.py
git commit -m "fix(selectel-ops): правки по живой проверке скрипта"
```

---

### Task 5: `REFERENCE.md`

**Files:**
- Create: `plugins/selectel-ops/skills/selectel-ops/REFERENCE.md`

**Interfaces:**
- Consumes: спека, раздел «Что установлено на практике» (все таблицы) и вывод скрипта из Task 4.
- Produces: заголовки второго уровня ровно с такими именами, на них ссылается `SKILL.md` (Task 6): `## 1. Карта эндпоинтов`, `## 2. Токены Keystone`, `## 3. DNS v2`, `## 4. Имена сущностей`, `## 5. Таблица ошибок`, `## 6. Pulumi`, `## 7. Ansible`, `## 8. Скрипт selectel.py`.

- [ ] **Step 1: Написать проверку структуры (падает, пока файла нет)**

Создать `plugins/selectel-ops/tests/check_docs.sh`:

```bash
#!/usr/bin/env bash
# Структура и чистота документов скилла: заголовки на месте, нет идентификаторов чужого стенда.
set -u
cd "$(dirname "$0")/../skills/selectel-ops" || exit 2
fail=0
need() { grep -qF -- "$2" "$1" || { echo "нет в $1: $2"; fail=1; }; }

for h in "## 1. Карта эндпоинтов" "## 2. Токены Keystone" "## 3. DNS v2" "## 4. Имена сущностей" \
         "## 5. Таблица ошибок" "## 6. Pulumi" "## 7. Ansible" "## 8. Скрипт selectel.py"; do
  need REFERENCE.md "$h"
done
for s in "X-Subject-Token" "vpc/resell/v2/projects" "domains/v2/zones" "external-network" \
         "ExternalGatewayForFloatingIPNotFound" "invalid character '<'" "user_domain_name" \
         "keyed_groups" "getFlavorOutput" "DomainsRrsetV2" "dependsOn"; do
  need REFERENCE.md "$s"
done

if [ -f SKILL.md ]; then
  need SKILL.md "name: selectel-ops"
  need SKILL.md "description:"
  for h in "## Чего ты никогда не делаешь" "## Модель доступа за минуту" "## Куда идти с какой задачей" \
           "## Фаза 0" "## Процедуры" "## Только в панели" "## Selectel в Pulumi" "## Selectel в Ansible" \
           "## Когда что-то не получается" "## Что отдавать наружу"; do
    need SKILL.md "$h"
  done
  lines=$(wc -l < SKILL.md)
  [ "$lines" -le 230 ] || { echo "SKILL.md длиннее 230 строк: $lines"; fail=1; }
fi

# Утечки: IPv4, 32-hex id проектов, числа от 6 знаков (номера аккаунтов), fernet-токены.
# Без \b: BSD grep на macOS его не понимает.
leaks=$(grep -nE '([0-9]{1,3}\.){3}[0-9]{1,3}|[0-9a-f]{32}|(^|[^0-9.])[0-9]{6,}([^0-9.]|$)|gAAAA' SKILL.md REFERENCE.md scripts/selectel.py 2>/dev/null \
        | grep -vE '127\.0\.0\.1|0{32}|<ACCOUNT>|<PROJECT_ID>' || true)
[ -z "$leaks" ] || { echo "похоже на идентификаторы стенда:"; echo "$leaks"; fail=1; }
exit $fail
```

`chmod +x plugins/selectel-ops/tests/check_docs.sh`

Run: `plugins/selectel-ops/tests/check_docs.sh; echo "exit=$?"`
Expected: строки `нет в REFERENCE.md: ...`, `exit=1`

- [ ] **Step 2: Написать `REFERENCE.md`**

Заголовок `# Selectel: справочник` и вводная строка: «Детали для `SKILL.md`. Плейсхолдеры: `<ACCOUNT>` — номер аккаунта, `<USER>` — сервисный пользователь, `<PROJECT_ID>`, `<ZONE_ID>`, `<TOKEN>`.»

`## 1. Карта эндпоинтов` — таблица `Сервис | Где | Scope токена | Примечание`, строки из спеки («Доступ», «Каталог и регионы»): Identity `https://cloud.api.selcloud.ru/identity/v3` (любой); resell `https://api.selectel.ru/vpc/resell/v2` (domain; проекты аккаунта); compute/network/image/volumev3 — из каталога по региону `ru-N`, хосты `<region>.cloud.api.selcloud.ru` для ru/gis и `*.servercore.com` для kz/uz/ke (project); `dnsv2` `https://api.selectel.ru/domains/v2` (project; один на все ru-регионы). Абзац про регионы и зоны: пул `ru-9`, зона `ru-9a`; эндпоинт брать из каталога, не хардкодить.

`## 2. Токены Keystone` — два готовых `curl` с `awk`, вытаскивающим `X-Subject-Token`:

```bash
# domain-scope: IAM, resell, /auth/projects
curl -sS -i https://cloud.api.selcloud.ru/identity/v3/auth/tokens -H 'Content-Type: application/json' \
  -d '{"auth":{"identity":{"methods":["password"],"password":{"user":{"name":"<USER>","domain":{"name":"<ACCOUNT>"},"password":"<PASSWORD>"}}},"scope":{"domain":{"name":"<ACCOUNT>"}}}}' \
  | awk -F': ' 'tolower($1)=="x-subject-token"{print $2}' | tr -d '\r'

# project-scope: Nova, Neutron, Cinder, Glance, DNS v2
#   ... "scope":{"project":{"id":"<PROJECT_ID>"}} ...
```

Плюс: `GET /auth/projects` с domain-токеном (свои проекты), `GET https://api.selectel.ru/vpc/resell/v2/projects` (все проекты аккаунта), чтение каталога из тела ответа (`.token.catalog[]`), `openstack --os-cloud <имя> token issue -f value -c id` и `--os-project-id <PROJECT_ID>` как способ переключить проект без правки `clouds.yaml`. Список фактов из таблицы «Доступ» спеки — каждый одной строкой, включая «403 на `identity:list_projects` — норма» и «401 на project-scope при верном пароле — проекта нет или нет роли».

`## 3. DNS v2` — `curl`: `GET /zones`, `GET /zones?filter=<name>.`, `GET /zones/<ZONE_ID>/rrset`, `POST /zones/<ZONE_ID>/rrset` с телом `{"name":"<host>.<zone>.","type":"A","ttl":60,"records":[{"content":"<IP>"}]}` (все с `X-Auth-Token: <TOKEN>` project-scope). Правила из таблицы «DNS v2» спеки: точка на конце; зона в проекте, где зарегистрирован домен; одна зона на имя в аккаунте; для своего домена — делегирование у регистратора на `a.ns.selectel.ru`, `b.ns.selectel.ru`, `c.ns.selectel.ru`; флап 500 HTML и его вид в Pulumi.

`## 4. Имена сущностей` — из таблицы «Флейворы, диски, образы»: семейства флейворов с расшифровкой `SL1.<vcpu>-<ram>[-<disk>]` и что `disk = 0` значит сетевой загрузочный диск; типы дисков `<тип>.<зона>` с перечнем; примеры точных имён образов Ubuntu; `external-network`; команды CLI:

```bash
openstack --os-cloud <имя> flavor list --long          # ID, Name, RAM, Disk, VCPUs
openstack --os-cloud <имя> image list --public | grep -i ubuntu
openstack --os-cloud <имя> volume type list
openstack --os-cloud <имя> network list --external
openstack --os-cloud <имя> project list
```

`## 5. Таблица ошибок` — `Код/текст | Где | Причина | Действие`, минимум строки: 401 на domain-токене; 401 на project-токене; 403 `identity:list_projects`/`list_role_assignments`; 403 на создании проекта или пользователя (роли аккаунта, при необходимости администратор аккаунта); 409 `already_exists` на `vpc/resell/v2/projects`; 500 HTML от `api.selectel.ru/domains/v2` и `invalid character '<' looking for beginning of value` у Pulumi; `ExternalGatewayForFloatingIPNotFound` (404 Neutron); `Flavor not found`/`No suitable flavor`; `could not find image`; пустой `ansible-inventory --graph`; `CERTIFICATE_VERIFY_FAILED` у Python с python.org; `Port` в `sshd_config` не действует на Ubuntu ≥ 22.10 (`ssh.socket`).

`## 6. Pulumi` — фрагменты из таблицы «Pulumi» спеки, каждый до десяти строк TypeScript/YAML:

```yaml
# Pulumi.yaml
runtime:
  name: nodejs
  options:
    typescript: true
    packagemanager: bun          # иначе выбор по lock-файлу
packages:
  selectel:
    source: terraform-provider
    parameters: [selectel/selectel, "8.3.1"]
```

```bash
pulumi config set selectel:domainName <ACCOUNT>
pulumi config set selectel:username   <USER>
pulumi config set selectel:password   --secret
pulumi config set selectel:authUrl    https://cloud.api.selcloud.ru/identity/v3/
pulumi config set selectel:authRegion ru-9
```

```ts
const os = new openstack.Provider("project", {
  authUrl: "https://cloud.api.selcloud.ru/identity/v3", domainName,
  tenantId: project.id, userName: serviceUser.name, password: password.result, region: pool,
});
const flavor = openstack.compute.getFlavorOutput({ name: flavorName }, { provider: os });
new openstack.networking.FloatingIpAssociate("server", { portId: port.id, floatingIp: fip.address },
  { provider: os, dependsOn: [routerInterface] });   // иначе ExternalGatewayForFloatingIPNotFound
const zone = selectel.getDomainsZoneV2Output({ name: "example.ru.", projectId: dnsProjectId });
new selectel.DomainsRrsetV2("gateway", { zoneId: zone.id, projectId: dnsProjectId,
  name: "app.example.ru.", type: "A", ttl: 60, records: [{ content: fip.address }] });
```

Плюс одной строкой каждое: `VpcKeypairV2` требует `userId`; `IamServiceuserV1` роли `[{roleName: "member", scope: "project", projectId}]`; `ignoreChanges: ["imageId"]`; логические имена не переименовывать; имена уровня аккаунта из конфига; `DomainsZoneV2({ name, projectId: project.id })` для своего домена.

`## 7. Ansible` — шаблон `clouds.yaml` (оба domain-поля = `<ACCOUNT>`), `inventory/openstack.yml`:

```yaml
plugin: openstack.cloud.openstack
only_clouds: [<имя-облака>]
inventory_hostname: name
fail_on_errors: true
expand_hostvars: false
all_projects: false
keyed_groups:
  - key: openstack.metadata.role   # role=web -> группа web
    prefix: ""
    separator: ""
```

`requirements.yml` (`openstack.cloud >= 2.0.0`), `requirements.txt` (`openstacksdk>=1.0.0`), проверка `ansible-inventory --graph`, причины пустого inventory.

`## 8. Скрипт selectel.py` — путь `scripts/selectel.py` относительно скилла, источники кредов по приоритету (из спеки), таблица подкоманд, пример вывода `check` в форме из Task 4 с плейсхолдерами, коды выхода `0/1/2`, «только чтение».

- [ ] **Step 3: Прогнать проверку структуры**

Run: `plugins/selectel-ops/tests/check_docs.sh; echo "exit=$?"`
Expected: пустой вывод, `exit=0` (проверки `SKILL.md` пропускаются, файла ещё нет).

- [ ] **Step 4: Прочитать файл глазами**

Каждая таблица спеки «Что установлено на практике» отражена хотя бы в одном разделе; ни одной строки с чужими id, адресами, доменами; все `curl` копируются и выполняются после подстановки плейсхолдеров.

- [ ] **Step 5: Commit**

```bash
git add plugins/selectel-ops/skills/selectel-ops/REFERENCE.md plugins/selectel-ops/tests/check_docs.sh
git commit -m "docs(selectel-ops): REFERENCE.md — карта API, DNS v2, ошибки, Pulumi, Ansible"
```

---

### Task 6: `SKILL.md`

**Files:**
- Create: `plugins/selectel-ops/skills/selectel-ops/SKILL.md`

**Interfaces:**
- Consumes: заголовки `REFERENCE.md §1–8` (Task 5), CLI скрипта (Task 1–3), спека «`SKILL.md`» (десять разделов и frontmatter).
- Produces: скилл, который Claude Code показывает как `selectel-ops:selectel-ops`.

- [ ] **Step 1: Убедиться, что проверка структуры падает на отсутствии `SKILL.md`**

В `check_docs.sh` блок `if [ -f SKILL.md ]` пропускает отсутствующий файл. Заменить эту строку на `[ -f SKILL.md ] || { echo "нет SKILL.md"; fail=1; }` и убрать закрывающий `fi` вместе с условием так, чтобы проверки `SKILL.md` выполнялись всегда.

Run: `plugins/selectel-ops/tests/check_docs.sh; echo "exit=$?"`
Expected: `нет SKILL.md`, `exit=1`

- [ ] **Step 2: Написать `SKILL.md`**

Frontmatter — дословно из спеки, раздел «`SKILL.md`». Затем заголовок `# Selectel Ops` и десять разделов, каждый с заголовком второго уровня ровно как в `check_docs.sh`:

1. `## Чего ты никогда не делаешь` — четыре пункта из спеки: пароли и токены (токен — только по `selectel.py token`, и только он); удаление проектов, серверов, зон — только по явной просьбе в этой сессии; в общем аккаунте никаких обобщённых имён уровня аккаунта (`study`, `test`, `pulumi-*`); id флейворов, имена образов и сетей — только из API.
2. `## Модель доступа за минуту` — шесть строк: аккаунт = домен Keystone, номер аккаунта = `domainName`; два вида сервисных пользователей; роли `member`, `iam.admin`, администратор аккаунта; domain-scope для IAM/resell, project-scope для всего внутри проекта; 401 на project-scope при верном пароле = проекта нет или нет роли; 403 на `identity:list_*` — норма. Ссылка: «тела запросов — REFERENCE §2».
3. `## Куда идти с какой задачей` — таблица `Задача | Инструмент`:

| Задача | Инструмент |
|---|---|
| флейвор, образ, тип диска, внешняя сеть | `openstack --os-cloud <имя> ...` внутри любого проекта аккаунта (REFERENCE §4) |
| список проектов и их id | `python3 scripts/selectel.py --cloud <имя> projects` |
| токен для `curl` | `scripts/selectel.py token [--scope project]` или `openstack token issue -f value -c id` |
| создать проект, проектного пользователя, keypair | IaC (Pulumi, REFERENCE §6) или панель |
| DNS-запись | IaC или `curl` к DNS v2 (REFERENCE §3) |
| первый сервисный пользователь аккаунта и его роли | только панель |
| сервер не отвечает по ssh | консоль сервера в панели |

4. `## Фаза 0 — pre-flight` — команда `python3 <путь к скиллу>/scripts/selectel.py --cloud <имя> check` (или с `SELECTEL_*`), что означает каждая из четырёх строк вывода, что при `FAIL` идти в раздел «Когда что-то не получается». Без `OK` на domain-токене дальше не двигаться.
5. `## Процедуры` — подразделы третьего уровня: токен; проекты; флейворы, образы, типы дисков (команды из REFERENCE §4, правило «имя, а не id», `disk = 0` для сетевого диска, зона диска = зона сервера); DNS (найти зону `?filter=<name>.`, записи, создать A; точка на конце; зона в проекте домена); сети (`network list --external`, имя `external-network`).
6. `## Только в панели` — сервисный пользователь аккаунта и роли (пароль показывается один раз; при 403 на создании проекта — роль администратора аккаунта); консоль сервера при потере ssh.
7. `## Selectel в Pulumi` — десять строк-правил из таблицы «Pulumi» спеки с указателем «фрагменты — REFERENCE §6»: `packages` и `pulumi install`; `sdks/` в `.gitignore`; `packagemanager`; конфиг `selectel:*`; провайдер openstack внутри проекта; `getFlavorOutput` по имени; `dependsOn: [routerInterface]` у `FloatingIpAssociate`; `ignoreChanges: ["imageId"]`; DNS через `getDomainsZoneV2Output` + `DomainsRrsetV2` с `projectId` зоны или `DomainsZoneV2` для своего домена; имена уровня аккаунта из конфига; логические имена не переименовывать.
8. `## Selectel в Ansible` — `clouds.yaml` (оба domain-поля = номер аккаунта), inventory `openstack.cloud` по `metadata`, `openstacksdk` + коллекция, `ansible-inventory --graph` первой проверкой; указатель «шаблоны — REFERENCE §7».
9. `## Когда что-то не получается` — таблица `Симптом | Причина | Действие`, короткая версия REFERENCE §5 (те же строки, по одной фразе).
10. `## Что отдавать наружу` — что проверено и какой командой, каким scope; что осталось за пользователем (панель, `pulumi up`, оплата); ни токенов, ни паролей в ответе.

- [ ] **Step 3: Прогнать проверку структуры и длины**

Run: `plugins/selectel-ops/tests/check_docs.sh; echo "exit=$?"; wc -l plugins/selectel-ops/skills/selectel-ops/SKILL.md`
Expected: пустой вывод, `exit=0`, строк ≤ 230 (ориентир 200). Если больше — переносить детали в `REFERENCE.md`, не удалять разделы.

- [ ] **Step 4: Проверить frontmatter как YAML**

Run: `python3 -c "import yaml,sys; t=open('plugins/selectel-ops/skills/selectel-ops/SKILL.md').read().split('---')[1]; d=yaml.safe_load(t); print(d['name'], len(d['description']))"`
Expected: `selectel-ops <число>`; описание одной строкой, без переносов внутри.

- [ ] **Step 5: Commit**

```bash
git add plugins/selectel-ops/skills/selectel-ops/SKILL.md plugins/selectel-ops/tests/check_docs.sh
git commit -m "docs(selectel-ops): SKILL.md — процедуры работы с Selectel"
```

---

### Task 7: README плагина, LICENSE, маркетплейс, установка и проверка срабатывания

**Files:**
- Create: `plugins/selectel-ops/README.md`
- Create: `plugins/selectel-ops/LICENSE` (копия)
- Modify: `.claude-plugin/marketplace.json` (массив `plugins`)
- Modify: `README.md` (таблица «Плагины»)

**Interfaces:**
- Consumes: готовый скилл из Task 5–6, скрипт из Task 1–4.
- Produces: плагин, который ставится командой `/plugin install selectel-ops@yarikmix-plugins`.

- [ ] **Step 1: LICENSE и README плагина**

Run: `cp plugins/typescript-native-lsp/LICENSE plugins/selectel-ops/LICENSE`

`plugins/selectel-ops/README.md`:

```markdown
# selectel-ops

Скилл для работы с облаком Selectel из Claude Code: модель доступа и роли сервисных пользователей,
токены нужного scope, проекты, флейворы, образы, типы дисков, DNS v2, диагностика ошибок API и
проверенные особенности стыка Selectel с Pulumi (`terraform-provider-selectel`) и Ansible
(`clouds.yaml`, dynamic inventory `openstack.cloud`).

В комплекте `scripts/selectel.py` — диагностика доступа одной командой. Скрипт только читает:
ни создания, ни удаления ресурсов.

## Требования

- Python 3.8 или новее. Сторонние пакеты не нужны; `PyYAML` — только для чтения `clouds.yaml`
  (`pip install pyyaml`), без него креды задаются переменными `SELECTEL_ACCOUNT`, `SELECTEL_USERNAME`,
  `SELECTEL_PASSWORD`.
- По желанию `openstack` CLI (`pip install python-openstackclient`) — так удобнее смотреть флейворы,
  образы и типы дисков.
- Сервисный пользователь Selectel с ролью `member` на аккаунт или на нужный проект.

## Установка

```text
/plugin marketplace add YarikMix/claude-plugins
/plugin install selectel-ops@yarikmix-plugins
```

## Проверка доступа

```bash
python3 ~/.claude/plugins/marketplaces/yarikmix-plugins/plugins/selectel-ops/skills/selectel-ops/scripts/selectel.py --cloud <имя-облака-из-clouds.yaml> check
```

Четыре строки `[OK]` — можно работать. Расшифровка `[FAIL]` — в `SKILL.md`, раздел
«Когда что-то не получается».

## Чего скилл не делает

Не пишет в облако (создание и удаление — через Pulumi или руками в панели), не автоматизирует
панель через браузер, не покрывает S3, Managed Kubernetes, DBaaS и биллинг.

## Installation

Requires Python 3.8+. Optional: `pyyaml` (to read `clouds.yaml`) and `python-openstackclient`.

```text
/plugin marketplace add YarikMix/claude-plugins
/plugin install selectel-ops@yarikmix-plugins
```

Then run `scripts/selectel.py --cloud <name> check` to verify access. The skill is read-only.
```

Путь в «Проверка доступа» сверить по факту установки (Step 4): если маркетплейсы лежат в другом каталоге, поправить путь в README.

- [ ] **Step 2: Запись в `marketplace.json` и строка в корневом README**

В `.claude-plugin/marketplace.json` добавить в массив `plugins` после `typescript-native-lsp`:

```json
    {
      "name": "selectel-ops",
      "description": "Работа с облаком Selectel: доступ, проекты, флейворы, DNS, диагностика, стык с Pulumi и Ansible",
      "version": "1.0.0",
      "author": {
        "name": "Yaroslav Mihalev"
      },
      "source": "./plugins/selectel-ops",
      "category": "development",
      "strict": false
    }
```

В корневой `README.md` добавить строку в таблицу «Плагины»:

```markdown
| [selectel-ops](plugins/selectel-ops/README.md) | скилл для работы с облаком Selectel: доступ, API, DNS, стык с Pulumi и Ansible | `/plugin install selectel-ops@yarikmix-plugins` |
```

Run: `python3 -c "import json; d=json.load(open('.claude-plugin/marketplace.json')); print([p['name'] for p in d['plugins']])"`
Expected: `['typescript-native-lsp', 'selectel-ops']`

- [ ] **Step 3: Валидация плагина и маркетплейса**

Run: `claude plugin validate plugins/selectel-ops; echo "exit=$?"`
Expected: без ошибок, `exit=0`. Если валидатор требует `.claude-plugin/plugin.json` — создать `plugins/selectel-ops/.claude-plugin/plugin.json`:

```json
{
  "name": "selectel-ops",
  "description": "Работа с облаком Selectel: доступ, проекты, флейворы, DNS, диагностика, стык с Pulumi и Ansible",
  "version": "1.0.0",
  "author": { "name": "Yaroslav Mihalev" }
}
```

и повторить. Run: `claude plugin validate .; echo "exit=$?"` → Expected: `exit=0`.

- [ ] **Step 4: Скилл виден и срабатывает без упоминания имени**

Run: `claude --plugin-dir plugins/selectel-ops -p "Перечисли имена доступных тебе скиллов, только список." --output-format text`
Expected: в списке `selectel-ops` (как `selectel-ops:selectel-ops` или `selectel-ops`).

Run: `claude --plugin-dir plugins/selectel-ops -p "Мне нужно узнать, какой флейвор взять в Selectel под 2 vCPU и 4 ГБ. С чего начать? Коротко." --output-format text`
Expected: ответ опирается на скилл: упоминает `openstack flavor list` или `selectel.py check`, семейство `SL1.2-4096` или правило «имя, а не id». Если ответ общий и без этих признаков — усилить триггеры в `description` (`SKILL.md`) словами из вопроса и повторить.

Run: `ls ~/.claude/plugins/marketplaces/ 2>/dev/null` → сверить путь из README §«Проверка доступа»; при расхождении поправить README.

- [ ] **Step 5: Полная проверка репозитория**

Run: `cd plugins/selectel-ops && python3 -m unittest -v tests.test_selectel && tests/check_docs.sh && cd ../..; echo "exit=$?"`
Expected: `OK` по тестам, пустой вывод `check_docs.sh`, `exit=0`.

Run: `grep -rnE '([0-9]{1,3}\.){3}[0-9]{1,3}|[0-9a-f]{32}|(^|[^0-9.])[0-9]{6,}([^0-9.]|$)' plugins/selectel-ops docs/superpowers/specs/2026-09-26-selectel-ops-design.md docs/superpowers/plans/2026-09-26-selectel-ops.md | grep -vE '127\.0\.0\.1|0{32}|<ACCOUNT>|<PROJECT_ID>|MIT License' || echo "чисто"`
Expected: `чисто` (допустимы только версии вроде `1.0.0` — они не попадают под шаблоны).

Run: `git status --short`
Expected: только файлы плагина, `marketplace.json`, `README.md`; `.DS_Store` остаются untracked и в коммит не идут.

- [ ] **Step 6: Commit**

```bash
git add plugins/selectel-ops/README.md plugins/selectel-ops/LICENSE .claude-plugin/marketplace.json README.md
git add plugins/selectel-ops/.claude-plugin/plugin.json 2>/dev/null || true
git commit -m "feat: плагин selectel-ops в маркетплейсе"
```

`git push` — после подтверждения владельца.

---

## Self-review

**Покрытие спеки.** Доступ, каталог, флейворы, сеть, DNS, Pulumi, Ansible, окружение → REFERENCE §1–7 и SKILL §2, §5, §7, §8, §9 (Task 5–6). Структура плагина, маркетплейс, README → Task 7. Скрипт: креды по приоритету и `getpass` → Task 1; подкоманды `token`/`projects`/`catalog` с `--json` → Task 2; `check` с пятью шагами и кодами выхода → Task 3; `certifi` → `ssl_context` в Task 1; «только чтение» → в скрипте нет ни одного запроса кроме `GET` и `POST /auth/tokens`. Проверка: живой аккаунт → Task 4; установка, видимость, срабатывание, `validate`, grep на утечки → Task 7; потолок 230 строк → `check_docs.sh`.

**Плейсхолдеры.** Код скрипта и тестов приведён целиком. Для `REFERENCE.md` и `SKILL.md` заданы точные заголовки, обязательные строки (проверяются `check_docs.sh`), готовые фрагменты `curl`/YAML/TS и ссылки на конкретные таблицы спеки, откуда берутся факты.

**Согласованность имён.** `request(method, url, token=None, body=None)` — сигнатура одинакова в Task 1 (реализация), Task 2 (`_fake_request_ok`) и Task 3 (`_failing_at`, `CheckTest`). `issue_token(creds, scope, project_id)` возвращает `(token, token_body)`, `catalog_endpoints(token_body, type_, region, interface)` — так и вызываются в `run_check`. Статусы шагов `OK`/`FAIL`/`SKIP` и строка `ИТОГ:` — одинаковы в `run_check` и тестах. `run_check_cli` объявлен заглушкой в Task 2 и заменён в Task 3. Заголовки `REFERENCE.md §1–8` и десять заголовков `SKILL.md` — одни и те же в Task 5, Task 6 и `check_docs.sh`.
