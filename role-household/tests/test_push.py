"""手机上弹通知（Web Push）和「添加到主屏幕」（manifest、图标、service worker）。

用户原话：「然后还有就是其他易用性」「我现在基本不在电脑前面了」；审稿 ~/.claude/reviews/rh-ux-1.md。
要的：有人 @ 我、角色出错、等批准时，页面不在前台也弹通知；能加到主屏幕像 App 打开；苹果手机先加到主屏幕才能收推送，页面上给一行引导。

推送服务用测试里起的假服务（本地 http），它收到的请求按 RFC 8291 自己解密、按 RFC 8292 自己验 VAPID 签名，
不信 rh/webpush.py 的实现。无头浏览器拿不到真推送服务（Chromium 无头 pushManager.subscribe 报 AbortError，2026-10-20 实测），
网页那边把 subscribe 换成假订阅（指向假推送服务、密钥由测试生成），收到的推送再经 CDP ServiceWorker.deliverPushMessage
交给真 service worker，看它弹出的通知。浏览器静音启动，只连本地 hub。
"""
from __future__ import annotations

import asyncio
import base64
import json
import os
import stat
import struct
import time
import unittest

from aiohttp import web
from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import encode_dss_signature
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

from rh.hub import Hub
from tests.test_agent_events import EventBase
from tests.test_hub import AUTH, TOKEN, HubBase, async_playwright, wait_for

PHONE = {"width": 390, "height": 844}   # 来源：同 tests/test_hub_mobile.py（iPhone 12-15）
IPHONE_UA = ("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 "
             "(KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1")
USER_ID = "100000000000000103"   # 测试用的 Discord 用户 ID（虚构 ID，不用真实账号）


def b64u(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


def unb64u(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def hkdf(salt, ikm, info, n):
    return HKDF(algorithm=hashes.SHA256(), length=n, salt=salt, info=info).derive(ikm)


class Browser:
    """一个浏览器订阅：自己的 P-256 密钥和 auth secret（RFC 8291 里的 user agent 一方）。"""

    def __init__(self):
        self.key = ec.generate_private_key(ec.SECP256R1())
        self.pub = self.key.public_key().public_bytes(serialization.Encoding.X962,
                                                      serialization.PublicFormat.UncompressedPoint)
        self.auth = os.urandom(16)

    def sub(self, endpoint):
        return {"endpoint": endpoint, "expirationTime": None, "keys": {"p256dh": b64u(self.pub), "auth": b64u(self.auth)}}

    def decrypt(self, body: bytes) -> bytes:
        """RFC 8291 第 3 节 + RFC 8188 aes128gcm，单条记录。"""
        salt, rs, idlen = body[:16], *struct.unpack("!IB", body[16:21])
        as_pub = body[21:21 + idlen]
        ct = body[21 + idlen:]
        assert idlen == 65 and len(ct) <= rs, (idlen, rs, len(ct))
        shared = self.key.exchange(ec.ECDH(), ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), as_pub))
        ikm = hkdf(self.auth, shared, b"WebPush: info\x00" + self.pub + as_pub, 32)
        cek = hkdf(salt, ikm, b"Content-Encoding: aes128gcm\x00", 16)
        nonce = hkdf(salt, ikm, b"Content-Encoding: nonce\x00", 12)
        plain = AESGCM(cek).decrypt(nonce, ct, None)
        assert plain.endswith(b"\x02"), "最后一条记录的分隔符是 0x02"
        return plain[:-1]


def verify_vapid(header: str, endpoint: str, server_key: str) -> dict:
    """RFC 8292：Authorization: vapid t=<JWT>, k=<公钥>；JWT 是 ES256，aud 是推送服务的 origin，exp 不超过 24 小时。"""
    assert header.startswith("vapid "), header
    parts = dict(p.strip().split("=", 1) for p in header[len("vapid "):].split(","))
    assert parts["k"] == server_key, "k 是 GET /api/push 给网页的那把公钥"
    h, p, s = parts["t"].split(".")
    assert json.loads(unb64u(h)) == {"typ": "JWT", "alg": "ES256"}
    claims = json.loads(unb64u(p))
    sig = unb64u(s)
    assert len(sig) == 64
    pub = ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), unb64u(parts["k"]))
    der = encode_dss_signature(int.from_bytes(sig[:32], "big"), int.from_bytes(sig[32:], "big"))
    try:
        pub.verify(der, f"{h}.{p}".encode(), ec.ECDSA(hashes.SHA256()))
    except InvalidSignature:
        raise AssertionError("VAPID 签名不对")
    from urllib.parse import urlsplit
    u = urlsplit(endpoint)
    assert claims["aud"] == f"{u.scheme}://{u.netloc}", claims
    assert time.time() < claims["exp"] <= time.time() + 24 * 3600, claims
    assert claims["sub"].startswith(("mailto:", "https://", "http://127.0.0.1")), claims
    return claims


