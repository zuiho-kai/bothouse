---
name: jiuwenswarm-common-2
description: jiuwenswarm/common/：公共基础模块总览（下）：permissions 与 MCP 配置面（permissions.tools 校验、权限别名表、MCP 事实源合并、预检与预热）、相关组件知识链接、common 下全部改动路由路径与验证说明
metadata:
  scope: 只收 permissions 与 MCP 配置面、相关组件知识、改动路由和验证；模块职责、关键文件与配置读取归 jiuwenswarm-common-1
---
# jiuwenswarm/common/：公共基础模块（2/2）

## 现状

- 拆分说明：本页是源页 `jiuwenswarm-common.md` 的第 2/2 部分；第 1 部分 [[jiuwenswarm-common-1]]

### permissions 与 MCP 配置面

- `permissions.tools` 的值只允许小写 `allow|ask|deny` 或 legacy `{"*": level}`，写入前经 `_validate_tools_map` 规范化；rules 必须有非空 `tools`+`pattern`，`id` 缺省自动生成 `ui_rule_<uuid4hex12>`，可变键白名单为 `tools/pattern/severity/action/description/match_type`，`severity` 归一为大写 `LOW|MEDIUM|HIGH|CRITICAL`、`action` 归一为小写三级；
  - 重复 rule id 在 mutator 内抛 `ValueError`，整个写入中止（[config.py L1097-L1204](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/config.py#L1097-L1204)、
  - [L1225-L1261](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/config.py#L1225-L1261)、[L1368-L1387](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/config.py#L1368-L1387)）。
- `permission_tools.py` 的别名表只有四条：`exec_command→mcp_exec_command`、`fetch_webpage→mcp_fetch_webpage`、`free_search→mcp_free_search`、`paid_search→mcp_paid_search`。`resolve_permission_tool_name` 对歧义别名图 fail-closed（conflict 时 `canonical_name` 置空，不猜）；
  - `stricter_permission_level` 按 `allow(0)<ask(1)<deny(2)` 取更严一侧，未知输入按 ask 的等级参与比较，但函数仍可能返回原始未知字符串；调用方需先校验合法等级（[permission_tools.py L9-L95](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/permission_tools.py#L9-L95)）。
- 当前 MCP 合并两个事实源：`get_mcp_servers` 合并 config.yaml `mcp.servers`（command.mcp/TUI 手填）与 `mcp/state.json` 的 connected 记录（marketplace/custom），同名冲突 state.json 优先，stale marketplace 记录和 skill-only 记录跳过，
  - state 读取失败只降级为 config.yaml 部分（[config.py L2546-L2590](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/config.py#L2546-L2590)）。`upsert_mcp_server` 按名字路由：已在 config.yaml 的原地更新，其余写 state.json；
  - command.mcp 的 add/update 传 `state="connecting"`，探活通过后才翻成 `connected`（[L2703-L2730](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/config.py#L2703-L2730)）。
- `build_mcp_server_config` 要求非空 `name` 和五种 transport 之一，否则返回 None（跳过而非报错）；stdio 必须有 `command`（`args` 里的 `${VAR}` 要替换，因为子进程 argv 不会再做 shell 展开），HTTP 必须有 `url`。`${VAR}` 占位符仅在调用方提供 resolver 时解析（`CredentialStore(name) ∪ os.environ`，缺省保持字面量）；
  - HTTP 的 `headers` 必须落到 `auth_headers`——openjiuwen 的 SseClient/StreamableHttpClient 读的是 `auth_headers` 而不是 `params.headers`，此适配层将认证 headers 放在 SDK 读取的 auth_headers，
  - 不能据此保证任意远端的错误表现（[mcp_config.py L47-L71](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/mcp_config.py#L47-L71)、
  - [L107-L195](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/mcp_config.py#L107-L195)）。`extract_enabled_mcp_server_entries` 以合并后的 `get_mcp_servers()` 为权威来源（传入 config_base 的 `mcp.servers` 会漏掉 state.json 的动态 MCP），只保留 enabled（缺省 True）的条目；
  - 合并读取抛错时可回退到传入 config_base 的服务器列表（[L74-L104](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/mcp_config.py#L74-L104)）。
- prewarm 是后台 fire-and-forget：并发上限 6、兜底 stall 超时 120s，不设激进超时（npx 首次安装要几十秒）。HTTP 探活 `preflight_mcp_server_reachable` 用裸 `httpx.AsyncClient` POST 一个与 mcp SDK initialize 完全一致的报文，绝不用 `client.connect()`（401/超时会泄漏 anyio ghost task）；401/403 判为 auth rejected，任何 ≥400 都拦截；
  - 每服务器 `timeout_s` 优先，否则调用方 timeout，否则 10s；非 HTTP transport 直接视为可达（[mcp_config.py L25-L33](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/mcp_config.py#L25-L33)、
  - [L226-L324](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/mcp_config.py#L226-L324)）。

### 相关组件知识

- [[common-core-rules]]（common 审查规则） — config.yaml 写事务与跨仓契约的硬约束（本页描述的是已实现行为，规则页是改动时的门禁）
- [[jiuwenswarm-common-config-panel]]（配置面板 handler（config_panel）） — Web/TUI 侧调用本页这些持久化入口的 handler 层
- [[jiuwenswarm-common-auth]]（../login-auth/jiuwenswarm-common-auth.md） — `get_available_models` 叠加的登录模型来源（auth/model_catalog），凭据按用户隔离
- [[jiuwenswarm-runtime]]（../agent-runtime/jiuwenswarm-runtime.md） — 消费模型目录与权限配置的共享 Agent Runtime
- **改动路由**
- `jiuwenswarm/common/_build_config.py`
- `jiuwenswarm/common/chat_final.py`
- `jiuwenswarm/common/cleanup.py`
- `jiuwenswarm/common/client/`
- `jiuwenswarm/common/coding_memory_paths.py`
- `jiuwenswarm/common/config.py`
- `jiuwenswarm/common/context_keys.py`
- `jiuwenswarm/common/context_window.py`
- `jiuwenswarm/common/cron_session.py`
- `jiuwenswarm/common/cron_team_completion.py`
- `jiuwenswarm/common/debug_dump.py`
- `jiuwenswarm/common/external_cli_catalog.py`
- `jiuwenswarm/common/external_cli_runtime.py`
- `jiuwenswarm/common/git_safe_directory.py`
- `jiuwenswarm/common/hooks_config.py`
- `jiuwenswarm/common/kv_cache_affinity_config.py`
- `jiuwenswarm/common/log_preview.py`
- `jiuwenswarm/common/mcp_config.py`
- `jiuwenswarm/common/media_capability_config.py`
- `jiuwenswarm/common/mode_matrix.py`
- `jiuwenswarm/common/model_catalog.py`
- `jiuwenswarm/common/model_config_validation.py`
- `jiuwenswarm/common/model_errors.py`
- `jiuwenswarm/common/model_migration.py`
- `jiuwenswarm/common/model_selection.py`
- `jiuwenswarm/common/model_vendor_registry.py`
- `jiuwenswarm/common/openrouter_attribution.py`
- `jiuwenswarm/common/permission_tools.py`
- `jiuwenswarm/common/playwright_mcp_runtime.py`
- `jiuwenswarm/common/process_supervision.py`
- `jiuwenswarm/common/projectless_workspace.py`
- `jiuwenswarm/common/protocol_ids.py`
- `jiuwenswarm/common/reasoning_config.py`
- `jiuwenswarm/common/reasoning_injector.py`
- `jiuwenswarm/common/runtime_log_filter.py`
- `jiuwenswarm/common/runtime_workspace.py`
- `jiuwenswarm/common/security/`
- `jiuwenswarm/common/session_message.py`
- `jiuwenswarm/common/stage_timer.py`
- `jiuwenswarm/common/startup_diagnostics.py`
- `jiuwenswarm/common/task_loop_config.py`
- `jiuwenswarm/common/team_artifacts.py`
- `jiuwenswarm/common/todo_snapshot.py`
- `jiuwenswarm/common/tool_display.py`
- `jiuwenswarm/common/tool_ownership.py`
- `jiuwenswarm/common/updater.py`
- `jiuwenswarm/common/updater_restart_helper.py`
- `jiuwenswarm/common/upgrade_executor.py`
- `jiuwenswarm/common/utils.py`
- `jiuwenswarm/common/version.py`
- `jiuwenswarm/common/version_source.py`
- `jiuwenswarm/common/work_mode.py`
- `jiuwenswarm/common/ws_diagnostics.py`
- `jiuwenswarm/common/ws_limits.py`

### 怎样验证

- 模型选择迁移、目录脱敏、write-only 字段保留、reasoning 档位和并发配置写入分别查本页 sources 中的聚焦单测。这里描述固定版本的静态源码行为，不能单独证明真实模型端点或 marketplace 的连通性。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/common-core/jiuwenswarm-common.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-09-30；updated: 2026-10-01
