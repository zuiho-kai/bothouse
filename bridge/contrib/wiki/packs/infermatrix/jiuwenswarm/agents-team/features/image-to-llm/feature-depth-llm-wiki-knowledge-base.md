---
name: feature-depth-llm-wiki-knowledge-base
description: LLM Wiki 实现深读：wiki_query 流程与返回契约、_resolve_workspace 回落规则、_create_llm_wiki 的 session 血缘、异常分支、monkeypatch 单测、ingest 默认 force=False
metadata:
  scope: 收 wiki_tools.py 的实现级事实，来源另含 test_wiki_tools_runtime_config.py；LLMWiki 分层结构、去重导入与三个工具签名的总览归 feature-llm-wiki-knowledge-base
---
# LLM Wiki 知识库（wiki_ingest/query/lint 子代理）：实现深读

## 现状

- [[feature-llm-wiki-knowledge-base]]（功能概览） · [[agents-team-overview-1]]、[[agents-team-overview-2]]（owner 入口）
- **wiki_query 工具：解析 workspace → 构造 LLMWiki 子代理 → 调用 query 返回 output** wiki_query 先用 _get_default_model() 取默认模型、_resolve_workspace(workspace) 解析出绝对路径；若该路径不存在则直接返回未初始化错误，否则经 _create_llm_wiki 构造 LLMWiki、ensure_initialized() 后调用 wiki.query(question=query)，结果含 "output" 键时返回其字符串形式。
- 来源：[jiuwenswarm/agents/harness/common/tools/wiki_tools.py:L536–L556](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/wiki_tools.py#L536-L556)
- **wiki_query 的输入校验与返回契约（局部返回分支）** wiki_query(query, workspace="") 在 query 为空白时立即返回 "Error: Query cannot be empty."；workspace 解析后不存在时返回提示先用 wiki_ingest 初始化的错误字符串；否则调用 wiki.query 并按 result 中的 "output"/"error" 键返回字符串，兜底 JSON 序列化；异常被捕获并作为 "Wiki Query Error: ..." 字符串返回。
- 来源：[jiuwenswarm/agents/harness/common/tools/wiki_tools.py:L530–L558](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/wiki_tools.py#L530-L558)
- **_resolve_workspace：空或等于 ".llm_wiki" 时回落到基础目录下的默认 wiki 目录** workspace 字符串先 strip；为空或恰为 DEFAULT_WIKI_DIR（".llm_wiki"）时返回 get_agent_workspace_dir()/.llm_wiki 的 resolve 结果；相对路径拼接到 base_dir，目录名不是 .llm_wiki 时追加该子目录，最终返回绝对路径。
- 来源：[jiuwenswarm/agents/harness/common/tools/wiki_tools.py:L398–L415](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/wiki_tools.py#L398-L415),
  - [jiuwenswarm/agents/harness/common/tools/wiki_tools.py:L42–L43](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/wiki_tools.py#L42-L43)
- **_create_llm_wiki 依赖 openjiuwen 会话上下文派生子代理 session 血缘** _create_llm_wiki 用 resolve_session_lineage(get_current_session()) 取 owner_session_id；存在时按 workspace 绝对路径 sha256 前 12 位拼出 "{owner}:subagent:wiki:{scope}" 作为 session_id 并传入 parent_session_id，再连同 workspace/model/sys_operation 传给 LLMWiki 构造器。
- 来源：[jiuwenswarm/agents/harness/common/tools/wiki_tools.py:L445–L459](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/wiki_tools.py#L445-L459),
  - [jiuwenswarm/agents/harness/common/tools/wiki_tools.py:L20–L21](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/wiki_tools.py#L20-L21)
- **wiki_query/wiki_lint 的异常分支：workspace 缺失返回错误字符串，异常被捕获为错误文本** 两个工具在 final_workspace.exists() 为假时返回 "Error: The workspace ... does not have an initialized LLM Wiki."（不抛出）；整体包在 try/except Exception 中，任何异常（含模型构造失败）被转为 "Wiki Query Error: {e}" / "Wiki Lint Error: {e}" 字符串返回给调用方。
- 来源：[jiuwenswarm/agents/harness/common/tools/wiki_tools.py:L539–L558](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/wiki_tools.py#L539-L558),
  - [jiuwenswarm/agents/harness/common/tools/wiki_tools.py:L569–L591](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/wiki_tools.py#L569-L591)
- **_create_llm_wiki 的参数传播有 monkeypatch 单测覆盖（helper 级）** test_create_llm_wiki_propagates_runtime_policy_and_parent_lineage 用 monkeypatch 替换 LLMWiki 捕获 kwargs，断言 enable_read_image_multimodal 为 False、session_id 为 "product-session:subagent:wiki:{workspace哈希前12位}"、
  - parent_session_id 为 "product-session"、kv_cache_affinity_config.enable_kv_cache_affinity 为 True。LLMWiki 本体被 mock，测试只覆盖 _create_llm_wiki 这一 helper，不覆盖 wiki_ingest/query/lint 的运行时集成；未在本批次执行。
- 来源：[tests/unit_tests/agents/test_wiki_tools_runtime_config.py:L30–L74](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/agents/test_wiki_tools_runtime_config.py#L30-L74)
- **ingest 默认 force=False：已知 SHA-256 直接跳过，需显式 force=True 才重新摄取** 设计推断（非作者历史意图）：
- 默认 force=False 时，若 manifest 已识别该文件的 SHA-256，ingest 记 warning 并返回 skipped 结果而不重新处理（推断）收益是相同内容不重复摄取，代价是调用方必须显式传 force=True 才会重跑。
- 来源：[jiuwenswarm/agents/harness/common/tools/wiki_tools.py:L313–L325](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/wiki_tools.py#L313-L325),
  - [jiuwenswarm/agents/harness/common/tools/wiki_tools.py:L462–L466](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/wiki_tools.py#L462-L466)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/agents-team/feature-depth-llm-wiki-knowledge-base.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/wiki_tools.py:L536-L556；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/wiki_tools.py:L398-L415
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/wiki_tools.py:L42-L43；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/wiki_tools.py:L445-L459
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/wiki_tools.py:L20-L21；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/wiki_tools.py:L539-L558
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/wiki_tools.py:L569-L591；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/agents/test_wiki_tools_runtime_config.py:L30-L74
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/wiki_tools.py:L530-L558；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/wiki_tools.py:L313-L325
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/wiki_tools.py:L462-L466
- 源页字段（feature）：llm-wiki-knowledge-base
- 入口（entry_points）：jiuwenswarm/agents/harness/common/tools/wiki_tools.py
- 源页字段（source_globs）：jiuwenswarm/agents/harness/common/tools/wiki_tools.py
