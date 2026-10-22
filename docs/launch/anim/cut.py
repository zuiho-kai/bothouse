"""把多个场景片段按顺序拼成一条成片，片段之间硬切；可选旁白、字幕、背景音乐。

用法：python docs/launch/anim/cut.py [剪辑名或 .json 路径...] [--lang zh,en]
剪辑表是 cuts/<名>.json，字段见 README「拼成片」。vo、sub、music 都可省；路径相对本目录。
片段取 out/<场景>.<lang>.mp4（先跑 render.py）；缺的片段跳过并提示。输出 out/<名>.<lang>.mp4。
"""
import argparse, json, pathlib, re, shutil, subprocess

ROOT = pathlib.Path(__file__).resolve().parent

PAD = 1.0          # 每镜旁白后的留白，来源：promo-zh-v2.md「全片规格」"每镜时长 = 旁白时长 + 约 1 秒留白"
VO_DELAY = 0.3     # 旁白在镜头开始后多久进来，来源：派活要求"旁白在镜头开始 0.3 秒后进来"
SUB_MAX = 18       # 字幕一屏一行最多字数，来源：派活要求"每屏只显示一行，一行不超过约 18 个汉字"
FADE_OUT = 1.5     # 音乐片尾淡出秒数，来源：派活要求"片尾 1.5 秒淡出"
FPS = 30           # 沿用 render.py 的 -r 30
AR = 44100         # 统一采样率（sidechaincompress 要求两路一致），沿用音乐文件 Digital_Lemonade.mp3 实测 44100
# 字体：规格要 PingFang SC，但本机（macOS 26）的 PingFang 文件 libass/FreeType 打不开，汉字全成方块（2026-10-22 实测，
# ffmpeg -v debug 报 "Glyph ... not found"）。退用系统自带、libass 能读的冬青黑 Hiragino Sans GB，同为无衬线黑体。
SUB_FONT = "Hiragino Sans GB"
W, H = 1280, 720   # 画面尺寸，沿用 README「模板约定」
WRAP_STYLE = 2     # libass WrapStyle 2 = 不自动换行：一屏只有一行，长句由 segments() 切成多屏
# 第 1 镜音乐音量：规格要"第 1 镜只有低音氛围"；0.2（约 -14 dB）是我定的，没有外部来源
INTRO_VOL = 0.2
# 响度：TTS 原声比音乐轻约 10 dB（测试片 volumedetect 实测），不统一的话闪避后音乐仍盖过人声。
# 旁白统一到 -16 LUFS（我定的，常见网络视频响度），音乐无旁白处 -20 LUFS（我定的，比人声低 4 dB 当背景）
VO_LUFS = -16
MUSIC_LUFS = -20
# 闪避：规格要"有旁白时音乐比人声低约 12 dB"，即音乐再压约 8 dB；threshold/ratio 是我定的，按测试片 volumedetect 实测校准
DUCK = "threshold=0.03:ratio=8:attack=20:release=400:makeup=1"
# 字幕样式：白字、无描边，底下另画一个圆角半透明黑胶囊（pill_event），放在底部 80px 区域正中。
# 来源：派活要求"真正的圆角半透明黑底胶囊，左右留白，放在底部 80px 区域正中。字号约 36"。
SUB_SIZE = 36
SUB_CY = H - 40           # 底部 80px 区域的中线 y=680
PILL_H = 56               # 胶囊高度，我定的（字号 36 上下各留约 10px）
PILL_PADX = 28            # 胶囊左右留白，我定的
PILL_ALPHA = "60"         # ASS alpha 十六进制，0x60≈62% 不透明，我定的
SUB_STYLE = (f"Style: Sub,{SUB_FONT},{SUB_SIZE},&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,"
             "0,0,0,0,100,100,0,0,1,0,0,5,0,0,0,1")


def ass_head():
    return (f"[Script Info]\nScriptType: v4.00+\nPlayResX: {W}\nPlayResY: {H}\nWrapStyle: {WRAP_STYLE}\n\n"
            "[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, "
            "BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, "
            "Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n"
            f"{SUB_STYLE}\n\n[Events]\n"
            "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n")


def probe(p):
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(p)],
                         capture_output=True, text=True, check=True).stdout
    return float(out.strip())


PUNCT = "，。、；：！？,.;:!? "
BREAK = "，。、；：！？,;:!?"   # 切屏处：逗号、顿号、句号等；断开处的标点全片统一去掉


