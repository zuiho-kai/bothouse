---
name: live-environment
description: 远端事实以 live env 为准：跑模型加载 / profiling / benchmark 前在本轮实际 SSH/container/venv 上确认 env、正在跑的 PID 环境和本地绝对 snapshot 路径，以及禁止事项与一次 P0 复盘
metadata:
  scope: 只收“历史记录里的远端路径只是候选线索，必须用当前 live 环境确认”这一规则、确认命令、禁止事项和 P0 复盘；offline 设置归 hf-offline-mandatory，容器 cache 路径归 container-setup
---
# 远端事实以 live env 为准

## 关键事实

- 源页：`knowledge/general/remote/guides/live-environment.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: general, remote；created: 2026-07-10；updated: 2026-07-10；sources: 无

### 规则

- 远端跑模型加载、profiling、benchmark 前，历史指南、错题和 `local/remote.md` 里的路径只能当候选线索，不能直接作为事实。必须在本轮实际执行的 SSH/container/venv 上确认：

```bash
env | grep -E 'HF_HOME|HF_HUB_CACHE|TRANSFORMERS_CACHE|HF_HUB_OFFLINE|TRANSFORMERS_OFFLINE|CUDA_VISIBLE_DEVICES|VIRTUAL_ENV'
pwd
python - <<'PY'
import os, sys
print("python", sys.executable)
for k in ["HF_HOME", "HF_HUB_CACHE", "TRANSFORMERS_CACHE", "CUDA_VISIBLE_DEVICES", "VIRTUAL_ENV"]:
    print(f"{k}={os.environ.get(k)}")
PY
```

- 如果服务器或 benchmark 已经在跑，先查正在跑的 PID，而不是猜：

```bash
tr '\0' '\n' < /proc/<pid>/environ | grep -E 'HF_HOME|HF_HUB_CACHE|TRANSFORMERS_CACHE|CUDA_VISIBLE_DEVICES|VIRTUAL_ENV'
readlink -f /proc/<pid>/cwd
ps -ww -p <pid> -o pid,pgid,etime,cmd
```

- 模型必须用验证过的本地绝对 snapshot 路径：

```bash
SNAP=/data/models/hub/models--org--repo/snapshots/<sha>
test -d "$SNAP" || { echo "missing snapshot: $SNAP"; exit 2; }
readlink -f "$SNAP"
```

### 相关

- hf_offline_mandatory：[[hf-offline-mandatory]]
- container_setup：[[container-setup]]
- srun_lifecycle：[[srun-lifecycle]]

## 决策与踩坑

### 禁止事项

- 禁止凭旧记忆把 `/data/model/hub`、`/data/models/hub`、`/home/models/hub` 写进命令；先在当前机器 `test -d`。
- 禁止为了让命令“看起来完整”临时新造 `HF_HOME=/data/<user>/hf-home`；除非明确要下载/重建 cache，并且用户接受 IO 成本。
- 禁止只看本地 shell env 后就判断容器内 env；`docker exec` / tmux / nohup 的实际进程 env 才是准的。
- 禁止把“我上次在这台机器这么跑过”当成本轮证据；共享机器上的 venv、cache、worktree 会被别人改。

### 这次 P0 的复盘

- 错误链路：按旧记忆用了 `/data/model/hub`，又临时设了 `<REMOTE_WORK_ROOT>/hf-home`，没有先从服务器正在跑的进程环境确认真实 `HF_HOME=/data/models`。
- 正确链路：

1. 先查正在跑的服务或 benchmark PID 的 `/proc/<pid>/environ`。
2. 读取 `HF_HOME/HF_HUB_CACHE/TRANSFORMERS_CACHE/CUDA_VISIBLE_DEVICES/VIRTUAL_ENV`。
3. `readlink -f /proc/<pid>/cwd` 和 `ps -ww` 确认工作目录与命令。
4. 对候选 snapshot 做 `test -d` 和 `readlink -f`。
5. 只清本轮目录/PGID 相关残留进程，再用验证出的路径重跑。
