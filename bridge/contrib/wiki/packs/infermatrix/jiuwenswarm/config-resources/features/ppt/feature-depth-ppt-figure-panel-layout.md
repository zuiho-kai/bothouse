---
name: feature-depth-ppt-figure-panel-layout
description: figure-panel.js 实现深读：renderFigurePanel 的读尺寸、分行缩放与贴图、layoutFigures 返回结构、非 PNG 或缺 IHDR 时同步 throw、全同步取舍与常量复制漂移、WIDE_AR 等常量、Node fs 依赖
metadata:
  scope: 只收 figure-panel.js 的流程、API、失败模式、取舍、配置与依赖的实现深读；功能概览归 feature-ppt-figure-panel-layout
---
# PPT 图表面板布局引擎（figure-panel.js）：实现深读

## 现状

- [[feature-ppt-figure-panel-layout]]（功能概览） · [[config-resources-overview-1]]、[[config-resources-overview-2]]（owner 入口）
- **renderFigurePanel：读尺寸→layoutFigures 分行缩放→逐图贴图并按需加标签** renderFigurePanel 对每个 figure 调 pngSize 得宽高比，layoutFigures 在 bounds.w×h 内分行并整体缩放，随后内容不足时垂直居中（oy），逐 rect 调 slide.addImage，仅当 f.label 存在才 slide.addText 居中中文标签，返回 layoutFigures 的结果。
- 来源：[jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/figure-panel.js:L82–L101](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/figure-panel.js#L82-L101)
- **layoutFigures(figs, w, h) 纯几何返回 {rects, rows, scale, totalH}；renderFigurePanel({slide, figures, bounds})** figs 需带 ar 字段；返回 rects（含 i,x,y,w,h,labelY，相对区域左上角）、行数 rows、scale=min(1, 可用高/自然高和)、累计 totalH。renderFigurePanel 只接 slide（无 pres 参数），figures 元素需 path 与可选 label，bounds 需 x,y,w,h，返回布局结果。
- 来源：[jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/figure-panel.js:L42–L75](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/figure-panel.js#L42-L75),
  - [jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/figure-panel.js:L82–L88](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/figure-panel.js#L82-L88)
- **非 PNG 或缺 IHDR 时同步 throw；文件描述符由 finally 保证关闭** pngSize 先 openSync 再 try/finally closeSync；签名不是 0x89504e47 抛 `not a PNG: <path>`，offset 12–16 非 "IHDR" 抛 `not a PNG: missing IHDR: <path>`。异常沿 renderFigurePanel 同步上抛，无捕获分支。仅校验 24 字节头部，不证明完整 PNG 有效性。
- 来源：[jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/figure-panel.js:L26–L37](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/figure-panel.js#L26-L37),
  - [jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/figure-panel.js:L83–L87](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/figure-panel.js#L83-L87)
- **全同步几何引擎换取可顺序调用；常量复制带来漂移风险（推断）** 设计推断（非作者历史意图）：
- 收益：全部同步使 slides.js 能按顺序调用组件、无需异步图片解码（注释明确此意图）。成本（推断）：LABEL_FONT/LABEL_COLOR 复制自 components.js 而非共享来源，两处可能不同步漂移；且 pngSize 只认 IHDR 在固定偏移的 PNG，其他图片格式直接抛错。
- 来源：[jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/figure-panel.js:L1–L7](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/figure-panel.js#L1-L7),
  - [jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/figure-panel.js:L17–L21](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/figure-panel.js#L17-L21),
  - [jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/figure-panel.js:L34–L35](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/figure-panel.js#L34-L35)
- **模块内固定布局常量 WIDE_AR/LABEL_H/GAP 及镜像的标签样式** 布局由三个模块内常量控制：WIDE_AR = 2.5（宽高比达到该值的图独占一行，注释要求介于 1.48 与 2.96 之间）、LABEL_H = 0.22 英寸（每行下方中文标签保留高度）、GAP = 0.12 英寸（行间与并排图间距）。标签字体 Microsoft YaHei 与颜色 595757 从 components.js 镜像复制以避免循环依赖。这些常量随 module.exports 一并导出。
- 来源：[jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/figure-panel.js:L10–L21](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/figure-panel.js#L10-L21),
  - [jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/figure-panel.js:L104–L104](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/figure-panel.js#L104-L104)
- **依赖 Node fs 同步读取 PNG 头；标签样式常量从 components.js 镜像复制** pngSize 用 fs.openSync/readSync/closeSync 同步读取文件前 24 字节，从 IHDR 解析宽高；LABEL_FONT/LABEL_COLOR 因 components.js 反向 require 本模块而复制而非导入。
- 来源：[jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/figure-panel.js:L8–L8](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/figure-panel.js#L8-L8),
  - [jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/figure-panel.js:L17–L21](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/figure-panel.js#L17-L21),
  - [jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/figure-panel.js:L26–L36](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/figure-panel.js#L26-L36)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/config-resources/feature-depth-ppt-figure-panel-layout.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/figure-panel.js:L1-L7
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/figure-panel.js:L17-L21
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/figure-panel.js:L34-L35
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/figure-panel.js:L82-L101
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/figure-panel.js:L42-L75
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/figure-panel.js:L82-L88
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/figure-panel.js:L26-L37
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/figure-panel.js:L83-L87
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/figure-panel.js:L8-L8
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/figure-panel.js:L26-L36
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/figure-panel.js:L10-L21
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/figure-panel.js:L104-L104
- 源页字段（feature）：ppt-figure-panel-layout
- 入口（entry_points）：jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/figure-panel.js
- 源页字段（source_globs）：jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/figure-panel.js
