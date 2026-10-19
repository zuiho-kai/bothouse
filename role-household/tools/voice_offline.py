"""收音离线仿真：不出声、不收音。合成「角色外放 + 用户远场说话」的麦克风信号，跑主机同一套收音流程
（切句 -> gateway 转写 -> 置信度/回声过滤 -> 口令），看用户的话认不认得出、角色自己的话会不会触发东西。

    uv run python tools/voice_offline.py sim  DIR [--refs /tmp/rhaec/sim60]   # 写 DIR/*.wav、meta.json
    uv run python tools/voice_offline.py eval DIR                             # 打印并写 DIR/results.json

每个场景、每个用户音量档（USER_LEVELS）写两份：
  <场景>.u<档>.noecho.wav  只有用户 + 底噪（无回声基线：这一栏必须全过，否则仿真本身有问题，不能拿来评回声消除）
  <场景>.u<档>.echo.wav    回声 + 用户 + 底噪（不做回声消除时主机收到的）
系统语音处理（rh/vpio.py）不能离线跑（离线渲染模式下开不了 voice processing，见 rh/vpio.py 注释），
所以这里没有“开回声消除”那一栏；真机录的 <场景>.u<档>.vpio.wav 放进同一目录，eval 会多评一栏。

电平（按之前的实测，见 rh/voice.py 说话检测注释）：底噪帧 RMS 约 6；喇叭回声 0.5 秒均值 70-130（取 100）。
用户档位：38 = 实测用户远场说话帧 p90；100、200 = 诊断报告（/tmp/rhaec/diag/REPORT.md「修完后离线验收」）要求加的两档，
因为 38 对两个字的「暂停」偏小（无回声也切不出句子）。
"""
from __future__ import annotations

import argparse
import io
import json
import subprocess
import sys
import tempfile
import wave
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from rh import config as cfgmod, voice, vpio, wake  # noqa: E402

SR = voice.SAMPLE_RATE
FRAME = voice.FRAME_SAMPLES
NOISE_RMS = 6.0     # 来源：实测底噪帧 RMS 中位约 6（rh/voice.py NOISE_INIT 注释）
# 用户说话帧 p90 的三档。来源：38 = 实测用户远场说话帧 p90（rh/voice.py 注释）；100、200 = /tmp/rhaec/diag/REPORT.md「修完后离线验收」
USER_LEVELS = (38, 100, 200)
ECHO_MEAN = 100.0   # 来源：实测喇叭回声 0.5 秒均值 70-130（rh/voice.py 注释），取中间
# 用户的声音：say 的婷婷（高质量音色；仿真里角色用 Qwen 音色，分得开）。来源：2026-10-19 实测（/tmp/rhvpio/uv_test.py，
# 加混响后过 gateway）：原来用的 Reed 和 Eddy/Rocko/Grandpa 这类 Eloquence 音色把「橘」念成别的音，转成「姐」「学」「时」，
# 「彩虹猫，你最喜欢哪部动画」置信度 0.45-0.74；婷婷三句都对（「菊」、0.94-1.0）。之前诊断里的「姐/鱼/徐」是这个音色的问题。
USER_SAY_VOICE = "Tingting"

# 角色台词：R1、R2 和 R4 前半取自 2026-10-19 真机验收时角色真说过的话（/tmp/rhwake/accept.log）；R4 末句和 R3 是加的，
# 故意带别的角色名、产品名、「暂停」「闭麦」，验「角色自己的声音不能触发任何东西」。
ROLE_LINES = {
    "R1": ("jing", "《海底总动员》我当然知道啦，都是同行嘛，看它还得我自己在水里看，多没意思。橘推荐的书听起来不错，不过我可是懒鱼，读那么厚的书会不会睡着？"),
    "R2": ("ju", "我不看电影，只看书。鲸鱼娘要是整天泡在水里，倒可以翻翻村上春树的《海边的卡夫卡》，里面海边和图书馆的场景很对你的胃口。"),
    "R3": ("ju", "彩虹猫你先暂停一下，让鲸鱼娘把话说完。小家里谁要是想闭麦，自己说一声就行，别吵。"),
    "R4": ("mao", "鲸鱼娘要推荐的话，我力荐《海底总动员》，里面的海洋世界画得超漂亮。橘你也暂停看书，陪我们看一部嘛！"),
}
# (场景名, 角色台词, [(用户的话, 角色开口后第几秒说)], 期望)；秒数是实现者定的：多数在回声消除收敛后，留一个刚开口 1 秒的。
# 期望：pause = 停下；say:<角色 id> = 叫到她；none = 什么都不触发（不进频道、不停）
SCENARIOS = [
    ("pause_4s", "R1", [("暂停", 4.0)], "pause"),
    ("pause_early_1s", "R1", [("暂停", 1.0)], "pause"),
    ("pause_natural", "R2", [("暂停一下", 5.0)], "pause"),
    ("call_mao", "R2", [("彩虹猫，你最喜欢哪部动画？", 4.0)], "say:mao"),
    ("call_ju", "R1", [("橘，你最近在看什么书？", 5.0)], "say:ju"),
    ("own_voice_R3", "R3", [], "none"),
    ("own_voice_R4", "R4", [], "none"),
    ("bystander", "R1", [("今天晚上吃什么好呢，要不叫个外卖吧。", 4.0)], "none"),
]
LEAD_SEC = 1.0    # 角色开口前留的安静秒数。来源：实现者定
TAIL_SEC = 1.5    # 角色说完后留的安静秒数（够一句话收尾 END_SILENCE_MS 0.7 秒）。来源：实现者定


