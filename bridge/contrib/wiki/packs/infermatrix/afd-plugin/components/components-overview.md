---
name: components-overview
description: AFD plugin 组件入口总览，含七个知识 owner 的映射表（主源码范围、主要验证）、收录边界和依赖方向
metadata:
  scope: 只收源目录 afd-plugin/components 索引页里的使用时机、收录边界、Owner 映射和依赖方向；各 owner 的架构与规则归各自组件页，仓库级门禁归 afd-plugin-rules
---
# AFD plugin 组件入口

## 现状

### 什么时候查这里

- 已知 changed file，需要定位唯一知识 owner、风险边界和 focused tests。
- 调查跨 Attention/FFN、connector、model、platform 或 compatibility 的调用链。

### 不放什么

- 仓库级默认门禁放 [[afd-plugin-rules]]（仓库规则）。
- 通用 review、debug 或 CI 方法放 general（源链接 `../../../general/_index.md`，不在本 pack 内）。
- adapter `modules` 服务 changed-path 风险路由；本目录服务人类知识 owner，两者目的不同但本次使用同一七 owner 边界。

### 依赖方向

- 角色和模型 owner 消费 plugin boundary、connector、platform 和 compatibility；低层 owner 不反向依赖具体 Attention/FFN worker。
- 跨 owner 结论只在最近 owner 保留正文，其他页面只链接。
- 系统总览见 [[afd-plugin-architecture]]（仓库架构）。

## 关键事实

- 源页：`knowledge/repos/afd-plugin/components/_index.md`（InferMatrixCopilot@ecfb84d0）；type: index；tags: afd-plugin, components；created: 2026-08-06；updated: 2026-08-06
- 来源：
  - afd-plugin@a432692:docs/design/module/index.md

### Owner 映射

- 所有路径已对照 `afd-plugin main @ a432692ed7d5dd6437a4755b530ee7aaf2685dad`。

| 遇到什么 | 查看哪里 | 主源码范围 | 主要验证 |
|---|---|---|---|
| 注册、配置、CPU-safe import、worker class 选择 | [[plugin-boundary-overview]]（plugin-boundary） | `afd_plugin/{__init__,config,config_utils,envs,validation}.py`、lazy exports、`pyproject.toml` | config、package、env、classpath tests |
| API 请求、Attention worker/runner、KV 与输出路径 | [[attention-runtime-overview]]（attention-runtime） | Attention worker/runner 和 GPU ubatch wrapper | Attention unit、serving/accuracy E2E |
| connector 驱动的 FFN daemon 和 runner | [[ffn-runtime-overview]]（ffn-runtime） | FFN worker/runner | FFN/engine-core unit、serving E2E |
| 拓扑、payload、通信和连接生命周期 | [[connectors-overview]]（connectors） | `afd_plugin/connectors/**`、`distributed/**` | connector/distributed unit、TP/model E2E |
| 模型注册、角色构造/加载、forward metadata | [[model-integration-overview]]（model-integration） | `afd_plugin/model_executor/**` | model unit、model/accuracy E2E |
| CUDA/Ascend graph、DBO/ubatching、profiling、native ops/build | [[execution-platforms-overview]]（execution-platforms） | 平台 helper、`csrc/**`、`setup.py`、`MANIFEST.in` | graph/DBO/ops/profiler unit 与硬件 E2E |
| vLLM/vLLM-Ascend adapter 和 monkey patch | [[compatibility-overview]]（compatibility） | `afd_plugin/compat/**` 中非平台机制文件 | compat/package/classpath/NPU tests |
