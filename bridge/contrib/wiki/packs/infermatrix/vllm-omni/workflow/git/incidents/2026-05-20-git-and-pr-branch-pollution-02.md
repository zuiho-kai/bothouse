---
name: 2026-05-20-git-and-pr-branch-pollution-02
description: 2026-05-20 错题：实现 HunyuanImage3 DiT step-wise grouped batching 时在主仓 D:\vllm-omni\vllm-omni 直接 apply_patch（分支 codex/pr-3626-review-fixes，非 wt-* worktree），及新建 worktree 补救与写文件前 guard
metadata:
  scope: 只收 2026-05-20 违反 worktree 规则在主仓工作区直接写文件这一起事故；PR 描述渲染问题归 2026-05-20-git-and-pr-branch-pollution-04，分支污染归 2026-04-30-git-and-pr-branch-pollution-01
---
# 2026-05-20 — 违反 worktree 规则，在主仓工作区直接 apply_patch

## 关键事实

- 源页：`knowledge/repos/vllm-omni/git/incidents/2026-05-20-git-and-pr-branch-pollution-02.md`（InferMatrixCopilot@ecfb84d0）；源页无 frontmatter

## 决策与踩坑

- 编号：`inc-2026-05-20-git-and-pr-branch-pollution-02`
- 归属：`repos/vllm-omni/git`
- 状态：已验证
- 搜索词：违反 worktree 规则，在主仓工作区直接 apply_patch
- 影响范围：repos/vllm-omni/git
- **症状**：用户要求实现 HunyuanImage3 DiT step-wise grouped batching。我已读 `CLAUDE.md`，但直接在 `D:\vllm-omni\vllm-omni` 执行 `apply_patch`，导致主仓工作区出现业务改动：

```text
 M vllm_omni/diffusion/models/hunyuan_image3/pipeline_hunyuan_image3.py
 M vllm_omni/diffusion/sched/base_scheduler.py
 M vllm_omni/diffusion/sched/interface.py
 M vllm_omni/diffusion/worker/input_batch.py
```

- 当时 git root 是 `D:/vllm-omni/vllm-omni`，分支是 `codex/pr-3626-review-fixes`，不是 `D:\vllm-omni\wt-*` worktree。
- **根因**：
  - 把“代码仓库在 `D:\vllm-omni\vllm-omni`”误执行成“可以在这里写代码”。
  - 开工前只看了 `git status`，没有把 D2/D4 转成写文件前的硬 gate。
  - 在读代码阶段 cwd 留在主仓；进入编辑阶段没有重新确认 git root 是否是 `wt-*`。
- **正确补救**：
  1. 立刻停手，不继续在主仓完成实现。
  2. 记录当前 `git status --short` 和 touched files。
  3. 新建独立 worktree：

     ```powershell
     $repo = "D:\vllm-omni\vllm-omni"
     $wt = "D:\vllm-omni\wt-hunyuanimage3-step-batch"
     git -C $repo worktree add -b codex/hunyuanimage3-step-batch $wt origin/main
     ```

  4. 把主仓里属于本次事故的 diff 迁移到 worktree 后，只撤回主仓中自己刚造成的这些文件改动。
  5. 之后所有实现、测试、commit 都只在 `wt-hunyuanimage3-step-batch` 内进行。
- **怎么避免**：
  1. vllm-omni 业务代码任务里，`apply_patch` 前必须跑：

     ```powershell
     $root = git rev-parse --show-toplevel
     Split-Path $root -Leaf
     git status --short --branch
     ```

  2. `Split-Path $root -Leaf` 不是 `wt-*` 就禁止写文件；先 `git worktree add`。
  3. 读代码可以在主仓；从“读”切到“改”的瞬间必须重新执行 guard。
  4. 如果用户贴了 `<cwd>D:\vllm-omni\workflow-starter</cwd>` 或当前 shell 位于主仓/非 worktree，不能凭上下文假设目标 worktree 已存在，必须显式创建或切换。

---
