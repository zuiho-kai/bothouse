"""#1492 常识：桥拒了看门登记（409 队友不在这台桥），d10 不能整个退出、连 10 分钟到点看门都不挂。"""
import os
from pathlib import Path
import runpy
import tempfile
import unittest
from unittest.mock import patch


class D10RegisterFail(unittest.TestCase):
    def test_refused_registration_still_arms_the_timer(self):
        tmp = tempfile.mkdtemp()
        env = {"CC_SESSION_KEY": "test:100", "CC_PROJECT": "lead", "GATE_SETUP_DIR": tmp, "CC_BIN": "/usr/bin/true"}
        with patch.dict(os.environ, env):
            mod = runpy.run_path(str(Path(__file__).with_name("d10")))
            g = mod["main"].__globals__
            calls = []

            def run(argv, **kw):
                calls.append(argv)
                class R:  # noqa: N801
                    returncode, stdout, stderr = 0, "t123\n", ""
                return R()

            def refuse(*a, **kw):
                raise OSError("看门登记失败（409）：assigned role is not connected to this bridge")
            with patch.object(g["_team"], "member_id", return_value="42"), patch.object(g["_team"], "cc_bin", return_value="/usr/bin/true"), \
                    patch.object(g["_watch"], "request", refuse), patch.object(g["subprocess"], "run", run):
                mod["main"](["龙娘", "修看门"])
        self.assertTrue(any(c[1:3] == ["timer", "add"] for c in calls), calls)


if __name__ == "__main__":
    unittest.main()
