---
name: feature-models
description: 模型平台与 API 配置：SelectionReference 与 ModelCatalog 入口，api_base/api_key/model_name/client_provider、alias、reasoning_level 配置语义，视觉/音频/视频/Embedding 分别配置，设计取舍与验证要点
metadata:
  scope: 只收模型目录与配置的职责边界、API、配置、设计取舍、数据流与验证要点；实现层深读归 feature-depth-models，MCP 配置归 feature-mcp
---
# 模型平台与 API 配置 的职责、接口与配置

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/common-core/feature-models.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/common/model_catalog.py；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/common/model_config_validation.py
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:docs/zh/配置信息.md
- 源页字段（feature）：models
- 入口（entry_points）：jiuwenswarm/common/model_catalog.py；jiuwenswarm/common/model_config_validation.py
- 源页字段（source_globs）：jiuwenswarm/common/model_catalog.py；jiuwenswarm/common/model_config_validation.py；jiuwenswarm/common/model*.py；jiuwenswarm/common/config_panel/config_set_handlers.py；jiuwenswarm/common/config_panel/models_handlers.py；jiuwenswarm/common/config_panel/tui_models_handlers.py
  - jiuwenswarm/common/config.py；jiuwenswarm/common/auth/apig.py；jiuwenswarm/channels/web/frontend/src/components/ChatPanel/ChatModelSelector.tsx；jiuwenswarm/channels/web/frontend/src/components/ChatPanel/ChatPanel.css；jiuwenswarm/server/agent_ws_server.py
  - jiuwenswarm/server/runtime/agent_adapter/interface_deep.py；jiuwenswarm/channels/web/frontend/src/features/settings/modules/models/ContextWindowField.tsx；jiuwenswarm/channels/web/frontend/src/features/settings/modules/models/contextWindow.ts
  - jiuwenswarm/channels/web/frontend/src/features/settings/modules/models/FreeModelsSettings.tsx；jiuwenswarm/server/control/config_service.py；jiuwenswarm/channels/web/frontend/src/features/settings/modules/agent/generationModels.ts；jiuwenswarm/llm_provider_compat_patch.py
  - jiuwenswarm/llm_sse_patch.py；jiuwenswarm/common/auth/model_catalog.py；jiuwenswarm/channels/web/frontend/src/features/settings/modules/models/FreeModelSettingsDialog.tsx；jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/validate_config.py
  - jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/config_writer.py；jiuwenswarm/server/runtime/model_compiler_adapter.py；jiuwenswarm/gateway/channel_manager/web/app_web_handlers.py
  - jiuwenswarm/channels/web/frontend/src/features/settings/modules/models/modelAdapters.ts；jiuwenswarm/channels/web/frontend/src/features/settings/modules/models/modelValidation.ts；jiuwenswarm/channels/web/frontend/src/features/settings/modules/models/modelListOperations.ts
  - jiuwenswarm/channels/web/frontend/src/components/ModelProviderIcon/index.css；jiuwenswarm/channels/web/frontend/src/components/ModelProviderIcon/index.tsx；jiuwenswarm/channels/web/frontend/src/assets/providers/index.ts
  - jiuwenswarm/channels/web/frontend/src/features/settings/modules/models/modelReasoning.ts；jiuwenswarm/common/model_selection.py；jiuwenswarm/common/model_errors.py；jiuwenswarm/common/model_migration.py；jiuwenswarm/server/runtime/model_routing_registry.py
  - jiuwenswarm/channels/web/frontend/src/features/modelSetupGuide/ModelSetupGuide.css；jiuwenswarm/channels/web/frontend/src/features/modelSetupGuide/ModelSetupGuide.tsx；jiuwenswarm/channels/web/frontend/src/features/modelSetupGuide/modelSetupGuideState.ts
  - jiuwenswarm/common/model_vendor_registry.py；jiuwenswarm/channels/web/frontend/src/features/settings/modules/models/definition.ts；jiuwenswarm/channels/web/frontend/src/features/settings/modules/models/index.ts；jiuwenswarm/common/openrouter_attribution.py
  - jiuwenswarm/common/reasoning_config.py；jiuwenswarm/common/reasoning_injector.py；jiuwenswarm/agents/harness/common/rsi/model_resolver.py；jiuwenswarm/channels/web/frontend/src/features/rsi/components/CreateExperimentDialog.tsx；jiuwenswarm/runtime/model_catalog.py
  - jiuwenswarm/runtime/service.py；jiuwenswarm/channels/web/frontend/src/features/settings/services/settingsContract.ts；jiuwenswarm/channels/web/frontend/src/features/settings/services/useSettingsConfig.ts；jiuwenswarm/channels/tui/frontend/src/app-state.ts
  - jiuwenswarm/channels/tui/frontend/src/ui/app-screen.ts；jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/model.ts；jiuwenswarm/channels/web/frontend/src/stores/sessionStore.ts；jiuwenswarm/channels/web/frontend/src/components/form/components/Form.tsx
  - jiuwenswarm/channels/web/frontend/src/components/form/components/FormDialog.tsx；jiuwenswarm/channels/web/frontend/src/components/form/core/FormStore.ts；jiuwenswarm/channels/web/frontend/src/components/form/hooks/useForm.ts
  - jiuwenswarm/channels/web/frontend/src/components/form/hooks/useFormState.ts；jiuwenswarm/channels/web/frontend/src/components/form/index.ts；jiuwenswarm/channels/web/frontend/src/components/form/types.ts
  - jiuwenswarm/channels/web/frontend/src/features/settings/modules/channels/forms/FeishuChannelForm.tsx；jiuwenswarm/channels/web/frontend/src/features/settings/modules/channels/forms/StandardChannelForm.tsx
  - jiuwenswarm/channels/web/frontend/src/features/settings/modules/channels/useSettingsChannelsController.ts；jiuwenswarm/channels/web/frontend/src/features/free-models/campaign.ts；jiuwenswarm/channels/web/frontend/src/features/free-models/chatError.ts
  - jiuwenswarm/channels/web/frontend/src/features/free-models/points.ts；jiuwenswarm/channels/web/frontend/src/features/free-models/quotaReset.ts；jiuwenswarm/channels/web/frontend/src/features/settings/modules/agent/GenerationModelConfigDialog.tsx
  - jiuwenswarm/channels/web/frontend/src/features/settings/modules/models/ModelDialog.tsx；jiuwenswarm/channels/web/frontend/src/features/settings/modules/models/ModelNameField.tsx；jiuwenswarm/channels/web/frontend/src/components/ModelPicker/index.tsx
  - jiuwenswarm/channels/web/frontend/src/features/settings/modules/models/ModelProviderSelect.tsx；jiuwenswarm/channels/web/frontend/src/App.tsx；jiuwenswarm/channels/web/frontend/src/features/settings/modules/models/ModelsSettings.tsx；jiuwenswarm/gateway/app_gateway.py