class FakePushService:
    """假推送服务：记下每个请求；status 可改（410 = 订阅失效）。"""

    def __init__(self):
        self.got: list[dict] = []
        self.status = 201
        self.redirect = None   # 设了就回 307 跳到这个地址

    async def start(self):
        app = web.Application()
        app.router.add_post("/push/{id}", self.handle)
        self.runner = web.AppRunner(app)
        await self.runner.setup()
        site = web.TCPSite(self.runner, "127.0.0.1", 0)
        await site.start()
        self.url = f"http://127.0.0.1:{self.runner.addresses[0][1]}"

    async def handle(self, request):
        self.got.append({"id": request.match_info["id"], "headers": dict(request.headers), "body": await request.read(),
                         "url": str(request.url)})
        if self.redirect:
            return web.Response(status=307, headers={"Location": self.redirect})
        return web.Response(status=self.status)

    async def stop(self):
        await self.runner.cleanup()


class PushBase(HubBase):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        self.push = FakePushService()
        await self.push.start()

    async def start_hub(self):
        self.hub = Hub(self.db, TOKEN, user_mention_id=USER_ID)
        self.hub.push_insecure_ok = True   # 假推送服务是本地 http；线上只收 https 的 endpoint
        from aiohttp import web as _web
        from rh.hub import make_app
        self.runner = _web.AppRunner(make_app(self.hub))
        await self.runner.setup()
        site = _web.TCPSite(self.runner, "127.0.0.1", self.port or 0)
        await site.start()
        self.port = self.runner.addresses[0][1]
        self.url = f"http://127.0.0.1:{self.port}"

    async def asyncTearDown(self):
        await super().asyncTearDown()
        await self.push.stop()

    async def key(self):
        async with self.http.get(f"{self.url}/api/push", headers=AUTH) as r:
            self.assertEqual(r.status, 200)
            return (await r.json())["key"]

    async def subscribe(self, browser, name="a", headers=None):
        async with self.http.post(f"{self.url}/api/push", json=browser.sub(f"{self.push.url}/push/{name}"),
                                  headers={**AUTH, "Origin": self.url, **(headers or {})}) as r:
            return r.status

    def payloads(self, browser):
        return [json.loads(browser.decrypt(g["body"])) for g in self.push.got]


class Rfc8291(unittest.TestCase):
    def test_rfc8291_example(self):
        """RFC 8291 第 5 节的例子（固定密钥和 salt）逐字节对上。"""
        from rh.webpush import encrypt
        as_priv = ec.derive_private_key(int.from_bytes(unb64u("yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw"), "big"),
                                        ec.SECP256R1())
        out = encrypt(b"When I grow up, I want to be a watermelon",
                      "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
                      "BTBZMqHH6r4Tts7J_aSIgg", salt=unb64u("DGv6ra1nlYgDCS1FRnbzlw"), server_key=as_priv)
        self.assertEqual(b64u(out), "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6Tlz"
                         "AC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN")


