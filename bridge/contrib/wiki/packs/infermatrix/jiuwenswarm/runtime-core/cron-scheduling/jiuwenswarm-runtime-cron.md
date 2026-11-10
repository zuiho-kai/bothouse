---
name: jiuwenswarm-runtime-cron
description: 定时任务（Cron）运行时：CronJob 数据模型与目标路由、mode 归一与超时、proactive.tick 保护、模型解析与 credential_ref 绑定、共享创建/patch 规则、5/7 段 cron 表达式
metadata:
  scope: 只收任务模型、表达式、执行模式与创建更新规则；文件与 etcd 存储后端归 jiuwenswarm-cron-store，设计取舍归 cron-scheduling-design-tradeoffs
---
# 定时任务（Cron）运行时：任务模型、存储后端与投递路由

## 现状

- 负责定时任务（CronJob）的数据模型、cron 表达式的校验与下次触发时间计算，以及任务的持久化。持久化有两种后端：个人版用文件存储，主备 Gateway 用 etcd 存储，两者都实现同一个存储协议。模块还负责把钉钉里创建的定时任务推送回发起它的会话。
- **从这里读起**
- `jiuwenswarm/runtime/cron/factory.py` — load_cron_store_settings 读取配置，create_gateway_cron_store 据此选用文件存储或 etcd 存储
- `jiuwenswarm/runtime/cron/store_base.py` — CronJobStoreBackend 协议：定义 list/get/create/update/delete/get_revision/watch/aclose，两种后端都要实现
- `jiuwenswarm/runtime/cron/models.py` — CronJob、CronTarget、CronRunState 数据模型，以及目标频道、运行模式、超时、MCP、模型字段的规范化与校验
- **关键文件**
- `jiuwenswarm/runtime/cron/cron_job_mutations.py` — 文件和 etcd 两种存储共用的任务构建、patch 合并、work_mode 推断与迁移逻辑，以及 proactive 任务的改删保护
- `jiuwenswarm/runtime/cron/store.py` — FileCronJobStore：在双层锁下读写 JSON，文件修订号供上层轮询变更（不支持 etcd 式 watch），另有 disable_project_jobs
- `jiuwenswarm/runtime/cron/etcd_store.py` — EtcdCronJobStore：主备 Gateway 用的 etcd 存储，更新时带 mod_revision 做 CAS，并监听前缀变化
- `jiuwenswarm/runtime/cron/etcd_client.py` — 基于 httpx 的精简 etcd v3 gRPC-gateway JSON 客户端（range/put/delete/CAS/watch），不依赖 grpc
- `jiuwenswarm/runtime/cron/cron_expr.py` — cron 表达式规范化、按时区校验、把 ISO 时间转成 7 段 cron、计算下次触发时间
- `jiuwenswarm/runtime/cron/dingtalk_routing.py` — 钉钉定时任务的会话 ID 编码与解析，以及推送元数据解析（Issue #2449）

### 数据模型与目标路由

