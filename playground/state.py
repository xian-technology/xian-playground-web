from __future__ import annotations

import ast
import json
import os
import time
from http.cookies import SimpleCookie
from typing import Dict, List
from urllib.parse import quote

import reflex as rx
from reflex.config import get_config

from .defaults import DEFAULT_CONTRACT, DEFAULT_CONTRACT_NAME, DEFAULT_KWARGS_INPUT
from .services import (
    ContractDetails,
    ContractExportInfo,
    DEFAULT_ENVIRONMENT,
    ENVIRONMENT_FIELDS,
    SESSION_COOKIE_NAME,
    SessionNotFoundError,
    SessionRepository,
    lint_contract as run_lint,
    session_runtime,
)
from .services.sessions import SESSION_UI_FIELDS
from .services.worker import ContractWorkerInvocationError
from .services.environment import stringify_environment_value


def _env_positive_int(name: str, default: int) -> int:
    raw = os.getenv(name)
    if raw is None:
        return default
    try:
        value = int(raw, 0)
    except ValueError:
        return default
    return value if value > 0 else default


def _format_bytes(value: int) -> str:
    units = ["bytes", "KB", "MB", "GB", "TB"]
    size = float(value)
    for unit in units:
        if size < 1024 or unit == units[-1]:
            if unit == "bytes":
                return f"{int(size)} {unit}"
            return f"{size:.1f} {unit}"
        size /= 1024
    return f"{value} bytes"


STATE_IMPORT_MAX_BYTES = _env_positive_int("PLAYGROUND_STATE_IMPORT_MAX_BYTES", 10 * 1024 * 1024)
ACTIVITY_LOG_MAX_ENTRIES = _env_positive_int("PLAYGROUND_ACTIVITY_LOG_MAX_ENTRIES", 50)
LOG_LEVEL_COLORS = {
    "info": "#3b82f6",
    "success": "#10b981",
    "error": "#ef4444",
    "warning": "#f59e0b",
}
ENVIRONMENT_FIELD_KEYS = [field["key"] for field in ENVIRONMENT_FIELDS]
FULLSCREEN_PANELS = {"write", "load", "execute", "state"}


def _is_system_contract_name(name: str) -> bool:
    return not (name or "").startswith("con_")


def _filter_visible_contracts(
    contracts: List[str],
    *,
    show_system_contracts: bool,
) -> List[str]:
    if show_system_contracts:
        return list(contracts)
    return [name for name in contracts if not _is_system_contract_name(name)]

