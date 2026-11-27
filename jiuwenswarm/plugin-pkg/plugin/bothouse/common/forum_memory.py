"""Shared team memory forum & memory flow for JiuwenSwarm 0.2.9+ colleagues.

All colleagues using the bothouse plugin share ONE team memory forum (not per-role):
- Threads grouped by "[版块] 对象" with floor numbers and source citations
- Wilson-score ranking with upvote/downvote & auto-collapse for bad/outdated rules
- Citation tracking -> outcome voting -> nightly thread assignment -> repeat-mistake checks
"""
from __future__ import annotations

import hashlib
import json
import math
import os
import re
import time
from pathlib import Path
from typing import Any

FLOOR_TAG_RE = re.compile(r"\s*<!-- 帖 t([0-9a-f]{10})·(\d+)楼(.*?)-->\s*$")
TITLE_ATTR_RE = re.compile(r"题「([^」]*)」")
DESC_ATTR_RE = re.compile(r"述「([^」]*)」")
SECTION_OBJ_RE = re.compile(r"^\[([^\]]+)\]\s*(.+)$")
TOKEN_ASCII_RE = re.compile(r"[a-z0-9_.-]{2,}", re.IGNORECASE)
TOKEN_CJK_RE = re.compile(r"[\u4e00-\u9fff]+")

INIT_WEIGHT = 2
COLLAPSE_NET_THRESHOLD = -1  # net_votes <= -1 or wilson < 0.22 with downvotes > 0


def _atomic_write_text(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f".{path.name}.tmp.{os.getpid()}")
    tmp.write_text(text, encoding="utf-8")
    os.replace(tmp, path)


def _append_jsonl(path: Path, record: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(record, ensure_ascii=False) + "\n")


def _read_jsonl(path: Path) -> list[dict[str, Any]]:
    if not path.is_file():
        return []
    out: list[dict[str, Any]] = []
    for line in path.read_text(encoding="utf-8", errors="ignore").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            obj = json.loads(line)
            if isinstance(obj, dict):
                out.append(obj)
        except ValueError:
            continue
    return out


def team_memory_root() -> Path:
    """Return the single shared team memory directory across all JiuwenSwarm colleagues."""
    env_dir = os.environ.get("BOTHOUSE_TEAM_MEMORY_DIR", "").strip()
    if env_dir:
        return Path(env_dir).expanduser()
    try:
        from jiuwenswarm.common.utils import get_root_dir

        return get_root_dir() / "bothouse" / "team-memory"
    except Exception:
        return Path.home() / ".jiuwenswarm" / "bothouse" / "team-memory"


def shared_wiki_dir() -> Path:
    """Return the shared team wiki directory (~/wiki if configured via GATE_WIKI, else team-memory/wiki)."""
    gate_wiki = os.environ.get("GATE_WIKI", "").strip()
    if gate_wiki:
        p = Path(gate_wiki).expanduser()
        if p.is_dir():
            return p
    return team_memory_root() / "wiki"


def bare_line(line: str) -> str:
    return FLOOR_TAG_RE.sub("", line).strip()


def line_cid(line: str) -> str:
    return hashlib.sha1(bare_line(line).encode("utf-8")).hexdigest()[:10]


def wilson_score(up: int, down: int, z: float = 1.28155) -> float:
    """Reddit 'best' comment ranking (Wilson score lower bound), matching forum_scores.py."""
    n = up + down
    if n <= 0:
        return 0.0
    p = up / n
    z2 = z * z
    num = p + z2 / (2 * n) - z * math.sqrt((p * (1 - p) + z2 / (4 * n)) / n)
    den = 1 + z2 / n
    return round(max(0.0, num / den), 4)


def _tokenize(text: str) -> list[str]:
    tokens: list[str] = []
    for m in TOKEN_ASCII_RE.findall(text.lower()):
        tokens.append(m)
    for seg in TOKEN_CJK_RE.findall(text):
        if len(seg) <= 2:
            tokens.append(seg)
        else:
            for i in range(len(seg) - 1):
                tokens.append(seg[i : i + 2])
    return list(dict.fromkeys(tokens))


