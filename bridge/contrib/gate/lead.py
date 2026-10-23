"""主角色（兜底角色）一句话切换：识别、存储、身份段。

用户原话（2026-10-21）：「每个角色他都能当主角色，或者说兜底角色，比如说你今天额度不够了，我可以用X或者Y当兜底角色」
「这个我预期可以一句话去换」。

- 团队从 gate 的团队文件读（gate.py 调 configure(_team)；单独跑时同 gate 的查找顺序：GATE_TEAM → <GATE_SETUP_DIR>/gate-team.json
  → team.example.json）。key "" = 团队文件里的 lead（默认主角色），其余 = subs 的 key（gate_url 的 ?bot=）。
  每个成员可写 "id"（聊天平台的用户 ID，用来认 <@id>）。
- 识别在 gate 里按规则做，不调任何大模型（主角色额度用完时也能切）。
- 「谁是主角色」只存 LEAD_FILE 一处，gate 每次判定实时读，切换不用重启。
- 只认用户本人：cc-connect 只把 allow_from（config.toml 里平台的 allow_from）的人类消息
  交给 gate，bot/板子 webhook 的消息 from_bot=true，所以这里只要求每一段都不是 bot 发的。
"""
import json, os, re, threading, time
from pathlib import Path

_SETUP_ENV = os.environ.get("GATE_SETUP_DIR")
_SETUP = Path(_SETUP_ENV or Path.home() / ".cc-connect").expanduser()
# The bridge and DSH use the product data directory even when no gate is
# installed. Only an explicit file override may select a different location.
_PRODUCT_ENV = os.environ.get("BOTHOUSE_DATA_DIR")
if _PRODUCT_ENV:
    _PRODUCT_DATA = Path(_PRODUCT_ENV).expanduser()
else:
    _preferred = Path.home() / ".bothouse"
    _legacy = Path.home() / ".cc-connect"
    _PRODUCT_DATA = _preferred if _preferred.exists() or not _legacy.exists() else _legacy
_LEGACY_LEAD_FILES = [_PRODUCT_DATA / "gate-lead.json", _SETUP / "gate-lead.json"]
if os.environ.get("GATE_LEAD_FILE"):
    LEAD_FILE = Path(os.environ["GATE_LEAD_FILE"]).expanduser()
else:
    LEAD_FILE = _PRODUCT_DATA / "lead.json"

KEYS, NAME, ID, ALIASES = [], {}, {}, {}
_alias, _WHO, PATTERNS = [], "", []


def _default_team():
    f = os.environ.get("GATE_TEAM") or (_SETUP / "gate-team.json" if (_SETUP / "gate-team.json").exists()
                                         else Path(__file__).with_name("team.example.json"))
    return json.loads(Path(f).expanduser().read_text(encoding="utf-8"))


def configure(team):
    """团队文件 {"lead": {name, aliases, id}, "subs": {key: {name, aliases, id}}} → 本模块的表和正则。"""
    global _alias, _WHO, PATTERNS
    members = {"": team["lead"], **team["subs"]}
    KEYS[:] = list(members)
    NAME.clear(); ID.clear(); ALIASES.clear()
    for k, m in members.items():
        NAME[k] = m["name"]
        if m.get("id"):
            ID[k] = str(m["id"])
        ALIASES[k] = list(dict.fromkeys([m["name"], *m.get("aliases", [])]))
    _build()


