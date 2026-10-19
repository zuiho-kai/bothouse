"""CNAS 打包工具的主机侧测试（不需要 ESP-IDF，也不需要板子）。

    cd firmware/esp32s3 && python3 -m unittest discover -s tests -p 'test_*.py'

需要 ffmpeg 的端到端用例会读 FFMPEG_PATH 或 PATH；找不到就跳过，并明确
说明跳过了什么，不把「跳过」当「通过」。
"""
from __future__ import annotations

import io
import os
from pathlib import Path
import struct
import subprocess
import sys
import tempfile
import unittest

try:
    from PIL import Image, ImageDraw, JpegImagePlugin
except ImportError:  # pragma: no cover - 只在缺 Pillow 的机器上走到
    Image = None
    JpegImagePlugin = None

if Image is None:
    raise unittest.SkipTest(
        "跳过 CNAS 打包测试：没有 Pillow。pip install pillow 后再跑（打包工具本身需要它）。")

TOOLS = Path(__file__).resolve().parents[1] / "tools"
REPO_ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(TOOLS))

import pack_assets as pa  # noqa: E402


def synthetic_segment(name: str, frames: int, fps: int = 12,
                      payload: bytes = b"\xff\xd8\xff\xd9") -> pa.Segment:
    """不经过 ffmpeg 的假片段，只用来验证容器布局。"""
    clip = pa.Clip(key=name, src=f"{name}.mp4", scale=1.0, tx=0.0, ty=0.0,
                   start=0.0, end=None, bg="#000000")
    seg = pa.Segment(name=name, clip=clip, src_path=Path(f"{name}.mp4"),
                     src_w=720, src_h=720, fps=fps)
    seg.jpegs = [payload + bytes([i]) for i in range(frames)]
    return seg


def jpeg_markers(data: bytes) -> list[int]:
    """返回 JPEG 里的 SOFn 标记值（0xC0 baseline / 0xC2 progressive）。"""
    found = []
    i = 2  # 跳过 SOI
    while i + 3 < len(data):
        if data[i] != 0xFF:
            i += 1
            continue
        marker = data[i + 1]
        if marker in (0xD8, 0xD9) or 0xD0 <= marker <= 0xD7:
            i += 2
            continue
        if marker == 0xDA:  # SOS，后面是熵编码数据，不再解析
            break
        length = struct.unpack_from(">H", data, i + 2)[0]
        if 0xC0 <= marker <= 0xCF and marker not in (0xC4, 0xC8, 0xCC):
            found.append(marker)
        i += 2 + length
    return found


class ContainerLayoutTests(unittest.TestCase):
    def test_header_and_table_are_little_endian_and_unpadded(self):
        segments = [synthetic_segment("idle", 3), synthetic_segment("thinking", 2, fps=10)]
        blob = pa.pack(segments)

        self.assertEqual(blob[:4], b"CNAS")
        version, count = struct.unpack_from("<HH", blob, 4)
        self.assertEqual((version, count), (1, 2))

        # 片段表紧接头部，每项 23 字节、无填充。
        first = struct.unpack_from("<16sBHI", blob, 8)
        self.assertEqual(first[0].rstrip(b"\0"), b"idle")
        self.assertEqual(first[1], 12)
        self.assertEqual(first[2], 3)
        second = struct.unpack_from("<16sBHI", blob, 8 + 23)
        self.assertEqual(second[0].rstrip(b"\0"), b"thinking")
        self.assertEqual(second[1], 10)
        self.assertEqual(second[2], 2)

        # 第一个索引表紧跟在片段表之后。
        self.assertEqual(first[3], 8 + 23 * 2)
        # 第二个索引表紧跟在第一个之后。
        self.assertEqual(second[3], 8 + 23 * 2 + 8 * 3)

    def test_frame_offsets_point_at_the_actual_jpeg_bytes(self):
        segments = [synthetic_segment("idle", 2), synthetic_segment("speaking", 3)]
        blob = pa.pack(segments)
        back = pa.unpack(blob)

        self.assertEqual([s.name for s in back], ["idle", "speaking"])
        for seg, original in zip(back, segments):
            self.assertEqual(len(seg.frames), len(original.jpegs))
            for frame, payload in zip(seg.frames, original.jpegs):
                self.assertEqual(blob[frame.offset:frame.offset + frame.length], payload)

    def test_round_trip_reports_same_frame_counts(self):
        segments = [synthetic_segment("idle", 5), synthetic_segment("listening", 1),
                    synthetic_segment("speaking", 4)]
        back = pa.unpack(pa.pack(segments))
        self.assertEqual([len(s.frames) for s in back], [5, 1, 4])
        self.assertEqual([s.fps for s in back], [12, 12, 12])

    def test_name_longer_than_field_is_rejected(self):
        with self.assertRaises(pa.PackError):
            pa.pack([synthetic_segment("a" * 16, 1)])

    def test_unpack_rejects_wrong_magic(self):
        blob = bytearray(pa.pack([synthetic_segment("idle", 1)]))
        blob[0:4] = b"XXXX"
        with self.assertRaises(pa.PackError):
            pa.unpack(bytes(blob))

    def test_unpack_rejects_unknown_version(self):
        blob = bytearray(pa.pack([synthetic_segment("idle", 1)]))
        struct.pack_into("<H", blob, 4, 99)
        with self.assertRaises(pa.PackError):
            pa.unpack(bytes(blob))

    def test_unpack_rejects_truncated_file(self):
        blob = pa.pack([synthetic_segment("idle", 2)])
        with self.assertRaises(pa.PackError):
            pa.unpack(blob[:-3])

    def test_unpack_rejects_non_jpeg_payload(self):
        seg = synthetic_segment("idle", 1, payload=b"not-a-jpeg")
        with self.assertRaises(pa.PackError):
            pa.unpack(pa.pack([seg]))


