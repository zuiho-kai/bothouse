---
name: feature-sandbox
description: JiuwenBox 隔离执行功能知识：沙箱创建、命令执行与后台任务边界，get_sandbox_manager/lifespan/create_app 定位入口，filesystem_policy YAML 键与 JIUWENBOX_UDS_PATH 等配置、取舍与验证步骤
metadata:
  scope: 只收隔离执行的功能入口级知识；推理隐私代理归 feature-sandbox-privacy-proxy，隔离执行的逐点实现深读归 feature-depth-sandbox
---
# JiuwenBox 隔离执行 的职责、接口与配置

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/sandbox-runtime/feature-sandbox.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenbox/src/jiuwenbox/server/app.py；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenbox/README_CN.md
- 源页字段（feature）：sandbox
- 入口（entry_points）：jiuwenbox/src/jiuwenbox/server/app.py
- 源页字段（source_globs）：jiuwenbox/src/jiuwenbox/server/app.py；jiuwenbox/src/jiuwenbox/*；jiuwenbox/src/jiuwenbox/supervisor/bwrap.py；jiuwenbox/src/jiuwenbox/supervisor/cgroup.py；jiuwenbox/src/jiuwenbox/server/runtime/process.py；jiuwenbox/src/jiuwenbox/server/sandbox_manager.py
  - jiuwenbox/src/jiuwenbox/supervisor/sandbox_daemon.py；jiuwenbox/src/jiuwenbox/server/auth.py；jiuwenbox/src/jiuwenbox/bundled_configs.py；jiuwenbox/src/jiuwenbox/cli/jiuwenbox.py；jiuwenbox/docker/Dockerfile；jiuwenbox/scripts/build_docker.sh；jiuwenbox/scripts/run_docker.sh
  - jiuwenbox/src/jiuwenbox/models/policy.py；jiuwenbox/src/jiuwenbox/server/routes/policy.py；jiuwenbox/src/jiuwenbox/logging_config.py；jiuwenbox/src/jiuwenbox/server/routes/mcp.py；jiuwenbox/src/jiuwenbox/models/__init__.py；jiuwenswarm/server/sandbox/jiuwenbox_runner.py
  - jiuwenbox/src/jiuwenbox/server/launcher.py；jiuwenbox/src/jiuwenbox/server/workspace.py；jiuwenbox/src/jiuwenbox/supervisor/landlock_launcher.py；jiuwenbox/src/jiuwenbox/supervisor/landlock.py；jiuwenbox/src/jiuwenbox/supervisor/network.py
  - jiuwenswarm/server/runtime/no_host_fallback_jiuwenbox.py；jiuwenbox/src/jiuwenbox/server/policy_reader.py；jiuwenswarm/common/config.py；jiuwenswarm/agents/harness/common/tools/command_tools.py；jiuwenswarm/server/agent_ws_server.py
  - jiuwenbox/src/jiuwenbox/supervisor/daemon_ipc.py；jiuwenswarm/server/runtime/agent_adapter/sysop_builder.py；jiuwenswarm/server/sandbox/host_port.py；jiuwenbox/src/jiuwenbox/models/sandbox.py；jiuwenswarm/server/runtime/sandbox_no_host_fallback.py
  - jiuwenbox/src/jiuwenbox/server/policy_engine.py；jiuwenbox/src/jiuwenbox/server/routes/sandbox.py；jiuwenbox/src/jiuwenbox/supervisor/seccomp.py
- 本页是该功能的基本知识入口，基线 `f0a69728c96b`。它连接源码契约与上游功能文档；详细字段和行为仍沿固定引用核对。

### 职责与边界

- JiuwenBox 服务管理隔离执行、策略和进程资源。沙箱创建、命令执行、后台任务和审计状态具有独立接口，真实隔离效果取决于系统能力与策略接线。 本页记录入口职责与边界；逐文件的类型、函数和依赖关系见同 owner 的源码接口记录。
- 源码与文档：[jiuwenbox/src/jiuwenbox/server/app.py:L1–L532](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenbox/src/jiuwenbox/server/app.py#L1-L532)；
  - [jiuwenbox/README_CN.md:L1–L903](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenbox/README_CN.md#L1-L903)。

### 接口与调用入口（API）

- 可定位的实现声明包括 `get_configured_health_body()`；`get_sandbox_manager()`；`lifespan(_application)`；`create_app()`。这些是源码定位入口，具体公共用户操作沿功能文档查证；本页不把内部符号直接当成稳定 HTTP API。参数、返回类型、错误传播和生命周期应在所列实现与调用方一起核对。
- 源码与文档：[jiuwenbox/src/jiuwenbox/server/app.py:L1–L532](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenbox/src/jiuwenbox/server/app.py#L1-L532)；
  - [jiuwenbox/README_CN.md:L1–L903](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenbox/README_CN.md#L1-L903)。

### 配置入口与生效条件

- 上游 YAML 示例的配置键包括 `version`、`name`、`filesystem_policy.directories`、`filesystem_policy.read_only`、`filesystem_policy.read_write`、`filesystem_policy.bind_mounts`、`filesystem_policy.device`、`process.run_as_user`。这些是示例字段，不单独证明源码默认值或全部优先级。 实现中直接读取的环境变量名称包括 `JIUWENBOX_UDS_PATH`、`JIUWENBOX_UDS_MODE`；
  - 名称与实际部署值分开核对。 文档中的调用选项包括 `--upgrade`、`--wheel`、`--host`、`--port`、`--log-level`、`--unix-socket`，适用命令与前置条件沿文档确认。 修改设置时还要检查配置加载位置与本功能的装配或连接时机，不能只由“保存成功”判断当前运行实例已经采用新值。
- 源码与文档：[jiuwenbox/src/jiuwenbox/server/app.py:L1–L532](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenbox/src/jiuwenbox/server/app.py#L1-L532)；
  - [jiuwenbox/README_CN.md:L1–L903](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenbox/README_CN.md#L1-L903)。

### 设计取舍

- **设计推断**：FastAPI 服务以静态策略管理 bubblewrap 长寿命 sandbox daemon，便于复用隔离执行和文件接口；代价是实际隔离依赖 Linux 内核、namespace 和策略能力。推理隐私代理及 API 认证是各自可选链路，服务返回成功不能单独证明所有约束已生效。以上分析从所列接口与功能边界得出，不宣称作者曾评估所有替代方案。
- 源码与文档：[jiuwenbox/src/jiuwenbox/server/app.py:L1–L532](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenbox/src/jiuwenbox/server/app.py#L1-L532)；
  - [jiuwenbox/README_CN.md:L1–L903](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenbox/README_CN.md#L1-L903)。

### 数据流与关联功能

- JiuwenBox 服务管理隔离执行、策略和进程资源。沙箱创建、命令执行、后台任务和审计状态具有独立接口，真实隔离效果取决于系统能力与策略接线。 联调时结合[[feature-permissions-1]]、[[feature-permissions-2]]（工具权限与安全治理）、[[feature-mcp]]（MCP 配置、凭据与资源）、[[feature-deployment]]（打包与部署）的入口、数据归属和生效条件查证；这些关联页解释不同阶段，不能只凭一项成功判定整个链路完成。
- 源码与文档：[jiuwenbox/src/jiuwenbox/server/app.py:L1–L532](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenbox/src/jiuwenbox/server/app.py#L1-L532)；
  - [jiuwenbox/README_CN.md:L1–L903](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenbox/README_CN.md#L1-L903)。

### 怎样验证

- 创建沙箱后验证允许和拒绝的文件、命令、网络访问，再检查后台任务、取消、销毁与审计记录。分别验证 opt-in API 认证、远程 MCP 和推理代理路由，覆盖缺少内核能力与策略错误的失败边界。这些是建议的验收步骤，本页没有记录上游运行测试已执行或已通过。
- 源码与文档：[jiuwenbox/src/jiuwenbox/server/app.py:L1–L532](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenbox/src/jiuwenbox/server/app.py#L1-L532)；
  - [jiuwenbox/README_CN.md:L1–L903](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenbox/README_CN.md#L1-L903)。