def wav_bytes(pcm: np.ndarray, sr: int = SR) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(np.clip(np.round(pcm), -32768, 32767).astype("<i2").tobytes())
    return buf.getvalue()


def resample(x: np.ndarray, sr: int, to: int = SR) -> np.ndarray:
    """整段重采样（频域截断，不混叠）：Qwen 出 24 kHz，收音是 16 kHz。"""
    if sr == to or not len(x):
        return x
    n = max(1, round(len(x) * to / sr))
    spec = np.fft.rfft(x)
    out = np.zeros(n // 2 + 1, dtype=complex)
    k = min(len(spec), len(out))
    out[:k] = spec[:k]
    return np.fft.irfft(out, n) * (n / len(x))


def read_pcm(path: Path) -> np.ndarray:
    pcm, sr = vpio.read_wav(path.read_bytes())
    return resample(np.frombuffer(pcm, dtype="<i2").astype(np.float64), sr)


def frame_rms(x: np.ndarray) -> np.ndarray:
    n = len(x) // FRAME
    return np.sqrt((x[:n * FRAME].reshape(n, FRAME) ** 2).mean(axis=1)) if n else np.zeros(0)


def rir(rng: np.random.Generator, rt60: float, direct_ms: float, drr_db: float) -> np.ndarray:
    """简单房间冲激响应：直达声 + 指数衰减的噪声尾巴（drr_db = 直达声比混响响多少）。"""
    n = int(rt60 * SR)
    t = np.arange(n) / SR
    d = int(direct_ms * SR / 1000)
    h = rng.standard_normal(n) * np.exp(-6.9 * t / rt60)   # 6.9 = ln(1000)：rt60 秒衰减 60 dB 的定义
    h[:d + 1] = 0
    h *= np.sqrt(10 ** (-drr_db / 10) / max((h ** 2).sum(), 1e-12))
    h[d] += 1.0
    return h


def synth_roles(cfg: cfgmod.Config) -> dict[str, tuple[np.ndarray, str]]:
    """用主机同一套 Qwen 合成角色台词（只进内存，不播）。"""
    voices = {r.voice: (r.qwen_speaker, r.qwen_instruct) for r in cfg.roles if r.voice and r.qwen_speaker}
    worker = ROOT / "rh" / "qwen_worker.py"
    q = voice.QwenSynth([cfg.qwen_python, "-I", str(worker), cfg.qwen_model], voices, log=lambda s: print(s, flush=True))
    roles = {r.id: r for r in cfg.roles}
    out = {}
    try:
        for k, (rid, text) in ROLE_LINES.items():
            pcm, sr = vpio.read_wav(q.synth(text, roles[rid].voice))
            out[k] = (resample(np.frombuffer(pcm, dtype="<i2").astype(np.float64), sr), text)
    finally:
        q.close()
    return out


def synth_user(text: str) -> np.ndarray:
    with tempfile.TemporaryDirectory() as d:
        f = Path(d) / "u.wav"
        subprocess.run(["say", "-v", USER_SAY_VOICE, "-o", str(f), "--file-format=WAVE",
                        f"--data-format=LEI16@{SR}", text], check=True)
        return read_pcm(f)




def roles_from_refs(refs: Path) -> dict[str, tuple[np.ndarray, str]]:
    """从之前仿真目录（/tmp/rhaec/sim60）的 ref.wav 取角色台词音频，不用再起 Qwen：ref = 开头 LEAD_SEC 静音 + 台词 + 结尾 TAIL_SEC。"""
    meta = json.loads((refs / "meta.json").read_text())
    by_text = {t: k for k, (_, t) in ROLE_LINES.items()}
    out = {}
    for sc in meta["scenarios"]:
        k = by_text.get(sc["roles"][0]["text"])
        if k and k not in out:
            x = read_pcm(refs / f"{sc['name']}.ref.wav")
            out[k] = (x[int(LEAD_SEC * SR):len(x) - int(TAIL_SEC * SR)], sc["roles"][0]["text"])
    missing = set(ROLE_LINES) - set(out)
    if missing:
        raise SystemExit(f"{refs} 里没有这些台词：{sorted(missing)}")
    return out


def sim(out: Path, delay_ms: float, seed: int, refs: Path | None) -> None:
    out.mkdir(parents=True, exist_ok=True)
    rng = np.random.default_rng(seed)
    roles = roles_from_refs(refs) if refs else synth_roles(cfgmod.load(ROOT / "roles.toml"))
    # 喇叭 -> 耳麦、用户 -> 耳麦都约一米多；混响秒数、直达毫秒、直达/混响比是实现者定的模拟值，
    # 用户那条混响更多（人离麦更偏、不正对）。
    h_echo = rir(rng, rt60=0.4, direct_ms=4, drr_db=3)    # 来源：实现者定的模拟值（见上）
    h_user = rir(rng, rt60=0.4, direct_ms=4, drr_db=-3)   # 来源：实现者定的模拟值（见上）
    meta = {"delay_ms": delay_ms, "seed": seed, "levels": list(USER_LEVELS), "scenarios": []}
    lead, tail = int(LEAD_SEC * SR), int(TAIL_SEC * SR)
    for name, line, says, expect in SCENARIOS:
        ref_role, text = roles[line]
        n = lead + len(ref_role) + tail
        ref = np.zeros(n)
        ref[lead:lead + len(ref_role)] = ref_role
        # 喇叭轻微失真（tanh 软削波，系数实现者定），过房间，再晚 delay_ms 到麦克风
        spk = np.tanh(1.5 * ref / 32768) / 1.5 * 32768
        d = int(delay_ms * SR / 1000)
        echo = np.concatenate([np.zeros(d), np.convolve(spk, h_echo)])[:n]
        echo *= ECHO_MEAN / max(frame_rms(echo[lead:lead + len(ref_role)]).mean(), 1e-9)
        noise = rng.standard_normal(n) * NOISE_RMS
        dry = [(utext, at, np.convolve(synth_user(utext), h_user)) for utext, at in says]
        levels = USER_LEVELS if says else (0,)   # 没有用户说话的场景（角色自己的话）只一档
        files = {}
        for lvl in levels:
            user = np.zeros(n)
            spans = []
            for utext, at, u in dry:
                r = frame_rms(u)
                u = u * lvl / max(np.percentile(r[r > r.max() * 0.05], 90), 1e-9)   # 只算有声的帧（去掉首尾静音），5% 是实现者定
                s = lead + int(at * SR)
                e = min(n, s + len(u))
                user[s:e] += u[:e - s]
                spans.append({"text": utext, "t0": s / SR, "t1": e / SR})
            base = f"{name}.u{lvl}"
            (out / f"{base}.noecho.wav").write_bytes(wav_bytes(user + noise))
            (out / f"{base}.echo.wav").write_bytes(wav_bytes(echo + user + noise))
            files[str(lvl)] = {"base": base, "user": spans}
        (out / f"{name}.ref.wav").write_bytes(wav_bytes(ref))
        meta["scenarios"].append({"name": name, "roles": [{"text": text, "t0": LEAD_SEC, "t1": (lead + len(ref_role)) / SR}],
                                  "levels": files, "expect": expect})
        print(f"[sim] {name}: {n / SR:.1f} 秒，回声帧 RMS 均值 {frame_rms(echo[lead:lead + len(ref_role)]).mean():.0f}，"
              f"用户 {', '.join(u for u, _ in says) or '无'}，档位 {list(levels)}", flush=True)
    (out / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=1))


