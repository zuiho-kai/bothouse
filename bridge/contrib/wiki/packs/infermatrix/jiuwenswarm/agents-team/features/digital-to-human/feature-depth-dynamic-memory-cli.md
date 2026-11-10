---
name: feature-depth-dynamic-memory-cli
description: Dynamic Memory CLI 实现深读：网关 call/_invoke 子进程调用、search 返回结构、root 解析与自动 init、无效 JSON 与非零退出的审计、每次起新子进程的取舍、重启后检索的运行时测试
metadata:
  scope: 只收Dynamic Memory CLI 网关与 CLI 侧的调用、错误与测试细节；功能概览归 feature-dynamic-memory-cli
---
# Dynamic Memory CLI（SQLite UT 记忆库与发布/构建流水线）：实现深读

## 现状

- [[feature-dynamic-memory-cli]]（功能概览） · [[agents-team-overview-1]]、[[agents-team-overview-2]]（owner 入口）
- **call() double-checks initialization, then _invoke() spawns the CLI and returns its parsed stdout JSON** Under the init lock, if root/memory.sqlite3 is absent the gateway runs `init --path` without --root; _initialized is set only after that succeeds,
  - so a failed init is retried on the next call. _invoke then runs [sys.executable, script, "--root", root, *args] with cwd=root, UTF-8 env overrides, stdin from DEVNULL, parses stdout as JSON, appends a memory-cli-calls audit entry, and raises RuntimeError when returncode != 0;
  - otherwise it returns the parsed JSON value (whatever json.loads produced, not guaranteed to be a dict).
