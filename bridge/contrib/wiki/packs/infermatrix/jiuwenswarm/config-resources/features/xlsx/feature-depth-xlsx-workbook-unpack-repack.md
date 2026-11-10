---
name: feature-depth-xlsx-workbook-unpack-repack
description: xlsx_unpack.py 与 xlsx_pack.py 实现深读：解包与重打包流程、两位置参数与退出码、硬编码排序与压缩、仅标准库依赖、错误路径、vbaProject.bin 与调用方修复的取舍、SKILL.md 手工校验（未执行）
metadata:
  scope: 只收两个脚本的实现细节（流程、参数与退出码、硬编码、依赖、错误路径、取舍、手工验证记载）；功能概览归 feature-xlsx-workbook-unpack-repack
---
# XLSX Skill Format-Preserving Unpack/Repack：实现深读

## 现状

- [[feature-xlsx-workbook-unpack-repack]]（功能概览） · [[config-resources-overview-1]]、[[config-resources-overview-2]]（owner 入口）
- **Unpack extracts workbook ZIP parts, then pack walks the dir and rewrites a sorted ZIP** xlsx_unpack.py main() 校验 argv 长度与 zipfile.is_zipfile 后 extractall 到 outdir 并打印 part 数及 VBA/pivot/chart 提示；
  - xlsx_pack.py main() 用 os.walk 收集文件为 arc 名，按 _order_key 排序（[Content_Types].xml 首位、_rels/ 次之），逐个写入输出 ZIP，vbaProject.bin 用 ZIP_STORED 其余 ZIP_DEFLATED，最后打印 packed N parts 并 return 0。
- 来源：[jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_unpack.py:L16–L38](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_unpack.py#L16-L38),
  - [jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_pack.py:L30–L54](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_pack.py#L30-L54)
- **Both scripts take exactly two positional argv paths; wrong argc returns 2, ZIP/dir checks return 1** `xlsx_unpack.py INPUT.xlsx OUTDIR/` 先用 `zipfile.is_zipfile` 校验输入，再 `extractall` 到（必要时创建的）目录，并打印解包的部件数；仅当存在 `xl/vbaProject.bin`、pivotTable 或 `xl/charts/` 部件时额外打印 NOTE。
  - `xlsx_pack.py SRCDIR/ OUTPUT.xlsx` 要求 SRCDIR 是目录，遍历后按 `_order_key` 排序写入输出 ZIP 并打印 `packed N parts`，随后 `return 0`（main 内返回，非进程退出码断言）。
- 来源：[jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_unpack.py:L16–L38](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_unpack.py#L16-L38),
  - [jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_pack.py:L30–L54](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_pack.py#L30-L54)
- **No configurable settings; entry ordering and compression are hardcoded** 两个脚本均无配置项或环境变量：入口顺序由 _order_key 硬编码（[Content_Types].xml → (0,arc)、_rels/ → (1,arc)、其余 (2,arc)），压缩方式仅由文件名后缀 vbaProject.bin 决定 ZIP_STORED，否则 ZIP_DEFLATED。
- 来源：[jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_pack.py:L22–L27](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_pack.py#L22-L27),
  - [jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_pack.py:L47–L52](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_pack.py#L47-L52)
- **Depends only on Python stdlib (os, sys, zipfile), avoiding openpyxl round-trips** 两个脚本仅 import os/sys/zipfile，把 .xlsx 当 ZIP of XML parts 处理；模块 docstring 说明这是 openpyxl 往返的 format-preserving 替代方案，vbaProject.bin 以未压缩存储保持宏有效。
- 来源：[jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_unpack.py:L3–L13](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_unpack.py#L3-L13),
  - [jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_pack.py:L3–L19](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_pack.py#L3-L19)
- **Usage error returns 2; non-zip input or missing srcdir returns 1 with stderr message** unpack: `len(sys.argv)!=3` → stderr usage、return 2；`not zipfile.is_zipfile(src)` → stderr "not a valid xlsx/zip: src"、return 1。pack: 目录不存在 → stderr "not a directory: srcdir"、return 1；
  - 若收集的 arcs 缺 [Content_Types].xml 仅打印 WARNING 到 stderr 仍继续打包（return 0）。
- 来源：[jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_unpack.py:L17–L23](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_unpack.py#L17-L23),
  - [jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_pack.py:L31–L47](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_pack.py#L31-L47)
- **Pack keeps vbaProject.bin stored uncompressed but shifts sharedStrings/calcChain repair to the caller** Benefit (documented intent): xlsx_pack.py writes parts ending in vbaProject.bin with ZIP_STORED and all others deflated so macros stay valid.
  - Cost (documented): pack does NOT recompute sharedStrings counts or rebuild calcChain — the caller must edit those in the unpacked dir or run libreoffice_recalc.py for formula cells without a cached <v>.
  - Inference: storing the macro blob uncompressed can enlarge the output file relative to deflating it.
- 来源：[jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_pack.py:L48–L52](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_pack.py#L48-L52),
  - [jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_pack.py:L8–L15](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_pack.py#L8-L15)
- **Documented manual EDIT verification: xlsx_reader.py --diff-against the input (NOT EXECUTED here)** 文档中的人工验收步骤（本轮未执行）：
- SKILL.md EDIT rule 5 directs running xlsx_reader.py output.xlsx --diff-against input.xlsx after packing and confirming original sheet names, named ranges, pivots/macros, and a sample of original data before delivery; a failed check must be fixed before delivering.
  - This is a documented procedure only — it was not executed and no automated runtime or source-text test for this feature is shown.
- 来源：[jiuwenswarm/resources/agent/workspace/skills/xlsx/SKILL.md:L100–L105](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/xlsx/SKILL.md#L100-L105)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/config-resources/feature-depth-xlsx-workbook-unpack-repack.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_unpack.py:L16-L38
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_pack.py:L30-L54
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_pack.py:L22-L27
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_pack.py:L47-L52
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_unpack.py:L3-L13
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_pack.py:L3-L19
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_unpack.py:L17-L23
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_pack.py:L31-L47
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_pack.py:L48-L52
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_pack.py:L8-L15；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/xlsx/SKILL.md:L100-L105
- 源页字段（feature）：xlsx-workbook-unpack-repack
- 入口（entry_points）：jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_pack.py；jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_unpack.py
- 源页字段（source_globs）：jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_pack.py；jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_unpack.py
