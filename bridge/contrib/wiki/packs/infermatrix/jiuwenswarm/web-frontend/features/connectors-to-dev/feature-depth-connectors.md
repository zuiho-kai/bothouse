---
name: feature-depth-connectors
description: 连接器市场实现深读：去掉 MOCK FALLBACK 与内联 fromRaw* 字段映射、上传导入 onConfirm 成功关弹窗与 2600ms Toast、失败留在 uploadError、waitAuth/cancelConnect 契约、list 的 query 与 filter 默认值、connect/waitAuth 的十分钟超时、marketSearchClient 运行时测试
metadata:
  scope: 只收 connectorApi、ConnectorMarket 上传导入与 webClient 的实现级证据与设计推断；功能概览、字段清单与验收步骤归 feature-connectors
---
# 连接器市场与 MCP 授权流程：实现深读

## 现状

- [[feature-connectors]]（功能概览） · [[web-frontend-overview-1]]、[[web-frontend-overview-2]]（owner 入口）
- **去掉 MOCK FALLBACK、按方法内联字段映射** 设计推断（非作者历史意图）：
- 事实：mcp.* 方法不再有 tryReal() 包装，失败即抛错，只有后端未实现的 pluginPackagesApi 保留 mock 兜底；snake_case→驼峰转换在每个方法内联（fromRawSummary/fromRawDetail/fromRawConnect），不建通用转换器。推断：这样换来问题不被假数据掩盖、每个响应形状独立可控，代价是字段增减时要在多处内联映射里同步修改，且无兜底时后端故障会直接以错误暴露给用户。
- 来源：[jiuwenswarm/channels/web/frontend/src/services/connectorApi.ts:L14–L30](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/services/connectorApi.ts#L14-L30),
  - [jiuwenswarm/channels/web/frontend/src/services/connectorApi.ts:L146–L169](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/services/connectorApi.ts#L146-L169)
- **上传导入 onConfirm 成功回调：关闭弹窗并置 successToast，success Toast 2600ms 后自动关闭** 回调先 setUploadError(null)，await importPluginLocal({ path })；
  - result.ok 为真时关弹窗并 setSuccessToast(t(...)) 后 return，316–317 行以 variant="success" 渲染 Toast（isError 为假 → setTimeout(onClose, 2600)），onClose 即 setSuccessToast(null)，卸载时 clearTimeout。
- 来源：[jiuwenswarm/channels/web/frontend/src/components/ConnectorMarket/index.tsx:L299–L312](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ConnectorMarket/index.tsx#L299-L312),
  - [jiuwenswarm/channels/web/frontend/src/components/ConnectorMarket/index.tsx:L316–L317](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ConnectorMarket/index.tsx#L316-L317),
  - [jiuwenswarm/channels/web/frontend/src/components/ConnectorMarket/Toast.tsx:L17–L23](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ConnectorMarket/Toast.tsx#L17-L23)
- **waitAuth 契约：mcp.wait_auth 携带 name 与 step_index 并用 WAIT_AUTH_TIMEOUT_MS 超时** waitAuth(name, stepIndex) 调 webRequest('mcp.wait_auth', { name, step_index: stepIndex }, { timeoutMs: WAIT_AUTH_TIMEOUT_MS })，结果经 fromRawConnect 返回 ConnectorConnectResponse；
  - cancelConnect(name) 发 'mcp.cancel_connect'，响应 type:'cancelled' 且 applied 可选。
- 来源：[jiuwenswarm/channels/web/frontend/src/services/connectorApi.ts:L220–L232](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/services/connectorApi.ts#L220-L232)
- **list 的 query='' 默认省略 query 键；filter 无客户端默认** list 的 query 默认 ''，为空时请求体省略 query 键（...(query ? { query } : {})）且第四参传 !query；filter 无客户端默认值，注释记录后端缺省按 'builtin' 处理，曾实测导致『我的MCP』完全看不到自定义 MCP。
- 来源：[jiuwenswarm/channels/web/frontend/src/services/connectorApi.ts:L182–L194](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/services/connectorApi.ts#L182-L194)
- **导入失败（result.ok 为假）时错误留在弹窗内 uploadError；rejectAllPending 逐项清定时器并以同一 WebError 拒绝** onConfirm 中 if (result.ok) 不成立时不执行关闭分支，setUploadError(result.error) 把错误留在打开的弹窗内；
  - webClient.rejectAllPending(error) 一旦被调用（调用点不在所示行），对 this.pending 每项 window.clearTimeout(entry.timeoutId) 并 entry.reject(error)，随后 this.pending.clear()。
- 来源：[jiuwenswarm/channels/web/frontend/src/components/ConnectorMarket/index.tsx:L299–L312](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ConnectorMarket/index.tsx#L299-L312),
  - [jiuwenswarm/channels/web/frontend/src/services/webClient.ts:L559–L565](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/services/webClient.ts#L559-L565)
- **运行时测试执行 connectorApi.list（stub webClient.request 传输）** 测试 stub webClient.request（'mcp.list' 返回 {items: []}，未预期 method 抛 Unexpected method）后实际执行 connectorApi.list('builtin', '销售')，并以 deepEqual 断言转发序列（49-52 行可见 agent_templates/agent_groups/plugin_packages 三项参数断言）；传输层被 stub，非真实 WS 集成。
- 来源：[jiuwenswarm/channels/web/frontend/tests/marketSearchClient.test.mjs:L33–L52](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/tests/marketSearchClient.test.mjs#L33-L52)
- **connectorApi 的 connect/waitAuth 依赖 webClient 的 webRequest 并共用 fromRawConnect 映射** connectorApi.ts 第2行从 './webClient' 导入 webRequest。
  - connect(name) 调 'mcp.connect'（传 { name }），waitAuth(name, stepIndex) 调 'mcp.wait_auth'（传 name 与 step_index），各自传 10 分钟的 timeoutMs 覆盖——注释称 webClient 默认 15s 会让 hold-open 握手在前端先超时。两处响应均经 fromRawConnect 把 installed_skills、server_id_scope、step_index 等原始键映射为驼峰字段。
- 来源：[jiuwenswarm/channels/web/frontend/src/services/connectorApi.ts:L1–L2](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/services/connectorApi.ts#L1-L2),
  - [jiuwenswarm/channels/web/frontend/src/services/connectorApi.ts:L146–L168](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/services/connectorApi.ts#L146-L168),
  - [jiuwenswarm/channels/web/frontend/src/services/connectorApi.ts:L171–L179](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/services/connectorApi.ts#L171-L179),
  - [jiuwenswarm/channels/web/frontend/src/services/connectorApi.ts:L213–L227](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/services/connectorApi.ts#L213-L227)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/web-frontend/feature-depth-connectors.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-02；updated: 2026-10-02
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/services/connectorApi.ts:L14-L30；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/services/connectorApi.ts:L146-L169
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/services/connectorApi.ts:L182-L194；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/tests/marketSearchClient.test.mjs:L33-L52
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/components/ConnectorMarket/index.tsx:L299-L312
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/components/ConnectorMarket/index.tsx:L316-L317
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/components/ConnectorMarket/Toast.tsx:L17-L23
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/services/connectorApi.ts:L220-L232；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/services/webClient.ts:L559-L565
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/services/connectorApi.ts:L1-L2；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/services/connectorApi.ts:L146-L168
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/services/connectorApi.ts:L171-L179；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/services/connectorApi.ts:L213-L227
- 源页字段（feature）：connectors
- 入口（entry_points）：jiuwenswarm/channels/web/frontend/src/services/connectorApi.ts；jiuwenswarm/channels/web/frontend/src/components/ConnectorMarket/index.tsx
- 源页字段（source_globs）：jiuwenswarm/channels/web/frontend/src/services/connectorApi.ts；jiuwenswarm/channels/web/frontend/src/components/ConnectorMarket/index.tsx
