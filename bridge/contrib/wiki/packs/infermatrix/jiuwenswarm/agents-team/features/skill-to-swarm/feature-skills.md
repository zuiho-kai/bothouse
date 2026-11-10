---
name: feature-skills
description: 技能安装、挂载与发现功能概览：SkillManager、SKILLNET_DOWNLOAD_TIMEOUT 等环境变量、已安装/可见/已加载/可调用的区别与验证步骤
metadata:
  scope: 只收技能安装、挂载与发现的职责、接口入口、配置入口、设计取舍与验证方法（guide）；skills.list 开关、版本真值、类型判定等实现细节归 feature-depth-skills；Hub 市场归 feature-skill-hub
---
# 技能安装、挂载与发现 的职责、接口与配置

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/agents-team/feature-skills.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/server/runtime/skill/skill_manager.py；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:docs/zh/技能.md
- 源页字段（feature）：skills
- 入口（entry_points）：jiuwenswarm/server/runtime/skill/skill_manager.py
- 源页字段（source_globs）：jiuwenswarm/server/runtime/skill/skill_manager.py；jiuwenswarm/server/runtime/skill/*；jiuwenswarm/agents/harness/common/tools/skill_toolkits.py；jiuwenswarm/server/runtime/skill/skills_multipart_http.py；jiuwenswarm/server/runtime/skill/skillpack.py；jiuwenswarm/common/utils.py
  - jiuwenswarm/resources/agent/workspace/skills/docx-pro/scripts/md_parser.py；jiuwenswarm/channels/web/frontend/src/utils/skillNetUrl.ts；jiuwenswarm/channels/web/frontend/src/utils/mySkills.ts
  - jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/sync-runtime-skill.js；jiuwenswarm/server/runtime/agent_adapter/interface_deep.py；jiuwenswarm/server/runtime/skill/archive_store.py；jiuwenswarm/server/runtime/skill/skill_content_images.py
  - jiuwenswarm/channels/web/frontend/src/components/SkillPanel/skillPanelUtils.ts；jiuwenswarm/channels/web/frontend/src/utils/skillPackageFile.ts；jiuwenswarm/agents/harness/common/tools/send_file_to_user.py
  - jiuwenswarm/channels/web/frontend/src/components/ChatPanel/SkillPickerPanel.tsx；jiuwenswarm/server/runtime/skill/skilldev/state_utils.py；jiuwenswarm/server/runtime/skill/skill_type.py；jiuwenswarm/channels/web/frontend/src/components/SkillPanel/skillVersionOptions.ts
  - jiuwenswarm/server/runtime/skill/skill_files.py；jiuwenswarm/channels/web/frontend/src/features/SkillNetSearchModal/index.tsx；jiuwenswarm/server/runtime/agent_adapter/interface.py；jiuwenswarm/server/agent_ws_server.py；jiuwenswarm/agents/swarm/providers/member_rails.py
  - jiuwenswarm/agents/harness/team/rails/team_member_skill_toolkit_rail.py；jiuwenswarm/agents/harness/team/rails/team_skill_library_reload_rail.py；jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_gen/url_ingest/url_safety.py
  - jiuwenswarm/channels/web/frontend/src/components/SkillPanel/index.tsx；jiuwenswarm/channels/web/app_web.py；jiuwenswarm/channels/browser/frontend/src/webview/chat.html
- 本页是该功能的基本知识入口，基线 `f0a69728c96b`。它连接源码契约与上游功能文档；详细字段和行为仍沿固定引用核对。

### 职责与边界

- 技能文件由运行时管理并在 Agent 装配中发现或挂载。已安装、可见、已加载和可调用是不同状态，理解问题时应沿技能目录与工具暴露过程查证。 本页记录入口职责与边界；逐文件的类型、函数和依赖关系见同 owner 的源码接口记录。
- 源码与文档：[jiuwenswarm/server/runtime/skill/skill_manager.py:L1–L8999](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/skill/skill_manager.py#L1-L8999)；
  - [docs/zh/技能.md:L1–L632](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E6%8A%80%E8%83%BD.md#L1-L632)。

### 接口与调用入口（API）

- 可定位的实现声明包括 `SkillRpcError`；`SkillNetEmptyDownloadError`；`SkillNetInstallError`；`SkillManager [set_skillnet_install_complete_hook, handle_skills_list, handle_skills_installed, handle_skills_get, handle_skills_versions_list]`。这些是源码定位入口，具体公共用户操作沿功能文档查证；本页不把内部符号直接当成稳定 HTTP API。
  - 参数、返回类型、错误传播和生命周期应在所列实现与调用方一起核对。
- 源码与文档：[jiuwenswarm/server/runtime/skill/skill_manager.py:L1–L8999](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/skill/skill_manager.py#L1-L8999)；
  - [docs/zh/技能.md:L1–L632](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E6%8A%80%E8%83%BD.md#L1-L632)。

### 配置入口与生效条件

- 实现中直接读取的环境变量名称包括 `SKILLNET_DOWNLOAD_TIMEOUT`、`SKILLNET_MAX_RETRIES`、`TEAM_SKILLS_HUB_TIMEOUT`、`IMPORT_LOCAL_REMOTE_TIMEOUT`、`NO_PROXY`；名称与实际部署值分开核对。 修改设置时还要检查配置加载位置与本功能的装配或连接时机，不能只由“保存成功”判断当前运行实例已经采用新值。
- 源码与文档：[jiuwenswarm/server/runtime/skill/skill_manager.py:L1–L8999](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/skill/skill_manager.py#L1-L8999)；
  - [docs/zh/技能.md:L1–L632](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E6%8A%80%E8%83%BD.md#L1-L632)。

### 设计取舍

- **设计推断**：技能正文与脚本、参考资料一起打包，便于按任务逐步披露内容；代价是安装、目录发现、挂载和实际调用都有各自状态。大规模技能直接全部注入会扩大上下文，适合通过 Symphony 按需检索而非仅增加列表长度。以上分析从所列接口与功能边界得出，不宣称作者曾评估所有替代方案。
- 源码与文档：[jiuwenswarm/server/runtime/skill/skill_manager.py:L1–L8999](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/skill/skill_manager.py#L1-L8999)；
  - [docs/zh/技能.md:L1–L632](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E6%8A%80%E8%83%BD.md#L1-L632)。

### 数据流与关联功能

- 技能文件由运行时管理并在 Agent 装配中发现或挂载。已安装、可见、已加载和可调用是不同状态，理解问题时应沿技能目录与工具暴露过程查证。 联调时结合[[feature-skill-hub]]（Skill Hub 与市场流通）、[[feature-symphony]]（Symphony 检索与图谱编排）、[[feature-skill-evolution]]（Skill 自演进）的入口、数据归属和生效条件查证；这些关联页解释不同阶段，不能只凭一项成功判定整个链路完成。
- 源码与文档：[jiuwenswarm/server/runtime/skill/skill_manager.py:L1–L8999](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/skill/skill_manager.py#L1-L8999)；
  - [docs/zh/技能.md:L1–L632](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E6%8A%80%E8%83%BD.md#L1-L632)。

### 怎样验证

- 安装最小 SKILL.md 能力包，核对安装列表、目录发现与实际任务调用。覆盖无效 metadata、缺少脚本、禁用和卸载，确认旧会话与新装配的技能可见性符合对应生效时机。这些是建议的验收步骤，本页没有记录上游运行测试已执行或已通过。
- 源码与文档：[jiuwenswarm/server/runtime/skill/skill_manager.py:L1–L8999](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/skill/skill_manager.py#L1-L8999)；
  - [docs/zh/技能.md:L1–L632](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E6%8A%80%E8%83%BD.md#L1-L632)。
