---
name: integration-pr-merge-vehicle-2
description: Integration PR / Merge Vehicle Gate 第 5–9 节：sub-agent 前置只读 review、合入前决策格式、合入后评论并关闭 superseded PR 与 post-merge checkpoint、real-env 证据只阻塞 release claim、反例信号清单
metadata:
  scope: 只收 sub-agent 前置到反例信号的后半段门禁；适用场景、merge vehicle 选择、ready 前审计与修复准入归 integration-pr-merge-vehicle-1，PR body 模板归 pr-body-evidence
---
# Integration PR / Merge Vehicle Gate（2/2）

## 关键事实

- 拆分说明：本页是源页 `integration-pr-merge-vehicle.md` 的第 2/2 部分；第 1 部分 [[integration-pr-merge-vehicle-1]]
- 源页：`knowledge/repos/vllm-omni/git/guides/integration-pr-merge-vehicle.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: vllm-omni, git；created: 2026-07-10；updated: 2026-07-10

### 5. Sub-agent 前置

- Integration PR ready / merge 前至少做三类只读 review：
  - Code review：找行为 bug、race、harness 假阳性 / 假阴性。
  - Merge-readiness review：判断该合哪个 PR、按什么顺序合、哪些 PR superseded。
  - Evidence/docs review：查 PR body、docs、manifest、CI 口径是否过 claim 或 stale。
- 规则：
  - sub-agent 只读，不改 PR body/comment、commit、push、merge。
  - 不把 sub-agent `OK` 当证据；主 agent 必须复核其 source、diff、CI 和 PR 状态。
  - merge-readiness review 应在 ready/merge 前做，不要等状态已经改完才补救。

### 6. 合入前决策格式

- 合入前给用户或自己写最短决策：

```text
Decision: merge now / merge after X / do not merge yet
Vehicle: #<PR>
Why this vehicle: <stacked base / integration-only fixes / CI / evidence>
Blockers: none / list
Not release claim because: <missing real env / post-merge rerun / target branch evidence>
After merge: <close superseded PRs / rerun commands>
```

- 没有这个决策，不 merge。

### 7. 合入后动作

- Integration PR merge 后立刻：
  1. Comment on superseded narrow PRs: `Superseded by #<integration PR>, merged into <target branch>.`
  2. Close superseded PRs.
  3. Check open PR list is empty or only expected PRs remain.
  4. Run post-merge checkpoint on target branch before release claim.
- 最低 post-merge checkpoint 按项目实际脚本选择；不能用 PR-head green 替代 target branch green。

### 8. Real-env Evidence 边界

- 缺真实 env 的 provider / LLM / TTS / GPU harness 可以不阻塞 merge，但必须阻塞 release claim。
- PR body 和 docs 必须写清：
  - fake/local harness 覆盖了什么；
  - real-env harness 未跑的 env 名称；
  - 何时才能 claim release complete。

## 决策与踩坑

### 9. 反例信号

- 看到这些信号，立即停下来重做 merge-vehicle audit：
  - “这个 PR 先 draft，现在 ready，但 body 还说 draft。”
  - “CodeRabbit success，但评论说 rate limit / skipped。”
  - “窄 PR 和 integration PR 都准备合。”
  - “合入前又顺手修一个状态机一致性。”
  - “sub-agent 是 merge 前最后一分钟才开的。”
  - “合完了但没关闭 superseded PR。”
  - “PR head 绿，所以说 main/release 也完成。”
