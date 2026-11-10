---
name: feature-depth-docx-pro-cli
description: docx-pro CLI 实现深读：main 存在性检查与局部返回 2、replace_in_docx options 默认值（scope=all/case_sensitive/verify）、替换对解析契约、setup_check 自检、SKILL.md replace 后验查流程（未执行）
metadata:
  scope: 只收 docx-pro CLI 的实现深读条目（流程、配置默认值、依赖、失败模式、取舍、验证）；功能概览归 feature-docx-pro-cli
---
# docx-pro Word 文档操作 CLI：实现深读

## 现状

- [[feature-docx-pro-cli]]（功能概览） · [[config-resources-overview-1]]、[[config-resources-overview-2]]（owner 入口）
- **main 解析参数并按存在性检查后分发到 args.func 的局部返回** main 先对 json/md/docx/map 中非空且非 "-" 的路径做存在性检查（缺失则记录并返回 2），否则返回 args.func(args)；分发函数抛 FileNotFoundError/ValueError 时同样记录并返回 2。
- 来源：[jiuwenswarm/resources/agent/workspace/skills/docx-pro/scripts/docx_pro.py:L404–L421](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/docx-pro/scripts/docx_pro.py#L404-L421)
- **replace_in_docx 的 options 默认值：scope=all、case_sensitive=True、verify=True** options.get 取默认 scope="all"、case_sensitive=True、dry_run=False、verify=True；scope="body" 时 _target_parts 只保留 REPLACE_BODY_PARTS 内的部件，否则按白名单加 .xml 前缀扩展。
- 来源：[jiuwenswarm/resources/agent/workspace/skills/docx-pro/scripts/docx_replace.py:L212–L236](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/docx-pro/scripts/docx_replace.py#L212-L236)
- **docx-pro 脚本依赖 python-docx 并提供 setup_check 自检** 设计推断（非作者历史意图）：
- setup_check.check 尝试 import docx 与 docx.shared，ImportError/异常时返回 False；docx_pro.py 将脚本目录加入 sys.path（推断：便于导入同目录模块）。
- 来源：[jiuwenswarm/resources/agent/workspace/skills/docx-pro/scripts/setup_check.py:L9–L26](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/docx-pro/scripts/setup_check.py#L9-L26),
  - [jiuwenswarm/resources/agent/workspace/skills/docx-pro/scripts/docx_pro.py:L31–L31](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/docx-pro/scripts/docx_pro.py#L31-L31)
- **cmd_replace 对同路径覆盖返回 2，main 捕获两类异常返回 2** 输出文件绝对路径等于输入时报 "输出文件不得覆盖输入文件" 并返回 2；main 捕获 FileNotFoundError/ValueError 记录 "[错误]" 后返回 2。返回值是局部返回，非进程退出码证明。
- 来源：[jiuwenswarm/resources/agent/workspace/skills/docx-pro/scripts/docx_pro.py:L174–L179](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/docx-pro/scripts/docx_pro.py#L174-L179),
  - [jiuwenswarm/resources/agent/workspace/skills/docx-pro/scripts/docx_pro.py:L414–L421](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/docx-pro/scripts/docx_pro.py#L414-L421)
- **main 仅捕获分发调用的 FileNotFoundError/ValueError 并返回 2：统一局部返回码，代价是仅凭返回值无法区分错误类型** 设计推断（非作者历史意图）：
- main 对 args.func(args) 的返回值原样透传，并仅将 FileNotFoundError 与 ValueError 两类异常记录 '[错误]' 后返回 2。收益是这两类常见错误有统一的局部返回值 2；成本是调用方仅凭该返回值无法区分是缺文件还是非法参数，且其他类型异常不在捕获之列（推断）。此为函数返回值，不构成进程退出码证明（尽管 __main__ 下 sys.exit(main()) 会传递它）。
- 来源：[jiuwenswarm/resources/agent/workspace/skills/docx-pro/scripts/docx_pro.py:L404–L421](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/docx-pro/scripts/docx_pro.py#L404-L421),
  - [jiuwenswarm/resources/agent/workspace/skills/docx-pro/scripts/docx_pro.py:L424–L425](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/docx-pro/scripts/docx_pro.py#L424-L425)
- **replace 的替换对解析契约与 ValueError→退出码 2 的本地返回** _load_replace_pairs 接受 --map（JSON 对象、[旧,新] 数组或 {find,to} 项）与成对的 -f/-t，两者可叠加；任一来源格式非法、-f/-t 数量不等、无任何替换对或旧文本等于新文本时 raise ValueError，main 捕获后记日志并本地 return 2。cmd_replace 在解析对之后、调用 docx_replace.replace_in_docx 之前，若输出绝对路径等于输入 docx 的绝对路径同样本地 return 2。
- 来源：[jiuwenswarm/resources/agent/workspace/skills/docx-pro/scripts/docx_pro.py:L141–L171](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/docx-pro/scripts/docx_pro.py#L141-L171),
  - [jiuwenswarm/resources/agent/workspace/skills/docx-pro/scripts/docx_pro.py:L174–L181](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/docx-pro/scripts/docx_pro.py#L174-L181),
  - [jiuwenswarm/resources/agent/workspace/skills/docx-pro/scripts/docx_pro.py:L404–L421](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/docx-pro/scripts/docx_pro.py#L404-L421)
- **SKILL.md 记载的 replace 后验查流程（文档化手动程序，未执行）** 文档中的人工验收步骤（本轮未执行）：
- SKILL.md 规定：先以 --dry-run 统计各部件命中次数再实跑，之后确认输出路径与输入不同、命中次数符合预期、日志出现“其余 zip 条目字节级一致: True”、段落数/表格数不变且残留计数为 0（新文本包含旧文本时残留>0 属正常）。这是文档化的手动检查步骤，本次 NOT EXECUTED，不构成任何已通过的测试断言。
- 来源：[jiuwenswarm/resources/agent/workspace/skills/docx-pro/SKILL.md:L66–L81](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/docx-pro/SKILL.md#L66-L81),
  - [jiuwenswarm/resources/agent/workspace/skills/docx-pro/SKILL.md:L107–L113](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/docx-pro/SKILL.md#L107-L113)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/config-resources/feature-depth-docx-pro-cli.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/docx-pro/scripts/docx_pro.py:L404-L421
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/docx-pro/scripts/docx_replace.py:L212-L236
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/docx-pro/scripts/setup_check.py:L9-L26
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/docx-pro/scripts/docx_pro.py:L31-L31
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/docx-pro/scripts/docx_pro.py:L174-L179
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/docx-pro/scripts/docx_pro.py:L414-L421
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/docx-pro/scripts/docx_pro.py:L424-L425
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/docx-pro/scripts/docx_pro.py:L141-L171
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/docx-pro/scripts/docx_pro.py:L174-L181
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/docx-pro/SKILL.md:L66-L81；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/docx-pro/SKILL.md:L107-L113
- 源页字段（feature）：docx-pro-cli
- 入口（entry_points）：jiuwenswarm/resources/agent/workspace/skills/docx-pro/scripts/docx_pro.py；jiuwenswarm/resources/agent/workspace/skills/docx-pro/scripts/setup_check.py
- 源页字段（source_globs）：jiuwenswarm/resources/agent/workspace/skills/docx-pro/scripts/docx_pro.py；jiuwenswarm/resources/agent/workspace/skills/docx-pro/scripts/setup_check.py；jiuwenswarm/resources/agent/workspace/skills/docx-pro/scripts/docx_replace.py
  - jiuwenswarm/resources/agent/workspace/skills/docx-pro/scripts/renderer.py；jiuwenswarm/resources/agent/workspace/skills/docx-pro/scripts/md_export.py
