"""End-to-end verification of bothouse v36 Feishu + JiuwenSwarm 0.2.9 features against a mock Feishu OpenAPI."""
from __future__ import annotations

import asyncio
import http.server
import json
import os
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path

PLUGIN_ROOT = Path(__file__).resolve().parents[1] / "plugin"
sys.path.insert(0, str(PLUGIN_ROOT))

from bothouse.common import feishu_workflow, forum_memory  # noqa: E402
from bothouse.rails.bothouse_role_rail import BothouseRoleRail  # noqa: E402
from bothouse.tools.feishu_need_card_tool import BothouseFeishuNeedCardTool  # noqa: E402
from bothouse.tools.feishu_topic_task_tool import BothouseFeishuTopicTaskTool  # noqa: E402
from bothouse.tools.memory_forum_tool import BothouseMemoryForumTool  # noqa: E402


class _MockFeishuHandler(http.server.BaseHTTPRequestHandler):
    events: list[dict] = []
    seq: int = 0

    def log_message(self, *args):
        pass

    def _reply_json(self, code: int, payload: dict):
        raw = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def _read_body(self) -> dict:
        n = int(self.headers.get("Content-Length") or 0)
        if n <= 0:
            return {}
        return json.loads(self.rfile.read(n).decode("utf-8"))

    def do_POST(self):
        body = self._read_body()
        if self.path == "/open-apis/auth/v3/tenant_access_token/internal":
            return self._reply_json(200, {"code": 0, "tenant_access_token": "t-mock-token", "expire": 7200})
        _MockFeishuHandler.seq += 1
        msg_id = f"om_mock_{_MockFeishuHandler.seq}"
        _MockFeishuHandler.events.append({"method": "POST", "path": self.path, "body": body, "message_id": msg_id})
        return self._reply_json(200, {"code": 0, "data": {"message_id": msg_id}})

    def do_PATCH(self):
        body = self._read_body()
        _MockFeishuHandler.events.append({"method": "PATCH", "path": self.path, "body": body})
        return self._reply_json(200, {"code": 0, "data": {}})


