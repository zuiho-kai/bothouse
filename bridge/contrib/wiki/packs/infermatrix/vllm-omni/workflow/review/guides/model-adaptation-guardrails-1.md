---
name: model-adaptation-guardrails-1
description: Model Adaptation PR Guardrails 第 1–4 节：触发与硬规则、mini-spec appendix 模板、checkpoint layout gate（runnable model id 只写当前 loader 可加载者）、public entrypoint matrix、request parsing 与 path parity（precomputed prompt 字段 all-or-none）
metadata:
  scope: 只收模型适配 PR 开发前的 mini-spec、checkpoint、public entrypoint 与 request parsing 规则；验证分层、docs 性能数字、full diff review gate、interactive reviewer loop 与 pre-push checklist 归 model-adaptation-guardrails-2，语义验证矩阵归 model-validation，owner 路由归 maintainer-pattern-routing
---
# Model Adaptation PR Guardrails（1/2）

## 关键事实

- 拆分说明：本页是源页 `model-adaptation-guardrails.md` 的第 1/2 部分；第 2 部分 [[model-adaptation-guardrails-2]]
- 源页：`knowledge/repos/vllm-omni/review/guides/model-adaptation-guardrails.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: vllm-omni, review；created: 2026-07-10；updated: 2026-07-10
- **触发**：新模型、新 pipeline、新 backend、已有模型新增 T2V/I2V/S2V/V2V 等 public path、PR 需要写性能提升、docs/recipe/supported model/perf config 任何一个公开入口发生变化。
- **硬规则**：开发前先按 canonical mini spec（源链接 `../../../../general/planning/guides/mini-spec.md`） 写最小模板；本页只补模型 / checkpoint / pipeline 适配 appendix。sub-agent review 只能兜底，不能替代开发前 gate。能跑通 unit test 不等于 public entrypoint 可用，不等于 PR body 可以写性能结论。声明 PR clean 前必须跑 full diff review；关闭已知 finding 不等于全量 review 干净。

### 1. Model adaptation mini-spec appendix

- 先完成 mini_spec.md（源链接 `../../../../general/planning/guides/mini-spec.md`） 的 canonical template；涉及新模型 / checkpoint / pipeline 时，再追加这张短矩阵，允许很短，但不能空：

```text
Mini spec
- Goal:
- Checkpoint layout:
  - runnable model id:
  - raw/upstream model id:
  - required files/subfolders:
- Public entrypoints:
  - offline T2V:
  - offline I2V:
  - serving T2V:
  - serving I2V:
  - perf config:
- Request fields:
  - ingress:
  - default semantics:
  - owner:
  - consumers:
  - failure policy:
- Path parity:
  - normal path:
  - variant paths:
  - shared helper or intentional split:
- Validation tiers:
  - unit:
  - public smoke:
  - formal perf:
- PR evidence:
  - latest-head:
  - historical:
  - pending:
- Non-goals:
```

- 写不出 mini spec，不准开始实现。五行能讲清就写五行；五行讲不清，就说明这不是简单改动。

### 2. Checkpoint layout gate

- 新模型 public model id 写进 docs/examples/recipes/perf config 前，必须先验证 checkpoint 目录结构。
- 至少检查：
  - `model_index.json`
  - pipeline loader 需要的 subfolder configs，例如 `transformer/config.json`、`vae/config.json`、`scheduler/scheduler_config.json`、`tokenizer/`、`text_encoder/`
  - 当前 pipeline loader 是否支持 single-file/raw safetensors
  - official repo 和 community Diffusers-format repo 是否是同一种布局
- 规则：
  - `supported_models.md`、offline examples、recipes、perf config 只能把**当前 loader 可直接加载**的 checkpoint 写成 runnable model id。
  - upstream raw checkpoint 只能写在 References / Notes，不能写进 runnable command 或 default route。
  - 从相邻版本继承经验必须重新验证。`LTX-2` official 是 Diffusers layout，不代表 `LTX-2.3` official 也是。

### 3. Public entrypoint matrix

- 新增或公开某个模型能力时，必须按 public path 列清楚命令和必填字段：

| Path | 必须证明 |
| --- | --- |
| offline T2V | model id、class auto-select、sampling params、output handling |
| offline I2V | image/multimodal key、single/multi image policy、latents path |
| serving T2V | `/v1/videos` 或 `/sync` form fields、model id、required params |
| serving I2V | `input_reference` / `image_reference` 到 `multi_modal_data["image"]` 到 pipeline consumer |
| perf config | workload、model id、mode、runner actually supports it |

- docs 里不能把 T2V curl 放在 I2V server command 后面冒充 I2V 验证。I2V recipe 必须带 reference input；如果 live serving smoke 没跑，PR body 必须明确写 pending。
- public API bad path 要区分层级：
  - endpoint 做了 structured 4xx：可以写 "request is rejected"
  - 只有 pipeline 内部 `ValueError`：只能写 "pipeline requires X"，不要暗示 public API 已有 clean rejection

### 4. Request parsing and path parity

- 新增第二条执行路径时，request parsing 默认不能复制。
- 常见第二路径：
  - T2V vs I2V
  - image input vs provided latents
  - packed vs unpacked latents
  - direct args vs prompt dict / `additional_information`
  - offline vs serving
  - normal forward vs step/graph/cache path
- 规则：
  - 两条路径解析同一套请求语义时，必须共用 owner helper。
  - helper 返回值按 consumer 拆名，不能把用户原始值、scheduler 默认、decode 默认、system prompt 默认混成一个变量。
  - 测试必须覆盖非默认字段，不能只测默认 smoke。
- precomputed prompt fields 是 all-or-none batch contract：
  - `prompt_embeds`
  - `negative_prompt_embeds`
  - `prompt_attention_mask` / `attention_mask`
  - `negative_prompt_attention_mask` / `negative_attention_mask`
- 只要 batch 里任一 prompt 提供该字段，所有 prompt 都必须提供。否则要 fail fast，并带 missing index；禁止让 `torch.stack([... None ...])` 这类低级错误泄漏出来。
- 不要用 Python `or` 合并 tensor 字段；tensor truthiness 会晚炸或语义错误。先显式判断 `is None`。
