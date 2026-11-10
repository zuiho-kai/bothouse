---
name: rules-comfyui-workflow-schema
description: "MiniMax-H3 ComfyUI 工作流 schema：VLLM-OMNI-PR9337-H3-COMFY-SCHEMA，节点新增 timeline_guides optional 口或 audio_mode required widget 后须重存 bundled example_workflows、重指 link slot，并以显式集合区分 schema-complete 与 legacy 图（PR #9337）"
metadata:
  scope: 只收节点契约变更与 bundled 工作流保存格式的规则；audio_mode 与 supplied-audio MV 语义归 rules-comfyui-audio，ComfyUI frontend 路由归 tooling-rules
---
# MiniMax-H3 ComfyUI 工作流 Schema 规则

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/minimax-h3/rules-comfyui-workflow-schema.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, models, diffusion；created: 2026-10-24；updated: 2026-10-24
- 来源（sources）：PR #9337
- [VLLM-OMNI-PR9337-H3-COMFY-SCHEMA] ComfyUI 节点契约变更必须同步重存 bundled 工作流并区分 legacy 图
  - 触发：修改 `apps/ComfyUI-vLLM-Omni` 节点的 `INPUT_TYPES()`（如 `VLLMOmniGenerateVideo` 新增 optional 输入口、`VLLMOmniMiniMaxH3Params` 新增 required widget）、`example_workflows/` 下保存的 MiniMax-H3 工作流 JSON，或 `tests/e2e/features/comfyui/test_timeline_guides.py` 的 saved-workflow audit。
  - 强制：节点新增 optional 输入口后，schema-complete 的 bundled 工作流（All-in-One、Music Video、Timeline Guides）里 Generate Video node 的保存 inputs 必须包含该口（本例 `timeline_guides`：type `H3_TIMELINE_GUIDES`、shape 7、`link: null`），并把既有 link 的 target slot 重指到当前位置（新口插入后 url/model/duration 由 9/10/16 变为 10/11/17）。
    - 节点新增 required widget（`audio_mode`）时，保存的 inputs 须带对应 COMBO widget entry，`widgets_values` 追加默认值（`VLLMOmniMiniMaxH3Params` 保存 `[3.0, 12.0, "native"]`）。audit 必须以显式集合区分两类图：断言某图包含 `timeline_guides` 当且仅当它属于 schema-complete 集合，legacy 图按 append-only 兼容省略该口；
    - Generate Video 的 optional sockets 须按 `INPUT_TYPES()` 的 optional 顺序保存，`widgets_values` 数量等于 required 数量。比较 `input["type"]` 与 schema 声明时，list 声明的输入按序列化值 `"COMBO"` 匹配。
  - 验收：`test_saved_workflows_keep_generate_video_slots` 对全部 `example_workflows/*.json` 通过，断言 schema-complete 集合内外的新口存在性、socket 顺序与 widget 数量；`test_h3_timeline_guides_workflow.py` 断言 `VLLMOmniMiniMaxH3Params` 的 `widgets_values == [3.0, 12.0, "native"]` 且 COMBO 类型解析正确；
    - legacy 工作流按 append-only 兼容语义继续通过。^[PR #9337]

## 决策与踩坑

- [VLLM-OMNI-PR9337-H3-COMFY-SCHEMA] 禁止：让保存的 link 继续指向新口插入前的旧 slot 索引；把 schema-complete 工作流当作可省略新口的 legacy 图（或反之）；只对单个工作流断言新口存在而不参数化覆盖全部 `example_workflows/*.json`；在节点契约已被其他 PR（#9226）改动的 stale base 上合并而不在合并结果上重跑 saved-workflow audit；把 list 声明与序列化 type 直接做相等比较。
