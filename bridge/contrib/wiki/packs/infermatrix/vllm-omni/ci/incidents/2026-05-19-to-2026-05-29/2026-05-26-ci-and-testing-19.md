---
name: 2026-05-26-ci-and-testing-19
description: "2026-05-26 CI 错题 inc-2026-05-26-ci-and-testing-19，PR #3474 GO-1-Air 的 load_state_dict 0 missing 与 shape smoke 全过，却藏着 sin/cos 顺序、SiLU vs GELU、token order、scheduler、pad_id == eos_id mask 等语义错配，及规则化的四条要求"
metadata:
  scope: "只收 2026-05-26 PR #3474 GO-1-Air 用 shape-clean smoke 当 correctness 证据的错题、四条根因和新模型 PR 的 semantic parity 规则化要求；CI 错题总表见 ci-incidents-overview"
---
# 2026-05-26 — PR #3474 GO-1-Air：shape-clean smoke 掩盖新模型语义错配

## 关键事实

- 源页：`knowledge/repos/vllm-omni/ci/incidents/2026-05-26-ci-and-testing-19.md`（InferMatrixCopilot@ecfb84d0）；源页无 frontmatter

## 决策与踩坑

- 编号：`inc-2026-05-26-ci-and-testing-19`
- 归属：`repos/vllm-omni/ci`
- 状态：已验证
- 搜索词：PR #3474 GO-1-Air：shape-clean smoke 掩盖新模型语义错配
- 影响范围：repos/vllm-omni/ci
- **症状**：PR 做了 GO-1-Air 相关重构后，`load_state_dict` 能做到 `0 missing / 0 unexpected`，stub smoke 能跑，输出 shape 和 NaN/Inf 检查都过。
  - 但按 module owner + omni project owner 视角复审时，发现多处 shape-compatible semantic bugs：timestep embedding `sin,cos` vs upstream `cos,sin`，MLP activation `SiLU` vs tanh GELU，joint token order 不一致，手写 scheduler 没对齐 DPM-Solver，`pad_id == eos_id` 时 attention mask 错杀 EOS，
  - real checkpoint tokenizer 缺失被 stub 路径掩盖。
- **根因**：
  1. 把 weight-load clean / shape smoke 当成 correctness 证据，忘了它们只能证明 plumbing。
  2. 没把 upstream semantic parity 当成新模型接入的 hard gate；scheduler、embedding order、activation、token order 这些都是 algorithm surface。
  3. review sub-agent framing 太泛，没指定 module owner 与 project owner 两个角色，导致初审容易停在“看起来结构 OK”。
  4. PR body 没强制区分 source inference、stub smoke、real checkpoint validation，证据等级混在一起。
- **规则化**：
  - 新模型 PR 必填 semantic parity matrix：scheduler / denoising loop、embedding `cos/sin` 顺序、activation、token order、special token + pad/eos attention mask、preprocess、noise/action contract。
  - tokenizer / processor / strict load / config 缺失必须 fail fast；禁止 silent fallback 到 zero-action / stub。
  - stub smoke、real checkpoint、official e2e 三类证据在 PR body 分开写，并标 allowed conclusion。
  - 第一次 push / PR 创建前必须用双 owner framing 跑 reviewer-lens audit：module owner 查 upstream parity，omni project owner 查文件归属、API 面、测试与 PR evidence；reviewer 提醒后再补跑只能算补救，不算合格首轮自审。
