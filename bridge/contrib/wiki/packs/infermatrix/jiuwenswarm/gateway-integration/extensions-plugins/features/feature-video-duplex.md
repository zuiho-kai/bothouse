---
name: feature-video-duplex
description: 音视频双工扩展功能知识入口：职责与边界、VoiceAgentTaskRail 与 task_checkpoint 等接口入口、插件元数据配置键、设计取舍、关联功能与验收步骤
metadata:
  scope: 只收音视频双工扩展的功能概览与六个 facet 摘要；task_checkpoint 与语音端点的实现证据归 feature-depth-video-duplex
---
# 音视频双工扩展 的职责、接口与配置

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/extensions-plugins/feature-video-duplex.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/extensions/video_duplex/backend/tasks/rail.py；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:docs/zh/application-plugins.md
- 源页字段（feature）：video-duplex
- 入口（entry_points）：jiuwenswarm/extensions/video_duplex/backend/tasks/rail.py
- 源页字段（source_globs）：jiuwenswarm/extensions/video_duplex/backend/tasks/rail.py；jiuwenswarm/extensions/video_duplex/*；jiuwenswarm/extensions/video_duplex/backend/video_search.py；jiuwenswarm/extensions/video_duplex/frontend/VideoLivePanel/index.tsx
  - jiuwenswarm/extensions/video_duplex/backend/video_live.py；jiuwenswarm/extensions/video_duplex/frontend/VideoLivePanel/joyaiPromptLifecycle.ts；jiuwenswarm/extensions/video_duplex/frontend/VideoLivePanel/joyaiProvider.ts
  - jiuwenswarm/extensions/video_duplex/frontend/VideoLivePanel/joyaiToolContext.ts；jiuwenswarm/extensions/video_duplex/frontend/VideoLivePanel/joyaiVoice.ts；jiuwenswarm/extensions/video_duplex/backend/joyai_provider.py
  - jiuwenswarm/extensions/video_duplex/frontend/VideoLivePanel/qwenOmniProtocol.ts；jiuwenswarm/extensions/video_duplex/frontend/VideoLivePanel/qwenOmniSession.ts；jiuwenswarm/extensions/video_duplex/frontend/VideoLivePanel/qwenOmniTools.ts
  - jiuwenswarm/extensions/video_duplex/frontend/VideoLivePanel/videoSource.ts；jiuwenswarm/extensions/video_duplex/frontend/VideoLivePanel/searchPresentation.ts；jiuwenswarm/channels/web/frontend/src/features/settings/modules/experimental/ExperimentalSettings.tsx
  - jiuwenswarm/channels/web/frontend/src/features/settings/modules/experimental/VideoDuplexModelSettings.tsx；jiuwenswarm/channels/web/frontend/src/features/settings/modules/experimental/definition.ts；jiuwenswarm/extensions/video_duplex/frontend/index.tsx
  - jiuwenswarm/extensions/video_duplex/frontend/VideoLivePanel/types.ts；jiuwenswarm/extensions/video_duplex/backend/video_files.py；jiuwenswarm/extensions/video_duplex/backend/tasks/server_adapter.py；jiuwenswarm/extensions/video_duplex/backend/tasks/store.py
  - jiuwenswarm/extensions/video_duplex/frontend/VideoLivePanel/replyLanguage.ts；jiuwenswarm/extensions/video_duplex/frontend/VideoLivePanel/taskPrompts.ts
- 本页是该功能的基本知识入口，基线 `f0a69728c96b`。它连接源码契约与上游功能文档；详细字段和行为仍沿固定引用核对。

### 职责与边界

- 音视频扩展具有自己的前端组件和后端任务处理。媒体连接、运行任务与插件启用状态之间有多重生命周期，实际设备和服务可用性需要联调确认。 本页记录入口职责与边界；逐文件的类型、函数和依赖关系见同 owner 的源码接口记录。
- 源码与文档：[jiuwenswarm/extensions/video_duplex/backend/tasks/rail.py:L1–L65](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/video_duplex/backend/tasks/rail.py#L1-L65)；
  - [docs/zh/application-plugins.md:L1–L149](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/application-plugins.md#L1-L149)。

### 接口与调用入口（API）

- 可定位的实现声明包括 `VoiceAgentTaskRail [before_model_call, after_model_call, before_tool_call]`；`install_task_rail(owner, rail, reload)`；`task_checkpoint(rail, ctx, stage)`。这些是源码定位入口，具体公共用户操作沿功能文档查证；本页不把内部符号直接当成稳定 HTTP API。参数、返回类型、错误传播和生命周期应在所列实现与调用方一起核对。
- 源码与文档：[jiuwenswarm/extensions/video_duplex/backend/tasks/rail.py:L1–L65](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/video_duplex/backend/tasks/rail.py#L1-L65)；
  - [docs/zh/application-plugins.md:L1–L149](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/application-plugins.md#L1-L149)。

### 配置入口与生效条件

- 上游 YAML 示例的配置键包括 `id`、`name`、`version`、`description`、`author`、`min_jiuwenswarm_version`、`package_type`、`permissions`。这些是示例字段，不单独证明源码默认值或全部优先级。 修改设置时还要检查配置加载位置与本功能的装配或连接时机，不能只由“保存成功”判断当前运行实例已经采用新值。
- 源码与文档：[jiuwenswarm/extensions/video_duplex/backend/tasks/rail.py:L1–L65](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/video_duplex/backend/tasks/rail.py#L1-L65)；
  - [docs/zh/application-plugins.md:L1–L149](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/application-plugins.md#L1-L149)。

### 设计取舍

- **设计推断**：双工媒体把设备采集、前端播放与后端任务连接起来，适合实时多模态交互；代价是媒体权限、传输和 Agent 运行有独立生命周期。插件被发现只证明扩展加载，摄像头、麦克风和模型服务是否可用需要单独验证。以上分析从所列接口与功能边界得出，不宣称作者曾评估所有替代方案。
- 源码与文档：[jiuwenswarm/extensions/video_duplex/backend/tasks/rail.py:L1–L65](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/video_duplex/backend/tasks/rail.py#L1-L65)；
  - [docs/zh/application-plugins.md:L1–L149](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/application-plugins.md#L1-L149)。

### 数据流与关联功能

- 音视频扩展具有自己的前端组件和后端任务处理。媒体连接、运行任务与插件启用状态之间有多重生命周期，实际设备和服务可用性需要联调确认。 联调时结合[[feature-applications]]（Application Plugin 与前端贡献）、[[feature-multimodal]]（多模态理解与媒体配置）、[[feature-web-chat-1]]、[[feature-web-chat-2]]（Web 对话与流式状态）的入口、数据归属和生效条件查证；这些关联页解释不同阶段，不能只凭一项成功判定整个链路完成。
- 源码与文档：[jiuwenswarm/extensions/video_duplex/backend/tasks/rail.py:L1–L65](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/video_duplex/backend/tasks/rail.py#L1-L65)；
  - [docs/zh/application-plugins.md:L1–L149](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/application-plugins.md#L1-L149)。

### 怎样验证

- 检查插件开启与前端媒体授权，分别验证音频或视频进入后端任务以及回复播放。覆盖设备不可用、拒绝授权、断连、取消和禁用，检查媒体连接与任务资源都能释放。这些是建议的验收步骤，本页没有记录上游运行测试已执行或已通过。
- 源码与文档：[jiuwenswarm/extensions/video_duplex/backend/tasks/rail.py:L1–L65](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/video_duplex/backend/tasks/rail.py#L1-L65)；
  - [docs/zh/application-plugins.md:L1–L149](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/application-plugins.md#L1-L149)。
