---
name: connectors-architecture
description: AFD connectors 架构，职责和边界、主要源码入口、三类 connector 的 world ordering 与 control/step 来源和拓扑、extra config、关闭顺序、验证方法
metadata:
  scope: 只收 afd-plugin connector owner 的当前合同（factory、schema、topology、control/data plane、payload/state、通信资源生命周期）；平台支持组合归 execution-platforms-architecture，review 规则归 connectors-rules
---
# AFD connectors 架构

## 现状

### 职责和边界

- connector owner 负责 lazy factory、connector-owned extra schema、跨 role topology、control/data plane、payload/state 和通信资源生命周期。
- worker 拥有 connector 对象并调用 `close()`；model 只在当次 forward 中通过 metadata 调用 data-path，不初始化或关闭通信资源。

### 数据怎样流动

| Connector | World ordering | Control/step source | 关键拓扑 |
|---|---|---|---|
| `P2pNcclAFDConnector` | FFN 后 Attention | NCCL metadata control plane | `A >= F` 且 `A % F == 0` |
| `CAMP2pAFDConnector` | FFN 后 Attention | Gloo control + HCCL data | `A >= F`，每 ubatch 独立 HCCL group |
| `CAMAsyncAFDConnector` | Attention 后 FFN | CAM dispatch payload/work item | role rank 直接映射，routing metadata 随 payload |

- 同步路径是 Attention send control metadata，FFN 应用 shape/graph state，然后按 layer/stage 完成 A2F receive、compute、F2A send 和 Attention receive。
- CAM async 无单独 control plane，Attention 把 routing/token metadata 交给 CAM，FFN 从 connector work item 得到计算输入，Attention 按 stage FIFO 完成延后 receive。
- `connector_extra_config` 不是 `AFDConfig` 字段。
- P2P 只接受空 mapping；CAMP2P 解析 core/gate/quant 选项；CAM async 解析 dynamic quant、Attention ranks-per-DP 和可选 async MoE pipeline。
- 具体支持组合由 [[execution-platforms-architecture]]（execution-platforms）集中记录。
- partial initialization 必须可 close。
- 关闭顺序需释放 pending queue、operator state、communicator 和 connector-owned process group；后台 FFN 计算或通信异常不得被 connector 吞掉。

## 关键事实

- 源页：`knowledge/repos/afd-plugin/components/connectors/architecture.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: afd-plugin, components, connectors, distributed；created: 2026-08-06；updated: 2026-08-06
- 来源：
  - afd-plugin@a432692:afd_plugin/connectors/**
  - afd-plugin@a432692:afd_plugin/distributed/**
  - afd-plugin@a432692:docs/design/module/connector_contracts.md
- 置信度（confidence）：medium

### 主要源码和调用入口

- `base.py` / `factory.py`：延迟加载 connector class，解析 typed extra config，从 global DP 和 local PCP/TP 坐标解析 role rank。
- `metadata.py`：`AFDControlPayload`、transfer metadata/state/context 和 A2F/F2A payload。
- `gpu/p2p.py`：NCCL data/control group。
- `npu/camp2p.py`：HCCL data groups + Gloo control plane。
- `npu/async_cam.py`：CAM dispatch/combine、pending FIFO 和 connector-driven work items。
- `distributed/**`：AFD process group 和 A/F topology。

### 怎样验证

- 对 factory/schema 改动覆盖 unknown/duplicate/invalid rank 且确保不创建资源。
- 对 concrete connector 同时覆盖初始化、往返 tensor/state、错误、partial cleanup 和 re-init，再跑匹配 GPU/NPU TP 或 async CAM E2E。
- 审查门禁见 [[afd-plugin-rules]]（仓库规则）。
