"""Session-scoped access to contracting services and metadata."""

from __future__ import annotations

import atexit
import logging
import os
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Dict

from .contracting import ContractDetails, ContractExportInfo
from .sessions import SessionMetadata, SessionNotFoundError, SessionRepository
from .worker import ContractingWorker, SessionServiceProxy


SESSION_COOKIE_NAME = "xian_session_id"
SESSION_COOKIE_MAX_AGE = 30 * 24 * 60 * 60  # 30 days

logger = logging.getLogger(__name__)


def _env_float(name: str, default: float) -> float:
    value = os.getenv(name)
    if value is None:
        return default
    try:
        return float(value)
    except ValueError:
        return default


def _env_int(name: str, default: int) -> int:
    value = os.getenv(name)
    if value is None:
        return default
    try:
        return int(value)
    except ValueError:
        return default


DEFAULT_MAX_IDLE_SECONDS = _env_float("PLAYGROUND_SESSION_MAX_IDLE_SECONDS", 900.0)
DEFAULT_REAPER_INTERVAL_SECONDS = _env_float("PLAYGROUND_SESSION_REAPER_INTERVAL", 30.0)
DEFAULT_MAX_RESIDENT_WORKERS = _env_int("PLAYGROUND_SESSION_MAX_WORKERS", 16)
DEFAULT_WORKER_DRAIN_TIMEOUT = _env_float("PLAYGROUND_SESSION_WORKER_STOP_TIMEOUT", 5.0)
DEFAULT_SESSION_TTL_SECONDS = _env_float("PLAYGROUND_SESSION_TTL_SECONDS", 7 * 24 * 60 * 60.0)

WorkerFactory = Callable[[Path], ContractingWorker]


@dataclass
class SessionServiceEntry:
    worker: ContractingWorker
    proxy: SessionServiceProxy | None
    last_used: float
    inflight: int = 0
    _lock: threading.Lock = field(default_factory=threading.Lock, init=False)
    _condition: threading.Condition = field(init=False)

    def __post_init__(self) -> None:
        self._condition = threading.Condition(self._lock)

    def mark_used(self) -> None:
        with self._condition:
            self.last_used = time.time()

    def begin_invocation(self) -> None:
        with self._condition:
            self.inflight += 1

    def end_invocation(self) -> None:
        with self._condition:
            self.inflight = max(0, self.inflight - 1)
            self.last_used = time.time()
            if self.inflight == 0:
                self._condition.notify_all()

    def wait_for_idle(self, timeout: float | None = None) -> bool:
        deadline = time.time() + timeout if timeout is not None else None
        with self._condition:
            while self.inflight > 0:
                remaining = None if deadline is None else deadline - time.time()
                if remaining is not None and remaining <= 0:
                    return False
                self._condition.wait(timeout=remaining)
        return True

    def snapshot(self) -> tuple[int, float]:
        with self._condition:
            return self.inflight, self.last_used

    def is_idle(self, now: float, idle_seconds: float) -> bool:
        with self._condition:
            if self.inflight > 0:
                return False
            return (now - self.last_used) >= idle_seconds


