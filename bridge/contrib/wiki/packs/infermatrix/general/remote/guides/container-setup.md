---
name: container-setup
description: 容器是临时的，只有挂载的宿主路径才持久：进容器第一套命令、HF cache 环境变量陷阱、docker exec chdir permission denied、multiprocessing 前 cd /tmp
metadata:
  scope: 只收远端容器内的持久化路径、cache 环境变量、docker exec 与 multiprocessing 工作目录规则；HF 离线加载归 hf-offline-mandatory，陌生节点侦察归 node-basics-1
---
# 容器是临时的：只有挂载的宿主路径才持久

## 现状

- 进容器之前 / 之后都要做的事，散在三个曾经独立的文件里——合一篇。

## 关键事实

- 源页：`knowledge/general/remote/guides/container-setup.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: general, remote；created: 2026-07-10；updated: 2026-07-16；sources: 无

### 1. 容器是临时的，只有挂载的宿主路径才持久

- **容器是临时的。只有挂载的宿主路径才持久。** 凡是有价值的东西（模型、数据集、venv、代码、产出），**第一次下载 / 生成时就写到挂载的 Lustre 路径**，绝对不新写容器临时路径。
- `/root` 在远端容器里也是容器层/共享历史区，不是个人持久工作根。
- 已有且完整的 `/root` / `/root/.cache` / `/root/...venv` 可以只读复用；一旦缺包、cache miss、要下载、要 `uv pip install` 或要建新 venv，`uv`、`pip`、`vllm`、HF、torch 的安装产物和 cache 根都必须显式指向当前机器的宿主挂载根（如 `<REMOTE_WORK_ROOT>`、`<REMOTE_WORK_ROOT>`、`/home/models`），禁止补装到 `/root`。

#### 典型错误（野鸡程序员习惯）

| 场景 | ❌ 野鸡做法 | ✅ 正确做法 |
|---|---|---|
| 下 HF 模型 | `hf download ...`（默认 `~/.cache/huggingface` = 容器里 `/root/.cache`，**容器删就丢**） | `export HF_HOME=/home/models` **先**，再 `hf download --cache-dir /home/models/hub` |
| pip install | `pip install foo`（进 `/usr/lib/python*/site-packages` = 容器层，重建丢） | venv 放 `/home/<user>/venvs/xxx` 或直接用镜像自带 `/app/vllm-omni/.venv` |
| uv / vLLM install | 缺包后直接 `uv pip install vllm...`，默认写 `/root/.cache/uv` 或把 venv 建到 `/root/...` | 已有完整 `/root` venv/cache 可只读复用；缺包或新建时，先设 `UV_CACHE_DIR` / `PIP_CACHE_DIR` / `XDG_CACHE_HOME` 到宿主挂载根，再把 venv 建到 `/data/<user>/...` 或 `/home/<user>/...` |
| git clone | `git clone ... /tmp/foo` 或 `~/foo` | clone 到 `/home/<YOUR_GROUP>/<user>/sources/` |
| 临时输出 | `/tmp/output.json` | `/home/<user>/workspace/output.json` |
| HuggingFace datasets | `~/.cache/huggingface/datasets` | `/home/models/hub` 下的 `datasets--*` 条目，跟模型放一起 |
| benchmark results | 当前目录（容器 cwd） | `/home/<user>/bench_results/` |

#### 每次进容器第一套命令

```bash
# 1. 持久 HF 缓存（HF_HOME 指挂载路径）
export HF_HOME=/home/models

# 2. 持久 pip/uv 缓存
export PIP_CACHE_DIR=/home/<YOUR_GROUP>/<YOUR_USERNAME>/.cache/pip
export UV_CACHE_DIR=/home/<YOUR_GROUP>/<YOUR_USERNAME>/.cache/uv
export XDG_CACHE_HOME=/home/<YOUR_GROUP>/<YOUR_USERNAME>/.cache

# 3. 持久 torch hub / torch compile
export TORCH_HOME=/home/<YOUR_GROUP>/<YOUR_USERNAME>/.cache/torch

# 4. 持久 HF datasets
export HF_DATASETS_CACHE=/home/models/hub

