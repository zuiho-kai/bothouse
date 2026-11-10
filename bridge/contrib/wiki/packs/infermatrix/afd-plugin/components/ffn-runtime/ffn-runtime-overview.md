---
name: ffn-runtime-overview
description: AFD FFN runtime 入口总览，含什么时候查这里、不放什么、Owner 凭证（基线、主源码、职责、验证、影响）和目录内容
metadata:
  scope: 只收源目录 components/ffn-runtime 索引页里的使用时机、收录边界、Owner 凭证和入口说明；架构归 ffn-runtime-architecture，审查规则归 ffn-runtime-rules
---
# AFD FFN runtime 入口

## 现状

- 什么时候查这里：
  - 修改 FFN worker/model runner、connector-driven daemon、empty KV surface、background error 传播或 shutdown。
  - 调查 scheduler 为什么不能直接驱动 FFN，或 control-plane 与 CAM work-item 路径如何分流。
- 不放什么：
  - API/KV/sampling 主路径放 [[attention-runtime-overview]]（attention-runtime）。
  - EngineCore 全局 patch 放 [[compatibility-overview]]（compatibility）；传输状态放 [[connectors-overview]]（connectors）。

## 关键事实

- 源页：`knowledge/repos/afd-plugin/components/ffn-runtime/_index.md`（InferMatrixCopilot@ecfb84d0）；type: index；tags: afd-plugin, components, ffn-runtime；created: 2026-08-06；updated: 2026-08-06
- 来源：
  - afd-plugin@a432692:docs/design/module/ffn_runtime.md

### Owner 凭证

- 基线：`afd-plugin main @ a432692ed7d5dd6437a4755b530ee7aaf2685dad`。
- 主源码：`afd_plugin/v1/worker/ffn_model_runner.py`、`ffn_worker.py` 及 NPU 对应 FFN 文件。
- 职责：拥有 connector-driven 循环、empty KV behavior、FFN compute handoff、背景错误传播和 shutdown；不接收用户请求。
- 输入/输出：输入 control payload 或 connector work item；输出与 layer/stage/transfer context 匹配的 FFN 结果。
- 验证：`test_ffn_model_runner.py`、`test_npu_runtime.py`、`test_engine_core.py`、GPU/NPU serving 和 async CAM E2E。
- 影响：EngineCore 生命周期、connector blocking receive、MLP/MoE compute、graph cache 和资源释放。

### 目录内容

| 遇到什么 | 查看哪里 | 说明 |
|---|---|---|
| 理解 daemon、step selection 和 shutdown | [[ffn-runtime-architecture]]（architecture） | control-plane 与 connector-driven 两条路径 |
| 审查 EngineCore 适配 | [[compatibility-rules]]（compatibility） | patch 和 non-AFD 分支门禁 |
| 调查 FFN 模型计算 | [[model-integration-architecture]]（model-integration） | role-aware 构造和权重边界 |

- FFN 角色运行时（worker / model runner）审查规则：[[ffn-runtime-rules]]
