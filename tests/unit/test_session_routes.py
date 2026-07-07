from __future__ import annotations

import asyncio
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from starlette.requests import Request

from playground.playground import (
    _frontend_redirect_target,
    create_session_route,
    resume_session_route,
)
from playground.services.runtime import (
    SESSION_COOKIE_NAME,
    SessionRuntimeManager,
    pack_session_cookie,
)
from playground.services.sessions import SessionRepository


def _request(
    *,
    method: str = "GET",
    path: str = "/",
    query_string: str = "",
    path_params: dict[str, str] | None = None,
    json_body: dict[str, object] | None = None,
) -> Request:
    body = b""
    headers = [(b"host", b"example.com")]
    if json_body is not None:
        body = json.dumps(json_body).encode()
        headers.append((b"content-type", b"application/json"))
    scope = {
        "type": "http",
        "http_version": "1.1",
        "method": method,
        "path": path,
        "raw_path": path.encode(),
        "root_path": "",
        "scheme": "http",
        "query_string": query_string.encode(),
        "headers": headers,
        "client": ("127.0.0.1", 12345),
        "server": ("example.com", 80),
        "path_params": path_params or {},
    }

    async def receive():
        return {"type": "http.request", "body": body, "more_body": False}

    return Request(scope, receive)


class SessionRouteSecurityTest(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.repo = SessionRepository(root=Path(self._tmp.name))
        self.manager = SessionRuntimeManager(
            repository=self.repo,
            max_idle_seconds=0,
            reap_interval_seconds=0,
        )
        self.addCleanup(self.manager.shutdown)

    def test_frontend_redirect_target_rejects_external_next(self) -> None:
        with patch("playground.playground.get_config") as mock_get_config:
            mock_get_config.return_value.deploy_url = ""
            request = _request(query_string="next=https%3A%2F%2Fevil.example%2F")
            self.assertEqual(_frontend_redirect_target(request), "/")

            relative = _request(query_string="next=%2Fstate%3Ftab%3Denv")
            self.assertEqual(_frontend_redirect_target(relative), "/state?tab=env")

    def test_create_session_route_issues_bound_cookie(self) -> None:
        with (
            patch("playground.playground.session_runtime", self.manager),
            patch("playground.playground.get_config") as mock_get_config,
        ):
            mock_get_config.return_value.deploy_url = ""
            response = asyncio.run(
                create_session_route(_request(path="/sessions/new", query_string="next=%2F"))
            )

        self.assertEqual(response.headers["location"], "/")
        session_id = self.repo.list_sessions()[0]
        metadata = self.repo.load_metadata(session_id)
        self.assertIn(f"{SESSION_COOKIE_NAME}={pack_session_cookie(metadata)}", response.headers["set-cookie"])

    def test_post_resume_consumes_single_use_token_and_sets_bound_cookie(self) -> None:
        session = self.manager.create_session()
        token = self.manager.create_resume_token(session.session_id)
        with patch("playground.playground.session_runtime", self.manager):
            response = asyncio.run(
                resume_session_route(
                    _request(
                        method="POST",
                        path="/sessions/resume",
                        query_string="next=%2F",
                        json_body={"token": token},
                    )
                )
            )

            replay = asyncio.run(
                resume_session_route(
                    _request(
                        method="POST",
                        path="/sessions/resume",
                        query_string="next=%2F",
                        json_body={"token": token},
                    )
                )
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(json.loads(response.body), {"redirect": "/"})
        adopted = self.repo.load_metadata(session.session_id)
        self.assertIn(f"{SESSION_COOKIE_NAME}={pack_session_cookie(adopted)}", response.headers["set-cookie"])
        self.assertEqual(replay.status_code, 404)


if __name__ == "__main__":
    unittest.main()
