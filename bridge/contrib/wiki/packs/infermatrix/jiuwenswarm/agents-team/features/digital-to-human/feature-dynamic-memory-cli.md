---
name: feature-dynamic-memory-cli
description: Dynamic Memory CLI：SQLite memory.sqlite3 UT 记忆库、命令行入口与输出契约、子进程网关、--root 与 init --path、检索与发布/构建流水线及内置 test 验证
metadata:
  scope: 只收Dynamic Memory CLI 的命令、状态机、配置与流水线概览；实现深读归 feature-depth-dynamic-memory-cli
---
# Dynamic Memory CLI：SQLite UT 记忆库与发布/构建流水线

## 现状

- **内置验证入口**
- `test` 命令（run_tests）对每个 active UT 的每条 query 跑一次 search_one，断言自身出现在 matches 且 must_include 短语存在于命中内容，返回 total/failed/failures；`--built-only` 限定已构建 UT。build_pending 在同一事务内做等价验收，任何失败整体回滚并返回 status=failed；`bench` 命令测量全量 query 的 p95/mean 检索耗时。
- Sources / 来源：jiuwenswarm/resources/agent/workspace/skills/dynamic-memory-cli/scripts/dynamic_memory_cli.py:L405–L424
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/dynamic-memory-cli/scripts/dynamic_memory_cli.py#L405-L424`）,
  - jiuwenswarm/resources/agent/workspace/skills/dynamic-memory-cli/scripts/dynamic_memory_cli.py:L380–L402
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/dynamic-memory-cli/scripts/dynamic_memory_cli.py#L380-L402`）,
  - jiuwenswarm/resources/agent/workspace/skills/dynamic-memory-cli/scripts/dynamic_memory_cli.py:L469–L486
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/dynamic-memory-cli/scripts/dynamic_memory_cli.py#L469-L486`）
- **命令行入口与输出契约**
- 入口是 `main(argv)`，argparse 定义子命令 init/search/list/show/check-conflicts/add/update/retire/get-state/publish-pending/freeze-pending/build-pending/test/bench。命令执行结果通过 `emit_json` 以单个 JSON 文档写到 stdout；try 块内抛出的异常会被捕获，输出 `{"error": 类型名, "message": ...}` 并以退出码 1 结束。
  - 注意 argparse 解析发生在 try 之前（L539），参数错误或 --help 不走该 JSON 错误路径。`DynamicMemoryGateway.call(*args)` 是进程外的异步封装，向同一脚本转发子命令。
