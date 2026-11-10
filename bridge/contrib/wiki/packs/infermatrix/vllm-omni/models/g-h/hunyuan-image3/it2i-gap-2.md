---
name: it2i-gap-2
description: "HunyuanImage-3.0-Instruct IT2I Gap 风险报告（2026-04-20）后半：方案 A（照 GLM-Image / BAGEL 在 DiT 侧加 image 处理，约 195-215 行、1.5-3 人天）、方案 B（等 PR #2949，约 80 行）、方案 C（放弃）的改动清单与风险评估，推荐对比表、待决策选项、关键文件路径与 PR #2949 信息"
metadata:
  scope: 只收 IT2I gap 报告的修复方案与工作量、推荐与决策请求、附录 A / B（源页四至六节及附录）；问题定位与代码缺口证据归 it2i-gap-1
---
# HunyuanImage3 IT2I gap 调查（2/2）

## 关键事实

- 拆分说明：本页是源页 `it2i-gap.md` 的第 2/2 部分；第 1 部分 [[it2i-gap-1]]
- 源页：`knowledge/repos/vllm-omni/models/hunyuan-image3/it2i-gap.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: vllm-omni, models, hunyuan-image3；created: 2026-07-10；updated: 2026-07-16

### 四、修复方案 & 工作量

#### 方案 A（推荐）：照 GLM-Image / BAGEL 先例在 DiT 侧加 image 处理

- **思路**：和 GLM-Image 一致，DiT 自己调 VAE/ViT 编码 PIL。工作重点是把官方 `hunyuan3.0_ins/image_processor.py` 的相关函数移植到 vLLM-Omni。
- **改动清单**：
  - （以下为原表格，按行改写为条目）
  - 文件：`vllm_omni/diffusion/models/hunyuan_image3/hunyuan_image3_transformer.py::HunyuanImage3ImageProcessor`
    - 新增代码量：~175-195 行
    - 内容：加 5 个方法 + 辅助类（从官方 `hunyuan3.0_ins/image_processor.py` 复制）：<br>• `as_image_tensor` ~60 行<br>• `vae_process_image` ~5 行<br>• `vit_process_image` ~15 行<br>• `get_image_with_size` ~35 行<br>• `build_cond_images` ~30 行<br>• `ImageTensor` / `CondImage` / `JointImage` 辅助类 ~30-50 行
  - 文件：`pipeline_hunyuan_image3.py::prepare_model_inputs` else 分支
    - 新增代码量：~15 行
    - 内容：加 `batch_image_list = self._validate_and_batchify_image(...)` → `build_cond_images` → 填 `batch_cond_image_info`（照抄官方 `modeling_hunyuan_image_3.py:2668-2676`）
  - 文件：`pipeline_hunyuan_image3.py::forward` 第 1003 行
    - 新增代码量：~5 行
    - 内容：从 `req.prompts[i].get("pil_image")` 或 `multi_modal_data.image` 读 PIL，加到 `prepare_model_inputs(image=...)` 传递
  - 文件：签名
    - 新增代码量：~1 行
    - 内容：`prepare_model_inputs(..., image=None, ...)` 加参数
- **总计**：~195-215 行。**全部从官方源码复制**，非创新设计。
- **需要验证的 3 层（无法跳过）**：
  1. **本地 import smoke**：改完后 `prepare_model_inputs(prompt="x", image=PIL.new("RGB", (512,512)))` 返回非空结构不报错
  2. **远端端到端 smoke**：起 server，HTTP `/v1/images/edits` 打一张图 + prompt，confirm 出图不崩
  3. **视觉合理性 smoke**：出的图像大致是图，不是噪声花屏（不要求和官方 pipeline 一致）
- **风险评估**：

| 风险项 | 等级 | 说明 |
|---|---|---|
| 逻辑风险（抄错/对齐错） | **低** | 官方代码开源可参照，GLM-Image 先例可比对 |
| 运行时 bug（tensor shape / dtype） | **中** | VAE/ViT tensor 的 shape / dtype 要和 chat template 的 token 数对齐 |
| 数值精度 | **低** | VAE 权重同一份，encode 实现从官方移植 |
| TP/并行分片 | **中** | GLM-Image 验证过 DiT TP worker 里跑 VAE，HunyuanImage3 同理但要实测 |
| chat template 拼接 | **中-高** | 作者留 TODO 的地方就是这里。`apply_chat_template` 的 `batch_cond_image_info` 路径代码上存在，但 prompt 分支下的 cond image sections 插入位置可能有隐藏 bug |

- **预计时间**：**1.5-3 人天**
  - 代码移植：0.5-1 天
  - 本地 smoke + 远端调试：1-2 天（bf16 MoE 80B 模型远端调试迭代慢，预计 1-3 轮）

#### 方案 B：等同事 PR #2949 合并，在其基础上扩展加 image 通道

- **前提**：
  - 等 PR #2949 合并（时间不可控）
  - AR 侧要先实现 `OmniOutput(multimodal_outputs=...)`（HunyuanImage3 AR 目前没实现）
- **改动清单**：

| 文件 | 新增代码量 |
|---|---|
| `hunyuan_image3.py` AR 侧加 mm_output 输出 | ~30 行 |
| `stage_input_processors/hunyuan_image3.py` 桥接加 mm payload | ~20 行 |
| `pipeline_hunyuan_image3.py::_forward_with_kv_reuse` 读 image tensor | ~30 行 |

- **总计**：~80 行。
- **劣势**：
  - 时间不可控（依赖 PR 合并）
  - 协调成本高（AR 输出格式要和 DiT 接口对齐，跨开发者）
  - 复用价值低于方案 A（只修 KV reuse 路径的 IT2I，不修普通 IT2I）
- **预计时间**：PR 合并后 1-2 人天。PR 未合并前等待时间不可控。

#### 方案 C：放弃 IT2I

- 不修复 IT2I 能力
- 下游业务（图片编辑 API / gbench / 业务图编辑）自己想办法
- **预计时间**：0 人天
- **代价**：能力缺失

---

### 五、推荐 & 决策请求

| 维度 | 方案 A（推荐） | 方案 B | 方案 C |
|---|---|---|---|
| 时间可控性 | ✓ 1.5-3 人天 | ✗ 依赖他人 PR | ✓ 0 天 |
| 代码量 | ~200 行 | ~80 行 | 0 |
| 开源参考 | ✓ GLM-Image / BAGEL 先例 + 官方源码 | ✓ 部分 | — |
| 风险 | 中（3 层验证可控） | 高（协调 + 前置依赖） | 0 |
| 能力交付 | 完整 IT2I | 仅 KV reuse 路径的 IT2I | 无 |

- **推荐方案 A**：不依赖他人、有开源参考、时间可控、能力完整。3 层验证（本地 smoke → 远端 smoke → 视觉合理性）可以充分控制风险。

---

### 附录 A：关键文件路径清单

- `vllm_omni/diffusion/models/hunyuan_image3/pipeline_hunyuan_image3.py`（DiT pipeline）
- `vllm_omni/diffusion/models/hunyuan_image3/hunyuan_image3_transformer.py`（含 `HunyuanImage3ImageProcessor`）
- `vllm_omni/model_executor/models/hunyuan_image3/hunyuan_image3.py`（AR 模型）
- `vllm_omni/model_executor/stage_input_processors/hunyuan_image3.py`（AR→DiT 桥接）
- `vllm_omni/model_executor/stage_configs/hunyuan_image3_it2i.yaml`（IT2I 部署配置）
- `hunyuan3.0_ins/image_processor.py`（官方 image 处理代码，移植来源）
- `hunyuan3.0_ins/modeling_hunyuan_image_3.py`（官方 HunyuanImage3ForCausalMM）
- `vllm_omni/diffusion/models/glm_image/pipeline_glm_image.py::_prepare_condition_image_kv_cache`（参考先例）
- `vllm_omni/diffusion/models/bagel/`（参考先例）

### 附录 B：同事 PR #2949 关键信息

- URL：<https://github.com/vllm-project/vllm-omni/pull/2949>
- 标题：`[Feature] Add KV Cache Reuse between AR-DiT in Hunyuan-Image3`
- 状态：OPEN（截至 2026-04-20）
- 作用：T2I 的 AR→DiT 文字 KV 复用，不影响 IT2I 路径

## 待办

### 六、下一步决策

- 请领导在以下选项中选择：
  - [ ] **方案 A**：立即启动自主实现，预计 1.5-3 人天交付可用 IT2I
  - [ ] **方案 B**：等同事 PR #2949 合并后再做，时间不可控
  - [ ] **方案 C**：不做 IT2I，本项目 IT2I 能力缺失
- 无论选择哪个方案，**T2I 的 GenEval 精度 CI 可以并行推进**（不依赖 IT2I 决策，vLLM-Omni 生产代码 0 改动）。

---
