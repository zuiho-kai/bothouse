---
name: local-doc-ocr-scripts-contracts-01
description: local-doc-ocr-scripts 源码接口记录 01：local-doc-ocr 技能脚本（离线 OCR、PDF 转图、图像预处理、setup 与 OCR 结果写入）；覆盖 ocr_offline.py、pdf_to_images.py、preprocess_img.py、setup.py、write_ocr_md.py
metadata:
  scope: 只收 local-doc-ocr-scripts 下这 5 个源文件的逐文件接口记录；本目录入口归 local-doc-ocr-scripts-overview
---
# local-doc-ocr-scripts 源码接口与集成边界 01

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/resources/agent/workspace/skills/local-doc-ocr/scripts/ocr_offline.py`**
- 调用入口 `ocr_image(engine, path, do_preprocess)`。
- 调用入口 `render_pdf(pdf, out_dir, dpi, start_page, end_page)`。
- 调用入口 `collect_images(inp)`。
- 调用入口 `main()`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`import sys, os, json, argparse, datetime`；`from preprocess_img import preprocess, _estimate_skew`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/local-doc-ocr/scripts/ocr_offline.py#L1-L238)。
- **`jiuwenswarm/resources/agent/workspace/skills/local-doc-ocr/scripts/pdf_to_images.py`**
- 调用入口 `render_one(src, out_base, dpi, start_page, end_page, do_preprocess, tiles)`。
- 调用入口 `main()`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`import sys, os, argparse`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/local-doc-ocr/scripts/pdf_to_images.py#L1-L129)。
- **`jiuwenswarm/resources/agent/workspace/skills/local-doc-ocr/scripts/preprocess_img.py`**
- 调用入口 `preprocess(img, do_deskew)`。
- 调用入口 `main()`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`import sys, os, argparse`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/local-doc-ocr/scripts/preprocess_img.py#L1-L76)。
- **`jiuwenswarm/resources/agent/workspace/skills/local-doc-ocr/scripts/setup.py`**
- 调用入口 `ensure_deps()`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`import importlib.util`；`import subprocess`；`import sys`。
- 模块级配置或常量名称：`PACKAGES`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/local-doc-ocr/scripts/setup.py#L1-L59)。
- **`jiuwenswarm/resources/agent/workspace/skills/local-doc-ocr/scripts/write_ocr_md.py`**
- 调用入口 `build_md(data)`。
- 调用入口 `main()`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`import sys, os, json, argparse, datetime`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/local-doc-ocr/scripts/write_ocr_md.py#L1-L76)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/config-resources/local-doc-ocr-scripts/source-contracts-01.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
