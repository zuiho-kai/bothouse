"""bridge_core 单测：用本地假 hub（标准库），不需要 AstrBot、不需要真 hub。"""
import json
import os
import sys
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

# bridge_core.py 在 tests 的上一级目录
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from bridge_core import BothouseBridgeCore, HubError  # noqa: E402

GOOD = "good-token"


class FakeHub:
    """最小 hub：POST 发消息、GET 取消息；带 token 校验。"""

    def __init__(self):
        self.messages = []
        self.next_id = 1
        self.requests = []
        hub = self

        class H(BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.1"

            def _json(self, obj, code=200):
                body = json.dumps(obj, ensure_ascii=False).encode()
                self.send_response(code)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def _auth(self):
                h = self.headers.get("Authorization", "")
                return h == "Bearer " + GOOD

            def do_POST(self):
                hub.requests.append(("POST", self.path, self.headers.get("Authorization")))
                n = int(self.headers.get("Content-Length", 0) or 0)
                data = json.loads(self.rfile.read(n) or b"{}")
                if not self._auth():
                    return self._json({"error": "unauthorized"}, 401)
                m = {"id": hub.next_id, "author_kind": "user", "text": data.get("text"),
                     "name": "用户"}
                hub.next_id += 1
                hub.messages.append(m)
                return self._json(m)

            def do_GET(self):
                hub.requests.append(("GET", self.path, self.headers.get("Authorization")))
                if not self._auth():
                    return self._json({"error": "unauthorized"}, 401)
                return self._json({"messages": hub.messages})

            def log_message(self, *a):
                pass

        self.srv = ThreadingHTTPServer(("127.0.0.1", 0), H)
        self.port = self.srv.server_address[1]
        threading.Thread(target=self.srv.serve_forever, daemon=True).start()

    def add_role_reply(self, name, text):
        m = {"id": self.next_id, "author_kind": "role", "name": name, "text": text}
        self.next_id += 1
        self.messages.append(m)
        return m

    def stop(self):
        self.srv.shutdown()


class BridgeCoreTest(unittest.TestCase):
    def setUp(self):
        self.hub = FakeHub()
        self.core = BothouseBridgeCore("http://127.0.0.1:%d" % self.hub.port, GOOD, room_id=1)

    def tearDown(self):
        self.hub.stop()

    def test_send_user_message_format_and_id(self):
        m = self.core.send_user_message("你好呀", sender_name="小王", chat_name="测试群")
        self.assertEqual(m["id"], 1)
        sent = self.hub.messages[-1]["text"]
        self.assertIn("[来自 QQ 群]", sent)
        self.assertIn("小王", sent)
        self.assertIn("你好呀", sent)
        self.assertEqual(self.core.last_seen_id, 1)

    def test_fetch_new_replies_filters_role_only(self):
        self.core.send_user_message("hi")                      # user 消息（id=1）
        self.hub.add_role_reply("小鲸", "收到")                # role 消息（id=2）
        self.hub.add_role_reply("小鱼", "喵")                  # role 消息（id=3）
        got = self.core.fetch_new_replies()
        self.assertEqual([m["name"] for m in got], ["小鲸", "小鱼"])
        self.assertEqual(self.core.last_seen_id, 3)

    def test_fetch_dedupes_and_skips_old(self):
        self.hub.add_role_reply("小鲸", "旧消息")   # id=1
        self.core._last_seen_id = 1                 # 假装已经看过
        self.hub.add_role_reply("小鲸", "新消息")   # id=2
        first = self.core.fetch_new_replies()
        second = self.core.fetch_new_replies()
        self.assertEqual(len(first), 1)
        self.assertEqual(first[0]["text"], "新消息")
        self.assertEqual(second, [])

    def test_wait_for_replies_returns_then_stops(self):
        self.hub.add_role_reply("小鲸", "马上回")
        self.hub.add_role_reply("小鱼", "我也回")
        replies = self.core.wait_for_replies(timeout=5, quiet=1.0, interval=0.2)
        self.assertEqual(len(replies), 2)

    def test_format_for_chat(self):
        self.assertEqual(self.core.format_for_chat({"name": "小鲸", "text": "你好"}),
                         "【小鲸】你好")
        self.assertEqual(self.core.format_for_chat({"name": "小鲸", "text": "  "}), "")

    def test_unauthorized_raises_hub_error_without_leaking_token(self):
        bad = BothouseBridgeCore("http://127.0.0.1:%d" % self.hub.port, "secret-token", room_id=1)
        with self.assertRaises(HubError) as ctx:
            bad.send_user_message("x")
        self.assertNotIn("secret-token", str(ctx.exception))

    def test_authorization_header_sent(self):
        self.core.send_user_message("x")
        self.assertTrue(all(h == "Bearer " + GOOD for _, _, h in self.hub.requests))


    def test_format_for_chat_strips_private_meta(self):
        """隐私：模型/额度/本机路径尾注必须被过滤。"""
        reply = {"name": "小鲸", "text": "你好\n\n*[\"ustc-techer\",\"deepseek-flash\"] · 额度暂不可查询 · D:\\Agent\\role"}
        self.assertEqual(self.core.format_for_chat(reply), "【小鲸】你好")

    def test_progress_message_skipped(self):
        """过程消息（第 N 步 · 💭）不该转发给外部群。"""
        for text in ("第 0 步 · 4秒 💭 Duplicate of previous message",
                     "第 12 步 · 1分30秒 💭 thinking..."):
            self.assertEqual(self.core.format_for_chat({"name": "小鲸", "text": text}), "")

    def test_local_path_line_removed(self):
        reply = {"name": "小鲸", "text": "结论见下\n结果在 D:/Agent/Agent Workspace/DSH/tmp/x"}
        self.assertEqual(self.core.format_for_chat(reply), "【小鲸】结论见下")

    def test_format_keeps_normal_text(self):
        self.assertEqual(self.core.format_for_chat({"name": "小鲸", "text": "你好，报到收到。"}),
                         "【小鲸】你好，报到收到。")


if __name__ == "__main__":
    unittest.main(verbosity=2)
