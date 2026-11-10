---
name: feature-llm-wiki-knowledge-base
description: LLM Wiki 知识库（wiki_ingest/query/lint 子代理）：LLMWiki 分层结构、workspace 解析与模型来源、SHA-256 去重导入、三个 @tool 入口签名与错误契约、取舍与单测
metadata:
  scope: 收 wiki_tools.py 的功能页（architecture），来源另含 test_wiki_tools_runtime_config.py；wiki_query 流程、参数传播与失败分支的实现深读归 feature-depth-llm-wiki-knowledge-base
---
# LLM Wiki 知识库（wiki_ingest/query/lint 子代理）

## 现状

- **LLMWiki 包装 DeepAgent 的分层结构**
- LLMWiki 是核心类：构造时把 workspace 划分为 sources/、wiki/、schema/ 三个目录（L195-201），并通过 create_deep_agent 创建一个内部 DeepAgent（L216-233）；ingest/query/lint 都是把自然语言指令拼成 query 后调用 self.agent.invoke，共享同一个 Session（L340、L354、L365）。ensure_initialized 幂等地创建目录并写入 schema/AGENT.md、wiki/index.md、wiki/log.md 的初始内容（L242-308）。
  - ingest 按 SHA-256 去重（force=False 且已记录则跳过），仅当结果不含 "error" 且 output 不以 "[ERROR" 开头时才把哈希写入 manifest——即代码只保证显式失败时不新增记录，不保证失败后可重试（L318-346）。
