from __future__ import annotations

import tempfile
import time
import unittest
from pathlib import Path
from typing import Any

from playground.services.runtime import (
    SessionNotFoundError,
    SessionRepository,
    SessionRuntimeManager,
    pack_session_cookie,
)


class FakeWorker:
    """Test double for ContractingWorker that runs in-process."""

    instances: list["FakeWorker"] = []

    def __init__(self, storage_home: Path):
        self.storage_home = storage_home
        self.started = False
        self.stopped = False
        self._dead = False
        self._environment: dict[str, Any] = {}
        FakeWorker.instances.append(self)

    def start(self) -> None:
        self.started = True

    def invoke(self, method: str, *args, **kwargs):
        handler = getattr(self, method)
        return handler(*args, **kwargs)

    def hydrate_environment(self, environment: dict[str, Any]) -> None:
        self._environment = dict(environment)

    def snapshot_environment(self) -> dict[str, Any]:
        return dict(self._environment)

    def get_environment(self) -> dict[str, Any]:
        return dict(self._environment)

    def stop(self) -> None:
        self.stopped = True
        self._dead = True


class SessionRuntimeWorkerLifecycleTest(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        FakeWorker.instances = []
        self.repo = SessionRepository(root=Path(self._tmp.name))

    def _manager(self, **kwargs) -> SessionRuntimeManager:
        manager = SessionRuntimeManager(
            repository=self.repo,
            worker_factory=FakeWorker,
            **kwargs,
        )
        self.addCleanup(manager.shutdown)
        return manager

    def test_idle_workers_are_reaped(self) -> None:
        manager = self._manager(max_idle_seconds=0.1, reap_interval_seconds=0.05, max_resident_workers=8)
        session = manager.create_session()
        manager.get_environment(session.session_id)
        self.assertFalse(FakeWorker.instances[0].stopped)

        deadline = time.time() + 2
        while time.time() < deadline and not FakeWorker.instances[0].stopped:
            time.sleep(0.05)

        self.assertTrue(
            FakeWorker.instances[0].stopped,
            "Idle worker should be stopped by the reaper.",
        )

    def test_max_worker_trim_drops_oldest_idle_session(self) -> None:
        manager = self._manager(
            max_idle_seconds=-1,
            reap_interval_seconds=1,
            max_resident_workers=1,
        )
        first = manager.create_session()
        manager.get_environment(first.session_id)
        second = manager.create_session()
        manager.get_environment(second.session_id)

        self.assertTrue(
            FakeWorker.instances[0].stopped,
            "Oldest idle worker should be evicted to honor the max worker limit.",
        )
        self.assertFalse(
            FakeWorker.instances[1].stopped,
            "Newest worker should remain active.",
        )

    def test_reaper_starts_when_ttl_enabled_even_if_idle_disabled(self) -> None:
        manager = SessionRuntimeManager(
            repository=self.repo,
            max_idle_seconds=0,
            reap_interval_seconds=0.01,
            worker_factory=FakeWorker,
        )
        self.addCleanup(manager.shutdown)
        self.assertIsNotNone(
            manager._reaper_thread,
            "Reaper should start to enforce session TTL even when idle trim is disabled.",
        )

    def test_invalid_session_does_not_auto_create(self) -> None:
        manager = self._manager(max_idle_seconds=0, reap_interval_seconds=0)
        with self.assertRaises(SessionNotFoundError):
            manager.resolve_or_create("not-a-session", create_if_missing=False)
        with self.assertRaises(SessionNotFoundError):
            manager.resolve_or_create(None, create_if_missing=False)
        self.assertEqual(self.repo.list_sessions(), [])

    def test_session_cookie_must_include_matching_owner_secret(self) -> None:
        manager = self._manager(max_idle_seconds=0, reap_interval_seconds=0)
        session = manager.create_session()

        metadata, created = manager.resolve_or_create(
            pack_session_cookie(session),
            create_if_missing=False,
        )
        self.assertFalse(created)
        self.assertEqual(metadata.session_id, session.session_id)

        with self.assertRaises(SessionNotFoundError):
            manager.resolve_or_create(session.session_id, create_if_missing=False)
        with self.assertRaises(SessionNotFoundError):
            manager.resolve_or_create(
                f"{session.session_id}.wrong-secret",
                create_if_missing=False,
            )

    def test_resume_token_is_single_use_and_rotates_owner_secret(self) -> None:
        manager = self._manager(max_idle_seconds=0, reap_interval_seconds=0)
        session = manager.create_session()
        old_cookie = pack_session_cookie(session)

        token = manager.create_resume_token(session.session_id)
        adopted = manager.consume_resume_token(token)

        self.assertEqual(adopted.session_id, session.session_id)
        self.assertNotEqual(adopted.owner_secret, session.owner_secret)
        self.assertIsNone(adopted.resume_token_hash)
        with self.assertRaises(SessionNotFoundError):
            manager.consume_resume_token(token)
        with self.assertRaises(SessionNotFoundError):
            manager.resolve_or_create(old_cookie, create_if_missing=False)

        metadata, created = manager.resolve_or_create(
            pack_session_cookie(adopted),
            create_if_missing=False,
        )
        self.assertFalse(created)
        self.assertEqual(metadata.session_id, session.session_id)


if __name__ == "__main__":
    unittest.main()
