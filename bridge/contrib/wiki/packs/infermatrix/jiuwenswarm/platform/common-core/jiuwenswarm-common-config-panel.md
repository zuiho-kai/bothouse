---
name: jiuwenswarm-common-config-panel
description: 配置面板 handler（config_panel）：Web 与 TUI 侧 config/models handler 的入口与关键文件，provider 归一化与 reasoning 档位的序列化和归一规则
metadata:
  scope: 收 common/config_panel 与 reasoning_config.py 的说明，来源另含 test_reasoning_config.py；handler 最终落盘的持久化入口归 jiuwenswarm-common-2，config.yaml 写事务门禁归 common-core-rules
---
# 配置面板 handler（config_panel）

## 现状

- 承载 Web 侧和 TUI 侧 config / models 域的 handler 实现，从 gateway 的 app_web_handlers 和 tui_connect 迁出。AgentServer 进程里的 ConfigAdapter 和 gateway 共用这一份实现，只维护一处代码。
- **入口**
- `jiuwenswarm/common/config_panel/config_set_handlers.py` — Web 侧入口，register_config_set_handlers 在 channel 上注册 config.set / config.save_all；apply_config_payload 负责写盘（.env 等）
- `jiuwenswarm/common/config_panel/models_handlers.py` — Web 侧入口，register_models_handlers 注册 models.list / models.replace_all / config.validate_model / models.validate
- `jiuwenswarm/common/config_panel/tui_models_handlers.py` — TUI 侧入口，register_tui_config_handlers 注册 config.get / config.set / config.validate_model / models.list，以及 TUI 专属的 command
- **关键文件**
- `jiuwenswarm/common/config_panel/config_set_handlers.py` — ConfigChangeSet 和 ConfigApplyResult 表示一次改动的结果（改了哪些键、要重载哪些范围）；flatten_* / build_*_config_update 负责 symphony、skill retrieval
- `jiuwenswarm/common/config_panel/models_handlers.py` — 处理模型列表：前端传入的模型转成默认配置、replace_all 时的合并、环境变量占位符比较、provider 规范化、reasoning level 序列化；ConfigPanelBadRequest 是请求错误
- `jiuwenswarm/common/config_panel/tui_models_handlers.py` — TUI 契约与 Web 侧不一致，文件头明确禁止合并；包含 build_config_schema、Auto-Harness 的 git 用户与 gitcode token 设置、模型增删改和切换，以及后台重载配置
- **相关文档**
- `docs/zh/E2A-protocol.md` — 改动涉及 AgentOS 多用户的 E2A 代理分叉时读。这部分由 gateway 侧的 _register_config_proxy 包装，本模块只提供本地 handler
- `docs/zh/AutoHarness.md` — 改动 TUI 侧 Auto-Harness 配置项（git user、gitcode token）时读
- `docs/zh/AgentTeam.md` — 改动 modes team 配置的展开，或 team 相关的 codex 请求判断时读
- `TESTING.md` — 给 config / models handler 补测试时参考；文中有过期路径，先看 tests/ 下已有用例
- **路由**
- `jiuwenswarm/common/config_panel/`

### 模型规范化与 reasoning 档位

- provider 归一化在 `normalize_provider_value`：任意大小写按 `ProviderType` 枚举值映射为规范大小写，查不到就原样返回；
  - 这是为了与 TUI 侧 `tui_connect._normalize_provider_value` 对齐，避免同一份历史配置在 TUI 能识别、Web 的"测试/保存"因大小写敏感被误判非法（[models_handlers.py L127-L141](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/config_panel/models_handlers.py#L127-L141)）。
- reasoning 档位的持久化形态有两层防御：读取侧 `reasoning_level_display` 把 YAML 1.1 加载器解析成布尔的裸 `on`/`off` 标量映射回字符串；
  - 写入侧 `_serialize_reasoning_level` 对非空值输出 DoubleQuotedScalarString，None/空白返回 None，同一字段绝不往返成"有时裸标量、有时带引号"的混合形态（[models_handlers.py L95-L118](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/config_panel/models_handlers.py#L95-L118)）。
  - `build_models_defaults_from_frontend` 保存前统一走共享的 `validate_reasoning_level_for_model`，此转换入口调用共享的 core 能力校验；其它保存入口仍需检查是否调用了该 helper（[L53](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/config_panel/models_handlers.py#L53)、
  - [L440](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/config_panel/models_handlers.py#L440)）。
- `jiuwenswarm/common/reasoning_config.py` 提供档位语义：`normalize_reasoning_level` 把别名（`none/false/disabled→off`、`true/enabled→on`、`minimum→minimal`、`med/mid→medium`、`extra_high→xhigh`、`maximum/ultra→max`）归一到 8 个 canonical 值；
  - `reasoning_config_for_level` 转成 core 的 provider-neutral 配置（off→`{"mode":"disabled"}`，on→`{"mode":"enabled"}`，其余→`{"mode":"enabled","effort":<level>}`）。
  - `validate_reasoning_level_for_model` 只把 None/空白视为未设置（裸 `off` 被 YAML 1.1 读成 False 时会走归一化变成 `"off"` 而不是被清空），能力查询异常统一转 `ValueError` 让保存路径返回可读的 BAD_REQUEST 而非 500；
  - `effective_endpoint_profile` 显式 `endpoint_profile` 永远优先，否则查用户配置的 host 覆盖表，源码不内置任何 host（[reasoning_config.py L80-L112](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/reasoning_config.py#L80-L112)、
  - [L120-L171](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/reasoning_config.py#L120-L171)；
  - 选择器 `test_reasoning_level_aliases_are_canonicalized`、`test_validate_reasoning_level_normalizes_legacy_yaml_booleans`，[test_reasoning_config.py L35-L44](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/test_reasoning_config.py#L35-L44)、
  - [L176-L210](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/test_reasoning_config.py#L176-L210)）。

### 相关组件知识

- [[jiuwenswarm-common-1]]、[[jiuwenswarm-common-2]]（jiuwenswarm/common/：公共基础模块） — 本页 handler 最终落盘所用的 `update_config` / `save_models_candidate` 等持久化入口
- [[jiuwenswarm-channels-cli]]（../gateway-channels/jiuwenswarm-channels-cli.md） — TUI 侧 channel 与本页 TUI 契约的边界（TUI 契约文件头明确禁止与 Web 侧合并）
- [[common-core-rules]]（common 审查规则） — handler 改动时的 config.yaml 写事务门禁

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/common-core/jiuwenswarm-common-config-panel.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-09-30；updated: 2026-10-01
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/common/config_panel/models_handlers.py；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/common/reasoning_config.py
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/test_reasoning_config.py