- Sources / 来源：[jiuwenswarm/agents/harness/common/tools/wiki_tools.py:L195–L233](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/wiki_tools.py#L195-L233),
  - [jiuwenswarm/agents/harness/common/tools/wiki_tools.py:L242–L258](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/wiki_tools.py#L242-L258),
  - [jiuwenswarm/agents/harness/common/tools/wiki_tools.py:L318–L347](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/wiki_tools.py#L318-L347)
- **workspace 解析与模型来源**
- workspace 由 _resolve_workspace 规范化：空串或等于 DEFAULT_WIKI_DIR 时映射到 base_dir/DEFAULT_WIKI_DIR；相对路径挂在 get_agent_workspace_dir() 之下；若路径末段不是 DEFAULT_WIKI_DIR 则追加该目录名（L398-415）。
  - 三个工具入口的模型固定来自 _get_default_model()（L478、L537、L570），该函数从默认模型配置取值并补齐 api_key/api_base/client_provider/model_name 等缺省以防 ValidationError（L368-395）；而 LLMWiki 类本身接受调用方传入的 model 并直接使用（L176、L217）。
- Sources / 来源：[jiuwenswarm/agents/harness/common/tools/wiki_tools.py:L368–L415](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/wiki_tools.py#L368-L415),
  - [jiuwenswarm/agents/harness/common/tools/wiki_tools.py:L470–L485](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/wiki_tools.py#L470-L485)
- **现有单测覆盖 _create_llm_wiki 与会话 lineage**
- tests/unit_tests/agents/test_wiki_tools_runtime_config.py 有三个用例：test_create_llm_wiki_propagates_runtime_policy_and_parent_lineage 通过 monkeypatch 假配置与会话，断言 enable_read_image_multimodal=False 被透传、session_id 形如 "{owner}:subagent:wiki:{workspace_scope}" 且 parent_session_id 指向父会话，
  - 并断言亲和配置的 enable_kv_cache_affinity 为 True（L30-74）；test_llm_wiki_session_exposes_provider_cache_lineage 构造真实 LLMWiki（stub 掉 create_deep_agent）后调用 resolve_session_lineage 验证内部 Session 的 lineage 解析结果（L77-94）；第三个用例验证 OpenAI affinity 模型同样得到启用亲和的 kv_cache_affinity_config（L97-125）。
  - 这些测试断言的是配置构造与 lineage，不涉及 ingest/query/lint 的运行时行为。
- Sources / 来源：[tests/unit_tests/agents/test_wiki_tools_runtime_config.py:L30–L74](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/agents/test_wiki_tools_runtime_config.py#L30-L74),
  - [tests/unit_tests/agents/test_wiki_tools_runtime_config.py:L77–L94](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/agents/test_wiki_tools_runtime_config.py#L77-L94),
  - [tests/unit_tests/agents/test_wiki_tools_runtime_config.py:L97–L125](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/agents/test_wiki_tools_runtime_config.py#L97-L125)
- **SHA-256 去重导入与目录级递归收集**
- LLMWiki.ingest 计算源文件 SHA-256，force=False 且 manifest 已知该哈希时返回 skipped 而不调用 agent；成功路径把源文件复制为 sources/{sha256前8位}_{文件名} 并仅在结果无 error 时写入 manifest 记录。wiki_ingest 对目录输入递归收集 .pdf/.md/.txt 三类文件，并用 posix 路径前缀比对 .llm_wiki 工作区根来跳过自身目录，避免循环导入；每个文件的结果聚合为 [Failed]/[Skipped]: Deduplicated/[Success] 的 JSON 摘要。
- Sources / 来源：[jiuwenswarm/agents/harness/common/tools/wiki_tools.py:L313–L347](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/wiki_tools.py#L313-L347),
  - [jiuwenswarm/agents/harness/common/tools/wiki_tools.py:L494–L519](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/wiki_tools.py#L494-L519)
- **三个 @tool 入口的签名与错误契约**
- 公开入口是三个 @tool 装饰的异步函数：`wiki_ingest(source: str, workspace: str = "", force: bool = False, sys_operation: Optional[SysOperation] = None) -> str`（L470-475）；`wiki_query(query: str, workspace: str = "", sys_operation: Optional[SysOperation] = None) -> str`（L530-532）；
  - `wiki_lint(workspace: str = "", sys_operation: Optional[SysOperation] = None) -> str`（L567）。错误契约：wiki_query 对空 query 直接返回 "Error: Query cannot be empty."（L534-535），wiki_query/wiki_lint 在 workspace 不存在时返回提示先使用 wiki_ingest 的错误字符串（L539-543、L572-576）；
  - wiki_ingest 对不存在的 source 返回 "Error: Source ... not found."，并以 try/except 把异常转成字符串返回而非抛出（L491-492、L520-521）。
- Sources / 来源：[jiuwenswarm/agents/harness/common/tools/wiki_tools.py:L470–L475](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/wiki_tools.py#L470-L475),
  - [jiuwenswarm/agents/harness/common/tools/wiki_tools.py:L530–L543](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/wiki_tools.py#L530-L543),
  - [jiuwenswarm/agents/harness/common/tools/wiki_tools.py:L567–L576](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/wiki_tools.py#L567-L576),
  - [jiuwenswarm/agents/harness/common/tools/wiki_tools.py:L491–L521](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/wiki_tools.py#L491-L521)
- **ingest 前置校验与 prompt 驱动的维护**
- Inference / 设计推断（非作者历史意图）：
- ingest 路径在代码层面做的确定性校验包括：源文件存在性检查（不存在则抛 FileNotFoundError，L315-316）、SHA-256 去重（force=False 且已记录则跳过，L318-327），以及 wiki_ingest 目录模式下用 posix 路径前缀比对排除 .llm_wiki 工作区自身以避免循环导入（L494-505）；
  - 其余知识提取、交叉链接与结构维护完全交给 LLM：ingest/lint 的指令是拼接的自然语言 prompt（L333-339、L357-364），manifest 仅在结果不含 "error" 且 output 不以 "[ERROR" 开头时记录哈希（L342-346）。这一取舍的代价是 wiki 内容质量依赖模型对 schema/AGENT.md 规则的遵循，代码不校验生成的 wiki 页面是否符合规则；收益是去重与防循环导入无需模型参与、行为可预测。
- Sources / 来源：[jiuwenswarm/agents/harness/common/tools/wiki_tools.py:L313–L347](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/wiki_tools.py#L313-L347),
  - [jiuwenswarm/agents/harness/common/tools/wiki_tools.py:L494–L505](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/wiki_tools.py#L494-L505),
  - [jiuwenswarm/agents/harness/common/tools/wiki_tools.py:L356–L365](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/wiki_tools.py#L356-L365)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/agents-team/feature-llm-wiki-knowledge-base.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-07
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/wiki_tools.py:L195-L233；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/wiki_tools.py:L242-L258
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/wiki_tools.py:L318-L347；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/wiki_tools.py:L368-L415
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/wiki_tools.py:L470-L485；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/agents/test_wiki_tools_runtime_config.py:L30-L74
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/agents/test_wiki_tools_runtime_config.py:L77-L94；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/agents/test_wiki_tools_runtime_config.py:L97-L125
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/wiki_tools.py:L313-L347；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/wiki_tools.py:L494-L519
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/wiki_tools.py:L470-L475；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/wiki_tools.py:L530-L543
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/wiki_tools.py:L567-L576；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/wiki_tools.py:L491-L521
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/wiki_tools.py:L494-L505；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/wiki_tools.py:L356-L365
- 源页字段（feature）：llm-wiki-knowledge-base
- 入口（entry_points）：jiuwenswarm/agents/harness/common/tools/wiki_tools.py
- 源页字段（source_globs）：jiuwenswarm/agents/harness/common/tools/wiki_tools.py