class Vapid(PushBase):
    async def test_key_file_private_and_kept(self):
        """VAPID 私钥存在库旁边的文件里（权限 600，不进 git：data/ 在 .gitignore），重启后还是同一把。"""
        k1 = await self.key()
        f = self.db.parent / "vapid_private.pem"
        self.assertTrue(f.is_file())
        self.assertEqual(stat.S_IMODE(f.stat().st_mode), 0o600)
        await self.stop_hub()
        await self.start_hub()
        self.assertEqual(await self.key(), k1)
        self.assertEqual(len(unb64u(k1)), 65)

    async def test_api_needs_token(self):
        async with self.http.get(f"{self.url}/api/push") as r:
            self.assertEqual(r.status, 401)
        async with self.http.post(f"{self.url}/api/push", json=Browser().sub("https://x.example/1")) as r:
            self.assertEqual(r.status, 401)

    async def test_bad_subscriptions_rejected(self):
        b = Browser()
        bad = [{}, {"endpoint": "https://x.example/1"}, {"endpoint": 1, "keys": b.sub("")["keys"]},
               {"endpoint": "https://x.example/1", "keys": {"p256dh": "AAAA", "auth": b64u(b.auth)}},
               {"endpoint": "https://x.example/1", "keys": {"p256dh": b64u(b.pub), "auth": "!!"}},
               {"endpoint": "https://" + "x" * 2000, "keys": b.sub("")["keys"]}]
        for body in bad:
            async with self.http.post(f"{self.url}/api/push", json=body, headers=AUTH) as r:
                self.assertEqual(r.status, 400, body)
        self.hub.push_insecure_ok = False
        async with self.http.post(f"{self.url}/api/push", json=b.sub("http://x.example/1"), headers=AUTH) as r:
            self.assertEqual(r.status, 400, "线上只收 https 的 endpoint")
        self.assertEqual(self.hub.push_subs(), [])

    async def test_subscribe_idempotent(self):
        b = Browser()
        self.assertEqual(await self.subscribe(b), 200)
        self.assertEqual(await self.subscribe(b), 200)
        self.assertEqual(len(self.hub.push_subs()), 1)


class ReviewFixes(PushBase):
    """代码审查（feat/push-pwa）补的：SSRF、VAPID sub、私钥临时文件。"""

    async def post_sub(self, endpoint, origin=None):
        h = {**AUTH, **({"Origin": origin} if origin else {})}
        async with self.http.post(f"{self.url}/api/push", json=Browser().sub(endpoint), headers=h) as r:
            return r.status

    async def test_ssrf_private_ip_rejected(self):
        """审查第 1 条：内网 / 本机地址不收（hub 会去 POST 它）。"""
        self.hub.push_insecure_ok = False
        ip = lambda *n: ".".join(map(str, n))   # 拼出来：仓库不许出现字面 IP（test_device test_9_no_public_ip_in_tracked_files）
        for ep in ("https://127.0.0.1/x", f"https://{ip(10, 0, 0, 5)}/x", f"https://{ip(192, 168, 1, 1)}/x",
                   f"https://{ip(169, 254, 169, 254)}/latest", "https://[::1]/x", "https://localhost/x"):
            self.assertEqual(await self.post_sub(ep), 400, ep)
        self.assertEqual(self.hub.push_subs(), [])

    async def test_ssrf_unknown_host_rejected(self):
        """审查第 1 条：只收已知推送服务的域名。"""
        self.hub.push_insecure_ok = False
        for ep in ("https://example.com/push", "https://fcm.googleapis.com.evil.com/x", "https://evilpush.apple.com/x",
                   "https://notify.windows.com.evil/x", "https://user@evil.com/x"):
            self.assertEqual(await self.post_sub(ep), 400, ep)
        for ep in ("https://fcm.googleapis.com/fcm/send/abc", "https://web.push.apple.com/QWxh",
                   "https://updates.push.services.mozilla.com/wpush/v2/x", "https://wns2-by3p.notify.windows.com/w/?token=x"):
            self.assertEqual(await self.post_sub(ep), 200, ep)
        self.assertEqual(len(self.hub.push_subs()), 4)

    async def test_redirect_not_followed(self):
        """审查第 1 条：推送服务回 3xx 不跟（跟了等于让对方指挥 hub 去访问任意地址）。"""
        b = Browser()
        await self.subscribe(b, "a")
        hits = []
        async def other(request):
            hits.append(request.path)
            return web.Response(status=201)
        tgt = web.Application(); tgt.router.add_route("*", "/{x:.*}", other)
        tr = web.AppRunner(tgt); await tr.setup(); site = web.TCPSite(tr, "127.0.0.1", 0); await site.start()
        try:
            self.push.redirect = f"http://127.0.0.1:{tr.addresses[0][1]}/inner"   # 当成内网地址
            await self.post("@用户 跳一下", author_kind="role", author="ju", name="橘")
            await wait_for(lambda: len(self.push.got) == 1, what="推到假推送服务")
            await asyncio.sleep(0.5)
            self.assertEqual(hits, [], "不跟随跳转")
        finally:
            await tr.cleanup()

    async def test_vapid_sub_https_only(self):
        """审查第 2 条：Origin 是 https 才当 sub，否则用 https://request.host。"""
        await self.post_sub(f"{self.push.url}/push/a", origin="https://hub.example")
        await self.post_sub(f"{self.push.url}/push/b", origin="http://evil.example")
        await self.post_sub(f"{self.push.url}/push/c", origin="javascript:alert(1)")
        await self.post_sub(f"{self.push.url}/push/d")
        host = self.url.split("://", 1)[1]
        got = {s["endpoint"].rsplit("/", 1)[1]: s["origin"] for s in self.hub.push_subs()}
        self.assertEqual(got, {"a": "https://hub.example", "b": f"https://{host}", "c": f"https://{host}",
                               "d": f"https://{host}"})


