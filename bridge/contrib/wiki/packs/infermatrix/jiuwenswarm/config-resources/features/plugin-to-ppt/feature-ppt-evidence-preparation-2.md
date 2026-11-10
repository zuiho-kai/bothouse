---
name: feature-ppt-evidence-preparation-2
description: prepare_evidence.py 功能概览第 2 部分：CLI 面与退出行为（缺 plan 或根目录越界返回 1）、选择性分派与 review pass、approve/use/copy 的运行时守卫
metadata:
  scope: 只收 CLI 与退出行为、分派结构、运行时守卫三段；配置、生命周期、选图取舍归 feature-ppt-evidence-preparation-1；实现深读归 feature-depth-ppt-evidence-preparation
---
# prepare_evidence.py — Evidence Plan Preparation and Review Lifecycle（2/2）

## 现状

- 拆分说明：本页是源页 `feature-ppt-evidence-preparation.md` 的第 2/2 部分；第 1 部分 [[feature-ppt-evidence-preparation-1]]
- **CLI surface and exit behavior**
- `main()` accepts a positional `project` plus `--plan` (default `evidence-plan.json`), repeatable `--item`/`--approve`/`--used`/`--reject`, and `--force` (L294–L302).
  - It returns 1 with a logged error when the plan file is missing (L305–L307) or when `asset_root`/`analysis_root` resolve outside the project root (L311–L316); per-item preparation failures do not set the exit code — the run still ends with `return 0`,
  - reporting them as warnings in the completion line (L346–L353). Uncaught exceptions elsewhere (e.g. JSON parsing at L308, `save_plan` at L350) propagate and terminate via `raise SystemExit(main())` with a nonzero status.
- Sources /
  - 来源：[jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/prepare_evidence.py:L294–L316](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/prepare_evidence.py#L294-L316),
  - [jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/prepare_evidence.py:L346–L356](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/prepare_evidence.py#L346-L356),
  - [jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/prepare_evidence.py:L358–L360](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/prepare_evidence.py#L358-L360)
- **Selective dispatch and review pass structure**
- Per item, `main()` first enforces path containment for path-bearing routes (L328–L331), then branches: if `--approve`/`--used`/`--reject` names were given (a review pass), it calls `use_item`, `approve_item`,
  - or writes a `rejected` review without invoking any route handler (L332–L338, L322–L323).
  - Route dispatch through `prepare_item` happens only in a non-review pass, and only for in-scope items whose status is in `PREPARABLE_STATUSES` (`planned`/`acquiring`/`needs-manual`) and that are `planned`, explicitly re-selected, or forced (L339–L345).
  - Any exception inside this loop downgrades the item to `needs-manual` with a `pending` review rather than aborting the run (L346–L349).
- Sources /
  - 来源：[jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/prepare_evidence.py:L322–L349](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/prepare_evidence.py#L322-L349),
  - [jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/prepare_evidence.py:L52–L53](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/prepare_evidence.py#L52-L53)
- **Runtime gates on review actions and asset copies**
- Review actions validate state at runtime: `approve_item` raises `FileNotFoundError` if the destination asset is missing, and `use_item` additionally requires `review.status == "approved"` before setting status `used`;
  - both native routes (`native-chart`, `native-drawing`) bypass these checks (L231–L253).
  - For copies, `copy_asset` raises when the source is missing, and when the destination exists with different content it raises `FileExistsError` unless `--force`; with identical content it returns early, but with `force` set it still performs `shutil.copy2` (L68–L76).
  - No test entry points for this script appear in the shown inputs.
- Sources /
  - 来源：[jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/prepare_evidence.py:L231–L253](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/prepare_evidence.py#L231-L253),
  - [jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/prepare_evidence.py:L68–L76](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/prepare_evidence.py#L68-L76)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/config-resources/feature-ppt-evidence-preparation.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-06
