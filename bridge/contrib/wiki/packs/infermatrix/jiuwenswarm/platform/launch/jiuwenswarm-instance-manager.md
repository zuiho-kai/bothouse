---
name: jiuwenswarm-instance-manager
description: instance_manager 多实例配置、端口与进程管理：instances.yaml 校验、实例名规则、端口分配公式（base + index×1000）与探测语义、PID 文件 schema、安全停止阶梯、InstanceLock/GatewayLock、默认实例状态判定、bootstrap .env 及相关测试
metadata:
  scope: 只收 instance_manager 的入口、关键文件、实现细节、验证用例、相关模块与文档；start_services 与 dotenv_early 的启动分派归 jiuwenswarm，设计取舍归 launch-design-tradeoffs
---
# instance_manager：多实例配置、端口与进程管理

## 现状

- 负责 JiuwenSwarm 多实例的配置与生命周期：维护 instances.yaml、校验实例名、分配端口并检测冲突、为每个实例生成 bootstrap .env。它还用锁文件和 PID 文件控制实例并发启动，并负责查询实例状态和停止实例进程。
- **从这里开始读**
- `jiuwenswarm/instance_manager/status.py` — list_all_instances、get_instance_status 查询实例状态，stop_instance_process 停止实例进程
- `jiuwenswarm/instance_manager/bootstrap.py` — create_bootstrap_env 为实例生成 bootstrap .env；load_instance_bootstrap_by_name 在 argparse 解析后加载它；它是被启动入口调用的模块
- `jiuwenswarm/instance_manager/yaml.py` — load_instances_yaml 和 update_instances_yaml 负责读写并校验 instances.yaml
- **关键文件**
- `jiuwenswarm/instance_manager/config.py` — InstanceConfig、InstanceStatus 数据类，BASE_PORTS、RESERVED_NAMES 等常量，实例名校验，端口计算、探测与冲突检查
- `jiuwenswarm/instance_manager/lock.py` — InstanceLock（跨平台启动锁，含过期锁清理）、GatewayLock、PID 文件读写和进程存活检测
- `jiuwenswarm/instance_manager/status.py` — 按 PID、进程组和监听端口判断进程是否属于本实例，再安全停止；这里的判断逻辑较细，审查时重点看
- `jiuwenswarm/instance_manager/yaml.py` — 实例目录和工作区路径，instances.yaml 结构与端口字段校验，get_instance_index
- `jiuwenswarm/instance_manager/bootstrap.py` — bootstrap .env 的生成与加载，包括不依赖其他模块的早期创建函数 _create_basic_bootstrap_env
- **相关文档**
- `docs/zh/Quickstart.md` — 想了解用户怎样启动 JiuwenSwarm，从而判断改动对启动流程的影响时读
- `README_CN.md` — 需要项目整体介绍和启动方式概览时读
- `docs/zh/FAQ.md` — 改动涉及启动失败、端口占用等用户常见问题时，查看已有说法
- `TESTING.md` — 给本模块补测试时参考；其中有过期路径，要以 tests/ 下实际存在的用例为准
- **改动路由**
- `jiuwenswarm/instance_manager/`

### 端口、锁与安全停止的实现细节

