"""Device side of the #42 wire contract, simulated on the computer first.

This is a *client*, not a second server: every request goes to the same device
entry that a browser page uses (``voice.device_app``), so a green test run
proves the documented contract instead of a parallel implementation.

The class models what an ESP32 terminal must do: keep a device identity and a
persisted client id, upload one 16 kHz WAV recording, submit exactly one turn
per recording, play the answer chunk by chunk in order, and report only what it
actually played. States change on observed events only — there is no timer that
guesses "the device probably finished".

Firmware is not included here; ``docs/DEVICE_TERMINAL.md`` is the contract this
module exercises.
"""
from __future__ import annotations

import array
import asyncio
from dataclasses import dataclass
import io
import json
import math
import os
from pathlib import Path
import tempfile
import time
from uuid import uuid4
import wave

RECORD_RATE = 16000
RECORD_CHANNELS = 1
RECORD_SAMPLE_BYTES = 2
MAX_RECORD_BYTES = 1_000_000
# A new question while the device is in one of these states would orphan the
# previous turn id.
BUSY_STATES = frozenset({"waiting", "playing", "draining"})


class DeviceError(RuntimeError):
    """A refusal the terminal must surface instead of retrying blindly."""

    def __init__(self, status: int, detail: str):
        super().__init__(detail)
        self.status = status
        self.detail = detail


def tone_wav(seconds: float = 1.0, *, rate: int = RECORD_RATE,
             frequency: float = 440.0, amplitude: float = 0.2) -> bytes:
    """Build a 16 kHz mono 16-bit WAV, the only recording format accepted."""
    frames = max(1, int(rate * seconds))
    samples = array.array('h', (int(32767 * amplitude * math.sin(2 * math.pi * frequency * i / rate))
                                for i in range(frames)))
    out = io.BytesIO()
    with wave.open(out, 'wb') as audio:
        audio.setparams((RECORD_CHANNELS, RECORD_SAMPLE_BYTES, rate, 0, 'NONE', 'not compressed'))
        audio.writeframes(samples.tobytes())
    return out.getvalue()


