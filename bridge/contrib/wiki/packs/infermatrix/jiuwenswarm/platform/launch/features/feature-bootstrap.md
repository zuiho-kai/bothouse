---
name: feature-bootstrap
description: 初始化与服务启动：init_workspace.py 的 run_init(force, name) 与 main()，桌面包/pip/源码安装条件，初始化与常规启动分离的取舍及空工作区验证步骤
metadata:
  scope: 只收初始化与服务启动的职责边界、API、配置、设计取舍、数据流与验证要点；实现层深读归 feature-depth-bootstrap，多实例归 feature-instances
---
# 初始化与服务启动 的职责、接口与配置

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/launch/feature-bootstrap.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/init_workspace.py；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:docs/zh/安装指南.md
- 源页字段（feature）：bootstrap
- 入口（entry_points）：jiuwenswarm/init_workspace.py
- 源页字段（source_globs）：jiuwenswarm/init_workspace.py；jiuwenswarm/server/agent_ws_server.py；jiuwenswarm/app.py；jiuwenswarm/common/config.py；jiuwenswarm/common/utils.py；jiuwenswarm/debug_launcher.py；jiuwenswarm/resources/agent/workspace/skills/delayed-restart-app/launch_delayed_restart.py
  - jiuwenswarm/server/lifecycle.py；jiuwenswarm/gateway/app_gateway.py；jiuwenswarm/gateway/__init__.py；jiuwenswarm/gateway/channel_manager/channel_manager.py；scripts/harmony_entry.py；jiuwenswarm/common/process_supervision.py；jiuwenswarm/runtime/service.py
  - jiuwenswarm/start_services.py
- 本页是该功能的基本知识入口，基线 `f0a69728c96b`。它连接源码契约与上游功能文档；详细字段和行为仍沿固定引用核对。

### 职责与边界

- 创建运行工作区并建立配置、资源和服务入口。初始化与常规启动分开，避免每次启动都重建用户状态。 本页记录入口职责与边界；逐文件的类型、函数和依赖关系见同 owner 的源码接口记录。
- 源码与文档：[jiuwenswarm/init_workspace.py:L1–L177](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/init_workspace.py#L1-L177)；
  - [docs/zh/安装指南.md:L1–L572](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E5%AE%89%E8%A3%85%E6%8C%87%E5%8D%97.md#L1-L572)。

### 接口与调用入口（API）

- 可定位的实现声明包括 `run_init(force, name)`；`main()`。这些是源码定位入口，具体公共用户操作沿功能文档查证；本页不把内部符号直接当成稳定 HTTP API。参数、返回类型、错误传播和生命周期应在所列实现与调用方一起核对。
- 源码与文档：[jiuwenswarm/init_workspace.py:L1–L177](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/init_workspace.py#L1-L177)；
  - [docs/zh/安装指南.md:L1–L572](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E5%AE%89%E8%A3%85%E6%8C%87%E5%8D%97.md#L1-L572)。

### 配置入口与生效条件

- 安装方式包括桌面包、pip 和源码环境；初始化创建用户工作区后还必须配置默认对话模型。当前文档对 macOS 桌面包限定 arm64，源码和 pip 路径有自己的 Python 与 Node 条件；初始化参数与包安装参数分属不同命令，按实际部署方式核对。
- 源码与文档：[jiuwenswarm/init_workspace.py:L1–L177](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/init_workspace.py#L1-L177)；
  - [docs/zh/安装指南.md:L1–L572](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E5%AE%89%E8%A3%85%E6%8C%87%E5%8D%97.md#L1-L572)。

### 设计取舍

- **设计推断**：初始化将模板资源与用户工作区分开，便于服务启动复用配置；代价是升级时需要核对模板版本与已有用户配置，不能仅以安装包版本判断工作区内容已经迁移。初始化后的模型参数、运行端口和资源路径属于后续启动的独立条件。以上分析从所列接口与功能边界得出，不宣称作者曾评估所有替代方案。
- 源码与文档：[jiuwenswarm/init_workspace.py:L1–L177](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/init_workspace.py#L1-L177)；
  - [docs/zh/安装指南.md:L1–L572](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E5%AE%89%E8%A3%85%E6%8C%87%E5%8D%97.md#L1-L572)。

### 数据流与关联功能

- 创建运行工作区并建立配置、资源和服务入口。初始化与常规启动分开，避免每次启动都重建用户状态。 联调时结合[[feature-models]]（模型平台与 API 配置）、[[feature-instances]]（单机多实例）、[[feature-deployment]]（打包与部署）的入口、数据归属和生效条件查证；这些关联页解释不同阶段，不能只凭一项成功判定整个链路完成。
- 源码与文档：[jiuwenswarm/init_workspace.py:L1–L177](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/init_workspace.py#L1-L177)；
  - [docs/zh/安装指南.md:L1–L572](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E5%AE%89%E8%A3%85%E6%8C%87%E5%8D%97.md#L1-L572)。

### 怎样验证

- 在空工作区验证创建配置与资源，再在已有配置的工作区检查用户设置是否保留。分别验证初始化、服务启动和首次模型请求，把缺少模型配置与安装或资源路径失败区分开。这些是建议的验收步骤，本页没有记录上游运行测试已执行或已通过。
- 源码与文档：[jiuwenswarm/init_workspace.py:L1–L177](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/init_workspace.py#L1-L177)；
  - [docs/zh/安装指南.md:L1–L572](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E5%AE%89%E8%A3%85%E6%8C%87%E5%8D%97.md#L1-L572)。
