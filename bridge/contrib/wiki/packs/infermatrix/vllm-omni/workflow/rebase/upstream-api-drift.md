---
name: upstream-api-drift
description: 上游 API 漂移模式（serving/调度/测试侧）10 类：Harmony/tool-parser 方法被删、renderer 参数改名、ChatTemplateConfig 与 reuse_port 构造迁移、AsyncGPUModelRunnerOutput 漏 has_fault、kv_connector_stats 提取时序、cudagraph 编译桶、MultimodalPayload 标量 sr、object.__new__ 测试构造、测试布局重命名被误判 OOM、benchmarks datasets 再导出
metadata:
  scope: 只收 serving/调度/测试侧的上游 API 漂移案例及其症状、根因与修法；权重/显存/运行时侧漂移归 upstream-api-drift-loading-1、upstream-api-drift-loading-2，波次与失败路由归 rebase-workflow，Scheduler 规则 SCHED-3a 归 scheduler-rules-1
---
# 上游 API 漂移模式（serving/调度/测试侧）

## 关键事实

- 源页：`knowledge/repos/vllm-omni/rebase/upstream-api-drift.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: vllm-omni, rebase；created: 2026-07-16；updated: 2026-07-16
- 来源（sources）：vllm-omni-rebase-agent@122a9468:agent/skills/fix-omni-serving-chat-upstream-harmony-refactor/SKILL.md；vllm-omni-rebase-agent@122a9468:agent/skills/fix-test-parser_cls-missing/SKILL.md
  - vllm-omni-rebase-agent@122a9468:agent/skills/fix-stale-test-path-collection-error-after-rename/SKILL.md；vllm-omni-rebase-agent@122a9468:agent/skills/benchmark-datasets-module-restructured/SKILL.md

## 决策与踩坑

- 对齐 upstream vLLM 时反复出现的漂移形态：接口改名/删除、构造函数迁移、新增 kwarg、时序调整、测试布局重命名。每条保留症状原文、根因与修法。权重/显存/运行时侧的漂移在[[upstream-api-drift-loading-1]]、[[upstream-api-drift-loading-2]]（姊妹页）。运营 runbook 以 rebase-agent 仓库为准，本页是知识树沉淀快照（2026-07-16，agent @122a9468；skills 工作树含未提交遥测更新，快照以工作树为准）。

### 1. 上游重构删掉 Omni 独立维护路径仍在调用的方法（Harmony/tool-parser）

- skill 元数据：`fix-omni-serving-chat-upstream-harmony-refactor`，modules=[scheduler]，status=active，run_count=20，2026-06-15 创建 / 07-11 最后使用。
- 症状：`AttributeError: 'OmniOpenAIServingChat' object has no attribute 'X'`—— X 为 `use_harmony`、`_should_stream_with_auto_tool_parsing`、`_should_check_for_unstreamed_tool_arg_tokens`、`parse_chat_output` 等；常在 `chat_completion_stream_generator`（~1535 行）触发，挂 `test_stream_finish_reason` 系列。
- 根因：Omni 的 `chat_completion_stream_generator` 为多模态流式**独立维护**，仍调用 upstream 在 Harmony/tool-parser 重构中删除的方法。诊断：查 upstream 基线 `git log vllm/entrypoints/openai/chat_completion/serving.py`，确认方法在基线提交存在、在重构中被删。
- 修法（改动位置 `serving_chat.py` / DM-184 亦记为 serving_chat.py）：`use_harmony: bool = False` 作类属性；被删方法在 `OmniOpenAIServingChat` 恢复为本地副本；核对 `vllm.entrypoints.openai.parser.harmony_utils` 的 import ——`parse_chat_output` 若从该模块移除则内联。
  - 回归：`tests/entrypoints/test_stream_finish_reason.py` + `tests/e2e/features/comfyui/test_comfyui_integration.py::test_understanding_node`；pre-commit（ruff format 可能内联被删 import）。^[SK-fix-omni-serving-chat-upstream-harmony-refactor]
- 细化实例（debug-memory #184，key=`missing_should_check_unstreamed_tool_arg_tokens`，module=online_serving，status=active，run_count=2）：upstream `9affc17a05` 把 unstreamed tool-arg flush 从 serving 层移到 parser 层删除该方法，挂 4 个 `test_stream_finish_reason` 用例；
  - 恢复的本地副本 `_should_check_for_unstreamed_tool_arg_tokens(self, delta_message, output)` 按 finish_reason/enable_auto_tools/tool_parser/delta_message tool_calls 返回 bool，**当前匹配 pre-`9affc17a05` 的 upstream 签名**（兼容性边界）；验收=全部测试通过；watch-out：upstream 再改 parser 接口时该独立维护路径还要跟。^[DM-184]

### 2. 参数/属性改名（renderer 类）

- debug-memory #408（key=`online_renderer-to-openai_serving_render-rename`，module=online_serving，status=inactive，run_count=1）：upstream 在 Harmony 重构（PR #45171/#45104）把 `OpenAIServingChat.__init__` 的 `online_renderer` 改名 `openai_serving_render` →
  - `TypeError: OpenAIServingChat.__init__() got an unexpected keyword argument 'online_renderer'` + 对 `self.online_renderer` 的 `AttributeError`（`test_stream_finish_reason`、`test_serving_chat_speaker`）；修法：serving_chat.py 两处 `self.online_renderer` 改名 + 两个测试的 kwarg 同步。^[DM-408]

### 3. 构造函数迁移（dataclass 化 / 新必填 kw-only 参数）

- debug-memory #454（key=`chat_template_config_migration`，module=online_serving，status=active，run_count=1）：upstream 把 pooling/serving 构造函数改为接受 `ChatTemplateConfig` dataclass（包 chat_template、chat_template_content_format、trust_request_chat_template），
  - 影响 ServingPooling/Embedding/Classification/Scores——旧 kwargs 直接 TypeError；修法（api_server.py，四步）：import `ChatTemplateConfig`（`vllm.entrypoints.chat_utils`）；
  - 构建 `ChatTemplateConfig(chat_template=resolved_chat_template, chat_template_content_format=args.chat_template_content_format, trust_request_chat_template=args.trust_request_chat_template)`；
  - 以 `chat_template_config=` 传给 ServingPooling/OpenAIServingEmbedding/ServingClassification/ServingScores 取代散装 kwargs；**ServingScores 还须补缺失的 `supported_tasks` 参数**。^[DM-454]
- debug-memory #435（key=`setup_server-reuse_port-kwarg`，module=online_serving，status=active，run_count=1）：upstream `ab3b6d97aa`（PR #47529，SO_REUSEPORT 仅限多 worker）给 `setup_server()` 加必填 kw-only `reuse_port` → omni 侧未同步更新的是 **import 别名 `setup_openai_server`**，
  - `setup_openai_server(args)` 调用会 TypeError；修法：`api_server.py:453` 改 `setup_openai_server(args, reuse_port=False)`（与 upstream `run_server()` 行为一致）；watch-out：upstream 再加 kwargs 时查 omni 全部调用点。^[DM-435]

### 4. 子类漏接上游新增字段（kwarg + 属性）

- debug-memory #429（key=`omni_async_gpu_model_runner_output_missing_has_fault`，module=worker_runner，status=active，run_count=1）：upstream `245888ff7`（#43637 EP all2all 容错）给 `AsyncGPUModelRunnerOutput` 加 `check_ep_fault`/`_has_fault`，
  - Omni 子类未跟 → `AttributeError: '_has_fault'`（`tests/worker/test_gpu_ar_model_runner.py`）；修法：`__init__` pop `check_ep_fault`（默认 False）+ 初始化 `self._has_fault = None`；`get_output()` 前 `if not hasattr(self, "_has_fault")` 兜底（照顾 `object.__new__` 的单测构造）；两处改动都在 `vllm_omni/worker/gpu_ar_model_runner.py`。
  - watch-out：未来 upstream 让 `check_ep_fault` 承担真实故障检测时，Omni 子类必须真正实现——当前默认 False 只是暂时安全。^[DM-429]

### 5. 时序对齐（stats 提取顺序）

- debug-memory #427（key=`kv_connector_stats_ordering_fix_9ff278b1d`，module=scheduler，status=active，run_count=1）：Omni 两个调度器在 `update_from_output` 开头提取 `kv_connector_stats`，
  - upstream `9ff278b1d` 把提取移到 `_update_from_kv_xfer_finished(kv_connector_output)` **之后**（保证 `update_connector_output()` 先跑）——否则调度侧 stats 是陈旧的；
  - 修法：`omni_ar_scheduler.py`（~303-309）与 `omni_generation_scheduler.py`（~433-440）同改——删早期提取块、在 connector 更新后按 upstream 新模式提取（带 `is_empty()` 判断与『仅调度侧 stats』的 fallback：旧的 `if kv_connector_stats and self.connector` 守卫要求 worker 侧 stats 在场，会**静默丢弃仅调度侧统计**，新模式两种情形都显式处理）。
  - 规则化见 [[scheduler-rules-1]]、[[scheduler-rules-2]]（Scheduler 规则 SCHED-3a）。^[DM-427]

### 6. 编译桶与新特性开关的耦合（cudagraph capture）

- debug-memory #468（key=`code-predictor-bucket-mismatch-cudagraph-capture`，module=online_serving，status=active，run_count=1）：commit `5dc787d5` 给 Qwen3-TTS 开 `talker_mtp_graph_safe=True`（talker_mtp CUDA graph capture）后，
  - `CodePredictorWrapper._warmup_buckets()` 只按 `max_num_seqs`（64）算 torch.compile(dynamic=False) 预热桶，而 capture 批量到 `max_cudagraph_capture_size`（128）——超桶批量逐个重编译，启动 +40-80s，在 L4 上有 OOM/超时风险（Entrypoint L4 job 被 cancel）；
  - 修法：`qwen3_code_predictor.py` 的 `CodePredictorWrapper._warmup_buckets()` 改算 `max_bsz = max(max_num_seqs, max_cudagraph_capture_size)`——后者从 compilation_config 读取并带 `isinstance(..., int)` 防护（兼容测试里的 mock config），保证 talker_mtp graph capture 遇到的所有批量都预编译。
  - 故障现场：Qwen3-TTS **CustomVoice** 模型启动的 Entrypoint L4 job。^[DM-468]

### 7. 重构改变数据通道语义（Output Processor 标量误入张量拼接）

- debug-memory #467（key=`error-concatenating-tensor-key-sr`，module=online_serving，status=active，run_count=1）：Output Processor Phase-2 用 `MultimodalPayload` dataclass 取代 dict 累积后，旧代码的 `elif k == "sr": self.mm_accumulated[k] = v[-1]` 特判消失，
  - 新实现让所有 tensor key 走 `_cat_tensors()` 且**每个 modality 只有一种拼接策略**，`from_dict()` 把**所有** tensor（含 0 维标量 `sr`——sample rate）塞进 `tensors` 走 `_cat_tensors()`，0 维张量在 `torch.cat()` 中失败 → `WARNING "Error concatenating tensor for key sr; keeping last tensor"`（output_processor.py:227，Qwen3-TTS serving）；
  - 修法：加 `_METADATA_TENSOR_KEYS` frozen set（sr、sample_rate、audio_sample_rate），`_consolidate_multimodal_tensors()` 在张量拼接循环前把这些已知标量键从 `tensors` 挪到 `metadata`（走 metadata 的 **REPLACE** 语义而非拼接）。watch-out：只处理已知键——未来模型产出其他元数据型标量（dimensions、channels 等）需加进集合，未知标量仍会触发 RuntimeError fallback warning。^[DM-467]

### 8. `object.__new__` 测试构造漏新属性/新签名

- skill 元数据：`fix-test-parser_cls-missing`，modules=[scheduler, entrypoints]，status=active，run_count=16，2026-06-16 创建 / 07-11 最后使用。
- 模式：测试用 `object.__new__(...)` 绕过 `__init__` 造对象，上游给 `__init__` 新增的属性全都不在——rebase 后测试挂 `AttributeError`，**不是产品 bug**。
- 实例 A：`OmniOpenAIServingChat.parser_cls`——upstream `__init__` 设 `self.parser_cls = ParserManager.get_parser(...)`，`_create_chat_completion` rebase 后从旧的 `self.reasoning_parser_cls` 改用它 → 测试里补 `serving_chat.parser_cls = None`（产品代码有 `if self.parser_cls is not None` 判空，安全）。
  - 验证：`python -m pytest tests/entrypoints/openai_api/test_serving_chat_speaker.py -xvs`。^[SK-fix-test-parser_cls-missing]
- 实例 B（debug-memory #441，key=`voxcpm2-test-talker-state-eviction-attribute-mismatch`，module=model_executor，status=active，run_count=1）：`test_talker_state_eviction.py` 4 处失败——`_make_bare_talker()`（`__new__` 构造）缺新属性 `_enable_unified_decode_graph`；
  - 且 `_finish_decode` 签名变（去掉 dev 参数）、`_DecodeResidualMeta` 从 dict 变 NamedTuple 而测试仍按 dict 访问；修法：helper 补 `_enable_unified_decode_graph=False`、meta 改用 NamedTuple 实例、去掉多余的 `torch.device()` 实参、`expected_meta['new_lm_hidden']` 改属性访问 `expected_meta.new_lm_hidden`。
  - watch-out：模型 `__init__` 加新属性时查 `_make_bare_talker()`；NamedTuple 取代 dict、或 `_finish_decode` 签名再变时查测试用法。^[DM-441]

### 9. 上游测试布局重命名 → 采集错误被误判 OOM

- skill 元数据：`fix-stale-test-path-collection-error-after-rename`，modules=[online_serving, model_executor]，status=active，run_count=6，2026-07-11 创建 / 07-11 最后使用。
- 症状：pipeline 测试 rc=4/rc=5，日志 `ERROR: file or directory not found:` / `collected 0 items` / `no tests ran`；postmortem 误标 `SILENT EXIT — child SIGKILL (OOM)`（该分类器在无 pytest traceback 时都触发，采集错误恰好也没有）→ 白烧 3 次 GPU 重试后硬停。
- 诊断：先 grep 采集错误特征（`ERROR: file or directory not found:` / `ERROR: not found:` / `collected 0 items` / `no tests ran`）——是**路径/采集** 错误不是 OOM；`ls /rebase/vllm-omni/<pytest 命令里的路径>` 确认文件缺失；
  - 再查 upstream 动向（vllm-omni 自身的 `origin/main`，即 `git -C /rebase/vllm-omni cat-file -e origin/main:<path>`）：不在但 `*_expansion.py`/`*_tts.py` 兄弟在（测试布局重构 #2556/#4354 的改名），或 `find /rebase/vllm-omni/tests -name <basename>` 找到新目录，或已删除并入别的层级（幸存者换 marker 如 `slow`、跑在别的 job）。
  - 这是 rebase-agent 清单（config.sh `CI_TEST_CMD`）的配置 bug，不是 vllm-omni 模型 bug。
- 修法（改 `agent/config.sh`，**绝不 patch vllm-omni**）：改名→指向现名（`test_sd3.py`→`test_sd3_expansion.py`、`test_voxcpm2.py`→`test_voxcpm2_tts.py` 等，marker/run-level 不动除非幸存者变了）；移动→改目录前缀；
  - 删除+改层→ **退役** slug（所有映射表 `LOCAL_CI_TESTS`/`CI_TEST_LABEL`/`CI_TEST_SOURCE`/`CI_TEST_CMD`/`CI_TEST_TIMEOUT_SEC`/min-gpus/hw/module 全部加 `# STALE: ` 前缀；若某个 full_model/nightly job 已运行 `*_expansion.py` 幸存者则覆盖率不丢）；顺手全表扫一遍所有 `tests/**/*.py` 是否在盘上，一次修完。
  - 既有护栏（别弄坏）：`agent/test_manifest.py::_validate_file_paths` 已 rename-aware（git rename map + 去 `_expansion`/`_tts` 的词干回退），`agent/lib/test_runner.sh::_append_silent_log_footer` 对 rc=4/5 出 `COLLECTION/PATH ERROR` footer 而非 OOM footer。
