---
name: feature-ppt-deck-finalize
description: ppt-creation 的 finalize_deck.py 功能概览：命令行入口与 FinalizeError 输出契约、--template/--order/--template-layout/--source-layout-mode 默认值、支持行为（坐标缩放、图表改名复制、fill_cover）、unpack→merge→fill_cover→prune→pack 编排、模板继承取舍、打包后母版与封面标题门禁
metadata:
  scope: 收 finalize_deck.py 的 API、配置、特性、架构、取舍与验证六个方面，来源另含 fill_cover.py、make_blank_template.py、merge_slides.py；逐方面的实现深读归 feature-depth-ppt-deck-finalize
---
# 一键成片流水线与质量门禁（finalize_deck.py）

## 现状

- **命令行入口与输出契约**
- `finalize_deck.py content.pptx out.pptx` 是公开入口：接收生成的 PptxGenJS 内容 PPTX 与输出路径，可选 `--template`、`--order`、`--cover-title`、`--cover-meta`、`--keep-workdir` 等参数。程序输出走 stdout、诊断走 stderr，两条流都经 logging 以纯 `%(message)s` 格式输出，便于下游解析。致命错误由 `FinalizeError` 表达，仅在 `main()` 入口转为带错误信息的 `SystemExit`，保持辅助函数可作库使用；
  - 成功时最终打印 `finalize_deck: OK`。
- Sources / 来源：[jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/finalize_deck.py:L100–L115](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/finalize_deck.py#L100-L115),
  - [jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/finalize_deck.py:L192–L197](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/finalize_deck.py#L192-L197)
- **实际参数与默认值**
- 主要设置：`--template` 默认 `references/template.pptx`（相对技能根）；`--order` 默认 `"t1,s*,t5"`（模板封面 + 全部内容页 + 模板结尾），`s*` 在运行时展开为 s1..sN；`--template-layout` 默认 `slideLayout7.xml`（注意 merge_slides.py 自身的同名默认是 `slideLayout6.xml`，仅当通过 finalize_deck 调用时才是 7）；
  - `--source-layout-mode` 取 `template`/`source`，默认 `template`。另有一致性约束：任务产物（content 与 out）不得位于技能目录内，否则直接报错。
- Sources / 来源：[jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/finalize_deck.py:L104–L115](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/finalize_deck.py#L104-L115),
  - [jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/finalize_deck.py:L123–L130](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/finalize_deck.py#L123-L130),
  - [jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/merge_slides.py:L439–L449](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/merge_slides.py#L439-L449)
- **支持行为与协作组件**
- 端到端支持：模板封面/结尾混排、跨画布坐标缩放（`scale_slide_xml` 调整 off/ext/chOff/字号/线宽）、图表与内嵌工作簿改名复制（规避 pptxgenjs 与模板同号 chart1.xml 冲突）、pptxgenjs 图表 XML 的 schema 修正（dPt/dLbls 顺序、悬空 axId）。封面填充由 `fill_cover.py` 完成：替换 ctrTitle 段落 runs、向 idx=1 占位符的 部门/汇报人/日期 标签后追加值。
  - 模板由 `make_blank_template.py` 生成，t1–t5 五页结构（封面/目录/两张空白/结尾），封面标题刻意留空并带 `<a:pPr>`，供 fill_cover 写入。
- Sources / 来源：[jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/merge_slides.py:L85–L122](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/merge_slides.py#L85-L122),
  - [jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/merge_slides.py:L168–L212](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/merge_slides.py#L168-L212),
  - [jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/fill_cover.py:L145–L181](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/fill_cover.py#L145-L181),
  - [jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/make_blank_template.py:L11–L29](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/make_blank_template.py#L11-L29)
- **Orchestrated pipeline over unpacked OOXML intermediates**
- finalize_deck.py is a process-level orchestrator: it unpacks the template and the generated content PPTX into a throwaway temp dir via subprocess calls to opc/unpack.py, expands the --order tokens (s* becomes s1..sN based on counted source slides), then runs merge_slides.py,
  - optionally fill_cover.py, opc/prune.py and opc/pack.py, repacking into the final PPTX. Each child step runs via run(), which re-raises any non-zero exit as FinalizeError pointing at --keep-workdir for debugging; workdir is removed in a finally block unless kept.
  - After packing, control returns to finalize_deck itself for post-hoc quality gates computed by reading the output zip (digest, cover_title_filled).
- Sources / 来源：[jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/finalize_deck.py:L132–L163](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/finalize_deck.py#L132-L163),
  - [jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/finalize_deck.py:L60–L66](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/finalize_deck.py#L60-L66),
  - [jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/finalize_deck.py:L165–L188](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/finalize_deck.py#L165-L188)
- **模板继承换统一版式，门禁以“打包后校验”兜底**
- 默认 `--source-layout-mode template` 将生成内容页重链到模板版式，收益是继承模板的母版/版式结构、代价是放弃 PptxGenJS 自带的设计部件（merge_slides.py 文档说明 `source` 模式仅留给刻意携带自有 layouts/masters/themes 的旧deck）。为兜住合并可能悄悄丢结构的风险，finalize_deck 在打包后做硬门禁：母版/版式数量少于模板基线（仅在 template 模式下检查，基线从模板自身读出而非硬编码）即抛 FinalizeError；
  - 封面标题门禁则无条件执行，因为模板 ctrTitle 出厂为空、漏填的封面看起来完工实则无题。
- Sources / 来源：[jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/finalize_deck.py:L165–L188](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/finalize_deck.py#L165-L188),
  - [jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/merge_slides.py:L439–L449](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/merge_slides.py#L439-L449)
- **打包后运行时质量门禁（非自动化测试）**
- 所示的 finalize_deck.py 没有测试入口；其可验证性体现为每次运行时在打包后执行的硬门禁（runtime guard，非测试执行）。其一为母版继承检查：用 digest() 比较 [输出] 与模板的母版/版式数量，仅当 --source-layout-mode 为 template 且输出的母版数或版式数少于模板基线时抛 FinalizeError——不比较幻灯片张数，基线从所 supplied 模板读出而非硬编码。其二为封面标题检查：cover_title_filled() 遍历幻灯片，对首个含 type="ctrTitle" 的形状提取 <a:t> 文本并要求非空；
  - 若整副牌没有 ctrTitle 占位符（如 --order 不含 t1）则直接返回 True 放行。失败经 main() 转为带信息的 SystemExit 退出。
- Sources / 来源：[jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/finalize_deck.py:L165–L188](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/finalize_deck.py#L165-L188),
  - [jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/finalize_deck.py:L88–L97](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/finalize_deck.py#L88-L97),
  - [jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/finalize_deck.py:L192–L197](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/finalize_deck.py#L192-L197)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/config-resources/feature-ppt-deck-finalize.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-07
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/finalize_deck.py:L100-L115
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/finalize_deck.py:L192-L197
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/finalize_deck.py:L104-L115
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/finalize_deck.py:L123-L130
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/merge_slides.py:L439-L449
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/merge_slides.py:L85-L122
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/merge_slides.py:L168-L212
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/fill_cover.py:L145-L181
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/make_blank_template.py:L11-L29
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/finalize_deck.py:L132-L163
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/finalize_deck.py:L60-L66
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/finalize_deck.py:L165-L188
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/finalize_deck.py:L88-L97
- 源页字段（feature）：ppt-deck-finalize
- 入口（entry_points）：jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/finalize_deck.py
- 源页字段（source_globs）：jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/finalize_deck.py；jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/make_blank_template.py；jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/fill_cover.py
  - jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/prune.py；jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/merge_slides.py
