import json, pathlib
D = pathlib.Path(__file__).resolve().parent / "scenes"
A = "../assets/v4/"
Z = lambda zh, en: {"zh": zh, "en": en}
SRC = "来源：PM 派活的脚本 v4.1（镜号见文件名）与用户 2026-10-22 原话；颜色来源见 _colors；毫秒数是目测节奏，每镜时长对齐旁白（cut.py：旁白 + 1 秒）"
# 主题色：派活交接「Claude 橘 #f08a24；Codex 龙娘淡紫；DeepSeek 鲸鱼娘 #4d6bfe；Gemini 彩虹猫蓝紫到粉渐变；MiniMax 岚汐青到紫渐变」。
# 淡紫/渐变的具体色值是我定的：白字要压得住，所以取中等明度。
C = dict(ju="#f08a24", longniang="#9b7be0", jingyu="#4d6bfe",
         gemini="linear-gradient(90deg,#6c7bff,#b36bfa,#ff6fb5)", lanxi="linear-gradient(90deg,#1fb8d8,#7c5cff)")
SOLID = dict(ju="#f08a24", longniang="#9b7be0", jingyu="#4d6bfe", gemini="#9a6cf5", lanxi="#3a8fe0")  # 头像描边等只能用纯色的地方
NAME = dict(ju=Z("橘", "Ju"), longniang=Z("龙娘", "Long"), jingyu=Z("鲸鱼娘", "Whale"), gemini=Z("彩虹猫", "Nyan"), lanxi=Z("岚汐", "Lanxi"))
CLI = dict(ju="Claude Code", longniang="Codex", jingyu="DSH", gemini="Antigravity", lanxi="MiniMax")
# 名字条英文：用户原话「下面再加个那个符合他们主题的颜色的一个名字，deepseek，gemini」——用模型名
EN = dict(ju="Claude", longniang="GPT", jingyu="DeepSeek", gemini="Gemini", lanxi="MiniMax")
def w(name, d):
    d.setdefault("_source", SRC); (D / f"{name}.json").write_text(json.dumps(d, ensure_ascii=False, indent=2), "utf-8")

# v4b 提速：用户看初剪「中后半段太慢了……没有那种轻快感」，镜5–8 的 hold/each/beat/total 按交接建议压短（具体毫秒是我定的），
# 气泡至少停 1.2 秒（审稿要求「不能又快到看不懂」）；四格 ui 字段：用户「参考真实界面的样子，而不是四个一样的界面」
# 镜1 封面
w("v4-cover", {"template": "cover", "roles": [{"img": A + f"{k}.png"} for k in ["gemini", "jingyu", "ju", "longniang", "lanxi"]],
    "line": Z("欢迎来玩", "Come on in"), "total": 4000})

# 镜2–4 四格：左上 Claude Code·Claude，右上 Codex·GPT，左下 DSH·DeepSeek，右下 反重力 Antigravity·Gemini（派活交接）
# 黑底上的名字牌颜色：DeepSeek 原色 #4d6bfe 在黑底上太暗，提亮到 #7b93ff（我定的）
terms = [
  {"cli": "Claude Code", "model": "Claude", "ui": "claude", "color": "#f08a24", "logs": ["> reading repo…", "✗ context lost", "warn: token limit near", "> summarize history?", "✗ session expired", "> loading CLAUDE.md", "warn: which project?", "> retry 3/5"]},
  {"cli": "Codex", "model": "GPT", "ui": "codex", "color": "#b9a3ff", "logs": ["$ codex exec", "✗ no AGENTS.md", "warn: sandbox denied", "> patch failed", "? which branch", "> re-run tests", "✗ timeout 600s", "> applying diff"]},
  {"cli": "DSH", "model": "DeepSeek", "ui": "dsh", "color": "#7b93ff", "logs": ["dsh> new session", "warn: memory empty", "> who are you?", "✗ unknown project", "> fetching docs…", "? what was decided", "> thinking…", "✗ rate limited"]},
  {"cli": "反重力 Antigravity", "model": "Gemini", "ui": "agy", "color": "#8ab4ff", "logs": ["agy> start", "warn: no workspace", "> indexing 0/0", "✗ permission?", "> open browser", "? what context", "> planning…", "✗ lost track"]},
]
w("v4-chaos", {"template": "terms", "mode": "chaos", "terms": terms, "total": 5900})
w("v4-repeat", {"template": "terms", "mode": "repeat", "terms": terms, "typed": Z("我在做宣传片，背景是……", "So I'm making a promo, the background is…"),
    "reply": Z("请提供更多上下文", "Please provide more context"), "total": 4300})
w("v4-flip", {"template": "terms", "mode": "flip", "terms": terms, "total": 3300})

# 镜5 家：频道名和消息是我加的设定
R = {k: {"head": A + f"{k}-head.png", "en": EN[k], "zh": NAME[k], "color": SOLID[k], "cli": CLI[k]} for k in C}
w("v4-home", {"template": "home", "server": Z("AI 娘们的家", "AI Girls' House"), "roles": R, "user": {"name": Z("你", "You")},
    "channels": [{"name": Z("宣传片", "promo"), "roles": ["ju", "jingyu", "gemini"]},
                 {"name": Z("写代码", "code"), "roles": ["longniang", "lanxi"]},
                 {"name": Z("量化", "quant"), "roles": ["ju", "longniang"]},
                 {"name": Z("后宅", "lounge"), "roles": ["ju", "longniang", "jingyu", "gemini", "lanxi"]}],
    "steps": [{"ch": 0, "user": Z("片子的配乐挑一下？", "Pick music for the promo?"), "role": "gemini", "say": Z("交给我！", "On it!"), "hold": 1000},
              {"ch": 1, "user": Z("这个 bug 修一下", "Fix this bug"), "role": "longniang", "say": Z("五分钟！", "Five minutes!"), "hold": 1000},
              {"ch": 3, "user": Z("今天辛苦啦～", "Good work today~"), "role": "jingyu", "say": Z("哼，知道就好", "Hmph, you'd better know"), "hold": 900}],
    "chips": [{"text": Z("多会话管理", "Multi-session"), "at": 700}, {"text": Z("多 CLI 管理", "Multi-CLI"), "at": 1300}],
    "total": 5000})

