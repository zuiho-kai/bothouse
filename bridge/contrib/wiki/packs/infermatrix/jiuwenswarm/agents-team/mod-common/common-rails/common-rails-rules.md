---
name: common-rails-rules
description: "common-rails 审查规则 JW-PERM-1a 至 JW-PERM-1c：xiaoyi_0.2.4.beta3 权限 rails 的 ASK/DENY、授权范围派生、shell_guard 测试（PR #7797、#7809）"
metadata:
  scope: 只收 JW-PERM-1a、1b、1c 三条规则及其触发、强制、禁止、验收；逐文件接口声明归 common-rails 契约页，入口索引归 common-rails-overview
---
# common-rails 审查规则

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/agents-team/common-rails/rules.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: jiuwenswarm, components；created: 2026-10-09；updated: 2026-10-09
- 来源（sources）：PR #7797；PR #7809
- 置信度（confidence）：high
- [JW-PERM-1a] ASK 授权不能覆盖 DENY，运行期授权与配置写入必须隔离
  - 触发：修改 xiaoyi_0.2.4.beta3 权限 rails 的批准、持久化和 NetGuard 匹配。
  - 强制：新批准记录使用结构化 `exact_operation`，在 guard 之后检查；session 批准留在 overlay，永久批准写 approval_overrides。重新检查批准等待期间新增的 DENY；网络匹配保持 DENY > ASK > ALLOW。
  - 验收：等待批准期间追加 deny 仍阻断操作；一次/会话/永久授权写入各自正确存储，旧格式匹配保持兼容。^[PR #7797]
- [JW-PERM-1b] 扩大授权范围只由服务器派生，网络同步与实际应用分开
  - 触发：修改 xiaoyi_0.2.4.beta3 的 allow_with_scope、出站重定向或 sandbox.network.sync/restart。
  - 强制：文件范围由服务器派生为直接父目录及后代，URL 为保留 scheme/port 的注册域及子域；命令不扩大。逐跳检查出站目标。网络同步仅导出支持的纯域名 allow/deny，ASK 跳过；restart 才重建并应用 files/urls。
  - 验收：覆盖范围派生、不可扩大对象、重定向和 ASK skipped；同步返回 restart_required，并在重启路径核对文件与网络规则同时应用。^[PR #7797]
- [JW-PERM-1c] 产品 shell guard 测试允许明确列举的可选开关
  - 触发：修改 xiaoyi_0.2.4.beta3 产品配置的 shell_guard 或其配置测试。
  - 强制：分别断言 unknown_structure 和 interpreter_sink 为 false；键集合只允许这两个键与可选 builtin_rules_enabled，后者存在时必须为 true。
  - 验收：四份产品配置及未知键/错误布尔值检查均符合明确的允许键集合。^[PR #7809]

## 决策与踩坑

- [JW-PERM-1a] 禁止：批准询问时越过显式 DENY；用普通 allow 消除 ask/deny；把已有 session 授权直接升级为永久授权。
- [JW-PERM-1b] 禁止：对 IP/localhost/公共后缀扩大授权；把原 URL 授权沿用到重定向目标；将 ASK 导出为 DENY；把 sync 的保存成功宣称为沙箱已经生效。
- [JW-PERM-1c] 禁止：整字典相等误拒合法的 builtin_rules_enabled；无界子集断言而允许任何未知键；放松两个拦截开关的关闭要求。
