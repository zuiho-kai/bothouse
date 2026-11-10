---
name: rules-component-lifecycle
description: Diffusion component lifecycle 规则 DIFF-2ac、2f、2g、2h、2i、2j、2r、2w、12a、2ad、2ag：Cache-DiT adapter 的 _is_cached marker 与 refresh 步数链、多 DiT `_dit_modules` 遍历与 dotted path identity、request-scoped Cache-DiT ownership、batch compatibility key、LTX recipe supports_cache_dit、SupportsModelCpuOffload、loader-to-offloader startup handoff、`_vae_modules` discovery
metadata:
  scope: 只收共享 diffusion owner 的 multi-DiT component discovery、Cache-DiT 生命周期、model-level CPU offload 与 startup handoff 规则；checkpoint remap、DLO 与 HWR 加载合同归 rules-checkpoint-loading-1、rules-checkpoint-loading-2，LoRA manager 规则归 rules-lora-2
---
# Diffusion component lifecycle 规则

## 关键事实

- 源页：`knowledge/repos/vllm-omni/components/diffusion/rules-component-lifecycle.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, components, diffusion；created: 2026-09-02；updated: 2026-10-06
- 来源（sources）：PR #5720；PR #5853；PR #5882；PR #5884；PR #6486；PR #6591；vllm_omni/diffusion/cache/base.py；vllm_omni/diffusion/cache/cachedit/backend.py；vllm_omni/diffusion/cache/cachedit/runtime.py；vllm_omni/diffusion/lora/manager.py；vllm_omni/diffusion/models/interface.py
  - vllm_omni/diffusion/offloader/module_collector.py；vllm_omni/diffusion/offloader/startup.py；vllm_omni/diffusion/registry.py；vllm_omni/diffusion/sched/interface.py；vllm_omni/diffusion/worker/diffusion_model_runner.py；tests/diffusion/cache/test_cache_backends.py
  - tests/diffusion/cache/test_cache_dit_request_runtime.py；tests/diffusion/models/sana_video/test_cache_offload.py；tests/diffusion/test_diffusion_model_runner.py；tests/diffusion/test_diffusion_scheduler.py；PR #6070；vllm_omni/diffusion/models/ltx2/ltx2_recipes.py；PR #6072；PR #7078
  - PR #7047；PR #8453
- 置信度（confidence）：high
- 本页承载共享 diffusion owner 的 multi-DiT component discovery 合同；模型专有 component 名和 residency 留在模型 owner。规则入口与其他共享机制仍见 [[diffusion-rules-1]]、[[diffusion-rules-2]]、[[diffusion-rules-3]]（Diffusion 共享规则）。
- [DIFF-2ac] bare-transformer Cache-DiT adapter 与 request refresh 不得携带旧 engine 状态
  - 触发：Cache-DiT `BlockAdapter` construction/enable、serial worker 中第二个 engine，或 runner cache refresh step resolution 变更。
  - 强制：bare-transformer adapter 每次 enable 前清除其 wrapper pipe class 的陈旧 `_is_cached` marker，再安装新的 cache context；该 marker 是 adapter wrapper class 的 process-wide 副作用，不是可跨 engine 复用的 installation state。
    - 每 request refresh 以显式 `num_inference_steps`、`len(timesteps)`、`len(sigmas)`、pipeline `default_num_inference_steps` 的顺序求步数；显式数值优先于 custom schedule 是当前合并源码的有意语义。
  - 验收：SANA CPU regression `test_second_engine_enables_cache_dit_after_undisabled_first` 覆盖 serial second-engine red→green；runner CPU test 覆盖 explicit/timesteps/sigmas/default 四段 refresh chain。现有证据不证明所有 declarative adapter 或跨进程 lifecycle 的同等行为。^[PR #5882]
- [DIFF-2f] 多 DiT pipeline 的 component list 是所有共享 lifecycle 的唯一集合
  - 触发：pipeline 增加第二个 DiT、task-dependent transformer，或修改 `_dit_modules`。
  - 强制：registry SP injection、loader strictness、Cache-DiT enable/refresh/summary、regional compile、LoRA、offloader/module collection 都遍历运行时实际存在的 `_dit_modules`；允许实例按 task 收窄 list，不得由 class 默认预建不存在的组件。模型规则只补 task/权重选择与 residency。
  - 验收：用非 canonical 第二属性覆盖每个 consumer 的 enable/refresh/summary/discovery，并覆盖 task 收窄后的缺省属性；至少一个真实双 DiT pipeline 逐 route 验证。^[PR #5720]
- [DIFF-2g] dotted component path 必须跨 consumer 解析为稳定且唯一的 module identity
  - 触发：`_dit_modules` 增加含点 path、alias，或 consumer 新增 discovery/getter/mutation。
  - 强制：把名称视为逐段 attribute path；中间 attribute 缺失或最终值为 `None` 才算未实例化。discovery、enable、refresh、compile、SP、LoRA 与 offload 必须解析到同一 object；结果按 identity 去重或明确禁止 alias，lifecycle 内不得悄悄替换已解析 target。
  - 验收：flat、dotted、missing-middle、`None`、非字符串、重复 alias 与 enable 后 identity replacement 分别覆盖所有 consumer。当前 mock 只覆盖 Cache-DiT dotted enable/refresh/summary，没有真实 cross-consumer identity 或异常覆盖。^[PR #5884]
- [DIFF-2h] Cache-DiT summary 只汇报 active cached target
  - 触发：修改 Cache-DiT summary、custom enabler、`BlockAdapter.is_cached` 或声明包含 uncached DiT。
  - 强制：discovery 与 summary 使用同一 path 解析，但调用 `cache_dit.summary` 前按真实 active cache context 过滤；必须定义全部 discovered target 都 uncached 时的可观察结果。Cosmos3 等 pipeline 可声明只执行一次而刻意不缓存的 nested DiT，声明存在不等于 cache 已启用。
  - 验收：混合 cached/uncached、all-uncached、无 declared target 和 repeated summary 分别断言调用与日志。当前 mock 覆盖混合列表只汇报 cached outer target；没有真实 exception 或 teardown 证据。request-scoped runtime 已增加 disable，但 summary 测试没有覆盖 disable 后状态。^[PR #5884]
- [DIFF-2i] request-scoped Cache-DiT 状态迁移必须保持唯一、可恢复的 ownership
  - 触发：pipeline 接管 runner 启动的 Cache-DiT，或 request 字段选择 cache profile/reference path。
  - 强制：只有实现 opt-in protocol 的 pipeline 才接管已 enabled backend；runner 转移 ownership 后清空自己的引用。每个 request 在 denoise 紧邻边界解析 desired spec：同 installation key 只 refresh，key 改变先 disable 旧 hooks 再 enable/refresh 新 profile，`None` disable 且 repeated `None` no-op；
    - disable/enable 失败时必须保留尚未清理的 target 或 rollback 已安装 hooks，使下一次 transition 能恢复。
  - 验收：覆盖 startup adoption、omit→lossless→accelerated→omit、无 startup 的 accelerated→lossless、same-key repeated refresh、different-key reinstall、partial multi-target enable、每个位置的 disable exception、取消与 worker shutdown，并断言 policy prepare 严格先于 denoise。当前实现的正常迁移有 fake backend 覆盖；
    - 但 enable 可留下未被 runtime 接管的部分 hooks，disable 在首个 exception 后仍在 `finally` 丢弃全部 target/state，因此不能称为 failure-atomic，也没有真实 hook 的并发、rollback、取消或 shutdown 证据。^[PR #5853]
- [DIFF-2j] process-wide request policy 必须参与 batch compatibility identity
  - 触发：request 字段或模型 policy 会切换 worker-wide hook、adapter、compile/cache profile。
  - 强制：所有会改变同批执行状态的 intent 必须进入 request-mode 与 step-mode compatibility key；保留 omitted 与 explicit value 的原始区别，只有 exact key 相同的 request 才能 co-batch。若模型把其他 request-local 字段纳入 installation key，则这些字段也必须进入 batch key，或由可执行检查保证该模型始终一次只处理一个 request。
  - 验收：两套 scheduler 都覆盖 same intent co-batch、accelerated/reference 分离、omitted/explicit 分离；每个新 policy input 用 mixed batch 证明 key 完整，或测试 single-request guard。^[PR #5853]
- [DIFF-2r] LTX Cache-DiT 支持必须由 recipe 显式限定
  - 触发：LTX 修改 Cache-DiT adapter、CFG guidance batching 或 phase recipe 的能力声明。
  - 强制：Cache-DiT 能力由 recipe 的 `supports_cache_dit` 显式声明；LTX guidance 将所有 guidance pass 融合进 batch 并每个 denoise step 只调用一次 Transformer，因此 `has_separate_cfg=False`；当前只有明确声明的 LTX-2/2.3 one-stage 与 positive-only recipe 可启用，LTX-2.5 和多阶段 recipe 必须在组件初始化前拒绝。
  - 验收：参数化检查每个 LTX recipe 与 adapter flag，覆盖启用、禁用和 component-init 前 rejection，并验证 fused guidance 每个 denoise step 只推进一次；无真实硬件 Cache-DiT accuracy 证据时不得扩大支持范围。^[PR #6070]
- [DIFF-2w] 模型级 CPU offload 的 direct component lifecycle 必须由显式 protocol 管理
  - 触发：共享 diffusion pipeline 需要在 `forward` 之外直接调用 VAE 或其他 stage，或修改 model-level CPU offload 的启停与 component discovery。
  - 强制：通过显式 `SupportsModelCpuOffload` protocol 委托完整生命周期；custom pipeline 使用 `ModuleDiscovery` 取得实际 DiT、encoder 和 VAE 集合，安装统一 sequential hooks，并可用 `offload_initial_dits=True` 先将 DiT 放回 CPU。
    - 所有非 `forward` 的直接 component call 必须由 `sequential_offload_component` 调用 hook 的 `pre_forward`，成功或异常后都执行 `_to_cpu`；禁用时移除全部已注册 module 的 hooks。
  - 验收：CPU/mock 覆盖 protocol pipeline 与普通 pipeline、真实 discovery 的 DiT/stage 列表、初始 DiT CPU residency、direct component activation failure 的 finally cleanup，以及 enable/disable 后所有 hook 清理；真实 accelerator 的性能与完整模型显存结论仍需独立验证。^[PR #6072]
- [DIFF-12a] loader-to-offloader startup handoff 必须单次消费并事务性回收
  - 触发：loader 产生 backend-owned state、runner/offloader startup boundary，或 backend enable/initial-prefetch failure cleanup。
  - 强制：loader 把 process-local startup state 附在 loaded pipeline 上，runner 只调用 generic enable boundary；该 boundary 必须 take-and-remove state exactly once。backend enable 从 hook/staging/lease acquisition 到 initial prefetch 失败时先 quiesce and disable，再关闭仍属 loader 的 state；
    - 已提交 final-layout restore 在 preferred mode 只能以 fresh canonical model retry，required mode 必须传播失败。worker shutdown 必须在 destroy distributed state 前关闭 offloader；layerwise shutdown 与可再次 enable 的 disable 分开：前者清 hook/state 时不恢复整份 DiT 到 GPU，后者仍为后续 reuse 恢复 weights。
    - registered HWR mmap teardown 先 drain/release source references、unregister all ranges，再 close lease。若 unregister 失败，保留 registration 与 open lease（跨 fresh retry/backend GC 亦然）供 retry 或 process exit，不能让 finalizer unmap CUDA 仍持有的页面。
  - 验收：覆盖 absent/taken startup state、backend construction/enable/prefetch failure、single fresh retry 与 required no-retry；断言 partial backend disable、carrier/lease close、fresh path bypasses HWR and checkpoint mmap；
    - 另注入 unregistration failure，断言 retryable retention、backend drop 和 distributed teardown ordering；layerwise shutdown 不调用 restore-next-block 且清全部 hooks，不把 mock cleanup 成功外推为每个模型退出都满足 executor grace。^[PR #6486] ^[PR #6591] ^[PR #8453]
- [DIFF-2ad] batch-first sampling gate 的 provided 标志必须进入 RequestBatchSamplingParamsKey
  - 触发：修改 `RequestBatchSamplingParamsKey`、`_build_sampling_params_key`，或 pipeline 从 batch 首请求读取 `*_provided` 再决定 guidance/image-guidance 行为。
  - 强制：凡 pipeline 用 “omitted vs explicit” provided 标志做 batch-local gate 的字段，都必须进入 request-mode 与 step-mode 的 sampling-params key；数值相等但 provided 不同的请求不得合批。当前合同要求 `guidance_scale_2_provided` 与数值 `guidance_scale_2` 一并参与 key。
  - 验收：用真实 key builder 覆盖 omitted `guidance_scale_2` 与显式同值、数值不同，以及两套 scheduler 的 key 分离；并断言 pipeline 首请求 gate 不会跨不同 provided 语义共享 batch。^[PR #7078]
- [DIFF-2ag] pipeline 自管 staging 的组件不得进入 always-resident discovery 列表
  - 触发：修改 `_vae_modules` / `ModuleDiscovery`、layerwise/HSDP/model-level offload 的 component 选择，或 pipeline 自己在 encode/decode 边界调用 `load_to_device`/`offload_to_cpu`。
  - 强制：`SupportsComponentDiscovery` 的 `_vae_modules` 语义是“VAE(s) always on GPU”。凡由 pipeline 自行互斥 staging、且不能交给 offloader/loader 搬迁的 VAE，必须从 discovery 列表省略（声明为空），使 layerwise/HSDP/model-level 路径都看不到它们；需要保留的 `pipeline.vae` 别名只服务 registry/patch，不算 discovery 声明。
  - 强制：因此退出 discovery 的组件，model-level CPU offload 入口不得再从 discovery 推导 stage 集，必须显式列出仍由 model-level 管理的 encoder/VAE 等；on-demand offload plan 同步丢掉已省略组件。
  - 验收：discovery/offload plan 断言 pipeline-staged VAE 不出现；其余仍声明 VAE 的 pipeline 合同不变；model-level 显式 stage 列表仍覆盖应有组件。^[PR #7047]

## 决策与踩坑

- [DIFF-2ac] 禁止：因前一个 engine 未 disable 而跳过第二个 bare-transformer adapter 的 context installation；不得让 class marker 或 cache refresh 在 process/request 间 carry over，也不得把 schedule-first 的旧 review 建议当成已合并行为。
- [DIFF-2f] 禁止：硬编码 `transformer`/`transformer_2` 或把非 canonical attribute 静默漏掉；不能用第一个 DiT 成功推断第二个已启用 cache/compile/offload。
- [DIFF-2g] 禁止：把含点字符串传给单层 `getattr`/`hasattr`；依赖 conventional direct alias 代替 canonical declaration；同一 object 因重复 path 被 enable 两次。目标 pin 只有 Cache-DiT 与 offloader 使用 `attrgetter`，generic compile、registry SP 与 LoRA 仍未统一，因此不能宣称 cross-consumer parity。
- [DIFF-2h] 禁止：对所有 declared DiT 无条件 summary；依赖 “no transformer” warning 判断 active cache。当前实现对 all-uncached 情况静默无 summary、也无 warning，调用方必须接受或另加显式信号。
- [DIFF-2i] 禁止：runner 与 pipeline 同时拥有同一 backend；按 config object equality 代替 stable installation key；enable 前覆盖既有 target list；第一个 disable exception 后忘记其余 target；在 cleanup 未完成时仅清 runtime key/reference 并宣称 disabled。非 opt-in 模型继续使用 runner-owned lifecycle，其他 cache backend 不变。
- [DIFF-2j] 禁止：在 batch 内按第一条 request 的 policy 切换 process-wide hooks；把 `None` 正规化成某个显式值；只更新 request scheduler 而漏掉 step scheduler。目标 pin 的 `quality` 已进入两套 key；H3 的 refresh hint 没进入 key，但 H3 `forward` 明确拒绝 `len(prompts) != 1`，不得把该例外推广到 batched adopter。
- [DIFF-2r] 禁止：从 one-stage/multi-stage 名称推断 Cache-DiT 支持；沿用 separate-CFG step counter；把 LTX-2.5 distilled/full 或两阶段 schedule 当成已 qualified 的 Cache-DiT 路径。
- [DIFF-2w] 禁止：以可调用属性探测替代 protocol、只依赖 generic forward hook 管理 direct VAE call、在没有 activation/release scope 时直接调用 hooked component，或在启停失败后遗留部分 hooks 与设备状态。
- [DIFF-12a] 禁止：让 runner 解释 HWR policy 或重复 transfer plan；复用 commit 后的 disposable model；在 async work、partial hooks 或 staging 仍存活时释放 lease，或让 retry 再次 lookup/publish/mmap。
- [DIFF-2ad] 禁止：只比较 auto-fill 后的数值；假设同数值即同语义；只更新 request scheduler 而漏掉 step scheduler；把 H3 等 single-request guard 当作可合批模型的例外模板。
- [DIFF-2ag] 禁止：一边在 pipeline 里互斥 staging，一边把同一 VAE 放进 `_vae_modules` 让 offloader/loader 再拉回 device；或用后端特殊分支掩盖 discovery 合同冲突。
