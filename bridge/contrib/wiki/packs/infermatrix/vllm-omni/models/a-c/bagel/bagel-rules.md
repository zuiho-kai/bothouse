---
name: bagel-rules
description: "BAGEL 实现规则 BAGEL-1 至 BAGEL-5：CFG position ID 沿序列轴合并（标量 RoPE 沿 dim 0，Lance mRoPE (3,S) 沿 dim 1）、DiT owner 是 nested language_model.model 须按 dotted path 解析、step image wave 的请求局部状态与同 wave 兼容边界（N<2 拒绝）、显式输出画布优先于 KV image_shape 与源图尺寸（PR #7287）、复制的 prefill / cache-update 相位跳过 SP strategy（PR #8177）"
metadata:
  scope: 只收 BAGEL-1 至 BAGEL-5 的适用范围、合同和验收；拓扑与数据流说明归 bagel-architecture，入口与配置差异归 bagel-overview
---
# BAGEL 实现规则

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/bagel/rules.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, models, diffusion；created: 2026-09-02；updated: 2026-10-06
- 来源（sources）：PR #5775；PR #5884；PR #6359；PR #7049；vllm_omni/diffusion/cache/cachedit/backend.py；vllm_omni/diffusion/diffusion_engine.py；vllm_omni/diffusion/models/bagel/bagel_transformer.py；vllm_omni/diffusion/models/bagel/pipeline_bagel.py；vllm_omni/diffusion/models/lance/lance_transformer.py
  - vllm_omni/diffusion/worker/diffusion_model_runner.py；tests/diffusion/cache/test_cache_backends.py；tests/diffusion/test_diffusion_engine_dummy_run.py；tests/diffusion/models/bagel/test_step_execution.py；PR #7287；PR #8177
- 置信度（confidence）：high

### Direct 代码快速入口

| PR 描述信号 | 规则 |
|---|---|
| CFG position ID、nested DiT owner、step image wave/request state | `BAGEL-1`–`BAGEL-3` |
| prefill、ViT/VAE 或 CFG cache-update 在 SP 下重复进入 collective | `BAGEL-5` |

### [BAGEL-1] CFG position ID 沿序列轴合并

- **适用范围**：`Bagel.forward` 将顺序 CFG 的 gen/cfg_text/cfg_img 分支合并为一次 LLM forward；也覆盖继承 `Bagel.generate_image` 和该 forward 的 Lance。
- **合同**：每分支的普通 RoPE position ID 形状为 `(S,)`，沿 dim 0 合并为 `(sum S,)`；每分支的 multimodal RoPE position ID 形状为 `(3,S)`，必须沿 dim 1 合并为 `(3,sum S)`。三条 t/h/w 是模态轴，不能沿 dim 0 拼成 `(3N,S)`；CFG 的 batch/branch 关系由重复 query sequence、`packed_seqlens` 和 merged cache 单独表达。
- **验收**：
  - 构造至少两个 CFG 分支，分别断言 1-D 输入得到 `(sum S,)`、2-D 输入得到 `(3,sum S)`，且每个分支在序列轴上的值和顺序保持不变。
  - 将结果送到对应 rotary/mRoPE 下游，断言 position ID 的序列长度与重复后的 query token 总数一致，模态轴仍为 3；不能只检查 `torch.cat` 本身不报错。
  - 保留 BAGEL 1-D 路径的回归覆盖，并为 Lance `(3,S)` 路径补 GPU E2E。引入该合同的 PR #5775（`c9f2e5ad`）只有 shape tracing、ruff 和 reviewer approval，作者因无 CUDA GPU 未执行 Lance 端到端，因此不能把该提交视为 GPU 精度/功能已验证。

### [BAGEL-2] DiT owner 是 nested `language_model.model`

- **适用范围**：任何消费 `BagelPipeline._dit_modules` 的 Cache-DiT、compile、SP、LoRA、loader 或 offloader 路径；Lance 继承此 pipeline 时也需复核其实际组件树。
- **合同**：Bagel 声明 `_dit_modules = ["language_model.model"]`；consumer 必须把它当多段 attribute path 解析到真实 DiT，不能把含点字符串传给单层 `getattr`。缺失中间节点应按该 consumer 的既有策略 skip/warn/fail，不能因解析器差异静默漏掉模型。目标 pin 的 Cache-DiT 已支持 dotted enable/refresh/summary；
  - generic compile、registry SP 和 LoRA 仍未共享 dotted resolver，不能声称 Bagel 的全部 lifecycle 已支持。Bagel init 也令 `transformer` 指向同一 object，但 `_dit_modules` 非空时 Cache-DiT 不走 conventional fallback；consumer 必须以 canonical declaration 为准，不能依赖当前 direct alias。
  - Cache-DiT 会在 refresh/summary 时重新解析该 path，故 enable 后不得替换 `language_model.model` identity；若 future declaration 同时列出两个 alias，也会重复 enable，因为当前 discovery 不按 identity 去重。
