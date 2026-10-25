"""One-off: create each sub bot's wiki (bots.json "wiki", default <workdir>/wiki) from an llm-wiki clone
(Chinese schema, bot domains, codex engines).

  setup_wiki.py <bot> ...   bots are keys of $WIKI_BOTS (default bots.json next to this file)
  setup_wiki.py --main <dir> <lead name> [<lead project>]
                            a machine with no main wiki yet (the setup wizard, user 2026-10-22 「记忆就是我们的llmwiki
                            ……当然也能独立」): <dir> from the template, with the shared programs in <dir>/bin that every
                            role's wiki forwards to. With <lead project> it is the lead's own wiki (as ~/wiki is 橘's):
                            it reads her transcripts (<WIKI_TRANSCRIPTS>/<lead project>), and dream/lint read her persona
                            ($WIKI_LEAD_PERSONA), not ~/.claude/CLAUDE.md; without, it reads no sessions. Either way it
                            writes MAIN_MARK (the lead project, or empty): the wizard takes a main wiki over for the
                            lead only when that file names her, so a wiki the user had before is never written to.
  env: LLM_WIKI_SRC = llm-wiki checkout or git URL to clone, or a plain copy of the template (default ~/llm-wiki;
       the setup wizard passes template/ next to this file, a copy of github.com/zuiho-kai/llm-wiki);
       WIKI_LEAD = 主角色名字（队友前缀示例）; WIKI_USER = the user's display name in channel lines;
       WIKI_TEAM = JSON list of the team's names (--main: config.json "bots"); WIKI_SHARED_BIN = the main
       wiki's bin/ (a role wiki's shims forward there, written to bin/.shared-bin; default ~/wiki/bin);
       WIKI_ENGINES = JSON object of config.json engine keys overriding the codex defaults below (the wizard sets
       them from the role's own CLI, so a machine without Codex still runs its wikis)
"""
import json, os, re, shutil, stat, subprocess, sys
from pathlib import Path
H = Path.home()
HERE = Path(__file__).resolve().parent
_bots_file = Path(os.environ.get("WIKI_BOTS") or HERE / "bots.json").expanduser()
_bots = json.loads(_bots_file.read_text(encoding="utf-8")) if _bots_file.exists() else {}
NAMES = {k: v.get("name") or k for k, v in _bots.items()}
PERSONA = {k: v.get("persona") or str(Path(v["workdir"]) / "AGENTS.md") for k, v in _bots.items()}
SRC = os.environ.get("LLM_WIKI_SRC") or str(H / "llm-wiki")
LEAD = os.environ.get("WIKI_LEAD", "主角色")
USER = os.environ.get("WIKI_USER", "<用户名>")
TRANSCRIPTS = os.environ.get("WIKI_TRANSCRIPTS") or str(HERE / "transcripts")
MAIN_MARK = ".bothouse-main"  # in a main wiki this program made: the lead project whose wiki it is ("" = nobody's)
# categories: review ~/.claude/reviews/sub-memory.md (经历 / 方法与教训 / 作品 / 关系 / 偏好), listed as "我加的设定"
DOMAINS = [("experiences", "经历", "经历：外出、玩过和做过的事、发生过的事故，以及当时的感受"),
           ("lessons", "方法与教训", "方法与教训：做事的方法、工具用法、踩过的坑"),
           ("works", "作品", "作品：自己写的、画的、做的东西（路径、进度）"),
           ("relations", "关系", "关系：用户和队友、外号、对我说过的话、一起的梗"),
           ("prefs", "偏好", "偏好：自己的喜好和习惯，用户对我的要求和否决")]
INTRO = """# Wiki schema

这是{name}（Discord 小群里的 sub bot）自己的记忆 wiki（Karpathy 模式），只归{name}本人读写，别人不翻。原始资料是
{name}自己的会话记录和日记 `diary.md`（由 `export.py` 转成 `{transcripts}/{bot}/`）；
本目录是由 LLM 提炼、维护的那一层。改这里的任何东西之前，先读本文件。用户的知识库在 `~/wiki`，那边的事实不抄过来，
需要时写 `~/wiki/<路径>` 链接。

## 谁在说话（读 TRANSCRIPT 前必看）

- CLAUDE 行 = {name}自己说的话、做的事（工具调用行是她跑的命令）。本 wiki 用第二人称「你」指{name}。
- USER 行 = 频道送进来的消息，不全是用户本人：
  - {team_prefixes}开头的是队友；`{user}:` 或没有前缀的才是用户本人。
  - 「【外出·接着】」「定时触发」「⏰」之类是系统定时消息，不是谁说的话。
  - 「（日记条目：…）」是标记：紧跟着的 CLAUDE 行是{name}自己写的日记。
- 写「用户说/用户定/用户否决」前，先确认那句确实是用户本人说的；队友说的写「{lead}说」等。

## 这本 wiki 记什么

- 除了工作上的事实，{name}自己的经历、作品、和用户及队友的关系、偏好都算长期有用：
  用户对她说过的话、新外号、反复出现的梗、玩过什么和当时的感受、自己做出来的东西。
- 一次性的寒暄、没有后续的闲聊、过程性调试不记。
- 不写秘密：账号密码只写存放位置（如 `<工作目录>/accounts/`）。

"""


