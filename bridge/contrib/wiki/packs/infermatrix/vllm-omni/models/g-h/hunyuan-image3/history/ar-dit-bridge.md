---
name: ar-dit-bridge
description: HunyuanImage3 AR→DiT 数据桥接分析（2026-04-09）：与 GLM-Image 传 prior_token_ids 不同，HunyuanImage3 传 CoT 文本；当时 ar2diffusion 的 extra 字段未被 DiT forward 读取（桥接断开），最小修复是顶层 cot_text key 加 DiT 读取约 5 行
metadata:
  scope: 只收 2026-04-09 这次 AR→DiT 桥接断点的分析与最小修复方案；多图输入下 ar2diffusion 透传 image 的盘点归 multi-image-input-plumbing，当前 DiT 侧入口归 hunyuan-image3-architecture
---
## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/hunyuan-image3/history/ar-dit-bridge.md`（InferMatrixCopilot@ecfb84d0）；源页无 frontmatter

### AR→DiT 数据桥接（2026-04-09 分析）

#### 核心发现

- HunyuanImage3 和 GLM-Image 的数据流本质不同：
  - GLM-Image：AR → `prior_token_ids`（离散图像 token）→ DiT 直接解码
  - HunyuanImage3：AR → CoT 文本（`<think>...<recaption>...`）→ 重新走 `apply_chat_template` → DiT 用重编码后的序列

#### 当前状态：断的

- `ar2diffusion()` 输出 `extra: {ar_token_ids, ar_generated_text}`，但 DiT pipeline `forward()` 完全不读 extra dict。

#### 最小修复方案

1. `ar2diffusion`：把 `ar_generated_text` 同时作为 `"cot_text"` 顶层 key
2. DiT `forward()`：加 ~5 行从 `req.prompts[0]` dict 读 `cot_text` 和 `pil_image`

#### 负责人

- AR→DiT 桥接分给别人做，我们只关心 AR 侧。
- **Why:** 这是 IT2I 端到端跑通的最大阻塞项。
- **How to apply:** 不要尝试用 GLM-Image 的 token ID 传递模式，HunyuanImage3 必须传 cot_text 字符串。
