"""把 TTS 句间停顿压到 GAP 秒，去掉头尾静音，输出 24k 单声道 wav（同 vo/zh-v4 现有格式）。
GAP=0.15 来源：派活「旁白句间停顿压到 0.1–0.2 秒」（鲸鱼娘拆解：17 处停顿全在 0.12–0.21 秒）。"""
import re, subprocess, sys
GAP, TH, MIN = 0.15, "-40dB", 0.08
src, dst = sys.argv[1], sys.argv[2]
log = subprocess.run(["ffmpeg", "-hide_banner", "-i", src, "-af", f"silencedetect=n={TH}:d={MIN}", "-f", "null", "-"], capture_output=True, text=True).stderr
dur = float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", src], capture_output=True, text=True).stdout)
st = [float(x) for x in re.findall(r"silence_start: ([\d.]+)", log)]
en = [float(x) for x in re.findall(r"silence_end: ([\d.]+)", log)]
sil = list(zip(st, en + [dur] * (len(st) - len(en))))
# 有声段 = 静音段之间
voiced, t = [], 0.0
for a, b in sil:
    if a > t + 0.01: voiced.append((t, a))
    t = b
if t < dur - 0.01: voiced.append((t, dur))
pad = 0.06  # 每段两头各留 60ms：30ms 会削掉 B 这类爆破音的起音（彩虹猫听出 bothouse 像 Fothouse）
parts = [(max(0, a - pad), min(dur, b + pad)) for a, b in voiced]
f, labels = [], []
for i, (a, b) in enumerate(parts):
    f.append(f"[0:a]atrim={a:.3f}:{b:.3f},asetpts=PTS-STARTPTS,afade=t=in:d=0.008,afade=t=out:st={b - a - 0.008:.3f}:d=0.008[p{i}]"); labels.append(f"[p{i}]")  # 8ms 淡入淡出去掉切口的咔哒杂音
    if i < len(parts) - 1:
        f.append(f"anullsrc=r=24000:cl=mono,atrim=0:{max(GAP - 2 * pad, 0.01):.3f}[g{i}]"); labels.append(f"[g{i}]")
f.append("".join(labels) + f"concat=n={len(labels)}:v=0:a=1[o]")
subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", src, "-filter_complex", ";".join(f), "-map", "[o]", "-ar", "24000", "-ac", "1", dst], check=True)
print(dst, [f"{a:.2f}-{b:.2f}" for a, b in voiced])
