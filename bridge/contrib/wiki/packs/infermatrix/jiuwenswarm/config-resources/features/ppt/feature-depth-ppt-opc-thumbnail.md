---
name: feature-depth-ppt-opc-thumbnail
description: thumbnail.py 实现深读：CLI 默认值与 ThumbnailError 转 SystemExit、CELL_W=480/MAX_PER_SHEET=24 常量、soffice/fitz/PIL 依赖、ThumbnailError 各触发路径、外部依赖取舍、_run 渲染分块写 JPG、editing.md 手工调用与每页数不一致（未执行）
metadata:
  scope: 收 thumbnail.py 的 API、配置、依赖、失败模式、取舍、流程与手工验收的实现深读，来源另含 editing.md；功能概览归 feature-ppt-opc-thumbnail
---
# Deck Thumbnail Contact-Sheet Renderer：实现深读

## 现状

- [[feature-ppt-opc-thumbnail]]（功能概览） · [[config-resources-overview-1]]、[[config-resources-overview-2]]（owner 入口）
- **CLI: positional deck, optional prefix (default "thumbnails"), --cols default 3; helpers raise ThumbnailError, main converts it to SystemExit** argparse 定义 deck（必填）、prefix（默认 thumbnails）、--cols（默认 3）。程序输出经 _OUT logger（%(message)s 格式、propagate=False、stdout handler）走 stdout，诊断经 LOGGER 走 stderr；
  - main 捕获 ThumbnailError 转为 SystemExit(str(exc))，__main__ 下 sys.exit(main())。
