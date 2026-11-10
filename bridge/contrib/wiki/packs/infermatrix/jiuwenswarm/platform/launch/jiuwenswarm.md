---
name: jiuwenswarm
description: jiuwenswarm 顶层包：start_services、app、debug_launcher、init_workspace、dotenv_early 的入口与关键文件，启动参数分派、端口回退与持久化、子进程环境注入、就绪横幅、dotenv_early 契约、macOS 代理继承，以及 LLM 方言与 SSE 补丁、acp/cli 兼容别名和对应测试
metadata:
  scope: 只收顶层包入口与实现细节、验证用例、相关文档和路由；instances.yaml 校验、锁与安全停止归 jiuwenswarm-instance-manager，桌面外壳归 jiuwenswarm-channels-desktop，设计取舍归 launch-design-tradeoffs
---
# jiuwenswarm 顶层包：启动入口、多实例与运行时补丁

## 现状

- 负责 JiuwenSwarm 的进程启动和初始化：一条命令拉起 AgentServer 与 Gateway、管理多实例（--dotenv/--name）、本地 debug 构建启动、初始化用户数据目录，并在 import 链最前面解析 dotenv。这里还放着 OpenAI/Anthropic 各家方言和 SSE 网关的运行时补丁，以及 `acp/`、`cli/` 下为迁走模块保留的兼容别名。
- **入口**
- `jiuwenswarm/start_services.py` — `jiuwenswarm-start` 主入口：按模式启动前后端服务，处理 --list/--status/--stop/--restart/--name 多实例命令、端口检查和端口回退
- `jiuwenswarm/app.py` — 先后启动 `server.app_agentserver` 和 `gateway.app_gateway` 两个进程，支持 --dotenv 多实例隔离
- `jiuwenswarm/debug_launcher.py` — `jiuwenswarm-start debug`：npm install/build 前端、按 config.yaml 里启用的外部 CLI agent 执行 uv sync，再在后台启动服务并写入带时间戳的日志；也负责停止后台服务
- `jiuwenswarm/init_workspace.py` — `jiuwenswarm-init`：询问语言偏好，把 config.yaml、.env 模板、agent 模板和多语言文件复制到用户数据根目录；支持 -f 强制重建和 --name 命名实例
- `jiuwenswarm/channels/acp/app_acp.py` — ACP 频道的命令行入口：用 argparse 解析参数，run_acp 负责运行，结果以 JSON 写到 stdout
- `jiuwenswarm/acp/cli.py` — 外部 ACP agent（stdio）的 CLI 冒烟测试，与 acp_chat 工具共用同一份配置
- `jiuwenswarm/cli/main.py` — 历史远程 CLI 模块路径的兼容入口
- **关键文件**
- `jiuwenswarm/dotenv_early.py` — 扫描 sys.argv 里的 --dotenv/--name，设置 JIUWENSWARM_DATA_DIR；必须在导入其他 jiuwenswarm 模块之前调用
- `jiuwenswarm/llm_provider_compat_patch.py` — 运行时补丁：修正 ModelArts 等 provider 在 Anthropic 参数和 OpenAI tool_choice 上的方言差异
- `jiuwenswarm/llm_sse_patch.py` — 给 OpenAIModelClient._parse_response 打补丁：非流式 invoke() 收到只含 SSE 文本的响应时，先组装成 ChatCompletion 再交给原逻辑解析
- `jiuwenswarm/acp/stdio_client.py` — ACP stdio 客户端的 re-export，实现已移到 `jiuwenswarm.common.acp`；console script `jiuwenswarm-acp-chat` 仍引用这个路径
- `jiuwenswarm/acp/subprocess_env.py` — ACP 子进程环境构造的 re-export，按 docstring 计划在阶段 3 随 `acp/` 目录一起删除
- `jiuwenswarm/cli/chat.py` — `channels.cli.chat` 的兼容别名；同目录下的 _terminal/events/gateway_client/render 也是同类别名

### 启动流程与早期环境加载的实现细节