- 验证：`cd /rebase/vllm-omni && /rebase/.venv/bin/python -m pytest --collect-only -q <corrected-path>` → rc=0 且 `N tests collected`；重跑 pipeline 测试进入执行。
- 禁止：为满足陈旧配置**重造上游已删除的测试文件**（旧的 `tests/e2e/online_serving/test_hunyuan_video_15.py` 已由 `tests/e2e/accuracy/hunyuanvideo15_{i2v,t2v}/` 幸存者取代；恢复旧路径会与幸存者重复、以后每次 rebase 都冲突）；把 rc=4/5 当 OOM 在 GPU 上重试——**结果永远不会改变**，只白烧 3 次重试并硬停；
  - 盲目放宽 marker 把 `slow`/`full_model` 幸存者塞进 merge job（改变上游的 CI 成本/分层意图）。^[SK-fix-stale-test-path-collection-error-after-rename]

### 10. 上游模块重排但保留再导出（benchmarks datasets）

- skill 元数据：`benchmark-datasets-module-restructured`，modules=[benchmarks]，status=active，run_count=15，2026-06-13 创建 / 07-11 最后使用。
- 诊断：`from vllm.benchmarks.datasets import SampleRequest, get_samples` 是否失败。模式：upstream 把 `vllm/benchmarks/datasets.py` 移成 `vllm/benchmarks/datasets/datasets.py` 并加再导出 `__init__.py`——旧 import 路径**仍可用**；只有当某符号没进再导出清单时才需要修（把它补进 `__init__.py`）。
  - 再导出含：SampleRequest、get_samples、add_dataset_parser、BenchmarkDataset、RandomDataset、RandomMultiModalDataset、ShareGPTDataset、SonnetDataset、HuggingFaceDataset、CustomDataset 等，及 process_image、process_audio、process_video——全表见 `/rebase/vllm/vllm/benchmarks/datasets/__init__.py`。
  - 教训：**先确认再导出是否已覆盖**，不要见 ImportError 就大改。^[SK-benchmark-datasets-module-restructured]

### 活文档（登记册）

- 见 [[rebase-workflow]]（workflow） 的"活文档"节（mrv2 计划与上游提交变更册）。

### 相关

- 权重/显存/运行时侧漂移：[[upstream-api-drift-loading-1]]、[[upstream-api-drift-loading-2]]（姊妹页）；波次与路由：[[rebase-workflow]]（workflow）。
