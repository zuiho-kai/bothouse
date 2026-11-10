---
name: rules-sleep-control
description: "Sleep / wake admission 与 ACK 规则：SERV-5b 只有成功 ACK 与真实 backend level-2 能力才转 warm，ERROR ACK / RPC error envelope 转 RuntimeError，不支持的 level-2 wake 返回 HTTP 501；SERV-5m AR lifecycle 先封锁 admission、经 EngineCore pause_scheduler / resume_scheduler / sleep / wake_up，wake 不隐式 resume，abort 等 ACK 后才清 frontend state（PR #4834、#6084、#7811、#8501 等）"
metadata:
  scope: 只收 SERV-5b 与 SERV-5m；sleep/wake 的 stage/tag 作用域（SERV-5a）与 wake 设备同步（SERV-5o）归 rules-engine-lifecycle-1、rules-engine-lifecycle-2，HTTP 请求 schema（SERV-CONTROL-1a）归 rules-control-request-schema，释放 KV memory（SERV-RELEASE-KV-1b）归 serving-rules-upstream-compat
---
# Sleep / wake admission 与 ACK 规则

## 关键事实

- 源页：`knowledge/repos/vllm-omni/components/serving/rules-sleep-control.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, components, serving；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：PR #4834；PR #4905；PR #4912；PR #5713；PR #6084；PR #6581；PR #6367；PR #7811；PR #8501
- 置信度（confidence）：high
- [SERV-5b] 只有成功 ACK 和真实 backend capability 才能转为 warm
  - 触发：worker ACK 可返回 error，或不同 backend 对 level-2 restore 能力不同。
  - 强制：逐目标确认成功 ACK 后再清状态；level-2 能力按 backend/stage 表达。diffusion ERROR ACK（object/dict）与 RPC error envelope（含 boolean error+reason、unsupported）必须转成带原因的 RuntimeError；无 task_id 的失败 envelope 不交给 ACK resolver。失败 sleep 仍记录可能部分 offload 的 diffusion stage，HTTP sleeping set 只镜像 engine 实际记录的 stage。
    - wake 只清成功 stage 的 tags，失败仍保持 admission；level-2 pre-offload 失败可重试，只有已有 replica 真正丢弃 weights 才保留不可恢复标志。HTTP runtime failure 返回结构化 500。
  - 验收：失败 ACK 保留 sleeping 状态；支持 level-2 的 diffusion 路径仍能 sleep → wake → generate，不支持的 stage 在调用 worker 前明确拒绝。assembled app 对不支持的 level-2 wake 保留 sleeping state，并把既有 `NotImplementedError` 映射为 OpenAI-style structured HTTP 501；
    - bare route mock 只证明 exception propagation，不能代替这条 live contract。^[PR #4834] ^[PR #4905] ^[PR #4912] ^[PR #5713] ^[PR #7811]
  - 验收补充：覆盖 object/dict/RPC-error、混合 stage 的部分成功、HTTP sleep failure→wake 可达、invalid IDs 不污染 sleeping set，以及 level-2 全失败与部分成功的不同恢复能力。显式 stage 查询返回该范围内是否仍有 sleeping tag。^[PR #7811]
- [SERV-5m] AR lifecycle 控制必须先封锁 admission，并以 backend 完成信号收尾
  - 触发：修改 `AsyncOmni` 的 pause/resume、sleep/wake 或 abort，或改变 `StagePool.collective_rpc` 到 AR EngineCore / diffusion worker 的控制面路由。
  - 强制：在 sleep drain/offload 前设置 frontend admission gate；AR stage 经 orchestrator 路由到 EngineCore 的 `pause_scheduler`、`resume_scheduler`、`sleep`、`wake_up`，diffusion stage 继续走 worker sleep/wake RPC。`wake_up()` 不得替 AR/mixed engine 解除 admission，只有 `resume_generation()` 可以解除；
    - 已 paused 时的定向 pause 和 cache clear 仍须执行。stage ID 必须先校验范围，且在设置 `_paused` / admission gate 之前完成，非法 ID 不得改变 admission 或等待 in-flight drain；HTTP ValueError 映射为 400。只允许这四个已知 EngineCore helper 使用 `*_async` fast path，并保持 caller timeout；其余 RPC 仍走 collective path。
    - 需要 frontend cleanup 的 abort 必须关联 result，等待 orchestrator 完成 stage abort、binding release 和 request cleanup 后才移除 frontend state，失败或 timeout 必须保留 state 并传播。
  - 强制：sleep 先关闭 admission，再等待所有 in-flight `_admitting` submissions drained 后才 offload；P0 先 reset MM cache，stage tag 保留 per-stage scope。wake 不重新开启 AR admission，仍只由 `resume_generation()` 解除。
    - AR abort 必须把 cumulative terminal-prefix token 由 output processor 传至 stage pool/orchestrator 并 ACK 回 async queue；先物理 abort，再 commit output/request state，且 state 延迟到 generator 消费后清理。只移除最后一个 child，只有最后 terminal output 收敛；control RPC exceptions 必须传播。diffusion abort 路径未因本 PR 改写。
  - 验收：覆盖 AR-only、diffusion-only 和 mixed stage 路由；sleep 进行时 generation 等待，AR sleep → wake 后仍需显式 resume，跨 AR+diffusion 的 sleep/wake E2E 必须在 post-wake `generate()` 前显式调用 `resume_generation()`，而 diffusion-only sleep → wake 可恢复 admission；
    - 重复/定向 pause 仍调用 scheduler 与 cache clear，非法 stage ID 产生明确错误，fast path 仅命中四个方法且 timeout 生效；abort success 后才清理 frontend state，orchestrator error 与 timeout 时 state 保留。本 PR 的测试/PR body 没有独立 GPU performance 或全量 diffusion-abort evidence。^[PR #6084] ^[PR #6581] ^[PR #6367] ^[PR #8501]
  - 验收补充：invalid sleep stage 后立即 generate 仍可进入；验证在非法输入下没有 sleep RPC、cache reset、paused-state mutation，HTTP sleep/wake 的 client errors 保持 400。^[PR #8501]
- 其他 stage 与 session 生命周期见 [[rules-engine-lifecycle-1]]、[[rules-engine-lifecycle-2]]（engine lifecycle）。

## 决策与踩坑

- [SERV-5b] 禁止：错误 ACK 也清 tag；用 engine 全局禁令误伤已经支持 restore 的 diffusion worker。
- [SERV-5m] 禁止：以单一 frontend flag 代替 AR scheduler 控制；在 sleep RPC 后才阻止 `generate()`；让 wake 隐式 resume；因已 paused 跳过不同 stage scope 或 cache reset；将任意同名 `*_async` helper 绕过 collective timeout；在 abort ack 前 pop request state，或将 abort failure 当成功。
