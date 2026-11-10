---
name: cron-scheduling-design-tradeoffs
description: Cron 后端与一致性的设计取舍（设计推断）：默认 file 后端与显式选 etcd、双层锁内 read-modify-write、后端 watch 能力差异，附 factory.py/store.py/etcd_store.py 源码依据与验证入口
metadata:
  scope: 只收设计选择、代价与适用边界；任务 DTO 与投递路由归 jiuwenswarm-runtime-cron，revision/CAS/watch 与后端配置归 jiuwenswarm-cron-store，功能入口归 feature-cron
---
# Cron 后端与一致性的设计取舍

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/cron-scheduling/design-tradeoffs.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/runtime/cron/factory.py；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/runtime/cron/store.py
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/runtime/cron/etcd_store.py；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/gateway/test_cron_factory.py
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/runtime/test_cron_store.py
- 本页解释该组件的设计选择、代价与适用边界。基线为 `f0a69728c96b`。收益和替代方案分析标为**设计推断**，不把推断当成作者历史意图，也不代替规则页。

### 个人模式默认文件，HA 后端显式选择

- factory 默认选择 file，注释明确不由 AgentOS 路由或非空 endpoints 推断 etcd。**设计推断**：普通部署无需引入远端状态服务，HA 用户明确承担服务配置；代价是部署者需要选择后端，环境中存在 etcd 地址本身不改变存储语义。
- 源码依据：[jiuwenswarm/runtime/cron/factory.py:L20–L84](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/cron/factory.py#L20-L84)。

### 把 read-modify-write 放在双层锁内

- FileCronJobStore 注释解释进程内 asyncio.Lock 与跨进程伴生文件锁，并在线程池等待文件锁。**设计推断**：复用本地文件格式并避免事件循环直接等待锁；代价是同一文件更新串行化，这不是多机器共享服务或跨网络文件系统行为保证。
- 源码依据：[jiuwenswarm/runtime/cron/store.py:L31–L69](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/cron/store.py#L31-L69)。

### 后端能力包括 watch，而不只 CRUD

- file 后端声明 supports_watch=False，etcd 声明 True，其注释说明连接失败时 list_jobs 暂返回空列表并由 watch 重试。**设计推断**：后端切换同时影响刷新、暂时可见性与故障处理；不自动回落到 file 可以避免偷偷分叉任务状态，但远端暂不可达时调度视图也受影响。
- 源码依据：[jiuwenswarm/runtime/cron/etcd_store.py:L31–L41](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/cron/etcd_store.py#L31-L41)。

### API、配置与数据流入口

- 任务 DTO、模式、模型与投递路由见[[jiuwenswarm-runtime-cron]]（Cron 运行时）；revision、CAS、watch 与后端配置见[[jiuwenswarm-cron-store]]（存储后端）。

### 关联功能

- 任务执行进入 [[agent-runtime-overview]]（Runtime），登录模型绑定依赖 [[login-auth-overview]]（login-auth），输出投递依赖 [[gateway-channels-overview]]（Gateway/频道）。

### 怎样验证

- [tests/unit_tests/gateway/test_cron_factory.py:L1–L25](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/gateway/test_cron_factory.py#L1-L25)
- [tests/unit_tests/runtime/test_cron_store.py:L1–L25](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/runtime/test_cron_store.py#L1-L25)
- 这些入口用于查找既有验证范围；源码阅读没有替代运行测试或真实服务验证。
