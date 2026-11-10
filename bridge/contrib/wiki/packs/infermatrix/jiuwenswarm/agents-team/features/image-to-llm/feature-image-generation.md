---
name: feature-image-generation
description: 图片生成工具 generate_image 的职责、接口、models.image_gen 配置、设计取舍与验证方法（image_tools.py、multimodal_config.py、配置信息文档）
metadata:
  scope: 只收图片生成与产物落盘的功能概览（guide）；调用链、默认值、异常分支与单测等实现细节归 feature-depth-image-generation
---
# 图片生成与产物落盘的职责、接口与配置

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/agents-team/feature-image-generation.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/image_tools.py；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/multimodal_config.py
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:docs/zh/配置信息.md
- 源页字段（feature）：image-generation
- 入口（entry_points）：jiuwenswarm/agents/harness/common/tools/image_tools.py；jiuwenswarm/agents/harness/common/tools/multimodal_config.py
- 源页字段（source_globs）：jiuwenswarm/agents/harness/common/tools/image_tools.py；jiuwenswarm/agents/harness/common/tools/multimodal_config.py；jiuwenswarm/resources/agent/workspace/skills/baoyu-image-gen/scripts/build-batch.ts
  - jiuwenswarm/resources/agent/workspace/skills/baoyu-image-gen/scripts/providers/agnes.ts；jiuwenswarm/resources/agent/workspace/skills/baoyu-image-gen/scripts/providers/azure.ts；jiuwenswarm/resources/agent/workspace/skills/baoyu-image-gen/scripts/main.ts
  - jiuwenswarm/resources/agent/workspace/skills/baoyu-image-gen/scripts/providers/codex-cli.ts；jiuwenswarm/resources/agent/workspace/skills/baoyu-image-gen/scripts/providers/dashscope.ts；jiuwenswarm/resources/agent/workspace/skills/baoyu-image-gen/scripts/providers/google.ts
  - jiuwenswarm/resources/agent/workspace/skills/baoyu-image-gen/scripts/providers/jimeng.ts；jiuwenswarm/resources/agent/workspace/skills/baoyu-image-gen/scripts/providers/minimax.ts；jiuwenswarm/resources/agent/workspace/skills/baoyu-image-gen/scripts/codex-imagegen/cache.ts
  - jiuwenswarm/resources/agent/workspace/skills/baoyu-image-gen/scripts/codex-imagegen/main.ts；jiuwenswarm/resources/agent/workspace/skills/baoyu-image-gen/scripts/codex-imagegen/types.ts；jiuwenswarm/resources/agent/workspace/skills/baoyu-image-gen/scripts/types.ts
  - jiuwenswarm/resources/agent/workspace/skills/baoyu-image-gen/scripts/providers/openrouter.ts；jiuwenswarm/resources/agent/workspace/skills/baoyu-image-gen/scripts/providers/replicate.ts；jiuwenswarm/resources/agent/workspace/skills/baoyu-image-gen/scripts/providers/seedream.ts
  - jiuwenswarm/resources/agent/workspace/skills/baoyu-image-gen/scripts/providers/zai.ts
- 本页提供该能力的基本知识与验证入口，固定基线 `f0a69728c96b`。

### 职责与边界