def from_template(w):
    """A new wiki repo at w from SRC (a plain template copy, or an llm-wiki checkout / git URL)."""
    src = Path(SRC).expanduser()
    if src.is_dir() and not (src / ".git").exists():  # a plain template copy (the wizard's): copy, start a repo
        shutil.copytree(src, w, ignore=shutil.ignore_patterns("SOURCE", "__pycache__"))
        if (w / "gitignore").exists():  # kept without the dot: a .gitignore inside this repo would hide it
            (w / "gitignore").rename(w / ".gitignore")
        subprocess.run(["git", "init", "-q"], cwd=w, check=True)
    else:
        subprocess.run(["git", "clone", "-q", SRC, str(w)], check=True)
        subprocess.run(["git", "remote", "remove", "origin"], cwd=w, check=True)  # local only: no push anywhere
    (w / "bin").mkdir(exist_ok=True)


def commit(w, msg):
    subprocess.run(["git", "add", "-A"], cwd=w, check=True)
    subprocess.run(["git", "-c", "user.name=sub-memory", "-c", "user.email=sub-memory@localhost", "commit", "-qm", msg],
                   cwd=w, check=True)


def made(w):
    """True when w is a finished wiki (config.json is written last). A half-made one (template copied, then a
    crash before config.json) is removed so this run makes it again."""
    if (w / "config.json").exists():
        return True
    if (w / ".git").exists() and (w / "bin").is_dir():
        # git writes .git/objects read-only; Windows refuses to delete a read-only file, so clear the flag and retry
        shutil.rmtree(w, onerror=lambda fn, path, _: (os.chmod(path, stat.S_IWRITE), fn(path)))
    return False


def main_wiki(w, lead, project=""):
    w = Path(w).expanduser()
    if made(w):
        print(w, "exists")
        return
    if w.exists() and any(w.iterdir()):
        sys.exit(f"{w} exists and is not a wiki (no bin/ingest.py): not touching it")
    if w.exists():
        w.rmdir()
    from_template(w)
    for f in (HERE / "llmwiki").glob("*.py"):
        shutil.copy(f, w / "bin" / f.name)
    shutil.copytree(HERE / "llmwiki" / "teammate", w / "bin" / "teammate", dirs_exist_ok=True,
                    ignore=shutil.ignore_patterns("__pycache__"))
    if project:
        # the lead's own wiki: her sessions (export.py writes transcripts/<bots.json key = project>), the team's names,
        # her persona as the rule file (the ~/.claude/CLAUDE.md default would have dream read the user's global rules)
        team = json.loads(os.environ.get("WIKI_TEAM") or "[]") or []
        persona = os.environ.get("WIKI_LEAD_PERSONA", "")
        cfg = {"transcripts": f"{TRANSCRIPTS}/{project}", "assistant": lead,
               "bots": {n: [n] for n in dict.fromkeys([lead, *NAMES.values(), *team])}, "user_names": [USER],
               "rule_files": [persona] if persona else []}
    else:
        (w / ".no-sessions").mkdir(exist_ok=True)
        (w / ".no-sessions" / ".keep").write_text("")
        cfg = {"assistant": lead, "bots": {lead: [lead]},
               # no lead given: each role's sessions go into that role's own wiki (bots.json); this one reads none
               "transcripts": str(w / ".no-sessions"), "rule_files": []}
    cfg["home"] = str(w)  # not ingest.py's "~/wiki" default: a main wiki at $WIKI_DIR is its own home
    (w / MAIN_MARK).write_text(project + "\n")
    cfg.update({k: v for k, v in (json.loads(os.environ.get("WIKI_ENGINES") or "{}") or {}).items()
                if k.endswith("_engine") or k in ("after_codex", "codex_models", "dsh_cmd", "dsh_patch", "dsh_env_file")})
    (w / "config.json").write_text(json.dumps(cfg, ensure_ascii=False, indent=2) + "\n")
    commit(w, "llm-wiki：主 wiki 和共享程序（向导建）")
    print(w, "created")


