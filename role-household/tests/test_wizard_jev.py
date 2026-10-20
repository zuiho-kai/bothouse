"""cc-connect 安装向导写的 jev.json 能被选频道读到（rh/config.py _fill_from_wizard_jev）：python3 -I -m unittest tests.test_wizard_jev"""
import json, tempfile, unittest
from pathlib import Path

from rh import config

BASE = """
[meeting]
max_turns_per_topic = 6
chars_per_sec = 5.0
[brain]
model = "haiku"
timeout_sec = 120
[[roles]]
id = "a"
name = "甲"
persona = "p"
[discord]
channel = "1"
guild = "2"
[discord.router]
key_file = "{key}"
"""


class T(unittest.TestCase):
    def load(self, jev: dict, extra: str = ""):
        d = Path(tempfile.mkdtemp())
        (d / "jev.json").write_text(json.dumps(jev))
        (d / "roles.toml").write_text(BASE.format(key=d / "jev.json") + extra, encoding="utf-8")
        return config.load(d / "roles.toml").discord

    def test_url_model_from_wizard_file(self):
        dc = self.load({"backend": "llm", "url": "http://m/v1/", "model": "qwen", "api_key": "k", "logprobs": True})
        self.assertEqual((dc.router.url, dc.router.model), ("http://m/v1", "qwen"))
        self.assertTrue(dc.auto)  # 不写 auto_channel = 配了模型就开（原有规则）

    def test_no_logprobs_falls_back_to_name_matching(self):
        dc = self.load({"url": "http://m/v1", "model": "qwen", "logprobs": False})
        self.assertEqual(dc.router.url, "")
        self.assertTrue(dc.auto)   # 配了 guild：自动选频道默认开，没模型 = 读音匹配（审查第 4 条）

    def test_roles_toml_other_url_rejected(self):
        """roles.toml 的 url 和向导文件的不一样：拒绝，不把向导的 key 发到别的地址（审查第 5 条）。"""
        with self.assertRaises(ValueError):
            self.load({"url": "http://m/v1", "model": "qwen", "logprobs": True}, 'url = "http://other/v1"\nmodel = "x"\n')


if __name__ == "__main__":
    unittest.main()
