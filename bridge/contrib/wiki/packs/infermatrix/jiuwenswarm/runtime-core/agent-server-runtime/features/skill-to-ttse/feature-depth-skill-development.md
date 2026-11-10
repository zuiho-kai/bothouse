---
name: feature-depth-skill-development
description: SkillDev 实现深读：handle() 方法分发与 skilldev.error 响应、SkillDevState 默认值与 start 参数缺省、run() 挂起点与阶段循环、_checkpoint 经 SkillDevDeps 的状态与工作区同步、IMPROVE/TEST_RUN 抛 ValueError、checkpoint 取舍推断、schema._now_iso 单测
metadata:
  scope: 收 SkillDev 服务与流水线的实现级证据（service.py、pipeline.py、deps.py、store.py、schema.py 与对应单测），来源另含 DESIGN.md、improve_stage.py、test_run_stage.py、test_skilldev_schema_now_iso.py；职责、接口与配置概览归 feature-skill-development
---
# SkillDev 创建、评测与打包边界：实现深读

## 现状

- [[feature-skill-development]]（功能概览） · [[agent-server-runtime-overview]]（owner 入口）
- **handle() 的方法分发契约** handle(request) 按 request.req_method 查 _METHOD_DISPATCH（7 个 skilldev.* 方法各映射一个 _handle_* 函数）；未知 method 产出一个 is_complete=True、payload 为 {event_type: "skilldev.error", error: ...} 的 AgentResponseChunk。
  - handler 返回值既可以是 AsyncIterator（逐个 yield chunk），也可以是单个 AgentResponseChunk，调用方无需区分。
