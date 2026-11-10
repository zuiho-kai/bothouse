---
name: feature-agent-template-layered-validation
description: Agent 模板分层校验器（validate_template.py / validate_hot_load_worker.py）功能知识：入口与退出码、L0/L1/L2 三层与子进程边界、JIUWENSWARM_DATA_DIR 与 --no-hot-load 配置、SKIP 语义取舍、无自动化测试的验证方式
metadata:
  scope: 只收校验器的功能知识；实现深读归 feature-depth-agent-template-layered-validation
---
# Agent 模板分层校验器（validate_template.py / validate_hot_load_worker.py）

## 现状

- **入口与调用契约**
- 主入口 `validate_template.py <path|agent-name> [--no-hot-load>`：目标既可以是包目录路径，也可以是 `local/` 下的 agent 名。退出码 0 表示三层全部 PASS，1 表示失败；`--no-hot-load` 时 L2 标记 SKIP，结论以 stdout 的 RESULT 行为准（PARTIAL/PASS/FAIL）。
  - 热加载 worker `validate_hot_load_worker.py <package-dir>` 由主脚本以子进程调用，在 stdout 最后一行输出一个 JSON 对象（status/errors/notes/skip_reason/skip_fix），自身退出码 0=pass、1=fail、2=skip。
- Sources /
  - 来源：[jiuwenswarm/resources/agent/workspace/skills/agent-creator/scripts/validate_template.py:L10–L14](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/agent-creator/scripts/validate_template.py#L10-L14),
  - [jiuwenswarm/resources/agent/workspace/skills/agent-creator/scripts/validate_template.py:L949–L987](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/agent-creator/scripts/validate_template.py#L949-L987),
  - jiuwenswarm/resources/agent/workspace/skills/agent-creator/scripts/validate_hot_load_worker.py:L1–L11
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/agent-creator/scripts/validate_hot_load_worker.py#L1-L11`）
- **三层结构与进程边界**
- 校验分三层：L0 规范与质量（占位符残留、展示字段）、L1 静态校验（加载阻塞项，纯 stdlib 的 json/ast/文件系统）、L2 热加载（真实 harness 加载链）。L0/L1 在主进程一趟跑完并全量报错，只有两者都通过才执行 L2；L2 的全部 openjiuwen 运行时副作用（Runner.resource_mgr、DeepAgent）隔离在子进程 worker 中，主脚本不 import openjiuwen，只解析 worker stdout 最后一个 JSON 行灌回 Layer 结果对象。
  - Layer 是统一的结果容器：errors 阻塞、warnings 提示、notes 记事实，另带 skip_reason/skip_fix 表达“未执行而非通过”。
- Sources / 来源：[jiuwenswarm/resources/agent/workspace/skills/agent-creator/scripts/validate_template.py:L1–L8](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/agent-creator/scripts/validate_template.py#L1-L8),
  - [jiuwenswarm/resources/agent/workspace/skills/agent-creator/scripts/validate_template.py:L860–L907](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/agent-creator/scripts/validate_template.py#L860-L907),
  - [jiuwenswarm/resources/agent/workspace/skills/agent-creator/scripts/validate_hot_load_worker.py:L1–L5](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/agent-creator/scripts/validate_hot_load_worker.py#L1-L5)
- **验证方式**
- Inference / 设计推断（非作者历史意图）：
- 所示片段中没有针对这两个脚本的自动化测试；验证入口即脚本自身的 CLI：`validate_template.py <path|agent-name>`，输出各层渲染的报告和 `RESULT:`/`NEXT:` 汇总行。L2 worker 的可用性依赖运行环境装有 openjiuwen——缺失时返回 skip 并提示“改用 JiuwenSwarm 的 venv python 重跑”，这本身构成对环境前置条件的运行时检查。
- Sources /
  - 来源：[jiuwenswarm/resources/agent/workspace/skills/agent-creator/scripts/validate_template.py:L915–L946](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/agent-creator/scripts/validate_template.py#L915-L946),
  - jiuwenswarm/resources/agent/workspace/skills/agent-creator/scripts/validate_hot_load_worker.py:L150–L155
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/agent-creator/scripts/validate_hot_load_worker.py#L150-L155`）
- **配置项与 CLI 参数**
- 可配置项集中在三处。环境变量 `JIUWENSWARM_DATA_DIR` 决定数据根目录，缺省回退到 `~/.jiuwenswarm`，模板包默认在 `<data>/agent/workspace/plugins/agent_templates/local/` 下按名解析（validate_template.py:L148-L173）。CLI 参数有两个：位置参数 `target`（包目录路径或 local/ 下的 agent-name），以及 `--no-hot-load` 只跑 L0+L1 并把 L2 标记为显式 SKIP（L953-L959、L972-L974）。
  - L2 子进程的运行参数硬编码：worker 路径取同目录的 validate_hot_load_worker.py，超时 120 秒（L35-L36）。
- Sources /
  - 来源：[jiuwenswarm/resources/agent/workspace/skills/agent-creator/scripts/validate_template.py:L148–L173](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/agent-creator/scripts/validate_template.py#L148-L173),
  - [jiuwenswarm/resources/agent/workspace/skills/agent-creator/scripts/validate_template.py:L953–L959](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/agent-creator/scripts/validate_template.py#L953-L959),
  - [jiuwenswarm/resources/agent/workspace/skills/agent-creator/scripts/validate_template.py:L972–L974](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/agent-creator/scripts/validate_template.py#L972-L974),
  - [jiuwenswarm/resources/agent/workspace/skills/agent-creator/scripts/validate_template.py:L35–L36](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/agent-creator/scripts/validate_template.py#L35-L36)
- **分层门控与 SKIP 语义的取舍**
- Inference / 设计推断（非作者历史意图）：
- 推断：L0/L1 全部通过才执行 L2 的门控让廉价的 stdlib 静态检查先行，只有静态干净的包才付出子进程热加载成本；但代价是环境性问题（openjiuwen 未安装、环境搭建失败、worker 超时或启动失败、stdout 不可解析）一律归为 SKIP 而非 FAIL，汇总输出 RESULT: PARTIAL 并明确提示“SKIP 不等于通过”，整体退出码要求三层全部 PASS 才为 0。
  - SKIP 的修复提示按来源区分：环境问题建议检查 openjiuwen 运行环境，超时提示检查包内在 import/绑定阶段卡住的 tool/rail，启动失败提示检查 python 与 worker 脚本。
- Sources /
  - 来源：[jiuwenswarm/resources/agent/workspace/skills/agent-creator/scripts/validate_template.py:L860–L907](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/agent-creator/scripts/validate_template.py#L860-L907),
  - [jiuwenswarm/resources/agent/workspace/skills/agent-creator/scripts/validate_template.py:L937–L941](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/agent-creator/scripts/validate_template.py#L937-L941),
  - [jiuwenswarm/resources/agent/workspace/skills/agent-creator/scripts/validate_template.py:L975–L987](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/agent-creator/scripts/validate_template.py#L975-L987),
  - jiuwenswarm/resources/agent/workspace/skills/agent-creator/scripts/validate_hot_load_worker.py:L150–L155
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/agent-creator/scripts/validate_hot_load_worker.py#L150-L155`）

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/config-resources/feature-agent-template-layered-validation.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-07
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/agent-creator/scripts/validate_template.py:L10-L14
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/agent-creator/scripts/validate_template.py:L949-L987
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/agent-creator/scripts/validate_hot_load_worker.py:L1-L11
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/agent-creator/scripts/validate_template.py:L1-L8
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/agent-creator/scripts/validate_template.py:L860-L907
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/agent-creator/scripts/validate_hot_load_worker.py:L1-L5
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/agent-creator/scripts/validate_template.py:L915-L946
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/agent-creator/scripts/validate_hot_load_worker.py:L150-L155
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/agent-creator/scripts/validate_template.py:L148-L173
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/agent-creator/scripts/validate_template.py:L953-L959
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/agent-creator/scripts/validate_template.py:L972-L974
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/agent-creator/scripts/validate_template.py:L35-L36
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/agent-creator/scripts/validate_template.py:L937-L941
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/agent-creator/scripts/validate_template.py:L975-L987
- 源页字段（feature）：agent-template-layered-validation
- 入口（entry_points）：jiuwenswarm/resources/agent/workspace/skills/agent-creator/scripts/validate_template.py
- 源页字段（source_globs）：jiuwenswarm/resources/agent/workspace/skills/agent-creator/scripts/validate_template.py；jiuwenswarm/resources/agent/workspace/skills/agent-creator/scripts/validate_hot_load_worker.py
