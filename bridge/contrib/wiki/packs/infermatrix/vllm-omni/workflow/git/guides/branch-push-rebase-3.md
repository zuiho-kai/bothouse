---
name: branch-push-rebase-3
description: "PR Workflow 第 2.1 节：rebase 或 cherry-pick 后不能只验证能编译，须做语义复审 gate（前后 head、fresh semantic diff、reviewer threads、shared path grep）及 HunyuanImage3 image_size / Bagel multi_modal_data img2img 两个高风险模式（PR #3626）"
metadata:
  scope: "只收 rebase 后语义复审的触发条件、gate、验收标准与 PR #3626 事故来源；主仓/worktree 与自动 push 归 branch-push-rebase-1，fork remote 推送与 head branch 名归 branch-push-rebase-2，调试与对齐官方测试归 debugging-and-tests"
---
# PR Workflow · Branch / Push / Rebase（3/3）

## 关键事实

- 拆分说明：本页是源页 `branch-push-rebase.md` 的第 3/3 部分；第 1 部分 [[branch-push-rebase-1]]；第 2 部分 [[branch-push-rebase-2]]
- 源页：`knowledge/repos/vllm-omni/git/guides/branch-push-rebase.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: vllm-omni, git；created: 2026-07-10；updated: 2026-07-16

### 2.1 Rebase 后不能只验证能编译，必须做语义复审

- **触发条件**：
  - PR rebase 到最新 `origin/main`。
  - cherry-pick / conflict resolution / force-with-lease 更新 PR head。
  - rebase 后 reviewer 又在刚改过的行上问 “why revert previous change?” / “will this affect model X?”。
- **不要做**：
  - 不要只跑 `ruff` / `compileall` / `git diff --check` 就 push。
  - 不要把 “Git 自动合并没有冲突” 当成语义正确。
  - 不要用 HunyuanImage3 的局部正确性解释 shared serving path 上的跨模型行为。
- **必须做的 gate**：
  1. 记录 rebase 前后 head：

     ```powershell
     git rev-parse HEAD
     git ls-remote git@github-taffy:TaffyOfficial/vllm-omni.git refs/heads/<pr-branch>
     ```

  2. rebase 后列 commit / 文件范围：

     ```powershell
     $i=1; git log --oneline origin/main..HEAD | ForEach-Object { "{0,2} {1}" -f $i, $_; $i++ }
     git diff --stat origin/main..HEAD
     git diff --name-only origin/main..HEAD
     ```

  3. 对冲突文件和自动合并文件跑 fresh semantic diff：

     ```powershell
     git diff origin/main..HEAD -- <file>
     git show origin/main:<file> | Select-String -Pattern "<anchor>" -Context 5,20
     ```

  4. 读当前 non-outdated reviewer threads，不只看本地 diff：

     ```powershell
     gh pr view <PR> --repo vllm-project/vllm-omni --json headRefOid
     ```

     - 需要 thread state 时用 GitHub reviewThreads / `gh api graphql`，区分 outdated 和 current。
  5. 对 shared serving / multimodal path 改动，必须 grep 所有消费者：

     ```powershell
     rg -n '"img2img"|"image"|"images"|multi_modal_data|mm_processor_kwargs' `
       vllm_omni/model_executor vllm_omni/diffusion vllm_omni/entrypoints tests
     ```

     - 然后写一句结论：每个受影响模型是保留、转换、兼容，还是不适用。
- **两个 high-risk pattern**：
  - **Algorithm 参数被半保留**：HunyuanImage3 explicit size 不是单个 `target_h/w`。`resolve_stop_token_ids(..., image_size="WxH")` 决定 AR 何时 stop；`target_h/w` 决定如果需要 ratio token 时强制哪个 ratio。rebase 时丢任一个都算回退。
  - **Multimodal key 被全局化**：`multi_modal_data["image"]` 对 HunyuanImage3 DiT bridge 是正确 consumer，但 Bagel 依赖 `multi_modal_data["img2img"]` 走 `Img2ImgProcessorItems`。共享 chat path 不能为了一个模型改全局 key；模型专属转换要放在模型 owner 或专用 builder。
- **验收标准**：
  - 当前 PR head、PR body Test Result head、远端 branch head 一致。
  - conflict / auto-merged 文件的 semantic diff 已看过，不只是静态检查。
  - 当前 non-outdated review threads 没有继续指向“为什么 revert / 会不会影响其他模型”的开放风险。
  - shared path 改动有跨模型 grep 证据或测试。

## 决策与踩坑

### 2.1 Rebase 后不能只验证能编译，必须做语义复审

- **事故来源**：2026-06-04 PR #3626 rebase 后，`end2end.py` 丢了主干已有的 `image_size` stop-token contract，只保留 `target_h/w`；`serving_chat.py` 把 shared chat img2img payload 从 `{"img2img": img}` 改成 `{"image": img}`，影响 Bagel parser。
  - 之前几轮 audit 没发现，是因为 framing 只看 HunyuanImage3 infer-align / explicit-size 语义，rebase 后没有把冲突和 auto-merged 文件当 fresh diff 重审。
