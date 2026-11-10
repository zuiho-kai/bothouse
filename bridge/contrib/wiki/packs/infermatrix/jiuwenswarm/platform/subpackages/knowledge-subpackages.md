---
name: knowledge-subpackages
description: jiuwenbox ProcessRuntime（进程态沙箱运行时适配器）：单次 bwrap 加常驻 daemon IPC 的数据流、JIUWENBOX_PYTHON_FASTPATH 等环境变量、条件化的宿主 iptables 防火墙与 Landlock daemon、设计取舍与集成测试 TCP/UDS 入口
metadata:
  scope: 收 jiuwenbox/src/jiuwenbox/server/runtime/process.py 相关的五条知识条目，来源另含 README_CN.md；process.py 的接口记录归 jiuwenbox-src-contracts-02
---
# jiuwenbox ProcessRuntime（进程态沙箱运行时适配器）

## 现状

- **设计取舍**
- 两个可考证的取舍：(1) 宿主防火墙自保护在 iptables 因无 root 返回 EPERM 时只告警并继续创建沙箱，而不是失败——注释明确说这是接受了无特权部署没有宿主级保护的后果，换取完全本地策略仍可用。
  - (2) 僵尸回收双通道：uvloop 拒绝 SIGCHLD handler，所以周期 Task（默认 2s）作为通用兜底，代价是空闲时少量轮询 CPU，收益是峰值 <defunct> 数量极小。cgroup 迁移放在 preexec_fn（fork 后 execve 前）是因为 cgroup v2 只在 fork 时继承，事后写 cgroup.procs 会漏掉 bwrap 早先 fork 的后代。
