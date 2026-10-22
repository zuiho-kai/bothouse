# /// script
# requires-python = ">=3.12"
# dependencies = ["mlx-lm; sys_platform == 'darwin' and platform_machine == 'arm64'"]  # mlx 只有 Apple 芯片；别的机器不装，gate 用 jev 或只按规则
# ///
"""主 bot 的快脑：cc-connect（maomao 分支）每条用户消息先问这里，回 reply / insert / silent。

先走确定性规则，规则定不了再让本地 Qwen3.5-4B 读 A/B/C 三个选项的概率（约 30ms，见 scorer.py）。
每次判断写进 GATE_LOG（默认 ~/.cc-connect/gate.jsonl），用来调规则或以后做微调。
POST /decide  {content, mentioned, busy, has_images, has_files, buffered[]} → {action, reason}
POST /context {key, text} → 每轮相关的 wiki 页（ctxsvc.py；wiki 目录 GATE_WIKI，默认 ~/wiki）

主 + sub：主 bot（/decide）按下面的规则和 4B 决定回/插入/不回，要别人开口就 @ 她们。
sub（/decide?bot=<key>）听群里每句话，但只在被 @ 时回；没 @ 时空闲就记作增量（context，
下次开口一起带上），忙时由 4B 判断这句和她手上的活有没有关系：有就插入，没有就记作增量。
"""
import json, os, re, time, urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import ctxsvc
from scorer_remote import NullScorer, RemoteScorer, load_jev

PORT = 9930
MODEL = os.environ.get("GATE_MODEL", "mlx-community/Qwen3.5-4B-MLX-4bit")
LOG = Path(os.environ.get("GATE_LOG", Path.home() / ".cc-connect/gate.jsonl"))

# 安装向导（cc-connect 网页 / cc-connect setup apply）把 jev.json、gate-team.json 写在 cc-connect 的数据目录。
SETUP_DIR = Path(os.environ.get("GATE_SETUP_DIR") or Path.home() / ".cc-connect").expanduser()
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


def _team_text(t):
    """把提示词里写死的「橘 / 龙娘、鲸鱼娘、彩虹猫」换成当前团队。"""
    return (t.replace("橘、龙娘、鲸鱼娘、彩虹猫", f"{LEAD}、{SUB_LIST}")
             .replace("龙娘、鲸鱼娘、彩虹猫", SUB_LIST).replace("橘", LEAD))

# 叫它、明确要它看/答
CALL = re.compile("|".join(map(re.escape, LEAD_NAMES)) + r"|你看看|你看下|看一下|帮我|你觉得|你怎么看|怎么看|怎么办|能不能|可以吗|为什么|是什么|吗[？?]?$|[？?]\s*$")
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
只答一个字母。

"""
PROMPT = _team_text(PROMPT)
SUFFIX = LEAD + "{state}。\n{history}用户刚发：「{msg}」\n\n判断（A 不回 / B 插入 / C 回复）："  # 末尾重提选项：不加的话偏向 A

ACTIONS = ["silent", "insert", "reply"]
def make_scorer():
    """jev.json（拿得到概率）→ 本机 mlx Qwen → 只按规则（NullScorer：模型那步按出错走，主 bot 回 = 兜底角色回）。"""
    jev = load_jev(os.environ.get("GATE_JEV") or SETUP_DIR / "jev.json")
    if jev:
        return RemoteScorer(jev), "jev"
    try:
        from scorer import Scorer
    except ImportError:  # 没装 mlx（非 Apple 芯片、Linux、Windows）
        return NullScorer(), "rules"
    return Scorer(MODEL), "local"


scorer, SCORER_KIND = make_scorer()
task = scorer.prepare(PROMPT, options=["A", "B", "C"], prefill="答案：")

# sub：忙时这句要不要打断她
SUB_PROMPT = """一个 AI 成员正在处理派给她的任务，这时群里有人发了新消息。判断这条消息怎么给她：
A 增量：普通群聊、和她手上的任务无关，先记着，等她下次开口时再一起看
B 插入：和她正在做的任务直接相关（更正、补充要求、改方向、叫停、叫她名字问进度），应该马上告诉她
群里还有橘、龙娘、鲸鱼娘、彩虹猫；叫的是别人的名字，就是在跟别人说话，不是对她。
只答一个字母。

