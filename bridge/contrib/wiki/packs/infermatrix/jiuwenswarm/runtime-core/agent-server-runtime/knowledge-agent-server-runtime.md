---
name: knowledge-agent-server-runtime
description: AgentServer WebSocket 边界知识页：AgentWebSocketServer 作为 Gateway 与 AgentServer 之间的单例边界、get_instance/reset_instance 与 bind_transport 监听所有权、host 127.0.0.1/port 18000/ping 默认值与 10.0s 保活常量、显式 internal 沙箱启动、session_messages.sqlite3 持久信箱与 RPC 适配器装配、测试入口与证据边界
metadata:
  scope: 收 agent_ws_server.py 边界的六节说明，来源另含 README.md；逐文件声明归 agent-server-runtime-contracts-01，流审计规则 JW-WS-AUDIT-1a 归 agent-server-runtime-rules
---
# AgentServer WebSocket 边界：Runtime、接口与配置

## 现状

### WebSocket 边界与共享 Runtime

- `AgentWebSocketServer` 的类文档将它定义为 Gateway 与 AgentServer 之间的 WebSocket 单例边界，约定 E2A/legacy 输入及 unary、stream 输出。构造器创建传输无关的 Runtime，并把 `_agent_manager` 保留为 Runtime 中 manager 的旧别名；传输入口与执行状态由此分开。维护者模块笔记也把前端渲染和频道摄取划在此模块之外。
- 来源：[jiuwenswarm/server/agent_ws_server.py:L1079–L1089](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/agent_ws_server.py#L1079-L1089),
  - [jiuwenswarm/server/agent_ws_server.py:L1110–L1118](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/agent_ws_server.py#L1110-L1118),
  - [.doc_project_maintainer/modules/agentserver-runtime/README.md:L15–L18](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/.doc_project_maintainer/modules/agentserver-runtime/README.md#L15-L18)

### 单例获取与监听所有权

- `get_instance()` 首次调用才创建对象，之后直接返回已有实例；再次传入 host、port 等参数不会重新配置已有对象，`reset_instance()` 的文档用途是测试。`start(bind_transport=False)` 默认启动 Runtime 服务而不绑定兼容监听器；源码把生产监听 socket 的所有权交给 AgentServer Front，`bind_transport=True` 是测试/兼容入口。
- 来源：[jiuwenswarm/server/agent_ws_server.py:L1268–L1294](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/agent_ws_server.py#L1268-L1294),
  - [jiuwenswarm/server/agent_ws_server.py:L1398–L1415](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/agent_ws_server.py#L1398-L1415)

### 构造器默认值与保活常量

- 构造器和 `get_instance()` 的默认参数为 host=`127.0.0.1`、port=18000、ping_interval=30.0、ping_timeout=300.0；这是该类的参数默认值，部署入口可以传入自己的配置。流式保活间隔常量为 10.0 秒，停止保活的超时常量为 1.0 秒。
- 来源：[jiuwenswarm/server/agent_ws_server.py:L1093–L1104](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/agent_ws_server.py#L1093-L1104),
  - [jiuwenswarm/server/agent_ws_server.py:L1268–L1288](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/agent_ws_server.py#L1268-L1288),
  - [jiuwenswarm/server/agent_ws_server.py:L407–L410](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/agent_ws_server.py#L407-L410)

### 显式沙箱启动避免升级副作用

- 内部 jiuwenbox 的自动启动分支先排除非 Linux，再要求 `get_sandbox_startup_mode_explicit()` 返回 `internal`；字段缺失或 external 都跳过自动启动。方法注释解释了为何不用带默认值的普通 getter：避免升级后给未使用沙箱的用户无意增加子进程。显式配置与一般默认值在这个启动路径中具有不同作用。
- 来源：[jiuwenswarm/server/agent_ws_server.py:L1599–L1618](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/agent_ws_server.py#L1599-L1618),
  - [jiuwenswarm/server/agent_ws_server.py:L1632–L1655](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/agent_ws_server.py#L1632-L1655)

### 持久信箱与 RPC 适配器装配

- 持久会话信箱使用 `get_agent_root_dir()/session_messages.sqlite3`，把 heartbeat admission、内部执行函数和状态回调注入 SessionMessageService，并将该 service 安装到 Runtime。构造器另一次性注册 Voice、Session、WorkspaceFile、Memory、Project、HarmonyOS 与 Config RPC 适配器；源码注释将其归为当前 AgentServer 数据目录中的 Gateway 用户业务 RPC。
- 来源：[jiuwenswarm/server/agent_ws_server.py:L1190–L1205](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/agent_ws_server.py#L1190-L1205),
  - [jiuwenswarm/server/agent_ws_server.py:L1129–L1142](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/agent_ws_server.py#L1129-L1142)

### 维护者给出的测试入口与证据边界

- 维护者 README 为启动/关闭目录保护、mode 与 project 解析、ACP 会话分配、slash 命令、断连清理及 warm pool 列出测试入口：`tests/unit_tests/test_app_agentserver.py` 与 `tests/unit_tests/agentserver/` 下对应测试。该局部笔记把真实 WebSocket 的 origin、并发帧、ack、心跳及断连的综合验证列为缺口；这份文档不能单独证明当前版本缺少这些测试或已经通过它们。
- 来源：[.doc_project_maintainer/modules/agentserver-runtime/README.md:L58–L64](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/.doc_project_maintainer/modules/agentserver-runtime/README.md#L58-L64),
  - [.doc_project_maintainer/modules/agentserver-runtime/README.md:L69–L73](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/.doc_project_maintainer/modules/agentserver-runtime/README.md#L69-L73)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/agent-server-runtime/knowledge-agent-server-runtime.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/server/agent_ws_server.py:L1079-L1089；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/server/agent_ws_server.py:L1110-L1118
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:.doc_project_maintainer/modules/agentserver-runtime/README.md:L15-L18；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/server/agent_ws_server.py:L1268-L1294
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/server/agent_ws_server.py:L1398-L1415；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/server/agent_ws_server.py:L1093-L1104
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/server/agent_ws_server.py:L1268-L1288；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/server/agent_ws_server.py:L407-L410
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/server/agent_ws_server.py:L1599-L1618；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/server/agent_ws_server.py:L1632-L1655
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/server/agent_ws_server.py:L1190-L1205；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/server/agent_ws_server.py:L1129-L1142
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:.doc_project_maintainer/modules/agentserver-runtime/README.md:L58-L64；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:.doc_project_maintainer/modules/agentserver-runtime/README.md:L69-L73
