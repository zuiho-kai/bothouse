---
name: rules-output-contract
description: "Omni 输出类型合同 EXEC-OUTPUT-1a 与 EXEC-7a 至 EXEC-7e：output type 只接受 canonical 名称（text/image/audio/latent/token_ids，PR #7843）、OmniRequestOutput 为扁平 RequestOutput 子类并经 from_stage_output() 复制（PR #5146）、字段与 _REQUEST_OUTPUT_CONTENT_ATTRS parity（PR #6152）、sample-rate 键按最新快照合并（PR #7448）、张量累积策略按 (modality, key) 解析（PR #7608）、routed-expert 回归验证 native V2 auxiliary output（PR #8500）"
metadata:
  scope: 只收 Omni 输出类型、OmniRequestOutput 字段/复制合同、MultimodalPayload 合并与累积策略六条规则；MRv2 的 aux tree 与 generation 输出归 rules-mrv2-output-contracts，异步 output slab 所有权归 rules-output-snapshots，跨 stage 合同归 rules-bridge-batch-1、rules-bridge-batch-2，其余审查组路由归 model-executor-rules-1
---
# Omni 输出类型合同

## 关键事实

- 源页：`knowledge/repos/vllm-omni/components/model-executor/rules-output-contract.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, components, model-executor；created: 2026-09-04；updated: 2026-10-06
- 来源（sources）：PR #5146；PR #6152；vllm_omni/outputs/；PR #7448；PR #7608；PR #7843；PR #8500
- 置信度（confidence）：high
- [EXEC-OUTPUT-1a] output type 只接受 canonical 名称，字段命名不证明表示正确
  - 触发：修改 OutputModality parsing、engine_output_type config、payload naming 或 DELTA retention。
  - 强制：只接受 text/image/audio/latent/token_ids 的 lowercase 无空白名称与非空 `+`/`,` 组合；None 保持默认，显式空值穿过 config 并在 output-processor 初始化失败，清理已启动 replica。TOKEN_IDS 是独立类型且不 drain；generic model_outputs/hidden 沿共享 default-key 命名，显式 auxiliary keys 保留，已有 per-key accumulation strategy 优先。
  - 验收：canonical/alias/case/whitespace/empty 解析、explicit-empty startup cleanup、dim0 accumulation、DELTA retention 与 key override；tensor normalization 前后值不变，独立 auxiliary outputs 有明确 keys。平台-specific auxiliary producer 另验。^[PR #7843]
- `EXEC-7a`–`EXEC-7b`：Omni 输出必须是扁平的 `RequestOutput` 子类，并保持其字段与复制合同。触发条件与其余审查组见 [[model-executor-rules-1]]、[[model-executor-rules-2]]、[[model-executor-rules-3]]（model-executor 共享规则） 的 Direct 代码快速入口。
- [EXEC-7a] Omni 输出必须是扁平的 RequestOutput 子类
  - 触发：修改 `OmniRequestOutput`、stage output wrapping、`omni.generate()` 返回对象或其 serving/offline 消费者。
  - 强制：`OmniRequestOutput` 必须继承 vLLM `RequestOutput` 并将继承字段作为 dataclass 字段直接声明；stage 原始输出必须通过 `from_stage_output()` 显式复制 `prompt`、`prompt_token_ids`、`outputs`、`finished` 等生成内容，源对象为 `OmniRequestOutput` 时再复制 diffusion 内容；消费者直接读取扁平字段，列表归一化只在真实列表边界完成。
  - 验收：用真实 `RequestOutput` 和 `OmniRequestOutput` 分别验证 factory 复制的 prompt、token、outputs、finished 及 images/trajectory 内容；覆盖文本、音频、图像和 pipeline stage 的直接字段消费，并确认未完成 stage 的 `finished` 不被包装过程改写。^[PR #5146]
- [EXEC-7b] OmniRequestOutput 必须保持 RequestOutput 字段与复制合同
  - 触发：修改 `OmniRequestOutput`、升级 vLLM `RequestOutput`，或调整 `from_stage_output()` 的输出复制逻辑时。
  - 强制：对照真实 `RequestOutput.__init__` 设置的全部公开属性，在 `OmniRequestOutput` 中以匹配的类型和默认值声明字段，并同步加入 `_REQUEST_OUTPUT_CONTENT_ATTRS`，确保 `from_stage_output()` 复制非空值。
  - 验收：用真实 `RequestOutput` 与 `OmniRequestOutput` 做属性 parity 测试；覆盖新字段默认值为 `None`，以及 `ec_transfer_params`、`num_cache_creation_tokens` 等非空值经 `from_stage_output()` 后保持不变。 ^[PR #6152]
- 相关执行流见 [[model-executor-architecture]]（model-executor architecture）；跨 stage 合同见 [[rules-bridge-batch-1]]、[[rules-bridge-batch-2]]（bridge/batch 规则）。
- [EXEC-7c] 已知 sample-rate 键必须按最新快照合并，不得当生成内容累积
  - 触发：修改 `MultimodalPayload.merged_with`、DELTA/CUMULATIVE 音频输出合并，或 `sr`/`sample_rate`/`audio_sample_rate` 的分区与巩固。
  - 强制：这三个键是 metadata 快照，不是 waveform 内容。合并前先从 incoming 捕获快照，再写入 metadata 分区一次；缺失键保留既有值。tensor/scalar 表示切换时必须从 tensors 分区移除同名残留。audio/latent 内容继续按既有策略累积。
  - 验收：覆盖整数/标量/向量/metadata tensor、表示切换、缺键保留、self-merge、长 DELTA/CUMULATIVE 流与 abort 刷新；断言快照始终非 list 且 `payload[key] is payload.to_dict()[key]`。^[PR #7448]
- [EXEC-7d] 张量累积策略必须按 (modality, key) 解析，codec 键不得套用波形默认
  - 触发：修改 `get_accumulation_strategy`、`MultimodalPayload.consolidate_tensors`、`_consolidate_tensor_list`，或 AUDIO 模态下非波形键（如 `codes.audio`/`codes.ref`）的巩固。
  - 强制：`consolidate_tensors` 接收 modality，并对每个 key 调用 `get_accumulation_strategy(modality, key)`。流水线通过 `register_key_accumulation_strategy` 注册覆盖；Qwen3-TTS 必须将 `codes.audio`→`CONCAT_DIM0`、`codes.ref`→`REPLACE`。`CONCAT_LAST` 失败仍可 flatten 后拼接；其他策略失败必须带 key 名 raise，不得静默 keep-last。
  - 验收：合成张量证明 `codes.audio` 沿 dim0 拼满、`codes.ref` 只保留一份，以及错误策略 raise；真实波形键仍走 `CONCAT_LAST`。^[PR #7608]
- [EXEC-7e] routed-expert 回归必须验证受支持的 native V2 auxiliary output
  - 触发：升级vLLM native auxiliary output或修改GPU routed-expert tests。
  - 强制：GPU auxiliary output的consumer是V2 runner `aux_output_connector_output`；测试经真实 native copy/process边界，保留decode/prefill rows、token_start和sampling mask，分别验证不同 sampled/rejected token counts都传入copy。legacy GPU辅助输出继续由既有配置gate拒绝。
  - 验收：compact width1/2的native V2结果保持row/offset/mask并出现两项不同count arrays；legacy config仍拒绝。test-only修复不改变production支持范围；旧vLLM0.30环境静态验证不证明 vLLM0.31 runtime，需单独的exact-head目标lane结果。^[PR #8500]

## 决策与踩坑

- [EXEC-OUTPUT-1a] 禁止：把 token_ids 当 text alias；lower/strip 吞掉错误配置；因为 generic hidden 被改名就当其 tensor values 已转成离散 IDs；改变已有 latent 表示或丢弃非流式中间全量上下文。
- [EXEC-7a] 禁止：重新引入 `request_output` 嵌套字段、动态 pass-through property、修改 dataclass 生成的 `__init__` 或递归 `unwrap` 兼容层；不得在 serving、example 或工具代码中恢复 `output.request_output` 访问。
- [EXEC-7b] 禁止：只声明新字段而遗漏复制列表，或用手写的静态字段清单代替真实 `RequestOutput` 属性 parity 检查，导致 serving 所需的 connector metadata 或 cache accounting 静默丢失。
- [EXEC-7c] 禁止：把 sample-rate 追加成 list 直到 consolidate；让非终态 DELTA 输出保留增长的标量历史；在两边分区同时留下陈旧值。
- [EXEC-7d] 禁止：整 payload 共用单一 modality 默认；把 codec-frame 矩阵当 `CONCAT_LAST` 波形；把非 `audio` 键的 concat 失败吞成 keep-last。
- [EXEC-7e] 禁止：mock已删除的legacy `_omni_extract_routed_experts`，为保住旧测试恢复dead API；或只检查sampled count，使相同/全零rejected count隐藏遗漏。
