---
name: benchmark-scope-2
description: "vLLM-Omni Benchmark 口径第 2 部分：2026-06-02 scope lock 反例（PR #3767 测量补丁不是被测 PR）、Benchmark Scope Lock 四元组模板、允许加入 candidate PR 的三种来源与禁止来源、用户改 scope 后旧 plan 失效、结果目录命名规则、shared TTS runner 的 --model 与 --served-model-name 分离（PR #5957）"
metadata:
  scope: 只收 benchmark scope lock、candidate 选择、命名规则和 shared TTS runner registry identity 规则；三阶段口径矩阵和 availability gate 归 benchmark-scope-1，共享 TTS registry 的目录级说明归 benchmark-overview
---
# vLLM-Omni Benchmark 口径（2/2）

## 关键事实

- 拆分说明：本页是源页 `benchmark-scope.md` 的第 2/2 部分；第 1 部分 [[benchmark-scope-1]]
- 源页：`knowledge/repos/vllm-omni/benchmark/guides/benchmark-scope.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: vllm-omni, benchmark；created: 2026-07-10；updated: 2026-07-16

### 5. Benchmark 必须先定口径：探索 / smoke / sweep 三段不能混跑

#### Benchmark scope lock：测量补丁不是被测 PR，禁止自造 candidate

- 开跑前必须写 scope lock 四元组；没有这四行，不准启动 benchmark：

```markdown
Benchmark Scope Lock
- Version under test: <origin/main | explicit candidate>
- Measurement patch/tooling: <PR #3767 overlay | none | other>
- Execution path: <AR-only | DiT-only | full AR+DiT>
- Valid metrics: <stage_0_gen_ms | TTFC | TPOT | op topN | e2e>
```

#### 允许加入 candidate PR 的条件

- candidate PR 只能来自三种来源：
  1. 用户明确说“对比 PR #xxxx”。
  2. 已确认 plan 明确列出 “baseline / candidate”，且用户没有后续改 scope。
  3. 用户问“找相关性能 PR”，并要求先调研候选；调研结论必须先返回，不得直接把候选加入 benchmark。

#### 用户改 scope 后旧 plan 失效

- 用户说“去掉 DiT”时，旧 full pipeline plan 立即失效；用户说“跑 main 版本”时，旧 `main vs candidate` comparison 立即失效。此时必须重新写四元组，并把旧结果标记为 `invalid for current request`，不能继续沿旧 endpoint / old candidate / old metric 表达。

#### 结果命名规则

- 输出目录、summary 标题、表格列名必须反映真实 scope：
  - `main_plus_3767_aronly_tp4`：main + #3767 overlay，AR-only TP4。
  - `main_pr3938_full_it2i_shared_memory`：main vs PR3938，full it2i，shared-memory connector。
  - 禁止把第二种结果简称成 “AR 极限”。
- **一句话规则**：benchmark PR 是尺子，不是自动成为被测对象；candidate PR 是用户需求，不是 agent 推断。先锁四元组，再启动任何远端长跑。

### Shared TTS runner 必须分离 registry identity 和实际 served model

- `--model` 只选择 `model_configs.yaml` 的 workload/deploy/voice 配置；服务从本地 bundle 启动时，`--served-model-name` 独立指定发给 `vllm bench serve` 的 model 值，不得因此变更 registry key 或工作负载。
- 为请求注入 seed 前必须 copy task `extra_body`，不能在多轮 sweep 中污染共享 registry dict；`--num-warmups` 必须非负；`argparse.REMAINDER` 交给底层 CLI 前只移除首个 literal `--`，其余参数和顺序原样保留。
- 验收：用 local served name + registry key、连续两轮不同 seed、负 warmup 和带/不带 separator 的 remainder 构造最终 argv；registry 输入在调用后保持不变。^[PR #5957]

## 决策与踩坑

### 5. Benchmark 必须先定口径：探索 / smoke / sweep 三段不能混跑

#### Benchmark scope lock：测量补丁不是被测 PR，禁止自造 candidate

- **2026-06-02 HunyuanImage3 AR benchmark 反例 / 修正**：用户原始需求是“跑远程 main 版本的 HunyuanImage3 AR 部分性能极限，然后用 benchmark PR #3767”。这里的正确解释是：
  - 被测版本：远程最新 `origin/main`
  - 测量补丁：PR #3767 的最小 benchmark / streaming metrics overlay
  - 被测路径：HunyuanImage3 AR-only
  - 有效指标：AR 阶段耗时 / 吞吐 / 必要时 operator topN；full it2i 指标只能作为 full pipeline 结果，不能回填成 AR 极限
- 错误路线是把“相关 PR”脑补成 PR #3938 fused rotary 性能候选，随后做出 `main vs pr3938` full it2i 表。这张表即使数据来自真实 JSON，也不回答用户原始问题，因为 PR #3938 从未被用户指定为本轮被测对象，full `/v1/images/edits` 也不是“去掉 DiT”后的 AR-only 口径。

#### 允许加入 candidate PR 的条件

- 禁止来源：
  - PR 标题看起来像性能优化。
  - 之前上下文里出现过某个 PR。
  - benchmark 脚本或 overlay PR 中提到某个模型/指标。
  - “为了让表格完整”补一个 candidate。
