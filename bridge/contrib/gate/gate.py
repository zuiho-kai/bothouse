# /// script
# requires-python = ">=3.12"
# dependencies = []  # 打分用 jev（OpenAI 兼容接口，标准库就够）；不装、不下载本地模型
# ///
"""主 bot 的快脑：cc-connect（maomao 分支）每条用户消息先问这里，回 reply / insert / silent / abort。

先走确定性规则，规则定不了再让 jev（向导填的模型）读 A/B/C 三个选项的概率（见 scorer_remote.py）。
没填 jev 时照样启动，只供 /context（每轮 wiki、任务板）和 /lead；/decide 回 503，cc-connect 按 gate_fallback 兜底
（core/gate.go fallbackFor：被 @ 的回，其余归主角色）。不自己下载模型。
每次判断写进 GATE_LOG（默认 <数据目录>/gate.jsonl），用来调规则或以后做微调。
POST /decide  {content, mentioned, busy, has_images, has_files, buffered[]} → {action, reason}
POST /context {key, text} → 每轮相关的 wiki 页（ctxsvc.py；wiki 目录 GATE_WIKI，默认 ~/wiki）

主 + sub：主 bot（/decide）按下面的规则和 4B 决定回/插入/不回，要别人开口就 @ 她们。
sub（/decide?bot=<key>）听群里每句话，但只在被 @ 时回；没 @ 时空闲就记作增量（context，
下次开口一起带上），忙时由 4B 判断这句和她手上的活有没有关系：有就插入，没有就记作增量。
没 @、没回复、没点名的用户消息先过 addressee：jev 读频道最近几条判是说给谁的，只有她按主角色的规则接，
判不出就接着用户正在说话的那位，再没有才归主角色（见下面「没 @ 的消息该归谁」一节）。
"""
import http.client, json, os, re, threading, time, urllib.parse
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import ctxsvc
from scorer_remote import RemoteScorer, load_jev
import lead
import datadir

# bothouse 拉起 gate 时用 GATE_PORT 告诉它听哪个端口（core/gate_proc.go，同 gateAddr）；手动跑不设就是 9930
PORT = int(os.environ.get("GATE_PORT") or 9930)
# 本机模型只在显式设了 GATE_MODEL 时用（GPU 机器上 start_gate_wsl.sh 那种部署），没有默认值、不自动下载
MODEL = os.environ.get("GATE_MODEL", "")
LOG = Path(os.environ.get("GATE_LOG") or datadir.setup_dir() / "gate.jsonl")

# 安装向导（cc-connect 网页 / cc-connect setup apply）把 jev.json、gate-team.json 写在 cc-connect 的数据目录。
SETUP_DIR = datadir.setup_dir()  # GATE_SETUP_DIR，不设 = 产品数据目录（datadir.py）
# 团队成员：GATE_TEAM=<json 文件>；不设就用向导写的 <SETUP_DIR>/gate-team.json（lead = 向导里选的兜底角色），
# 再没有就用同目录的 team.example.json（占位名字，复制一份改成你自己的角色）。格式：
# {"lead": {"name": "C酱", "aliases": ["Claude"]}, "subs": {"gge": {"name": "G哥", "aliases": ["Codex"]}}}
# subs 的 key 就是 cc-connect 里 gate_url 的 ?bot=<key>。
_team_file = os.environ.get("GATE_TEAM") or (SETUP_DIR / "gate-team.json" if (SETUP_DIR / "gate-team.json").exists()
                                              else Path(__file__).with_name("team.example.json"))
_team = json.loads(Path(_team_file).expanduser().read_text(encoding="utf-8"))
LEAD = _team["lead"]["name"]
LEAD_NAMES = [LEAD, *_team["lead"].get("aliases", [])]
SUBS = {k: v["name"] for k, v in _team["subs"].items()}
NAMES = {k: [v["name"], *v.get("aliases", [])] for k, v in _team["subs"].items()}
NAMES[""] = LEAD_NAMES
SUB_LIST = "、".join(SUBS.values())
lead.configure(_team)  # 主角色可切换（lead.py）：用同一份团队文件


def _team_text(t):
    """把提示词里写死的「橘 / 龙娘、鲸鱼娘、彩虹猫」换成当前团队。"""
    return (t.replace("橘、龙娘、鲸鱼娘、彩虹猫", f"{LEAD}、{SUB_LIST}")
             .replace("龙娘、鲸鱼娘、彩虹猫", SUB_LIST).replace("橘", LEAD))

# 明确要它看/答（叫它的名字另看 NAMES[主角色]，主角色可切换，lead.py）
CALL = re.compile(r"你看看|你看下|看一下|帮我|你觉得|你怎么看|怎么看|怎么办|能不能|可以吗|为什么|是什么|吗[？?]?$|[？?]\s*$")
URL = re.compile(r"https?://\S+")
# 纯应答/语气词 → 不出声
ACK = re.compile(r"^(好的?|嗯+|哦+|噢+|ok|OK|行|收到|知道了|谢谢|谢了|thx|👌|👍|哈+|嘿+|[.。!！~～]+)$")
LINKS_FOR_REPLY = 3      # 本条 + 缓存里累计这么多链接 → 该看了
BUFFER_FOR_REPLY = 6     # 攒了这么多条没回 → 该回了

# 指令在前（每次一样，启动时缓存），状态和消息在后（每次只算这段）
PROMPT = """你是群聊里「橘」的"要不要出声"判断器。橘是群里的主 AI，背后能干活；群里还有龙娘、鲸鱼娘、彩虹猫。
根据下面的状态和消息，判断橘该怎么做：
A 不回：闲聊、语气词、自言自语、还没说完、和橘无关
B 插入：给出了新信息、新资料，或者对橘正在做的事的更正、追加、叫停，橘应该马上知道，但用户没要求回答
C 回复：用户在问橘、要橘做事或给意见、问大家的看法
D 打断：橘正在干活时，用户叫停、暂停、别做了、换成别的事（要她马上停下，不是补充信息）
只答一个字母。

"""
PROMPT = _team_text(PROMPT)


def _member_text(t, k):
    """_team_text 之后的提示词，再把主 bot 换成当前主角色 k，其余成员当队友。"""
    others = "、".join(v for j, v in lead.NAME.items() if j != k)
    return t.replace(SUB_LIST, "\0").replace(LEAD, lead.NAME[k]).replace("\0", others)


SUFFIX = "{name}{state}。\n{history}用户刚发：「{msg}」\n\n判断（A 不回 / B 插入 / C 回复 / D 打断）："  # 末尾重提选项：不加的话偏向 A

