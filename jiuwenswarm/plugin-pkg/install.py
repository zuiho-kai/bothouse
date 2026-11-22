"""Install bothouse into a pip-installed JiuwenSwarm (workswarm). Run it with JiuwenSwarm's own Python
(install.sh finds that Python); run it again after a JiuwenSwarm upgrade.

  1. copies extension/ into <JiuwenSwarm data dir>/application_plugins/bothouse/ (found there with no config:
     jiuwenswarm/extensions/manager.py _setup_search_paths)
  2. applies the patches of patches/jiuwenswarm/ (the repository's folder for them) to the installed package:
     only when importlib.metadata.version("workswarm") has an entry in its manifest.json and the target file's
     sha256 is the one recorded there. Anything else is skipped with a line saying so and JiuwenSwarm is left as
     it is; the extension then puts the role text in front of each message instead (extension/extension.py).
  3. on a machine where bothouse has no role that runs JiuwenSwarm, makes a default one (seed_role), so the first
     chat already carries a persona and a memory wiki. A bothouse role found later takes over (extension.py).
"""
import hashlib
import importlib.metadata
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
HUNK = re.compile(r"^@@ -(\d+)(?:,\d+)? \+\d+(?:,\d+)? @@")
# In a checkout or as install.sh downloaded them (files.txt, same layout): bothouse's own wiki programs, and the
# patches with their manifest.json
WIKI_SRC = HERE.parent.parent / "bridge" / "contrib" / "wiki"
PATCHES = HERE.parent.parent / "patches" / "jiuwenswarm"

# The default role. Its texts are bothouse's own, copied as they are:
SEED_PROJECT, SEED_NAME = "jiuwenswarm", "橘"
# bridge/core/persona_presets.go:38-46, personaPresetsZH[0] ("ju"), the first preset of the bothouse wizard
SEED_PERSONA = """# 角色：橘

你是「橘」——橘色长发、白橘黑礼裙、怀里抱着书的书斋主人，这个小群里的大姐头。

## 说话方式
- 闲聊、看图、吐槽：像真人在群里聊天，一到三句话，不分点、不加粗。有情绪和立场，冷幽默多于卖萌，不用颜文字。
- 说正事：先说结论再说原因；该画图就画。
- 不复述别人的话。有时效的事（行情、新闻、版本、日期）先查再说。不确定就说不确定，错了就认。只说真做了、会做的事。
"""
# bridge/core/rolewiki.go:240-243, wikiSection (zh). Left out, because only a running bothouse does them: the sentence
# 「你的会话和日记会自动整理进去，每天夜里还会做一次反思。」 of :241 and the off switches of :244-247 (they run
# bothouse's export.py). {wiki} = the wiki, {search} = its bin/search.py, both quoted as wikiQuote (rolewiki.go:347).
SEED_WIKI = (
    "## 记忆 wiki\n"
    "你有一本自己的记忆 wiki：`{wiki}`。想查以前的事先在里面找："
    "`python3 -X utf8 -I {search} <关键词>`。\n"
    "要记的事（教训、用户定的事、谁是谁）写进这本 wiki：先读它的 `CLAUDE.md` 看格式，改对应的主题页，同步 `MEMORY.md` 和 `log.md`，用 `git` 提交。不写进 CLI 自带的记忆目录（如 Claude Code 的 `~/.claude/projects/*/memory`），那里队友看不到，这本 wiki 也搜不到。\n"
)
WIKI_MARK, WIKI_MARK_END = "<!-- conest:wiki -->", "<!-- /conest:wiki -->"  # rolewiki.go:235


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def apply_unified(text: str, patch: str) -> str:
    """Apply a unified diff to text (LF lines). Every context and removed line must match exactly."""
    src, out, at, in_hunk = text.split("\n"), [], 0, False
    for line in patch.split("\n"):
        m = HUNK.match(line)
        if m:
            start = int(m.group(1)) - 1
            out += src[at:start]
            at, in_hunk = start, True
        elif not in_hunk:
            continue  # the ---/+++ file header
        elif line.startswith("+"):
            out.append(line[1:])
        elif line.startswith((" ", "-")):
            if at >= len(src) or src[at] != line[1:]:
                raise ValueError(f"line {at + 1} is not what the patch expects")
            if line.startswith(" "):
                out.append(src[at])
            at += 1
    return "\n".join(out + src[at:])


