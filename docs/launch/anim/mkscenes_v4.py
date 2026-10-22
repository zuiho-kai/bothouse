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

# 镜6 登场：前四个由镜2 的名字牌翻出来，岚汐冲进来（脚本 v4.1）
order = ["ju", "longniang", "jingyu", "gemini", "lanxi"]
plate = {"ju": "#f08a24", "longniang": "#b9a3ff", "jingyu": "#7b93ff", "gemini": "#8ab4ff"}
model = {"ju": ("Claude Code", "Claude"), "longniang": ("Codex", "GPT"), "jingyu": ("DSH", "DeepSeek"), "gemini": ("反重力 Antigravity", "Gemini")}
cast = []
for i, k in enumerate(order):
    c = {"img": A + f"{k}.png", "en": EN[k], "zh": NAME[k], "color": C[k], "x": 150 + i * 245}
    if k in model: c.update(cli=model[k][0], model=model[k][1], plate=plate[k])
    cast.append(c)
w("v4-debut", {"template": "debut", "cast": cast, "each": 1300, "beat": 250, "lastHold": 2000, "shout": Z("等等我～", "Wait for me~")})

# 镜7 协作：用户原话第 4 条；台词照 PM 派活脚本，卡片行文是我加的设定
w("v4-collab", {"template": "collab", "channel": Z("宣传片", "promo"),
    "user": {"name": Z("你", "You"), "text": Z("帮我做个宣传片～", "Make me a promo video~")},
    "roles": {k: {"head": A + f"{k}-head.png", "zh": NAME[k], "color": SOLID[k], "cli": CLI[k]} for k in order},
    "lead": {"role": "ju", "say": Z("脚本 v1 来啦", "Script v1, here")},
    "card": {"title": Z("脚本 v1", "Script v1"), "title2": Z("脚本 v2", "Script v2"),
             "lines": [Z("痛点：四个终端", "Pain: four terminals"), Z("封面：五人全身照", "Cover: full cast"), Z("登场：图标 + 名字", "Debut: icons + names"), Z("结尾：GitHub 地址", "End: GitHub link")]},
    "notes": [{"role": "jingyu", "say": Z("封面别剧透，痛点挪后面", "No spoilers on the cover"), "op": {"swap": [0, 1], "set": {"i": 0, "text": Z("封面：只露呆毛", "Cover: just ahoge")}}, "hold": 1200},
              {"role": "lanxi", "say": Z("名字牌做成圆角卡片", "Make name tags rounded cards"), "op": {"set": {"i": 2, "text": Z("登场：圆角名字卡", "Debut: rounded cards")}}, "hold": 1200},
              {"role": "gemini", "say": Z("加点反差梗！", "Add a twist gag!"), "op": {"add": Z("彩蛋：反差梗", "Bonus: twist gag")}, "hold": 1200},
              {"role": "longniang", "say": Z("立绘我来画", "I'll draw them"), "op": {"art": True}, "hold": 1500}],
    "art": {"img": A + "plane.jpg"}, "zoomHold": 2800, "_zoomHold": "审稿要求合影停够久、看得出是五个人；2.8 秒是我定的", "total": 12000})

# 镜8 片尾：地址照 scenes/v2-end.json:61
w("v4-outro", {"template": "outro4", "img": A + "peace.jpg", "slogan": Z("AI 娘们的家 · 开源", "A home for AI girls · Open source"),
    "repo": "github.com/zuiho-kai/bothouse", "credit": Z("Music: 甘茶の音楽工房", "Music: Amacha Music Studio"), "total": 3500})
