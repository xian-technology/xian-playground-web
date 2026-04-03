from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from playground.services.contracting import (
    ContractingService,
    _valid_contract_name,
)


SIMPLE_CONTRACT = """
value = Variable()

@export
def set_value(v: int):
    value.set(v)

@construct
def init():
    value.set(1)
"""


class ContractNameValidationTest(unittest.TestCase):
    def test_valid_name_pattern(self) -> None:
        valid = [
            "con_demo",
            "con_contract_1",
            "con_" + ("a" * 60),
            "con_a1",
        ]
        for name in valid:
            with self.subTest(name=name):
                self.assertTrue(_valid_contract_name(name))

    def test_safe_name_pattern_without_user_prefix(self) -> None:
        self.assertTrue(
            _valid_contract_name("demo_token", require_con_prefix=False)
        )

    def test_invalid_name_pattern(self) -> None:
        invalid = [
            "",
            "demo",
            "with-dash",
            "folder/name",
            "..",
            "a" * 65,
            "con_MixedCase",
            "1con_bad",
        ]
        for name in invalid:
            with self.subTest(name=name):
                self.assertFalse(_valid_contract_name(name))

    def test_deploy_rejects_invalid_names_early(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            service = ContractingService(storage_home=Path(tmpdir))
            with self.assertRaises(ValueError):
                service.deploy("bad/name", SIMPLE_CONTRACT)
            with self.assertRaises(ValueError):
                service.deploy("demo", SIMPLE_CONTRACT)
            with self.assertRaises(ValueError):
                service.deploy("a" * 65, SIMPLE_CONTRACT)

    def test_sys_signer_can_deploy_safe_name_without_con_prefix(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            service = ContractingService(storage_home=Path(tmpdir))
            service.set_signer("sys")
            service.deploy("demo_token", SIMPLE_CONTRACT)

            self.assertIn("demo_token", service.list_contracts())

    def test_contract_details_return_source_and_runtime_code(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            service = ContractingService(storage_home=Path(tmpdir))
            service.deploy("con_demo_token", SIMPLE_CONTRACT)

            details = service.get_contract_details("con_demo_token")

            self.assertEqual(details.source.strip(), SIMPLE_CONTRACT.strip())
            self.assertIn("@__export('con_demo_token')", details.decompiled_source)
            self.assertNotEqual(
                details.source.strip(),
                details.decompiled_source.strip(),
            )


if __name__ == "__main__":
    unittest.main()
