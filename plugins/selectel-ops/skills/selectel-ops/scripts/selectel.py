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
