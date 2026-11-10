---
name: deploy-yaml
description: vLLM-Omni deploy YAML 写作实操（main @ 7a2007cc 复核）：何时需要新 YAML 何时 CLI override 就够、--deploy-config 取代 --stage-configs-path、必查字段（gpu_memory_utilization、async_chunk、kv_cache_memory_bytes、diffusion_batch_size 与 max_num_seqs）、三类拓扑的代表 YAML 与 Audex 2B/30B 变体
metadata:
  scope: 只收给模型写或改部署 YAML 的实操要点；字段语义与合并链归 configuration-architecture，字段全表与函数级解析链归 pipeline-deploy-schema，显存预算案例归 deployment-memory-budget，connector 声明归 distributed 组件
---
# Deploy YAML 写作实操

## 关键事实

- 源页：`knowledge/repos/vllm-omni/components/configuration/deploy-yaml.md`（InferMatrixCopilot@ecfb84d0）；title: vLLM-Omni deploy YAML 实操；type: guide；tags: vllm-omni, components, config；created: 2026-07-16；updated: 2026-09-02
- 来源（sources）：claude-workflow-starter-private@296ea45；PR #5647；vllm_omni/deploy/；vllm_omni/entrypoints/cli/serve.py
- 面向"要给模型写/改部署配置"的场景；schema 语义 owner 是 [[configuration-architecture]]（Configuration）（本页不复制字段表）。`main @ 7a2007cc` 复核。

### 何时需要 YAML，何时 CLI 就够

- bundled 默认：registry 按 `model_type` 自动加载 `vllm_omni/deploy/<model>.yaml` ——public `vllm serve --omni` 不给 `--deploy-config` 时就用它；只调个别 stage 参数时优先 CLI/per-stage override，不新写 YAML。
- 需要新 YAML 的信号：新模型/新 stage 拓扑变体（参照 bagel 的三形态）、平台覆盖（`platforms: npu/rocm/xpu`）、connector 拓扑改变、或要固化一组经过验证的资源参数（如 voxcpm2 的 KV pin）。
- public `vllm serve --omni` 已删除 `--stage-configs-path`，在线启动和 Helm 统一使用 `--deploy-config` / `deployConfigPath`；旧 Helm key 非空时必须 fail fast 并给出替代项。Offline/programmatic API 仍可用 `stage_configs_path` 读取 legacy `stage_args` schema（`model_executor/stage_configs/*.yaml`），不要把 public CLI 删除误写成内部合同已删除。

### 写作时必查的字段（事故来源）

- **每个共卡 stage 显式 `gpu_memory_utilization`**（缺省 0.9/0.92 是 OOM 事故源，[[configuration-rules-1]]、[[configuration-rules-2]]、[[configuration-rules-3]]（CONF-1a））。
- **单 stage/端到端 pipeline pin `async_chunk: false`**（[[ci-gotchas]]（ci-gotchas） 第 2 条）。
- KV 记账外分配的模型考虑 `kv_cache_memory_bytes` pin（[[configuration-rules-1]]、[[configuration-rules-2]]、[[configuration-rules-3]]（CONF-2a））。
- 争议以展开后最终配置为准（[[configuration-rules-1]]、[[configuration-rules-2]]、[[configuration-rules-3]]（CONF-3a））。
- `diffusion_batch_size` 是客户端请求 batch width，不能替代 scheduler 的 `max_num_seqs`。需要 Wan2.2 request-level batching 时，在 CLI 显式传 `--max-num-seqs N` 或在 stage YAML 设置该字段；`wan2_2_ti2v.yaml` 的默认宽度为 4。不要依赖 stage init 把前者写进后者。^[PR #6525]

### 代表样例（79 份 YAML 中的三类拓扑）

- 单 stage diffusion：不进 `OMNI_PIPELINES`，通常无需 YAML（引擎默认兜底），需要固化参数时才写。
- AR+DiT 两 stage：`glm_image.yaml`、`hunyuan_image3_{ar,dit,_moe}.yaml`。
- thinker/talker(+code2wav) 多 stage：`qwen2_5_omni.yaml`（1×H100 验证）、`qwen3_omni_moe.yaml`（2×H100 验证）、`qwen3_tts.yaml`（+ 高并发/对齐器变体）。
- Audex 四模式各有 2B/30B YAML：`audex_{tts,tta,thinker_only,s2s}{,_30b}.yaml`；TTS/S2S 使用 streaming codec handoff，TTA 使用同步 full-payload XCodec，30B 必须显式选择 `_30b` 资源配置。

### 相关

- 字段语义/合并链：[[configuration-architecture]]（Configuration architecture）；connector 声明：[[connector-backends]]（connector-backends）。