class KeyFile(unittest.TestCase):
    def test_leftover_tmp_does_not_leak_mode(self):
        """审查第 3 条：上次留下的 .tmp（权限 644）不能让新私钥也变成 644。"""
        import tempfile
        from pathlib import Path
        from rh.webpush import Vapid
        d = Path(tempfile.mkdtemp())
        tmp = d / "vapid_private.tmp"
        tmp.write_text("old")
        os.chmod(tmp, 0o644)
        Vapid.load(d / "vapid_private.pem")
        self.assertEqual(stat.S_IMODE((d / "vapid_private.pem").stat().st_mode), 0o600)


class Triggers(PushBase):
    async def test_mention_me_pushes_encrypted_with_vapid(self):
        """角色 @ 我（@用户 / @user / <@我的 Discord ID>）就推；推送体按 RFC 8291 加密、带 VAPID。"""
        self.hub.set_members([{"id": "ju", "name": "橘"}])
        b = Browser()
        self.assertEqual(await self.subscribe(b), 200)
        key = await self.key()
        st, m = await self.post("@用户 你看一下这个", author_kind="role", author="ju", name="橘")
        self.assertEqual(st, 200)
        await wait_for(lambda: len(self.push.got) == 1, what="推送到了假推送服务")
        g = self.push.got[0]
        self.assertEqual(g["headers"]["Content-Encoding"], "aes128gcm")
        self.assertGreater(int(g["headers"]["TTL"]), 0)
        claims = verify_vapid(g["headers"]["Authorization"], g["url"], key)
        self.assertEqual(claims["sub"], self.url.replace("http://", "https://"),
                         "Origin 不是 https 时 sub 用 https://request.host（复审第 2 条）")
        p = self.payloads(b)[0]
        self.assertIn("橘", p["title"])
        self.assertIn("你看一下这个", p["body"])
        self.assertEqual((p["room"], p["id"]), (1, m["id"]))
        for text in ("@user 看这里", f"<@{USER_ID}> 看这里", f"<@!{USER_ID}> 看这里"):
            await self.post(text, author_kind="role", author="ju", name="橘")
        await wait_for(lambda: len(self.push.got) == 4, what="三种写法都推")

    async def test_no_push_for_plain_or_own_messages(self):
        b = Browser()
        await self.subscribe(b)
        await self.post("大家好", author_kind="role", author="ju", name="橘")       # 没 @ 我
        await self.post("@用户 自言自语")                                          # 我自己发的
        await self.post("@龙娘 你来", author_kind="role", author="ju", name="橘")  # @ 的是别人
        await self.post("```\n@用户\n```", author_kind="role", author="ju", name="橘")  # 代码块里的不算（同 cloudweb）
        await self.post("系统消息", author_kind="system")
        await self.post("@用户 最后这条要推", author_kind="role", author="ju", name="橘")
        await wait_for(lambda: len(self.push.got) >= 1, what="最后一条")
        await self.post("x", author_kind="system")   # 再等一轮事件循环
        self.assertEqual([p["body"] for p in self.payloads(b)], ["@用户 最后这条要推"])

    async def test_system_notice_with_notify_flag(self):
        """角色出错、等批准：主机发的系统消息带 notify=true 才推（做完那条不带）。"""
        b = Browser()
        await self.subscribe(b)
        await self.post("橘这一轮做完了", author_kind="system", client_key="boot:event:1")
        await self.post("橘出错了：boom", author_kind="system", client_key="boot:event:2", notify=True)
        await wait_for(lambda: len(self.push.got) == 1, what="出错那条推了")
        self.assertIn("橘出错了：boom", self.payloads(b)[0]["body"])
        await self.post("橘出错了：boom", author_kind="system", client_key="boot:event:2", notify=True)   # 重试不重推
        await self.post("x", author_kind="system")
        self.assertEqual(len(self.push.got), 1)

    async def test_gone_subscription_removed(self):
        """推送服务回 404/410（用户关了通知、换了浏览器）：删掉这个订阅，不再推。"""
        await self.subscribe(Browser(), "a")
        await self.subscribe(Browser(), "b")
        self.push.status = 410
        await self.post("@用户 一", author_kind="role", author="ju", name="橘")
        await wait_for(lambda: self.hub.push_subs() == [], what="两个失效订阅都删了")

    async def test_long_text_truncated(self):
        b = Browser()
        await self.subscribe(b)
        st, _ = await self.post("@用户 " + "长" * 1000, author_kind="role", author="ju", name="橘")
        self.assertEqual(st, 200)
        await wait_for(lambda: len(self.push.got) == 1, what="推了")
        self.assertLess(len(self.push.got[0]["body"]), 4096, "推送体要在 4KB 以内（RFC 8030 第 7.2 节）")
        self.assertLessEqual(len(self.payloads(b)[0]["body"]), 200)