def _load_votes(mem_root: Path) -> tuple[dict[str, dict[str, int]], dict[str, int]]:
    """Return ({cid: {'up': int, 'down': int}}, {cid: cite_count})."""
    votes_path = mem_root / "votes.jsonl"
    outcome_by_voter: dict[tuple[str, str], int] = {}
    cites: dict[str, int] = {}
    for rec in _read_jsonl(votes_path):
        cid_raw = str(rec.get("id", "")).strip()
        short_id = cid_raw.split("#")[-1] if "#" in cid_raw else cid_raw
        if not short_id:
            continue
        by = rec.get("by", "self")
        if by == "self":
            cites[short_id] = cites.get(short_id, 0) + 1
            continue
        voter = str(rec.get("voter", "team"))
        vote = int(rec.get("vote", 0))
        outcome_by_voter[(voter, short_id)] = vote

    tallies: dict[str, dict[str, int]] = {}
    for (_voter, short_id), v in outcome_by_voter.items():
        slot = tallies.setdefault(short_id, {"up": 0, "down": 0})
        if v > 0:
            slot["up"] += 1
        elif v < 0:
            slot["down"] += 1
    return tallies, cites


def scan_forum_threads(wiki_dir: Path | None = None, mem_root: Path | None = None) -> list[dict[str, Any]]:
    """Scan shared wiki markdown files and return grouped forum threads with scores and collapse flags."""
    wdir = wiki_dir or shared_wiki_dir()
    mroot = mem_root or team_memory_root()
    tallies, cites = _load_votes(mroot)
    threads: dict[str, dict[str, Any]] = {}

    if not wdir.is_dir():
        return []

    for md in sorted(wdir.rglob("*.md")):
        if md.name in {"README.md", "MEMORY.md", "CLAUDE.md", "log.md"}:
            continue
        rel = md.relative_to(wdir).as_posix()
        try:
            lines = md.read_text(encoding="utf-8", errors="ignore").splitlines()
        except OSError:
            continue
        for raw in lines:
            stripped = raw.strip()
            if not stripped.startswith(("- ", "* ")):
                continue
            m = FLOOR_TAG_RE.search(raw)
            content = bare_line(raw).lstrip("-* ").strip()
            if not content:
                continue
            cid = line_cid(raw)
            vote_info = tallies.get(cid, {"up": 0, "down": 0})
            up = vote_info["up"]
            down = vote_info["down"]
            score = wilson_score(INIT_WEIGHT + up, down)
            collapsed = (up - down <= COLLAPSE_NET_THRESHOLD) or (down > up and score < 0.25)

            if m:
                tid = "t" + m.group(1)
                floor_no = int(m.group(2))
                attrs = m.group(3)
                tm = TITLE_ATTR_RE.search(attrs)
                dm = DESC_ATTR_RE.search(attrs)
                title = tm.group(1).strip() if tm else ""
                desc = dm.group(1).strip() if dm else ""
            else:
                tid = "t" + cid
                floor_no = 1
                title = f"[{md.stem}] {content[:28]}"
                desc = ""

            th = threads.setdefault(
                tid,
                {
                    "tid": tid,
                    "title": title or f"[{md.stem}] {content[:28]}",
                    "desc": desc,
                    "section": "",
                    "object": "",
                    "page": rel,
                    "floors": [],
                    "upvotes": 0,
                    "downvotes": 0,
                    "cites": 0,
                    "score": 0.0,
                    "collapsed": False,
                },
            )
            if title and (not th["title"] or floor_no == 1):
                th["title"] = title
            if desc and not th["desc"]:
                th["desc"] = desc
            sec_m = SECTION_OBJ_RE.match(th["title"])
            if sec_m:
                th["section"] = sec_m.group(1).strip()
                th["object"] = sec_m.group(2).strip()
            else:
                th["section"] = md.stem
                th["object"] = th["title"]

            th["floors"].append(
                {
                    "floor": floor_no,
                    "cid": cid,
                    "text": content,
                    "upvotes": up,
                    "downvotes": down,
                    "cites": cites.get(cid, 0),
                    "score": score,
                    "collapsed": collapsed,
                }
            )

    result: list[dict[str, Any]] = []
    for th in threads.values():
        th["floors"].sort(key=lambda f: f["floor"])
        active_floors = [f for f in th["floors"] if not f["collapsed"]]
        best_floor = max(active_floors or th["floors"], key=lambda f: (f["score"], -f["floor"]))
        th["upvotes"] = sum(f["upvotes"] for f in th["floors"])
        th["downvotes"] = sum(f["downvotes"] for f in th["floors"])
        th["cites"] = sum(f["cites"] for f in th["floors"])
        th["score"] = best_floor["score"]
        th["collapsed"] = all(f["collapsed"] for f in th["floors"])
        th["top_rule"] = best_floor["text"]
        th["top_cid"] = best_floor["cid"]
        result.append(th)

    result.sort(key=lambda t: (not t["collapsed"], t["score"], t["upvotes"] - t["downvotes"]), reverse=True)
    return result


