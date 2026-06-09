from __future__ import annotations

import multiprocessing as mp
import os
import threading
import traceback
from dataclasses import dataclass
from multiprocessing.connection import Connection
from pathlib import Path
from typing import Any, Callable

DEFAULT_RPC_TIMEOUT = float(os.getenv("PLAYGROUND_WORKER_RPC_TIMEOUT", "30.0"))

class ContractingWorker(mp.Process):
    """Run a ContractingService inside an isolated process."""

    def __init__(self, storage_home: Path, rpc_timeout: float | None = None):
        super().__init__(daemon=True)
        self._storage_home = str(storage_home)
        self._parent_conn: Connection | None = None
        self._child_conn: Connection | None = None
        self._lock = None
        self._stopped = False
        self._dead = False
        self._rpc_timeout = DEFAULT_RPC_TIMEOUT if rpc_timeout is None else rpc_timeout

    def run(self) -> None:
        from .contracting import ContractingService  # Local import for spawn safety

        service = ContractingService(storage_home=Path(self._storage_home))
        conn = self._child_conn
        while True:
            try:
                message = conn.recv()
            except EOFError:
                break
            if not isinstance(message, tuple) or len(message) != 3:
                conn.send(("error", ("ContractingWorker", "invalid message")))
                continue
            command, args, kwargs = message
            if command == "__shutdown__":
                conn.send(("ok", None))
                break
            try:
                target: Callable = getattr(service, command)
            except AttributeError:
                conn.send(("error", ("AttributeError", f"Unknown command {command!r}")))
                continue
            try:
                result = target(*args, **kwargs)
                conn.send(("ok", result))
            except Exception as exc:  # noqa: BLE001
                conn.send(("error", _serialize_exception(exc)))

        conn.close()

    def start(self) -> None:
        parent_conn, child_conn = mp.Pipe()
        self._parent_conn = parent_conn
        self._child_conn = child_conn
        super().start()
        self._lock = threading.Lock()

    def invoke(self, command: str, *args, **kwargs):
        if self._stopped:
            raise RuntimeError("Contracting worker has been stopped.")

        lock = self._lock
        if lock is None:
            raise RuntimeError("Worker lock not initialized.")
        with lock:
            conn = self._parent_conn
            if conn is None:
                raise RuntimeError("Worker connection not initialized.")
            try:
                conn.send((command, args, kwargs))
                timeout = self._rpc_timeout
                if timeout is not None and timeout > 0:
                    if not conn.poll(timeout):
                        self._handle_timeout()
                        raise ContractWorkerTimeoutError(command=command, timeout=timeout)
                status, payload = conn.recv()
            except (EOFError, BrokenPipeError):
                self._dead = True
                raise RuntimeError("Contracting worker became unavailable.") from None
        if status == "ok":
            return payload
        remote = RemoteExceptionPayload.from_raw(payload)
        raise ContractWorkerInvocationError(command=command, payload=remote)

    def stop(self) -> None:
        if self._stopped:
            return
        try:
            lock = self._lock
            if lock is None:
                raise RuntimeError("Worker lock not initialized.")
            with lock:
                conn = self._parent_conn
                if conn is not None:
                    conn.send(("__shutdown__", (), {}))
                    conn.recv()
        except (EOFError, BrokenPipeError):
            pass
        finally:
            if self._parent_conn is not None:
                self._parent_conn.close()
            if self._child_conn is not None:
                self._child_conn.close()
            self.join(timeout=2)
            if self.is_alive():
                self.terminate()
            self._stopped = True
            self._dead = True

    def __getstate__(self):
        state = self.__dict__.copy()
        state['_lock'] = None
        state['_parent_conn'] = None
        return state

    def __setstate__(self, state):
        self.__dict__.update(state)
        self._lock = None

    def _handle_timeout(self) -> None:
        """Forcefully tear down a hung worker after an RPC timeout."""

        self._dead = True
        try:
            parent_conn = self._parent_conn
            if parent_conn is not None:
                try:
                    parent_conn.close()
                finally:
                    self._parent_conn = None

            child_conn = self._child_conn
            if child_conn is not None:
                try:
                    child_conn.close()
                finally:
                    self._child_conn = None

            if self.is_alive():
                self.terminate()
                self.join(timeout=1)
        finally:
            self._stopped = True


class SessionServiceProxy:
    """Thin proxy forwarding attribute access to the worker process."""

    def __init__(
        self,
        worker: ContractingWorker,
        *,
        before_invoke: Callable[[], None] | None = None,
        after_invoke: Callable[[], None] | None = None,
    ):
        self._worker = worker
        self._before_invoke = before_invoke
        self._after_invoke = after_invoke

    def __getattr__(self, item: str):
        def method(*args, **kwargs):
            invoked = False
            if self._before_invoke:
                self._before_invoke()
                invoked = True
            try:
                return self._worker.invoke(item, *args, **kwargs)
            finally:
                if invoked and self._after_invoke:
                    self._after_invoke()

        return method

    def stop(self) -> None:
        self._worker.stop()


@dataclass(slots=True)
class RemoteExceptionPayload:
    """Structured representation of an exception raised inside the worker process."""

    type_name: str
    module: str
    message: str
    traceback_text: str

    @classmethod
    def from_raw(cls, payload: Any) -> "RemoteExceptionPayload":
        if isinstance(payload, dict):
            return cls(
                type_name=str(payload.get("exc_type", "Exception")),
                module=str(payload.get("exc_module", "")),
                message=str(payload.get("message", "")),
                traceback_text=str(payload.get("traceback", "")),
            )
        if isinstance(payload, tuple) and len(payload) == 2:
            type_name, message = payload
            return cls(
                type_name=str(type_name),
                module="",
                message=str(message),
                traceback_text="",
            )
        return cls(
            type_name="Exception",
            module="",
            message=str(payload),
            traceback_text="",
        )


def _serialize_exception(exc: Exception) -> dict[str, str]:
    formatted = "".join(traceback.format_exception(exc.__class__, exc, exc.__traceback__))
    return {
        "exc_type": exc.__class__.__name__,
        "exc_module": exc.__class__.__module__,
        "message": str(exc),
        "traceback": formatted,
    }


class ContractWorkerInvocationError(RuntimeError):
    """Raised when the contracting worker reports an exception."""

    def __init__(self, *, command: str, payload: RemoteExceptionPayload):
        self.command = command
        self.remote_type = payload.type_name
        self.remote_module = payload.module
        self.remote_message = payload.message
        self.remote_traceback = payload.traceback_text
        display = payload.message or payload.type_name
        super().__init__(f"{command} failed: {payload.type_name}: {display}")

    def pretty_remote_traceback(self) -> str:
        """Return the remote traceback or a synthesized message."""
        return self.remote_traceback or f"{self.remote_type}: {self.remote_message}"


class ContractWorkerTimeoutError(RuntimeError):
    """Raised when the contracting worker fails to respond within the timeout."""

    def __init__(self, *, command: str, timeout: float):
        self.command = command
        self.timeout = timeout
        super().__init__(f"{command} timed out after {timeout} seconds.")
