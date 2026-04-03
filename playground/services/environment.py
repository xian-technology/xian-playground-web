"""Helpers for working with environment fields."""

from __future__ import annotations

from datetime import datetime as PyDatetime

from xian_runtime_types.time import Datetime as ContractingDatetime


def stringify_environment_value(value: object) -> str:
    """Convert runtime environment values into editable strings."""
    if isinstance(value, ContractingDatetime):
        return value._datetime.isoformat()
    if isinstance(value, PyDatetime):
        return value.isoformat()
    if value is None:
        return ""
    return str(value)