class SessionRuntimeManager:
    """Coordinate per-session ContractingService instances + metadata."""

    def __init__(
        self,
        repository: SessionRepository | None = None,
        *,
        max_idle_seconds: float | None = None,
        max_resident_workers: int | None = None,
        reap_interval_seconds: float | None = None,
        worker_factory: WorkerFactory | None = None,
    ):
        self._repository = repository or SessionRepository()
        self._entries: dict[str, SessionServiceEntry] = {}
        self._services_lock = threading.RLock()
        self._worker_factory: WorkerFactory = worker_factory or ContractingWorker
        self._max_idle_seconds = (
            DEFAULT_MAX_IDLE_SECONDS if max_idle_seconds is None else max_idle_seconds
        )
        self._max_resident_workers = (
            DEFAULT_MAX_RESIDENT_WORKERS
            if max_resident_workers is None
            else max_resident_workers
        )
        self._reaper_interval = (
            DEFAULT_REAPER_INTERVAL_SECONDS
            if reap_interval_seconds is None
            else reap_interval_seconds
        )
        self._reaper_stop = threading.Event()
        self._reaper_thread: threading.Thread | None = None
        self._worker_stop_timeout = DEFAULT_WORKER_DRAIN_TIMEOUT
        self._session_ttl_seconds = max(0.0, DEFAULT_SESSION_TTL_SECONDS)
        reaper_needed = (
            self._reaper_interval > 0
            and (self._max_idle_seconds > 0 or self._session_ttl_seconds > 0)
        )
        if reaper_needed:
            self._start_reaper()

    @property
    def repository(self) -> SessionRepository:
        return self._repository

    def resolve_or_create(
        self,
        session_id: str | None,
        *,
        create_if_missing: bool = True,
    ) -> tuple[SessionMetadata, bool]:
        """Return existing metadata for session_id or create a new session."""
        if session_id and SessionRepository.is_valid_session_id(session_id):
            try:
                metadata = self._repository.load_metadata(session_id)
                return metadata, False
            except SessionNotFoundError:
                pass

        if not create_if_missing:
            raise SessionNotFoundError(session_id or "missing-session-id")

        metadata = self._repository.create_session()
        return metadata, True

    def create_session(self) -> SessionMetadata:
        return self._repository.create_session()

    def ensure_exists(self, session_id: str) -> SessionMetadata:
        return self._repository.load_metadata(session_id)

    def session_exists(self, session_id: str) -> bool:
        return self._repository.session_exists(session_id)

    def get_ui_state(self, session_id: str) -> Dict[str, Any]:
        metadata = self.ensure_exists(session_id)
        return dict(metadata.ui_state)

    def save_ui_state(self, session_id: str, ui_state: Dict[str, Any]) -> None:
        self._repository.update_metadata(session_id, ui_state=ui_state)

    def get_environment_snapshot(self, session_id: str) -> Dict[str, Any]:
        service = self._get_service(session_id)
        return service.snapshot_environment()

    def update_environment_snapshot(self, session_id: str) -> None:
        service = self._get_service(session_id)
        snapshot = service.snapshot_environment()
        self._repository.update_metadata(session_id, environment=snapshot)

    def list_contracts(self, session_id: str) -> list[str]:
        service = self._get_service(session_id)
        return service.list_contracts()

    def get_export_metadata(self, session_id: str, contract: str) -> list[ContractExportInfo]:
        service = self._get_service(session_id)
        return service.get_export_metadata(contract)

    def get_contract_details(self, session_id: str, contract: str) -> ContractDetails:
        service = self._get_service(session_id)
        return service.get_contract_details(contract)

    def deploy(self, session_id: str, name: str, code: str) -> None:
        service = self._get_service(session_id)
        service.deploy(name, code)

    def call(self, session_id: str, contract: str, function: str, kwargs: Dict[str, Any]):
        service = self._get_service(session_id)
        return service.call(contract, function, kwargs)

    def dump_state(self, session_id: str, show_internal: bool) -> str:
        service = self._get_service(session_id)
        return service.dump_state(show_internal)

    def apply_state_snapshot(self, session_id: str, snapshot: Dict[str, Any]) -> None:
        service = self._get_service(session_id)
        service.apply_state_snapshot(snapshot)

    def restore_state_snapshot(self, session_id: str, snapshot: Dict[str, Any]) -> None:
        service = self._get_service(session_id)
        service.restore_state_snapshot(snapshot)

    def remove_contract(self, session_id: str, name: str) -> None:
        service = self._get_service(session_id)
        service.remove_contract(name)

    def reset_state(self, session_id: str) -> SessionMetadata:
        service = self._get_service(session_id)
        service.reset_state()
        metadata = SessionMetadata.new(session_id)
        metadata.environment = service.snapshot_environment()
        metadata.updated_at = metadata.created_at
        self._repository.update_metadata(
            session_id,
            environment=metadata.environment,
            ui_state=metadata.ui_state,
        )
        return metadata

    def set_environment_var(self, session_id: str, key: str, value: Any) -> Any:
        service = self._get_service(session_id)
        result = service.set_environment_var(key, value)
        self.update_environment_snapshot(session_id)
        return result

    def remove_environment_var(self, session_id: str, key: str) -> None:
        service = self._get_service(session_id)
        service.remove_environment_var(key)
        self.update_environment_snapshot(session_id)

    def set_signer(self, session_id: str, signer: str) -> str:
        service = self._get_service(session_id)
        updated = service.set_signer(signer)
        self.update_environment_snapshot(session_id)
        return updated

    def get_environment(self, session_id: str) -> Dict[str, Any]:
        service = self._get_service(session_id)
        return service.get_environment()

    def shutdown(self) -> None:
        self._stop_reaper()
        with self._services_lock:
            entries = list(self._entries.values())
            self._entries.clear()
        for entry in entries:
            self._stop_entry(entry)

    def close_session(self, session_id: str) -> None:
        normalized = SessionRepository._normalize_session_id(session_id)
        if not normalized:
            return
        with self._services_lock:
            entry = self._entries.pop(normalized, None)
        if entry:
            self._stop_entry(entry)

    def _start_reaper(self) -> None:
        if self._reaper_thread is not None:
            return
        self._reaper_thread = threading.Thread(
            target=self._reaper_loop,
            name="session-worker-reaper",
            daemon=True,
        )
        self._reaper_thread.start()

    def _stop_reaper(self) -> None:
        if self._reaper_thread is None:
            return
        self._reaper_stop.set()
        self._reaper_thread.join(timeout=self._reaper_interval or 1.0)
        self._reaper_thread = None

    def _reaper_loop(self) -> None:
        while not self._reaper_stop.wait(self._reaper_interval):
            try:
                self._reap_idle_workers()
                self._reap_expired_sessions()
            except Exception:  # noqa: BLE001
                logger.exception("Failed to reap idle session workers.")

    def _reap_idle_workers(self) -> None:
        if self._max_idle_seconds <= 0:
            return
        now = time.time()
        victims: list[SessionServiceEntry] = []
        with self._services_lock:
            for session_id, entry in list(self._entries.items()):
                if entry.is_idle(now, self._max_idle_seconds):
                    victims.append(entry)
                    self._entries.pop(session_id, None)
        for entry in victims:
            self._stop_entry(entry)

    def _get_service(self, session_id: str) -> SessionServiceProxy:
        normalized = SessionRepository._normalize_session_id(session_id)
        if not normalized:
            raise SessionNotFoundError("missing-session-id")
        entry = self._get_or_create_entry(normalized)
        entry.mark_used()
        if entry.proxy is None:
            raise RuntimeError("Session worker proxy is not initialized.")
        return entry.proxy

    def _get_or_create_entry(self, session_id: str) -> SessionServiceEntry:
        entry_to_stop: SessionServiceEntry | None = None
        with self._services_lock:
            entry = self._entries.get(session_id)
            if entry and entry.worker._dead:
                self._entries.pop(session_id, None)
                entry_to_stop = entry
                entry = None
            if entry:
                return entry
        if entry_to_stop:
            self._stop_entry(entry_to_stop)
        new_entry = self._create_entry(session_id)
        with self._services_lock:
            entry = self._entries.get(session_id)
            if entry is None:
                self._entries[session_id] = new_entry
                entry = new_entry
            else:
                self._stop_entry(new_entry)
        if entry is new_entry:
            self._trim_workers_if_needed()
        return entry

    def _trim_workers_if_needed(self) -> None:
        limit = self._max_resident_workers
        if limit is None or limit <= 0:
            return
        victims: list[SessionServiceEntry] = []
        with self._services_lock:
            surplus = len(self._entries) - limit
            if surplus <= 0:
                return
            snapshots: list[tuple[float, str, SessionServiceEntry]] = []
            for session_id, entry in self._entries.items():
                inflight, last_used = entry.snapshot()
                if inflight == 0:
                    snapshots.append((last_used, session_id, entry))
            snapshots.sort(key=lambda item: item[0])
            for _, session_id, entry in snapshots:
                if surplus <= 0:
                    break
                victims.append(entry)
                self._entries.pop(session_id, None)
                surplus -= 1
            if surplus > 0:
                logger.warning(
                    "Unable to evict enough idle workers to honor PLAYGROUND_SESSION_MAX_WORKERS=%s",
                    limit,
                )
        for entry in victims:
            self._stop_entry(entry)

    def _create_entry(self, session_id: str) -> SessionServiceEntry:
        metadata = self._repository.load_metadata(session_id)
        storage_home = self._repository.storage_home(session_id)
        worker = self._worker_factory(storage_home=storage_home)
        worker.start()
        entry = SessionServiceEntry(worker=worker, proxy=None, last_used=time.time())
        try:
            proxy = SessionServiceProxy(
                worker,
                before_invoke=entry.begin_invocation,
                after_invoke=entry.end_invocation,
            )
            proxy.hydrate_environment(metadata.environment)
        except Exception:
            try:
                worker.stop()
            except Exception:
                logger.exception("Failed to stop worker after hydration error.")
            raise
        entry.proxy = proxy
        return entry

    def _stop_entry(self, entry: SessionServiceEntry) -> None:
        idle = entry.wait_for_idle(timeout=self._worker_stop_timeout)
        if not idle:
            logger.warning("Timed out waiting for session worker to become idle; forcing stop.")
        try:
            entry.worker.stop()
        except Exception:  # noqa: BLE001
            logger.exception("Failed to stop contracting worker cleanly.")

    def _reap_expired_sessions(self) -> None:
        ttl = self._session_ttl_seconds
        if ttl <= 0:
            return
        expired = self._repository.expired_sessions(ttl)
        for session_id in expired:
            try:
                self.close_session(session_id)
                self._repository.delete_session(session_id)
            except Exception:  # noqa: BLE001
                logger.exception("Failed to reap expired session %s", session_id)


session_runtime = SessionRuntimeManager()

atexit.register(session_runtime.shutdown)
