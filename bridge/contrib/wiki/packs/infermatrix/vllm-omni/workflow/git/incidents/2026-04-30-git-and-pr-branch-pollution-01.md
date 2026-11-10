---
name: 2026-04-30-git-and-pr-branch-pollution-01
description: "2026-04-30 错题：feature/hunyuan-t2t-sdpa-fa 上 PR #3243 显示 96 files diff 而真改动仅 4 个文件，因夹带 6 个 GEBench CI commit；cherry-pick 重建分支后 10 个 commit hash 失效，及 PR description hash 引用与多 worktree 状态确认两条同期教训"
metadata:
  scope: 只收 2026-04-30 分支污染与 cherry-pick 后 hash 失效这一起事故及同期两条教训；PR 描述没按模板写归 2026-05-19-git-and-pr-branch-pollution-03，主仓写文件违反 worktree 规则归 2026-05-20-git-and-pr-branch-pollution-02
---
# 2026-04-30 — feature/hunyuan-t2t-sdpa-fa 分支污染 + cherry-pick 后 hash 失效

## 关键事实

- 源页：`knowledge/repos/vllm-omni/git/incidents/2026-04-30-git-and-pr-branch-pollution-01.md`（InferMatrixCopilot@ecfb84d0）；源页无 frontmatter

## 决策与踩坑

- 编号：`inc-2026-04-30-git-and-pr-branch-pollution-01`
- 归属：`repos/vllm-omni/git`
- 状态：已验证
- 搜索词：feature/hunyuan-t2t-sdpa-fa 分支污染 + cherry-pick 后 hash 失效
- 影响范围：repos/vllm-omni/git

### 原文件说明

### Error Book: Git / PR 分支管理

- **症状**：
  - 分支 `feature/hunyuan-t2t-sdpa-fa` 上 PR #3243 显示 96 files / 1287+1431 lines diff
  - 实际真改动只有 4 个 hunyuan_image3 文件 / 449+24 lines
  - 用户开始 review 时一句"分支好像受到我其他分支污染"才发现问题
- **根因**：分支夹带了 6 个不属于本 PR 的 commit：
  - `3e392b2` [CI] add GEBench T2I accuracy test to nightly pipeline
  - `caa159c` [CI] use full_model run-level
  - `497a01f` [CI] add --gebench-t2i-only flag
  - `b01f469` [CI] fix summarize fallback for t2i-only mode
  - `44871a0` Address HunyuanImage GEBench review comments
  - `2719abca` Merge remote-tracking branch 'origin/main' into feature/hunyuan-t2t-sdpa-fa
- 这些来自 `feat/hunyuan-image3-accuracy-ci` 分支（GEBench CI 工作），通过 merge 拉进来时连带一起进了本 PR 范围。**多分支并行工作时**这种污染常发生：从 origin/main rebase / merge 时，如果其他分支已经 merge 进 main，那些 commit 又会跟新写的 commit 一起 push 到本 PR 分支。
- **解法**：

```bash
# 从 origin/main 起新分支，只 cherry-pick 真正属于 PR 的 10 个 commit
git checkout -b feature/hunyuan-image3-ar-alignment origin/main
for h in 42ee44b6 80617a1d 88d16caa 80e0237f 42c2f349 0a63ab5e a7a5ab3f 80cbaa3f 0413c2c2 40ac16cc; do
    git cherry-pick "$h" || break
done
# 验证 diff stat 干净
git diff --stat origin/main..HEAD   # 应该只动 4 个 PR 范围内的文件
# Force-push 到 PR 分支
git push fork feature/hunyuan-image3-ar-alignment:feature/hunyuan-t2t-sdpa-fa --force-with-lease
git push zuiho-kai feature/hunyuan-image3-ar-alignment:feature/hunyuan-t2t-sdpa-fa --force-with-lease
```

- cherry-pick 后所有 commit hash 变了：

| 旧 hash | 新 hash | 主题 |
|---|---|---|
| `42ee44b6` | `d71981e7` | Siglip2 list compat |
| `80617a1d` | `d360569a` | T2T instruct format |
| `88d16caa` | `27083f9c` | Unify chat template |
| `80e0237f` | `ea809348` | Assistant: prefix |
| `42c2f349` | `7bd429ed` | build_prompt_tokens |
| `0a63ab5e` | `3d415e17` | docs: timestep |
| `a7a5ab3f` | `8a1a4af9` | docs: image preprocessing |
| `80cbaa3f` | `41d29432` | VAE pixel cast |
| `0413c2c2` | `31c2fa56` | fp32 MoE router |
| `40ac16cc` | `07d8cf0d` | stop at </think> |

- **对未来的提醒**：
  1. **开 PR 前必查**：`git log --oneline origin/main..HEAD | nl` —— 逐条 commit 主题确认全属于本 PR
  2. **diff stat 检查**：`git diff --stat origin/main..HEAD` —— 改的文件应该跟 PR 主题强相关，无关文件超过 1-2 个就要查
  3. **避免 merge from origin/main**：要同步上游用 rebase 不用 merge（merge commit 会把上游所有合并的 PR 都"拉进"本分支的 log）
  4. **cherry-pick 后必更新 PR description 里的 hash 引用**——old hash 在新分支上不存在，链接会失效
  5. **多 worktree 工作时分清 base**：每个 worktree 起 branch 时明确 `git checkout -b xxx origin/main`，不要从当前 HEAD 起新分支

---

### 同期教训：PR description 里 hash 引用 cherry-pick 后失效

- **症状**：cherry-pick 之前我的 PR description 里 commit table 用了旧 hash（`42ee44b6`...），cherry-pick 后 hash 变成（`d71981e7`...），用户打开 PR description 看到 hash 全对不上 GitHub 上的实际 commit。
- **对未来的提醒**：
  - 写 PR description 引用 commit 时**避免**只用裸 hash；用 `<hash> + 一句话主题`，hash 失效时主题还能查
  - cherry-pick / rebase / amend 后**必须**重新跑一遍 `git log --oneline origin/main..HEAD` 跟 description 比对
  - 终极方案：写完 description 跑 sed 一遍把 hash 替换成最新值，再贴

---

### 同期教训：多分支并行工作时 worktree 状态确认

- 本次本地有 N 个 worktree（看 `git branch -a` 一堆 `bounty-hunter/*`、`feat/*`），任何一个 worktree 误操作都可能影响 PR 分支。
- **规则**：
  - 每个 worktree 进去后第一件事：`git status -s` + `git branch --show-current` + `git log --oneline -3` 三连，确认在对的分支 + 干净状态
  - 长会话中跨 worktree 切换时同样三连
  - worktree 名字遵循 `wt-<purpose>` 约定（CLAUDE.md 22 条规则之一）便于识别

---