def _build():
    global _alias, _WHO, PATTERNS
    _alias = sorted(((a, k) for k, ns in ALIASES.items() for a in ns), key=lambda x: len(x[0]), reverse=True)
    # 拉丁叫法前后不能连着字母（"cc-connect"、"dsl" 不算）
    _WHO = "(?P<who>" + "|".join((rf"(?<![A-Za-z]){re.escape(a)}(?![A-Za-z\-])" if a.isascii() else re.escape(a))
                                 for a, _ in _alias) + r"|<@!?\d+>|你)"
    # 「主」单字后面只能是句末/语气词/标点，免得「主力」「主意」「主页」也算
    _ROLE = r"(?:主角色|主角|兜底角色|兜底|负责人|带头的|主(?=$|[吧了啊呀哈呢，,。.!！~～\s]))"
    _SWITCH = r"(?:换|切|改|转)"
    # 开头叫名字后可以跟逗号/顿号/冒号（「龙娘，你当主」「ds、你当主」，2026-10-21 实测漏认）
    _SEP = r"[\s，,、:：]*"
    PATTERNS = [re.compile(p, re.I) for p in (
        rf"{_SWITCH}回(?:给|成|到)?\s*{_WHO}",                                     # 换回橘 / 切回 cc
        rf"(?:主角色|主角|兜底角色|兜底|负责人)\s*(?:先|就|今天)?\s*{_SWITCH}?(?:成|到|为|给|用|是)\s*{_WHO}",  # 主角色换成龙娘 / 兜底给ds
        rf"(?:让|换|切|改|用|由|请)\s*(?:成|到|为)?\s*{_WHO}\s*(?:来|先|今天)?\s*(?:当|作为|顶|接)?\s*{_ROLE}",  # 换龙娘当主 / 用ds兜底
        rf"^\s*{_WHO}{_SEP}你?\s*(?:来|先|今天)?\s*(?:当|作为|接|顶)\s*{_ROLE}",           # 龙娘当主角色 / ds来兜底 / 龙娘，你当主
        rf"^\s*{_WHO}{_SEP}你?\s*(?:来|先|今天)?\s*兜底",                                       # ds兜底 / 龙娘, 你来兜底
    )]
# 动词不收「做」：「你做主吧」是让对方拿主意，不是切换
# 问句、假设句不算切换（用户原话 A 就是一句「我可以用龙娘或者ds当兜底角色……可以支持吗」）
NOT_COMMAND = re.compile(r"[?？]|吗|如果|假如|要是|的话|能不能|可不可以|会不会|怎么|是不是|为什么|什么时候|支持")


def _resolve(who, own, req, me, to=None, outing=None):
    if who == "你":  # 「@龙娘 你来当主」：自己的 @ 被 cc-connect 去掉了，别人看到的是 <@id>
        ids = re.findall(r"<@!?(\d+)>", own)
        if len(ids) == 1:
            return next((k for k, i in ID.items() if i == ids[0]), None)
        if ids:
            return None
        if req.get("mentioned"):
            return me
        # 没 @：回复谁的消息就是在跟谁说（同 gate.decide_sub「回复她」），否则在谁的外出频道就是跟谁说（同「她的外出频道」）
        # 用户原话 2026-10-21「允许我和子角色说，他当主」
        if to in KEYS:
            return to
        return outing if outing in KEYS else None
    m = re.fullmatch(r"<@!?(\d+)>", who)
    if m:
        return next((k for k, i in ID.items() if i == m.group(1)), None)
    return next(k for a, k in _alias if a.lower() == who.lower())


def parse(req, own, me, to=None, outing=None):
    """这条是不是用户在切换主角色 → 目标 bot key，不是 → None。own = 去掉回复引用后用户自己写的部分。
    to = 被回复的 bot key（gate.split_reply，不是回复 bot 为 None）；outing = 这个频道是谁的外出频道（bot key 或 None）。
    这两个只在用户不 @、不点名、只说「你当主」时用。"""
    parts = req.get("parts") or [{"from_bot": req.get("from_bot")}]
    if req.get("from_bot") or any(p.get("from_bot") for p in parts):
        return None
    text = own.strip()
    if not text or NOT_COMMAND.search(text):
        return None
    for p in PATTERNS:
        m = p.search(text)
        if m:
            return _resolve(m.group("who"), text, req, me, to, outing)
    return None


_lock = threading.Lock()


def state():
    """→ {"lead": key, "at": 切换时间 或 ""}；没切过 / 文件坏了 = 橘（现状）。"""
    for path in (LEAD_FILE, *_LEGACY_LEAD_FILES):
        try:
            s = json.loads(path.read_text())
            if s.get("lead") in KEYS:
                return {"lead": s["lead"], "at": s.get("at", "")}
        except (OSError, ValueError):
            pass
    return {"lead": "", "at": ""}


