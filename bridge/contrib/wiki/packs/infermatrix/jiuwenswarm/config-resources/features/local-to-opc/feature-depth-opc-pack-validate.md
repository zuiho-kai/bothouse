---
name: feature-depth-opc-pack-validate
description: opc/pack.py 实现深读：校验通过后 condense 并写 ZIP、前置校验与 PackError 契约、--no-repair/--no-validate/--original 与 baseline 指纹、repair_all 就地改写源目录、拒写 output 的安全与 copytree 成本、editing.md 手工流程（未执行）
metadata:
  scope: 收 pack.py 的流程、API、配置、依赖、失败模式、取舍与手工验收的实现深读，来源另含 editing.md、repair.py、validate.py；功能概览归 feature-opc-pack-validate
---
# OOXML 打包与 schema 校验（opc/pack.py）：实现深读

## 现状

- [[feature-opc-pack-validate]]（功能概览） · [[config-resources-overview-1]]、[[config-resources-overview-2]]（owner 入口）
- **pack() 校验通过后在临时目录压缩 XML 并写出 ZIP** pack() 先（默认）执行 repair_all 与 validate；若校验有错误，记录前 20 条并抛出 PackError 拒绝写出。否则把 unpacked 复制到临时目录，对每个 *.xml 与 *.rels 执行 condense，按排序且把 FIRST_ENTRY 指定的条目排最前，以 ZIP_DEFLATED 写入 output。
- 来源：[jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/pack.py:L94–L126](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/pack.py#L94-L126)
- **pack(unpacked, output, do_repair=True, do_validate=True, original=None) 前置校验与失败契约** pack() 要求 unpacked 是目录且 output 后缀（小写比较）属于 SUPPORTED={".pptx",".docx",".xlsx"}，否则抛 PackError；validation 失败时抛 PackError 拒绝写 output。main() 把 PackError 转成 SystemExit，保持函数可作库使用。
- 来源：[jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/pack.py:L87–L110](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/pack.py#L87-L110),
  - [jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/pack.py:L62–L62](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/pack.py#L62-L62),
  - [jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/pack.py:L147–L152](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/pack.py#L147-L152)
- **do_repair/do_validate 默认开启，--no-repair/--no-validate 关闭，--original 作为校验基线** _run() 的 argparse 定义 `--no-repair`、`--no-validate`（store_true）与 `--original`，并以 `do_repair=not args.no_repair, do_validate=not args.no_validate` 调用 pack()。original 传入 validate 的 baseline；
  - 基线错误按 _fingerprint（去掉行号的 part+message）过滤，仅报告基线中不存在的缺陷，基线不可读时报告全部错误。
- 来源：[jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/pack.py:L131–L143](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/pack.py#L131-L143),
  - [jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/validate.py:L158–L195](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/validate.py#L158-L195)
- **pack 依赖 repair.repair_all 与 validate，且 repair 会就地改写源目录** pack 直接调用 repair_all(unpacked) 与 validate(unpacked, baseline=original)。repair_all 对每个 *.xml 逐条应用 5 条规则并当文本变化时就地 write_text，因此 do_repair=True 时传入的 unpacked 目录本身被修改，发生在 condense 的临时 staged 复制之前。
- 来源：[jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/pack.py:L94–L102](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/pack.py#L94-L102),
  - [jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/repair.py:L187–L199](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/repair.py#L187-L199),
  - [jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/repair.py:L178–L184](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/repair.py#L178-L184)
- **非目录/非法后缀/校验失败均抛 PackError，main() 转为 SystemExit** unpacked 非目录或 output 后缀不在 SUPPORTED 时抛 PackError；validate 返回错误时记录前 20 条并抛 `pack: refusing to write {output}`，中止写入。main() 捕获 PackError 并 raise SystemExit(str(exc))。
- 来源：[jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/pack.py:L87–L110](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/pack.py#L87-L110),
  - [jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/pack.py:L147–L152](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/pack.py#L147-L152)
- **验证失败拒写 output（安全）换取整目录复制到临时目录（成本）** 设计推断（非作者历史意图）：
- 收益（推断）：validate 报错时 raise PackError refusing to write，output 不会被新写入的坏包覆盖。成本（推断）：每次打包都要 copytree 到 TemporaryDirectory 并对全部 *.xml/*.rels 重新解析写出。注意源目录并非全程只读——repair_all 已在此之前就地改写。
- 来源：[jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/pack.py:L101–L117](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/pack.py#L101-L117)
- **editing.md 中记录的 pack.py 手动流程（未执行）** 文档中的人工验收步骤（本轮未执行）：
- 文档给出具体操作 `python scripts/opc/pack.py unpacked/ output.pptx --original input.pptx`，并声明其效果为校验、修复、压缩 XML、重新编码弯引号。这是 documented_manual 证据，本条未执行该流程；未见任何针对 pack.py 的自动化测试断言。
- 来源：[jiuwenswarm/resources/agent/workspace/skills/ppt-creation/editing.md:L49–L95](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/editing.md#L49-L95)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/config-resources/feature-depth-opc-pack-validate.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/pack.py:L87-L110
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/pack.py:L147-L152
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/pack.py:L94-L102
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/repair.py:L187-L199
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/repair.py:L178-L184
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/pack.py:L101-L117
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/pack.py:L94-L126
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/pack.py:L131-L143
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/validate.py:L158-L195
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/pack.py:L62-L62
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/editing.md:L49-L95
- 源页字段（feature）：opc-pack-validate
- 入口（entry_points）：jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/pack.py
- 源页字段（source_globs）：jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/pack.py；jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/repair.py；jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/unpack.py
  - jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/validate.py