"""
SUB_PROMPT = _team_text(SUB_PROMPT)
SUB_SUFFIX = "她是「{name}」，正在做的任务：「{task}」\n群里刚发：「{msg}」\n\n判断（A 增量 / B 插入）："
sub_task = scorer.prepare(SUB_PROMPT, options=["A", "B"], prefill="答案：")
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


def judge(content, busy, buffered):
    state = "正在干活（处理用户之前的请求）" if busy else "现在空闲"
    history = ""
    if buffered:
        history = "之前还没回的消息：\n" + "\n".join(f"- {b[:300]}" for b in buffered[-6:]) + "\n"
    return task.score(SUFFIX.format(state=state, history=history, msg=content[:1500]))


def decide_sub(req, bot):
    content = (req.get("content") or "").strip()
    key = (bot, req.get("session_key") or "")
    if req.get("mentioned"):
        current_task[key] = content[-500:]
        return "reply", "sub: 被@", None
    if re.search(r"<@!?&?\d+>", content):  # @ 了别人：不是对她说
        return "context", "sub: @了别人", None
    if bot in called_names(content):
        current_task[key] = content[-500:]
        return "reply", "sub: 被点名", None
    if mentions_name(content, bot):
        sc = named_task.score(NAMED_SUFFIX.format(name=SUBS[bot], msg=content[:1500]))
        if sc.probs[1] >= NAMED_THRESHOLD:
            current_task[key] = content[-500:]
            return "reply", "sub model: 提到且在叫她", sc
        if not req.get("busy"):
            return "context", "sub model: 只是提到", sc
    if not req.get("busy") or not current_task.get(key):
        return "context", "sub: 空闲，记作增量", None
    sc = sub_task.score(SUB_SUFFIX.format(name=SUBS[bot], task=current_task[key], msg=content[:1500]))
    return ("context", "insert")[sc.choice], "sub model", sc


def decide(req):
    content = (req.get("content") or "").strip()
    buffered = req.get("buffered") or []
    busy = bool(req.get("busy"))
    if req.get("mentioned"):
        return "reply", f"rule: @{LEAD}", None
    if re.search(r"<@!?&?\d+>", content):  # @ 了别的 bot/人（自己的 @ 已被 cc-connect 去掉）→ 不是叫橘
        return "silent", "rule: @了别人", None
    called = called_names(content)
    if called and "" not in called:  # 开头叫的是 sub，让她自己接
        return "silent", "rule: 点名 sub", None
    if content.startswith("/"):
        return "reply", "rule: command", None
    if ACK.match(content):
        return "silent", "rule: 应答", None
    if CALL.search(content):
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
    try:
        sc = judge(content, busy, buffered)
    except ValueError as e:  # 输入超过 scorer 上限：和 cc-connect 出错时一样按 reply
        return "reply", f"error: {e}", None
    return ACTIONS[sc.choice], "model", sc


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


def tier_of(req):
    """返回 (tier, 依据, score)。tier 是 "chat" 或 "task"。"""
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
    sc = tier_task.score(TIER_SUFFIX.format(msg=content[:1500]))
    return ("chat", "task")[sc.choice], "tier model", sc


class H(BaseHTTPRequestHandler):
    def do_POST(self):
        url = urllib.parse.urlsplit(self.path)
        bot = urllib.parse.parse_qs(url.query).get("bot", [""])[0]
        if url.path == "/context":  # 每轮相关的 wiki 页（ctxsvc.py）
            req = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or b"{}")
            body = json.dumps(ctxsvc.context(req), ensure_ascii=False).encode()
            self.send_response(200); self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body))); self.end_headers(); self.wfile.write(body)
            return
        if url.path != "/decide" or (bot and bot not in SUBS):
            self.send_error(404); return
        req = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or b"{}")
        t = time.time()
        try:
            action, reason, sc = decide_sub(req, bot) if bot else decide(req)
        except ValueError as e:  # 输入超过 scorer 上限
            action, reason, sc = ("context" if bot else "reply"), f"error: {e}", None
        tier = tier_reason = tier_probs = None
        if action in ("reply", "insert"):
            try:
                tier, tier_reason, tsc = tier_of(req)
                tier_probs = tsc.probs if tsc else None
            except ValueError as e:  # 输入超过 scorer 上限
                tier, tier_reason = "task", f"tier error: {e}"
        probs = sc.probs if sc else None
        ms = round((time.time() - t) * 1000)
        with LOG.open("a") as f:
            f.write(json.dumps({"t": time.strftime("%F %T"), "bot": bot or LEAD, "busy": req.get("busy"), "mentioned": req.get("mentioned"),
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
    try:
        judge("你好", False, [])  # warm up (first forward compiles kernels / first remote call)
    except ValueError as e:
        print(f"warm-up: {e}", flush=True)
    print(f"gate on 127.0.0.1:{PORT}  team={LEAD}+{SUB_LIST}  scorer={SCORER_KIND}  wiki={ctxsvc.WIKI or 'off'}", flush=True)
    ThreadingHTTPServer(("127.0.0.1", PORT), H).serve_forever()
