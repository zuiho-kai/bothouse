---
name: feature-depth-cli
description: 交互式命令行实现深读：jiuwenswarm.cli 对 channels.cli 的模块别名、JIUWENSWARM_SKIP_DOTENV 与 .env 优先级、复用 /tui 通道的单客户端互斥、main() 退出码契约与 KeyboardInterrupt 130、TestInteractiveLoop 断言
metadata:
  scope: 命令行进程入口与测试的实现细节；职责边界、选项清单、取舍和验证步骤归 feature-cli
---
# 交互式命令行：实现深读

## 现状

- [[feature-cli]]（功能概览） · [[gateway-channels-overview]]（owner 入口）
- **对 jiuwenswarm.channels.cli 的模块别名耦合** jiuwenswarm/cli 下的 _terminal.py、chat.py、events.py 通过 sys.modules[__name__] = import_module("jiuwenswarm.channels.cli.*") 把旧路径整体替换为新实现模块；旧导入路径因此可用，但任何对这些名字的模块级操作（如二次赋值）实际落在被替换后的模块上。
- 来源：[jiuwenswarm/cli/_terminal.py:L5–L8](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/cli/_terminal.py#L5-L8),
  - [jiuwenswarm/cli/chat.py:L5–L8](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/cli/chat.py#L5-L8),
  - [jiuwenswarm/cli/main.py:L5–L7](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/cli/main.py#L5-L7)
- **JIUWENSWARM_SKIP_DOTENV 与 .env 优先级** 环境变量 JIUWENSWARM_SKIP_DOTENV 未设置或不等于 "1"（strip 后比较）时，main 启动时执行 load_dotenv(dotenv_path=get_env_file(), override=False)：已存在的进程环境变量优先于 .env 文件中的同名值；设为 "1" 则跳过这段加载，但导入阶段的 parse_dotenv_early("jiuwenswarm") 仍先行执行，不受该开关控制。
  - 文档另给出 --mode 默认 code.normal、--gateway-url 默认 ws://127.0.0.1:19001/tui。
- 来源：[jiuwenswarm/channels/cli/main.py:L19–L21](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/cli/main.py#L19-L21),
  - [jiuwenswarm/channels/cli/main.py:L29–L36](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/cli/main.py#L29-L36),
  - [docs/zh/命令行指令.md:L228–L235](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E5%91%BD%E4%BB%A4%E8%A1%8C%E6%8C%87%E4%BB%A4.md#L228-L235)
- **复用 /tui 通道：共用管线与单客户端互斥** `jiuwenswarm chat` 复用 Gateway 的 /tui WebSocket 路由（channel_id="tui"），与 TUI 共用相同的 MessageHandler 和 AgentServer 路径，无需另建服务面；文档同时记录其代价：同一 channel_id="tui" 同一时刻只能有一个 WebSocket 客户端在线，chat 运行时打开 TUI（或反过来）会替换该通道上的上一个客户端，且首版有意不复刻 TUI 的全部 slash command。
- 来源：[docs/zh/命令行指令.md:L212–L212](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E5%91%BD%E4%BB%A4%E8%A1%8C%E6%8C%87%E4%BB%A4.md#L212-L212),
  - [docs/zh/命令行指令.md:L349–L351](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E5%91%BD%E4%BB%A4%E8%A1%8C%E6%8C%87%E4%BB%A4.md#L349-L351)
- **TestInteractiveLoop 的退出码与终帧行为断言** 实际测试入口在 tests/unit_tests/channels/cli/test_chat.py 的 TestInteractiveLoop：test_chat_error_returns_1 注入 {"event": "chat.error", "payload": {"error": "something broke"}} 帧，断言 _run_interactive_loop 返回 1；
  - test_keepalive_final_does_not_terminate 注入 event_type 为 keepalive 的 chat.final 后再收到 chat.delta 与真 final，断言流未被提前终止（renderer.streamed_text=="ok" 且返回 0）。这些是源码中的既有断言，不代表当前已运行通过。
- 来源：[tests/unit_tests/channels/cli/test_chat.py:L829–L836](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/channels/cli/test_chat.py#L829-L836),
  - [tests/unit_tests/channels/cli/test_chat.py:L839–L846](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/channels/cli/test_chat.py#L839-L846),
  - [tests/unit_tests/channels/cli/test_chat.py:L884–L891](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/channels/cli/test_chat.py#L884-L891),
  - [tests/unit_tests/channels/cli/test_chat.py:L897–L905](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/channels/cli/test_chat.py#L897-L905)
- **main() 进程入口契约：剥离可选 chat 前缀，以 run_chat 返回值作进程退出码** main() 无参数，从 sys.argv[1:] 读取；首个 token 恰为 "chat" 时先剥离，再交给 chat 参数解析器。它不以返回值交付结果：末行 sys.exit(run_chat(chat_args)) 把 run_chat 的返回值直接作为进程退出码（文档定义 0 成功、1 Agent 返回错误、2 CLI 参数错误、3 Gateway 不可达、4 当前调用不支持交互输入、130 用户中断）。
  - 调用方须按进程入口方式调用——历史路径 jiuwenswarm/cli/main.py 仅转发该 main 并在 __main__ 下执行。
- 来源：[jiuwenswarm/channels/cli/main.py:L41–L51](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/cli/main.py#L41-L51),
  - [docs/zh/命令行指令.md:L338–L347](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E5%91%BD%E4%BB%A4%E8%A1%8C%E6%8C%87%E4%BB%A4.md#L338-L347),
  - [jiuwenswarm/cli/main.py:L5–L11](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/cli/main.py#L5-L11)
- **main() 启动流程与文档载明的 /tui WebSocket 路由** main() 先 parse_dotenv_early 并导入 run_chat；除非 JIUWENSWARM_SKIP_DOTENV=1，否则再 load_dotenv(get_env_file(), override=False)。随后剥离 argv 首个 "chat"，sys.exit(run_chat(chat_args)) 使其返回值成为退出码。
  - 文档载明 chat 经 Gateway /tui WebSocket（channel_id="tui"）与 TUI 共用 MessageHandler 和 AgentServer 路径。
- 来源：[jiuwenswarm/channels/cli/main.py:L15–L51](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/cli/main.py#L15-L51),
  - [docs/zh/命令行指令.md:L169–L240](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E5%91%BD%E4%BB%A4%E8%A1%8C%E6%8C%87%E4%BB%A4.md#L169-L240)
- **main() 启动阶段 KeyboardInterrupt 守卫：记录警告后调用 sys.exit(130)；dotenv ImportError 跳过** main() 三处 except KeyboardInterrupt（早期导入、dotenv 加载（仅当 JIUWENSWARM_SKIP_DOTENV strip 后不为 '1'）、参数解析）各记 'Interrupted during startup. Exiting.' 并调用 sys.exit(130)；dotenv 块的 ImportError 以 pass 跳过，启动继续。
- 来源：[jiuwenswarm/channels/cli/main.py:L19–L39](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/cli/main.py#L19-L39),
  - [jiuwenswarm/channels/cli/main.py:L45–L50](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/cli/main.py#L45-L50)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/gateway-channels/feature-depth-cli.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-02；updated: 2026-10-02
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/cli/_terminal.py:L5-L8；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/cli/chat.py:L5-L8
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/cli/main.py:L5-L7；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/cli/main.py:L19-L21
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/cli/main.py:L29-L36；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:docs/zh/命令行指令.md:L228-L235
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:docs/zh/命令行指令.md:L212-L212；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:docs/zh/命令行指令.md:L349-L351
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/channels/cli/test_chat.py:L829-L836；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/channels/cli/test_chat.py:L839-L846
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/channels/cli/test_chat.py:L884-L891；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/channels/cli/test_chat.py:L897-L905
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/cli/main.py:L41-L51；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:docs/zh/命令行指令.md:L338-L347
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/cli/main.py:L5-L11；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/cli/main.py:L15-L51
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:docs/zh/命令行指令.md:L169-L240；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/cli/main.py:L19-L39
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/cli/main.py:L45-L50
- 源页字段（feature）：cli
- 入口（entry_points）：jiuwenswarm/cli/main.py
- 源页字段（source_globs）：jiuwenswarm/cli/main.py；jiuwenswarm/cli/*.py