- `CronJob.from_dict` 的准入门槛：id/name/cron_expr/timezone/targets/description 缺一抛 ValueError；name ≤ 64、description ≤ 500 字符；wake_offset_seconds 必须可转 int 且负值钳为 0；
  - cron_expr 连同 timezone 一起走 validate_cron_expression（[models.py:476-538](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/cron/models.py#L476-L538)）。
- 序列化不对称：to_dict 始终输出 project_id 与 work_mode（空串=默认项目），
  - 而 session_id/chat_type/last_session_id/model_name/model_selection/mcp/app_id/user_id/credential_ref 只在非空时写入（[models.py:431-474](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/cron/models.py#L431-L474)）。
- targets 只存一个频道 ID 字符串；旧 list[dict] 形态取第一个非空 channel_id 兼容；规范化走 CronTargetChannel 枚举（大小写不敏感），非空但非法的值回落默认 "web"；
  - `feishu_enterprise:<app_id>` 是唯一带参键，忽略 `:chat:` 等后续后缀（[models.py:36-77](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/cron/models.py#L36-L77)、
  - [models.py:501-513](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/cron/models.py#L501-L513)）。
- CronRunState 是内存执行态，当前 CronJob 存储协议不序列化它；其中 exec_mode/exec_channel_id/exec_session_id/exec_user_id/exec_work_mode/exec_project_* 在任务被删后仍保留，让 ghost/超时取消仍能路由到持有该请求的同一个 Runtime agent，
  - 而不是回落默认用户（[models.py:644-683](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/cron/models.py#L644-L683)、
  - [store_base.py:11-18](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/cron/store_base.py#L11-L18)）。

### 执行模式与 proactive 保护

- 两套 mode 归一入口：normalize_cron_job_mode（create/update 严格路径）对未知值抛 ValueError("Invalid cron job mode")，已知值先过 _CRON_JOB_MODE_ALIASES（plan→agent、agent.fast→agent、team.plan→team.plan.normal）再经 deprecate_mode 落到新三段 canonical（agent→agent.work.normal）；
  - coerce_cron_job_mode（读盘路径）同样叠加 deprecate_mode，但未知值小写直通不抛错，存量数据不会因未知 mode 起不来。默认 mode 为 "agent"；
  - cron_job_metadata 把 modes/default_mode/超时常量作为 TUI/Web 客户端的单一 schema 来源（[models.py:113-168](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/cron/models.py#L113-L168)，
  - 两步归一期望表见 [test_cron_job_mode.py:35-58](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/gateway/test_cron_job_mode.py#L35-L58)）。
- 超时三档解析：显式 timeout_seconds（60 ≤ 值 ≤ 72h，否则 ValueError）→ team 模式默认 1h → 普通默认 1h；两档默认当前同为 3600s（[models.py:186-205](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/cron/models.py#L186-L205)、
  - [models.py:335-342](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/cron/models.py#L335-L342)）。
- proactive.tick 任务有独立的 store 层保护；注册与实际触发路由需沿 proactive_cron_sync 和 Gateway scheduler 核对：update 只放行 {cron_expr, timezone, expired, updated_at} 四个键，越权键丢弃并 warning；
  - 非 force 删除抛 _ProactiveJobProtected（RuntimeError 子类），直接调用这些 store 删除入口时会经过这一拦截（[cron_job_mutations.py:26-46](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/cron/cron_job_mutations.py#L26-L46)、
  - [cron_job_mutations.py:225-246](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/cron/cron_job_mutations.py#L225-L246)）。

### 模型解析与登录凭据绑定

- resolve_cron_model 命中顺序 config → zen → login，同名自配优先；返回 (canonical, source)，source="login" 向调用方表明需要从创建连接的登录会话捕获 CronJob.credential_ref；
  - controller 与执行注入的实际接线需另沿调用方核对（[models.py:239-263](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/cron/models.py#L239-L263)）。
- 别名解析到 model_client_config.model_name 并展开环境变量占位符；显式配置却解析为空 → ValueError，不持久化空名；zen/登录目录是内存缓存，查找异常只 debug 日志、不阻塞主校验路径；未知模型 ValueError 附最多 20 个可用模型提示；
  - 登录模型名可带 "#index" 后缀，取前半段匹配（[models.py:282-322](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/cron/models.py#L282-L322)；
  - 测试用 autouse fixture 把两个免费来源置空作为干净基线 [test_cron_model_validation.py:28-42](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/gateway/test_cron_model_validation.py#L28-L42)）。

### 共享创建/更新规则（cron_job_mutations.py）

- build_new_cron_job 不落盘：省略 id 时生成 uuid4().hex，构造后经 from_dict(to_dict()) 往返自校验再返回；
  - parse_cron_jobs 逐条容错，单条损坏只 warning("Ignoring invalid cron job id=…") 跳过，不拖垮整个调度器，结果按 updated_at 降序（[cron_job_mutations.py:120-136](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/cron/cron_job_mutations.py#L120-L136)、
  - [cron_job_mutations.py:196-222](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/cron/cron_job_mutations.py#L196-L222)）。
- apply_cron_job_patch 的隐式状态机：patch enabled=true 或修改 cron_expr 时自动清 expired（除非显式 patch expired）；cron_expr 实际变化且未显式传 delete_after_run 时重置该标记（防止一次性提醒任务换排程后被调度器判过期）；patch model_name 而不带 model_selection 时清空旧 model_selection（否则执行侧优先旧 ID 选择）；model_selection 本身经 ModelSelectionResolver 校验；
  - 结尾刷新 updated_at 并整体重新校验（[cron_job_mutations.py:249-368](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/cron/cron_job_mutations.py#L249-L368)，
  - 回归见 [test_cron_store.py:11-48](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/runtime/test_cron_store.py#L11-L48)）。

### Cron 文件与 etcd 存储后端

- 该工作流的职责、顺序、错误边界与源码入口见[[jiuwenswarm-cron-store]]（Cron 文件与 etcd 存储后端）。

### cron 表达式（cron_expr.py）

- 只收 5 段或 7 段：5 段自动前补秒 "0"、后补年 "*"，其余段数抛 ValueError；
  - validate_cron_expression 仅做语法校验（croniter.is_valid + ZoneInfo 时区 + 从当前时刻构造一次），固定过去年份的一次性表达式仍可能在求下次触发时失败（[cron_expr.py:15-32](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/cron/cron_expr.py#L15-L32)、
  - [cron_expr.py:55-76](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/cron/cron_expr.py#L55-L76)）。
- next_cron_datetime 以 max_years_between_matches=130 支持远期固定年份（如 2099），naive 结果继承 base 的时区；
  - iso_to_seven_field_cron 对 naive 输入按给定 timezone 解释、aware 输入先转换，dow 位固定 "?"（[cron_expr.py:8](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/cron/cron_expr.py#L8)、
  - [cron_expr.py:35-52](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/cron/cron_expr.py#L35-L52)、
  - [cron_expr.py:79-94](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/cron/cron_expr.py#L79-L94)）。
- **路由**
- `jiuwenswarm/runtime/cron/`

### 怎样验证

- 聚焦测试（本轮仅静态核对源码与用例，未执行）：tests/unit_tests/runtime/{test_cron_expr,test_cron_store}.py 与 tests/unit_tests/gateway/{test_cron_etcd_store,test_cron_factory,test_cron_job_mode,test_cron_model_validation,test_cron_store_path_resolution}.py。
  - test_cron_etcd_store.py 用内存 FakeEtcdJsonClient 模拟 CAS/watch，不代表真实 etcd 集群行为；scheduler/controller 的 HA 行为只有 test_watch_triggers_scheduler_reload 触及，本页未展开。
- 旧 import 路径 jiuwenswarm.gateway.cron.models 是 jiuwenswarm.runtime.cron 的再导出 shim（[gateway/cron/models.py:3-5](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/cron/models.py#L3-L5)），既有测试大多仍从 gateway.cron 旧路径 import。

### 相关文档

- [[jiuwenswarm-common-auth]]（华为账号登录与免费模型凭据（common/auth）） — resolve_cron_model 的 login 来源与 credential_ref 句柄的来源侧。
- [[jiuwenswarm-runtime]]（共享 Agent Runtime（jiuwenswarm/runtime）） — mode/mcp/timeout 在 AgentServer 执行侧的消费。
- [[jiuwenswarm-common-1]]、[[jiuwenswarm-common-2]]（jiuwenswarm/common/：公共基础模块） — work_mode 与 mode_matrix/deprecate_mode 的共享定义。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/cron-scheduling/jiuwenswarm-runtime-cron.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-09-30；updated: 2026-10-01
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/runtime/cron/models.py；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/runtime/cron/cron_job_mutations.py
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/runtime/cron/store.py；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/runtime/cron/etcd_store.py
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/runtime/cron/factory.py；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/runtime/cron/cron_expr.py
