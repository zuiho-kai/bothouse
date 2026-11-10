---
name: cron-scheduling-knowledge
description: cron-scheduling 知识片段：传输无关的 CronJob 模型与可替换后端、mode 归一与 proactive 保护、gateway.cron.store_backend 配置、from_dict 往返校验、CronJobStoreBackend 协议
metadata:
  scope: 只收 runtime/cron 包的架构、配置、校验与后端协议知识片段（附源码依据）；运行时细节归 jiuwenswarm-runtime-cron，存储实现归 jiuwenswarm-cron-store
---
# cron-scheduling：CronJob 模型、双后端存储与投递路由

## 现状

- **传输无关的任务模型与可替换持久化后端**
- jiuwenswarm/runtime/cron 是传输中立（transport-neutral）的定时任务模型与持久化包：models.py 定义 CronJob/CronRunState/CronTarget 数据类与校验、cron_expr.py 负责 5/7 段表达式归一，持久化由 CronJobStoreBackend 协议抽象，FileCronJobStore（本地 JSON，supports_watch=False）与 EtcdCronJobStore（ appliance 主备 Gateway，supports_watch=True）是两个实现；
  - 包出口 __init__ 只导出 CronJob、CronJobStore、CronRunState、CronTargetChannel。CronRunState 明确不在持久化协议内（仅内存）。工厂 create_gateway_cron_store 按配置返回后端，Gateway 是唯一持久化入口，Runtime 侧 cron 工具经 build_job 产出同一份已校验的线上表示后提交变更。
