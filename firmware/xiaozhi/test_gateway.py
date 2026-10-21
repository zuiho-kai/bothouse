"""网关的离线测试：Ogg 封装/拆包、协议帧头、Opus 往返（有 ffmpeg 才跑）、服务端 VAD。"""
import asyncio
import io
import math
import os
import shutil
import struct
import subprocess
import sys
import unittest
from types import SimpleNamespace
from unittest.mock import patch
import wave
from pathlib import Path
from aiohttp.test_utils import TestClient, TestServer

sys.path.insert(0, str(Path(__file__).parent))
import gateway as g  # noqa: E402

FFMPEG = os.environ.get('FFMPEG') or shutil.which('ffmpeg')


def tone(seconds=1.0, rate=16000):
    buf = io.BytesIO()
    with wave.open(buf, 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(b''.join(struct.pack('<h', int(8000 * math.sin(2 * math.pi * 440 * i / rate)))
                               for i in range(int(seconds * rate))))
    return buf.getvalue()


class OggTest(unittest.TestCase):
    def test_mux_then_demux_returns_same_packets(self):
        packets = [bytes([i]) * (i * 37 % 400 + 1) for i in range(20)]
        out = g.ogg_packets(g.opus_to_ogg(packets))
        self.assertTrue(out[0].startswith(b'OpusHead'))
        self.assertTrue(out[1].startswith(b'OpusTags'))
        self.assertEqual(out[2:], packets)

    def test_page_crc_matches_reference_vector(self):
        # 改一个字节 CRC 必须变，且整页 CRC 字段清零后重算等于写入值
        page = g._ogg_page(b'abc', 1, 0, 0, 2)
        raw = bytearray(page)
        stored = struct.unpack_from('<I', raw, 22)[0]
        struct.pack_into('<I', raw, 22, 0)
        self.assertEqual(g.ogg_crc(bytes(raw)), stored)

    def test_protocol_headers_round_trip(self):
        p = b'\x01\x02\x03'
        for v in (1, 2, 3):
            self.assertEqual(g.strip_header(g.add_header(p, v), v), p)


class SplitCnasTest(unittest.TestCase):
    def test_split_keeps_frames_and_skips_states(self):
        def seg(name, frames, index):
            return struct.pack('<16sBHI', name.encode().ljust(16, b'\0'), 10, len(frames), index)
        frames = {'idle': [b'\xff\xd8a\xff\xd9'], 'happy': [b'\xff\xd8bb\xff\xd9', b'\xff\xd8ccc\xff\xd9']}
        head = 8 + 23 * 2
        idx_idle, idx_happy = head, head + 8
        data = head + 8 * 3
        blob = struct.pack('<4sHH', b'CNAS', 1, 2) + seg('idle', frames['idle'], idx_idle) + seg('happy', frames['happy'], idx_happy)
        payload, entries = b'', b''
        for f in frames['idle'] + frames['happy']:
            entries += struct.pack('<II', data + len(payload), len(f))
            payload += f
        out = g.split_cnas(blob + entries + payload, {'idle'})
        self.assertEqual(list(out), ['happy'])
        one = out['happy']
        self.assertEqual(one[:4], b'CNAS')
        self.assertEqual(struct.unpack_from('<H', one, 6)[0], 1)
        _, _, n, index = struct.unpack_from('<16sBHI', one, 8)
        got = [one[o:o + l] for o, l in (struct.unpack_from('<II', one, index + 8 * k) for k in range(n))]
        self.assertEqual(got, frames['happy'])


class IdleClipPoolTest(unittest.TestCase):
    def test_successive_downloads_never_repeat(self):
        clips = {name: name.encode() for name in ('curious', 'doze', 'happy', 'pout', 'shy', 'yawn')}
        pool = g.IdleClipPool(clips)
        previous = None
        for _ in range(200):
            name, data = pool.next()
            self.assertNotEqual(name, previous)
            self.assertEqual(data, clips[name])
            previous = name

    def test_two_clips_alternate_on_repeated_requests(self):
        pool = g.IdleClipPool({'happy': b'h', 'shy': b's'})
        with patch.object(g.random, 'choice', side_effect=lambda names: names[0]):
            self.assertEqual([pool.next()[1] for _ in range(4)], [b'h', b's', b'h', b's'])

    def test_single_clip_is_allowed_and_empty_pool_is_explicit(self):
        pool = g.IdleClipPool({'happy': b'h'})
        self.assertEqual(pool.next(), ('happy', b'h'))
        self.assertEqual(pool.next(), ('happy', b'h'))
        with self.assertRaises(LookupError):
            g.IdleClipPool({}).next()

    def test_can_choose_every_clip_without_dropping_names(self):
        pool = g.IdleClipPool({'happy': b'h', 'shy': b's', 'doze': b'd'})
        with patch.object(g.random, 'choice', side_effect=lambda names: names[-1]):
            self.assertEqual(pool.next()[0], 'doze')
            self.assertEqual(pool.next()[0], 'shy')
            self.assertEqual(pool.next()[0], 'doze')


class IdleClipHttpTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.clips = {'happy': b'happy-cnas', 'shy': b'shy-cnas'}
        config = {'ffmpeg': 'unused', 'upstream': 'http://127.0.0.1:1',
                  'device_id': 'test', 'secret': 'test', 'project': 'test',
                  'clips_pack': 'fixture', 'role_name': '肥鱼'}
        with patch.object(g.Path, 'read_bytes', return_value=b'fixture'), \
                patch.object(g, 'split_cnas', return_value=self.clips):
            app = g.build_app(config)
        self.client = TestClient(TestServer(app))
        await self.client.start_server()

    async def asyncTearDown(self):
        await self.client.close()

    async def test_next_downloads_real_segments_without_repeats_or_cache(self):
        previous = None
        for _ in range(12):
            response = await self.client.get('/xiaozhi/clip/next')
            self.assertEqual(response.status, 200)
            name = response.headers['X-Conest-Clip']
            self.assertNotEqual(name, previous)
            self.assertEqual(await response.read(), self.clips[name])
            self.assertEqual(response.headers['Cache-Control'], 'no-store')
            previous = name

    async def test_named_download_and_missing_clip(self):
        response = await self.client.get('/xiaozhi/clip/happy')
        self.assertEqual(await response.read(), b'happy-cnas')
        self.assertEqual((await self.client.get('/xiaozhi/clip/unknown')).status, 404)

    async def test_empty_pool_returns_404(self):
        self.clips.clear()
        self.assertEqual((await self.client.get('/xiaozhi/clip/next')).status, 404)

    async def test_handshake_preserves_role_and_advertises_random_entry(self):
        ws = await self.client.ws_connect(g.WS_PATH)
        await ws.send_json({'type': 'hello'})
        self.assertEqual((await ws.receive_json())['type'], 'hello')
        clips = (await ws.receive_json())['conest_clips']
        self.assertEqual(clips['name'], '肥鱼')
        self.assertEqual(clips['names'], ['next'])
        self.assertEqual((clips['min_s'], clips['max_s']), (20, 45))
        await ws.close()


@unittest.skipUnless(FFMPEG, '需要 ffmpeg')
class OpusRoundTripTest(unittest.TestCase):
    def test_encode_then_decode_keeps_duration(self):
        codec = g.Codec(FFMPEG)
        packets = codec.encode(tone(1.2))
        self.assertGreater(len(packets), 15)
        # 下行是 24k；网关解码按上行 16k 输出，时长应接近原长
        wav = codec.decode(packets)
        self.assertAlmostEqual(g.wav_seconds(wav), 1.2, delta=0.15)


def pcm_frame(amplitude: int) -> bytes:
    """一帧 60ms 16k 的 440Hz 正弦，amplitude=0 是全静音。"""
    return b''.join(struct.pack('<h', int(amplitude * math.sin(2 * math.pi * 440 * i / 16000)))
                    for i in range(g.FRAME_SAMPLES))


LOUD, QUIET = -15.0, -60.0


def run_vad(cfg, levels):
    vad = g.EndOfSpeech(cfg)
    events = []
    for i, db in enumerate(levels):
        e = vad.feed(db)
        if e:
            events.append((i, e))
            if e in ('end', 'max', 'no_speech'):
                break
    return events


class VadTest(unittest.TestCase):
    def test_frame_levels(self):
        loud, silent = g.frame_levels(pcm_frame(16000) + pcm_frame(0))
        self.assertAlmostEqual(loud, 20 * math.log10(16000 / math.sqrt(2) / 32768), delta=0.5)
        self.assertLess(silent, -80)

    def test_speech_then_800ms_silence_ends(self):
        cfg = g.VadConfig()
        levels = [QUIET] * 5 + [LOUD] * 20 + [QUIET] * 30
        events = run_vad(cfg, levels)
        self.assertEqual(events[0], (5 + 2, 'speech'))  # 180ms = 3 帧
        end_at = events[-1][0]
        self.assertEqual(events[-1][1], 'end')
        # 最后一帧有声是 24，静音 800ms 向上取整 = 14 帧
        self.assertEqual(end_at, 24 + 14)

    def test_short_pause_does_not_end(self):
        cfg = g.VadConfig()
        levels = [LOUD] * 10 + [QUIET] * 8 + [LOUD] * 10 + [QUIET] * 20
        events = run_vad(cfg, levels)
        self.assertEqual([e for _, e in events], ['speech', 'end'])
        self.assertEqual(events[-1][0], 27 + 14)

    def test_click_is_not_speech(self):
        cfg = g.VadConfig(no_speech_sec=1.2)
        levels = [QUIET] * 3 + [LOUD] * 2 + [QUIET] * 30
        self.assertEqual(run_vad(cfg, levels), [(19, 'no_speech')])  # 1.2s = 20 帧

    def test_noise_floor_raises_threshold(self):
        cfg = g.VadConfig(no_speech_sec=0)
        vad = g.EndOfSpeech(cfg)
        for _ in range(40):  # 先听 2.4s 的 -40dB 底噪（比绝对门限 -45 高）
            if vad.feed(-40.0) in ('end', 'max'):
                vad.reset()  # 底噪学会之前可能误判一小段，之后就不会了
        vad.reset()
        self.assertEqual([vad.feed(-40.0) for _ in range(40)], [None] * 40)
        # 比底噪高不到 10dB 不算说话，高 10dB 以上才算
        self.assertEqual([vad.feed(-32.0) for _ in range(5)], [None] * 5)
        self.assertEqual([vad.feed(-20.0) for _ in range(3)], [None, None, 'speech'])

    def test_max_utterance(self):
        cfg = g.VadConfig(max_utterance_sec=1.2)
        events = run_vad(cfg, [LOUD] * 100)
        self.assertEqual(events[-1], (19, 'max'))

    def test_config_from_dict(self):
        self.assertEqual(g.VadConfig.from_dict({'silence_ms': 600}).silence_ms, 600)
        self.assertEqual(g.VadConfig.from_dict(None), g.VadConfig())
        with self.assertRaises(ValueError):
            g.VadConfig.from_dict({'silence': 600})


class FakeWs:
    closed = False

    def __init__(self):
        self.sent = []

    async def send_json(self, msg):
        self.sent.append(msg)


class FakeCodec:
    """包内容 b'S' = 有声帧，b'Q' = 静音帧；decode_pcm 原样还原成 PCM。"""

    def decode_pcm(self, packets):
        return b''.join(pcm_frame(16000 if p == b'S' else 0) for p in packets)


class FakeSession(g.Session):
    def __init__(self, cfg):
        self.turns = []
        super().__init__(FakeWs(), 1, None, FakeCodec(), cfg)

    async def abort(self, why):
        pass

    async def _run_turn(self, packets):
        self.turns.append(packets)


class SessionVadTest(unittest.TestCase):
    def feed(self, s, packets):
        async def go():
            for p in packets:
                s.on_audio(p)
                await asyncio.sleep(0)
                if s.vad_task:
                    await s.vad_task
                if s.task:
                    await s.task
        return go()

    def test_wake_session_ends_on_silence_and_rearms(self):
        async def main():
            s = FakeSession(g.VadConfig())
            await s.on_text({'type': 'listen', 'state': 'detect', 'text': 'ni hao xi jiang'})
            await s.on_text({'type': 'listen', 'state': 'start', 'mode': 'realtime'})
            self.assertTrue(s.auto)
            await self.feed(s, [b'Q'] * 3 + [b'S'] * 12 + [b'Q'] * 18)
            self.assertEqual(len(s.turns), 1)
            self.assertEqual(s.turns[0].count(b'S'), 12)
            self.assertTrue(s.listening and s.auto)  # 播完自己继续聆听
            self.assertEqual(set(s.recorded), {b'Q'})  # 之后来的帧算下一句
        asyncio.run(main())

    def test_no_speech_sends_listen_stop(self):
        async def main():
            s = FakeSession(g.VadConfig(no_speech_sec=1.2))
            await s.on_text({'type': 'listen', 'state': 'start', 'mode': 'auto'})
            await self.feed(s, [b'Q'] * 24)
            self.assertEqual(s.turns, [])
            self.assertFalse(s.listening)
            self.assertIn({'type': 'listen', 'state': 'stop', 'session_id': s.id}, s.ws.sent)
        asyncio.run(main())

    def test_manual_mode_waits_for_release(self):
        async def main():
            s = FakeSession(g.VadConfig())
            await s.on_text({'type': 'listen', 'state': 'start', 'mode': 'manual'})
            self.assertFalse(s.auto)
            await self.feed(s, [b'S'] * 10 + [b'Q'] * 30)
            self.assertEqual(s.turns, [])  # 静音再久也不自己结束
            await s.on_text({'type': 'listen', 'state': 'stop'})
            await s.task
            self.assertEqual(len(s.turns), 1)
            self.assertEqual(len(s.turns[0]), 40)
            self.assertFalse(s.listening)
        asyncio.run(main())

    def test_boot_during_wake_session_switches_to_manual(self):
        async def main():
            s = FakeSession(g.VadConfig())
            await s.on_text({'type': 'listen', 'state': 'start', 'mode': 'realtime'})
            await self.feed(s, [b'S'] * 5)
            await s.on_text({'type': 'listen', 'state': 'start', 'mode': 'manual'})  # 按下 BOOT
            self.assertFalse(s.auto)
            await self.feed(s, [b'S'] * 4 + [b'Q'] * 20)
            self.assertEqual(s.turns, [])
            await s.on_text({'type': 'listen', 'state': 'stop'})
            await s.task
            self.assertEqual(len(s.turns[0]), 24)
        asyncio.run(main())

    def test_vad_disabled_falls_back_to_manual(self):
        async def main():
            s = FakeSession(g.VadConfig(enabled=False))
            await s.on_text({'type': 'listen', 'state': 'start', 'mode': 'realtime'})
            self.assertFalse(s.auto)
        asyncio.run(main())


class CharacterTest(unittest.TestCase):
    def test_hello_sends_character_every_connect(self):
        async def main():
            ch = g.load_character({'name': '肥鱼', 'role': 'feiyu'})
            clips = {'base': 'http://h/xiaozhi/clip/', 'names': ['wave']}
            for _ in range(2):  # 每次重连都发
                s = g.Session(FakeWs(), 1, None, FakeCodec(), clips=clips, character=ch)
                await s.on_text({'type': 'hello'})
                self.assertIn({'type': 'rh_dial', 'name': '肥鱼', 'role': 'feiyu',
                               'conest_clips': clips, 'session_id': s.id}, s.ws.sent)
        asyncio.run(main())

    def test_character_without_clips(self):
        async def main():
            s = g.Session(FakeWs(), 1, None, FakeCodec(), character=g.load_character('C酱'))
            await s.on_text({'type': 'hello'})
            self.assertEqual(s.ws.sent[-1], {'type': 'rh_dial', 'name': 'C酱', 'session_id': s.id})
        asyncio.run(main())

    def test_no_character_no_clips_sends_no_dial(self):
        async def main():
            s = g.Session(FakeWs(), 1, None, FakeCodec())
            await s.on_text({'type': 'hello'})
            self.assertEqual([m['type'] for m in s.ws.sent], ['hello'])
        asyncio.run(main())

    def test_explicit_wake_words(self):
        ch = g.load_character({'name': '小新', 'wake_words': [
            {'command': 'ni hao xiao xin', 'text': '你好小新'}, 'xiao xin xiao xin']})
        self.assertEqual(g.character_dial(ch), {'name': '小新', 'conest_wake_words': [
            {'command': 'ni hao xiao xin', 'text': '你好小新'},
            {'command': 'xiao xin xiao xin', 'text': 'xiao xin xiao xin'}]})

    def test_bad_character_config(self):
        with self.assertRaises(ValueError):
            g.load_character({'name': '肥鱼', 'wake': []})
        with self.assertRaises(ValueError):
            g.load_character({'name': '肥鱼', 'wake_words': ['你好肥鱼']})
        with self.assertRaises(ValueError):
            g.load_character({'name': '肥鱼', 'wake_words': ['Ni Hao']})
        self.assertEqual(g.load_character(None), {})


@unittest.skipUnless(FFMPEG, '需要 ffmpeg')
class VadWithRealOpusTest(unittest.TestCase):
    def test_levels_survive_opus_windows(self):
        """真 Opus：响-静的录音按 3 帧一窗解码（垫一帧），电平仍能分出说话和静音。"""
        codec = g.Codec(FFMPEG)
        buf = io.BytesIO()
        with wave.open(buf, 'wb') as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(16000)
            w.writeframes(pcm_frame(12000) * 15 + pcm_frame(0) * 15)
        p = subprocess.run([FFMPEG, '-loglevel', 'error', '-i', 'pipe:0', '-ac', '1', '-ar', '16000',
                            '-c:a', 'libopus', '-frame_duration', '60', '-f', 'ogg', 'pipe:1'],
                           input=buf.getvalue(), capture_output=True, check=True)
        packets = [x for x in g.ogg_packets(p.stdout) if not x.startswith((b'OpusHead', b'OpusTags'))]

        async def main():
            s = g.Session(FakeWs(), 1, None, codec, g.VadConfig())
            turns = []

            async def fake_turn(pk):
                turns.append(pk)
            s._run_turn = fake_turn
            s.abort = lambda why: asyncio.sleep(0)
            await s.on_text({'type': 'listen', 'state': 'start', 'mode': 'realtime'})
            for pk in packets:
                s.on_audio(pk)
                if s.vad_task:
                    await s.vad_task
                if s.task:
                    await s.task
            return turns
        turns = asyncio.run(main())
        self.assertEqual(len(turns), 1)



class RecognitionStateTest(unittest.IsolatedAsyncioTestCase):
    async def test_waiting_pose_precedes_slow_recognition_and_empty_resets_it(self):
        ws = FakeWs()
        class Codec:
            def decode(self, packets):
                return b'wav'
        class Up:
            async def transcribe(inner, wav):
                self.assertTrue(any(m.get('emotion') == 'thinking' for m in ws.sent))
                return ''
        s = g.Session(ws, 1, Up(), Codec(), None)
        await s._run_turn([b'x'] * 30)
        self.assertEqual(ws.sent[-2].get('emotion'), 'neutral')
        self.assertEqual(ws.sent[-1].get('state'), 'stop')

    async def test_failed_recognition_leaves_waiting_pose(self):
        ws = FakeWs()
        at_recognition = []
        class Codec:
            def decode(self, packets):
                return b'wav'
        class Up:
            async def transcribe(inner, wav):
                at_recognition.extend(ws.sent)
                raise RuntimeError('recognition unavailable')
        s = g.Session(ws, 1, Up(), Codec(), None)
        await s._run_turn([b'x'] * 30)
        self.assertTrue(any(m.get('emotion') == 'thinking' for m in at_recognition))
        self.assertEqual(ws.sent[-2].get('emotion'), 'sad')
        self.assertEqual(ws.sent[-1].get('state'), 'stop')


class PlayErrorTest(unittest.IsolatedAsyncioTestCase):
    async def test_failed_turn_replaces_thinking_pose(self):
        class Up:
            async def status(self, turn):
                return {'status': 'error', 'error': '伙伴本轮没有可播放的完整回答。'}
        ws = FakeWs()
        s = g.Session(ws, 1, Up(), FakeCodec(), None)
        await s.play('t1', 0.0)
        kinds = [(m.get('type'), m.get('state') or m.get('emotion')) for m in ws.sent]
        self.assertIn(('alert', 'sad'), kinds)
        self.assertEqual(kinds[-1], ('tts', 'stop'))


class PlayStoppedTest(unittest.IsolatedAsyncioTestCase):
    async def test_stopped_turn_leaves_thinking_pose(self):
        class Up:
            async def status(self, turn):
                return {'status': 'stopped'}
        ws = FakeWs()
        await g.Session(ws, 1, Up(), FakeCodec(), None).play('t1', 0.0)
        self.assertIn(('llm', 'neutral'), [(m.get('type'), m.get('emotion')) for m in ws.sent])



class FirstPacketTimingTest(unittest.IsolatedAsyncioTestCase):
    async def test_first_packet_metric_excludes_rest_of_chunk_pacing(self):
        clock = [10.0]
        first_packet_at = []
        receipts = []

        class Ws(FakeWs):
            async def send_bytes(self, packet):
                if not first_packet_at:
                    first_packet_at.append(clock[0])

        class Codec:
            def encode(self, wav):
                clock[0] += .05
                return [b'opus'] * 50

        class Up:
            async def status(self, turn):
                return {'status': 'ready', 'audio_complete': True,
                        'playback_allowed': True,
                        'audio_chunks': [{'index': 0, 'duration_seconds': 3}]}

            async def chunk(self, turn, index):
                clock[0] += .10
                return b'wav'

            async def receipt(self, turn, state, offset, end):
                receipts.append((state, clock[0]))

        async def sleep(delay):
            clock[0] += max(0, delay)

        ws = Ws()
        with patch.object(g, 'time', SimpleNamespace(monotonic=lambda: clock[0])), \
                patch.object(g.asyncio, 'sleep', side_effect=sleep), \
                self.assertLogs(g.log, level='INFO') as logs:
            await g.Session(ws, 1, Up(), Codec(), None).play('private', 2.0)
        metrics = [line for line in logs.output if 'first_audio_packet' in line]
        self.assertEqual(len(metrics), 1)
        self.assertIn('"since_submit_ms": 8150', metrics[0])
        self.assertIn('"encode_ms": 50', metrics[0])
        # The 3s chunk is still paced: only the board lead (PRE_BUFFER frames) is sent ahead.
        self.assertGreater(receipts[0][1] - first_packet_at[0], 3 - g.PRE_BUFFER * g.FRAME_SEC - .1)
        self.assertEqual(receipts[-1][0], 'completed')

    async def test_empty_encoder_output_never_starts_speaking(self):
        class Up:
            async def status(self, turn):
                return {'status': 'ready', 'audio_complete': True,
                        'playback_allowed': True,
                        'audio_chunks': [{'index': 0, 'duration_seconds': 1}]}
            async def chunk(self, turn, index):
                return b'wav'
            async def receipt(self, turn, state, offset, end):
                pass
        class Codec:
            def encode(self, wav):
                return []
        ws = FakeWs()
        with self.assertRaisesRegex(ValueError, 'Opus'):
            await g.Session(ws, 1, Up(), Codec(), None).play('private', 0.0)
        self.assertNotIn(('tts', 'start'), [(m.get('type'), m.get('state')) for m in ws.sent])


class FailedPlaybackCleanupTest(unittest.IsolatedAsyncioTestCase):
    def make_session(self):
        class Codec:
            def decode(self, packets):
                return b"wav"
            def encode(self, wav):
                return []
        class Up:
            def __init__(self):
                self.stop_calls = []
                self.fail_stop = False
                self.receipts = []
            async def transcribe(self, wav):
                return "test"
            async def submit(self, text):
                return "turn-1"
            async def status(self, turn):
                return {"status": "ready", "audio_complete": True,
                        "playback_allowed": True,
                        "audio_chunks": [{"index": 0, "duration_seconds": 1}]}
            async def chunk(self, turn, index):
                return b"wav"
            async def stop(self, turn):
                self.stop_calls.append(turn)
                if self.fail_stop:
                    raise RuntimeError("offline")
            async def receipt(self, *args):
                self.receipts.append(args)
        return g.Session(FakeWs(), 1, Up(), Codec(), None)

    async def test_empty_encoding_releases_upstream_without_completed_receipt(self):
        s = self.make_session()
        await s._run_turn([b"x"] * 30)
        self.assertEqual(s.up.stop_calls, ["turn-1"])
        self.assertIsNone(s.turn)
        self.assertEqual(s.up.receipts, [])
        self.assertNotIn(("tts", "start"), [(m.get("type"), m.get("state")) for m in s.ws.sent])

    async def test_failed_stop_blocks_rearm_and_next_listen_until_stop_succeeds(self):
        s = self.make_session()
        s.auto = True
        s.up.fail_stop = True
        await s.run_turn([b"x"] * 30, rearm=True)
        self.assertEqual(s.turn, "turn-1")
        self.assertFalse(s.listening)
        await s.on_text({"type": "listen", "state": "start"})
        self.assertFalse(s.listening)
        self.assertEqual(s.turn, "turn-1")
        s.up.fail_stop = False
        await s.on_text({"type": "listen", "state": "start"})
        self.assertTrue(s.listening)
        self.assertIsNone(s.turn)
        self.assertEqual(s.up.stop_calls, ["turn-1"] * 3)

    async def test_cancelled_task_cannot_discard_failed_stop_handle(self):
        s = self.make_session()
        entered = asyncio.Event()
        async def play(*args, **kwargs):
            entered.set()
            await asyncio.Future()
        s.play = play
        s.up.fail_stop = True
        s.task = asyncio.create_task(s.run_turn([b"x"] * 30))
        await entered.wait()
        self.assertFalse(await s.abort("cancel"))
        with self.assertRaises(asyncio.CancelledError):
            await s.task
        self.assertEqual(s.turn, "turn-1")
        s.up.fail_stop = False
        self.assertTrue(await s.abort("retry stop"))
        self.assertIsNone(s.turn)
    async def test_cancel_during_error_cleanup_preserves_unconfirmed_handle(self):
        s = self.make_session()
        entered = asyncio.Event()
        calls = []
        async def stop(turn):
            calls.append(turn)
            if len(calls) == 1:
                entered.set()
                await asyncio.Future()
            raise RuntimeError("offline")
        s.up.stop = stop
        s.task = asyncio.create_task(s.run_turn([b"x"] * 30))
        await entered.wait()
        self.assertFalse(await s.abort("cancel during cleanup"))
        with self.assertRaises(asyncio.CancelledError):
            await s.task
        self.assertEqual(s.turn, "turn-1")
        await s.on_text({"type": "listen", "state": "start"})
        self.assertFalse(s.listening)
        self.assertEqual(calls, ["turn-1"] * 3)


class GrokPresetTest(unittest.TestCase):
    def test_grokball_gets_grok_wake_words(self):
        ch = g.load_character({'name': 'Grok', 'role': 'grokball'})
        self.assertEqual([w['command'] for w in ch['wake_words']], ['ni hao ge luo ke', 'ge luo ke ge luo ke'])
        self.assertNotIn('wake_words', g.load_character({'name': '肥鱼', 'role': 'feiyu'}))



class PreBufferTest(unittest.TestCase):
    def test_lead_covers_a_chunk_gap_and_fits_board_queue(self):
        # A chunk is ~0.6s; fetching and encoding the next one must not drain the board.
        self.assertGreaterEqual(g.PRE_BUFFER * g.FRAME_MS, 800)
        # Never push more than the firmware decode queue holds (it would drop packets).
        self.assertLess(g.PRE_BUFFER, g.BOARD_DECODE_QUEUE_FRAMES)

if __name__ == '__main__':
    unittest.main()
