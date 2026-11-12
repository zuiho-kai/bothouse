"""Task #797: use the real board CLI with isolated state and no bridge calls."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))  # python3 -I drops the script dir (like test_board.py / test_board_prune.py)


class HandbackReview(unittest.TestCase):
    def test_report_after_worker_closed_still_requires_dispatcher(self):
        tmp = tempfile.mkdtemp()
        env = {**os.environ, "BOARD_DIR": tmp, "CC_BIN": "false", "CC_PROJECT": "worker", "CC_SESSION_KEY": "room:work"}
        path = Path(tmp) / "board.jsonl"
        path.write_text(json.dumps({"id": 46, "what": "verify", "chat": "room:chat", "ws": "room:work", "dispatcher": "dispatcher"}) + "\n")
        def cli(*args):
            p = subprocess.run([sys.executable, "-I", str(HERE / "board.py"), *args], env=env, text=True, capture_output=True, timeout=10)
            self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
        cli("update", "46", "已完成")
        self.assertEqual(path.read_text(), "")  # existing worker completion behavior
        cli("returned", "46", "worker")
        it = json.loads(path.read_text())
        self.assertEqual(it["reviewer"], "dispatcher")
        self.assertNotIn("done_at", it)
        self.assertEqual((Path(tmp) / "board-done.jsonl").read_text(), "")
        env.update(CC_PROJECT="dispatcher", CC_SESSION_KEY="room:chat")
        cli("done", "46", "0")
        cli("returned", "46", "worker")  # delayed duplicate cannot undo acceptance
        self.assertEqual(path.read_text(), "")
        self.assertTrue(json.loads((Path(tmp) / "board-done.jsonl").read_text())["review_accepted_at"])

    def test_lead_pass_closes_with_reject_rounds(self):
        # agentm #35 11-10: the lead passed the report (ws-pass) but the item stayed 「已交回待验收」;
        # the review nudge reopened it four hours later. `board accepted` is what the bridge runs on pass.
        tmp = tempfile.mkdtemp()
        env = {**os.environ, "BOARD_DIR": tmp, "CC_BIN": "false", "CC_PROJECT": "lead", "CC_SESSION_KEY": "room:chat"}
        path = Path(tmp) / "board.jsonl"
        path.write_text(json.dumps({"id": 35, "what": "review", "chat": "room:chat", "ws": "room:work", "dispatcher": "lead",
                                    "returned_at": "2026-11-10T03:21:00+00:00", "reject_reasons": ["head 变了"]}) + "\n")
        def cli(*args):
            p = subprocess.run([sys.executable, "-I", str(HERE / "board.py"), *args], env=env, text=True, capture_output=True, timeout=10)
            self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
            return p.stdout
        self.assertIn("已验收收口", cli("accepted", "35"))
        self.assertEqual(path.read_text(), "")
        rec = json.loads((Path(tmp) / "board-done.jsonl").read_text())
        self.assertTrue(rec["review_accepted_at"])
        self.assertEqual((rec["rework"], rec["rework_why"]), (1, "head 变了"))
        self.assertIn("不用再收", cli("accepted", "35"))  # already closed: no error

    def test_rework_cap_does_not_claim_an_unsent_ask(self):
        # #1492: the second rejection pauses the item and sends the user an [ask]. When the send
        # failed, stdout still said 「已在聊天频道发 [ask]」, so the lead trusted it and the user never heard.
        tmp = tempfile.mkdtemp()
        env = {**os.environ, "BOARD_DIR": tmp, "CC_BIN": "false", "CC_PROJECT": "lead", "CC_SESSION_KEY": "room:chat"}
        path = Path(tmp) / "board.jsonl"
        path.write_text(json.dumps({"id": 35, "what": "review", "chat": "room:chat", "ws": "room:work", "project": "lead",
                                    "returned_at": "2026-11-10T03:21:00+00:00", "reject_reasons": ["第一次"]}) + "\n")
        p = subprocess.run([sys.executable, "-I", str(HERE / "board.py"), "reject", "35", "第二次"],
                           env=env, text=True, capture_output=True, timeout=10)
        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
        self.assertTrue(json.loads(path.read_text())["rework_cap"])
        self.assertNotIn("已在聊天频道发 [ask]", p.stdout)
        self.assertIn("没发出去", p.stdout)

    def test_report_reject_rebind_and_accept(self):
        with tempfile.TemporaryDirectory() as tmp:
            env = {**os.environ, "BOARD_DIR": tmp, "CC_BIN": "false", "CC_PROJECT": "dispatcher"}
            env.pop("BOARD_PR_REPO", None)
            def cli(*args):
                p = subprocess.run([sys.executable, "-I", str(HERE / "board.py"), *args],
                                   env=env, text=True, capture_output=True, timeout=10)
                self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
            def item():
                return json.loads((Path(tmp) / "board.jsonl").read_text().strip())
            cli("add", "交回验收", "notes.md", "执行中", "worker", "--short", "交回验收")
            self.assertEqual(item()["dispatcher"], "dispatcher")
            data = item() | {"ws": "room:work", "chat": "room:chat", "sk": "room:work"}
            (Path(tmp) / "board.jsonl").write_text(json.dumps(data) + "\n")
            env["CC_PROJECT"] = "worker"
            cli("returned", "1", "worker")
            first = item()
            self.assertEqual(first["reviewer"], "dispatcher")
            self.assertNotIn("ws", first)
            self.assertEqual(first["ws_was"], "room:work")
            self.assertEqual(first["sk"], "room:chat")
            cli("returned", "1", "other")
            self.assertEqual(first["returned_at"], item()["returned_at"])
            cli("update", "1", "已交回待验收")
            self.assertEqual(item()["returned_at"], first["returned_at"])
            cli("reject", "1", "缺真实入口验证")
            self.assertNotIn("returned_at", item())
            self.assertIn("缺真实入口验证", item()["pause_why"])
            cli("returned", "1", "worker")
            self.assertNotEqual(first["returned_at"], item()["returned_at"])
            self.assertNotIn("paused", item())
            self.assertNotIn("review_rejected", item())
            cli("done", "1", "1", "补入口验证")
            self.assertEqual((Path(tmp) / "board.jsonl").read_text().strip(), "")
            self.assertEqual(json.loads((Path(tmp) / "board-done.jsonl").read_text())["rework"], 1)

class MergeClosure(unittest.TestCase):
    def test_bound_merged_pr_enters_review_once_and_never_accepts_itself(self):
        import board
        from unittest.mock import patch
        from subprocess import CompletedProcess
        tmp = Path(tempfile.mkdtemp())
        with patch.object(board, "DIR", tmp), patch.dict(os.environ, {"CC_PROJECT":"lead"}), patch.object(board.subprocess,"run",return_value=CompletedProcess([],0,'{"state":"MERGED","mergedAt":"2026-11-02T00:00:00Z","mergeCommit":{"oid":"abc"}}','')):
            board._write([{"id":72,"what":"test","chat":"room:main","dispatcher":"lead","bound":"2026-11-01T00:00:00Z"}])
            board.bind_pr(72,"https://github.com/example/project/pull/830",True)
            board.reconcile_merged_prs()
            first=board.items()[0]
            self.assertIn("待收口",first["status"])
            self.assertTrue(first["returned_at"])
            self.assertFalse((tmp / "board-done.jsonl").exists())
            board.reconcile_merged_prs()
            self.assertEqual(first,board.items()[0])
            board.reject(72,"missing acceptance")
            board.reconcile_merged_prs()
            self.assertNotIn("returned_at",board.items()[0])
            board.rebind(72,"room:new-work")
            self.assertNotIn("pr_merge",board.items()[0])
            item=board.items()[0]
            item["bound"]="new-generation"
            item.pop("paused",None)
            board._write([item])
            board.bind_pr(72,"https://github.com/example/project/pull/831",True)
            board.reconcile_merged_prs()
            self.assertEqual(board.items()[0]["pr_merge"]["url"],"https://github.com/example/project/pull/831")

    def test_open_closed_deploy_required_and_stale_pr_bindings_do_not_close(self):
        import board
        from unittest.mock import patch
        from subprocess import CompletedProcess
        for state,no_deploy,stale in [("OPEN",True,False),("CLOSED",True,False),("MERGED",False,False),("MERGED",True,True)]:
            with self.subTest(state=state,no_deploy=no_deploy,stale=stale):
                tmp=Path(tempfile.mkdtemp())
                with patch.object(board,"DIR",tmp),patch.dict(os.environ,{"CC_PROJECT":"lead"}),patch.object(board.subprocess,"run",return_value=CompletedProcess([],0,json.dumps({"state":state,"mergedAt":"2026-11-02T00:00:00Z"}),'')):
                    board._write([{"id":72,"chat":"room:main","dispatcher":"lead","bound":"old"}])
                    board.bind_pr(72,"https://github.com/example/project/pull/830",no_deploy)
                    if stale:
                        item=board.items()[0]; item["bound"]="new"; board._write([item])
                    board.reconcile_merged_prs()
                    self.assertNotIn("returned_at",board.items()[0])

class AwaitDeploy(unittest.TestCase):
    """#134 ③：要部署的 PR 合并后进「等发布」，部署含它之后转「待上线验收」。"""
    def test_merged_deploy_binding_waits_for_release_then_review(self):
        import board
        from unittest.mock import patch
        from subprocess import CompletedProcess
        tmp=Path(tempfile.mkdtemp())
        merged=CompletedProcess([],0,json.dumps({"state":"MERGED","mergedAt":"2026-11-04T09:00:00Z","mergeCommit":{"oid":"abc1234def"}}),'')
        with patch.object(board,"DIR",tmp),patch.dict(os.environ,{"CC_PROJECT":"lead"}):
            board._write([{"id":80,"chat":"room:main","dispatcher":"lead","bound":"g1","returned_at":"2026-11-04T08:00:00+00:00","reviewer":"fish"}])
            board.bind_pr(80,"https://github.com/example/project/pull/990",False)
            with patch.object(board.subprocess,"run",return_value=merged):
                board.reconcile_merged_prs()
            it=board.items()[0]
            self.assertEqual(it["await_deploy"]["commit"],"abc1234def")
            self.assertTrue(it["status"].startswith("等发布"))
            self.assertNotIn("returned_at",it)  # 合并前已审过；等发布不是待验收
            with patch.object(board,"_deploy_contains",return_value=False):
                self.assertEqual(board.mark_deployed("0123456"),[])
            with patch.object(board,"_deploy_contains",return_value=None):
                self.assertEqual(board.mark_deployed("0123456"),[])  # gh 查不到：先不动
            self.assertIn("await_deploy",board.items()[0])
            with patch.object(board,"_deploy_contains",return_value=True) as q:
                self.assertEqual(board.mark_deployed("fedcba9876"),[80])
                q.assert_called_once_with("example/project","abc1234def","fedcba9876")
            it=board.items()[0]
            self.assertNotIn("await_deploy",it)
            self.assertEqual(it["deployed"]["commit"],"fedcba9876")
            self.assertTrue(it["returned_at"])
            self.assertEqual(it["reviewer"],"lead")
            self.assertTrue(it["status"].startswith("待上线验收"))
            with patch.object(board,"_deploy_contains",return_value=True):
                self.assertEqual(board.mark_deployed("fedcba9876"),[])  # 只转一次

    def test_new_generation_drops_the_old_deploy_state(self):
        """换代次（rebind/bind_pr）和退回、恢复都不再等上一代次的部署（#985 复审 2.1/2.2）。"""
        import board
        from unittest.mock import patch
        tmp=Path(tempfile.mkdtemp())
        with patch.object(board,"DIR",tmp),patch.dict(os.environ,{"CC_PROJECT":"lead"}):
            board._write([{"id":80,"chat":"room:main","dispatcher":"lead","bound":"g1","ws":"room:ws1",
                           "await_deploy":{"commit":"aaa1111","url":"u","merged_at":"m"},
                           "pr_binding":{"url":"u","repo":"example/project","number":990,"no_deploy":False,"bound":"g1"}}])
            board.rebind(80,"room:ws2")
            it=board.items()[0]
            self.assertNotIn("await_deploy",it)
            self.assertEqual(it["bound"] and it["ws"], "room:ws2")
            # 退回：重做后的构建不是原来已验收的那次部署
            it.update({"returned_at":"2026-11-04T08:00:00+00:00","deployed":{"commit":"fed","at":"t"}})
            board._write([it])
            board.reject(80,"缺入口验证")
            self.assertNotIn("deployed",board.items()[0])
            self.assertNotIn("await_deploy",board.items()[0])
            # 恢复：接着做，不是那次已验的部署
            it=board.items()[0] | {"await_deploy":{"commit":"bbb2222"}}
            board._write([it])
            board.resume(80)
            self.assertNotIn("await_deploy",board.items()[0])

    def test_bind_pr_to_another_pr_clears_deploy_state(self):
        import board
        from unittest.mock import patch
        tmp=Path(tempfile.mkdtemp())
        with patch.object(board,"DIR",tmp),patch.dict(os.environ,{"CC_PROJECT":"lead"}):
            board._write([{"id":80,"chat":"room:main","dispatcher":"lead","bound":"g1",
                           "await_deploy":{"commit":"aaa1111"}}])
            board.bind_pr(80,"https://github.com/example/project/pull/990",False)
            self.assertNotIn("await_deploy",board.items()[0])  # 第一次绑定就是新代次
            it=board.items()[0] | {"await_deploy":{"commit":"aaa1111"}}
            board._write([it])
            board.bind_pr(80,"https://github.com/example/project/pull/990",False)
            self.assertIn("await_deploy",board.items()[0])  # 同一个 PR 再写一次：代次没换，留着
            board.bind_pr(80,"https://github.com/example/project/pull/991",False)
            self.assertNotIn("await_deploy",board.items()[0])

    def test_mark_deployed_skips_paused_and_says_why(self):
        """暂停中的不静默写；关联不上的要说出来（#985 复审 2.3/2.4）。"""
        import board
        from unittest.mock import patch
        import io, contextlib
        tmp=Path(tempfile.mkdtemp())
        with patch.object(board,"DIR",tmp),patch.dict(os.environ,{"CC_PROJECT":"lead"}):
            board._write([
                {"id":80,"chat":"room:main","dispatcher":"lead","bound":"g1","paused":"11-04 18:00",
                 "pause_why":"验收退回：x","await_deploy":{"commit":"abc1234def"},
                 "pr_binding":{"url":"u","repo":"example/project","number":990,"no_deploy":False,"bound":"g1"}},
                {"id":81,"chat":"room:main","dispatcher":"lead","bound":"g1","await_deploy":{"commit":""}},
            ])
            err=io.StringIO()
            with patch.object(board,"_deploy_contains",return_value=True), contextlib.redirect_stderr(err):
                self.assertEqual(board.mark_deployed("fedcba98"),[])
            self.assertIn("80",err.getvalue())
            self.assertIn("暂停",err.getvalue())
            self.assertIn("81",err.getvalue())
            for it in board.items():
                self.assertIn("await_deploy",it)
                self.assertNotIn("deployed",it)

    def test_deploy_contains_reads_compare_status(self):
        import board
        from unittest.mock import patch
        from subprocess import CompletedProcess
        for status,want in [("ahead",True),("identical",True),("behind",False),("diverged",False)]:
            with patch.object(board.subprocess,"run",return_value=CompletedProcess([],0,status+"\n",'')) as run:
                self.assertEqual(board._deploy_contains("o/r","aaa1111","bbb2222"),want)
                self.assertIn("repos/o/r/compare/aaa1111...bbb2222",run.call_args[0][0])
        with patch.object(board.subprocess,"run",return_value=CompletedProcess([],1,"","boom")):
            self.assertIsNone(board._deploy_contains("o/r","a","b"))


