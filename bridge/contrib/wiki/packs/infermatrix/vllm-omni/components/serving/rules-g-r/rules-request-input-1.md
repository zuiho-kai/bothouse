---
name: rules-request-input-1
description: "请求输入合同第 1 部分：SERV-4a–4h 公开字段 owner、多来源输入验证前不合并、入口到 consumer 闭环、跨 dispatcher 同一错误合同、弃用警告、slice 限定 consumer view、来源矩阵与架构重置；SERV-4l request-level LoRA 贯穿 stage-0 提交（PR #5374）；SERV-4m API server 用 FlexibleArgumentParser 并同步 positional model（PR #3805）"
metadata:
  scope: 只收 SERV-4a–4h、SERV-4l、SERV-4m；SERV-4n–4s、SERV-4r2–4r5 与 SERV-4i2 归 rules-request-input-2，SERV-4i–4k batch chat 归 rules-batch-chat，engine 生命周期归 rules-engine-lifecycle-1、rules-engine-lifecycle-2，规则组总表归 serving-rules-1
---
# 请求输入合同（1/2）

## 关键事实

- 拆分说明：本页是源页 `rules-request-input.md` 的第 1/2 部分；第 2 部分 [[rules-request-input-2]]
- 源页：`knowledge/repos/vllm-omni/components/serving/rules-request-input.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, components, serving；created: 2026-09-04；updated: 2026-09-22
- 来源（sources）：PR #3805；PR #5374；PR #5885；PR #6598；vllm_omni/data_entry_keys.py；vllm_omni/engine/async_omni_engine.py；vllm_omni/entrypoints/openai/；vllm_omni/entrypoints/omni_base.py；vllm_omni/engine/orchestrator.py；vllm_omni/inputs/；tests/engine/test_async_omni_engine_input.py
  - tests/engine/test_orchestrator_error_handling.py；tests/entrypoints/test_omni_entrypoints.py；tests/entrypoints/openai_api/test_invalid_audio_speech.py；tests/entrypoints/openai_api/test_serving_speech.py；PR #5181；PR #6182；PR #6963；PR #4741；PR #4167；PR #7447；PR #7459；PR #7463；PR #5691
- 置信度（confidence）：high
- `SERV-4a`–`SERV-4q`：公开请求字段的校验、限界与 owner。触发条件与其余审查组见 [[serving-rules-1]]、[[serving-rules-2]]、[[serving-rules-3]]（Serving 共享规则） 的 Direct 代码快速入口。
- [SERV-4a] 公开字段由 serving 显式拥有
  - 触发：修改请求 allowlist、冲突字段集或兼容输入。
  - 强制：逐项绑定真实 consumer，公开字段由 serving 边界显式声明。
  - 验收：加入一个内部同名字段反例，证明它不会被误算成公开 root 字段。
- [SERV-4b] 多来源输入验证前不得合并
  - 触发：请求同时支持 flattened、raw nested、声明字段、alias 或 canonical container。
  - 强制：保留来源直到冲突检查结束；验证通过后若用字典展开构造并集，必须注明各映射已经不相交。
  - 验收：重复字段返回明确 4xx，不重叠字段全部到达最终 consumer。
- [SERV-4c] 入口接受必须闭环到每个生产消费者
  - 触发：新增请求字段或改变字段分流。
  - 强制：对每条 dispatcher 追踪字段到 engine、pipeline、prompt 或 sampling 参数。
  - 验收：真实请求对象同时覆盖默认值和非默认值，并断言最终 consumer。
- [SERV-4d] 同一请求合同错误跨 dispatcher 保持同一响应合同
  - 触发：同一非法输入可进入 diffusion-only、multi-stage 或其他多个 dispatcher。
  - 强制：使用一致的 status、错误类型和消息策略，并在公共边界转换一次。
  - 验收：同一冲突输入经过每条受影响 dispatcher 时响应等价，且都在 engine/pipeline 调用前失败。
- [SERV-4e] 请求期弃用信号必须对 operator 可见
  - 触发：serving 路径继续接收 deprecated 输入。
  - 强制：使用项目 logger 的 `warning_once` 或明确限频策略。
  - 验收：合法旧输入恰好记录一次警告；因冲突返回 4xx 的输入不记录兼容警告；用户响应合同与日志合同分别断言。
- [SERV-4f] Serving 只编译当前 slice 拥有的请求语义
  - 触发：同一 serving 字段存在 flattened、nested、canonical 或 legacy 来源。
  - 强制：在 request mutation、preprocess 和 dispatcher 分支之前完成一次来源校验，并产出当前 slice 限定字段的 consumer view。
  - 验收：root control + nested extras 分别经过 pure/mixed dispatcher 到达 prompt、AR metadata 与 diffusion sampling consumer；registry 字段与 service control 重名时仍只有一个 owner。
- [SERV-4g] 多来源合同编码前必须完成来源矩阵
  - 触发：一个语义存在多个来源、dispatcher 或 stage scope。
  - 强制：按 source-consumer decision matrix（源链接 `../../../../general/review/guides/review-execution-contract.md#source-consumer-decision-matrix`） 标明路由、重复拒绝、不适用和 defaults；兼容写法默认进入同一 consumer scope，只有矩阵声明不同语义时才能分流。规范化结果拆成多个 consumer view 时默认互不重叠，同一字段确需进入多个 view 时逐一命名最终 consumer。
  - 验收：每个来源组合都有明确 decision 和生产路径证据；每个 consumer view 的重叠项都有显式最终 consumer，不存在接受后丢弃或末端重新读取 raw request。
