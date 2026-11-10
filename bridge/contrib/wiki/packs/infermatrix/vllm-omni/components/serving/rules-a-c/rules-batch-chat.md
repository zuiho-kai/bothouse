---
name: rules-batch-chat
description: "Batched Chat Serving 三条规则（PR #5317）：/v1/chat/completions/batch 是 frontend fan-out/fan-in；SERV-4i 每个 input 有唯一、稳定、可取消的 child request，SERV-4j 一项 input 对一项 choice（text+audio 合并、image list 不拆），SERV-4k child / aggregation failure 按来源分 4xx / 5xx 且 whole-batch 语义明确"
metadata:
  scope: 只收 batched chat 的 SERV-4i、SERV-4j、SERV-4k；其余 SERV-4* 请求字段合同归 rules-request-input-1、rules-request-input-2，规则组总表归 serving-rules-1
---
# Batched Chat Serving 规则

## 关键事实

- 源页：`knowledge/repos/vllm-omni/components/serving/rules-batch-chat.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, components, serving；created: 2026-09-02；updated: 2026-09-02
- 来源（sources）：PR #5317；vllm_omni/config/endpoint_policy.py；vllm_omni/entrypoints/openai/api_server.py；vllm_omni/entrypoints/openai/batch_serving.py；tests/e2e/online_serving/test_flux_2_dev_expansion.py；tests/e2e/online_serving/test_qwen3_omni.py
  - tests/entrypoints/openai/test_batch_chat_completions.py
- 置信度（confidence）：high
- 该 endpoint 是 frontend fan-out/fan-in，不是 scheduler 或 engine native batch；模型 E2E 只证明对应输出 surface 可经该 wrapper 返回，不改变模型或 scheduler owner。
- [SERV-4i] 每个 batch input 必须有唯一、稳定且可取消的 child request
  - 触发：修改 `/v1/chat/completions/batch`、child request 转换、request ID 或并发 task orchestration。
  - 强制：先把每项转换为普通 non-streaming chat request并按 input index 建立稳定 child ID，再并发提交；fan-in 按原 input 顺序返回。复用 raw Request 时必须隔离 header/request-id 等 mutable state，ID 在并发 batch 间也须唯一；disconnect、child exception 和 early abort 必须 cancel 并 await 全部未完成 task。
  - 验收：覆盖有/无 header、相同 user base ID 的并发 batches、顺序不同的 child completion、conversion error、child exception、disconnect/cancel 和大 batch admission。目标实现只证明单 batch suffix 唯一；它复用并修改 raw Request，task 数无界，finally cancel 后不 await，跨 batch collision/泄漏未覆盖。^[PR #5317]
- [SERV-4j] batch response cardinality 永远是一项 input 对一项 choice
  - 触发：普通 chat 新增 output modality/choice shape，或修改 batch choice collapse。
  - 强制：单 content choice 原样保留；恰好一个 content 加一个 audio choice 合成同一 message，顺序无关；image list 仍是一个 content choice。aggregate choice index 必须等于 input position。
  - 验收：text、audio+text 两种顺序、image、image+audio 与非法多 choice 精确断言 payload 和 cardinality；当前 unit tests 覆盖 collapse shape，Qwen E2E 覆盖 text/audio，FLUX E2E 只检查 choice 数，未验证 image payload 的 JSON serialization；最终 `model_dump(mode="json")` 也未用 `serialize_as_any`。^[PR #5317]
- [SERV-4k] child 与 aggregation failure 必须按来源分类且 whole-batch 语义明确
  - 触发：child 返回 `ErrorResponse`、conversion/collapse 失败、usage 聚合或 streaming request。
  - 强制：client conversion/unsupported option 返回结构化 4xx；child `ErrorResponse` 保留其 code；内部 response-shape/collapse/task failure 返回 5xx。接口若采用 whole-batch failure，就不得混入 partial choices；usage 合同须明确只汇总 basic prompt/completion/total，或完整合并新增 detail 字段。
  - 验收：malformed child、n>1、first/middle/last child 4xx/5xx、collapse failure、task exception、partial success、stream request 和 usage details 分别断言 HTTP/status/body。目标实现对 stream 只 server warning，任一 child error 返回 whole-batch error，basic usage 求和；collapse 内部失败仍误报默认 400。^[PR #5317]

## 决策与踩坑

- [SERV-4i] 禁止：称其为 engine batching；无上限地按 input 数创建 task；只在单 batch 内 suffix 去重却允许用户重用 base ID 造成跨 batch collision；共享并修改一个 raw Request 而不证明 child isolation。
- [SERV-4j] 禁止：把 text/audio 两个内部 choice 直接展开成两项 batch choice；把 image content list 的元素数误当 choice 数；对多个 content、多个 audio 或超过两个 choice 猜测合并。
- [SERV-4k] 禁止：用 `_create_error_response` 的默认 400 包装服务器产生的非法 choice shape；把 valid `stream=true` 静默改 false 后让客户端误以为请求语义已满足；忽略某个 child usage/error。
