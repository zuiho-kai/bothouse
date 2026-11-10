---
name: hf-omni-alignment-method-2
description: "HunyuanImage3 HF/Omni 对齐方法后半：历史 PR #2713 / #3107「已对齐」声明不可轻信，HF 与 omni 两个独立测试脚本的验证模板和 hunyuan_image3_i2t.yaml 配置，修复前后的实证与不能修的差异，transformers 4.57.1 与 5.6.2 的版本约束实测（降级后输出 byte-identical），用过的 demo 图与 prompt"
metadata:
  scope: 只收 HF/Omni 对齐的测试覆盖提醒、验证模板、实证、transformers 版本约束和资源清单；触发条件与五步排查顺序归 hf-omni-alignment-method-1，HF 侧的环境与 patch 归 hf-baseline-runbook-1
---
# HunyuanImage3 HF/Omni 系统化对齐方法（2/2）

## 关键事实

- 拆分说明：本页是源页 `hf-omni-alignment-method.md` 的第 2/2 部分；第 1 部分 [[hf-omni-alignment-method-1]]
- 源页：`knowledge/repos/vllm-omni/models/hunyuan-image3/hf-omni-alignment-method.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: vllm-omni, models, hunyuan-image3；created: 2026-07-10；updated: 2026-07-16

### 验证模板

- 写**两个独立测试脚本**（不要混在一起，避免 kv-cache 复用）：
  - `test_*_hf.py`（用 `<OTHER_USER_ROOT>/bin/activate`，transformers==4.57.1）
    - 调 `model.prepare_model_inputs` + `model.generate(do_sample=False, temperature=0.0, decode_text=True)`
    - dump `kw["input_ids"]`
  - `test_*_omni.py`（用 `<OTHER_USER_ROOT>/bin/activate`，transformers==5.6.2）
    - 调 `omni.generate({"prompt_token_ids": ids, "multi_modal_data": {...}})`（避免 BPE 整串重新 encode）
    - 需要 `if __name__ == "__main__":` 包住 main（避免 multiprocessing bootstrap error）
- `yaml` 配置：用 `hunyuan_image3_i2t.yaml`（AR-only，requires_multimodal_data=true，`is_comprehension=true`，`final_output_type=text`），temp=0，max_tokens=2048，stop=`[127957, 128026]`。

### 实证

- 修复前 IT2I greedy：vllm-omni 输出死循环 garbage（`最终图像完整保留了image_1...`×7）
- 修复 prompt 格式后：vllm-omni 输出结构对、关键元素全覆盖
- 用 prompt_token_ids 路径后：**前 1227 token 与 HF byte-identical**（图像位置之前完全一致）
- 不能修的部分：
  - 图像内 `<timestep>` 展开差异（深耦合，不能单点改 token id）
  - BF16 数值噪声 + transformers 5.6.2（vllm-omni venv 锁死） vs 4.57.1（HF venv） 的 Siglip2 normalize 路径差异
  - sampling 时 vllm sampler ≠ transformers sampler（不同 RNG primitive、不同 logits processor 顺序、不同 BF16 fused kernel）

### HunyuanImage3 transformers 版本约束

- 官方 README 没硬性写 transformers 版本，但 [requirements.txt](https://github.com/Tencent-Hunyuan/HunyuanImage-3.0/blob/main/requirements.txt) pin 了 `transformers[accelerate,tiktoken]==4.57.1`。
- **vllm 实际允许的 transformers 范围**：`>= 4.56.0, != 5.0.*, != 5.1.*, != 5.2.*, != 5.3.*, != 5.4.*, != 5.5.0`——也就是 **4.57.1 完全在允许范围内**。`<OTHER_USER_ROOT>` 默认装的是 5.6.2 只是因为没 pin 让 pip 挑了最新版，不是硬性约束。
- → **omni venv 也可以装 transformers==4.57.1**（和 venv_hf 同版本），消除 Siglip2 list-vs-tensor 兼容差异。
- **但实测（2026-04-29）**：把 omni venv 从 5.6.2 降到 4.57.1，跑同一个 IT2I greedy 测试，输出**byte-identical**（2167 字完全相同）。说明：
  - vllm-omni 的 `process_image()` 在 transformers 5.6.2 vs 4.57.1 下产生的预处理 tensor 数值**没有可观测差异**（或者差异在 BF16 量化后被消化了）
  - omni 和 HF 之间剩下的 800+ 字输出长度差，**不来自 transformers 版本**
  - 真正的差异源是更深的两套实现差：vllm-omni model forward vs HF modeling forward（独立代码）、PagedAttention KV cache 数值、image token routing 细节
- → 装 4.57.1 可以做（消除 list-vs-tensor 兼容代码 + 跟官方版本对齐），但不要指望它修好输出对齐——本会话实测证明它一字不差。
- （更早版本的本文件先错把"omni 锁 5.x"写成硬约束，又错把"transformers 版本是数值差异源"写成假设——两次都错，已修正——勿信）

### 用过的资源

- HF 官方 demo image: `https://github.com/Tencent-Hunyuan/HunyuanImage-3.0/raw/main/assets/demo_instruct_imgs/input_0_0.png`
- HF generation_config 默认：`use_system_prompt="en_unified"`，`bot_task="think_recaption"`，`temperature=0.6` (默认采样)
- 验证用例 prompt：`"新年宠物海报，Q版圆润的可爱标题..."` (中文)，`"Describe the Eiffel Tower in detail..."` (英文 T2T)

## 决策与踩坑

### 测试覆盖陷阱（避免走老路）

- 历史 PR（#2713/#3107）的"已对齐"声明在多个组合下不成立。**不要相信 PR 描述里"已通过"的字样**，先确认它跑了哪条路径，再对照本方法论补漏。详见 `feedback_pr_test_path_audit.md`。
