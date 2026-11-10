---
name: common-recommendation-contracts-01
description: common-recommendation 源码接口与集成边界 01：__init__.py、calendar_source.py、feedback_collector.py、gradient_updater.py、proactive_actions.py、proactive_engine.py 等 9 个模块
metadata:
  scope: 只收 common/recommendation 下 __init__.py 至 situation_report.py 共 9 个源码文件的静态声明（接口、类型、依赖与源码依据链接）
---
# common-recommendation 源码接口与集成边界 01

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/agents/harness/common/recommendation/__init__.py`**
- 源码对模块职责的说明：Proactive recommendation system — background engine for task reminder, need exploration, and skill matching based on current conversation.。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from jiuwenswarm.agents.harness.common.recommendation.profile_extractor imp`；`from jiuwenswarm.agents.harness.common.recommendation.proactive_engine impo`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/recommendation/__init__.py#L1-L30)。
- **`jiuwenswarm/agents/harness/common/recommendation/calendar_source.py`**
- 源码对模块职责的说明：Calendar data source for the proactive recommendation engine.。
- 异步入口 `fetch_calendar_events(max_events, lookahead_hours)`；声明返回 `list[dict[str, Any]]`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import json`；`import logging`；`from datetime import datetime, timedelta, timezone`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/recommendation/calendar_source.py#L1-L198)。
- **`jiuwenswarm/agents/harness/common/recommendation/feedback_collector.py`**
- 源码对模块职责的说明：Feedback collector for proactive recommendation optimization.。
- `RecMeta` 定义类型边界。
- 调用入口 `record_feedback(rec_id, feedback_type, user_reply, meta)`；声明返回 `None`。
- 调用入口 `record_explicit_feedback(rec_id, feedback_type, meta)`；声明返回 `None`。
- 调用入口 `record_implicit_feedback(rec_id, user_reply)`；声明返回 `None`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import logging`；`import time`；`from dataclasses import dataclass`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/recommendation/feedback_collector.py#L1-L241)。
- **`jiuwenswarm/agents/harness/common/recommendation/gradient_updater.py`**
- 源码对模块职责的说明：Gradient updater for proactive recommendation optimization.。
- 调用入口 `gradient_update_prompt(language)`；声明返回 `str`。
- 调用入口 `apply_operations(gradients, operations)`；声明返回 `list[dict]`。
- 异步入口 `update_gradients(feedbacks, existing_gradients, proactive_agent)`；声明返回 `list[dict]`。
- 调用入口 `attribute_gradients(gradients)`；声明返回 `tuple[list[dict], list[dict]]`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import json`；`import logging`；`import re`。
- 模块级配置或常量名称：`GRADIENT_UPDATE_PROMPT_ZH`, `GRADIENT_UPDATE_PROMPT_EN`, `DECISION_CATEGORIES`, `STYLE_CATEGORIES`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/recommendation/gradient_updater.py#L1-L678)。
- **`jiuwenswarm/agents/harness/common/recommendation/proactive_actions.py`**
- 源码对模块职责的说明：Proactive recommendation — decision types, skill discovery, rate limiting, and LLM analysis helpers.。
- `RecommendationDecision` 定义类型边界。
- `AnalysisResult` 定义类型边界。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import json`；`import logging`；`import re`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/recommendation/proactive_actions.py#L1-L446)。
- **`jiuwenswarm/agents/harness/common/recommendation/proactive_engine.py`**
- 源码对模块职责的说明：Proactive engine — service that scans user conversations, updates the user profile, and decides whether to proactively reach out with a skill recommendation, ta。
- `ProactiveEngine` 定义类型边界；方法入口：`__init__`, `set_proactive_agent`, `last_tick_at`, `rebuild_proactive_agent`, `set_trigger_main_agent_callback`, `set_check_agent_available_callback`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import logging`；`import re`；`import time`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/recommendation/proactive_engine.py#L1-L451)。
- **`jiuwenswarm/agents/harness/common/recommendation/proactive_prompts.py`**
- 源码对模块职责的说明：Proactive recommendation LLM prompt templates.。
- 调用入口 `unified_analysis_prompt(language)`；声明返回 `str`。
- 调用入口 `directive_prompt(language)`；声明返回 `str`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/recommendation/proactive_prompts.py#L1-L241)。
- **`jiuwenswarm/agents/harness/common/recommendation/profile_extractor.py`**
- 源码对模块职责的说明：Recommendation state persistence for the proactive recommendation engine.。
- `RecommendationState` 定义类型边界；方法入口：`add_recommendation`, `touch`。
- 调用入口 `load_recommendation_state(path)`；声明返回 `RecommendationState`。
- 调用入口 `save_recommendation_state(state, path)`；声明返回 `None`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import json`；`import logging`；`from dataclasses import asdict, dataclass, field`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/recommendation/profile_extractor.py#L1-L110)。
- **`jiuwenswarm/agents/harness/common/recommendation/situation_report.py`**
- 源码对模块职责的说明：Situation report builder — aggregates multi-session history, user profile, recommendation history, and pending commitments into a single LLM-ready context.。
- `SessionSummary` 定义类型边界。
- `SituationReport` 定义类型边界；方法入口：`is_empty`, `most_recent_active_session`, `find_session_for_channel`, `render_for_llm`。
- 异步入口 `build_situation_report(max_rounds, skills, mode_prefix)`；声明返回 `SituationReport`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import logging`；`import re`；`from dataclasses import dataclass, field`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/recommendation/situation_report.py#L1-L412)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/agents-team/common-recommendation/source-contracts-01.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