- 本页是该功能的基本知识入口，基线 `f0a69728c96b`。它连接源码契约与上游功能文档；详细字段和行为仍沿固定引用核对。

### 职责与边界

- 模型目录与校验把用户提供的模型平台参数转成运行时模型选择。配置保存、目录可见、认证有效和一次模型调用成功是不同验证层次。 本页记录入口职责与边界；逐文件的类型、函数和依赖关系见同 owner 的源码接口记录。
- 源码与文档：[jiuwenswarm/common/model_catalog.py:L1–L188](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/model_catalog.py#L1-L188)；
  - [jiuwenswarm/common/model_config_validation.py:L1–L278](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/model_config_validation.py#L1-L278)；
  - [docs/zh/配置信息.md:L1–L638](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E9%85%8D%E7%BD%AE%E4%BF%A1%E6%81%AF.md#L1-L638)。

### 接口与调用入口（API）

- 可定位的实现声明包括 `SelectionReference`；`ModelCatalog [get_model, get_group, list_public_models, get_public_model_detail, list_public_groups]`。这些是源码定位入口，具体公共用户操作沿功能文档查证；本页不把内部符号直接当成稳定 HTTP API。参数、返回类型、错误传播和生命周期应在所列实现与调用方一起核对。
- 源码与文档：[jiuwenswarm/common/model_catalog.py:L1–L188](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/model_catalog.py#L1-L188)；
  - [jiuwenswarm/common/model_config_validation.py:L1–L278](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/model_config_validation.py#L1-L278)；
  - [docs/zh/配置信息.md:L1–L638](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E9%85%8D%E7%BD%AE%E4%BF%A1%E6%81%AF.md#L1-L638)。

### 配置入口与生效条件

- 模型配置的 api_base、api_key、model_name 与 client_provider 分别定义地址、认证、模型 ID 和协议类型；前端 model、model_provider 保存时映射为后端名称。多模型条目还可带 alias 和 reasoning_level，默认对话模型需支持工具调用；视觉、音频、视频和 Embedding 分别配置及验证。
- 源码与文档：[jiuwenswarm/common/model_catalog.py:L1–L188](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/model_catalog.py#L1-L188)；
  - [jiuwenswarm/common/model_config_validation.py:L1–L278](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/model_config_validation.py#L1-L278)；
  - [docs/zh/配置信息.md:L1–L638](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E9%85%8D%E7%BD%AE%E4%BF%A1%E6%81%AF.md#L1-L638)。

### 设计取舍

- **设计推断**：模型目录与配置校验把多个平台和别名统一到运行选择，便于切换服务；代价是目录记录、配置持久化、认证和真实调用必须分别确认。视觉、音频与 Embedding 是独立能力配置，默认聊天模型可用不能证明它们全部可用。以上分析从所列接口与功能边界得出，不宣称作者曾评估所有替代方案。
- 源码与文档：[jiuwenswarm/common/model_catalog.py:L1–L188](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/model_catalog.py#L1-L188)；
  - [jiuwenswarm/common/model_config_validation.py:L1–L278](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/model_config_validation.py#L1-L278)；
  - [docs/zh/配置信息.md:L1–L638](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E9%85%8D%E7%BD%AE%E4%BF%A1%E6%81%AF.md#L1-L638)。

### 数据流与关联功能

- 模型目录与校验把用户提供的模型平台参数转成运行时模型选择。配置保存、目录可见、认证有效和一次模型调用成功是不同验证层次。 联调时结合[[feature-multimodal]]（多模态理解与媒体配置）、[[feature-login]]（账号登录与凭据续期）、[[feature-mcp]]（MCP 配置、凭据与资源）的入口、数据归属和生效条件查证；这些关联页解释不同阶段，不能只凭一项成功判定整个链路完成。
- 源码与文档：[jiuwenswarm/common/model_catalog.py:L1–L188](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/model_catalog.py#L1-L188)；
  - [jiuwenswarm/common/model_config_validation.py:L1–L278](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/model_config_validation.py#L1-L278)；
  - [docs/zh/配置信息.md:L1–L638](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E9%85%8D%E7%BD%AE%E4%BF%A1%E6%81%AF.md#L1-L638)。

### 怎样验证

- 新增模型及别名，检查参数校验、保存、目录读取和实际选择，再完成一次真实请求。覆盖无效平台、缺少认证、服务错误和禁用模型；对多模态与 Embedding 单独检查输入格式和路由。这些是建议的验收步骤，本页没有记录上游运行测试已执行或已通过。
- 源码与文档：[jiuwenswarm/common/model_catalog.py:L1–L188](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/model_catalog.py#L1-L188)；
  - [jiuwenswarm/common/model_config_validation.py:L1–L278](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/model_config_validation.py#L1-L278)；
  - [docs/zh/配置信息.md:L1–L638](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E9%85%8D%E7%BD%AE%E4%BF%A1%E6%81%AF.md#L1-L638)。
