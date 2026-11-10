---
name: feature-depth-ppt-deck-finalize
description: finalize_deck.py 实现深读：_run 解包 template 与 content、CLI 位置参数、默认值、subprocess 调用 unpack.py 与非零退出抛 FinalizeError、零内容页报错、FinalizeError 取舍、--cover-title 手工流程（未执行）
metadata:
  scope: 收 finalize_deck.py 的流程、API、配置、依赖、失败模式、取舍与手工验收的实现深读，来源另含 create-deck.md、quality-gates.md；功能概览归 feature-ppt-deck-finalize
---
# 一键成片流水线与质量门禁（finalize_deck.py）：实现深读

## 现状

- [[feature-ppt-deck-finalize]]（功能概览） · [[config-resources-overview-1]]、[[config-resources-overview-2]]（owner 入口）
- **_run 在校验输入后用 run() 依次解包 template 与 content 到工作目录** _run 解析参数后检查 content 与 template 文件存在且 content/out 不在 SKILL_ROOT 内；workdir 取 --keep-workdir 指定目录，否则新建临时目录，然后通过 run() 先后调用 unpack.py 解包 template 到 tdir、content 到 sdir。
- 来源：[jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/finalize_deck.py:L117–L137](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/finalize_deck.py#L117-L137)
- **CLI takes positional content and out; main maps FinalizeError to SystemExit** finalize_deck.py accepts positional args `content` (generated content .pptx) and `out` (final .pptx to write); main() calls _run() and, on FinalizeError, raises SystemExit(str(exc)) chained from it,
  - per its docstring keeping helpers usable as a library.
- 来源：[jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/finalize_deck.py:L100–L109](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/finalize_deck.py#L100-L109),
  - [jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/finalize_deck.py:L192–L197](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/finalize_deck.py#L192-L197)
- **Defaults: template.pptx, order "t1,s*,t5", slideLayout7.xml, source-layout-mode template** --template defaults to SKILL_ROOT/references/template.pptx, --order defaults to "t1,s*,t5" (tN/sN/s* tokens), --template-layout defaults to slideLayout7.xml (Office's Blank),
  - and --source-layout-mode accepts only "template" or "source", defaulting to "template".
- 来源：[jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/finalize_deck.py:L100–L109](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/finalize_deck.py#L100-L109)
- **finalize_deck 通过 sys.executable 子进程调用同目录 scripts/opc/unpack.py，非零退出即抛 FinalizeError** run() 用 subprocess.run([sys.executable, *argv]) 执行子脚本；SCRIPTS 定位为 finalize_deck.py 所在目录（SKILL_ROOT 为其父目录），_run() 先后调用 SCRIPTS/opc/unpack.py 解包模板与内容。
  - 任一子进程 returncode != 0 时抛 FinalizeError，提示用 --keep-workdir 检查中间目录。
- 来源：[jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/finalize_deck.py:L56–L66](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/finalize_deck.py#L56-L66),
  - [jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/finalize_deck.py:L132–L137](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/finalize_deck.py#L132-L137)
- **Zero content slides raise FinalizeError; main converts it to SystemExit with the message** When count_slides(sdir) returns 0, _run raises FinalizeError("finalize_deck: no slides found in {content}"); main() catches FinalizeError and re-raises SystemExit(str(exc)),
  - terminating the process with the fatal message.
- 来源：[jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/finalize_deck.py:L139–L146](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/finalize_deck.py#L139-L146),
  - [jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/finalize_deck.py:L192–L197](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/finalize_deck.py#L192-L197)
- **helpers 抛 FinalizeError 而非 SystemExit 以保持库可用；代价是进程入口需自责转换** 设计推断（非作者历史意图）：
- FinalizeError 的 docstring 说明在入口外抛 SystemExit 被禁止且使函数无法作库使用；main() 捕获 FinalizeError 并转为 SystemExit(str(exc))。推断的代价：经由 main() 运行时错误以退出消息呈现，库式调用方需自行捕获 FinalizeError。
- 来源：[jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/finalize_deck.py:L44–L49](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/finalize_deck.py#L44-L49),
  - [jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/finalize_deck.py:L192–L197](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/finalize_deck.py#L192-L197)
- **文档化手工流程：finalize_deck.py --cover-title 与收尾门禁（未执行）** 文档中的人工验收步骤（本轮未执行）：
- 文档记载的手工验证（NOT EXECUTED）：运行 `python3 ../scripts/finalize_deck.py output/content.pptx output/final.pptx --cover-title "..." --cover-meta "部门|作者|日期"`，脚本封装 unpack→merge→fill_cover→clean→pack 并在结束时自检，打印页数/母版/版式摘要；若未传 `--cover-title`，收尾的 cover-title 硬门禁判失败（模板 ctrTitle 出厂为空且合并流程不写入）。
- 来源：[jiuwenswarm/resources/agent/workspace/skills/ppt-creation/workflows/create-deck.md:L121–L133](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/workflows/create-deck.md#L121-L133),
  - [jiuwenswarm/resources/agent/workspace/skills/ppt-creation/base/quality-gates.md:L26–L28](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/base/quality-gates.md#L26-L28)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/config-resources/feature-depth-ppt-deck-finalize.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/finalize_deck.py:L117-L137
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/finalize_deck.py:L100-L109
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/finalize_deck.py:L192-L197
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/finalize_deck.py:L139-L146
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/finalize_deck.py:L56-L66
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/finalize_deck.py:L132-L137
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/finalize_deck.py:L44-L49
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/workflows/create-deck.md:L121-L133
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/base/quality-gates.md:L26-L28
- 源页字段（feature）：ppt-deck-finalize
- 入口（entry_points）：jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/finalize_deck.py
- 源页字段（source_globs）：jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/finalize_deck.py；jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/make_blank_template.py；jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/fill_cover.py
  - jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/prune.py；jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/merge_slides.py
