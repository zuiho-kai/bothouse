"""记忆推送向量一路的服务（vector_search.py 调它）：Qwen3-Embedding 把 wiki 每行和这轮的话转成向量，按余弦相似度排。

要带 torch、transformers、numpy 的 Python（gate 自己的 Python 不用装这些）：
    pip install torch transformers numpy
    python3 embed_svc.py            # 地址见下面 PORT，模型默认 Qwen/Qwen3-Embedding-0.6B（第一次自动下载）
再在 bothouse 配置里打开：[gate] vector = true（服务地址不是默认的再写 vector_url）。
环境变量：EMBED_MODEL（模型名或本地目录）、EMBED_PORT、EMBED_DIR（向量表存哪，默认本文件旁的 vec/）。

    POST /sync   {"table": 名, "rows": {键: 文本, ...}}  → {"ok": true, "n": 现有行数, "todo": 待算行数}
                 只算新键、删掉 rows 里没有的键；在后台算，算完存盘（重启不重算）。
    POST /search {"table": 名, "q": 这轮的话, "k": 取前几行}  → {"ready": true, "ids": [键, ...], "model": 名}
                 表还没建完回 {"ready": false}。

做法照模型卡和离线实验 gen-memory/amr/v5/run.py：查询前加任务说明，取最后一个 token 的隐层，归一化。
离线实验实测（Mac Studio，0.6B）：2.67 万行建表 192 秒、表 109MB、每句查询中位 21ms、进程约 1.7GB。
"""
import json, os, threading
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

tok = AutoTokenizer.from_pretrained(MODEL, padding_side="left")
model = AutoModel.from_pretrained(MODEL, torch_dtype=torch.float32 if DEV == "cpu" else torch.bfloat16).to(DEV).eval()
_model = threading.Lock()  # 模型一次只跑一批：查询插在建表的两批之间


def enc(texts):
    out = np.zeros((len(texts), model.config.hidden_size), np.float32)
    order = np.argsort([len(t) for t in texts])
    for s in range(0, len(texts), BATCH):
        ix = order[s:s + BATCH]
        with _model, torch.no_grad():
            b = tok([texts[i] for i in ix], padding=True, truncation=True, max_length=MAX_TOK, return_tensors="pt").to(DEV)
            out[ix] = torch.nn.functional.normalize(model(**b).last_hidden_state[:, -1].float(), dim=-1).cpu().numpy()
    return out


class Table:
    def __init__(self, name):
        self.name, self.lock, self.busy = name, threading.Lock(), False
        self.keys, self.E, self.ready, self.todo = [], np.zeros((0, model.config.hidden_size), np.float32), False, 0
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
    print(f"embed_svc: {MODEL} on {DEV}, 127.0.0.1:{PORT}", flush=True)
    ThreadingHTTPServer(("127.0.0.1", PORT), H).serve_forever()
