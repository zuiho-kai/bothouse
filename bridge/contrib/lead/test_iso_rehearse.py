#!/usr/bin/env -S python3 -I
"""iso-check（按会话登记的测试隔离）和 rehearse-copy（脱敏配置副本、--restore 回滚）的测试。
跑法：ISO_DIR=<iso-check before 打出的目录> python3 -I test_iso_rehearse.py（ISO_DIR 可省）。
只碰本测试自己建的 /tmp/iso.* 目录和临时目录；HOME 指向临时目录，不读写真实配置。"""
import json, os, shutil, subprocess, tempfile, time, unittest

HERE = os.path.dirname(os.path.abspath(__file__))
ISO = os.path.join(HERE, 'iso-check')
BIN = HERE
BASE = os.environ.get('ISO_DIR') or None
CLEAR = ('CC_SESSION_KEY', 'CC_SESSION', 'CLAUDE_CODE_SESSION_ID', 'BOTHOUSE_DATA_DIR', 'CONEST_COLLAB_DATA')


def run(args, home):
    # rehearse-copy 缺省目录会调 iso-check before；记录放进测试自己的目录，不写真实 /tmp/iso-check.d
    env = {k: v for k, v in os.environ.items() if k not in CLEAR}
    env.update(HOME=home, ISO_CHECK_STATE=os.path.join(home, '.iso-state'), CC_SESSION_KEY='test:rehearse')
    return subprocess.run(args, env=env, capture_output=True, text=True, timeout=30)