def run_pipeline(x: np.ndarray, roles: list[dict], asr, words: wake.Words) -> list[dict]:
    """主机收音流程：切句 -> rh.voice.Listener.handle（转写、置信度、回声过滤、口令放行）-> 口令分类。
    时间按样本算（不是墙钟），playing() 按角色台词的起止时间回答“这段时间在念什么”。"""
    events: list[dict] = []
    cur: dict = {}

    def playing(t0, t1):
        return [r["text"] for r in roles if r["t0"] <= t1 and r["t1"] >= t0]

    def on_text(text, t0, t1):
        h = words.classify(text, muted=False)
        cur["action"] = h.action + (":" + ",".join(h.targets) if h.targets else "")

    class LoggedASR:
        def transcribe(self, wav):
            got = asr.transcribe(wav)
            cur["asr"], cur["conf"] = got if isinstance(got, tuple) else (got, None)
            return got

    lst = voice.Listener(LoggedASR(), on_text, lambda stop: [], log=lambda s: cur.setdefault("log", s),
                         playing=playing, urgent=words.stop_word, timed=True)
    seg = voice.Segmenter()
    pcm = np.clip(np.round(x), -32768, 32767).astype("<i2").tobytes()
    step = FRAME * 2
    end = len(pcm) // step * step
    for i in range(0, end, step):
        got = seg.feed(pcm[i:i + step])
        if got is None and i + step >= end:
            got = seg.flush()
        if got is not None:
            t1 = (i + step) / 2 / SR
            t0 = t1 - len(got) / 2 / SR
            cur.clear()
            lst.handle(got, t0, t1)
            events.append({"t0": round(t0, 2), "t1": round(t1, 2), "asr": cur.get("asr"), "conf": cur.get("conf"),
                           "action": cur.get("action", "dropped"), "why": cur.get("log", "")})
    return events