@dataclass
class DeviceTerminal:
    """One simulated physical device talking to the device entry over HTTP.

    ``http`` is any async client with ``get``/``post`` returning an object that
    has ``status_code``, ``json()`` and ``content`` (``httpx.AsyncClient``
    matches). Tests inject an ASGI transport so no socket is opened.
    """

    http: object
    base_url: str
    device_id: str
    client_id: str | None = None
    token: str = ''
    secret: str = ''
    poll_interval: float = 0.05
    timeout: float = 10.0
    clock: object = time.monotonic
    state_path: str = ''

    project: str = ''
    name: str = ''
    state: str = 'offline'
    turn_id: str | None = None
    played_seconds: float = 0.0
    played_chunks: int = 0
    finished: bool = False
    unconfirmed: bool = False

    def __post_init__(self):
        if self.state_path:
            self.load_state()
        # A device persists this id in flash; losing it would look like a new
        # page and lose the right to resume its own answer.
        if not self.client_id:
            self.client_id = str(uuid4())

    # -- flash-persisted state (the device's NVS) --------------------------

    def save_state(self) -> None:
        """Persist the ids and the playback cursor, like a device's NVS.

        The server remains authoritative for what it actually received; this
        record only survives a reboot so the terminal does not have to start
        from a blank memory. Written atomically and 0600: it is device state,
        not a log.
        """
        if not self.state_path:
            return
        payload = {'device_id': self.device_id, 'client_id': self.client_id,
                   'turn_id': self.turn_id, 'played_chunks': self.played_chunks,
                   'played_seconds': self.played_seconds, 'finished': self.finished,
                   'unconfirmed': self.unconfirmed}
        path = Path(self.state_path).expanduser()
        path.parent.mkdir(parents=True, exist_ok=True)
        fd, temp = tempfile.mkstemp(prefix='.device-state-', dir=str(path.parent))
        try:
            with os.fdopen(fd, 'w', encoding='utf-8') as handle:
                json.dump(payload, handle)
            os.replace(temp, path)
        except BaseException:
            try:
                os.unlink(temp)
            except OSError:
                pass
            raise
        os.chmod(path, 0o600)

    def load_state(self) -> None:
        """Restore ids and cursor saved by :meth:`save_state`, if any."""
        if not self.state_path:
            return
        path = Path(self.state_path).expanduser()
        if not path.is_file():
            return
        try:
            payload = json.loads(path.read_text(encoding='utf-8'))
        except (OSError, ValueError):
            return
        if not isinstance(payload, dict) or payload.get('device_id') != self.device_id:
            # State for another device must never be adopted.
            return
        if isinstance(payload.get('client_id'), str) and payload['client_id']:
            self.client_id = self.client_id or payload['client_id']
        if isinstance(payload.get('turn_id'), str):
            self.turn_id = self.turn_id or payload['turn_id']
        if isinstance(payload.get('played_chunks'), int) and payload['played_chunks'] >= 0:
            self.played_chunks = payload['played_chunks']
        if isinstance(payload.get('played_seconds'), (int, float)):
            self.played_seconds = float(payload['played_seconds'])
        self.finished = bool(payload.get('finished'))
        self.unconfirmed = bool(payload.get('unconfirmed')) and self.turn_id is not None

    # -- transport ---------------------------------------------------------

    def _headers(self, extra: dict | None = None) -> dict:
        headers = {'X-Device-Client': self.client_id}
        if self.secret:
            headers['X-Device-Secret'] = self.secret
        if self.token:
            headers['X-Voice-Token'] = self.token
        if extra:
            headers.update(extra)
        return headers

    def _url(self, path: str) -> str:
        return self.base_url.rstrip('/') + path

    @staticmethod
    def _detail(response) -> str:
        try:
            payload = response.json()
        except (ValueError, json.JSONDecodeError):
            return f'HTTP {response.status_code}'
        if isinstance(payload, dict) and isinstance(payload.get('detail'), str):
            return payload['detail']
        return f'HTTP {response.status_code}'

    async def _request(self, method: str, path: str, *, body: bytes | None = None,
                       json_body: dict | None = None, content_type: str | None = None):
        extra = {'Content-Type': content_type} if content_type else None
        url = self._url(path)
        if method == 'GET':
            response = await self.http.get(url, headers=self._headers())
        else:
            kwargs = {'headers': self._headers(extra)}
            if body is not None:
                kwargs['content'] = body
            if json_body is not None:
                kwargs['json'] = json_body
            response = await self.http.post(url, **kwargs)
        if response.status_code >= 400:
            raise DeviceError(response.status_code, self._detail(response))
        return response

    # -- identity ----------------------------------------------------------

    async def config(self) -> dict:
        response = await self._request('GET', f'/device/{self.device_id}/api/config')
        return response.json()

    async def connect(self) -> dict:
        """Read the device configuration; identity and partner are never guessed."""
        payload = await self.config()
        # A LAN entry deliberately does not hand out the page token.
        self.token = payload.get('token', '')
        self.project = payload['default_role']
        self.name = payload['device_name']
        self.state = 'listening'
        return payload

    async def wait_for_release(self, turn_id: str | None = None, *,
                               timeout: float | None = None) -> dict:
        """Wait until the entry reports this device free before recording again.

        A stop acknowledgement is not a release: the delivered CLI work keeps
        the slot until it finishes. The turn snapshot's ``device_released`` is
        the per-turn signal; the config's ``active_turn``/``available`` is the
        global one, and both are needed because the slot is shared between
        devices. Recording into that window uploads a whole sentence that is
        then rejected with 409, so the terminal must check first instead of
        trusting its own stop button.
        """
        deadline = self.clock() + (self.timeout if timeout is None else timeout)
        identifier = turn_id or self.turn_id
        while True:
            if identifier is not None:
                try:
                    snapshot = await self.status(identifier)
                except DeviceError as exc:
                    if exc.status not in {404, 410}:
                        raise
                    identifier = None  # Turn is gone: the global check decides.
                else:
                    if snapshot.get('device_released') is False:
                        # Still draining: the id must stay, it is how the
                        # release state is queried.
                        await self._wait_for(deadline)
                        continue
            payload = await self.config()
            roles = payload.get('roles') or []
            if payload.get('active_turn') is None and all(role.get('available') for role in roles):
                self.state = 'listening'
                if identifier is not None and identifier == self.turn_id:
                    # Released and idle: this turn is over. Dropping the id is
                    # what stops the next question from reusing it.
                    self.turn_id = None
                    self.played_chunks, self.played_seconds, self.finished = 0, 0.0, False
                    self.save_state()
                return payload
            await self._wait_for(deadline)

    async def _wait_for(self, deadline: float) -> None:
        if self.clock() >= deadline:
            raise DeviceError(0, '上一轮仍在后台收尾；现在录音会被拒，请稍后再试。')
        await asyncio.sleep(self.poll_interval)

    async def resume(self) -> dict:
        """Reconnect with the persisted client id; no new identity is created.

        The playback cursor is recovered from the progress receipts this device
        already sent, so a power loss in the middle of an answer continues at the
        next chunk instead of replaying the first one from memory that did not
        survive the reboot.
        """
        payload = await self.connect()
        if self.turn_id is not None:
            try:
                snapshot = await self.status(self.turn_id)
            except DeviceError as exc:
                if exc.status in {404, 410}:
                    # Unknown to the entry: the request never landed, or the
                    # entry restarted and voided it. Nothing to retry under it.
                    self.turn_id, self.unconfirmed = None, False
                    self.played_chunks, self.played_seconds = 0, 0.0
                    self.save_state()
                    return {'id': None, 'status': 'unknown', 'detail': exc.detail}
                raise
            self.unconfirmed = False  # The entry knows this turn: it was accepted.
            playback = snapshot.get('playback') or {}
            # A finished turn has no audio left to hand out; remembering it as
            # resumable would make a rebooted device try to replay the answer.
            self.finished = playback.get('state') == 'completed' or snapshot.get('status') == 'stopped'
            if self.finished:
                self.played_chunks, self.played_seconds = 0, 0.0
            else:
                saved = self.played_chunks if snapshot.get('id') == self.turn_id else 0
                self.played_chunks, self.played_seconds = self._cursor(snapshot, saved)
            self.state = self._state_after_reconnect(snapshot)
            self.save_state()
            return snapshot
        return {'id': None, 'status': 'idle', 'config': payload}

    def _state_after_reconnect(self, snapshot: dict) -> str:
        """Reconnecting is not permission to start a new turn: the server's
        record of the persisted turn decides what the device may do next."""
        if snapshot.get('status') in {'stopped', 'error'} or self.finished:
            return 'listening' if snapshot.get('device_released') is True else 'draining'
        return 'waiting'

    def _cursor(self, snapshot: dict, saved: int = 0) -> tuple[int, float]:
        """How many chunks of *this* turn may be skipped on resume.

        Two records can disagree: the server's progress receipts and the
        cursor persisted in flash. A receipt can be lost on the way out, and a
        flash write can be cut short by the power loss itself. Skipping audio is
        worse than replaying it, so the smaller of the two wins and a value that
        does not fit this turn is ignored entirely.
        """
        chunks = snapshot.get('audio_chunks') or []
        playback = snapshot.get('playback') or {}
        position = playback.get('position_seconds')
        total = round(sum(chunk['duration_seconds'] for chunk in chunks), 6)
        if not chunks:
            return 0, 0.0
        duration = playback.get('duration_seconds')
        server = None
        if (isinstance(position, (int, float)) and isinstance(duration, (int, float))
                and abs(duration - total) <= max(.25, total * .01)):
            played, count = 0.0, 0
            for chunk in chunks:
                played = round(played + chunk['duration_seconds'], 6)
                if played > position + 1e-6:
                    break
                count += 1
            server = count
        if server is None:
            server = saved
        count = min(server, saved if saved else server)
        count = max(0, min(count, len(chunks)))
        return count, round(sum(c['duration_seconds'] for c in chunks[:count]), 6)

    # -- record and ask ----------------------------------------------------

    async def heartbeat(self) -> dict:
        """Tell the entry this device is still here.

        Every request already refreshes the lease; an explicit beat matters when
        the device is busy recording and sends nothing else for a while. When the
        beats stop, the entry releases the shared slot and records why.
        """
        response = await self._request('POST', f'/device/{self.device_id}/api/heartbeat')
        return response.json()

    async def transcribe(self, wav_bytes: bytes) -> dict:
        if len(wav_bytes) > MAX_RECORD_BYTES:
            raise DeviceError(0, f'录音超过 {MAX_RECORD_BYTES} 字节，请缩短后重传。')
        response = await self._request('POST', f'/device/{self.device_id}/api/transcribe',
                                       body=wav_bytes, content_type='audio/wav')
        return response.json()

    async def ask(self, text: str, *, turn_id: str | None = None) -> dict:
        """Submit a new question under a fresh turn id.

        ``turn_id`` is only for tests and for restoring a known turn; ordinary
        use must not reuse the previous id, because the server rejects a
        repeated id with different text as a conflict. Retrying an uncertain
        delivery is :meth:`retry`.

        Refused locally while the previous turn is unfinished or its delivery is
        unconfirmed: replacing the id then would lose the only handle for the
        release query or for an idempotent retry.
        """
        refusal = '上一轮未结束或结果待确认：请先 wait_for_release() 或 retry() 原轮，不能另开新轮。'
        if self.unconfirmed or self.state in BUSY_STATES:
            raise DeviceError(0, refusal)
        if self.turn_id is not None and turn_id != self.turn_id:
            # Local state can be stale after a reboot, whichever path set it
            # (connect, resume, ...). The server decides whether the old turn
            # may be replaced.
            try:
                previous = await self.status(self.turn_id)
            except DeviceError as exc:
                if exc.status not in {404, 410}:
                    raise
            else:
                if previous.get('device_released') is not True:
                    self.state = self._state_after_reconnect(previous)
                    raise DeviceError(0, refusal)
        self.played_chunks, self.played_seconds, self.finished = 0, 0.0, False
        return await self._submit(text, turn_id or str(uuid4()))

    async def retry(self, text: str) -> dict:
        """Re-send the *same* turn after an unknown delivery outcome.

        Idempotent on the server: same id and same text returns the original
        turn instead of delivering twice.
        """
        if self.turn_id is None:
            raise DeviceError(0, '没有可重发的轮次；新问题请用 ask()。')
        return await self._submit(text, self.turn_id)

    async def _submit(self, text: str, turn_id: str) -> dict:
        # Marked unconfirmed and persisted before the request leaves, so a
        # timeout or power loss mid-request still blocks a new turn.
        self.turn_id, self.unconfirmed = turn_id, True
        self.save_state()
        try:
            response = await self._request(
                'POST', f'/device/{self.device_id}/api/turn',
                json_body={'id': turn_id, 'project': self.project, 'text': text})
        except DeviceError as exc:
            if 400 <= exc.status < 500:
                # A definite refusal: nothing was delivered under this id.
                self.unconfirmed = False
                self.save_state()
            raise
        self.unconfirmed = False
        self.state = 'waiting'
        self.save_state()
        return response.json()

    async def resend(self, text: str) -> dict:
        """Deprecated alias kept for callers written against the first draft."""
        return await self.retry(text)

    async def status(self, turn_id: str | None = None) -> dict:
        identifier = turn_id or self.turn_id
        response = await self._request('GET', f'/device/{self.device_id}/api/turn/{identifier}')
        return response.json()

    async def wait_ready(self, turn_id: str | None = None, *, timeout: float | None = None) -> dict:
        """Poll until the answer is playable, failed or stopped; never resubmit."""
        deadline = self.clock() + (self.timeout if timeout is None else timeout)
        while True:
            snapshot = await self.status(turn_id)
            if snapshot['status'] in {'ready', 'error', 'stopped'}:
                # A stopped turn may still be draining; only wait_for_release()
                # returns the device to listening.
                self.state = {'ready': 'waiting', 'stopped': 'draining'}.get(snapshot['status'], 'listening')
                return snapshot
            if self.clock() >= deadline:
                raise DeviceError(0, '等待回答超时；本轮不重发，请在电脑核对原会话。')
            await asyncio.sleep(self.poll_interval)

    # -- playback ----------------------------------------------------------

    async def _chunk(self, url: str, deadline: float) -> bytes:
        while True:
            try:
                return (await self._request('GET', url)).content
            except DeviceError as exc:
                # 404 means "not synthesized yet", not "give up".
                if exc.status != 404:
                    raise
                if self.clock() >= deadline:
                    raise
                await asyncio.sleep(self.poll_interval)

    async def play(self, snapshot: dict, *, start_index: int | None = None, limit: int | None = None,
                   pace: bool = False, on_chunk=None) -> dict:
        """Play chunks in index order and report progress and completion.

        ``start_index`` defaults to the cursor this terminal already holds for
        *this* turn; a chunk that was never fetched is never counted as played.
        ``limit`` plays only the first N chunks without a completion receipt,
        which is how a power loss in the middle of an answer is modelled.

        Progress is reported after every chunk, so the server — not the device's
        volatile memory — is the record a rebooted device resumes from.
        """
        turn_id = snapshot['id']
        if self.finished and turn_id == self.turn_id:
            raise DeviceError(0, '这一轮已经播完或已停止；不重播旧回答。')
        chunks = snapshot.get('audio_chunks') or []
        if not chunks:
            raise DeviceError(0, '这一轮没有可播放的分块音频。')
        if start_index is None:
            start_index = self.played_chunks if turn_id == self.turn_id else 0
        if not 0 <= start_index <= len(chunks):
            raise DeviceError(0, f'续播位置 {start_index} 不在本轮 {len(chunks)} 块之内。')
        total = round(sum(chunk['duration_seconds'] for chunk in chunks), 6)
        played = round(sum(chunk['duration_seconds'] for chunk in chunks[:start_index]), 6)
        if start_index > 0 and snapshot.get('playback_allowed') is not True:
            raise DeviceError(0, '重连后本轮已无播放权；不重播旧回答。')
        deadline = self.clock() + self.timeout
        self.state = 'playing'
        remaining = chunks[start_index:] if limit is None else chunks[start_index:start_index + limit]
        for chunk in remaining:
            audio = await self._chunk(chunk['audio_url'], deadline)
            if on_chunk is not None:
                on_chunk(chunk['index'], audio)
            if played == 0:
                await self.receipt(turn_id, 'playing', 0.0, total)
            played = round(played + chunk['duration_seconds'], 6)
            self.played_seconds, self.played_chunks = played, chunk['index'] + 1
            if pace:
                await asyncio.sleep(chunk['duration_seconds'])
            # Recorded after the audio was handed to the output, never before.
            self.save_state()
            await self.receipt(turn_id, 'playing', played, total)
        if limit is not None:
            return {'turn_id': turn_id, 'chunks': len(chunks), 'played_seconds': played,
                    'completed': False}
        await self.receipt(turn_id, 'completed', played, total)
        self.finished = True
        self.save_state()
        self.state = 'listening'
        return {'turn_id': turn_id, 'chunks': len(chunks), 'played_seconds': played,
                'completed': True}

    async def receipt(self, turn_id: str, state: str, position: float, duration: float) -> None:
        await self._request(
            'POST', f'/device/{self.device_id}/api/turn/{turn_id}/playback',
            json_body={'state': state, 'position_seconds': position, 'duration_seconds': duration})

    async def stop(self, turn_id: str | None = None) -> dict:
        identifier = turn_id or self.turn_id
        response = await self._request('POST', f'/device/{self.device_id}/api/turn/{identifier}/stop',
                                       json_body=None)
        # Draining: the CLI work may still be finishing. Only
        # wait_for_release() may return this device to listening.
        self.state = 'draining'
        self.save_state()
        return response.json()