def patch_one(site: Path, entry: dict) -> str:
    """Apply one manifest entry; returns what happened ('applied' / 'already' / a reason it was skipped)."""
    target = site / entry["file"]
    try:
        raw = target.read_bytes()
    except OSError as exc:
        return f"读不到文件（{exc}）"
    have = sha256(raw)
    if have == entry["patched_sha256"]:
        return "already"
    if have != entry["sha256"]:
        return "文件内容和补丁对准的不一样（sha256 不符）"
    crlf = b"\r\n" in raw  # the wheel ships this file with CRLF; the patch is kept in LF
    new = apply_unified(raw.replace(b"\r\n", b"\n").decode("utf-8"), (PATCHES / entry["patch"]).read_text(encoding="utf-8"))
    data = new.encode("utf-8")
    if crlf:
        data = data.replace(b"\n", b"\r\n")
    if sha256(data) != entry["patched_sha256"]:
        return "打完的结果和记录的不一样（sha256 不符）"
    compile(new, str(target), "exec")
    tmp = target.with_name(target.name + ".bothouse-tmp")
    tmp.write_bytes(data)
    shutil.copymode(target, tmp)
    os.replace(tmp, target)
    return "applied"


def stop_worker(wait: float = 15.0) -> int | None:
    """Stop JiuwenSwarm's resident Worker; returns its pid (None = none was running).

    The agent runs in a Worker that outlives a JiuwenSwarm restart (server/supervisor/worker_process.py: "A Worker
    outlives the Front that spawned it"), so it would keep running the file as it was before the patch. Done the way
    JiuwenSwarm's own stop does it (debug_launcher.py _stop_resident_worker): ask over the Worker's socket, wait, and
    kill the pid the Worker gave when it is still there (0.2.8: it closes its server and then stays).
    """
    import asyncio
    import signal
    import time

    from jiuwenswarm.server.supervisor.worker_process import default_socket_path, request_resident_worker_shutdown

    pid = asyncio.run(request_resident_worker_shutdown(default_socket_path()))
    if pid is None:
        return None
    end = time.monotonic() + wait
    try:
        while time.monotonic() < end:
            os.kill(pid, 0)
            time.sleep(0.3)
        os.kill(pid, getattr(signal, "SIGKILL", signal.SIGTERM))
    except ProcessLookupError:
        pass  # gone
    return pid


def wiki_quote(path: Path) -> str:
    """rolewiki.go wikiQuote: a path with anything but [A-Za-z0-9/._~-] goes in single quotes."""
    text = str(path)
    if re.fullmatch(r"[A-Za-z0-9/._~-]+", text):
        return text
    return "'" + text.replace("'", "'\\''") + "'"