class IsoCheck(unittest.TestCase):
    def setUp(self):
        self.state = tempfile.mkdtemp(prefix='isocheck-test-state.', dir=BASE)
        # 假 HOME + 假 PATH：快照只看这里，不受机器上真实桥、数据目录影响
        self.home = tempfile.mkdtemp(prefix='isocheck-home.', dir=BASE)
        self.bindir = os.path.join(self.home, 'bin')
        os.makedirs(self.bindir)
        self.mine = []  # 本测试建的 /tmp/iso.* 目录，收尾只删这些

    def tearDown(self):
        for d in self.mine:
            if d.startswith('/tmp/iso.') and os.path.isdir(d):
                shutil.rmtree(d)
        shutil.rmtree(self.state)
        shutil.rmtree(self.home)

    def run_iso(self, *args, owner=None, var='CC_SESSION_KEY', extra=None):
        env = {k: v for k, v in os.environ.items() if k not in CLEAR + ('CC_BIN', 'ISO_CHECK_PORTS')}
        env.update(ISO_CHECK_STATE=self.state, HOME=self.home, PATH=f'{self.bindir}:/usr/bin:/bin:/usr/sbin:/sbin',
                   ISO_CHECK_PORTS='1', ISO_PORT_SLOT='0')  # 不让测试去查线上桥的工作区列表
        if owner:
            env[var] = owner
        env.update(extra or {})
        return subprocess.run([ISO, *args], env=env, capture_output=True, text=True, timeout=30)

    def before(self, owner, **kw):
        r = self.run_iso('before', owner=owner, **kw)
        self.assertEqual(r.returncode, 0, r.stderr)
        d = [l.split('=', 1)[1].split('（')[0] for l in r.stdout.splitlines() if l.startswith('ISO_DIR=')][0]
        self.mine.append(d)
        self.assertTrue(d.startswith('/tmp/iso.') and os.path.isdir(d))
        return d

    def ports(self, d):
        env = {}
        for line in open(os.path.join(d, 'ports.env')):
            if line.startswith('export '):
                for kv in line.split()[1:]:
                    k, v = kv.split('=', 1)
                    env[k] = int(v)
        return env

    def test_ports_by_workspace_no_overlap(self):
        # 10-30 两个工作区的 jiuwen 测试实例都用 5173/19000 撞车：不同工作区号拿到不重叠的端口段
        p2 = self.ports(self.before('discord:W2', extra={'ISO_PORT_SLOT': '2'}))
        p3 = self.ports(self.before('discord:W3', extra={'ISO_PORT_SLOT': '3'}))
        self.assertEqual(p2['ISO_PORT_BASE'], 42200)
        self.assertEqual(p3['FRONTEND_PORT'], 42300)
        keys = [k for k in p2 if k.endswith('_PORT')]
        for k in ('FRONTEND_PORT', 'WEB_PORT', 'GATEWAY_PORT', 'AGENT_SERVER_PORT', 'JIUWENSWARM_WEB_PORT',
                  'JIUWENSWARM_AGENT_HTTP_PORT', 'BROWSER_RUNTIME_MCP_PORT'):
            self.assertIn(k, keys)
        for p in (p2, p3):
            self.assertEqual(p['WEB_PORT'], p['JIUWENSWARM_WEB_PORT'])
            for k in keys:
                self.assertTrue(p['ISO_PORT_BASE'] <= p[k] <= p['ISO_PORT_BASE'] + 99, k)
        self.assertFalse({p2[k] for k in keys} & {p3[k] for k in keys})

    def test_ports_slot_out_of_range_refused(self):
        before = set(os.listdir('/tmp'))
        r = self.run_iso('before', owner='discord:W', extra={'ISO_PORT_SLOT': '72'})
        self.assertEqual(r.returncode, 2)
        self.assertIn('超出端口段', r.stderr)
        self.assertFalse({x for x in set(os.listdir('/tmp')) - before if x.startswith('iso.')})

    def test_cross_session_cannot_delete(self):
        a, b = self.before('discord:A'), self.before('discord:B')
        r = self.run_iso('after', b, owner='discord:A')
        self.assertEqual(r.returncode, 2)
        self.assertIn('不是本会话', r.stderr)
        self.assertTrue(os.path.isdir(b))
        r = self.run_iso('after', b, owner='discord:B')  # B 自己能删，判定照旧
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertIn('干净', r.stdout)
        self.assertFalse(os.path.exists(b))
        self.assertTrue(os.path.isdir(a))

    def test_after_requires_dir(self):
        a = self.before('discord:A')
        r = self.run_iso('after', owner='discord:A')
        self.assertEqual(r.returncode, 2)
        self.assertIn('必须给目录', r.stderr)
        self.assertTrue(os.path.isdir(a))

    def test_own_dir_clean_and_deleted(self):
        a = self.before('discord:A')
        with open(os.path.join(a, 'x'), 'w') as f:
            f.write('1')
        os.chmod(a, 0o500)  # 只读也要能删
        r = self.run_iso('after', a + '/', owner='discord:A')
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertIn('已删隔离目录', r.stdout)
        self.assertIn('干净', r.stdout)
        self.assertFalse(os.path.exists(a))
        self.assertEqual(self.run_iso('after', a, owner='discord:A').returncode, 2)  # 记录也清掉了

    def test_live_data_dir_change_detected(self):
        a = self.before('discord:A')
        os.makedirs(os.path.join(self.home, '.bothouse', 'run'))
        open(os.path.join(self.home, '.bothouse', 'run', 'api.sock'), 'w').close()
        r = self.run_iso('after', a, owner='discord:A')
        self.assertEqual(r.returncode, 1, r.stdout)
        self.assertIn('api.sock', r.stdout)
        self.assertFalse(os.path.exists(a))

    def test_bridge_binary_replaced_or_renamed(self):
        # 测试里 bothouse update 连到线上桥时，线上桥会自升级换掉程序文件
        p = os.path.join(self.bindir, 'bothouse')
        with open(p, 'w') as f:
            f.write('old-binary')
        os.chmod(p, 0o755)
        a = self.before('discord:A')
        with open(p, 'w') as f:
            f.write('release-binary')
        r = self.run_iso('after', a, owner='discord:A')
        self.assertEqual(r.returncode, 1, r.stdout + r.stderr)
        self.assertIn('binfp:', r.stdout)
        a = self.before('discord:A')
        shutil.copy2(p, p + '.old')
        r = self.run_iso('after', a, owner='discord:A')
        self.assertEqual(r.returncode, 1, r.stdout + r.stderr)
        self.assertIn('bothouse.old', r.stdout)
        a = self.before('discord:A')
        self.assertEqual(self.run_iso('after', a, owner='discord:A').returncode, 0)

    def test_unregistered_dir_refused(self):
        d = tempfile.mkdtemp(prefix='iso.', dir='/tmp')
        self.mine.append(d)
        r = self.run_iso('after', d, owner='discord:A')
        self.assertEqual(r.returncode, 2)
        self.assertTrue(os.path.isdir(d))

    def test_no_register_subcommand(self):
        # 没有 register：别的会话不能把已有目录（包括别人的）登记成自己的再删
        d = tempfile.mkdtemp(prefix='iso.', dir='/tmp')
        self.mine.append(d)
        self.assertEqual(self.run_iso('register', d, owner='discord:A').returncode, 2)
        self.assertEqual(self.run_iso('after', d, owner='discord:A').returncode, 2)
        self.assertTrue(os.path.isdir(d))
        b = self.before('discord:B')
        self.assertEqual(self.run_iso('register', b, owner='discord:A').returncode, 2)
        self.assertEqual(self.run_iso('after', b, owner='discord:A').returncode, 2)
        self.assertTrue(os.path.isdir(b))

    def test_cc_session_fallback(self):
        # DSH 会删名字含 KEY 的变量，只剩 CC_SESSION：也要认得出会话
        d = self.before('dsh:A', var='CC_SESSION')
        self.assertEqual(self.run_iso('after', d, owner='dsh:B', var='CC_SESSION').returncode, 2)
        self.assertEqual(self.run_iso('after', d, owner='dsh:A', var='CC_SESSION').returncode, 0)

    def test_no_owner_refused(self):
        r = self.run_iso('before')
        self.assertEqual(r.returncode, 2)
        self.assertIn('--owner', r.stderr)
        r = self.run_iso('before', '--owner', 'manual')  # --owner 显式给也行
        self.assertEqual(r.returncode, 0, r.stderr)
        d = [l.split('=', 1)[1].split('（')[0] for l in r.stdout.splitlines() if l.startswith('ISO_DIR=')][0]
        self.mine.append(d)
        self.assertEqual(self.run_iso('after', d, '--owner', 'manual').returncode, 0)
        # --owner 缺值要报错退出，不能死循环
        self.assertEqual(self.run_iso('after', '/tmp/iso.x', '--owner', owner='discord:A').returncode, 2)


