---
name: feature-depth-worktree
description: Worktree 隔离工作实现深读：_build_worktree_rail_via_config 的缓存复用、构造异常降级为 None 且不缓存、仅 enabled=True 的 WorktreeConfig、find_canonical_git_root 解析仓库根、缓存与吞异常的取舍推断、_check_worktree_path_safety helper 单测
metadata:
  scope: 收 interface_code.py 中 WorktreeRail 构建与 worktree 路径检查的实现级证据，来源另含 command_tools.py、test_command_safety.py；职责、接口与配置概览归 feature-worktree
---
# Worktree 隔离工作：实现深读

## 现状

- [[feature-worktree]]（功能概览） · [[agent-server-runtime-overview]]（owner 入口）
- **构造失败降级为禁用** WorktreeRail 构造抛出任意 Exception 时被 except Exception 捕获，仅记录一条包含异常信息的 warning（"WorktreeRail create failed"），随后返回 None，不缓存失败状态——下一次调用会重新尝试构造。
- 来源：[jiuwenswarm/server/runtime/agent_adapter/interface_code.py:L1860–L1870](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/agent_adapter/interface_code.py#L1860-L1870)
- **_build_worktree_rail_via_config：缓存命中即返回旧实例，未命中才构建 WorktreeRail 并写入缓存** 进入方法先查 `self._worktree_rail`：非空则记录 reuse cached instance 日志并 return 该缓存实例；为空则进入 try，以 `WorktreeRail(config=WorktreeConfig(enabled=True))` 构建并赋给 `self._worktree_rail`，可见片段止于该赋值。
- 来源：[jiuwenswarm/server/runtime/agent_adapter/interface_code.py:L1845–L1862](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/agent_adapter/interface_code.py#L1845-L1862)
- **_build_worktree_rail_via_config 返回 WorktreeRail | None；构造异常不缓存、下次调用重试** 契约：self._worktree_rail 已非 None 时直接返回缓存实例；否则构造 WorktreeRail、赋值缓存后返回；构造抛异常时仅记录 warning 并返回 None，缓存保持未设置，因此下一次调用会重试构造。调用方必须处理 None 返回值。
- 来源：[jiuwenswarm/server/runtime/agent_adapter/interface_code.py:L1845–L1870](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/agent_adapter/interface_code.py#L1845-L1870)
- **code 模式 WorktreeRail 仅设置 enabled=True，其余 WorktreeConfig 保持库默认（docstring 声明）** docstring（1852–1854）声明构造 WorktreeConfig 时只设置 enabled=True，其余选项保持 openjiuwen 库默认，直至引入配置 schema；所示方法内首个守卫是 1857–1859 的缓存命中（_worktree_rail is not None）直接 return 旧实例，不再进入 1860 起的 try 构造路径。
- 来源：[jiuwenswarm/server/runtime/agent_adapter/interface_code.py:L1845–L1860](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/agent_adapter/interface_code.py#L1845-L1860),
  - [jiuwenswarm/server/runtime/agent_adapter/interface_code.py:L44–L63](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/agent_adapter/interface_code.py#L44-L63)
- **直接实例化库侧 WorktreeRail；docstring 称仓库根由运行时 cwd 经 find_canonical_git_root 解析** 代码直接实例化库的 `WorktreeRail`/`WorktreeConfig`；docstring 称 WorktreeManager 用 `find_canonical_git_root` 从运行时 cwd 解析仓库根，而 agent cwd 在 init 时被 Workspace 锚到 project_dir，因此 worktree 落在用户真实仓库之下。
- 来源：[jiuwenswarm/server/runtime/agent_adapter/interface_code.py:L1848–L1852](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/agent_adapter/interface_code.py#L1848-L1852),
  - [jiuwenswarm/server/runtime/agent_adapter/interface_code.py:L1860–L1862](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/agent_adapter/interface_code.py#L1860-L1862)
- **收益：缓存命中避免重复构造 WorktreeRail；成本：构造异常被吞为 warning+None（推理）** 设计推断（非作者历史意图）：
- 推理：缓存命中分支（L1857–L1859）使重复调用无需重建 WorktreeRail；成本是 except Exception（L1868–L1870）吞掉所有构造异常，仅留 warning 日志与 None 返回，失败原因不向调用方传播。均限定于本片段实现，未断言任何调用方行为。
- 来源：[jiuwenswarm/server/runtime/agent_adapter/interface_code.py:L1857–L1870](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/agent_adapter/interface_code.py#L1857-L1870)
- **_check_worktree_path_safety 的 helper 单测（仅覆盖 helper，本轮未执行）** test_worktree_add_sibling_dir_blocked 借 _project_root fixture（monkeypatch 将 _context_project_root 固定为临时目录）调用 _check_worktree_path_safety("git worktree add ../foo main")，断言返回消息非空且含 .worktrees/ 与 ../；
  - test_worktree_add_inside_dot_worktrees_allowed 断言项目内 .worktrees/ 相对目标与绝对目标均返回 None。断言仅覆盖该路径检查 helper，未创建真实 worktree，返回 None 亦不代表命令可执行成功；测试本轮未运行。
- 来源：[tests/unit_tests/agents/test_command_safety.py:L313–L333](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/agents/test_command_safety.py#L313-L333),
  - [tests/unit_tests/agents/test_command_safety.py:L346–L364](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/agents/test_command_safety.py#L346-L364),
  - [jiuwenswarm/agents/harness/common/tools/command_tools.py:L545–L576](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/command_tools.py#L545-L576)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/agent-server-runtime/feature-depth-worktree.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-02；updated: 2026-10-02
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/server/runtime/agent_adapter/interface_code.py:L1860-L1870；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/server/runtime/agent_adapter/interface_code.py:L1845-L1862
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/server/runtime/agent_adapter/interface_code.py:L1848-L1852；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/server/runtime/agent_adapter/interface_code.py:L1860-L1862
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/server/runtime/agent_adapter/interface_code.py:L1845-L1870；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/server/runtime/agent_adapter/interface_code.py:L1857-L1870
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/server/runtime/agent_adapter/interface_code.py:L1845-L1860；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/server/runtime/agent_adapter/interface_code.py:L44-L63
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/agents/test_command_safety.py:L313-L333；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/agents/test_command_safety.py:L346-L364
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/command_tools.py:L545-L576
- 源页字段（feature）：worktree
- 入口（entry_points）：jiuwenswarm/server/runtime/agent_adapter/interface_code.py
- 源页字段（source_globs）：jiuwenswarm/server/runtime/agent_adapter/interface_code.py；jiuwenswarm/agents/harness/common/rails/*
