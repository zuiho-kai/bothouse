---
name: feature-arxiv-visual-extraction-2
description: extract_arxiv_visuals v2.2 功能知识 下：Python-only 零外部工具链与人工复核要求、%PDF- 魔数与 debug/contact sheet 复核产物、输出 PNG 与 caption 变体的条件
metadata:
  scope: 只收零外部工具链取舍、参数校验与复核产物、输出行为三节；流水线、命令行设置与 CLI 入口归 feature-arxiv-visual-extraction-1，实现深读归 feature-depth-arxiv-visual-extraction
---
# extract_arxiv_visuals v2.2 — arXiv 论文 Figure/Table 检测与高清导出（2/2）

## 现状

- 拆分说明：本页是源页 `feature-arxiv-visual-extraction.md` 的第 2/2 部分；第 1 部分 [[feature-arxiv-visual-extraction-1]]
- **零外部工具链与人工复核要求**
- docstring 明确脚本"intentionally Python-only"——不依赖 Bash/curl/Java/Git/WSL，缺失的 PyMuPDF/Pillow 默认在模块导入期自动 pip 安装（--no-auto-install 关闭）；PDFFigures2 结果以可选 JSON 文件接入，使脚本本身不需要 Java 运行时。代价是检测为启发式：manifest 固定写入 quality_note，提示 PyMuPDF 表格检测与 caption 启发式属于自动检测，应查看 debug/ 与 contact_sheet.png 做人工视觉复核。
- Sources / 来源：jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/extract_arxiv_visuals_v2_2.py:L22–L24
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/extract_arxiv_visuals_v2_2.py#L22-L24`）,
  - jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/extract_arxiv_visuals_v2_2.py:L96–L127
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/extract_arxiv_visuals_v2_2.py#L96-L127`）,
  - jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/extract_arxiv_visuals_v2_2.py:L891–L897
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/extract_arxiv_visuals_v2_2.py#L891-L897`）,
  - jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/extract_arxiv_visuals_v2_2.py:L1334–L1337
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/extract_arxiv_visuals_v2_2.py#L1334-L1337`）
- **参数校验与可视化复核产物**
- main() 在解析后用 parser.error 校验 --dpi/--debug-dpi 必须为正、--padding 非负，并在提取前读取文件前 5 字节验证 %PDF- 魔数。运行后生成复核用的可视化产物：make_debug_pages 为每个含候选的页面渲染红框标注图，标签含 kind、label 与 source；make_contact_sheet 把成功提取的缩略图排成网格，缩略图不少于 3 张时为 3 列，不足时列数等于缩略图数，无缩略图则不生成该文件。manifest 的 summary 记录 figure/table/visual/failure 计数。
- Sources / 来源：jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/extract_arxiv_visuals_v2_2.py:L1413–L1437
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/extract_arxiv_visuals_v2_2.py#L1413-L1437`）,
  - jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/extract_arxiv_visuals_v2_2.py:L1126–L1148
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/extract_arxiv_visuals_v2_2.py#L1126-L1148`）,
  - jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/extract_arxiv_visuals_v2_2.py:L1168–L1177
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/extract_arxiv_visuals_v2_2.py#L1168-L1177`）
- **支持的输出行为及其条件**
- 提取成功时，每个候选写入两张 PNG：figures/（或 tables/）下的内容图，以及 *_with_caption 变体——仅当 region 与 caption bbox 可合并时才渲染合并区域，否则直接复制内容图，因此 caption 变体并不保证包含 caption；单个候选渲染失败不会中断流程，而是记入 manifest 的 failures。辅助产物是条件性的：debug/ 标注页只为含候选的页面生成，contact_sheet.png 在没有任何成功缩略图时跳落不生成，pages/ 全页 PNG 仅在 --keep-pages 时输出。
- Sources / 来源：jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/extract_arxiv_visuals_v2_2.py:L1259–L1274
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/extract_arxiv_visuals_v2_2.py#L1259-L1274`）,
  - jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/extract_arxiv_visuals_v2_2.py:L1121–L1128
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/extract_arxiv_visuals_v2_2.py#L1121-L1128`）,
  - jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/extract_arxiv_visuals_v2_2.py:L1168–L1177
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/extract_arxiv_visuals_v2_2.py#L1168-L1177`）,
  - jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/extract_arxiv_visuals_v2_2.py:L1298–L1302
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/extract_arxiv_visuals_v2_2.py#L1298-L1302`）

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/config-resources/feature-arxiv-visual-extraction.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-07
