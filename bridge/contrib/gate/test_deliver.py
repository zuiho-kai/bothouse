"""#1904 成品活「样 → 全量」：没有用户认可进不了全量；认可只追加；记录格式是定死的（桥注入、对照件检查都读它）。
对照件：board compare 起干净模型只喂用户原话、原件或认可样、成品；exit_check 是交给用户的出口共用的判断。模型用假的 claude 顶替。
用户原话（2026-11-23）：「先交一小段让你点头，你认了才铺开整版。……你点过头的东西记下来，新会话也自动带上，不许改动。」
跑：python3 -I test_deliver.py"""
import hashlib, json, os, subprocess, sys, tempfile, unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
TMP = tempfile.mkdtemp(prefix="board-deliver-")
os.environ.update(BOARD_DIR=TMP, GATE_SETUP_DIR=TMP, CC_BIN="/usr/bin/false")  # 隔离：不读写真实数据目录、不调桥
sys.path.insert(0, str(HERE))
import board  # noqa: E402
import deliver  # noqa: E402

MAIN, OTHER, WS = "discord:1560508467733860372", "discord:1561556710097952888", "discord:1563964848755314753"
ITEMS = [
    {"id": 1904, "what": "宣传片 v9", "short": "宣传片", "where": "-", "status": "进行中", "who": "工作区1C酱",
     "at": "11-23 10:00", "chat": MAIN, "sk": WS, "ch": WS.split(":")[1], "ws": WS},
    {"id": 1905, "what": "封面图", "short": "封面图", "where": "-", "status": "进行中", "who": "橘", "at": "11-23 10:05",
     "chat": MAIN, "sk": MAIN, "ch": MAIN.split(":")[1]},
]
KEYS = {"id", "title", "chat", "stage", "product", "refs", "approvals", "compares"}
DIFFS = ["片头比原件慢半拍", "字幕颜色原件是白的、成品偏黄", "结尾少了原件最后一个镜头"]
# 假的 claude：记下收到的参数和输入，回一条 stream-json 的 result；旁边有 fail 文件就当模型出错
FAKE_CLAUDE = r'''
import json, sys
from pathlib import Path
d = Path(sys.argv[0]).parent
(d / "argv.json").write_text(json.dumps(sys.argv[1:]), encoding="utf-8")
(d / "stdin.json").write_text(sys.stdin.read(), encoding="utf-8")
if (d / "fail").exists():
    sys.stderr.write("API Error: overloaded\n"); sys.exit(1)
print(json.dumps({"type": "system", "subtype": "init"}))
print(json.dumps({"type": "result", "result": json.dumps({"diffs": json.loads((d / "diffs.json").read_text())}), "total_cost_usd": 0.01}))
'''
BIN = Path(TMP, "bin")


def run(*args, key=MAIN):
    env = dict(os.environ, CC_SESSION_KEY=key, PATH=f"{BIN}:{os.environ.get('PATH', '')}")
    return subprocess.run([sys.executable, "-I", str(HERE / "board.py"), *args], capture_output=True, text=True, env=env, timeout=60)


def record(nid):
    return json.loads(Path(TMP, "deliver", f"{nid}.json").read_text(encoding="utf-8"))


