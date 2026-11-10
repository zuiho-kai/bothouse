---
name: feature-depth-web-asset-publish-flow
description: Web 资产发布流程实现深读：updateSubmission 提交锁、assetPublishApi.commit/prepare 参数、75 秒与 15 秒超时、definitiveCommitRejection 与 publishIssueKey、createCommitAttempt 并发去重、抽屉轮询测试、OAuth 凭据与 sessionStorage 依赖
metadata:
  scope: 只收 useAssetPublish、assetPublishApi、assetPublishState 的七个 facet 深读；五种资产类型、轮询节奏与元数据默认值归 feature-web-asset-publish-flow
---
# Web 资产发布流程（prepare/commit/轮询/提交锁）：实现深读

## 现状

- [[feature-web-asset-publish-flow]]（功能概览） · [[web-frontend-overview-1]]、[[web-frontend-overview-2]]（owner 入口）
- **updateSubmission 回调按活动提交过滤记录并设置提交锁** useAssetPublish 的 updateSubmission 回调：若已有 activeSubmission 且其 operationId/draftId 均不匹配 next，则返回 false 不更新；否则按 publishOutcome 是否为 queued/uploading/unknown 设置 activeSubmission 与 submissionLocked，并把记录去重前插到 records。
  - record 相关字段变化时通过 window 事件 'asset-publication-changed' 通知。