- 图片生成工具使用独立 image_gen 模型配置，将文本提示交给模型后返回生成文件路径或错误消息。它与 OCR 和视觉问答的输入输出方向不同：理解工具读取已有图片，生成工具创建新产物，模型配置和输出落盘都需要各自验证。
- 源码与文档：[jiuwenswarm/agents/harness/common/tools/image_tools.py:L1–L506](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/image_tools.py#L1-L506)；
  - [jiuwenswarm/agents/harness/common/tools/multimodal_config.py:L1–L314](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/multimodal_config.py#L1-L314)；
  - [docs/zh/配置信息.md:L1–L638](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E9%85%8D%E7%BD%AE%E4%BF%A1%E6%81%AF.md#L1-L638)。

### 接口与调用入口（API）

- generate_image(prompt, size, quality, save_dir) 是源码公开异步入口，prompt 描述内容，size 与 quality 指定请求规格，save_dir 控制产物目录。实现调用 _invoke_model_image_generation，并沿 apply_image_gen_model_config_from_yaml 读取配置；返回文本中的文件路径不能直接视作网络 URL。
- 源码与文档：[jiuwenswarm/agents/harness/common/tools/image_tools.py:L1–L506](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/image_tools.py#L1-L506)；
  - [jiuwenswarm/agents/harness/common/tools/multimodal_config.py:L1–L314](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/multimodal_config.py#L1-L314)；
  - [docs/zh/配置信息.md:L1–L638](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E9%85%8D%E7%BD%AE%E4%BF%A1%E6%81%AF.md#L1-L638)。

### 配置入口与生效条件

- 上游配置文档将 models.image_gen 作为图片生成模型入口，主配置还允许 IMAGE_GEN_API_BASE 等环境配置。当前前端文档说明生成模型不在旧配置面板展示，实际界面应按当前版本核对；地址、认证、模型及 provider 必须属于生成服务，默认聊天或视觉理解配置不能替代。
- 源码与文档：[jiuwenswarm/agents/harness/common/tools/image_tools.py:L1–L506](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/image_tools.py#L1-L506)；
  - [jiuwenswarm/agents/harness/common/tools/multimodal_config.py:L1–L314](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/multimodal_config.py#L1-L314)；
  - [docs/zh/配置信息.md:L1–L638](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E9%85%8D%E7%BD%AE%E4%BF%A1%E6%81%AF.md#L1-L638)。

### 设计取舍

- **设计推断**：独立生成模型允许选择具备生成能力的 provider，代价是图片理解和图片生成要维护不同请求契约。文件落盘便于后续任务引用，但还需要宿主展示、文件权限与输出交付；收到模型成功响应不保证产物能在用户界面读取。
- 源码与文档：[jiuwenswarm/agents/harness/common/tools/image_tools.py:L1–L506](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/image_tools.py#L1-L506)；
  - [jiuwenswarm/agents/harness/common/tools/multimodal_config.py:L1–L314](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/multimodal_config.py#L1-L314)；
  - [docs/zh/配置信息.md:L1–L638](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E9%85%8D%E7%BD%AE%E4%BF%A1%E6%81%AF.md#L1-L638)。

### 数据流与关联功能

- 文本描述经生成模型变为图片产物，再由调用方使用返回路径查看或交付。该链路关联模型管理、媒体工具和工作区文件访问，与生成式 A2UI 的组件消息有不同格式；生成图片不是创建可交互表单。
- 源码与文档：[jiuwenswarm/agents/harness/common/tools/image_tools.py:L1–L506](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/image_tools.py#L1-L506)；
  - [jiuwenswarm/agents/harness/common/tools/multimodal_config.py:L1–L314](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/multimodal_config.py#L1-L314)；
  - [docs/zh/配置信息.md:L1–L638](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E9%85%8D%E7%BD%AE%E4%BF%A1%E6%81%AF.md#L1-L638)。

### 怎样验证

- 使用支持的 size 与 quality 生成一个小图片，检查实际文件、格式与返回路径，再由宿主展示或读取。覆盖缺少生成配置、模型拒绝、不支持规格、保存失败和工作区权限；本页未运行上游模型请求，也未声明服务效果已验证。
- 源码与文档：[jiuwenswarm/agents/harness/common/tools/image_tools.py:L1–L506](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/image_tools.py#L1-L506)；
  - [jiuwenswarm/agents/harness/common/tools/multimodal_config.py:L1–L314](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/multimodal_config.py#L1-L314)；
  - [docs/zh/配置信息.md:L1–L638](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E9%85%8D%E7%BD%AE%E4%BF%A1%E6%81%AF.md#L1-L638)。
