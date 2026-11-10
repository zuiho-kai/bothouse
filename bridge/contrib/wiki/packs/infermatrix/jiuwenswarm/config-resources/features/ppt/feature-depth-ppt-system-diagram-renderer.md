---
name: feature-depth-ppt-system-diagram-renderer
description: addSystemDiagram 实现深读：components.js 中按区域宽度选 density 并调用 renderSystemDiagram、默认区域 (0.5, 1.05, 9.0, 3.6) 与返回描述符、density 的 full/split/compact 阈值、components.js 与 diagrams.js 的 require 关系、拒绝 left_to_right 的 fail-loud 取舍
metadata:
  scope: 只收 addSystemDiagram 包装、density 选择、模块依赖与 left_to_right 取舍；system-diagram.js 引擎本体归 feature-ppt-system-diagram-renderer
---
# PPT 系统架构图原生形状渲染引擎：实现深读

## 现状

- [[feature-ppt-system-diagram-renderer]]（功能概览） · [[config-resources-overview-1]]、[[config-resources-overview-2]]（owner 入口）
- **addSystemDiagram 按区域宽度选 density 后调用 renderSystemDiagram 画原生形状** components.js 的 addSystemDiagram(pres, slide, {spec, x=0.5, y=1.05, w=9.0, h=3.6, density, heading}) 先校验 slide 并警告区域重叠；可选 heading 先画标题并从 h 中扣减标题高度；
  - density 缺省时按宽度选 full(w>=8)/split(w>=4)/compact，把对应 fontMin/fontMax 合入 DEFAULT_THEME 后调用 system-diagram.js 的 renderSystemDiagram，返回布局描述符 {bounds, nodes, groups, edgeLabels, warnings}。
- 来源：[jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/components.js:L1728–L1737](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/components.js#L1728-L1737),
  - [jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/system-diagram.js:L1–L10](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/system-diagram.js#L1-L10)
- **addSystemDiagram 契约：区域默认 (0.5, 1.05, 9.0, 3.6)，返回布局描述符** 签名 addSystemDiagram(pres, slide, { spec, x=0.5, y=1.05, w=9.0, h=3.6, density, heading })；调用方传入 Diagram IR spec，density 缺省按宽度自动选择，返回引擎布局描述符 { bounds, nodes, groups, edgeLabels, warnings } 供 QA 与 diagram-verifier 不重解析 PPTX 即可检查几何。
- 来源：[jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/components.js:L1722–L1737](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/components.js#L1722-L1737),
  - [jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/system-diagram.js:L797–L802](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/system-diagram.js#L797-L802)
- **density 省略时按区域宽度自动选择：w>=8 为 full，w>=4 为 split，否则 compact** 默认区域 w=9.0 落入 full（fontMin 7 / fontMax 13）；split 限 6.5–11，compact 限 6–9.5；显式传入未知 density 时回退 DIAGRAM_DENSITY.full。字体制数覆盖 DEFAULT_THEME 同名字段。
- 来源：[jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/components.js:L1733–L1736](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/components.js#L1733-L1736),
  - [jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/components.js:L17–L21](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/components.js#L17-L21)
- **components.js 同级 require system-diagram.js，diagrams.js 从 components.js 转口 API** components.js 通过 require(path.join(__dirname, "system-diagram.js")) 取得渲染引擎并（经 addSystemDiagram 与构造器）供外部使用；
  - components/diagrams.js 仅 require ../scripts/components.js 并转口 addSystemDiagram、addPipelineDiagram 等及 item/group/bandNode/groupBand，不导出 renderSystemDiagram 或 DEFAULT_THEME。
- 来源：[jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/components.js:L10–L13](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/components.js#L10-L13),
  - [jiuwenswarm/resources/agent/workspace/skills/ppt-creation/components/diagrams.js:L4–L17](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/components/diagrams.js#L4-L17)
- **fail loud 拒绝 left_to_right：换取可测量性，代价是既有调用方必须改写** 实现注释（L145–L150）解释 left_to_right 被移除是因该路径不测量内容、top_to_bottom 装不下时报 OVER-CAPACITY 会把作者推向宽松路径，故选择 fail loud 并在错误中指引改用 addPipelineDiagram；代价是使用该 orientation 的调用方直接得到异常、需删字段或换 API。此取舍叙述来自源码注释，属实现的既述理由。
- 来源：[jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/system-diagram.js:L145–L158](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/system-diagram.js#L145-L158)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/config-resources/feature-depth-ppt-system-diagram-renderer.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/components.js:L1733-L1736
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/components.js:L17-L21
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/components.js:L1722-L1737
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/system-diagram.js:L797-L802
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/components.js:L10-L13
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/components/diagrams.js:L4-L17
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/system-diagram.js:L145-L158
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/components.js:L1728-L1737
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/system-diagram.js:L1-L10
- 源页字段（feature）：ppt-system-diagram-renderer
- 入口（entry_points）：jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/system-diagram.js
- 源页字段（source_globs）：jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/system-diagram.js；jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/components.js