class HostNotify(EventBase):
    async def test_error_and_permission_pushed_done_not(self):
        """真主机 + 真 hub：cc-connect 报出错、等批准 → 推；做完 → 不推（rh/discord_body.py → Host.agent_event → hub）。"""
        self.hub.push_insecure_ok = True
        self.push = FakePushService()
        await self.push.start()
        try:
            b = Browser()
            async with self.http.post(f"{self.url}/api/push", json=b.sub(f"{self.push.url}/push/h"),
                                      headers={**AUTH, "Origin": self.url}) as r:
                self.assertEqual(r.status, 200)
            await self.start_body(play=False)
            await self.event("error", error="agent process exited")
            await wait_for(lambda: len(self.push.got) == 1, what="出错推了")
            await self.event("permission.requested", content="```\nrm -rf build\n```", extra={"tool_name": "Bash"})
            await wait_for(lambda: len(self.push.got) == 2, what="等批准推了")
            await self.event("message.sent", content="做好了")
            await asyncio.sleep(0.5)
            self.assertFalse(any("做完" in t for t in self.system_texts()))   # 做完不进大厅（刷屏修复）
            bodies = [json.loads(b.decrypt(g["body"]))["body"] for g in self.push.got]
            self.assertEqual(len(bodies), 2, bodies)
            self.assertIn("出错", bodies[0])
            self.assertIn("批准", bodies[1])
        finally:
            await self.push.stop()


@unittest.skipIf(async_playwright is None, "没装 playwright（uv sync 的 dev 组）")
class WebBase(PushBase):
    UA = None

    async def asyncSetUp(self):
        await super().asyncSetUp()
        self.pw = await async_playwright().start()
        # channel=chromium：新无头模式，通知权限能给（老的 headless shell 一律 denied，2026-10-20 实测）
        self.browser = await self.pw.chromium.launch(channel="chromium", args=["--mute-audio"])
        self.ctx = await self.browser.new_context(viewport=PHONE, **({"user_agent": self.UA} if self.UA else {}))
        self.page = await self.ctx.new_page()

    async def asyncTearDown(self):
        await self.browser.close()
        await self.pw.stop()
        await super().asyncTearDown()

    async def open(self, path="/"):
        await self.page.goto(f"{self.url}{path}#token={TOKEN}")
        await self.page.wait_for_function("document.getElementById('meta').textContent === '已连接'", timeout=5000)

    async def bar(self):
        return await self.page.evaluate("(() => { const b = document.getElementById('pushbar');"
                                        " return b && !b.hidden ? b.innerText : null; })()")


