"""Utility helpers to lint contracts using the official Xian linter."""

from __future__ import annotations

import atexit
from concurrent.futures import ThreadPoolExecutor
from typing import List

from xian_linter import LintErrorModel, lint_code_inline


def _format_error(error: LintErrorModel) -> str:
    position = getattr(error, "position", None)
    message = getattr(error, "message", "")

    if position is None:
        return message

    line = getattr(position, "line", None)
    column = getattr(position, "column", getattr(position, "col", None))

    location = ""
    if line is not None:
        location = f"Line {line + 1}"
        if column is not None:
            location += f", Col {column + 1}"
        location += ": "
    return f"{location}{message}"


# Keep linting work isolated from the main event loop and shut down cleanly.
_EXECUTOR = ThreadPoolExecutor(max_workers=1)
atexit.register(_EXECUTOR.shutdown, wait=False)


def lint_contract(code: str) -> List[str]:
    """Run the linter synchronously using xian-linter's inline helper."""

    future = _EXECUTOR.submit(lint_code_inline, code)
    errors = future.result()
    return [_format_error(error) for error in errors]
