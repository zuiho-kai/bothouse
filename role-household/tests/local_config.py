"""roles.toml 是各人自己的本地文件（不进 git，模板 roles.example.toml）。核对本机实际配置的测试没有它就跳过。"""
from pathlib import Path

LOCAL = Path(__file__).resolve().parent.parent / "roles.toml"


def need_local(tc) -> Path:
    if not LOCAL.is_file():
        tc.skipTest("没有本地 roles.toml（不进 git，cp roles.example.toml roles.toml 后再跑这条）")
    return LOCAL
