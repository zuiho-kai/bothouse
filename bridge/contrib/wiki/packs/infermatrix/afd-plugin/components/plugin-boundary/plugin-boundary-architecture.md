---
name: plugin-boundary-architecture
description: AFD plugin boundary 架构，vllm.general_plugins 注册、公共 AFD 配置解析与 CPU-safe 校验、lazy exports、role/platform worker 选择的数据流和验证方式
metadata:
  scope: 只收 plugin boundary（注册、配置、校验、worker 选择）的架构、数据流和验证方式；patch 生命周期归 compatibility-architecture，硬门禁归 plugin-boundary-rules
---
# AFD plugin boundary 架构

## 现状

### 职责和边界

- 本 owner 负责 `vllm.general_plugins` 注册、公共 AFD 配置、CPU-safe 校验、lazy exports 和 role/platform worker 选择。
- 它是 AFD 最低共享层，不得在 package/config/validation import 时引入 CUDA、Ascend 或 vLLM worker 重依赖。
- 具体 patch 生命周期由 [[compatibility-architecture]]（compatibility） 拥有。

### 数据怎样流动

```text
vLLM discovers register_afd()
  -> non-strict pinned-version check
  -> best-effort core compatibility bootstrap
  -> required ModelRegistry aliases
  -> parse additional_config["afd"]
  -> connector-owned extra schema validation
  -> upstream platform normalization
  -> role/platform AFD worker selection
  -> device runtime imports only after executor resolves the class path
```

- `additional_config["afd"]` 的 namespace presence 是激活信号。
- 未知顶层 key 拒绝；connector-specific 字段只能位于 `connector_extra_config`并由选中 connector 的 closed parser 解析。
- 新命令使用 `worker_cls="auto"`，显式 class path 只保留旧命令兼容。
- Ascend-specific patch 延迟到 AFD NPU 配置构建或 NPU worker 启动，以保证通用 plugin hook 在 CPU/CUDA-only 进程中不导入 vLLM-Ascend。
- 无 AFD namespace 时，非 AFD worker 和 model registry lookup 必须保持上游行为。

## 关键事实

- 源页：`knowledge/repos/afd-plugin/components/plugin-boundary/architecture.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: afd-plugin, components, plugin-boundary, config；created: 2026-08-06；updated: 2026-08-06
- 来源：
  - afd-plugin@a432692:afd_plugin/__init__.py
  - afd-plugin@a432692:afd_plugin/config.py
  - afd-plugin@a432692:afd_plugin/validation.py
  - afd-plugin@a432692:docs/design/module/plugin_boundary.md
- 置信度（confidence）：high

### 主要源码和调用入口

- `pyproject.toml` 在 `vllm.general_plugins` 下注册 `afd = "afd_plugin:register_afd"`。
- `afd_plugin/__init__.py::register_afd()` 执行版本检查、core patch import、DBO yield op 和 model registry 注册。
- `config.py` / `config_utils.py` 解析 `additional_config["afd"]`、兼容 alias 与 connector envelope。
- `validation.py` 校验 role、connector、拓扑、endpoint 和 worker class wiring。

### 怎样验证

- 运行 config/package/env/classpath 单测，并同时覆盖 AFD 与 non-AFD control。
- 变更启动面时还要验证 role/platform 映射、显式 worker 保留、错误在通信资源创建前暴露。
- 硬门禁见 [[plugin-boundary-rules]]（rules），平台组合见 [[execution-platforms-architecture]]（execution-platforms）。