class RelayGeneration(unittest.TestCase):
    def test_rejection_records_new_pause_identity_and_owner(self):
        import board
        from unittest.mock import patch
        tmp=Path(tempfile.mkdtemp())
        with patch.object(board,"DIR",tmp), patch.dict(os.environ,{"CC_PROJECT":"reviewer"}):
            board._write([{"id":72,"returned_at":"2026-11-02T00:00:00Z","paused_at":"old-pause","paused_by":"old-owner"}])
            board.reject(72,"missing evidence")
            item=board.items()[0]
            self.assertNotEqual(item["paused_at"],"old-pause")
            self.assertEqual(item["paused_by"],"reviewer")

    def test_late_relay_cannot_resume_paused_work(self):
        import board
        from unittest.mock import patch
        tmp = Path(tempfile.mkdtemp())
        with patch.object(board, "DIR", tmp):
            item = {"id":72, "chat":"room:main", "bound":"generation", "paused":"11-02 10:00"}
            board._write([item])
            self.assertFalse(board.returned(72, "lead", "2026-11-02T00:00:00Z", "generation", "late-receipt"))
            self.assertEqual(board.items(), [item])

    def test_trusted_return_is_atomic_and_rejected_receipt_does_not_reopen(self):
        import board
        from unittest.mock import patch
        tmp=Path(tempfile.mkdtemp())
        with patch.object(board,"DIR",tmp):
            board._write([{"id":72,"chat":"room:main","dispatcher":"lead","bound":"generation"}])
            self.assertTrue(board.returned(72,"lead","2026-11-02T00:00:00Z","generation","task:1:request"))
            board.reject(72,"must fix")
            self.assertTrue(board.returned(72,"lead","2026-11-02T00:00:00Z","generation","task:1:request"))
            self.assertNotIn("returned_at",board.items()[0])
            item=board.items()[0]; item["bound"]="next-generation"; board._write([item])
            self.assertFalse(board.returned(72,"lead","2026-11-02T00:00:00Z","generation","task:1:new-request"))
            self.assertEqual(item,board.items()[0])
            board._write([])
            self.assertFalse(board.returned(72,"lead","2026-11-02T00:00:00Z","generation","task:1:request"))

