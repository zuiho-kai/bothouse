# 自主采集的重试与诊断

Issue #221：分钟任务读 Discord 时遇到临时 TLS 断连会立即退出；静默 cron 丢弃了 stderr，成功的下一轮又清除 collection_error，导致只剩 shell exit code 1。2026-10-21 的同接口只读探测复现 SSLEOFError；历史两次告警没有原始异常，不能严格断言完全同因。

## 行为

- 仅没有 body/files 的 Discord GET 最多尝试3次。临时网络错误、408/429/500/502/503/504 可重试，普通退避1秒、2秒；证书验证失败、其他HTTP错误及非法JSON立即失败。
- 单次GET的重试预算45秒，每次连接/读取超时最多20秒；分页共用采集原有60秒截止点，剩余预算不足不再重试。数字 Retry-After 优先，超过剩余预算或格式无效时退出，交由下一次分钟调度。预算约束请求超时和重试调度；不是针对慢速持续传输的强制进程截止。
- POST、附件发送、桥接提交、整个tick均不重试；已有活动key和发送结果不明时不重发的规则保留。采集未完成不触发活动，不用旧材料继续。
- 配置同目录的 diagnostics.json 保存最近20次失败（0600权限），记录UTC时间、阶段和白名单错误分类，必要时含HTTP状态、尝试次数、SQLite/errno数值。绝不写token、URL、响应正文、异常原文或频道消息。成功轮次不清除历史。
- 阶段包括 initialize、collect、reconcile、schedule、save、render；配置解析或抢配置锁之前的错误不在此文件覆盖范围。诊断文件也无法写入时保留原始失败并向stderr写固定提示。

## 核查

直接读取配置同目录 diagnostics.json 可查历史，不必重跑任务。state.json 的 last_tick / last_collected 仅反映已有调度/采集状态，不能当作模型活动完成证据。

回归命令：在 companion 执行 `uv run python -m pytest -q tests/test_autonomy_reliability.py`。包含真实 Python 模块CLI入口的隔离失败→恢复流程，网络读取使用假接口，禁止发送和真实任务提交。旧版核心回归为11失败/7通过；修复后新增边界用例一并通过，完整验证见PR。

部署只取合并main的 autonomy 包；保留实例显式配置路径、活动计划、数据库、会话与桥接进程。旧安装默认路径可能仍为 ~/.cc-connect-maomao，升级包默认是 ~/.conest；现有cron显式 --config 不受影响，旧本机脚本需显式绑定原实例配置。切换前备份包和入口，在配置锁与分钟调度间隙替换，等待自然tick验收，不手工重跑活动。
