---
name: feature-depth-plugin-package-layered-validator
description: "validate_plugin.py 实现深读：main 的三层分支与返回值、CLI 的 target 与 --no-hot-load、数据目录解析、L2 依赖 openjiuwen 的 ImportError 即 skip、worker 超时记 SKIP、子进程隔离取舍、SKILL.md 须 RESULT: PASS 才能注册（未执行）"
metadata:
  scope: 收 validate_plugin.py 及热加载 worker 的流程、API、配置、依赖、失败模式、取舍与手工验收的实现深读，来源另含 SKILL.md、validate_plugin_hot_load_worker.py；功能概览归 feature-plugin-package-layered-validator-1、feature-plugin-package-layered-validator-2
---
# plugin-creator 插件包分层校验器（L0/L1/L2）：实现深读

## 现状

- [[feature-plugin-package-layered-validator-1]]、[[feature-plugin-package-layered-validator-2]]（功能概览） · [[config-resources-overview-1]]、[[config-resources-overview-2]]（owner 入口）
- **main：三层校验的分支、渲染与本地返回值** main() 解析 target 与 --no-hot-load；resolve_pkg 失败时输出 Error 并 return 1。随后 validate_static(pkg) 得到 L0/L1 两层；--no-hot-load 或 L0/L1 有 errors 时构造 LAYER_HOT_LOAD 的 Layer 并 skip，否则调用 validate_hot_load(pkg) 在子进程中跑 worker 并解析最后一行 JSON。
  - 三层经 layer.render() 与 _print_summary 写到 stdout，仅当三层 status 全为 "PASS" 才 return 0，否则 return 1（函数返回值，非进程退出码断言）。