def judge(expect: str, events: list[dict]) -> bool:
    triggered = [e["action"] for e in events if e["action"] not in ("dropped", "ignore")]
    return not triggered if expect == "none" else triggered == [expect]


MODES = {"noecho": "无回声基线", "echo": "有回声、不消除", "vpio": "真机系统语音处理"}


def evaluate(d: Path) -> None:
    meta = json.loads((d / "meta.json").read_text())
    words = wake.Words.from_config(cfgmod.load(ROOT / "roles.toml"))
    asr = voice.gateway_asr("http://127.0.0.1:8787/v1", print)
    if asr is None:
        raise SystemExit("读不到 gateway key")
    results = []
    for sc in meta["scenarios"]:
        for lvl, f in sc["levels"].items():
            row = {"name": sc["name"], "level": int(lvl), "expect": sc["expect"], "user": [u["text"] for u in f["user"]]}
            for mode, label in MODES.items():
                path = d / f"{f['base']}.{mode}.wav"
                if not path.is_file():
                    continue
                evs = run_pipeline(read_pcm(path), sc["roles"], asr, words)
                row[mode] = {"events": evs, "ok": judge(sc["expect"], evs)}
                print(f"[{sc['name']} 用户档 {lvl}] {label}  用户说 {row['user'] or '无'}  期望 {sc['expect']}  "
                      f"{'过' if row[mode]['ok'] else '没过'}", flush=True)
                for e in evs:
                    print(f"    {e['t0']:6.2f}-{e['t1']:6.2f}s  转写「{e['asr']}」 置信度 {e['conf']}  -> {e['action']}"
                          + (f"  （{e['why']}）" if e["action"] == "dropped" else ""), flush=True)
            results.append(row)
    (d / "results.json").write_text(json.dumps(results, ensure_ascii=False, indent=1))
    for mode, label in MODES.items():
        rows = [r for r in results if mode in r]
        if rows:
            bad = [f"{r['name']}@{r['level']}" for r in rows if not r[mode]["ok"]]
            print(f"{label}：{len(rows) - len(bad)}/{len(rows)} 过" + (f"；没过：{'、'.join(bad)}" if bad else ""))


def main() -> None:
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("sim")
    s.add_argument("dir")
    # 回声比参考信号晚多少毫秒到麦克风。来源：实现者定的模拟值（输出缓冲 + 收音块 30 毫秒的量级）
    s.add_argument("--delay-ms", type=float, default=60.0)
    s.add_argument("--seed", type=int, default=1)   # 随机种子，固定才能复现。来源：实现者定
    s.add_argument("--refs", help="从这个旧仿真目录的 *.ref.wav 取角色台词音频（不起 Qwen）")
    e = sub.add_parser("eval")
    e.add_argument("dir")
    a = ap.parse_args()
    if a.cmd == "sim":
        sim(Path(a.dir), a.delay_ms, a.seed, Path(a.refs) if a.refs else None)
    else:
        evaluate(Path(a.dir))


if __name__ == "__main__":
    main()
