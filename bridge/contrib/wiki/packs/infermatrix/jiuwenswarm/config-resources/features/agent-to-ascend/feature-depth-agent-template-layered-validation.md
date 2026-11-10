---
name: feature-depth-agent-template-layered-validation
description: Agent 模板分层校验器实现深读：main() 分层执行与热加载跳过、worker 子进程 0/1/2 退出契约、resolve_pkg 目标解析、openjiuwen 缺失判 skip、静态错误即跳过的取舍、SKIP 使退出码为 1、SKILL.md 手工校验流程（未执行）
metadata:
  scope: 收 validate_template.py 与 validate_hot_load_worker.py 的实现深读，来源另含 SKILL.md；功能概览归 feature-agent-template-layered-validation
---
# Agent 模板分层校验器（L0 规范 / L1 静态 AST / L2 子进程编排）：实现深读

## 现状

- [[feature-agent-template-layered-validation]]（功能概览） · [[config-resources-overview-1]]、[[config-resources-overview-2]]（owner 入口）
- **main()：解析包目录后按层执行，热加载在静态错误时被跳过** validate_template.py 的 main() 先 resolve_pkg 解析目标；validate_static 得到 quality/static 两层；若 --no-hot-load 或任一层有 errors，热加载层记录 skip 原因而非执行；随后逐层 render 输出并 _print_summary，仅当三层 status 均为 PASS 才返回 0，否则返回 1。
- 来源：[jiuwenswarm/resources/agent/workspace/skills/agent-creator/scripts/validate_template.py:L949–L987](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/agent-creator/scripts/validate_template.py#L949-L987)
- **worker 子进程契约：单个包目录参数，stdout 输出 JSON 结果并按 status 返回 0/1/2** validate_hot_load_worker.py 的 main() 要求 sys.argv 恰好为 2 个（脚本 + 包目录），否则打印 skip JSON 并返回 2；包目录不存在同样返回 2；结果以 json.dumps(result, ensure_ascii=False) 写到 stdout，status 为 pass 返回 0、fail 返回 1、其余（skip）返回 2。
- 来源：jiuwenswarm/resources/agent/workspace/skills/agent-creator/scripts/validate_hot_load_worker.py:L328–L376
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/agent-creator/scripts/validate_hot_load_worker.py#L328-L376`）
- **数据目录默认 ~/.jiuwenswarm，target 先按路径再按 local/ 目录名解析，--no-hot-load 只跑 L0+L1** get_jiuwenswarm_data_dir 在 raw 为真时对其 expanduser，否则默认 Path.home()/".jiuwenswarm"（所示行未给出 raw 的来源）。resolve_pkg 优先把 expanduser 后已是目录的参数 resolve 返回，否则尝试 local 模板目录下的同名目录，两处都不是目录时抛 FileNotFoundError。
  - main 的 --no-hot-load（store_true）使 L2 直接记 skip（“已通过 --no-hot-load 显式跳过”），仅执行 L0+L1。
- 来源：[jiuwenswarm/resources/agent/workspace/skills/agent-creator/scripts/validate_template.py:L151–L153](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/agent-creator/scripts/validate_template.py#L151-L153),
  - [jiuwenswarm/resources/agent/workspace/skills/agent-creator/scripts/validate_template.py:L164–L173](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/agent-creator/scripts/validate_template.py#L164-L173),
  - [jiuwenswarm/resources/agent/workspace/skills/agent-creator/scripts/validate_template.py:L956–L959](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/agent-creator/scripts/validate_template.py#L956-L959),
  - [jiuwenswarm/resources/agent/workspace/skills/agent-creator/scripts/validate_template.py:L971–L977](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/agent-creator/scripts/validate_template.py#L971-L977)
- **L2 热加载硬依赖 openjiuwen；导入失败被判为环境问题（skip）而非包问题** worker 在执行真实加载链前导入 openjiuwen.core/harness 的 AgentCard、DeepAgent、Workspace 等符号；ImportError 时直接返回 _result("skip")，skip_fix 提示改用 JiuwenSwarm 的 venv python 重跑且这不是包的问题。
- 来源：jiuwenswarm/resources/agent/workspace/skills/agent-creator/scripts/validate_hot_load_worker.py:L140–L155
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/agent-creator/scripts/validate_hot_load_worker.py#L140-L155`）
- **静态错误即跳过热加载：快速反馈的代价是静态失败时无运行时证据** 设计推断（非作者历史意图）：
- main() 在 quality.errors 或 static.errors 非空时让热加载层 skip（提示先修 L0/L1 再重跑），这缩短了坏包的验证循环，但意味着静态未通过时本实现不产出任何热加载层的运行时结论。
- 来源：[jiuwenswarm/resources/agent/workspace/skills/agent-creator/scripts/validate_template.py:L971–L987](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/agent-creator/scripts/validate_template.py#L971-L987)
- **未知 worker status 或环境缺 openjiuwen 时 L2 记为 skip，且 L0/L1 有错则不执行热加载** worker 返回的 status 不在 ("pass","fail") 时该 Layer 调 skip 记原因与修复建议；worker 进程 ImportError openjiuwen 时返回 status=skip 并附 skip_fix。热加载仅在非 --no-hot-load 且 L0/L1 无 errors 时执行，否则同样 skip。最终 ok 要求三层全部 status=="PASS"，故任一 skip 使 main 返回 1。
- 来源：[jiuwenswarm/resources/agent/workspace/skills/agent-creator/scripts/validate_template.py:L839–L843](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/agent-creator/scripts/validate_template.py#L839-L843),
  - jiuwenswarm/resources/agent/workspace/skills/agent-creator/scripts/validate_hot_load_worker.py:L150–L155
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/agent-creator/scripts/validate_hot_load_worker.py#L150-L155`）,
  - [jiuwenswarm/resources/agent/workspace/skills/agent-creator/scripts/validate_template.py:L971–L987](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/agent-creator/scripts/validate_template.py#L971-L987)
- **SKILL.md 记录的手工校验流程（本轮未执行）** 文档中的人工验收步骤（本轮未执行）：
- 文档规定 create 与 update 均须运行 `python3 <skill_dir>/scripts/validate_template.py <agent-name>`，使用 JiuwenSwarm 运行环境的 python，依次执行 L0/L1/L2，达到 `RESULT: PASS` 才可 register；L2 失败或未执行不能 register；warning（`!`）不阻塞。此为已记录的手工流程，本轮未执行。所供证据未展示针对本校验器的自动化测试。
- 来源：[jiuwenswarm/resources/agent/workspace/skills/agent-creator/SKILL.md:L106–L116](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/agent-creator/SKILL.md#L106-L116)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/config-resources/feature-depth-agent-template-layered-validation.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/agent-creator/scripts/validate_template.py:L949-L987
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/agent-creator/scripts/validate_hot_load_worker.py:L328-L376
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/agent-creator/scripts/validate_hot_load_worker.py:L140-L155
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/agent-creator/scripts/validate_template.py:L971-L987
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/agent-creator/scripts/validate_template.py:L151-L153
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/agent-creator/scripts/validate_template.py:L164-L173
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/agent-creator/scripts/validate_template.py:L956-L959
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/agent-creator/scripts/validate_template.py:L971-L977
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/agent-creator/SKILL.md:L106-L116
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/agent-creator/scripts/validate_template.py:L839-L843
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/agent-creator/scripts/validate_hot_load_worker.py:L150-L155
- 源页字段（feature）：agent-template-layered-validation
- 入口（entry_points）：jiuwenswarm/resources/agent/workspace/skills/agent-creator/scripts/validate_template.py
- 源页字段（source_globs）：jiuwenswarm/resources/agent/workspace/skills/agent-creator/scripts/validate_template.py；jiuwenswarm/resources/agent/workspace/skills/agent-creator/scripts/validate_hot_load_worker.py
