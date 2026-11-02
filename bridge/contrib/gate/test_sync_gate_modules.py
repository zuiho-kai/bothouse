"""sync_gate.sh 打包给远端的模块要覆盖 gate.py 及其本地依赖 import 的同目录模块：python3 -I test_sync_gate_modules.py"""
import ast
import re
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent


def local_imports(name):
    tree = ast.parse((HERE / name).read_text(encoding="utf-8"))
    mods = set()
    for node in tree.body:  # 只看模块顶层；函数里 try 着 import 的（ctxsvc 的 board）没有也能跑
        if isinstance(node, ast.Import):
            mods |= {a.name.split(".")[0] for a in node.names}
        elif isinstance(node, ast.ImportFrom) and node.module and not node.level:
            mods.add(node.module.split(".")[0])
    return {m + ".py" for m in mods if (HERE / (m + ".py")).is_file()}


class T(unittest.TestCase):
    def test_modules_cover_gate_imports(self):
        sh = (HERE / "sync_gate.sh").read_text(encoding="utf-8")
        listed = set(re.search(r'^GATE_MODULES="([^"]*)"', sh, re.M).group(1).split())
        need, todo = set(), ["gate.py"]
        while todo:  # gate.py 及其本地依赖的传递闭包
            for m in local_imports(todo.pop()) - need - {"gate.py"}:
                need.add(m)
                todo.append(m)
        need.discard("scorer.py")  # 远端的 scorer.py 由 scorer_torch.py 改名而来，单独拷
        self.assertFalse(need - listed, f"sync_gate.sh 漏拷：{sorted(need - listed)}")


if __name__ == "__main__":
    unittest.main()
