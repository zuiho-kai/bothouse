---
name: rules-async-chunk-prewarm
description: "规则 VLLM-OMNI-PR8198-ASYNC-PREWARM：async-chunk placeholder prewarm payload 的四层合同（StagePipelineConfig.async_chunk_prewarm_payload_func、orchestrator 初始 add、scheduler pending_request_prewarms 恰好一次投递、GPU/NPU runner 的 on_requests_added / run_idle_prefetch），chunk 0 不得依赖 prewarm，Code2Wav token2wav_ref_prefetch 默认值（PR #8198）"
metadata:
  scope: 只收 async-chunk prewarm payload 这一条规则的触发、强制、禁止与验收；async-chunk 等待截止时间、容量占用等其他 async-chunk 调度规则（SCHED-4a–6f）归 scheduler-rules-2
---
# Async-chunk prewarm 规则

## 关键事实

- 源页：`knowledge/repos/vllm-omni/components/scheduler/rules-async-chunk-prewarm.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, components, scheduler；created: 2026-10-10；updated: 2026-10-10
- 来源（sources）：PR #8198
- [VLLM-OMNI-PR8198-ASYNC-PREWARM] async-chunk prewarm payload 是四层同契约的提示，不是数据源
  - 触发：修改 async-chunk placeholder prewarm 的任一层：`StagePipelineConfig.async_chunk_prewarm_payload_func`（legacy 与 typed metadata 两条路径都要解析）、orchestrator 初始 add 的 `_attach_async_chunk_prewarm_payload`、
    - scheduler `add_request` 对 `_async_chunk_prewarm.*` 键的弹出与 `OmniSchedulerOutput.pending_request_prewarms` 投递，或 GPU/NPU generation runner 的 `on_requests_added` / `run_idle_prefetch` 模型 hook。
  - 强制：payload 函数按 stage 显式 opt-in（MiniCPM-o 仅 Code2Wav 设置 `code2wav_prewarm_payload`）并在 stage client 暴露；orchestrator 只在初始 add 附带——streaming re-prewarm、session-owned 与 resumable 请求跳过——并把扁平 `{name: Tensor|scalar}` 展开为 `additional_information` 顶层 `_async_chunk_prewarm.<name>` 键使 tensor 能过序列化；
    - 函数失败或返回空时 placeholder 原样提交。scheduler 在 `add_request` 弹出这些键使其不进入 runner 的 per-request buffer，只对仍存活的 request id 经 `pending_request_prewarms` 恰好投递一次，finish/abort 丢弃未投递项。`run_idle_prefetch` 仅在「零 token step 且前一 step 也是零 token」时运行——有 chunk 调度、或 busy 后首个 idle step（输出可能仍在途）都不得运行；
    - hook 异常只记日志（每个 hook 首次 warning），绝不传到 EngineCore；无 hook 的模型零影响。prefetch 在 forward 同一线程按排队 request 单 phase 执行，不自建线程/锁/side stream（CFM/HiFT CUDA graph 共享静态 buffer，`prepare_prompt` 设置进程全局默认 dtype）。chunk 0 必须仍自带 stage 所需全部输入。
  - 验收：scheduler 两侧（OmniGenerationScheduler 与 OmniARScheduler）覆盖键弹出、恰好一次投递、finish/abort 丢弃、malformed payload 不抛错与序列化往返；orchestrator 覆盖初始 add 附带、re-prewarm/session/resumable 跳过与函数失败时 placeholder 不变；dotted path 在 legacy 与 typed 两条 metadata 路径均可解析；
    - GPU 与 NPU runner 断言 hook 时序（零 token step 且前一 step 也零 token）、每 hook 首次 warning、无 hook 模型 no-op；Code2Wav 断言 prefetch 仅在无 live stream 且恰有一个等待 reference 时运行，`token2wav_ref_prefetch` 默认开、`token2wav_ref_prefetch_setup` 默认关（共享 GPU 时其 GPU work 会拖慢 Stage-0 thinker 的 text TTFT）。^[PR #8198]

## 决策与踩坑

- [VLLM-OMNI-PR8198-ASYNC-PREWARM] 禁止：把 tensor 嵌套进 payload 容器（必须扁平）；让 chunk 0 的正确性依赖 prewarm payload（re-prewarm、session-owned/resumable 请求或函数失败时缺席）；让 hook 异常到达 EngineCore 或影响同批请求；只接 GPU 或只接 NPU 一侧 runner；prefetch duplex session 或 resumable 请求；在没有真实 idle-step consumer 证据时给其它 stage 打开 payload 函数。
