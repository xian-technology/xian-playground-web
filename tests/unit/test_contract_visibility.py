from __future__ import annotations

import unittest

from playground.state import (
    _filter_visible_contracts,
    _is_system_contract_name,
)


class ContractVisibilityHelpersTest(unittest.TestCase):
    def test_identifies_system_contracts_by_name(self) -> None:
        self.assertTrue(_is_system_contract_name("submission"))
        self.assertTrue(_is_system_contract_name("currency"))
        self.assertFalse(_is_system_contract_name("con_demo"))

    def test_filters_system_contracts_by_default(self) -> None:
        contracts = ["con_demo", "submission", "currency", "con_other"]

        visible = _filter_visible_contracts(
            contracts,
            show_system_contracts=False,
        )

        self.assertEqual(visible, ["con_demo", "con_other"])

    def test_keeps_all_contracts_when_toggle_enabled(self) -> None:
        contracts = ["con_demo", "submission", "currency"]

        visible = _filter_visible_contracts(
            contracts,
            show_system_contracts=True,
        )

        self.assertEqual(visible, contracts)


if __name__ == "__main__":
    unittest.main()
