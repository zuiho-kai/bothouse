---
name: feature-xlsx-workbook-unpack-repack
description: xlsx_unpack.py 与 xlsx_pack.py 格式保留解包重打包：命令行与退出码 0/1/2、ZIP-of-XML 管道、_order_key 排序与 vbaProject.bin 不压缩、无配置项、不重算 sharedStrings 与 calcChain
metadata:
  scope: 只收 xlsx_unpack.py 与 xlsx_pack.py 的功能概览（入口与退出码、管道结构、包完整性、配置面、内置验证、取舍）；实现深读归 feature-depth-xlsx-workbook-unpack-repack
---
# XLSX Skill 格式保留解包/重打包（xlsx_unpack.py / xlsx_pack.py）

## 现状

- **命令行入口与退出码**
- 两个脚本都是无依赖第三方库的 Python 3 命令行工具。`xlsx_unpack.py INPUT.xlsx OUTDIR/` 将工作簿解包到目录，参数数目不符时向 stderr 输出 usage 并返回 2，输入不是 zip 时返回 1，成功返回 0 并打印解包的 part 数量。`xlsx_pack.py SRCDIR/ OUTPUT.xlsx` 将目录重打包为 .xlsx/.xlsm，同样以参数数目（返回 2）和源目录不存在（返回 1）作为错误契约，成功时打印打包 part 数。
- Sources / 来源：[jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_unpack.py:L16–L28](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_unpack.py#L16-L28),
  - [jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_pack.py:L30–L54](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_pack.py#L30-L54)
- **解包-编辑-重打包的管道结构**
- 组件是围绕 ZIP-of-XML 这一 xlsx 本质的薄封装：解包侧用 `zipfile.ZipFile.extractall` 原样展开所有 part，收集 namelist 并检测 VBA 宏、pivotTable、图表等特殊 part 并提示保留；编辑发生在解包后的目录中（UTF-8 XML 直接修改），重打包侧用 `os.walk` 收集文件、把相对路径转为 zip 归档路径后写入。两脚本之间只通过目录内容和 `[Content_Types].xml` 等包结构约定耦合，是 openpyxl 往返（round-trip）的格式保留替代方案。
- Sources / 来源：[jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_unpack.py:L3–L9](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_unpack.py#L3-L9),
  - [jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_unpack.py:L24–L37](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_unpack.py#L24-L37),
  - [jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_pack.py:L38–L52](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_pack.py#L38-L52)
- **包完整性与宏保留**
- 重打包时按 `_order_key` 排序，先写 `[Content_Types].xml`，再写 `_rels/`，其余 part 最后，以维持包完整性；`vbaProject.bin` 使用 ZIP_STORED 不压缩存储以免宏失效，其他 part 一律 ZIP_DEFLATED。解包时会检测 `xl/vbaProject.bin`、含 pivotTable 的 part 和 `xl/charts/` 前缀，并输出 "NOTE: preserve these on repack" 提示。缺 `[Content_Types].xml` 时仅打印 WARNING 仍继续打包。
- Sources / 来源：[jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_pack.py:L8–L11](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_pack.py#L8-L11),
  - [jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_pack.py:L44–L52](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_pack.py#L44-L52),
  - [jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_unpack.py:L29–L37](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_unpack.py#L29-L37)
- **配置面：无配置项，仅命令行位置参数**
- 两个脚本都没有配置文件、环境变量或选项开关；全部行为通过两个位置参数控制。`xlsx_unpack.py INPUT.xlsx OUTDIR/` 中 OUTDIR 不存在时会用 `os.makedirs(outdir, exist_ok=True)` 自动创建；`xlsx_pack.py SRCDIR/ OUTPUT.xlsx` 的输出后缀（.xlsx/.xlsm）由调用者直接给定，脚本不区分。其余行为（写入顺序、vbaProject.bin 的压缩方式）是脚本内固定的启发式，不可配置。
- Sources / 来源：[jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_unpack.py:L5–L9](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_unpack.py#L5-L9),
  - [jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_pack.py:L5–L6](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_pack.py#L5-L6),
  - [jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_unpack.py:L20–L26](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_unpack.py#L20-L26)
- **内置验证：结构前提检查与人工提示**
- 解包前用 `zipfile.is_zipfile(src)` 验证输入确为 zip/xlsx，否则报错退出 1；解包后扫描 namelist，对 `xl/vbaProject.bin`、含 pivotTable 的 part、`xl/charts/` 前缀输出 "NOTE: preserve these on repack" 提示。重打包侧检查 SRCDIR 是目录（否则退出 1），并在 `[Content_Types].xml` 缺失时打印 WARNING 但继续写出 ZIP。所示文件不含自动化测试入口。
- Sources / 来源：[jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_unpack.py:L21–L37](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_unpack.py#L21-L37),
  - [jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_pack.py:L35–L47](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_pack.py#L35-L47)
- **以包结构启发式换取格式保留，代价是派生索引需人工维护**
- 组件选择直接操作 ZIP-of-XML 而非 openpyxl 往返，以换取格式保留（xlsx_unpack.py:L9 明确称之为 format-preserving alternative）。重打包侧用固定启发式维持包完整性：`_order_key` 先写 `[Content_Types].xml` 再写 `_rels/`（xlsx_pack.py:L22–L27、L47），`vbaProject.bin` 以 ZIP_STORED 存储以免宏失效，其余 part 一律 ZIP_DEFLATED（L51）。
  - 成本是脚本不重算 sharedStrings 计数、不重建 calcChain，需要编辑者在解包目录中自行处理（L13–L14）；新增的公式单元格若没有缓存 `<v>`，则依赖 Excel 打开时重算或用 libreoffice_recalc.py（L14–L15）。
- Sources / 来源：[jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_unpack.py:L3–L9](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_unpack.py#L3-L9),
  - [jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_pack.py:L8–L15](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_pack.py#L8-L15),
  - [jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_pack.py:L22–L27](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_pack.py#L22-L27),
  - [jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_pack.py:L47–L52](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_pack.py#L47-L52)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/config-resources/feature-xlsx-workbook-unpack-repack.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_unpack.py:L16-L28
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_pack.py:L30-L54
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_unpack.py:L3-L9
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_unpack.py:L24-L37
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_pack.py:L38-L52
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_pack.py:L8-L11
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_pack.py:L44-L52
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_unpack.py:L29-L37
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_unpack.py:L5-L9
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_pack.py:L5-L6
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_unpack.py:L20-L26
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_unpack.py:L21-L37
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_pack.py:L35-L47
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_pack.py:L8-L15
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_pack.py:L22-L27
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_pack.py:L47-L52
- 源页字段（feature）：xlsx-workbook-unpack-repack
- 入口（entry_points）：jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_pack.py；jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_unpack.py
- 源页字段（source_globs）：jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_pack.py；jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_unpack.py
