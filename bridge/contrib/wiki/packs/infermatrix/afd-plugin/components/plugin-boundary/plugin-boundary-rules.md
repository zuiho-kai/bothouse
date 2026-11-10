---
name: plugin-boundary-rules
description: AFD plugin boundary 规则 AFD-2b…AFD-2d，公开激活与 worker 选择面唯一、connector 私有配置由 connector 拥有、non-AFD 和 CPU-safe 路径隔离
metadata:
  scope: 只收 plugin boundary 的硬门禁 AFD-2b、AFD-2c、AFD-2d（激活与 worker 选择面、connector 私有配置、non-AFD/CPU-safe 隔离）；数据流归 plugin-boundary-architecture，仓库级规则归 afd-plugin-rules
---
# AFD plugin boundary 规则

## 现状

- 这些规则从 [[afd-plugin-rules]]（仓库规则） 迁入最近 owner，保留原有稳定 ID。
- 数据流和注册顺序见 [[plugin-boundary-architecture]]（architecture），全仓库版本/硬件声明见 [[afd-plugin-rules]]（仓库规则）。

## 关键事实

- 源页：`knowledge/repos/afd-plugin/components/plugin-boundary/rules.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: afd-plugin, components, plugin-boundary, config；created: 2026-08-06；updated: 2026-08-06
- 来源：
  - afd-plugin@a432692:README.md
  - afd-plugin@a432692:afd_plugin/config.py
  - afd-plugin@a432692:afd_plugin/validation.py
  - afd-plugin@a432692:docs/design/module/plugin_boundary.md
- 置信度（confidence）：high

- [AFD-2b] 公开激活与 worker 选择面唯一
  - 触发：新增启动参数、注册入口、worker class 或 model wrapper。
  - 必须通过 `vllm.general_plugins`、`VLLM_PLUGINS`、`additional_config["afd"]`、自动 role worker、plugin-owned model wrapper 和窄 compatibility shim 组装 AFD。
  - 禁止新建独立 `--afd-config` 或把内部 worker class path 当作稳定第三方 API。新命令应省略 `--worker-cls`。
  - 验收：四个 role/platform 自动映射、显式兼容路径、非 AFD control 和错误 class path 都有 focused tests。
- [AFD-2c] connector 私有配置必须由 connector 拥有
  - 触发：新增或修改 AFD/connector 配置字段。
  - connector-specific 字段必须进入 `additional_config["afd"]["connector_extra_config"]`，并由对应 connector parser 进行 closed-schema 校验。
  - 未知 AFD 顶层字段和未知 connector 字段必须报错，不得静默透传、过滤或降级。
  - 验收：默认值、alias/canonical 冲突、非法类型、unknown key 和每个 connector 的合法/非法 schema 都有解析测试。
- [AFD-2d] non-AFD 和 CPU-safe 路径必须隔离
  - 触发：修改 package import、注册、自动 worker 选择或 Ascend bootstrap。
  - 没有 `additional_config["afd"]` 时，非 AFD 请求、worker、模型和上游 vLLM 行为必须保持不变。
  - 通用 plugin hook 不得导入 Ascend runtime；Ascend patch 只能在 AFD NPU 配置构建或 NPU worker 启动后应用。
  - 验收：无 vLLM/无设备依赖的 import/config 测试、non-AFD regression 和 Ascend lazy-import 测试都通过。
