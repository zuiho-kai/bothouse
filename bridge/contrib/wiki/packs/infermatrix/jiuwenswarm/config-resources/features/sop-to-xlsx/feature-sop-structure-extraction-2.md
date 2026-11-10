---
name: feature-sop-structure-extraction-2
description: SOP 结构化抽取第二部分：分块合并与单发兜底的数量启发式取舍、空抽取与弱结果运行时信号、文件加载（AutoFileParser 与直接读取后缀）与无文档时的意图兜底
metadata:
  scope: 只收分块合并取舍、运行时自检与功能路径（文件加载、意图兜底）；入口契约、分层流程与解析选项归 feature-sop-structure-extraction-1；实现深读归 feature-depth-sop-structure-extraction
---
# SOP 结构化抽取（parse_sop_raw_text / parse_sop_file）（2/2）

## 现状

- 拆分说明：本页是源页 `feature-sop-structure-extraction.md` 的第 2/2 部分；第 1 部分 [[feature-sop-structure-extraction-1]]
- 分块路径用 `merge_partial_dicts` 做确定性合并（按 step_number 去重合并、按 id 合并 sections、多数投票 sop_type，分歧时判 hybrid），多块时可用 `_RECONCILE_PROMPT` 整体替换合并稿。当 ≥2 个分块抽取为空时触发单发兜底，但替换判据仅是 steps+knowledge_items+sections 的数量总和 `score_s >= score_c`（sop_parser.py:L329–L333）——这是数量启发式，不保证单发结果质量不低于分块结果；
  - 且截断警告仅在单发被采纳时才追加（L337–L341），兜底单发本身的截断在其他路径下不记录。
- Sources / 来源：jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_gen/sop_parser.py:L315–L341
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_gen/sop_parser.py#L315-L341`）,
  - jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_gen/sop_chunk_merge.py:L403–L456
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_gen/sop_chunk_merge.py#L403-L456`）,
  - jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_gen/sop_chunk_merge.py:L537–L557
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_gen/sop_chunk_merge.py#L537-L557`）
- **运行时自检：空抽取与弱结果信号**
- 两条路径都在抽取完全为空（无 steps、无 title、无 knowledge_items）时追加 `extraction_empty_after_chunked` / `extraction_empty_single_shot` 警告并抛 `ValueError`，异常消息携带 `merge_warnings`。
  - 空抽取检查之后，`weak_reasons` 仅在分块且 `chunk_count > 1` 时由四类质量信号推导：缺 title、sections ≥3 却缺 scope、长文（超过 room_single）但 knowledge_items < 3、以及未应用 reconcile；命中任一即置 `use_raw_excerpt_draft_fallback = True`。`extraction_meta.output_counts` 记录五类输出条数。
- Sources / 来源：jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_gen/sop_parser.py:L343–L347
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_gen/sop_parser.py#L343-L347`）,
  - jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_gen/sop_parser.py:L371–L389
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_gen/sop_parser.py#L371-L389`）,
  - jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_gen/sop_parser.py:L365–L369
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_gen/sop_parser.py#L365-L369`）
- **功能：文档抽取与无文档时的意图兜底**
- 该特性提供两条功能路径。其一，`parse_sop_file` 从文件加载纯文本：优先用 agent-core 的 `AutoFileParser`（支持时解析文档并拼接各 chunk 文本），当解析器不可用、抛错或返回空结果时回退为直接读取，且直接读取仅接受 `.md/.txt/.json/.yaml/.yml` 后缀，其他格式抛 `ValueError` 提示安装 agent-core；加载后的文本交由 `parse_sop_raw_text` 做 LLM 结构化抽取（单发或分块），全文始终保留在 `SOPStructure.raw_text`。
  - 其二，当会话中没有任何 SOP 文档时，`sop_fallback` 提供意图兜底：默认应在运行时能调用模型时就传入 `invoke_llm_json`（`build_intent_fallback_sop` 先确定性构建骨架再调用 `enrich_fallback_sop_with_llm` 精修），只有系统无法运行 LLM（测试、离线、宿主未接线、策略限制）时才传 `None` 或单独使用 `build_fallback_sop_structure`；
  - 兜底产物带与 LLM 抽取相同的字段，并在 meta 中标记 `fallback_sop`/`fallback_reason`，enrich 失败或空响应时原样返回输入结构。
- Sources / 来源：jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_gen/sop_parser.py:L430–L455
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_gen/sop_parser.py#L430-L455`）,
  - jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_gen/sop_fallback.py:L1–L13
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_gen/sop_fallback.py#L1-L13`）,
  - jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_gen/sop_fallback.py:L360–L378
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_gen/sop_fallback.py#L360-L378`）,
  - jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_gen/sop_fallback.py:L416–L426
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_gen/sop_fallback.py#L416-L426`）

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/config-resources/feature-sop-structure-extraction.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-07
