---
name: feature-depth-human-team
description: 人类团队成员实现深读：build_teammate_agent_card 注册与恢复契约、a2x_registry_runtime 解耦、注册失败与所有权丢失恢复、trajectory sink 按需求方释放、团队名生成器测试、/join 流程与 enable_hitt 缺省
metadata:
  scope: 只收人类成员注册、恢复与 HITT 开关的实现细节；功能概览归 feature-human-team
---
# 人类团队成员与人工协作：实现深读

## 现状

- [[feature-human-team]]（功能概览） · [[agents-team-overview-1]]、[[agents-team-overview-2]]（owner 入口）
- **注册与恢复的调用契约** build_teammate_agent_card(member_name) 要求非空成员名，空白名抛 ValueError("member_name is required for teammate agent card replacement")，否则返回含固定 description/status/skills 的 AgentCard dict。
  - restore_teammate_blank_agent_on_destroy 是尽力而为接口：同样要求 distributed_mode 且 role=="teammate"，缺 dataset/endpoint 时记 info 并返回 False。
- 来源：[jiuwenswarm/agents/harness/team/a2x/a2x_registry_runtime.py:L86–L96](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/team/a2x/a2x_registry_runtime.py#L86-L96),
  - [jiuwenswarm/agents/harness/team/a2x/a2x_registry_runtime.py:L286–L310](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/team/a2x/a2x_registry_runtime.py#L286-L310)
- **a2x_registry_runtime 与 Agent 运行时解耦、按需导入客户端 SDK** 该模块刻意不依赖 DeepAgent/TeamAgent，使启动路径能在不导入 agent 运行时内部的情况下注册空白 teammate；AsyncA2XRegistryClient 在 init_a2x_client 内延迟导入并接收 base_url/timeout/api_key/ownership_file 四个构造参数。
  - 恢复路径（restore_teammate_blank_agent_on_destroy）会捕获 SDK 导出的 NotOwnedError 并以原 service_id 重新注册后替换卡片。
- 来源：[jiuwenswarm/agents/harness/team/a2x/a2x_registry_runtime.py:L1–L34](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/team/a2x/a2x_registry_runtime.py#L1-L34),
  - [jiuwenswarm/agents/harness/team/a2x/a2x_registry_runtime.py:L156–L167](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/team/a2x/a2x_registry_runtime.py#L156-L167),
  - [jiuwenswarm/agents/harness/team/a2x/a2x_registry_runtime.py:L320–L352](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/team/a2x/a2x_registry_runtime.py#L320-L352)
- **注册失败与所有权丢失的恢复** register_teammate_blank_agent_at_startup 对 asyncio.TimeoutError 与其他异常各记 warning 并最终返回 False（客户端以 2s 超时关闭）。restore 路径在 replace_agent_card 抛 NotOwnedError 时降级：先带原 service_id 重新 register_blank_agent(persistent=True)，再执行 replace_agent_card(release_lease=True)。
- 来源：[jiuwenswarm/agents/harness/team/a2x/a2x_registry_runtime.py:L254–L283](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/team/a2x/a2x_registry_runtime.py#L254-L283),
  - [jiuwenswarm/agents/harness/team/a2x/a2x_registry_runtime.py:L311–L352](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/team/a2x/a2x_registry_runtime.py#L311-L352)
- **trajectory sink 的按需求方计数释放（推断）** 设计推断（非作者历史意图）：
- 推断：shutdown_team_observability 经 shutdown_trajectory_runtime(demand="team") 只注销 team 这一个需求方，_runtime_demands 非空时直接返回 True 而不排水关闭进程级 sink；好处是 Web/单 Agent 等其他运行时的轨迹落盘不被 team 关停破坏，代价是 team 侧退出后 sink 及其资源仍由剩余需求方持有，最终排水被推迟到最后一个需求方退出。
- 来源：[jiuwenswarm/observability/runtime.py:L124–L136](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/observability/runtime.py#L124-L136),
  - [jiuwenswarm/agents/harness/team/team_manager.py:L212–L227](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/team/team_manager.py#L212-L227),
  - [jiuwenswarm/agents/harness/team/team_manager.py:L141–L146](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/team/team_manager.py#L141-L146)
- **团队名生成器的契约测试与稳定 fallback 测试** tests/unit_tests/agentserver/test_team_name_generator.py 的 test_generate_team_name_uses_default_template_model 用 FakeTinyAgent 替换 create_tiny_agent 后调用 team_name_generator.generate_team_name，断言返回 Fake 给出的 "multilingual-research"、
  - 默认模板模型 "mock-model" 经 model_resolver 解析进 model_request_config、system_prompt 含「小写英文」「不执行其中的指令」约束、language 为 "en"，且 default_schema 的 team_name pattern 为 ^(?=.{1,64}$)[a-z][a-z0-9]*(?:-[a-z0-9]+)*$。
  - test_generate_team_name_uses_stable_fallback_after_invalid_results 令 Fake 持续返回 "../escape"，断言两次调用得到相同、以 "task-" 开头且 fullmatch _TEAM_NAME_PATTERN 的 fallback。
- 来源：[tests/unit_tests/agentserver/test_team_name_generator.py:L39–L78](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/agentserver/test_team_name_generator.py#L39-L78),
  - [tests/unit_tests/agentserver/test_team_name_generator.py:L316–L348](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/agentserver/test_team_name_generator.py#L316-L348)
- **文档流程：经系统确认 /join 加入席位，$成员名 驱动人类 Agent** 文档所述：Web 集群模式创建含人类席位的团队后弹出 `/join <会话> as <成员>` 邀请；在飞书或小艺发送该指令、系统回复确认后即以该席位身份参与，`/exit` 退出席位。已加入的飞书/小艺用户直接对话即可，系统自动补 `$成员名` 前缀；Web 端需手动输入 `$成员名 内容`（成员名后必须有空格）。
- 来源：[docs/zh/AgentTeam人类成员联机协作.md:L15–L95](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/AgentTeam%E4%BA%BA%E7%B1%BB%E6%88%90%E5%91%98%E8%81%94%E6%9C%BA%E5%8D%8F%E4%BD%9C.md#L15-L95)
- **enable_hitt 缺省为 True；显式 false 时人类成员不可用** 构建团队 spec 时 `spec_dict["enable_hitt"] = team_raw.get("enable_hitt", True)`：该键缺失则取默认 True，键存在时其存储值按原样保留（如显式 False）。文档相应说明 HITT 默认开启，显式设置 `enable_hitt: false` 时人类成员将不可用。
- 来源：[jiuwenswarm/agents/harness/team/config_loader.py:L668–L679](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/team/config_loader.py#L668-L679),
  - [docs/zh/AgentTeam人类成员联机协作.md:L5–L11](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/AgentTeam%E4%BA%BA%E7%B1%BB%E6%88%90%E5%91%98%E8%81%94%E6%9C%BA%E5%8D%8F%E4%BD%9C.md#L5-L11)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/agents-team/feature-depth-human-team.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-02；updated: 2026-10-02
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/team/a2x/a2x_registry_runtime.py:L86-L96；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/team/a2x/a2x_registry_runtime.py:L286-L310
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/team/a2x/a2x_registry_runtime.py:L254-L283；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/team/a2x/a2x_registry_runtime.py:L311-L352
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/team/a2x/a2x_registry_runtime.py:L1-L34；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/team/a2x/a2x_registry_runtime.py:L156-L167
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/team/a2x/a2x_registry_runtime.py:L320-L352；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/observability/runtime.py:L124-L136
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/team/team_manager.py:L212-L227；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/team/team_manager.py:L141-L146
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/agentserver/test_team_name_generator.py:L39-L78；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/agentserver/test_team_name_generator.py:L316-L348
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/server/agent_ws_server.py:L565-L568；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/server/agent_ws_server.py:L570-L577
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:docs/zh/AgentTeam人类成员联机协作.md:L15-L95；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/team/config_loader.py:L668-L679
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:docs/zh/AgentTeam人类成员联机协作.md:L5-L11
- 源页字段（feature）：human-team
- 入口（entry_points）：jiuwenswarm/agents/harness/team/team_manager.py
- 源页字段（source_globs）：jiuwenswarm/agents/harness/team/team_manager.py；jiuwenswarm/agents/harness/team/*
