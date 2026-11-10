---
name: feature-local-doc-ocr-offline-2
description: local-doc-ocr 本地离线 OCR 管线功能概览第 2 部分：离线优先与手写/印章识别弱项的容错取舍、预处理逐步吞错、ocr_offline.py CLI 选项默认值与输出路径解析（-o、--boxes-json 命名）
metadata:
  scope: 只收 local-doc-ocr 功能概览的设计取舍与 CLI 选项/输出路径解析；脚本入口、行为边界、验证途径与管线控制流归 feature-local-doc-ocr-offline-1，实现深读归 feature-depth-local-doc-ocr-offline
---
# local-doc-ocr：本地离线 OCR 管线（RapidOCR：PDF/图片 → Markdown）（2/2）

## 现状

- 拆分说明：本页是源页 `feature-local-doc-ocr-offline.md` 的第 2/2 部分；第 1 部分 [[feature-local-doc-ocr-offline-1]]
- **离线优先与容错取舍**
- 隐私优先：识别用本地 ONNX 引擎 RapidOCR，输出显式声明「不联网、不上传」；代价是首次依赖缺失时需联网装一次白名单包（setup.py 仅在 find_spec 检出缺失时才安装，依赖齐则直接返回就绪）。识别质量取舍：RapidOCR 对手写/印章/严重倾斜较弱，脚本在空页建议和结尾警告中明确引导改走多模态读图路线复核，而不是自行调参兜底。预处理（preprocess_img.preprocess）仅对 EXIF 转置、倾斜校正、锐化各步分别 try/except 吞错跳过，灰度转换等步骤异常仍会向上传播，并非整体降级。
- Sources / 来源：[jiuwenswarm/resources/agent/workspace/skills/local-doc-ocr/scripts/setup.py:L41–L55](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/local-doc-ocr/scripts/setup.py#L41-L55),
  - [jiuwenswarm/resources/agent/workspace/skills/local-doc-ocr/scripts/ocr_offline.py:L206–L218](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/local-doc-ocr/scripts/ocr_offline.py#L206-L218),
  - [jiuwenswarm/resources/agent/workspace/skills/local-doc-ocr/scripts/preprocess_img.py:L35–L58](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/local-doc-ocr/scripts/preprocess_img.py#L35-L58)
- **CLI Options and Output-Path Resolution**
- The ocr_offline.py CLI has no external configuration files or environment variables; all configuration is provided through command-line arguments: `-o/--out` (default None), `-d/--dpi` (default 300), `--no-preprocess` (default off),
  - `--start-page`/`--end-page` (default None, 1-based; `render_pdf` applies one-sided bounds via `s = max(1, start_page or 1)` and `e = min(n, end_page or n)`, so either bound can be set alone), and `--boxes-json` (default off).
  - Output-path resolution is two-step and differs by input type: when `-o` is omitted, directory inputs write `<stem>_OCR.md` inside the input directory itself (L164–L165), while file inputs write it next to the input (L166–L167);
  - the boxes JSON is always derived from the resolved Markdown path as `os.path.splitext(out_md)[0] + "_boxes.json"` (L224–L225), so a custom `-o` such as `out.md` yields `out_boxes.json`, not `<name>_OCR_boxes.json`.
  - The sibling pdf_to_images.py mirrors these knobs (`-d` 300, `-p/-n` page bounds, `-o` output directory defaulting to a `<name>_pages` folder beside the PDF) plus `--preprocess`, `-b`, and `-t/--tiles` (default 0).
- Sources / 来源：[jiuwenswarm/resources/agent/workspace/skills/local-doc-ocr/scripts/ocr_offline.py:L129–L145](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/local-doc-ocr/scripts/ocr_offline.py#L129-L145),
  - [jiuwenswarm/resources/agent/workspace/skills/local-doc-ocr/scripts/ocr_offline.py:L160–L167](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/local-doc-ocr/scripts/ocr_offline.py#L160-L167),
  - [jiuwenswarm/resources/agent/workspace/skills/local-doc-ocr/scripts/ocr_offline.py:L224–L229](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/local-doc-ocr/scripts/ocr_offline.py#L224-L229),
  - [jiuwenswarm/resources/agent/workspace/skills/local-doc-ocr/scripts/pdf_to_images.py:L74–L92](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/local-doc-ocr/scripts/pdf_to_images.py#L74-L92)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/config-resources/feature-local-doc-ocr-offline.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-07