- Sources / 来源：[jiuwenbox/src/jiuwenbox/server/runtime/process.py:L1336–L1355](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenbox/src/jiuwenbox/server/runtime/process.py#L1336-L1355),
  - [jiuwenbox/src/jiuwenbox/server/runtime/process.py:L2031–L2040](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenbox/src/jiuwenbox/server/runtime/process.py#L2031-L2040)
- **测试入口**
- Inference / 设计推断（非作者历史意图）：
- README_CN 记录了集成测试双通路入口：pytest tests/integration 可分别用 --server-endpoint=http://127.0.0.1:8321（TCP）和 --server-endpoint=unix:///...（UDS）运行，对应传输层两种监听形态。
  - process.py 自身注释提到测试会直接实例化 ProcessRuntime（如 _derive_protect_ports_from_listen 的 docstring 提到 test harness 不设 JIUWENBOX_LISTEN 的路径）以及测试中重建事件循环时 register_zombie_reaper 会替换旧注册，但本次展示的输入未包含这些测试文件本身。
- Sources / 来源：[jiuwenbox/README_CN.md:L163–L166](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenbox/README_CN.md#L163-L166),
  - [jiuwenbox/src/jiuwenbox/server/runtime/process.py:L124–L127](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenbox/src/jiuwenbox/server/runtime/process.py#L124-L127),
  - [jiuwenbox/src/jiuwenbox/server/runtime/process.py:L1720–L1724](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenbox/src/jiuwenbox/server/runtime/process.py#L1720-L1724)
- **职责与数据流：单次 bwrap + 常驻 daemon IPC**
- ProcessRuntime 是进程态运行时适配器：每个沙箱生命周期只 spawn 一次 bubblewrap 来启动沙箱内常驻 daemon，之后的 exec/exec_background 请求都经 daemon IPC 服务，使命令继承同一 namespace/mount/seccomp/Landlock 包络，避免每次调用重新拉起 bwrap。
  - 控制通道是 box-server 在宿主侧 0700 目录里 bind 的 Unix listener，其 fd 通过 Popen(pass_fds=...) 一路继承给 daemon（经 LISTENER_FD_ENV 认领），沙箱内用户代码无法经文件系统触达该 socket。IPC 并非唯一通路：遇到 FATAL_DAEMON_ERRNOS 这类致命错误时会翻转 _daemon_socket_ready，后续调用退回慢速的 bash/python3 传统路径。
- Sources / 来源：[jiuwenbox/src/jiuwenbox/server/runtime/process.py:L2–L8](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenbox/src/jiuwenbox/server/runtime/process.py#L2-L8),
  - [jiuwenbox/src/jiuwenbox/server/runtime/process.py:L265–L276](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenbox/src/jiuwenbox/server/runtime/process.py#L265-L276),
  - [jiuwenbox/src/jiuwenbox/server/runtime/process.py:L297–L311](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenbox/src/jiuwenbox/server/runtime/process.py#L297-L311)
- **环境变量：fastpath 与宿主端口保护**
- JIUWENBOX_PYTHON_FASTPATH 控制透明优化的开关：unset 或 "1" 开启，"0" 显式关闭，其它任何值告警并按关闭处理（fail-safe）。配套的 JIUWENBOX_PYTHON_FASTPATH_MAX_SANDBOXES 限制单进程内可激活 worker 池的沙箱数，默认 50，解析时上限钳到 1000。JIUWENBOX_SERVER_PROTECT_PORTS 未设置时从 JIUWENBOX_LISTEN 推导（http://host:port 取端口，unix:// 返回空即不保护，缺失或畸形回退默认 8321）；
  - 显式设为空字符串可整体关闭，设为逗号分隔整数列表则覆盖。
- Sources / 来源：[jiuwenbox/src/jiuwenbox/server/runtime/process.py:L191–L217](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenbox/src/jiuwenbox/server/runtime/process.py#L191-L217),
  - [jiuwenbox/src/jiuwenbox/server/runtime/process.py:L179–L188](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenbox/src/jiuwenbox/server/runtime/process.py#L179-L188),
  - [jiuwenbox/src/jiuwenbox/server/runtime/process.py:L117–L146](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenbox/src/jiuwenbox/server/runtime/process.py#L117-L146),
  - [jiuwenbox/src/jiuwenbox/server/runtime/process.py:L1204–L1214](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenbox/src/jiuwenbox/server/runtime/process.py#L1204-L1214)
- **隔离特性：条件化的宿主防火墙与 Landlock daemon**
- network.mode: host 下会按沙箱 uid 安装 iptables OUTPUT REJECT 保护 box-server 自身端口，但该保护是条件化的：policy 未声明任何 egress/ingress 规则时跳过，环境变量设空可禁用，iptables 无 root 返回 EPERM 时只回滚部分规则、告警并继续创建沙箱。
  - Landlock 路径上，launcher（python3 -S）先应用 Landlock，再通过 compile/exec 在同一 Python 进程内运行 daemon 代码——Landlock 锁定后没有第二次 execve，daemon 脚本的磁盘路径无需保持可达，因此 /run 可留在 Landlock 白名单之外；README 将 Landlock/seccomp 的可用性表述为依赖内核支持。
- Sources / 来源：[jiuwenbox/src/jiuwenbox/server/runtime/process.py:L1301–L1316](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenbox/src/jiuwenbox/server/runtime/process.py#L1301-L1316),
  - [jiuwenbox/src/jiuwenbox/server/runtime/process.py:L1336–L1355](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenbox/src/jiuwenbox/server/runtime/process.py#L1336-L1355),
  - [jiuwenbox/src/jiuwenbox/server/runtime/process.py:L1055–L1072](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenbox/src/jiuwenbox/server/runtime/process.py#L1055-L1072),
  - [jiuwenbox/README_CN.md:L48–L52](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenbox/README_CN.md#L48-L52)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/subpackages/knowledge-subpackages.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenbox/src/jiuwenbox/server/runtime/process.py:L1336-L1355；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenbox/src/jiuwenbox/server/runtime/process.py:L2031-L2040
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenbox/README_CN.md:L163-L166；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenbox/src/jiuwenbox/server/runtime/process.py:L124-L127
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenbox/src/jiuwenbox/server/runtime/process.py:L1720-L1724；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenbox/src/jiuwenbox/server/runtime/process.py:L2-L8
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenbox/src/jiuwenbox/server/runtime/process.py:L265-L276；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenbox/src/jiuwenbox/server/runtime/process.py:L297-L311
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenbox/src/jiuwenbox/server/runtime/process.py:L191-L217；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenbox/src/jiuwenbox/server/runtime/process.py:L179-L188
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenbox/src/jiuwenbox/server/runtime/process.py:L117-L146；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenbox/src/jiuwenbox/server/runtime/process.py:L1204-L1214
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenbox/src/jiuwenbox/server/runtime/process.py:L1301-L1316；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenbox/src/jiuwenbox/server/runtime/process.py:L1055-L1072
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenbox/README_CN.md:L48-L52