class PlaygroundState(rx.State):
    """Global Reflex state powering the playground UI."""

    code_editor: str = DEFAULT_CONTRACT
    code_editor_revision: int = 0
    contract_name: str = DEFAULT_CONTRACT_NAME
    deploy_message: str = ""
    deploy_is_error: bool = False

    expert_message: str = ""
    expert_is_error: bool = False
    show_internal_state: bool = False
    show_system_contracts: bool = False
    environment_editor: dict[str, str] = {
        key: DEFAULT_ENVIRONMENT.get(key, "") for key in ENVIRONMENT_FIELD_KEYS
    }
    session_id: str = ""
    session_error: str = ""
    resume_session_input: str = ""
    _last_ui_snapshot_ts: float = 0.0

    state_is_editing: bool = False
    state_editor: str = ""
    lint_results: List[str] = []
    linting: bool = False
    lint_has_results: bool = False

    deployed_contracts: List[str] = []
    hidden_system_contract_count: int = 0
    selected_contract: str = ""
    available_functions: List[str] = []
    function_name: str = ""

    load_selected_contract: str = ""
    loaded_contract_code: str = ""
    loaded_contract_decompiled: str = ""
    function_required_params: dict[str, List[str]] = {}
    load_view_decompiled: bool = True
    expanded_panel: str = ""

    kwargs_input: str = DEFAULT_KWARGS_INPUT
    run_result: str = ""
    state_dump: str = "{}"
    _saved_code_snapshot: str = DEFAULT_CONTRACT
    log_entries: List[Dict[str, str]] = []
    _state_edit_snapshot: str = ""
    activity_log_view_key: str = "activity-log"

    def on_load(self):
        session_id = self._cookie_session_id()
        if not session_id:
            self.session_error = "Session cookie missing. Issuing a fresh session."
            return self._navigate_to_session_route("new")
        self.session_id = session_id
        try:
            metadata = session_runtime.ensure_exists(session_id)
        except SessionNotFoundError:
            self.session_error = "Session not found. Creating a new one."
            return self._navigate_to_session_route("new")

        self._apply_ui_state(metadata.ui_state or {})
        env_snapshot = session_runtime.get_environment_snapshot(session_id)
        self.environment_editor = {
            key: env_snapshot.get(key, "")
            for key in ENVIRONMENT_FIELD_KEYS
        }
        self.session_error = ""
        self._last_ui_snapshot_ts = time.time()
        self._refresh_activity_log_panel()
        actions = [
            type(self).refresh_contracts,
            type(self).refresh_state,
            type(self).refresh_environment,
        ]
        return actions

    def _cookie_session_id(self) -> str:
        header = getattr(self.router.headers, "cookie", "") or ""
        if not header:
            return ""
        jar = SimpleCookie()
        try:
            jar.load(header)
        except Exception:
            return ""
        morsel = jar.get(SESSION_COOKIE_NAME)
        return (morsel.value or "").strip() if morsel else ""

    def _apply_ui_state(self, snapshot: dict[str, object]):
        if not snapshot:
            return
        pending_editor_value = snapshot.get("code_editor")
        for field in SESSION_UI_FIELDS:
            if field == "code_editor" or field not in snapshot:
                continue
            setattr(self, field, snapshot[field])
        if self.expanded_panel not in FULLSCREEN_PANELS:
            self.expanded_panel = ""

        if pending_editor_value is not None:
            self._hydrate_code_editor(str(pending_editor_value))

    def _hydrate_code_editor(self, value: str, *, force_refresh: bool = False):
        normalized = value or ""
        if not force_refresh and normalized == self.code_editor:
            self._saved_code_snapshot = normalized
            return
        self.code_editor = normalized
        self._saved_code_snapshot = normalized
        self.code_editor_revision += 1

    def _save_session(self, include_code: bool = False):
        if not self.session_id:
            return
        payload = {}
        for field in SESSION_UI_FIELDS:
            if field == "code_editor":
                payload[field] = self.code_editor if include_code else self._saved_code_snapshot
            else:
                payload[field] = getattr(self, field)
        session_runtime.save_ui_state(self.session_id, payload)
        if include_code:
            self._saved_code_snapshot = self.code_editor

    def _refresh_activity_log_panel(self):
        seed = f"{self.session_id or 'log'}-{time.time():.6f}"
        self.activity_log_view_key = seed

    def _log_event(
        self,
        level: str,
        action: str,
        message: str,
        detail: str = "",
    ) -> None:
        normalized_level = (level or "").lower() or "info"
        detail = (detail or "").strip()
        if len(detail) > 4000:
            detail = detail[:4000] + "…"
        entry = {
            "timestamp": time.strftime("%Y-%m-%d %H:%M:%S", time.localtime()),
            "level": normalized_level,
            "level_label": normalized_level.title(),
            "action": action,
            "message": message,
            "detail": detail,
            "color": LOG_LEVEL_COLORS.get(normalized_level, LOG_LEVEL_COLORS["info"]),
        }
        entries = [entry] + self.log_entries
        if len(entries) > ACTIVITY_LOG_MAX_ENTRIES:
            entries = entries[:ACTIVITY_LOG_MAX_ENTRIES]
        self.log_entries = entries

    def _log_success(self, action: str, message: str, detail: str = "") -> None:
        self._log_event("success", action, message, detail)

    def _log_worker_failure(
        self,
        action: str,
        prefix: str,
        exc: ContractWorkerInvocationError,
        extra_lines: Dict[str, str] | None = None,
    ) -> str:
        core = exc.remote_message or exc.remote_type
        message = f"{prefix}{core}"
        detail = f"{exc.remote_type}: {exc.remote_message}".strip()
        if extra_lines:
            suffix = "\n".join(f"{key}: {value}" for key, value in extra_lines.items())
            detail = f"{detail}\n{suffix}"
        self._log_event("error", action, message, detail)
        return message

    def _log_generic_failure(
        self,
        action: str,
        prefix: str,
        exc: Exception,
        detail_suffix: str | None = None,
    ) -> str:
        message = f"{prefix}{exc}"
        detail = detail_suffix or ""
        self._log_event("error", action, message, detail)
        return message

    def _format_log_json(self, data: object, *, limit: int = 160) -> str:
        try:
            text = json.dumps(data, sort_keys=True)
        except Exception:
            text = str(data)
        text = text.strip()
        if len(text) > limit:
            text = text[:limit] + "…"
        return text

    def _summarize_state_diff(
        self,
        before: Dict[str, object] | None,
        after: Dict[str, object] | None,
        limit: int = 5,
    ) -> str:
        before = before or {}
        after = after or {}
        changes: list[str] = []
        changed_keys = [key for key in sorted(set(before) | set(after)) if before.get(key) != after.get(key)]
        total = len(changed_keys)
        for key in changed_keys[:limit]:
            before_display = self._format_log_json(before.get(key))
            after_display = self._format_log_json(after.get(key))
            changes.append(f"{key}: {before_display} -> {after_display}")
        if total > limit:
            changes.append(f"... and {total - limit} more change(s)")
        if not changes:
            changes.append("State updated without detectable key changes.")
        return "\n".join(changes)

    def clear_logs(self):
        self.log_entries = []
        return [rx.toast.success("Activity log cleared.")]

    def _require_session(self) -> str | None:
        if not self.session_id:
            self.session_error = "Session unavailable. Refresh the page to rehydrate."
            return None
        return self.session_id

    def _frontend_origin(self) -> str:
        url = getattr(self.router, "url", None)
        if url is not None:
            origin = getattr(url, "origin", "") or ""
            if origin:
                return origin.rstrip("/")
        header_origin = getattr(self.router.headers, "origin", "") or ""
        if header_origin:
            return header_origin.rstrip("/")
        config = get_config()
        if config.deploy_url:
            return config.deploy_url.rstrip("/")
        return ""

    def _session_route_url(self, suffix: str) -> str:
        config = get_config()
        base = (config.api_url or "").rstrip("/")
        path = suffix.lstrip("/")
        next_url = self._frontend_origin()
        query = ""
        if next_url:
            encoded = quote(next_url, safe=":/?#[]@!$&'()*+,;=%")
            query = f"?next={encoded}"
        if not base:
            return f"/sessions/{path}{query}"
        return f"{base}/sessions/{path}{query}"

    def copy_session_id(self):
        if not self.session_id:
            return [rx.toast.error("Session unavailable. Reload the page.")]
        return [
            rx.set_clipboard(self.session_id),
            rx.toast.success("Session ID copied."),
        ]

    def _navigate_to_session_route(self, suffix: str):
        target = self._session_route_url(suffix)
        script = f"window.location.assign({json.dumps(target)});"
        return [rx.call_script(script)]

    def start_new_session(self):
        return self._navigate_to_session_route("new")

    def update_resume_session_input(self, value: str):
        self.resume_session_input = (value or "").strip().lower()

    def resume_session(self):
        target = (self.resume_session_input or "").strip().lower()
        if not target:
            self.session_error = "Enter a session ID to resume."
            return [rx.toast.error(self.session_error)]
        if not SessionRepository.is_valid_session_id(target):
            self.session_error = "Session ID must be a UUID4 hex string."
            return [rx.toast.error(self.session_error)]
        if not session_runtime.session_exists(target):
            self.session_error = "Session not found."
            return [rx.toast.error(self.session_error)]
        self.session_error = ""
        return self._navigate_to_session_route(target)

    def save_code_draft(self):
        session_id = self._require_session()
        if not session_id:
            return []
        self._save_session(include_code=True)
        return [rx.toast.success("Draft saved.")]

    def update_code(self, value: str):
        self.code_editor = value or ""
        self.lint_results = []
        self.lint_has_results = False

    def update_contract_name(self, value: str):
        self.contract_name = value

    def update_kwargs(self, value: str):
        self.kwargs_input = value

    def change_selected_contract(self, value: str):
        if value != self.selected_contract:
            self.selected_contract = value
            self.kwargs_input = DEFAULT_KWARGS_INPUT
            self.run_result = ""
        return [type(self).refresh_functions]

    def change_selected_function(self, value: str):
        self.function_name = value
        self.run_result = ""
        self.prefill_kwargs_for_current_function(force=True)

    def refresh_contracts(self):
        session_id = self._require_session()
        if not session_id:
            return []
        all_contracts = session_runtime.list_contracts(session_id)
        visible_contracts = _filter_visible_contracts(
            all_contracts,
            show_system_contracts=self.show_system_contracts,
        )
        self.hidden_system_contract_count = (
            0
            if self.show_system_contracts
            else sum(
                1 for name in all_contracts
                if _is_system_contract_name(name)
            )
        )
        self.deployed_contracts = visible_contracts

        if not visible_contracts:
            self.selected_contract = ""
            self.available_functions = []
            self.function_name = ""
            self.load_selected_contract = ""
            self.loaded_contract_code = ""
            self.loaded_contract_decompiled = ""
            self.function_required_params = {}
            return []

        if self.selected_contract not in visible_contracts:
            self.selected_contract = visible_contracts[0]
            self.kwargs_input = DEFAULT_KWARGS_INPUT

        if (
            not self.load_selected_contract
            or self.load_selected_contract not in visible_contracts
        ):
            self.load_selected_contract = visible_contracts[0]

        return [type(self).refresh_functions, type(self).refresh_loaded_contract]

    def refresh_functions(self):
        session_id = self._require_session()
        if not session_id:
            return []
        if not self.selected_contract:
            self.available_functions = []
            self.function_name = ""
            self.function_required_params = {}
            return

        exports: List[ContractExportInfo] = session_runtime.get_export_metadata(session_id, self.selected_contract)
        required_map = {
            export.name: [
                param.name for param in (export.parameters or []) if param.required
            ]
            for export in exports
        }
        self.function_required_params = required_map

        functions = sorted(required_map.keys())
        self.available_functions = functions

        if not functions:
            self.function_name = ""
        elif self.function_name not in functions:
            self.function_name = functions[0]

        self.prefill_kwargs_for_current_function()

    def change_loaded_contract(self, value: str):
        self.load_selected_contract = value
        return [type(self).refresh_loaded_contract]

    def refresh_loaded_contract(self):
        session_id = self._require_session()
        if not session_id:
            return []
        if not self.load_selected_contract:
            self.loaded_contract_code = ""
            self.loaded_contract_decompiled = ""
            return []

        try:
            details: ContractDetails = session_runtime.get_contract_details(session_id, self.load_selected_contract)
        except Exception as exc:
            self.loaded_contract_code = ""
            self.loaded_contract_decompiled = ""
            return [rx.toast.error(f"Failed to load contract '{self.load_selected_contract}': {exc}")]

        self.loaded_contract_code = details.source
        self.loaded_contract_decompiled = details.decompiled_source
        return []

    def toggle_load_view(self):
        self.load_view_decompiled = not self.load_view_decompiled

    def set_show_system_contracts(self, value):
        if isinstance(value, dict):
            value = value.get("value", False)
        self.show_system_contracts = bool(value)
        return [type(self).refresh_contracts]

    def toggle_show_system_contracts(self):
        self.show_system_contracts = not self.show_system_contracts
        return [type(self).refresh_contracts]

    def toggle_panel(self, panel_id: str):
        target = (panel_id or "").strip()
        if not target:
            return
        if target not in FULLSCREEN_PANELS:
            return
        self.expanded_panel = "" if self.expanded_panel == target else target

    def handle_fullscreen_keydown(self, event):
        """Handle keyboard events in fullscreen mode - exit on ESC key."""
        # Event can be a string or dict depending on Reflex version
        key = event if isinstance(event, str) else event.get("key", "")
        if key == "Escape":
            self.expanded_panel = ""

    def prefill_kwargs_for_current_function(self, force: bool = False):
        if not self.function_name:
            return
        required = self.function_required_params.get(self.function_name, [])
        if not required:
            if force or self.kwargs_input.strip() != DEFAULT_KWARGS_INPUT:
                self.kwargs_input = DEFAULT_KWARGS_INPUT
            return
        # Only seed the editor if it is still empty or in the default form.
        current = self.kwargs_input.strip()
        if force or current in ("", DEFAULT_KWARGS_INPUT):
            payload = {name: "" for name in required}
            self.kwargs_input = json.dumps(payload, indent=2)

    def confirm_clear_state(self):
        session_id = self._require_session()
        if not session_id:
            return []
        try:
            metadata = session_runtime.reset_state(session_id)
        except ContractWorkerInvocationError as exc:
            message = self._log_worker_failure("reset_state", "Failed to clear state: ", exc)
            return [rx.toast.error(message)]
        except Exception as exc:
            message = self._log_generic_failure("reset_state", "Failed to clear state: ", exc)
            return [rx.toast.error(message)]

        env = metadata.environment

        self.deployed_contracts = []
        self.hidden_system_contract_count = 0
        self.selected_contract = ""
        self.available_functions = []
        self.function_name = ""
        self.function_required_params = {}
        self.load_selected_contract = ""
        self.loaded_contract_code = ""
        self.loaded_contract_decompiled = ""
        self.load_view_decompiled = True
        self.expanded_panel = ""
        self.kwargs_input = DEFAULT_KWARGS_INPUT
        self.run_result = ""
        self.state_is_editing = False
        self.state_dump = "{}"
        self.state_editor = "{}"
        self.lint_results = []
        self.lint_has_results = False
        self._hydrate_code_editor(DEFAULT_CONTRACT, force_refresh=True)
        self.contract_name = DEFAULT_CONTRACT_NAME
        self.environment_editor = {
            key: stringify_environment_value(env.get(key))
            for key in ENVIRONMENT_FIELD_KEYS
        }
        self._save_session(include_code=True)
        self._log_success("reset_state", "All contracts and state cleared.")

        return [
            rx.toast.success("All contracts and state cleared."),
            type(self).refresh_environment,
            type(self).refresh_contracts,
            type(self).refresh_state,
        ]

    def export_state(self):
        session_id = self._require_session()
        if not session_id:
            return []
        data = session_runtime.dump_state(session_id, show_internal=True)
        return [
            rx.download(
                data=data,
                filename="contract_state.json",
            )
        ]

    async def import_state(self, files: list[rx.UploadFile]):
        if not files:
            return [rx.toast.info("Select a JSON export to import.")]

        session_id = self._require_session()
        if not session_id:
            return []

        file = files[0]
        limit = STATE_IMPORT_MAX_BYTES
        friendly_limit = _format_bytes(limit)
        try:
            declared_size = getattr(file, "size", None)
            if declared_size is not None and declared_size > limit:
                return [rx.toast.error(f"Import file exceeds the {friendly_limit} limit.")]

            content = await file.read(limit + 1)
            if len(content) > limit:
                return [rx.toast.error(f"Import file exceeds the {friendly_limit} limit.")]
        except Exception as exc:
            return [rx.toast.error(f"Failed to read import: {exc}")]
        finally:
            await file.close()

        if isinstance(content, bytes):
            try:
                text = content.decode("utf-8")
            except UnicodeDecodeError:
                return [rx.toast.error("Import file must be UTF-8 encoded JSON.")]
        else:
            text = str(content)

        try:
            payload = json.loads(text)
        except json.JSONDecodeError as exc:
            return [rx.toast.error(f"Invalid JSON: {exc}")]

        try:
            session_runtime.restore_state_snapshot(session_id, payload)
        except ContractWorkerInvocationError as exc:
            message = self._log_worker_failure("import_state", "Failed to import state: ", exc)
            return [rx.toast.error(message)]
        except Exception as exc:
            message = self._log_generic_failure("import_state", "Failed to import state: ", exc)
            return [rx.toast.error(message)]
        self._save_session()
        self._log_success("import_state", "State imported from JSON upload.")

        return [
            rx.toast.success("State imported."),
            type(self).refresh_state,
            type(self).refresh_contracts,
        ]

    def remove_selected_contract(self):
        target = self.load_selected_contract or self.selected_contract
        if not target:
            return [rx.toast.info("Select a contract to remove.")]

        session_id = self._require_session()
        if not session_id:
            return []

        try:
            session_runtime.remove_contract(session_id, target)
        except ContractWorkerInvocationError as exc:
            message = self._log_worker_failure(
                "remove_contract",
                f"Failed to remove contract '{target}': ",
                exc,
            )
            return [rx.toast.error(message)]
        except Exception as exc:
            message = self._log_generic_failure(
                "remove_contract",
                f"Failed to remove contract '{target}': ",
                exc,
            )
            return [rx.toast.error(message)]

        if self.selected_contract == target:
            self.selected_contract = ""
            self.available_functions = []
            self.function_name = ""
            self.kwargs_input = "{}"

        if self.load_selected_contract == target:
            self.load_selected_contract = ""
            self.loaded_contract_code = ""
            self.loaded_contract_decompiled = ""
        if self.expanded_panel == target:
            self.expanded_panel = ""

        self.run_result = ""
        self._save_session()
        self._log_success("remove_contract", f"Contract '{target}' removed.")

        return [
            rx.toast.success(f"Contract '{target}' removed."),
            type(self).refresh_contracts,
            type(self).refresh_state,
        ]

    def refresh_state(self):
        session_id = self._require_session()
        if not session_id:
            return []
        snapshot = session_runtime.dump_state(session_id, self.show_internal_state)
        self.state_dump = snapshot
        if not self.state_is_editing:
            self.state_editor = snapshot

    def refresh_environment(self):
        session_id = self._require_session()
        if not session_id:
            return []
        env = session_runtime.get_environment(session_id)
        self.environment_editor = {
            key: stringify_environment_value(env.get(key))
            for key in ENVIRONMENT_FIELD_KEYS
        }

    def deploy_contract(self):
        session_id = self._require_session()
        if not session_id:
            return []
        try:
            session_runtime.deploy(session_id, self.contract_name, self.code_editor)
        except ContractWorkerInvocationError as exc:
            self.deploy_is_error = True
            message = self._log_worker_failure("deploy", "Deploy failed: ", exc)
            self.deploy_message = message
            return [rx.toast.error(self.deploy_message)]
        except Exception as exc:
            self.deploy_is_error = True
            message = self._log_generic_failure("deploy", "Deploy failed: ", exc)
            self.deploy_message = message
            return [rx.toast.error(self.deploy_message)]

        self.deploy_is_error = False
        self.deploy_message = f"Contract '{self.contract_name}' deployed successfully."
        self._log_success("deploy", self.deploy_message)
        self.selected_contract = self.contract_name
        self.load_selected_contract = self.contract_name
        self.kwargs_input = DEFAULT_KWARGS_INPUT
        self._save_session(include_code=True)

        events = [
            rx.toast.success(self.deploy_message),
            type(self).refresh_contracts,
            type(self).refresh_state,
            type(self).refresh_environment,
            type(self).refresh_loaded_contract,
        ]
        return events

    def set_show_internal_state(self, value):
        if isinstance(value, dict):
            value = value.get("value", False)
        self.show_internal_state = bool(value)
        return [type(self).refresh_state]

    def toggle_show_internal_state(self):
        self.show_internal_state = not self.show_internal_state
        return [type(self).refresh_state]

    def edit_environment_value(self, key: str, value):
        if isinstance(key, dict):
            key = key.get("value", "")
        if isinstance(value, dict):
            value = value.get("value", "")
        if not key:
            return
        if key in self.environment_editor:
            self.environment_editor[key] = value

    def apply_environment_value(self, key):
        if isinstance(key, dict):
            key = key.get("value", "")
        if not key:
            self.expert_is_error = True
            self.expert_message = "No environment key selected."
            return []
        current = self.environment_editor.get(key, "")
        before_value = DEFAULT_ENVIRONMENT.get(key, "")
        session_id = self._require_session()
        session_id = self._require_session()
        if not session_id:
            return []
        try:
            if current.strip() == "":
                session_runtime.remove_environment_var(session_id, key)
                message = f"Environment['{key}'] cleared."
                toast = rx.toast.info(message)
                after_value = DEFAULT_ENVIRONMENT.get(key, "")
            else:
                session_runtime.set_environment_var(session_id, key, current)
                message = f"Environment['{key}'] updated."
                toast = rx.toast.success(message)
                after_value = current
        except ContractWorkerInvocationError as exc:
            self.expert_is_error = True
            self.expert_message = self._log_worker_failure(
                "environment",
                f"Failed to set environment['{key}']: ",
                exc,
            )
            return [rx.toast.error(self.expert_message)]
        except Exception as exc:
            self.expert_is_error = True
            self.expert_message = self._log_generic_failure(
                "environment",
                f"Failed to set environment['{key}']: ",
                exc,
            )
            return [rx.toast.error(self.expert_message)]

        self.expert_is_error = False
        self.expert_message = message
        detail = f"{key}: {self._format_log_json(before_value)} -> {self._format_log_json(after_value)}"
        self._log_success("environment", message, detail=detail)
        self._save_session()
        return [toast, type(self).refresh_environment]

    def reset_environment_value(self, key):
        if isinstance(key, dict):
            key = key.get("value", "")
        if not key:
            return []
        session_id = self._require_session()
        if not session_id:
            return []
        before_value = self.environment_editor.get(key, DEFAULT_ENVIRONMENT.get(key, ""))
        try:
            session_runtime.remove_environment_var(session_id, key)
        except ContractWorkerInvocationError as exc:
            message = self._log_worker_failure(
                "environment",
                f"Failed to reset environment['{key}']: ",
                exc,
            )
            return [rx.toast.error(message)]
        except Exception as exc:
            message = self._log_generic_failure(
                "environment",
                f"Failed to reset environment['{key}']: ",
                exc,
            )
            return [rx.toast.error(message)]
        self.environment_editor[key] = DEFAULT_ENVIRONMENT.get(key, "")
        self.expert_is_error = False
        self.expert_message = f"Environment['{key}'] cleared."
        detail = f"{key}: {self._format_log_json(before_value)} -> {self._format_log_json(self.environment_editor[key])}"
        self._log_success("environment", self.expert_message, detail=detail)
        self._save_session()
        return [rx.toast.info(self.expert_message), type(self).refresh_environment]

    def update_state_editor(self, value: str):
        self.state_editor = value

    def cancel_state_editing(self):
        self.state_is_editing = False
        self.state_editor = self.state_dump
        self._state_edit_snapshot = ""
        return []

    def toggle_state_editor(self):
        if not self.state_is_editing:
            self.state_editor = self.state_dump
            self.state_is_editing = True
            self._state_edit_snapshot = self.state_dump
            return []

        try:
            data = json.loads(self.state_editor)
        except json.JSONDecodeError as exc:
            return [rx.toast.error(f"Invalid JSON: {exc}")]

        session_id = self._require_session()
        if not session_id:
            return []
        try:
            session_runtime.apply_state_snapshot(session_id, data)
        except ContractWorkerInvocationError as exc:
            message = self._log_worker_failure("state_edit", "Failed to update state: ", exc)
            return [rx.toast.error(message)]
        except Exception as exc:
            message = self._log_generic_failure("state_edit", "Failed to update state: ", exc)
            return [rx.toast.error(message)]

        self.state_is_editing = False
        self.refresh_state()
        self._save_session()
        try:
            before_data = json.loads(self._state_edit_snapshot or "{}")
        except json.JSONDecodeError:
            before_data = {}
        diff_summary = self._summarize_state_diff(before_data, data)
        self._state_edit_snapshot = ""
        detail = f"Changes:\n{diff_summary}"
        self._log_success("state_edit", "State updated from editor changes.", detail=detail)
        return [rx.toast.success("State updated.")]

    def lint_contract(self):
        if self.linting:
            return []

        self.linting = True
        try:
            raw_results = run_lint(self.code_editor)
        except Exception as exc:
            self.linting = False
            self.lint_results = []
            self.lint_has_results = False
            return [rx.toast.error(f"Lint failed: {exc}")]

        self.linting = False
        formatted: list[str] = []
        for result in raw_results:
            if isinstance(result, dict):
                position = result.get("position") or {}
                line = position.get("line")
                column = position.get("column", position.get("col"))
                message = result.get("message", "")
                location = ""
                if line is not None:
                    location = f"Line {line + 1}"
                    if column is not None:
                        location += f", Col {column + 1}"
                    location += ": "
                formatted.append(f"{location}{message}")
            else:
                formatted.append(str(result))

        self.lint_results = formatted
        self.lint_has_results = bool(formatted)

        if formatted:
            return [
                rx.toast.warning(f"Found {len(formatted)} issue(s)."),
            ]
        return [rx.toast.success("No lint issues found.")]

    def _parse_kwargs(self) -> dict:
        raw = self.kwargs_input.strip()
        if not raw:
            return {}
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            try:
                data = ast.literal_eval(raw)
            except Exception as exc:
                raise ValueError(f"Cannot parse kwargs: {exc}") from exc
        if not isinstance(data, dict):
            raise ValueError("Kwargs must evaluate to a dictionary.")
        return data

    def run_contract(self):
        if not self.selected_contract:
            self.run_result = "Select a deployed contract first."
            return
        if not self.function_name:
            self.run_result = "Select a function to execute."
            return

        try:
            kwargs = self._parse_kwargs()
        except ValueError as exc:
            self.run_result = str(exc)
            return [rx.toast.error(self.run_result)]

        session_id = self._require_session()
        if not session_id:
            return []
        context = {
            "Contract": self.selected_contract or "-",
            "Function": self.function_name or "-",
            "Kwargs": self._format_log_json(kwargs),
        }
        detail_lines = [
            f"Contract: {context['Contract']}",
            f"Function: {context['Function']}",
            f"Kwargs: {context['Kwargs']}",
        ]
        detail_text = "\n".join(detail_lines)
        try:
            call_result = session_runtime.call(session_id, self.selected_contract, self.function_name, kwargs)
        except ContractWorkerInvocationError as exc:
            message = self._log_worker_failure(
                "execute",
                "Execution failed: ",
                exc,
                extra_lines={"Call": detail_text},
            )
            self.run_result = message
            return [rx.toast.error(self.run_result)]
        except Exception as exc:
            message = self._log_generic_failure(
                "execute",
                "Execution failed: ",
                exc,
                detail_text,
            )
            self.run_result = message
            return [rx.toast.error(self.run_result)]

        self.run_result = call_result.as_string()
        detail = self.run_result if self.run_result else ""
        result_preview = self._format_log_json(call_result.result)
        detail_payload = "\n".join([detail_text, f"Result: {result_preview}"])
        self._log_success(
            "execute",
            f"Executed {self.selected_contract}.{self.function_name}",
            detail=detail_payload if detail_payload else detail,
        )
        return [
            rx.toast.success("Execution succeeded."),
            type(self).refresh_state,
            type(self).refresh_contracts,
        ]
