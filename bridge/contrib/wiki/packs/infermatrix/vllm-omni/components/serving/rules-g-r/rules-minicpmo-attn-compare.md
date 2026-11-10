---
name: rules-minicpmo-attn-compare
description: "规则 VLLM-OMNI-PR9344-MINICPM-ATTN-COMPARE：出货 MiniCPM-o profile（vllm_omni/deploy/minicpmo_4_5.yaml）不固定 CUDA Thinker 的 attention_backend，对比后端用只改 stage 0 的 --deploy-config overlay（TRITON_ATTN），质量对比固定变量、多 seed、重启复测，response.done 只证明协议完成（docs/serving/realtime_duplex_api.md，PR #9344）"
metadata:
  scope: 只收 MiniCPM-o 注意力后端对比的 profile、overlay 与证据语义这一条规则；stage 启动与设备布局的一般合同归 rules-stage-startup
---
# vLLM-Omni Serving 规则 — MiniCPM-o 注意力后端对比

## 关键事实

- 源页：`knowledge/repos/vllm-omni/components/serving/rules-minicpmo-attn-compare.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, components, serving；created: 2026-10-25；updated: 2026-10-25
- 来源（sources）：PR #9344
- [VLLM-OMNI-PR9344-MINICPM-ATTN-COMPARE] MiniCPM-o 注意力后端对比：出货 profile 不锁定 CUDA Thinker 后端，实验走仅改 stage 0 的 overlay
  - 触发：改动 `docs/serving/realtime_duplex_api.md` 的 `#### Compare MiniCPM-o attention backends` 小节，或 MiniCPM-o 部署 profile（如 `vllm_omni/deploy/minicpmo_4_5.yaml` 及其变体）中 CUDA stage 的 `attention_backend` 取值，或 `tests/model_executor/models/minicpmo_4_5/test_pipeline.py` 对部署 profile 的结构断言；
    - 也覆盖以采样 transcript 差异主张注意力后端缺陷、或以 `response.done` 成功主张识别质量的评审证据。
  - 强制：出货 MiniCPM-o profile 保持把 CUDA Thinker 注意力后端选择交给 vLLM（文档明示该语义）。比较后端必须用只改 stage 0 的部署 overlay：`base_config` 指向 `vllm_omni/deploy/minicpmo_4_5.yaml`，在 `platforms.cuda.stages` 下为 `stage_id: 0` 设 `attention_backend: TRITON_ATTN`，经 `--deploy-config` 传入；overlay 保留 Talker 的后端选择与 profile 的 graph 设置；
    - turn-mode profile 同样继承该基础部署，改基础 profile 会同时影响两种服务模式；启动后须逐 stage 核对启动日志中的实际后端与 graph 模式。质量对比须固定源与模型 revision、参考音频、输入音视频、帧率、节奏、窗口设置与采样参数，比对多个匹配 seed，并在全新服务器启动后重复会话，按场景与提问时间戳评估回复（较晚的回答可能描述的是模型作答期间已变化的场景）。证据语义：成功的 `response.done` 只证明协议完成，不证明识别正确或句子完整；图启用与 eager 服务须分别验证并记录实测拓扑；
    - 单个采样 transcript 的变化既不建立注意力后端缺陷，也不建立普遍质量提升；该 overlay 是对比工具，不是识别错误或 post-commit drain 超时的已确认修复。
  - 验收：`docs/serving/realtime_duplex_api.md` 保留该小节（stage-0 overlay YAML 示例、`--deploy-config` 用法、Talker/graph 保留说明、与 `--attention-backend` 的区别、逐 stage 启动日志核对、固定变量与多 seed/重启规程、时间戳评估及 `response.done` 语义限定）；出货 MiniCPM-o profile 的 CUDA stage 0 未固定 `attention_backend`；
    - `pytest tests/model_executor/models/minicpmo_4_5/test_pipeline.py` 通过且 mypy/pre-commit 通过。^[PR #9344]

## 决策与踩坑

- [VLLM-OMNI-PR9344-MINICPM-ATTN-COMPARE] 禁止：在出货 profile 中固定 CUDA stage 0 的 `attention_backend`，或恢复要求 Triton 为默认的测试断言；把服务器级 `--attention-backend` 覆盖当作 Thinker-only 对比（它同时作用于 Talker，属于不同实验）；以变量不匹配的 transcript 对比或仅凭 `response.done` 成功宣称后端缺陷或质量结论；删除或改写文档小节中的 overlay 示例、对比规程与证据限定；
  - 移除 `test_pipeline.py` 中 mypy 要求的 `expected_graph_config: dict[str, object]` 类型注解。
