---
name: jiuwenswarm-common-1
description: jiuwenswarm/common/：公共基础模块总览（上）：模块职责、从这里读起与关键文件、相关文档，配置读取与环境变量解析（get_config 流水线、resolve_env_vars、_normalize_config）
metadata:
  scope: 只收模块总览、关键文件清单与配置读取；permissions 与 MCP 配置面、相关组件知识、改动路由与验证归 jiuwenswarm-common-2；模型目录与选择校验归 jiuwenswarm-common-model-catalog
---
# jiuwenswarm/common/：公共基础模块（1/2）

## 现状

- 拆分说明：本页是源页 `jiuwenswarm-common.md` 的第 1/2 部分；第 2 部分 [[jiuwenswarm-common-2]]
- Gateway 和 AgentServer 共用的基础层，负责 config.yaml 的读写与迁移、模型目录、模型选择与校验、运行模式解析、工作区路径，以及南北向客户端契约等共享逻辑。进程监管、启动诊断、自动升级、后台清理和异步状态转储等进程级工具也放在这里。
- **从这里读起**
- `jiuwenswarm/common/config.py` — get_config / update_config：读取 config.yaml 并展开环境变量，加锁后原子写回，同时提供各特性开关的读取函数
- `jiuwenswarm/common/mode_matrix.py` — resolve_request_mode：把 Web 的 agent/team/agent.plan 和 work_mode 组合成 canonical mode，并据此路由到 Deep 或 Code Adapter
- `jiuwenswarm/common/model_catalog.py` — ModelCatalog：只读目录，统一提供默认模型、AgentOS 模型和模型组
- `jiuwenswarm/common/client/agent_client.py` — AgentServerClient 抽象：与 AgentServer 通信的南北向契约，Gateway 仓另有一份副本
- `jiuwenswarm/common/process_supervision.py` — supervise：监管 AgentServer 和 Gateway 子进程，判断哪些退出需要重启
- `jiuwenswarm/common/startup_diagnostics.py` — doctor_main：只依赖标准库的 --doctor 启动诊断，用于排查打包桌面版启动失败
- `jiuwenswarm/common/updater.py` — UpdaterService：负责版本检查、安装包下载和升级执行
- `jiuwenswarm/common/cleanup.py` — start_background_cleanup：按保留期定期清理旧会话数据和 file_ops 日志
- **关键文件**
- `jiuwenswarm/common/model_selection.py` — ModelSelection 和 Resolved* 等 DTO，描述稳定的模型选择与模型组选择
- `jiuwenswarm/common/model_config_validation.py` — 校验模型目录和模型组 patch，并探测模型连通性
- `jiuwenswarm/common/kv_cache_affinity_config.py` — KV cache 亲和配置和 provider 规则的权威定义
- `jiuwenswarm/common/mcp_config.py` — 把 config.yaml 的 MCP 条目转成运行时配置，也负责预检、探活和预热
- `jiuwenswarm/common/hooks_config.py` — 定义 config.yaml 中 hooks 段的 schema 和事件匹配逻辑
- `jiuwenswarm/common/projectless_workspace.py` — 为无项目请求在 Documents/JiuwenSwarm 下分配按日期划分的任务目录，并登记会话
- `jiuwenswarm/common/team_artifacts.py` — 确定 Team 成员工作目录和共享交付目录的根路径
- `jiuwenswarm/common/cron_team_completion.py` — Gateway 和 AgentServer 共用的 cron 团队轮次结束判定
- `jiuwenswarm/common/chat_final.py` — chat.final 的 final_mode 字段（patch_segment / replace_turn / append），决定前端如何落地最终回复
- `jiuwenswarm/common/client/agent_http_bridge.py` — 解析受认证 HTTP bridge 的基址并执行大文件上传，大文件因此不走 E2A 帧
- `jiuwenswarm/common/security/ws_origin.py` — 共享的 WebSocket Origin 校验
- `jiuwenswarm/common/_build_config.py` — 由 scripts/build_config.py --sync 生成，不要手改
- **相关文档**
- `docs/zh/E2A-protocol.md` — 改 client/ 下的南北向契约或上传通道时，对照 E2A 线协议
- `docs/zh/MCP配置.md` — 改 mcp_config.py 里 MCP 条目的解析或凭据处理时读
- `docs/zh/AgentTeam.md` — 改 team 模式解析、team_artifacts.py 或 cron_team_completion.py 时读
- `docs/zh/Harness.md` — 改 cron_team_completion.py 里 harness 轮次结束条件时读
- `TESTING.md` — 给本模块补测试时参考；其中有过期路径，要先核对 tests/ 下已有的用例

### 配置读取与环境变量解析

- `get_config()` 的流水线固定为 `_read_with_retry` → `resolve_env_vars` → `_normalize_config`，env 解析和归一化在锁外执行以缩短锁持有时间。只有 YAML parse 结果进缓存：键是文件身份 `(mtime_ns, size)`，命中与写入都深拷贝，文件 mtime_ns 或 size 改变时会使缓存失效；
  - 不能检测保持两者不变的内容改写，而 `load_dotenv_runtime(override=True)` 后的新环境变量下一次读取立即生效，无需显式失效钩子（[config.py L171-L244](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/config.py#L171-L244)）。
  - `_read_with_retry` 遇 `YAMLError` 默认最多尝试 3 次（最多重试 2 次）（间隔 0.05s 递增）以跨过另一进程写一半的文件；`get_config_raw()` 跳过 env 解析，
  - 专供局部读改写回（[L199-L234](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/config.py#L199-L234)、[L262-L264](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/config.py#L262-L264)）。
- `resolve_env_vars` 的 `${VAR:-default}` 按 bash 语义：unset 或空串都用默认值；无 `:-` 的 `${VAR}` 在 unset 时得到空串。变量名含 `api_key`/`token`（不区分大小写）且有值时先经 crypto provider 解密。`mcp.servers` 条目的 `headers`/`env`/`staticHeaders`/`static_headers` 子树原样保留 `${VAR}` 占位符——它们属于 CredentialStore，在构建 `McpServerConfig` 时才解析；
  - 提前塌缩成空串会让 httpx 报 `Illegal header value b'Bearer '`（[config.py L62-L125](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/config.py#L62-L125)；
  - 选择器 `TestResolveEnvVars::test_mcp_server_headers_env_placeholders_preserved`，[test_config.py L623-L712](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/test_config.py#L623-L712)）。
- `_normalize_config` 对 KV cache 亲和 fail-closed：开关已开但 `validate_affinity_invariant` 不通过时只在内存里关掉开关（保留用户文件供诊断），绝不激活不一致配置；
  - 同时把 JSON 字符串形式的 `custom_headers` 解析成 dict，并为 `channels.{web,feishu,xiaoyi}` 顶层缺省的 `send_file_allowed` 兜底 True（[config.py L128-L168](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/config.py#L128-L168)）。

### 模型目录、稳定选择与配置校验

- 该工作流的职责、顺序、错误边界与源码入口见[[jiuwenswarm-common-model-catalog]]（模型目录、稳定选择与配置校验）。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/common-core/jiuwenswarm-common.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-09-30；updated: 2026-10-01
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/common/config.py；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/common/model_selection.py
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/common/model_catalog.py；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/common/model_config_validation.py
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/common/permission_tools.py；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/common/mcp_config.py
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/test_model_selection_migration.py；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/test_config.py
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/common/test_model_config_validation.py；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/common/test_config_concurrent_models.py
