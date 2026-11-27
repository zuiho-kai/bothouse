#!/usr/bin/env -S python3 -I
"""merge-gate（合并前真实入口验证，复盘 10-30 第 4 条）的测试。跑法：python3 -I test_merge_gate.py
不连网：fetch / gh_resolve / reverts 换成假的；登记写进临时目录；退回检查在临时 git 仓库里回放。"""
import importlib.machinery, importlib.util, os, subprocess, sys, tempfile, unittest

HERE = os.path.dirname(os.path.abspath(__file__))
loader = importlib.machinery.SourceFileLoader('merge_gate', os.path.join(HERE, 'merge-gate'))
mg = importlib.util.module_from_spec(importlib.util.spec_from_loader('merge_gate', loader))
loader.exec_module(mg)
REVERTS = mg.reverts

SHA = 'fbf006ef5a679e3687dc3b051e0f68445939fe5e'
PRS = {('gitcode', 'openJiuwen/jiuwenswarm', 9279): ('0.2.8', SHA, False),
       ('gitcode', 'openJiuwen/jiuwenswarm', 9300): ('develop', SHA, False),
       ('github', 'Kuddev/bothouse', 12): ('release/0.2', SHA, False)}


class Args:
    def __init__(self, **kw):
        self.__dict__.update(kw)


class MergeGate(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix='mergegate-test.')
        mg.EVID = os.path.join(self.tmp, 'evid')
        mg.fetch = lambda h, r, n: PRS[(h, r, n)]
        mg.gh_resolve = lambda repo, sel, cwd: ('github', 'Kuddev/bothouse', 12)
        mg.reverts = lambda repo, n, cwd=None: None
        self.shot = os.path.join(self.tmp, 'real-login.png')
        open(self.shot, 'wb').write(b'png')

    def guard(self, cmd):
        try:
            mg.cmd_guard(Args(cmd=cmd, cwd=None))
        except SystemExit as e:
            return e.code
        return 0

    def record(self, pr='gitcode:openJiuwen/jiuwenswarm!9279', commit=None, login='华为真账号登录', proof=None):
        mg.cmd_record(Args(pr=pr, commit=commit, login=login, entry='桌面版', proof=proof or [self.shot]))

    def test_9279_merge_blocked_without_evidence(self):
        # 原事故：!9279 只有假登录态对比，就要进 0.2.8
        url = 'https://api.gitcode.com/api/v5/repos/openJiuwen/jiuwenswarm/pulls/9279/merge'
        self.assertEqual(self.guard(f'curl -X PUT -H "PRIVATE-TOKEN: $T" {url}'), 1)
        self.record()
        self.assertEqual(self.guard(f'curl -X PUT {url}'), 0)

    def test_new_commit_needs_new_evidence(self):
        self.record(commit='a36fbfa42')  # 旧提交验过
        self.assertIsNotNone(mg.check('gitcode', 'openJiuwen/jiuwenswarm', 9279))
        self.record(commit=SHA[:9])
        self.assertIsNone(mg.check('gitcode', 'openJiuwen/jiuwenswarm', 9279))

    def test_fake_login_and_missing_proof_refused(self):
        with self.assertRaises(SystemExit):
            self.record(login='假登录态对比')
        with self.assertRaises(SystemExit):
            self.record(proof=[os.path.join(self.tmp, 'nope.png')])
        self.record()
        os.remove(self.shot)  # 截图被删了，登记不再算
        self.assertIsNotNone(mg.check('gitcode', 'openJiuwen/jiuwenswarm', 9279))

    def test_non_release_branch_not_checked(self):
        self.assertEqual(self.guard('curl -X PUT https://api.gitcode.com/api/v5/repos/openJiuwen/jiuwenswarm/pulls/9300/merge'), 0)

    def test_create_release_pr_must_be_draft(self):
        u = 'https://api.gitcode.com/api/v5/repos/openJiuwen/jiuwenswarm/pulls'
        self.assertEqual(self.guard(f"""curl -X POST {u} -d '{{"base": "0.2.8", "head": "zuiho:fix"}}'"""), 1)
        self.assertEqual(self.guard(f"""curl -X POST {u} -d '{{"base": "0.2.8", "draft": true}}'"""), 0)
        self.assertEqual(self.guard(f"""curl -X POST {u} -d '{{"base": "develop"}}'"""), 0)
        # 转非草稿要验证
        self.assertEqual(self.guard(f"""curl -X PATCH {u}/9279 -d '{{"draft": false}}'"""), 1)

    def test_approve_comment_checked(self):
        u = 'https://api.gitcode.com/api/v5/repos/openJiuwen/jiuwenswarm/pulls/9279/comments'
        self.assertEqual(self.guard(f"""curl -X POST {u} -d '{{"body": "/lgtm"}}'"""), 1)
        self.assertEqual(self.guard(f"""curl -X POST {u} -d '{{"body": "截图已补"}}'"""), 0)

    def test_unknown_number_blocked(self):
        self.assertEqual(self.guard('curl -X PUT "https://api.gitcode.com/api/v5/repos/openJiuwen/jiuwenswarm/pulls/$N/merge"'), 1)

    def test_gh_pr_merge(self):
        self.assertEqual(mg.gh_merges('cd x && gh pr merge 12 --squash -R Kuddev/bothouse', None), [('Kuddev/bothouse', '12')])
        self.assertEqual(self.guard('gh pr merge 12 --squash'), 1)
        self.record(pr='github:Kuddev/bothouse#12')
        self.assertEqual(self.guard('gh pr merge 12 --squash'), 0)

    def test_release_pattern(self):
        for b in ('0.2.8', 'v1.2', 'release/0.3'):
            self.assertTrue(mg.RELEASE.match(b), b)
        for b in ('develop', 'main', 'fix/0.2.8-x'):
            self.assertFalse(mg.RELEASE.match(b), b)