class RehearseCopy(unittest.TestCase):
    def setUp(self):
        self.home = os.path.realpath(tempfile.mkdtemp(prefix='rchome.', dir=BASE))
        d = os.path.join(self.home, '.bothouse')
        os.makedirs(d)
        self.cfg = os.path.join(d, 'config.toml')
        with open(self.cfg, 'w') as f:
            f.write('[[projects.platforms]]\n  type = "discord"\n  token = "REALTOKEN123"\n  api_key="sk-abc"\n'
                    '  allow_from = "user"\n  max_tokens = 4096\n  work_dir = "%s/work"\n' % self.home)
        os.chmod(self.cfg, 0o600)
        p = os.path.join(self.home, '.dsh', 'profiles', 'web')
        os.makedirs(p)
        with open(os.path.join(p, 'dsh-web.json'), 'w') as f:
            json.dump({'url': 'http://127.0.0.1:1/?token=SECRETTOK#c', 'client_secret': 'zz', 'pid': 1}, f)
        with open(os.path.join(p, 'cordis.yml'), 'w') as f:
            f.write('plugins:\n  bot:\n    password: hunter2\n    name: x\n')
        self.out = tempfile.mkdtemp(prefix='rcout.', dir=BASE)

    def tearDown(self):
        shutil.rmtree(self.home)
        shutil.rmtree(self.out)

    def test_file_copy_redact(self):
        r = run([os.path.join(BIN, 'rehearse-copy'), self.cfg, self.out], self.home)
        self.assertEqual(r.returncode, 0, r.stderr)
        dst = os.path.join(self.out, 'home', '.bothouse', 'config.toml')
        self.assertIn(f'HOME={self.out}/home', r.stdout)
        self.assertIn(f'CONFIG={dst}', r.stdout)
        s = open(dst).read()
        self.assertNotIn('REALTOKEN123', s)
        self.assertNotIn('sk-abc', s)
        self.assertIn('token = "REDACTED"', s)
        self.assertIn('allow_from = "user"', s)  # 权限字段原样
        self.assertIn('max_tokens = 4096', s)  # 数值不当密钥
        self.assertEqual(os.stat(dst).st_mode & 0o777, 0o600)  # cp -a 保留权限
        self.assertIn('REALTOKEN123', open(self.cfg).read())  # 原件不动
        self.assertIn('仍指向真实', r.stdout)  # work_dir 指回真实 HOME 要提醒

    def test_dir_copy_redact(self):
        src = os.path.join(self.home, '.dsh', 'profiles', 'web')
        r = run([os.path.join(BIN, 'rehearse-copy'), src, self.out], self.home)
        self.assertEqual(r.returncode, 0, r.stderr)
        dst = os.path.join(self.out, 'home', '.dsh', 'profiles', 'web')
        j = open(os.path.join(dst, 'dsh-web.json')).read()
        self.assertNotIn('SECRETTOK', j)
        self.assertNotIn('"zz"', j)
        y = open(os.path.join(dst, 'cordis.yml')).read()
        self.assertNotIn('hunter2', y)
        self.assertIn('name: x', y)

    def test_extra_leaks(self):
        # 代码审查指出的四类：非常见扩展名（备份）、export 前缀、行内表、KEY_ID
        d = os.path.join(self.home, 'cfgdir')
        os.makedirs(d)
        open(os.path.join(d, 'config.toml.bak-20261025'), 'w').write('token = "BAKTOK111"\n')
        open(os.path.join(d, 'env.sh'), 'w').write('export DISCORD_BOT_TOKEN=EXPTOK222\nexport PATH=/usr/bin\n')
        open(os.path.join(d, 'inline.toml'), 'w').write('creds = { name = "n", token = "INLTOK333", api_key = INLKEY444 }\n')
        open(os.path.join(d, 'alpaca.env'), 'w').write('ALPACA_KEY_ID=PKFAKE555\nALPACA_SECRET_KEY=SKFAKE666\n')
        open(os.path.join(d, 'blob.bin'), 'wb').write(b'\x00\x01token=BINTOK777')
        r = run([os.path.join(BIN, 'rehearse-copy'), d, self.out], self.home)
        self.assertEqual(r.returncode, 0, r.stderr)
        dst = os.path.join(self.out, 'home', 'cfgdir')
        allt = ''.join(open(os.path.join(dst, f)).read() for f in
                       ('config.toml.bak-20261025', 'env.sh', 'inline.toml', 'alpaca.env'))
        for leak in ('BAKTOK111', 'EXPTOK222', 'INLTOK333', 'INLKEY444', 'PKFAKE555', 'SKFAKE666'):
            self.assertNotIn(leak, allt)
        self.assertIn('export PATH=/usr/bin', allt)
        self.assertIn('name = "n"', allt)
        self.assertIn('api_key = REDACTED }', allt)
        self.assertEqual(open(os.path.join(dst, 'blob.bin'), 'rb').read(), b'\x00\x01token=BINTOK777')  # 二进制不动

    def test_platform_credential_keys(self):
        # bridge/platform/*/ 读 opts 的真实凭据键名，逐个造值，副本里一个都不能留
        keys = ('token', 'bot_token', 'app_token', 'access_token', 'callback_token', 'channel_token', 'app_secret',
                'bot_secret', 'client_secret', 'corp_secret', 'channel_secret', 'webhook_secret', 'proxy_password',
                'cross_signing_password', 'encrypt_key', 'callback_aes_key', 'wps_sid', 'webhook_url')
        body = '[[projects.platforms]]\n  type = "x"\n'
        body += ''.join(f'  {k} = "LEAK{i:02d}x"\n' for i, k in enumerate(keys))
        body += '[q]\n  "bot_token" = "QUOTEDLEAK1"\n  \'app_secret\' = \'QUOTEDLEAK2\'\n'
        body += '  proxy = "http://puser:PROXYPASS@10.0.0.1:8080"\n'
        body += '  webhook_url = "https://open.feishu.cn/hook/HOOKLEAK"\n'
        body += '  token2 = """MULTI\nLINELEAK\n"""\n  after_multi = "kept"\n'
        body += "  secret3 = '''LITLEAK'''\n  allow_from = \"u1\"\n"
        f = os.path.join(self.home, '.bothouse', 'plat.toml')
        open(f, 'w').write(body)
        r = run([os.path.join(BIN, 'rehearse-copy'), f, self.out], self.home)
        self.assertEqual(r.returncode, 0, r.stderr)
        s = open(os.path.join(self.out, 'home', '.bothouse', 'plat.toml')).read()
        for leak in ['LEAK%02dx' % i for i in range(len(keys))] + ['QUOTEDLEAK1', 'QUOTEDLEAK2', 'PROXYPASS', 'puser',
                                                                  'HOOKLEAK', 'MULTI', 'LINELEAK', 'LITLEAK']:
            self.assertNotIn(leak, s)
        self.assertIn('proxy = "http://REDACTED:REDACTED@10.0.0.1:8080"', s)
        self.assertIn('token2 = """REDACTED"""\n  after_multi = "kept"', s)  # 多行串整体换掉，后面的行不被写坏
        self.assertIn("secret3 = '''REDACTED'''", s)
        self.assertIn('"bot_token" = "REDACTED"', s)
        self.assertIn('allow_from = "u1"', s)
        try:
            import tomllib
        except ImportError:  # Python < 3.11 没有 tomllib，跳过语法检查
            return
        tomllib.loads(s)  # 脱敏后仍是合法 TOML

    def test_keep_secrets(self):
        r = run([os.path.join(BIN, 'rehearse-copy'), self.cfg, self.out, '--keep-secrets'], self.home)
        self.assertEqual(r.returncode, 0, r.stderr)
        s = open(os.path.join(self.out, 'home', '.bothouse', 'config.toml')).read()
        self.assertIn('REALTOKEN123', s)

    def test_default_dir_and_missing(self):
        r = run([os.path.join(BIN, 'rehearse-copy'), self.cfg], self.home)
        self.assertEqual(r.returncode, 0, r.stderr)
        d = [l.split('=', 1)[1] for l in r.stdout.splitlines() if l.startswith('REHEARSE_DIR=')][0]
        try:
            self.assertTrue(d.startswith('/tmp/iso.'))
            self.assertIn(f'iso-check after {d}', r.stdout)
            self.assertNotIn('path:', r.stdout)  # iso-check 的快照不混进输出
            a = run([ISO, 'after', d], self.home)  # 同一会话键登记过，能删
            self.assertEqual(a.returncode, 0, a.stdout + a.stderr)
            self.assertFalse(os.path.exists(d))
        finally:
            if d.startswith('/tmp/iso.') and os.path.isdir(d):
                shutil.rmtree(d)
        r = run([os.path.join(BIN, 'rehearse-copy'), self.home + '/nope'], self.home)
        self.assertEqual(r.returncode, 1)

    def test_default_dir_aborts_without_session(self):
        env = {k: v for k, v in os.environ.items() if k not in CLEAR}
        env.update(HOME=self.home, ISO_CHECK_STATE=os.path.join(self.home, '.iso-state'))
        r = subprocess.run([os.path.join(BIN, 'rehearse-copy'), self.cfg], env=env, capture_output=True, text=True, timeout=30)
        self.assertEqual(r.returncode, 1, r.stdout)
        self.assertIn('中止', r.stderr)
        self.assertNotIn('REHEARSE_DIR=', r.stdout)

    def test_outside_home(self):
        other = tempfile.mkdtemp(prefix='rcother.', dir=BASE)
        self.addCleanup(shutil.rmtree, other)
        f = os.path.join(other, 'cc.toml')
        open(f, 'w').write('token = "t"\n')
        r = run([os.path.join(BIN, 'rehearse-copy'), f, self.out], self.home)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertNotIn('HOME=', r.stdout)
        self.assertIn('token = "REDACTED"', open(os.path.join(self.out, 'cc.toml')).read())