def _load_wav(path: str) -> bytes:
    with open(path, 'rb') as handle:
        return handle.read()


def main(argv: list[str] | None = None) -> int:
    import argparse

    parser = argparse.ArgumentParser(description='共栖：模拟外接语音终端走一遍 #42 协议')
    parser.add_argument('--base', default='http://127.0.0.1:8796')
    parser.add_argument('--device', required=True, help='设备编号，例如 desk-gge')
    parser.add_argument('--wav', help='16kHz 单声道 16bit WAV；省略则上传 1 秒测试音')
    parser.add_argument('--text', help='跳过录音上传，直接发送这段文字')
    parser.add_argument('--client', help='复用上次的 client id（模拟重连）')
    parser.add_argument('--secret', help='设备凭据；连非本机入口时必填')
    parser.add_argument('--pace', action='store_true', help='按真实时长播放')
    args = parser.parse_args(argv)

    try:
        import httpx
    except ImportError:
        print('需要 httpx：在 companion 下用 uv run --group dev python -m voice.device_terminal')
        return 2

    async def run() -> int:
        async with httpx.AsyncClient(timeout=60) as http:
            terminal = DeviceTerminal(http, args.base, args.device, client_id=args.client or str(uuid4()),
                                      secret=args.secret or '')
            config = await terminal.connect()
            print(f"已连接 {config['device_name']} → {terminal.project}，client={terminal.client_id}")
            await terminal.wait_for_release()
            text = args.text
            if text is None:
                recording = _load_wav(args.wav) if args.wav else tone_wav(1.0)
                started = time.monotonic()
                result = await terminal.transcribe(recording)
                print(f"识别 {round((time.monotonic() - started) * 1000)}ms：{result['text']}")
                text = result['text']
            await terminal.ask(text)
            snapshot = await terminal.wait_ready()
            if snapshot['status'] != 'ready':
                print(f"本轮不可播放：{snapshot['status']} {snapshot.get('error', '')}")
                return 1
            played = await terminal.play(snapshot, pace=args.pace,
                                         on_chunk=lambda index, audio: print(f'  块 {index}：{len(audio)} 字节'))
            print(f"播放完成：{played['chunks']} 块 / {played['played_seconds']:.2f}s")
        return 0

    return asyncio.run(run())


if __name__ == '__main__':
    raise SystemExit(main())