class Reverts(unittest.TestCase):
    """#2206 的事故：分支 reset --soft 到已含 #2205 的 develop 再提交，旧工作区把 #2205 原样删了。"""

    def git(self, *a):
        return subprocess.run(['git', '-C', self.d, *a], capture_output=True, text=True, check=True).stdout.strip()

    def write(self, name, text):
        with open(os.path.join(self.d, name), 'w') as f:
            f.write(text)

    def commit(self, msg):
        self.git('add', '-A')
        self.git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', msg)
        return self.git('rev-parse', 'HEAD')

    def setUp(self):
        self.d = tempfile.mkdtemp(prefix='mergegate-git.')
        self.git('init', '-q', '-b', 'develop')
        self.write('handoff.py', ''.join(f'line {i}\n' for i in range(40)))
        self.write('other.py', 'a\nb\nc\n')
        self.commit('base')
        self.old = self.git('rev-parse', 'HEAD')
        # 别人刚合的 #2205：handoff.py 中间加一段、改一行，新加测试文件
        lines = [f'line {i}\n' for i in range(40)]
        lines[20] = 'line 20 changed\n'
        lines[10:10] = ['def follow_chat():\n', '    return chat\n']
        self.write('handoff.py', ''.join(lines))
        self.write('test_follow.py', 'assert follow_chat()\n')
        self.fix = self.commit('ws-handoff: keep the channel (#2205)')

    def branch_from_old(self, name):
        self.git('checkout', '-q', '-b', name, self.old)
        self.write('handoff.py', open(os.path.join(self.d, 'handoff.py')).read() + 'keep_running = True\n')
        self.write('board.py', 'keep\n')

    def test_reset_soft_onto_new_base_is_caught(self):
        self.branch_from_old('autowake')
        self.git('reset', '--soft', 'develop')  # 旧工作区原样提交到新底上
        head = self.commit('wake the lead (#2206)')
        self.assertEqual([c for c, _ in mg.reverted(self.d, 'develop', head)], [self.fix])

    def test_branch_behind_base_is_fine(self):
        # 正常落后：分支没碰 #2205 改的地方，GitHub 三方合并保留它
        self.git('checkout', '-q', '-b', 'behind', self.old)
        self.write('board.py', 'keep\n')
        self.write('other.py', 'a\nb\nc\nd\n')
        head = self.commit('board only')
        self.assertEqual(mg.reverted(self.d, 'develop', head), [])

    def test_edit_on_top_is_fine(self):
        # 在 #2205 之上正常改同一个文件（改它加的那行）不算退回
        self.git('checkout', '-q', '-b', 'ontop', 'develop')
        self.write('handoff.py', open(os.path.join(self.d, 'handoff.py')).read().replace('return chat', 'return chat or ""'))
        head = self.commit('tweak')
        self.assertEqual(mg.reverted(self.d, 'develop', head), [])

    def test_waived_by_pr_text(self):
        self.assertTrue(mg.waived(self.fix, 'ws-handoff: keep the channel (#2205)', 'Reverts #2205: broke X'))
        self.assertTrue(mg.waived(self.fix, 'x', f'This reverts {self.fix[:7]}.'))
        self.assertFalse(mg.waived(self.fix, 'ws-handoff: keep the channel (#2205)', 'Closes #2203'))
        self.assertFalse(mg.waived(self.fix, 'ws-handoff: keep the channel (#2205)', 'Reverts #22050'))

    def test_guard_blocks_gh_merge_when_reverting(self):
        mg.gh_resolve = lambda repo, sel, cwd: ('github', 'Kuddev/bothouse', 2206)
        mg.fetch = lambda h, r, n: ('develop', 'f' * 40, False)
        mg.reverts = lambda repo, n, cwd=None: '会把已合的提交退回去'
        try:
            with self.assertRaises(SystemExit) as e:
                mg.cmd_guard(Args(cmd='gh pr merge 2206 --squash -R Kuddev/bothouse', cwd=None))
            self.assertEqual(e.exception.code, 1)
        finally:
            mg.reverts = REVERTS


if __name__ == '__main__':
    unittest.main()