class MergeClosureCLI(unittest.TestCase):
    def test_real_cli_bind_merge_review_and_accept(self):
        tmp=Path(tempfile.mkdtemp())
        bin_dir=tmp/"bin"; bin_dir.mkdir()
        fake=bin_dir/"gh"
        fake.write_text('#!/bin/sh\nprintf \'%s\\n\' \'{"state":"MERGED","mergedAt":"2026-11-02T00:00:00Z"}\'\n')
        fake.chmod(0o700)
        env={"PATH":str(bin_dir)+os.pathsep+os.defpath,"HOME":str(tmp),"BOARD_DIR":str(tmp),"GATE_SETUP_DIR":str(tmp),"CC_BIN":"false","CC_PROJECT":"lead","CC_SESSION_KEY":"room:main"}
        path=tmp/"board.jsonl"
        path.write_text(json.dumps({"id":72,"chat":"room:main","dispatcher":"lead","bound":"generation"})+'\n')
        def cli(*args):
            p=subprocess.run([sys.executable,"-I",str(HERE/"board.py"),*args],env=env,capture_output=True,text=True,timeout=10)
            self.assertEqual(p.returncode,0,p.stdout+p.stderr)
        cli("pr","72","https://github.com/example/project/pull/830","no-deploy")
        cli("merged")
        self.assertIn("待收口",json.loads(path.read_text())["status"])
        cli("done","72","0")
        self.assertEqual(path.read_text(),"")
        self.assertTrue(json.loads((tmp/"board-done.jsonl").read_text())["review_accepted_at"])