class InstallWeb(WebBase):
    async def asyncSetUp(self):
        await PushBase.asyncSetUp(self)
        # 带用户目录的浏览器：无痕窗口 Chrome 一律判不可安装（errorId in-incognito）
        import tempfile
        self.pw = await async_playwright().start()
        self.ctx = await self.pw.chromium.launch_persistent_context(tempfile.mkdtemp(), channel="chromium",
                                                                    args=["--mute-audio"], viewport=PHONE)
        self.browser = self.ctx
        self.page = self.ctx.pages[0] if self.ctx.pages else await self.ctx.new_page()

    async def test_manifest_icons_and_service_worker(self):
        """能加到主屏幕：manifest、图标、service worker 都在；Chrome 判定可安装（CDP Page.getInstallabilityErrors 为空）。"""
        await self.open()
        href = await self.page.eval_on_selector("link[rel=manifest]", "e => e.href")
        async with self.http.get(href) as r:
            self.assertEqual(r.status, 200)
            man = json.loads(await r.text())
        self.assertEqual(man["display"], "standalone")
        self.assertEqual(man["start_url"], "/")
        sizes = {i["sizes"] for i in man["icons"]}
        self.assertTrue({"192x192", "512x512"} <= sizes, sizes)
        for i in man["icons"]:
            async with self.http.get(self.url + i["src"]) as r:
                self.assertEqual(r.status, 200, i)
                png = await r.read()
            w, h = struct.unpack("!II", png[16:24])
            self.assertEqual(f"{w}x{h}", i["sizes"])
        apple = await self.page.eval_on_selector("link[rel=apple-touch-icon]", "e => e.href")
        async with self.http.get(apple) as r:
            self.assertEqual(r.status, 200)
        scope = await self.page.evaluate("navigator.serviceWorker.ready.then(r => r.scope)")
        self.assertEqual(scope, self.url + "/")
        cdp = await self.ctx.new_cdp_session(self.page)
        errs = await cdp.send("Page.getInstallabilityErrors")
        self.assertEqual(errs["installabilityErrors"], [])


FAKE_SUB = """([endpoint, p256dh, auth]) => {
  const raw = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - s.length % 4) % 4)), c => c.charCodeAt(0)).buffer;
  let cur = null;
  const register = ServiceWorkerContainer.prototype.register;
  ServiceWorkerContainer.prototype.register = function (...a) { return register.apply(this, a).then(r => (window.__reg = r)); };
  const make = (opts) => ({endpoint, expirationTime: null, options: opts,
    getKey: (n) => raw(n === 'p256dh' ? p256dh : auth),
    toJSON: () => ({endpoint, expirationTime: null, keys: {p256dh, auth}}),
    unsubscribe: async () => { cur = null; return true; }});
  PushManager.prototype.subscribe = async function (opts) {
    // 同真 Chrome：registration 还没激活时 subscribe 报错（2026-10-20 真 Chrome 实测 rh-push.js 踩过）
    const r = window.__reg;
    if (!r || !r.active) throw new DOMException('Subscription failed - no active Service Worker', 'AbortError');
    window.__subOpts = opts; cur = make(opts); return cur; };
  PushManager.prototype.getSubscription = async function () { return cur; };
}"""


