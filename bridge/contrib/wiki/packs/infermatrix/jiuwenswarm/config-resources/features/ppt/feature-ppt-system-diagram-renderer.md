---
name: feature-ppt-system-diagram-renderer
description: system-diagram.js 系统架构图原生形状渲染引擎功能概览：导出与 renderSystemDiagram 调用契约、normalizeSpec 校验与重叠检测、网格重排与 visual_role 样式、可读性下限与 DIAGRAM-OVER-CAPACITY、left_to_right 被拒绝
metadata:
  scope: 收 system-diagram.js 的 API、验证、特性与取舍，来源另含 components.js；逐方面的实现深读归 feature-depth-ppt-system-diagram-renderer
---
# PPT 系统架构图原生形状渲染引擎（system-diagram.js）

## 现状

- **公共入口与调用契约**
- CommonJS 模块导出 renderSystemDiagram、normalizeSpec、DEFAULT_THEME 及四个 IR 构造器 item/group/bandNode/groupBand。主入口 renderSystemDiagram({ pres, slide, spec, bounds, theme }) 接收 pptxgenjs 的 presentation 与 slide、声明式 Diagram IR、目标区域和主题；缺 pres 或 slide 时抛错。
  - 渲染到既有 slide 上的一个区域（不画标题等页面装饰，宿主页自管），并返回布局描述符 { bounds, nodes, groups, edgeLabels, warnings } 供 QA 与 diagram-verifier 免解析 PPTX 检查几何。上层封装 components.js 的 addSystemDiagram 计算密度主题后转发调用。
- Sources / 来源：[jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/system-diagram.js:L797–L812](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/system-diagram.js#L797-L812),
  - [jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/system-diagram.js:L840–L873](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/system-diagram.js#L840-L873),
  - [jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/components.js:L1729–L1737](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/components.js#L1729-L1737)
- **验证：IR 校验、重叠检测与语义损失提示**
- normalizeSpec 做结构校验（band 数 2–8、叶子上限 36、重复 id、悬空边、空 group 等抛错），并对截断后的 node/item label 运行 mergeSuspect：省略检测要求剥掉尾部的「等/…/…」后仍有非空前缀，斜杠合并检测要求首尾段都含字母或数字，命中则 console.warn（不阻断渲染）。渲染后 renderSystemDiagram 对所有已定位节点两两做 rectsOverlap 检查——该函数在比较式中使用 0.02 的容差而非将矩形四边内缩——重叠者写入返回值 warnings 供 QA 与 diagram-verifier 消费。
- Sources / 来源：[jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/system-diagram.js:L130–L143](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/system-diagram.js#L130-L143),
  - [jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/system-diagram.js:L210–L224](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/system-diagram.js#L210-L224),
  - [jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/system-diagram.js:L791–L840](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/system-diagram.js#L791-L840)
- **网格重排与视觉角色样式**
- band 内的 groups 通过 gridShape 重排（组数 ≤4 时首选 4 列、否则 3 列）；nodes 不经 gridShape，而是按 band.layout 直接定列数（column 为 1、row 为全宽、缺省最多 5 列）。group 内 items 由 itemGridShape 排布：4 项及以上自动 2 列。视觉外观由 styleForVisualRole 按 visual_role（primary/factor_group/warning/action 等）映射到主题色、虚线与填充透明度。
- Sources / 来源：[jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/system-diagram.js:L330–L331](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/system-diagram.js#L330-L331),
  - [jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/system-diagram.js:L480–L482](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/system-diagram.js#L480-L482),
  - [jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/system-diagram.js:L543–L549](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/system-diagram.js#L543-L549),
  - [jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/system-diagram.js:L245–L267](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/system-diagram.js#L245-L267)
- **可读性下限与 fail-loud 容量检查**
- 引擎宁可拒绝渲染也不压扁内容：computeBandRects 检查各 band 最小高度之和加上 gapFloor 间隔（最小 gap）是否超过 bounds.h + 0.01，超出则抛 [DIAGRAM-OVER-CAPACITY]，附最占高 band 明细和有序整改建议（扩区、换骨架、拆页），并禁止缩字或删条目。ITEM_H_FLOOR/NODE_H_FLOOR 下限由测量与渲染两阶段共享，保证两阶段对盒子最小尺寸的判断一致。
  - orientation "left_to_right" 被显式移除并抛错，注释指出该路径不测内容、稀疏内容必然留下大片空白且无警告，故 fail loud 而非静默降级。
- Sources / 来源：[jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/system-diagram.js:L428–L447](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/system-diagram.js#L428-L447),
  - [jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/system-diagram.js:L46–L53](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/system-diagram.js#L46-L53),
  - [jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/system-diagram.js:L143–L158](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/system-diagram.js#L143-L158)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/config-resources/feature-ppt-system-diagram-renderer.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/system-diagram.js:L797-L812
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/system-diagram.js:L840-L873
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/components.js:L1729-L1737
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/system-diagram.js:L130-L143
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/system-diagram.js:L210-L224
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/system-diagram.js:L791-L840
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/system-diagram.js:L330-L331
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/system-diagram.js:L480-L482
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/system-diagram.js:L543-L549
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/system-diagram.js:L245-L267
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/system-diagram.js:L428-L447
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/system-diagram.js:L46-L53
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/system-diagram.js:L143-L158
- 源页字段（feature）：ppt-system-diagram-renderer
- 入口（entry_points）：jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/system-diagram.js
- 源页字段（source_globs）：jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/system-diagram.js；jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/components.js