ACTIONS = ["silent", "insert", "reply", "abort"]  # abort：忙时叫停/暂停/换事 → cc-connect 先取消当前一轮再按 reply 投递（用户原话「我说暂停，还要等个40分钟」）
# 忙时整句只是停止词就叫停：词表照 core/gate_local.go:33 的 localStopWords（停、暂停、停一下、别做了、stop、pause），
# 去掉首尾空白和 isLocalStopWord 那组标点后整句匹配、不分大小写（用户原话「我说暂停，还要等个40分钟」）
STOP_WORDS = re.compile(r"[\s　。.!！~～、,，…]*(?:停|暂停|停一下|别做了|stop|pause)[\s　。.!！~～、,，…]*", re.IGNORECASE)
# 「别做了，改做X」：照 core/gate_local.go:46 localRedirectRe，从开头匹配；abort 后 cc-connect 先取消这一轮再按 reply 开新的一轮
REDIRECT = re.compile(r"(?:先)?别做(?:这个|了)[，,、；;]?\s*改(?:做|成)\s*\S")
# 措辞同向导 jev 一步（web/src/pages/Setup/texts.ts jevQ）和 docs/connect-discord-feishu.md 第 5 节的推荐
NO_JEV = """gate 没填 jev 模型（{path} 不存在，或向导测试时没拿到概率）：只供每轮 wiki/任务板（/context）和 /lead，
不判谁回（/decide 回 503，cc-connect 按 gate_fallback 兜底）。gate 靠 jev 判断一句话该哪个角色回，不会自己下载模型。二选一，填好再启动：
  1. 用免费小模型：硅基流动的免费 Qwen 小模型。在安装向导（运行 cc-connect，浏览器里的 /setup）的 jev 一步填 Base URL、Key、模型名。
  2. 本地下载一个 0.6B 小模型：如 Qwen3 0.6B，用 mlx_lm.server 起 OpenAI 兼容接口
     （mlx_lm.server --model mlx-community/Qwen3-0.6B-4bit），再把地址填进向导的 jev。LM Studio 不给概率，当不了 jev。"""


def make_scorer():
    """jev.json（向导写的、测出给概率的）→ RemoteScorer；显式设了 GATE_MODEL → 本机 scorer.py；都没有 → 不打分（None）。"""
    path = os.environ.get("GATE_JEV") or SETUP_DIR / "jev.json"
    jev = load_jev(path)
    if jev:
        return RemoteScorer(jev), "jev"
    if MODEL:
        try:
            from scorer import Scorer
        except ImportError as e:
            raise SystemExit(f"gate 没法启动：设了 GATE_MODEL={MODEL}，但加载不了本机打分器（{e}）。"
                             "Apple 芯片用 uv run --with mlx-lm 运行；N 卡把 scorer_torch.py 放成 scorer.py。不想用本机模型就去掉 GATE_MODEL、在向导填 jev。")
        return Scorer(MODEL), "local"
    print(NO_JEV.format(path=path), flush=True)
    return _NoScorer(), "none"


class _NoScorer:
    """没 jev：模块里的 prepare 照常走完（拿到 None），/decide 在用到之前就回 503。"""
    def prepare(self, *a, **k):
        return None


scorer, SCORER_KIND = make_scorer()
# 按当前主角色的名字判（lead.py）
tasks = {k: scorer.prepare(_member_text(PROMPT, k), options=["A", "B", "C", "D"], prefill="答案：") for k in lead.KEYS}

# sub：忙时这句要不要打断她
SUB_PROMPT = """一个 AI 成员正在处理派给她的任务，这时群里有人发了新消息。判断这条消息怎么给她：
A 增量：普通群聊、和她手上的任务无关，先记着，等她下次开口时再一起看
B 插入：和她正在做的任务直接相关（更正、补充要求、改方向、叫她名字问进度），应该马上告诉她
D 打断：叫停、暂停、别做了、换成别的事（要她马上停下手上的任务）
群里还有橘、龙娘、鲸鱼娘、彩虹猫；叫的是别人的名字，就是在跟别人说话，不是对她。
只答一个字母。

"""
SUB_PROMPT = _team_text(SUB_PROMPT)
SUB_SUFFIX = "她是「{name}」，正在做的任务：「{task}」\n群里刚发：「{msg}」\n\n判断（A 增量 / B 插入 / D 打断）："
sub_task = scorer.prepare(SUB_PROMPT, options=["A", "B", "D"], prefill="答案：")
# 多频道：每个频道是她的一个独立会话（share_session_in_channel），手上的活按 (bot, session_key) 记
current_task = {}  # (bot, session_key) → 最近一次被叫时的内容

# 点名：消息开头就是名字（"龙娘，帮我…" / "龙娘鲸鱼娘你们看看"）= 在叫她，直接回；
# 名字出现在句中（"龙娘刚才写的有 bug"）可能只是在说她，交给她自己的 4B 判断。
_ALL_NAMES = sorted((n for ns in NAMES.values() for n in ns), key=len, reverse=True)
_NAME = "(?:" + "|".join(_ALL_NAMES) + ")"
# 名字后面得是标点、结尾或呼唤词（你/帮/来…），"龙娘刚才写的…"不算叫她
LEADING = re.compile(r"^\s*" + _NAME + r"(?:[\s，,、和跟与/]*" + _NAME + r")*"
                     r"(?=$|[\s，,、:：!！?？~～.。]|你|帮|来|去|看|在|呢|快|给|说|过来|出来|有空)")
NAMED_THRESHOLD = 0.7  # 句中提到她时，4B 判"叫她"的概率要过这个线才开口（宁可漏，不和橘抢话）
NAMED_PROMPT = """群里有人发了一条消息，里面提到了某个 AI 成员的名字。判断这句话是不是在叫她回话或干活：
A 只是提到她：在跟别人说她、转述她、评价她，并没有要她回应
B 在叫她：问她、要她做事、要她表态
群里有橘、龙娘、鲸鱼娘、彩虹猫和用户。只答一个字母。

"""
NAMED_PROMPT = _team_text(NAMED_PROMPT)
NAMED_SUFFIX = "她是「{name}」。\n群里刚发：「{msg}」\n\n判断（A 只是提到 / B 在叫她）："
named_task = scorer.prepare(NAMED_PROMPT, options=["A", "B"], prefill="答案：")


def called_names(content):
    """开头连着的名字 → 被叫的成员 key 集合（"" = 主 bot）。"""
    m = LEADING.match(content)
    if not m:
        return set()
    lead = m.group(0)
    return {k for k, ns in NAMES.items() if any(n in lead for n in ns)}


def mentions_name(content, bot):
    return any(n in content for n in NAMES[bot])


def _member(name):
    """名字 / 别名 → 成员 key（"" = 团队文件里的 lead）；认不出 → None。"""
    return next((k for k, ns in NAMES.items() if name in ns), None)