- 来源：[jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/thumbnail.py:L22–L37](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/thumbnail.py#L22-L37),
  - [jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/thumbnail.py:L106–L112](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/thumbnail.py#L106-L112),
  - [jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/thumbnail.py:L135–L144](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/thumbnail.py#L135-L144)
- **常量与 CLI 默认：prefix=thumbnails、cols=3、CELL_W=480、MAX_PER_SHEET=24** 输出前缀默认 “thumbnails”、列数默认 3；CELL_W=480px、LABEL_H=22、PAD=8 为模块常量；页数超过 MAX_PER_SHEET=24 时文件名追加 “-N” 后缀分片。运行时 soffice 转换 timeout=300 秒。
- 来源：[jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/thumbnail.py:L52–L55](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/thumbnail.py#L52-L55),
  - [jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/thumbnail.py:L109–L111](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/thumbnail.py#L109-L111),
  - [jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/thumbnail.py:L126–L127](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/thumbnail.py#L126-L127)
- **soffice subprocess, delayed fitz import, and PIL (Image/ImageDraw) composition** render_pages 以 find_soffice() 返回的可执行文件运行 `--headless --convert-to pdf`（check=True, capture_output, timeout=300 的 subprocess 参数），随后延迟 import fitz 并用 fitz + PIL Image 栅格化；build_sheet 用 Image.new/ImageDraw 拼网格。
  - 缺 soffice 或 PyMuPDF 分别抛出指明安装方式的 ThumbnailError。
- 来源：[jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/thumbnail.py:L58–L78](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/thumbnail.py#L58-L78),
  - [jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/thumbnail.py:L89–L103](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/thumbnail.py#L89-L103)
- **ThumbnailError 路径：soffice 缺失、无 PDF、缺 PyMuPDF、deck 不存在** find_soffice 找不到 soffice 或 mac 路径时抛 ThumbnailError；LibreOffice 未产出 PDF 文件、fitz ImportError、deck 非文件均抛 ThumbnailError；main() 将其转为 SystemExit(错误消息)，使 helper 保持可库用。
- 来源：[jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/thumbnail.py:L58–L63](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/thumbnail.py#L58-L63),
  - [jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/thumbnail.py:L71–L78](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/thumbnail.py#L71-L78),
  - [jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/thumbnail.py:L114–L116](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/thumbnail.py#L114-L116),
  - [jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/thumbnail.py:L135–L140](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/thumbnail.py#L135-L140)
- **Bundling rendering into helpers with ThumbnailError keeps library usability (inference), at the cost of external soffice/PyMuPDF requirements** 设计推断（非作者历史意图）：
- 收益（推断）：按 docstring L41–L45，helpers 抛 ThumbnailError 而非 SystemExit，使其可作为库复用。成本：必须找到 soffice 且 fitz 可导入，否则以 ThumbnailError 失败；L70 的 timeout=300 是传给 subprocess.run 的设置参数，本片证据不构成对实际耗时的硬性保证。
- 来源：[jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/thumbnail.py:L40–L45](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/thumbnail.py#L40-L45),
  - [jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/thumbnail.py:L58–L78](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/thumbnail.py#L58-L78)
- **_run() 校验 deck 后在临时目录渲染分页并分块写出 JPG（emit 的输出目标未在所示行内）** `_run()` 先检查 `deck.is_file()`，否则抛 `ThumbnailError`；随后在 `tempfile.TemporaryDirectory()` 中调 `render_pages()`，后者用 `soffice --headless --convert-to pdf`（check=True，timeout=300）转 PDF，确认 PDF 文件存在后导入 fitz，按 `CELL_W/page宽` 缩放栅格化每页为 PIL RGB 图像。
  - 回到 `_run()`，页按 `MAX_PER_SHEET=24` 分块，每块经 `build_sheet()` 保存为 `{prefix}{suffix}.jpg`（quality=88，多块时后缀 `-N`），最后调用 `emit()` 报告写入的文件名与页数；`emit` 与 `build_sheet` 的内部实现不在所示范围内。
- 来源：[jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/thumbnail.py:L106–L131](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/thumbnail.py#L106-L131),
  - [jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/thumbnail.py:L66–L86](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/thumbnail.py#L66-L86),
  - [jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/thumbnail.py:L52–L55](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/thumbnail.py#L52-L55)
- **editing.md 记录的手动调用（未执行）：thumbnail.py 生成带页文件名标注的 thumbnails.jpg，默认 3 列** 文档中的人工验收步骤（本轮未执行）：
- 文档给出 `python scripts/opc/thumbnail.py input.pptx [output_prefix] [--cols N]`，预期产出带页面文件名标注的 `thumbnails.jpg`，默认 3 列；并说明该输出只用于模板版式分析，视觉 QA 需另用 `soffice` + `pdftoppm`。此为文档化手动流程，未在本轮执行；所示源码 span 中无自动化测试，代码 `MAX_PER_SHEET = 24` 与文档所述“每张网格最多 12 页”不一致，应以源码为准并在文档侧修正。
- 来源：[jiuwenswarm/resources/agent/workspace/skills/ppt-creation/editing.md:L91–L99](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/editing.md#L91-L99),
  - [jiuwenswarm/resources/agent/workspace/skills/ppt-creation/editing.md:L11–L17](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/editing.md#L11-L17),
  - [jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/thumbnail.py:L52–L55](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/thumbnail.py#L52-L55)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/config-resources/feature-depth-ppt-opc-thumbnail.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/thumbnail.py:L52-L55
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/thumbnail.py:L109-L111
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/thumbnail.py:L126-L127
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/thumbnail.py:L58-L63
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/thumbnail.py:L71-L78
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/thumbnail.py:L114-L116
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/thumbnail.py:L135-L140
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/thumbnail.py:L22-L37
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/thumbnail.py:L106-L112
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/thumbnail.py:L135-L144
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/thumbnail.py:L58-L78
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/thumbnail.py:L89-L103
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/thumbnail.py:L40-L45
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/thumbnail.py:L106-L131
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/thumbnail.py:L66-L86
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/editing.md:L91-L99
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/editing.md:L11-L17
- 源页字段（feature）：ppt-opc-thumbnail
- 入口（entry_points）：jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/thumbnail.py
- 源页字段（source_globs）：jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/thumbnail.py