- 来源：[jiuwenswarm/resources/agent/workspace/skills/plugin-creator/scripts/validate_plugin.py:L933–L971](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/plugin-creator/scripts/validate_plugin.py#L933-L971),
  - [jiuwenswarm/resources/agent/workspace/skills/plugin-creator/scripts/validate_plugin.py:L844–L891](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/plugin-creator/scripts/validate_plugin.py#L844-L891)
- **CLI：位置参数 target + --no-hot-load；找不到目录时输出 Error 并局部返回 1** validate_plugin.py 接受一个位置参数 target（包目录绝对路径，或 local/ 下的 plugin-name）和 --no-hot-load 开关；resolve_pkg 抛 FileNotFoundError 时 write_stdout("Error: ...") 并 return 1（局部返回值，非进程级断言）。
  - 热加载 worker 是独立入口：要求恰好一个参数 <package-dir>，向 stdout 输出一行 JSON 结果，status 为 pass/fail/其他时分别返回 0/1/2。
- 来源：[jiuwenswarm/resources/agent/workspace/skills/plugin-creator/scripts/validate_plugin.py:L937–L952](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/plugin-creator/scripts/validate_plugin.py#L937-L952),
  - jiuwenswarm/resources/agent/workspace/skills/plugin-creator/scripts/validate_plugin_hot_load_worker.py:L328–L344
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/plugin-creator/scripts/validate_plugin_hot_load_worker.py#L328-L344`）,
  - jiuwenswarm/resources/agent/workspace/skills/plugin-creator/scripts/validate_plugin_hot_load_worker.py:L370–L376
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/plugin-creator/scripts/validate_plugin_hot_load_worker.py#L370-L376`）
- **数据目录默认 ~/.jiuwenswarm，JIUWENSWARM_DATA_DIR 覆盖** get_jiuwenswarm_data_dir 读取非空 JIUWENSWARM_DATA_DIR（expanduser），否则用 ~/.jiuwenswarm；resolve_pkg 先按参数找目录，找不到再到 local/ 下找，仍无则抛 FileNotFoundError。
- 来源：[jiuwenswarm/resources/agent/workspace/skills/plugin-creator/scripts/validate_plugin.py:L157–L182](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/plugin-creator/scripts/validate_plugin.py#L157-L182)
- **L2 依赖 openjiuwen 运行时，ImportError 产生该次 skip 结果** worker 在 _hot_load 内导入 openjiuwen 的 Runner/DeepAgent/Workspace 等；ImportError 时返回 skip 结果并提示换 JiuwenSwarm 的 venv python 重跑，本次不产出包级判定。
- 来源：jiuwenswarm/resources/agent/workspace/skills/plugin-creator/scripts/validate_plugin_hot_load_worker.py:L136–L155
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/plugin-creator/scripts/validate_plugin_hot_load_worker.py#L136-L155`）
- **热加载 worker 超时或无法启动时父层记录 SKIP 并返回该层** 父脚本 subprocess.run 带 timeout=HOT_LOAD_TIMEOUT_SEC、check=False；捕获 subprocess.TimeoutExpired 与 OSError 时调用 layer.skip 记录原因与修复提示并 return layer，不抛异常。worker 侧 asyncio.run(_hot_load) 抛出的异常被捕获并转为 status="skip" 的结果。
- 来源：[jiuwenswarm/resources/agent/workspace/skills/plugin-creator/scripts/validate_plugin.py:L856–L876](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/plugin-creator/scripts/validate_plugin.py#L856-L876),
  - jiuwenswarm/resources/agent/workspace/skills/plugin-creator/scripts/validate_plugin_hot_load_worker.py:L361–L368
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/plugin-creator/scripts/validate_plugin_hot_load_worker.py#L361-L368`）
- **子进程隔离+超时换取环境故障表现为 SKIP 而非错误** 设计推断（非作者历史意图）：
- （推断）收益：热加载在子进程中执行并受 HOT_LOAD_TIMEOUT_SEC 约束，包内 import/绑定卡住不会无限阻塞校验；代价：超时/启动失败被记为 SKIP，而 970 行要求所有层 status == "PASS" 才返回 0，故基础设施故障同样导致整体返回 1，无法通过校验。另注意 _smoke_rail_callbacks 中单个回调抛异常是逐项记录为 error，不是整体 skip。
- 来源：[jiuwenswarm/resources/agent/workspace/skills/plugin-creator/scripts/validate_plugin.py:L856–L876](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/plugin-creator/scripts/validate_plugin.py#L856-L876),
  - [jiuwenswarm/resources/agent/workspace/skills/plugin-creator/scripts/validate_plugin.py:L969–L971](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/plugin-creator/scripts/validate_plugin.py#L969-L971),
  - jiuwenswarm/resources/agent/workspace/skills/plugin-creator/scripts/validate_plugin_hot_load_worker.py:L122–L133
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/plugin-creator/scripts/validate_plugin_hot_load_worker.py#L122-L133`）
- **文档规定须跑到 RESULT: PASS 才能注册（未执行）** 文档中的人工验收步骤（本轮未执行）：
- SKILL.md 要求 create/update 都执行 scripts/validate_plugin.py，L0/L1/L2 依次运行，须以 JiuwenSwarm 环境 python 达到 RESULT: PASS，L2 失败或未执行均不能 register。此为文档化手工流程，本次未执行。
- 来源：[jiuwenswarm/resources/agent/workspace/skills/plugin-creator/SKILL.md:L1–L167](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/plugin-creator/SKILL.md#L1-L167)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/config-resources/feature-depth-plugin-package-layered-validator.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/plugin-creator/scripts/validate_plugin.py:L937-L952
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/plugin-creator/scripts/validate_plugin_hot_load_worker.py:L328-L344
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/plugin-creator/scripts/validate_plugin_hot_load_worker.py:L370-L376
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/plugin-creator/scripts/validate_plugin.py:L157-L182
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/plugin-creator/scripts/validate_plugin_hot_load_worker.py:L136-L155
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/plugin-creator/SKILL.md:L1-L167
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/plugin-creator/scripts/validate_plugin.py:L856-L876
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/plugin-creator/scripts/validate_plugin_hot_load_worker.py:L361-L368
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/plugin-creator/scripts/validate_plugin.py:L969-L971
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/plugin-creator/scripts/validate_plugin_hot_load_worker.py:L122-L133
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/plugin-creator/scripts/validate_plugin.py:L933-L971
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/plugin-creator/scripts/validate_plugin.py:L844-L891
- 源页字段（feature）：plugin-package-layered-validator
- 入口（entry_points）：jiuwenswarm/resources/agent/workspace/skills/plugin-creator/scripts/validate_plugin.py
- 源页字段（source_globs）：jiuwenswarm/resources/agent/workspace/skills/plugin-creator/scripts/validate_plugin.py；jiuwenswarm/resources/agent/workspace/skills/plugin-creator/scripts/validate_plugin_hot_load_worker.py
