---
name: plugin-boundary-overview
description: AFD plugin boundary 入口总览，含什么时候查这里、不放什么、Owner 凭证（基线、主源码、输入、输出、验证、影响）和目录内容
metadata:
  scope: 只收源目录 components/plugin-boundary 索引页里的使用时机、收录边界、Owner 凭证和入口说明；架构归 plugin-boundary-architecture，硬门禁归 plugin-boundary-rules
---
# AFD plugin boundary 入口

## 现状

- 什么时候查这里：
  - 修改插件注册、AFD 配置 schema、alias、验证、CPU-safe import 或自动 worker 选择。
  - 调查为什么 AFD 未激活、选错 worker，或非 AFD 路径被插件污染。
- 不放什么：
  - monkey patch 具体差异放 [[compatibility-overview]]（compatibility）。
  - connector 私有 schema 和通信资源放 [[connectors-overview]]（connectors）。

## 关键事实

- 源页：`knowledge/repos/afd-plugin/components/plugin-boundary/_index.md`（InferMatrixCopilot@ecfb84d0）；type: index；tags: afd-plugin, components, plugin-boundary, config；created: 2026-08-06；updated: 2026-08-06
- 来源：
  - afd-plugin@a432692:docs/design/module/plugin_boundary.md

### Owner 凭证

- 基线：`afd-plugin main @ a432692ed7d5dd6437a4755b530ee7aaf2685dad`。
- 主源码：`afd_plugin/__init__.py`、`config.py`、`config_utils.py`、`envs.py`、`validation.py`、`py.typed`、`afd_plugin/v1/__init__.py`、两层 worker `__init__.py`、`pyproject.toml`。
- 输入：`VllmConfig.additional_config["afd"]`、平台、role 和 worker selection state。
- 输出：类型化 `AFDConfig`、已验证的 runtime wiring、lazy model/worker 注册。
- 验证：`tests/unit/config/**`、`tests/unit/package/test_package.py`、`tests/unit/test_envs.py`、`tests/unit/v1/worker/test_runtime_classpaths.py`。
- 影响：所有 AFD 角色、connector、模型和平台路径。

### 目录内容

| 遇到什么 | 查看哪里 | 说明 |
|---|---|---|
| 理解注册、配置和 worker 选择 | [[plugin-boundary-architecture]]（architecture） | 当前 normative boundary |
| 审查新配置或启动入口 | [[plugin-boundary-rules]]（rules） | `AFD-2b`–`AFD-2d` 硬门禁 |
| 理解整体依赖方向 | [[afd-plugin-architecture]]（仓库架构） | 七 owner 系统图 |
