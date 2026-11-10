---
name: feature-ppt-opc-thumbnail
description: opc/thumbnail.py 缩略图联系表渲染器功能概览：soffice 转 PDF 再 PyMuPDF 栅格化的流水线、prefix/--cols 与 CELL_W/MAX_PER_SHEET 常量、ThumbnailError 与 CalledProcessError 的错误契约、标签按页序生成的假定、外部工具链取舍、验证方式
metadata:
  scope: 只收 thumbnail.py 的架构、配置、API、特性、取舍与验证六个方面；逐方面的实现深读归 feature-depth-ppt-opc-thumbnail
---
# Deck Thumbnail Contact-Sheet Renderer (thumbnail.py)

## 现状

- **渲染流水线与数据流**
- 流程为两阶段转换:`_run()` 在临时目录中调用 `render_pages()`,先用 LibreOffice `soffice --headless --convert-to pdf` 把 deck 转成 PDF(check=True, 300s 超时),再用 PyMuPDF(fitz)按 `CELL_W/page宽` 的缩放把每页栅格化为 PIL RGB 图像;随后 `build_sheet()` 把图像按行列贴到白色画布并标注 `slideN.xml` 标签。
  - `find_soffice()` 依次探测 PATH 中的 `soffice` 和 macOS 应用路径,找不到即抛 `ThumbnailError`。
- Sources / 来源：[jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/thumbnail.py:L66–L86](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/thumbnail.py#L66-L86),
  - [jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/thumbnail.py:L89–L103](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/thumbnail.py#L89-L103)
- **配置项与常量默认值**
- 用户可配置项仅有 CLI 的 `prefix`(默认 `thumbnails`)和 `--cols`(默认 3)。布局常量硬编码:`CELL_W=480` 像素/缩略图、`LABEL_H=22`、`PAD=8`、`MAX_PER_SHEET=24`(超过则拆成 `prefix-1.jpg`、`prefix-2.jpg`…);JPEG 保存质量固定 88。无环境变量或配置文件。
- Sources / 来源：[jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/thumbnail.py:L52–L55](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/thumbnail.py#L52-L55),
  - [jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/thumbnail.py:L107–L111](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/thumbnail.py#L107-L111),
  - [jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/thumbnail.py:L126–L128](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/thumbnail.py#L126-L128)
- **API 与错误契约**
- 入口为 CLI：位置参数 `deck`（输入 .pptx）、可选 `prefix`（默认 `thumbnails`）与 `--cols`（默认 3）。程序输出经 `thumbnail.out` logger 走 stdout，诊断走 stderr，格式均为裸 `%(message)s`。错误契约需区分：`main()` 仅把 `ThumbnailError` 转为带消息的 `SystemExit`（L139–L140）；
  - 而 L68–L70 的 `subprocess.run(check=True, timeout=300)` 失败或超时会直接抛出 `subprocess.CalledProcessError`/`TimeoutExpired`，不会经过该转换。
- Sources / 来源：[jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/thumbnail.py:L106–L116](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/thumbnail.py#L106-L116),
  - [jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/thumbnail.py:L135–L140](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/thumbnail.py#L135-L140),
  - [jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/thumbnail.py:L68–L70](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/thumbnail.py#L68-L70)
- **支持的渲染行为**
- 把 deck 经 LibreOffice 无头转 PDF，再用 PyMuPDF 按宽度缩放到 480px 栅格化每页，贴成带标签的白色网格并以 JPEG（quality=88）落盘；超过 24 页拆分为 `prefix-1.jpg`、`prefix-2.jpg`…。注意：单元格标签是按 PDF 页序生成的 `slide{i+1}.xml`（L121），并不读取 deck 内实际的 OPC 部件名，因此页序与部件名的对应是假定而非查证。缺失输入文件、找不到 LibreOffice、无 PDF 产出或缺 PyMuPDF 时给出显式错误消息。
- Sources / 来源：[jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/thumbnail.py:L66–L86](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/thumbnail.py#L66-L86),
  - [jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/thumbnail.py:L121–L128](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/thumbnail.py#L121-L128),
  - [jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/thumbnail.py:L114–L116](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/thumbnail.py#L114-L116)
- **设计取舍**
- 渲染完全依赖外部工具链：`find_soffice()` 探测 PATH 与 macOS 应用路径，缺失即失败；PyMuPDF 在 `render_pages` 内延迟导入，缺包时报错（L75–L78）。换取的是无需自己解析/绘制幻灯片内容。另一取舍是标签映射：docstring 宣称标签让视觉发现能直接定位待编辑文件（L7–L8），但实现只按页序生成顺序标签（L121），若部件命名或顺序与线性页序不一致，该映射会失配。soffice 调用设有 300 秒超时上限以约束单次转换时长。
- Sources / 来源：[jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/thumbnail.py:L58–L63](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/thumbnail.py#L58-L63),
  - [jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/thumbnail.py:L121–L121](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/thumbnail.py#L121-L121),
  - [jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/thumbnail.py:L7–L8](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/thumbnail.py#L7-L8),
  - [jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/thumbnail.py:L68–L70](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/thumbnail.py#L68-L70)
- **验证方式**
- Inference / 设计推断（非作者历史意图）：
- 所示摘录中未包含针对该脚本的测试；模块 docstring 给出两条例子调用（`thumbnail.py deck.pptx`、`... grid --cols 4`）作为用法示范（L4–L5）。代码内可观察的检查点包括：输入文件存在性检查（L114–L116）、PDF 产出与 PyMuPDF 导入检查（L72–L78），以及 CLI 边界把 `ThumbnailError` 转为非零退出的路径（L139–L140）——这些错误分支是手动运行时可复现的行为。
- Sources / 来源：[jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/thumbnail.py:L4–L5](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/thumbnail.py#L4-L5),
  - [jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/thumbnail.py:L114–L116](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/thumbnail.py#L114-L116),
  - [jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/thumbnail.py:L135–L140](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/thumbnail.py#L135-L140)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/config-resources/feature-ppt-opc-thumbnail.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/thumbnail.py:L66-L86
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/thumbnail.py:L89-L103
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/thumbnail.py:L52-L55
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/thumbnail.py:L107-L111
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/thumbnail.py:L126-L128
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/thumbnail.py:L106-L116
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/thumbnail.py:L135-L140
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/thumbnail.py:L68-L70
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/thumbnail.py:L121-L128
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/thumbnail.py:L114-L116
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/thumbnail.py:L58-L63
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/thumbnail.py:L121-L121
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/thumbnail.py:L7-L8
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/thumbnail.py:L4-L5
- 源页字段（feature）：ppt-opc-thumbnail
- 入口（entry_points）：jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/thumbnail.py
- 源页字段（source_globs）：jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/thumbnail.py
