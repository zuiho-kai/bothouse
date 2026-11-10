---
name: distributed-overview
description: Distributed 组件入口（跨 stage 通信与数据搬运）：omni_connectors 六后端、OmniKVTransferManager、omni_coordinator LoadBalancer 与 OmniMasterServer 端口分配的源码锚点（main @ 44d3ae10），何时查本目录，按 PR 信号直达首批源码的入口表（save_async、Mooncake、route port），目录内各页指引
metadata:
  scope: 只收 distributed 目录的入口、源码锚点、PR 信号入口表与页面指引；connector 合同与后端矩阵归 distributed-architecture，已修产品坑归 connector-pitfalls，规则正文归 distributed-rules-1、distributed-rules-2，调度侧 KV/输入等待状态机归 scheduler-overview，请求编排与 stage 生命周期归 serving-overview
---
# Distributed（跨 stage 通信与数据搬运）

## 现状

- 源码入口：`vllm_omni/distributed/omni_connectors/`（`connectors/` 6 个后端、`factory.py`、`kv_transfer_manager.py`、`transfer_adapter/`、`utils/`）和 `vllm_omni/distributed/omni_coordinator/`（协调器与 load balancer）
- 知识面另覆盖跨 stage ZMQ 路由/端口分配（`vllm_omni/engine/stage_engine_startup.py::OmniMasterServer`）——组件划分服务知识归属，与 manifest 运行时粒度不同
- 源码校验：以上路径与下列锚点均已在 `main @ 44d3ae10`（upstream `main` 快照）验证存在：`OmniConnectorBase`（connectors/base.py:12）、`OmniKVTransferManager`（kv_transfer_manager.py:348）、`LoadBalancer` 三实现（load_balancer.py:39/64/74/102）、`OmniMasterServer._allocate_route_locked`（stage_engine_startup.py:262）
- 官方设计文档：`docs/design/feature/disaggregated_inference.md` + `docs/design/feature/omni_connectors/`（逐后端 spec）
- 测试入口：`tests/distributed/`

### 什么时候查这里

- 跨 stage 数据传不动、损坏、乱序或 `Address already in use` 类启动失败。
- 选择/配置 connector 后端（单机 SHM、跨机 Mooncake/Mori/Yuanrong）。
- 排查 KV cache 跨 stage 迁移的数据面（`OmniKVTransferManager`）。

### Direct 代码快速入口

| PR 描述信号 | 第一批源码 | 已有知识 |
|---|---|---|
| connector backend、put/get、跨 stage 数据损坏 | `distributed/omni_connectors/connectors/base.py::OmniConnectorBase`；目标 backend 的 `put` / `get` | architecture |
| async sender boundary、segment generation、chunk dedup watermark | `distributed/omni_connectors/transfer_adapter/chunk_transfer_adapter.py::save_async` | DIST-1g/1j |
| Mooncake、RDMA/TCP fallback、object decode | `connectors/mooncake_transfer_engine_connector.py::MooncakeTransferEngineConnector` | connector pitfalls |
| KV transfer、connector lifecycle | `distributed/omni_connectors/kv_transfer_manager.py::OmniKVTransferManager` | architecture |
| coordinator、replica selection、负载均衡 | `distributed/omni_coordinator/load_balancer.py::LoadBalancer` 及具体 balancer | architecture |
| `Address already in use`、route/handshake/input/output port | `engine/stage_engine_startup.py::_port_from_zmq_address`、`OmniMasterServer._allocate_route_locked`、`_alloc_unique_ports` | connector pitfalls |

### 不放什么

- 调度侧的 KV/输入等待状态机属于 [[scheduler-overview]]（Scheduler）。
- 请求编排与 stage 生命周期属于 [[serving-overview]]（Serving）。

### 目录内容

| 遇到什么 | 查看哪里 |
|---|---|
| 按 PR 描述直达 connector、KV transfer、load balancer 或 route-port 首批源码 | [本页 Direct 代码快速入口](#direct-代码快速入口) |
| 理解 connector 合同、6 后端、KV 迁移管理与负载均衡 | [[distributed-architecture]]（architecture） |
| 已修过的 connector/端口产品坑 | [[connector-pitfalls]]（connector pitfalls） |
| 选择和配置 connector backend | [[connector-backends]]（connector backends） |
| 跨 stage `async_chunk` 流式语义 | [[async-chunk]]（async chunk） |
| TP KV receive consensus、chunk boundary、active-window 合同、Mooncake TCP write completion 与 SHM 完整 key 清理 | [[distributed-rules-1]]、[[distributed-rules-2]]（distributed rules） — DIST-1l、DIST-1l2、DIST-1l3、DIST-1l4、DIST-1m。 |

- [[rules-shm-readiness]]（SHM arrival hints、独立 work event 与 polling fallback）。
- [[rules-shm-final-cleanup]]（stage-0-final、CFG KV/chunk 分区与全部stage后回收）。

## 关键事实

- 源页：`knowledge/repos/vllm-omni/components/distributed/_index.md`（InferMatrixCopilot@ecfb84d0）；type: index；tags: vllm-omni, components, distributed；created: 2026-07-16；updated: 2026-10-09
- 来源（sources）：vllm_omni/distributed/omni_connectors/；vllm_omni/distributed/omni_coordinator/；docs/design/feature/disaggregated_inference.md
