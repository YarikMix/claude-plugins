#!/usr/bin/env python3
"""Токен, проекты, каталог и диагностика доступа к облаку Selectel. Только чтение.

Креды: --cloud NAME из clouds.yaml (нужен PyYAML) или переменные окружения
SELECTEL_ACCOUNT, SELECTEL_USERNAME, SELECTEL_PASSWORD (необязательно
SELECTEL_PROJECT_ID, SELECTEL_REGION, SELECTEL_AUTH_URL).
Пароль в аргументы не передаётся и никогда не печатается.
"""
import argparse
import getpass
import http.client
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
            try:
                return resp.status, resp.headers, (json.loads(raw) if raw.strip() else {})
            except ValueError:
                raise ApiError(resp.status, raw, url) from None
    except urllib.error.HTTPError as e:
        raise ApiError(e.code, e.read().decode("utf-8", "replace"), url) from None
    except (urllib.error.URLError, OSError, http.client.HTTPException) as e:
        # HTTPError субклассит URLError — ловим первым выше; TimeoutError — подкласс OSError;
        # RemoteDisconnected/ConnectionResetError при чтении тела ловим через OSError.
        raise ApiError(0, str(getattr(e, "reason", e)), url) from None


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
    # Глобальные опции нужны и до, и после подкоманды (`--json projects` и `projects --json`).
    # parent объявляет их с default=SUPPRESS: атрибут появляется в Namespace, только если опцию
    # реально передали после подкоманды, — иначе остаются дефолты основного парсера.
    parent = argparse.ArgumentParser(add_help=False)
    parent.add_argument("--cloud", default=argparse.SUPPRESS, help="имя облака из clouds.yaml")
    parent.add_argument(
        "--clouds-file", default=argparse.SUPPRESS,
        help="путь к clouds.yaml (по умолчанию ./, ~/.config/openstack, /etc/openstack)",
    )
    parent.add_argument(
        "--json", action="store_true", default=argparse.SUPPRESS,
        help="машиночитаемый вывод (кроме token)",
    )

    p = argparse.ArgumentParser(
        prog="selectel.py",
        description="Токен, проекты, каталог и диагностика доступа к Selectel (только чтение).",
    )
    p.add_argument("--cloud", help="имя облака из clouds.yaml (можно и после подкоманды)")
    p.add_argument(
        "--clouds-file",
        help="путь к clouds.yaml (по умолчанию ./, ~/.config/openstack, /etc/openstack; можно и после подкоманды)",
    )
    p.add_argument(
        "--json", action="store_true",
        help="машиночитаемый вывод, кроме token (можно и после подкоманды)",
    )
    sub = p.add_subparsers(dest="cmd", required=True)
    t = sub.add_parser("token", help="напечатать токен, только его", parents=[parent])
    t.add_argument(
        "--scope", choices=("domain", "project"), default=None,
        help="domain (по умолчанию) или project; --project без --scope тоже включает project, "
             "а --scope domain вместе с --project — ошибка",
    )
    t.add_argument("--project", help="id проекта для scope=project")
    sub.add_parser("projects", help="проекты аккаунта (resell API)", parents=[parent])
    c = sub.add_parser("catalog", help="эндпоинты из каталога Keystone", parents=[parent])
    c.add_argument("--type", dest="type_", help="тип сервиса: compute, network, image, volumev3, dnsv2 ...")
    c.add_argument("--region", help="регион, например ru-9")
    c.add_argument("--project", help="id проекта; без него — из кредов")
    k = sub.add_parser("check", help="диагностика доступа и живости API", parents=[parent])
    k.add_argument("--project", help="id проекта; без него — из кредов")
    k.add_argument("--region", help="регион для проверки compute; по умолчанию из кредов")
    return p


def main(argv=None):
    args = build_parser().parse_args(argv)
    try:
        creds = load_credentials(args.cloud, args.clouds_file)
        if args.cmd == "token":
            if args.scope == "domain" and args.project:
                raise UsageError("--project подразумевает --scope project")
            scope = args.scope or ("project" if args.project else "domain")
            token, _ = issue_token(creds, scope, args.project)
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


if __name__ == "__main__":
    sys.exit(main())

