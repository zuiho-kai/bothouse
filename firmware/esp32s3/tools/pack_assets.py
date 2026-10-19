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

from PIL import Image

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

# 板端每段的截取时长与帧率，出处 docs/BOARD_ASSETS_PLAN.md §3「各状态精简方案」。
#
# 起点、scale/tx/ty 仍然来自 source.html（网页圆屏同源，不能各写一份）；
# 这里只覆盖「截多长」和「多少 fps」——把整段都塞进 Flash 装不下，
# 而网页上的片段本来就比落板需要的长。
#
# duration=None 表示不截断，用 source.html 的完整片段（thinking 要完整一圈：
# 中性起步 → 歪头问号 → 复位中性，截短会破坏首尾闭合）。
BOARD_PLAN = {
    "idle": {"duration": 2.5, "fps": 12},
    "listening": {"duration": 2.0, "fps": 12},
    "thinking": {"duration": None, "fps": 10},
    "speaking": {"duration": 2.0, "fps": 12},
}


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


def probe_video(ffmpeg: str, path: Path) -> tuple[int, int]:
    """返回源视频的 (宽, 高)。用 ffmpeg 的 stderr 解析，避免依赖 ffprobe。"""
    proc = subprocess.run([ffmpeg, "-hide_banner", "-i", str(path)],
                          capture_output=True, text=True)
    # ffmpeg 没有输出文件时以非零退出，stderr 里仍有流信息。
    match = re.search(r"Video:.*?(\d{2,5})x(\d{2,5})", proc.stderr)
    if not match:
        raise PackError(f"无法读取视频尺寸：{path}")
    return int(match.group(1)), int(match.group(2))


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
    clip: Clip
    src_path: Path
    src_w: int
    src_h: int
    target_fps: int = 12
    duration: float | None = None
    fps: int = 12
    pngs: list[Path] = field(default_factory=list)
    jpegs: list[bytes] = field(default_factory=list)

    @property
    def take(self) -> float:
        """这一段实际截多长（秒）。None 的 duration 表示用完整片段。"""
        if self.duration is not None:
            return self.duration
        if self.clip.end is not None:
            return self.clip.end - self.clip.start
        raise PackError(
            f"片段 {self.name!r} 没有 end 也没有 duration，无法确定截多长。")


