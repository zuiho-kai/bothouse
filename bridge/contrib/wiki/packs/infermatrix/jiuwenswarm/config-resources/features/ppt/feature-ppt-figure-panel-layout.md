---
name: feature-ppt-figure-panel-layout
description: figure-panel.js 图表面板布局引擎功能概览：导出接口、纯几何与渲染的职责和数据流、WIDE_AR/LABEL_H/GAP 常量与标签样式、同步几何与手工 PNG 解析的代价、分行与缩放行为、pngSize 运行时守卫
metadata:
  scope: 只收 figure-panel.js 的 API、架构、配置、取舍、特性与验证六个方面；逐方面的实现深读归 feature-depth-ppt-figure-panel-layout
---
# PPT 图表面板布局引擎（figure-panel.js）

## 现状

- **公开接口**
- 模块导出 `pngSize(filePath)`、`layoutFigures(figs, w, h)`、`renderFigurePanel({ slide, figures, bounds })` 以及常量 `WIDE_AR`、`LABEL_H`、`GAP`（第 104 行）。核心入口 `renderFigurePanel` 接收 pptxgenjs 的 slide、figures 数组（含 path 与可选 label）和 bounds 区域，返回 `{ rects, rows, scale, totalH }`。
  - `pngSize` 对非 PNG 或缺少 IHDR 的文件抛出带路径的 Error（第 34-35 行）。
- Sources / 来源：[jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/figure-panel.js:L82–L104](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/figure-panel.js#L82-L104),
  - [jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/figure-panel.js:L34–L37](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/figure-panel.js#L34-L37)
- **职责与数据流**
- 文件刻意保持纯几何引擎 + 渲染函数的结构，与 system-diagram.js 的拆分方式对应：components.js 只保留薄封装 addFigurePanel（第 2-4 行注释，属文档声明）。数据流：renderFigurePanel 先用 pngSize 同步读取 PNG IHDR 头得到宽高并算出宽高比（第 83-86 行），再由 layoutFigures 在 w×h 区域内计算行分组与矩形坐标，最后逐个 addImage/addText 写入 slide。同步是硬约束：slides.js 顺序调用组件，无法使用异步的 sharp（第 6-7 行注释）。
- Sources / 来源：[jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/figure-panel.js:L1–L8](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/figure-panel.js#L1-L8),
  - [jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/figure-panel.js:L82–L92](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/figure-panel.js#L82-L92)
- **布局常量与标签样式设置**
- 布局由三个模块内常量控制：`WIDE_AR = 2.5`（宽高比达到该值的图独占一行）、`LABEL_H = 0.22` 英寸（每行下方中文标签保留高度）、`GAP = 0.12` 英寸（行间及并排图之间距）。L11–L12 注释要求 WIDE_AR 必须介于 1.48（Alita GAIA 表格）与 2.96（Alita 架构图）之间，是依据真实论文校准的区间。标签字体 `Microsoft YaHei` 与颜色 `595757` 从 components.js 镜像复制（仅这两项，注释 L17–L21 说明是为避免循环依赖）；
  - 渲染时字号固定 10、居中、fit 为 shrink（L94–L98）。常量随模块一并导出（L104）。
- Sources / 来源：[jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/figure-panel.js:L10–L21](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/figure-panel.js#L10-L21),
  - [jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/figure-panel.js:L93–L98](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/figure-panel.js#L93-L98)
- **同步几何与手工 PNG 解析的代价**
- L6–L7 注释明确说明：slides.js 顺序调用组件，因此本文件刻意全部同步，无法使用异步的 sharp 读图。由此 `pngSize` 只能用同步 fs 手工解析 PNG IHDR 头（读取前 24 字节，L26–L36），这把输入限制为 PNG 一种格式，非 PNG 或缺 IHDR 直接抛错。另一取舍是标签与间距保持绝对尺寸、仅图片缩放（L39–L41），保证排版再紧标签也可读，代价是极小区域中图片占比被进一步压缩。`LABEL_FONT`/`LABEL_COLOR` 复制而非导入，注释归因于 components.js 反向依赖本模块会形成循环（L17–L19）。
- Sources / 来源：[jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/figure-panel.js:L1–L8](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/figure-panel.js#L1-L8),
  - [jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/figure-panel.js:L23–L41](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/figure-panel.js#L23-L41)
- **支持的布局行为**
- 引擎按宽高比分行：ar ≥ WIDE_AR(2.5) 的宽图独占一行，较方的图与相邻的方图两两并排（L44–L48）。行内按可用高度统一缩放（scale ≤ 1，仅缩图片，标签与间距保持绝对尺寸），整块内容在 bounds 内垂直居中，行内图片在行高中垂直居中（L55–L57、L88、L68）。渲染时每张图通过 slide.addImage 原样贴入（无边框无填充），若 figure 带 label 则在其下方绘制居中、fit:shrink 的中文说明文字（L90–L98）。
- Sources / 来源：[jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/figure-panel.js:L42–L57](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/figure-panel.js#L42-L57),
  - [jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/figure-panel.js:L82–L98](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/figure-panel.js#L82-L98)
- **验证入口：运行时守卫（非测试）**
- 所示文件不含任何测试入口点或断言辅助函数，唯一的验证机制是 `pngSize` 内的运行时守卫（runtime guard，属于检查而非测试执行）：读取文件前 24 字节后，先校验 PNG 签名（`0x89504e47`），再校验第 12–16 字节为 `IHDR`，任一不满足即抛出包含文件路径的 Error（如 `not a PNG: <path>`）。这两个守卫在 `renderFigurePanel` 读取每张图尺寸时被调用，是渲染路径上实际执行的输入校验。
- Sources / 来源：[jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/figure-panel.js:L26–L37](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/figure-panel.js#L26-L37),
  - [jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/figure-panel.js:L82–L87](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/figure-panel.js#L82-L87)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/config-resources/feature-ppt-figure-panel-layout.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-07
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/figure-panel.js:L82-L104
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/figure-panel.js:L34-L37
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/figure-panel.js:L1-L8
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/figure-panel.js:L82-L92
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/figure-panel.js:L10-L21
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/figure-panel.js:L93-L98
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/figure-panel.js:L23-L41
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/figure-panel.js:L42-L57
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/figure-panel.js:L82-L98
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/figure-panel.js:L26-L37
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/figure-panel.js:L82-L87
- 源页字段（feature）：ppt-figure-panel-layout
- 入口（entry_points）：jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/figure-panel.js
- 源页字段（source_globs）：jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/figure-panel.js
