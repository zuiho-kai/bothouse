---
name: connector-backends
description: Connector 后端选择与配置指南：官方选择矩阵（单机 SharedMemoryConnector、跨机 MooncakeStore TCP、MooncakeTransferEngine RDMA 最快、Mori RDMA、Yuanrong 两形态），全部为 D2H2D 模式，deploy YAML 的 connectors / input_connectors / output_connectors 与 extra 键（shm_threshold_bytes 默认 65536）的出处
metadata:
  scope: 只收按部署场景选 connector 后端及其配置入口；connector 合同与 factory 注册名归 distributed-architecture，deploy YAML 的 connector 声明语法归 configuration-architecture，已修产品坑归 connector-pitfalls
---
# Connector 后端选择与配置

## 关键事实

- 源页：`knowledge/repos/vllm-omni/components/distributed/connector-backends.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: vllm-omni, components, distributed；created: 2026-07-16；updated: 2026-07-16
- 来源（sources）：docs/design/feature/disaggregated_inference.md；docs/design/feature/omni_connectors/
- 官方 spec：`docs/design/feature/disaggregated_inference.md` + 逐后端文档 `docs/design/feature/omni_connectors/{shared_memory,mooncake_store, mooncake_transfer_engine,mori_transfer_engine,yuanrong,yuanrong_transfer_engine}_connector.md`（`main @ 5c390096` 复核）。

### 选择矩阵（官方口径）

| 场景 | 推荐后端 | 备注 |
|---|---|---|
| 单机 | SharedMemoryConnector | 未指定 connector 时自动配置 |
| 跨机（Mooncake Store） | MooncakeStoreConnector | TCP，需 Mooncake Master + metadata server |
| 跨机（Mooncake RDMA） | MooncakeTransferEngineConnector | RDMA/TCP 直传 + 托管内存池，**最快** |
| 跨机（Mori RDMA） | MoriTransferEngineConnector | Mori IOEngine RDMA 直传 |
| Yuanrong | Yuanrong(TransferEngine)Connector | 两种形态 |

- 当前所有后端均为 **D2H2D**（device→host→device）模式。deploy YAML 里的 connector 声明与 stage 引用语法（顶层 `connectors:` + per-stage `input_connectors`/`output_connectors`）见 [[configuration-architecture]]（Configuration）；
  - `extra` 键（如 SHM 的 `shm_threshold_bytes` 默认 65536；Mooncake 的 host/metadata_server/master/segment/localbuf/proto）见 config spec 的 connector schema 表。

### 相关

- 合同与实现边界见 [[distributed-architecture]]（architecture）；已修产品坑见 [[connector-pitfalls]]（connector pitfalls）。
