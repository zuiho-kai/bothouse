---
name: feature-sop-structure-extraction-1
description: SOP 结构化抽取 parse_sop_raw_text / parse_sop_file 第一部分：公开入口与契约、按 sop_parse_mode 的分层抽取流程与模式选择、解析选项默认值与字符预算
metadata:
  scope: 收 sop_parser.py 抽取特性的入口契约、分层流程与解析选项，来源另含 __init__.py、sop_chunk_merge.py、sop_fallback.py；分块合并取舍、运行时自检、文件加载与意图兜底归 feature-sop-structure-extraction-2；实现深读归 feature-depth-sop-structure-extraction
---
# SOP 结构化抽取（parse_sop_raw_text / parse_sop_file）（1/2）

## 现状

- 拆分说明：本页是源页 `feature-sop-structure-extraction.md` 的第 1/2 部分；第 2 部分 [[feature-sop-structure-extraction-2]]
- **公开入口与契约**
- 包级导出（`skill_gen/__init__.py`）暴露 `parse_sop_file`、`parse_sop_raw_text`、`DEFAULT_SINGLE_SHOT_BUDGET` 及模型和 fallback 工厂。
  - `parse_sop_raw_text(raw_text, *, invoke_llm_json, parse_options=None, source_label="")` 是核心异步入口，必须传入 `invoke_llm_json`（完整 SOPStructure 抽取仅靠 LLM），返回 `(SOPStructure, extraction_meta)`，全文始终写入 `SOPStructure.raw_text`。
  - `parse_sop_file(file_path, ...)` 先检查文件存在（缺失抛 `FileNotFoundError`），空文本/空抽取抛 `ValueError`。
- Sources / 来源：jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_gen/__init__.py:L9–L21
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_gen/__init__.py#L9-L21`）,
  - jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_gen/sop_parser.py:L257–L273
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_gen/sop_parser.py#L257-L273`）,
  - jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_gen/sop_parser.py:L394–L427
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_gen/sop_parser.py#L394-L427`）
- **分层抽取流程与模式选择**
- 入口层 `parse_sop_raw_text` 校验非空文本后，按 `sop_parse_mode` 决定路径：`chunked`/`single` 直接切换，`auto` 则在「应用正的 `single_shot_budget` 上限之后的 `room_single`」与原文长度比较，超出才走分块（sop_parser.py:L275–L293）。分块路径由 `extract_structure_chunked` 做 map-reduce：按预算递归二分切块、逐块 LLM 抽取、确定性合并，多块时再跑可选 reconcile LLM 整理；
  - 单发路径 `extract_structure_single_shot` 只做一次 LLM 调用。若分块结果出现 ≥2 条空块警告，会截断原文（仅在超预算时）跑一次单发兜底，且仅当单发结果的 steps+knowledge_items+sections 计分不低于分块结果时才替换，并在 meta 标记 `replaced_by_single_shot_after_chunk_loss`（sop_parser.py:L315–L337）。
- Sources / 来源：jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_gen/sop_parser.py:L275–L306
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_gen/sop_parser.py#L275-L306`）,
  - jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_gen/sop_parser.py:L310–L341
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_gen/sop_parser.py#L310-L341`）,
  - jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_gen/sop_chunk_merge.py:L478–L560
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_gen/sop_chunk_merge.py#L478-L560`）
- **解析选项与字符预算**
- `parse_options` 由 `_default_parse_options` 填充默认值：`sop_parse_mode="auto"`、`single_shot_budget=12000`、`max_chunk_chars=8000`、`chunk_overlap=1200`、`max_context_chars=120000`、`safety_margin=2000`。
  - 单发可用空间 `room_single = max(1, max_context_chars - 模板开销 - safety_margin)`，且仅当 `single_shot_budget` 为正并小于该值时进一步收紧。分块路径把非正的 `max_chunk_chars` 以 `None` 传入 `extract_structure_chunked`，`_compute_room_for_chunk` 仅在 `max_chunk_chars` 为正时用它截小房间，最终下限为 1。
- Sources / 来源：jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_gen/sop_parser.py:L246–L254
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_gen/sop_parser.py#L246-L254`）,
  - jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_gen/sop_parser.py:L279–L304
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_gen/sop_parser.py#L279-L304`）,
  - jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_gen/sop_chunk_merge.py:L459–L468
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_gen/sop_chunk_merge.py#L459-L468`）
- **分块合并与单发兜底的取舍**

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/config-resources/feature-sop-structure-extraction.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-07
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_gen/__init__.py:L9-L21
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_gen/sop_parser.py:L257-L273
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_gen/sop_parser.py:L394-L427
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_gen/sop_parser.py:L275-L306
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_gen/sop_parser.py:L310-L341
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_gen/sop_chunk_merge.py:L478-L560
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_gen/sop_parser.py:L246-L254
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_gen/sop_parser.py:L279-L304
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_gen/sop_chunk_merge.py:L459-L468
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_gen/sop_parser.py:L315-L341
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_gen/sop_chunk_merge.py:L403-L456
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_gen/sop_chunk_merge.py:L537-L557
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_gen/sop_parser.py:L343-L347
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_gen/sop_parser.py:L371-L389
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_gen/sop_parser.py:L365-L369
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_gen/sop_parser.py:L430-L455
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_gen/sop_fallback.py:L1-L13
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_gen/sop_fallback.py:L360-L378
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_gen/sop_fallback.py:L416-L426
- 源页字段（feature）：sop-structure-extraction
- 入口（entry_points）：jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_gen/sop_parser.py
- 源页字段（source_globs）：jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_gen/sop_parser.py；jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_gen/sop_chunk_merge.py
  - jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_gen/sop_fallback.py；jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_gen/__init__.py
  - jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_gen/models.py
