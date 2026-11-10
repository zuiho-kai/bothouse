---
name: common-core-rules
description: "jiuwenswarm/common 审查规则：JIUWENSW-I1、I4、I13、I17（config.yaml 写事务、写入口、开关来源、client 跨仓契约）与 JW-MCP-PREFLIGHT-1a、JW-QUOTA-1a、JW-TRACE-1a（PR #7810、#7788、#6926）"
metadata:
  scope: 只收 JIUWENSW-I1、I4、I13、I17、JW-MCP-PREFLIGHT-1a、JW-QUOTA-1a、JW-TRACE-1a 七条规则；已实现行为的说明归 jiuwenswarm-common-1、jiuwenswarm-common-2
---
# jiuwenswarm/common 审查规则：配置读写事务、跨仓契约与持久化键稳定性

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/common-core/rules.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: jiuwenswarm；created: 2026-09-30；updated: 2026-10-09
- 来源（sources）：PR #6926；PR #7788；PR #7810
- [JIUWENSW-I1] `jiuwenswarm/common/config.py::update_config` 的 mutator 不能再次进入写锁，返回值决定是否写盘
  - `_CONFIG_WRITE_LOCK`（`threading.Lock`）和 portalocker 文件锁都不可重入。如果 mutator 里调用了任何经过 `update_config` 或 `config_write_lock` 的函数（如 `update_ttse_enabled_in_config`、`save_models_candidate`、`update_permissions_*`），同一线程会一直阻塞，到 `lock_timeout` 后抛出 `TimeoutError`，写入失败。
  - mutator 的返回值才是要 dump 的对象。返回 `None` 表示不写盘（`delete_*` 没命中时就靠它跳过）。新写的 mutator 如果漏了 `return data`，修改会被悄悄丢掉。
  - mutator 内抛出异常会中止写入。校验（`raise_if_invalid`、重复 id 检查）必须放在 mutator 里面或调用之前，不能放到 `update_config` 返回之后。
  - 写盘后要读出来展示的数据，应在 `update_config` 返回后另发一次调用，不要在 mutator 里读。
- [JIUWENSW-I4] 新增的 config.yaml 写入口必须走 `update_config` 加 `dump_yaml_round_trip`，不要复制裸读改写的写法
  - AgentServer 和 Gateway 两个进程会同时写同一个 config.yaml。`update_channel_in_config`、`update_browser_in_config`、`set_auto_memory_enabled` 这类裸 `load_yaml_round_trip` 到 `dump_yaml_round_trip` 的写法不持锁，会覆盖另一个进程的修改。新代码不要照抄这种写法；PR 改到这些旧函数时，优先迁移到 `update_config`。
  - 不要使用 `set_config`（直接 `open(..., "w")` 后 `yaml.safe_dump`），也不要自己开文件写。这种写法不是原子的，读者可能读到写了一半的文件，还会丢掉注释和引号风格。
  - `dump_yaml_round_trip` 的临时文件必须和目标文件放在同一目录（`os.replace` 不能跨文件系统），异常路径要删掉 tmp 文件。不要去掉 `_atomic_replace` 对 Windows `PermissionError` 的重试。
  - `_CONFIG_YAML_PATH`、`_load_yaml_round_trip`、`_dump_yaml_round_trip` 是下游模块在导入的兼容别名，不能删除或改名。
- [JIUWENSW-I13] 读取开关时注意字符串布尔值；evolution 开关只有一个来源
  - 通过 `${VAR:-false}` 注入的值是字符串，而 `bool("false")` 为 True。可能来自环境变量替换的新开关应使用 `coerce_config_bool`。`is_subagent_runtime_enabled` 里的 `bool(...)` 就有这个问题，不要照抄。
  - `_get_evolution_config` 有意只读 `react.evolution`，不读顶层的 `evolution`，也不读环境变量覆盖，以免残留的部署变量改变运行中 agent 的能力。`get_skill_evolution_enabled` 和 `get_evolution_auto_save_enabled` 用 `is True` 严格判断。PR 不能把旧路径或 env 回退加回来。