- 来源：[jiuwenswarm/agents/harness/common/rails/eternal_conversation/memory_cli.py:L43–L57](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/rails/eternal_conversation/memory_cli.py#L43-L57),
  - [jiuwenswarm/agents/harness/common/rails/eternal_conversation/memory_cli.py:L64–L107](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/rails/eternal_conversation/memory_cli.py#L64-L107)
- **CLI search() returns the single group for one query, {"queries": groups} otherwise; gateway search short-circuits blank queries** CLI-side search(root, queries) computes one search_one group per query and returns groups[0] when len==1, else {"queries": groups}.
  - Gateway-side search(query) strips the query and returns {"query": "", "matches": []} locally when empty; otherwise it dispatches `search <query>` through call(), a path a gateway comment says merges published Pending and Built UTs.
- 来源：jiuwenswarm/resources/agent/workspace/skills/dynamic-memory-cli/scripts/dynamic_memory_cli.py:L247–L250
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/dynamic-memory-cli/scripts/dynamic_memory_cli.py#L247-L250`）,
  - [jiuwenswarm/agents/harness/common/rails/eternal_conversation/memory_cli.py:L115–L120](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/rails/eternal_conversation/memory_cli.py#L115-L120)
- **Root resolution and auto-init default; UTF-8 subprocess env** --root is the global project option (init instead takes --path); commands other than init call require_project and raise ValueError("dynamic memory project not found at {root}") if the DB file is missing.
  - The gateway forces PYTHONUTF8=1 and PYTHONIOENCODING=utf-8 on every CLI subprocess.
- 来源：jiuwenswarm/resources/agent/workspace/skills/dynamic-memory-cli/scripts/dynamic_memory_cli.py:L506–L511
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/dynamic-memory-cli/scripts/dynamic_memory_cli.py#L506-L511`）,
  - jiuwenswarm/resources/agent/workspace/skills/dynamic-memory-cli/scripts/dynamic_memory_cli.py:L543–L546
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/dynamic-memory-cli/scripts/dynamic_memory_cli.py#L543-L546`）,
  - jiuwenswarm/resources/agent/workspace/skills/dynamic-memory-cli/scripts/dynamic_memory_cli.py:L98–L100
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/dynamic-memory-cli/scripts/dynamic_memory_cli.py#L98-L100`）,
  - [jiuwenswarm/agents/harness/common/rails/eternal_conversation/memory_cli.py:L70–L76](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/rails/eternal_conversation/memory_cli.py#L70-L76)
- **无效 JSON 与非零 returncode 在审计后抛 RuntimeError；取消时杀掉子进程再重抛** _invoke 中 json.loads 失败时构造 {"error":"invalid_json",...} 结果、先 append_audit 再抛 RuntimeError；returncode != 0 时在审计后抛 "dynamic-memory-cli failed"。communicate() 期间收到 CancelledError 则 _stop_process 杀进程并重抛（returncode 已设置时直接返回）。
- 来源：[jiuwenswarm/agents/harness/common/rails/eternal_conversation/memory_cli.py:L83–L106](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/rails/eternal_conversation/memory_cli.py#L83-L106),
  - [jiuwenswarm/agents/harness/common/rails/eternal_conversation/memory_cli.py:L126–L136](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/rails/eternal_conversation/memory_cli.py#L126-L136)
- **每次 call 起新子进程：换来进程隔离与 UTF-8 固定环境，代价是每命令的启动开销** 设计推断（非作者历史意图）：
- （推断）每次 _invoke 都 create_subprocess_exec 一个新的 Python 解释器并强制 PYTHONUTF8=1、PYTHONIOENCODING=utf-8，受益是与 CLI 的编码和运行时隔离；代价是每条命令都付出解释器启动成本。这是对显示实现的推断，非文档记载的历史意图。
- 来源：[jiuwenswarm/agents/harness/common/rails/eternal_conversation/memory_cli.py:L64–L80](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/rails/eternal_conversation/memory_cli.py#L64-L80)
- **Runtime test: gateway search returns built UT after coordinator restart** test (starting at line 1104 area, shown span 1166-1172) restarts SessionCoordinator on the same tmp_path, resumes background work,
  - and asserts restarted.memory.search("NimbusGate")["matches"][0]["build_state"] == "built" — an actual runtime assertion through the gateway search path. NOT EXECUTED now; cited as existing test evidence.
- 来源：[tests/unit_tests/agentserver/rails/test_eternal_conversation_rail.py:L1166–L1172](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/agentserver/rails/test_eternal_conversation_rail.py#L1166-L1172),
  - [tests/unit_tests/agentserver/rails/test_eternal_conversation_rail.py:L759–L762](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/agentserver/rails/test_eternal_conversation_rail.py#L759-L762)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/agents-team/feature-depth-dynamic-memory-cli.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/dynamic-memory-cli/scripts/dynamic_memory_cli.py:L506-L511
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/dynamic-memory-cli/scripts/dynamic_memory_cli.py:L543-L546
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/dynamic-memory-cli/scripts/dynamic_memory_cli.py:L98-L100
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/rails/eternal_conversation/memory_cli.py:L70-L76
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/agentserver/rails/test_eternal_conversation_rail.py:L1166-L1172
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/agentserver/rails/test_eternal_conversation_rail.py:L759-L762
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/rails/eternal_conversation/memory_cli.py:L83-L106
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/rails/eternal_conversation/memory_cli.py:L126-L136
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/rails/eternal_conversation/memory_cli.py:L64-L80
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/rails/eternal_conversation/memory_cli.py:L43-L57
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/rails/eternal_conversation/memory_cli.py:L64-L107
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/dynamic-memory-cli/scripts/dynamic_memory_cli.py:L247-L250
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/rails/eternal_conversation/memory_cli.py:L115-L120
- 源页字段（feature）：dynamic-memory-cli
- 入口（entry_points）：jiuwenswarm/resources/agent/workspace/skills/dynamic-memory-cli/scripts/dynamic_memory_cli.py
- 源页字段（source_globs）：jiuwenswarm/resources/agent/workspace/skills/dynamic-memory-cli/scripts/dynamic_memory_cli.py；jiuwenswarm/agents/harness/common/rails/eternal_conversation/memory_cli.py
