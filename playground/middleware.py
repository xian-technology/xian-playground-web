"""ASGI middleware ensuring each request carries a valid session cookie."""

from __future__ import annotations

import os
from urllib.parse import urlparse

from reflex.config import get_config
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import Response

from .services import (
    SESSION_COOKIE_MAX_AGE,
    SESSION_COOKIE_NAME,
    SessionNotFoundError,
    pack_session_cookie,
    session_runtime,
)
from .services.sessions import SessionMetadata


def _env_secure_cookie_override() -> bool | None:
    raw = os.getenv("PLAYGROUND_SESSION_COOKIE_SECURE")
    if raw is None or raw.strip() == "":
        return None
    value = raw.strip().lower()
    if value in {"1", "true", "yes", "on"}:
        return True
    if value in {"0", "false", "no", "off"}:
        return False
    return None


def _infer_secure_cookie(request: Request | None) -> bool:
    """Derive whether to mark cookies secure based on the request/deploy URL."""

    if request is not None:
        forwarded_header = request.headers.get("forwarded", "")
        forwarded_proto = ""
        if forwarded_header:
            try:
                # RFC 7239 allows multiple Forwarded entries; use the first proto value.
                first_entry = forwarded_header.split(",")[0]
                parts = [part.strip() for part in first_entry.split(";")]
                for part in parts:
                    if part.lower().startswith("proto="):
                        forwarded_proto = part.split("=", 1)[1].strip().lower()
                        break
            except Exception:
                forwarded_proto = ""

        forwarded = (request.headers.get("x-forwarded-proto") or "").split(",")[0].strip().lower()
        scheme = forwarded_proto or forwarded or request.url.scheme.lower()
        if scheme == "https":
            return True

    deploy = (get_config().deploy_url or "").strip()
    if deploy:
        parsed = urlparse(deploy)
        if parsed.scheme.lower() == "https":
            return True

    return False


def issue_session_cookie(
    response: Response,
    metadata: SessionMetadata,
    *,
    secure: bool | None = None,
    request: Request | None = None,
) -> None:
    override = _env_secure_cookie_override() if secure is None else secure
    flag = override if override is not None else _infer_secure_cookie(request)
    response.set_cookie(
        SESSION_COOKIE_NAME,
        pack_session_cookie(metadata),
        httponly=True,
        samesite="lax",
        secure=flag,
        max_age=SESSION_COOKIE_MAX_AGE,
        path="/",
    )


class SessionCookieMiddleware(BaseHTTPMiddleware):
    """Ensure every HTTP request has a server-issued session cookie."""

    def __init__(self, app, *, secure: bool | None = None):
        super().__init__(app)
        self._secure_override = _env_secure_cookie_override() if secure is None else secure

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        incoming = request.cookies.get(SESSION_COOKIE_NAME)
        try:
            metadata, created = session_runtime.resolve_or_create(
                incoming,
                create_if_missing=False,
            )
            request.state.session_id = metadata.session_id
        except SessionNotFoundError:
            metadata, created = None, False
            request.state.session_id = None
        response = await call_next(request)
        if metadata and (created or incoming != pack_session_cookie(metadata)):
            issue_session_cookie(
                response,
                metadata,
                secure=self._secure_override,
                request=request,
            )
        return response
