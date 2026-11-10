---
name: feature-docx-pro-cli
description: docx-pro Word 文档操作 CLI 功能概览：docx_pro.py 编排层与 renderer/md_parser/md_export/docx_replace 分层、七个子命令与退出码契约、replace 保真替换与后验校验、目录域取舍、python-docx 依赖
metadata:
  scope: 只收 docx-pro CLI 的功能概览（分层与数据流、支持行为与依赖、子命令入口与退出码、替换与目录域取舍、replace 后验校验）；实现深读归 feature-depth-docx-pro-cli
---
# docx-pro Word 文档操作 CLI

## 现状

- **分层结构与数据流**
- docx_pro.py 是编排层：解析参数、校验路径，把工作委托给同目录的四个模块——renderer.py（大纲字典渲染为 docx）、md_parser.parse_markdown（Markdown→大纲）、md_export.docx_to_markdown（docx→Markdown）、docx_replace.replace_in_docx（保真替换）；通过 `sys.path.append` 引入同目录模块。create 与 from-md 共用 renderer 的 `render_outline(outline, out)` 统一渲染管线；
  - replace 走独立的纯标准库 zip/XML 路径，不经过 python-docx 写入。renderer 内部按 `BLOCK_RENDERERS` 字典把块 type 分派到具体渲染函数。
