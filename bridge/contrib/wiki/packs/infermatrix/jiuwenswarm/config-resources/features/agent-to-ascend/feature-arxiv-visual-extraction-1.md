---
name: feature-arxiv-visual-extraction-1
description: extract_arxiv_visuals v2.2 功能知识 上：四源候选到去重清洗渲染的流水线、命令行设置（--dpi/--padding/--no-auto-install 等）、CLI 入口与错误契约（退出码 130/1）
metadata:
  scope: 只收候选流水线、命令行设置与 CLI 入口错误契约三节；零外部工具链取舍、参数校验与复核产物、输出行为归 feature-arxiv-visual-extraction-2，实现深读归 feature-depth-arxiv-visual-extraction
---
# extract_arxiv_visuals v2.2 — arXiv 论文 Figure/Table 检测与高清导出（1/2）

## 现状

- 拆分说明：本页是源页 `feature-arxiv-visual-extraction.md` 的第 1/2 部分；第 2 部分 [[feature-arxiv-visual-extraction-2]]
- **候选流水线与数据流**
- extract_visuals 采用四源候选→合并→去重→清洗→渲染的流水线：先加载可选 PDFFigures2 JSON（confidence 0.96），再跑 PyMuPDF find_tables（0.82/0.66），caption 启发式为 figure（0.62）和 table（0.55）补充候选；merge_same_label_tables 合并同页同标签的表格碎片，deduplicate 按 source 优先级（pdffigures2_json 最高）加 IoU>0.42 / 包含率>0.78 / 同标签轻微重叠规则去重；
  - 最后 sanitize_margin_artifacts 对所有路径（含外部 PDFFigures2 框）统一剔除页边 arXiv 戳记，逐候选渲染 PNG 并写 manifest。文档还注明清理刻意放在去重之后，保证每条路径得到同样的裁剪治理。
- Sources / 来源：jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/extract_arxiv_visuals_v2_2.py:L1203–L1217
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/extract_arxiv_visuals_v2_2.py#L1203-L1217`）,
  - jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/extract_arxiv_visuals_v2_2.py:L962–L997
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/extract_arxiv_visuals_v2_2.py#L962-L997`）,
  - jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/extract_arxiv_visuals_v2_2.py:L423–L432
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/extract_arxiv_visuals_v2_2.py#L423-L432`）
- **命令行设置**
- CLI 提供 --dpi（默认 300，即 DEFAULT_DPI）、--padding（默认 4.0 PDF point）、--debug-dpi（默认 120）、--output（默认 ./paper-assets-<paper-id>）、--keep-pages、--force、--include-uncaptioned-tables（默认关闭，因流程图/仪表盘易被误判为表格）、--pdffigures-json 与 --no-auto-install。main() 校验 dpi/debug_dpi 必须为正、padding 非负，否则 parser.error。
  - --no-auto-install 在模块导入期、第三方 import 之前就从 sys.argv 解析，用于禁止自动 pip 安装 PyMuPDF（>=1.24,<2）与 Pillow（>=10,<13）。
- Sources / 来源：jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/extract_arxiv_visuals_v2_2.py:L1363–L1406
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/extract_arxiv_visuals_v2_2.py#L1363-L1406`）,
  - jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/extract_arxiv_visuals_v2_2.py:L50–L56
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/extract_arxiv_visuals_v2_2.py#L50-L56`）,
  - jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/extract_arxiv_visuals_v2_2.py:L125–L130
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/extract_arxiv_visuals_v2_2.py#L125-L130`）
- **CLI 入口与错误契约**
- 公开入口是命令行 main()：接受 arXiv ID/URL、HTTP(S) PDF URL 或本地 PDF 路径，核心逻辑在 extract_visuals(pdf_path, output, resource, options)，返回 manifest dict 并写入 manifest.json。参数校验（dpi/debug_dpi 为正、padding 非负）发生在 L1411–L1418，位于 try 块之前，parser.error 直接退出；
  - 只有 L1420 之后抛出的异常才被 L1466–L1471 捕获——KeyboardInterrupt 返回 130，其余异常打印错误并返回 1。依赖安装则在模块导入期（L125–L130 之前的 ensure_dependencies）完成，不在此 try 覆盖范围内。
- Sources / 来源：jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/extract_arxiv_visuals_v2_2.py:L1410–L1471
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/extract_arxiv_visuals_v2_2.py#L1410-L1471`）,
  - jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/extract_arxiv_visuals_v2_2.py:L1191–L1196
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/extract_arxiv_visuals_v2_2.py#L1191-L1196`）,
  - jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/extract_arxiv_visuals_v2_2.py:L1363–L1369
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/extract_arxiv_visuals_v2_2.py#L1363-L1369`）

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/config-resources/feature-arxiv-visual-extraction.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-07
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/extract_arxiv_visuals_v2_2.py:L1203-L1217
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/extract_arxiv_visuals_v2_2.py:L962-L997
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/extract_arxiv_visuals_v2_2.py:L423-L432
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/extract_arxiv_visuals_v2_2.py:L1363-L1406
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/extract_arxiv_visuals_v2_2.py:L50-L56
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/extract_arxiv_visuals_v2_2.py:L125-L130
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/extract_arxiv_visuals_v2_2.py:L1410-L1471
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/extract_arxiv_visuals_v2_2.py:L1191-L1196
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/extract_arxiv_visuals_v2_2.py:L1363-L1369
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/extract_arxiv_visuals_v2_2.py:L22-L24
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/extract_arxiv_visuals_v2_2.py:L96-L127
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/extract_arxiv_visuals_v2_2.py:L891-L897
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/extract_arxiv_visuals_v2_2.py:L1334-L1337
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/extract_arxiv_visuals_v2_2.py:L1413-L1437
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/extract_arxiv_visuals_v2_2.py:L1126-L1148
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/extract_arxiv_visuals_v2_2.py:L1168-L1177
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/extract_arxiv_visuals_v2_2.py:L1259-L1274
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/extract_arxiv_visuals_v2_2.py:L1121-L1128
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/extract_arxiv_visuals_v2_2.py:L1298-L1302
- 源页字段（feature）：arxiv-visual-extraction
- 入口（entry_points）：jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/extract_arxiv_visuals_v2_2.py
- 源页字段（source_globs）：jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/extract_arxiv_visuals_v2_2.py
