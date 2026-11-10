---
name: feature-web-asset-publish-flow
description: Web 资产发布流程功能概览：useAssetPublish 对外契约与错误键来源、五种资产类型与发布状态归一、prepare→commit→轮询状态流与断线找回、幂等键与不确定失败的保守锁、元数据默认值与修改守卫、commit 前运行时守卫
metadata:
  scope: 只收 api、features、architecture、tradeoffs、configuration、validation 六个 facet 摘要；各 RPC 超时、拒绝码匹配与抽屉测试细节归 feature-depth-web-asset-publish-flow
---
# Web 资产发布流程（prepare/commit/轮询/提交锁）

## 现状

- **useAssetPublish Hook 的对外契约**
- `useAssetPublish(reference, restored?)` 是发布流程的前端入口，返回 `prepare`、`commit`、`refresh`、`edit` 等操作以及 `metadata`、`draft`、`record`、`records`、`submissionLocked`、`busy`、`error`、`attempted`、`loggedIn` 等状态。远程交互覆盖五个方法：`assetPublishApi.describe`、`.records`、`.prepare`、`.commit`、`.status`。
  - 错误键来源混合：`describe/prepare/records` 失败走 `publishFailureKey` 映射（assetPublishErrors.ts 的安全键表加兜底 `requestFailed`），而轮询失败直接设 `statusFailed`（L163–164），草稿过期设 `expired`（L213–215），提交失败按 `definitiveCommitRejection` 结果设 `expired`/`commitRejected`/`commitUncertain`（L238–248）。
