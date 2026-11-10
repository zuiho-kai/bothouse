---
name: feature-depth-opc-add-slide
description: opc/add_slide.py 实现深读：layout 分支写入 EMPTY_SLIDE 并登记、CLI 位置参数与 emit 输出、仅标准库文本替换、AddSlideError 抛出条件、文本替换取舍（静默失败）、无配置项与编号规则、手工验收（未执行）
metadata:
  scope: 只收 add_slide.py 的流程、API、依赖、失败模式、取舍、配置六个方面的实现深读；功能概览归 feature-opc-add-slide
---
# 解包 PPTX 幻灯片添加工具（opc/add_slide.py）：实现深读

## 现状

- [[feature-opc-add-slide]]（功能概览） · [[config-resources-overview-1]]、[[config-resources-overview-2]]（owner 入口）
- **layout 分支：写入空幻灯片与 .rels 后登记 content type 并挂入 presentation.xml** source 以 slideLayout 开头且该 layout 文件存在时，写入 EMPTY_SLIDE 到 ppt/slides/slideN.xml、写 .rels 指向 ../slideLayouts/{source}，再调 _register_content_type 与 _register_in_presentation，返回两行摘要由 emit 输出到 stdout。
- 来源：[jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/add_slide.py:L104–L130](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/add_slide.py#L104-L130),
  - [jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/add_slide.py:L167–L173](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/add_slide.py#L167-L173)
- **CLI 契约：位置参数 unpacked 与 source；结果经 emit 写 stdout** 命令行需两个位置参数：unpacked 目录与 source（slideN.xml 复制或 slideLayoutN.xml 起新页）。add_slide 返回摘要字符串，emit 经 propagate=False 的 add_slide.out logger 以裸 %(message)s 格式写 stdout，诊断走 stderr 的另一 logger。main() 捕获 AddSlideError 转为 SystemExit；
  - main 返回值仅在 __main__ 下交给 sys.exit。
- 来源：[jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/add_slide.py:L167–L186](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/add_slide.py#L167-L186),
  - [jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/add_slide.py:L20–L48](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/add_slide.py#L20-L48)
- **仅用标准库、以纯文本替换修改解包 OPC 目录中的 XML** 仅导入 logging/argparse/re/shutil/sys/pathlib，无第三方依赖；对 [Content_Types].xml、presentation.xml.rels 和 presentation.xml 做 str.replace/re.sub 文本改写，若目标标记（如 </Types>、</Relationships>）不存在则替换不生效且不报错。
- 来源：[jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/add_slide.py:L13–L18](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/add_slide.py#L13-L18),
  - [jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/add_slide.py:L133–L163](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/add_slide.py#L133-L163)
- **AddSlideError：源布局或源幻灯片缺失时抛出，main 转为 SystemExit(消息)** source 以 slideLayout 开头且 layouts/source 不是文件时抛 AddSlideError("add_slide: no such layout: …")；否则 slides/source 不是文件时抛 "no such slide"。main() 捕获并 raise SystemExit(str(exc))，其余异常不在此处理。
- 来源：[jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/add_slide.py:L108–L122](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/add_slide.py#L108-L122),
  - [jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/add_slide.py:L177–L182](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/add_slide.py#L177-L182)
- **文本替换改包结构：零依赖、可独立运行的代价是对标记字面量敏感** 设计推断（非作者历史意图）：
- （推断）收益：只用标准库字符串替换即可同时改部件、.rels、[Content_Types].xml 和 presentation.xml 的 sldIdLst（注释称四处任错即被 PowerPoint 判为损坏）；成本：若目标文件缺少被替换的字面闭合/包裹标记（如无 '</p:sldIdLst>' 且无 sldMasterIdLst 块），replace/re.sub 静默不生效，登记缺失而脚本仍返回成功摘要。sldId 取 max(used,255)+1 且下限 256 以满足编号空间要求。
- 来源：[jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/add_slide.py:L133–L163](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/add_slide.py#L133-L163),
  - [jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/add_slide.py:L7–L9](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/add_slide.py#L7-L9)
- **仅两个位置参数、无自定义选项的 CLI，编号取自解包目录现状** _run() 用 argparse 只定义位置参数 unpacked 与 source；所示片段无配置文件或环境变量读取，也未禁用 argparse 默认帮助项。幻灯片号取目录中已有 slideN.xml 的最大值加一（无则 1），sldId 取已有值最大值加一且下限 256；source 以 slideLayout 开头时要求该 layout 文件存在，否则抛 AddSlideError。
- 来源：[jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/add_slide.py:L167–L171](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/add_slide.py#L167-L171),
  - [jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/add_slide.py:L84–L90](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/add_slide.py#L84-L90),
  - [jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/add_slide.py:L104–L112](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/add_slide.py#L104-L112),
  - [jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/add_slide.py:L154–L156](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/add_slide.py#L154-L156)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/config-resources/feature-depth-opc-add-slide.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/add_slide.py:L167-L186
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/add_slide.py:L20-L48
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/add_slide.py:L108-L122
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/add_slide.py:L177-L182
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/add_slide.py:L133-L163
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/add_slide.py:L7-L9
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/add_slide.py:L104-L130
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/add_slide.py:L167-L173
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/add_slide.py:L13-L18
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/add_slide.py:L167-L171
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/add_slide.py:L84-L90
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/add_slide.py:L104-L112
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/add_slide.py:L154-L156
- 源页字段（feature）：opc-add-slide
- 入口（entry_points）：jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/add_slide.py
- 源页字段（source_globs）：jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/add_slide.py
