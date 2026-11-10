---
name: feature-ppt-evidence-preparation-1
description: prepare_evidence.py 功能概览第 1 部分：plan 字段与 CLI 默认值（asset_root/analysis_root、min_confidence 0.55）、route 的 status/review 生命周期、自动选图评分与人工视觉门取舍
metadata:
  scope: 只收配置、生命周期、选图取舍三段；CLI 退出行为、分派与 review pass、运行时守卫归 feature-ppt-evidence-preparation-2；实现深读归 feature-depth-ppt-evidence-preparation
---
# prepare_evidence.py — Evidence Plan Preparation and Review Lifecycle（1/2）

## 现状

- 拆分说明：本页是源页 `feature-ppt-evidence-preparation.md` 的第 1/2 部分；第 2 部分 [[feature-ppt-evidence-preparation-2]]
- **Plan fields and CLI flags with their defaults**
- The plan supplies `asset_root` and `analysis_root`, defaulting to `<project>/assets` and `<project>/analysis`; both must resolve inside the project root or the run exits 1 (L309–L316).
  - Per-item paper selectors default `min_confidence` to 0.55 and `include_caption` to false, which picks `image_path` over `image_with_caption_path` (L95–L102, L156–L157).
  - Retry semantics are constrained: `--force` or an explicit `--item` triggers preparation only when the item's status is one of `planned`/`acquiring`/`needs-manual` (PREPARABLE_STATUSES) and only in a non-review pass; a bare run without selection prepares only `planned` items (L52–L53, L322–L345).
- Sources /
  - 来源：[jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/prepare_evidence.py:L309–L316](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/prepare_evidence.py#L309-L316),
  - [jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/prepare_evidence.py:L95–L102](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/prepare_evidence.py#L95-L102),
  - [jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/prepare_evidence.py:L52–L53](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/prepare_evidence.py#L52-L53),
  - [jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/prepare_evidence.py:L322–L345](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/prepare_evidence.py#L322-L345)
- **Status/review lifecycle across route families**
- For file-bearing routes the lifecycle is gated: `--approve` requires the destination file to exist and sets status `ready` with review `approved`; `--used` additionally requires review status `approved` and marks status `used` (L236–L253).
  - Native routes (`native-chart`, `native-drawing`) bypass these file and approval checks on both actions — they go straight to `ready`/`used` with review `not-required` (L231–L247). Failed or ambiguous preparation lands in `needs-manual` with review `pending`, e.g.
  - ambiguous paper selection (L148–L154) or any per-item exception (L346–L348).
- Sources /
  - 来源：[jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/prepare_evidence.py:L231–L253](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/prepare_evidence.py#L231-L253),
  - [jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/prepare_evidence.py:L148–L154](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/prepare_evidence.py#L148-L154),
  - [jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/prepare_evidence.py:L346–L348](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/prepare_evidence.py#L346-L348)
- **Automatic selection versus human visual gates**
- Inference / 设计推断（非作者历史意图）：
- Paper-figure selection scores candidates by confidence (default floor 0.55), +2 for an exact normalized label match and +0.5 per caption-keyword hit; automatic selection succeeds only when there is a selector (label or keywords) or exactly one candidate,
  - and either a sole ranked candidate or a top score exceeding the runner-up by more than 0.15 — otherwise the item is marked `needs-manual` for human review against the contact sheet (L95–L125, L148–L154).
  - AI illustrations are deliberately kept manual: the script only writes a prompt file and warns that AI cannot serve as factual evidence (L216–L226, and the module docstring L4–L7).
  - The confidence floor is a narrowing filter only; the code comment states approval remains the hard visual gate (L99–L101). These intent statements are design rationale from the source comments, not independent documentation.
- Sources /
  - 来源：[jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/prepare_evidence.py:L95–L125](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/prepare_evidence.py#L95-L125),
  - [jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/prepare_evidence.py:L99–L101](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/prepare_evidence.py#L99-L101),
  - [jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/prepare_evidence.py:L216–L226](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/prepare_evidence.py#L216-L226),
  - [jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/prepare_evidence.py:L4–L7](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/prepare_evidence.py#L4-L7)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/config-resources/feature-ppt-evidence-preparation.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/prepare_evidence.py:L309-L316
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/prepare_evidence.py:L95-L102
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/prepare_evidence.py:L52-L53
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/prepare_evidence.py:L322-L345
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/prepare_evidence.py:L231-L253
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/prepare_evidence.py:L148-L154
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/prepare_evidence.py:L346-L348
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/prepare_evidence.py:L95-L125
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/prepare_evidence.py:L99-L101
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/prepare_evidence.py:L216-L226
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/prepare_evidence.py:L4-L7
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/prepare_evidence.py:L294-L316
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/prepare_evidence.py:L346-L356
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/prepare_evidence.py:L358-L360
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/prepare_evidence.py:L322-L349
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/prepare_evidence.py:L68-L76
- 源页字段（feature）：ppt-evidence-preparation
- 入口（entry_points）：jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/prepare_evidence.py
- 源页字段（source_globs）：jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/prepare_evidence.py
