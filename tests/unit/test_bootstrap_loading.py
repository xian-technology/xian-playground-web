from __future__ import annotations

import unittest
from types import SimpleNamespace
from unittest.mock import patch

from playground.defaults import DEFAULT_KWARGS_INPUT
from playground.state import PlaygroundState


class BootstrapLoadingStateTest(unittest.TestCase):
    def test_on_load_starts_bootstrap_tracking(self) -> None:
        state = PlaygroundState(_reflex_internal_init=True)
        metadata = SimpleNamespace(ui_state={})

        with (
            patch.object(PlaygroundState, "_cookie_session_id", return_value="session-1"),
            patch("playground.state.session_runtime.ensure_exists", return_value=metadata),
            patch("playground.state.session_runtime.get_environment_snapshot", return_value={}),
        ):
            actions = state.on_load()

        self.assertEqual(state.session_id, "session-1")
        self.assertTrue(state.bootstrapping)
        self.assertEqual(state._bootstrap_remaining, 3)
        self.assertEqual(
            actions,
            [
                PlaygroundState.refresh_contracts,
                PlaygroundState.refresh_state,
                PlaygroundState.refresh_environment,
            ],
        )

    def test_refresh_contracts_extends_bootstrap_for_follow_up_loads(self) -> None:
        state = PlaygroundState(_reflex_internal_init=True)
        state.bootstrapping = True
        state._bootstrap_remaining = 3
        state.show_system_contracts = False
        state.selected_contract = ""
        state.load_selected_contract = ""
        state.kwargs_input = '{"stale": true}'
        state.available_functions = []
        state.function_name = ""
        state.loaded_contract_source = ""
        state.loaded_contract_runtime_source = ""
        state.function_required_params = {}

        with (
            patch.object(PlaygroundState, "_require_session", return_value="session-1"),
            patch(
                "playground.state.session_runtime.list_contracts",
                return_value=["submission", "con_demo"],
            ),
        ):
            actions = state.refresh_contracts()

        self.assertEqual(state.deployed_contracts, ["con_demo"])
        self.assertEqual(state.hidden_system_contract_count, 1)
        self.assertEqual(state.selected_contract, "con_demo")
        self.assertEqual(state.load_selected_contract, "con_demo")
        self.assertEqual(state.kwargs_input, DEFAULT_KWARGS_INPUT)
        self.assertTrue(state.bootstrapping)
        self.assertEqual(state._bootstrap_remaining, 4)
        self.assertEqual(
            actions,
            [
                PlaygroundState.refresh_functions,
                PlaygroundState.refresh_loaded_contract,
            ],
        )

    def test_refresh_state_finishes_final_bootstrap_step(self) -> None:
        state = PlaygroundState(_reflex_internal_init=True)
        state.bootstrapping = True
        state._bootstrap_remaining = 1
        state.show_internal_state = False
        state.state_is_editing = False

        with (
            patch.object(PlaygroundState, "_require_session", return_value="session-1"),
            patch("playground.state.session_runtime.dump_state", return_value='{"ok": true}'),
        ):
            state.refresh_state()

        self.assertFalse(state.bootstrapping)
        self.assertEqual(state._bootstrap_remaining, 0)
        self.assertEqual(state.state_dump, '{"ok": true}')
        self.assertEqual(state.state_editor, '{"ok": true}')


if __name__ == "__main__":
    unittest.main()