# 镜6 登场（v4c）：用户「第26秒开始那个画面端端端太慢了……更加活泼一点」→ 不再一人一人排队出场（派活方案 1，已审 promo-v4-fix2）。
# 落地/闪切/小跳的时刻对齐 happytime 的鼓点：librosa beat_track 实测 117.5 BPM，本镜从全片 23.3 秒开始，
# 镜内拍点 0.29/0.79/1.28/1.79/2.28/2.79/3.30 秒（/tmp/promo-v4/vo4c/beat.txt），半拍 0.255 秒 ≈ 派活「每隔约 0.25 秒」。
# 四人落在 0.29 起的连续半拍上；闪切 1.28–2.28（派活「约 1 秒的闪切」，正好一拍起一拍止）；小跳 2.79 起，落地约 3.25 踩拍；
# 整镜 5.0 秒（派活「整镜约 5 秒」），岚汐名字条约 2.5 秒、前四人约 4 秒，够读完。
order = ["ju", "longniang", "jingyu", "gemini", "lanxi"]
cast = [{"img": A + f"{k}.png", "en": EN[k], "zh": NAME[k], "color": C[k], "x": 150 + i * 245} for i, k in enumerate(order)]
w("v4-debut", {"template": "debut", "cast": cast, "land": [290, 545, 790, 1035], "flash": 1280, "flashDur": 1000, "hop": 2790,
    "total": 5000, "shout": Z("等等我～", "Wait for me~")})

# 镜7 协作（v4c）：派活方案 2——气泡连续弹出、不要打字提示，「立绘我来画」「脚本 v2 ✓」两处 1 秒闪切，一句旁白挂一个画面。
# 每条 at = 旁白 vo/zh-v4/07.wav 里这一小句的起点 + 0.3 秒（cut.py VO_DELAY）。小句起点由 faster-whisper 逐字时间戳实测
# （/tmp/promo-v4/vo4c/asr.txt：你就 0.00、橘 0.96、鲸鱼娘 1.80、岚汐 2.86、彩虹猫 3.94、龙娘 4.94、V2 5.92 秒），
# 相邻两条约隔 1 秒 = 派活「字少的停约 1 秒」；合影 7.4 秒起停到 10.0 秒（派活「五人合影停约 2 秒」「整镜约 10–11 秒」）。
w("v4-collab", {"template": "collab", "channel": Z("宣传片", "promo"),
    "user": {"name": Z("你", "You"), "text": Z("帮我做个宣传片～", "Make me a promo video~"), "at": 300},
    "roles": {k: {"head": A + f"{k}-head.png", "zh": NAME[k], "color": SOLID[k], "cli": CLI[k]} for k in order},
    "lead": {"role": "ju", "say": Z("脚本 v1 来啦", "Script v1, here"), "at": 1260},
    "card": {"title": Z("脚本 v1", "Script v1"), "title2": Z("脚本 v2", "Script v2"),
             "lines": [Z("痛点：四个终端", "Pain: four terminals"), Z("封面：五人全身照", "Cover: full cast"), Z("登场：图标 + 名字", "Debut: icons + names"), Z("结尾：GitHub 地址", "End: GitHub link")]},
    "notes": [{"role": "jingyu", "say": Z("封面别剧透，痛点挪后面", "No spoilers on the cover"), "op": {"swap": [0, 1], "set": {"i": 0, "text": Z("封面：只露呆毛", "Cover: just ahoge")}}, "at": 2100},
              {"role": "lanxi", "say": Z("名字牌做成圆角卡片", "Make name tags rounded cards"), "op": {"set": {"i": 2, "text": Z("登场：圆角名字卡", "Debut: rounded cards")}}, "at": 3160},
              {"role": "gemini", "say": Z("加点反差梗！", "Add a twist gag!"), "op": {"add": Z("彩蛋：反差梗", "Bonus: twist gag")}, "at": 4240},
              {"role": "longniang", "say": Z("立绘我来画", "I'll draw them"), "op": {"art": True}, "at": 5240}],
    "flash": 1000, "v2": {"at": 6300}, "zoomAt": 7400,
    "art": {"img": A + "plane.jpg"}, "total": 10000})

# 镜8 片尾：地址照 scenes/v2-end.json:61
w("v4-outro", {"template": "outro4", "img": A + "peace.jpg", "slogan": Z("AI 娘们的家 · 开源", "A home for AI girls · Open source"),
    "repo": "github.com/zuiho-kai/bothouse", "credit": Z("Music: 甘茶の音楽工房", "Music: Amacha Music Studio"),
    # v4c：派活方案 4「五个人一起蹦一下再定格，约 3 秒」；1.1 秒起跳是我定的（合影、标志、地址都弹完之后）
    "hop": 1100, "total": 3000})