def main(bot):
    name = NAMES[bot]
    w = Path(_bots[bot].get("wiki") or Path(_bots[bot]["workdir"]) / "wiki").expanduser()
    if made(w):
        print(bot, w, "exists")
        return
    if w.exists() and any(w.iterdir()):
        sys.exit(f"{w} exists and is not a wiki (no config.json): not touching it")
    if w.exists():
        w.rmdir()
    from_template(w)
    schema = (w / "schema/CLAUDE.zh-CN.md").read_text()
    body = schema.split("## 分层", 1)[1]
    body = "## 分层" + body
    body = re.sub(r"## 阅读摘要（论文/外部项目）.*?(?=## 工具)", "", body, flags=re.S)
    body = body.replace("回答「怎么连我的服务器」：MEMORY.md → `infra/README.md` → `infra/server.md`。",
                        "回答「上次和用户玩了什么」：MEMORY.md → `experiences/README.md` → 对应主题页。")
    prefixes = "".join(f"「【{n}】」" for n in [LEAD, *NAMES.values()])
    (w / "CLAUDE.md").write_text(INTRO.format(name=name, bot=bot, transcripts=TRANSCRIPTS, team_prefixes=prefixes,
                                              user=USER, lead=LEAD) + body)
    # bin/ingest.py and bin/lint.py forward to the shared tool (../bin, or $WIKI_BIN), same as the author's sub wikis
    for f in ("ingest.py", "lint.py", "search.py"):
        shutil.copy(HERE / "llmwiki" / "teammate" / f, w / "bin" / f)
    if os.environ.get("WIKI_SHARED_BIN"):  # a main wiki not at ~/wiki ($WIKI_DIR): the shims read where it is
        (w / "bin" / ".shared-bin").write_text(os.environ["WIKI_SHARED_BIN"] + "\n")
    for d in ("refs",):
        if subprocess.run(["git", "ls-files", "--error-unmatch", d], cwd=w, capture_output=True).returncode == 0:
            subprocess.run(["git", "rm", "-rq", d], cwd=w, check=True)
        else:
            shutil.rmtree(w / d, ignore_errors=True)
    lines = []
    for d, zh, desc in DOMAINS:
        (w / d).mkdir()
        (w / d / "README.md").write_text(f"# {zh}\n\n{desc.split('：', 1)[1]}。\n")
        lines.append(f"- [{d}]({d}/README.md) — {desc}")
    lines.append("- [misc](misc/README.md) — 放不进上面各类的零散主题；dream 的规则候选")
    (w / "MEMORY.md").write_text("\n".join(lines) + "\n")
    (w / "misc/README.md").write_text("# misc\n\n放不进现有分类的零散主题。≥ 2 个相关主题时升为新分类。\n")
    (w / "log.md").write_text("# Log\n\n只追加的历史。条目格式：`## [YYYY-MM-DD] ingest | <sid8> <会话标题>`（见 CLAUDE.md）。\n")
    cfg = {
        "transcripts": f"{TRANSCRIPTS}/{bot}",
        "assistant": name, "bots": {n: [n] for n in [LEAD, *NAMES.values()]}, "user_names": [USER],
        # every pass on codex (ChatGPT subscription), none on Claude: user 「额度花太快」; models and efforts as
        # ~/wiki's private pipeline (~/wiki/bin/ingest.py:55-77: night/review/dream/split codex:high, lint codex:max,
        # chain gpt-6-luna → gpt-6.1-sol → gpt-6-astra)
        "ingest_engine": "codex:high", "fallback_engine": "codex:high", "night_engine": "codex:high",
        "review_engine": "codex:high", "lint_engine": "codex:max", "dream_engine": "codex:high",
        "split_engine": "codex:high",
        "codex_models": ["gpt-6-luna", "gpt-6.1-sol", "gpt-6-astra"],
        "after_codex": [],  # no Claude fallback: a failed batch waits for the next night
        "rule_files": [PERSONA[bot]],
    }
    if _bots[bot].get("dsh_home"):
        cfg["dsh_home"] = _bots[bot]["dsh_home"]  # the dsh engine runs under the role's DSH home (ingest.py dsh_env)
    engines = (json.loads(os.environ.get("WIKI_ENGINES") or "{}") or {})
    cfg.update({k: v for k, v in engines.items() if k.endswith("_engine") or k in ("after_codex", "codex_models", "dsh_cmd", "dsh_patch", "dsh_env_file")})
    (w / "config.json").write_text(json.dumps(cfg, ensure_ascii=False, indent=2) + "\n")  # git-ignored
    r = subprocess.run([sys.executable, "-X", "utf8", "-I", "bin/lint.py"], cwd=w, capture_output=True, text=True)
    print(bot, r.stdout.strip())
    commit(w, f"{name}的记忆 wiki：中文 schema、五个分类")


if sys.argv[1:2] == ["--main"]:
    main_wiki(*sys.argv[2:5])
else:
    for b in sys.argv[1:]:
        main(b)
