"""Web Push 发送端：RFC 8291（消息加密，aes128gcm）+ RFC 8292（VAPID 签名）+ RFC 8030（投递）。

用户 2026-10-20「我现在基本不在电脑前面了」「然后还有就是其他易用性」：手机上页面不在前台也要弹通知。
只用 cryptography + aiohttp（hub 本来就用 aiohttp，异步发，不拖慢发消息）。

VAPID 私钥存在一个 PEM 文件里（hub 库旁边 data/vapid_private.pem，权限 600；data/ 不进 git），第一次启动自动生成，
之后一直用同一把（换了钥匙，手机上的旧订阅全部失效，要重新点「开通知」）。私钥不打印、不进日志。
"""
from __future__ import annotations

import base64
import json
import os
import struct
import time
from pathlib import Path
from urllib.parse import urlsplit

import aiohttp
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

# JWT 有效期（秒）。来源：RFC 8292 第 2 节，exp 不能超过 24 小时；取 12 小时留余量（实现者定）。
JWT_TTL = 12 * 3600
# 推送服务替手机存多久（秒，TTL 头）：手机关机、没网时等它回来再送。来源：实现者定，一天之后的 @ 已经没意义。
PUSH_TTL = 24 * 3600
# 一条记录的大小（RFC 8188 rs）。来源：RFC 8291 第 4 节建议用 4096。
RECORD_SIZE = 4096
# 发一次推送等多久（秒）。来源：实现者定。
SEND_TIMEOUT = 15


def b64u(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


def unb64u(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def _pub_bytes(key: ec.EllipticCurvePrivateKey) -> bytes:
    return key.public_key().public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)


def _hkdf(salt: bytes, ikm: bytes, info: bytes, n: int) -> bytes:
    return HKDF(algorithm=hashes.SHA256(), length=n, salt=salt, info=info).derive(ikm)


class Vapid:
    def __init__(self, key: ec.EllipticCurvePrivateKey):
        self.key = key
        self.public_key = b64u(_pub_bytes(key))   # 网页 subscribe 的 applicationServerKey

    @classmethod
    def load(cls, path: str | Path | None) -> "Vapid":
        """读 PEM；没有就生成一把写进去（权限 600）。path=None：只放内存（:memory: 库，测试用）。"""
        if path is None:
            return cls(ec.generate_private_key(ec.SECP256R1()))
        path = Path(path)
        if path.exists():
            return cls(serialization.load_pem_private_key(path.read_bytes(), password=None))
        key = ec.generate_private_key(ec.SECP256R1())
        pem = key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
                                serialization.NoEncryption())
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".tmp")
        tmp.unlink(missing_ok=True)   # 上次留下的 .tmp 可能是别的权限：删掉重建（O_EXCL），再 fchmod 一次（代码审查第 3 条）
        fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "wb") as f:
            f.write(pem)
        os.replace(tmp, path)   # 两个进程同时开时不会读到写了一半的文件
        return cls(serialization.load_pem_private_key(path.read_bytes(), password=None))

    def auth_header(self, endpoint: str, subject: str, now: float | None = None) -> str:
        u = urlsplit(endpoint)
        claims = {"aud": f"{u.scheme}://{u.netloc}", "exp": int((now or time.time()) + JWT_TTL), "sub": subject}
        head = b64u(json.dumps({"typ": "JWT", "alg": "ES256"}, separators=(",", ":")).encode())
        body = b64u(json.dumps(claims, separators=(",", ":")).encode())
        r, s = decode_dss_signature(self.key.sign(f"{head}.{body}".encode(), ec.ECDSA(hashes.SHA256())))
        sig = b64u(r.to_bytes(32, "big") + s.to_bytes(32, "big"))   # JWS 的 ES256 是 r||s 各 32 字节，不是 DER
        return f"vapid t={head}.{body}.{sig}, k={self.public_key}"


def valid_keys(p256dh: object, auth: object) -> bool:
    """浏览器订阅里的 keys：p256dh 是 65 字节的 P-256 公钥点，auth 是 16 字节（RFC 8291 第 2、3 节）。"""
    try:
        pub, secret = unb64u(p256dh), unb64u(auth)   # type: ignore[arg-type]
        ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), pub)
    except (TypeError, ValueError, AttributeError):
        return False
    return len(pub) == 65 and len(secret) == 16


def encrypt(payload: bytes, p256dh: str, auth: str, salt: bytes | None = None,
            server_key: ec.EllipticCurvePrivateKey | None = None) -> bytes:
    """RFC 8291 第 3、4 节：一条记录，头部 salt(16) | rs(4) | idlen(1) | 发送方临时公钥(65)。
    salt、server_key 只给测试固定用（RFC 8291 第 5 节的例子），平时每条都随机。"""
    ua_pub = unb64u(p256dh)
    secret = unb64u(auth)
    key = server_key or ec.generate_private_key(ec.SECP256R1())
    as_pub = _pub_bytes(key)
    shared = key.exchange(ec.ECDH(), ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), ua_pub))
    ikm = _hkdf(secret, shared, b"WebPush: info\x00" + ua_pub + as_pub, 32)
    salt = salt or os.urandom(16)
    cek = _hkdf(salt, ikm, b"Content-Encoding: aes128gcm\x00", 16)
    nonce = _hkdf(salt, ikm, b"Content-Encoding: nonce\x00", 12)
    if len(payload) + 1 + 16 > RECORD_SIZE:
        raise ValueError("payload too large")
    ct = AESGCM(cek).encrypt(nonce, payload + b"\x02", None)   # 0x02：最后一条记录
    return salt + struct.pack("!IB", RECORD_SIZE, len(as_pub)) + as_pub + ct


async def send(session: aiohttp.ClientSession, sub: dict, data: bytes, vapid: Vapid, subject: str) -> int:
    """发一条，返回推送服务的 HTTP 状态码（201 成功；404/410 订阅失效）。"""
    body = encrypt(data, sub["p256dh"], sub["auth"])
    headers = {"Authorization": vapid.auth_header(sub["endpoint"], subject), "Content-Encoding": "aes128gcm",
               "Content-Type": "application/octet-stream", "TTL": str(PUSH_TTL),
               # high：苹果、安卓省电模式下也马上送（RFC 8030 第 5.3 节）；只有 @ 我、出错、等批准才推，量很少
               "Urgency": "high"}
    # 不跟跳转（代码审查第 1 条）：跟了等于让对方指挥 hub 去访问任意地址；3xx 当失败，hub 记日志
    async with session.post(sub["endpoint"], data=body, headers=headers, allow_redirects=False,
                            timeout=aiohttp.ClientTimeout(total=SEND_TIMEOUT)) as r:
        await r.read()
        return r.status
