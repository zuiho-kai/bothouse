"""假小智板子：按小智协议连主机的 OTA 接口和 WebSocket，记下收到的消息和音频帧，不出声。

单测用（tests/test_xiaozhi.py），也能手动对着正在跑的主机试（不接真板子先看主机推了什么，Ctrl-C 退出）：

    uv run python tools/fake_xiaozhi.py http://127.0.0.1:8791/xiaozhi/ota/ --device 90:70:69:f5:89:e4

协议同 rh/xiaozhi.py 文件头（出处 78/xiaozhi-esp32 docs/websocket.md）：先 POST OTA（头 Device-Id、Client-Id，
body 带 application.version），按回包里的 websocket.url / token 连 WebSocket（头 Authorization、Protocol-Version、
Device-Id、Client-Id），发 hello，等主机回 hello。之后只收不发（和真板子第一步一样不收音）；
只回主机的 MCP 请求：self.get_device_status 报当前音量，self.audio_speaker.set_volume 改音量（同固件 main/mcp_server.cc）。
"""
from __future__ import annotations

import argparse
import asyncio
import json
import struct
import time
import uuid

import sys
from pathlib import Path

import aiohttp

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))   # 直接 python tools/fake_xiaozhi.py 时也找得到 rh
from rh.xiaozhi import FRAME_MS, SAMPLE_RATE


