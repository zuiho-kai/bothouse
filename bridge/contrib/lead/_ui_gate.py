"""#2042 交回时查界面活的用户视角走查：按这件活实际改动的文件判，不看交接里的字眼。
来源：用户 11-26「做」批的「误拦那条检查挪到干完活再查」（zzzx0757 同日：交接写「KV 布局」碰上「布局」关键词，被当成前端活拦回）。
改动文件从交回草稿里找：写的 PR（gh pr view --json files）、写的本机 git 目录（和 origin 底分支比的改动加未提交的）。
找不到改动就放行：拿不到证据时退回，等于换个地方再误拦。规则（文件正则、提示）在 handoff-rules.json 的 report.user_view_walk。"""
import json, os, re, shutil, subprocess
from pathlib import Path

RULES = Path(__file__).resolve().parent / "handoff-rules.json"
_IMG = re.compile(r"\.(png|jpe?g|webp|gif)$", re.I)
_PR = re.compile(r"github\.com/([\w.-]+/[\w.-]+)/pull/(\d+)|\bPR\s*#?(\d+)", re.I)
_DIR = re.compile(r"(?:~|/Users/[\w.-]+)/work/[^\s`'\"）)，。；：]+")


def _rule():
    try:
        return json.loads(RULES.read_text(encoding="utf-8")).get("report", {}).get("user_view_walk")
    except (OSError, ValueError):
        return None


def _run(args, cwd=None):
    try:
        r = subprocess.run(args, cwd=cwd, capture_output=True, text=True, timeout=30)
    except (OSError, subprocess.SubprocessError):
        return None
    return r.stdout if r.returncode == 0 else None


def _pr_files(repo, num):
    if not shutil.which("gh"):
        return []
    out = _run(["gh", "pr", "view", num, "--json", "files", "--repo", repo or "zuiho-kai/bothouse"])
    try:
        return [f["path"] for f in json.loads(out or "{}").get("files") or []]
    except ValueError:
        return []


def _dir_files(d):
    top = (_run(["git", "rev-parse", "--show-toplevel"], cwd=d) or "").strip()
    if not top:
        return []
    files = []
    for base in ("origin/develop", "origin/main"):
        mb = (_run(["git", "merge-base", "HEAD", base], cwd=top) or "").strip()
        if mb:
            files += (_run(["git", "diff", "--name-only", mb], cwd=top) or "").split()
            break
    files += [ln[3:].strip() for ln in (_run(["git", "status", "--porcelain", "-uall"], cwd=top) or "").splitlines() if len(ln) > 3]
    return files


def changed_files(draft_text):
    """交回草稿里写到的 PR 和本机仓库目录，这件活改了哪些文件（去重）。"""
    files = []
    for m in _PR.finditer(draft_text):
        files += _pr_files(m.group(1), m.group(2) or m.group(3))
    tops = []
    for m in dict.fromkeys(_DIR.findall(draft_text)):
        d = Path(os.path.expanduser(m.rstrip(".,:")))
        while not d.is_dir() and d != d.parent:  # 写的是文件或带行号：退到所在目录
            d = d.parent
        top = (_run(["git", "rev-parse", "--show-toplevel"], cwd=d) or "").strip() if d.is_dir() else ""
        if top and top not in tops:
            tops.append(top)
            files += _dir_files(top)
    return list(dict.fromkeys(f for f in files if f))


def _has_shot(draft_text, files):
    if any(_IMG.search(str(f)) for f in files):
        return True
    for m in re.finditer(r"(~?/[^\s`'\"）)]+\.(?:png|jpe?g|webp|gif))", draft_text, re.I):
        if Path(os.path.expanduser(m.group(1))).is_file():
            return True
    return False


def report_block(draft, files=(), failed=False):
    """改了界面文件、又没带走查截图时返回退回理由；其余（没改界面、找不到改动、失败交回）返回 None。"""
    rule = _rule()
    if failed or not rule:
        return None
    try:
        text = Path(draft).read_text(encoding="utf-8")
    except OSError:
        return None
    ui = [f for f in changed_files(text) if re.search(rule["files_re"], f)]
    if not ui or _has_shot(text, files):
        return None
    return rule["msg"].replace("{files}", "、".join(ui[:5]) + ("等" if len(ui) > 5 else ""))
