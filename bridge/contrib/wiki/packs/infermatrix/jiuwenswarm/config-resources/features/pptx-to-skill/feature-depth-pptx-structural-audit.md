---
name: feature-depth-pptx-structural-audit
description: audit_pptx.py 实现深读：main 与退出码、字号阈值 24/10/7 与 EMU 缺省尺寸、仅标准库依赖、异常处理与缺失部件、主题色外置到 lock 的取舍、--evidence-plan 文档化手工验证（未执行）
metadata:
  scope: 收 audit_pptx.py 的实现细节（main、默认值、依赖、异常路径、取舍、手工验证记载），来源另含 quality-gates.md；功能概览归 feature-pptx-structural-audit
---
# PPTX 结构与可读性审计脚本：实现深读

## 现状

- [[feature-pptx-structural-audit]]（功能概览） · [[config-resources-overview-1]]、[[config-resources-overview-2]]（owner 入口）
- **main 解析参数后调用 audit，报告写入/输出并以错误数决定返回值** main 配置 stderr 日志、解析参数，调用 audit(args)；成功时可选写 --report JSON，逐条输出 warnings/errors 及汇总行，仅当 report["errors"] 非空时返回 1，否则返回 0。
- 来源：[jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/audit_pptx.py:L494–L534](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/audit_pptx.py#L494-L534)
- **字号下限默认 24/10/7 可由 CLI 覆盖；幻灯尺寸缺省 12192000x6858000 EMU** --title-min-font、--body-min-font、--absolute-min-font 的 argparse 默认分别为 24.0、10.0、7.0；slide_size 在 presentation.xml 缺少 p:sldSz 节点或属性时回退到 12192000x6858000 EMU（16:9）。
- 来源：[jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/audit_pptx.py:L506–L509](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/audit_pptx.py#L506-L509),
  - [jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/audit_pptx.py:L59–L64](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/audit_pptx.py#L59-L64)
- **audit_pptx.py depends only on the Python standard library and reads the PPTX as a ZIP of XML** Imports are argparse, hashlib, json, logging, posixpath, re, sys, zipfile, pathlib and xml.etree.ElementTree only; the xml() helper parses parts via ET.fromstring(zf.read(name)),
  - so the audit runs without python-pptx or other third-party packages.
- 来源：[jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/audit_pptx.py:L11–L20](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/audit_pptx.py#L11-L20),
  - [jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/audit_pptx.py:L55–L56](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/audit_pptx.py#L55-L56)
- **输入/解析异常被捕获并返回 1；缺失包部件记为 errors** main 捕获 (OSError, ValueError, zipfile.BadZipFile, ET.ParseError)，日志输出 "audit failed: ..." 并返回 1；audit 内部对不存在的 pptx 路径抛 FileNotFoundError，对缺失的必需包部件（如 ppt/presentation.xml）追加到 errors 列表而非立即抛出。
- 来源：[jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/audit_pptx.py:L511–L517](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/audit_pptx.py#L511-L517),
  - [jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/audit_pptx.py:L295–L308](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/audit_pptx.py#L295-L308)
- **主题色外置到 lock 便于换肤，但视觉验收仍需人工/Agent** 设计推断（非作者历史意图）：
- 收益：summary_band 的期望填充色来自锁文件而非硬编码，重主题化 deck 不需要修改检查。成本：docstring 明确视觉 contact sheet 仍需 Agent 目检，脚本只覆盖结构与可读性维度。
- 来源：[jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/audit_pptx.py:L2–L7](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/audit_pptx.py#L2-L7),
  - [jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/audit_pptx.py:L268–L274](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/audit_pptx.py#L268-L274)
- **main() 以位置参数 pptx 加 --template/--lock/--evidence-plan 选项运行，有 error 时返回 1** main() 声明位置参数 pptx 与可选 --template、--lock、--evidence-plan（后者启用论文图来源注检查）；日志走 stderr。结束时 emit 汇总 error/warning 数与 slides/masters/layouts/font_min_pt，并 `return 1 if report["errors"] else 0`（这是 main 的返回值，非进程退出码的直接证明）。
  - audit() 前置条件：pptx 路径不存在时抛 FileNotFoundError；传入 --lock 时按 UTF-8 JSON 读取锁文件。zip 内缺 [Content_Types].xml、ppt/presentation.xml、ppt/_rels/presentation.xml.rels 任一部件即追加 error。
- 来源：[jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/audit_pptx.py:L494–L503](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/audit_pptx.py#L494-L503),
  - [jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/audit_pptx.py:L528–L534](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/audit_pptx.py#L528-L534),
  - [jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/audit_pptx.py:L292–L308](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/audit_pptx.py#L292-L308)
- **文档化手动验证：带 --evidence-plan 运行 audit_pptx.py，缺“来源：…”文本时 error 并以退出码 1 结束（NOT EXECUTED）** 文档中的人工验收步骤（本轮未执行）：
- quality-gates.md 的“常用命令”给出具体操作：`python scripts/audit_pptx.py output.pptx --template references/template.pptx --lock execution-lock.json --evidence-plan evidence-plan.json --report qa/structure.json`，并记录预期结果：--evidence-plan 打开论文图来源硬校验，按图片字节哈希定位嵌入论文原图的页面，
  - 该页若无 addSourceNote 画出的“来源：…”文本则报 error 并以退出码 1 结束。此为文档记载的步骤，本次未执行；提供的输入中无针对该脚本的自动化测试。
- 来源：[jiuwenswarm/resources/agent/workspace/skills/ppt-creation/base/quality-gates.md:L97–L110](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/base/quality-gates.md#L97-L110)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/config-resources/feature-depth-pptx-structural-audit.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/audit_pptx.py:L494-L534
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/audit_pptx.py:L506-L509
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/audit_pptx.py:L59-L64
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/audit_pptx.py:L511-L517
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/audit_pptx.py:L295-L308
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/audit_pptx.py:L2-L7
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/audit_pptx.py:L268-L274
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/audit_pptx.py:L11-L20
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/audit_pptx.py:L55-L56
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/audit_pptx.py:L494-L503
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/audit_pptx.py:L528-L534
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/audit_pptx.py:L292-L308
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/base/quality-gates.md:L97-L110
- 源页字段（feature）：pptx-structural-audit
- 入口（entry_points）：jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/audit_pptx.py
- 源页字段（source_globs）：jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/audit_pptx.py；jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/qa_density.py；jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/qa_geometry.py
