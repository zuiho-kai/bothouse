---
name: attention-runtime-overview
description: AFD Attention runtime 入口总览，含使用时机、收录边界、Owner 凭证（基线、主源码、职责、验证、影响）和目录内容
metadata:
  scope: 只收源目录 afd-plugin/components/attention-runtime 索引页里的使用时机、收录边界、Owner 凭证和入口说明；运行流程归 attention-runtime-architecture，审查规则归 attention-runtime-rules
---
# AFD Attention runtime 入口

## 现状

### 什么时候查这里

- 修改 Attention worker/model runner、API 请求执行、KV/sampling 边界或 AFD forward metadata 安装。
- 调查请求进入 Attention 后如何交给 FFN，以及 control-plane/async CAM 分流。

### 不放什么

- FFN daemon 生命周期放 [[ffn-runtime-overview]]（ffn-runtime）。
- payload/process group 放 [[connectors-overview]]（connectors）；graph 和 native ubatching 放 [[execution-platforms-overview]]（execution-platforms）。

## 关键事实

- 源页：`knowledge/repos/afd-plugin/components/attention-runtime/_index.md`（InferMatrixCopilot@ecfb84d0）；type: index；tags: afd-plugin, components, attention-runtime；created: 2026-08-06；updated: 2026-10-09
- 来源：
  - afd-plugin@a432692:docs/design/module/attention_runtime.md

### Owner 凭证

- 基线：`afd-plugin main @ a432692ed7d5dd6437a4755b530ee7aaf2685dad`。
- 主源码：`afd_plugin/v1/worker/attention_model_runner.py`、`attention_worker.py`、`ubatch_wrapper.py` 及 NPU 对应 Attention 文件。
- 职责：拥有外部请求、scheduler/KV/sampling 角色适配、AFD metadata 安装与 FFN handoff；不拥有 connector 通信资源或模型参数。
- 输入/输出：输入 vLLM scheduled batch 和 Attention role config；输出发往 FFN 的 stage/layer 工作与最终用户响应。
- 验证：`test_attention_model_runner.py`、`test_npu_runtime.py`、GPU/NPU serving、accuracy 和 async CAM E2E。
- 影响：请求调度、KV cache、模型 forward、connector control metadata 和输出路径。

### 目录内容

| 遇到什么 | 查看哪里 | 说明 |
|---|---|---|
| 理解初始化、请求和 control metadata 流 | [[attention-runtime-architecture]]（architecture） | v0.26 当前运行实现 |
| 调查模型内 handoff | [[model-integration-architecture]]（model-integration） | 角色感知层构造和 metadata consumer |
| 调查 graph/DBO | [[execution-platforms-architecture]]（execution-platforms） | 平台 wrapper、capture 和 replay |

- [[attention-runtime-rules]]（afd_plugin/v1/worker 审查规则：AFD 事务元数据、控制面发送与 runner 生命周期）：包括 v0.30 GPU MRV2 的实例 prepare seam 与每 stage 控制；不扩大 v0.26 基线支持。
