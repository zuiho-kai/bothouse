"""把多个场景片段按顺序拼成一条成片，片段之间硬切。

用法：python docs/launch/anim/cut.py [剪辑名...] [--lang zh,en]
剪辑表是 cuts/<名>.json：{"clips": [{"scene": "x-team", "speed": 1.5}, ...]}，speed 默认 1。
片段取 out/<场景>.<lang>.mp4（先跑 render.py）；缺的片段跳过并提示。输出 out/<名>.<lang>.mp4。
"""
import argparse, json, pathlib, shutil, subprocess

ROOT = pathlib.Path(__file__).resolve().parent


def cut(name, lang):
    clips = json.loads((ROOT / "cuts" / f"{name}.json").read_text("utf-8"))["clips"]
    inputs, speeds = [], []
    for c in clips:
        src = ROOT / "out" / f"{c['scene']}.{lang}.mp4"
        if not src.exists():
            print(f"跳过 {c['scene']}.{lang}：{src.name} 还没渲染")
            continue
        inputs.append(src)
        speeds.append(float(c.get("speed", 1)))
    if not inputs:
        print(f"{name}.{lang}：没有可用片段")
        return
    # 每段先改速（setpts 除以 speed），再统一 30fps 后首尾相接；30fps 与 render.py 的 -r 30 一致
    chains = [f"[{i}:v]setpts=(PTS-STARTPTS)/{s},fps=30,setsar=1[v{i}]" for i, s in enumerate(speeds)]
    graph = ";".join(chains) + ";" + "".join(f"[v{i}]" for i in range(len(inputs))) + \
        f"concat=n={len(inputs)}:v=1:a=0[out]"
    out = ROOT / "out" / f"{name}.{lang}.mp4"
    cmd = ["ffmpeg", "-y", "-loglevel", "error"]
    for p in inputs:
        cmd += ["-i", str(p)]
    # 编码参数同 render.py（来源：样品 rec.py 的转码说明）
    cmd += ["-filter_complex", graph, "-map", "[out]", "-c:v", "libx264", "-pix_fmt", "yuv420p",
            "-movflags", "+faststart", str(out)]
    subprocess.run(cmd, check=True)
    print(out)


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