- [JIUWENSW-I17] `jiuwenswarm/common/client/` 下的抽象接口是跨仓库契约，改签名必须和 Gateway 副本同步
  - `AgentServerClient` 和 `ThirdAgent` 在 Gateway 仓库里各有一份副本，两边靠 E2A 线协议对齐。修改方法名、keyword-only 参数或返回类型时，必须同步 Gateway 副本和所有实现（WebSocket、AgentOS Router 等）。
  - 新增 `@abstractmethod` 会让所有没实现它的子类无法实例化。可选能力应提供默认实现（参考 `ThirdAgent.normalize_agent_type`）。
  - `send_request` 的 `timeout=None` 表示使用客户端默认值。实现方必须采用调用方传入的更大值（例如 cron 的 `timeout_seconds`），不能再被内层默认值提前截断。
  - `UnsupportedThirdAgent` 的返回形状（`ok` 为 False，带 `error`，`code` 为 UNSUPPORTED）是调用方依赖的约定。`normalize_agent_type` 只对内置的 jiuwenswarm 不区分大小写，registry 里的名称保留原大小写。
- [JW-MCP-PREFLIGHT-1a] 启用远程 MCP 的 add/update 在 HTTP 预检失败时不得落库
  - 触发：修改含 HTTP MCP 预检的 common/mcp_config 和 AgentServer MCP add/update；当前核对 dev-stable。
  - 强制：启用的远程 HTTP/SSE 配置先连通性/鉴权预检，通过后才保存；SSE 用 GET 读取响应头，streamable-http POST initialize，并传递配置鉴权信息。超时、连接异常、非法 URL、HTTP >=400 或意外探测异常返回明确失败。
  - 验收：失败 add/update 的配置写入口未调用；SSE GET、HTTP POST initialize、401 和正常保存都有定向测试。^[PR #7810]
- [JW-QUOTA-1a] 配额关闭时短路门禁，不能同时关闭无关的只读接口
  - 触发：修改带 workspace quota 的 common/workspace/quota 或 workspace_quota_rail；当前核对 dev-stable。
  - 强制：统一使用 WORKSPACE_QUOTA_ENABLED，默认 false，按配置布尔语义解析；关闭时 before_tool_call 返回，命令/写盘门禁返回 allowed=True,status=ok，避免继续计算配额。
  - 验收：默认、false 和 true 分别覆盖门禁路径；关闭时既不计算配额也不阻断写盘，而只读接口保持既有身份校验。^[PR #7788]
- [JW-TRACE-1a] 共享 trace 开关必须区分显式通道与旧兼容键
  - 触发：修改 xiaoyi_0.2.4.beta3 common/e2a/wire_trace 的 E2A/A2A/session 调试落盘开关。
  - 强制：复用 trace.json 和 JIUWENSWARM_TRACE 系列覆盖；环境变量优先。只有 e2a/a2a/session_history 算显式通道键，显式模式未列出的通道关闭；history_records 留作兼容键。保持文件缓存刷新和 get_dated_logs_dir 下的默认通道目录；落盘异常不能中断业务。
  - 验收：test_trace_switches 同时覆盖环境覆盖、缓存刷新、显式通道遗漏和旧文件/变量兼容；注入写入异常时业务继续。^[PR #6926]

## 决策与踩坑

- [JW-MCP-PREFLIGHT-1a] 禁止：探测失败仍保存配置；为预检进入 MCP SDK 长生命周期任务组；对 stdio 等本地传输 spawn 探测；把 HTTP 探测通过宣称为完整 MCP 协议验证。
- [JW-QUOTA-1a] 禁止：关闭开关时仍产生 quota block；将隐藏导航误解为 Gateway list/usage/preview/download 等只读接口不可调用。
- [JW-TRACE-1a] 禁止：新造独立开关文件；把 history_records 当作显式通道模式判据；要求改开关后重启或把默认输出另放一套目录。
