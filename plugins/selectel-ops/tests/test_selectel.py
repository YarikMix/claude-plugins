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
