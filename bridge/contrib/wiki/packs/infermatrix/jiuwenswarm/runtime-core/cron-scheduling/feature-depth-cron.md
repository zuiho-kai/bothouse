---
name: feature-depth-cron
description: 定时任务与调度存储实现深读：表达式校验与文件锁单测入口、CronJob.from_dict 校验调用链、etcd update_job 契约与 mod_revision 条件写、store_backend 缺省 file、CAS 单次重试与取舍推断
metadata:
  scope: 只收该功能的深读条目；功能概览归 feature-cron，任务模型归 jiuwenswarm-runtime-cron，存储后端归 jiuwenswarm-cron-store，设计取舍归 cron-scheduling-design-tradeoffs
---
# 定时任务与调度存储：实现深读

## 现状

- [[feature-cron]]（功能概览） · [[cron-scheduling-overview]]（owner 入口）
- **表达式校验与文件锁的单测入口** `test_validate_cron_expression_accepts_shared_five_and_seven_field_syntax` 参数化断言 `validate_cron_expression` 在 `Asia/Shanghai` 下同时接受 5 段（`15 9 * * 1-5`）与 7 段（含固定年份 2099）表达式；
  - `test_next_cron_datetime_preserves_seconds_for_seven_fields` 与 `test_next_cron_datetime_supports_far_future_fixed_year` 断言秒字段保留和跨年触发。`TestCronJobStoreFileLock.test_held_file_lock_times_out_other_store` 断言伴生锁被外部持有时 `create_job` 抛 portalocker `LockException`、锁释放后写入恢复。以上为断言内容，非本次运行结果。
