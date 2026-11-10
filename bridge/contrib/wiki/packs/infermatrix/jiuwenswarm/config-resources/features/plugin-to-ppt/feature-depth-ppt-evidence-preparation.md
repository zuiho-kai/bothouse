---
name: feature-depth-ppt-evidence-preparation
description: prepare_evidence.py 实现深读：main 对可准备条目的循环与返回 0、use_item 的路径与 approved 门槛、CLI 与目录默认、extractor 子进程与 PIL 缺失、逐条异常转 needs-manual、SKILL.md 联系表审阅流程（未执行）
metadata:
  scope: 收 prepare_evidence.py 的流程、API、配置、依赖、失败模式、取舍与手工验收的实现深读，来源另含 SKILL.md；功能概览归 feature-ppt-evidence-preparation-1、feature-ppt-evidence-preparation-2
---
# Evidence Plan Preparation and Review Lifecycle：实现深读

## 现状

- [[feature-ppt-evidence-preparation-1]]、[[feature-ppt-evidence-preparation-2]]（功能概览） · [[config-resources-overview-1]]、[[config-resources-overview-2]]（owner 入口）
- **main() prepares only preparable planned/retried items, then saves plan and builds contact sheet, returning 0** With no --approve/--used/--reject, main() loops plan items; an item is prepared only when its status is in PREPARABLE_STATUSES {"planned", "acquiring",
  - "needs-manual"} and it is planned, explicitly selected, or --force. After the loop it saves the plan, builds the contact sheet, logs warnings, and returns 0 from this function.
- 来源：[jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/prepare_evidence.py:L52–L53](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/prepare_evidence.py#L52-L53),
  - [jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/prepare_evidence.py:L322–L356](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/prepare_evidence.py#L322-L356)
- **use_item(): non-native items need an existing path (else FileNotFoundError) and review.status=="approved" (else ValueError)** use_item marks native-chart/native-drawing items used directly; other items raise FileNotFoundError if the resolved path is missing,
  - ValueError if review.status is not "approved", and only then set status to "used".
- 来源：[jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/prepare_evidence.py:L243–L253](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/prepare_evidence.py#L243-L253)
- **CLI 默认值与目录默认：--plan 默认 evidence-plan.json，根目录缺省 assets/ 与 analysis/** argparse 定义位置参数 project，--plan 默认 "evidence-plan.json"，--item/--approve/--used/--reject 为可重复列表，--force 为开关；plan 中的 asset_root 缺省回退到 root/"assets"，analysis_root 回退到 root/"analysis"，二者经 relative_to 校验必须位于项目根内，否则记日志并返回 1。
  - paper 选择器的 min_confidence 默认 0.55。
- 来源：[jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/prepare_evidence.py:L294–L316](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/prepare_evidence.py#L294-L316),
  - [jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/prepare_evidence.py:L95–L102](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/prepare_evidence.py#L95-L102)
- **prepare_paper shells out to sibling extractor with check=True; make_contact_sheet silently skips when PIL is missing** prepare_paper runs extract_arxiv_visuals_v2_2.py via subprocess.run(check=True) with --force when force or the output dir exists, so an extractor failure raises;
  - make_contact_sheet returns without output if PIL cannot be imported.
- 来源：[jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/prepare_evidence.py:L134–L141](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/prepare_evidence.py#L134-L141),
  - [jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/prepare_evidence.py:L256–L260](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/prepare_evidence.py#L256-L260)
- **Per-item exceptions are caught, set needs-manual, and continue the loop** In main's item loop, any Exception during review/prepare (e.g. copy_asset raising FileNotFoundError at L69-70) is caught: the item's status becomes "needs-manual",
  - review becomes {"status":"pending","notes":<error text>}, and the error string is appended to errors for later warning logging.
- 来源：[jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/prepare_evidence.py:L346–L349](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/prepare_evidence.py#L346-L349),
  - [jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/prepare_evidence.py:L68–L70](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/prepare_evidence.py#L68-L70)
- **Per-item exception capture keeps the loop running but downgrades failures to warnings** 设计推断（非作者历史意图）：
- Inference: inside the per-item loop, any Exception (e.g. from use_item/approve_item/prepare_item) sets that item's status to needs-manual with review notes recording the cause, appends an error message, and continues to the next item;
  - the benefit is one failing item does not abort the remaining items, and the cost is that the failure surfaces only as a logged warning plus item-level notes within this loop.
- 来源：[jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/prepare_evidence.py:L324–L353](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/prepare_evidence.py#L324-L353)
- **Documented manual procedure: contact-sheet review then --approve/--used (NOT EXECUTED)** 文档中的人工验收步骤（本轮未执行）：
- SKILL.md documents running prepare_evidence.py, then viewing analysis/evidence-contact-sheet.jpg (or the paper-specific contact sheet) before --approve <id> marks an item ready, and --used <id> recording placement into the PPT;
  - statuses are limited to planned/acquiring/ready/used/needs-manual/skipped. This procedure is documented only; it was NOT EXECUTED here.
- 来源：[jiuwenswarm/resources/agent/workspace/skills/ppt-creation/SKILL.md:L150–L168](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/SKILL.md#L150-L168),
  - [jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/prepare_evidence.py:L231–L253](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/prepare_evidence.py#L231-L253)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/config-resources/feature-depth-ppt-evidence-preparation.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/prepare_evidence.py:L294-L316
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/prepare_evidence.py:L95-L102
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/prepare_evidence.py:L52-L53
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/prepare_evidence.py:L322-L356
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/prepare_evidence.py:L243-L253
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/prepare_evidence.py:L134-L141
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/prepare_evidence.py:L256-L260
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/prepare_evidence.py:L346-L349
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/prepare_evidence.py:L68-L70
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/prepare_evidence.py:L324-L353
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/SKILL.md:L150-L168
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/prepare_evidence.py:L231-L253
- 源页字段（feature）：ppt-evidence-preparation
- 入口（entry_points）：jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/prepare_evidence.py
- 源页字段（source_globs）：jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/prepare_evidence.py
