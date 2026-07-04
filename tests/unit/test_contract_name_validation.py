from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from playground.services import contracting as contracting_service_module
from playground.services.contracting import (
    ContractingService,
    _valid_contract_name,
)


SIMPLE_CONTRACT = """
value = Variable()

@export
def set_value(v: int):
    value.set(v)

@export
def get() -> int:
    return value.get()

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

    def test_contract_details_return_source_and_vm_ir(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            service = ContractingService(storage_home=Path(tmpdir))
            service.deploy("con_demo_token", SIMPLE_CONTRACT)

            details = service.get_contract_details("con_demo_token")
            vm_ir = json.loads(details.vm_ir_json)

            self.assertEqual(details.source.strip(), SIMPLE_CONTRACT.strip())
            self.assertEqual(vm_ir["module_name"], "con_demo_token")
            self.assertTrue(
                {"set_value", "get"}.issubset(
                    {function["name"] for function in vm_ir["functions"]}
                )
            )
            self.assertNotEqual(
                details.source.strip(),
                details.vm_ir_json.strip(),
            )

    def test_deploy_and_call_execute_through_vm_core(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            service = ContractingService(storage_home=Path(tmpdir))
            with patch(
                "playground.services.contracting.xian_vm_core.execute_contract",
                wraps=contracting_service_module.xian_vm_core.execute_contract,
            ) as execute_contract:
                service.deploy("con_demo_token", SIMPLE_CONTRACT)
                self.assertEqual(
                    service.call("con_demo_token", "get", {}).as_string(),
                    "1",
                )

        calls = {
            (
                call.kwargs["contract_name"],
                call.kwargs["function_name"],
            )
            for call in execute_contract.call_args_list
        }
        self.assertIn(("submission", "submit_contract"), calls)
        self.assertIn(("con_demo_token", "get"), calls)

    def test_apply_state_snapshot_rejects_internal_contract_injection(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            service = ContractingService(storage_home=Path(tmpdir))

            with self.assertRaises(ValueError):
                service.apply_state_snapshot(
                    {
                        "bad-name": {
                            "__xian_ir_v1__": "{}",
                            "__source__": "@export\ndef ping():\n    return 7\n",
                        }
                    }
                )

            self.assertEqual(service.list_contracts(), ["submission"])

    def test_restore_state_snapshot_round_trips_exported_contracts(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            service = ContractingService(storage_home=Path(tmpdir))
            service.deploy("con_demo_token", SIMPLE_CONTRACT)

            exported = json.loads(service.dump_state(True))

            service.reset_state()
            service.restore_state_snapshot(exported)

            self.assertEqual(
                service.call("con_demo_token", "get", {}).as_string(),
                "1",
            )
            details = service.get_contract_details("con_demo_token")
            self.assertEqual(details.source.strip(), SIMPLE_CONTRACT.strip())

    def test_restore_state_snapshot_ignores_submission_override(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            service = ContractingService(storage_home=Path(tmpdir))

            snapshot = json.loads(service.dump_state(True))
            snapshot["submission"]["__source__"] = "@export\ndef nope():\n    return 1\n"

            service.restore_state_snapshot(snapshot)

            self.assertIn("submit_contract", [e.name for e in service.get_export_metadata("submission")])


if __name__ == "__main__":
    unittest.main()
