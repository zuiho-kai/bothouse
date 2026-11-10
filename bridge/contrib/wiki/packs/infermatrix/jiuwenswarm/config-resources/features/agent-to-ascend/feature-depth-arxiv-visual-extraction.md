---
name: feature-depth-arxiv-visual-extraction
description: extract_arxiv_visuals 实现深读：main() 流程、resolve_input 四种合法输入、ensure_dependencies 缺失依赖 RuntimeError、--dpi 默认值与 pages/ 渲染条件、page_index 越界记 failures、caption 回退 copy2 取舍、paper-figure 手工复核流程（未执行）
metadata:
  scope: 收 extract_arxiv_visuals_v2_2.py 的实现深读，来源另含 acquire-visuals.md、prepare_evidence.py；功能概览归 feature-arxiv-visual-extraction-1 和 feature-arxiv-visual-extraction-2
---
# arXiv 论文 Figure/Table 检测与高清导出（extract_arxiv_visuals）：实现深读

## 现状

- [[feature-arxiv-visual-extraction-1]]、[[feature-arxiv-visual-extraction-2]]（功能概览） · [[config-resources-overview-1]]、[[config-resources-overview-2]]（owner 入口）
- **main()：解析参数→解析输入→获取 PDF→签名校验→extract_visuals→输出摘要并返回 0** main() 先校验参数，resolve_input 解析输入，本地 PDF 走 copy_local_pdf，否则 download_pdf；再读前 5 字节校验 %PDF- 后调用 extract_visuals，emit 结果计数与 manifest 路径，本地返回 0。
- 来源：jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/extract_arxiv_visuals_v2_2.py:L1410–L1465
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/extract_arxiv_visuals_v2_2.py#L1410-L1465`）
- **resolve_input：接受 arXiv ID/链接、HTTP(S) PDF 链接或本地 PDF 路径，否则 ValueError** 调用方传入原始字符串：本地文件后缀非 .pdf 抛 ValueError「本地文件不是 PDF」；命中 arXiv ID/URL 正则得到 pdf_url=https://arxiv.org/pdf/{id}；其它 http(s) 链接按文件名生成 paper_id；都不匹配抛 ValueError 列出四种合法输入。
- 来源：jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/extract_arxiv_visuals_v2_2.py:L200–L246
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/extract_arxiv_visuals_v2_2.py#L200-L246`）
- **ensure_dependencies：import 探测 DEPENDENCIES，缺失且禁用自动安装时抛 RuntimeError** 对 DEPENDENCIES 表逐个 importlib.import_module，ImportError 记入 missing；auto_install=False 时拼出 pip install 命令并以 RuntimeError 抛出（含 sys.executable），由调用方决定安装。PIL 固定规格为 Pillow>=10,<13。
- 来源：jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/extract_arxiv_visuals_v2_2.py:L55–L56
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/extract_arxiv_visuals_v2_2.py#L55-L56`）,
  - jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/extract_arxiv_visuals_v2_2.py:L96–L112
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/extract_arxiv_visuals_v2_2.py#L96-L112`）
- **--dpi defaults to DEFAULT_DPI; pages/ rendering only runs when options.keep_pages is true** L1370 将 --dpi 的 argparse 默认值设为 DEFAULT_DPI。L1298–L1299 显示 render_all_pages(doc, output/"pages", dpi) 仅在 options.keep_pages 为真时执行；未展示禁用时是否创建 pages/ 目录。
- 来源：jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/extract_arxiv_visuals_v2_2.py:L1370–L1370
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/extract_arxiv_visuals_v2_2.py#L1370-L1370`）,
  - jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/extract_arxiv_visuals_v2_2.py:L1298–L1299
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/extract_arxiv_visuals_v2_2.py#L1298-L1299`）
- **Out-of-range page_index candidates are recorded as failures and skipped; failures are included in manifest** 候选的 page_index 不满足 0 <= page_index < doc.page_count 时，向 failures 追加含 asdict(candidate) 与 error "page_index out of range" 的条目并 continue；manifest 的 "failures" 字段输出这些条目。
  - 另外 load_pdffigures_json 在路径缺失时抛 FileNotFoundError，顶层格式不符时抛 ValueError。
