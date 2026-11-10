---
name: feature-depth-plugin-package-initializer
description: init_plugin.py 实现深读：main 创建 manifest.json 与 README.md 骨架、返回码契约、数据目录默认 ~/.jiuwenswarm、拒绝覆盖与显式路径绕过重名预检、标准库依赖、OSError 不被捕获、SKILL.md mode=create 手工流程（未执行）
metadata:
  scope: 收 init_plugin.py 的流程、API、配置、取舍、依赖、失败模式与手工验收的实现深读，来源另含 SKILL.md；功能概览归 feature-plugin-package-initializer
---
# plugin-creator 插件包脚手架初始化：实现深读

## 现状

- [[feature-plugin-package-initializer]]（功能概览） · [[config-resources-overview-1]]、[[config-resources-overview-2]]（owner 入口）
- **main: 传入 kebab-case 名称时在 local plugin_packages 下创建含 manifest.json 与 README.md 的骨架目录** main 校验 argv 长度后调用 resolve_init_target(sys.argv[1])，若名称匹配 NAME_RE 且 local/built_in 中均无同名目录，则 init_package 创建 pkg_dir（先 mkdir parents），
  - 写入由 MANIFEST_TEMPLATE 和 README_TEMPLATE 填充占位符得到的 manifest.json 与 README.md，通过 write_stdout 输出进度后返回 0。
- 来源：[jiuwenswarm/resources/agent/workspace/skills/plugin-creator/scripts/init_plugin.py:L184–L202](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/plugin-creator/scripts/init_plugin.py#L184-L202),
  - [jiuwenswarm/resources/agent/workspace/skills/plugin-creator/scripts/init_plugin.py:L150–L181](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/plugin-creator/scripts/init_plugin.py#L150-L181)
- **接受 kebab-case 包名或显式路径参数，返回 int 状态码** main() 在无参数时经 write_stdout 输出用法说明并 return 1；有参数时 resolve_init_target(sys.argv[1]) 接受包名或含分隔符的路径，init_package 成功后 return 0，ValueError 被捕获并把消息写到 stdout 后 return 1；脚本入口 raise SystemExit(main())。
- 来源：[jiuwenswarm/resources/agent/workspace/skills/plugin-creator/scripts/init_plugin.py:L184–L206](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/plugin-creator/scripts/init_plugin.py#L184-L206),
  - [jiuwenswarm/resources/agent/workspace/skills/plugin-creator/scripts/init_plugin.py:L129–L131](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/plugin-creator/scripts/init_plugin.py#L129-L131)
- **落盘根由 JIUWENSWARM_DATA_DIR 决定，未设置或空白时默认 ~/.jiuwenswarm** get_jiuwenswarm_data_dir 读取环境变量 JIUWENSWARM_DATA_DIR 并 strip，非空则 Path(raw).expanduser()，否则 Path.home()/".jiuwenswarm"；local 目录固定追加 agent/workspace/plugins/plugin_packages/local。
- 来源：[jiuwenswarm/resources/agent/workspace/skills/plugin-creator/scripts/init_plugin.py:L91–L103](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/plugin-creator/scripts/init_plugin.py#L91-L103)
- **拒绝覆盖已有包换取安全，代价是需重命名或删除；显式路径绕过重名预检** 设计推断（非作者历史意图）：
- 收益（推断）：目标目录已存在时 raise 而非覆盖，避免破坏现有包，错误信息给出 rename/delete 两种出路。成本（推断）：按名创建前须先处理旧包；且含分隔符的显式路径分支只校验父目录必须是 local 目录，不执行 _assert_package_id_available 的 local/built_in 重名检查。
- 来源：[jiuwenswarm/resources/agent/workspace/skills/plugin-creator/scripts/init_plugin.py:L129–L147](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/plugin-creator/scripts/init_plugin.py#L129-L147),
  - [jiuwenswarm/resources/agent/workspace/skills/plugin-creator/scripts/init_plugin.py:L158–L162](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/plugin-creator/scripts/init_plugin.py#L158-L162)
- **仅依赖标准库模块 os/re/sys/pathlib** 所示 import 区只引入 Python 标准库（os、re、sys、pathlib.Path），未显示任何仓库内或第三方导入；因此该脚本在所示范围内不与仓库其他 Python 模块耦合。
- 来源：[jiuwenswarm/resources/agent/workspace/skills/plugin-creator/scripts/init_plugin.py:L10–L13](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/plugin-creator/scripts/init_plugin.py#L10-L13)
- **main 仅捕获 ValueError 并返回 1；init_package 内 mkdir 抛出的 OSError 不被捕获** main() 的 try 仅包裹 resolve_init_target 与 init_package 并只捕获 ValueError，将异常文本经 write_stdout 写出后 return 1。因此名称/路径校验与目录已存在检查（如 L158–L162 的 pkg_dir.exists() 分支、L134–L139 的显式路径父目录约束）都会转为消息加返回值 1；
  - 但 init_package 在 L164–L165 调用 mkdir 时抛出的 OSError 不在该 except 子句内，将作为未捕获异常传播，而非返回 1。
- 来源：[jiuwenswarm/resources/agent/workspace/skills/plugin-creator/scripts/init_plugin.py:L196–L202](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/plugin-creator/scripts/init_plugin.py#L196-L202),
  - [jiuwenswarm/resources/agent/workspace/skills/plugin-creator/scripts/init_plugin.py:L150–L165](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/plugin-creator/scripts/init_plugin.py#L150-L165),
  - [jiuwenswarm/resources/agent/workspace/skills/plugin-creator/scripts/init_plugin.py:L129–L147](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/plugin-creator/scripts/init_plugin.py#L129-L147),
  - [jiuwenswarm/resources/agent/workspace/skills/plugin-creator/scripts/init_plugin.py:L114–L126](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/plugin-creator/scripts/init_plugin.py#L114-L126)
- **SKILL.md 记录的 mode=create 手工初始化步骤（本轮未执行）** 文档中的人工验收步骤（本轮未执行）：
- 文档规定仅 mode=create 执行 `python3 <skill_dir>/scripts/init_plugin.py <plugin-name>`，脚本自行解析落盘路径并输出到 stdout，模板文件带 [TODO] 占位符，且勿手建目录。这是已记录的手工流程，本轮未执行；所示输入未包含任何自动化测试或其断言。
- 来源：[jiuwenswarm/resources/agent/workspace/skills/plugin-creator/SKILL.md:L87–L97](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/plugin-creator/SKILL.md#L87-L97)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/config-resources/feature-depth-plugin-package-initializer.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/plugin-creator/scripts/init_plugin.py:L184-L202
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/plugin-creator/scripts/init_plugin.py:L150-L181
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/plugin-creator/scripts/init_plugin.py:L184-L206
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/plugin-creator/scripts/init_plugin.py:L129-L131
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/plugin-creator/scripts/init_plugin.py:L91-L103
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/plugin-creator/scripts/init_plugin.py:L129-L147
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/plugin-creator/scripts/init_plugin.py:L158-L162
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/plugin-creator/scripts/init_plugin.py:L10-L13
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/plugin-creator/SKILL.md:L87-L97
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/plugin-creator/scripts/init_plugin.py:L196-L202
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/plugin-creator/scripts/init_plugin.py:L150-L165
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/plugin-creator/scripts/init_plugin.py:L114-L126
- 源页字段（feature）：plugin-package-initializer
- 入口（entry_points）：jiuwenswarm/resources/agent/workspace/skills/plugin-creator/scripts/init_plugin.py
- 源页字段（source_globs）：jiuwenswarm/resources/agent/workspace/skills/plugin-creator/scripts/init_plugin.py
