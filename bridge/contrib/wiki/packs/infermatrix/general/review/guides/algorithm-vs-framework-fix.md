---
name: algorithm-vs-framework-fix
description: Framework hack vs algorithm fix：观察到 framework 层少一个机制时先问 algorithm 层能否不产生该状态，再考虑加 framework 机制（PR 3444 KV reuse 复盘）
metadata:
  scope: 只收“framework 补丁还是 algorithm 修复”的决策顺序、信号识别、PR 3444 KV reuse 实测与反模式；查 upstream 的做法归 upstream-first-for-algorithm
---
# Framework hack vs algorithm fix

## 现状

- PR #3444 KV reuse S-N=6 复盘抽出。
- 两套描述 fit 同一现象时（"AR 跑过头 KV 包括 5 个 tail token" 既能从 algorithm 层解释也能从 framework 层"补 cap 机制"打补丁），**我两次选了 framework hack 路线**，每次都被 reviewer 拉回 algorithm 路线。
- 派生自 `P3 完整链路而非单点`。

## 关键事实

- 源页：`knowledge/general/review/guides/algorithm-vs-framework-fix.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: general, review；created: 2026-07-10；updated: 2026-07-10；sources: 无

### 规则

- **触发器**：观察到 framework 层"少一个机制"（KV cap 缺、orchestrator 没 defer、yaml 没 stop_token_ids 覆盖、middleware 没 cleanup hook ...）
- **强制（决策顺序）**：
  1. **先问 algorithm 层**：是不是上层在产生不该有的状态？让上层别产生 → framework 自然不用补
  2. 才考虑 framework 加机制：上层确实需要这个状态，framework 缺一个合理 API
- **禁止**：
  - 跳过 step 1 直接加 framework 机制
  - "algorithm 层 owner 在另一个团队，framework 这边补一下" → 跨团队不是借口；同一 PR scope 内能改 algorithm 就改
  - 多个 framework hack 串起来兜底一个 algorithm 错（symptom：3 个独立的 hack 都"必须放在一起才 work"——这是 cargo cult 复合）

### 信号识别

- **framework hack 在补 algorithm 错的特征**：

| 信号 | 解释 |
|---|---|
| hack 的注释里出现 "为了应付 X 这种特殊情况" | X 是 algorithm 层故意 / 意外的产物 |
| hack 触发条件复杂（`if A and not B and stage_id != C`）| 在精确匹配 algorithm 层错误产生的 narrow state |
| hack 之间互相依赖（hack1 在 deploy yaml，hack2 在 orchestrator，hack3 在 bridge）| 没有上层 algorithm 改动能一处吃掉 |
| 加 hack 后还要加 "extra check" 防 hack 本身崩 | hack 制造了新失败模式 |

### How to apply

- **调试时遇到"framework 少机制"的判断分支**：

```
现象 = framework 层补丁 OR algorithm 层 fix
    ↓
先问：algorithm 层能不能不产生这个状态？
    ├─ 能 → 改 algorithm（一处吃掉）
    └─ 不能 → 加 framework 机制
       ↓
       这时再问：upstream 怎么处理的？（接 [upstream_first_for_algorithm](upstream-first-for-algorithm.md)）
```

- 上面判断分支里的 upstream_first_for_algorithm 即 [[upstream-first-for-algorithm]]。
- **review / 写完 patch 后自检**：
  - 我这个 patch 在补什么状态？这个状态是不是上游故意/意外产生的？
  - 上游能不能不产生这个状态？
  - 如果能：先 revert framework patch，去 fix algorithm
  - 跟 [[conclusion-discipline]]（conclusion_discipline）规则 2 联动："harmless 必须有完整因果链" — algorithm 错没修，framework hack 的副作用因果链通常不完整

### 链接

- PR #3444 KV reuse review iteration：Hunyuan KV reuse 错题（源链接 `../../../repos/vllm-omni/models/hunyuan-image3/incidents/2026-05-13-kv-reuse-orchestrator.md`）
- 相邻：[[conclusion-discipline]]（conclusion_discipline）规则 2（harmless 因果链）
- 相邻：[[upstream-first-for-algorithm]]（upstream_first_for_algorithm）（去查 upstream 怎么做 algorithm 决策）
- 派生硬规则：CLAUDE.md B31

## 决策与踩坑

### Why（PR #3444 KV reuse 实测）

- **症状**：AR ship KV to EOS，S-N=6 不是 1（DiT 切到 N，多 5 token KV 被扔），而且 kv_ready 在 AR mid-decode 就 fire → bridge `ar_output.outputs[0]` crash。
- **我的方案（framework hack 三件套）**：
  1. `deploy/hunyuan_image3.yaml`: 加 `kv_transfer_criteria: special_token, token_id=128019(</recaption>), stop_after_transfer=false` 强制 KV snapshot 触发点
  2. `orchestrator._handle_kv_ready_raw_outputs`: 加 `finished_in_batch` defer，等 AR finish 才 forward partial output
  3. `prompt_utils.resolve_stop_token_ids`: stop 改 `<|endoftext|>` 让 AR 走完 forced tail（这个其实是 algorithm 改，但方向错）
- 三件套互相依赖：
  - yaml `stop_after_transfer=false` → AR 跑过 snapshot 点 → 产生 mid-decode kv_ready → orchestrator defer 兜底
  - orchestrator defer 等 AR finish → AR stop token 设到 `<eos>` 才能 finish → prompt_utils 改 stop
  - 任何一个单独抽掉都不 work
- **reviewer 指 upstream 后揭示 algorithm 路线**：AR stop 直接设到 ratio token range，
  - AR 自然停在 `<img_ratio_X>` → S-N=1（KV 自然 cap）
  - 自然 finish → 没有 mid-decode kv_ready → orchestrator 不用 defer
  - 不需要 `kv_transfer_criteria` 这种 framework 机制
  - yaml 改一行 → 三件套全消
- **净结果**：删 yaml block 20 行 + 删 orchestrator defer 14 行 + 改 stop algorithm 30 行。一处 algorithm fix 吃掉三处 framework hack。

### 反模式

- "我先把 framework 兜住，algorithm 后面再优化" → "后面"永远不会发生
- "yaml 加个配置就能 fix，最小改动" → 改 yaml 看起来小，但 yaml 配置背后的 framework 路径是不是真的为这个场景设计的？
- "上游也有这个机制" → 检查上游是不是真的用它（很多 framework feature 是 dead code）
