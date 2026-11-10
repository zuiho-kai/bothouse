---
name: feature-depth-mcp
description: MCP 实现深读：build_mcp_server_config 契约与 enabled 默认、凭据解析优先级、与 mcp/state.json 动态连接器合并、preflight 与 probe_mcp_live_connection 的失败分支、实连探测取舍及两条运行时单测
metadata:
  scope: 只收 MCP 配置与连接的实现层深读条目；功能概览归 feature-mcp
---
# MCP 配置、凭据与资源：实现深读

## 现状

- [[feature-mcp]]（功能概览） · [[common-core-overview]]（owner 入口）
- **build_mcp_server_config 的契约** build_mcp_server_config(entry) 要求 entry 含非空 name，transport 必须属于 {stdio, sse, http, streamable-http, streamable_http}，stdio 还需 command、HTTP 还需 url，否则返回 None（调用方静默跳过）。credential_resolver 缺省为 None，此时占位符保持字面量（向后兼容）；传入 resolver 才会替换 env/args/url/headers 中的 ${VAR}。
- 来源：[jiuwenswarm/common/mcp_config.py:L107–L195](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/mcp_config.py#L107-L195)
- **enabled 默认与凭据优先级** mcp.servers 条目的 enabled 缺省按 True 处理（bool(item.get("enabled", True))）。占位符解析优先级为：该 MCP 的 CredentialStore 存储值优先，未命中再取 os.environ，都没有则保留字面 ${VAR}（build_mcp_credential_resolver 的 resolver 闭包定义此顺序；无存储凭据时整个 resolver 为 None）。
- 来源：[jiuwenswarm/common/mcp_config.py:L97–L104](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/mcp_config.py#L97-L104),
  - [jiuwenswarm/common/mcp_config.py:L47–L71](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/mcp_config.py#L47-L71)
- **与 mcp/state.json 动态连接器的合并** extract_enabled_mcp_server_entries 的权威来源是 get_mcp_servers()，它合并 config.yaml 的 mcp.servers 与 mcp/state.json 中 state==connected 的记录，同名冲突时 state.json 优先；传入的 config_base 仅在 store 读取失败（如 bootstrap 早期）时作回退。因此 config_base 里的 servers 会漏掉动态注册的 MCP。
- 来源：[jiuwenswarm/common/mcp_config.py:L74–L104](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/mcp_config.py#L74-L104),
  - [jiuwenswarm/common/config.py:L2546–L2590](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/config.py#L2546-L2590)
- **preflight 的超时/不可达/401/403 捕获分支就地返回 (False, 原因)；probe 的 stdio PATH 缺失分支** preflight_mcp_server_reachable 把 httpx.TimeoutException 转 (False, "http probe timed out after {read_t}s…")、ConnectError 等转 "unreachable: …"、其余异常兜底 "probe failed: …"、401/403 转 "auth rejected (HTTP n)"，全部就地返回不抛出；
  - probe_mcp_live_connection 在 stdio 且 command 非空、shutil.which(cmd) 为 None 时返回 (False, "command '…' not found on PATH")，preflight 失败 reason 原样向上返回。
- 来源：[jiuwenswarm/common/mcp_config.py:L300–L324](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/mcp_config.py#L300-L324),
  - [jiuwenswarm/common/mcp_config.py:L492–L503](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/mcp_config.py#L492-L503)
- **实连探测取舍（docstring 明文）：握手/npx 失败提前暴露，代价是用户在连接期等待** 收益：npx 首次安装与握手失败在连接期（用户等待 connect 时）暴露，而非首轮对话静默退化成 "no tools"；代价：等待同样落在 connect 阶段——两侧均为函数 docstring 原文陈述，非本文推断。
- 来源：[jiuwenswarm/common/mcp_config.py:L440–L448](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/mcp_config.py#L440-L448)
- **已有运行时单测（断言可见，本轮未执行）：占位符保留字面量；prewarm 挂起不中断** test_stdio_env_placeholder_missing_kept_literal 用 monkeypatch.delenv 加空 resolver，断言 cfg.params["env"]["K"] == "${NONEXISTENT_VAR}"；
  - test_prewarm_times_out_a_hung_mcp_and_continues 把 probe 替换为 sleep 3600、_PREWARM_STALL_TIMEOUT_S=0.1，断言 set(attempted) == {"hung","good"} 且耗时 <0.5s（probe 被打桩，只覆盖 prewarm 的停顿护栏）。
- 来源：[tests/unit_tests/agentserver/mcp/test_mcp_config_placeholder.py:L60–L68](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/agentserver/mcp/test_mcp_config_placeholder.py#L60-L68),
  - [tests/unit_tests/agentserver/test_mcp_startup_prewarm.py:L65–L88](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/agentserver/test_mcp_startup_prewarm.py#L65-L88)
- **probe_mcp_live_connection 各分支返回 (ok, reason)；try 外调用不保证从不抛出** 空名返回 (False, "mcp name is required")；entry 为 None 返回 (True, "")，cfg 为 None 返回 invalid entry 失败。stdio 且 command 非空不在 PATH 时失败；preflight 不可达返回 reason、自身异常仅 debug 后继续；
  - Runner 导入或 add_mcp_server(tag="mcp.probe") 异常各返回 (False, 原因)，成功按 is_ok()/bool（result 为 None 视为成功）返回 (True, "")；但 entry 读取、cfg 构建、which 与结果检查在 try 之外，不构成从不抛出。
- 来源：[jiuwenswarm/common/mcp_config.py:L440–L547](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/mcp_config.py#L440-L547)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/common-core/feature-depth-mcp.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-02；updated: 2026-10-02
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/common/mcp_config.py:L107-L195；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/common/mcp_config.py:L97-L104
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/common/mcp_config.py:L47-L71；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/common/mcp_config.py:L74-L104
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/common/config.py:L2546-L2590；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/common/mcp_config.py:L440-L448
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/agentserver/mcp/test_mcp_config_placeholder.py:L60-L68；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/agentserver/test_mcp_startup_prewarm.py:L65-L88
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/common/mcp_config.py:L300-L324；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/common/mcp_config.py:L492-L503
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/common/mcp_config.py:L440-L547
- 源页字段（feature）：mcp
- 入口（entry_points）：jiuwenswarm/common/mcp_config.py
- 源页字段（source_globs）：jiuwenswarm/common/mcp_config.py