- 以下行为在 commit `f0a6972` 上逐条核对，行号链接即证据；未运行任何测试，仅记录用例断言的契约。
- **参数分派与校验**：`mode` 限定 `all/web/app/dev/debug`（默认 `all`）；`--list/--status/--stop/--restart` 是互斥组；`--restart` 只接受 `all/app/web`；`debug` 不能与 `--name` 组合（debug 永远驱动默认实例）；`--skip-build` 仅对 `debug` 有意义；后面三种自定义组合校验失败返回 1；
  - 非法 mode 或管理选项互斥冲突由 argparse 以 SystemExit(2) 拒绝（[start_services.py:1022-1112](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/start_services.py#L1022-L1112)）。
- **SIGTERM 与日志初始化**：`main()` 把 SIGTERM 接到 `default_int_handler`，将其转为 KeyboardInterrupt；在 `_run_processes` 或 `_run_instance_with_pid` 的监管循环中触发时清理并返回 130；
  - INFO 级 stdout 日志在 `main()` 内配置而非 import 时，否则 `--list/--status` 的表格会被根 logger 默认 WARNING 级静默吞掉（[start_services.py:1158-1173](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/start_services.py#L1158-L1173)）。
- **默认实例的端口持久化契约**：默认实例没有 bootstrap .env 也没有 instances.yaml 条目，子进程经 `app.py` 的 `load_dotenv_runtime(get_env_file(), override=True)` 读端口；因此 `_run` 的每次默认实例启动（all/app/web/dev）（无论是否发生回退）都把本次实际端口 upsert 进 `~/.jiuwenswarm/config/.env`，防止上次回退残留（如 `GATEWAY_PORT=20001`）让之后无冲突的启动静默绑定旧端口；
  - 写入失败视为致命返回 1（[start_services.py:349-382](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/start_services.py#L349-L382)、
  - [start_services.py:827-859](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/start_services.py#L827-L859)、[app.py:15-40](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/app.py#L15-L40)）。
- **端口冲突回退**：从实例自身 index 向上扫 10 个 index 的完整 4 端口组，并排除其他已配置实例已声明的端口；命中后原地改写内存 config 并持久化（命名实例写 instances.yaml + bootstrap .env，默认实例写 config/.env），持久化失败直接中止启动——否则子进程仍读旧端口并在 bind 时崩溃；
  - 区间耗尽返回 1，并按平台给出 `--stop`/netstat/lsof 排查提示（[start_services.py:228-346](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/start_services.py#L228-L346)）。
- **子进程环境注入**：`_start_process` 为每个子进程注入 `JIUWENSWARM_START_CMD` 与解析后的端口组（`AGENT_SERVER_PORT`、`AGENT_PORT`、`WEB_PORT`、`GATEWAY_PORT`、`FRONTEND_PORT`），设置 `JIUWENSWARM_CLI_PORTS=1` 并删除继承的 `AGENT_SERVER_URL`（Gateway 优先读该 URL，残留值会绕过重映射端口）；
  - 子进程内 `load_dotenv_runtime(override=True)` 据此保留启动器注入的端口组，不被旧 .env 覆盖（[start_services.py:584-615](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/start_services.py#L584-L615)、
  - [dotenv_early.py:110-143](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/dotenv_early.py#L110-L143)）。
- **就绪等待与端口横幅**：`_wait_for_services_ready` 对每个已启动进程的目标端口做 TCP connect 探测（`127.0.0.1` 失败再试 `::1`，对应 Vite on Windows 只绑 IPv6 回环）；Web UI 一可达就先打印"启动中"部分横幅，全部就绪后刷新为"服务已启动"；任一已启动子进程退出立即停止等待；
  - 总超时默认 30s，含 `web-dev` 时 45s（[start_services.py:687-791](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/start_services.py#L687-L791)）。
- **监管与退出路径**：启动器以 0.5s 间隔轮询子进程，任一退出即以其退出码作为启动器退出码；KeyboardInterrupt 返回 130；`finally` 中先对全部存活子进程 `terminate()`，8 秒内未全部退出再 `kill()`（[start_services.py:413-457](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/start_services.py#L413-L457)、
  - [start_services.py:618-634](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/start_services.py#L618-L634)）。dev 模式在包安装且缺 `channels/web/frontend/package.json` 时抛 `RuntimeError`；
  - npm 子进程不接收 `--dotenv`，端口靠继承的环境变量传入（[start_services.py:525-562](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/start_services.py#L525-L562)）。
- **dotenv_early 契约**：每个入口必须在导入其他 jiuwenswarm 模块**之前**调用 `parse_dotenv_early`；它扫描 sys.argv 但不删除参数（argparse 稍后正常解析）；`--dotenv` 优先于 `--name`；`--name` 时自行定位 instances.yaml（home 可用 `JIUWENSWARM_HOME` 覆盖），workspace 缺省 `~/.jiuwenswarm-instances/<name>`，
  - bootstrap .env 缺失时现场用按 yaml 顺序和基础端口直接计算的 `_create_basic_bootstrap_env`（函数体不调用共享路径解析；bootstrap 模块本身仍导入 instance_manager 依赖） 生成（[dotenv_early.py:146-202](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/dotenv_early.py#L146-L202)、
  - [dotenv_early.py:205-278](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/dotenv_early.py#L205-L278)）。
  - 导入该模块用 `setdefault` 补入 `GRPC_ENABLE_FORK_SUPPORT=0`、`GRPC_VERBOSITY=ERROR`，已有环境值保留（必须在 grpc 懒初始化前生效，否则 fork 出的工具子进程 stderr 会被 C-core 日志污染）（[dotenv_early.py:33-49](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/dotenv_early.py#L33-L49)）。
  - 注意早期名校验只拒绝空名和 `default/config/tmp`，完整规则（含保留名 `jiuwenswarm`/`all`）留给后续 `validate_instance_name`。
- **init_workspace 命名实例**：实例运行中拒绝初始化并提示先 `--stop`；初始化后先探测自身 index 端口；仅发现占用时才扫描无冲突端口组（`scan_range=20`，排除其他实例已声明端口）并连同 workspace 写入 instances.yaml 与 bootstrap .env；
  - 区间耗尽仅警告并保留原 index 端口，留给启动时回退重试（[init_workspace.py:73-143](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/init_workspace.py#L73-L143)）。
- **macOS 系统代理继承**：`_inherit_system_proxy` 仅在 darwin 生效；
  - 环境中已存在任何 `http_proxy`/`https_proxy`/`all_proxy`（含空值，显式设置优先）时不覆盖，否则才把 `getproxies_macosx_sysconf` 发现的系统代理写入子进程 env（[start_services.py:565-581](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/start_services.py#L565-L581)）。
  - `_resolve_runtime_ports`（读 `AGENT_SERVER_PORT`/`WEB_PORT`/`GATEWAY_PORT`/`FRONTEND_PORT` 覆盖、非法或超出 1-65535 的值忽略）在本包内没有生产调用方，仅被单元测试直接调用（[start_services.py:637-662](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/start_services.py#L637-L662)）。

#### 怎样验证

- `tests/unit_tests/test_start_services_ready_hint.py` — 端口横幅（含提前打印与超时省略号）、IPv4/IPv6 探测、子进程端口注入与 `AGENT_SERVER_URL` 删除、`JIUWENSWARM_CLI_PORTS` 抵御旧 .env 覆盖（issue #2749）、子进程提前退出终止等待。
- `tests/test_start_services_proxy.py` — macOS 代理三态：无显式代理时继承系统代理、显式代理（含空值）保留、非 darwin 平台不动。
- `tests/unit_tests/test_instance_manager.py::TestStartServicesFallback` — 命名/默认实例回退持久化、区间耗尽返回 1、持久化失败中止、无冲突启动清理残留端口。
- `tests/system_tests/test_init_workspace.py` — 初始化 CLI 的语言偏好、workspace 创建与集成路径。
- **相关模块**
- [[jiuwenswarm-instance-manager]]（instance_manager：多实例配置、端口与进程管理） — 端口分配公式、instances.yaml 校验、锁与安全停止的实现细节
- [[jiuwenswarm-common-1]]、[[jiuwenswarm-common-2]]（jiuwenswarm/common/：公共基础模块） — `app.py` 拉起的 AgentServer/Gateway 子进程由 `common/process_supervision.py` 监管重启；`get_env_file`/`get_user_workspace_dir` 的路径解析也在 common
- [[jiuwenswarm-channels-cli]]（CLI 频道（jiuwenswarm/channels/cli）） — 端口回退提示中 `jiuwenswarm chat` / TUI 连接方的实现
- **相关文档**
- `docs/zh/Quickstart.md` — 改动涉及启动命令、初始化流程或默认启动模式时读
- `README_CN.md` — 核对 jiuwenswarm-start / jiuwenswarm-init 等命令的对外说明是否与改动一致时读
- `docs/zh/ACP插件使用.md` — 改动涉及 acp/cli.py、channels/acp/app_acp.py 或 ACP 兼容路径时读
- `docs/zh/FAQ.md` — 改动影响端口、多实例或启动报错等常见问题的表现时读
- `TESTING.md` — 给启动器或补丁补测试时参考；里面有过期路径，应以 tests/ 下现有用例为准
- **路由**
- `jiuwenswarm/acp/`
- `jiuwenswarm/app.py`
- `jiuwenswarm/channels/acp/`
- `jiuwenswarm/cli/`
- `jiuwenswarm/debug_launcher.py`
- `jiuwenswarm/dotenv_early.py`
- `jiuwenswarm/init_workspace.py`
- `jiuwenswarm/llm_provider_compat_patch.py`
- `jiuwenswarm/llm_sse_patch.py`
- `jiuwenswarm/start_services.py`

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/launch/jiuwenswarm.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-09-30；updated: 2026-10-01
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/start_services.py；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/app.py；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/dotenv_early.py
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/init_workspace.py；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/test_start_services_ready_hint.py
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/test_start_services_proxy.py；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/system_tests/test_init_workspace.py
