---
name: feature-plugin-package-layered-validator-1
description: validate_plugin.py 功能概览第 1 部分：L0/L1/L2 三层结构与子进程隔离、JIUWENSWARM_DATA_DIR 与 120 秒热加载超时等配置、无测试文件与 L2 冒烟自校验入口
metadata:
  scope: 只收三层结构、配置、测试与自校验入口三段；三层覆盖范围、隔离与 AST 近似取舍、CLI 入口与退出码归 feature-plugin-package-layered-validator-2；实现深读归 feature-depth-plugin-package-layered-validator
---
# plugin-creator 插件包分层校验器（validate_plugin.py L0/L1/L2）（1/2）

## 现状

- 拆分说明：本页是源页 `feature-plugin-package-layered-validator.md` 的第 1/2 部分；第 2 部分 [[feature-plugin-package-layered-validator-2]]
- **三层结构与进程边界**
- 校验分三层：L0 规范与质量（占位符残留、展示字段），L1 静态校验（加载阻塞项，纯 stdlib：json/ast/文件系统），L2 热加载由子进程运行 worker、主脚本只解析结果；L0/L1 都通过才执行 L2（validate_plugin.py:2-8, 955-963）。
  - L1 对 manifest 声明的 tools/rails 类做 AST 级检查（继承基类、无参构造、ToolCard 字面量、运行时路径策略），路径解析规则对齐加载器 `_resolve_new_manifest_path`（validate_plugin.py:197-222, 722-745, 448-491）。
  - 进程隔离的动机是让 openjiuwen 的运行时副作用（Runner.resource_mgr、DeepAgent）完全留在 worker 子进程内，主脚本不 import openjiuwen（worker:2-5, validate_plugin.py:801-803）；worker 内部再分三段：搭最简 agent（失败算环境问题 skip）、真实 load_plugin（失败算包问题 fail）、对绑定的 Tool/Rail 做冒烟并卸载（worker:163-306）。
- Sources / 来源：[jiuwenswarm/resources/agent/workspace/skills/plugin-creator/scripts/validate_plugin.py:L1–L15](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/plugin-creator/scripts/validate_plugin.py#L1-L15),
  - [jiuwenswarm/resources/agent/workspace/skills/plugin-creator/scripts/validate_plugin.py:L955–L968](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/plugin-creator/scripts/validate_plugin.py#L955-L968),
  - jiuwenswarm/resources/agent/workspace/skills/plugin-creator/scripts/validate_plugin_hot_load_worker.py:L136–L217
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/plugin-creator/scripts/validate_plugin_hot_load_worker.py#L136-L217`）
- **配置项与环境变量**
- 唯一的运行时配置是环境变量 `JIUWENSWARM_DATA_DIR`：非默认实例由宿主注入，缺省回退到 `~/.jiuwenswarm`；它决定插件包的查找目录 `<data>/agent/workspace/plugins/plugin_packages/local`（validate_plugin.py:157-170）。其余行为由模块内常量固定：热加载 worker 超时 120 秒（HOT_LOAD_TIMEOUT_SEC），worker 路径取脚本同目录（validate_plugin.py:34-35）；
  - TODO 扫描仅覆盖 .md/.py/.json 后缀并跳过 `__pycache__`/`.git`/`.state` 目录（validate_plugin.py:42-44）。CLI 层面用户只能通过 `--no-hot-load` 改变执行范围（validate_plugin.py:941-943）。
- Sources /
  - 来源：[jiuwenswarm/resources/agent/workspace/skills/plugin-creator/scripts/validate_plugin.py:L157–L170](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/plugin-creator/scripts/validate_plugin.py#L157-L170),
  - [jiuwenswarm/resources/agent/workspace/skills/plugin-creator/scripts/validate_plugin.py:L34–L44](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/plugin-creator/scripts/validate_plugin.py#L34-L44)
- **测试与自校验入口**
- 在所提供的源码切片中没有针对这两个脚本的测试文件；可观察到的验证入口是脚本自身的自校验路径：L2 冒烟本身会用良性输入逐个调用 Tool.invoke 和每个 Rail callback（含对 exception 事件注入 RuntimeError），并核对卸载数量，等于把运行时契约作为可执行断言（worker:57-133, 229-301）。主脚本对 worker 输出协议做了防御性处理：未知 status、无 JSON、超时均转为 SKIP 而非崩溃（validate_plugin.py:806-891）。此为部分输入的观察；不能据此断言仓库中不存在其他测试。
- Sources / 来源：jiuwenswarm/resources/agent/workspace/skills/plugin-creator/scripts/validate_plugin_hot_load_worker.py:L100–L133
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/plugin-creator/scripts/validate_plugin_hot_load_worker.py#L100-L133`）,
  - jiuwenswarm/resources/agent/workspace/skills/plugin-creator/scripts/validate_plugin_hot_load_worker.py:L288–L306
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/plugin-creator/scripts/validate_plugin_hot_load_worker.py#L288-L306`）,
  - [jiuwenswarm/resources/agent/workspace/skills/plugin-creator/scripts/validate_plugin.py:L823–L891](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/plugin-creator/scripts/validate_plugin.py#L823-L891)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/config-resources/feature-plugin-package-layered-validator.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-07
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/plugin-creator/scripts/validate_plugin.py:L1-L15
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/plugin-creator/scripts/validate_plugin.py:L955-L968
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/plugin-creator/scripts/validate_plugin_hot_load_worker.py:L136-L217
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/plugin-creator/scripts/validate_plugin.py:L157-L170
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/plugin-creator/scripts/validate_plugin.py:L34-L44
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/plugin-creator/scripts/validate_plugin_hot_load_worker.py:L100-L133
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/plugin-creator/scripts/validate_plugin_hot_load_worker.py:L288-L306
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/plugin-creator/scripts/validate_plugin.py:L823-L891
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/plugin-creator/scripts/validate_plugin.py:L230-L246
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/plugin-creator/scripts/validate_plugin.py:L258-L266
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/plugin-creator/scripts/validate_plugin.py:L522-L543
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/plugin-creator/scripts/validate_plugin.py:L648-L652
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/plugin-creator/scripts/validate_plugin.py:L806-L891
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/plugin-creator/scripts/validate_plugin.py:L513-L543
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/plugin-creator/scripts/validate_plugin.py:L782-L798
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/plugin-creator/scripts/validate_plugin.py:L933-L950
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/plugin-creator/scripts/validate_plugin.py:L157-L182
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/plugin-creator/scripts/validate_plugin.py:L906-L927
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/plugin-creator/scripts/validate_plugin.py:L955-L971
- 源页字段（feature）：plugin-package-layered-validator
- 入口（entry_points）：jiuwenswarm/resources/agent/workspace/skills/plugin-creator/scripts/validate_plugin.py
- 源页字段（source_globs）：jiuwenswarm/resources/agent/workspace/skills/plugin-creator/scripts/validate_plugin.py；jiuwenswarm/resources/agent/workspace/skills/plugin-creator/scripts/validate_plugin_hot_load_worker.py
