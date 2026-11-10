---
name: model-adaptation-guardrails-2
description: Model Adaptation PR Guardrails 第 5–9 节：验证三层（latest-head / historical / pending）与 PR body 措辞、public docs 性能数字 provenance、full diff review gate 与输出格式、interactive reviewer loop 协议、pre-push 13 项 checklist
metadata:
  scope: 只收验证分层、docs 数字、full diff review、interactive reviewer loop 与 pre-push checklist；触发、mini-spec、checkpoint、entrypoint 与 request parsing 归 model-adaptation-guardrails-1、model-adaptation-guardrails-2，PR body 证据写法归 pr-body-model-evidence，审查入口归 review-guides-overview
---
# Model Adaptation PR Guardrails（2/2）

## 关键事实

- 拆分说明：本页是源页 `model-adaptation-guardrails.md` 的第 2/2 部分；第 1 部分 [[model-adaptation-guardrails-1]]
- 源页：`knowledge/repos/vllm-omni/review/guides/model-adaptation-guardrails.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: vllm-omni, review；created: 2026-07-10；updated: 2026-07-10

### 5. Validation tiers and PR body wording

- PR body 必须把证据分三层，不准混写；细节见 [[pr-body-model-evidence]]（pr_body_model_evidence）、[[pr-body-provenance]]（pr_body_provenance）、[[pr-body-privacy]]（pr_body_privacy）。

```text
Latest-head validation:
- 当前 PR head 的命令、结果、版本

Historical reference:
- 旧 checkout / artifact / benchmark，只能作为背景，必须写 checkout

Pending:
- 需要远端 GPU、model cache、serving smoke、formal perf 的项
```

- 性能结论只来自 formal sweep。单请求 smoke、endpoint 探索、unit tests、shape-clean 都不能写成 speedup。
- 公开 PR body / comment 只写 reviewer-facing 可复现证据；本地/远端内部路径、host/user/cache/venv 探针、个人机器 blocker 只进私有验证 artifact，不进公开正文。新模型 PR 里的 `strict load`、stub smoke、real checkpoint validation 必须分层，不能互相冒充。

### 6. Public docs performance numbers

- recipes / docs 不能发布没有 provenance 的 latency、VRAM、warmup 秒数。
- 允许：
  - "run latest-head serving smoke or DFX benchmark before publishing latency/VRAM"
  - "96GB-class GPU recommended for validation" 这类非测量指导
  - 带 commit/env/workload 的历史表，并明确 historical
- 不允许：
  - 从历史笔记搬 `~110s`、`~62GB` 进 public recipe
  - PR body 说 formal sweep pending，但 recipe 表格像 validated configurations
  - perf config 只覆盖小 workload，却在 docs 写另一个大 workload 的正式结果

### 7. Full diff review gate

- 新模型适配 PR 通常会同时改 pipeline、测试、recipe、perf config、registry/docs。用户要求全量 review、项目级 review、看有没有废话/重复/垃圾修改，或准备 push/更新 PR body 前，必须先跑 full diff review gate。
- 先生成 diff 证据：

```powershell
git diff --stat origin/main...HEAD
git diff --name-status origin/main...HEAD
git diff --numstat origin/main...HEAD
```

- 然后按新增行数从大到小审：
  1. Pipeline / model 文件：每个新增 helper、request parser、default、denoise/step 函数都要追到 T2V forward、I2V forward、offline entrypoint、serving entrypoint、tests。只测 helper 返回值不算 public path 通过。
  2. Tests：确认测试覆盖的是公开行为 owner，不只是内部 helper；prompt embeds、latents、image tensor、non-default fps/frame_count/num_outputs 等都要走到 consumer。
  3. Recipe/docs/perf config：model id 必须是当前 loader 可加载的 Diffusers layout；workload、frame size/count、mode、compile/eager、性能数字和 config 必须一一对应。
- Garbage pass 必须专门查：
  - T2V/I2V request parsing 是否复制，后续字段是否会漂移。
  - tensor-like 字段是否用了 Python `or` / truthiness fallback。
  - docs 是否把 raw/upstream checkpoint 写成 runnable checkpoint。
  - perf config 只覆盖小 workload，却在 recipe 里暗示大 workload 已验证。
  - unit-only 验证是否被写成 public entrypoint smoke。
  - 已修 finding 的同类模式是否横向漏扫。
- 输出必须写：

```text
DIFF REVIEW BASE: <base>...<head>
TOP FILES REVIEWED: <files>
AUDITS RUN: diff-census, semantic-trace, garbage-pass, reviewer-lens-1..4
```

- 如果只检查了之前 reviewer/sub-agent 提过的问题，只能写 `known findings closed`，不能写 `full PR reviewed`、`clean` 或 `no remaining P1/P2 for the PR`。

### 8. Interactive reviewer loop

- 普通 "review 一下" sub-agent 容易直接给结论，不能逼出不明白的问题。复杂模型适配需要 loop protocol。
- 使用这个协议：

```text
You are a fresh low-context interactive reviewer.
Do not finish in one pass.

Hard protocol:
1. First response MUST be `QUESTIONS ROUND 1`.
2. Ask 3-6 concrete questions. Each question includes:
   - file:line evidence
   - what you do not understand
   - what answer would change your review result
3. Stop after questions and wait.
4. After answers, validate against code, then either:
   - ask `QUESTIONS ROUND N`, or
   - say `READY_FOR_FINDINGS`
5. Do not output final findings until main agent sends `FINALIZE_REVIEW`.
6. Final output is P0/P1/P2 findings or no blocking findings plus residual risks.
```

- 主 agent 操作规则：
  - 不要长等到 completed 后才看。短轮询，看到 QUESTIONS 就答。
  - 答案不能只解释设计，要给它可验证的 file/line/command。
  - 对它指出的 "没有证据" 默认当真，先补证据或改 wording。
  - 它说 `READY_FOR_FINDINGS` 后再发 `FINALIZE_REVIEW`。

### 9. Pre-push checklist

- 新模型适配 PR push 前必须逐项打勾：
  - [ ] mini spec 写过
  - [ ] runnable checkpoint layout 已验证
  - [ ] official raw vs Diffusers-format checkpoint 已区分
  - [ ] supported model / examples / recipes / perf config 的 model id 一致且可加载
  - [ ] T2V/I2V public commands 都有正确必填字段
  - [ ] request parsing 共享 helper 或明确 intentional split
  - [ ] batched optional tensor fields all-or-none fail-fast
  - [ ] non-default field tests 覆盖 fps/frame_rate、num_outputs_per_prompt、prompt dict fallback、latents/image path、decode fields
  - [ ] PR body 分 latest-head / historical / pending
  - [ ] public docs 没有无 provenance latency/VRAM 数字
  - [ ] full diff review gate 跑过，并区分 known findings closed vs full PR reviewed
  - [ ] 至少跑过 module owner + omni project owner review
  - [ ] 对复杂 PR 跑过 interactive reviewer loop
