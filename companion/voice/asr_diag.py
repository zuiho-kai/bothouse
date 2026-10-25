"""只记录的识别诊断：把墙钟、CPU 时间、缺页和宿主负载一起落盘。

用途：判定「识别很慢」到底是真算力，还是进程被抢占/缺页换入。
线上那次 14347ms 只留下了墙钟（asr-followup-20261021.jsonl 里没有 cpu_ms），
拿不到这两者的比值，就无法归因。

边界：
- 默认关闭。只有环境变量 VOICE_ASR_DIAG 指向一个文件路径时才追加写入。
- 任何异常都吞掉：诊断绝不能把一轮语音搞失败，也不能改变返回值。
- 不记录音频、识别文本、模型路径或凭据。
"""
from __future__ import annotations

import json
import os
import resource
import time

ENV_NAME = 'VOICE_ASR_DIAG'

_last_end: float | None = None


def target() -> str | None:
    """诊断文件路径；未配置就是关闭。"""
    path = (os.environ.get(ENV_NAME) or '').strip()
    return path or None


def enabled() -> bool:
    return target() is not None


def snapshot() -> dict:
    """当前进程用量与宿主压力。取不到的字段就省略，不填假值。"""
    usage = resource.getrusage(resource.RUSAGE_SELF)
    row = {
        'cpu_ms': (usage.ru_utime + usage.ru_stime) * 1000.0,
        'major_faults': usage.ru_majflt,
        'minor_faults': usage.ru_minflt,
    }
    # macOS 的 ru_maxrss 是字节，Linux 是 KB；按平台换算成 MB。
    divisor = 1024.0 * 1024.0 if os.uname().sysname == 'Darwin' else 1024.0
    row['rss_mb'] = round(usage.ru_maxrss / divisor, 1)
    try:
        row['loadavg'] = [round(value, 2) for value in os.getloadavg()]
    except OSError:
        pass
    try:
        with open('/proc/meminfo', encoding='utf-8') as handle:
            for line in handle:
                if line.startswith('MemAvailable:'):
                    row['available_mb'] = round(int(line.split()[1]) / 1024.0, 1)
                    break
    except (OSError, ValueError):
        pass
    return row


def take_idle(now: float | None = None) -> float | None:
    """距上一次识别**结束**的空闲秒数；跨进程不共享，只用于本次会话归因。

    只读不写：结束时间由 finish() 在识别完成时更新，避免把上一轮的识别耗时算进空闲。"""
    now = time.monotonic() if now is None else now
    if _last_end is None:
        return None
    return round(max(0.0, now - _last_end), 3)


def begin() -> tuple[dict | None, float | None]:
    """识别开始前采样。关闭或任何异常都返回 (None, None)，绝不打断识别。"""
    if not enabled():
        return None, None
    try:
        return snapshot(), take_idle()
    except Exception:
        return None, None


def finish(timings: dict, before: dict | None, idle_seconds: float | None,
           now: float | None = None) -> bool:
    """识别成功结束后采样并写一行，同时记下结束时间。任何异常都吞掉。"""
    global _last_end
    try:
        _last_end = time.monotonic() if now is None else now
        if before is None:
            return False
        return record(timings, before, snapshot(), idle_seconds=idle_seconds)
    except Exception:
        return False


def build(timings: dict, before: dict, after: dict, *,
          idle_seconds: float | None = None, error: str | None = None) -> dict:
    """把一次识别折叠成一行可归因的记录。"""
    wall = float(timings.get('total_ms') or 0.0)
    cpu = max(0.0, float(after.get('cpu_ms', 0.0)) - float(before.get('cpu_ms', 0.0)))
    row = {
        'at': round(time.time(), 3),
        'wall_ms': round(wall, 3),
        'inference_ms': timings.get('inference_ms'),
        'queue_ms': timings.get('queue_ms'),
        'setup_ms': timings.get('setup_ms'),
        'audio_ms': timings.get('audio_ms'),
        'cpu_ms': round(cpu, 3),
        # 墙钟减 CPU：这段时间进程没在算（等锁、被抢占、等缺页、等 IO）。
        'descheduled_ms': round(max(0.0, wall - cpu), 3),
        'cpu_ratio': round(cpu / wall, 3) if wall > 0 else None,
        'major_faults': after.get('major_faults', 0) - before.get('major_faults', 0),
        'minor_faults': after.get('minor_faults', 0) - before.get('minor_faults', 0),
        'loadavg': after.get('loadavg'),
        'rss_mb': after.get('rss_mb'),
        'available_mb': after.get('available_mb'),
        'idle_seconds': idle_seconds,
    }
    if error:
        row['error'] = error
    return row


def write(row: dict) -> bool:
    """追加一行；失败也不抛出，返回是否写成功。"""
    path = target()
    if not path:
        return False
    try:
        with open(path, 'a', encoding='utf-8') as handle:
            handle.write(json.dumps(row, ensure_ascii=False) + '\n')
        return True
    except Exception:
        return False


def record(timings: dict, before: dict, after: dict, *,
           idle_seconds: float | None = None, error: str | None = None) -> bool:
    """诊断主入口：关闭时是空操作，异常一律吞掉。"""
    if not enabled():
        return False
    try:
        return write(build(timings, before, after, idle_seconds=idle_seconds, error=error))
    except Exception:
        return False
