---
name: legacy-error-summary
description: "HunyuanImage3 接入完整踩坑归档（2026-04-08 至 04-30，PR #2713 / #2986 / #3107 / #3243 与 GEBench CI）：A Git 与环境、B 模型接入与精度对齐、C PR review 反馈、D GEBench CI 接入、E HF baseline 误用 bot_task=auto 的 30 分钟事故"
metadata:
  scope: 只收按主题压缩的接入期踩坑完整历史；通用教训已提炼到各层 incidents，当前 baseline 跑法归 hf-alignment-pitfalls，CI 卡住时的进展快照归 ci-progress
---
# Error Book: HunyuanImage3 接入完整踩坑归档（2026-04-08 ~ 2026-04-30）

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/hunyuan-image3/history/legacy-error-summary.md`（InferMatrixCopilot@ecfb84d0）；源页无 frontmatter

## 决策与踩坑

> 这是 HunyuanImage-3.0-Instruct 接入工作（PR #2713 / #2986 / #3107 / #3243 + GEBench CI 系列）期间累积的所有踩坑，按主题压缩归档。
> 通用教训已分别提炼到 `general/`、仓库指南和各层 `incidents/`，本文件只保留完整历史记录。

### A. Git & 环境搭建（04-08）

- **Rebase 落后 269 commits**：untracked files would be overwritten → `git stash -u` + rebase + pop；上游 main 也在改 hunyuan_image3 6 个文件冲突，按归属选 ours/theirs
- **代理 / gh CLI**：`https_proxy="http://127.0.0.1:7890"` 必须带协议前缀；gh CLI 不走 http_proxy → fallback `curl --proxy` + GitHub API
- **GitHub user is blocked**：push 到 fork 成功 ≠ 能往上游提 PR

### B. 模型接入 & 精度对齐（04-09 ~ 04-10）

- **下划线命名残留**：上游 `hunyuan_image_3` vs vllm-omni `hunyuan_image3`，搬代码后 `grep -rn "hunyuan_image_3" vllm_omni/` 扫残留
- **HF 缓存不完整**：`tencent/HunyuanImage-3.0`（base）下载中断，blobs `.incomplete`；改下 Instruct 仓库（base / Instruct 是两个不同 HF repo，partial 不能互用）
- **I2T stage config 三坑**：modes 路由错 + gpu_memory_utilization 太低 + GPU 残留进程占用 → 纯 LLM stage + utilization ≥ 0.9 + 避开被占 GPU
- **缺 `__name__` 保护 → spawn 子进程崩**：`StageEngineCoreProc died during HELLO` → 加 `if __name__ == "__main__":`
- **AR sampling 空输出**：缺 `_StageTransitionLogitsProcessor` + `_ConditionalSliceVocabLogitsProcessor` → 实现自定义 `sample()` + `prefer_model_sampler = True`
- **load_tokenizer 缺 model_version**：`AttributeError: 'HunyuanImage3Config' object has no attribute 'model_version'` → 用 importlib 从模型 package 导 tokenizer 类，不传 model_version
- **prompt template 不一致**：官方 `apply_chat_template()` vs vLLM `build_prompt()` → dump 官方 input_ids 直接喂 vLLM
- **T2I AR ratio token 死循环**：`_apply_ratio_restriction` 选了 ratio 后不再触发 → `last_token in self._all_ratio_ids` 时强制 EOS
- **bf16 greedy 跨框架前 122 token 一致后分叉**：浮点累积误差，前几百 token 一致就算对齐成功

### C. PR Review 反馈（04-15 ~ 04-16）

- 不要硬编码 token ID（`127957` → `tokenizer.eos_token_id`）
- 写了清理方法（`_clear_transition_state`）必须同时写调用点
- patch.py 死代码（`if A is not B: pass`）必删；提交前 grep `pass` 和 `# just in case`
- 只支持单请求时用 `assert logits.shape[0] == 1` 显式声明，不要装作支持 batch
- monkey patch 必须有 import-time sanity check（`assert _installed is _patched`）
- 写 logits processor 测试前必须读完整方法，注意 in-place mutation
- PR 依赖其他 PR 的文件时在 description 注明依赖关系
- multimodal data key 不统一（`image` vs `images`），两个 `get` 都可能 None → `if pil_image is not None:` 不能用 `else`（参考 `glm_image.py`）

### D. CI 接入（GEBench，04-21 ~ 04-23）

- **方向错**：先做 GenEval 才发现 `tests/e2e/accuracy/test_gebench_h100_smoke.py` 已经存在，加一行 `--gebench-model` 就跑 → **新模型接入先 `ls tests/e2e/accuracy/`**
- **conftest fixture 三次返工**：硬编码 GPU 数 + 漏 `--no-async-chunk` + 物理/逻辑 device id 混淆 → 新 fixture 逐条 diff 同类 fixture
- **smoke test 漏传 `--samples-per-type`**：跑了全量数据集（每样本 6 张图），smoke test 应 `--samples-per-type 1` → 写完后 diff 同类测试确认参数齐全
- **Judge GPU 选择反复 4 次**：硬编码被占 / 选空闲卡是假的 / 残留 OOM → GPU 选择在用的那一刻查实况；kill 后 `sleep 5 + nvidia-smi` 确认归零
- **HF baseline vs Omni fairness**：先降 HF 8 step，后升 Omni 28 → 对照实验先列 checklist（steps / samples / dtype / seed / prompt / image_size）
- **HF cache 路径跨节点不一致**：假设 `$HF_HOME/models--xxx/`，实际有 `hub/` 中间目录 → `find $HF_HOME -maxdepth 3 -name "snapshots" -type d`
- **`--t2i-only` 漏 evaluate 阶段**：generate 加了 flag，evaluate 没同步 → 多 subcommand CLI 改动全链路 grep
- **63-commit 分支**：squash 前 45 个是 bash 脚本 fix、12 个 fixture 修补、只有 6 个 feature commit → 严格按调试策略硬规则走，应 ≤ 10 commit

### E. baseline 测试方式踩坑（04-30）

- **症状**：自己写 `model.generate(bot_task="auto", eos_token_id=[</recaption>, <answer>, <boi>, EOS])` 跑 HF baseline，346 chars，跟 omni 811 chars 完全对不上，错误结论"两边设计不同不可比"。
- **根因**：没先 grep README，错过官方 `model.generate_image(bot_task="think_recaption")`。`generate_image()` 内部 (`modeling_hunyuan_image_3.py:3237-3320`) 拼了 `stage_transitions` + `final_stop_tokens` 喂给 `model.generate()`，跟 omni `_StageTransitionLogitsProcessor` 是同一机制。
  - 直接用 `bot_task="auto"` 完全绕过 stage_transitions。
- **解法**：复刻 `generate_image()` AR 部分（带 `stage_transitions=[(end_of_think_id, [recap_id])]` + `final_stop_tokens=[end_of_recap_id]`）才能跟 omni 比。
- **烧的成本**：30+ 分钟 + 用户一句"那为什么不照着官方，你要自己胡来"。
- **衍生教训**：HF `prepare_model_inputs(...)` 返回的 kw dict 自带 `max_new_tokens` / `eos_token_id`（来自 generation_config），调 `model.generate(**kw, max_new_tokens=2048, eos_token_id=[...])` 撞 `TypeError`。必先 `kw.pop("max_new_tokens", None); kw.pop("eos_token_id", None)`。
- 当前方法见 [[hf-alignment-pitfalls]]（HF alignment pitfalls）。
