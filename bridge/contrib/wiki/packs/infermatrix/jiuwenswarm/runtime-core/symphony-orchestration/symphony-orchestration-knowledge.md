---
name: symphony-orchestration-knowledge
description: Symphony service.py 基础知识：runtime 缓存键与构建互斥、install_candidate 重放与校验契约、config.yaml symphony 段默认值与归一化（top_k=0 变 1）、Web 图谱载荷的技能包展示边界、graph_state 与 evolution 开关单测范围
metadata:
  scope: 收 service.py 与 config.py 相关的架构、API、配置、功能、验证五类知识条目，来源另含 test_config.py、test_graph_state.py；构建顺序与存储布局归 jiuwenswarm-symphony，候选安装守卫顺序的完整说明归 jiuwenswarm-symphony-service
---
# Symphony orchestration service (jiuwenswarm/symphony/service.py) 基础知识页

## 现状

- **进程内 Symphony 服务的 runtime 管理与构建互斥**
- SwarmSymphonyService 是进程级单例（get_swarm_symphony_service），持有并复用 Core 的 SymphonyRuntime：默认模型 runtime 按 graph_dir、mode、top_k、max_depth、min_edge_confidence、evolution 开关与 LLM 签名组成缓存键重建。但服务并非只维护一个 runtime：plan 传入 llm_config 时会创建不带 Flow 的临时 runtime 并在结束后关闭；读取图谱工件时也会构造独立 runtime。
  - 缓存键变化时若现有 runtime 已挂 Flow store（单一进程 owner），会拒绝替换，配置变更需重启生效。所有图谱构建经 _build_guard 互斥，同一时刻仅一个构建任务。
- Sources / 来源：[jiuwenswarm/symphony/service.py:L210–L224](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/symphony/service.py#L210-L224),
  - [jiuwenswarm/symphony/service.py:L636–L672](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/symphony/service.py#L636-L672),
  - [jiuwenswarm/symphony/service.py:L449–L472](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/symphony/service.py#L449-L472),
  - [jiuwenswarm/symphony/service.py:L515–L533](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/symphony/service.py#L515-L533)
- **install_candidate 的重放与校验契约**
- install_candidate(request_id, recipe_id, recipe_version, package_id, integrity, skill_manager) 先用 experience_request_id(recipe_id, version) 校验 request_id，不匹配即拒绝。命中已安装时存在短路：内存或 flow 目录 install_receipts 中已有 installed=true 的回执时，直接以 replayed=true 返回并重新 acknowledge 候选，不再走 review_and_prepare_install。
  - 否则经 flow.review_and_prepare_install 复核，verdict 非 approved 即失败；调用方传入的 package_id 与 integrity 仅在非空时才与准备结果比对，之后还做完整性校验与 artifact 目录位置检查。
- Sources / 来源：[jiuwenswarm/symphony/service.py:L937–L998](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/symphony/service.py#L937-L998),
  - [jiuwenswarm/symphony/service.py:L80–L84](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/symphony/service.py#L80-L84)
- **config.yaml symphony 段的加载、默认值与归一化**
- load_symphony_config 从 get_config() 读取 config.yaml 的 symphony 段并经 symphony_config_from_dict 归一化：默认 symphony.enabled=false、evolution 关闭、orchestration mode="fast"、top_k=3、max_depth=4、min_edge_confidence=0.5；paths.skills_root/graph_dir 缺省落在工作区 skills 与 symphony/graph；
  - evolution.flow.enabled 缺省时回退旧位置 evolution.enabled。数值归一化注意：_positive_int 对可解析的非正整数取 max(1, parsed)（如 top_k=0 变为 1，而不是回退默认 3），仅解析失败才用默认；float 阈值被夹取到 [0,1]。
- Sources / 来源：[jiuwenswarm/symphony/config.py:L12–L33](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/symphony/config.py#L12-L33),
  - [jiuwenswarm/symphony/config.py:L112–L151](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/symphony/config.py#L112-L151),
  - [jiuwenswarm/symphony/config.py:L240–L273](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/symphony/config.py#L240-L273)
- **编排工具与 Web 图谱载荷中的技能包展示**
- 功能文档把 symphony_read_graph、symphony_refresh_graph、symphony_compose_graph 归为技能编排工具（查图谱状态、刷新图谱、生成执行图）。服务端 graph() 通过 _web_graph_payload 把能力图改写为 Web UI 形态：能力 id 映射为 skill:/capability: 引用，被禁用技能按规范化名称从 capabilities/nodes/edges 中过滤，并扫描工作区 SkillPacks 生成 pack 节点与 contains 边。
  - 两个已知边界：包扫描在 try 块内逐项追加、异常仅被吞掉，失败时可能保留已追加的部分包数据而非干净回退；不在主图中的包成员会被新建节点加入，绕过了上述禁用过滤。
- Sources / 来源：[docs/zh/Symphony-技能编排与分发.md:L93–L99](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/Symphony-%E6%8A%80%E8%83%BD%E7%BC%96%E6%8E%92%E4%B8%8E%E5%88%86%E5%8F%91.md#L93-L99),
  - [jiuwenswarm/symphony/service.py:L1188–L1214](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/symphony/service.py#L1188-L1214),
  - [jiuwenswarm/symphony/service.py:L1252–L1311](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/symphony/service.py#L1252-L1311)
- **graph_state 与 evolution 开关的既有单元测试**
- 既有辅助层单元测试（未在本次输入中运行）：tests/unit_tests/symphony/test_graph_state.py 直接构造 CapabilityDescriptor 与 GraphStateBuilder，断言 next_state 生成 schema_version "Symphony-graph-state-v2"、能力哈希键映射为相对路径，并覆盖从 v1 旧 skill_md_sha256 的一次性迁移读取。
  - tests/unit_tests/test_config.py 的 test_symphony_evolution_getter_reads_only_passed_switches 用 monkeypatch 把全局配置与完整解析器替换为 pytest.fail，验证 get_symphony_evolution_enabled 只读取传入的开关字典、不触发配置加载。二者均为 helper 单元测试，不是对 SwarmSymphonyService 运行时行为的端到端验证。
- Sources / 来源：[tests/unit_tests/symphony/test_graph_state.py:L34–L49](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/symphony/test_graph_state.py#L34-L49),
  - [tests/unit_tests/symphony/test_graph_state.py:L52–L67](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/symphony/test_graph_state.py#L52-L67),
  - [tests/unit_tests/test_config.py:L107–L134](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/test_config.py#L107-L134)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/symphony-orchestration/knowledge.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-07
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/symphony/service.py:L210-L224；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/symphony/service.py:L636-L672
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/symphony/service.py:L449-L472；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/symphony/service.py:L515-L533
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/symphony/service.py:L937-L998；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/symphony/service.py:L80-L84
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/symphony/config.py:L12-L33；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/symphony/config.py:L112-L151
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/symphony/config.py:L240-L273；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:docs/zh/Symphony-技能编排与分发.md:L93-L99
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/symphony/service.py:L1188-L1214；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/symphony/service.py:L1252-L1311
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/symphony/test_graph_state.py:L34-L49；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/symphony/test_graph_state.py:L52-L67
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/test_config.py:L107-L134
