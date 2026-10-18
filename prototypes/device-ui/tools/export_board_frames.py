#!/usr/bin/env python3
"""Export video animations into optimized frame sequences for ESP32-S3 AMOLED circular screens.

Hardware Target: Waveshare ESP32-S3-Touch-AMOLED-1.75
- Display: 1.75-inch AMOLED, 466 x 466 pixels (RGB565 = 424.13 KB per uncompressed frame)
- Storage constraint: 16MB Flash with 8MB LittleFS partition (or 8MB Flash with 3MB partition)
- Recommended Format: Baseline JPEG sequence @ Quality 80 (approx 32~36 KB/frame, 12 fps)
"""
from __future__ import annotations

import argparse
import io
import json
import os
from pathlib import Path
import subprocess
import sys
from PIL import Image

def find_ffmpeg(explicit_path: str = "") -> str:
    if explicit_path and os.path.exists(explicit_path):
        return explicit_path
    env_path = os.environ.get("FFMPEG_PATH", "").strip()
    if env_path and os.path.exists(env_path):
        return env_path
    import shutil
    p = shutil.which("ffmpeg")
    if p:
        return p
    for candidate in [
        "/opt/homebrew/bin/ffmpeg",
        "/usr/local/bin/ffmpeg",
    ]:
        if os.path.exists(candidate):
            return candidate
    raise FileNotFoundError(
        "未找到 ffmpeg 可执行程序。请安装 ffmpeg 并加入 PATH、设置环境变量 FFMPEG_PATH，或传入 --ffmpeg 参数。"
    )


def export_state_frames(
    video_path: Path,
    output_dir: Path,
    *,
    start_time: float = 0.0,
    duration: float = 2.0,
    fps: int = 12,
    resolution: int = 466,
    quality: int = 80,
    ffmpeg_bin: str = "",
) -> dict:
    """Extract frames from video and encode them to optimized JPEG sequence."""
    ffmpeg_bin = find_ffmpeg(ffmpeg_bin)

    output_dir.mkdir(parents=True, exist_ok=True)
    temp_png_dir = output_dir / "_temp_png"
    temp_png_dir.mkdir(parents=True, exist_ok=True)

    # 1. Extract raw PNG frames using ffmpeg
    cmd = [
        ffmpeg_bin,
        "-y",
        "-ss", str(start_time),
        "-i", str(video_path),
        "-t", str(duration),
        "-r", str(fps),
        "-vf", f"scale={resolution}:{resolution}",
        str(temp_png_dir / "frame_%04d.png")
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        raise RuntimeError(f"ffmpeg 抽取帧失败 (退出码 {proc.returncode}):\n{proc.stderr.strip()}")

    raw_frames = sorted(temp_png_dir.glob("frame_*.png"))
    if not raw_frames:
        raise RuntimeError(f"No frames extracted from {video_path}")

    frames_stats = []
    total_jpeg_bytes = 0

    # 2. Convert each frame to baseline JPEG
    for idx, png_file in enumerate(raw_frames):
        im = Image.open(png_file).convert("RGB")
        target_jpg = output_dir / f"frame_{idx:03d}.jpg"
        
        buf = io.BytesIO()
        im.save(buf, format="JPEG", quality=quality, optimize=True)
        data = buf.getvalue()
        target_jpg.write_bytes(data)

        size_kb = len(data) / 1024.0
        total_jpeg_bytes += len(data)
        frames_stats.append({
            "index": idx,
            "file": target_jpg.name,
            "bytes": len(data),
            "kb": round(size_kb, 2),
        })

    # Cleanup temp png
    for p in raw_frames:
        try:
            p.unlink()
        except OSError:
            pass
    try:
        temp_png_dir.rmdir()
    except OSError:
        pass

    uncompressed_rgb565_bytes = resolution * resolution * 2 * len(frames_stats)
    compression_ratio = uncompressed_rgb565_bytes / max(1, total_jpeg_bytes)

    report = {
        "video_source": str(video_path),
        "start_time": start_time,
        "duration_seconds": duration,
        "fps": fps,
        "resolution": f"{resolution}x{resolution}",
        "jpeg_quality": quality,
        "total_frames": len(frames_stats),
        "total_jpeg_bytes": total_jpeg_bytes,
        "total_jpeg_kb": round(total_jpeg_bytes / 1024.0, 2),
        "total_jpeg_mb": round(total_jpeg_bytes / (1024.0 * 1024.0), 3),
        "avg_frame_kb": round(total_jpeg_bytes / (1024.0 * len(frames_stats)), 2),
        "uncompressed_rgb565_kb": round(uncompressed_rgb565_bytes / 1024.0, 2),
        "compression_ratio": round(compression_ratio, 2),
        "frames": frames_stats,
    }

    manifest_path = output_dir / "state_manifest.json"
    manifest_path.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
    return report


def main():
    parser = argparse.ArgumentParser(description="Export board-ready frame sequences for ESP32-S3 AMOLED round screen")
    parser.add_argument("--video", type=str, required=True, help="Input video path")
    parser.add_argument("--out", type=str, required=True, help="Output directory for frame sequence")
    parser.add_argument("--start", type=float, default=0.0, help="Start time in seconds")
    parser.add_argument("--duration", type=float, default=2.0, help="Duration in seconds")
    parser.add_argument("--fps", type=int, default=12, help="Target frame rate (default: 12 fps)")
    parser.add_argument("--res", type=int, default=466, help="Square resolution (default: 466)")
    parser.add_argument("--quality", type=int, default=80, help="JPEG quality 1-100 (default: 80)")
    parser.add_argument("--ffmpeg", type=str, default="", help="Path to ffmpeg binary")

    args = parser.parse_args()
    report = export_state_frames(
        Path(args.video),
        Path(args.out),
        start_time=args.start,
        duration=args.duration,
        fps=args.fps,
        resolution=args.res,
        quality=args.quality,
        ffmpeg_bin=args.ffmpeg,
    )
    print(f"Exported {report['total_frames']} frames to {args.out}")
    print(f"Total size: {report['total_jpeg_kb']} KB ({report['total_jpeg_mb']} MB)")
    print(f"Avg frame: {report['avg_frame_kb']} KB | Compression: {report['compression_ratio']}x vs RGB565")


if __name__ == "__main__":
    main()
