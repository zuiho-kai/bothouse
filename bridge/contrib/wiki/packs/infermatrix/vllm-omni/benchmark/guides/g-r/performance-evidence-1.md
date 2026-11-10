---
name: performance-evidence-1
description: 性能与精度证据第 1 部分：official e2e 结论不能用 smoke 数据代替——触发条件、强制流程、Evidence Matrix 模板（E1 function smoke / E2 official accuracy / E3 official perf）与每行必填项、PR Test Plan 与 Test Result 规范、五条硬规则（单变量对比、图片证据匹配结论、来源错了必须重跑）
metadata:
  scope: 只收 Evidence Matrix 的定义和 PR Test Plan / Test Result 的写法；仪表盘 metric 的证据边界、2026-05-21 grouped batching 反例和 benchmark 程序自身验收归 performance-evidence-2，旧 artifact 是否可复用归 evidence-gate
---
# 性能与精度证据（1/2）

## 关键事实

- 拆分说明：本页是源页 `performance-evidence.md` 的第 1/2 部分；第 2 部分 [[performance-evidence-2]]
- 源页：`knowledge/repos/vllm-omni/benchmark/guides/performance-evidence.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: vllm-omni, benchmark；created: 2026-07-10；updated: 2026-07-20
- 来源（sources）：PR #5052；Issue #5811；PR #6150

### 4. 性能 / 精度验证必须先定义口径：official e2e 结论不能用 smoke 数据代替

- **触发条件**：
  - 用户要求“跑精度测试 / 性能收益 / 和官方输入一样 / 贴输出图”。
  - 一个功能有多条可运行路径，例如 DiT-only、AR-to-DiT、单请求 accuracy、双请求 grouped batch。
  - 想把临时脚本结果写进 PR / issue / final answer。
- **强制流程**：
  1. 先填 Evidence Matrix，再跑或汇报结果。
  2. 跑完后把每行的 result / artifact / metric 补齐。
  3. PR / issue / final answer 只能引用矩阵里 `allowed conclusion` 覆盖得到的结论。
  4. 没有矩阵的性能 / 精度 / 图片结果，不能进入 PR 主结论。
- **Evidence Matrix 模板**：

```markdown
| ID | Purpose | Input Source | Path | Requests | Batch Knobs | Timing Scope | Metrics / Artifacts | Allowed Conclusion |
| --- | --- | --- | --- | ---: | --- | --- | --- | --- |
| E1 | function smoke | temporary prompt | DiT-only | 2 | max_num_seqs=2, diffusion_batch_size=2 | N/A | logs only | variable prompt lengths can be grouped |
| E2 | official accuracy | official fixture | AR-to-DiT | 1 | DiT max_num_seqs=2 | N/A | CLIP/SSIM/PSNR + image | step-wise path preserves official accuracy |
| E3 | official perf | official fixture | AR-to-DiT | 2 | baseline 1/1 vs grouped 2/2 | omni.generate only, model init excluded | elapsed / throughput / GPU stats | official two-request e2e speedup |
```

- 每行必须包含：
  - purpose：功能 smoke / official accuracy / full e2e / performance comparison。
  - input source：官方 fixture、用户指定输入，还是临时 prompt。
  - path：DiT-only / AR-to-DiT / request-mode / step-wise。
  - request count：单请求、双请求、多请求。
  - batch knobs：`max_num_seqs`、`diffusion_batch_size`、stage batch size。
  - timing scope：是否排除模型初始化。
  - metrics / artifacts：指标、图片、日志证据在哪里。
  - allowed conclusion：这条结果最多能证明什么。
- **PR Test Plan 规范**：
  - Test Plan 必须按 Evidence Matrix 的 ID 拆小节。
  - Test Result 必须沿用同一组 ID，避免结果和计划错位。
  - Smoke 的图片默认不贴；除非用户明确要看 smoke 输出。
  - Performance table 只能出现在 official / user-specified input 的 performance row 下。
- **PR Test Result 规范**：
  - 表格标题必须带输入口径，例如 `Official IT2I performance comparison`，不要只写 `Performance`。
  - 精度表必须写 reference，例如 `against tests/assets/hunyuan/hunyuan_image_ref.png`。
  - 速度表必须写 `model initialization excluded/included`。
  - 如果同一 PR 同时有 smoke 和 official e2e，smoke 放在最后，且标题写 `Compatibility smoke`。
- **硬规则**：
  1. 先写测试矩阵，再跑或汇报结果。
  2. official accuracy / official performance 只能用官方 fixture 或用户指定输入。临时 prompt 只能标为 smoke。
  3. 性能对比必须单变量：
     - baseline 与 grouped 使用同一输入、同一请求数、同一 seed / steps / guidance / AR 配置。
     - 只改变目标 batching knobs。
     - elapsed 的计时范围一致。
  4. 图片证据必须匹配结论：
     - 质量 / 精度图用 official 或用户指定输入。
     - 功能 smoke 图如果质量差，不贴；用日志证明 grouping 即可。
  5. 如果发现结果来源错了，不能用注释补救；必须撤掉旧表，重跑正确口径并替换。