class WebParityTests(unittest.TestCase):
    """裁切必须和网页圆屏同源，否则板端和网页对不上。"""

    @classmethod
    def setUpClass(cls):
        cls.source = REPO_ROOT / "prototypes/device-ui/source.html"
        if not cls.source.is_file():
            raise unittest.SkipTest(f"找不到 {cls.source}")
        cls.clips = pa.load_web_clips(cls.source, "gpt")
        cls.chars = REPO_ROOT / "prototypes/device-ui/assets/characters/gpt"

    def test_reads_the_same_numbers_as_source_html(self):
        idle = self.clips["idle"]
        self.assertEqual(Path(idle.src).name, "idle-blink-square-v1.mp4")
        self.assertAlmostEqual(idle.scale, 1.18)
        self.assertAlmostEqual(idle.tx, 1.8)
        self.assertAlmostEqual(idle.ty, 1.5)
        self.assertAlmostEqual(idle.start, 4.65)
        self.assertAlmostEqual(idle.end, 9.9)
        self.assertEqual(idle.bg, "#242827")

    def test_thinking_uses_the_question_clip_by_default(self):
        segs = pa.select_segments(self.clips, self.chars, "question", extras=0, seed=0)
        self.assertEqual([s.name for s in segs], ["idle", "listening", "thinking", "speaking"])
        thinking = segs[2].clip
        self.assertEqual(thinking.key, "thinking_question")
        self.assertAlmostEqual(thinking.end, 3.96)

    def test_thinking_calm_is_available(self):
        segs = pa.select_segments(self.clips, self.chars, "calm", extras=0, seed=0)
        self.assertEqual(segs[2].clip.key, "thinking_calm")
        self.assertAlmostEqual(segs[2].clip.end, 1.18)

    def test_extras_are_bounded_and_reproducible(self):
        two = pa.select_segments(self.clips, self.chars, "question", extras=2, seed=0)
        again = pa.select_segments(self.clips, self.chars, "question", extras=2, seed=0)
        self.assertEqual(len(two), 6)
        self.assertEqual([s.name for s in two], [s.name for s in again])
        # 固定 seed 的抽样必须是确定的，打包才能复现。
        other_seed = pa.select_segments(self.clips, self.chars, "question", extras=2, seed=7)
        self.assertEqual(len(other_seed), 6)

    def test_zero_extras_keeps_only_the_four_states(self):
        segs = pa.select_segments(self.clips, self.chars, "question", extras=0, seed=0)
        self.assertEqual(len(segs), 4)

    def test_board_plan_only_shrinks_idle(self):
        """C酱 定的落板口径：只缩 idle，另外三段保持完整。

        listening / thinking / speaking 都是首尾闭合的整圈循环，截一半会在
        循环接缝处跳帧，所以一律不截。
        """
        segs = pa.select_segments(self.clips, self.chars, "question", extras=0, seed=0)
        got = {seg.name: (seg.start, seg.end) for seg in segs}

        idle_start, idle_end = got["idle"]
        self.assertAlmostEqual(idle_start, 6.9, places=3)
        self.assertAlmostEqual(idle_end, 9.65, places=3)
        self.assertGreaterEqual(idle_end - idle_start, pa.IDLE_SEARCH_MIN - 1e-6)
        self.assertLessEqual(idle_end - idle_start, pa.IDLE_SEARCH_MAX + 1e-6)

        # 另外三段必须和 source.html 完全一致（整段，不截）。
        for name, key in (("listening", "listening"),
                          ("thinking", "thinking_question"),
                          ("speaking", "speaking")):
            self.assertEqual(got[name], (self.clips[key].start, self.clips[key].end))

    def test_idle_range_stays_inside_the_web_clip(self):
        """只缩板端这一份，不能越出 source.html 里 idle 的取用区间。"""
        idle = self.clips["idle"]
        start, end = pa.BOARD_PLAN["idle"]["range"]
        self.assertGreaterEqual(start, idle.start - 1e-9)
        self.assertLessEqual(end, idle.end + 1e-9)

    def test_board_range_override_wins_over_the_default(self):
        segs = pa.select_segments(self.clips, self.chars, "question", extras=0, seed=0,
                                  overrides={"idle": (5.0, 7.5)})
        idle = next(seg for seg in segs if seg.name == "idle")
        self.assertEqual((idle.start, idle.end), (5.0, 7.5))

    def test_parse_board_range(self):
        self.assertEqual(pa.parse_board_range("idle=6.9,9.65"), ("idle", 6.9, 9.65))
        self.assertEqual(pa.parse_board_range(" idle = 6 , 9.6 "), ("idle", 6.0, 9.6))
        for bad in ("idle", "idle=6.9", "idle=9,6", "=1,2"):
            with self.assertRaises(pa.PackError):
                pa.parse_board_range(bad)

    def test_full_length_opt_out_restores_whole_clips(self):
        segs = pa.select_segments(self.clips, self.chars, "question", extras=0,
                                  seed=0, full_length=True)
        idle = next(seg for seg in segs if seg.name == "idle")
        self.assertEqual((idle.start, idle.end), (self.clips["idle"].start,
                                                  self.clips["idle"].end))

    def test_range_beyond_the_clip_is_rejected(self):
        """取帧越界要报错，不能让 ffmpeg 悄悄少给帧。"""
        seg = pa.Segment(name="idle", clip=self.clips["idle"],
                         src_path=Path("x.mp4"), src_w=720, src_h=720,
                         src_duration=10.0, start=4.65, end=99.0)
        with tempfile.TemporaryDirectory() as tmp:
            cache = pa.FrameCache("ffmpeg", Path(tmp))
            with self.assertRaises(pa.PackError) as ctx:
                cache.frames(seg, 12)
            self.assertIn("只有", str(ctx.exception))

    def test_placement_matches_hand_computed_crop(self):
        """idle: scale 1.18 / tx 1.8% / ty 1.5%，720² 源 → 610px 取景框。"""
        place = pa.placement(self.clips["idle"], 720, 720)
        self.assertAlmostEqual(place.side, 720 / 1.18, places=3)
        self.assertAlmostEqual(place.x0, 43.93, places=1)
        self.assertAlmostEqual(place.y0, 45.76, places=1)
        self.assertEqual((place.src_x, place.src_y), (43, 45))
        # 取到的那块必须盖满取景框（右缘 654.1、下缘 655.9），不多不少。
        self.assertGreaterEqual(place.src_x + place.src_w, int(place.x0 + place.side))
        self.assertGreaterEqual(place.src_y + place.src_h, int(place.y0 + place.side))
        self.assertLessEqual(place.src_x + place.src_w, 720)
        self.assertLessEqual(place.src_y + place.src_h, 720)

    def test_placement_keeps_the_background_strip_instead_of_clamping(self):
        """thinking 的 ty=+6.2% 会在顶部留约 22px 底色，不能靠夹紧取景框糊过去。

        夹紧会让整幅画面下移，人物和问号位置跟网页对不上。
        """
        place = pa.placement(self.clips["thinking_question"], 720, 720)
        self.assertLess(place.x0, 0)
        self.assertLess(place.y0, 0)
        strip_px = -place.y0 / place.side * pa.SCREEN
        self.assertGreater(strip_px, 20)
        self.assertLess(strip_px, 24)

    def test_render_frame_fills_uncovered_area_with_clip_background(self):
        clip = self.clips["thinking_question"]
        frame = pa.render_frame(Image.new("RGB", (720, 720), (255, 255, 255)), clip)
        self.assertEqual(frame.size, (pa.SCREEN, pa.SCREEN))
        # 顶部留白必须是片段底色，不是视频内容。
        expected = tuple(int(clip.bg[i:i + 2], 16) for i in (1, 3, 5))
        self.assertEqual(frame.getpixel((pa.SCREEN // 2, 2)), expected)
        self.assertEqual(frame.getpixel((pa.SCREEN // 2, pa.SCREEN // 2)), (255, 255, 255))

    def test_render_frame_puts_content_where_the_web_would(self):
        """源画面正中心的方块必须落在网页公式算出的位置。

        网页：screen = half + t + s * (elem - half)，elem = 源坐标 * cover。
        偏 1px 就说明裁切取了整，人物会和网页错位。
        """
        clip = self.clips["idle"]
        src = Image.new("RGB", (720, 720), (0, 0, 0))
        ImageDraw.Draw(src).rectangle([350, 350, 369, 369], fill=(255, 255, 255))
        frame = pa.render_frame(src, clip)

        cover = pa.SCREEN / 720
        half = pa.SCREEN / 2.0
        expected_x = half + clip.tx / 100.0 * pa.SCREEN + clip.scale * (359.5 * cover - half)
        expected_y = half + clip.ty / 100.0 * pa.SCREEN + clip.scale * (359.5 * cover - half)

        xs, ys, count = 0, 0, 0
        for y in range(pa.SCREEN):
            for x in range(pa.SCREEN):
                if min(frame.getpixel((x, y))) > 200:
                    xs += x
                    ys += y
                    count += 1
        self.assertGreater(count, 0)
        self.assertAlmostEqual(xs / count, expected_x, delta=0.5)
        self.assertAlmostEqual(ys / count, expected_y, delta=0.5)

    def test_render_frame_matches_a_per_pixel_inverse_map(self):
        """小尺寸上直接和逐像素逆映射比：这是「网页等价」的独立实现。"""
        out = 48
        clip = self.clips["thinking_question"]
        src = Image.new("RGB", (720, 720), (30, 60, 90))
        ImageDraw.Draw(src).rectangle([0, 0, 199, 719], fill=(200, 30, 30))
        got = pa.render_frame(src, clip, out=out)

        cover = max(out / 720, out / 720)
        off = (out - 720 * cover) / 2.0
        half = out / 2.0
        bg = tuple(int(clip.bg[i:i + 2], 16) for i in (1, 3, 5))
        def want_at(x, y):
            sx = (half + (x - clip.tx / 100 * out - half) / clip.scale - off) / cover
            sy = (half + (y - clip.ty / 100 * out - half) / clip.scale - off) / cover
            if 0 <= sx < 720 and 0 <= sy < 720:
                return (200, 30, 30) if sx < 200 else (30, 60, 90)
            return bg

        expected = [[want_at(x, y) for x in range(out)] for y in range(out)]
        checked = mismatches = 0
        for y in range(out):
            for x in range(out):
                # 跳过色块边界：重采样在那里本来就会混色，跟几何对错无关。
                if any(expected[ny][nx] != expected[y][x]
                       for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1))
                       if 0 <= nx < out and 0 <= ny < out):
                    continue
                checked += 1
                px = got.getpixel((x, y))
                if max(abs(a - b) for a, b in zip(px, expected[y][x])) > 40:
                    mismatches += 1
        self.assertGreater(checked, out * out // 2, "有效比较像素太少，测试没测到东西")
        self.assertLess(mismatches, checked * 0.02,
                        f"{mismatches}/{checked} 个像素与逐像素逆映射不符")


class LadderTests(unittest.TestCase):
    def test_ladder_drops_quality_before_framerate(self):
        self.assertEqual(pa.settings_ladder(12, 80),
                         [(12, 80), (12, 75), (11, 75), (10, 75)])

    def test_ladder_never_goes_below_the_floors(self):
        for fps, quality in pa.settings_ladder(14, 90):
            self.assertGreaterEqual(fps, pa.MIN_FPS)
            self.assertGreaterEqual(quality, pa.MIN_QUALITY)

    def test_ladder_from_the_floor_is_a_single_attempt(self):
        self.assertEqual(pa.settings_ladder(10, 75), [(10, 75)])

    def test_explicit_lower_floor_is_honoured(self):
        """回归：过滤阶梯时曾误用全局下限常量，把显式下调的档位全滤掉，
        结果一帧都不抽、报「0 B 仍然超出预算」。
        """
        self.assertEqual(pa.settings_ladder(10, 70, min_fps=10, min_quality=70),
                         [(10, 70)])
        self.assertEqual(pa.settings_ladder(12, 80, min_fps=10, min_quality=70),
                         [(12, 80), (12, 70), (11, 70), (10, 70)])

    def test_start_below_floor_is_rejected(self):
        with self.assertRaises(pa.PackError):
            pa.settings_ladder(8, 80)
        with self.assertRaises(pa.PackError):
            pa.settings_ladder(12, 60)


class EndToEndTests(unittest.TestCase):
    """真跑一遍 ffmpeg：验证尺寸、baseline、帧数和预算行为。"""

    @classmethod
    def setUpClass(cls):
        explicit = os.environ.get("FFMPEG_PATH", "").strip()
        cls.ffmpeg = explicit if explicit and Path(explicit).is_file() else None
        if cls.ffmpeg is None:
            import shutil
            cls.ffmpeg = shutil.which("ffmpeg")
        if cls.ffmpeg is None:
            raise unittest.SkipTest(
                "跳过端到端用例：没有 ffmpeg。设置 FFMPEG_PATH 或把 ffmpeg 加入 PATH 后再跑。")
        cls.source = REPO_ROOT / "prototypes/device-ui/source.html"
        cls.chars = REPO_ROOT / "prototypes/device-ui/assets/characters"
        if not cls.source.is_file() or not cls.chars.is_dir():
            raise unittest.SkipTest("跳过端到端用例：仓库里没有圆屏素材。")

    def run_tool(self, *extra: str, budget_mib: float = 7.0) -> subprocess.CompletedProcess:
        cmd = [sys.executable, str(TOOLS / "pack_assets.py"),
               "--ffmpeg", self.ffmpeg,
               "--budget-mib", str(budget_mib), *extra]
        return subprocess.run(cmd, capture_output=True, text=True)

    def test_four_states_pack_and_unpack(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "assets.bin"
            report = Path(tmp) / "report.json"
            # 预算给足，只为验证产物本身，不把预算判定混进来。
            proc = self.run_tool("--out", str(out),
                                 "--report", str(report), "--verify",
                                 budget_mib=64)
            self.assertEqual(proc.returncode, 0, proc.stderr + proc.stdout)
            blob = out.read_bytes()
            self.assertTrue(report.is_file())

            segments = pa.unpack(blob)
            self.assertEqual([s.name for s in segments],
                             ["idle", "listening", "thinking", "speaking"])
            # 预算给足时用起始档 12fps：2.75s→33、4.04s→49、3.96s→48、4.04s→49。
            self.assertEqual([len(seg.frames) for seg in segments], [33, 49, 48, 49])
            self.assertEqual([seg.fps for seg in segments], [12, 12, 12, 12])
            for seg in segments:
                self.assertGreater(len(seg.frames), 0)
                for frame in seg.frames:
                    data = blob[frame.offset:frame.offset + frame.length]
                    with Image.open(io.BytesIO(data)) as image:
                        self.assertEqual(image.size, (pa.SCREEN, pa.SCREEN))
                        self.assertEqual(image.mode, "RGB")
                    # baseline、YUV420、Q 档：和 benchmarks/jpeg 的 fixture 规格一致，
                    # 板端解码器和测过的解码路径才对得上。
                    self.assertFalse(image.info.get("progressive"))
                    self.assertEqual(JpegImagePlugin.get_sampling(image), 2)
                    markers = jpeg_markers(data)
                    self.assertIn(0xC0, markers)
                    self.assertNotIn(0xC2, markers)

    def test_seven_mib_budget_lands_at_the_floor_and_fits(self):
        """C酱 的硬要求：总量不超过 7 MiB。

        按落板口径（只缩 idle、另外三段整段）在 7 MiB 下会落到最低档
        Q75/10fps —— 这是允许的，但不能超，也不能不降就写出去。
        """
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "assets.bin"
            proc = self.run_tool("--out", str(out), "--verify")
            self.assertEqual(proc.returncode, 0, proc.stderr + proc.stdout)
            blob = out.read_bytes()
            self.assertLessEqual(len(blob), 7 * 1024 * 1024)

            segments = pa.unpack(blob)
            self.assertEqual([seg.fps for seg in segments], [10, 10, 10, 10])
            self.assertEqual([len(seg.frames) for seg in segments], [28, 41, 40, 41])

    def test_budget_is_enforced_instead_of_silently_exceeded(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "assets.bin"
            proc = self.run_tool("--out", str(out), budget_mib=0.5)
            self.assertEqual(proc.returncode, 2, proc.stdout)
            self.assertFalse(out.exists(), "超预算时不应该写出文件")
            self.assertIn("仍然超出预算", proc.stderr)


if __name__ == "__main__":
    unittest.main()