- [SERV-4h] 请求合同膨胀时停止逐评论修补
  - 触发：生产 diff 超过预算上限 1.5 倍、出现第二个重叠语义 owner，或下一审查波次再次发现同一 owner 漏洞。
  - 强制：执行 架构重置验收（源链接 `../../../../general/review/guides/code-taste.md#架构重置怎样验收`），重新确认唯一最终产物、删除清单和规模上限。
  - 验收：恢复编码前 owner、consumer、删除项和 diff 预算都有可检查记录。
- [SERV-4l] request-level LoRA 必须贯穿每种 stage-0 submission 形态
  - 触发：修改 chat adapter 解析、`AsyncOmni.generate`、ordinary/streaming request submission、stage-0 input processing 或 LoRA request 类型。
  - 强制：OpenAI chat `_maybe_get_adapters()` 得到的同一个 request-level `LoRARequest` 必须传入 `AsyncOmni.generate`，再贯穿普通 `add_request_async`、streaming 首 chunk、每个 `add_streaming_update_async` 与无 chunk/final marker，
    - 最终由 `AsyncOmniEngine._build_add_request_message` 传给**非 diffusion stage 0** 的 vLLM input processor。`None` 同样原样传播，不能复用上一请求 adapter。
  - 验收：用 identity sentinel 分别覆盖普通 prompt、streaming 有 chunk、streaming 空输入/final marker 与 `None`；单 stage sampling 参数包成长度 1，多 stage 参数长度必须等于 stage 数。断言 stage-0 input processor 收到同一对象，并另外验证 downstream stage 的 LoRA 仍由对应 `sampling_params_list[i].lora_request` 拥有，默认参数对象不被污染。
    - GPU 验收必须先确认 adapter ID 已加载，再证明 deterministic token/logprob 与 base 不同；#5369 另报的 `AsyncOmni.add_lora` control-RPC 反序列化成 list 问题不在本修复范围。^[PR #5374]
- [SERV-4m] API server 必须规范化 CLI 参数并同步 positional model
  - 触发：修改 `vllm_omni.entrypoints.openai.api_server` 的 CLI parser、模型参数来源或直接运行入口。
  - 强制：直接运行 API server 时复用 upstream `FlexibleArgumentParser`，使下划线参数与连字符参数保持一致的规范化行为；解析后若 `args.model_tag` 非空，必须将 `args.model` 同步为该值，以确保 positional model 不会退回 vLLM `ModelConfig` 的默认模型。
  - 验收：分别验证 positional model、`--model`、`--gpu_memory_utilization` 等下划线参数和连字符参数均可解析，并断言 `args.model` 与 `args.model_tag` 一致且服务加载请求模型，不会回退到默认 LLM。^[PR #3805]
- engine 生命周期见 [[rules-engine-lifecycle-1]]、[[rules-engine-lifecycle-2]]（engine 生命周期规则）；故障隔离见 [[rules-fault-isolation]]（fault isolation 规则）。

## 决策与踩坑

- [SERV-4a] 禁止：从包含 tensor、KV 状态或运行时中间量的内部结构反射生成公开字段。
- [SERV-4b] 禁止：用 `or`、字典展开或 `update()` 决定重复值，制造未声明优先级。
- [SERV-4c] 禁止：用 helper 返回值或 HTTP 成功代替传播证明。
- [SERV-4d] 禁止：一路本地映射为 4xx，另一路交给远处通用 `ValueError` 捕获。
- [SERV-4e] 禁止：使用仅写 stderr 且按调用点过滤的 `warnings.warn`。
- [SERV-4f] 禁止：dispatcher 重读 raw request 或重新决定优先级；为了 request-extra normalization 把 topology、模型能力、逐 stage 参数或其他 owner 吸进完整 compiler。
- [SERV-4g] 禁止：矩阵缺失时声称实现或审查完成；由字段集合运算、输入写法或 dispatcher 末端 defaults 隐式决定 scope。
- [SERV-4h] 禁止：继续堆 helper、compatibility branch 或 reviewer-specific patch。
- [SERV-4l] 禁止：只修非流式提交；把单个 request-level LoRA 广播成每 stage adapter；绕过既有 `resolve_sampling_params_list` 的 stage cardinality 校验；以 adapter 已加载证明 request 已选择它。该参数在 target 的 engine APIs 仍标作 `Any`，不是类型安全合同；评审明确要求收窄类型，后续应统一为 `LoRARequest | None` 而非继续扩散 `Any`。
- [SERV-4m] 禁止：使用不支持 upstream flag normalization 的独立 argparse parser；仅在 `args.model` 缺失时反向填充 `model_tag`，导致 positional model 仍未传入实际 model consumer；把 `--omni` 的兼容占位参数解释为改变直接入口运行模式的开关。