- 来源：[jiuwenswarm/channels/web/frontend/src/hooks/useAssetPublish.ts:L39–L61](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/hooks/useAssetPublish.ts#L39-L61),
  - [jiuwenswarm/channels/web/frontend/src/features/assetPublishState.ts:L7–L15](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/assetPublishState.ts#L7-L15)
- **assetPublishApi.commit 接受 (draft_id, request_id)；prepare 传 metadata、可选 target_asset_id 与 force** commit 调用 request('commit', {draft_id, request_id}) 返回 PublishRecord；prepare 过滤空 tags，target_asset_id 仅在非空时携带，并显式传 force。调用方须提供幂等 request_id。
- 来源：[jiuwenswarm/channels/web/frontend/src/services/assetPublishApi.ts:L28–L38](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/services/assetPublishApi.ts#L28-L38)
- **发布 RPC 默认 75 秒超时，localStatus 单独用 15 秒且不带 auth** describe/prepare/commit/status/records 经共享 request 助手走 `assets.publish.*` 并统一注入 auth 与 `{ timeoutMs: 75_000 }`；仅 localStatus 直接调 webRequest，超时 15_000 且参数只含引用字段。
- 来源：[jiuwenswarm/channels/web/frontend/src/services/assetPublishApi.ts:L10–L38](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/services/assetPublishApi.ts#L10-L38)
- **definitiveCommitRejection 区分 'expired'/'rejected'，publishIssueKey 未知错误回落 'requestFailed'** definitiveCommitRejection 仅在 code/message 字符串匹配 \bdraft_expired\b（不区分大小写）时返回 'expired'，匹配 invalid_draft、draft_not_found、publish_auth_required、auth_required、invalid_identifier、queue_full、
  - target_conflict 时返回 'rejected'，否则 null。publishIssueKey 将错误码规范化（trim、'-'→'_'、大写）后查 SAFE_FAILURE_KEYS 白名单，未命中回落 'requestFailed'。
- 来源：[jiuwenswarm/channels/web/frontend/src/features/assetPublishState.ts:L47–L61](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/assetPublishState.ts#L47-L61),
  - [jiuwenswarm/channels/web/frontend/src/features/assetPublishErrors.ts:L13–L33](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/assetPublishErrors.ts#L13-L33)
- **createCommitAttempt 并发去重换取固定 requestId 重试：成功结果被缓存，失败后会重新 send** 设计推断（非作者历史意图）：
- 收益：同一 attempt 实例内并发的 run() 共享同一个 pending Promise，成功后 completed 缓存让后续 run 直接返回已兑现值。成本：仅成功结果被缓存——send 拒绝后 finally 清空 pending，之后的 run 会用同一 requestId 再次调用 send，客户端本身并不阻止重复提交（推断：去重依赖服务端按 request_id 幂等）。
- 来源：[jiuwenswarm/channels/web/frontend/src/features/assetPublishState.ts:L23–L41](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/assetPublishState.ts#L23-L41)
- **抽屉测试用桩 API 验证轮询完成后更新历史行（automated_runtime）** assetPublishDrawer.test.mjs 用 assetPublishApi.describe/status 桩返回 queued→completed/pending_moderation，openAssetPublish 打开抽屉后等待约 2100ms，断言 'asset-publish-record' 文本匹配 /pending moderation/i。这是对抽屉运行时行为的自动化测试（API 已打桩），非本批内执行的声明。
- 来源：[jiuwenswarm/channels/web/frontend/tests/assetPublishDrawer.test.mjs:L317–L331](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/tests/assetPublishDrawer.test.mjs#L317-L331),
  - [jiuwenswarm/channels/web/frontend/src/features/assetPublishEvents.ts:L1–L4](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/assetPublishEvents.ts#L1-L4)
- **assetPublishApi 的 describe/prepare/commit/status/records 五方法经共享 request 注入 OAuth 凭据并依赖 sessionStorage 读取** 所示 assetPublishApi.ts 中 describe、prepare、commit、status、records 五个方法都经共享 request<T> 调 webRequest，方法名拼接为 `assets.publish.${method}`，
  - 并统一附加 auth（getStoredOAuthToken/getStoredOAuthProvider）与 timeoutMs 75_000。凭据读取依赖 sessionStorage：getStoredOAuthToken 读取异常时返回 null，getStoredOAuthProvider 仅在归一化为 'github' 时返回 'github'，否则（含异常）回退 'gitcode'。useAssetPublish.ts L29 以 `${provider}:${token || ''}` 构造作用域键，token 为 null 时用空字符串。
  - 此范围不含 localStatus 等未展示分支。
- 来源：[jiuwenswarm/channels/web/frontend/src/services/assetPublishApi.ts:L10–L19](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/services/assetPublishApi.ts#L10-L19),
  - [jiuwenswarm/channels/web/frontend/src/services/assetPublishApi.ts:L27–L38](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/services/assetPublishApi.ts#L27-L38),
  - [jiuwenswarm/channels/web/frontend/src/utils/gitcodeOAuth.ts:L32–L47](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/utils/gitcodeOAuth.ts#L32-L47),
  - [jiuwenswarm/channels/web/frontend/src/hooks/useAssetPublish.ts:L29–L30](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/hooks/useAssetPublish.ts#L29-L30)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/web-frontend/feature-depth-web-asset-publish-flow.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/services/assetPublishApi.ts:L28-L38；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/hooks/useAssetPublish.ts:L39-L61
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/features/assetPublishState.ts:L7-L15
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/features/assetPublishState.ts:L47-L61
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/features/assetPublishErrors.ts:L13-L33
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/tests/assetPublishDrawer.test.mjs:L317-L331
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/features/assetPublishEvents.ts:L1-L4；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/services/assetPublishApi.ts:L10-L38
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/features/assetPublishState.ts:L23-L41
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/services/assetPublishApi.ts:L10-L19；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/services/assetPublishApi.ts:L27-L38
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/utils/gitcodeOAuth.ts:L32-L47；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/hooks/useAssetPublish.ts:L29-L30
- 源页字段（feature）：web-asset-publish-flow
- 入口（entry_points）：jiuwenswarm/channels/web/frontend/src/hooks/useAssetPublish.ts
- 源页字段（source_globs）：jiuwenswarm/channels/web/frontend/src/hooks/useAssetPublish.ts；jiuwenswarm/channels/web/frontend/src/types/assetPublish.ts；jiuwenswarm/channels/web/frontend/src/features/assetPublication.ts；jiuwenswarm/channels/web/frontend/src/features/assetPublishErrors.ts
  - jiuwenswarm/channels/web/frontend/src/features/assetPublishEvents.ts；jiuwenswarm/channels/web/frontend/src/features/assetPublishState.ts
