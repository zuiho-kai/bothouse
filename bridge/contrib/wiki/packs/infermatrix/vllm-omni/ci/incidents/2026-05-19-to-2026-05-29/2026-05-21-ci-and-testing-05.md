---
name: 2026-05-21-ci-and-testing-05
description: "2026-05-21 CI 错题 inc-2026-05-21-ci-and-testing-05，PR #3723 人工 review 指出 stream 字段缺文档、streaming 逻辑放在 api_server.py、手写 AR delta 未复用 RequestOutputKind.DELTA、ar_delta chunk 缺 index，及八步修复和六条预防"
metadata:
  scope: "只收 2026-05-21 PR #3723 reviewer feedback 复盘（streaming public API 的分层、协议 schema、文档与测试）；同一 PR 早先漏审的协议坏路径归 2026-05-19-ci-and-testing-06"
---
# 2026-05-21 — PR #3723 reviewer feedback 复盘：streaming public API 不能只按 endpoint 增量做

## 关键事实

- 源页：`knowledge/repos/vllm-omni/ci/incidents/2026-05-21-ci-and-testing-05.md`（InferMatrixCopilot@ecfb84d0）；源页无 frontmatter

## 决策与踩坑

- 编号：`inc-2026-05-21-ci-and-testing-05`
- 归属：`repos/vllm-omni/ci`
- 状态：已验证
- 搜索词：PR #3723 reviewer feedback 复盘：streaming public API 不能只按 endpoint 增量做
- 影响范围：repos/vllm-omni/ci
- **症状**：HunyuanImage3 IT2I `/v1/images/edits stream=true` 第一版能跑通 happy path，但人工 review 连续指出四类问题：
  1. 新 public API 字段 `stream` 和 SSE response format 没补文档。
  2. streaming 逻辑放在 `api_server.py`，没有跟 `create_chat_completion` 一样由 serving 层在 `stream=True` 时返回 generator、非流式返回完整结果。
  3. 手写 `previous_text_by_index` 计算 AR delta，没有复用 engine 侧已有 `RequestOutputKind.DELTA`。
  4. `ar_delta` chunk 没有 `index`，当前 Hunyuan 常规单路 AR 可用，但未来多 completion 会把多个 AR 流混在一起。
- **为什么出现**：
  - 把需求理解成“给 `/v1/images/edits` 加一个 stream 分支”，而不是“新增公开 API + 新 streaming protocol surface”。因此只盯代码和 tests，漏掉 docs、schema、错误语义和客户端消费语义。
  - 没先 grep/diff 仓库已有 streaming endpoint，尤其没有对齐 `create_chat_completion` 的分层：API 层接参和包装 response，serving 层持有生成逻辑。
  - 为了快速产出手写 delta 逻辑，没有先查 engine output processor 里已有的 DELTA 输出机制，导致重复实现且协议语义更脆。
  - 设计 chunk schema 时按当前模型 n=1 的实际路径拍板，没有从 public response 的扩展边界出发。
  - sub-agent review 和 ruff 已经变成硬卡点，但第一版 reviewer-lens prompt 没把 docs surface / existing streaming pattern / protocol append invariant 显式列入审计重点。
- **怎么解决**：
  1. API 层只保留 `stream` form 参数、单阶段早拒绝和 `StreamingResponse(media_type="text/event-stream")` 包装。
  2. `generate_diffusion_images(..., stream=True)` 下沉到 serving 层返回 async generator，`stream=False` 保持原完整返回路径。
  3. stage0 AR sampling params 使用 `RequestOutputKind.DELTA`，删除手写 previous-text delta 计算。
  4. 在 `protocol/images.py` 定义正式 stream response chunk schema：`ImageEditARDeltaChunk`、`ImageEditImageChunk`、`ImageEditStreamError`，并导出。
  5. `ar_delta` chunk 加 `index`，让客户端能区分多路 completion；当前 Hunyuan 单路仍保持简单消费。
  6. 补 `docs/serving/image_edit_api.md`：`stream` 参数、适用条件、多阶段 AR+DiT 顺序、`ar_delta` / final image / error / `[DONE]` 示例、curl 示例。
  7. 补坏路径和协议测试：单阶段早拒绝、DELTA sampling params、多个 index、空 final image/error、最终 image chunk base64/format/size。
  8. 本地跑 changed-file `ruff check`、`py_compile`、`git diff --check`；远端新 `<REMOTE_WORK_ROOT>` worktree + fresh venv 跑 focused API tests 和 Hunyuan bridge regression。
- **之后怎么避免**：
  1. 看到新增 `stream` / SSE / WebSocket / OpenAI-compatible response，先做 protocol audit，不把它当 endpoint if 分支：docs、schema、错误 chunk、DONE、client append 语义都要覆盖。
  2. 动手前先 grep 现有 streaming endpoint 和 output processor；已有 `RequestOutputKind.DELTA` / error handling / EngineDeadError 语义优先复用。
  3. streaming response 类型先落在 protocol 层，再接 serving，再接 API；不要从 endpoint 里临时 yield dict。
  4. 字段名叫 `delta` 的测试必须模拟客户端 append 重建最终文本；如果 append 不成立，改协议字段，不改测试迁就。
  5. reviewer-lens 的 Surface area audit 必须显式问 docs surface：新增参数是否有文档、默认值、适用条件、响应格式、错误格式。
  6. 提交/推 PR 前固定顺序：diff 自审 → sub-agent reviewer-lens audit → 修 findings → ruff/必要 pytest → PR body/docs 读回检查。