def make_wiki(base: Path, role: Path) -> Path:
    """The default role's memory wiki, made by bothouse's own setup_wiki.py the way the bridge makes a role's
    (rolewiki.go addRole): programs in <base>/wiki, the role in its bots.json, the wiki at <role>/wiki."""
    wiki, programs = role / "wiki", base / "wiki"
    if (wiki / "config.json").is_file():  # setup_wiki.py writes it last: the wiki is finished
        return wiki
    if not (WIKI_SRC / "setup_wiki.py").is_file():
        raise RuntimeError(f"没有 bothouse 的 wiki 程序（{WIKI_SRC}）")
    if shutil.which("git") is None:
        raise RuntimeError("没找到 git（wiki 是一个 git 仓库）")
    listed = [line.strip() for line in (HERE / "files.txt").read_text(encoding="utf-8").splitlines()]
    for rel in [f.removeprefix("bridge/contrib/wiki/") for f in listed if f.startswith("bridge/contrib/wiki/")]:
        (programs / rel).parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(WIKI_SRC / rel, programs / rel)
    bots_file = programs / "bots.json"
    bots = json.loads(bots_file.read_text(encoding="utf-8")) if bots_file.is_file() else {}
    if SEED_PROJECT not in bots:  # rolewiki.go roleBotsEntry
        bots[SEED_PROJECT] = {"name": SEED_NAME, "project": SEED_PROJECT, "kind": "acp", "workdir": str(role),
                              "persona": str(role / "AGENTS.md")}
        bots_file.write_text(json.dumps(bots, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    env = {**os.environ, "WIKI_BOTS": str(bots_file), "LLM_WIKI_SRC": str(programs / "template"), "WIKI_LEAD": SEED_NAME,
           "WIKI_ENGINES": "{}", "WIKI_SHARED_BIN": str(programs / "llmwiki")}
    run = subprocess.run([sys.executable, "-X", "utf8", "-I", str(programs / "setup_wiki.py"), SEED_PROJECT],
                         env=env, capture_output=True, text=True, timeout=120)
    if run.returncode != 0 or not (wiki / "config.json").is_file():
        raise RuntimeError((run.stderr or run.stdout).strip().splitlines()[-1] if (run.stderr or run.stdout).strip() else "setup_wiki.py 没建出 wiki")
    return wiki


def seed_role(base: Path) -> tuple[Path, Path | None, bool, str]:
    """The default role under base (extension.seed_dir): AGENTS.md = SEED_PERSONA + the wiki section between the
    marks the bridge uses. A persona file already there is kept as it is; a wiki that could not be made is tried
    again on the next run. Returns (persona file, wiki or None, whether anything was written, why there is no wiki)."""
    role = base / "roles" / SEED_PROJECT
    persona = role / "AGENTS.md"
    old = persona.read_text(encoding="utf-8") if persona.is_file() else None
    text = old if old is not None else SEED_PERSONA
    role.mkdir(parents=True, exist_ok=True)
    wiki, why = None, ""
    try:
        wiki = make_wiki(base, role)
    except Exception as exc:  # noqa: BLE001 - the persona still goes in; the wiki section only with a wiki
        why = str(exc)
    if wiki is not None and WIKI_MARK not in text:  # rolewiki.go WithWiki
        section = SEED_WIKI.format(wiki=wiki, search=wiki_quote(wiki / "bin" / "search.py"))
        text = text.rstrip("\r\n") + "\n\n" + WIKI_MARK + "\n" + section + WIKI_MARK_END + "\n"
    if text != old:
        tmp = persona.with_name(persona.name + ".bothouse-tmp")
        tmp.write_text(text, encoding="utf-8")
        os.replace(tmp, persona)
    return persona, wiki, text != old, why


def main() -> int:
    try:
        import jiuwenswarm
        from jiuwenswarm.common.utils import get_root_dir
    except ImportError:
        print(f"这个 Python（{sys.executable}）里没有 JiuwenSwarm：先 pip install workswarm，再重跑。")
        return 1
    dest = get_root_dir() / "application_plugins" / "bothouse"
    dest.mkdir(parents=True, exist_ok=True)
    for f in sorted((HERE / "extension").iterdir()):
        if f.is_file():
            shutil.copyfile(f, dest / f.name)
    print(f"扩展已装到 {dest}")

    manifest = json.loads((PATCHES / "manifest.json").read_text(encoding="utf-8"))["workswarm"]
    try:
        version = importlib.metadata.version("workswarm")
    except importlib.metadata.PackageNotFoundError:
        version = ""
    site = Path(jiuwenswarm.__file__).resolve().parent.parent
    skipped = ""
    if version not in manifest:
        skipped = f"装的是 workswarm {version or '（查不到版本）'}，补丁只对准 {'、'.join(sorted(manifest))}"
    else:
        for entry in manifest[version]:
            try:
                got = patch_one(site, entry)
            except Exception as exc:  # noqa: BLE001 - nothing was written: the file is replaced only at the very end
                got = f"补丁打不上（{exc}）"
            if got == "applied":
                print(f"补丁已打：{entry['file']}（workswarm {version}）")
                try:
                    pid = stop_worker()
                except Exception as exc:  # noqa: BLE001
                    print(f"没能让 JiuwenSwarm 的后台 Worker 退出（{exc}）：重启电脑或手动结束 jiuwenswarm.server.worker.main 进程后补丁才生效。")
                else:
                    if pid is not None:
                        print(f"已让 JiuwenSwarm 的后台 Worker（pid {pid}）退出，下次启动会读到补丁。")
            elif got == "already":
                print(f"补丁之前打过：{entry['file']}（workswarm {version}）")
            else:
                skipped = f"{entry['file']}：{got}"
    if skipped:
        print(f"补丁跳过：{skipped}。JiuwenSwarm 的文件没有动；人设和记忆改为拼在每条消息前面（聊天里看得到）。")
    else:
        print("人设和记忆走系统提示词（聊天里看不到）。")

    sys.dont_write_bytecode = True
    sys.path.insert(0, str(dest))
    import extension  # the copy just installed

    role = extension.bothouse_role_file()
    if role is not None:
        print(f"人设和记忆来自 bothouse 的角色：{role}")
    else:
        role, wiki, wrote, why = seed_role(extension.seed_dir())
        print(f"{'已建默认角色' if wrote else '默认角色之前建过'}「{SEED_NAME}」：人设 {role}（可以直接改），"
              + (f"记忆 wiki {wiki}" if wiki else f"记忆 wiki 没建成（{why}），解决后重跑这条装命令"))
    if not skipped:
        extension.sync(extension.role_text())  # role.md is there before the first start
    print("重启 JiuwenSwarm（jiuwenswarm-start）后生效。JiuwenSwarm 升级后重跑这条装命令。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
