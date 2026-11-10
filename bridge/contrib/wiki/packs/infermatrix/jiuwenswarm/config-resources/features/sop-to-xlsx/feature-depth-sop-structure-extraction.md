---
name: feature-depth-sop-structure-extraction
description: SOP 结构化抽取实现深读：auto 模式按 room_single 判定分块、模块依赖、超长单发截断取舍、parse_sop_file 异步契约、默认字符预算常量、空抽取 ValueError、文档化手工验证（未执行）
metadata:
  scope: 收 sop_parser.py 的实现细节（模式判定、依赖、截断、异步入口、预算常量、空抽取、手工验证记载），来源另含 __init__.py、sop-structure-pipeline.md、sop_chunk_merge.py；功能概览归 feature-sop-structure-extraction-1、feature-sop-structure-extraction-2
---
# SOP 结构化抽取（parse_sop_raw_text / parse_sop_file）：实现深读

## 现状

- [[feature-sop-structure-extraction-1]]、[[feature-sop-structure-extraction-2]]（功能概览） · [[config-resources-overview-1]]、[[config-resources-overview-2]]（owner 入口）
- **auto 模式按 room_single 判定分块，否则单次抽取并记录弱抽取原因** mode 为 auto 时仅当 len(raw_text) > room_single 才走 extract_structure_chunked（run_reconcile=True），否则截断到 room_single 走单次抽取；随后计算 weak_reasons，置 sop.raw_text=raw_text 并返回 (sop, extraction_meta)。
- 来源：jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_gen/sop_parser.py:L289–L306
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_gen/sop_parser.py#L289-L306`）,
  - jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_gen/sop_parser.py:L349–L364
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_gen/sop_parser.py#L349-L364`）,
  - jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_gen/sop_parser.py:L371–L391
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_gen/sop_parser.py#L371-L391`）
- **sop_parser 依赖 sop_chunk_merge 与 models.SOPStructure** sop_parser.py 导入 extract_structure_chunked/extract_structure_single_shot 与 SOPStructure，抽取结果的 dict 经 SOPStructure.from_dict 转为结构化对象；包 __init__ 对外导出 parse_sop_raw_text/parse_sop_file 及 DEFAULT_SINGLE_SHOT_BUDGET。
- 来源：jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_gen/sop_parser.py:L14–L15
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_gen/sop_parser.py#L14-L15`）,
  - jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_gen/sop_chunk_merge.py:L559–L560
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_gen/sop_chunk_merge.py#L559-L560`）,
  - jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_gen/__init__.py:L3–L21
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_gen/__init__.py#L3-L21`）
- **超长单次输入截断换取成本可控，代价是提示不完整（推断）** 设计推断（非作者历史意图）：
- 非分块路径直接把 raw_text 截到 room_single 并在 merge_warnings 记 "single_shot_prompt_truncated_to_{n}_chars"，避免分块多次调用；代价是截断后文档尾部信息不进入本次抽取（推断自 shown lines 350-363）。
- 来源：jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_gen/sop_parser.py:L349–L363
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_gen/sop_parser.py#L349-L363`）
- **parse_sop_file 为异步入口，调用方必须以关键字传入 invoke_llm_json，返回 (SOPStructure, extraction_meta) 且全文存入 raw_text** parse_sop_file(file_path, *, invoke_llm_json, parse_options=None) 是 async 函数，invoke_llm_json 为必需的关键字参数，返回 (SOPStructure, extraction_meta)；文档字符串声明完整文档文本始终写入 SOPStructure.raw_text。
  - 单发路径中若 LLM 抽取后 steps、title、knowledge_items 均为空，则追加 merge_warning "extraction_empty_single_shot" 并抛 ValueError。底层 extract_structure_single_shot 收到的是（可能截断的）原文文本而非完整 prompt，prompt 在其内部由模板构造；
  - invoke_llm_json 带 fallback={} 与 trace_tag="sop_extract_single_shot"，若返回非 dict 或为空，helper 本地记录 "empty_llm_response" 并返回空 SOPStructure 与 meta，不在此层抛错。
