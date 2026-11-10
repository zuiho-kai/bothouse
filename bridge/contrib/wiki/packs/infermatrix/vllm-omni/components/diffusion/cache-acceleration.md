---
name: cache-acceleration
description: Diffusion 缓存加速：Cache-DiT、TeaCache（rel_l1_thresh 默认与 0.2 回退、custom extractor 合同、hook state reset）、stepcache、magcache、prompt_embed_cache，_NO_CACHE_ACCELERATION 三条不支持的 pipeline，MiniMax-H3 只校准 FL2VA；源码 vllm_omni/diffusion/cache/（main @ 45629a8e 复核）
metadata:
  scope: 只收 diffusion cache 后端的机制说明与兼容性例外；组件边界归 diffusion-architecture，step mode 拒绝 cache backend 的合同归 step-and-batching
---
# 缓存加速（cache_dit / TeaCache / stepcache / magcache）

## 关键事实

- 源页：`knowledge/repos/vllm-omni/components/diffusion/cache-acceleration.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: vllm-omni, components, diffusion；created: 2026-07-16；updated: 2026-09-04
- 来源（sources）：PR #5840；PR #6353；docs/design/feature/cache_dit.md；docs/design/feature/teacache.md；recipes/MiniMaxAI/MiniMax-H3.md；vllm_omni/diffusion/cache/；vllm_omni/diffusion/data.py；vllm_omni/diffusion/registry.py；vllm_omni/diffusion/worker/diffusion_model_runner.py
  - vllm_omni/engine/async_omni_engine.py；tests/diffusion/cache/test_teacache_extractors.py
- 官方 spec：`docs/design/feature/{cache_dit,teacache,prefix_caching}.md`；源码 `vllm_omni/diffusion/cache/`（`base.py`、`selector.py`、`cache_dit_backend.py`、`teacache/`、`stepcache/`、`magcache/`、`prompt_embed_cache.py`—— `main @ 45629a8e` 复核）。
- **Cache-DiT**：DiT 加速库，跨 denoise step 缓存中间计算——相邻步的中间特征相似，可复用缓存跳过冗余计算；支持三类缓存策略；标准架构自动支持，自定义架构需按 spec 写自定义实现（参照实现：Qwen-Image、LongCat-Image pipeline）。
- **TeaCache**：当相邻 timestep 的调制输入（归一化 + timestep conditioning 后）累积重标定 L1 距离低于阈值时复用上一步 transformer block 残差。`rel_l1_thresh=None` 先交给 transformer-type default，未注册模型才回退 0.2；速度/质量必须逐模型校准，不能沿用通用“1.5x–2.0x、损失极小”描述。
  - custom extractor 必须镜像 native preprocess、block call、SP prepare/gather 与 postprocess 的完整 kwargs/layout/device/dtype 合同，并按 request 重置 state。注意 public engine 的 omitted `cache_config` 仍可能在 backend 前注入 0.2；必须从入口追到最终值。hook state 实际驻留在 module 上，由 runner 在每次 generation 前 reset；
  - 只有 first step 明确强制 compute，代码没有 last-step 特例，request 隔离仍依赖 refresh 与无交错执行。
- 其他后端：`stepcache/`、`magcache/`（同一 selector 框架下的策略变体）、`prompt_embed_cache.py`（prompt 嵌入缓存）、`prefix_caching.md`（diffusion 侧前缀缓存语义）。
- 兼容性例外：registry 的 `_NO_CACHE_ACCELERATION = {"NextStep11Pipeline", "Pi0Pipeline", "LingBotWorldCausalDMDPipeline"}`——这三条 pipeline 不支持 cache_dit/tea_cache。
- MiniMax-H3 只校准 FL2VA：Ref2VA-only fail fast，combined 只 hook `transformer` 并告警 `transformers_ref` 不缓存；具体阈值与证据见 [[rules-cache-task-1]]（MMH3-2g；源锚点 #mmh3-2g-h3-teacache-只绑定-fl2va-校准与-request-state）。

### 相关

- 后端选择入口在 `diffusion/registry.py::initialize_model`（加载类、量化、VAE slicing/tiling、并行注入的同一初始化链）；组件边界见 [[diffusion-architecture]]（architecture）。