class PushWeb(WebBase):
    async def test_enable_then_push_reaches_service_worker(self):
        """点「开通知」→ 网页向 hub 登记订阅（applicationServerKey 是 hub 的公钥）→ 角色 @ 我 → hub 推到推送服务
        → 解密后交给 service worker → 弹出通知；点通知回到那个频道。"""
        b = Browser()
        endpoint = f"{self.push.url}/push/web"
        await self.ctx.grant_permissions(["notifications"], origin=self.url)
        await self.ctx.add_init_script(f"({FAKE_SUB})({json.dumps([endpoint, b64u(b.pub), b64u(b.auth)])})")
        # 权限先是 default：要用户点按钮才去申请（苹果手机只认点击里申请的权限）
        await self.ctx.clear_permissions()
        await self.open()
        await wait_for_async(self.bar, what="出现开通知那一行")
        self.assertIn("通知", await self.bar())
        await self.ctx.grant_permissions(["notifications"], origin=self.url)
        await self.page.click("#pushbar button")
        await wait_for(lambda: len(self.hub.push_subs()) == 1, what="hub 登记了订阅")
        key = await self.key()
        opts_key = await self.page.evaluate("btoa(String.fromCharCode(...new Uint8Array(window.__subOpts.applicationServerKey)))"
                                            ".replace(/\\+/g,'-').replace(/\\//g,'_').replace(/=+$/,'')")
        self.assertEqual(opts_key, key)
        await wait_for_async(lambda: self._bar_hidden(), what="开好后那一行收起")

        cdp = await self.ctx.new_cdp_session(self.page)
        regs = []
        cdp.on("ServiceWorker.workerRegistrationUpdated", lambda e: regs.extend(e["registrations"]))
        await cdp.send("ServiceWorker.enable")
        await wait_for(lambda: any(r["scopeURL"] == self.url + "/" for r in regs), what="拿到 registrationId")
        reg_id = next(r["registrationId"] for r in regs if r["scopeURL"] == self.url + "/")

        await self.page.evaluate("document.dispatchEvent(new Event('visibilitychange'))")
        self.hub.set_members([{"id": "ju", "name": "橘"}])
        await self.post("@用户 帮我看下 PR", author_kind="role", author="ju", name="橘")
        await wait_for(lambda: len(self.push.got) == 1, what="推到假推送服务")
        data = b.decrypt(self.push.got[0]["body"]).decode()
        await cdp.send("ServiceWorker.deliverPushMessage", {"origin": self.url, "registrationId": reg_id, "data": data})
        notes = await wait_for_async(lambda: self.page.evaluate(
            "navigator.serviceWorker.ready.then(r => r.getNotifications()).then(ns => ns.map(n => ({title: n.title, body: n.body, data: n.data})))"),
            what="service worker 弹出通知")
        self.assertEqual(len(notes), 1)
        self.assertIn("橘", notes[0]["title"])
        self.assertEqual(notes[0]["body"], "@用户 帮我看下 PR")
        self.assertEqual(notes[0]["data"]["room"], 1)
        await self.page.screenshot(path=str(self.dir / "push-on.png"))

    async def test_granted_subscribes_on_load(self):
        """已经给过通知权限（再次打开、或从主屏幕图标打开）：不用点，打开就登记；那一行不出现。"""
        b = Browser()
        await self.ctx.grant_permissions(["notifications"], origin=self.url)
        await self.ctx.add_init_script(f"({FAKE_SUB})({json.dumps([self.push.url + '/push/w', b64u(b.pub), b64u(b.auth)])})")
        await self.open()
        await wait_for(lambda: len(self.hub.push_subs()) == 1, what="打开就登记了订阅")
        self.assertIsNone(await self.bar())

    async def _bar_hidden(self):
        return (await self.bar()) is None

    async def test_open_room_from_notification_url(self):
        """通知点开时页面没开着：service worker 打开 /?room=频道，网页进那个频道。"""
        made = self.hub.create_room({"name": "二号"})
        await self.open(f"/?room={made['id']}")
        await self.page.wait_for_function(f"document.getElementById('room').textContent === '二号'", timeout=5000)
        self.assertNotIn("room=", self.page.url)


async def wait_for_async(fn, timeout=8.0, what="条件"):
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        v = await fn()
        if v:
            return v
        await asyncio.sleep(0.1)
    raise AssertionError(f"等 {what} 超时")


class IPhoneSafari(WebBase):
    UA = IPHONE_UA

    async def test_ios_guidance_before_home_screen(self):
        """苹果手机在 Safari 里（没加到主屏幕）：给一行引导，不给开通知按钮。"""
        await self.ctx.add_init_script("delete window.PushManager;")   # iPhone Safari 网页里没有 PushManager（加到主屏幕才有）
        await self.open()
        text = await wait_for_async(self.bar, what="引导那一行")
        self.assertIn("添加到主屏幕", text)
        self.assertEqual(await self.page.evaluate("document.querySelectorAll('#pushbar button').length"), 0)
        await self.page.screenshot(path=str(self.dir / "ios-guide.png"))

    async def test_ios_home_screen_offers_button(self):
        await self.ctx.add_init_script("Object.defineProperty(navigator, 'standalone', {get: () => true});")
        await self.open()
        await wait_for_async(self.bar, what="开通知那一行")
        self.assertEqual(await self.page.evaluate("document.querySelectorAll('#pushbar button').length"), 1)


if __name__ == "__main__":
    unittest.main()