class ReviewTier(unittest.TestCase):
    """User 2026-11-04「简单的交给便宜模型」: unmarked = simple, a reviewer escalates with board tier."""

    def test_tier_marks_item(self):
        with tempfile.TemporaryDirectory() as tmp:
            env = {**os.environ, "BOARD_DIR": tmp, "CC_BIN": "false", "CC_PROJECT": "dispatcher"}
            path = Path(tmp) / "board.jsonl"
            path.write_text(json.dumps({"id": 7, "what": "verify", "chat": "room:chat"}) + "\n")
            def cli(*args):
                return subprocess.run([sys.executable, "-I", str(HERE / "board.py"), *args], env=env, text=True, capture_output=True, timeout=10)
            self.assertEqual(cli("tier", "7", "complex").returncode, 0)
            self.assertEqual(json.loads(path.read_text())["review_tier"], "complex")
            self.assertEqual(cli("tier", "#7", "简单").returncode, 0)
            self.assertEqual(json.loads(path.read_text())["review_tier"], "simple")
            self.assertNotEqual(cli("tier", "8", "complex").returncode, 0)  # missing item
            self.assertNotEqual(cli("tier", "7", "hard").returncode, 0)  # unknown tier: usage


class AutoCloseSimple(unittest.TestCase):
    """用户 2026-11-04 23:2x「小活交回时，只要检查都过了就自动收口，大活才需要人看」。"""
    def _run(self, tier, rollup, no_deploy=True):
        import board
        from unittest.mock import patch
        from subprocess import CompletedProcess
        tmp = Path(tempfile.mkdtemp())
        pr = {"state": "MERGED", "mergedAt": "2026-11-04T15:00:00Z", "mergeCommit": {"oid": "abc"}, "statusCheckRollup": rollup}
        with patch.object(board, "DIR", tmp), patch.dict(os.environ, {"CC_PROJECT": "lead"}), \
                patch.object(board.subprocess, "run", return_value=CompletedProcess([], 0, json.dumps(pr), '')), \
                patch.object(board, "_park_done", lambda hit: None):
            it = {"id": 90, "what": "t", "chat": "room:main", "dispatcher": "lead", "bound": "g1"}
            if tier:
                it["review_tier"] = tier
            board._write([it])
            board.bind_pr(90, "https://github.com/example/project/pull/900", no_deploy)
            board.reconcile_merged_prs()
            done = (tmp / "board-done.jsonl")
            return board.items(), (done.read_text() if done.exists() else "")

    def test_simple_green_closes(self):
        items, done = self._run(None, [{"conclusion": "SUCCESS"}, {"conclusion": "SKIPPED"}])
        self.assertEqual(items, [])
        self.assertEqual(json.loads(done)["rework"], 0)

    def test_simple_red_or_pending_or_empty_waits(self):
        for rollup in ([{"conclusion": "FAILURE"}], [{"state": "PENDING"}], [], None):
            with self.subTest(rollup=rollup):
                items, done = self._run(None, rollup)
                self.assertEqual(len(items), 1)
                self.assertIn("待收口", items[0]["status"])
                self.assertEqual(done, "")

    def test_complex_green_waits_for_human(self):
        items, done = self._run("complex", [{"conclusion": "SUCCESS"}])
        self.assertEqual(len(items), 1)
        self.assertEqual(done, "")

    def test_deploy_binding_waits_for_the_release_even_when_simple_and_green(self):
        """要部署的活合并后先等发布，不因小活检查全绿就收口（部署后转待上线验收再自动收口）。"""
        items, done = self._run(None, [{"conclusion": "SUCCESS"}], no_deploy=False)
        self.assertEqual(done, "")
        self.assertEqual(len(items), 1)
        self.assertIn("等发布", items[0]["status"])
        self.assertEqual(items[0]["await_deploy"]["commit"], "abc")


if __name__ == "__main__":
    unittest.main(verbosity=2)
