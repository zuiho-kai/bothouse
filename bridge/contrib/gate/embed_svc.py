"""记忆推送向量一路的服务（vector_search.py 调它）：Qwen3-Embedding 把 wiki 每行和这轮的话转成向量，按余弦相似度排。

要带 torch、transformers、numpy 的 Python（gate 自己的 Python 不用装这些）：
    pip install torch transformers numpy
    python3 embed_svc.py            # 地址见下面 PORT，模型默认 Qwen/Qwen3-Embedding-0.6B（第一次自动下载）
再在 bothouse 配置里打开：[gate] vector = true（服务地址不是默认的再写 vector_url）。
环境变量：EMBED_MODEL（模型名或本地目录）、EMBED_PORT、EMBED_DIR（向量表存哪，默认本文件旁的 vec/）、
EMBED_IDLE（空闲多少秒卸载模型，0 = 不卸）、EMBED_MAX_MB（进程内存上限，0 = 不限）。

长期跑不涨内存（用户 11-27「搞一个内存限制…长期这样搞的话，我怕他会炸」）：
- 空闲卸载：模型空闲 EMBED_IDLE 秒就卸掉、还回显存，下次查询再加载（实测冷加载约 1.6 秒）；向量表留着（约 0.1GB）。
  照 Ollama（docs/faq.mdx「By default models are kept in memory for 5 minutes before being unloaded」，OLLAMA_KEEP_ALIVE 可改）
  和 qmd（README「Embedding/reranking contexts are disposed after 5 min idle and transparently recreated on the next request」）。
- 内存上限：每 10 秒量一次本进程内存，超了先卸模型、清显存缓存；还超就退出，由守护（launchd KeepAlive / systemd Restart）拉起。
  它是独立进程，回收它不影响 gate：这期间 gate 只用关键词推。
- 每算完一批清 MPS/CUDA 缓存：长度不同的批次各开一块缓存不还，是 rerank_svc 11-14 涨到 89G 的原因。

    POST /sync   {"table": 名, "rows": {键: 文本, ...}}  → {"ok": true, "n": 现有行数, "todo": 待算行数}
                 只算新键、删掉 rows 里没有的键；在后台算，算完存盘（重启不重算）。
    POST /search {"table": 名, "q": 这轮的话, "k": 取前几行}  → {"ready": true, "ids": [键, ...], "model": 名}
                 表还没建完回 {"ready": false}。

做法照模型卡和离线实验 gen-memory/amr/v5/run.py：查询前加任务说明，取最后一个 token 的隐层，归一化。
离线实验实测（Mac Studio，0.6B）：2.67 万行建表 192 秒、表 109MB、每句查询中位 21ms、进程约 1.7GB。
"""
import gc, json, os, subprocess, sys, threading, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import numpy as np
import torch
from transformers import AutoModel, AutoTokenizer

MODEL = os.environ.get("EMBED_MODEL") or "Qwen/Qwen3-Embedding-0.6B"  # 来源：用户 11-27 认可「换成 0.6B 效果没掉」
PORT = int(os.environ.get("EMBED_PORT") or 9931)  # 来源：沿用 gate 默认 9930（gate.py），取紧挨着的下一个；同 config [gate] vector_url 默认
DIR = Path(os.environ.get("EMBED_DIR") or Path(__file__).resolve().parent / "vec")
# 模型卡要求按任务写一句说明，加在查询前；被检索的行不加（同离线实验 run.py）
INS = "Instruct: Given a user request to an AI assistant, retrieve memory notes that help answer it\nQuery: "
BATCH, MAX_TOK, Q_CHARS = 64, 2048, 2000  # 来源：离线实验 run.py 的同名设置
DEV = "mps" if torch.backends.mps.is_available() else "cuda" if torch.cuda.is_available() else "cpu"
IDLE = float(os.environ.get("EMBED_IDLE") or 300)  # 来源：Ollama 默认 keep_alive 5 分钟（docs/faq.mdx），qmd 同为空闲 5 分钟释放
MAX_MB = float(os.environ.get("EMBED_MAX_MB") or 4096)  # 来源：离线实验实测进程峰值约 1.7GB，上限取它的两倍多，正常建表、查询碰不到
CHECK = 10  # 秒：多久量一次内存、看一次空闲；来源：同 IDLE 比够细（5 分钟里看 30 次），ps 一次几毫秒

tok = AutoTokenizer.from_pretrained(MODEL, padding_side="left")
model, _used = None, time.time()
_model = threading.Lock()  # 模型一次只跑一批：查询插在建表的两批之间；加载、卸载也在这把锁里


def _free():
    gc.collect()
    if DEV == "mps":
        torch.mps.empty_cache()
    elif DEV == "cuda":
        torch.cuda.empty_cache()


def _load():
    """锁内调：模型没加载就加载。"""
    global model, _used
    if model is None:
        t0 = time.time()
        model = AutoModel.from_pretrained(MODEL, torch_dtype=torch.float32 if DEV == "cpu" else torch.bfloat16).to(DEV).eval()
        print(f"embed_svc: loaded {MODEL} in {time.time() - t0:.1f}s", flush=True)
    _used = time.time()
    return model


def unload(why):
    global model
    with _model:
        if model is None:
            return
        model = None
        _free()
    print(f"embed_svc: unloaded model ({why}), memory {mem_mb():.0f}MB", flush=True)


