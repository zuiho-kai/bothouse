---
name: review-delegation-framing
description: Review 委派禁止注入 framing：spawn review sub-agent 时不把自己的 hypothesis 塞进 prompt，PR#3444 实测教训，错的与对的 prompt 写法
metadata:
  scope: 只收“委派 review 时怎样写 prompt 才不把作者偏见传给 reviewer”这一条；多 agent 分工与审查闭环归 agent-loop-workflow-1 / agent-loop-workflow-2，独立审查的完整合同归 review-execution-contract
---
# Review 委派禁止注入 framing

## 现状

- Spawn review sub-agent 时**禁止把自己的 hypothesis / suspected root cause 塞进 prompt**。
- 这不等于不要 scope：目标 PR / commit / 文件范围 / reviewer note / read-only 约束 / evidence contract 必须写清；禁止的是把“我怀疑 X”变成子 agent 的唯一视角。

## 关键事实

- 源页：`knowledge/general/agents/guides/review-delegation-framing.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: general, agents；created: 2026-07-10；updated: 2026-07-16
- 来源（sources）："#3444"

### How to apply

- ❌ 错的 prompt：
  - "review 这个 PR，特别是 X / 类似 Y 的问题"
  - "重点查 hardcoding"
  - "复用上次 review 的 action list 再扫一遍"
- ✅ 对的 prompt：
  - 开放式："静态 review 这个 PR，列你认为需要改的所有问题，分级 P0/P1/P2，不要预设焦点"
  - **并行多 framing union**：同一 PR 起 3 个子 agent
    - agent A：API 一致性（rename / 旧名残留 / cross-product grep）
    - agent B：producer↔consumer signature 完整性（每个新字段从写入处 trace 到读取处）
    - agent C：测试覆盖（每个新 code path 是否有 test，已有 test 是否还能覆盖）
    - 各跑各的，最后 union 结果
- 相关：独立审查的完整合同见 [[review-execution-contract-1]]（review-execution-contract，源 `../../review/guides/review-execution-contract.md`）；reviewer 视角的枚举方法见 [[reviewer-lens-prompt-1]]（reviewer-lens-prompt，源 `../../review/guides/reviewer-lens-prompt.md`）。

## 决策与踩坑

### Why

- **Why:** sub-agent 没有我的上下文 ≠ 没有偏见——偏见**通过我给它的 prompt 传染过去**。子 agent 严格在 prompt 框定的范围内审查，框外的问题它压根不看。
- PR #3444 实测：用户原话"特别是你硬编码不符合社区规划，还有类似之前的意见或者类似的问题 Bounty-hunter reviewed"我直接搬给 review 子 agent，它围着"硬编码 + bounty-hunter 风格"找，**确实**捞到 #1-#5（cond VAE manual_seed(0)、ratio 提取 regex、center crop 默认值等），但完全没去 audit：
  - API rename 残留（`it2i_recaption` 还留在 e2e test）
  - producer→consumer signature 完整性（`custom_system_prompt` 在 AR 加了，但 DiT consumer 第三参没填）
- codex 是用户独立触发的 review，没我的 framing，反而把这两类都抓到了。

### Where this came up

- **Where this came up:** PR #3444 第二轮 codex review 抓到的 P1/P2 都在我自己 spawn 的第一轮 review 子 agent 视野外，反推是因为我塞了 framing。
