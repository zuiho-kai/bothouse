---
name: codex-review-lessons
description: Codex review lessons：从生产模块取枚举而不在消费端写死、枚举型 knob 旁同时暴露 custom escape hatch、promotion 后显式写默认值（PR 3444 task/bot_task API split）
metadata:
  scope: 只收 PR 3444 task/bot_task API split 中对照 Codex 平行补丁得到的 API 设计习惯；公开参数与 API surface 的通用审查归 code-taste-api-surface
---
# Codex review lessons

## 现状

- When Codex did the same `task/bot_task` API split on PR #3444 (`codex/pr3444-online-prompt-align`), it shipped two API-design habits I missed on the first pass:

## 关键事实

- 源页：`knowledge/general/review/guides/codex-review-lessons.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: general, review；created: 2026-07-10；updated: 2026-07-16；sources: 无
- **Where this came up:** P1 commit of PR #3444 (`617f97ec2 fix(hunyuan_image3): split task / bot_task / sys_type at /v1/images/edits`) was amended after reviewing Codex's parallel patch (`codex/pr3444-online-prompt-align`).

### 1. Source enums from the producing module, not a hardcoded set at the consumer

- Right (Codex): `from ...prompt_utils import available_tasks; if bot_task in available_tasks(): ...`.
- **How to apply:**
  - Before writing `{"a", "b", ...}` literal as a membership check, grep for an existing `available_*()` / `valid_*()` / `_THINGS` constant in the producing module.
  - If it exists, import it.
  - The exporter usually already exists for tests; reuse it for runtime validation too.

### 2. Expose the escape hatch alongside the enum-typed knob

- Right (Codex): expose **two** fields: `sys_type` (or `use_system_prompt` in Codex naming) for enum selection AND `system_prompt` for the verbatim custom body.
  - Thread `system_prompt → custom_system_prompt` through `build_prompt_tokens(..., custom_system_prompt=...)`.
- **How to apply:**
  - When wrapping a `func(enum: str, custom: str | None = None)` shape behind an API, expose BOTH params.
  - Grep the inner function's signature; if it has `custom_*` / `override_*` / `extra_*` / `_path: str | None` kwargs, the API needs them too.
  - Document them as "advanced override, leave blank for default mapping from {enum_field}".

### 3. Bonus — explicit defaults after promotion

- Codex's promotion logic explicitly sets `bot_task = "think"` after promoting `prompt_task = bot_task` (legacy form), instead of relying on a downstream `effective_bot_task = bot_task or "think"` fallback.
- Either works; explicit is slightly clearer in trace logs and harder to silently break if a future refactor moves the default elsewhere.

## 决策与踩坑

### 1. Source enums from the producing module — wrong form and why

- Wrong (mine): hardcode `_legacy_task_enum = {"t2t", "i2t", "it2i", "t2i"}` literal in `serving_chat.py`.
- **Why:**
  - `prompt_utils._TASKS` is the **single source of truth** for the task enum.
  - Duplicating the literal at the consumer means adding a new task (`vid2img` say) needs synchronous edits in 2 places, and any drift produces a silently-incomplete promotion path.
  - Calling the producer's `available_tasks()` removes the duplication.

### 2. Expose the escape hatch — wrong form and why

- Wrong (mine): only expose `sys_type: str` (enum: `en_unified` / `en_think_recaption` / `en_vanilla` / `custom` / `dynamic`).
  - The "custom" sys_type branch in `get_system_prompt()` reads a `custom_system_prompt` parameter, but my online API didn't expose any way for the caller to provide it — so `sys_type="custom"` would silently return None.
- **Why:**
  - Enum-typed knobs forbid covering all behaviors of the underlying function.
  - If the function accepts an enum + a custom override, both belong on the API.
  - Otherwise power users can't trigger the override branch from the outside, and the enum value `"custom"` becomes silently broken.
