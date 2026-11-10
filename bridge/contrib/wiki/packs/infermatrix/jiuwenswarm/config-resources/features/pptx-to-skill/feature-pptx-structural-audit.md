---
name: feature-pptx-structural-audit
description: PPTX 结构与可读性审计脚本 audit_pptx.py 及 qa_density.py、qa_geometry.py：验证入口、命令行与退出码、包级解析、检查项、页脚豁免取舍、字号阈值与 lock 优先级
metadata:
  scope: 只收三个审计脚本的功能概览（验证入口、CLI 与退出码、zipfile+XML 解析、检查项、取舍、配置默认值）；实现深读归 feature-depth-pptx-structural-audit
---
# PPTX 结构与可读性审计脚本（audit_pptx.py 及配套 QA 脚本）

## 现状

- **验证入口**
- 所提供的输入中没有针对这三个脚本的测试文件或测试调用；可观察到的验证方式是脚本自身的退出码契约（audit_pptx.py、qa_density.py、qa_geometry.py 均在有 error 时返回 1）和结构化 JSON 报告（--report / --json），供流水线消费。qa_geometry.py 支持 --slide 单页复查，qa_density.py 的文档字符串展示了带 --lock 的流水线用法示例。
- Sources / 来源：[jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/audit_pptx.py:L511–L534](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/audit_pptx.py#L511-L534),
  - [jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/qa_density.py:L9–L18](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/qa_density.py#L9-L18),
  - [jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/qa_geometry.py:L459–L482](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/qa_geometry.py#L459-L482)
- **命令行入口、退出码与输出通道**
- 三个脚本均以 main() 作为 CLI 入口：audit_pptx.py 接受位置参数 pptx 及 --template/--lock/--evidence-plan/--report 与三个字号阈值选项。退出码契约是"有 error 返回 1，否则 0"（audit_pptx.py L534、qa_density.py L111、qa_geometry.py L470/L482）。报告正文（含 --json 载荷）经独立 stdout logger 输出、诊断走 stderr；
  - audit_pptx.py 的 --report 则把完整 JSON 报告写入指定文件（先建父目录），不经过 stdout。
- Sources / 来源：[jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/audit_pptx.py:L494–L534](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/audit_pptx.py#L494-L534),
  - [jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/qa_density.py:L67–L111](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/qa_density.py#L67-L111),
  - [jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/qa_geometry.py:L459–L482](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/qa_geometry.py#L459-L482)
- **独立于生成代码的包级解析流水线**
- 三个脚本都直接用 zipfile + XML 解析打开 .pptx 包，不依赖生成代码，对任意 pptx 可运行：audit_pptx.py 用 ElementTree 读 presentation.xml 确定画布与幻灯片顺序，再逐页检查；qa_geometry.py 自述为补上人眼 contact sheet 看不见的 0.1 英寸级问题。分工上 audit_pptx.py 管包结构、模板继承计数、字号与锁契约，qa_density.py 管每页文字量，qa_geometry.py 管重叠/遮挡/越界/轴线。
  - 注意 qa_geometry.py 虽为 layout/master 继承元素设 z=-1000，但这些元素只喂给 check_duplicate_chrome，参与文字碰撞与遮挡检查的仍只是页面自身元素。
- Sources / 来源：[jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/audit_pptx.py:L303–L313](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/audit_pptx.py#L303-L313),
  - [jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/qa_geometry.py:L1–L13](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/qa_geometry.py#L1-L13),
  - [jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/qa_geometry.py:L229–L253](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/qa_geometry.py#L229-L253),
  - [jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/qa_geometry.py:L442–L452](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/qa_geometry.py#L442-L452)
- **检查项与跨脚本协作**
- audit_pptx.py 检查必需包部件缺失、幻灯片关系指向的部件存在性；与 --template 对比时画布需精确相等，但 master/layout 数量只要求不少于模板（>=，非相等）。--evidence-plan 启用论文配图溯源：按图片字节 sha256 匹配（对 merge_slides.py 的重命名免疫），命中配图而页面文本无"来源/Source:"式来源注记则报 error。
  - qa_geometry.py 的 check_duplicate_chrome 消费 layout/master 继承元素，抓"页面自绘页脚 + 母版继承页脚"叠加的重复 chrome，与 audit_pptx.py 中 footer_mode=master 的文本级检查互补。
- Sources / 来源：[jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/audit_pptx.py:L303–L336](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/audit_pptx.py#L303-L336),
  - [jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/audit_pptx.py:L344–L381](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/audit_pptx.py#L344-L381),
  - [jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/qa_geometry.py:L229–L279](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/qa_geometry.py#L229-L279)
- **页脚豁免与显式字号检查的取舍**
- body-min 字号警告有意排除页脚区（画布高度 90% 以下的形状不计入 body_font_sizes），因为页脚 chrome 本就约 7pt、官方母版页脚为 9.74pt，计入会对每页每份 deck 都告警，反而让人忽略警告列；代价是该警告不覆盖页脚内容的可读性。另一个限制是字号检查只收集幻灯片 XML 中带显式 sz 属性的 rPr/defRPr/endParaRPr 值，不解析从母版/版式继承的字号，因此绝对下限仅对页面上显式声明的字号生效。
  - qa_density.py 的密度下限则是写死的常量（FLOOR_HARD=300、FLOOR_WARN=400），按真实内部 deck 校准（内容页 400-700 可视字符，中位约 480），不暴露为 CLI 选项。
- Sources / 来源：[jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/audit_pptx.py:L221–L246](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/audit_pptx.py#L221-L246),
  - [jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/audit_pptx.py:L133–L143](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/audit_pptx.py#L133-L143),
  - [jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/qa_density.py:L1–L30](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/qa_density.py#L1-L30)
- **CLI 字号阈值默认值与执行锁的优先级**
- audit_pptx.py 的三个字号阈值均为 CLI 选项而非配置文件：--title-min-font 默认 24、--body-min-font 默认 10、--absolute-min-font 默认 7（type=float）。当传入 --lock 且某页在锁中映射为 standard-content 角色时，标题下限改用锁内 deck.typography_policy.title_min_pt（缺省回退到 CLI 值），总结条颜色用锁内 brand.summary_banner.fill（回退 4472C4）；
  - 该标题检查只作用于这些锁映射的 standard-content 页，TOC 角色页另有独立的 TOC_MIN_TIER_PT=12 常量下限（乘 compat_scale 换算）。
- Sources / 来源：[jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/audit_pptx.py:L494–L509](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/audit_pptx.py#L494-L509),
  - [jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/audit_pptx.py:L415–L426](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/audit_pptx.py#L415-L426),
  - [jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/audit_pptx.py:L450–L467](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/audit_pptx.py#L450-L467)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/config-resources/feature-pptx-structural-audit.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-07
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/audit_pptx.py:L511-L534
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/qa_density.py:L9-L18
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/qa_geometry.py:L459-L482
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/audit_pptx.py:L494-L534
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/qa_density.py:L67-L111
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/audit_pptx.py:L303-L313
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/qa_geometry.py:L1-L13
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/qa_geometry.py:L229-L253
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/qa_geometry.py:L442-L452
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/audit_pptx.py:L303-L336
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/audit_pptx.py:L344-L381
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/qa_geometry.py:L229-L279
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/audit_pptx.py:L221-L246
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/audit_pptx.py:L133-L143
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/qa_density.py:L1-L30
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/audit_pptx.py:L494-L509
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/audit_pptx.py:L415-L426
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/audit_pptx.py:L450-L467
- 源页字段（feature）：pptx-structural-audit
- 入口（entry_points）：jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/audit_pptx.py
- 源页字段（source_globs）：jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/audit_pptx.py；jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/qa_density.py；jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/qa_geometry.py