- Sources / 来源：[jiuwenswarm/channels/web/frontend/src/hooks/useAssetPublish.ts:L87–L114](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/hooks/useAssetPublish.ts#L87-L114),
  - [jiuwenswarm/channels/web/frontend/src/hooks/useAssetPublish.ts:L151–L173](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/hooks/useAssetPublish.ts#L151-L173),
  - [jiuwenswarm/channels/web/frontend/src/hooks/useAssetPublish.ts:L238–L249](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/hooks/useAssetPublish.ts#L238-L249),
  - [jiuwenswarm/channels/web/frontend/src/hooks/useAssetPublish.ts:L257–L285](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/hooks/useAssetPublish.ts#L257-L285)
- **支持的发布行为**
- 支持五种资产类型（skill、agent_template、agent_group、plugin、mcp，types/assetPublish.ts L1），流程含 prepare/commit/过期检查/提交锁/记录找回/状态轮询。`publishOutcome` 把 `PublishRecord` 归一为 queued/uploading/failed/pending_moderation/published/unknown（assetPublishState.ts L7–15）；'unknown' 结果会维持提交锁（L53）。
  - `openAssetPublish` 仅派发 `asset-publish-open` 自定义事件，监听方不在本次展示范围内。发布状态展示层提供中英双语标签，详情页只显示已确认的状态（assetPublication.ts L17–20）。
- Sources / 来源：[jiuwenswarm/channels/web/frontend/src/types/assetPublish.ts:L1–L3](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/types/assetPublish.ts#L1-L3),
  - [jiuwenswarm/channels/web/frontend/src/features/assetPublishState.ts:L7–L15](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/assetPublishState.ts#L7-L15),
  - [jiuwenswarm/channels/web/frontend/src/features/assetPublishEvents.ts:L1–L4](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/assetPublishEvents.ts#L1-L4),
  - [jiuwenswarm/channels/web/frontend/src/features/assetPublication.ts:L17–L20](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/assetPublication.ts#L17-L20)
- **架构：状态流、轮询与找回**
- useAssetPublish 以 prepare→draft→commit→record→轮询为主线：draft 确认后 commit 产生 PublishRecord，随后按 execution_status（queued/uploading）轮询 assetPublishApi.status；L156–L168 显示下一次轮询在上一次请求完成后再延迟 5 秒调度（首次延迟 2 秒），因此实际间隔包含请求耗时。异步竞态通过 generation 计数 + scope（OAuth 提供者与令牌拼接，L29）双重校验（current()，L67–L70）过滤过期响应。
  - 断线恢复是条件性的：仅当 description 尚未加载时订阅 webClient.onStateChange，在连接 ready 时触发 refresh（L145–L150）；refresh 在 records 中按 operation_id 或 draft_id 匹配活跃提交并恢复其状态（L99–L104）。
- Sources / 来源：[jiuwenswarm/channels/web/frontend/src/hooks/useAssetPublish.ts:L145–L173](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/hooks/useAssetPublish.ts#L145-L173),
  - [jiuwenswarm/channels/web/frontend/src/hooks/useAssetPublish.ts:L96–L114](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/hooks/useAssetPublish.ts#L96-L114),
  - [jiuwenswarm/channels/web/frontend/src/hooks/useAssetPublish.ts:L67–L70](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/hooks/useAssetPublish.ts#L67-L70)
- **取舍：幂等键与不确定失败的保守锁**
- commit 采用单次尝试持有一个幂等请求 ID（crypto.randomUUID()，L218–L222）：createCommitAttempt 在成功后缓存结果并复用，失败后允许用同一 ID 重试（assetPublishState.ts L23–L41），以避免重复上传。错误处理刻意保守：只有 definitiveCommitRejection 识别出的明确拒绝（draft_expired 及 invalid_draft/draft_not_found/auth_required 等正则，assetPublishState.ts L47–L60）才释放提交锁并丢弃幂等键；
  - 其余失败仅设 error 'commitUncertain' 并保留 activeSubmission（L238–L248），后续靠 refresh 按 ID 找回记录（L96–L104）。代价是不确定状态下用户停留在锁定态等待恢复。
- Sources / 来源：[jiuwenswarm/channels/web/frontend/src/features/assetPublishState.ts:L23–L41](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/assetPublishState.ts#L23-L41),
  - [jiuwenswarm/channels/web/frontend/src/features/assetPublishState.ts:L47–L60](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/assetPublishState.ts#L47-L60),
  - [jiuwenswarm/channels/web/frontend/src/hooks/useAssetPublish.ts:L238–L249](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/hooks/useAssetPublish.ts#L238-L249)
- **发布元数据的默认值与修改守卫**
- 发布元数据的前端默认值由 `emptyMetadata` 定义：version 固定为 '1.0.0'，visibility 为 'public'，asset_name 与 display_name 初始取自 `reference.local_id`；未传入恢复值 `restored` 时以该默认值初始化（useAssetPublish.ts L20–L33）。服务端返回的 `description.defaults` 仅在用户未编辑过（`edited.current` 为假）时覆盖本地默认值（L94、L138）。
  - 对 `setTargetAssetId`/`setForce`/`edit` 的每次修改都先经 `invalidate()`：当存在活跃提交（`activeSubmission`）或进行中的操作（`busyRef`）时拒绝修改并保留当前 draft/record，否则自增 generation 使过期异步响应失效并清空 draft 与 attempt（L174–L188、L261–L269）。
- Sources / 来源：[jiuwenswarm/channels/web/frontend/src/hooks/useAssetPublish.ts:L20–L33](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/hooks/useAssetPublish.ts#L20-L33),
  - [jiuwenswarm/channels/web/frontend/src/hooks/useAssetPublish.ts:L90–L95](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/hooks/useAssetPublish.ts#L90-L95),
  - [jiuwenswarm/channels/web/frontend/src/hooks/useAssetPublish.ts:L174–L188](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/hooks/useAssetPublish.ts#L174-L188),
  - [jiuwenswarm/channels/web/frontend/src/hooks/useAssetPublish.ts:L261–L269](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/hooks/useAssetPublish.ts#L261-L269)
- **验证入口：导出的元数据校验纯函数与 commit 前运行时守卫**
- 展示的文件中不包含自动化测试；可指认的验证入口有两类。其一为源码级校验函数：`validateMetadata`（assetPublishState.ts）是导出的纯函数，对 `asset_name`（小写字母/数字/-/_ 正则）、`version`（三段数字或 7 位十六进制正则）与 `display_name`（非空且 ≤128 字符）做检查并返回违规字段名数组，展示范围内未出现调用它的代码。
  - 其二为 useAssetPublish 中 commit 的运行时守卫（非测试）：busy、缺少 `draft_id`、`can_submit` 为假、`draft.errors` 非空或已存在 record 时直接拒绝提交；且仅当 `attempt.current` 尚未创建时才检查 `draft.expires_at`，已过期则设置 error 'expired' 并清空 draft。
- Sources / 来源：[jiuwenswarm/channels/web/frontend/src/features/assetPublishState.ts:L16–L22](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/assetPublishState.ts#L16-L22),
  - [jiuwenswarm/channels/web/frontend/src/hooks/useAssetPublish.ts:L212–L216](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/hooks/useAssetPublish.ts#L212-L216)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/web-frontend/feature-web-asset-publish-flow.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-07
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/hooks/useAssetPublish.ts:L87-L114；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/hooks/useAssetPublish.ts:L151-L173
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/hooks/useAssetPublish.ts:L238-L249；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/hooks/useAssetPublish.ts:L257-L285
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/types/assetPublish.ts:L1-L3；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/features/assetPublishState.ts:L7-L15
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/features/assetPublishEvents.ts:L1-L4
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/features/assetPublication.ts:L17-L20；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/hooks/useAssetPublish.ts:L145-L173
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/hooks/useAssetPublish.ts:L96-L114；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/hooks/useAssetPublish.ts:L67-L70
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/features/assetPublishState.ts:L23-L41
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/features/assetPublishState.ts:L47-L60；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/hooks/useAssetPublish.ts:L20-L33
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/hooks/useAssetPublish.ts:L90-L95；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/hooks/useAssetPublish.ts:L174-L188
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/hooks/useAssetPublish.ts:L261-L269；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/features/assetPublishState.ts:L16-L22
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/hooks/useAssetPublish.ts:L212-L216
- 源页字段（feature）：web-asset-publish-flow
- 入口（entry_points）：jiuwenswarm/channels/web/frontend/src/hooks/useAssetPublish.ts
- 源页字段（source_globs）：jiuwenswarm/channels/web/frontend/src/hooks/useAssetPublish.ts；jiuwenswarm/channels/web/frontend/src/types/assetPublish.ts；jiuwenswarm/channels/web/frontend/src/features/assetPublication.ts；jiuwenswarm/channels/web/frontend/src/features/assetPublishErrors.ts
  - jiuwenswarm/channels/web/frontend/src/features/assetPublishEvents.ts；jiuwenswarm/channels/web/frontend/src/features/assetPublishState.ts
