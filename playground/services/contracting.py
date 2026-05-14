from __future__ import annotations

import ast
import decimal
import json
import threading
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List

from contracting import constants
from contracting.local import ContractingClient
from contracting.names import is_safe_contract_name
from contracting.storage.driver import Driver
from xian_runtime_types.decimal import ContractingDecimal
from xian_runtime_types.time import Datetime

from .environment import stringify_environment_value


DEFAULT_SIGNER = "demo"
DEFAULT_ENVIRONMENT: Dict[str, str] = {
    "signer": DEFAULT_SIGNER,
    "now": "2024-02-01T12:30:00",
    "block_num": "100",
    "block_hash": "0xabc...",
}

ENVIRONMENT_FIELDS: List[Dict[str, str]] = [
    {
        "key": "signer",
        "label": "signer",
        "tooltip": (
            "Override ctx.signer for executions. Typically this is the Xian wallet "
            "address submitting the transaction; leave blank to keep the default signer."
        ),
        "placeholder": DEFAULT_SIGNER,
    },
    {
        "key": "now",
        "label": "now",
        "tooltip": "Override the execution timestamp returned by ctx.now. Use ISO 8601 input such as 2024-02-01T12:30:00.",
        "placeholder": DEFAULT_ENVIRONMENT["now"],
    },
    {
        "key": "block_num",
        "label": "block_num",
        "tooltip": "Synthetic block height applied when seeding deterministic randomness.",
        "placeholder": DEFAULT_ENVIRONMENT["block_num"],
    },
    {
        "key": "block_hash",
        "label": "block_hash",
        "tooltip": "Block hash string mixed into the randomness seed.",
        "placeholder": DEFAULT_ENVIRONMENT["block_hash"],
    },
]

_ENVIRONMENT_LOOKUP = {field["key"]: field for field in ENVIRONMENT_FIELDS}


def _default_storage_home() -> Path:
    """Return the storage directory used by the in-app client."""
    root = Path(__file__).resolve().parent.parent
    storage = root / ".contract_state"
    storage.mkdir(parents=True, exist_ok=True)
    return storage


def _valid_contract_name(
    name: str,
    *,
    require_con_prefix: bool = True,
) -> bool:
    """Return True if the contract name matches current Xian submission rules."""

    if not is_safe_contract_name(name):
        return False
    if require_con_prefix and not name.startswith("con_"):
        return False
    return True


def _contract_name_error(*, require_con_prefix: bool = True) -> str:
    if require_con_prefix:
        return (
            "Contract name must start with 'con_' and contain only lowercase "
            "ASCII letters, digits, and underscores, up to 64 characters."
        )
    return (
        "Contract name must start with a lowercase ASCII letter and contain "
        "only lowercase ASCII letters, digits, and underscores, up to 64 "
        "characters."
    )


def _is_export_decorator(node: ast.AST) -> bool:
    """Return True if the decorator node represents `@export`."""
    if isinstance(node, ast.Name):
        return node.id in {"export", "__export"}
    if isinstance(node, ast.Attribute):
        return node.attr in {"export", "__export"}
    if isinstance(node, ast.Call):
        return _is_export_decorator(node.func)
    return False


