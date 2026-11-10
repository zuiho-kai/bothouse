---
name: feature-multimodal
description: 多模态理解与媒体配置的职责边界、complete_multimodal_model_configured 等入口、models 下 model_config 回退优先级、媒体工具设计取舍与验证方法
metadata:
  scope: 只收多模态理解与媒体配置的功能概览（职责、入口、配置、取舍、验证）；实现深读归 feature-depth-multimodal
---
# 多模态理解与媒体配置 的职责、接口与配置

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/agents-team/feature-multimodal.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/multimodal_config.py；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/image_tools.py
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:docs/zh/Harness.md
- 源页字段（feature）：multimodal
- 入口（entry_points）：jiuwenswarm/agents/harness/common/tools/multimodal_config.py；jiuwenswarm/agents/harness/common/tools/image_tools.py
- 源页字段（source_globs）：jiuwenswarm/agents/harness/common/tools/multimodal_config.py；jiuwenswarm/agents/harness/common/tools/image_tools.py；jiuwenswarm/agents/harness/common/tools/*；jiuwenswarm/channels/web/frontend/src/features/settings/modules/agent/AgentSettings.css
  - jiuwenswarm/channels/web/frontend/src/features/settings/modules/agent/AgentSettings.tsx；jiuwenswarm/agents/harness/common/tools/audio_tools.py；jiuwenswarm/server/runtime/image_modality_warmup.py
  - jiuwenswarm/channels/web/frontend/src/features/settings/modules/agent/mediaCapabilities.ts；jiuwenswarm/channels/web/frontend/src/features/settings/modules/agent/mediaModelConfig.ts；jiuwenswarm/common/media_capability_config.py
  - jiuwenswarm/agents/harness/common/rails/multimodal_image_rail.py；jiuwenswarm/agents/harness/common/prompt/user_prompt_builder.py；jiuwenswarm/server/runtime/agent_adapter/interface_deep.py；jiuwenswarm/agents/swarm/providers/tools.py
  - jiuwenswarm/agents/harness/common/tools/video_tools.py；jiuwenswarm/agents/harness/common/tools/visual_gen_tools.py；jiuwenswarm/channels/web/frontend/src/components/ChatPanel/InputArea.tsx
  - jiuwenswarm/channels/web/frontend/src/features/settings/modules/agent/MediaModelConfigDialog.tsx；jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/image_reading_tool.py
- 本页是该功能的基本知识入口，基线 `f0a69728c96b`。它连接源码契约与上游功能文档；详细字段和行为仍沿固定引用核对。

### 职责与边界

- 图片、音频和视频理解通过媒体工具与模型能力配置接入。工具已装配、媒体文件可读取和模型支持该媒体类型是不同条件。 本页记录入口职责与边界；逐文件的类型、函数和依赖关系见同 owner 的源码接口记录。
- 源码与文档：[jiuwenswarm/agents/harness/common/tools/multimodal_config.py:L1–L314](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/multimodal_config.py#L1-L314)；
  - [jiuwenswarm/agents/harness/common/tools/image_tools.py:L1–L506](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/image_tools.py#L1-L506)；
  - [docs/zh/Harness.md:L1–L626](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/Harness.md#L1-L626)。

### 接口与调用入口（API）

- 可定位的实现声明包括 `complete_multimodal_model_configured(config_base, model_type)`；`multimodal_model_enabled(config_base, model_type)`；`apply_audio_model_config_from_yaml(config_base)`；`apply_vision_model_config_from_yaml(config_base)`；`apply_video_model_config_from_yaml(config_base)`。
  - 这些是源码定位入口，具体公共用户操作沿功能文档查证；本页不把内部符号直接当成稳定 HTTP API。参数、返回类型、错误传播和生命周期应在所列实现与调用方一起核对。
- 源码与文档：[jiuwenswarm/agents/harness/common/tools/multimodal_config.py:L1–L314](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/multimodal_config.py#L1-L314)；
  - [jiuwenswarm/agents/harness/common/tools/image_tools.py:L1–L506](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/image_tools.py#L1-L506)；
  - [docs/zh/Harness.md:L1–L626](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/Harness.md#L1-L626)。

### 配置入口与生效条件

- multimodal_config 的优先级是 models 下对应媒体类型的 model_config 或 model_client_config，再取 embed 的媒体模型及共享地址、认证，最后回落到环境配置。vision、audio、video 的完整配置校验独立于主模型；工具装配还要确认文件可读和模型具备对应输入能力。
- 源码与文档：[jiuwenswarm/agents/harness/common/tools/multimodal_config.py:L1–L314](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/multimodal_config.py#L1-L314)；
  - [jiuwenswarm/agents/harness/common/tools/image_tools.py:L1–L506](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/image_tools.py#L1-L506)；
  - [docs/zh/Harness.md:L1–L626](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/Harness.md#L1-L626)。

### 设计取舍

- **设计推断**：媒体工具把 OCR、视觉问答、音频与视频理解接到模型能力配置，便于选择专业工具；代价是媒体读取、格式与模型支持共同决定成功。read_file 的原生图片输入与返回元数据后调用视觉工具是不同路径，需要按启用配置验证。以上分析从所列接口与功能边界得出，不宣称作者曾评估所有替代方案。
- 源码与文档：[jiuwenswarm/agents/harness/common/tools/multimodal_config.py:L1–L314](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/multimodal_config.py#L1-L314)；
  - [jiuwenswarm/agents/harness/common/tools/image_tools.py:L1–L506](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/image_tools.py#L1-L506)；
  - [docs/zh/Harness.md:L1–L626](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/Harness.md#L1-L626)。

### 数据流与关联功能

- 图片、音频和视频理解通过媒体工具与模型能力配置接入。工具已装配、媒体文件可读取和模型支持该媒体类型是不同条件。 联调时结合[[feature-models]]（模型平台与 API 配置）、[[feature-video-duplex]]（音视频双工扩展）、[[feature-browser-tools]]（浏览器服务与网页工具）的入口、数据归属和生效条件查证；这些关联页解释不同阶段，不能只凭一项成功判定整个链路完成。
- 源码与文档：[jiuwenswarm/agents/harness/common/tools/multimodal_config.py:L1–L314](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/multimodal_config.py#L1-L314)；
  - [jiuwenswarm/agents/harness/common/tools/image_tools.py:L1–L506](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/image_tools.py#L1-L506)；
  - [docs/zh/Harness.md:L1–L626](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/Harness.md#L1-L626)。

### 怎样验证

- 用本地和 HTTP 媒体分别验证读取与工具调用，核对模型路由、输出和错误。覆盖缺少媒体模型、损坏文件、不可达 URL 与权限拒绝，并检查原生图片输入开关对 read_file 结果的影响。这些是建议的验收步骤，本页没有记录上游运行测试已执行或已通过。
- 源码与文档：[jiuwenswarm/agents/harness/common/tools/multimodal_config.py:L1–L314](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/multimodal_config.py#L1-L314)；
  - [jiuwenswarm/agents/harness/common/tools/image_tools.py:L1–L506](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/image_tools.py#L1-L506)；
  - [docs/zh/Harness.md:L1–L626](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/Harness.md#L1-L626)。
