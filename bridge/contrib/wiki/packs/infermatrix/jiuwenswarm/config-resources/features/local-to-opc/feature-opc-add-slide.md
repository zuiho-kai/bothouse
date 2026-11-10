---
name: feature-opc-add-slide
description: ppt-creation 的 opc/add_slide.py 功能概览：验证入口（docstring 示例命令）、入口与 AddSlideError 契约、四处一致更新流程、无配置的设置面（slide 编号/rId/sldId 取值）、两种添加方式、纯文本替换的实现取舍
metadata:
  scope: 只收 add_slide.py 的验证入口、契约、流程、设置面、行为与取舍六个方面；逐方面的实现深读归 feature-depth-opc-add-slide
---
# add_slide.py — 解包 PPTX 幻灯片添加工具

## 现状

- **验证入口**
- 所示文件不含测试代码；docstring 中的两条示例命令（复制 slide2、基于 slideLayout2 建空白页）即是最直接的手工验证入口，成功输出为两行摘要（新部件路径与 presentation.xml 注册结果）。未展示仓库内针对此脚本的自动化测试。
- Sources / 来源：[jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/add_slide.py:L2–L11](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/add_slide.py#L2-L11),
  - [jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/add_slide.py:L129–L130](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/add_slide.py#L129-L130)
- **入口与契约**
- 命令行入口为 `add_slide.py <unpacked目录> <source>`，source 可以是 `slideN.xml`（复制现有幻灯片）或 `slideLayoutN.xml`（在该版式上建空白页）。`add_slide(root, source)` 也可作库函数调用，返回两行摘要：新部件路径 `ppt/slides/slideN.xml`，以及在 presentation.xml 中注册的 `<p:sldId id="..." r:id="<rel_id>"/>`——摘要里 sldId 固定显示为 "..."，只有 r:id 是实际生成的关系 id。
  - 辅助函数以 `AddSlideError` 报告致命错误，`main()` 将其转为带信息的 `SystemExit`，使函数保持可库用。
- Sources / 来源：[jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/add_slide.py:L167–L182](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/add_slide.py#L167-L182),
  - [jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/add_slide.py:L127–L130](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/add_slide.py#L127-L130)
- **四处一致更新**
- 核心流程 `add_slide()` 先在 `ppt/slides/` 选取下一个空闲编号（`next_free` 扫描 `slideN.xml`），然后按 source 类型生成部件：版式来源写入内置 `EMPTY_SLIDE` 模板并新建指向 `../slideLayouts/<source>` 的 `.rels`；幻灯片来源用 `shutil.copy2` 复制部件，若源 `.rels` 存在则一并复制。
  - 随后 `_register_content_type` 向 `[Content_Types].xml` 追加 Override，`_register_in_presentation` 同时改写 presentation.xml.rels 和 presentation.xml。新 `<p:sldId>` 条目插入在 `</p:sldIdLst>` 关闭标签之前（即列表内部末尾）；若列表不存在，则紧跟 `<p:sldMasterIdLst>` 之后新建整个列表。程序输出走 stdout、诊断走 stderr，两个 logger 均 `propagate=False`。
- Sources / 来源：[jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/add_slide.py:L98–L130](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/add_slide.py#L98-L130),
  - [jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/add_slide.py:L152–L163](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/add_slide.py#L152-L163)
- **设置面**
- 无配置文件或环境变量；调用面只有两个位置参数 `unpacked` 和 `source`（argparse 定义）。行为还依赖解包目录中的现有内容：幻灯片编号取自目录中已有的 `slideN.xml`（无则从 1 起），关系 id 取自 presentation.xml.rels 中已有 `Id="rIdN"` 的最大值加一，sldId 取自 presentation.xml 中已有值的最大值加一且下限 256。模块常量固定了幻灯片内容类型、slide 与 slideLayout 两种关系类型，以及空白幻灯片 XML 模板。
- Sources / 来源：[jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/add_slide.py:L167–L171](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/add_slide.py#L167-L171),
  - [jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/add_slide.py:L50–L56](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/add_slide.py#L50-L56),
  - [jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/add_slide.py:L143–L157](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/add_slide.py#L143-L157)
- **支持的行为**
- 工具支持两种添加方式：以 `slideN.xml` 为源时用 `shutil.copy2` 复制现有幻灯片部件，并在源 `.rels` 存在时一并复制；以 `slideLayoutN.xml` 为源时写入内置的 `EMPTY_SLIDE` 空 spTree 模板，并新建指向 `../slideLayouts/<source>` 的关系文件。版式或幻灯片源文件不存在时抛出 `AddSlideError`，错误信息中携带 root 拼接得到的路径；`main()` 将其转换为带信息的 `SystemExit`。
  - docstring 提示可用 `ls unpacked/ppt/slideLayouts/` 查看可用版式。
- Sources / 来源：[jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/add_slide.py:L2–L11](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/add_slide.py#L2-L11),
  - [jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/add_slide.py:L108–L125](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/add_slide.py#L108-L125)
- **实现取舍**
- Inference / 设计推断（非作者历史意图）：
- 注册环节采用纯文本改写而非 XML 解析：`_register_content_type` 和 `_register_in_presentation` 通过字符串 `replace` 在 `</Types>`、`</Relationships>`、`</p:sldIdLst>` 关闭标签前插入条目，`next_rel_id` 也只用正则匹配双引号形式的 `Id="rIdN"`。这是一种推断得出的简化取舍：实现短小、无外部依赖，但对 XML 的排版形式（如属性引号、关闭标签写法）有隐含假设，遇到不匹配的写法时插入会静默失败。
  - 另一取舍是复制幻灯片时不重写新部件内部的关系引用，复制 `.rels` 后新部件与源部件指向同一批目标（推断）。
- Sources / 来源：[jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/add_slide.py:L93–L95](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/add_slide.py#L93-L95),
  - [jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/add_slide.py:L133–L163](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/add_slide.py#L133-L163),
  - [jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/add_slide.py:L122–L125](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/add_slide.py#L122-L125)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/config-resources/feature-opc-add-slide.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/add_slide.py:L2-L11
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/add_slide.py:L129-L130
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/add_slide.py:L167-L182
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/add_slide.py:L127-L130
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/add_slide.py:L98-L130
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/add_slide.py:L152-L163
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/add_slide.py:L167-L171
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/add_slide.py:L50-L56
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/add_slide.py:L143-L157
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/add_slide.py:L108-L125
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/add_slide.py:L93-L95
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/add_slide.py:L133-L163
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/add_slide.py:L122-L125
- 源页字段（feature）：opc-add-slide
- 入口（entry_points）：jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/add_slide.py
- 源页字段（source_globs）：jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/add_slide.py
