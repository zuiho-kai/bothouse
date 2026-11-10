---
name: feature-depth-modes
description: Agent、Code 与 Team 模式实现深读：resolve_mode_capability 解析契约与 BAD_REQUEST/NOT_FOUND、deprecate_mode 空 mode 与 normalize_mode_text 的差异、plan 入口字面量跨端契约测试、旧串静默映射取舍、单 Agent 四个模式描述符目录、mode_catalog 对 mode_matrix 的依赖
metadata:
  scope: 收 mode_catalog.py 与 mode_matrix.py 的实现级证据，来源另含 test_plan_entry_source_contract.py；功能概览与 modes.* 配置示例键归 feature-modes
---
# Agent、Code 与 Team 模式：实现深读

## 现状

- [[feature-modes]]（功能概览） · [[agent-server-runtime-overview]]（owner 入口）
- **resolve_mode_capability 的解析契约** resolve_mode_capability(requested) 接受任意对象，经 deprecate_mode 归一并 strip 后，空值抛 ModeCatalogError("mode is required", code="BAD_REQUEST")，未在 _SINGLE_AGENT_MODES 中命中抛 ModeCatalogError("single-Agent mode not found", code="NOT_FOUND")；调用方必须处理这两个错误码而非期待返回 None。
- 来源：[jiuwenswarm/runtime/mode_catalog.py:L92–L101](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/mode_catalog.py#L92-L101),
  - [jiuwenswarm/runtime/mode_catalog.py:L21–L27](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/mode_catalog.py#L21-L27)
- **空 mode 的两级不同行为** deprecate_mode 对 None/空串/空白串原样返回（不做空串回落），因此空值不会被误映射为 agent.work.normal；下游 resolve_mode_capability 据此抛 code="BAD_REQUEST"。而未经 deprecate_mode 的 normalize_mode_text 会把空值回落为 "agent"——绕过 deprecate_mode 直接判定的调用方与走完整归一的调用方行为不一致。
- 来源：[jiuwenswarm/common/mode_matrix.py:L309–L326](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/mode_matrix.py#L309-L326),
  - [jiuwenswarm/common/mode_matrix.py:L219–L223](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/mode_matrix.py#L219-L223),
  - [jiuwenswarm/runtime/mode_catalog.py:L92–L101](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/mode_catalog.py#L92-L101)
- **plan 入口字面量跨端契约测试** tests/unit_tests/test_plan_entry_source_contract.py 用 test_explicit_plan_entry_accepts_known_sources / test_explicit_plan_entry_rejects_unknown_sources 断言 AgentWebSocketServer._is_explicit_plan_entry_request 只接受 slash_command 与 plan_toggle 两个已知字面量，空串、大小写偏差和非 dict params 均拒绝；
  - 并用正则解析 TUI/Web 的 .ts 常量与后端 PLAN_ENTRY_SOURCES 做 == 比对。
- 来源：[tests/unit_tests/test_plan_entry_source_contract.py:L126–L163](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/test_plan_entry_source_contract.py#L126-L163),
  - [tests/unit_tests/test_plan_entry_source_contract.py:L72–L93](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/test_plan_entry_source_contract.py#L72-L93)
- **canonical 归一与单 Agent 目录匹配调用链** 输入请求携带的 mode 串（如旧串 agent）：resolve_mode_capability 先调用 deprecate_mode；deprecate_mode 经 canonicalize_mode_text 得到规范文本并查 DEPRECATION_MAP，把 agent 映射为 agent.work.normal；canonicalize_mode_text 内部先由 normalize_mode_text 做小写化与空值回落 agent，再查 MODE_ALIASES。
  - resolve_mode_capability 最后在 _SINGLE_AGENT_MODES 的四个 agent.* 描述符中精确匹配，命中返回 RuntimeModeDescriptor，team 等非单 Agent 串抛 ModeCatalogError(code=NOT_FOUND)，空串抛 code=BAD_REQUEST。
- 调用路径：`jiuwenswarm/runtime/mode_catalog.py`（`resolve_mode_capability`） → `jiuwenswarm/common/mode_matrix.py`（`deprecate_mode`） → `jiuwenswarm/common/mode_matrix.py`（`canonicalize_mode_text`） → `jiuwenswarm/common/mode_matrix.py`（`normalize_mode_text`）
- 来源：[jiuwenswarm/runtime/mode_catalog.py:L92–L101](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/mode_catalog.py#L92-L101),
  - [jiuwenswarm/runtime/mode_catalog.py:L59–L84](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/mode_catalog.py#L59-L84),
  - [jiuwenswarm/common/mode_matrix.py:L309–L326](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/mode_matrix.py#L309-L326),
  - [jiuwenswarm/common/mode_matrix.py:L219–L229](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/mode_matrix.py#L219-L229)
- **旧串静默映射的兼容收益与观测代价** 设计推断（非作者历史意图）：
- 文档记载迁移策略：旧串经 deprecate_mode() 静默映射到新串，不抛错、不告警，旧客户端继续发旧串也能正常工作。代码中映射仅在文本变化时输出一条 logger.debug。推断：收益是旧客户端零改动即可兼容；代价是仍在使用旧串的流量在生产日志里几乎不可见，迁移退场进度难以度量。
- 来源：[docs/zh/模式系统.md:L39–L43](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E6%A8%A1%E5%BC%8F%E7%B3%BB%E7%BB%9F.md#L39-L43),
  - [docs/zh/模式系统.md:L67–L69](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E6%A8%A1%E5%BC%8F%E7%B3%BB%E7%BB%9F.md#L67-L69),
  - [jiuwenswarm/common/mode_matrix.py:L309–L326](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/mode_matrix.py#L309-L326)
- **单 Agent 模式能力目录：模块级硬编码的四个描述符，包装返回** `_SINGLE_AGENT_MODES` 为模块级常量：`agent.work.normal`/`agent.work.plan` 为 `work_mode="work"`、`supports_custom_agent_definitions=False`；`agent.code.normal`/`agent.code.plan` 为 `"code"`、`True`。
  - `list_mode_capabilities()` 返回 `ModeCatalogResult(modes=...)` 包装而非裸元组，描述符字段必填、无默认值。
- 来源：[jiuwenswarm/runtime/mode_catalog.py:L59–L84](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/mode_catalog.py#L59-L84),
  - [jiuwenswarm/runtime/mode_catalog.py:L87–L89](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/mode_catalog.py#L87-L89),
  - [jiuwenswarm/runtime/mode_catalog.py:L30–L37](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/mode_catalog.py#L30-L37),
  - [jiuwenswarm/common/mode_matrix.py:L33–L36](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/mode_matrix.py#L33-L36)
- **mode_catalog 导入 mode_matrix 的 NEW_AGENT_* 常量与 deprecate_mode；模式另决定 profile/Rails 装配（文档）** mode_catalog.py 从 jiuwenswarm.common.mode_matrix 导入四个 NEW_AGENT_* 常量与 deprecate_mode：目录条目 mode 串的取值与 resolve_mode_capability 的归一（先 deprecate_mode 再在 _SINGLE_AGENT_MODES 内匹配）都依赖该模块。
  - 文档另载模式决定装配：code.normal 走 Code Adapter，固定挂载 LspRail、CodingMemoryRail 等 Rails。
- 来源：[jiuwenswarm/runtime/mode_catalog.py:L10–L16](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/mode_catalog.py#L10-L16),
  - [jiuwenswarm/runtime/mode_catalog.py:L92–L101](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/mode_catalog.py#L92-L101),
  - [docs/zh/模式系统.md:L230–L238](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E6%A8%A1%E5%BC%8F%E7%B3%BB%E7%BB%9F.md#L230-L238)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/agent-server-runtime/feature-depth-modes.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-02；updated: 2026-10-02
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/runtime/mode_catalog.py:L92-L101；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/runtime/mode_catalog.py:L21-L27
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/common/mode_matrix.py:L309-L326；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/common/mode_matrix.py:L219-L223
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/test_plan_entry_source_contract.py:L126-L163；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/test_plan_entry_source_contract.py:L72-L93
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/runtime/mode_catalog.py:L59-L84；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/common/mode_matrix.py:L219-L229
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:docs/zh/模式系统.md:L39-L43；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:docs/zh/模式系统.md:L67-L69
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/runtime/mode_catalog.py:L10-L16；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:docs/zh/模式系统.md:L230-L238
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/runtime/mode_catalog.py:L87-L89；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/runtime/mode_catalog.py:L30-L37
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/common/mode_matrix.py:L33-L36
- 源页字段（feature）：modes
- 入口（entry_points）：jiuwenswarm/runtime/mode_catalog.py；jiuwenswarm/common/mode_matrix.py
- 源页字段（source_globs）：jiuwenswarm/runtime/mode_catalog.py；jiuwenswarm/common/mode_matrix.py；jiuwenswarm/server/runtime/agent_adapter/*.py
