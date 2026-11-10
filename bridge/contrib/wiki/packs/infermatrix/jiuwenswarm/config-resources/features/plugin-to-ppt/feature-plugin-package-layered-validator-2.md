---
name: feature-plugin-package-layered-validator-2
description: validate_plugin.py 功能概览第 2 部分：L0/L1/L2 实际覆盖范围、进程隔离与 AST 近似取舍、CLI 入口与退出码（PASS/FAIL/PARTIAL）
metadata:
  scope: 只收覆盖范围、取舍、CLI 与退出码三段；三层结构、配置、测试与自校验入口归 feature-plugin-package-layered-validator-1；实现深读归 feature-depth-plugin-package-layered-validator
---
# plugin-creator 插件包分层校验器（validate_plugin.py L0/L1/L2）（2/2）

## 现状

- 拆分说明：本页是源页 `feature-plugin-package-layered-validator.md` 的第 2/2 部分；第 1 部分 [[feature-plugin-package-layered-validator-1]]
- **三层校验的实际覆盖范围**
- L0 质量层扫描包内残留的 `[TODO` 占位符，但仅限 .md/.py/.json 后缀、跳过 `__pycache__`/`.git`/`.state` 目录且忽略读不了的文件；并校验 manifest 的 i18n 展示字段、tags/quick_inputs 恰好 3 项、`default_init_input` 与 `quick_inputs[0]` 的 en/zh 值一致、README.md 存在等。
  - L1 静态层检查 manifest 基本项（package_type=plugin、source=local、id 等于目录名等）、skills 目录的 SKILL.md frontmatter，以及对 tools/rails 声明类做 AST 检查（继承基类、无参构造、async invoke、ToolCard 字面量的 id/name/input_params）；找不到 ToolCard 字面量或 input_params 不是字面量 dict 时只降级为 warning，且 `mcps` 仅在取值为真时才报错。
  - L2 在子进程中经真实 `load_plugin` 链加载并对绑定的 Tool.invoke 和每个 Rail callback 做冒烟，最后核对卸载数量。
- Sources /
  - 来源：[jiuwenswarm/resources/agent/workspace/skills/plugin-creator/scripts/validate_plugin.py:L230–L246](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/plugin-creator/scripts/validate_plugin.py#L230-L246),
  - [jiuwenswarm/resources/agent/workspace/skills/plugin-creator/scripts/validate_plugin.py:L258–L266](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/plugin-creator/scripts/validate_plugin.py#L258-L266),
  - [jiuwenswarm/resources/agent/workspace/skills/plugin-creator/scripts/validate_plugin.py:L522–L543](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/plugin-creator/scripts/validate_plugin.py#L522-L543),
  - [jiuwenswarm/resources/agent/workspace/skills/plugin-creator/scripts/validate_plugin.py:L648–L652](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/plugin-creator/scripts/validate_plugin.py#L648-L652)
- **进程隔离与静态近似带来的取舍**
- Inference / 设计推断（非作者历史意图）：
- 成本侧：L2 依赖 openjiuwen 运行环境，环境问题（ImportError、agent 搭建失败、worker 崩溃/超时/无 JSON）会以有效 skip payload 或主脚本的防御分支转化为 SKIP，退出码仍为 1（PARTIAL），用户需要区分“包坏”与“环境不可用”。收益侧：主脚本完全不 import openjiuwen，运行时副作用隔离在子进程 worker 内，且 worker 用真实 load_plugin/unload_extension 链和 Tool.invoke、Rail callback 冒烟验证运行时契约。
  - L1 选择 AST 近似而非导入执行：找不到字面量 ToolCard(...) 或 input_params 非字面量 dict 时只降级为 warning、放弃该项检查，换取纯 stdlib、无副作用且全量报错的安全性。
- Sources /
  - 来源：[jiuwenswarm/resources/agent/workspace/skills/plugin-creator/scripts/validate_plugin.py:L806–L891](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/plugin-creator/scripts/validate_plugin.py#L806-L891),
  - jiuwenswarm/resources/agent/workspace/skills/plugin-creator/scripts/validate_plugin_hot_load_worker.py:L136–L217
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/plugin-creator/scripts/validate_plugin_hot_load_worker.py#L136-L217`）,
  - [jiuwenswarm/resources/agent/workspace/skills/plugin-creator/scripts/validate_plugin.py:L513–L543](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/plugin-creator/scripts/validate_plugin.py#L513-L543),
  - [jiuwenswarm/resources/agent/workspace/skills/plugin-creator/scripts/validate_plugin.py:L782–L798](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/plugin-creator/scripts/validate_plugin.py#L782-L798)
- **CLI 入口与退出码契约**
- 公开入口是命令行 `validate_plugin.py <target> [--no-hot-load]`：target 既可以是包目录路径，也可以是 `local/` 下的 plugin-name——resolve_pkg 先按目录解析，失败时回退到 `<JIUWENSWARM_DATA_DIR 或 ~/.jiuwenswarm>/agent/workspace/plugins/plugin_packages/local/<name>`，都找不到则向 stdout 写 Error 并返回 1（validate_plugin.py:937-950, 173-182）。
  - 退出码 0 仅当 L0/L1/L2 三层状态全为 PASS（含被跳过的 L2 不算 PASS），否则为 1（validate_plugin.py:970-971）；`--no-hot-load` 或 L0/L1 有错时 L2 记为 SKIP（validate_plugin.py:956-961）。汇总的 RESULT 行按优先级输出：任一层有 errors 时为 FAIL；仅当 L0/L1 无错且 L2 无错但状态为 SKIP 时输出 RESULT: PARTIAL（validate_plugin.py:906-927）。
- Sources /
  - 来源：[jiuwenswarm/resources/agent/workspace/skills/plugin-creator/scripts/validate_plugin.py:L933–L950](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/plugin-creator/scripts/validate_plugin.py#L933-L950),
  - [jiuwenswarm/resources/agent/workspace/skills/plugin-creator/scripts/validate_plugin.py:L157–L182](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/plugin-creator/scripts/validate_plugin.py#L157-L182),
  - [jiuwenswarm/resources/agent/workspace/skills/plugin-creator/scripts/validate_plugin.py:L906–L927](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/plugin-creator/scripts/validate_plugin.py#L906-L927),
  - [jiuwenswarm/resources/agent/workspace/skills/plugin-creator/scripts/validate_plugin.py:L955–L971](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/plugin-creator/scripts/validate_plugin.py#L955-L971)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/config-resources/feature-plugin-package-layered-validator.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-07
