---
name: feature-depth-skills
description: 技能安装、挂载与发现实现深读：handle_skills_list 默认值与技能目录、archive_store 版本真值、索引损坏传播、detect_skill_type 判定流程、get_local_skills 与图片改写单测
metadata:
  scope: 只收 SkillManager 的实现级事实；职责与配置概览归 feature-skills
---
# 技能安装、挂载与发现：实现深读

## 现状

- [[feature-skills]]（功能概览） · [[agents-team-overview-1]]、[[agents-team-overview-2]]（owner 入口）
- **skills.list 的开关默认值与技能目录位置** handle_skills_list 的 refresh_marketplaces 默认 False（True 时先对已配置 marketplace 执行 clone/pull 再扫描），with_installed 默认 False（True 时同响应附带 plugins，避免网关串行两次 RPC）。本地技能目录由 get_agent_skills_dir() 给出：~/.jiuwenswarm/agent/workspace/skills（get_agent_workspace_dir()/skills）。
- 来源：[jiuwenswarm/server/runtime/skill/skill_manager.py:L786–L809](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/skill/skill_manager.py#L786-L809),
  - [jiuwenswarm/common/utils.py:L1816–L1824](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/utils.py#L1816-L1824)
- **版本真值依赖 archive_store 而非插件登记** handle_skills_installed 不再信任 installed_plugins[].version，而是对每个 skill 用 _resolve_local_skill_dir 定位目录后调 archive_store 的 get_current_version，从 Skill 根目录 .archive/versions/index.json 读取版本；读取失败（SkillArchiveError）时版本回退为 None 而非中断整个列表。这一耦合把版本真值收敛到技能目录内，使登记数据与磁盘可分叉。
- 来源：[jiuwenswarm/server/runtime/skill/skill_manager.py:L811–L877](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/skill/skill_manager.py#L811-L877),
  - [jiuwenswarm/server/runtime/skill/archive_store.py:L1–L35](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/skill/archive_store.py#L1-L35),
  - [jiuwenswarm/server/runtime/skill/skill_manager.py:L6331–L6343](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/skill/skill_manager.py#L6331-L6343)
- **索引损坏与图片改写失败的传播** .archive/versions/index.json 损坏或无法解析时 read_versions_index 抛 SkillArchiveError(ERROR_INDEX_CORRUPT，即 "SKILL_VERSION_CONTENT_INVALID")，handle_skills_get 将其原 code/message 转为 SkillRpcError 向上层透传。
  - 正文中本地图片改写（rewrite_skill_markdown_images）抛任何异常时仅 logger.debug 记录并返回原文，不影响 skills.get 成功返回。
- 来源：[jiuwenswarm/server/runtime/skill/archive_store.py:L87–L100](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/skill/archive_store.py#L87-L100),
  - [jiuwenswarm/server/runtime/skill/skill_manager.py:L995–L1014](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/skill/skill_manager.py#L995-L1014),
  - [jiuwenswarm/server/runtime/skill/skill_manager.py:L903–L915](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/skill/skill_manager.py#L903-L915)
- **with_installed 合并响应** 设计推断（非作者历史意图）：
- 推断：skills.list 的 with_installed 把 installed 列表并入同一次响应，收益是网关不必串行处理两次 RPC、避免列表刷新超时或排队过久；代价是单次响应变大，且 installed 计算里的逐目录版本读取开销被计入 list 请求。设计动机来自函数 docstring，代码本身只证明该合并行为存在。
- 来源：[jiuwenswarm/server/runtime/skill/skill_manager.py:L786–L809](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/skill/skill_manager.py#L786-L809)
- **图片改写行为的单测断言** tests/unit_tests/agentserver/test_skill_content_images.py::test_skills_get_rewrites_relative_image_keeps_external：manager fixture monkeypatch 技能目录后写入含本地 PNG、外链 https://example.com/a.png 与缺失文件的 SKILL.md，调用 handle_skills_get（name=visual-doc、_session_id=sess-1），
  - 断言返回 content 含 /file-api/download?token= 与 session_id=sess-1、外链与缺失路径保持原文，且磁盘 SKILL.md 仍含 assets/flow.png、不含 /file-api/download。
- 来源：[tests/unit_tests/agentserver/test_skill_content_images.py:L43–L88](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/agentserver/test_skill_content_images.py#L43-L88),
  - [tests/unit_tests/agentserver/test_skill_content_images.py:L92–L125](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/agentserver/test_skill_content_images.py#L92-L125)
- **detect_skill_type 类型判定流程：目录无效或全部未命中时返回 SKILL_TYPE_SKILL** skill_dir 为 None 或非目录时直接返回 SKILL_TYPE_SKILL；否则依序判定 is_skillpack→SKILL_TYPE_SKILLPACK、_frontmatter_kind_is_swarm→SKILL_TYPE_SWARM、_has_multimedia_asset→SKILL_TYPE_MULTIMODAL，均未命中返回 SKILL_TYPE_SKILL。
- 来源：[jiuwenswarm/server/runtime/skill/skill_type.py:L48–L61](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/skill/skill_type.py#L48-L61)
- **get_local_skills(self) -> list[dict] 返回 local_skills 记录的列表副本，键缺省时为空列表** SkillManager.get_local_skills(self) -> list[dict]，实现为 list(self._state.get("local_skills", []))，键缺省时返回空列表。
  - 工具侧 _find_installed_by_target 消费该列表：跳过非字典项，仅当传入 source 与记录 source 均为 "skillnet" 且记录 origin 等于去空白后的 identifier 时按 name 构造已安装项；identifier 为空直接返回 None。list() 仅给出列表级副本，所示代码不证明嵌套字典被深拷贝。
- 来源：[jiuwenswarm/server/runtime/skill/skill_manager.py:L8673–L8675](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/skill/skill_manager.py#L8673-L8675),
  - [jiuwenswarm/agents/harness/common/tools/skill_toolkits.py:L173–L188](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/skill_toolkits.py#L173-L188)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/agents-team/feature-depth-skills.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-02；updated: 2026-10-02
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/server/runtime/skill/skill_manager.py:L811-L877；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/server/runtime/skill/archive_store.py:L1-L35
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/server/runtime/skill/skill_manager.py:L6331-L6343；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/server/runtime/skill/archive_store.py:L87-L100
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/server/runtime/skill/skill_manager.py:L995-L1014；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/server/runtime/skill/skill_manager.py:L903-L915
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/server/runtime/skill/skill_manager.py:L786-L809；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/common/utils.py:L1816-L1824
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/agentserver/test_skill_content_images.py:L43-L88；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/agentserver/test_skill_content_images.py:L92-L125
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/server/runtime/skill/skill_type.py:L48-L61；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/server/runtime/skill/skill_manager.py:L8673-L8675
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/skill_toolkits.py:L173-L188
- 源页字段（feature）：skills
- 入口（entry_points）：jiuwenswarm/server/runtime/skill/skill_manager.py
- 源页字段（source_globs）：jiuwenswarm/server/runtime/skill/skill_manager.py；jiuwenswarm/server/runtime/skill/*