def search_forum(
    query: str,
    *,
    section: str = "",
    limit: int = 5,
    include_collapsed: bool = False,
    wiki_dir: Path | None = None,
    mem_root: Path | None = None,
) -> list[dict[str, Any]]:
    """Search the shared memory forum for rules/threads matching query and optional [版块] section."""
    threads = scan_forum_threads(wiki_dir=wiki_dir, mem_root=mem_root)
    if section:
        sec_l = section.strip().lower()
        threads = [t for t in threads if sec_l in t["section"].lower() or sec_l in t["title"].lower()]
    if not include_collapsed:
        threads = [t for t in threads if not t["collapsed"]]
    tokens = _tokenize(query)
    if not tokens:
        return threads[:limit]

    scored: list[tuple[float, dict[str, Any]]] = []
    for th in threads:
        haystack = " ".join([th["title"], th["desc"], *(f["text"] for f in th["floors"])]).lower()
        hits = sum(1 for tok in tokens if tok in haystack)
        if hits == 0:
            continue
        rank = hits * (1.0 + th["score"])
        scored.append((rank, th))
    scored.sort(key=lambda item: item[0], reverse=True)
    return [item[1] for item in scored[:limit]]


def cite_rules(cids: list[str], *, voter: str = "team", session_id: str = "", mem_root: Path | None = None) -> int:
    """Record self-citations for memory items used in this turn (memvote cite semantics)."""
    mroot = mem_root or team_memory_root()
    now = time.strftime("%Y-%m-%d %H:%M:%S")
    count = 0
    for cid in cids:
        clean = str(cid).strip().lstrip("#")
        if not clean:
            continue
        _append_jsonl(
            mroot / "votes.jsonl",
            {
                "t": now,
                "voter": voter,
                "id": clean,
                "vote": 1,
                "by": "self",
                "key": session_id,
                "agent": "jiuwenmate",
            },
        )
        count += 1
    return count


def _load_checks(mroot: Path) -> list[dict[str, Any]]:
    checks_file = mroot / "checks.json"
    if not checks_file.is_file():
        return []
    try:
        data = json.loads(checks_file.read_text(encoding="utf-8"))
        return data if isinstance(data, list) else []
    except (OSError, ValueError):
        return []


def _save_checks(mroot: Path, checks: list[dict[str, Any]]) -> None:
    _atomic_write_text(mroot / "checks.json", json.dumps(checks, ensure_ascii=False, indent=2) + "\n")


def record_correction(
    *,
    rule: str,
    section: str,
    obj: str,
    quote: str,
    source: str,
    actor: str = "team",
    mistake_key: str = "",
    cited_cids: list[str] | None = None,
    mem_root: Path | None = None,
) -> dict[str, Any]:
    """Record a correction from chat/topic; on 2nd occurrence of same mistake_key, promote to hard check."""
    mroot = mem_root or team_memory_root()
    now = time.strftime("%Y-%m-%d %H:%M:%S")
    norm_key = (mistake_key or f"{section.strip()}::{obj.strip()}").lower()
    existing = _read_jsonl(mroot / "corrections.jsonl")
    prev_count = sum(1 for r in existing if str(r.get("mistake_key", "")).lower() == norm_key)
    new_count = prev_count + 1

    entry = {
        "t": now,
        "section": section.strip(),
        "object": obj.strip(),
        "rule": rule.strip(),
        "quote": quote.strip(),
        "source": source.strip(),
        "actor": actor,
        "mistake_key": norm_key,
        "occurrence": new_count,
        "cited_cids": list(cited_cids or []),
        "assigned": False,
    }
    _append_jsonl(mroot / "corrections.jsonl", entry)

    # Downvote any cited rule that led to a correction
    for cid in cited_cids or []:
        _append_jsonl(
            mroot / "votes.jsonl",
            {"t": now, "voter": actor, "id": str(cid).lstrip("#"), "vote": -1, "by": "outcome", "key": source},
        )

    promoted_check = None
    if new_count >= 2:
        checks = _load_checks(mroot)
        if not any(c.get("mistake_key") == norm_key for c in checks):
            promoted_check = {
                "id": "chk_" + hashlib.sha1(norm_key.encode("utf-8")).hexdigest()[:8],
                "mistake_key": norm_key,
                "section": section.strip(),
                "object": obj.strip(),
                "rule": rule.strip(),
                "required_keywords": [tok for tok in _tokenize(rule)[:3]],
                "forbidden_keywords": [],
                "created_at": now,
            }
            checks.append(promoted_check)
            _save_checks(mroot, checks)

    return {"recorded": True, "occurrence": new_count, "promoted_check": promoted_check}