class Deliver(unittest.TestCase):
    def setUp(self):
        for f in Path(TMP, "deliver").glob("*"):
            f.unlink()
        Path(TMP, "board.jsonl").write_text("".join(json.dumps(i, ensure_ascii=False) + "\n" for i in ITEMS), encoding="utf-8")
        self.sample = Path(TMP, "sample.mp4")
        self.sample.write_bytes(b"sample-15s")
        self.ref = Path(TMP, "ref.mp4")
        self.ref.write_bytes(b"original")
        BIN.mkdir(exist_ok=True)
        for f in BIN.glob("*"):
            f.unlink()
        (BIN / "claude").write_text(f"#!{sys.executable}\n" + FAKE_CLAUDE, encoding="utf-8")
        (BIN / "claude").chmod(0o755)
        (BIN / "diffs.json").write_text(json.dumps(DIFFS), encoding="utf-8")
        self.orig = Path(TMP, "orig.md")
        self.orig.write_text("原件正文：开头一句话点题，白色字幕。", encoding="utf-8")
        self.made = Path(TMP, "made.md")
        self.made.write_text("成品正文：开头绕了三句才点题，黄色字幕。", encoding="utf-8")

    def fed(self):
        """假 claude 收到的：(命令行参数, 喂进去的全部文字, 内容块类型列表)。"""
        msg = json.loads((BIN / "stdin.json").read_text(encoding="utf-8"))["message"]["content"]
        return (json.loads((BIN / "argv.json").read_text(encoding="utf-8")),
                "\n".join(c.get("text", "") for c in msg), [c["type"] for c in msg])

    def test_full_refused_without_approval(self):
        r = run("stage", "1904", "全量")
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("还不能铺开全量", r.stderr)
        self.assertIn("board approve 1904", r.stderr)  # 拒绝的话里带下一步怎么做
        self.assertFalse(Path(TMP, "deliver", "1904.json").exists())  # 被拒不留记录
        self.assertEqual(run("stage", "1904", "样", "--product", str(self.sample)).returncode, 0)
        r = run("stage", "1904", "全量")  # 登记了样、还没认可：照样拒，阶段不变
        self.assertNotEqual(r.returncode, 0)
        self.assertEqual(record(1904)["stage"], "样")

    def test_full_allowed_after_approval(self):
        run("stage", "1904", "样", "--product", str(self.sample), "--ref", str(self.ref))
        r = run("approve", "1904", "--file", str(self.sample), "--quote", "可以，就照这个铺开", "--locked", "开头三秒", "--locked", "配音")
        self.assertEqual(r.returncode, 0, r.stderr)
        r = run("stage", "1904", "全量", "--product", "https://example.com/full.mp4")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("全量", r.stdout)
        rec = record(1904)
        self.assertEqual((rec["stage"], rec["product"]), ("全量", "https://example.com/full.mp4"))
        self.assertEqual(rec["refs"], [str(self.ref.resolve())])  # 没再给 --ref，原件留着

    def test_record_format(self):
        run("stage", "1904", "样", "--product", str(self.sample), "--ref", str(self.ref), "--ref", "https://example.com/ref")
        run("approve", "1904", "--file", str(self.sample), "--quote", "可以", "--locked", "开头三秒")
        deliver.add_compare(1904, str(self.sample), str(self.ref), ["片头慢半拍", "字幕颜色偏黄", "结尾少一个镜头"])
        rec = record(1904)
        self.assertEqual(set(rec), KEYS)
        self.assertEqual((rec["id"], rec["title"], rec["chat"], rec["stage"]), ("1904", "宣传片", MAIN, "样"))  # chat = 条目所属频道
        self.assertEqual(rec["product"], str(self.sample.resolve()))
        self.assertEqual(rec["refs"], [str(self.ref.resolve()), "https://example.com/ref"])
        a = rec["approvals"][0]
        self.assertEqual(set(a), {"file", "sha256", "quote", "at", "locked"})
        self.assertEqual((a["file"], a["quote"], a["locked"]), (str(self.sample.resolve()), "可以", ["开头三秒"]))
        self.assertEqual(a["sha256"], hashlib.sha256(b"sample-15s").hexdigest())
        c = rec["compares"][0]
        self.assertEqual(set(c), {"product", "sha256", "against", "diffs", "at"})
        self.assertEqual((c["against"], len(c["diffs"]), c["sha256"]), (str(self.ref.resolve()), 3, a["sha256"]))
        from datetime import datetime
        for at in (a["at"], c["at"]):
            self.assertIsNotNone(datetime.fromisoformat(at).tzinfo)  # ISO 时间，带时区
        self.assertEqual(json.loads(run("deliver", "1904").stdout), rec)  # board deliver 打印的就是这份记录
        self.assertEqual(deliver.load(1904), rec)
        self.assertIsNone(deliver.load(1905))

    def test_chat_is_item_owner(self):
        run("stage", "1905", "样")  # 所属频道就是条目的归属 chat（board.channel_of，#2010 起不再退到 sk、ch）
        self.assertEqual(record(1905)["chat"], MAIN)
        self.assertEqual(record(1905)["chat"], board.channel_of(ITEMS[1]))

    def test_approvals_append_only(self):
        run("approve", "1904", "--file", str(self.sample), "--quote", "可以")
        run("approve", "1904", "--file", "https://example.com/sample2", "--quote", "这版也行")
        rec = record(1904)
        self.assertEqual([a["quote"] for a in rec["approvals"]], ["可以", "这版也行"])
        self.assertEqual(rec["approvals"][1]["sha256"], "")  # 链接不记指纹
        self.assertEqual(deliver.latest_approval(1904)["quote"], "这版也行")
        self.assertEqual(deliver.latest_approval(rec), rec["approvals"][-1])
        self.assertIsNone(deliver.latest_approval(1905))
        for bad in ([], [dict(rec["approvals"][0], quote="改过的话"), rec["approvals"][1]]):  # 删、改都不让写
            with self.assertRaises(deliver.Refused):
                deliver.save(dict(rec, approvals=bad))
        self.assertEqual(record(1904), rec)

    def test_approve_needs_real_file_and_quote(self):
        for args in (("--file", str(self.sample)), ("--quote", "可以"), ("--file", str(Path(TMP, "nope.mp4")), "--quote", "可以"),
                     ("--file", str(self.sample), "--quote", "  ")):
            r = run("approve", "1904", *args)
            self.assertNotEqual(r.returncode, 0, args)
            self.assertTrue(r.stderr.strip())
        self.assertFalse(Path(TMP, "deliver", "1904.json").exists())

    def test_unknown_item_and_stage(self):
        self.assertIn("没有 #7", run("stage", "7", "样").stderr)
        self.assertNotEqual(run("stage", "1904", "半成品").returncode, 0)
        self.assertNotEqual(run("deliver", "1905").returncode, 0)  # 没登记过

    def test_other_channel_cannot_write(self):
        r = run("stage", "1905", "样", key=OTHER)  # 别的频道派的活，这里不改（#836）
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("到那边处理", r.stderr)
        self.assertEqual(run("stage", "1904", "样", key=WS).returncode, 0)  # 干这件活的工作区可以

    # ---- 对照件（用户 11-23 认可「交之前，由一个只拿到你原话和原件的新人，把成品和原件并排比一遍，写出最大的三处差别，跟成品一起交给你」）----
    def test_compare_feeds_only_quote_ref_product(self):
        run("stage", "1904", "样", "--product", str(self.made), "--ref", str(self.orig))
        r = run("compare", "1904", "--quote", "照着原件写，一个字都别多")
        self.assertEqual(r.returncode, 0, r.stderr)
        for d in DIFFS:
            self.assertIn(d, r.stdout)  # 三处差别打出来，发成品时带上
        argv, text, kinds = self.fed()
        self.assertEqual(argv[argv.index("--tools") + 1], "")  # 干净模型：不带工具、不读设置
        self.assertEqual(argv[argv.index("--setting-sources") + 1], "")
        self.assertIn("--strict-mcp-config", argv)
        for want in ("照着原件写，一个字都别多", "原件正文：开头一句话点题", "成品正文：开头绕了三句才点题"):
            self.assertIn(want, text)
        self.assertNotIn("宣传片", text)  # 活名、任务板上派活人写的话都不喂
        self.assertEqual(kinds, ["text", "text", "text"])  # 原话、原件、成品，各一块
        c = record(1904)["compares"][-1]
        self.assertEqual(set(c), {"product", "sha256", "against", "diffs", "at"})
        self.assertEqual((c["product"], c["against"], c["diffs"]), (str(self.made.resolve()), str(self.orig.resolve()), DIFFS))
        self.assertEqual(c["sha256"], hashlib.sha256(self.made.read_bytes()).hexdigest())

    def test_compare_quote_from_handoff_and_approval(self):
        notes = Path(TMP, "handoff.md")
        notes.write_text("# 交接\n## 用户原话\n- 「照抄他，学他」\n## 总目标\n派活人自己写的目标\n", encoding="utf-8")
        Path(TMP, "board.jsonl").write_text(json.dumps(dict(ITEMS[0], where=str(notes)), ensure_ascii=False) + "\n", encoding="utf-8")
        run("approve", "1904", "--file", str(self.orig), "--quote", "可以，就照这个铺开")
        run("stage", "1904", "全量", "--product", str(self.made))
        r = run("compare", "1904")  # 不写 --quote：交接「用户原话」节和认可时的原话都算
        self.assertEqual(r.returncode, 0, r.stderr)
        _, text, _ = self.fed()
        self.assertIn("照抄他，学他", text)
        self.assertIn("可以，就照这个铺开", text)
        self.assertNotIn("派活人自己写的目标", text)
        self.assertIn("用户认可过的样品", text)  # 没有原件：对着最新认可的那份比
        self.assertEqual(record(1904)["compares"][-1]["against"], str(self.orig.resolve()))

    def test_compare_image_goes_in_as_image_block(self):
        png = Path(TMP, "cover.png")
        png.write_bytes(b"\x89PNG\r\n\x1a\n-cover")
        blocks = deliver._material("成品", str(png))
        self.assertEqual([b["type"] for b in blocks], ["text", "image"])
        self.assertEqual(blocks[1]["source"]["media_type"], "image/png")
        with self.assertRaises(deliver.Refused):
            deliver._material("原件", "https://example.com/ref.png")  # 干净模型不带工具，打不开链接
        blob = Path(TMP, "deck.pptx")
        blob.write_bytes(b"PK\x03\x04\xff\xfe\x00binary")
        with self.assertRaises(deliver.Refused):
            deliver._material("成品", str(blob))

    def test_compare_refusals_record_nothing(self):
        self.assertIn("还没有交付记录", run("compare", "1904", "--quote", "照原件").stderr)
        run("stage", "1904", "样", "--product", str(self.made))
        r = run("compare", "1904", "--quote", "照原件")  # 没原件、没认可样：没东西可比
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("一句问话", r.stderr)
        run("stage", "1904", "样", "--ref", str(self.orig))
        r = run("compare", "1904")  # 没有用户原话
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("--quote", r.stderr)
        (BIN / "fail").write_text("1")
        r = run("compare", "1904", "--quote", "照原件")  # 模型没比成：不编差别
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("没比成", r.stderr)
        (BIN / "fail").unlink()
        (BIN / "diffs.json").write_text("[]")
        self.assertNotEqual(run("compare", "1904", "--quote", "照原件").returncode, 0)  # 模型没写出差别
        self.assertEqual(record(1904)["compares"], [])
        self.assertNotEqual(run("compare", "1905", "--quote", "照原件", key=OTHER).returncode, 0)  # 别的频道的活不在这里比

    def test_exit_check(self):
        other = Path(TMP, "notes.txt")
        other.write_text("随手发的文件", encoding="utf-8")
        self.assertEqual(deliver.exit_check([str(other)], "看一下"), ([], []))  # 没登记的文件不管
        run("stage", "1904", "样", "--product", str(self.made))
        problems, passed = deliver.exit_check([str(self.made)], "做好了")  # 没原件没认可样：只许带一句问话
        self.assertEqual((len(problems), passed), (1, []))
        self.assertIn("问话", problems[0])
        self.assertEqual(deliver.exit_check([str(self.made)], "先出了开头十秒，是这个感觉吗？"), ([], []))
        run("stage", "1904", "样", "--ref", str(self.orig))
        problems, passed = deliver.exit_check([str(self.made)], "先出了开头十秒，是这个感觉吗？")  # 有原件：问话不顶用，要对照件
        self.assertEqual(passed, [])
        self.assertIn("board compare 1904", problems[0])
        self.assertEqual(run("compare", "1904", "--quote", "照原件").returncode, 0)
        problems, passed = deliver.exit_check([str(self.made)], "做好了")
        self.assertEqual(problems, [])
        self.assertEqual((passed[0]["id"], passed[0]["compare"]["diffs"]), ("1904", DIFFS))
        self.assertFalse(deliver.carried("做好了", passed[0]["compare"]))
        self.assertTrue(deliver.carried("做好了\n" + passed[0]["text"], passed[0]["compare"]))
        self.assertEqual(deliver.exit_check([], "做好了", nid=1904)[1][0]["file"], str(self.made.resolve()))  # ws-pass 按任务号查
        self.assertEqual(deliver.exit_check([], "做好了", nid=1905), ([], []))
        self.made.write_text("成品改过一版", encoding="utf-8")  # 成品换了：旧对照件作废
        problems, passed = deliver.exit_check([str(self.made)], "做好了")
        self.assertEqual(passed, [])
        self.assertIn("没有对照件", problems[0])
        self.assertIn("没有对照件", deliver.exit_check([], "做好了", nid=1904)[0][0])


if __name__ == "__main__":
    unittest.main()
