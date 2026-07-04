from __future__ import annotations

import os
import unittest
from contextlib import contextmanager
from unittest.mock import patch

from starlette.requests import Request
from starlette.responses import Response

from playground.middleware import (
    _env_secure_cookie_override,
    _infer_secure_cookie,
    issue_session_cookie,
)
from playground.services.sessions import SessionMetadata


def _make_request(*, scheme: str = "http", headers: dict[str, str] | None = None) -> Request:
    raw_headers = []
    for key, value in (headers or {}).items():
        raw_headers.append((key.lower().encode(), value.encode()))
    raw_headers.append((b"host", b"example.com"))
    scope = {
        "type": "http",
        "http_version": "1.1",
        "method": "GET",
        "path": "/",
        "raw_path": b"/",
        "root_path": "",
        "scheme": scheme,
        "headers": raw_headers,
    }
    return Request(scope)


@contextmanager
def _env(var: str, value: str | None):
    original = os.environ.get(var)
    if value is None:
        os.environ.pop(var, None)
    else:
        os.environ[var] = value
    try:
        yield
    finally:
        if original is None:
            os.environ.pop(var, None)
        else:
            os.environ[var] = original


class MiddlewareSecurityTest(unittest.TestCase):
    def test_env_override_parsing(self) -> None:
        with _env("PLAYGROUND_SESSION_COOKIE_SECURE", "true"):
            self.assertTrue(_env_secure_cookie_override())
        with _env("PLAYGROUND_SESSION_COOKIE_SECURE", "0"):
            self.assertFalse(_env_secure_cookie_override())
        with _env("PLAYGROUND_SESSION_COOKIE_SECURE", None):
            self.assertIsNone(_env_secure_cookie_override())

    def test_infer_secure_prefers_forwarded_proto(self) -> None:
        with patch("playground.middleware.get_config") as mock_get_config:
            mock_get_config.return_value.deploy_url = ""
            req = _make_request(scheme="http", headers={"x-forwarded-proto": "https"})
            self.assertTrue(_infer_secure_cookie(req))
            req2 = _make_request(scheme="http")
            self.assertFalse(_infer_secure_cookie(req2))

    def test_issue_cookie_marks_secure_when_https(self) -> None:
        request = _make_request(scheme="https")
        response = Response()
        metadata = SessionMetadata.new("abc")
        with _env("PLAYGROUND_SESSION_COOKIE_SECURE", None):
            issue_session_cookie(response, metadata, request=request)
        header = response.headers["set-cookie"]
        self.assertIn("Secure", header)
        self.assertIn(f"xian_session_id={metadata.session_id}.", header)

    def test_issue_cookie_omits_secure_when_overridden_false(self) -> None:
        request = _make_request(scheme="https")
        response = Response()
        metadata = SessionMetadata.new("abc")
        with _env("PLAYGROUND_SESSION_COOKIE_SECURE", "0"):
            issue_session_cookie(response, metadata, request=request)
        header = response.headers["set-cookie"]
        self.assertNotIn("Secure", header)


if __name__ == "__main__":
    unittest.main()
