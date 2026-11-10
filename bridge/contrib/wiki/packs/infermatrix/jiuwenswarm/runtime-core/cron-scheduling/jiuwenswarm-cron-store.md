---
name: jiuwenswarm-cron-store
description: Cron 文件与 etcd 存储后端：FileCronJobStore 双层锁、原子写、修订号与 work_mode 惰性迁移，etcd 存储的 CAS 单次重试、watch 退避重连与 store_backend 后端选择
metadata:
  scope: 只收 CronJob 持久化、后端选择、文件锁、变更修订与 etcd CAS/watch；任务 schema、表达式和执行路由归 jiuwenswarm-runtime-cron，设计取舍归 cron-scheduling-design-tradeoffs
---
# Cron 文件与 etcd 存储后端

## 现状

### 职责和边界

- 说明 CronJob 持久化、后端选择、文件锁、变更修订与 etcd CAS/watch；任务 schema、表达式和执行路由见 Cron 主页面。

### 文件存储（store.py）

- JSON 读、upsert 和删除各自通过双层锁保护：进程内 asyncio.Lock + 跨进程 portalocker 伴生 `cron_jobs.json.lock`（默认 10s 超时）；文件锁在 to_thread 里获取，避免阻塞事件循环。但 update_job 先 get_job、在锁外合并 patch、再单独锁定 upsert；
  - 不能据此宣称同一任务的并发 patch 是完整原子读改写（[store.py:222-230](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/cron/store.py#L222-L230)）
  - （[store.py:28](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/cron/store.py#L28)、
  - [store.py:56-69](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/cron/store.py#L56-L69)）。
- 原子写（.tmp + replace）；读侧任何异常（缺文件/坏 JSON/非 dict）都静默返回 {"version":1,"jobs":[]}——文件损坏的表现是"清空"而非报错（[store.py:301-324](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/cron/store.py#L301-L324)）。
- get_revision 是 stat 派生哈希 (mtime_ns<<40)^(ctime_ns<<16)^size，不是递增序号；
  - supports_watch=False、watch() 直接 NotImplementedError，该后端不提供事件 watch，上层可轮询 revision 发现变更（[store.py:40](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/cron/store.py#L40)、
  - [store.py:71-83](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/cron/store.py#L71-L83)）。
- work_mode 惰性迁移发生在 list_jobs 的同一把锁内：project_id 反查（include_hidden=True）优先，查不到按 targets 含 tui → "code"、否则 "work"；
  - 只写回缺/非法 work_mode 的 job，全部合法时跳过项目查询与迁移写回（仍有读取、加锁和解析开销）（[cron_job_mutations.py:55-117](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/cron/cron_job_mutations.py#L55-L117)、
  - [store.py:85-105](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/cron/store.py#L85-L105)，
  - TestCronJobLazyMigration [test_cron_job_mode.py:324-544](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/gateway/test_cron_job_mode.py#L324-L544)）。
- 默认存储路径为 workspace 的 `agent` 目录下的 `home/cron_jobs.json`（FileCronJobStore 构造器可指定 path）（get_cron_jobs_path）：遗留 gateway/cron_jobs.json 不读、不迁移、
  - 不删除（[test_cron_store_path_resolution.py:28-38](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/gateway/test_cron_store_path_resolution.py#L28-L38)、
  - [test_cron_store_path_resolution.py:182-196](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/gateway/test_cron_store_path_resolution.py#L182-L196)）。
- 错误面：update_job 任务不存在抛 KeyError("job not found")；delete_job 对不存在 id 返回 False；build_job 静态方法供 runtime 侧 cron 工具先构造同校验的 wire 表示再经常驻 host 提交 mutation，该工具接线把持久化请求交给常驻 Gateway host，store 本身不限制调用进程；
  - 另有 disable_project_jobs 批量停用项目下 enabled 任务（[store.py:116-169](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/cron/store.py#L116-L169)、
  - [store.py:222-272](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/cron/store.py#L222-L272)）。

### etcd 存储（etcd_store.py）与后端选择（factory.py）

- 每 job 一个 key（前缀默认 /jiuwenswarm/cron/jobs/）；连接失败不阻塞 Gateway：list_jobs 返回 []、get_job 返回 None；
  - store_backend=etcd 而 endpoints 为空时记一次 error 且仍返回 etcd store，绝不回落本地文件（[etcd_store.py:34-74](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/cron/etcd_store.py#L34-L74)、
  - [test_cron_factory.py:33-41](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/gateway/test_cron_factory.py#L33-L41)）。
- update_job 的 CAS：range 取 mod_revision → put_if_mod_revision 写入；EtcdCasError 冲突后重读最新值、对最新值重放同一 patch、再 CAS 一次（恰好一次重试）；二次冲突（EtcdCasError 是 EtcdError 子类）或网络错统一转 EtcdError，任务消失转 KeyError；
  - delete_job 是先 get 校验再普通 delete，非 CAS（[etcd_store.py:208-261](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/cron/etcd_store.py#L208-L261)、
  - [etcd_client.py:17-22](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/cron/etcd_client.py#L17-L22)、
  - [test_cron_etcd_store.py:163-209](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/gateway/test_cron_etcd_store.py#L163-L209)）。
- watch 循环：成功连接先回调一次（全量 reload），之后每个前缀事件批回调一次；任何异常按 1s→30s 指数退避重连；list_jobs 跳过 JSON 解码失败的 value，work_mode 迁移写回是逐 key put、无整体事务（[etcd_store.py:30-31](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/cron/etcd_store.py#L30-L31)、
  - [etcd_store.py:263-276](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/cron/etcd_store.py#L263-L276)、
  - [etcd_store.py:89-111](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/cron/etcd_store.py#L89-L111)）。
- create_gateway_cron_store 只认 gateway.cron.store_backend（默认 file），etcd 必须显式 opt-in，绝不因配置了 endpoints 或 agentos router 而隐式切换；扁平键 gateway.cron_store_backend 与 agentos.cron_store_backend 被忽略；
  - endpoints 支持列表或逗号分隔字符串（[factory.py:41-84](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/cron/factory.py#L41-L84)、
  - [test_cron_factory.py:43-76](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/gateway/test_cron_factory.py#L43-L76)）。

### 怎样验证

- 源码链接固定在 f0a69728c96b5961d993449f1a901cbd2f4dac5b。聚焦单测选择器和验证范围见[[jiuwenswarm-runtime-cron]]（原模块页面；源锚点 #怎样验证）；单元契约不能替代真实服务、模型端点或跨平台集成验证。

### 相关文档

- [[jiuwenswarm-runtime-cron]]（原模块架构与入口）
- [[jiuwenswarm-instance-manager]]（相邻模块）

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/cron-scheduling/jiuwenswarm-cron-store.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/runtime/cron/cron_job_mutations.py；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/runtime/cron/etcd_client.py
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/runtime/cron/etcd_store.py；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/runtime/cron/factory.py
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/runtime/cron/store.py；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/gateway/test_cron_etcd_store.py
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/gateway/test_cron_factory.py；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/gateway/test_cron_job_mode.py
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/gateway/test_cron_store_path_resolution.py
