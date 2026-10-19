#!/usr/bin/env python3
"""把圆屏角色的动画片段打包成板端 assets.bin（CNAS 格式）。

输入是 ``prototypes/device-ui/assets/characters/<character>/`` 下的 mp4，
裁切参数直接读 ``prototypes/device-ui/source.html`` 里的 CHARACTER_CONFIG，
保证板端画面和网页圆屏逐像素同源，而不是各写一份数字。

    python3 firmware/esp32s3/tools/pack_assets.py \
        --ffmpeg "/path/to/ffmpeg" \
        --out build/assets.bin

输出：466×466 baseline JPEG 帧序列 + 索引，全部小端序。格式见
``firmware/esp32s3/ASSETS_FORMAT.md``。

预算默认 7 MiB。超出时按 (fps, quality) 阶梯降级：先降质量到 Q75，
再降帧率到 10fps；到最低档仍然超预算就报错退出，不写超预算的文件
（``--allow-over-budget`` 仅供排查）。

ffmpeg 只通过 ``--ffmpeg`` / ``FFMPEG_PATH`` / PATH 查找，不在脚本里写死
第三方应用自带的路径。
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
from dataclasses import asdict, dataclass, field
from pathlib import Path
import re
import shutil
import struct
import subprocess
import sys
import tempfile

from PIL import Image, ImageChops

MAGIC = b"CNAS"
VERSION = 1
SCREEN = 466

# 片段表一项：name[16] + fps u8 + frames u16 + index_offset u32
SEGMENT_ENTRY = struct.Struct("<16sBHI")
SEGMENT_ENTRY_SIZE = SEGMENT_ENTRY.size  # 23，无填充
HEADER = struct.Struct("<4sHH")
FRAME_ENTRY = struct.Struct("<II")

NAME_BYTES = 16
MIN_FPS = 10
MIN_QUALITY = 75

# 四个状态片段固定，顺序即板端优先读取顺序。
STATE_CLIPS = (
    ("idle", "idle"),
    ("listening", "listening"),
    ("thinking", "thinking_question"),
    ("speaking", "speaking"),
)

# 板端每段的取帧区间，只对板端生效，**不改 source.html**。
#
# 起点、scale/tx/ty 仍然来自 source.html（网页圆屏同源，不能各写一份）；
# 这里只覆盖「板端从哪一帧取到哪一帧」。
#
# `full=True` 表示整段都要——listening / thinking / speaking 都是首尾闭合的
# 整圈循环，截一半会在循环接缝处跳帧，所以一律不截。
# `range=(start, end)` 是显式区间（绝对秒数），`--board-range` 可覆盖。
BOARD_PLANS = {
    "gpt": {
        # 四段都用网页同款的完整片段。Flash 分区放大到 12 MiB（预算 11 MiB）之后
        # 不必再省，idle 直接用 4.65–9.90s 整段：里面有眨眼，首尾接不接得上跟网页
        # 完全一致，不再单独截子段。
        #
        # 背景：这版 idle 整段本身不是闭合循环，「有眨眼」和「首尾接得上」不可兼得。
        # --auto-idle-range 只按首尾差最小搜，会挑出几乎不动的一段（峰值 8.14 级）。
        # 所以自动选段保留作工具，但不设为默认；默认就是要完整段。
        # 8MB Flash 的备用方案：--budget-mib 7 --board-range idle=4.65,7.15。
        "idle": {"full": True},
        "listening": {"full": True},
        "thinking": {"full": True},
        "speaking": {"full": True},
    },
    "gemini": {
        # Gemini 四段素材源片均为完整的 4 秒闭合循环，idle 不需要截 2.5s，
        # 四个状态均取 4.0s 完整循环（丢弃末尾 0.04s 冗余帧）。
        "idle": {"range": (0.0, 4.0)},
        "listening": {"range": (0.0, 4.0)},
        "thinking": {"range": (0.0, 4.0)},
        "speaking": {"range": (0.0, 4.0)},
    },
    "grok": {
        # Grok 四段素材源片亦为完整的 4 秒闭合循环，四个状态均取 4.0s 完整循环。
        "idle": {"range": (0.0, 4.0)},
        "listening": {"range": (0.0, 4.0)},
        "thinking": {"range": (0.0, 4.0)},
        "speaking": {"range": (0.0, 4.0)},
    },
}

BOARD_PLAN = BOARD_PLANS["gpt"]


def get_board_plan(character: str) -> dict[str, dict]:
    """返回角色的落板截取方案。未专门定义的角色回退到 gpt。"""
    return BOARD_PLANS.get(character, BOARD_PLANS["gpt"])


# 两套打包预设。
#
# flash：刷进板载 Flash 的保底包。assets 分区 12 MiB、预算 11 MiB，四段完整，
#        带 offline/error 状态图，不带小动作（小动作留给 TF，省空间）。
# tf   ：拷进 TF 卡的精细包。**不设体积上限**，画质拉到 Q89，四段完整，
#        六个待机小动作全部带上；帧率由 --fps 指定（12 或 24，源片是 24fps）。
PROFILES = {
    "flash": {
        "budget_mib": 11.0,
        "quality": 80,
        "fps": 12,
        "extras": 0,        # 0 = 不带小动作
        "full": True,
    },
    "tf": {
        "budget_mib": None,  # None = 不设上限
        "quality": 89,
        "fps": 24,           # 源片原生帧率；12 帧用 --fps 12 出对照包
        "extras": -1,        # -1 = 全部小动作
        "full": True,
    },
}

# 断网 / 出错的静态状态片段名，按这个顺序进片段表。
STATUS_SEGMENTS = ("offline", "error")

# 状态图文件名前缀不一定等于角色目录名：G哥 的素材叫 gge（GodGe）。
# 其余角色目前与目录名一致；不一样时用 --status-prefix 覆盖。
STATUS_PREFIX = {"gpt": "gge"}

# idle 自动选段的搜索窗口：C酱 要求 2.0~3.0 秒之间首尾最接的一段。
IDLE_SEARCH_MIN = 2.0
IDLE_SEARCH_MAX = 3.0
IDLE_SEARCH_STEP = 1.0 / 12.0   # 按 12fps 的帧格走，避免选出半个帧的区间


class PackError(RuntimeError):
    """打包失败；消息直接面向人，不吞掉原因。"""


# --------------------------------------------------------------------------
# ffmpeg
# --------------------------------------------------------------------------

def find_ffmpeg(explicit_path: str = "") -> str:
    """按显式参数、FFMPEG_PATH、PATH 的顺序找 ffmpeg。不探测第三方应用目录。"""
    if explicit_path:
        if not os.path.isfile(explicit_path):
            raise PackError(f"--ffmpeg 指向的文件不存在：{explicit_path}")
        return explicit_path
    env_path = os.environ.get("FFMPEG_PATH", "").strip()
    if env_path:
        if not os.path.isfile(env_path):
            raise PackError(f"FFMPEG_PATH 指向的文件不存在：{env_path}")
        return env_path
    found = shutil.which("ffmpeg")
    if found:
        return found
    raise PackError(
        "未找到 ffmpeg。请用 --ffmpeg 指定可执行文件，或设置 FFMPEG_PATH，"
        "或把 ffmpeg 加入 PATH。"
    )


def probe_video(ffmpeg: str, path: Path) -> tuple[int, int, float]:
    """返回源视频的 (宽, 高, 时长秒)。解析 ffmpeg stderr，不依赖 ffprobe。"""
    proc = subprocess.run([ffmpeg, "-hide_banner", "-i", str(path)],
                          capture_output=True, text=True)
    # ffmpeg 没有输出文件时以非零退出，stderr 里仍有流信息。
    match = re.search(r"Video:.*?(\d{2,5})x(\d{2,5})", proc.stderr)
    if not match:
        raise PackError(f"无法读取视频尺寸：{path}")
    clock = re.search(r"Duration:\s*(\d+):(\d{2}):(\d{2}\.\d+)", proc.stderr)
    if not clock:
        raise PackError(f"无法读取视频时长：{path}")
    hours, minutes, seconds = int(clock.group(1)), int(clock.group(2)), float(clock.group(3))
    return int(match.group(1)), int(match.group(2)), hours * 3600 + minutes * 60 + seconds


# --------------------------------------------------------------------------
# 与网页圆屏同源的裁切
# --------------------------------------------------------------------------

@dataclass(frozen=True)
class Clip:
    """一个片段的裁切参数，字段含义与 source.html 的 clips 完全一致。"""

    key: str
    src: str
    scale: float
    tx: float
    ty: float
    start: float
    end: float | None
    bg: str = "#000000"


def _brace_block(text: str, open_index: int) -> str:
    """从 text[open_index] 的 '{' 开始，返回配对的花括号内部文本。"""
    depth = 0
    for i in range(open_index, len(text)):
        ch = text[i]
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return text[open_index + 1:i]
    raise PackError("source.html 的配置块括号不配对，无法读取裁切参数。")


def _find_block(text: str, key: str, start: int = 0) -> str | None:
    """找到 `<key>: {` 或 `<key> = {` 并返回其内部文本。"""
    match = re.search(rf"(?<![\w$]){re.escape(key)}\s*[:=]\s*\{{", text[start:])
    if not match:
        return None
    return _brace_block(text, start + match.end() - 1)


def _number(block: str, field_name: str) -> float | None:
    match = re.search(rf"\b{field_name}\s*:\s*(-?\d+(?:\.\d+)?)", block)
    return None if match is None else float(match.group(1))


def _color(block: str, field_name: str, default: str = "#000000") -> str:
    """读出 '#rrggbb'。网页用这个颜色铺视频没盖住的地方，板端要一致。"""
    match = re.search(rf"\b{field_name}\s*:\s*'(#[0-9A-Fa-f]{{6}})'", block)
    return default if match is None else match.group(1).lower()


def load_web_clips(source_html: Path, character: str) -> dict[str, Clip]:
    """从 source.html 读出某角色的 clips 与 idleVariants。

    source.html 是构建 screen.js 的唯一来源（见 build.py），所以这里读它，
    不复制一份数字；网页改了参数，打包结果跟着变。
    """
    text = source_html.read_text(encoding="utf-8")
    config = _find_block(text, "CHARACTER_CONFIG")
    if config is None:
        raise PackError(f"{source_html} 里没有 CHARACTER_CONFIG。")
    char_block = _find_block(config, character)
    if char_block is None:
        raise PackError(f"CHARACTER_CONFIG 里没有角色 {character!r}。")

    clips: dict[str, Clip] = {}
    for section in ("clips", "idleVariants"):
        section_text = _find_block(char_block, section)
        if section_text is None:
            continue
        for match in re.finditer(r"(?<![\w$])([A-Za-z_][\w]*)\s*:\s*\{", section_text):
            key = match.group(1)
            body = _brace_block(section_text, match.end() - 1)
            src = re.search(r"\bsrc\s*:\s*'([^']+)'", body)
            scale = _number(body, "scale")
            if src is None or scale is None:
                continue
            clips[key] = Clip(
                key=key,
                src=src.group(1),
                scale=scale,
                tx=_number(body, "tx") or 0.0,
                ty=_number(body, "ty") or 0.0,
                start=_number(body, "start") or 0.0,
                end=_number(body, "end"),
                bg=_color(body, "bg"),
            )
    if not clips:
        raise PackError(f"角色 {character!r} 没有任何可打包的片段。")
    return clips


@dataclass(frozen=True)
class Placement:
    """网页那一帧在源视频坐标系里的取景框。

    ``x0``/``y0``/``side`` 是理想取景框（可能有一部分落在画面外，网页那里
    露出的是片段的 bg 底色）；``src_*`` 是实际能从源视频取到的部分。
    """

    x0: float
    y0: float
    side: float
    src_x: int
    src_y: int
    src_w: int
    src_h: int


def placement(clip: Clip, src_w: int, src_h: int, out: int = SCREEN) -> Placement:
    """把网页的 scale / tx / ty 换算成源视频上的取景框。

    网页对视频元素做 ``transform: translate(tx%, ty%) scale(s)``，
    ``transform-origin: 50% 50%``，元素按 ``object-fit: cover`` 铺满 466×466。
    百分比位移相对元素自身尺寸，且位移不参与缩放，所以正向映射是

        screen = half + t + s * (elem - half)

    取逆就得到 466×466 画面在源视频里对应的位置。scale 小于「刚好铺满」时，
    取景框会超出画面边缘——这正是网页上那一条底色留白，不能靠夹紧取景框
    糊过去（thinking 片段 ty=+6.2% 在顶部留了约 22px，夹紧会让整幅画面下移）。
    """
    if clip.scale <= 0:
        raise PackError(f"片段 {clip.key!r} 的 scale 必须是正数。")

    cover = max(out / src_w, out / src_h)
    disp_w, disp_h = src_w * cover, src_h * cover
    off_x, off_y = (out - disp_w) / 2.0, (out - disp_h) / 2.0
    half = out / 2.0
    tx_px = clip.tx / 100.0 * out
    ty_px = clip.ty / 100.0 * out

    elem_x0 = half + (0.0 - tx_px - half) / clip.scale
    elem_y0 = half + (0.0 - ty_px - half) / clip.scale
    x0 = (elem_x0 - off_x) / cover
    y0 = (elem_y0 - off_y) / cover
    side = (out / clip.scale) / cover

    if side > max(src_w, src_h) + 1:
        raise PackError(f"片段 {clip.key!r} 的取景框比源视频还大，检查 scale。")

    src_x = max(0, int(x0))
    src_y = max(0, int(y0))
    src_right = min(src_w, int(x0 + side) + 1)
    src_bottom = min(src_h, int(y0 + side) + 1)
    return Placement(x0=x0, y0=y0, side=side,
                     src_x=src_x, src_y=src_y,
                     src_w=max(1, src_right - src_x),
                     src_h=max(1, src_bottom - src_y))


def render_frame(frame: Image.Image, clip: Clip, out: int = SCREEN) -> Image.Image:
    """把一帧源视频渲染成网页圆屏上看到的那 466×466。

    一次仿射重采样搞定裁切+缩放，而不是「先整数裁切再贴回」——后者会把
    取景框的位置取整，人物会整体偏 1~2px，和网页对不上。

    逆映射（PIL 的 AFFINE 就是按输出坐标算输入坐标）：

        elem   = half + (screen - t - half) / s
        source = (elem - off) / cover

    展开后正好是 ``source = screen / (s * cover) + placement.x0``，所以系数
    直接取 ``placement`` 的 ``x0``/``y0``。取景框超出源画面的部分（scale 小于
    刚好铺满时网页露出的底色）由 ``fillcolor`` 填片段 ``bg``。
    """
    if clip.scale <= 0:
        raise PackError(f"片段 {clip.key!r} 的 scale 必须是正数。")
    src_w, src_h = frame.size
    place = placement(clip, src_w, src_h, out)
    cover = max(out / src_w, out / src_h)
    step = 1.0 / (clip.scale * cover)
    bg = tuple(int(clip.bg[i:i + 2], 16) for i in (1, 3, 5))
    rendered = frame.convert("RGB").transform(
        (out, out), Image.AFFINE,
        (step, 0.0, place.x0, 0.0, step, place.y0),
        resample=Image.BICUBIC, fillcolor=bg)
    if rendered.size != (out, out):
        raise PackError(f"渲染后尺寸不是 {out}×{out}：{rendered.size}")
    return rendered


# --------------------------------------------------------------------------
# 抽帧与编码
# --------------------------------------------------------------------------

@dataclass
class Segment:
    name: str
    clip: Clip | None            # 静态图片段没有裁切参数
    src_path: Path
    src_w: int
    src_h: int
    src_duration: float = 0.0
    start: float = 0.0
    end: float | None = None      # None = 一直取到文件末尾
    fps: int = 12
    static_png: Path | None = None   # 非 None 表示单帧静态图，不抽帧
    pngs: list[Path] = field(default_factory=list)
    jpegs: list[bytes] = field(default_factory=list)

    @property
    def take(self) -> float:
        """这一段实际截多长（秒）。静态图按 1 秒算。"""
        if self.static_png is not None:
            return 1.0
        if self.end is None:
            return self.src_duration - self.start
        return self.end - self.start


class FrameCache:
    """按 (源文件, 区间, fps) 缓存 PNG 帧，降级时不必重复抽同一档。"""

    def __init__(self, ffmpeg: str, workdir: Path):
        self.ffmpeg = ffmpeg
        self.workdir = workdir
        self._cache: dict[tuple, list[Path]] = {}

    def frames(self, segment: Segment, fps: int) -> list[Path]:
        if segment.static_png is not None:
            return [segment.static_png]
        take = segment.take
        if take <= 0:
            raise PackError(
                f"片段 {segment.name!r} 的截取时长必须为正（现在是 {take}s）。")
        if segment.start < 0:
            raise PackError(f"片段 {segment.name!r} 的起点不能为负。")
        # 截取不能越过片段本身：越了就是配置写错，别让 ffmpeg 悄悄少给帧。
        if segment.end is not None:
            available = segment.clip.end - segment.clip.start if segment.clip.end else segment.src_duration
            if segment.end > segment.clip.start + available + 1e-6:
                raise PackError(
                    f"片段 {segment.name!r} 要到 {segment.end:g}s，但 source.html 里"
                    f"只有到 {segment.clip.start + available:.3f}s"
                    f"（start={segment.clip.start}, end={segment.clip.end}）。")

        key = (str(segment.src_path), segment.start, segment.end, fps,
               segment.src_w, segment.src_h)
        if key in self._cache:
            return self._cache[key]

        out_dir = Path(tempfile.mkdtemp(prefix=f"frames-{segment.name}-", dir=self.workdir))
        # 抽原始分辨率的整帧；裁切/缩放/底色由 render_frame 一次仿射做完，
        # 这样取景框位置不会被整数裁切取整，跟网页圆屏对得上。
        cmd = [self.ffmpeg, "-hide_banner", "-loglevel", "error", "-y",
               "-ss", f"{segment.start:.3f}",
               "-i", str(segment.src_path),
               "-t", f"{take:.3f}",
               "-an", "-sn", "-r", str(fps),
               str(out_dir / "f_%04d.png")]
        proc = subprocess.run(cmd, capture_output=True, text=True)
        if proc.returncode != 0:
            raise PackError(
                f"抽帧失败（{segment.name}，退出码 {proc.returncode}）：\n{proc.stderr.strip()}")

        pngs = sorted(out_dir.glob("f_*.png"))
        if not pngs:
            raise PackError(f"片段 {segment.name!r} 没有抽出任何帧，检查区间。")
        self._cache[key] = pngs
        return pngs


def frame_delta(a: Image.Image, b: Image.Image) -> float:
    """两帧的平均像素差（0~255 级）。用来量循环接缝有多大。"""
    diff = ImageChops.difference(a.convert("RGB"), b.convert("RGB")).convert("L")
    histogram = diff.histogram()
    total = sum(histogram)
    return sum(i * c for i, c in enumerate(histogram)) / total if total else 0.0


def find_idle_range(ffmpeg: str, clip: Clip, src_path: Path, src_w: int, src_h: int,
                    src_duration: float, workdir: Path, fps: int = 12,
                    min_len: float = IDLE_SEARCH_MIN,
                    max_len: float = IDLE_SEARCH_MAX
                    ) -> tuple[float, float, float, float]:
    """在 idle 原片里找首尾帧最接近的一段。

    候选区间长度在 ``min_len``~``max_len`` 之间，按 12fps 的帧格走；对每个
    候选算首尾帧的平均像素差，取最小的。差值越小，循环回接时越不跳。

    只在 idle 上做这件事：另外三段都是首尾闭合的整圈，本来就不该截。
    """
    span_start = clip.start
    span_end = clip.end if clip.end is not None else src_duration
    probe = Segment(name="idle-probe", clip=clip, src_path=src_path,
                    src_w=src_w, src_h=src_h, src_duration=src_duration,
                    start=span_start, end=span_end, fps=fps)
    cache = FrameCache(ffmpeg, workdir)
    pngs = cache.frames(probe, fps)
    # 渲染成板端真正看到的 466×466 再比较，不然量的是原始视频而不是落板效果。
    rendered = [render_frame(Image.open(p), clip) for p in pngs]

    step = 1.0 / fps
    # 相邻帧差：用来判断这段里到底有没有动作（眨眼是大峰）。
    moves = [frame_delta(rendered[i - 1], rendered[i]) for i in range(1, len(rendered))]
    best: tuple[float, float, float, float] | None = None
    lengths = []
    length = min_len
    while length <= max_len + 1e-9:
        lengths.append(round(length, 3))
        length += step
    for index in range(len(rendered)):
        for length in lengths:
            last = index + int(round(length * fps))
            if last >= len(rendered):
                continue
            delta = frame_delta(rendered[index], rendered[last])
            if best is None or delta < best[2]:
                peak = max(moves[index:last - 1]) if last - 1 > index else 0.0
                start_t = span_start + index * step
                best = (start_t, start_t + length, delta, peak)
    if best is None:
        raise PackError(
            f"idle 里找不到 {min_len}~{max_len}s 的候选区间"
            f"（可用帧数 {len(rendered)}）。")
    return best


def encode_jpegs(pngs: list[Path], clip: Clip | None, quality: int) -> list[bytes]:
    """PNG → 466×466 baseline JPEG。

    ``clip`` 为 None 时是静态状态图（offline / error）：整幅缩放到 466×466，
    不套角色的 scale/tx/ty——那是设计好的整屏画面，不是角色动画。
    """
    out: list[bytes] = []
    for png in pngs:
        with Image.open(png) as image:
            if clip is None:
                frame = image.convert("RGB").resize((SCREEN, SCREEN), Image.LANCZOS)
            else:
                frame = render_frame(image, clip)
            if frame.size != (SCREEN, SCREEN):
                raise PackError(f"合成后尺寸不是 {SCREEN}×{SCREEN}：{frame.size}")
            buffer = io.BytesIO()
            # PIL 默认 progressive=False，即 baseline；4:2:0 由 quality<95 自动选择。
            frame.save(buffer, format="JPEG", quality=quality, optimize=True)
            out.append(buffer.getvalue())
    return out


# --------------------------------------------------------------------------
# CNAS 打包 / 解包
# --------------------------------------------------------------------------

def pack(segments: list[Segment]) -> bytes:
    """按 CNAS v1 布局拼出 assets.bin。"""
    if not segments:
        raise PackError("没有可打包的片段。")
    if len(segments) > 0xFFFF:
        raise PackError("片段数超过 u16 上限。")

    header_size = HEADER.size + SEGMENT_ENTRY_SIZE * len(segments)
    index_sizes = [FRAME_ENTRY.size * len(seg.jpegs) for seg in segments]
    data_start = header_size + sum(index_sizes)

    index_offsets: list[int] = []
    cursor = header_size
    for size in index_sizes:
        index_offsets.append(cursor)
        cursor += size

    blob = bytearray()
    blob += HEADER.pack(MAGIC, VERSION, len(segments))
    for seg, index_offset in zip(segments, index_offsets):
        name = seg.name.encode("ascii")
        if len(name) >= NAME_BYTES:
            raise PackError(f"片段名 {seg.name!r} 超过 {NAME_BYTES - 1} 字节。")
        if not 0 < len(seg.jpegs) <= 0xFFFF:
            raise PackError(f"片段 {seg.name!r} 帧数 {len(seg.jpegs)} 超出 u16 范围。")
        blob += SEGMENT_ENTRY.pack(name.ljust(NAME_BYTES, b"\0"),
                                   seg.fps, len(seg.jpegs), index_offset)

    data_offset = data_start
    frame_offsets: list[list[int]] = []
    for seg in segments:
        offsets = []
        for jpeg in seg.jpegs:
            offsets.append(data_offset)
            data_offset += len(jpeg)
        frame_offsets.append(offsets)

    for seg, offsets in zip(segments, frame_offsets):
        for offset, jpeg in zip(offsets, seg.jpegs):
            blob += FRAME_ENTRY.pack(offset, len(jpeg))

    for seg in segments:
        for jpeg in seg.jpegs:
            blob += jpeg

    return bytes(blob)


@dataclass(frozen=True)
class UnpackedFrame:
    offset: int
    length: int


@dataclass(frozen=True)
class UnpackedSegment:
    name: str
    fps: int
    frames: tuple[UnpackedFrame, ...]
    index_offset: int


def unpack(blob: bytes) -> list[UnpackedSegment]:
    """解析 assets.bin。测试与 --verify 共用；越界或魔数不对直接报错。"""
    if len(blob) < HEADER.size:
        raise PackError("文件比头部还短。")
    magic, version, count = HEADER.unpack_from(blob, 0)
    if magic != MAGIC:
        raise PackError(f"魔数不是 CNAS：{magic!r}")
    if version != VERSION:
        raise PackError(f"版本号不支持：{version}")

    segments: list[UnpackedSegment] = []
    table_end = HEADER.size + SEGMENT_ENTRY_SIZE * count
    if table_end > len(blob):
        raise PackError("片段表超出文件长度。")

    for i in range(count):
        offset = HEADER.size + i * SEGMENT_ENTRY_SIZE
        raw_name, fps, frames, index_offset = SEGMENT_ENTRY.unpack_from(blob, offset)
        name = raw_name.split(b"\0", 1)[0].decode("ascii", "strict")
        if fps <= 0:
            raise PackError(f"片段 {name!r} 的 fps 非法：{fps}")
        entries_end = index_offset + FRAME_ENTRY.size * frames
        if entries_end > len(blob):
            raise PackError(f"片段 {name!r} 的帧索引越界。")
        frame_list = []
        for f in range(frames):
            foff, flen = FRAME_ENTRY.unpack_from(blob, index_offset + f * FRAME_ENTRY.size)
            if flen == 0 or foff + flen > len(blob):
                raise PackError(f"片段 {name!r} 第 {f} 帧越界。")
            if blob[foff:foff + 2] != b"\xff\xd8":
                raise PackError(f"片段 {name!r} 第 {f} 帧不是 JPEG（缺 SOI）。")
            frame_list.append(UnpackedFrame(offset=foff, length=flen))
        segments.append(UnpackedSegment(name=name, fps=fps,
                                        frames=tuple(frame_list),
                                        index_offset=index_offset))
    return segments


# --------------------------------------------------------------------------
# 预算阶梯
# --------------------------------------------------------------------------

def settings_ladder(start_fps: int, start_quality: int,
                    min_fps: int = MIN_FPS,
                    min_quality: int = MIN_QUALITY) -> list[tuple[int, int]]:
    """降级顺序：先降质量到下限，再逐档降帧率到下限。

    下限默认 Q75 / 10fps。要继续往下压必须显式传更低的 ``min_*``——把「预算
    装不下」变成一条要人签字的选择，而不是脚本自己悄悄降画质。
    """
    if min_fps < 1 or min_quality < 1:
        raise PackError("min_fps / min_quality 必须为正。")
    if start_fps < min_fps or start_quality < min_quality:
        raise PackError(
            f"起始档 fps={start_fps} quality={start_quality} 低于下限 "
            f"fps={min_fps} quality={min_quality}。")
    ladder = [(start_fps, start_quality)]
    if start_quality > min_quality:
        ladder.append((start_fps, min_quality))
    for fps in range(start_fps - 1, min_fps - 1, -1):
        ladder.append((fps, min_quality))
    seen: set[tuple[int, int]] = set()
    out: list[tuple[int, int]] = []
    for item in ladder:
        if item[0] < min_fps or item[1] < min_quality or item in seen:
            continue
        seen.add(item)
        out.append(item)
    if not out:
        raise PackError(
            f"降级阶梯为空（起始 fps={start_fps} quality={start_quality}，"
            f"下限 fps={min_fps} quality={min_quality}）。")
    return out


def format_size(num_bytes: int) -> str:
    return (f"{num_bytes:,} B ({num_bytes / 1024:.1f} KiB, "
            f"{num_bytes / 1024 / 1024:.2f} MiB)")


def _segment_report(seg: Segment) -> dict:
    """把一段的元数据写成报告条目；静态图没有裁切参数。"""
    item = {
        "name": seg.name,
        "source": seg.src_path.name,
        "take_seconds": round(seg.take, 3),
        "fps": seg.fps,
        "frames": len(seg.jpegs),
        "bytes": sum(len(jpeg) for jpeg in seg.jpegs),
    }
    if seg.static_png is not None:
        item["static"] = True
        return item
    item.update({
        "start": round(seg.start, 3),
        "end": None if seg.end is None else round(seg.end, 3),
        "scale": seg.clip.scale,
        "tx": seg.clip.tx,
        "ty": seg.clip.ty,
        "placement": asdict(placement(seg.clip, seg.src_w, seg.src_h)),
        "bg": seg.clip.bg,
    })
    return item


def print_table(segments: list[Segment]) -> None:
    width = max(len(seg.name) for seg in segments)
    print(f"{'segment'.ljust(width)}  take   fps  frames       bytes      KiB  source")
    for seg in segments:
        size = sum(len(jpeg) for jpeg in seg.jpegs)
        print(f"{seg.name.ljust(width)}  {seg.take:>4.2f}s  {seg.fps:>3}  "
              f"{len(seg.jpegs):>6}  {size:>11,}  {size / 1024:>8.1f}  {seg.src_path.name}")


# --------------------------------------------------------------------------
# 主流程
# --------------------------------------------------------------------------

def parse_board_range(text: str) -> tuple[str, float, float]:
    """解析 ``name=start,end``。"""
    match = re.fullmatch(r"\s*([A-Za-z_][\w]*)\s*=\s*(-?\d+(?:\.\d+)?)\s*,"
                         r"\s*(-?\d+(?:\.\d+)?)\s*", text)
    if not match:
        raise PackError(f"--board-range 格式应是 name=start,end，收到 {text!r}。")
    name, start, end = match.group(1), float(match.group(2)), float(match.group(3))
    if end <= start:
        raise PackError(f"--board-range {name} 的 end 必须大于 start。")
    return name, start, end


def select_segments(clips: dict[str, Clip], character_dir: Path,
                    thinking: str, extras: int, seed: int,
                    plan: dict[str, dict] | None = None,
                    overrides: dict[str, tuple[float, float]] | None = None,
                    full_length: bool = False,
                    character: str = "gpt") -> list[Segment]:
    """四个状态片段 + 最多 N 段待机小动作。

    四个状态片段按对应角色的 ``BOARD_PLANS`` 决定取帧区间（整段或显式区间），
    ``overrides`` 来自 ``--board-range``，优先级最高。小动作整段打包。
    """
    thinking_key = "thinking_question" if thinking == "question" else "thinking_calm"
    chosen: list[tuple[str, str]] = [
        (name, thinking_key if name == "thinking" else key)
        for name, key in STATE_CLIPS
    ]

    # thinking_calm 是 thinking 的备选，不是小动作，别把它当变体打进来。
    reserved = {k for _, k in STATE_CLIPS} | {"thinking_calm", "thinking_question"}
    variant_keys = sorted(key for key in clips if key not in reserved)
    if extras < 0 and variant_keys:
        # -1 = 全部小动作（TF 包用），按名字排序，结果确定。
        chosen += [(key, key) for key in variant_keys]
    elif extras > 0 and variant_keys:
        import random
        pool = list(variant_keys)
        # 固定 seed 时结果可复现；默认 seed=0，所以默认打包是确定性的。
        random.Random(seed).shuffle(pool)
        chosen += [(key, key) for key in pool[:extras]]

    active_plan = get_board_plan(character) if plan is None else plan
    overrides = overrides or {}
    segments: list[Segment] = []
    for name, key in chosen:
        clip = clips.get(key)
        if clip is None:
            raise PackError(f"source.html 里找不到片段 {key!r}（片段 {name!r} 需要）。")
        src_path = character_dir / Path(clip.src).name
        if not src_path.is_file():
            raise PackError(f"素材文件不存在：{src_path}")

        spec = active_plan.get(name, {})
        start = clip.start
        end = clip.end
        # 优先级：--board-range（最具体）> --full-length（全局）> BOARD_PLAN。
        if name in overrides:
            start, end = overrides[name]
        elif full_length or spec.get("full"):
            pass
        elif spec.get("range"):
            if name == "thinking" and thinking == "calm":
                pass
            else:
                start, end = spec["range"]
        segments.append(Segment(
            name=name, clip=clip, src_path=src_path, src_w=0, src_h=0,
            start=start, end=end))
    return segments


def build(args: argparse.Namespace) -> int:
    repo_root = Path(__file__).resolve().parents[3]
    source_html = Path(args.source_html) if args.source_html else (
        repo_root / "prototypes/device-ui/source.html")
    character_dir = Path(args.character_dir) if args.character_dir else (
        repo_root / "prototypes/device-ui/assets/characters" / args.character)

    profile = PROFILES[args.profile]
    budget_mib = args.budget_mib if args.budget_mib is not None else profile["budget_mib"]
    quality = args.quality if args.quality is not None else profile["quality"]
    fps = args.fps if args.fps is not None else profile["fps"]
    extras = args.extras if args.extras is not None else profile["extras"]

    ffmpeg = find_ffmpeg(args.ffmpeg)
    clips = load_web_clips(source_html, args.character)

    overrides: dict[str, tuple[float, float]] = {}
    for text in args.board_range:
        name, start, end = parse_board_range(text)
        overrides[name] = (start, end)

    budget = None if budget_mib is None else int(budget_mib * 1024 * 1024)
    print(f"profile     : {args.profile}"
          f"{'' if budget is not None else '（不设体积上限）'}")
    print(f"ffmpeg      : {ffmpeg}")
    print(f"source.html : {source_html}")
    print(f"character   : {args.character}  ({character_dir})")
    if budget is None:
        print("budget      : 不设上限（TF 模式）")
    else:
        print(f"budget      : {budget_mib:g} MiB = {budget:,} B")
    print()

    with tempfile.TemporaryDirectory(prefix="cnas-") as tmp:
        workdir = Path(tmp)

        # idle 自动选段：找首尾最接的一段，把区间和差值打出来。
        idle_clip = clips["idle"]
        idle_path = character_dir / Path(idle_clip.src).name
        if "idle" not in overrides and not args.full_length:
            if args.auto_idle_range:
                iw, ih, idur = probe_video(ffmpeg, idle_path)
                start, end, delta, peak = find_idle_range(
                    ffmpeg, idle_clip, idle_path, iw, ih, idur, workdir)
                overrides["idle"] = (start, end)
                print(f"idle 自动选段：{start:.3f}s–{end:.3f}s（{end - start:.2f}s，"
                      f"首尾帧平均差 {delta:.2f} 级，段内最大动作 {peak:.2f} 级）")
                if peak < 12:
                    print("  注意：这一段几乎没有动作（眨眼峰一般 ≥12 级），"
                          "待机画面会基本静止。")
                    print("  这版 idle 整段不是闭合循环，想要有眨眼就必然首尾不接；"
                          "两者不可兼得时请用 --board-range 显式指定。")
                print()

        segments = select_segments(clips, character_dir, args.thinking, extras,
                                   args.seed, overrides=overrides,
                                   full_length=args.full_length,
                                   character=args.character)
        for seg in segments:
            seg.src_w, seg.src_h, seg.src_duration = probe_video(ffmpeg, seg.src_path)

        # 断网 / 出错的静态状态图，各 1 帧、fps=1。整幅缩放，不套角色裁切。
        if args.status_dir:
            status_dir = Path(args.status_dir)
            prefix = args.status_prefix or STATUS_PREFIX.get(args.character, args.character)
            for name in STATUS_SEGMENTS:
                png = status_dir / f"{prefix}-{name}.png"
                if not png.is_file():
                    raise PackError(
                        f"状态图不存在：{png}\n"
                        f"--status-dir 里应有 <前缀>-offline.png 和 <前缀>-error.png"
                        f"（当前前缀 {prefix!r}，可用 --status-prefix 改）。")
                with Image.open(png) as image:
                    width, height = image.size
                segments.append(Segment(
                    name=name, clip=None, src_path=png, src_w=width, src_h=height,
                    fps=1, static_png=png))

        print(f"segments    : {', '.join(seg.name for seg in segments)}")
        for seg in segments:
            if seg.static_png is not None:
                print(f"  {seg.name:<10} 静态 1 帧 @ 1fps  （源 {seg.src_path.name}）")
            else:
                print(f"  {seg.name:<10} {seg.start:6.2f}s–{seg.end if seg.end is not None else seg.src_duration:6.2f}s"
                      f"  截 {seg.take:5.2f}s"
                      f"  （源 {seg.clip.src}）")
        print()

    with tempfile.TemporaryDirectory(prefix="cnas-") as tmp:
        cache = FrameCache(ffmpeg, Path(tmp))
        if budget is None:
            # TF 模式不降级：只用指定档位，装多大算多大。
            ladder = [(fps, quality)]
        else:
            ladder = settings_ladder(fps, quality, args.min_fps, args.min_quality)
        blob = b""
        final: tuple[int, int] | None = None
        for fps, quality in ladder:
            for seg in segments:
                # 静态图恒为 1fps，不跟着阶梯走。
                seg.fps = 1 if seg.static_png is not None else fps
                seg.pngs = cache.frames(seg, seg.fps)
                seg.jpegs = encode_jpegs(seg.pngs, seg.clip, quality)
            blob = pack(segments)
            print(f"try fps={fps} quality={quality} → {format_size(len(blob))}")
            if budget is None or len(blob) <= budget:
                final = (fps, quality)
                break

        if final is None:
            print()
            print_table(segments)
            print()
            lowest = ladder[-1] if ladder else (args.fps, args.quality)
            print(f"最低档 fps={lowest[0]} quality={lowest[1]} 仍然超出预算 "
                  f"{format_size(budget)}：{format_size(len(blob))}", file=sys.stderr)
            # 逐段大小是独立的：把 extras 去掉后的大小能直接算出来，
            # 这样决定「提高预算 / 砍小动作 / 降低下限」时有确切数字。
            state_names = {name for name, _ in STATE_CLIPS}
            states_only = [seg for seg in segments if seg.name in state_names]
            if len(states_only) != len(segments):
                # 单独打包四个状态片段，给出「去掉小动作」后的确切大小。
                base = len(pack(states_only))
                print(f"只打包四个状态片段（去掉 --extras）是 {format_size(base)}。",
                      file=sys.stderr)
            print("可提高 --budget-mib、减少 --extras，或缩短片段；"
                  "不要悄悄放宽预算。", file=sys.stderr)
            if not args.allow_over_budget:
                return 2

    fps, quality = final if final else (ladder[-1] if ladder else (args.fps, args.quality))
    print()
    print_table(segments)
    total = len(blob)
    print()
    print(f"打包完成：{len(segments)} 段 / {sum(len(s.jpegs) for s in segments)} 帧 / "
          f"fps={fps} / quality={quality}")
    if budget is None:
        print(f"总大小：{format_size(total)}（不设上限）")
    else:
        print(f"总大小：{format_size(total)}，预算占用 {total / budget * 100:.1f}%")
    print(f"sha256：{hashlib.sha256(blob).hexdigest()}")

    if args.verify:
        check = unpack(blob)
        if len(check) != len(segments):
            raise PackError("自检失败：解包后的片段数不一致。")
        for seg, back in zip(segments, check):
            if back.name != seg.name or len(back.frames) != len(seg.jpegs):
                raise PackError(f"自检失败：片段 {seg.name!r} 解包不一致。")
        print("自检：解包通过（片段数、帧数、JPEG SOI 均一致）")

    if args.report:
        report_path = Path(args.report)
        report_path.parent.mkdir(parents=True, exist_ok=True)
        report = {
            "magic": MAGIC.decode(),
            "version": VERSION,
            "character": args.character,
            "fps": fps,
            "quality": quality,
            "budget_bytes": budget,
            "total_bytes": total,
            "sha256": hashlib.sha256(blob).hexdigest(),
            "segments": [_segment_report(seg) for seg in segments],
        }
        report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n",
                               encoding="utf-8")
        print(f"报告：{report_path}")

    if args.out:
        out_path = Path(args.out)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_bytes(blob)
        print(f"输出：{out_path}")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="把圆屏角色动画打包成板端 CNAS assets.bin",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter)
    parser.add_argument("--ffmpeg", default="", help="ffmpeg 可执行文件路径")
    parser.add_argument("--character", default="gpt", help="角色目录名")
    parser.add_argument("--source-html", default="", help="覆盖 source.html 路径")
    parser.add_argument("--character-dir", default="", help="覆盖角色素材目录")
    parser.add_argument("--out", default="", help="assets.bin 输出路径")
    parser.add_argument("--report", default="", help="写出 JSON 报告")
    parser.add_argument("--thinking", choices=("question", "calm"), default="question",
                        help="thinking 用带问号原片还是无问号安静段")
    parser.add_argument("--extras", type=int, default=None,
                        help="打包几段待机小动作：-1=全部，0=不带，正数=随机抽；默认取 profile")
    parser.add_argument("--full-length", action="store_true",
                        help="全部用 source.html 的完整片段（仅排查用，会超预算）")
    parser.add_argument("--board-range", action="append", default=[], metavar="NAME=START,END",
                        help="只对板端生效的取帧区间，可重复；不改 source.html")
    parser.add_argument("--status-prefix", metavar="PREFIX",
                        help="状态图文件名前缀，默认取角色名（gpt 的素材叫 gge）")
    parser.add_argument("--status-dir", metavar="DIR",
                        help="静态状态图目录，取 <角色>-offline.png 和 <角色>-error.png"
                             " 各 1 帧、fps=1；不传就不打包状态图")
    parser.add_argument("--auto-idle-range", action="store_true",
                        help="在 idle 原片里重新搜索首尾最接的 2.0~3.0s 区间（较慢）")
    parser.add_argument("--seed", type=int, default=0,
                        help="小动作抽样种子；默认固定，保证打包可复现")
    parser.add_argument("--fps", type=int, default=None, help="起始帧率")
    parser.add_argument("--quality", type=int, default=None, help="起始 JPEG 质量")
    parser.add_argument("--min-fps", type=int, default=MIN_FPS,
                        help="帧率下限；默认就是约定下限，调低等于放宽验收")
    parser.add_argument("--min-quality", type=int, default=MIN_QUALITY,
                        help="JPEG 质量下限；默认就是约定下限，调低等于放宽验收")
    parser.add_argument("--profile", choices=sorted(PROFILES), default="flash",
                        help="打包预设：flash=11 MiB 预算/Q80/不带小动作；"
                             "tf=不设上限/Q89/全部小动作（默认 flash）")
    parser.add_argument("--budget-mib", type=float, default=None,
                        help="总大小预算（MiB），默认取 profile；8MB Flash 的板子用 7")
    parser.add_argument("--verify", action="store_true", help="打包后解包自检")
    parser.add_argument("--allow-over-budget", action="store_true",
                        help="仅排查用：超预算也写文件")
    args = parser.parse_args(argv)
    try:
        return build(args)
    except PackError as exc:
        print(f"错误：{exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