def current():
    return state()["lead"]


def resolve(who):
    """名字 / 别名 / bot key / Discord ID → bot key；认不出 → None。四个角色自己报「我要当主」时用。"""
    if who is None:
        return None
    w = str(who).strip()
    if w in KEYS:
        return w
    m = re.fullmatch(r"<@!?(\d+)>", w)
    if m:
        return next((k for k, i in ID.items() if i == m.group(1)), None)
    hits = [k for a, k in _alias if a.lower() == w.lower()]
    # 「橘」和空 key 同义；别名表里 "" 也占一个 key，所以去重后只剩一个才算认出
    hits = list(dict.fromkeys(hits))
    return hits[0] if len(hits) == 1 else None


def set_lead(key):
    """四个 bot 会同时为同一条消息问 gate：已经是它就不动（时间戳不变，身份段不重复推）。"""
    with _lock:
        if state()["lead"] == key and LEAD_FILE.exists():
            return False
        LEAD_FILE.parent.mkdir(parents=True, exist_ok=True)
        tmp = LEAD_FILE.with_suffix(".tmp")
        tmp.write_text(json.dumps({"lead": key, "name": NAME[key], "at": time.strftime("%m-%d %H:%M:%S")}, ensure_ascii=False))
        tmp.replace(LEAD_FILE)
        return True


def identity(bot):
    """给 bot 这一轮附的主/次身份段（ctxsvc 拼进上下文）。没切换过 → None：人设文件现在写的就是橘为主。
    第一步只改 gate；bridge 的交接回报/升级/仲裁仍发给 team_lead_bot（橘），第二步改成读这里。"""
    s = state()
    if not s["at"]:
        return None
    L, me = s["lead"], bot
    lead = f"{NAME[L]}（<@{ID[L]}>）" if L in ID else NAME[L]
    if L == "":
        text = f"主角色已换回{NAME['']}，按人设里原来的主/次分工。" + (f"如果用户这句是在切换主角色，用一句话确认：现在主角色是{NAME['']}。" if me == "" else "")
    elif me == L:
        text = (f"用户把主角色（兜底角色）换成了你（{NAME[L]}）。人设里写的「你是 sub、只在被 @ 时开口」暂时不适用："
                f"用户没点名的消息由你接；队友做完的活、报错、升上来的活和三轮没定的仲裁由你处理，可以 @ 队友派活。"
                f"如果用户这句是在切换主角色，用一句话确认：现在主角色是{NAME[L]}。")
    else:
        extra = "人设里写的「你是主」那段暂时不适用，" if me == "" else f"人设里写「{NAME['']}是主」的地方按这条换成{NAME[L]}，"
        text = f"现在主角色是{lead}，你是次：{extra}没被 @ 或点名不开口，要拍板、交接、升级找{NAME[L]}。"
    return {"path": f"【主角色：{NAME[L]}，{s['at']} 用户切换】", "desc": text}



# 主角色工作手册：谁当主就附给谁，当次的不附（用户 2026-10-23「方便任意人当主角色，并且也能放到仓库」）。
# GATE_PLAYBOOK=<文件> 可换成英文版 ../lead/PLAYBOOK.md 或自己的；设成空或 off = 不附。
_pb = os.environ.get("GATE_PLAYBOOK", str(Path(__file__).resolve().parent.parent / "lead" / "PLAYBOOK.zh-CN.md")).strip()
PLAYBOOK = None if _pb.lower() in ("", "off") else Path(_pb).expanduser()


def playbook(bot):
    """bot 是当前主角色 → 手册段（ctxsvc 拼进上下文），否则 None。
    path 里带切换时间：cc-connect 按 path 每个会话只推一次，换主后新主的下一轮收到一次。"""
    s = state()
    if bot != s["lead"] or PLAYBOOK is None or not PLAYBOOK.is_file():
        return None
    return {"path": f"【主角色工作手册：{PLAYBOOK}，{s['at'] or '默认主角色'}】",
            "desc": PLAYBOOK.read_text(encoding="utf-8").strip()}

configure(_default_team())