def split_reply(content):
    """cc-connect 把 Discord「回复」拼成 "[replying to 作者: 原文]\\n正文"（platform/discord applyReferencedMessage，作者 = Discord 用户名）。
    → (被回复的成员 key 或 None, 用户自己写的部分)。作者按团队文件的名字/别名认（bot 的 Discord 用户名写进 aliases），认不出为 None。
    引用里的名字不算叫她，回复的是谁的消息，就是在跟谁说话（本机 gate 2026-10-12：回复主角色时 sub 因引用里有自己名字跟着开口）。"""
    if not content.startswith("[replying to "):
        return None, content
    end = content.rfind("]\n")
    if end >= 0:
        return _member(content[len("[replying to "):].split(":", 1)[0]), content[end + 2:].strip()
    end = content.rfind("]")  # 正文为空（只发了图/文件）时尾部的换行已被 strip 掉
    if end < 0:
        return None, content
    return _member(content[len("[replying to "):end].split(":", 1)[0]), content[end + 1:].strip()


def user_addressed(req, bot):
    """这条是不是明确在叫这个成员：被 @、开头点名、或回复她的消息。不含模型判断和提问句。"""
    if req.get("mentioned"):
        return True
    to, own = split_reply((req.get("content") or "").strip())
    if re.search(r"<@!?&?\d+>", own):  # @ 了别人
        return False
    called = called_names(own)
    if called:
        return bot in called
    return to == bot


def judge(content, busy, buffered, me=""):
    state = "正在干活（处理用户之前的请求）" if busy else "现在空闲"
    history = ""
    if buffered:
        history = "之前还没回的消息：\n" + "\n".join(f"- {b[:300]}" for b in buffered[-6:]) + "\n"
    return tasks[me].score(SUFFIX.format(name=lead.NAME[me], state=state, history=history, msg=content[:1500]))


def decide_sub(req, bot):
    action, reason, sc = _decide_sub(req, bot)
    if action == "reply" and req.get("busy"):  # 叫她且她正忙：是不是叫停
        key = (bot, req.get("session_key") or "")
        content = split_reply((req.get("content") or "").strip())[1]
        sc2 = sub_task.score(SUB_SUFFIX.format(name=lead.NAME[bot], task=current_task.get(key, "")[:500], msg=content[:1500]))
        if sc2.choice == 2:
            return "abort", reason + "；sub model: 打断", sc2
    return action, reason, sc


def _decide_sub(req, bot):
    content = (req.get("content") or "").strip()
    key = (bot, req.get("session_key") or "")
    if req.get("mentioned"):
        current_task[key] = content[-500:]
        return "reply", "sub: 被@", None
    to, content = split_reply(content)
    if re.search(r"<@!?&?\d+>", content):  # @ 了别人：不是对她说
        return "context", "sub: @了别人", None
    called = called_names(content)
    if bot in called:
        current_task[key] = content[-500:]
        return "reply", "sub: 被点名", None
    if called:  # 开头叫的是别人
        return "context", "sub: 叫的是别人", None
    if to == bot:  # 回复她的消息 = 在跟她说
        current_task[key] = content[-500:]
        return "reply", "sub: 回复她", None
    if to is not None:
        return "context", "sub: 回复别人的消息", None
    if mentions_name(content, bot):
        sc = named_task.score(NAMED_SUFFIX.format(name=lead.NAME[bot], msg=content[:1500]))
        if sc.probs[1] >= NAMED_THRESHOLD:
            current_task[key] = content[-500:]
            return "reply", "sub model: 提到且在叫她", sc
        if not req.get("busy"):
            return "context", "sub model: 只是提到", sc
    if not req.get("busy") or not current_task.get(key):
        return "context", "sub: 空闲，记作增量", None
    sc = sub_task.score(SUB_SUFFIX.format(name=lead.NAME[bot], task=current_task[key], msg=content[:1500]))
    return ("context", "insert", "abort")[sc.choice], "sub model", sc


# ---------- 没 @ 的消息该归谁（用户 2026-10-22「核心要区分一下，让jev判断，是给谁回的」）----------
# 用户发的、没 @、没回复谁、开头没点名的消息：读频道最近几条消息、本频道谁刚干完活，让 jev 判是说给谁的。
# 判给谁，谁就按主角色那套规则（_decide_lead）定回/插入/不回，其他成员只收作上下文。每个 bot 各自来问同一条：
# 第一个请求算，其余等它的结果（_addr_cache），所以只会有一位回。jev 判不出（超时、看不出、出错、收件人不在线）时，
# 接着用户正在说话的那位（_talking）；也没有才照旧交给主角色。
# 用户 2026-10-23「没艾特他，怎么他在说话」：用户刚回复橘，下一句没 @、jev 超时，归了主角色鲸鱼娘，她攒满条数抢答（本机 gate.jsonl 09:26:52）。
#
# 读的都是 cc-connect 现有的配置（<SETUP_DIR>/config.toml，没有就不读）：
# - 各 bot 的 discord token：拉频道历史（任一位的都行，主角色优先）；
# - discord allow_from：谁是用户本人（"*" 或读不到 = 频道里的人都算用户）；
# - team_status_dir：各 bot 每 2 秒写的忙闲状态（core/team.go），用来看谁刚干完活、谁在线。没配就不知道谁在线，按都在线算。
# bot 的 Discord ID 用团队文件里成员的 "id"（lead.py）；没写 id 的按 Discord 用户名/昵称对团队文件的名字和别名认。
try:
    import tomllib
except ImportError:  # Python 3.10 及以下：没有 tomllib，读不了 config.toml，按没配处理
    tomllib = None

CC_CONFIG = SETUP_DIR / "config.toml"


