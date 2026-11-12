"""#1492 常识：在别的仓库里查不到 PR，不等于这件活写的 PR 是编的。"""
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('_handoff_rules', Path(__file__).with_name('_handoff_rules.py'))
hr = importlib.util.module_from_spec(spec)
spec.loader.exec_module(hr)


class PrWithoutRepo(unittest.TestCase):
    def test_bare_number_missing_in_cwd_repo_is_unverified(self):
        class R:  # noqa: N801
            returncode, stdout, stderr = 1, "", "no pull requests found for branch \"123\""
        with patch.object(hr.shutil, "which", return_value="/usr/bin/gh"), patch.object(hr, "_git_top", return_value=Path("/x")), \
                patch.object(hr.subprocess, "run", return_value=R()):
            self.assertIsNone(hr._gh_pr("", "123", []))
            self.assertFalse(hr._gh_pr("o/r", "123", []))  # 仓库写明了：查不到才算不对


if __name__ == "__main__":
    unittest.main()