- **验收**：真实 Bagel component tree 覆盖 Cache-DiT enable→repeated request refresh→summary，断言 hook/context 始终绑定同一 nested model，disable 清理安装时记录的 target。对 compile、SP、LoRA 与 offload 分别验证同一 object identity 和 missing-middle 行为。当前 mock 测试覆盖 dotted enable/refresh/summary；
  - multi-target disable 虽有 mock 覆盖，但没有真实 cross-consumer、异常或 worker shutdown 证据。^[PR #5884]

### [BAGEL-3] Step image wave 必须保持请求局部状态与兼容边界

- **适用范围**：`BagelPipeline` 的 `prepare_encode` → `denoise_step` → `step_scheduler` → `post_decode` image step lifecycle，以及 runner 在 step wave 和完整 `forward()` fallback 间切换；不把 AR Thinker 或 text generation 纳入该合同。
- **合同**：每个 image request 在 `prepare_encode` 建立自己的 latent、timestep/scheduler progress、主/CFG KV context、CFG 参数与可选 trajectory；同一 wave 可以把兼容 request 的 DiT 输入、KV 和 CFG 分支打包进一次 denoise forward，但必须重 base 每个 request 的 packed token index，之后按 request 拆回 noise prediction、scheduler update 和输出。
  - 三路 CFG（gen/cfg_text/cfg_img）仍是每 request 的语义，不能因 packing 混用 KV、renormalization 或 trajectory。
- Admission 必须先解析有效图像几何：img2img 从输入图像推导、对齐 latent stride 并受 checkpoint size limit 限制，不能直接按用户的 `height`/`width` 合批。一个 step wave 只可含 effective geometry 相同且 `cfg_text_scale`、`cfg_img_scale`、`cfg_interval`、`cfg_renorm_type`、`cfg_renorm_min` 相同的请求；其余请求独立排队。
  - 该支持只覆盖 image generation：两个 two-stage 拓扑的 Stage 1 diffusion 使用 step protocol、Stage 0 Thinker 仍为 AR；single-stage 的显式 text2text/img2text 继续走完整请求路径。BAGEL step mode 不支持 sequence parallelism 或 diffusion cache backend；这不否定 two-stage 的 inter-stage KV transfer。
- 调度步数须以当前 BAGEL schedule builder 为准：#6359 的一度行为已由 #7049 恢复为 `N` 个 schedule points、`N - 1` 个 Euler denoise updates，所有 image path 对 `N < 2` 失败。不要把旧的 “exactly N updates”、one-step 支持或该 PR 的 benchmark 当成当前合同。
- engine dummy warmup 在 request 和 step 两种 execution mode 都必须请求至少两个 inference steps，保证 BAGEL 至少执行一次 denoise iteration，不能把未去噪的 initial noise 当作 warmup。
- step request abort/finish 后，runner 必须先清理 request state、paged diffusion-KV 和 stale `InputBatch`，再 dispatch 后续完整 `forward()` 的 text fallback；否则先前 wave 的 tensor/KV 可保留并污染生命周期。
- **验收**：以两个重叠 image request 覆盖 packed index rebasing、各自 CFG/renorm、state isolation 和 output ownership；再覆盖 img2img effective geometry 不同而不合批、SP/cache rejection，以及 step request finish/abort 后的 explicit text full-forward fallback。
  - schedule regression 必须断言 `N < 2` 在 complete 和 step image path 均被拒绝，且不将 denoise update 数写成 `N`；dummy-run regression 必须对 request 和 step 两种 mode 都断言两个 inference steps。^[PR #6359] ^[PR #7049]

### [BAGEL-4] 显式输出画布优先于 KV image_shape 与源图尺寸

- **适用范围**：`/v1/images/edits` 与 BAGEL img2img/`get_bagel_pre_process_func`/`_forward_single` 的 height/width 决议，含 two-stage 的 `kv_metadata["image_shape"]`。
- **合同**：画布优先级为 **显式请求 > `kv_metadata["image_shape"]` > 输入图像推导**。`size=auto` 在 API 层解析为源尺寸后，必须用 `height_not_provided`/`width_not_provided` 标记非意图画布；preprocessor 对派生画布同样置位。显式边长按 latent stride 向下对齐并告警；超过 checkpoint 上限以 `OmniClientError`（HTTP 400）拒绝。源图仍可为 VAE/ViT prefill 做 stride 对齐，但不得覆盖已请求的输出画布。
  - 非流式 generation/edit 响应的 `size` 必须来自实际生成图像。
- **验收**：显式 `size` 不被源图或 AR 发布的 KV shape 覆盖；`size=auto` 与纯离线 img2img 保持派生对齐；越界拒绝；响应 `size` 与解码图像一致。^[PR #7287]

### [BAGEL-5] 复制的 prefill/cache-update 相位必须跳过 SP strategy

- 触发：修改 `PackedAttentionMoT` 的 `_forward_und`、`_forward_gen`、attention 构造或 CFG cache-update。
- 强制：每个 SP rank 持有完整序列的 causal prefill、ViT/VAE 和 CFG cache-update 使用 `skip_sequence_parallel=True` 的 causal/local noncausal attention；参数无关的 local noncausal 层与 strategy 层分开。`_forward_gen` 仅在 SP active 且 `not update_past_key_values` 时进入 joint denoise strategy。
- 验收：断言构造期 causal/local opt-out 与 joint noncausal 的 opt-in；覆盖 SP cache-update、SP denoise、非 SP 和 causal/noncausal prefill 的实际 dispatch 与 KV shape。^[PR #8177]

## 决策与踩坑

- [BAGEL-5] 禁止：把复制的完整序列当 shard 送入 Ulysses all-to-all；让 `_forward_und` 进入 strategy；为修复 cache-update 而关闭原本分片的 denoise 路径。