class Restore(unittest.TestCase):
    """--restore：装回设置向导留的 config.toml.bak-<时间>（bridge/config/wizard.go backupPath 同名规则）。"""
    def setUp(self):
        self.home = os.path.realpath(tempfile.mkdtemp(prefix='rshome.', dir=BASE))
        self.dir = os.path.join(self.home, '.bothouse')
        os.makedirs(self.dir)
        self.cfg = os.path.join(self.dir, 'config.toml')
        for name, body in (('config.toml.bak-20261020-121500', 'v = 1\n'), ('config.toml.bak-20261024-090000', 'v = 2\n'),
                           ('config.toml.bak-20261024-090000-2', 'v = 3\n'), ('config.toml.bak-junk', 'v = 9\n')):
            open(os.path.join(self.dir, name), 'w').write(body)
        open(self.cfg, 'w').write('v = 4\n')

    def tearDown(self):
        shutil.rmtree(self.home)

    def rc(self, *a):
        return run([os.path.join(BIN, 'rehearse-copy'), '--restore', *a], self.home)

    def test_dry_run_picks_newest_and_writes_nothing(self):
        before = sorted(os.listdir(self.dir))
        r = self.rc(self.cfg, '--dry-run')
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn('config.toml.bak-20261024-090000-2', r.stdout)
        self.assertEqual(sorted(os.listdir(self.dir)), before)
        self.assertEqual(open(self.cfg).read(), 'v = 4\n')

    def test_restore_newest_and_undo(self):
        r = self.rc(self.cfg)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(open(self.cfg).read(), 'v = 3\n')
        keep = [l.split('：', 1)[1].split('（')[0] for l in r.stdout.splitlines() if l.startswith('回滚前的文件留在')][0]
        self.assertEqual(open(keep).read(), 'v = 4\n')  # 回滚前的文件留了底
        r = self.rc(self.cfg, keep)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(open(self.cfg).read(), 'v = 4\n')

    def test_restore_twice_steps_back(self):
        # 连跑两次：第二次不能把第一次换下的当前文件（v = 4）装回去，要退到更早一份
        r = self.rc(self.cfg)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(open(self.cfg).read(), 'v = 3\n')
        r = self.rc(self.cfg)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(open(self.cfg).read(), 'v = 2\n')
        pre = sorted(f for f in os.listdir(self.dir) if '.pre-restore-' in f)
        self.assertEqual(len(pre), 2)
        self.assertFalse(any('.bak-' in f and f not in ('config.toml.bak-20261020-121500', 'config.toml.bak-20261024-090000',
                             'config.toml.bak-20261024-090000-2', 'config.toml.bak-junk') for f in os.listdir(self.dir)))

    def test_restore_named_and_rejects_foreign(self):
        r = self.rc(self.cfg, os.path.join(self.dir, 'config.toml.bak-20261020-121500'))
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(open(self.cfg).read(), 'v = 1\n')
        other = os.path.join(self.home, 'evil.toml')
        open(other, 'w').write('x')
        self.assertEqual(self.rc(self.cfg, other).returncode, 1)
        self.assertEqual(self.rc(self.cfg, os.path.join(self.dir, 'config.toml.bak-junk')).returncode, 1)

    def test_no_backup(self):
        for f in os.listdir(self.dir):
            if '.bak-' in f:
                os.remove(os.path.join(self.dir, f))
        r = self.rc(self.cfg)
        self.assertEqual(r.returncode, 1)
        self.assertIn('无可回滚', r.stderr)
        self.assertEqual(open(self.cfg).read(), 'v = 4\n')


if __name__ == '__main__':
    unittest.main()
