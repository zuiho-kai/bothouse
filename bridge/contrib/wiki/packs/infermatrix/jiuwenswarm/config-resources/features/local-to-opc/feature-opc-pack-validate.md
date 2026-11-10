---
name: feature-opc-pack-validate
description: ppt-creation 的 opc/pack.py 功能概览：pack() 入口与 PackError 契约、修复→校验→写 ZIP 三段流水线、pack 参数与 --no-repair/--no-validate/--original 开关、五条修复规则与校验范围、baseline 容忍与正则修复取舍、validate.py 独立入口
metadata:
  scope: 只收 pack.py 及其调用的 repair/validate 的概览；逐方面的实现深读归 feature-depth-opc-pack-validate
---
# OOXML 打包与 schema 校验（opc/pack.py）

## 现状

- **pack 的入口、输入输出与错误契约**
- 公共入口是 `pack(unpacked, output, do_repair=True, do_validate=True, original=None)`：接受解包目录与输出路径（后缀必须是 .pptx/.docx/.xlsx 之一），按修复→校验→写 ZIP 的顺序执行；校验失败时抛出 `PackError`（RuntimeError 子类），拒绝写出文件，`main()` 再把它转成干净的 SystemExit。
  - 命令行用法为 `python3 pack.py unpacked/ out.pptx`，可用 `--no-repair`、`--no-validate`、`--original` 关闭或放宽相应步骤。
- Sources / 来源：[jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/pack.py:L87–L110](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/pack.py#L87-L110),
  - [jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/pack.py:L131–L152](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/pack.py#L131-L152)
- **修复→校验→写包的三段流水线**
- pack.py 编排三个模块：repair.repair_all 先对解包目录做生成器怪癖修复并直接写回源 XML（repair.py:L197–L198），随后 validate.validate 做 schema 与结构校验，校验失败抛 PackError 拒绝写出输出文件，最后在临时目录中 condense 并写出 ZIP。三个步骤并非无条件执行：do_repair/do_validate 均可关闭（pack.py:L94、L101）。校验的对象是修复后的源文件，而非仅打包副本。
- Sources / 来源：[jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/pack.py:L94–L110](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/pack.py#L94-L110),
  - [jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/repair.py:L187–L199](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/repair.py#L187-L199),
  - [jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/pack.py:L112–L128](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/pack.py#L112-L128)
- **配置面：pack() 参数与 CLI 开关**
- 配置面有两层：库级参数 pack(unpacked, output, do_repair=True, do_validate=True, original=None)（默认全开），以及 CLI 开关 --no-repair、--no-validate、--original 映射到这些参数。--original 提供 baseline 包；validate.py 解压并校验它，仅报告 baseline 中不存在的缺陷（按去掉行号的指纹比对），但 baseline 不可读（BadZipFile/OSError）时退回报告全部错误。
- Sources / 来源：[jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/pack.py:L87–L92](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/pack.py#L87-L92),
  - [jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/pack.py:L135–L143](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/pack.py#L135-L143),
  - [jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/validate.py:L184–L195](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/validate.py#L184-L195)
- **修复规则与校验范围**
- repair_all 对每个 *.xml 依序应用五条规则：子弹百分比、负 extent 翻转（flipH/flipV）、阴影值、重复 shape id、空白保留。注意细节：超出上限的 blurRad/dist/dir 不是被钳制，而是替换为固定回退值（38100/38100/5400000），仅 alpha 值被钳制到 0..100000；空白规则只给不带属性、且首尾含空白的 `t` 元素加 xml:space="preserve"，而非所有含空白的 t。校验按根命名空间选 XSD，未列出的命名空间和 docProps/ 被跳过。
- Sources / 来源：[jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/repair.py:L112–L141](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/repair.py#L112-L141),
  - [jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/repair.py:L164–L175](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/repair.py#L164-L175),
  - [jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/validate.py:L50–L74](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/validate.py#L50-L74)
- **基线容忍与正则修复的取舍**
- baseline 机制是有意的放宽：生成器（如 PptxGenJS 图表子元素顺序）产出的包本身就违反已发布 schema 但能正常打开，拒绝重打包会阻断既有 decks 的每次编辑，因此只报告本次编辑新引入的缺陷；代价是不可读的 baseline 会退回报告全部错误，且指纹（去掉行号的 part+message）可能把不同位置的同类缺陷视为相同。修复层用逐条正则规则针对 PptxGenJS 的具体观察失败，收益是精准、可计数，限制是仅覆盖已枚举的怪癖，其他生成器的问题落在 validate 层兜底。
- Sources / 来源：[jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/validate.py:L167–L195](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/validate.py#L167-L195),
  - [jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/repair.py:L2–L11](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/repair.py#L2-L11)
- **校验入口与所覆盖的检查**
- validate.py 可独立运行（`python3 validate.py unpacked/ [--baseline ...]`）：失败时经 stderr 列出前 40 条错误并以退出码 1 结束，全部通过则 stdout 输出 "All validations PASSED!"。它做两层检查：逐 part 的 XSD 校验（含不可编译 schema 的跳过与命名空间映射例外），以及跨 part 结构检查——slide 的 .rels 存在、r:id/r:embed 引用存在、恰好一条 slideLayout 关系、每张 slide 内 shape id 唯一。
  - 所示输入中未包含这些模块的测试用例。
- Sources / 来源：[jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/validate.py:L198–L214](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/validate.py#L198-L214),
  - [jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/validate.py:L120–L155](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/validate.py#L120-L155)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/config-resources/feature-opc-pack-validate.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/pack.py:L87-L110
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/pack.py:L131-L152
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/pack.py:L94-L110
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/repair.py:L187-L199
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/pack.py:L112-L128
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/pack.py:L87-L92
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/pack.py:L135-L143
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/validate.py:L184-L195
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/repair.py:L112-L141
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/repair.py:L164-L175
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/validate.py:L50-L74
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/validate.py:L167-L195
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/repair.py:L2-L11
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/validate.py:L198-L214
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/validate.py:L120-L155
- 源页字段（feature）：opc-pack-validate
- 入口（entry_points）：jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/pack.py
- 源页字段（source_globs）：jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/pack.py；jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/repair.py；jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/unpack.py
  - jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/validate.py
