---
name: feature-xlsx-insert-row
description: xlsx_insert_row.py 插行并扩展范围：编排层与 _xlsx_common 分层、--at/--text/--values/--formula/--copy-style-from 参数、尽力而为的 A1:B9 范围扩展、直接编辑 XML 的取舍、CLI 契约
metadata:
  scope: 收 xlsx_insert_row.py 的功能概览（架构、配置、验证要求、功能、取舍、CLI 契约），来源另含 _xlsx_common.py、xlsx_shift_rows.py；实现深读归 feature-depth-xlsx-insert-row
---
# XLSX Row Insert with Range Extension（jiuwenswarm skills/xlsx 脚本）

## 现状

- **架构：分层与数据流**
- 三层结构：xlsx_insert_row.py 是面向用户的编排层，xlsx_shift_rows.py 是薄 CLI 包装，共享逻辑集中在 _xlsx_common.py。数据流为：workbook.xml 按表名查 r:id，再到 workbook.xml.rels 解析出 worksheet XML 路径（支持绝对/相对 Target）；随后依次 shift_rows → extend_ranges → get_or_make_row → 写入新单元格 → sort_sheetdata → update_dimension → 原位写回。
  - 所有编辑直接作用于解包目录里的 XML，宣称对未触碰单元格零格式损失。
- Sources / 来源：[jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/_xlsx_common.py:L57–L77](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/_xlsx_common.py#L57-L77),
  - [jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_insert_row.py:L66–L89](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_insert_row.py#L66-L89),
  - [jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/_xlsx_common.py:L3–L7](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/_xlsx_common.py#L3-L7)
- **配置：参数与默认值**
- 本组件无配置文件，行为完全由 CLI 参数决定。--at 为必需整数；--sheet 缺省时取 workbook.xml 中第一个 sheet（first_sheet_name，找不到表时 SystemExit）；--text/--values/--formula 缺省为空列表；--copy-style-from 缺省为 None（不加样式属性 s）。文本单元格写成 inlineStr 并保留空白，数值写 <v>，公式的等号前缀被去掉后写入 <f>。
- Sources / 来源：[jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_insert_row.py:L52–L60](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_insert_row.py#L52-L60),
  - [jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/_xlsx_common.py:L96–L113](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/_xlsx_common.py#L96-L113)
- **验证：文档要求的外部校验**
- 所示片段中没有这些脚本的自动化测试入口；验证方式是流程性的：xlsx_insert_row.py 的文档要求编辑后用 xlsx_pack.py 重新打包并校验，且因单单元格引用不被范围扩展覆盖、xlsx_shift_rows.py 不改写公式文本，两个脚本都明确提示“总是事后验证（Always validate afterwards）”。
- Sources / 来源：[jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_insert_row.py:L5–L20](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_insert_row.py#L5-L20),
  - [jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_shift_rows.py:L9–L12](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_shift_rows.py#L9-L12)
- **功能：插行、条件性样式复制与尽力而为的范围扩展**
- 插入流程在写新单元格前先 shift_rows 腾位并调用 extend_ranges。范围扩展是尽力而为：只对公式文本中 A1:B9 形态的范围端点按行号 >= at 加 delta，单单元格引用不动，文档要求事后核对合计值。样式复制仅在显式传入 --copy-style-from 时发生（按同列读取源行单元格的 s 属性）；未提供时新单元格不带 s 属性。写回前会重排行列并调用 update_dimension，而它只在 dimension 元素已存在且 maxr>0 时更新 @ref。
- Sources / 来源：[jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_insert_row.py:L66–L85](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_insert_row.py#L66-L85),
  - [jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/_xlsx_common.py:L154–L169](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/_xlsx_common.py#L154-L169),
  - [jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_insert_row.py:L14–L20](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_insert_row.py#L14-L20),
  - [jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/_xlsx_common.py:L179–L196](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/_xlsx_common.py#L179-L196)
- **取舍：直接编辑 XML 的得失**
- Inference / 设计推断（非作者历史意图）：
- 脚本选择直接用 lxml 原位编辑解包目录中的 worksheet XML，模块文档声称对未触碰的单元格零格式损失；代价是公式改写只覆盖范围形态（_RANGE 正则），shift_rows 只改 row@r/cell@r 而不重写公式文本，因此两个脚本的文档都要求编辑后校验。这些是所示源码呈现的边界；将其解读为有意保守的设计选择属于推断，所示证据未包含设计历史。
- Sources / 来源：[jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/_xlsx_common.py:L3–L7](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/_xlsx_common.py#L3-L7),
  - [jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/_xlsx_common.py:L142–L157](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/_xlsx_common.py#L142-L157),
  - [jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_shift_rows.py:L9–L12](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_shift_rows.py#L9-L12),
  - [jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_insert_row.py:L5–L7](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_insert_row.py#L5-L7)
- **xlsx_insert_row.py CLI 契约**
- 入口是命令行脚本 `xlsx_insert_row.py`（`main()` 经 `sys.exit(main())` 调用，成功返回 0 并打印确认行）。调用契约：位置参数 `workdir`（解包的工作簿目录）为必需；`--at`（int，必需）指定新行占据的 1-based 行号；可选 `--sheet`、`--text/--values/--formula`（COL=VALUE 对，缺省空列表）与 `--copy-style-from`（int，可选）。`--sheet` 缺省时取 workbook.xml 的第一个表；
  - 找不到表或关系时 `resolve_worksheet` 以 `SystemExit` 终止并带错误消息。输入的 COL=VALUE 对缺少 `=` 时由 `parse_pairs` 以 SystemExit 拒绝。文档要求编辑后用 xlsx_pack.py 重打包。
- Sources / 来源：[jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_insert_row.py:L49–L58](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_insert_row.py#L49-L58),
  - [jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_insert_row.py:L60–L64](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_insert_row.py#L60-L64),
  - [jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_insert_row.py:L89–L95](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_insert_row.py#L89-L95),
  - [jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/_xlsx_common.py:L65–L77](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/_xlsx_common.py#L65-L77)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/config-resources/feature-xlsx-insert-row.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-07
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/_xlsx_common.py:L57-L77
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_insert_row.py:L66-L89
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/_xlsx_common.py:L3-L7
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_insert_row.py:L52-L60
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/_xlsx_common.py:L96-L113
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_insert_row.py:L5-L20
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_shift_rows.py:L9-L12
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_insert_row.py:L66-L85
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/_xlsx_common.py:L154-L169
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_insert_row.py:L14-L20
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/_xlsx_common.py:L179-L196
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/_xlsx_common.py:L142-L157
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_insert_row.py:L5-L7
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_insert_row.py:L49-L58
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_insert_row.py:L60-L64
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_insert_row.py:L89-L95
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/_xlsx_common.py:L65-L77
- 源页字段（feature）：xlsx-insert-row
- 入口（entry_points）：jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_insert_row.py
- 源页字段（source_globs）：jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_insert_row.py；jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_shift_rows.py；jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/_xlsx_common.py
