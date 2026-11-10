---
name: rules-dfx-reliability
description: "规则 VLLM-OMNI-PR9407-FAULT-PAYLOAD-REUSE：tests/dfx/reliability/test_qwen3_omni.py 的 process-kill 故障注入中，多模态请求体在主线程按 model 构建一次并缓存于 _MULTIMODAL_REQUESTS，线程池 worker 只发 HTTP、不得调用 generate_synthetic_audio（espeak 进程级全局，曾致 pytest SIGSEGV 退出码 139，PR #9407）"
metadata:
  scope: 只收 DFX 可靠性故障注入测试里请求体复用与 espeak 线程安全这一条评审规则；replica 死亡后的服务侧隔离合同（SERV-5f）归 rules-fault-isolation
---
# vLLM-Omni Serving · DFX 可靠性故障注入测试评审规则

## 关键事实

- 源页：`knowledge/repos/vllm-omni/components/serving/rules-dfx-reliability.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, components, serving；created: 2026-10-26；updated: 2026-10-26
- 来源（sources）：PR #9407
- [VLLM-OMNI-PR9407-FAULT-PAYLOAD-REUSE] 可靠性故障注入的并发线程复用预构建多模态请求体，worker 线程禁止触发 espeak
  - 触发：改动 `tests/dfx/reliability/test_qwen3_omni.py` 中 `_multimodal_request` 的请求体构建、模块级 `_MULTIMODAL_REQUESTS` 缓存，或进程击杀（process-kill）线程池（`submit_concurrent` / `assert_fast_fail` 路径）对该请求体的使用；以及任何会让多个测试线程直接或间接调用 `tests/helpers/media.py` 的 `generate_synthetic_audio`（pyttsx3/espeak）的新测试代码。
  - 强制：多模态请求体须在调用线程上按 model 构建一次并缓存于 `_MULTIMODAL_REQUESTS`（warmup 在进入线程池前的主线程完成首次音频合成），`assert_fast_fail` 与 `submit_concurrent` 复用同一 body，线程池 worker 只发送 HTTP；`_multimodal_request` 每次返回新组装的外层 dict，`modalities` 以 `list(...)` 拷贝。
    - 依据 PR #9407 随修复新增的代码注释：espeak 为进程级全局（单一 synth 回调、固定 350 项 voice 表 N_VOICES_LIST），修复前四个 worker 线程各自调用 `_multimodal_request` → `generate_synthetic_audio`，在服务器已返回 HTTP 500 的情况下把 pytest 进程以 SIGSEGV（退出码 139）杀死，故障注入测试无法完成对 API 错误的断言。
  - 验收：`tests/dfx/reliability/test_qwen3_omni.py::test_reliability_fault_process_kill_worker_no_load[qwen3_omni_reliability_async_chunk__sigterm]`（双 H100、Qwen/Qwen3-Omni-30B-A3B-Instruct）能完整结束并观测到 HTTP 500，pytest 进程不再以 139 退出；
    - 源码中 `_multimodal_request` 含按 model 的缓存，且线程池 worker 路径不再调用 `generate_synthetic_audio`。^[PR #9407]

## 决策与踩坑

- [VLLM-OMNI-PR9407-FAULT-PAYLOAD-REUSE] 禁止：把请求体构建（尤其 `generate_synthetic_audio` 调用）移回线程池 worker 或任何并发路径；删除 `_MULTIMODAL_REQUESTS` 缓存使 worker 重新合成音频；在没有并发调用方证据的情况下改 `tests/helpers/media.py` 加进程级 espeak 锁（PR #9407 记录仓库内其余 `generate_synthetic_audio` 调用方均为单线程，媒体助手保持不动）。