# 5. 仅放行已经验证归属的当前仓库
git config --global --add safe.directory "$(pwd -P)"
```

#### 判断标准（每次下东西前问自己）

1. **这个东西下一次还会用到吗？** → 会 → 写挂载路径
2. **容器销毁后是否能再次获得？** → 不能 → 必须写挂载路径
3. **是否超过 100MB？** → 是 → 写挂载路径（省网络）
4. **是否和其他人能共享？** → 是 → 写 `/home/models` 或 `/scratch/<YOUR_GROUP>/huggingface` 共享缓存

- 任意一条回答"是"，都不能写容器临时路径。

### 2. HF cache 环境变量陷阱：TRANSFORMERS_CACHE / HF_HUB_CACHE 都覆盖 HF_HOME

- 容器镜像可能同时设了 `TRANSFORMERS_CACHE` 和 `HF_HUB_CACHE`，**两者优先级都高于** `HF_HOME`。只 unset 一个不够。
  - `os.environ.get("TRANSFORMERS_CACHE")` 返回的值会被 transformers 直接传给 `hf_hub_download`，覆盖 `HF_HOME` 推导路径
  - `HF_HUB_CACHE` 同理（huggingface_hub 库直接读）
  - **空字符串 ≠ unset**：`TRANSFORMERS_CACHE=""` 仍被 `os.environ.get` 返回 `""`，行为不可预测；`unset` 才返回 `None`

#### 进容器必做

```bash
# 检查所有 cache/HF 相关变量
env | grep -iE "cache|hf_home|offline"

# 一律 unset，再设 HF_HOME
unset TRANSFORMERS_CACHE
unset HF_HUB_CACHE
export HF_HOME=/home/models   # 或节点对应的持久挂载路径

# 新安装 / 新建 venv 前验证：目标不能含 /root
python - <<'PY'
import os, site
keys = ["UV_CACHE_DIR", "PIP_CACHE_DIR", "XDG_CACHE_HOME", "HF_HOME", "TORCH_HOME"]
for key in keys:
    print(f"{key}={os.environ.get(key)}")
print("site-packages=", site.getsitepackages())
assert not any((os.environ.get(k) or "").startswith("/root") for k in keys)
assert not any(path.startswith("/root") for path in site.getsitepackages())
print("TRANSFORMERS_CACHE" in os.environ, "HF_HUB_CACHE" in os.environ)
PY
# 期望：cache/site-packages 不含 /root，最后一行 False False
```

- 如果明确是复用已有 `/root` 环境，只做只读验证（例如 `python -c "import vllm; print(vllm.__version__)"` 或 `ls <existing-cache-path>`）；验证发现缺包 / 缺 shard / cache miss 时，停止复用并切到宿主挂载路径安装，不能在 `/root` 下补齐。
- 单条命令时也可用 `env -u TRANSFORMERS_CACHE -u HF_HUB_CACHE python ...`。

#### 典型症状

- server 启动后 GPU 全程 0 MiB、600s timeout 后崩 = 模型从未加载（cache 路径错）
- model 路径指向 `/models/huggingface/transformers/` 而非 `$HF_HOME/hub/`
- `LocalEntryNotFoundError` 但模型确实在 `$HF_HOME/hub/` 下

#### OmniServer env_dict 不能删除变量

- `OmniServer._start_server()` 做 `env = os.environ.copy(); env.update(self.env_dict)`——**只能覆盖、不能删除**。如果容器设了 `TRANSFORMERS_CACHE`，env_dict 无法 unset 它。
- **解法**：在启动 server 的 bash 脚本里 `unset` 这两个变量，或在调起 OmniServer 之前 `os.environ.pop("TRANSFORMERS_CACHE", None)`。

### 3. docker exec chdir permission denied → 先 cd 到匹配宿主路径

- docker exec 容器时如果报 `chdir to cwd ("...") set in config.json failed: permission denied`，解法是先在宿主机 `cd` 到容器配置的工作目录路径，再 `docker exec -it`。
- **How to apply:**

```bash
cd /path/matching/container/cwd && docker exec -it <container> bash
```

### 4. 容器内跑 multiprocessing 前 `cd /tmp`

- 容器内 spawn 子进程时，子进程会 chdir 到父进程当前目录。如果父进程在 Lustre 受限路径里，子进程 chdir 失败 → `PermissionError`。
- **How to apply:** 跑任何起 multiprocessing 的脚本前先 `cd /tmp`，让 spawn 子进程在 `/tmp` 下创建临时文件不报错。

## 决策与踩坑

### 2. HF cache 环境变量陷阱：历史踩坑

- 2026-04-22 GEBench DiffusionWorker 找不到模型（`TRANSFORMERS_CACHE` 覆盖）
- 2026-04-27 server 600s 超时 GPU 0 MiB（`HF_HUB_CACHE` 覆盖）

### 3. docker exec chdir permission denied

- **Why:** 容器的 config.json 里设了 cwd（如 `/scratch/<YOUR_GROUP>/<YOUR_USERNAME>/workdir`），非交互式 exec 在权限不足时直接失败。先 cd 到对应宿主路径 + 用 `-it` 交互模式可以绕过。
- 不要用 `docker exec -w /tmp` 之类的 workaround（虽然能跑单条命令，但不适合交互式操作）。
