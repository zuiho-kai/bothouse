---
name: feature-plugin-package-initializer
description: plugin-creator 的 init_plugin.py 功能概览：JIUWENSWARM_DATA_DIR 与默认输出目录、验证入口（无测试）、命令行入口与 ValueError/OSError 错误契约、单文件脚手架控制流、永不覆盖与校验强度取舍、manifest.json/README.md 模板
metadata:
  scope: 只收 init_plugin.py 的配置、验证、API、架构、取舍与行为六个方面；逐方面的实现深读归 feature-depth-plugin-package-initializer
---
# plugin-creator 插件包脚手架初始化（init_plugin.py）

## 现状

- **环境变量与输出位置**
- 唯一配置项是环境变量 `JIUWENSWARM_DATA_DIR`：设置时数据根为该路径（支持 `~` 展开），未设置或为空白时默认 `~/.jiuwenswarm`。默认输出目录为 `<data-dir>/agent/workspace/plugins/plugin_packages/local/<plugin-name>/`，用法文本中亦有说明。
- Sources / 来源：[jiuwenswarm/resources/agent/workspace/skills/plugin-creator/scripts/init_plugin.py:L91–L103](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/plugin-creator/scripts/init_plugin.py#L91-L103),
  - [jiuwenswarm/resources/agent/workspace/skills/plugin-creator/scripts/init_plugin.py:L186–L191](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/plugin-creator/scripts/init_plugin.py#L186-L191)
- **验证入口**
- Inference / 设计推断（非作者历史意图）：
- 本片段未附带任何测试或文档证据，无法指出针对该脚本的既有测试入口；其行为只能由源码本身（如 158-162 行的存在性检查、141-145 行的名称校验）佐证。仓库其余部分的测试未在本次输入中展示。
- Sources / 来源：[jiuwenswarm/resources/agent/workspace/skills/plugin-creator/scripts/init_plugin.py:L141–L162](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/plugin-creator/scripts/init_plugin.py#L141-L162)
- **命令行入口与错误契约**
- CLI 入口为 `init_plugin.py <plugin-name>` 或 `init_plugin.py <path-to-package-dir>`（见文件头用法说明）。无参数时打印用法到 fd 1 并返回退出码 1。main() 仅捕获 `ValueError`（来自名称校验、路径约束与目录已存在检查），把异常文本写入 fd 1 并返回 1；目录创建与文件写入（init_package 内）抛出的 OSError 不在该捕获范围内，会产生未捕获的回溯。
  - 正常路径返回 0，并经 `os.write(1, ...)` 输出进度信息（docstring 注明是为规避 G.LOG.02 而避免 print/sys.stdout）。
- Sources / 来源：[jiuwenswarm/resources/agent/workspace/skills/plugin-creator/scripts/init_plugin.py:L1–L18](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/plugin-creator/scripts/init_plugin.py#L1-L18),
  - [jiuwenswarm/resources/agent/workspace/skills/plugin-creator/scripts/init_plugin.py:L184–L202](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/plugin-creator/scripts/init_plugin.py#L184-L202)
- **单文件 CLI 脚手架：解析目标目录并生成骨架**
- 本组件是一个自包含的 Python CLI 脚本，控制流为 main() → resolve_init_target()（把名称或显式路径解析为包目录）→ init_package()（创建目录并写入两个模板文件）。目录解析基于环境变量 JIUWENSWARM_DATA_DIR（默认 ~/.jiuwenswarm），包落在 <data-dir>/agent/workspace/plugins/plugin_packages/local/ 下。
  - init_package 对任何输入（含显式路径）统一执行 basename 的长度与 kebab-case（NAME_RE）校验，再做目标目录存在性检查（拒绝覆盖）。名称输入分支额外先经 _assert_package_id_available 检查 local 与 built_in 目录冲突；显式路径分支只要求父目录是 local plugin_packages，提前返回，不经 built_in 冲突检查。
- Sources / 来源：[jiuwenswarm/resources/agent/workspace/skills/plugin-creator/scripts/init_plugin.py:L91–L107](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/plugin-creator/scripts/init_plugin.py#L91-L107),
  - [jiuwenswarm/resources/agent/workspace/skills/plugin-creator/scripts/init_plugin.py:L129–L147](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/plugin-creator/scripts/init_plugin.py#L129-L147),
  - [jiuwenswarm/resources/agent/workspace/skills/plugin-creator/scripts/init_plugin.py:L150–L165](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/plugin-creator/scripts/init_plugin.py#L150-L165)
- **永不覆盖与轻量校验的取舍**
- 脚本采取"永不覆盖"策略：目标目录已存在即抛 ValueError，提示重命名或删除旧包（local 冲突）或换名（built_in 冲突）。校验强度按输入类型不同：名称输入受 kebab-case 正则、长度下限以及 local/built_in 双重冲突检查约束；显式路径输入绕过 built_in 冲突检查，但仍受父目录必须是 local plugin_packages 的约束，并统一受 init_package 内的 basename kebab-case/长度校验和目录存在性检查约束。
  - main() 只捕获 ValueError（返回退出码 1），目录/文件写操作可能抛出的 OSError 不在捕获范围。
- Sources / 来源：[jiuwenswarm/resources/agent/workspace/skills/plugin-creator/scripts/init_plugin.py:L129–L147](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/plugin-creator/scripts/init_plugin.py#L129-L147),
  - [jiuwenswarm/resources/agent/workspace/skills/plugin-creator/scripts/init_plugin.py:L150–L162](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/plugin-creator/scripts/init_plugin.py#L150-L162),
  - [jiuwenswarm/resources/agent/workspace/skills/plugin-creator/scripts/init_plugin.py:L196–L202](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/plugin-creator/scripts/init_plugin.py#L196-L202)
- **脚手架生成：manifest.json 与 README.md 模板**
- init_package() 在目标目录下生成两个骨架文件：`manifest.json`（由 MANIFEST_TEMPLATE 填入包名 id，version 固定 "1.0.0"、package_type "plugin"、source "local"）和 `README.md`（标题由包名 kebab-case 转为 Title Case）。manifest 中 display_name、display_description、default_init_input、tags、quick_inputs 为中英双语占位；
  - `description`（L26）是单个中文占位串，与双语字段区分。生成后输出提示 [TODO] 占位需在下一步填写。名称式输入额外经 _assert_package_id_available 检查与 local、built_in 两个既有包目录的 id 冲突：local 冲突提示可重命名或删除旧包后重试，built_in 冲突则要求换名。
- Sources / 来源：[jiuwenswarm/resources/agent/workspace/skills/plugin-creator/scripts/init_plugin.py:L21–L41](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/plugin-creator/scripts/init_plugin.py#L21-L41),
  - [jiuwenswarm/resources/agent/workspace/skills/plugin-creator/scripts/init_plugin.py:L114–L126](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/plugin-creator/scripts/init_plugin.py#L114-L126),
  - [jiuwenswarm/resources/agent/workspace/skills/plugin-creator/scripts/init_plugin.py:L164–L181](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/plugin-creator/scripts/init_plugin.py#L164-L181)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/config-resources/feature-plugin-package-initializer.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-07
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/plugin-creator/scripts/init_plugin.py:L91-L103
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/plugin-creator/scripts/init_plugin.py:L186-L191
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/plugin-creator/scripts/init_plugin.py:L141-L162
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/plugin-creator/scripts/init_plugin.py:L1-L18
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/plugin-creator/scripts/init_plugin.py:L184-L202
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/plugin-creator/scripts/init_plugin.py:L91-L107
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/plugin-creator/scripts/init_plugin.py:L129-L147
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/plugin-creator/scripts/init_plugin.py:L150-L165
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/plugin-creator/scripts/init_plugin.py:L150-L162
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/plugin-creator/scripts/init_plugin.py:L196-L202
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/plugin-creator/scripts/init_plugin.py:L21-L41
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/plugin-creator/scripts/init_plugin.py:L114-L126
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/plugin-creator/scripts/init_plugin.py:L164-L181
- 源页字段（feature）：plugin-package-initializer
- 入口（entry_points）：jiuwenswarm/resources/agent/workspace/skills/plugin-creator/scripts/init_plugin.py
- 源页字段（source_globs）：jiuwenswarm/resources/agent/workspace/skills/plugin-creator/scripts/init_plugin.py
