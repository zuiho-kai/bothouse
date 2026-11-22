"""safe-restart：非 UTF-8 locale 下 $VAR 后紧跟全角字符不再报变量未定义（#2092）。
根因：「$LOG（」里全角括号的高位字节在单字节 locale（如 en_US.ISO8859-1）下被并进
变量名，set -u 报 unbound variable；修成 ${LOG} 定界。同目录 iso-check 的
「$b、」「$busy。」同类，一并扫描防回退。"""
import re, subprocess, tempfile, unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
# $VAR 后紧跟非 ASCII 字节：变量名边界依赖 locale，单字节 locale 会把高位字节并进变量名
BAD = re.compile(rb'\$[A-Za-z_][A-Za-z_0-9]*[\x80-\xff]')
# 复现需要一个把 UTF-8 高位字节当字母的单字节 locale；C/POSIX/GBK 不复现
LOCALE_RE = re.compile(r'8859', re.I)


def single_byte_locale():
    try:
        out = subprocess.run(["locale", "-a"], capture_output=True, text=True).stdout
    except OSError:
        return None
    for name in out.split():
        if LOCALE_RE.search(name):
            return name
    return None


class SafeRestartLocaleTest(unittest.TestCase):
    def run_safe_restart(self, loc):
        # CC_LAUNCHD_LABEL 跳过 daemon --help 检查，CC_LOG 指向不存在文件直达「找不到日志」分支
        env = {"PATH": "/usr/bin:/bin", "HOME": tempfile.mkdtemp(),
               "CC_LAUNCHD_LABEL": "x.test", "CC_BIN": "/bin/true",
               "CC_LOG": "/nonexistent/safe-restart.log", "LC_ALL": loc}
        return subprocess.run(["sh", str(HERE / "safe-restart"), "测试", "接着做"],
                              capture_output=True, text=True, env=env)

    def test_missing_log_branch_single_byte_locale(self):
        loc = single_byte_locale()
        if not loc:
            self.skipTest("没有可用的单字节 locale（如 en_US.ISO8859-1）")
        r = self.run_safe_restart(loc)
        self.assertEqual(r.returncode, 1, r.stderr)
        self.assertIn("找不到日志", r.stderr)
        self.assertNotRegex(r.stderr, r"unbound variable|parameter not set|bad substitution")

    def test_missing_log_branch_c_locale(self):
        r = self.run_safe_restart("C")
        self.assertEqual(r.returncode, 1, r.stderr)
        self.assertIn("找不到日志", r.stderr)

    def test_no_var_adjacent_to_nonascii_in_shell_scripts(self):
        for f in sorted(HERE.iterdir()):
            if not f.is_file() or f.suffix in (".py", ".pyc"):
                continue
            with f.open("rb") as fh:
                head = fh.readline()
            if not re.search(rb'sh|zsh|bash', head):
                continue
            bad = [(i, l) for i, l in enumerate(f.read_bytes().split(b'\n'), 1)
                   if not l.lstrip().startswith(b'#') and BAD.search(l)]
            self.assertEqual(bad, [], f"{f.name} 还有 $VAR<非 ASCII> 写法：{bad}")


if __name__ == "__main__":
    unittest.main()