def segments(text, n=SUB_MAX):
    """一句旁白切成若干屏，每屏一行：按逗号、顿号等切，断开处的标点去掉；单段超过 n 字再按 n 字硬切。
    例外（我加的）：顿号连着的并列短词（如「Claude、DeepSeek、Codex」）合起来放不超过 n 字宽时留在同一屏、保留顿号，
    免得一个词闪一屏看不清。"""
    out, prev_dun = [], False
    for seg, sep in re.findall(f"([^{BREAK}]*)([{BREAK}]?)", text.replace("\n", "")):
        seg = seg.strip()
        if seg and prev_dun and out and text_w(out[-1] + "、" + seg) <= n * SUB_SIZE:
            out[-1] += "、" + seg
        elif seg:
            while len(seg) > n:
                out.append(seg[:n].strip())
                seg = seg[n:].strip()
            out.append(seg)
        prev_dun = sep == "、"
    return [x for x in out if x]


def text_w(t):
    """估算 36 号冬青黑的行宽（没有 PIL 测量）：汉字占 1 个字号，ASCII 约 0.55 个字号（我定的估值）。"""
    return sum(SUB_SIZE * (0.55 if ord(c) < 128 else 1.0) for c in t)


def pill_event(a, b, t):
    """在字幕下面画圆角胶囊（ASS 矢量绘图，半径 = 高度一半）。"""
    w, h = text_w(t) + 2 * PILL_PADX, PILL_H
    r, k = h / 2, h / 2 * 0.5523
    x0, y0 = W / 2 - w / 2, SUB_CY - h / 2
    f = lambda *v: " ".join(f"{x:.1f}" for x in v)
    path = (f"m {f(r, 0)} l {f(w - r, 0)} b {f(w - r + k, 0, w, r - k, w, r)} "
            f"b {f(w, r + k, w - r + k, h, w - r, h)} l {f(r, h)} "
            f"b {f(r - k, h, 0, r + k, 0, r)} b {f(0, r - k, r - k, 0, r, 0)}")
    tag = (r"{\an7\pos(%.1f,%.1f)\bord0\shad0\1c&H000000&\1a&H%s&\p1}" % (x0, y0, PILL_ALPHA))
    return f"Dialogue: 0,{ts(a)},{ts(b)},Sub,,0,0,0,,{tag}{path}\n"


def ts(t):
    m, s = divmod(max(t, 0), 60)
    return f"0:{int(m):02d}:{s:05.2f}"


