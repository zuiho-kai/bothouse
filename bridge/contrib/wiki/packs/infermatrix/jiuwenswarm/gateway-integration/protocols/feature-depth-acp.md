---
name: feature-depth-acp
description: ACP 与 stdio 桥接实现深读：profile 字段与关闭超时、_run_once 退出码 0/1/2、common.config 与 common.acp 兼容层、initialize 能力取舍、系统测试与冒烟路径
metadata:
  scope: 只收 ACP 的实现深读；功能概览归 feature-acp，A2A 与 E2A 的深读归 feature-depth-a2a、feature-depth-e2a
---
# ACP 与 stdio 桥接：实现深读

## 现状

- [[feature-acp]]（功能概览） · [[protocols-overview]]（owner 入口）
- **profile 字段与关闭超时默认值** profile 从 config.yaml 的 acp_agents 读取：command 必填，args 列表转字符串列表，cwd 仅在非空白字符串时生效，env 仅在为 dict 时传入。环境变量 ACP_CLI_CLOSE_TIMEOUT_S 默认 "30" 秒，作为 finally 中 asyncio.wait_for 包裹（shield）client.close() 的超时。JIUWENSWARM_SKIP_DOTENV 不为 "1" 时从 get_env_file()（配置目录下 .env）以 override=False 加载。
- 来源：[jiuwenswarm/acp/cli.py:L36–L60](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/acp/cli.py#L36-L60),
  - [jiuwenswarm/acp/cli.py:L75–L82](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/acp/cli.py#L75-L82),
  - [jiuwenswarm/common/utils.py:L2432–L2433](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/utils.py#L2432-L2433)
- **main 把 _run_once 的返回值传入 sys.exit；acp_agents profile 要求非空 command** argparse：agent 必填，message 可选默认 'Hello'；_run_once 在 acp_agents profile 缺失/非 dict 或 command 为空时局部返回 2，成功为 0，connect/chat 抛 Exception 时在 except 内局部返回 1——客户端构造位于 try 之外，构造异常不被捕获。
- 来源：[jiuwenswarm/acp/cli.py:L19–L29](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/acp/cli.py#L19-L29),
  - [jiuwenswarm/acp/cli.py:L32–L62](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/acp/cli.py#L32-L62),
  - [jiuwenswarm/acp/cli.py:L65–L86](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/acp/cli.py#L65-L86)
- **耦合：common.config 读取与 common.acp 的兼容 re-export 层** `cli` 从 `jiuwenswarm.common.config.get_config` 读 `acp_agents`；`jiuwenswarm/acp/stdio_client.py` 与 `subprocess_env.py` 仅 re-export `jiuwenswarm.common.acp` 实现，docstring 自述为保住 `jiuwenswarm-acp-chat` 等旧 import 路径，且该层将在阶段 3 删除。
- 来源：[jiuwenswarm/acp/cli.py:L13–L24](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/acp/cli.py#L13-L24),
  - [jiuwenswarm/acp/stdio_client.py:L1–L13](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/acp/stdio_client.py#L1-L13),
  - [jiuwenswarm/acp/subprocess_env.py:L1–L12](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/acp/subprocess_env.py#L1-L12)
- **profile/command 无效时 _run_once 局部返回 2 且不构造客户端；会话期异常被 except 捕获后局部返回 1** acp_agents 非 dict、profile 非 dict 或 command 为空时 _run_once 记录错误并局部返回 2，不构造客户端——connect 的 ValueError('ACP agent command is empty') 在该路径不会到达；
  - rpc 层收到 JSON-RPC error 对象即 raise RuntimeError，chat 异常（含 'not connected; call connect() first' 前置检查）被 except 捕获，记录 '[ERROR] ACP session failed' 后局部返回 1。
- 来源：[jiuwenswarm/acp/cli.py:L19–L29](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/acp/cli.py#L19-L29),
  - [jiuwenswarm/acp/cli.py:L32–L62](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/acp/cli.py#L32-L62),
  - [jiuwenswarm/common/acp/stdio_client.py:L484–L492](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/acp/stdio_client.py#L484-L492),
  - [jiuwenswarm/common/acp/stdio_client.py:L545–L549](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/acp/stdio_client.py#L545-L549)
- **initialize 能力取舍：声明 FS 能力、放弃 terminal** `initialize` 声明 `clientCapabilities.fs.readTextFile=True/writeTextFile=True` 而 `terminal=False`；行内注释自述收益是让 Codex ACP 等 Agent 完成工具回合，代价是本客户端不支持 terminal 能力。
- 来源：[jiuwenswarm/common/acp/stdio_client.py:L512–L521](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/acp/stdio_client.py#L512-L521)
- **系统测试：真实子进程假 Agent 上的 connect/chat 断言** `test_stdio_client_connect_and_chat_with_fake_agent` 拉起 tmp_path 生成的子进程假 Agent，断言 `client.session_id == "st-fake-session"` 且 `chat("hello st") == "echo:hello st"`；
  - `test_stdio_client_chat_raises_on_jsonrpc_error` 断言 `chat` 抛出匹配 `ACP JSON-RPC error:.*agent failed` 的 `RuntimeError`。
- 来源：[tests/system_tests/test_acp_stdio_client_st.py:L162–L187](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/system_tests/test_acp_stdio_client_st.py#L162-L187),
  - [tests/system_tests/test_acp_stdio_client_st.py:L191–L199](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/system_tests/test_acp_stdio_client_st.py#L191-L199)
- **ACP CLI 冒烟路径：acp_agents profile → AcpStdioClient.connect 建会话 → _run_once 本地返回 0/1/2** _get_spec 从 get_config() 的 acp_agents 字典按 strip 后的 agent 名取 profile，无该字典或 profile 非字典时记 error 返回 None；_run_once 据此返回 2，command 去空白后为空也返回 2。
  - 有效时构造 AcpStdioClient（jiuwenswarm/acp/stdio_client.py 仅从 common.acp re-export 以保持旧 import 路径）并 connect：已关闭抛 RuntimeError、空命令抛 ValueError，随后以三路 PIPE（_KILL_PG 为真时加 start_new_session）启动子进程，先发 initialize（protocolVersion 1、fs 读写均为 True、terminal 为 False，超时 120 秒），
  - 再发 session/new（cwd 取 self._cwd 绝对化值否则 os.getcwd()，mcpServers 为空列表，超时 60 秒）；结果须为 dict，sessionId 缺失或为空时可回退 session_id，strip 后仍为空则抛 RuntimeError，否则存入 _session_id。回到 _run_once，connect/chat 成功后以 info 记录 out 或「(empty response)」并返回 0；仅该 try 内的 Exception 记「[ERROR] ACP session failed」返回 1；
  - finally 中按 ACP_CLI_CLOSE_TIMEOUT_S（默认 30）作超时对 shield 的 close 等待，关闭异常仅记 warning。
- 来源：[jiuwenswarm/acp/cli.py:L13–L66](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/acp/cli.py#L13-L66),
  - [jiuwenswarm/acp/stdio_client.py:L3–L13](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/acp/stdio_client.py#L3-L13),
  - [jiuwenswarm/common/acp/stdio_client.py:L488–L543](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/acp/stdio_client.py#L488-L543)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/protocols/feature-depth-acp.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-02；updated: 2026-10-02
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/acp/cli.py:L36-L60；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/acp/cli.py:L75-L82
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/common/utils.py:L2432-L2433；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/acp/cli.py:L13-L24
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/acp/stdio_client.py:L1-L13；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/acp/subprocess_env.py:L1-L12
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/common/acp/stdio_client.py:L512-L521；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/system_tests/test_acp_stdio_client_st.py:L162-L187
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/system_tests/test_acp_stdio_client_st.py:L191-L199；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/acp/cli.py:L19-L29
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/acp/cli.py:L32-L62；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/acp/cli.py:L65-L86
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/common/acp/stdio_client.py:L484-L492；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/common/acp/stdio_client.py:L545-L549
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/acp/cli.py:L13-L66；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/acp/stdio_client.py:L3-L13
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/common/acp/stdio_client.py:L488-L543
- 源页字段（feature）：acp
- 入口（entry_points）：jiuwenswarm/acp/stdio_client.py
- 源页字段（source_globs）：jiuwenswarm/acp/stdio_client.py；jiuwenswarm/acp/*.py
