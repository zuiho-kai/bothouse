"""记忆推送的向量一路（可选，默认关）：关键词（BM25）名单和向量名单用 RRF 合并，再交给 ctxsvc.match_wiki 照旧排页、判相关、推前 5 条。

开关：GATE_VECTOR = 向量服务地址（embed_svc.py）。bothouse 配置 [gate] vector = true 时由桥传（core/gate_proc.go），
不设就关：rank() 原样返回关键词名单，推送和没有这个文件时一模一样。
服务没起、没建完表、1 秒没答：这一轮只用关键词，不报错。

做法照离线实验 gen-memory/amr/v5/run.py（用户 11-27 定「只接关键词加向量合并这一步，论文的排序模型不接」）：
关键词前 3000 行、向量前 1000 行，同一行文本只算一次，各按名次给 1/(61+名次)，加起来排。
向量表跟着 wiki 走：ctxsvc 每次重建关键词索引（5 分钟）把全部行发给服务，服务只算新行、删掉没了的行（embed_svc.py /sync）。
只用标准库：gate 的 Python 不装 numpy、torch，算向量在服务那边。
"""
import hashlib, json, os, re, threading, urllib.request
from pathlib import Path

URL = os.environ.get("GATE_VECTOR", "").strip().rstrip("/")
URL = "" if URL.lower() == "off" else URL
RRF_K = 60  # 来源：RRF 原论文（Cormack 2009）的常数，qmd 同；离线实验用的就是它
DEPTH_KW, DEPTH_VEC = 3000, 1000  # 来源：离线实验 run.py，两路各取这么深再合并
WAIT = 1  # 秒：查询向量实测中位 21ms（0.6B，Mac），超过就当服务卡住，这一轮只用关键词
SYNC_WAIT = 30  # 秒：发全表给服务只是登记，算向量在服务后台做

_FLOOR_TAG = re.compile(r"\s*<!-- 帖 t[0-9a-f]{10}·\d+楼.*?-->\s*$")  # 同 ctxsvc._FLOOR_TAG：楼层标注不进向量
_lock = threading.Lock()
_sent = {}  # 表名 → 已发过的关键词索引（同一个索引只发一次；重建后再发）
_busy = set()


def row_text(rel, line):
    """一行记忆送去算向量的文本：页路径 + 这行（同离线实验的条目文本）。"""
    return f"{rel} - {_FLOOR_TAG.sub('', line).strip()}"


def row_key(text):
    return hashlib.sha1(text.encode()).hexdigest()[:16]


def table(root):
    """每个 wiki 根一张表（主 wiki、各角色 wiki 分开）。"""
    return hashlib.sha1(str(Path(root).expanduser().resolve()).encode()).hexdigest()[:12]


def _post(path, body, timeout):
    req = urllib.request.Request(URL + path, json.dumps(body, ensure_ascii=False).encode(),
                                 {"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read())


def _keys(idx):
    """索引每行的向量键，和键 → 第一次出现的行（同一文本出现多次只算一行）；缓存在索引上。"""
    if getattr(idx, "_vec_keys", None) is None:
        keys = [row_key(row_text(l[0], l[2])) for l in idx.lines]
        first = {}
        for i, k in enumerate(keys):
            first.setdefault(k, i)
        idx._vec_keys, idx._vec_first = keys, first
    return idx._vec_keys, idx._vec_first


def _sync(idx, name):
    try:
        keys, _ = _keys(idx)
        _post("/sync", {"table": name, "rows": {k: row_text(l[0], l[2]) for k, l in zip(keys, idx.lines)}}, SYNC_WAIT)
        with _lock:
            _sent[name] = idx
    except Exception:  # 服务没起：下一轮再发
        pass
    finally:
        with _lock:
            _busy.discard(name)


def sync(idx, root):
    """这个索引还没发给服务就在后台发（不挡这一轮）。"""
    name = table(root)
    with _lock:
        if _sent.get(name) is idx or name in _busy:
            return
        _busy.add(name)
    threading.Thread(target=_sync, args=(idx, name), daemon=True).start()


def rank(idx, root, q, vq, k):
    """前 k 行在 idx.lines 里的下标。q = 关键词查询；vq = 向量查询（这轮的话）。开关关着 = idx.rank(q, k)。"""
    if not URL or not vq:
        return idx.rank(q, k)
    kw = idx.rank(q, max(k, DEPTH_KW))
    sync(idx, root)
    try:
        got = _post("/search", {"table": table(root), "q": vq, "k": DEPTH_VEC}, WAIT)
    except Exception:
        return kw[:k]
    if not got.get("ready"):
        return kw[:k]
    keys, first = _keys(idx)
    sc, seen = {}, set()
    for i in kw:
        if keys[i] not in seen:
            sc[i] = sc.get(i, 0) + 1 / (RRF_K + 1 + len(seen))
            seen.add(keys[i])
    for r, key in enumerate(got.get("ids") or ()):
        i = first.get(key)
        if i is not None:
            sc[i] = sc.get(i, 0) + 1 / (RRF_K + 1 + r)
    return sorted(sc, key=lambda i: -sc[i])[:k]
