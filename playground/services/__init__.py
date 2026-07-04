from __future__ import annotations

from importlib import import_module
from typing import Any

__all__ = [
    "ContractingService",
    "ENVIRONMENT_FIELDS",
    "DEFAULT_SIGNER",
    "DEFAULT_ENVIRONMENT",
    "ContractDetails",
    "ContractExportInfo",
    "FunctionParameter",
    "lint_contract",
    "SessionRuntimeManager",
    "session_runtime",
    "SESSION_COOKIE_NAME",
    "SESSION_COOKIE_MAX_AGE",
    "pack_session_cookie",
    "parse_session_cookie",
    "SessionRepository",
    "SessionMetadata",
    "SessionNotFoundError",
]

_EXPORT_MAP = {
    "contracting": {
        "ContractingService",
        "ENVIRONMENT_FIELDS",
        "DEFAULT_SIGNER",
        "DEFAULT_ENVIRONMENT",
        "ContractDetails",
        "ContractExportInfo",
        "FunctionParameter",
    },
    "linting": {"lint_contract"},
    "runtime": {
        "SessionRuntimeManager",
        "session_runtime",
        "SESSION_COOKIE_NAME",
        "SESSION_COOKIE_MAX_AGE",
        "pack_session_cookie",
        "parse_session_cookie",
    },
    "sessions": {
        "SessionRepository",
        "SessionMetadata",
        "SessionNotFoundError",
    },
}


def __getattr__(name: str) -> Any:
    for module_name, symbols in _EXPORT_MAP.items():
        if name in symbols:
            module = import_module(f".{module_name}", __name__)
            value = getattr(module, name)
            globals()[name] = value
            return value
    raise AttributeError(name)
