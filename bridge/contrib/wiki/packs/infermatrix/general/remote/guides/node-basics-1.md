---
name: node-basics-1
description: 进陌生远端节点的正确流程（第 1/2 部分）：先看别人容器的挂载、持久存储、模型缓存、现成 clone 和 venv、候选 python 的 import gate、容器权限问题与反面教训
metadata:
  scope: 只收初次进入陌生远端节点时的环境侦察顺序、import gate 和权限问题；香港机器 PyPI 源和他人 editable install 的 worktree + PYTHONPATH 套路归 node-basics-2
---
# 进陌生远端节点的正确流程（第 1/2 部分）

## 现状

- 本页是源页 `node-basics.md` 的第 1 节“进陌生远端节点的正确流程”；第 2 节“香港机器：直连 PyPI，不要清华源”和第 3 节“别人的 editable install：worktree + PYTHONPATH 前置”在 [[node-basics-2]]。

## 关键事实

- 源页：`knowledge/general/remote/guides/node-basics.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: general, remote；created: 2026-07-10；updated: 2026-07-16；sources: 无

### 1. 进陌生远端节点的正确流程

#### 正确顺序

##### 1.1 先看节点上别人的容器怎么挂的

```bash
docker ps --format "{{.Names}} {{.Image}}"
docker inspect <someone_else_container> --format '{{range .Mounts}}{{.Source}} -> {{.Destination}}{{println}}{{end}}'
```

- **这比任何文档都权威**。别人容器挂什么，我就挂什么。

##### 1.2 节点有哪些持久存储

```bash
df -h | grep -E "home|scratch|lustre|nfs"
ls /home /scratch 2>/dev/null
```

- Lustre 路径在不同节点可能：
  - `/scratch/<YOUR_GROUP>/...`
  - `/home/<YOUR_GROUP>/<user>/...`
- **不要假设路径。先查文件系统。**

##### 1.3 节点上有哪些模型缓存

```bash
ls /home/models/hub 2>/dev/null     # Lustre 共享缓存
ls /scratch/<YOUR_GROUP>/huggingface/hub 2>/dev/null   # Lustre 用户缓存
find /home /scratch -maxdepth 4 -name "models--*" -type d 2>/dev/null | head
```

- **模型缓存 160GB，能复用绝不重下**。

##### 1.4 节点上有没有现成的 vllm-omni clone 和 venv

```bash
OWNER_ROOT=/home/<user>   # 或用户明确点名的 /data/<user> / /scratch/<group>/<user>
test -d "$OWNER_ROOT" && find "$OWNER_ROOT" -maxdepth 4 -type d \( -name 'vllm-omni*' -o -name 'wt-*' -o -name '.venv' -o -name 'venv' -o -name 'vllm*' \) 2>/dev/null | sort
find "$OWNER_ROOT" -maxdepth 5 -path '*/bin/python' -type f 2>/dev/null | sort
ls /app/vllm-omni/.venv 2>/dev/null
which python   # 容器里可能是 /app/vllm-omni/.venv/bin/python
```

- `local/remote.md`、历史错题和其他人的目录只能当候选线索，不能当“目标工作根不存在”的证据。
- 用户明确说某个工作根或 vLLM 版本环境存在时，先用 live `find` / import gate 证明精确路径；环境目录可能按版本命名，不一定叫 `.venv`。
- 没找到要汇报“我没有按正确根目录查到”，不能直接跳到其他用户目录。
- 候选 python 的最低 import gate：

```bash
"$PY" - <<'PY'
import sys
print("python", sys.executable)
try:
    import vllm
    print("vllm", vllm.__version__)
except Exception as e:
    print("vllm_import_error", repr(e))
try:
    import pytest
    print("pytest", pytest.__version__)
except Exception as e:
    print("pytest_import_error", repr(e))
PY
```

##### 1.5 容器权限问题

- 容器内是 root，但挂载的 Lustre 目录 owner 是 UID=2129 之类。会有两类问题：
  - **Git 报 dubious ownership**：先验证仓库 owner 和绝对路径，只将当前已授权仓库加入 `safe.directory`；禁止使用通配符全局放行
  - **某些 Lustre 子目录 root 没权限读**：没办法，需要容器加 `--user 2129:1033`（但 cuda-12.9 image 可能没建 user，风险高）

## 决策与踩坑

### 1. 进陌生远端节点的正确流程

- **错误示范（我犯过的）**：假设新节点路径结构和之前节点一样，直接 `cd /app/vllm-omni` 或 `source <YOUR_REMOTE_WORKDIR>/.venv/bin/activate`，全部踩空。

#### 反面教训

- **不要**上来就跑业务命令。先 30 秒探环境
- **不要**假设节点路径结构。每个节点不一样
- **不要**依赖容器内的 `~/.cache`，写 Lustre 才持久
- **不要**因为看到别人的 repo/venv 可用，就跳过任务 owner root
- **不要**在他人 repo 下 `git fetch`、`git worktree add`、`pip install`、跑会写 cache 的测试，除非用户明确授权
