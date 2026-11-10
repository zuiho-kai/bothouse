---
name: ffn-runtime-architecture
description: AFD FFN runtime 架构，connector-driven 计算 daemon 的职责边界、CUDA/Ascend 源码入口、control-plane 与 CAM async 数据流、错误传播与 shutdown、验证方式
metadata:
  scope: 只收 FFN runtime（worker / model runner）的架构、数据流和验证方式；传输归 connectors-architecture，EngineCore 改写归 compatibility-architecture，审查规则归 ffn-runtime-rules
---
# AFD FFN runtime 架构

## 现状

### 职责和边界

- FFN runtime 是 connector-driven 计算 daemon，拥有 empty KV surface、背景循环、FFN compute dispatch、错误传播和 shutdown。
- 它不接收 API 请求，也不允许 native scheduler 调用 `execute_model()` 驱动工作。
- 传输由 [[connectors-architecture]]（connectors） 拥有，EngineCore 改写由 [[compatibility-architecture]]（compatibility） 拥有。

### 数据怎样流动

```text
worker init -> role-aware model -> empty KV surface -> connector init -> daemon

if connector.control_plane exists:
  receive AFDControlPayload -> warm/capture/replay/eager -> receive tensor
else (CAM async on NPU):
  receive connector work item -> build minimal forward context

compute_ffn_output -> send with the same transfer context -> repeat
```

- 同步 connector 先应用 stage DP metadata 和 graph flags，再按 layer/stage 收取 `AFDA2FTransferPayload`；返回时必须保留 receive 时的 transfer context/state。
- CAM async 没有 DP-metadata control plane，NPU runner 从 connector work item 得到 layer、token 和 routed/shared payload，并返回 CAM combine 需要的输出。
- daemon 捕获原始异常并通过 `raise_ffn_loop_error_if_any()` 向前台暴露。
- shutdown 先 signal，再关闭 runner-owned profiler 和 connector-owned communication，有界 join 后重新抛出背景错误，最后交回 upstream teardown。

## 关键事实

- 源页：`knowledge/repos/afd-plugin/components/ffn-runtime/architecture.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: afd-plugin, components, ffn-runtime；created: 2026-08-06；updated: 2026-08-06
- 来源：
  - afd-plugin@a432692:afd_plugin/v1/worker/ffn_model_runner.py
  - afd-plugin@a432692:afd_plugin/v1/worker/ffn_worker.py
  - afd-plugin@a432692:afd_plugin/v1/worker/npu/ffn_model_runner.py
  - afd-plugin@a432692:docs/design/module/ffn_runtime.md
- 置信度（confidence）：medium

### 主要源码和调用入口

- CUDA 使用 `AFDFFNWorker` 和 plugin-owned `GPUFFNModelRunner`；Ascend 使用直接继承 upstream NPU 类的 `AFDNPUFFNWorker` / `AFDNPUFFNModelRunner`。
- 两个平台不跨设备继承，共享语义通过 config、payload、validation 和小 helper 传递。

### 怎样验证

- 运行 FFN runner、NPU runtime 和 EngineCore patch 单测；每次修改 step selection 都要同时覆盖有/无 control plane、背景失败、重入 startup 和 shutdown。
- 传输、graph 或 CAM work-item 变更还需对应 connector/platform unit 与 serving/async CAM E2E。
- 硬门禁见 [[afd-plugin-rules]]（仓库规则）。
