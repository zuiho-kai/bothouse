---
name: agents-team-overview-2
description: agents-team 目录总览 第 2 部分：Xiaoyi 设备工具、视频生成、A2X、命令执行、LLM Wiki 等功能知识页与各页实现深读入口
metadata:
  scope: 只收目录入口链接的后半部分；前半部分入口与源码子模块目录在 agents-team-overview-1
---
# agents-team（2/2）

## 现状

- 拆分说明：本页是源页 `_index.md` 的第 2/2 部分；第 1 部分 [[agents-team-overview-1]]
- [[knowledge-agents-team]]（Code harness：静态提示词、计划审批与观测开关） — 说明接口、配置与集成边界，关联源码和维护者文档。
- [[feature-depth-team]]（多智能体团队协作：实现深读）
- [[feature-depth-distributed-team]]（跨进程分布式 Team：实现深读）
- [[feature-depth-human-team]]（人类团队成员与人工协作：实现深读）
- [[feature-depth-swarmflow]]（SwarmFlow 工作流与 HITL：实现深读）
- [[feature-depth-planning]]（任务规划与 Todo：实现深读）
- [[feature-depth-subagents]]（子代理派发与验证：实现深读）
- [[feature-depth-skills]]（技能安装、挂载与发现：实现深读）
- [[feature-depth-swarm-skills]]（团队技能与能力复用：实现深读）
- [[feature-depth-skill-hub]]（Skill Hub 与市场流通：实现深读）
- [[feature-depth-memory]]（长期记忆：实现深读）
- [[feature-depth-auto-memory]]（对话后自动记忆：实现深读）
- [[feature-depth-task-memory]]（任务经验检索与沉淀：实现深读）
- [[feature-depth-browser-tools]]（浏览器服务与网页工具：实现深读）
- [[feature-depth-multimodal]]（多模态理解与媒体配置：实现深读）
- [[feature-depth-jiuwen-memory-sdk]]（JiuwenMemory 进程内 SDK 接入：实现深读）
- [[feature-depth-image-generation]]（图片生成与产物落盘：实现深读）
- [[feature-depth-digital-avatar]]（群聊数字分身与 owner 权限：实现深读）
- [[feature-dynamic-memory-cli]]（Dynamic Memory CLI：SQLite UT 记忆库与发布/构建流水线）
- [[feature-pdf-reading-tool]]（read_pdf：分页 PDF 文本读取工具（feature-pdf-reading-tool））
- [[feature-sdd-design-rail]]（DesignRail SDD 状态机（Spec-Driven Development））
- [[feature-session-messaging-toolkit]]（SessionMessagingToolkit 跨会话消息六工具）
- [[feature-user-todos-tool]]（user_todos Personal Per-Channel Todo Tool）
- [[feature-web-search-tools]]（MCP Free/Paid Search Tools with Trusted-Search Provenance Lease）
- [[feature-xiaoyi-alarm-crud]]（小艺手机工具 — 设备闹钟 CRUD（create/search/modify/delete_alarm））
- [[feature-xiaoyi-calendar-tools]]（Xiaoyi 设备日历日程工具（create/search_calendar_event））
- [[feature-xiaoyi-call-phone-tool]]（小艺拨打电话工具 (call_phone)）
- [[feature-xiaoyi-collection-tools]]（小艺收藏工具（query/add/delete_collection））
- [[feature-xiaoyi-contact-search]]（search_contact 设备联系人搜索工具（feature-xiaoyi-contact-search））
- [[feature-xiaoyi-location-tool]]（设备定位工具 get_user_location（feature-xiaoyi-location-tool））
- [[feature-xiaoyi-note-tools]]（小艺备忘录工具（create_note / search_notes / modify_note））
- [[feature-xiaoyi-photo-gallery-tools]]（小艺图库工具：search_photo_gallery / upload_photo (photo_tools.py)）
- [[feature-xiaoyi-timestamp-utc8-tool]]（时间戳转北京时间工具 (convert_timestamp_to_utc8_time)）
- [[feature-a2x-registry-client-sdk]]（A2X Registry Client SDK — 同步/异步镜像式服务注册客户端）
- [[feature-command-execution-tool]]（mcp_exec_command 跨平台命令执行工具）
- [[feature-llm-wiki-knowledge-base]]（LLM Wiki 知识库（wiki_ingest/query/lint 子代理））
- [[feature-video-generation-tools]]（generate_video / check_video_status 提交后轮询的视频生成工具）
- [[feature-xiaoyi-pushdata-store-and-viewer]]（推送记录持久化与查询：pushdata_manager 与 view_push_result）
- [[feature-xiaoyi-save-to-phone-tools]]（小艺保存到手机工具（save_media_to_gallery / save_file_to_file_manager））
- [[feature-depth-a2x-registry-client-sdk]]（A2X Registry Client SDK — mirrored sync/async service registry client：实现深读）
- [[feature-depth-command-execution-tool]]（mcp_exec_command 跨平台命令执行工具：实现深读）
- [[feature-depth-dynamic-memory-cli]]（Dynamic Memory CLI（SQLite UT 记忆库与发布/构建流水线）：实现深读）
- [[feature-depth-llm-wiki-knowledge-base]]（LLM Wiki 知识库（wiki_ingest/query/lint 子代理）：实现深读）
- [[feature-depth-pdf-reading-tool]]（分页 PDF 文本读取工具（read_pdf）：实现深读）
- [[feature-depth-sdd-design-rail]]（DesignRail SDD 状态机（Spec-Driven Development）：实现深读）
- [[feature-depth-session-messaging-toolkit]]（跨会话消息 Agent 工具集（SessionMessagingToolkit 六工具）：实现深读）
- [[feature-depth-user-todos-tool]]（user_todos Personal Per-Channel Todo Tool：实现深读）
- [[feature-depth-video-generation-tools]]（generate_video / check_video_status Submit-then-Poll Video Generation：实现深读）
- [[feature-depth-web-search-tools-1]]、[[feature-depth-web-search-tools-2]]（MCP Free/Paid Search Tools with Trusted-Search Provenance Lease：实现深读）
- [[feature-depth-xiaoyi-alarm-crud]]（设备闹钟 CRUD 工具（create/search/modify/delete_alarm）：实现深读）
- [[feature-depth-xiaoyi-calendar-tools]]（设备日历日程工具（create/search_calendar_event）：实现深读）
- [[feature-depth-xiaoyi-call-phone-tool]]（小艺拨打电话工具 (call_phone)：实现深读）
- [[feature-depth-xiaoyi-collection-tools]]（小艺收藏/个人知识库工具 (query/add/delete_collection)：实现深读）
- [[feature-depth-xiaoyi-contact-search]]（设备联系人搜索工具（search_contact）：实现深读）
- [[feature-depth-xiaoyi-location-tool]]（设备定位工具（get_user_location）：实现深读）
- [[feature-depth-xiaoyi-note-tools]]（小艺备忘录工具 (create_note / search_notes / modify_note)：实现深读）
- [[feature-depth-xiaoyi-photo-gallery-tools]]（小艺图库搜索与照片上传工具 (search_photo_gallery / upload_photo)：实现深读）
- [[feature-depth-xiaoyi-pushdata-store-and-viewer]]（推送记录持久化与查询 (pushdata_manager + view_push_result)：实现深读）
- [[feature-depth-xiaoyi-save-to-phone-tools]]（小艺保存到手机工具 (save_media_to_gallery / save_file_to_file_manager)：实现深读）
- [[feature-depth-xiaoyi-timestamp-utc8-tool]]（时间戳转北京时间工具 (convert_timestamp_to_utc8_time)：实现深读）

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/agents-team/_index.md`（InferMatrixCopilot@ecfb84d0）；type: index；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