def mem_mb():
    """本进程占的内存（MB）：常驻内存 + MPS 驱动占的显存（Mac 上统一内存，常驻里不全算它）。"""
    try:
        if sys.platform == "linux":
            rss = int(open("/proc/self/statm").read().split()[1]) * os.sysconf("SC_PAGE_SIZE") / 2**20
        else:
            rss = int(subprocess.run(["ps", "-o", "rss=", "-p", str(os.getpid())], capture_output=True, text=True).stdout) / 1024
    except (OSError, ValueError):
        return 0.0
    return rss + (torch.mps.driver_allocated_memory() / 2**20 if DEV == "mps" else 0)


def _watch():
    while True:
        time.sleep(CHECK)
        if model is not None and IDLE > 0 and time.time() - _used >= IDLE:
            unload(f"idle {IDLE:.0f}s")
        if MAX_MB > 0 and mem_mb() > MAX_MB:
            unload(f"over {MAX_MB:.0f}MB")
            m = mem_mb()
            if m > MAX_MB:  # 卸了模型还超：只剩重启能还内存，守护会拉起，向量表从盘上读回
                print(f"embed_svc: still {m:.0f}MB > {MAX_MB:.0f}MB after unloading, exiting for a restart", flush=True)
                os._exit(75)


def enc(texts):
    out = None
    order = np.argsort([len(t) for t in texts])
    for s in range(0, len(texts), BATCH):
        ix = order[s:s + BATCH]
        with _model, torch.no_grad():
            m = _load()
            if out is None:
                out = np.zeros((len(texts), m.config.hidden_size), np.float32)
            b = tok([texts[i] for i in ix], padding=True, truncation=True, max_length=MAX_TOK, return_tensors="pt").to(DEV)
            out[ix] = torch.nn.functional.normalize(m(**b).last_hidden_state[:, -1].float(), dim=-1).cpu().numpy()
            del b
            _free()
    return out


class Table:
    def __init__(self, name):
        self.name, self.lock, self.busy = name, threading.Lock(), False
        self.keys, self.E, self.ready, self.todo = [], np.zeros((0, 0), np.float32), False, 0
        f = DIR / f"{name}.npz"
        if f.exists():
            try:
                z = np.load(f)
                if str(z["model"]) == MODEL:  # 换了模型：整表重算
                    self.keys, self.E, self.ready = list(z["keys"]), z["E"], True
            except Exception:  # 存盘坏了：整表重算
                pass

    def sync(self, rows):
        with self.lock:
            have = set(self.keys)
            new = [k for k in rows if k not in have]
            gone = have - set(rows)
            self.todo = len(new)
            if (new or gone or not self.ready) and not self.busy:
                self.busy = True
                threading.Thread(target=self._build, args=(rows, new), daemon=True).start()
            return {"ok": True, "n": len(self.keys), "todo": self.todo}

    def _build(self, rows, new):
        try:
            E_new = enc([rows[k] for k in new]) if new else np.zeros((0, self.E.shape[1]), np.float32)
            _free()
            with self.lock:
                pos = {k: i for i, k in enumerate(self.keys)}
                keep = [k for k in self.keys if k in rows]
                keys = keep + new
                E = np.concatenate([self.E[[pos[k] for k in keep]], E_new]) if keep else E_new
                self.keys, self.E, self.ready, self.todo = keys, E, True, 0
            DIR.mkdir(parents=True, exist_ok=True)
            tmp = DIR / f"{self.name}.tmp.npz"
            np.savez(tmp, keys=np.array(keys), E=E, model=np.array(MODEL))
            os.replace(tmp, DIR / f"{self.name}.npz")
        finally:
            with self.lock:
                self.busy = False

    def search(self, q, k):
        with self.lock:
            if not self.ready or not self.keys:
                return {"ready": False}
            keys, E = self.keys, self.E
        cos = E @ enc([INS + q[:Q_CHARS]])[0]
        top = np.argsort(-cos)[:k]
        return {"ready": True, "ids": [keys[i] for i in top], "model": MODEL}


_tables, _tables_lock = {}, threading.Lock()


def get(name):
    with _tables_lock:
        if name not in _tables:
            _tables[name] = Table(name)
        return _tables[name]


class H(BaseHTTPRequestHandler):
    def do_POST(self):
        try:
            req = json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)))
            name = str(req["table"])
            if self.path == "/sync":
                out = get(name).sync(req["rows"])
            elif self.path == "/search":
                out = get(name).search(str(req.get("q") or ""), int(req["k"]))
            else:
                self.send_error(404)
                return
            b, code = json.dumps(out).encode(), 200
        except Exception as e:
            b, code = json.dumps({"error": str(e)}).encode(), 400
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(b)))
        self.end_headers()
        self.wfile.write(b)

    def log_message(self, *a):
        pass


if __name__ == "__main__":
    print(f"embed_svc: {MODEL} on {DEV}, 127.0.0.1:{PORT}, unload after {IDLE:.0f}s idle, memory cap {MAX_MB:.0f}MB", flush=True)
    threading.Thread(target=_watch, daemon=True).start()
    ThreadingHTTPServer(("127.0.0.1", PORT), H).serve_forever()