def run_nightly_flow(
    *,
    wiki_dir: Path | None = None,
    mem_root: Path | None = None,
) -> dict[str, Any]:
    """Run nightly memory flow: assign pending corrections to '[版块] 对象' threads + outcome votes."""
    wdir = wiki_dir or shared_wiki_dir()
    mroot = mem_root or team_memory_root()
    wdir.mkdir(parents=True, exist_ok=True)
    corr_path = mroot / "corrections.jsonl"
    records = _read_jsonl(corr_path)
    threads = scan_forum_threads(wiki_dir=wdir, mem_root=mroot)
    by_title = {t["title"]: t for t in threads}

    assigned_count = 0
    for rec in records:
        if rec.get("assigned"):
            continue
        sec = rec.get("section") or "团队规范"
        obj = rec.get("object") or "通用"
        title = f"[{sec}] {obj}"
        rule_text = f"{rec['rule']}（出处：{rec.get('source', '群聊')}）"
        existing = by_title.get(title)
        if existing:
            tid_hex = existing["tid"].lstrip("t")
            floor_no = len(existing["floors"]) + 1
            page_path = wdir / existing["page"]
            tag = f" <!-- 帖 t{tid_hex}·{floor_no}楼 -->"
            existing["floors"].append({"floor": floor_no, "text": rule_text})
        else:
            tid_hex = hashlib.sha1(title.encode("utf-8")).hexdigest()[:10]
            slug = re.sub(r"[^a-z0-9\u4e00-\u9fff]+", "-", sec.lower()).strip("-") or "team-rules"
            page_path = wdir / f"{slug}.md"
            tag = f" <!-- 帖 t{tid_hex}·1楼 题「{title}」 述「{sec}相关团队规矩」 -->"
            by_title[title] = {
                "tid": f"t{tid_hex}",
                "title": title,
                "page": page_path.relative_to(wdir).as_posix(),
                "floors": [{"floor": 1, "text": rule_text}],
            }
        prev = page_path.read_text(encoding="utf-8") if page_path.is_file() else f"# {sec}\n\n"
        if not prev.endswith("\n"):
            prev += "\n"
        _atomic_write_text(page_path, prev + f"- {rule_text}{tag}\n")
        rec["assigned"] = True
        assigned_count += 1

    if assigned_count:
        _atomic_write_text(
            corr_path,
            "".join(json.dumps(r, ensure_ascii=False) + "\n" for r in records),
        )

    # Outcome upvote for cited rules in sessions that had no corrections
    corrected_cids = {c for r in records for c in (r.get("cited_cids") or [])}
    votes = _read_jsonl(mroot / "votes.jsonl")
    already_outcome = {
        (v.get("voter"), v.get("id")) for v in votes if v.get("by") == "outcome"
    }
    now = time.strftime("%Y-%m-%d %H:%M:%S")
    upvoted = 0
    for v in votes:
        if v.get("by") != "self":
            continue
        cid = str(v.get("id", ""))
        voter = str(v.get("voter", "team"))
        if cid in corrected_cids or (voter, cid) in already_outcome:
            continue
        _append_jsonl(
            mroot / "votes.jsonl",
            {"t": now, "voter": voter, "id": cid, "vote": 1, "by": "outcome", "key": v.get("key", "")},
        )
        already_outcome.add((voter, cid))
        upvoted += 1

    return {"assigned": assigned_count, "outcome_upvoted": upvoted, "threads_total": len(by_title)}


def check_delivery_rules(
    summary: str,
    *,
    evidence: str = "",
    mem_root: Path | None = None,
) -> dict[str, Any]:
    """Run active repeat-mistake checks before task delivery. Rejects if violated."""
    mroot = mem_root or team_memory_root()
    checks = _load_checks(mroot)
    combined = f"{summary}\n{evidence}".lower()
    violations: list[dict[str, Any]] = []
    for chk in checks:
        forbidden = [k.lower() for k in chk.get("forbidden_keywords") or [] if k]
        required = [k.lower() for k in chk.get("required_keywords") or [] if k]
        hit_forbidden = [k for k in forbidden if k in combined]
        missing_required = [k for k in required if k not in combined] if required else []
        if hit_forbidden or (required and len(missing_required) == len(required)):
            violations.append(
                {
                    "check_id": chk.get("id"),
                    "rule": chk.get("rule"),
                    "reason": (
                        f"命中禁用项 {hit_forbidden}" if hit_forbidden else f"未体现必查项（{chk.get('rule')}）"
                    ),
                }
            )
    return {"passed": len(violations) == 0, "violations": violations}
