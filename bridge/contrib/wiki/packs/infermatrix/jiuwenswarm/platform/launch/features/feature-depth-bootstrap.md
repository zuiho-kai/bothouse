---
name: feature-depth-bootstrap
description: 初始化与服务启动实现深读：run_init 返回值契约与默认/命名实例分支、JIUWENSWARM_HOME 与默认工作区路径、parse_known_args 取舍、语言选择系统测试、命名实例对 instance_manager 端口预留的依赖
metadata:
  scope: 只收初始化流程的实现层深读条目；功能概览归 feature-bootstrap
---
# 初始化与服务启动：实现深读

## 现状

- [[feature-bootstrap]]（功能概览） · [[launch-overview]]（owner 入口）
- **run_init 的返回值契约** run_init(force, name) 返回 int：实例名校验失败（56-61 行）、实例运行中、或 init_user_workspace 返回 "cancelled"（146-147 行，含用户拒绝确认和语言选择取消——utils.py 1674-1677 行 lang 为 None 也返回 "cancelled"）时返回 1；命名实例初始化成功在 143-144 行返回 0。调用方 main() 原样返回该值（173 行），未展示的行不能证明它成为进程退出码。
- 来源：[jiuwenswarm/init_workspace.py:L44–L151](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/init_workspace.py#L44-L151),
  - [jiuwenswarm/common/utils.py:L1674–L1677](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/utils.py#L1674-L1677)
- **JIUWENSWARM_HOME 与默认工作区路径** 默认工作区是 get_user_home() / ".jiuwenswarm"（init_workspace.py 68-69 行）。get_user_home 的优先级是：缓存的 _user_home 首先命中，其次 JIUWENSWARM_HOME 环境变量，最后 Path.home()（utils.py 386-394 行）。因此一旦模块内已缓存 _user_home，之后设置 JIUWENSWARM_HOME 不会改变本次返回值。
- 来源：[jiuwenswarm/common/utils.py:L378–L394](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/utils.py#L378-L394),
  - [jiuwenswarm/init_workspace.py:L63–L71](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/init_workspace.py#L63-L71)
- **parse_known_args 的取舍** 设计推断（非作者历史意图）：
- main() 用 parse_known_args 而非 parse_args，源码注释说明这是为了让 main() 在 pytest（sys.argv 残留测试路径）下不因未知参数 SystemExit。推断（inference）：代价是真实命令行上的拼写错误参数（如 --nmae）会被静默忽略，以默认值继续执行而非报错。
- 来源：[jiuwenswarm/init_workspace.py:L154–L173](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/init_workspace.py#L154-L173)
- **语言选择与默认值的系统测试** tests/system_tests/test_init_workspace.py 的 TestPromptPreferredLanguage 通过 monkeypatch 模拟输入断言：选 "1"/"zh" 得 "zh"、"2"/"en" 得 "en"，输入 no/n/q/invalid 返回 None；TestResolvePreferredLanguage.test_resolve_default_to_zh 断言无配置文件时语言默认 "zh"。这是对初始化语言交互契约的断言记录，不证明当前已运行通过。
- 来源：[tests/system_tests/test_init_workspace.py:L54–L177](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/system_tests/test_init_workspace.py#L54-L177)
- **命名实例初始化对 instance_manager 端口预留的依赖** run_init 的命名实例分支直接复用 jiuwenswarm.instance_manager（27-41 行导入）：get_instance_index/calculate_instance_ports 算出本组端口后逐一 is_port_available("127.0.0.1", p) 检测（110-113 行），有冲突时先 collect_all_ports(exclude_name=name) 排除兄弟实例，
  - 再 find_available_ports(base_index=index, scan_range=20, exclude_ports=...) 向上扫描（117-123 行），最后 update_instances_yaml + create_bootstrap_env 落盘（138、141 行）。源码注释（106-109 行）说明目的：让实例创建后立即可启动，否则首次 jiuwenswarm-start --name 会撞端口并退回启动时兜底。
- 来源：[jiuwenswarm/init_workspace.py:L26–L41](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/init_workspace.py#L26-L41),
  - [jiuwenswarm/init_workspace.py:L100–L144](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/init_workspace.py#L100-L144)
- **run_init default branch (no --name, no -f): initialize ~/.jiuwenswarm, return 0 when not cancelled** Without --name and -f, `if name:`/`elif force:` are both false, run_init skips the running check and sets the workspace to `get_user_home()/.jiuwenswarm`,
  - calls `init_user_workspace(overwrite=False, workspace_dir=...)` (deletion/confirmation handled by it); when target is not "cancelled", it logs `initialized: {target}` and returns 0.
- 来源：[jiuwenswarm/init_workspace.py:L44–L98](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/init_workspace.py#L44-L98),
  - [jiuwenswarm/init_workspace.py:L146–L151](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/init_workspace.py#L146-L151),
  - [jiuwenswarm/init_workspace.py:L154–L173](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/init_workspace.py#L154-L173)
- **run_init: named instance running blocks init and returns 1; port group scan failure only warns and degrades** When --name is given and `get_instance_status(config).running` is true, run_init logs the PID ERROR and --stop hint and returns 1 (before calling init_user_workspace);
  - when --name is given and target is not "cancelled", if the index's port group has conflicts and `find_available_ports(scan_range=20)` returns None, it only logs a WARNING, still calls update_instances_yaml with the index's ports and returns 0.
- 来源：[jiuwenswarm/init_workspace.py:L73–L98](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/init_workspace.py#L73-L98),
  - [jiuwenswarm/init_workspace.py:L100–L144](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/init_workspace.py#L100-L144)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/launch/feature-depth-bootstrap.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-02；updated: 2026-10-02
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/init_workspace.py:L154-L173；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/system_tests/test_init_workspace.py:L54-L177
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/init_workspace.py:L44-L151；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/common/utils.py:L1674-L1677
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/common/utils.py:L378-L394；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/init_workspace.py:L63-L71
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/init_workspace.py:L26-L41；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/init_workspace.py:L100-L144
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/init_workspace.py:L44-L98；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/init_workspace.py:L146-L151
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/init_workspace.py:L73-L98
- 源页字段（feature）：bootstrap
- 入口（entry_points）：jiuwenswarm/init_workspace.py
- 源页字段（source_globs）：jiuwenswarm/init_workspace.py