def _cc_projects():
    """config.toml 里属于本团队的 project：[(成员 key, project 表)]，主角色排前面。读不到 → []。"""
    if tomllib is None:
        return []
    try:
        cfg = tomllib.loads(CC_CONFIG.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return []
    out = []
    for p in cfg.get("projects") or []:
        k = _project_member(p.get("name") or "")
        if k is not None:
            out.append((k, p))
    return sorted(out, key=lambda kp: kp[0] != "")


def _project_member(project):
    """cc-connect 的 project 名 → 成员 key：subs 的 key 就是 project 名（gate_url 的 ?bot=）；
    主角色的 project 名在团队文件 lead 的 aliases 里（安装向导写 gate-team.json 时放进去的，core/setup_wizard.go）。"""
    if project in SUBS:
        return project
    return "" if project in LEAD_NAMES else None


def _discord_opts():
    return [pl.get("options") or {} for _, p in _cc_projects() for pl in p.get("platforms") or [] if pl.get("type") == "discord"]


def _team_dir():
    for _, p in _cc_projects():
        if p.get("team_status_dir"):
            return Path(p["team_status_dir"]).expanduser()
    return None


def _user_ids():
    """discord allow_from 里的用户 ID；有 "*" 或一个都没读到 → None（频道里的人都算用户）。"""
    ids = set()
    for o in _discord_opts():
        for i in str(o.get("allow_from") or "").split(","):
            if i.strip() == "*":
                return None
            if i.strip():
                ids.add(i.strip())
    return ids or None


TEAM_DIR = _team_dir()
USER_IDS = _user_ids()
BOT_BY_ID = {i: k for k, i in lead.ID.items()}

ADDR_PROMPT = """群里有用户和 {n} 个 AI 成员：{names}。用户刚发了一条消息，没有 @ 谁，没有回复谁的消息，开头也没叫名字。
根据最近的聊天、本频道谁刚干完活，判断这条消息是说给谁的：
{options}
{unsure} 看不出：和最近的聊天接不上，或者是对大家说的
用户常接着刚跟他说话的那位往下说：同意、追问、补要求、让她去做、评价她刚发的东西。
只答一个字母。

"""
ADDR_SUFFIX = "最近的聊天（旧→新）：\n{history}\n本频道队友：\n{team}\n{last}用户刚发：「{msg}」\n\n判断（{choices} / {unsure} 看不出）："
# {last}「最后一位说话的 AI」：不写时模型偏向主角色，8 个情景对 6 个；写上 8 个全对（本机 gate 2026-10-22 实测）
ADDR_LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXY"[:len(lead.KEYS)]  # 顺序 = lead.KEYS（主角色在前）；下一个字母 = 看不出
ADDR_UNSURE = chr(ord("A") + len(lead.KEYS))
addr_task = scorer.prepare(
    ADDR_PROMPT.format(n=len(lead.KEYS), names="、".join(lead.NAME[k] for k in lead.KEYS), unsure=ADDR_UNSURE,
                       options="\n".join(f"{ADDR_LETTERS[i]} {lead.NAME[k]}" for i, k in enumerate(lead.KEYS))),
    options=list(ADDR_LETTERS) + [ADDR_UNSURE], prefill="答案：")
ADDR_HISTORY = 6      # 来源：用户原话「最近几条」；条数沿用 judge 的 buffered[-6:]（本机 gate 同值）
ADDR_MSG_CHARS = 100  # 来源：沿用本机 gate 同值。每条只截开头：6 条聊天 + 队友 + 本条要塞进本机打分器 2048 token 上限（scorer.py）
# cc-connect 只等 gate gate_timeout_ms（默认 3000ms），超时各 bot 按 gate_fallback 兜底：拉历史总共最多给一半，剩下的给打分
DISCORD_DEADLINE = 1.5  # 来源：沿用本机 gate 同值（gate_timeout_ms 3000 的一半）
# 同一条的各个请求都在这之内到：空闲的 bot 先攒 1.5s（core/gate.go burstWindow）+ gate 3s 超时 = 4.5s，翻倍取整
ADDR_REUSE_SECS = 10  # 来源：沿用本机 gate 同值（burstWindow 1.5s + gate 超时 3s，翻倍取整）
TEAM_STALE_SECS = 60  # 来源：同 core/team.go teamStaleAfter：文件一分钟没重写 = 那个进程没了
# 各请求共用的绝对截止，从第一个请求到达算起；留 0.8s 给超时后收件人那次打分和 HTTP 往返，到点算判不出
ADDR_DEADLINE = 2.2  # 来源：沿用本机 gate 同值（gate_timeout_ms 默认 3000 减 0.8s）
# 「刚说过话」的窗口：主角色上一条回复在这之内算刚说过话，对话延续用同一口径
LAST_FRESH_SECS = 1800  # 来源：用户 2026-10-23 10:4x 对『多久内算正在对话，不说就按 30 分钟合』回「可以」

_addr_cache = {}  # (频道, 本条原文) → [建立时刻, Event, 结果, 正在对话的成员]（结果在 set() 之后不再改）
# 用户在本频道正跟谁说话：最近一条用户消息落到谁头上（被 @、回复她、点名、或她接了没 @ 的话）
_talk = {}  # 频道 → (成员 key, 时刻)
_addr_lock = threading.Lock()
_dc = {"conn": None, "token": None}
_dc_lock = threading.Lock()


def _chat(key):
    """session key → "平台:频道"，同 core/team.go chatOf。"""
    return ":".join((key or "").split(":", 2)[:2])


def _ts(s):
    """ISO 时间 → epoch 秒。Go 写的秒小数位数不定（team/*.json），老版本 Python 的 fromisoformat 只认 3/6 位。"""
    m = re.match(r"(.*?\d\d:\d\d:\d\d)(?:\.(\d+))?(Z|[+-]\d\d:\d\d)?$", s or "")
    if not m:
        return None
    frac = ((m.group(2) or "") + "000000")[:6]
    tz = m.group(3) or "+00:00"
    return datetime.fromisoformat(f"{m.group(1)}.{frac}{'+00:00' if tz == 'Z' else tz}").timestamp()


def _ago(secs):
    return "刚才" if secs < 60 else f"{secs // 60} 分钟前" if secs < 3600 else f"{secs // 3600} 小时前"


def _discord_token():
    """本团队一位 bot 的 discord token（config.toml，主角色优先；"${VAR}" 从环境变量取）。不写日志、不外传。"""
    if not _dc["token"]:  # 没读到不缓存，下次再读
        for o in _discord_opts():
            tok = os.path.expandvars(str(o.get("token") or "")).strip()
            if tok and "${" not in tok:
                _dc["token"] = tok
                break
    return _dc["token"] or ""


def _discord_get(path):
    """GET discord.com/api/v10<path>，总共最多等 DISCORD_DEADLINE 秒；超时或失败返回 None。"""
    box = {}
    t = threading.Thread(target=lambda: box.setdefault("v", _discord_get_sync(path)), daemon=True)
    t.start()
    t.join(DISCORD_DEADLINE)
    return box.get("v")


def _discord_get_sync(path):
    """复用一条 HTTPS 连接（每次新建连接实测 0.7–2.5s，复用 0.4s，本机 gate 2026-10-22）。"""
    tok = _discord_token()
    if not tok or not _dc_lock.acquire(timeout=DISCORD_DEADLINE):
        return None
    try:
        for attempt in (0, 1):  # 复用的连接可能已被对面关掉：换新连接再试一次
            fresh = _dc["conn"] is None
            if fresh:
                _dc["conn"] = http.client.HTTPSConnection("discord.com", timeout=DISCORD_DEADLINE)
            try:
                _dc["conn"].request("GET", "/api/v10" + path, headers={"Authorization": "Bot " + tok, "User-Agent": "DiscordBot (bothouse-gate, 1)"})
                r = _dc["conn"].getresponse()
                body = r.read()
                return json.loads(body) if r.status == 200 else None
            except Exception:
                _dc["conn"].close()
                _dc["conn"] = None
                if fresh:
                    return None
    finally:
        _dc_lock.release()
    return None


def _bot_key(user):
    """Discord 用户对象 → 成员 key：先按团队文件的 id，没写 id 的按用户名/昵称对名字和别名；认不出 → None。"""
    k = BOT_BY_ID.get(str(user.get("id") or ""))
    if k is not None:
        return k
    for n in (user.get("global_name"), user.get("username")):
        if n and _member(n) is not None:
            return _member(n)
    return None


def recent_messages(chat, limit):
    """频道最近的消息，新的在前：[(几秒前, 作者, [回复/@ 到的成员 key], 原文)]；作者是成员 key，人是 None（用户）或名字。
    拉不到（不是 Discord、没 token、网络失败）返回 []。"""
    plat, _, cid = chat.partition(":")
    if plat != "discord" or not cid.isdigit():
        return []
    data = _discord_get(f"/channels/{cid}/messages?limit={limit}")
    if not isinstance(data, list):
        return []
    now, out = time.time(), []
    for m in data:
        text = (m.get("content") or "").strip()
        if m.get("webhook_id") or not text:  # 板子 webhook、只有卡片/附件的不算聊天
            continue
        a = m.get("author") or {}
        if a.get("bot"):
            who = _bot_key(a)
            if who is None:
                continue
        else:
            who = None if USER_IDS is None or a.get("id") in USER_IDS else (a.get("global_name") or a.get("username") or "某人")
        to = []
        ref = (m.get("referenced_message") or {}).get("author")
        for u in ([ref] if ref else []) + list(m.get("mentions") or []):
            k = _bot_key(u)
            if k is not None and k not in to:
                to.append(k)
        t = _ts(m.get("timestamp"))
        out.append((int(now - t) if t else 0, who, to, text))
    return out


def _team_files():
    """team_status_dir 里本团队每位的状态文件 → {成员 key: 内容}；一分钟没重写的（进程没了）不算。"""
    if TEAM_DIR is None:
        return {}
    now, out = time.time(), {}
    for p in sorted(TEAM_DIR.glob("*.json")):
        try:
            f = json.loads(p.read_text())
        except (OSError, ValueError):
            continue
        k = _project_member(f.get("project") or "")
        if k is None or now - (_ts(f.get("updated")) or 0) > TEAM_STALE_SECS:
            continue
        out[k] = f
    return out


def team_recent(chat):
    """本频道每位队友的状态：在忙 / 刚做完、接的是哪句。"""
    now, out = time.time(), []
    for k, f in _team_files().items():
        for s in f.get("sessions") or []:
            if _chat(s.get("key")) != chat:
                continue
            task = re.sub(r"\s+", " ", s.get("task") or "")[:60]
            if s.get("busy"):
                out.append(f"- {lead.NAME[k]} 正在本频道干活（{_ago(int(now - (_ts(s.get('since')) or now)))}开始），接的是「{task}」")
            else:
                out.append(f"- {lead.NAME[k]} {_ago(int(now - (_ts(s.get('done_at')) or now)))}在本频道做完一轮，接的是「{task}」")
    return out


def team_online(bot, chat):
    """收件人在线且在本频道：她的状态文件一分钟内重写过，且 sessions 里有本频道。没配 team_status_dir 时不知道，按在线算。"""
    if TEAM_DIR is None:
        return True
    f = _team_files().get(bot)
    return bool(f) and any(_chat(s.get("key")) == chat for s in f.get("sessions") or [])


def _key_part(req):
    """缓存键对应的那一条：合并请求取最后一条有文字的（都没文字取最后一条），否则就是本条。忙闲的 bot 都合并连发
    （core/gate.go），各 bot 按同一条判，结论才一致。「@某人 看这个」+图拆成两条时图在后、文字为空，取它就丢了 @。"""
    parts = req.get("parts") or []
    if parts:
        p = next((p for p in reversed(parts) if (p.get("content") or "").strip()), parts[-1])
        return {"content": p.get("content") or "", "mentioned": p.get("mentioned"), "from_bot": p.get("from_bot")}
    return {"content": req.get("content") or "", "mentioned": req.get("mentioned"), "from_bot": req.get("from_bot")}


def _addr_applies(req, bot):
    """只管用户发的、没 @、没回复、开头没点名、不是命令的消息。只看缓存键那一条（_key_part），各 bot 看到的结论一样：
    @ 了谁，被 @ 的那位 mentioned=true，其余几位的原文里有 <@id>；回复和点名每位看到的原文相同。
    只发图/文件、一个字没写的也归这里（以前空文本直接绕过，主角色按「只有附件」插话抢答）。"""
    p = _key_part(req)
    content = p["content"].strip()
    own = split_reply(content)[1]
    attach_only = not own and bool(req.get("has_images") or req.get("has_files"))
    return not (p["mentioned"] or p["from_bot"] or content.startswith("[replying to ") or re.search(r"<@!?&?\d+>", own)
                or called_names(own) or own.startswith("/") or (not own and not attach_only))


ATTACH_ONLY_MSG = "（只发了图片/文件，没有文字）"  # 只发附件时喂给 jev 的「用户刚发」，jev 靠上文判是给谁的


def _called_in_burst(req, bot):
    """合并的连发里前面某条明确叫了这个 bot（@、开头点名、回复她）：那条照她自己的规则走，不因最后一条判给别人就丢掉。"""
    parts = (req.get("parts") or [])[:-1]
    return any(user_addressed({"content": p.get("content") or "", "mentioned": p.get("mentioned")}, bot) for p in parts)


def _judge_addressee(chat, msg, msgs=None, talking=None, now=None):
    """talking：正在对话的成员（_talking 的结果）。拉不到历史时把它作为「最后一位说话的 AI」喂给 jev，仍由 jev 判。"""
    if msgs is None:
        msgs = recent_messages(chat, ADDR_HISTORY + 4)  # 多拉几条：最新的几条可能就是本条（用户连发）
    norm = lambda t: re.sub(r"\s+", " ", t).strip()
    for i, m in enumerate(msgs[:4]):  # 去掉本条自己：只删一条、原文完全相同的（子串匹配会误删历史里更短的旧消息）
        if m[1] is None and norm(m[3]) == norm(msg):
            msgs.pop(i)
            break
    hist = []
    for ago, who, to, text in reversed(msgs[:ADDR_HISTORY]):
        name = "用户" if who is None else lead.NAME.get(who, who)
        tail = f"（对{'、'.join(lead.NAME[t] for t in to)}说）" if to else ""
        text = re.sub(r"\s+", " ", text)[:ADDR_MSG_CHARS]
        hist.append(f"- {_ago(ago)} {name}{tail}：{text}")
    last = next((f"最后一位说话的 AI：{lead.NAME[w]}（{_ago(a)}）\n" for a, w, _, _ in msgs[:ADDR_HISTORY] if w in lead.NAME), "")
    if not last and talking is not None:  # 拉不到历史（Discord 超时 / 没 token）：用本进程记下的对话对象
        at = _talk.get(chat, (None, 0))[1] if _talk.get(chat, (None,))[0] == talking else 0
        last = f"最后一位说话的 AI：{lead.NAME[talking]}" + (f"（{_ago((now or time.time()) - at)}）" if at else "") + "\n"
    team = team_recent(chat)
    if not hist and not team and not last:
        return None, "没有上下文", None
    sc = addr_task.score(ADDR_SUFFIX.format(history="\n".join(hist) or "（拉不到）", team="\n".join(team) or "（没人在本频道干活）",
                                            last=last, msg=msg[:500], unsure=ADDR_UNSURE,
                                            choices=" / ".join(f"{ADDR_LETTERS[i]} {lead.NAME[k]}" for i, k in enumerate(lead.KEYS))))
    if sc.choice >= len(lead.KEYS):
        return None, "jev 看不出", sc
    k = lead.KEYS[sc.choice]
    if not team_online(k, chat):  # 判给的成员下线或不在本频道：她收不到，交主角色
        return None, f"jev 判给{lead.NAME[k]}，收件人不在线", sc
    return k, "jev", sc


def _settle(ent, result, fallback=False):
    """结果只落一次：先到的（算完 / 到截止）为准，之后的丢弃。
    fallback=True 表示 jev 没给出结论（超时、出错、没有任何上下文可喂）：这时才接着用户正在说话的那位。
    jev 明确答了（含「看不出 / 对大家说的」）以 jev 为准（用户原话「让jev判断，是给谁回的」）。"""
    with _addr_lock:
        if not ent[1].is_set():
            k, why, sc = result
            if fallback and k is None and ent[3] is not None:  # 在锁里定一次，各 bot 看到同一个
                result = (ent[3], f"{why}，接着和{lead.NAME[ent[3]]}的对话", sc)
            ent[2] = result
            ent[1].set()


def addressee(req, bot):
    """→ (收件人成员 key 或 None, 说明, score)。None = 不归这一步管或判不出，照旧走主角色/sub 的规则。"""
    if addr_task is None or not _addr_applies(req, bot):  # addr_task 为 None：测试里关掉这一步
        return None, "", None
    last = split_reply(_key_part(req)["content"].strip())[1] or ATTACH_ONLY_MSG
    key = (_chat(req.get("session_key")), last)
    with _addr_lock:
        now = time.time()
        for k in [k for k, v in _addr_cache.items() if now - v[0] > ADDR_REUSE_SECS]:
            del _addr_cache[k]
        ent = _addr_cache.get(key)
        mine = ent is None
        if mine:  # 正在对话的成员在第一个请求到时定下，各 bot 共用，结论一致
            ent = _addr_cache[key] = [now, threading.Event(), (None, "jev 没算完", None), _talking(key[0], now)]

    def work():
        try:
            msgs = recent_messages(key[0], ADDR_HISTORY + 4)
            with _addr_lock:  # 拉到历史就把「最后发言的 bot」并进对话对象，jev 打分超时也用得上
                ent[3] = _talking(key[0], ent[0], msgs)
            r = _judge_addressee(key[0], last, msgs, ent[3], ent[0])  # 只喂键那一条：合并和逐条请求的输入相同；连发前几条在频道历史里
        except Exception as e:  # 拉历史/打分出错（含 jev 超时、输入超长的 ValueError）：判不出
            r = (None, f"jev 出错 {e!r}"[:200], None)
        _settle(ent, r, fallback=r[2] is None)  # 没有 score = jev 没答（出错 / 没上下文）

    if mine:
        threading.Thread(target=work, daemon=True).start()
    if not ent[1].wait(max(0.0, ent[0] + ADDR_DEADLINE - time.time())):
        _settle(ent, (None, "jev 超时", None), fallback=True)
    return ent[2]


def _talking(chat, now, msgs=()):
    """用户在这个频道正跟谁说话，取两个来源里较新的那个：_talk（她接了用户的话）和频道历史里最后发言的 bot
    （她真正发出消息的时刻，含主动来报结果；@ 别的 bot 的那条不算）。要在 LAST_FRESH_SECS 之内、且在线在本频道，没有返回 None。"""
    k, at = _talk.get(chat, (None, 0))
    age = now - at if k is not None else None
    said = next(((a, w) for a, w, to, _ in msgs if w in lead.NAME and not to), None)  # msgs 新的在前（recent_messages）
    if said is not None and (age is None or said[0] < age):
        age, k = said
    if k is None or age > LAST_FRESH_SECS or not team_online(k, chat):
        return None
    return k


def route(req, bot=""):
    action, reason, sc = _route(req, bot)
    p = _key_part(req)
    # 只记「用户在跟她说」的：@ / 回复 / 点名她，或 jev 判给她。主角色按「攒满 / 提问 / 模型」接的话不算（bot 之间的 @ 也不算）
    if action in ("reply", "abort", "insert") and not p["from_bot"] and (user_addressed(p, bot) or ": 判给我；" in reason):
        _talk[_chat(req.get("session_key"))] = (bot, time.time())
    return action, reason, sc


def _route(req, bot=""):
    """用户切换主角色的那句先处理（lead.py）；再判没 @ 的消息归谁（addressee）；其余按当前主角色分流：主角色走主的规则，其他成员走 sub 的规则。"""
    to, own = split_reply((req.get("content") or "").strip())
    target = lead.parse(req, own, bot, to)
    if target is not None:
        lead.set_lead(target)
        if bot == target:
            return "reply", f"rule: 用户把主角色切到{lead.NAME[target]}", None
        return "context", f"rule: 用户把主角色切到{lead.NAME[target]}，不是我", None
    addr, why, asc = addressee(req, bot)
    if addr is not None and bot != addr and _called_in_burst(req, bot):  # 连发前面有条叫的是她：按她自己的规则
        addr, why = None, f"{why}: 判给{lead.NAME[addr]}，但连发里叫了我"
    if addr is not None:
        if bot != addr:
            return "context", f"{why}: 判给{lead.NAME[addr]}", asc
        current_task[(bot, req.get("session_key") or "")] = own[-500:]
        if req.get("busy") and STOP_WORDS.fullmatch(own):  # 判给她且她正忙、整句是停止词：直接打断，不调模型（下面 model=False 会回 reply，打断不了）
            return "abort", f"{why}: 判给我；rule: 停止词", asc
        # 收件人只跑主角色那套的规则部分，不再串一次 judge：jev 已判给她，再打分要多等一次模型，
        # 加上拉历史和 jev 会超过 cc-connect 的 gate_timeout_ms（默认 3000ms），兜底成 context 就没人回了
        action, reason, sc = _decide_lead(req, bot, model=False)
        return action, f"{why}: 判给我；{reason}", sc or asc
    action, reason, sc = decide(req, bot) if bot == lead.current() else decide_sub(req, bot)
    return action, (f"{why}；{reason}" if why else reason), sc or asc


def _other_mention(me):
    """原文里 @ 了除 me 以外的成员，只按团队文件里写的 id 认；认不出的 <@id> 一律当没 @ 队友。
    一个 id 都没写时返回 None，不做同时 @ 判定（否则用户「@主bot @朋友」会被判 context，没人回）。"""
    ids = [i for k, i in lead.ID.items() if k != me]
    return re.compile(r"<@!?(?:" + "|".join(map(re.escape, ids)) + r")>") if ids else None


def co_mention(req, me=""):
    """用户同一条消息同时 @ 了 me 和别的成员。按单条原始消息判：空闲时连发的几条会被 core 合并，
    parts 是合并前的每一条（各自的原文、有没有 @me、是不是 bot 发的；单条消息不带 parts）。
    @ 了 me 的每一条都同时 @ 了别的成员、都是人发的、都不是回复 me 的消息，才算；
    有一条只 @ me、是 bot @ me（队友交回/报错），或回复的是 me 的消息，就是在叫 me 本人。"""
    other = _other_mention(me)
    if other is None:
        return False
    parts = req.get("parts") or [{"content": req.get("content") or "", "mentioned": req.get("mentioned"),
                                  "from_bot": req.get("from_bot")}]
    called = [p for p in parts if p.get("mentioned")]

    def ok(p):
        to, own = split_reply((p.get("content") or "").strip())
        return not p.get("from_bot") and to != me and bool(other.search(own))

    return bool(called) and all(ok(p) for p in called)


def decide(req, me=""):
    action, reason, sc = _decide_lead(req, me)
    if action == "reply" and req.get("busy"):  # @主角色/叫她名字且她正忙：是不是叫停，同 decide_sub（用户原话「艾特她的时候，不要只有insert插入，而是还有abort插入」）
        content = split_reply((req.get("content") or "").strip())[1]
        if req.get("mentioned") or any(n in content for n in NAMES[me]):
            sc2 = judge(content, True, req.get("buffered") or [], me)
            if ACTIONS[sc2.choice] == "abort":
                return "abort", reason + "；model: 打断", sc2
    return action, reason, sc


def _decide_lead(req, me="", model=True):
    content = (req.get("content") or "").strip()
    buffered = req.get("buffered") or []
    busy = bool(req.get("busy"))
    if req.get("mentioned"):
        # 同一条消息同时 @ 了主角色和队友：队友干活，做完的回复会 @ 主角色（core lead_return 交回），主角色那时再核对；
        # 这一轮不回，免得拿旧消息当她的答案。回 context 不回 silent：带图时 silent 会被 core 改成 insert
        # （core/gate.go 附件不能按文字缓冲），context 把图记成文字（core/gate_comention_test.go）。
        if co_mention(req, me):
            return "context", "rule: 同时 @ 了队友，等她回复 @主角色", None
        return "reply", f"rule: @{lead.NAME[me]}", None
    to, own = split_reply(content)  # 下面的规则只看用户自己写的部分，引用里的名字、@、问号不算
    # 回复的是别的成员的消息、开头也没叫我：回复谁就是在跟谁说。回 context 不回 silent：带图时 silent 会被 cc-connect
    # 改成 insert（core/gate.go 附件不能按文字缓冲），主角色就插话抢答了（本机 gate 2026-10-23「我都艾特你了，他还在判断」）
    if to not in (None, me) and me not in called_names(own):
        return "context", "rule: 回复 sub", None
    if re.search(r"<@!?&?\d+>", own):  # @ 了别的 bot/人（自己的 @ 已被 cc-connect 去掉）→ 不是叫橘
        return "silent", "rule: @了别人", None
    called = called_names(own)
    if called and me not in called:  # 开头叫的是别人，让她自己接
        return "silent", "rule: 点名 sub", None
    if own.startswith("/"):
        return "reply", "rule: command", None
    if ACK.match(own):
        return "silent", "rule: 应答", None
    if CALL.search(own) or any(n in own for n in NAMES[me]):
        return "reply", "rule: 叫我/提问", None
    links = len(URL.findall(content)) + sum(len(URL.findall(b)) for b in buffered)
    if links >= LINKS_FOR_REPLY:
        return "reply", f"rule: {links} 个链接", None
    if links and not URL.sub("", content).strip():
        return "silent", f"rule: 只有链接，等凑够 {LINKS_FOR_REPLY} 个", None
    if len(buffered) + 1 >= BUFFER_FOR_REPLY:
        return "reply", f"rule: 攒了 {len(buffered) + 1} 条", None
    if not content:
        return "insert", "rule: 只有附件", None
    if not model:  # 已判给我（addressee）：规则没拦下就回，同上面「叫我/提问」那几条规则（忙时也是 reply，由 cc-connect 投递）
        return "reply", "rule: jev 判给我", None
    try:
        sc = judge(content, busy, buffered, me)
    except ValueError as e:  # 输入超过 scorer 上限：和 cc-connect 出错时一样按 reply
        return "reply", f"error: {e}", None
    action = ACTIONS[sc.choice]
    if action == "abort" and not busy:  # 不忙没有可打断的，按回复
        return "reply", "model: 打断但空闲，按回复", sc
    return action, "model", sc


# ---------- 分级：这条是聊天还是干活（给 cc-connect 自动选模型用）----------
# 只在 action 为 reply / insert 时给；规则先判，判不了交给 4B 二选一。
TIER_LONG = 120  # 超过这么多字的消息一般是需求描述，按任务算
TASK_WORDS = re.compile(
    r"写|改一?下|修改|修复|修一?下|查一?下|查查|搜一?下|生成|分析|整理|总结|翻译|重构|实现|部署|运行|跑一?下|测试|调试"
    r"|review|debug|bug|代码|脚本|文件|文档|函数|接口|报错|\bPR\b|commit|提交|合并|配置|安装"
    r"|做一个|做个|帮我做|弄一下|写个|画一?个|设计|方案|计划|列一?个|清单|表格|对比", re.IGNORECASE)
CHAT_WORDS = re.compile(
    r"^(你好|您好|早|晚安|早安|晚上好|早上好|中午好|下午好|在吗|在不在|嗨|哈喽|hello|hi)"
    r"|你是谁|你叫什么|什么模型|哪个模型|天气|心情|累了|好累|难过|开心|无聊|想你|哈哈|笑死|晚饭|午饭|吃了吗", re.IGNORECASE)
TIER_CHAT_SHORT = 12  # 这么短又没有干活的词，按聊天算

TIER_PROMPT = """判断群里这条发给 AI 成员的消息，是想跟它聊天，还是要它干活。
A 聊天：打招呼、闲聊、情绪表达、简单问答（问它是谁、在不在、天气、随口一问）
B 任务：要它写、改、查、修、生成、分析、整理、review 文件、代码或文档，或者给出明确的工作指令
只答一个字母。

"""
TIER_SUFFIX = "消息：「{msg}」\n\n判断（A 聊天 / B 任务）："
tier_task = scorer.prepare(TIER_PROMPT, options=["A", "B"], prefill="答案：")


def tier_of(req, model=True):
    """返回 (tier, 依据, score)。tier 是 "chat" 或 "task"；model=False 时规则判不了返回 None（不带 tier，cc-connect 用默认模型）。"""
    content = (req.get("content") or "").strip()
    if req.get("has_files") or req.get("has_images"):
        return "task", "tier rule: 带附件", None
    if len(content) > TIER_LONG:
        return "task", f"tier rule: 长消息 {len(content)} 字", None
    m = TASK_WORDS.search(content)
    if m:
        return "task", f"tier rule: 干活词「{m.group(0)}」", None
    if ACK.match(content) or CHAT_WORDS.search(content):
        return "chat", "tier rule: 闲聊/问候", None
    if len(content) <= TIER_CHAT_SHORT:
        return "chat", "tier rule: 短句无干活词", None
    if not model:  # jev 判给的收件人：时间已花在拉历史和 jev 上，不再串一次模型（同 _route 收件人那段）
        return None, "tier skip: 已判给我，不再打分", None
    sc = tier_task.score(TIER_SUFFIX.format(msg=content[:1500]))
    return ("chat", "task")[sc.choice], "tier model", sc


class H(BaseHTTPRequestHandler):
    def _json(self, obj, code=200):
        body = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(code); self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body))); self.end_headers(); self.wfile.write(body)

    def do_POST(self):
        url = urllib.parse.urlsplit(self.path)
        bot = urllib.parse.parse_qs(url.query).get("bot", [""])[0]
        if url.path == "/lead":  # 主角色自己来问 / 自己来当（用户 2026-10-21：「每个角色都可以去选择当主，他自己有个功能接口过去搞」）
            req = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or b"{}")
            action = (req.get("action") or "get").strip()
            if action == "get":
                s = lead.state()
                return self._json({"ok": True, "lead": s["lead"], "name": lead.NAME[s["lead"]], "at": s["at"]})
            if action == "set":
                target = lead.resolve(req.get("who") if req.get("who") is not None else bot)
                if target is None:
                    return self._json({"ok": False, "error": f"认不出是谁：{req.get('who')!r}"}, 400)
                changed = lead.set_lead(target)
                s = lead.state()
                return self._json({"ok": True, "changed": changed, "lead": s["lead"], "name": lead.NAME[s["lead"]], "at": s["at"]})
            return self._json({"ok": False, "error": f"action 只认 get / set：{action!r}"}, 400)
        if url.path == "/context":  # 每轮相关的 wiki 页（ctxsvc.py）
            req = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or b"{}")
            req.setdefault("bot", bot)  # sub 的 gate_url 带 ?bot=
            body = json.dumps(ctxsvc.context(req), ensure_ascii=False).encode()
            self.send_response(200); self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body))); self.end_headers(); self.wfile.write(body)
            return
        if url.path != "/decide" or (bot and bot not in SUBS):
            self.send_error(404); return
        if not SUBS:  # 单角色（向导写的 gate-team.json 没有 subs）：没有队友可让，不打分；忙时叫停/改做照 core/gate_local.go applyLocalGate
            req = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or b"{}")
            own = split_reply((req.get("content") or "").strip())[1]
            if req.get("busy") and req.get("mentioned") and not req.get("from_bot") and (STOP_WORDS.fullmatch(own) or REDIRECT.match(own)):
                return self._json({"action": "abort", "reason": "no teammate; rule: 停止词/改做"})
            return self._json({"action": "reply", "reason": "no teammate: reply"})
        if SCORER_KIND == "none":  # 没 jev：不判谁回，cc-connect 按 gate_fallback 兜底（core/gate.go fallbackFor）
            return self._json({"error": "no jev: /decide is off, use gate_fallback"}, 503)
        req = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or b"{}")
        t = time.time()
        try:
            action, reason, sc = route(req, bot)
        except ValueError as e:  # 输入超过 scorer 上限
            action, reason, sc = ("reply" if bot == lead.current() else "context"), f"error: {e}", None
        tier = tier_reason = tier_probs = None
        if action in ("reply", "insert", "abort"):  # abort 在 cc-connect 里按 reply 投递
            try:
                tier, tier_reason, tsc = tier_of(req, model=": 判给我；" not in reason)
                tier_probs = tsc.probs if tsc else None
            except ValueError as e:  # 输入超过 scorer 上限
                tier, tier_reason = "task", f"tier error: {e}"
        probs = sc.probs if sc else None
        ms = round((time.time() - t) * 1000)
        with LOG.open("a") as f:
            f.write(json.dumps({"t": time.strftime("%F %T"), "bot": bot or LEAD, "lead": lead.NAME[lead.current()], "busy": req.get("busy"), "mentioned": req.get("mentioned"),
                                "content": (req.get("content") or "")[:300], "buffered": len(req.get("buffered") or []),
                                "action": action, "reason": reason, "probs": probs, "ms": ms,
                                "tier": tier, "tier_reason": tier_reason, "tier_probs": tier_probs,
                                # option_mass 低 = 模型想答的不是 A/B/C（prompt 有问题）；logprobs 为全词表 log 概率
                                **({"option_mass": sc.option_mass, "logprobs": sc.logprobs,
                                    "cached_tokens": sc.cached_tokens} if sc else {})}, ensure_ascii=False) + "\n")
        out = {"action": action, "reason": f"{reason} {probs or ''} {ms}ms".strip()}
        if tier:
            out["tier"], out["tier_reason"] = tier, f"{tier_reason} {tier_probs or ''}".strip()
        body = json.dumps(out, ensure_ascii=False).encode()
        self.send_response(200); self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body))); self.end_headers(); self.wfile.write(body)

    def log_message(self, *a):
        pass


if __name__ == "__main__":
    if SCORER_KIND != "none":
        try:
            judge("你好", False, [])  # warm up (first forward compiles kernels / first remote call)
        except ValueError as e:
            print(f"warm-up: {e}", flush=True)
    print(f"gate on 127.0.0.1:{PORT}  team={LEAD}+{SUB_LIST}  scorer={SCORER_KIND}  wiki={ctxsvc.WIKI or 'off'}", flush=True)
    ThreadingHTTPServer(("127.0.0.1", PORT), H).serve_forever()
