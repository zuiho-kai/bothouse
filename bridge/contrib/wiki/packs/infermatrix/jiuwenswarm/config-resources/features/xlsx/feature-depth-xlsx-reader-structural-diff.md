---
name: feature-depth-xlsx-reader-structural-diff
description: xlsx_reader.py 实现深读：main 派发 diff_against 并返回 0/1、CLI、采样默认值只限制保留的非空单元格、openpyxl 与 zipfile 依赖、采样异常降级为 notes、SKILL.md 手工校验（未执行）
metadata:
  scope: 收 xlsx_reader.py 的实现细节（main、采样默认值、依赖、失败路径、手工验证记载），来源另含 SKILL.md；功能概览归 feature-xlsx-reader-structural-diff
---
# XLSX Read-Only Structure Reader and Edit-Damage Differ：实现深读

## 现状

- [[feature-xlsx-reader-structural-diff]]（功能概览） · [[config-resources-overview-1]]、[[config-resources-overview-2]]（owner 入口）
- **main() dispatches --diff-against to diff_against() and returns 0 only when report['ok']** When --diff-against OLD is given, main() calls diff_against(args.file, OLD), prints JSON or a text report (issues prefixed '!', notes '.', up to 20 '~' changed-cell lines),
  - and returns 0 if rep['ok'] else 1; main()'s return value is passed to sys.exit at module run.
- 来源：[jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_reader.py:L165–L178](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_reader.py#L165-L178),
  - [jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_reader.py:L199–L200](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_reader.py#L199-L200)
- **main() CLI: FILE plus --diff-against OLD.xlsx dispatch, returning 0/1 from the diff branch** main() 接受位置参数 file、--sheet、--preview（默认 0）、--diff-against、--json。
  - 当 --diff-against 为真时调用 diff_against(args.file, args.diff_against)，--json 打印缩进 JSON，否则打印 RESULT 与 issues/notes/前 20 条 changed_cells_sample，并在该分支内 return 0 if rep["ok"] else 1；仅当 --preview 和 --sheet 同时为真才调用 preview()。入口处 sys.exit(main())。
- 来源：[jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_reader.py:L156–L196](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_reader.py#L156-L196),
  - [jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_reader.py:L199–L200](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_reader.py#L199-L200)
- **采样默认值：_sheet_sample 默认 max_sheets=50、max_cells=200，且限制的是保留的非空单元格数** diff_against 调用 _sheet_sample 时不传参，使用默认 50/200；循环遍历所有行与列并跳过 None 值，仅在保留的非空单元格计数达到 max_cells 时提前 break，因此该默认不限制被扫描的单元格总数。
- 来源：[jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_reader.py:L81–L101](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_reader.py#L81-L101),
  - [jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_reader.py:L126–L130](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_reader.py#L126-L130)
- **Depends on openpyxl (hard) and stdlib zipfile for feature detection** If `from openpyxl import load_workbook` fails, the script prints 'openpyxl is required: ...' to stderr and exits 2. _zip_features instead reads the package with stdlib zipfile to detect vbaProject.bin,
  - pivotTable/pivotCache names, xl/charts/ parts without openpyxl parsing.
- 来源：[jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_reader.py:L25–L29](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_reader.py#L25-L29),
  - [jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_reader.py:L32–L44](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_reader.py#L32-L44)
- **In diff mode, cell-sample exceptions become notes without clearing ok; preview() raises SystemExit on missing sheet** diff_against wraps _sheet_sample calls in try/except: on exception it appends 'cell sample diff skipped: {e}' to report['notes'] and leaves report['ok'] unchanged.
  - Separately, preview() raises SystemExit('sheet not found: ...; available: ...') when the requested sheet is absent — a preview-mode failure, not part of the diff branch.
- 来源：[jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_reader.py:L126–L141](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_reader.py#L126-L141),
  - [jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_reader.py:L67–L71](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_reader.py#L67-L71)
- **SKILL.md 规定的保存后 --diff-against 校验流程（未执行）** 文档中的人工验收步骤（本轮未执行）：
- SKILL.md L103–L105 规定：保存 output.xlsx 后运行 `xlsx_reader.py --diff-against input.xlsx`，确认原有 sheet 名称、named ranges、透视表/宏及原始数据样本仍在；若校验失败须先修复再交付。这是已记录的手工流程，本文未执行。所提供材料不含该脚本的测试文件。
- 来源：[jiuwenswarm/resources/agent/workspace/skills/xlsx/SKILL.md:L97–L108](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/xlsx/SKILL.md#L97-L108)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/config-resources/feature-depth-xlsx-reader-structural-diff.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_reader.py:L25-L29
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_reader.py:L32-L44
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_reader.py:L165-L178
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_reader.py:L199-L200
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_reader.py:L126-L141
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_reader.py:L67-L71
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_reader.py:L81-L101
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_reader.py:L126-L130
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_reader.py:L156-L196
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/xlsx/SKILL.md:L97-L108
- 源页字段（feature）：xlsx-reader-structural-diff
- 入口（entry_points）：jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_reader.py
- 源页字段（source_globs）：jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_reader.py
