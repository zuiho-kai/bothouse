#!/usr/bin/env python3 -I
"""Seconds-fast checks of search.py on a fake wiki (temp dir); no model calls.

  python3 -I bin/test_search.py
"""
import os, sys, tempfile, unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import search as S

PAGE = """---
name: {name}
description: {desc}
metadata:
  scope: s
---
# T
## 关键事实
{body}
"""


def put(root, rel, text):
    p = Path(root) / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(text)


class T(unittest.TestCase):
    def test_toks(self):
        # 中文二字切分 + 英文词（>=2 字符）+ 3 位以上数字；单字、两位数字不要
        self.assertEqual(S.toks("代理端口 Clash 7890 a 12 中"),
                         ["代理", "理端", "端口", "clash", "7890"])

    def test_skip_rules_and_subdomain(self):
        with tempfile.TemporaryDirectory() as d:
            for f in ("MEMORY.md", "log.md", "CLAUDE.md"):
                put(d, f, "代理端口 7890 在这里")
            put(d, "infra/README.md", "- [vps](vps.md) — 代理端口 7890")
            put(d, "infra/vps.md", PAGE.format(name="vps", desc="VPS 一览", body="- 代理端口 7890"))
            put(d, "bots/README.md", "x")
            put(d, "bots/chat/README.md", "x")
            put(d, "bots/chat/gate.md", PAGE.format(name="gate", desc="gate 页", body="- gate 也走代理端口"))
            put(d, "refs/README.md", "x")
            put(d, "refs/media/clip.md", PAGE.format(name="clip", desc="c", body="- 代理端口 视频"))
            put(d, ".ingest-work/infra/README.md", "x")
            put(d, ".ingest-work/infra/vps.md", PAGE.format(name="vps", desc="d", body="- 代理端口 7890"))
            put(d, "bin/x.md", "代理端口 7890")
            idx = S.Index(Path(d))
            pages = {r for r, _, _ in idx.search("代理端口")}
            self.assertEqual(pages, {"infra/vps.md", "bots/chat/gate.md"})
            top = idx.search("代理端口 7890")[0]
            self.assertEqual(top[0], "infra/vps.md")
            self.assertEqual(top[2], "- 代理端口 7890")
            self.assertEqual(top[1], 9)  # 文件里的真实行号（1 起）
            self.assertEqual(idx.desc["bots/chat/gate.md"], "gate 页")

    def test_frontmatter_not_indexed(self):
        with tempfile.TemporaryDirectory() as d:
            put(d, "infra/README.md", "x")
            put(d, "infra/vps.md", PAGE.format(name="vps", desc="只在描述里的词汇", body="- 正文内容一行"))
            self.assertEqual(S.Index(Path(d)).search("描述里的词汇"), [])

    def test_top10(self):
        with tempfile.TemporaryDirectory() as d:
            put(d, "infra/README.md", "x")
            put(d, "infra/vps.md", PAGE.format(name="vps", desc="d", body="\n".join(f"- 代理端口第{i}条记录" for i in range(30))))
            self.assertEqual(len(S.Index(Path(d)).search("代理端口")), 10)


    def test_pages_fold_page_and_family(self):
        with tempfile.TemporaryDirectory() as d:
            put(d, "infra/README.md", "x")
            put(d, "infra/vps.md", PAGE.format(name="vps", desc="d", body="- 代理端口一\n- 代理端口二"))
            put(d, "infra/vps-details.md", PAGE.format(name="vps-details", desc="d", body="- 代理端口三"))
            put(d, "infra/vpsx.md", PAGE.format(name="vpsx", desc="d", body="- 代理端口四"))  # not vps- : own family
            hits = S.Index(Path(d)).search_pages("代理端口")
            self.assertEqual(len(hits), 2)
            fam = next(h for h in hits if h[0] in ("infra/vps.md", "infra/vps-details.md"))
            self.assertEqual(sorted([fam[0]] + fam[4]), ["infra/vps-details.md", "infra/vps.md"])
            self.assertEqual(S.Index(Path(d)).candidates("代理端口 一")[0], "infra/vps.md")


if __name__ == "__main__":
    unittest.main()