- Sources / 来源：[jiuwenswarm/resources/agent/workspace/skills/docx-pro/scripts/docx_pro.py:L31–L41](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/docx-pro/scripts/docx_pro.py#L31-L41),
  - [jiuwenswarm/resources/agent/workspace/skills/docx-pro/scripts/renderer.py:L583–L599](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/docx-pro/scripts/renderer.py#L583-L599),
  - [jiuwenswarm/resources/agent/workspace/skills/docx-pro/scripts/docx_replace.py:L221–L253](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/docx-pro/scripts/docx_replace.py#L221-L253)
- **支持的行为与依赖**
- 生成侧支持封面、目录域（Word 中按 F9 更新）、多级标题（映射到内置 Heading 样式供 TOC/导航识别）、表格（跨行跨列合并、斑马纹、列宽）、图片、代码块、引用、页眉页脚页码、每页 VML 文字水印；replace 支持跨 run 定位替换、批量映射（-f/-t 或 --map）、--dry-run，匹配不跨段落/单元格/域代码，重打包时其余 zip 条目按原字节复制。依赖 python-docx（create/转换/检查路径）与 docx_replace 仅用标准库；setup_check.py 提供依赖自检。
- Sources / 来源：[jiuwenswarm/resources/agent/workspace/skills/docx-pro/scripts/docx_pro.py:L3–L12](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/docx-pro/scripts/docx_pro.py#L3-L12),
  - [jiuwenswarm/resources/agent/workspace/skills/docx-pro/scripts/docx_replace.py:L5–L26](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/docx-pro/scripts/docx_replace.py#L5-L26),
  - [jiuwenswarm/resources/agent/workspace/skills/docx-pro/scripts/setup_check.py:L9–L26](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/docx-pro/scripts/setup_check.py#L9-L26)
- **子命令入口与退出码契约**
- docx_pro.py 通过 argparse 暴露 create/from-md/to-md/replace/inspect/toc/watermark 七个子命令，由 `args.func(args)` 分派；main 统一预检输入文件存在性（不存在返回 2），并把 FileNotFoundError/ValueError 转为退出码 2。覆写保护仅存在于 create（输出不得等于输入 JSON）与 replace（输出不得等于输入 docx，返回 2）；toc 与 watermark 子命令无此检查，直接 `doc.save(args.out)`。
  - replace 的退出码分支不对称：仅当条目列表不一致或出现 unexpected_changes 时返回 1，零命中也返回 1，而 `_verify` 中记录的 opens_ok=False 不会触发失败分支。
- Sources / 来源：[jiuwenswarm/resources/agent/workspace/skills/docx-pro/scripts/docx_pro.py:L331–L347](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/docx-pro/scripts/docx_pro.py#L331-L347),
  - [jiuwenswarm/resources/agent/workspace/skills/docx-pro/scripts/docx_pro.py:L404–L421](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/docx-pro/scripts/docx_pro.py#L404-L421),
  - [jiuwenswarm/resources/agent/workspace/skills/docx-pro/scripts/docx_pro.py:L176–L178](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/docx-pro/scripts/docx_pro.py#L176-L178),
  - [jiuwenswarm/resources/agent/workspace/skills/docx-pro/scripts/docx_pro.py:L277–L326](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/docx-pro/scripts/docx_pro.py#L277-L326)
- **保真替换与目录域的实现取舍**
- replace_in_xml 跨 run 命中时只把替换文本写入首个命中节点、清空被匹配区间覆盖的中间/尾部节点内容，节点内未被匹配覆盖的文本通过区间拼接保留；回写时若新文本含前导/尾随空白且原标签缺 xml:space 会补上该属性，因此命中部件并非严格字节不变。整包重打包时未修改的 zip 条目按原始字节与原压缩方式复制。目录采用域（field）而非预生成条目：add_toc 插入 TOC 域并留提示文本，由用户在 Word 中按 F9 更新生成（此为代码展示的行为，其设计动机属于推断）。
- Sources / 来源：[jiuwenswarm/resources/agent/workspace/skills/docx-pro/scripts/docx_replace.py:L174–L205](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/docx-pro/scripts/docx_replace.py#L174-L205),
  - [jiuwenswarm/resources/agent/workspace/skills/docx-pro/scripts/docx_replace.py:L264–L274](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/docx-pro/scripts/docx_replace.py#L264-L274),
  - [jiuwenswarm/resources/agent/workspace/skills/docx-pro/scripts/renderer.py:L233–L252](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/docx-pro/scripts/renderer.py#L233-L252)
- **replace 的后验校验与退出码**
- 非 dry-run 的 replace 在写出后由 _verify 校验：比较新旧 zip 条目列表是否一致、逐条目字节比对（区分预期修改与 unexpected_changes）、对目标部件做残留计数，并尝试用 python-docx 重新打开两个文件——但 paragraphs/tables 仅记录新旧数量（len 对），代码未比较二者是否相等。退出码：total_found 为 0 时也输出警告日志，dry-run 返回 1，正式替换同样在零命中时返回 1；条目列表不一致或出现 unexpected_changes 也返回 1。
- Sources / 来源：[jiuwenswarm/resources/agent/workspace/skills/docx-pro/scripts/docx_replace.py:L284–L331](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/docx-pro/scripts/docx_replace.py#L284-L331),
  - [jiuwenswarm/resources/agent/workspace/skills/docx-pro/scripts/docx_pro.py:L183–L216](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/docx-pro/scripts/docx_pro.py#L183-L216)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/config-resources/feature-docx-pro-cli.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/docx-pro/scripts/docx_pro.py:L31-L41
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/docx-pro/scripts/renderer.py:L583-L599
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/docx-pro/scripts/docx_replace.py:L221-L253
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/docx-pro/scripts/docx_pro.py:L3-L12
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/docx-pro/scripts/docx_replace.py:L5-L26
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/docx-pro/scripts/setup_check.py:L9-L26
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/docx-pro/scripts/docx_pro.py:L331-L347
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/docx-pro/scripts/docx_pro.py:L404-L421
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/docx-pro/scripts/docx_pro.py:L176-L178
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/docx-pro/scripts/docx_pro.py:L277-L326
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/docx-pro/scripts/docx_replace.py:L174-L205
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/docx-pro/scripts/docx_replace.py:L264-L274
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/docx-pro/scripts/renderer.py:L233-L252
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/docx-pro/scripts/docx_replace.py:L284-L331
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/docx-pro/scripts/docx_pro.py:L183-L216
- 源页字段（feature）：docx-pro-cli
- 入口（entry_points）：jiuwenswarm/resources/agent/workspace/skills/docx-pro/scripts/docx_pro.py；jiuwenswarm/resources/agent/workspace/skills/docx-pro/scripts/setup_check.py
- 源页字段（source_globs）：jiuwenswarm/resources/agent/workspace/skills/docx-pro/scripts/docx_pro.py；jiuwenswarm/resources/agent/workspace/skills/docx-pro/scripts/setup_check.py；jiuwenswarm/resources/agent/workspace/skills/docx-pro/scripts/docx_replace.py
  - jiuwenswarm/resources/agent/workspace/skills/docx-pro/scripts/renderer.py；jiuwenswarm/resources/agent/workspace/skills/docx-pro/scripts/md_export.py
