---
name: 2026-05-19-remote-validation-010
description: 2026-05-19 错题：远端验证前没读 local/remote.md 就直连 SSH，错过 REMOTE_WORK_ROOT 下指定 venv；含新建 worktree + uv venv、vllm / flashinfer 健康检查命令与 6 条避免规则
metadata:
  scope: 只收 2026-05-19 远端验证前须先读本机远端配置这一起事故及新建 worktree/venv 与健康检查流程；小 lint 修复不必上远端归 2026-05-19-remote-validation-006，远端路径不能猜归 2026-05-19-remote-validation-012
---
# 2026-05-19 — 远端验证前没读本机远端配置，错过指定 venv

## 关键事实

- 源页：`knowledge/repos/vllm-omni/remote/incidents/workflow-validation/2026-05-19-remote-validation-010.md`（InferMatrixCopilot@ecfb84d0）；源页无 frontmatter

## 决策与踩坑

- 编号：`inc-2026-05-19-remote-validation-010`
- 归属：`repos/vllm-omni/remote`
- 状态：已验证
- 搜索词：远端验证、本机配置、venv
- 影响范围：repos/vllm-omni/remote
- **症状**：用户给远端 SSH 入口让我验证，我直接连上后扫 `python --version` / `find` 环境，报默认 `python` 不存在，然后才被用户指出 `local/remote.md` 已写明 `<REMOTE_WORK_ROOT>` 下的工作目录和 venv。
- **根因**：把“SSH 能连通”误当作“远端环境已知”，跳过了仓库已经维护的本机远端事实。`CLAUDE.md` 虽然要求远端侦察，但 venv、worktree、同步方式都集中在 `local/remote.md`，不读就会重复踩：错 venv、错目录、错同步方式。
- **解法**：任何远端验证 / GPU smoke / 远端 pytest 之前，先读：

```powershell
Get-Content -Encoding utf8 local\remote.md
```

- 然后以 `<REMOTE_WORK_ROOT>` 为稳定锚点。用户明确预期是：**本地修改先 commit + push 到远程分支；服务器在 `<REMOTE_WORK_ROOT>` 下新建本次专用 worktree 和 venv；远端通过 git fetch/pull 同步代码后验证**。不能把某个旧 `wt-*` 或 `.venv` 当永久路径（用户会不定期删除 worktree 和 venv）。
- 先动态查看当前 `<REMOTE_WORK_ROOT>`，避免命名冲突：

```bash
ls -la <REMOTE_WORK_ROOT>
find <REMOTE_WORK_ROOT> -maxdepth 3 -type f \( -name pyvenv.cfg -o -name activate \) 2>/dev/null | sort
find <REMOTE_WORK_ROOT> -maxdepth 2 -type d -name "wt-*" 2>/dev/null | sort
```

- 再新建本次专用目录（名字按任务改）：

```bash
cd <REMOTE_WORK_ROOT>
git clone <repo-url> wt-<task>   # 若已有合适 repo，可 git fetch 后 git worktree add <REMOTE_WORK_ROOT>/wt-<task> <branch>
cd <REMOTE_WORK_ROOT>/wt-<task>
git fetch origin <branch>
git checkout -B <branch> FETCH_HEAD
uv venv .venv --python /usr/bin/python3 --system-site-packages
```

- 新建 venv 后必须跑健康检查，健康检查通过才继续：

```bash
VENV=<REMOTE_WORK_ROOT>/wt-<task>/.venv
$VENV/bin/python -c "
import vllm; print('vllm:', vllm.__version__)
from vllm.v1.core.sched.scheduler import Scheduler
print('_get_routed_experts:', hasattr(Scheduler, '_get_routed_experts'))
import flashinfer; print('flashinfer:', flashinfer.__version__)
"
```

- **怎么避免**：
  1. 远端命令第一步不是 `ssh ... "pwd"`，而是本地读 `local/remote.md`；除非文件不存在，才问用户远端布局。
  2. `<REMOTE_WORK_ROOT>` 是稳定目录；每次远端验证默认在 `<REMOTE_WORK_ROOT>` 下新建本次专用 worktree 和 `.venv`，不要复用可能被删除的旧路径。
  3. 读完必须在执行记录里显式带上三个值：远端 worktree、venv 路径、代码同步分支。
  4. 节点 B 同步代码只走 git：本地 commit + push fork branch，远端 `git fetch` + `git checkout -B <branch> FETCH_HEAD`；禁 `scp` / `git diff | ssh apply`。
  5. venv 健康检查通过前，不跑 pytest / server / smoke；默认 `python` 不存在或系统 python 不相关都不能作为结论。
  6. Windows PowerShell 不能用 Bash 风格 `cmd1 && cmd2`；本地 git 操作分开跑，或用 PowerShell 的语法显式判断 `$LASTEXITCODE`。
