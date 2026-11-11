from __future__ import annotations

import unittest
from unittest import mock

from playground.services import lint_contract


class LintingHelpersTest(unittest.TestCase):
    def test_lint_contract_calls_inline_linter(self) -> None:
        mock_error_with_position = mock.Mock()
        mock_error_with_position.message = "boom"
        mock_error_with_position.position = mock.Mock(line=0, column=1)

        mock_error_without_position = mock.Mock()
        mock_error_without_position.message = "oops"
        mock_error_without_position.position = None

        with mock.patch("playground.services.linting.lint_code_inline") as inline:
            inline.return_value = [mock_error_with_position, mock_error_without_position]
            results = lint_contract("contract code")

        inline.assert_called_once_with("contract code", mode="xian_vm_v2")
        self.assertEqual(results, ["Line 1, Col 2: boom", "oops"])


if __name__ == "__main__":
    unittest.main()