def _serialize_value(value: Any) -> Any:
    """Convert contracting values to JSON-serializable primitives."""
    if isinstance(value, ContractingDecimal):
        return str(value)
    if isinstance(value, decimal.Decimal):
        return str(value)
    if isinstance(value, Datetime):
        return str(value)
    if isinstance(value, bytes):
        return value.hex()
    if isinstance(value, dict):
        return {str(k): _serialize_value(v) for k, v in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [_serialize_value(v) for v in value]
    return value


@dataclass
class ContractingCallResult:
    result: Any

    def as_string(self) -> str:
        if self.result is None:
            return "Success (no return value)"
        serialized = _serialize_value(self.result)
        if isinstance(serialized, (dict, list)):
            return json.dumps(serialized, indent=2, sort_keys=True)
        return str(serialized)


@dataclass
class FunctionParameter:
    name: str
    required: bool = True


@dataclass
class ContractExportInfo:
    name: str
    docstring: str = ""
    parameters: List[FunctionParameter] | None = None


@dataclass
class ContractDetails:
    name: str
    source: str
    local_runtime_source: str
    exports: List[ContractExportInfo]


class ContractingService:
    """Facade around `ContractingClient` with basic locking and helpers."""

    def __init__(self, storage_home: Path | None = None):
        storage_home = storage_home or _default_storage_home()
        self._storage_home = storage_home
        self._lock = threading.RLock()
        self._driver = Driver(storage_home=storage_home)
        self._client = ContractingService._create_client(driver=self._driver)
        self._environment = self._client.environment
        self._apply_default_environment()
        self._prune_environment()

    @staticmethod
    def _create_client(driver: Driver) -> ContractingClient:
        return ContractingClient(driver=driver, signer=DEFAULT_SIGNER)

    def get_signer(self) -> str:
        with self._lock:
            return self._client.signer

    def set_signer(self, signer: str) -> str:
        clean = (signer or "").strip()
        if not clean:
            raise ValueError("Signer cannot be empty.")

        with self._lock:
            self._client.signer = clean

        # Keep the environment mirror in sync so UI displays the current signer.
        self._environment['signer'] = clean

        return clean

    def get_environment(self) -> Dict[str, Any]:
        with self._lock:
            self._prune_environment()
            env = {
                key: self._environment.get(key)
                for key in _ENVIRONMENT_LOOKUP
            }
            env['signer'] = self._client.signer
            return env

    def snapshot_environment(self) -> Dict[str, str]:
        """Return a JSON-friendly snapshot of the current environment."""
        env = self.get_environment()
        return {
            key: stringify_environment_value(env.get(key))
            for key in _ENVIRONMENT_LOOKUP
        }

    def hydrate_environment(self, snapshot: Dict[str, Any] | None) -> None:
        """Restore signer/environment overrides from a serialized snapshot."""
        if not snapshot:
            return
        for key in ENVIRONMENT_FIELDS:
            name = key["key"]
            value = snapshot.get(name)
            if value is None or str(value).strip() == "":
                continue
            if name == "signer":
                self.set_signer(str(value))
            else:
                self.set_environment_var(name, value)

    def set_environment_var(self, key: str, value: str) -> Any:
        clean_key = (key or "").strip()
        if not clean_key:
            raise ValueError("Environment key cannot be empty.")
        if clean_key not in _ENVIRONMENT_LOOKUP:
            raise ValueError(f"Environment key '{clean_key}' is not configurable.")

        if clean_key == 'signer':
            clean_value = str(value).strip()
            if clean_value == "":
                clean_value = DEFAULT_SIGNER

            with self._lock:
                self._client.signer = clean_value
                self._environment['signer'] = clean_value
            return clean_value

        if value is None or str(value).strip() == "":
            default = DEFAULT_ENVIRONMENT.get(clean_key, "")
            coerced_default = self._coerce_environment_value(clean_key, default)
            with self._lock:
                self._environment[clean_key] = coerced_default
            return coerced_default

        coerced = self._coerce_environment_value(clean_key, value)

        with self._lock:
            self._environment[clean_key] = coerced

        return coerced

    def remove_environment_var(self, key: str) -> None:
        clean_key = (key or "").strip()
        if not clean_key:
            return
        if clean_key not in _ENVIRONMENT_LOOKUP:
            return
        with self._lock:
            if clean_key == 'signer':
                self._client.signer = DEFAULT_SIGNER
                self._environment['signer'] = DEFAULT_SIGNER
            else:
                default = DEFAULT_ENVIRONMENT.get(clean_key)
                if default is not None:
                    self._environment[clean_key] = self._coerce_environment_value(clean_key, default)
                else:
                    self._environment.pop(clean_key, None)

    def _prune_environment(self) -> None:
        for key in list(self._environment.keys()):
            if key not in _ENVIRONMENT_LOOKUP:
                self._environment.pop(key, None)

    def _apply_default_environment(self) -> None:
        for key, default in DEFAULT_ENVIRONMENT.items():
            if key == "signer":
                self._client.signer = default
                self._environment['signer'] = default
            else:
                current = self._environment.get(key)
                if current is None or (isinstance(current, str) and current.strip() == ""):
                    self._environment[key] = self._coerce_environment_value(key, default)

    def _coerce_environment_value(self, key: str, raw: Any) -> Any:
        if key not in _ENVIRONMENT_LOOKUP:
            raise ValueError(f"Environment key '{key}' is not configurable.")

        if isinstance(raw, Datetime):
            return raw

        if key == 'signer':
            return str(raw).strip()

        if key == "now":
            if raw is None or str(raw).strip() == "":
                raise ValueError("Environment['now'] requires an ISO datetime string.")

            text = str(raw).strip()
            try:
                parsed = datetime.fromisoformat(text)
            except ValueError as exc:
                raise ValueError("Invalid ISO format for 'now'.") from exc
            return Datetime._from_datetime(parsed)

        if key == "block_num":
            text = str(raw).strip() or "0"
            try:
                return int(text, 0)
            except ValueError as exc:
                raise ValueError("block_num must be an integer.") from exc

        if key == 'block_hash':
            return str(raw).strip()

        text = str(raw).strip()
        if text == "":
            return ""

        try:
            parsed = json.loads(text)
            return parsed
        except json.JSONDecodeError:
            return text

    def deploy(self, name: str, code: str) -> None:
        """Deploy a contract by name."""
        clean_name = (name or "").strip()
        if not clean_name:
            raise ValueError("Contract name cannot be empty.")
        if clean_name == "submission":
            raise ValueError("Contract name 'submission' is reserved.")
        if not code or not code.strip():
            raise ValueError("Contract code cannot be empty.")

        with self._lock:
            require_con_prefix = self._client.signer != "sys"
            if not _valid_contract_name(
                clean_name,
                require_con_prefix=require_con_prefix,
            ):
                raise ValueError(
                    _contract_name_error(
                        require_con_prefix=require_con_prefix
                    )
                )
            self._client.submit(code, name=clean_name)
            self._driver.commit()

    @staticmethod
    def _is_internal_state_key(key: str) -> bool:
        return key.startswith("__")

    def _existing_public_keys(self, contract: str) -> set[str]:
        prefix = f"{contract}{constants.INDEX_SEPARATOR}"
        return {
            key.removeprefix(prefix)
            for key in self._driver.keys_from_disk(prefix)
            if isinstance(key, str)
            and not key.removeprefix(prefix).startswith("__")
        }

    def _apply_public_contract_state(
        self,
        contract: str,
        entries: Dict[str, Any],
    ) -> None:
        existing_keys = self._existing_public_keys(contract)
        public_entries: list[tuple[str, Any]] = []

        for key, value in entries.items():
            if not isinstance(key, str):
                raise ValueError(
                    f"State keys for '{contract}' must be strings."
                )
            if self._is_internal_state_key(key):
                continue
            public_entries.append((key, value))

        if not public_entries and entries:
            return

        provided_keys: set[str] = set()
        for key, value in public_entries:
            full_key = (
                contract
                if key == ""
                else f"{contract}{constants.INDEX_SEPARATOR}{key}"
            )

            if value is None:
                self._driver.delete(full_key)
            else:
                self._driver.set(full_key, value)
            provided_keys.add(key)

        missing_keys = existing_keys - provided_keys
        for key in missing_keys:
            full_key = (
                contract
                if key == ""
                else f"{contract}{constants.INDEX_SEPARATOR}{key}"
            )
            self._driver.delete(full_key)

    def apply_state_snapshot(self, snapshot: Dict[str, Any]) -> None:
        if not isinstance(snapshot, dict):
            raise ValueError("State snapshot must be a JSON object.")

        with self._lock:
            for contract, entries in snapshot.items():
                if contract == "__runtime__":
                    continue
                if contract == constants.SUBMISSION_CONTRACT_NAME:
                    continue
                if not isinstance(entries, dict):
                    raise ValueError(
                        f"State for '{contract}' must be an object mapping "
                        "keys to values."
                    )
                if not self._driver.has_contract(contract):
                    raise ValueError(
                        f"Contract '{contract}' is not deployed. Deploy it "
                        "before editing state."
                    )

                self._apply_public_contract_state(contract, entries)

            self._driver.commit()

    def restore_state_snapshot(self, snapshot: Dict[str, Any]) -> None:
        """Restore a previously exported snapshot without trusting raw internals."""
        if not isinstance(snapshot, dict):
            raise ValueError("State snapshot must be a JSON object.")

        with self._lock:
            for contract, entries in snapshot.items():
                if contract in {
                    "__runtime__",
                    constants.SUBMISSION_CONTRACT_NAME,
                }:
                    continue
                if not isinstance(entries, dict):
                    raise ValueError(
                        f"State for '{contract}' must be an object mapping "
                        "keys to values."
                    )
                if not _valid_contract_name(contract):
                    raise ValueError(
                        f"Contract '{contract}' cannot be restored because "
                        "its name is invalid under current submission rules."
                    )

                source = entries.get("__source__")
                deployed_source = self._driver.get_contract_source(contract)
                if deployed_source is None:
                    if not isinstance(source, str) or not source.strip():
                        raise ValueError(
                            f"Contract '{contract}' is missing '__source__' "
                            "and cannot be restored."
                        )
                    self._client.submit(source, name=contract)
                    self._driver.commit()
                    deployed_source = self._driver.get_contract_source(contract)

                if (
                    isinstance(source, str)
                    and source.strip()
                    and deployed_source is not None
                    and deployed_source.strip() != source.strip()
                ):
                    raise ValueError(
                        f"Contract '{contract}' already exists with different "
                        "source code. Reset the session or remove the "
                        "contract before importing."
                    )

            for contract, entries in snapshot.items():
                if contract in {
                    "__runtime__",
                    constants.SUBMISSION_CONTRACT_NAME,
                }:
                    continue
                if not isinstance(entries, dict):
                    raise ValueError(
                        f"State for '{contract}' must be an object mapping "
                        "keys to values."
                    )
                public_entries = {
                    key: value
                    for key, value in entries.items()
                    if isinstance(key, str)
                    and not self._is_internal_state_key(key)
                }
                self._apply_public_contract_state(contract, public_entries)

            self._driver.commit()

    def list_contracts(self) -> List[str]:
        with self._lock:
            contract_files = self._driver.get_contract_files()
        return sorted(contract_files)

    def list_functions(self, contract: str) -> List[str]:
        if not contract:
            return []

        with self._lock:
            source = self._driver.get_contract_source(contract)

        if not source:
            return []

        exports = self._parse_exports(source)
        return sorted(export.name for export in exports)

    def get_export_metadata(self, contract: str) -> List[ContractExportInfo]:
        if not contract:
            return []

        with self._lock:
            source = self._driver.get_contract_source(contract)

        if not source:
            return []

        return self._parse_exports(source)

    def get_contract_details(self, contract: str) -> ContractDetails:
        clean_name = (contract or "").strip()
        if not clean_name:
            raise ValueError("Contract name is required.")

        with self._lock:
            source = self._driver.get_contract_source(clean_name)
            local_runtime = self._driver.get_local_contract_runtime(clean_name)

        if source is None and local_runtime is None:
            raise ValueError(f"Contract '{clean_name}' is not deployed.")

        display_source = source or local_runtime or ""
        exports = self._parse_exports(display_source)
        local_runtime_source = self._local_runtime_display_source(
            local_runtime,
            fallback=display_source,
        )
        return ContractDetails(
            name=clean_name,
            source=display_source,
            local_runtime_source=local_runtime_source,
            exports=exports,
        )

    def call(self, contract: str, function: str, kwargs: Dict[str, Any]) -> ContractingCallResult:
        if not contract:
            raise ValueError("No contract selected.")
        if not function:
            raise ValueError("No function selected.")

        with self._lock:
            abstract = self._client.get_contract_proxy(contract)
            if abstract is None:
                raise ValueError(f"Contract '{contract}' is not deployed.")
            if not hasattr(abstract, function):
                raise ValueError(f"Function '{function}' not found on contract '{contract}'.")

            fn = getattr(abstract, function)
            result = fn(**kwargs)
            self._driver.commit()

        return ContractingCallResult(result=result)

    def dump_state(self, show_internal: bool = False) -> str:
        snapshot: Dict[str, Dict[str, Any]] = {}

        with self._lock:
            contract_files = self._driver.get_contract_files()
            for name in contract_files:
                snapshot[name] = {
                    key.removeprefix(f"{name}{constants.INDEX_SEPARATOR}"): _serialize_value(value)
                    for key, value in self._driver.items(f"{name}{constants.INDEX_SEPARATOR}").items()
                    if (
                        show_internal
                        or not key.removeprefix(f"{name}{constants.INDEX_SEPARATOR}").startswith("__")
                    )
                    if value is not None
                }

            runtime_snapshot: Dict[str, Dict[str, Any]] = {}
            for key, value in self._driver.get_run_state().items():
                contract, _, suffix = key.partition(constants.INDEX_SEPARATOR)
                if not show_internal and suffix.startswith("__"):
                    continue
                runtime_snapshot.setdefault(contract, {})[suffix] = _serialize_value(value)

            if runtime_snapshot:
                snapshot["__runtime__"] = runtime_snapshot

        return json.dumps(snapshot, indent=2, sort_keys=True)

    def remove_contract(self, name: str) -> None:
        clean_name = (name or "").strip()
        if not clean_name:
            raise ValueError("Contract name is required.")
        if clean_name == constants.SUBMISSION_CONTRACT_NAME:
            raise ValueError("The submission contract cannot be removed.")

        with self._lock:
            if not self._driver.has_contract(clean_name):
                raise ValueError(f"Contract '{clean_name}' is not deployed.")
            self._driver.delete_contract(clean_name)
            self._driver.flush_file(clean_name)
            self._driver.flush_cache()
            self._driver.commit()

    def reset_state(self) -> None:
        with self._lock:
            self._driver.flush_full()
            self._driver = Driver(storage_home=self._storage_home)
        self._client = ContractingService._create_client(driver=self._driver)
        self._environment = self._client.environment
        self._apply_default_environment()
        self._prune_environment()

    @staticmethod
    def _parse_exports(source: str) -> List[ContractExportInfo]:
        try:
            tree = ast.parse(source)
        except SyntaxError:
            return []

        exports: List[ContractExportInfo] = []
        for node in ast.walk(tree):
            if isinstance(node, ast.FunctionDef) and any(
                _is_export_decorator(dec) for dec in node.decorator_list
            ):
                doc = ast.get_docstring(node) or ""
                parameters: List[FunctionParameter] = []

                # Positional-only parameters
                posonly = list(getattr(node.args, "posonlyargs", []))
                for arg in posonly:
                    parameters.append(FunctionParameter(name=arg.arg, required=True))

                # Regular positional parameters
                regular_args = list(node.args.args)
                defaults = list(node.args.defaults)
                num_defaults = len(defaults)
                num_required = len(regular_args) - num_defaults
                for idx, arg in enumerate(regular_args):
                    required = idx < num_required
                    parameters.append(FunctionParameter(name=arg.arg, required=required))

                # Keyword-only parameters
                kwonly_args = list(node.args.kwonlyargs)
                kw_defaults = list(node.args.kw_defaults)
                for arg, default in zip(kwonly_args, kw_defaults):
                    required = default is None
                    parameters.append(FunctionParameter(name=arg.arg, required=required))

                # Varargs / kwargs - include but mark optional
                if node.args.vararg is not None:
                    parameters.append(FunctionParameter(name=node.args.vararg.arg, required=False))
                if node.args.kwarg is not None:
                    parameters.append(FunctionParameter(name=node.args.kwarg.arg, required=False))

                exports.append(
                    ContractExportInfo(
                        name=node.name,
                        docstring=doc.strip(),
                        parameters=parameters,
                    )
                )
        return exports

    @staticmethod
    def _local_runtime_display_source(
        local_runtime: str | None,
        *,
        fallback: str = "",
    ) -> str:
        """Return transient local harness source when available, otherwise source."""
        if local_runtime and local_runtime.strip():
            return local_runtime
        return fallback