class FakeXiaozhi:
    def __init__(self, ota_url: str, device: str = "aa:bb:cc:dd:ee:01", version: int = 1, fw: str = "2.5.2"):
        self.ota_url, self.device, self.version, self.fw = ota_url, device, version, fw
        self.client = str(uuid.uuid4())
        self.got: list[tuple[float, str, object]] = []   # (时刻, "json"/"audio", 内容)；audio 记去掉协议头后的 Opus 包
        self.ota_reply: dict | None = None
        self.hello: dict | None = None
        self.http: aiohttp.ClientSession | None = None
        self.ws: aiohttp.ClientWebSocketResponse | None = None
        self._task: asyncio.Task | None = None
        self.volume = 70   # 固件默认音量（main/audio/audio_codec.h 第 64 行 output_volume_ = 70）
        self.mcp_answer = True   # False：不回 MCP（模拟老固件 / 没回包）
        self.elf_sha256 = "00" * 32   # self.get_system_info 报的固件 elf_sha256
        self.upgrades: list[str] = []   # 主机让它 self.upgrade_firmware 的地址

    async def ota(self) -> dict:
        self.http = self.http or aiohttp.ClientSession()
        body = {"application": {"version": self.fw}, "mac_address": self.device}
        async with self.http.post(self.ota_url, json=body,
                                  headers={"Device-Id": self.device, "Client-Id": self.client}) as r:
            r.raise_for_status()
            self.ota_reply = await r.json()
        return self.ota_reply

    async def connect(self, timeout: float = 5.0, autoping: bool = True) -> dict:
        """autoping=False：收到 ping 不回 pong，模拟断电、掉 Wi-Fi 后的半开连接（单测心跳用）。"""
        if self.ota_reply is None:
            await self.ota()
        ws_cfg = self.ota_reply["websocket"]
        headers = {"Protocol-Version": str(self.version), "Device-Id": self.device, "Client-Id": self.client}
        if ws_cfg.get("token"):
            headers["Authorization"] = f"Bearer {ws_cfg['token']}"
        self.ws = await self.http.ws_connect(ws_cfg["url"], headers=headers, autoping=autoping)
        # 板子的 hello（固件 websocket_protocol.cc 第 200-217 行）
        params = {"format": "opus", "sample_rate": SAMPLE_RATE, "channels": 1, "frame_duration": FRAME_MS}
        await self.ws.send_json({"type": "hello", "version": self.version, "features": {"mcp": True},
                                 "transport": "websocket", "audio_params": params})
        msg = await self.ws.receive(timeout=timeout)
        self.hello = json.loads(msg.data)
        self._task = asyncio.create_task(self._loop())
        return self.hello

    def _strip(self, data: bytes) -> bytes:
        # 协议头：v2 16 字节、长度在第 12-16 字节；v3 4 字节、长度在第 2-4 字节（固件 main/protocols/protocol.h BinaryProtocol2/3）
        if self.version == 2:
            n = struct.unpack(">I", data[12:16])[0]
            return data[16:16 + n]
        if self.version == 3:
            n = struct.unpack(">H", data[2:4])[0]
            return data[4:4 + n]
        return data

    async def _loop(self) -> None:
        async for m in self.ws:
            if m.type == aiohttp.WSMsgType.TEXT:
                d = json.loads(m.data)
                self.got.append((time.monotonic(), "json", d))
                if d.get("type") == "mcp" and self.mcp_answer:
                    await self._mcp(d.get("payload") or {})
            elif m.type == aiohttp.WSMsgType.BINARY:
                self.got.append((time.monotonic(), "audio", self._strip(m.data)))

    async def _mcp(self, req: dict) -> None:
        """照固件回包格式（main/mcp_server.cc ReplyResult / ReplyError，工具结果包成 content[0].text）。"""
        i, params = req.get("id"), req.get("params") or {}
        name, args = params.get("name"), params.get("arguments") or {}
        if req.get("method") != "tools/call":
            out = {"error": {"code": -32601, "message": "Method not implemented: " + str(req.get("method"))}}
        elif name == "self.get_device_status":
            text = json.dumps({"audio_speaker": {"volume": self.volume}})
            out = {"result": {"content": [{"type": "text", "text": text}], "isError": False}}
        elif name == "self.get_system_info":
            text = json.dumps({"application": {"version": self.fw, "elf_sha256": self.elf_sha256}})
            out = {"result": {"content": [{"type": "text", "text": text}], "isError": False}}
        elif name == "self.upgrade_firmware" and isinstance(args.get("url"), str):
            self.upgrades.append(args["url"])
            out = {"result": {"content": [{"type": "text", "text": "true"}], "isError": False}}
        elif name == "self.audio_speaker.set_volume" and isinstance(args.get("volume"), int) and 0 <= args["volume"] <= 100:
            self.volume = args["volume"]
            out = {"result": {"content": [{"type": "text", "text": "true"}], "isError": False}}
        else:
            out = {"error": {"code": -32602, "message": "bad call"}}
        await self.ws.send_json({"session_id": "", "type": "mcp", "payload": {"jsonrpc": "2.0", "id": i, **out}})

    def mcp_calls(self, name: str | None = None) -> list[dict]:
        """主机发来的 MCP tools/call 的 params（可按工具名筛）。"""
        return [d["payload"]["params"] for d in self.jsons(type="mcp")
                if d["payload"].get("method") == "tools/call" and (name is None or d["payload"]["params"].get("name") == name)]

    async def upload_audio(self, data: bytes) -> None:
        """模拟板子上传一帧麦克风音频（主机应丢掉）。"""
        await self.ws.send_bytes(data)

    def jsons(self, **match) -> list[dict]:
        return [d for _, k, d in self.got if k == "json" and all(d.get(a) == b for a, b in match.items())]

    def audio(self) -> list[bytes]:
        return [d for _, k, d in self.got if k == "audio"]

    async def close(self) -> None:
        if self.ws is not None:
            await self.ws.close()
        if self._task is not None:
            try:
                await asyncio.wait_for(self._task, 2)
            except (asyncio.TimeoutError, asyncio.CancelledError):
                pass
        if self.http is not None:
            await self.http.close()
            self.http = None


async def _main(a) -> None:
    dev = FakeXiaozhi(a.ota, a.device, a.version)
    print("OTA 回包：", json.dumps(await dev.ota(), ensure_ascii=False))
    print("主机 hello：", json.dumps(await dev.connect(), ensure_ascii=False))
    seen = 0
    try:
        while not dev.ws.closed:
            await asyncio.sleep(0.2)
            for t, k, d in dev.got[seen:]:
                print(f"{t:.2f} {k} " + (json.dumps(d, ensure_ascii=False) if k == "json" else f"{len(d)} 字节"))
            seen = len(dev.got)
    finally:
        await dev.close()


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("ota", help="OTA 地址，如 http://127.0.0.1:8791/xiaozhi/ota/")
    ap.add_argument("--device", default="aa:bb:cc:dd:ee:01", help="假装的板子 MAC（Device-Id）")
    ap.add_argument("--version", type=int, default=1, help="协议版本 1/2/3")
    asyncio.run(_main(ap.parse_args()))
