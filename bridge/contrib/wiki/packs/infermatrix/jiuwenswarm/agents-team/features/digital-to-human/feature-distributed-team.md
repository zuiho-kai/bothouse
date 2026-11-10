---
name: feature-distributed-team
description: 跨进程分布式 Team 的职责边界、is_distributed_mode / runtime_role 入口、team.storage 与 workspace 配置、设计取舍与双目录验证方法
metadata:
  scope: 只收跨进程分布式 Team 的功能概览（职责、入口、配置、取舍、验证）；实现深读归 feature-depth-distributed-team
---
# 跨进程分布式 Team 的职责、接口与配置

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/agents-team/feature-distributed-team.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/team/distributed_runtime.py；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:docs/zh/分布式Team.md
- 源页字段（feature）：distributed-team
- 入口（entry_points）：jiuwenswarm/agents/harness/team/distributed_runtime.py
- 源页字段（source_globs）：jiuwenswarm/agents/harness/team/distributed_runtime.py；jiuwenswarm/agents/harness/team/a2x/a2x_registry_runtime.py；jiuwenswarm/agents/harness/team/team_manager.py；jiuwenswarm/agents/harness/team/remote_member_bootstrap.py
- 本页是该功能的基本知识入口，基线 `f0a69728c96b`。它连接源码契约与上游功能文档；详细字段和行为仍沿固定引用核对。

### 职责与边界

- 分布式 Team 将成员放到不同进程或节点，仍由统一的服务入口协调。传输、身份、共享存储和单活会话语义共同决定能否完成跨节点闭环。 本页记录入口职责与边界；逐文件的类型、函数和依赖关系见同 owner 的源码接口记录。
- 源码与文档：[jiuwenswarm/agents/harness/team/distributed_runtime.py:L1–L412](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/team/distributed_runtime.py#L1-L412)；
  - [docs/zh/分布式Team.md:L1–L486](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E5%88%86%E5%B8%83%E5%BC%8FTeam.md#L1-L486)。

### 接口与调用入口（API）

- 可定位的实现声明包括 `is_distributed_mode(config_base)`；`runtime_role(config_base)`；`runtime_member_name(config_base, team_cfg)`；`parse_port(value, default, field_name)`；`normalize_distributed_transport_fields(config_base, team_cfg)`。这些是源码定位入口，具体公共用户操作沿功能文档查证；本页不把内部符号直接当成稳定 HTTP API。
  - 参数、返回类型、错误传播和生命周期应在所列实现与调用方一起核对。
- 源码与文档：[jiuwenswarm/agents/harness/team/distributed_runtime.py:L1–L412](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/team/distributed_runtime.py#L1-L412)；
  - [docs/zh/分布式Team.md:L1–L486](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E5%88%86%E5%B8%83%E5%BC%8FTeam.md#L1-L486)。

### 配置入口与生效条件

- 上游 YAML 示例的配置键包括 `team.storage.type`、`team.storage.params.connection_string`、`team.workspace.enabled`、`team.workspace.root_path`、`team.workspace.version_control`、`react.a2x_registry.base_url`。这些是示例字段，不单独证明源码默认值或全部优先级。 文档中的调用选项包括 `--extra`、`--index-url`、`--id`、`--host`、`--port`，适用命令与前置条件沿文档确认。
  - 修改设置时还要检查配置加载位置与本功能的装配或连接时机，不能只由“保存成功”判断当前运行实例已经采用新值。
- 源码与文档：[jiuwenswarm/agents/harness/team/distributed_runtime.py:L1–L412](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/team/distributed_runtime.py#L1-L412)；
  - [docs/zh/分布式Team.md:L1–L486](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E5%88%86%E5%B8%83%E5%BC%8FTeam.md#L1-L486)。

### 设计取舍

- **设计推断**：分布式成员跨进程运行，但业务入口仍为统一 AgentServer，便于复用 TeamManager；代价是传输身份、存储和 bootstrap 配置成为新的故障边界。每频道单活 session 使切换时资源容易归属，限制是多个 TUI 窗口不能同时运行分布式 Team。以上分析从所列接口与功能边界得出，不宣称作者曾评估所有替代方案。
- 源码与文档：[jiuwenswarm/agents/harness/team/distributed_runtime.py:L1–L412](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/team/distributed_runtime.py#L1-L412)；
  - [docs/zh/分布式Team.md:L1–L486](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E5%88%86%E5%B8%83%E5%BC%8FTeam.md#L1-L486)。

### 数据流与关联功能

- 分布式 Team 将成员放到不同进程或节点，仍由统一的服务入口协调。传输、身份、共享存储和单活会话语义共同决定能否完成跨节点闭环。 联调时结合[[feature-team]]（多智能体团队协作）、[[feature-instances]]（单机多实例）、[[feature-tui]]（TUI 对话与命令）的入口、数据归属和生效条件查证；这些关联页解释不同阶段，不能只凭一项成功判定整个链路完成。
- 源码与文档：[jiuwenswarm/agents/harness/team/distributed_runtime.py:L1–L412](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/team/distributed_runtime.py#L1-L412)；
  - [docs/zh/分布式Team.md:L1–L486](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E5%88%86%E5%B8%83%E5%BC%8FTeam.md#L1-L486)。

### 怎样验证

- 按文档用 leader 与 teammate 双目录配置验证任务、消息与结果闭环。切换或新建同频道 Team 会话时确认旧成员连接和 bootstrap 资源停止；再验证传输失败、身份不一致与存储不可用的诊断。这些是建议的验收步骤，本页没有记录上游运行测试已执行或已通过。
- 源码与文档：[jiuwenswarm/agents/harness/team/distributed_runtime.py:L1–L412](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/team/distributed_runtime.py#L1-L412)；
  - [docs/zh/分布式Team.md:L1–L486](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E5%88%86%E5%B8%83%E5%BC%8FTeam.md#L1-L486)。