- 来源：jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/extract_arxiv_visuals_v2_2.py:L1224–L1232
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/extract_arxiv_visuals_v2_2.py#L1224-L1232`）,
  - jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/extract_arxiv_visuals_v2_2.py:L1330–L1333
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/extract_arxiv_visuals_v2_2.py#L1330-L1333`）,
  - jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/extract_arxiv_visuals_v2_2.py:L891–L901
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/extract_arxiv_visuals_v2_2.py#L891-L901`）
- **Caption render fallback via copy2 may duplicate image content; copy failure is uncaught here** 设计推断（非作者历史意图）：
- For each candidate the script unions region and caption bboxes and tries render_region; if that raises, or union_rect returns None, it calls shutil.copy2(image_path, caption_path).
  - Benefit (inference): a caption file is still attempted when rendering fails; cost: when copy succeeds the caption file duplicates the plain image instead of including the caption, and copy2 itself is not wrapped in try here so its failure propagates.
- 来源：jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/extract_arxiv_visuals_v2_2.py:L1259–L1266
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/extract_arxiv_visuals_v2_2.py#L1259-L1266`）
- **已文档化的 paper-figure 手工复核流程（prepare→看 contact sheet→approve→used），未执行** 文档中的人工验收步骤（本轮未执行）：
- 工作流文档规定了具体操作：先运行 `python3 ../scripts/prepare_evidence.py .` 走 `paper-figure` 路由（prepare_paper 调用 extract_arxiv_visuals_v2_2.py 并解析 manifest），再查看 `analysis/evidence-contact-sheet.jpg` 或论文专属 contact sheet 后执行 `--approve <id>`，素材加入幻灯片后执行 `--used <id>`；
  - 预期结果是文件视觉素材经 `review.approved` 后状态变为 ready/used，自动选择不唯一时状态转为 needs-manual 并保留 manifest 与 contact sheet 供人工判断。该流程是文档化手工确认视觉相关性与可读性，不是裁图正确性的自动化断言；NOT EXECUTED（本次未运行）。
- 来源：[jiuwenswarm/resources/agent/workspace/skills/ppt-creation/workflows/acquire-visuals.md:L44–L52](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/workflows/acquire-visuals.md#L44-L52),
  - [jiuwenswarm/resources/agent/workspace/skills/ppt-creation/workflows/acquire-visuals.md:L64–L73](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/workflows/acquire-visuals.md#L64-L73),
  - [jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/prepare_evidence.py:L128–L174](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/prepare_evidence.py#L128-L174),
  - [jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/prepare_evidence.py:L231–L253](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/prepare_evidence.py#L231-L253)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/config-resources/feature-depth-arxiv-visual-extraction.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/extract_arxiv_visuals_v2_2.py:L1410-L1465
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/extract_arxiv_visuals_v2_2.py:L200-L246
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/extract_arxiv_visuals_v2_2.py:L55-L56
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/extract_arxiv_visuals_v2_2.py:L96-L112
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/extract_arxiv_visuals_v2_2.py:L1370-L1370
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/extract_arxiv_visuals_v2_2.py:L1298-L1299
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/extract_arxiv_visuals_v2_2.py:L1224-L1232
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/extract_arxiv_visuals_v2_2.py:L1330-L1333
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/extract_arxiv_visuals_v2_2.py:L891-L901
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/extract_arxiv_visuals_v2_2.py:L1259-L1266
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/workflows/acquire-visuals.md:L44-L52
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/workflows/acquire-visuals.md:L64-L73
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/prepare_evidence.py:L128-L174
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/prepare_evidence.py:L231-L253
- 源页字段（feature）：arxiv-visual-extraction
- 入口（entry_points）：jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/extract_arxiv_visuals_v2_2.py
- 源页字段（source_globs）：jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/extract_arxiv_visuals_v2_2.py