def build(name, lang):
    """返回 (ffmpeg 输入参数, filter 链列表, 输出标签, 全片时长)；没有可用片段返回 None。"""
    # name 也可以直接给一个 .json 路径（临时剪辑表不用放进 cuts/）
    f = pathlib.Path(name) if name.endswith(".json") else ROOT / "cuts" / f"{name}.json"
    spec = json.loads(f.read_text("utf-8"))
    shots = []
    for c in spec["clips"]:
        src = ROOT / "out" / f"{c['scene']}.{lang}.mp4"
        if not src.exists():
            print(f"跳过 {c['scene']}.{lang}：{src.name} 还没渲染")
            continue
        speed = float(c.get("speed", 1))
        vdur = probe(src) / speed
        vo = ROOT / c["vo"] if c.get("vo") else None
        if vo and not vo.exists():
            print(f"{c['scene']}：旁白 {c['vo']} 不存在，这一镜不带旁白")
            vo = None
        vodur = probe(vo) if vo else 0.0
        # 每镜时长 = 旁白时长 + 留白；画面更长就保留画面原长
        dur = max(vdur, vodur + PAD) if vo else vdur
        shots.append(dict(src=src, speed=speed, vdur=vdur, vo=vo, vodur=vodur, dur=dur, sub=c.get("sub")))
    if not shots:
        return None

    args, chains, t = [], [], 0.0
    for i, s in enumerate(shots):
        args += ["-i", str(s["src"])]
        s["start"] = t
        t += s["dur"]
        hold = s["dur"] - s["vdur"]
        # 画面比本镜时长短：tpad clone 停在最后一帧补齐
        tp = f",tpad=stop_mode=clone:stop_duration={hold:.3f}" if hold > 0 else ""
        chains.append(f"[{i}:v]setpts=(PTS-STARTPTS)/{s['speed']},fps={FPS},setsar=1{tp}[v{i}]")
    total, n = t, len(shots)
    chains.append("".join(f"[v{i}]" for i in range(n)) + f"concat=n={n}:v=1:a=0[vcat]")

    # 字幕：有旁白就与旁白同起同止，没旁白就占满本镜。
    # 每屏一行：整句按标点切成几屏，时长按字数比例分给这句的旁白时长（我定的分法，没有逐字时间戳）
    events = []
    for s in shots:
        if s["sub"]:
            a = s["start"] + (VO_DELAY if s["vo"] else 0)
            b = a + s["vodur"] if s["vo"] else s["start"] + s["dur"]
            # sub 可写成列表：每项就是一屏（只去掉句尾句号），不再按逗号切
            parts = [x.rstrip("。") for x in s["sub"]] if isinstance(s["sub"], list) else segments(s["sub"])
            per_char = (b - a) / sum(len(x) for x in parts)
            for x in parts:
                b2 = a + per_char * len(x)
                events.append(pill_event(a, b2, x))
                events.append(f"Dialogue: 1,{ts(a)},{ts(b2)},Sub,,0,0,0,,{{\\pos({W/2:.0f},{SUB_CY})}}{x}\n")
                a = b2
    if events:
        ass = ROOT / "out" / f"{pathlib.Path(name).stem}.{lang}.ass"
        ass.write_text(ass_head() + "".join(events), "utf-8")
        chains.append(f"[vcat]ass=filename='{ass}'[vout]")
    else:
        chains.append("[vcat]null[vout]")

    fmt = f"aresample={AR},aformat=sample_fmts=fltp:channel_layouts=stereo"
    idx, vos = n, []
    for s in shots:
        if s["vo"]:
            ms = round((s["start"] + VO_DELAY) * 1000)
            args += ["-i", str(s["vo"])]
            chains.append(f"[{idx}:a]loudnorm=I={VO_LUFS},{fmt},adelay={ms}:all=1[vo{idx}]")
            vos.append(f"[vo{idx}]")
            idx += 1
    voice = None
    if vos:
        # normalize=0：各段旁白时间不重叠，直接相加，不按路数降音量
        mix = f"amix=inputs={len(vos)}:normalize=0:duration=longest," if len(vos) > 1 else ""
        # 只用 apad 补到全片时长，不接 atrim（原因同下面音乐链：loudnorm 后 atrim 会多剪）
        chains.append(f"{''.join(vos)}{mix}apad=whole_dur={total:.3f}[voice]")
        voice = "voice"

    labels = {"v": "vout", "a": voice, "music": None}
    music = spec.get("music")
    if isinstance(music, list):
        # 分段音乐：每段 {"file", "from": 从第几镜开始(0 起), "seek": 从曲子第几秒开始}，放到下一段开始为止；
        # 段与段之间各淡入淡出 XF 秒。没有「第 1 镜压成氛围音量」这条（那是单曲旧版的规则）
        XF = 0.25   # 换曲淡入淡出秒数，我定的：够短，翻转镜头的音乐切换听起来是"切"不是"渐变"
        starts = [shots[min(m.get("from", 0), n - 1)]["start"] for m in music] + [total]
        segs = []
        for k, m in enumerate(music):
            a, b = starts[k], starts[k + 1]
            if b <= a:
                continue
            seek, d = float(m.get("seek", 0)), b - a
            args += ["-stream_loop", "-1", "-i", str(ROOT / m["file"])]
            fades = (f",afade=t=in:d={XF}" if k else "") + (f",afade=t=out:st={max(d - XF, 0):.3f}:d={XF}" if k < len(music) - 1 else "")
            chains.append(f"[{idx}:a]atrim={seek:.3f}:{seek + d:.3f},asetpts=PTS-STARTPTS,loudnorm=I={MUSIC_LUFS},{fmt},asetpts=N/SR/TB{fades},"
                          f"apad=whole_dur={d:.3f},atrim=0:{d:.3f},adelay={round(a * 1000)}:all=1,apad=whole_dur={total:.3f}[ms{k}]")
            segs.append(f"[ms{k}]")
            idx += 1
        mix = f"amix=inputs={len(segs)}:normalize=0:duration=longest," if len(segs) > 1 else ""
        chains.append(f"{''.join(segs)}{mix}apad=whole_dur={total:.3f}[mraw]")
        music = {"_list": True}
    if music:
        if not music.get("_list"):
            args += ["-stream_loop", "-1", "-i", str(ROOT / music["file"])]
            seek = float(music.get("seek", 0))
            if "dip" in music:
                # 单曲按镜头段压音量：dip=[{"from": 第几镜, "to": 到第几镜之前, "gain": 倍数}]，段边缘 DIP_RAMP 秒线性过渡，曲子不断开
                DIP_RAMP = 0.4   # 过渡秒数，我定的：短到跟得上翻转，长到听不出跳变
                expr = "1"
                for d in music["dip"]:
                    a = shots[min(d["from"], n - 1)]["start"]
                    b = shots[d["to"]]["start"] if d["to"] < n else total
                    w = f"clip(min((t-{a - DIP_RAMP:.3f})/{DIP_RAMP},({b + DIP_RAMP:.3f}-t)/{DIP_RAMP}),0,1)"
                    expr = f"({expr})*(1-{1 - float(d['gain']):.3f}*{w})"
                vol = f"volume='{expr}':eval=frame"
            else:
                # 旧版：第 1 镜压到氛围音量，第 2 镜起恢复
                vol = f"volume='if(lt(t,{shots[0]['dur']:.3f}),{INTRO_VOL},1)':eval=frame"
            # loudnorm 后面接 atrim 会按错位的时间戳多剪约 0.4 秒（实测），所以先 atrim 截长度，loudnorm 后只用 apad 补齐
            chains.append(f"[{idx}:a]atrim={seek:.3f}:{seek + total:.3f},asetpts=PTS-STARTPTS,loudnorm=I={MUSIC_LUFS},{fmt},apad=whole_dur={total:.3f},"
                          f"{vol}[mraw]")
            idx += 1
        m = "mraw"
        if voice:
            # 旁白一路做侧链触发，一路进混音
            chains.append(f"[voice]asplit[vmix][vsc];[mraw][vsc]sidechaincompress={DUCK}[mduck]")
            m, voice = "mduck", "vmix"
        # 音效：sfx=[{"file", "shot": 第几镜, "at": 镜内秒数, "gain": 倍数}]，叠在闪避后的音乐上（不触发闪避）
        sfx = spec.get("sfx") or []
        if sfx:
            outs = []
            for k, e in enumerate(sfx):
                ms = round((shots[min(e["shot"], n - 1)]["start"] + float(e.get("at", 0))) * 1000)
                args += ["-i", str(ROOT / e["file"])]
                chains.append(f"[{idx}:a]{fmt},volume={float(e.get('gain', 1)):.3f},adelay={ms}:all=1,apad=whole_dur={total:.3f}[fx{k}]")
                outs.append(f"[fx{k}]")
                idx += 1
            chains.append(f"[{m}]{''.join(outs)}amix=inputs={len(outs) + 1}:normalize=0:duration=first[mfx]")
            m = "mfx"
        fade = f"afade=t=out:st={max(total - FADE_OUT, 0):.3f}:d={FADE_OUT}"
        # mout 是闪避后的纯音乐，留给测量用；正常出片接 anullsink 丢掉
        chains.append(f"[{m}]asplit[mout][mmix]")
        if voice:
            chains.append(f"[mmix][{voice}]amix=inputs=2:normalize=0,{fade}[aout]")
        else:
            chains.append(f"[mmix]{fade}[aout]")
        labels.update(a="aout", music="mout")
    return args, chains, labels, total


