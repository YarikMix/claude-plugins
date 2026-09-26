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

    def test_timeout_becomes_api_error_status_0(self):
        with mock.patch("selectel.urllib.request.urlopen", side_effect=TimeoutError("timed out")):
            with self.assertRaises(selectel.ApiError) as ctx:
                selectel.request("GET", "https://x")
        self.assertEqual(ctx.exception.status, 0)

    def test_non_json_2xx_becomes_api_error_with_html(self):
        fake = _FakeResponse(200, {}, "<html><body>500</body></html>")
        with mock.patch("selectel.urllib.request.urlopen", return_value=fake):
            with self.assertRaises(selectel.ApiError) as ctx:
                selectel.request("GET", "https://x")
        self.assertEqual(ctx.exception.status, 200)
        self.assertTrue(ctx.exception.is_html)


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

    def test_json_after_subcommand(self):
        code, out = self.run_main(["projects", "--json"])
        self.assertEqual(code, 0)
        self.assertEqual(json.loads(out), [{"id": "p1", "name": "one", "enabled": True}])

    def test_cloud_after_subcommand_is_accepted(self):
        self.assertEqual(selectel.build_parser().parse_args(["check", "--cloud", "x"]).cloud, "x")

    def test_token_project_flag_implies_project_scope(self):
        code, out = self.run_main(["token", "--project", "zzz"])
        self.assertEqual((code, out), (0, "ptok\n"))

    def test_token_scope_domain_with_project_is_usage_error(self):
        err = io.StringIO()
        with mock.patch.dict(os.environ, ENV, clear=True), \
             mock.patch("selectel.request", side_effect=_fake_request_ok), \
             mock.patch("sys.stderr", err):
            code = selectel.main(["token", "--scope", "domain", "--project", "zzz"])
        self.assertEqual(code, 2)
        self.assertIn("--project", err.getvalue())


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


if __name__ == "__main__":
    unittest.main()