- 来源：[tests/unit_tests/runtime/test_cron_expr.py:L12–L41](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/runtime/test_cron_expr.py#L12-L41),
  - [tests/unit_tests/gateway/test_cron_scheduler.py:L2564–L2593](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/gateway/test_cron_scheduler.py#L2564-L2593)
- **持久化 job 字典到已校验 CronJob 的调用链** 输入是存储读出的单个 job 字典：CronJob.from_dict（models.py:477）规整各字段后，在 536 行把 cron_expr 连同 timezone 传入 validate_cron_expression；后者在 70 行调用 normalize_cron_expr，把 5 段表达式补成 7 段 Quartz（24-25 行），字段数非 5/7 时抛 ValueError；normalize_cron_expr 在 23 行调用 cron_field_count 统计字段数。
  - 校验全部通过后 from_dict 返回完整 CronJob，ValueError 则向上传播给调用方决定取舍。
- 调用路径：`jiuwenswarm/runtime/cron/models.py`（`CronJob.from_dict`） → `jiuwenswarm/runtime/cron/cron_expr.py`（`validate_cron_expression`） → `jiuwenswarm/runtime/cron/cron_expr.py`（`normalize_cron_expr`） → `jiuwenswarm/runtime/cron/cron_expr.py`（`cron_field_count`）
- 来源：[jiuwenswarm/runtime/cron/models.py:L477–L641](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/cron/models.py#L477-L641),
  - [jiuwenswarm/runtime/cron/cron_expr.py:L55–L76](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/cron/cron_expr.py#L55-L76),
  - [jiuwenswarm/runtime/cron/cron_expr.py:L15–L32](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/cron/cron_expr.py#L15-L32),
  - [jiuwenswarm/runtime/cron/cron_expr.py:L11–L12](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/cron/cron_expr.py#L11-L12)
- **update_job 契约：空 id 抛 ValueError("id is required")，job 不存在抛 KeyError("job not found")** update_job 对空 id 抛 ValueError("id is required")，读取不到现有任务抛 KeyError("job not found")；成功路径在锁内按 mod_revision 条件写回并返回更新后的 CronJob。
- 来源：[jiuwenswarm/runtime/cron/etcd_store.py:L208–L246](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/cron/etcd_store.py#L208-L246)
- **store_backend 缺省 "file"、仅显式 "etcd" 生效；etcd_endpoints/etcd_prefix 的缺省与解析** gateway.cron.store_backend 未设置或空白时默认 "file"（取值经 strip().lower() 归一），任何非 "etcd" 值都返回 FileCronJobStore；仅 "etcd" 构造 EtcdCronJobStore，且 etcd_endpoints 为空时只记 error 日志、不回落文件。etcd_endpoints 接受列表/元组或逗号分隔字符串，逐项 strip 并丢弃空项；
  - etcd_prefix 缺省为 "/jiuwenswarm/cron/jobs/"。
- 来源：[jiuwenswarm/runtime/cron/factory.py:L17–L51](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/cron/factory.py#L17-L51),
  - [jiuwenswarm/runtime/cron/factory.py:L63–L84](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/cron/factory.py#L63-L84),
  - [tests/unit_tests/gateway/test_cron_factory.py:L14–L17](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/gateway/test_cron_factory.py#L14-L17)
- **update_job 依赖 etcd 客户端的 mod_revision 条件写** 更新依赖 _client.put_if_mod_revision(..., mod_revision=mod_rev) 条件写入：先经 _get_job_with_rev 取回任务与修订号；任何 EtcdError 统一被包成 _unavailable(...) 再上抛。
- 来源：[jiuwenswarm/runtime/cron/etcd_store.py:L212–L226](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/cron/etcd_store.py#L212-L226)
- **CAS 冲突单次重试后上抛；选 etcd 缺 etcd_endpoints 不回退文件** put_if_mod_revision 抛 EtcdCasError 触发重读任务并重放 patch 的单次重试；重读时任务已删抛 KeyError，重试 put 的 EtcdError 包成 unavailable("cas-put")。选 etcd 但无 endpoints 仅记 error 日志仍构造 EtcdCronJobStore。
- 来源：[jiuwenswarm/runtime/cron/etcd_store.py:L227–L246](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/cron/etcd_store.py#L227-L246),
  - [jiuwenswarm/runtime/cron/factory.py:L75–L83](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/cron/factory.py#L75-L83)
- **默认 file 免外部状态服务（推断收益）；etcd 缺 endpoints 不回落文件（推断代价）** 设计推断（非作者历史意图）：
- 收益（推断）：默认 file 后端使部署无需 etcd 服务，docstring 明确 etcd 仅经 gateway.cron.store_backend=etcd 显式启用、不从非空 endpoints 推断。代价（推断）：误选 etcd 且 etcd_endpoints 为空时不回落文件，工厂记 error 后仍返回 EtcdCronJobStore（测试断言 list_jobs()==[]），_unavailable 相应报 "etcd endpoints are empty"。
- 来源：[jiuwenswarm/runtime/cron/factory.py:L54–L84](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/cron/factory.py#L54-L84),
  - [jiuwenswarm/runtime/cron/etcd_store.py:L65–L74](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/cron/etcd_store.py#L65-L74),
  - [tests/unit_tests/gateway/test_cron_factory.py:L33–L40](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/gateway/test_cron_factory.py#L33-L40)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/cron-scheduling/feature-depth-cron.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-02；updated: 2026-10-02
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/runtime/test_cron_expr.py:L12-L41；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/gateway/test_cron_scheduler.py:L2564-L2593
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/runtime/cron/models.py:L477-L641；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/runtime/cron/cron_expr.py:L55-L76
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/runtime/cron/cron_expr.py:L15-L32；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/runtime/cron/cron_expr.py:L11-L12
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/runtime/cron/etcd_store.py:L208-L246；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/runtime/cron/etcd_store.py:L212-L226
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/runtime/cron/etcd_store.py:L227-L246；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/runtime/cron/factory.py:L75-L83
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/runtime/cron/factory.py:L17-L51；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/runtime/cron/factory.py:L63-L84
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/gateway/test_cron_factory.py:L14-L17；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/runtime/cron/factory.py:L54-L84
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/runtime/cron/etcd_store.py:L65-L74；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/gateway/test_cron_factory.py:L33-L40
- 源页字段（feature）：cron
- 入口（entry_points）：jiuwenswarm/runtime/cron/factory.py
- 源页字段（source_globs）：jiuwenswarm/runtime/cron/factory.py；jiuwenswarm/runtime/cron/*.py
