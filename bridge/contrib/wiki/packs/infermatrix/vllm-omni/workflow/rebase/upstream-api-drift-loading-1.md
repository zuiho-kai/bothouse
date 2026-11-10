---
name: upstream-api-drift-loading-1
description: 上游 API 漂移（权重加载/显存/运行时侧）第 1–2 节：FusedMoE 由类改工厂函数后 HunyuanImage3 adapter 须直接返回 MoERunner（KeyError routed_experts.w13_weight、ForwardContext.num_tokens hook），及 diffusion FP8 在线量化 meta-tensor 下 _process_weights_after_loading 须按 base_loader 合同分路
metadata:
  scope: 只收 FusedMoE 工厂函数与 FP8 meta-tensor 两个漂移案例；cumem 双重释放与 moss_tts_nano load_weights 冲突归 upstream-api-drift-loading-2，serving/调度/测试侧漂移归 upstream-api-drift，目录入口归 rebase-overview
---
# 上游 API 漂移模式（权重加载 / 显存 / 运行时侧）（1/2）

## 关键事实

- 拆分说明：本页是源页 `upstream-api-drift-loading.md` 的第 1/2 部分；第 2 部分 [[upstream-api-drift-loading-2]]
- 源页：`knowledge/repos/vllm-omni/rebase/upstream-api-drift-loading.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: vllm-omni, rebase；created: 2026-07-16；updated: 2026-07-16
- 来源（sources）：vllm-omni-rebase-agent@122a9468:agent/skills/fix-hunyuanimage3-moe-weight-loading-keyerror/SKILL.md；vllm-omni-rebase-agent@122a9468:agent/skills/fix-diffusion-fp8-meta-tensor-weight-loading/SKILL.md
  - vllm-omni-rebase-agent@122a9468:agent/skills/fix-cumem-cuda-double-free-gc-atexit/SKILL.md；vllm-omni-rebase-agent@122a9468:agent/skills/resolve-moss-tts-nano-load-weights-conflict/SKILL.md

## 决策与踩坑

- serving/调度/测试侧的漂移在[[upstream-api-drift]]（姊妹页）。运营 runbook 以 rebase-agent 仓库为准，本页是知识树沉淀快照（2026-07-16，agent @122a9468；skills 工作树含未提交遥测更新，快照以工作树为准）。

### 1. FusedMoE 类 → 工厂函数：adapter 必须直接返回 MoERunner

- skill 元数据：`fix-hunyuanimage3-moe-weight-loading-keyerror`，modules=[model_executor]，status=active，run_count=29，2026-06-09 创建 / 07-11 最后使用。
- 症状：HunyuanImage3 测试 `KeyError: 'layers.N.mlp.experts.routed_experts.w13_weight'`（或 `w2_weight`），位置 `HunyuanModel.load_weights`——`named_parameters()` 找不到 MoE runner 的 expert 权重。
- 根因：upstream `dc68bd8c41` 把 `FusedMoE` 从 `nn.Module` 类重构为返回 `MoERunner` 的**工厂函数**；expert 权重住在 `routed_experts` 子模块。若 adapter 把 runner 包进普通（非 `nn.Module`）对象，`named_parameters()` 看不见其参数 → `load_weights` KeyError。
  - 另：vLLM 0.18.0 起 `FusedMoE` 每次 forward 前必须设 `ForwardContext.num_tokens`——不设则 MoE 专家路由**静默错误**。
- 反模式（禁止）：`if name_mapped not in params_dict: continue`——静默跳过未映射权重 → 参数未初始化 → 静默推理错误。
- 修法（参照 `vllm_omni/diffusion/models/hunyuan_image3/hunyuan_fused_moe.py` `HunyuanFusedMoEDefault.__new__`）——skill 原文代码：

  ```python
  def __new__(cls, *, prefix: str = "", **kwargs: Any) -> Any:
      from vllm.model_executor.layers.fused_moe import FusedMoE as _FusedMoE

      moe_runner = _FusedMoE(prefix=prefix, **kwargs)

      # Hook 1: 每次 forward 前设 ForwardContext.num_tokens（vLLM 0.18.0 必需；
      # 不设则 MoE 路由静默错误）。hidden_states 兼容 kwargs 与位置参数。
      def _num_tokens_pre_hook(module: Any, args: Any, kwargs: Any) -> None:
          hidden_states = kwargs.get("hidden_states")
          if hidden_states is None and args:
              hidden_states = args[0]
          if hidden_states is not None:
              _set_forward_context_num_tokens(hidden_states.shape[0])

      moe_runner.register_forward_pre_hook(_num_tokens_pre_hook, with_kwargs=True)

      # Hook 2: 首次 forward 的一次性懒 kernel 初始化——仅当 runner 暴露未初始化
      # quant_method 时生效（镜像旧 wrapper 行为，只是绑定到 runner 模块本身）。
      init_handle: Any = None

      def _kernel_init_pre_hook(module: Any, args: Any, kwargs: Any) -> None:
          nonlocal init_handle
          quant_method = getattr(module, "quant_method", None)
          if quant_method is not None and getattr(quant_method, "moe_kernel", None) is None:
              quant_method.process_weights_after_loading(module)
          if init_handle is not None:
              init_handle.remove()

      init_handle = moe_runner.register_forward_pre_hook(_kernel_init_pre_hook, with_kwargs=True)

      return moe_runner  # 直接返回——必须是真正的 nn.Module
  ```

  - 另：`make_expert_params_mapping` 改为委托 upstream 独立函数 `fused_moe_make_expert_params_mapping`（重构中 classmethod 被移出为独立函数）。
- 验证：`python3 -c "from vllm_omni.diffusion.models.hunyuan_image3.hunyuan_fused_moe import HunyuanFusedMoE; print('OK')"`；`python3 -m pytest tests/diffusion/models/hunyuan_image3/ -x -v 2>&1 | tail -20`。
- Watch out：runner 必须从 `__new__` 直接返回——包一层就复现本 KeyError；`_set_forward_context_num_tokens` 不存在时需定义（见现实现）。^[SK-fix-hunyuanimage3-moe-weight-loading-keyerror]

### 2. FP8 在线量化 meta-tensor：加载器要按 upstream base_loader 合同分路

- skill 元数据：`fix-diffusion-fp8-meta-tensor-weight-loading`，modules=[diffusion_model_loader, quantization, worker_runner]，status=active，run_count=5，2026-07-08 创建 / 07-11 最后使用。
- 症状：diffusion FP8 测试（`test_single_stage_qwen_image_fp8`、`test_bagel_fp8_generates_image`、fp8 vae_patch_parallel serving）pytest 层报 `RuntimeError: Server processes exited with code 1 before becoming ready`；
  - 真实崩溃在 spawn 的 `DiffusionWorker` 子进程——job 日志里 `NotImplementedError: Cannot copy out of meta tensor; no data! Please use torch.nn.Module.to_empty()`，位置 `diffusers_loader.py` `_process_weights_after_loading`（~416 行）`module.to(target_device)`；
  - 父进程随后 `multiproc_executor ... reader.recv() -> EOFError` + `Orchestrator initialization failed`。**只在 rebase 到新 upstream 后出现**—— 同测试在 main 的 nightly（老 vLLM）通过（用 Buildkite API 对比：main nightly pipeline `vllm-omni` source=schedule NIGHTLY=1 vs align 的 `vllm-omni-rebase`）。
- 根因：新 upstream 在线量化 linear method 设 `uses_meta_device = True`（`vllm/model_executor/layers/quantization/online/fp8.py`），权重先分配在 `meta` 设备、经 layerwise 在线处理（`initialize_online_processing`）逐层即时物化；"掉队"层（padding/部分加载）留在 meta。
  - omni 的 `_process_weights_after_loading` 做全递归 `module.to(target_device)`——meta 张量不可 move。模型相关：Z-Image FP8 全物化（过）；Qwen-Image/BAGEL FP8 留掉队层（崩）。注意该循环遍历所有 `quant_method isinstance QuantizeMethodBase` 的模块（含 `UnquantizedLinearMethod`），但只有 meta（在线量化）参数触发崩溃。
- 修法（`diffusers_loader.py::_process_weights_after_loading`，镜像 upstream `base_loader` 合同）：
  1. 循环前，仅当 `self._has_online_quant(model)` 时调 `finalize_layerwise_processing(model, model_config=None)`（懒 import `vllm.model_executor.model_loader.reload.layerwise`；`model_config=None` 可行——只有 vLLM Attention/MLA 层用到它，DiT 没有）。helper 原文：

  ```python
  @staticmethod
  def _has_online_quant(model):
      for m in model.modules():
          if getattr(getattr(m, "quant_method", None), "uses_meta_device", False):
              return True
      return False
  ```

  2. **把 meta-safe 的逐参数搬运 gate 在在线量化上**——skill 原文代码（`has_online_quant` 在循环前算一次）：

  ```python
  for _, module in model.named_modules():
      quant_method = getattr(module, "quant_method", None)
      if quant_method is None or not isinstance(quant_method, QuantizeMethodBase):
          continue
      if has_online_quant:
          original_devices = {}
          for name, param in module.named_parameters():
              if param.device.type != "meta" and param.device != target_device:
                  original_devices[name] = param.device
                  param.data = param.data.to(target_device)
          quant_method.process_weights_after_loading(module)
          for name, param in module.named_parameters():
              if name in original_devices:
                  param.data = param.data.to(original_devices[name])
      else:
          # 原 FSDP/HSDP-aware 路径（此处不可能有 meta 参数）
          module_device = next(module.parameters(), None)
          module_device = module_device.device if module_device is not None else None
          needs_move = module_device != target_device
          if needs_move:
              module.to(target_device)
          quant_method.process_weights_after_loading(module)
          if needs_move:
              module.to(module_device)
  ```

- 验证：单元层——一个 cpu 参数 + 一个 `torch.empty(..., device="meta")` 参数的模块走逐参数循环无 `NotImplementedError`、真实参数 move+还原、对 meta 参数 `module.to()` 仍会 raise（证明旧路径就是 bug）；
  - 端到端——重跑 nightly `Quantization Test`（H100+L4）与 `Diffusion ... Qwen-Image`（fp8 vae_patch_parallel_2）变绿，**且**测试自身的图像断言（有效 PIL/SSIM）必须过——"用垃圾物化"的错修只救 crash、救不了精度断言。
- 禁止：把逐参数 `.data.to()` **无条件**用于所有 quant 模块——FSDP/HSDP 路径下参数是 sharded DTensor，跨设备 `.data` 重指存储直接 `RuntimeError: Attempted to set the storage ...`（曾回归 nightly `test_zimage[layerwise_hsdp]`）；用 `module.to_empty(device=...)` "修"——分配 **未初始化**内存，静默产出垃圾权重/图像（crash 检查过、精度挂）；
  - 把 Dockerfile.ci 的 cu130/torch-2.11.0 环境回退到 main 版本换取通过——main 跑老 vLLM（v0.24.0 tag），align 分支的目标就是新 upstream（领先 585 提交），回退环境等于放弃 rebase 目标，修复属于 loader 代码；
  - 顶层无条件 import `finalize_layerwise_processing`——老 vLLM 没有 `reload.layerwise`，须在 `_has_online_quant` guard 内懒 import。^[SK-fix-diffusion-fp8-meta-tensor-weight-loading]
