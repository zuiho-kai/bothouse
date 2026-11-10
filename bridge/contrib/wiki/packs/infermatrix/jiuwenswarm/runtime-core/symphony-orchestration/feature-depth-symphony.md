---
name: feature-depth-symphony
description: Symphony 检索与图谱编排实现深读：服务启动配置加载链、start_refresh_graph 后台复用契约、默认值与 flow 开关回退、FingerprintService 适配器注入、后台构建异常处理、graph_status 扫描取舍、test_config.py 断言范围
metadata:
  scope: 只收 Symphony 的逐点实现深读；功能入口级知识归 feature-symphony，构建顺序与存储布局归 jiuwenswarm-symphony
---
# Symphony 检索与图谱编排：实现深读

## 现状

- [[feature-symphony]]（功能概览） · [[symphony-orchestration-overview]]（owner 入口）
- **服务启动时的配置加载链** SwarmSymphonyService.start() 在启用开关检查前先调用 load_symphony_config()；load_symphony_config 在未传入 config 时调用 get_config() 读取并解析 config.yaml（含环境变量解析与归一化），返回的字典再经 symphony_config_from_dict 转成 SymphonyConfig，start 据此判断 config.enabled 与 evolution_flow_enabled 决定是否继续 Flow 恢复。
- 调用路径：`jiuwenswarm/symphony/service.py`（`SwarmSymphonyService.start`） → `jiuwenswarm/symphony/config.py`（`load_symphony_config`） → `jiuwenswarm/common/config.py`（`get_config`）
- 来源：[jiuwenswarm/symphony/service.py:L808–L819](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/symphony/service.py#L808-L819),
  - [jiuwenswarm/symphony/config.py:L112–L120](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/symphony/config.py#L112-L120),
  - [jiuwenswarm/common/config.py:L237–L244](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/config.py#L237-L244)
- **start_refresh_graph 的后台复用契约** start_refresh_graph(force=...) 在 _build_guard 保护下复用未完成的 symphony-graph-build 任务：若已有任务在跑，直接返回 {"success": true, "background": true, "build_status": "running"}；否则重置 build_log.jsonl、记录 update.start 并创建新任务。调用方义务是用 build_status/build_progress 轮询，而不是假定启动即完成。
- 来源：[jiuwenswarm/symphony/service.py:L264–L321](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/symphony/service.py#L264-L321)
- **默认值与 flow 开关回退** 代码默认 symphony.enabled=false、orchestration.mode="fast"、min_edge_confidence=0.5；evolution.flow.enabled 缺省时回退读取旧位置 evolution.enabled（symphony_config_from_dict 中 flow_enabled 为 None 时取 evolution.get("enabled")）。路径缺省落在 get_agent_workspace_dir() 下的 skills 与 symphony/graph。
- 来源：[jiuwenswarm/symphony/config.py:L12–L33](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/symphony/config.py#L12-L33),
  - [jiuwenswarm/symphony/config.py:L127–L151](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/symphony/config.py#L127-L151)
- **构建期把本地适配器注入核心 FingerprintService** GraphBuildRuntimeFactory.fingerprint_service 构造核心 openjiuwen 的 FingerprintService 时，把扫描结果包装成 ScanResultCapabilityProvider 作为能力来源，并在提供 llm_config 时注入 FingerprintLLMAdapter、用 fingerprint_settings_from_swarm 翻译本地配置。
  - 这层耦合决定了本地 Symphony 配置（workers、batch_size 等）如何进入核心指纹提取流程。
- 来源：[jiuwenswarm/symphony/build.py:L139–L154](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/symphony/build.py#L139-L154),
  - [jiuwenswarm/symphony/adapter.py:L91–L122](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/symphony/adapter.py#L91-L122)
- **tests/unit_tests/symphony/test_config.py 的断言范围** test_symphony_config_defaults_paths 断言空配置时 skills/graph 默认路径、batch_size=12、mode="fast"、enabled=False；test_symphony_config_normalizes_values 断言字符串数字归一与 min_edge_confidence 越界夹取（2→1.0、-1→0.0）；
  - test_symphony_config_rejects_non_llm_orchestration_modes 断言非 fast/beam 模式抛 ValueError。这些是断言所锻炼的行为入口，不代表本次已运行通过。
- 来源：[tests/unit_tests/symphony/test_config.py:L6–L30](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/symphony/test_config.py#L6-L30),
  - [tests/unit_tests/symphony/test_config.py:L50–L118](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/symphony/test_config.py#L50-L118)
- **后台构建任务异常由 _consume_background_build_result 记录而不重抛；构建日志载荷并入 status 返回值** 后台构建任务收尾时 _consume_background_build_result 调 task.result()：asyncio.CancelledError 直接 return，其余 Exception 仅以 logger.exception("Background Skill Graph build failed") 记录、不重抛；
  - graph_status 的 status() 返回前执行 payload.update(_build_log_payload(graph_dir)) 并调用 _prefer_build_failure_detail(payload)，构建日志载荷由此进入状态返回值。
- 来源：[jiuwenswarm/symphony/service.py:L1111–L1119](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/symphony/service.py#L1111-L1119),
  - [jiuwenswarm/symphony/service.py:L235–L247](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/symphony/service.py#L235-L247)
- **graph_status 状态路径以受 max_depth 限制的扫描与哈希换取内容级新鲜度判定** 设计推断（非作者历史意图）：
- service.graph_status 先修复中断构建态，再于线程中调用 builder.status：按 fingerprint.scan.max_depth 扫描 skills_root 并计算 capability hashes，与 active entries 比出 added/changed/removed；图存在且初步未过期时还读 orchestration 工件校验快照身份（FileNotFoundError/ValueError 则判 stale）。收益是按当前技能内容判定 stale；代价是每次该状态调用都承担扫描与哈希（新鲜图另有工件读取）。
  - 仅限此状态路径，不推及其他应答入口；超出扫描深度的变动不保证被捕获。
- 来源：[jiuwenswarm/symphony/service.py:L227–L249](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/symphony/service.py#L227-L249),
  - [jiuwenswarm/symphony/build.py:L558–L573](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/symphony/build.py#L558-L573),
  - [jiuwenswarm/symphony/build.py:L170–L261](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/symphony/build.py#L170-L261)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/symphony-orchestration/feature-depth-symphony.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-02；updated: 2026-10-02
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/symphony/service.py:L264-L321；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/symphony/config.py:L12-L33
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/symphony/config.py:L127-L151；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/symphony/test_config.py:L6-L30
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/symphony/test_config.py:L50-L118；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/symphony/service.py:L808-L819
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/symphony/config.py:L112-L120；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/common/config.py:L237-L244
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/symphony/build.py:L139-L154；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/symphony/adapter.py:L91-L122
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/symphony/service.py:L1111-L1119；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/symphony/service.py:L235-L247
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/symphony/service.py:L227-L249；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/symphony/build.py:L558-L573
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/symphony/build.py:L170-L261
- 源页字段（feature）：symphony
- 入口（entry_points）：jiuwenswarm/symphony/service.py
- 源页字段（source_globs）：jiuwenswarm/symphony/service.py；jiuwenswarm/symphony/*.py