- Sources / 来源：[jiuwenswarm/runtime/cron/store_base.py:L11–L70](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/cron/store_base.py#L11-L70),
  - [jiuwenswarm/runtime/cron/__init__.py:L1–L6](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/cron/__init__.py#L1-L6),
  - [jiuwenswarm/runtime/cron/factory.py:L54–L84](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/cron/factory.py#L54-L84),
  - [jiuwenswarm/runtime/cron/store.py:L139–L170](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/cron/store.py#L139-L170)
- **模式归一、proactive 保护、模型解析与 IM 投递绑定**
- 任务支持 agent/team 及三段命名（agent.work.normal 等）共 20 余种 mode；特殊 mode "proactive.tick" 由 proactive_cron_sync 自动注册，其任务受保护——delete（非 force）抛 _ProactiveJobProtected，update 只允许 cron_expr/timezone/expired/updated_at 字段。
  - 模型经 resolve_cron_model 按 config → zen → login 顺序解析到规范 model_name，login 来源触发凭据绑定（CronJob.credential_ref 只认服务端登录会话派生的句柄）。投递侧 dingtalk_routing 把 originating 会话编码为 "dingtalk::{conv}::{sender}::{type}" 存入 session_id，内部会话 ID 前缀（dingtalk_ 等）不会被误当 staffId。
- Sources / 来源：[jiuwenswarm/runtime/cron/models.py:L80–L114](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/cron/models.py#L80-L114),
  - [jiuwenswarm/runtime/cron/cron_job_mutations.py:L26–L46](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/cron/cron_job_mutations.py#L26-L46),
  - [jiuwenswarm/runtime/cron/models.py:L239–L264](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/cron/models.py#L239-L264),
  - [jiuwenswarm/runtime/cron/dingtalk_routing.py:L44–L66](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/cron/dingtalk_routing.py#L44-L66)
- **后端选择配置与任务元数据暴露**
- 工厂读取 `gateway.cron.store_backend`：未设置或空白时默认 "file"（值经 strip().lower() 归一）；仅当归一后等于 "etcd" 才构造 EtcdCronJobStore，其他任何值（含未知字符串，其原样保留在 CronStoreSettings.backend 中）都返回 FileCronJobStore——即选择 file 存储，而不是把值改写为 "file"。`etcd_endpoints` 接受列表/元组或逗号分隔字符串，逐项 strip 后丢弃空项；
  - `etcd_prefix` 缺省为 "/jiuwenswarm/cron/jobs/"。`cron_job_metadata()` 向客户端暴露 modes、default_mode、default_timeout_seconds、default_team_timeout_seconds 与 max_timeout_seconds；它不包含 name/description 长度上限（64/500）或最小超时 60 秒，这些仅由常量与校验函数体现。
- Sources / 来源：[jiuwenswarm/runtime/cron/factory.py:L32–L51](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/cron/factory.py#L32-L51),
  - [jiuwenswarm/runtime/cron/factory.py:L70–L84](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/cron/factory.py#L70-L84),
  - [jiuwenswarm/runtime/cron/models.py:L175–L190](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/cron/models.py#L175-L190)
- **往返校验与损坏条目的隔离**
- CronJob.from_dict 逐字段规整并校验（id/name/cron_expr/timezone/targets 必填、长度上限、wake_offset_seconds 与 timeout_seconds 范围），并在第 536 行调用 validate_cron_expression(cron_expr, timezone=timezone)；后者用 croniter 校验语法后直接调用 `ZoneInfo(timezone)`，无效时区的异常未被转换为 ValueError。parse_cron_jobs 对非 dict 条目静默跳过；
  - dict 条目若 from_dict 抛错则记 warning 并跳过，使单条损坏数据不会拖垮整个调度列表。往返校验存在两处：构建路径用 `CronJob.from_dict(job.to_dict())`，patch 路径用 `CronJob.from_dict(updated.to_dict())`。
- Sources / 来源：[jiuwenswarm/runtime/cron/models.py:L477–L540](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/cron/models.py#L477-L540),
  - [jiuwenswarm/runtime/cron/cron_expr.py:L55–L76](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/cron/cron_expr.py#L55-L76),
  - [jiuwenswarm/runtime/cron/cron_job_mutations.py:L120–L136](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/cron/cron_job_mutations.py#L120-L136),
  - [jiuwenswarm/runtime/cron/cron_job_mutations.py:L221–L222](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/cron/cron_job_mutations.py#L221-L222)
- **CronJobStoreBackend 后端协议**
- `jiuwenswarm/runtime/cron/store_base.py` 定义存储后端 Protocol `CronJobStoreBackend`：异步方法 `list_jobs`、`get_job(job_id)`、`create_job(...)`（全关键字参数，返回 `CronJob`）、`update_job(job_id, patch)`、`delete_job(job_id, *, force=False)`、`get_revision`、`watch(callback)` 与 `aclose`，
  - 并以 `supports_watch: bool` 声明后端是否支持远端变更监听；docstring 说明个人版用文件后端、HA appliance 选 etcd，`CronRunState` 不属于该协议（仅内存）。`FileCronJobStore` 与 `EtcdCronJobStore` 是该协议的两个实现，`watch` 在文件后端抛 `NotImplementedError`。
- Sources / 来源：[jiuwenswarm/runtime/cron/store_base.py:L11–L70](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/cron/store_base.py#L11-L70),
  - [jiuwenswarm/runtime/cron/store.py:L40–L40](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/cron/store.py#L40-L40),
  - [jiuwenswarm/runtime/cron/store.py:L326–L328](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/cron/store.py#L326-L328)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/cron-scheduling/knowledge.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-07
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/runtime/cron/store_base.py:L11-L70；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/runtime/cron/__init__.py:L1-L6
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/runtime/cron/factory.py:L54-L84；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/runtime/cron/store.py:L139-L170
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/runtime/cron/models.py:L80-L114；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/runtime/cron/cron_job_mutations.py:L26-L46
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/runtime/cron/models.py:L239-L264；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/runtime/cron/dingtalk_routing.py:L44-L66
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/runtime/cron/factory.py:L32-L51；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/runtime/cron/factory.py:L70-L84
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/runtime/cron/models.py:L175-L190；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/runtime/cron/models.py:L477-L540
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/runtime/cron/cron_expr.py:L55-L76；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/runtime/cron/cron_job_mutations.py:L120-L136
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/runtime/cron/cron_job_mutations.py:L221-L222；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/runtime/cron/store.py:L40-L40
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/runtime/cron/store.py:L326-L328