class FrameCache:
    """按 (源文件, 起止, fps) 缓存 PNG 帧，降级时不必重复抽同一档。"""

    def __init__(self, ffmpeg: str, workdir: Path):
        self.ffmpeg = ffmpeg
        self.workdir = workdir
        self._cache: dict[tuple, list[Path]] = {}

    def frames(self, segment: Segment, fps: int) -> list[Path]:
        take = segment.take
        if take <= 0:
            raise PackError(
                f"片段 {segment.name!r} 的截取时长必须为正（现在是 {take}s）。")
        # 截取不能越过片段本身：越了就是配置写错，别让 ffmpeg 悄悄少给帧。
        available = None
        if segment.clip.end is not None:
            available = segment.clip.end - segment.clip.start
        if available is not None and take > available + 1e-6:
            raise PackError(
                f"片段 {segment.name!r} 要截 {take}s，但 source.html 里只有 "
                f"{available:.3f}s（start={segment.clip.start}, end={segment.clip.end}）。")

        key = (str(segment.src_path), segment.clip.start, take, fps,
               segment.src_w, segment.src_h)
        if key in self._cache:
            return self._cache[key]

        out_dir = Path(tempfile.mkdtemp(prefix=f"frames-{segment.name}-", dir=self.workdir))
        # 抽原始分辨率的整帧；裁切/缩放/底色由 render_frame 一次仿射做完，
        # 这样取景框位置不会被整数裁切取整，跟网页圆屏对得上。
        cmd = [self.ffmpeg, "-hide_banner", "-loglevel", "error", "-y",
               "-ss", f"{segment.clip.start:.3f}",
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
            raise PackError(f"片段 {segment.name!r} 没有抽出任何帧，检查 start/end。")
        self._cache[key] = pngs
        return pngs


def encode_jpegs(pngs: list[Path], clip: Clip, quality: int) -> list[bytes]:
    """PNG → 466×466 baseline JPEG（按网页的取景与底色渲染）。"""
    out: list[bytes] = []
    for png in pngs:
        with Image.open(png) as image:
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


def print_table(segments: list[Segment]) -> None:
    width = max(len(seg.name) for seg in segments)
    print(f"{'segment'.ljust(width)}  take   fps  frames       bytes      KiB  source")
    for seg in segments:
        size = sum(len(jpeg) for jpeg in seg.jpegs)
        print(f"{seg.name.ljust(width)}  {seg.take:>4.2f}s  {seg.fps:>3}  "
              f"{len(seg.jpegs):>6}  {size:>11,}  {size / 1024:>8.1f}  {seg.clip.src}")


# --------------------------------------------------------------------------
# 主流程
# --------------------------------------------------------------------------

def select_segments(clips: dict[str, Clip], character_dir: Path,
                    thinking: str, extras: int, seed: int,
                    plan: dict[str, dict] | None = None,
                    full_length: bool = False) -> list[Segment]:
    """四个状态片段 + 最多 N 段待机小动作。

    四个状态片段按 ``BOARD_PLAN`` 截取时长并各自定帧率；小动作按完整片段走
    （它们是插播，本来就短）。``full_length=True`` 时不截断，用 source.html
    的完整片段——只在排查画质时用。
    """
    thinking_key = "thinking_question" if thinking == "question" else "thinking_calm"
    chosen: list[tuple[str, str]] = [
        (name, thinking_key if name == "thinking" else key)
        for name, key in STATE_CLIPS
    ]

    variant_keys = sorted(key for key in clips if key not in {k for _, k in STATE_CLIPS})
    if extras > 0 and variant_keys:
        import random
        pool = list(variant_keys)
        # 固定 seed 时结果可复现；默认 seed=0，所以默认打包是确定性的。
        random.Random(seed).shuffle(pool)
        chosen += [(key, key) for key in pool[:extras]]

    plan = BOARD_PLAN if plan is None else plan
    segments: list[Segment] = []
    for name, key in chosen:
        clip = clips.get(key)
        if clip is None:
            raise PackError(f"source.html 里找不到片段 {key!r}（片段 {name!r} 需要）。")
        src_path = character_dir / Path(clip.src).name
        if not src_path.is_file():
            raise PackError(f"素材文件不存在：{src_path}")
        spec = plan.get(name, {})
        segments.append(Segment(
            name=name, clip=clip, src_path=src_path, src_w=0, src_h=0,
            target_fps=spec.get("fps", 12),
            duration=None if full_length else spec.get("duration")))
    return segments


def build(args: argparse.Namespace) -> int:
    repo_root = Path(__file__).resolve().parents[3]
    source_html = Path(args.source_html) if args.source_html else (
        repo_root / "prototypes/device-ui/source.html")
    character_dir = Path(args.character_dir) if args.character_dir else (
        repo_root / "prototypes/device-ui/assets/characters" / args.character)

    ffmpeg = find_ffmpeg(args.ffmpeg)
    clips = load_web_clips(source_html, args.character)
    segments = select_segments(clips, character_dir, args.thinking, args.extras,
                               args.seed, full_length=args.full_length)
    for seg in segments:
        seg.src_w, seg.src_h = probe_video(ffmpeg, seg.src_path)

    budget = int(args.budget_mib * 1024 * 1024)
    print(f"ffmpeg      : {ffmpeg}")
    print(f"source.html : {source_html}")
    print(f"character   : {args.character}  ({character_dir})")
    print(f"segments    : {', '.join(seg.name for seg in segments)}")
    print(f"budget      : {args.budget_mib:g} MiB = {budget:,} B")
    print()
    for seg in segments:
        print(f"  {seg.name:<10} 截 {seg.take:5.2f}s @ {seg.target_fps}fps"
              f"  （源 {seg.clip.src} 从 {seg.clip.start:g}s 起）")
    print()

    with tempfile.TemporaryDirectory(prefix="cnas-") as tmp:
        cache = FrameCache(ffmpeg, Path(tmp))
        ladder = settings_ladder(args.fps, args.quality,
                                 args.min_fps, args.min_quality)
        blob = b""
        final: tuple[int, int] | None = None
        for fps_cap, quality in ladder:
            for seg in segments:
                # 阶梯给的是上限：thinking 本来就只要 10fps，不必跟着抬到 12。
                seg.fps = min(seg.target_fps, fps_cap)
                seg.pngs = cache.frames(seg, seg.fps)
                seg.jpegs = encode_jpegs(seg.pngs, seg.clip, quality)
            blob = pack(segments)
            detail = "/".join(str(seg.fps) for seg in segments)
            print(f"try fps≤{fps_cap} quality={quality} (实际 {detail}) "
                  f"→ {format_size(len(blob))}")
            if len(blob) <= budget:
                final = (fps_cap, quality)
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
            "segments": [
                {
                    "name": seg.name,
                    "source": seg.clip.src,
                    "start": seg.clip.start,
                    "end": seg.clip.end,
                    "scale": seg.clip.scale,
                    "tx": seg.clip.tx,
                    "ty": seg.clip.ty,
                    "placement": asdict(placement(seg.clip, seg.src_w, seg.src_h)),
                    "bg": seg.clip.bg,
                    "take_seconds": round(seg.take, 3),
                    "target_fps": seg.target_fps,
                    "fps": seg.fps,
                    "frames": len(seg.jpegs),
                    "bytes": sum(len(jpeg) for jpeg in seg.jpegs),
                }
                for seg in segments
            ],
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
    parser.add_argument("--extras", type=int, default=0,
                        help="额外打包几段待机小动作（默认 0：这一版固件先不带小动作）")
    parser.add_argument("--full-length", action="store_true",
                        help="不按落板方案截短，用 source.html 的完整片段（仅排查用）")
    parser.add_argument("--seed", type=int, default=0,
                        help="小动作抽样种子；默认固定，保证打包可复现")
    parser.add_argument("--fps", type=int, default=12, help="起始帧率")
    parser.add_argument("--quality", type=int, default=80, help="起始 JPEG 质量")
    parser.add_argument("--min-fps", type=int, default=MIN_FPS,
                        help="帧率下限；默认就是约定下限，调低等于放宽验收")
    parser.add_argument("--min-quality", type=int, default=MIN_QUALITY,
                        help="JPEG 质量下限；默认就是约定下限，调低等于放宽验收")
    parser.add_argument("--budget-mib", type=float, default=7.0, help="总大小预算（MiB）")
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