- 来源：jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_gen/sop_parser.py:L394–L403
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_gen/sop_parser.py#L394-L403`）,
  - jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_gen/sop_parser.py:L349–L369
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_gen/sop_parser.py#L349-L369`）,
  - jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_gen/sop_chunk_merge.py:L563–L585
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_gen/sop_chunk_merge.py#L563-L585`）
- **默认字符预算常量与 auto 模式：仅当 len(raw_text) > room_single 时走分块路径** 默认值由常量定义：`DEFAULT_SINGLE_SHOT_BUDGET = 12000`、`DEFAULT_MAX_CHUNK_CHARS = 8000`、`DEFAULT_CHUNK_OVERLAP = 1200`、`DEFAULT_MAX_CONTEXT_CHARS = 120_000`、`DEFAULT_SAFETY_MARGIN = 2000`。
  - 模式为 `auto`（else 分支）时，仅当 `len(raw_text) > room_single` 才置 `use_chunked` 并调用 `extract_structure_chunked`（非正的 `max_chunk` 以 `None` 传入）；分块房间在 `_compute_room_for_chunk` 中仅当 `max_chunk_chars > 0` 且 `room > max_chunk_chars` 时收紧，下限 `max(1, room)`。
- 来源：jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_gen/sop_parser.py:L19–L23
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_gen/sop_parser.py#L19-L23`）,
  - jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_gen/sop_parser.py:L289–L306
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_gen/sop_parser.py#L289-L306`）,
  - jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_gen/sop_chunk_merge.py:L466–L468
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_gen/sop_chunk_merge.py#L466-L468`）
- **空抽取（无 steps/title/knowledge_items）在单发与分块路径均记入 merge_warnings 并抛 ValueError** 分块路径：若 `not sop.steps and not sop.title and not sop.knowledge_items`，先 append `"extraction_empty_after_chunked"` 到 `merge_warnings` 再 `raise ValueError`；单发路径同样 append `"extraction_empty_single_shot"` 后抛错。
  - 单发前若 `len(raw_text) > room_single` 会截断提示词并记 `single_shot_prompt_truncated_to_{room_single}_chars` 警告；更底层地，`extract_structure_single_shot` 在 LLM 返回非 dict 或空 dict 时记 `"empty_llm_response"` 并返回空 `SOPStructure()`（该空结构随后触发上层 ValueError）。
- 来源：jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_gen/sop_parser.py:L343–L369
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_gen/sop_parser.py#L343-L369`）,
  - jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_gen/sop_chunk_merge.py:L582–L585
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_gen/sop_chunk_merge.py#L582-L585`）
- **文档规定的人工验证路径：以 parse_sop_file/parse_sop_raw_text 加 invoke_llm_json 得到 SOPStructure（NOT EXECUTED）** 文档中的人工验收步骤（本轮未执行）：
- 已有文档 `sop-structure-pipeline.md` 写明唯一受支持路径：调用 `skill_gen.sop_parser.parse_sop_file` 或 `parse_sop_raw_text` 并传入必需的 `invoke_llm_json` callable，即可得到完整 `SOPStructure`；并明确 `skill_generator_cli.py sop-text` 只输出纯文本、不产出 `SOPStructure` JSON（用于排除错误验证方式）。未提供任何针对这些函数的自动化测试断言；
  - 本程序为 documented_manual，NOT EXECUTED。
- 来源：jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/reference/sop-structure-pipeline.md:L1–L16
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/reference/sop-structure-pipeline.md#L1-L16`）

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/config-resources/feature-depth-sop-structure-extraction.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_gen/sop_parser.py:L14-L15
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_gen/sop_chunk_merge.py:L559-L560
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_gen/__init__.py:L3-L21
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_gen/sop_parser.py:L349-L363
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_gen/sop_parser.py:L289-L306
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_gen/sop_parser.py:L349-L364
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_gen/sop_parser.py:L371-L391
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_gen/sop_parser.py:L19-L23
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_gen/sop_chunk_merge.py:L466-L468
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_gen/sop_parser.py:L343-L369
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_gen/sop_chunk_merge.py:L582-L585
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/reference/sop-structure-pipeline.md:L1-L16
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_gen/sop_parser.py:L394-L403
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_gen/sop_parser.py:L349-L369
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_gen/sop_chunk_merge.py:L563-L585
- 源页字段（feature）：sop-structure-extraction
- 入口（entry_points）：jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_gen/sop_parser.py
- 源页字段（source_globs）：jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_gen/sop_parser.py；jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_gen/sop_chunk_merge.py
  - jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_gen/sop_fallback.py；jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_gen/__init__.py
  - jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_gen/models.py
