---
name: conclusion-discipline-cases-2
description: "下结论纪律第 2 部分：规则 6（有 fix 指令且修改点已定就直接动手，禁 detour 读 sibling）、规则 7（抢答 ≠ 下结论，S-N=6 改口 4 次）、规则 8（自评成果要 reference 比对 + 重读自己的警告 + 主动列失败模式，2026-05-15 FP8 Marlin t2i 糊图案例）、跟 codex 的四阶段对比表与 Hard rule、PR #3444 incident 链接、规则到 P1 / P2 / P3 的派生关系"
metadata:
  scope: 只收规则 6–8 及页尾的 codex 对比、incident 链接和派生关系；规则 1–5 归 conclusion-discipline-cases-1
---
# 下结论的纪律（流程化清单）（2/2）

## 关键事实

- 拆分说明：本页是源页 `conclusion-discipline-cases.md` 的第 2/2 部分；第 1 部分 [[conclusion-discipline-cases-1]]
- 源页：`knowledge/repos/vllm-omni/debug/guides/conclusion-discipline-cases.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: vllm-omni, debug；created: 2026-07-10；updated: 2026-07-10

### 规则 6 — 有 fix 指令 + 修改点 identified → 直接动手禁 detour

- **触发器**：
  - 用户给了具体 fix 指令（"修这个"、"去服务器跑"、"加 yaml"）
  - 上下文已交代清楚（前文已 trace 过 / 已确定修改文件 / 已确定行号）
  - 修改点 identified（知道改哪个函数 / 哪个 yaml field）
- **强制**：直接 edit + commit + push + 跑测试；这里的“直接”是禁止 detour 和重复背景调查，不是跳过 `CLAUDE.md` 的强门禁。若改动触及代码品味、算法/upstream、PR 公开证据、远端/benchmark 等 gate，仍先满足对应 gate。

---

### 规则 7（meta）— 抢答 ≠ 下结论

- **触发器**：准备说 "X 是 A" / "X 没问题" / "我觉得 X" 这种确定语
- **强制**：替换成 "我看到 X，**可能 A 也可能 B**，先验证 A" + 给出验证步骤（grep 哪个 file / 实测什么命令 / 看哪个 log line）

---

### 规则 8 — 自评成果禁"看起来 OK"：必须有 reference 比对 + 重读自己的警告 + 主动找失败

- **触发器**：跑完优化/改动后审视自己产生的输出（image / log / generated text），当前 framing 处在"验证 X 赢了"
- **强制**：
  1. **Reference 自查**：声明 output OK 前问 "有没有 known-good baseline 比对？"（BF16 baseline / 改动前 / 上游行为）。没有 → **只能说 "no crash"，不能说 "no degradation"**。前缀必须 "推理：单边看了一张" 不是 "实测：对比无差异"
  2. **重读自己的警告**：搜索本会话、指南和错题中已经写过的“X 有风险”或“Y 可能崩”。命中后必须用那个角度重新审视当前输出。
  3. **主动列失败模式**：动手前列 top-3 该 output **如果质量退化会以什么形式表现**（图像：模糊 / artifact / 色偏 / 构图错；文本：重复 / 截断 / 风格漂移 / 事实错；trace：kernel 序错 / 气泡变形 / 资源泄漏）。每条都看一遍，**不是走"特征清单 ✓"**
- 派生：规则 1（invariant=bug detector，token 跳值就是 invariant 违反）+ 规则 6（confirmation seeking 伪装成 due diligence，"看图打勾"= 想确认成功）+ 规则 7（未验证就用确定语）

---

### 跟 codex 对比（外部 reference 模板）

| 阶段 | codex | 我（错） |
|---|---|---|
| 接手会话 | 先核对实际 worktree 代码状态（"当前 C: ar2diffusion 没有 `_truncate_at_cot_end`"）| 假设 D: 镜像就是 PR ground truth |
| 设计 | 明确说 "我不会做 X，因为 Y"（不加 `kv_transfer_criteria` 到 yaml，因为会崩 orchestrator）| 直接加 X，崩了再撤 |
| commit 前 | trace 完语义再落 diff（"positive_reuse_len 故意不复用 `</recaption>` 本身，所以 S-N=1 是健康态"）| 边改边 trace 反复改口 |
| 兜底 | 设计 fallback（"KV reuse 不通过就 fresh prefill，永远不产生坏图"）| 追求 S-N=1 magic number，没 fallback 路径 |

- **Hard rule**：用户暗示 codex 方向对的时候，**先 fetch codex 的 diff，Read 清，再讨论**。不要凭自己理解给一个"等价"或"差不多"的替代方案。

---

### 具体 incident

- PR #3444 S-N=6 → S-N=1 修复全过程：[[2026-05-13-kv-reuse-orchestrator-1]]、[[2026-05-13-kv-reuse-orchestrator-2]]（Hunyuan KV reuse 错题）

### 派生关系

- 规则 1, 3, 5, 7 ← `P1 证据先行`
- 规则 2, 4 ← `P3 完整链路`
- 规则 5, 6 ← `P2 简单直接 / 意图先行`

## 决策与踩坑

### 规则 6 — 有 fix 指令 + 修改点 identified → 直接动手禁 detour

- **禁止**：
  - detour 去 read sibling 实现（"先看 Bagel 是怎么处理的"）
  - detour 去 verify reference（"再确认下 vLLM 上游怎么做"）
  - "先看看再说" / "确认一下 X 怎么做"
  - 任何"先做 background check 再动手"伪装成 due diligence
- **Why**：PR #3444 用户骂完让修 S-N=6 + 修改点已经清楚（orchestrator 加 defer + yaml 加 criteria），我**还去 grep + Read `vllm_omni/model_executor/stage_input_processors/bagel.py`** 看 "Bagel 是不是也走同一 path"。被用户打断 "你都知道问题了直接开不行么，浪费 token"。
- **这是确认偏好（confirmation bias seeking）伪装成 due diligence**：我已经知道答案，去读 sibling 不是为了拿信息，是为了让自己心里更踏实。但每次 Read sibling 文件都在浪费 token + 推迟 fix。

### 规则 7（meta）— 抢答 ≠ 下结论

- **禁止**：未验证就用确定语下结论
- **Why**：PR #3444 S-N=6 解读改口 4 次：
  1. "AR 抖动副作用"
  2. "layout bug 假设"
  3. "stop_token 副作用 harmless"
  4. "AR 跑过头需要 orchestrator deferred forward"
- 每次都是抢答被打脸。

### 规则 8 — 自评成果禁"看起来 OK"：必须有 reference 比对 + 重读自己的警告 + 主动找失败

- **禁止**：
  - 没 reference 写 "无明显劣化 / 无明显退化 / 看起来 OK / 质量保留"
  - 走清单（"主体 ✓ 纹理 ✓ 背景 ✓"）替代根本问题（"这是该模型应有的水平吗"）
  - 自己几小时前的警告不读就下"通过"结论
  - output 里出现明显异常（token 重复 100 次 / 数值跳值 / kernel 序异常）扫一眼当 "正常 padding / 噪声" 略过——任何不能解释的现象都是 bug detector（呼应规则 1）
  - 在"想 claim 赢"的 framing 下被锚定，把 ambiguous 信号默认归"OK"
- **Why**：2026-05-15 FP8 Marlin t2i 小狗 run：
  - 09:xx 我自己写过 "online quant + MoE 对图像生成质量没保护，i2t 文本可能 OK / t2i 图像高风险"
  - 12:09 跑完看图，**没重读那段警告**，说 "无明显劣化 / 主体清晰 / 毛发纹理 OK"
  - AR token 输出 `<img_ratio_16>×32 → <img_ratio_19>×16 → <img_ratio_13>×30` 明显病态我看到了**当成 "末尾 padding 噪声" 略过**
  - 用户秒回 "图像是糊的"，问 "为什么还要我说你才能发现"
  - 失败结构 = confirmation bias × 缺 reference × 不读自己警告 × 走清单替代质疑
