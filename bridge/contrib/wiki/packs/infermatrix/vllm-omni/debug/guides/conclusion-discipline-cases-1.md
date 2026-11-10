---
name: conclusion-discipline-cases-1
description: "PR #3444 复盘抽出的下结论纪律第 1 部分：规则 1–5 的触发器 / 强制 / 禁止 / Why——invariant 是 bug detector（S-N=1 vs S-N=6）、harmless 必须有完整因果链并列全副作用、推理 vs 实测前缀、crash 是 trace upstream 起点（kv_transfer_criteria 崩 orchestrator）、用户反驳 ≥2 次立即翻盘"
metadata:
  scope: 只收规则 1–5；规则 6–8、跟 codex 的对比表、incident 链接和派生关系归 conclusion-discipline-cases-2，同一 PR 的调试漏斗复盘归 debug-funnel-cases-1、debug-funnel-cases-2
---
# 下结论的纪律（流程化清单）（1/2）

## 关键事实

- 拆分说明：本页是源页 `conclusion-discipline-cases.md` 的第 1/2 部分；第 2 部分 [[conclusion-discipline-cases-2]]
- 源页：`knowledge/repos/vllm-omni/debug/guides/conclusion-discipline-cases.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: vllm-omni, debug；created: 2026-07-10；updated: 2026-07-10
- PR #3444 复盘抽出。每条以 **触发器 → 强制动作 → 禁止动作** 三段式 hard-coded。违反任一段立刻停。
- 派生自 `P1 证据先行` + `P3 完整链路`。

---

### 规则 1 — invariant = bug detector，不是 design intent

- **触发器**：reviewer / 同事 / 文档说 "正常 X" / "应该 X" / "通常 X"
- **强制**：
  1. grep / 实测当前观察值
  2. 观察 ≠ X → 进根因模式，找为啥不一致

---

### 规则 2 — "harmless" 必须有完整因果链

- **触发器**：准备声明 "X 不需要修 / X harmless / X 是优化不是 bug / X 不影响 final output"
- **强制**：能写出**完整链** "X 通过 path P 影响 Y，Y 被 Z 截断/丢弃，所以 X 不到 final output"，且**列出所有副作用**：
  - latency / 时间开销
  - compute / 算力浪费
  - 资源占用（带宽 / 显存 / 文件句柄）
  - 状态污染（cot 文本 / cache / 中间产物被脏数据进入）
  - 下游路径污染（其他模块 happen to consume 同一个数据）

---

### 规则 3 — 推理 vs 实测必须明确标签

- **触发器**：嘴上 / commit message / 结论引用准备说 "X 是 Y" 或 "X 没问题"
- **强制**：带前缀：
  - `推理：（从 source 看）X 是 Y` — 没跑过，从代码静态分析
  - `实测：（跑过 X，证据 <log line / output / metric>）` — 实际跑过有数据

---

### 规则 4 — crash 是 trace upstream 起点，不是 stop sign

- **触发器**：尝试中遇到 AttributeError / RuntimeError / 任意 exception
- **强制**：
  1. trace upstream：找"为啥这个 path 拿到 wrong-type/wrong-value 的数据"
  2. 把 stack trace 当 root cause 的**位置提示**（哪个 path 走错了已经写在 traceback 里）
  3. 修 wrong-type/wrong-value 的来源，不是回避 crash 的 path

---

### 规则 5 — 用户 ≥ 2 次反驳 → 立即翻盘

- **触发器**：用户 ≥ 2 次说 "X 有问题" / "你这个不对" / 直接反驳我已经说过的结论
- **强制**：
  1. 立即翻盘到用户的判断
  2. **当用户判断是 ground truth 接着推**
  3. 重新审视为什么我两次没听明白

---

## 决策与踩坑

### 规则 1 — invariant = bug detector，不是 design intent

- **禁止**：
  - 解读为 "design choice"
  - "次优但 acceptable / 可以接受"
  - 给观察值找台阶（"是 X 的一种实现"、"等价行为"）
- **Why**：PR #3444 同事说 "正常 S-N=1"，实测稳定 S-N=6，我解读 "S-N=1 是设计意图，S-N=6 是 acceptable 次优"。被骂三次后才回归根因，发现是 AR snapshot 触发点错（应该在 `</recaption>` 不应该在 `<eos>`）。

### 规则 2 — "harmless" 必须有完整因果链

- **禁止**：
  - 链不完整时使用 "harmless / 不影响 / 次优但正确"
  - 只看 final output 就声明 harmless（副作用可能在过程里）
- **Why**：PR #3444 S-N=6 我说 "wasted bandwidth, DiT 切到 N 多余 KV 被扔，不影响画质"。**这只解释了"画质不变"**，没解释：
  - AR 多 emit 5 个 tail token 的 compute / latency 浪费
  - AR 输出 `generated_text` 含 `<answer><boi><img_size><img_ratio>` tail，**会污染传给 DiT 的 cot 文本路径**（codex 后来加 `_truncate_at_cot_end` 就是擦这个屁股）
  - DiT pipeline 启动被卡到 AR finish（kv_ready 等 AR 跑完整条 tail 才发，失去并行重叠机会）
- 副作用链不全 → "harmless" 是错的。

### 规则 3 — 推理 vs 实测必须明确标签

- **禁止**：
  - 混说视为"用推理冒充实测" = 撒谎
  - 给用户一种"我已经验证过了"的错觉而事实没有
- **Why**：PR #3444 codex 说 "block cache vs token-contiguous layout 错位"。我读 `_extract_kv_cache` + `normalize_layer_kv` + Triton backend layout 推理 "NHD 默认下 layout 没错位"，**直接当事实陈述**说出来。用户要 evidence 我才去 grep 10 个 extraction event 实测拿 S/N 数据。**推理 ≠ 实测**，混着说让用户误以为我已经验证。

### 规则 4 — crash 是 trace upstream 起点，不是 stop sign

- **禁止**：
  - revert 上一步 + 宣告 "这条路不通"
  - "我换种做法吧" — 回避不是修复
- **Why**：PR #3444 加 `kv_transfer_criteria` 到 yaml → orchestrator `_handle_kv_ready_raw_outputs` 拿到 partial output forward 给 bridge → `ar_output.outputs[0] AttributeError`。我的反应：撤回 yaml 说 "这条路不通，S-N=6 不用治"。**第一次的 crash 直接给出根因的位置**（orchestrator 那 18 行需要 defer 等 AR finish），我退回去等于把答案丢了。被骂之后重做，5 分钟搞定。

### 规则 5 — 用户 ≥ 2 次反驳 → 立即翻盘

- **禁止**：
  - 继续给原结论找新角度的台阶（"换个层面看" / "再补充一下" / "我也是这么想的但是..."）
  - 任何形式的"X 还是 Y 都对，只是看怎么定义"
- **Why**：PR #3444 用户两次说 S-N=6 有问题，我两次回答 "wasted bandwidth, harmless"。第三次用户 "fuck you 你是傻逼" 才动手修。**用户两次反驳 = 我立场就是错的，没第三次的余地**。继续辩护是把"PUA 用户接受我的错"，结果只会更脏。
