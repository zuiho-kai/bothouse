"""#1904 成品活「样 → 全量」：没有用户认可进不了全量；认可只追加；记录格式是定死的（桥注入、对照件检查都读它）。
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
     "sk": MAIN, "ch": MAIN.split(":")[1]},
]
KEYS = {"id", "title", "chat", "stage", "product", "refs", "approvals", "compares"}


def run(*args, key=MAIN):
    env = dict(os.environ, CC_SESSION_KEY=key)
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

    def test_chat_falls_back_to_item_channel(self):
        run("stage", "1905", "样")  # 条目没有 chat，只有 sk：所属频道按 board.channel_of 认
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


if __name__ == "__main__":
    unittest.main()
