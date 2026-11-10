---
name: feature-xlsx-add-computed-column
description: xlsx_add_column.py 向解包目录工作表添加计算列：CLI 参数与缺省值、表头/公式/合计/顶边框写入、原地改写 XML 的架构与取舍、边框改写只保留 numFmtId
metadata:
  scope: 只收 xlsx_add_column.py 的功能概览（CLI、测试入口、缺省值、支持行为、架构、取舍）；实现深读归 feature-depth-xlsx-add-computed-column
---
# XLSX Computed Column Adder (xlsx_add_column.py)

## 现状

- **CLI 入口与参数**
- 命令行入口：`python3 xlsx_add_column.py <workdir> --col G [--sheet ...]`。位置参数 `workdir` 是 xlsx_unpack.py 产出的解包目录，脚本原地编辑工作表 XML，需再用 xlsx_pack.py 回打包。
  - 主要选项：`--col`（必填，目标列字母）、`--sheet`（缺省取第一张表）、`--header`/`--header-row`（默认 1）、`--formula`（模板，`{row}` 替换为行号）、`--formula-rows`（如 `2:9` 闭区间）、`--total-row`/`--total-formula`、`--numfmt`、`--border-row`/`--border-style`（默认 `medium`）。成功时打印 `added column <col> on '<sheet>'` 并返回 0。
- Sources / 来源：[jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_add_column.py:L51–L65](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_add_column.py#L51-L65),
  - [jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_add_column.py:L3–L13](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_add_column.py#L3-L13)
- **测试入口**
- 本次展示的输入只包含该脚本本体（120 行，无测试文件、无 docs），未见针对 xlsx_add_column.py 的测试或验证入口，无法从所示证据描述其测试覆盖。
- Sources / 来源：[jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_add_column.py:L1–L20](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_add_column.py#L1-L20)
- **命令行参数与缺省值**
- 配置全部来自命令行：位置参数 workdir（解包目录）；--col 必填（目标列字母）；--sheet 缺省为第一张表；--header-row 缺省 1；--border-style 缺省 "medium"；其余选项（--header、--formula、--formula-rows 如 "2:9" 闭区间、--total-row、--total-formula、--numfmt、--border-row）缺省为空/未启用。效果按条件生效：仅当 --numfmt 为真时才注册 numFmt，且仅当得到非零 nfid 时才创建数据单元格的 data_xf；
  - 启用 --border-row 时会额外注册顶边框，并为合计单元格构造带 numFmtId+borderId 的 total_xf。
- Sources / 来源：[jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_add_column.py:L52–L65](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_add_column.py#L52-L65),
  - [jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_add_column.py:L74–L78](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_add_column.py#L74-L78)
- **支持的行为**
- 支持向指定列写入：表头文本（样式取自表头行同行某列的现有单元格样式索引，源列取目标列左邻列、但被限制最小为 A，源单元格不存在时则不带样式）、按 {row} 模板展开的公式单元格（--formula-rows 指定闭区间）、合计公式单元格，以及一行行宽的顶边框——边框处理会为该行每个已有单元格换成新的样式索引，同时保留其原 numFmtId。公式用 make_cell(formula=...) 写入；--numfmt 只作用于新列的公式/合计单元格。
- Sources / 来源：[jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_add_column.py:L80–L86](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_add_column.py#L80-L86),
  - [jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_add_column.py:L89–L102](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_add_column.py#L89-L102),
  - [jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_add_column.py:L104–L109](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_add_column.py#L104-L109)
- **架构：解包目录内的原地工作表编辑器**
- 该脚本是 xlsx 技能链中的一环：输入是 xlsx_unpack.py 产出的解包目录，脚本通过 `_xlsx_common` 定位工作表（`--sheet` 缺省取第一张表）、解析 XML 并原地编辑 sheetData，最后由用户再用 xlsx_pack.py 回打包。
  - 主流程分阶段执行：先在 Styles 中注册 numFmt/xf/边框（L74–L78），随后依次写表头（L81–L86）、循环展开公式单元格（L89–L95）、写合计单元格（L98–L102），再对边框行逐单元格改写样式索引（L104–L109），最后统一 `X.sort_sheetdata(sd)` 与 `X.update_dimension(root)` 并保存样式与工作表（L111–L114）。每个写单元格动作都是对行的独立查找/创建（`X.get_or_make_row` + `X.set_cell_in_row`），而非单遍处理。
- Sources / 来源：[jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_add_column.py:L3–L13](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_add_column.py#L3-L13),
  - [jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_add_column.py:L67–L78](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_add_column.py#L67-L78),
  - [jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_add_column.py:L89–L95](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_add_column.py#L89-L95),
  - [jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_add_column.py:L111–L115](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_add_column.py#L111-L115)
- **设计取舍：直接编辑解包 XML 与边框样式改写**
- 脚本选择在 xlsx_unpack.py 产出的解包目录内直接解析并原地改写工作表 XML（docstring 自述为“零格式损失：现有单元格不被触碰”），代价是流程依赖 unpack/edit/repack 三段式链路，而非单工具完成。另一个可见限制：--border-row 对该行每个已有单元格重写样式索引时，只通过 numfmt_of 读取并保留原样式的 numFmtId（L104–L109、L28–L37），所示代码中未体现保留 xf 的其他属性（如字体、填充）。
- Sources / 来源：[jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_add_column.py:L3–L6](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_add_column.py#L3-L6),
  - [jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_add_column.py:L104–L109](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_add_column.py#L104-L109),
  - [jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_add_column.py:L28–L37](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_add_column.py#L28-L37)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/config-resources/feature-xlsx-add-computed-column.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-07
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_add_column.py:L51-L65
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_add_column.py:L3-L13
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_add_column.py:L1-L20
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_add_column.py:L52-L65
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_add_column.py:L74-L78
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_add_column.py:L80-L86
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_add_column.py:L89-L102
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_add_column.py:L104-L109
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_add_column.py:L67-L78
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_add_column.py:L89-L95
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_add_column.py:L111-L115
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_add_column.py:L3-L6
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_add_column.py:L28-L37
- 源页字段（feature）：xlsx-add-computed-column
- 入口（entry_points）：jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_add_column.py
- 源页字段（source_globs）：jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_add_column.py