- Sources / 来源：jiuwenswarm/resources/agent/workspace/skills/dynamic-memory-cli/scripts/dynamic_memory_cli.py:L506–L539
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/dynamic-memory-cli/scripts/dynamic_memory_cli.py#L506-L539`）,
  - jiuwenswarm/resources/agent/workspace/skills/dynamic-memory-cli/scripts/dynamic_memory_cli.py:L578–L582
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/dynamic-memory-cli/scripts/dynamic_memory_cli.py#L578-L582`）,
  - [jiuwenswarm/agents/harness/common/rails/eternal_conversation/memory_cli.py:L55–L69](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/rails/eternal_conversation/memory_cli.py#L55-L69)
- **SQLite 状态机与子进程网关**
- 存储是单文件 `memory.sqlite3`（WAL、foreign_keys=ON），含 uts、built_docs（外键级联到 uts.id）和 meta 三张表；meta 保存 schema_version、memory_revision、snapshot_revision、covered_through 和 snapshot。发布路径 publish-pending 在 BEGIN IMMEDIATE 事务中校验提案的 base 修订号、游标连续性，然后应用 changed_uts 并推进修订号；
  - 上层 `DynamicMemoryGateway` 始终以子进程方式调用该脚本（调用方不直接碰数据库），完成的调用会把参数、耗时与结果写入 evidence 审计流——注意子进程创建失败或任务被取消时不会到达该审计写入。
- Sources / 来源：jiuwenswarm/resources/agent/workspace/skills/dynamic-memory-cli/scripts/dynamic_memory_cli.py:L59–L95
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/dynamic-memory-cli/scripts/dynamic_memory_cli.py#L59-L95`）,
  - jiuwenswarm/resources/agent/workspace/skills/dynamic-memory-cli/scripts/dynamic_memory_cli.py:L286–L318
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/dynamic-memory-cli/scripts/dynamic_memory_cli.py#L286-L318`）,
  - [jiuwenswarm/agents/harness/common/rails/eternal_conversation/memory_cli.py:L89–L107](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/rails/eternal_conversation/memory_cli.py#L89-L107)
- **可配置项：--root、init --path 与 meta 默认值**
- 全局 `--root` 决定项目根目录，但 `init` 例外：它使用必需的 `--path` 参数；其余命令先用 require_project 校验 memory.sqlite3 存在。init 写入 meta 默认值：schema_version=1、memory_revision=0、snapshot_revision=0、covered_through=0、空 snapshot。
  - 发布成功时 snapshot_revision 总是 +1、covered_through 更新为 to_cursor、snapshot 被覆盖，而 memory_revision 仅在 changed_uts 非空时 +1。
- Sources / 来源：jiuwenswarm/resources/agent/workspace/skills/dynamic-memory-cli/scripts/dynamic_memory_cli.py:L506–L545
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/dynamic-memory-cli/scripts/dynamic_memory_cli.py#L506-L545`）,
  - jiuwenswarm/resources/agent/workspace/skills/dynamic-memory-cli/scripts/dynamic_memory_cli.py:L86–L95
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/dynamic-memory-cli/scripts/dynamic_memory_cli.py#L86-L95`）,
  - jiuwenswarm/resources/agent/workspace/skills/dynamic-memory-cli/scripts/dynamic_memory_cli.py:L311–L315
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/dynamic-memory-cli/scripts/dynamic_memory_cli.py#L311-L315`）
- **检索与发布/构建流水线**
- search 对 active UT 检索：pending UT 用内容/queries/must_include/tags/source 拼接的临时文档打分，built UT 则读取 built_docs 文档并要求其 content_hash 与当前 UT 一致且状态合格，否则跳过；结果按 priority、score、id 排序。
  - 发布/构建流水线是 publish-pending → freeze-pending（把 pending UT 原子写入冻结批次文件，字段名用 frozen_at 以避免与 UT.updated_at 的时序歧义）→ build-pending（同一事务内重建文档并做检索验收，任一失败整体回滚）。
- Sources / 来源：jiuwenswarm/resources/agent/workspace/skills/dynamic-memory-cli/scripts/dynamic_memory_cli.py:L218–L244
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/dynamic-memory-cli/scripts/dynamic_memory_cli.py#L218-L244`）,
  - jiuwenswarm/resources/agent/workspace/skills/dynamic-memory-cli/scripts/dynamic_memory_cli.py:L321–L339
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/dynamic-memory-cli/scripts/dynamic_memory_cli.py#L321-L339`）,
  - jiuwenswarm/resources/agent/workspace/skills/dynamic-memory-cli/scripts/dynamic_memory_cli.py:L342–L402
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/dynamic-memory-cli/scripts/dynamic_memory_cli.py#L342-L402`）
- **子进程隔离与事务化验收的取舍**
- 网关把每次 CLI 调用放在独立子进程并以 JSON stdout 通信，换取进程隔离与可审计性，但每次调用都要付出进程启动成本；审计写入发生在 communicate() 正常返回之后（记录参数、返回码、耗时与结果），取消路径会先终止子进程并直接重抛 CancelledError，因此该次调用不会留下审计记录。构建侧 build_pending 选择单事务全有或全无：任一 UT 的检索验收或 must_include 检查失败即整体回滚返回 failed，content_hash 与冻结批次不一致的条目被跳过而非报错，以跳过换取幂等重放。
- Sources / 来源：[jiuwenswarm/agents/harness/common/rails/eternal_conversation/memory_cli.py:L64–L107](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/rails/eternal_conversation/memory_cli.py#L64-L107),
  - jiuwenswarm/resources/agent/workspace/skills/dynamic-memory-cli/scripts/dynamic_memory_cli.py:L342–L402
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/dynamic-memory-cli/scripts/dynamic_memory_cli.py#L342-L402`）

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/agents-team/feature-dynamic-memory-cli.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-07
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/dynamic-memory-cli/scripts/dynamic_memory_cli.py:L405-L424
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/dynamic-memory-cli/scripts/dynamic_memory_cli.py:L380-L402
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/dynamic-memory-cli/scripts/dynamic_memory_cli.py:L469-L486
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/dynamic-memory-cli/scripts/dynamic_memory_cli.py:L506-L539
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/dynamic-memory-cli/scripts/dynamic_memory_cli.py:L578-L582
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/rails/eternal_conversation/memory_cli.py:L55-L69
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/dynamic-memory-cli/scripts/dynamic_memory_cli.py:L59-L95
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/dynamic-memory-cli/scripts/dynamic_memory_cli.py:L286-L318
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/rails/eternal_conversation/memory_cli.py:L89-L107
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/dynamic-memory-cli/scripts/dynamic_memory_cli.py:L506-L545
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/dynamic-memory-cli/scripts/dynamic_memory_cli.py:L86-L95
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/dynamic-memory-cli/scripts/dynamic_memory_cli.py:L311-L315
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/dynamic-memory-cli/scripts/dynamic_memory_cli.py:L218-L244
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/dynamic-memory-cli/scripts/dynamic_memory_cli.py:L321-L339
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/dynamic-memory-cli/scripts/dynamic_memory_cli.py:L342-L402
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/rails/eternal_conversation/memory_cli.py:L64-L107
- 源页字段（feature）：dynamic-memory-cli
- 入口（entry_points）：jiuwenswarm/resources/agent/workspace/skills/dynamic-memory-cli/scripts/dynamic_memory_cli.py
- 源页字段（source_globs）：jiuwenswarm/resources/agent/workspace/skills/dynamic-memory-cli/scripts/dynamic_memory_cli.py；jiuwenswarm/agents/harness/common/rails/eternal_conversation/memory_cli.py