- 以下行为在 commit `f0a6972` 上逐条核对，行号链接即证据；未运行任何测试，仅记录用例断言的契约。
- **端口分配公式与覆盖**：`BASE_PORTS = {agent_server: 18092, web: 19000, gateway: 19001, frontend: 5173}`，实例端口 = base + index×1000；index 0 固定给默认实例，命名实例按 instances.yaml 声明顺序从 1 开始（声明顺序影响未显式配置端口时的自动计算；已持久化的 ports 以条目值为准）。
  - `JIUWENSWARM_<TYPE>_PORT` 环境变量可覆盖 base（供 Docker 等场景），非整数值仅 debug 日志后忽略，未知端口类型回落 10000（[config.py:39-51](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/instance_manager/config.py#L39-L51)、
  - [config.py:133-188](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/instance_manager/config.py#L133-L188)）。
- **实例名校验**：1-64 字符、仅字母/数字/下划线/连字符、不能以点开头；保留名按小写比较，集合为 `{default, config, tmp, jiuwenswarm, all}`（[config.py:103-122](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/instance_manager/config.py#L103-L122)）。
  - 注意 dotenv_early 的早期校验只拒绝其中 `default/config/tmp`（见 [[jiuwenswarm]]（jiuwenswarm 顶层包） 的 dotenv_early 契约）。
- **端口占用探测语义**：`is_port_available` 用 `bind()+listen()` 而非 connect()，因此能识别"已死但仍处 LISTENING 的僵尸监听者"（connect 探测会超时误判为空闲）；POSIX 上对 EADDRINUSE 再用 SO_REUSEADDR 复探，把只剩 TIME_WAIT/半关闭**连接**套接字的端口判为可用（真实服务自身都设 SO_REUSEADDR），Windows 禁用复探以免掩盖真冲突；host 为回环/wildcard 时同时探测 `::1`（Vite on Windows 常只绑 IPv6 回环）；
  - `EADDRNOTAVAIL`/`EAFNOSUPPORT`/`EPROTONOSUPPORT` 视为协议栈不可用而非端口占用（[config.py:191-343](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/instance_manager/config.py#L191-L343)）。
- **instances.yaml 读写**：`load_instances_yaml` 校验顶层结构（非空 mapping 缺 `instances` 键报错，空 YAML 归一为 `instances: {}`）、实例名规则、端口类型必须是 4 种之一且为 1-65535 整数、workspace 必须是字符串，错误统一抛带修复建议的 `InstancesYamlError`；
  - `save_instances_yaml` 用同目录临时文件 + `os.replace` 原子替换，失败时清理临时文件——两个实例并发更新时读方永远不会看到半个文件，原子替换保证文件完整，但不保证全局读改写事务：按 workspace 持有的 `InstanceLock` 不能串行化不同实例对同一 instances.yaml 的更新，
  - 仍可能丢更新（[yaml.py:45-254](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/instance_manager/yaml.py#L45-L254)）。
  - 条目缺 `ports` 时按声明顺序 index 自动补齐端口（[status.py:261-294](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/instance_manager/status.py#L261-L294)）。
- **PID 文件 schema**：`.instance.pid` 是 workspace 下的 JSON（pid/started_at/name），先写临时文件，再删除已有目标并 rename；这避免直接写入半个 JSON，但删除与 rename 之间仍有目标不存在的窗口；schema v2 追加 launcher 的 pid+create_time、pgid/sid、`dedicated_session` 标志和 witnesses（每个子进程的 pid、create_time、`-m` 模块名、`--dotenv` 实路径），用于外置 `setsid` 启动器的归属验证；
  - Windows 上 pgid/sid 为 None、dedicated_session 为 False，launcher 出生时间与可取得的 witnesses 仍保留（[lock.py:442-511](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/instance_manager/lock.py#L442-L511)、
  - [start_services.py:460-522](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/start_services.py#L460-L522)）。
- **安全停止阶梯**：launcher 终身持有 `InstanceLock`，stop 不抢启动锁；schema v2 记录对存活 PID 还要求 psutil create_time 与记录一致（3 秒容差）才认定未被复用，不一致直接拒绝发信号返回 False；存活且证明专用会话（pgid==sid==pid 且元数据吻合）时 `killpg` 整组；launcher 已死但 witness 证明子进程仍在其原专用组时也 `killpg` 旧组（不做端口扫描）；
  - POSIX 存活 launcher 没有专用组证明时只停 launcher PID（旧 schema 也沿用单 PID 行为）；launcher 已死且无 witness、或没有 PID 记录时才回退到监听者检查：要求拼接后的 cmdline 包含 `jiuwenswarm` 和 bootstrap 路径字符串，属于子串检查，而非 witness 使用的 `--dotenv` 参数 realpath 精确匹配——检查失败不构成杀进程的许可；
  - 成功判定要求端口已释放，最后以 stop 开始时读到的 pid_data 为期望值、在短时 `InstanceLock` 下删除 PID 文件，防止误删并发新启动写入的记录（[status.py:591-690](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/instance_manager/status.py#L591-L690)、
  - [status.py:400-526](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/instance_manager/status.py#L400-L526)）。
- **InstanceLock（启动并发锁）**：POSIX 用 `fcntl.flock` 排他锁，Windows 无 fcntl，改用独占创建 + 30 秒 stale 判定（只依据文件 mtime，超龄删除后重试，不核验持有者 PID）；launcher 在实例启动全程持有（[lock.py:32-34](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/instance_manager/lock.py#L32-L34)、
  - [lock.py:42-198](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/instance_manager/lock.py#L42-L198)）。
- **GatewayLock（每 workspace Gateway 单例）**：动机是防止同一 workspace 起两个 Gateway——两个独立 CronSchedulerService 共享同一 `cron_jobs.json` 可导致重复执行（详见 [[jiuwenswarm-runtime-cron]]（定时任务（Cron）运行时））。
  - 用 portalocker OS 级锁（POSIX flock / Windows LockFileEx）终身持有：锁文件从不 unlink（杜绝删除竞态），OS 锁放在伴随文件 `.gateway.lock.lock` 上（Windows 强制锁会使被锁文件不可读），元数据 `.gateway.lock` 永不加锁、随时可读；
  - `find_holder` 先确认元数据 PID 存活、再探测 OS 锁确认持有者真存活，避免 PID 复用造成"Gateway 还在跑"误报（[lock.py:201-439](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/instance_manager/lock.py#L201-L439)）。
- **默认实例状态判定**：先查 PID 文件；PID 记录不存在或未证明进程仍存活时，对 agent_server/gateway/frontend 端口做占用检测，任一被占即视为运行，并用 netstat（Windows）/lsof（Unix，5 秒超时）反查监听 PID（[status.py:89-203](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/instance_manager/status.py#L89-L203)）。
- **bootstrap .env 内容**：整文件重写为 `JIUWENSWARM_DATA_DIR`、`JIUWENSWARM_INSTANCE` 加 4 个端口变量；
  - 早期版本的 `_create_basic_bootstrap_env` 按 yaml 声明顺序算 index，不导入任何 jiuwenswarm 模块（供 dotenv_early 在 import 前调用）（[bootstrap.py:32-71](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/instance_manager/bootstrap.py#L32-L71)、
  - [bootstrap.py:85-136](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/instance_manager/bootstrap.py#L85-L136)）。

#### 怎样验证

- `tests/unit_tests/test_instance_manager.py::TestIssue2788SafeStop` — 复用存活 PID 不发信号、launcher 已死走 witness 而非端口扫描、专用会话整组停、终锁不可得时保留记录。
- `::TestGatewayLock` — 跨进程互斥、持有者死亡后的接管、`find_holder` 对复用 PID/已释放 OS 锁的判定。
- `::TestStartServicesFallback`、`::TestPortAvailability`、`::TestUpsertEnvPorts`、`::TestEnvVarOverride`、`::TestInstancesYamlError` — 回退持久化、探测语义、.env 端口 upsert、env 覆盖与 yaml 校验错误。
- **相关模块**
- [[jiuwenswarm]]（jiuwenswarm 顶层包：启动入口、多实例与运行时补丁） — start_services/jiuwenswarm-init 如何调用本模块做端口检查、回退持久化与停止
- [[jiuwenswarm-runtime-cron]]（定时任务（Cron）运行时：任务模型、存储后端与投递路由） — GatewayLock 防重复调度的对象 cron_jobs.json 的存储实现
- [[jiuwenswarm-common-1]]、[[jiuwenswarm-common-2]]（jiuwenswarm/common/：公共基础模块） — workspace/home 路径解析（get_user_home）与被拉起进程的监管归属

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/launch/jiuwenswarm-instance-manager.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-09-30；updated: 2026-10-01
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/instance_manager/config.py；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/start_services.py
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/instance_manager/status.py；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/instance_manager/lock.py
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/instance_manager/yaml.py；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/instance_manager/bootstrap.py
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/test_instance_manager.py
