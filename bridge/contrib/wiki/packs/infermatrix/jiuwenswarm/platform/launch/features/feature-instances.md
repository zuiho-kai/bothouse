---
name: feature-instances
description: 单机多实例：create_bootstrap_env、create_bootstrap_env_for_name、load_instance_bootstrap_by_name 入口，上游 YAML 示例键、JIUWENSWARM_HOME、--name/--workspace/--list/--status/--stop/--restart 选项，实例隔离取舍与双实例验证步骤
metadata:
  scope: 只收单机多实例的职责边界、API、配置、设计取舍、数据流与验证要点；实现层深读归 feature-depth-instances，初始化归 feature-bootstrap
---
# 单机多实例 的职责、接口与配置

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/launch/feature-instances.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/instance_manager/bootstrap.py；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:docs/zh/单机多实例运行.md
- 源页字段（feature）：instances
- 入口（entry_points）：jiuwenswarm/instance_manager/bootstrap.py
- 源页字段（source_globs）：jiuwenswarm/instance_manager/bootstrap.py；jiuwenswarm/instance_manager/*.py；jiuwenswarm/dotenv_early.py；jiuwenswarm/gateway/app_gateway.py；jiuwenswarm/instance_manager/__init__.py；jiuwenswarm/instance_manager/config.py；jiuwenswarm/instance_manager/lock.py
  - jiuwenswarm/start_services.py；jiuwenswarm/instance_manager/status.py；jiuwenswarm/instance_manager/yaml.py
- 本页是该功能的基本知识入口，基线 `f0a69728c96b`。它连接源码契约与上游功能文档；详细字段和行为仍沿固定引用核对。

### 职责与边界

- 以实例配置、锁和端口信息隔离同机进程。配置目录与运行时端口属于不同生命期，排障时需要同时检查持久文件和当前进程。 本页记录入口职责与边界；逐文件的类型、函数和依赖关系见同 owner 的源码接口记录。
- 源码与文档：[jiuwenswarm/instance_manager/bootstrap.py:L1–L202](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/instance_manager/bootstrap.py#L1-L202)；
  - [docs/zh/单机多实例运行.md:L1–L249](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E5%8D%95%E6%9C%BA%E5%A4%9A%E5%AE%9E%E4%BE%8B%E8%BF%90%E8%A1%8C.md#L1-L249)。

### 接口与调用入口（API）

- 可定位的实现声明包括 `create_bootstrap_env(config)`；`create_bootstrap_env_for_name(name, workspace)`；`load_instance_bootstrap_by_name(name)`。这些是源码定位入口，具体公共用户操作沿功能文档查证；本页不把内部符号直接当成稳定 HTTP API。参数、返回类型、错误传播和生命周期应在所列实现与调用方一起核对。
- 源码与文档：[jiuwenswarm/instance_manager/bootstrap.py:L1–L202](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/instance_manager/bootstrap.py#L1-L202)；
  - [docs/zh/单机多实例运行.md:L1–L249](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E5%8D%95%E6%9C%BA%E5%A4%9A%E5%AE%9E%E4%BE%8B%E8%BF%90%E8%A1%8C.md#L1-L249)。

### 配置入口与生效条件

- 上游 YAML 示例的配置键包括 `instances.dev.workspace`、`instances.dev.ports.agent_server`、`instances.dev.ports.web`、`instances.dev.ports.gateway`、`instances.dev.ports.frontend`、`instances.prod.workspace`、`instances.prod.ports.agent_server`、`instances.prod.ports.web`。这些是示例字段，不单独证明源码默认值或全部优先级。
  - 实现中直接读取的环境变量名称包括 `JIUWENSWARM_HOME`；名称与实际部署值分开核对。 文档中的调用选项包括 `--name`、`--workspace`、`--list`、`--status`、`--stop`、`--restart`，适用命令与前置条件沿文档确认。 修改设置时还要检查配置加载位置与本功能的装配或连接时机，不能只由“保存成功”判断当前运行实例已经采用新值。
- 源码与文档：[jiuwenswarm/instance_manager/bootstrap.py:L1–L202](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/instance_manager/bootstrap.py#L1-L202)；
  - [docs/zh/单机多实例运行.md:L1–L249](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E5%8D%95%E6%9C%BA%E5%A4%9A%E5%AE%9E%E4%BE%8B%E8%BF%90%E8%A1%8C.md#L1-L249)。

### 设计取舍

- **设计推断**：每个命名实例拥有独立工作区与端口，适合开发和生产配置隔离；代价是配置、PID、锁和端口登记都必须按实例定位。同 Gateway 的多窗口 TUI 是会话隔离，两者不能互相替代。以上分析从所列接口与功能边界得出，不宣称作者曾评估所有替代方案。
- 源码与文档：[jiuwenswarm/instance_manager/bootstrap.py:L1–L202](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/instance_manager/bootstrap.py#L1-L202)；
  - [docs/zh/单机多实例运行.md:L1–L249](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E5%8D%95%E6%9C%BA%E5%A4%9A%E5%AE%9E%E4%BE%8B%E8%BF%90%E8%A1%8C.md#L1-L249)。

### 数据流与关联功能

- 以实例配置、锁和端口信息隔离同机进程。配置目录与运行时端口属于不同生命期，排障时需要同时检查持久文件和当前进程。 联调时结合[[feature-bootstrap]]（初始化与服务启动）、[[feature-tui]]（TUI 对话与命令）、[[feature-desktop]]（桌面宿主与自动更新）的入口、数据归属和生效条件查证；这些关联页解释不同阶段，不能只凭一项成功判定整个链路完成。
- 源码与文档：[jiuwenswarm/instance_manager/bootstrap.py:L1–L202](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/instance_manager/bootstrap.py#L1-L202)；
  - [docs/zh/单机多实例运行.md:L1–L249](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E5%8D%95%E6%9C%BA%E5%A4%9A%E5%AE%9E%E4%BE%8B%E8%BF%90%E8%A1%8C.md#L1-L249)。

### 怎样验证

- 启动两个不同名字的实例，分别核对配置目录、PID 和监听端口；检查重复启动的锁处理与端口冲突回退。再从不同客户端连接，确认会话和模型设置属于预期实例。这些是建议的验收步骤，本页没有记录上游运行测试已执行或已通过。
- 源码与文档：[jiuwenswarm/instance_manager/bootstrap.py:L1–L202](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/instance_manager/bootstrap.py#L1-L202)；
  - [docs/zh/单机多实例运行.md:L1–L249](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E5%8D%95%E6%9C%BA%E5%A4%9A%E5%AE%9E%E4%BE%8B%E8%BF%90%E8%A1%8C.md#L1-L249)。
