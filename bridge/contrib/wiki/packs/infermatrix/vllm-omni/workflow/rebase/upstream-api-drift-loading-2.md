---
name: upstream-api-drift-loading-2
description: 上游 API 漂移（权重加载/显存/运行时侧）第 3–4 节：cumem 双重释放以补丁 CuMemAllocator._python_free_callback 去掉 ROCm-only guard 为根修（含退役 skill 的历史修法），及 moss_tts_nano load_weights 取 HEAD drain-only 并把 transformers keys 包装移进 __init__ 的冲突模式
metadata:
  scope: 只收 cumem 双重释放与 moss_tts_nano load_weights 冲突两个案例及相关导航；FusedMoE 工厂函数与 FP8 meta-tensor 归 upstream-api-drift-loading-1，serving/调度/测试侧漂移归 upstream-api-drift，波次与失败路由归 rebase-workflow
---
# 上游 API 漂移模式（权重加载 / 显存 / 运行时侧）（2/2）

## 关键事实

- 拆分说明：本页是源页 `upstream-api-drift-loading.md` 的第 2/2 部分；第 1 部分 [[upstream-api-drift-loading-1]]
- 源页：`knowledge/repos/vllm-omni/rebase/upstream-api-drift-loading.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: vllm-omni, rebase；created: 2026-07-16；updated: 2026-07-16

## 决策与踩坑

### 3. cumem 双重释放：ROCm-only guard 是根因（canonical + 退役史）

- skill 元数据：`fix-cumem-cuda-double-free-gc-atexit`（**canonical**），modules=[online_serving]，status=active，run_count=5，2026-07-08 创建 / 07-11 最后使用。
- 症状：`CUDA Error: invalid argument at /workspace/csrc/cumem_allocator.cpp:235` 在引擎关停时出现（`test_llm_sleep_ack` 或任何 `enable_sleep_mode=True` 测试后）；**所有单测 PASS** 但 watchdog rc=143；错误发生在 EngineCore 子进程（StageEngineCoreProc）的 atexit 清理；此前可见 `CuMemAllocator: sleep freed`。
- 根因：`CuMemAllocator._python_free_callback`（`vllm/device_allocator/cumem.py:206`）的 `if data.is_asleep and current_platform.is_rocm():`——upstream `68afd78897` 只给 ROCm 加了安全空 handle 返回；CUDA 上回调对已 asleep 的条目返回**陈旧** handle → C 扩展对已释放内存 `cuMemRelease`。
  - 链路：worker `allocator.sleep()` → `unmap_and_release(handle)`、`is_asleep=True` → 子进程退出 atexit `_shutdown_singleton` → `release_pools()` → GC → `_python_free_callback` → CUDA 返回陈旧 handle → 报错。
- 修法：`vllm_omni/patch.py` 增 `_patch_cumem_free_callback_cuda()` 并**在模块内显式调用**——skill 原文代码（本质就是去掉 `and current_platform.is_rocm()`，两平台行为一致，因为 `sleep()` 在两平台都走 `unmap_and_release()`）：

  ```python
  def _patch_cumem_free_callback_cuda() -> None:
      from vllm.device_allocator.cumem import CuMemAllocator

      def _patched_free_callback(self, ptr: int) -> tuple:
          data = self.pointer_to_data.pop(ptr)
          if data.cpu_backup_tensor is not None:
              data.cpu_backup_tensor = None
          if data.is_asleep:
              device, size, d_mem, _ = data.handle
              return (device, size, d_mem, [])
          torch.accelerator.synchronize(data.handle[0])
          return data.handle

      CuMemAllocator._python_free_callback = _patched_free_callback

  _patch_cumem_free_callback_cuda()
  ```

- 验证（skill 原文可执行片段，期望输出 `OK: Patched correctly`）：

  ```python
  import vllm_omni.patch
  from vllm.device_allocator.cumem import CuMemAllocator
  import inspect
  src = inspect.getsource(CuMemAllocator._python_free_callback)
  assert "is_rocm" not in src, "ROCm-only guard still present"
  print("OK: Patched correctly")
  ```

- 禁止：只在引擎关停调用点把 `allocator.sleep()` 换成 `release_pools()`（退役的旧修法）——`release_pools()` 仍驱动 GC → 回调在 CUDA 返回陈旧 handle，atexit 路径照样双重释放。**回调补丁是覆盖全部路径（显式 sleep、release_pools、atexit GC）的唯一根修。** ^[SK-fix-cumem-cuda-double-free-gc-atexit]
- 退役史（保留供追溯）：skill `fix-cumem-allocator-sleep-double-free`（modules=[online_serving, worker_runner]，**status=retired**，run_count=2，2026-07-07 创建 / 07-07 最后使用；
  - retired 状态**不会向 agent 展示**，仅存档）主张在 `async_omni_engine.py`（~1536 行）换调用点——其原理陈述有误（声称 `release_pools()` 是设计好的清理路径——释放 MemPool 引用并触发 GC，回调对 asleep 条目返回空 handle『CUDA 上 0、ROCm 上 []』、由 C 扩展的 `p_memHandle != nullptr` 空指针检查跳过双重释放；实际 CUDA 上回调返回**陈旧** handle），修法不完整、已被 canonical skill 取代；
  - 其诊断细节（cpp:235 对应 `unmap_and_release()` 的 `cuMemRelease(*p_memHandle)`、`sleep()` 非幂等：首次 sleep C 侧 `free(p_memHandle)` 后 `data.handle[3]` 仍持旧指针整数值、回归测试 `test_llm_sleep_ack` + `test_duplicate_wake_is_idempotent`，验收含 stderr 无 CUDA 错误、全部测试通过且 watchdog 不杀进程）仍有效。
  - 同事件的 debug-memory #437（key=`allocator_sleep_double_free_shutdown`，module=online_serving，status=active，run_count=1）记录同一诊断链，其修法即被取代的调用点替换；
  - 其 watch-out 仍适用：排查是否还有别的代码路径对已 asleep 的 allocator 重复调 `allocator.sleep()`——upstream `cumem.py` 的 `sleep()` 理想上应幂等，但那是 upstream 代码、不能本地改。^[SK-fix-cumem-allocator-sleep-double-free] ^[DM-437]

### 4. rebase 冲突：drain-only vs 全量 from_pretrained（moss_tts_nano 模式）

- skill 元数据：`resolve-moss-tts-nano-load-weights-conflict`，modules=[model_executor]，status=active，run_count=24，2026-06-10 创建 / 07-11 最后使用。
- 触发：`modeling_moss_tts_nano.py` 的 `load_weights()` 出现 `<<<<<<< HEAD ... >>>>>>>` 冲突——HEAD 侧是 drain-only（`for _ in weights: pass`），omni 侧是带 `_transformers_keys_to_ignore_compat()` 包装的全量 `from_pretrained` 加载。
- 判定：查 `__init__` 是否已经通过 `from_pretrained` **急切加载**了模型—— 是则 `load_weights` 只需要清空迭代器。
- 修法：1) load_weights **取 HEAD**（drain-only），签名保持 `def load_weights(self, weights: Iterable[tuple[str, torch.Tensor]]) -> set[str]` ——注释注明权重在 `__init__` 已加载、`load_format=dummy` 下不会调用本函数（DummyModelLoader 原地随机化参数），`for _ in weights: pass` 后返回 `{name for name, _ in self.named_parameters()}`；
  - 2) 把 `_transformers_keys_to_ignore_compat()` 包装**移进 `__init__`**，包住两处 `from_pretrained`（`AutoModelForCausalLM` 的 LM 加载 + `AutoModel` 的 audio tokenizer 加载）；
  - 3) 核对无冲突标记、语法与 import 正常。^[SK-resolve-moss-tts-nano-load-weights-conflict]

### 相关

- serving/调度/测试侧漂移：[[upstream-api-drift]]（姊妹页）；波次与失败路由：[[rebase-workflow]]（workflow）；FusedMoE/权重案例的模型页：[[hunyuan-image3-overview]]（hunyuan-image3）。