- 来源：[jiuwenswarm/server/runtime/skill/skilldev/service.py:L44–L52](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/skill/skilldev/service.py#L44-L52),
  - [jiuwenswarm/server/runtime/skill/skilldev/service.py:L65–L83](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/skill/skilldev/service.py#L65-L83),
  - [jiuwenswarm/server/runtime/skill/skilldev/service.py:L328–L336](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/skill/skilldev/service.py#L328-L336)
- **SkillDevState 的默认值与 start 参数缺省** 新建任务时 SkillDevState 默认 stage=INIT、mode=CREATE、iteration=0（schema.py L117–L119）；_handle_start 从 params 填充 input，缺省为 query=""、tools=[]、resources=[]、existing_skill=None，因此仅传 query 即可发起 create 模式任务。
- 来源：[jiuwenswarm/server/runtime/skill/skilldev/service.py:L92–L101](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/skill/skilldev/service.py#L92-L101),
  - [jiuwenswarm/server/runtime/skill/skilldev/schema.py:L113–L122](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/skill/skilldev/schema.py#L113-L122)
- **run() 循环：非终态时执行当前阶段或命中挂起点暂停；退出循环后才排空 _event_queue 并 yield** state.stage 非终态时循环：命中 SUSPENSION_POINTS 则 emit TODOS_UPDATE 与 CONFIRM_REQUEST、await _checkpoint() 后 break 暂停；
  - 否则（STAGE_HANDLERS 有该阶段 handler 时）ensure_local 取 workspace 构造 SkillDevContext，emit STAGE_CHANGED/TODOS_UPDATE，await handler.execute 后 stage=result.next_stage 并 checkpoint。经 break 或 while 条件退出后才排空 _event_queue 逐个 yield。
- 来源：[jiuwenswarm/server/runtime/skill/skilldev/pipeline.py:L74–L148](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/skill/skilldev/pipeline.py#L74-L148)
- **SkillDevPipeline._checkpoint 经注入 SkillDevDeps 耦合状态持久化与工作区同步（存储可替换）** _checkpoint 先 await self._deps.state_store.save_state(task_id, state)，再 await self._deps.workspace_provider.sync_to_remote(task_id)；两项耦合均经由 __init__ 注入的 SkillDevDeps，store.py 文档注明当前实现为本地 state.json、可替换 Redis 而接口不变。
- 来源：[jiuwenswarm/server/runtime/skill/skilldev/pipeline.py:L68–L72](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/skill/skilldev/pipeline.py#L68-L72),
  - [jiuwenswarm/server/runtime/skill/skilldev/pipeline.py:L186–L194](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/skill/skilldev/pipeline.py#L186-L194),
  - [jiuwenswarm/server/runtime/skill/skilldev/deps.py:L35–L37](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/skill/skilldev/deps.py#L35-L37),
  - [jiuwenswarm/server/runtime/skill/skilldev/store.py:L7–L8](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/skill/skilldev/store.py#L7-L8)
- **IMPROVE feedback_history 为空或 TEST_RUN evals 缺失时 execute 抛 ValueError** ImproveStageHandler.execute 在 ctx.state.feedback_history 为空时 raise ValueError("IMPROVE 阶段缺少反馈历史，请先完成 REVIEW 阶段")；TestRunStageHandler 在 state.evals 无用例时同样 raise ValueError；两处分支均不返回 StageResult。
- 来源：[jiuwenswarm/server/runtime/skill/skilldev/stages/improve_stage.py:L82–L84](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/skill/skilldev/stages/improve_stage.py#L82-L84),
  - [jiuwenswarm/server/runtime/skill/skilldev/stages/test_run_stage.py:L38–L41](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/skill/skilldev/stages/test_run_stage.py#L38-L41)
- **挂起点与每阶段推进均 checkpoint（DESIGN：序列化到 state.json 供 respond 恢复）；代价是额外持久化（推断）** 设计推断（非作者历史意图）：
- pipeline 在挂起点（L100）与每阶段成功推进后（L135）都 await _checkpoint()；DESIGN.md 记载 _checkpoint() 在每个阶段边界将 State 序列化到 state.json、_handle_respond 从 state.json 加载恢复。推断：收益是任务可在挂起点跨请求续跑；成本是每次阶段迁移都多一次状态序列化开销。
- 来源：[jiuwenswarm/server/runtime/skill/skilldev/pipeline.py:L84–L101](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/skill/skilldev/pipeline.py#L84-L101),
  - [jiuwenswarm/server/runtime/skill/skilldev/pipeline.py:L131–L135](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/skill/skilldev/pipeline.py#L131-L135),
  - [jiuwenswarm/server/runtime/skill/skilldev/DESIGN.md:L464–L468](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/skill/skilldev/DESIGN.md#L464-L468)
- **SkillDev schema._now_iso 的格式与 UTC 范围断言（helper 级单测）** test_now_iso_format_and_no_deprecation_warning 直接导入 jiuwenswarm.server.runtime.skill.skilldev.schema._now_iso，在调用前后记录 UTC 时间并捕获 DeprecationWarning；断言返回值匹配 YYYY-MM-DDTHH:MM:SSZ 正则、无该类警告，且解析后时间位于 before 与 after 之间。
  - 该测试仅覆盖此 helper，未在本轮执行，不触及技能生成、评测或打包流程。
- 来源：[tests/unit_tests/agentserver/test_skilldev_schema_now_iso.py:L1–L25](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/agentserver/test_skilldev_schema_now_iso.py#L1-L25),
  - [jiuwenswarm/server/runtime/skill/skilldev/schema.py:L647–L651](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/skill/skilldev/schema.py#L647-L651)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/agent-server-runtime/feature-depth-skill-development.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-02；updated: 2026-10-02
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/server/runtime/skill/skilldev/service.py:L44-L52；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/server/runtime/skill/skilldev/service.py:L65-L83
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/server/runtime/skill/skilldev/service.py:L328-L336；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/server/runtime/skill/skilldev/service.py:L92-L101
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/server/runtime/skill/skilldev/schema.py:L113-L122；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/server/runtime/skill/skilldev/pipeline.py:L74-L148
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/server/runtime/skill/skilldev/pipeline.py:L84-L101；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/server/runtime/skill/skilldev/pipeline.py:L131-L135
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/server/runtime/skill/skilldev/DESIGN.md:L464-L468；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/server/runtime/skill/skilldev/stages/improve_stage.py:L82-L84
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/server/runtime/skill/skilldev/stages/test_run_stage.py:L38-L41；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/server/runtime/skill/skilldev/pipeline.py:L68-L72
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/server/runtime/skill/skilldev/pipeline.py:L186-L194；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/server/runtime/skill/skilldev/deps.py:L35-L37
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/server/runtime/skill/skilldev/store.py:L7-L8；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/agentserver/test_skilldev_schema_now_iso.py:L1-L25
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/server/runtime/skill/skilldev/schema.py:L647-L651
- 源页字段（feature）：skill-development
- 入口（entry_points）：jiuwenswarm/server/runtime/skill/skilldev/service.py；jiuwenswarm/server/runtime/skill/skilldev/pipeline.py；jiuwenswarm/server/runtime/skill/skilldev/deps.py；jiuwenswarm/server/runtime/skill/skilldev/context.py
- 源页字段（source_globs）：jiuwenswarm/server/runtime/skill/skilldev/service.py；jiuwenswarm/server/runtime/skill/skilldev/pipeline.py；jiuwenswarm/server/runtime/skill/skilldev/deps.py；jiuwenswarm/server/runtime/skill/skilldev/context.py