class TestJiuwenFeishuV36(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.old_env = {k: os.environ.get(k) for k in ("BOTHOUSE_TEAM_MEMORY_DIR", "FEISHU_API_BASE", "FEISHU_APP_ID", "FEISHU_APP_SECRET", "BOTHOUSE_STUCK_SECS")}
        os.environ["BOTHOUSE_TEAM_MEMORY_DIR"] = self.tmp.name
        os.environ["FEISHU_APP_ID"] = "cli_mock_app"
        os.environ["FEISHU_APP_SECRET"] = "sec_mock_secret"
        os.environ["BOTHOUSE_STUCK_SECS"] = "600"
        _MockFeishuHandler.events.clear()
        _MockFeishuHandler.seq = 0
        self.srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), _MockFeishuHandler)
        threading.Thread(target=self.srv.serve_forever, daemon=True).start()
        os.environ["FEISHU_API_BASE"] = f"http://127.0.0.1:{self.srv.server_address[1]}/open-apis"

    def tearDown(self) -> None:
        self.srv.shutdown()
        self.srv.server_close()
        for k, v in self.old_env.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
        self.tmp.cleanup()

    def test_full_v36_flow(self) -> None:
        forum_tool = BothouseMemoryForumTool()
        need_tool = BothouseFeishuNeedCardTool()
        topic_tool = BothouseFeishuTopicTaskTool()

        # 1. Colleague A records a correction -> nightly flow -> Colleague B searches shared memory forum
        res1 = asyncio.run(
            forum_tool.invoke(
                {
                    "action": "record_correction",
                    "section": "登录服务",
                    "object": "限流",
                    "rule": "登录接口限流必须使用令牌桶，单 IP 每秒 20 次",
                    "quote": "小红：上次支付组踩过坑，必须令牌桶 20/s",
                    "source": "飞书话题 #login-1",
                    "actor": "colleague_A",
                    "mistake_key": "rate_limit_algo",
                }
            )
        )
        self.assertTrue(res1["success"])
        self.assertEqual(res1["occurrence"], 1)
        self.assertIsNone(res1["promoted_check"])

        nightly = asyncio.run(forum_tool.invoke({"action": "run_nightly"}))
        self.assertEqual(nightly["assigned"], 1)

        search_b = asyncio.run(
            forum_tool.invoke({"action": "search", "query": "登录接口 限流", "actor": "colleague_B"})
        )
        self.assertGreaterEqual(search_b["count"], 1)
        self.assertIn("[登录服务] 限流", search_b["threads"][0]["title"])

        # 2. Need card automatically pulls shared memory rules + sends interactive card to Feishu
        need_res = asyncio.run(
            need_tool.invoke(
                {
                    "chat_id": "oc_group_1",
                    "title": "给登录接口加限流",
                    "dispatcher": "小明",
                    "user_quotes": [
                        {"speaker": "小明", "text": "登录接口加限流，防暴力破解"},
                        {"speaker": "小绿", "text": "单 IP 超限返回 429"},
                    ],
                    "acceptance_criteria": ["令牌桶单 IP 20/s", "超限返回 429", "单测通过"],
                }
            )
        )
        self.assertTrue(need_res["success"])
        self.assertTrue(need_res["delivered_to_feishu"])
        self.assertGreaterEqual(need_res["memory_rules_count"], 1)
        need_event = _MockFeishuHandler.events[-1]
        self.assertEqual(need_event["body"]["msg_type"], "interactive")
        need_card_json = json.loads(need_event["body"]["content"])
        card_dump = json.dumps(need_card_json, ensure_ascii=False)
        self.assertIn("回复「开工」确认，或直接说要改哪里", card_dump)
        self.assertNotIn('"tag": "button"', card_dump)
        self.assertNotIn('"tag": "action"', card_dump)
        self.assertIn("令牌桶", card_dump)

        task_id = need_res["task_id"]

        # 3. Start task -> opens topic + main-group Progress Card; work logs stay in topic
        start_res = asyncio.run(
            topic_tool.invoke(
                {
                    "action": "start",
                    "chat_id": "oc_group_1",
                    "subtasks": [
                        {"id": "1", "name": "实现令牌桶中间件", "owner": "Claude", "status": "in_progress"},
                        {"id": "2", "name": "补齐 429 单测", "owner": "Codex", "status": "pending"},
                    ],
                }
            )
        )
        self.assertTrue(start_res["success"])
        self.assertEqual(start_res["task_id"], task_id)
        topic_root_id = start_res["topic_root_id"]
        prog_msg_id = start_res["progress_message_id"]

        before_log_count = len(_MockFeishuHandler.events)
        log_res = asyncio.run(
            topic_tool.invoke(
                {
                    "action": "post_topic",
                    "task_id": task_id,
                    "actor": "Claude",
                    "text": "已完成令牌桶限流中间件初稿，正在跑单测",
                }
            )
        )
        self.assertTrue(log_res["success"])
        log_ev = _MockFeishuHandler.events[-1]
        self.assertEqual(len(_MockFeishuHandler.events), before_log_count + 1)
        self.assertEqual(log_ev["path"], f"/open-apis/im/v1/messages/{topic_root_id}/reply")
        self.assertTrue(log_ev["body"]["reply_in_thread"])

        # 4. Update progress -> PATCHes existing Progress Card in-place (no new main-group message)
        upd_res = asyncio.run(
            topic_tool.invoke(
                {
                    "action": "update_progress",
                    "task_id": task_id,
                    "subtask_id": "1",
                    "status": "done",
                    "note": "中间件已合入",
                }
            )
        )
        self.assertTrue(upd_res["success"])
        patch_ev = _MockFeishuHandler.events[-1]
        self.assertEqual(patch_ev["method"], "PATCH")
        self.assertEqual(patch_ev["path"], f"/open-apis/im/v1/messages/{prog_msg_id}")

        # 5. Stuck check -> 10m alert in topic, 20m escalation in main group
        task = feishu_workflow.load_task(task_id)
        assert task is not None
        task["last_progress_at"] = time.time() - 700
        feishu_workflow.save_task(task)
        chk1 = asyncio.run(topic_tool.invoke({"action": "check_stuck"}))
        self.assertEqual(chk1["alerts"][0]["level"], "topic")
        self.assertTrue(_MockFeishuHandler.events[-1]["body"]["reply_in_thread"])

        task = feishu_workflow.load_task(task_id)
        assert task is not None
        task["last_progress_at"] = time.time() - 1300
        feishu_workflow.save_task(task)
        chk2 = asyncio.run(topic_tool.invoke({"action": "check_stuck"}))
        self.assertEqual(chk2["alerts"][0]["level"], "main_group")
        self.assertEqual(_MockFeishuHandler.events[-1]["path"], "/open-apis/im/v1/messages?receive_id_type=chat_id")

        # 6. 2nd correction on same mistake_key -> promotes to hard check -> complete rejects without evidence
        res2 = asyncio.run(
            forum_tool.invoke(
                {
                    "action": "record_correction",
                    "section": "登录服务",
                    "object": "限流",
                    "rule": "必须附带压测或单测退出码",
                    "quote": "小明：又没贴测试退出码",
                    "source": "飞书话题 #login-2",
                    "actor": "colleague_B",
                    "mistake_key": "rate_limit_algo",
                }
            )
        )
        self.assertEqual(res2["occurrence"], 2)
        self.assertIsNotNone(res2["promoted_check"])

        bad_done = asyncio.run(
            topic_tool.invoke({"action": "complete", "task_id": task_id, "text": "改好了", "evidence": ""})
        )
        self.assertFalse(bad_done["success"])
        self.assertTrue(bad_done["rejected"])

        good_done = asyncio.run(
            topic_tool.invoke(
                {
                    "action": "complete",
                    "task_id": task_id,
                    "text": "已完成限流，必须附带压测或单测退出码：exit 0",
                    "evidence": "pytest exit 0",
                }
            )
        )
        self.assertTrue(good_done["success"])
        self.assertEqual(good_done["status"], "completed")

        # 7. Rail injects shared team memory hits into system_prompt_builder
        class _Builder:
            def __init__(self):
                self.sections = {}

            def add_section(self, sec):
                self.sections[sec.name] = sec

            def remove_section(self, name):
                self.sections.pop(name, None)

        class _Agent:
            def __init__(self):
                self.system_prompt_builder = _Builder()

        class _Ctx:
            class _Inputs:
                messages = [{"role": "user", "content": "登录接口限流怎么配？"}]

            inputs = _Inputs()

        rail = BothouseRoleRail()
        rail.init(_Agent())
        asyncio.run(rail.before_model_call(_Ctx()))
        self.assertIn("bothouse.team_memory", rail._agent.system_prompt_builder.sections)


if __name__ == "__main__":
    unittest.main()