def cut(name, lang):
    b = build(name, lang)
    if not b:
        print(f"{name}.{lang}：没有可用片段")
        return
    args, chains, labels, total = b
    if labels["music"]:
        chains.append(f"[{labels['music']}]anullsink")
    dst = ROOT / "out" / f"{pathlib.Path(name).stem}.{lang}.mp4"
    cmd = ["ffmpeg", "-y", "-loglevel", "error"] + args + \
        ["-filter_complex", ";".join(chains), "-map", f"[{labels['v']}]"]
    if labels["a"]:
        cmd += ["-map", f"[{labels['a']}]", "-c:a", "aac"]
    # 视频编码参数同 render.py（来源：样品 rec.py 的转码说明）；-t 截到全片时长，防止循环音乐拖长
    cmd += ["-c:v", "libx264", "-pix_fmt", "yuv420p", "-t", f"{total:.3f}", "-movflags", "+faststart", str(dst)]
    subprocess.run(cmd, check=True)
    print(dst)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("cuts", nargs="*")
    ap.add_argument("--lang", default="zh,en")
    a = ap.parse_args()
    names = a.cuts or sorted(p.stem for p in (ROOT / "cuts").glob("*.json"))
    for n in names:
        for lang in a.lang.split(","):
            cut(n, lang.strip())


if __name__ == "__main__":
    assert shutil.which("ffmpeg"), "需要 ffmpeg"
    main()
