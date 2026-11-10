---
name: reviewer-lens-contracts
description: Reviewer Lens Contracts：跨模块暴露、转发或规范化行为时先写 contract matrix，含四项 audit 细则（duplication、layering、edge cases、surface area）与 streaming/API protocol 检查
metadata:
  scope: 只收跨模块边界改动的 contract matrix 写法、audit 细则和 streaming/API 协议面检查；流程门禁归 reviewer-lens-gates-1，审查方法归 reviewer-lens-audit-1
---
# Reviewer Lens Contracts

## 现状

- Use this when the change exposes, forwards, or normalizes behavior across module boundaries.

## 关键事实

- 源页：`knowledge/general/review/guides/reviewer-lens-contracts.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: general, review；created: 2026-07-10；updated: 2026-07-13；sources: 无

### 先把矩阵写出来

- 下面的 contract matrix 不是心算清单。任何命中本页的实现，第一处业务代码修改前都必须在 mini spec 或当时的工作记录中逐项写出答案，并绑定目标基线和 changed surfaces；只写“已考虑”或只列字段名不算完成。该 canonical 记录属于 reviewer 允许读取的设计合同。reviewer 只能核对当前矩阵是否完整、是否匹配 live diff，记录缺失时报 `MISSING_EVIDENCE`；事后 review 输出不能倒推或补造“编码前已完成”的证据。

- 矩阵逐行标记 `affected`、`unaffected-control` 或 `N/A-with-evidence`。只有受影响行缺少必要行为证据时，状态才降为 `implementation draft`；窄修改不需要重跑与 live 调用链无关的全产品矩阵。live 调用链存在未改生产路径时，至少保留一个作回归对照；修改覆盖全部路径时明确写明，不虚构 control。

- 先从 live 源码列出所有能到达同一 consumer 的公开和内部入口。对每个入口记录：在哪里验证、验证发生在文件读取/网络获取/解码/分配/GPU 工作之前还是之后、由哪个生产入口测试覆盖。只验证当前正在编辑的 endpoint，不算入口完整。

### Contract matrix

- Required for any new or modified:

  - OpenAI-compatible request parameter, `extra_body`, `extra_args`;
  - `mm_processor_kwargs`, processor kwarg, pipeline extra body;
  - multimodal key such as `image`, `images`, `img2img`;
  - AR-to-DiT bridge, serving-to-engine prompt, pipeline-to-processor field;
  - CLI/example-visible model behavior switch;
  - public response schema or streaming chunk.

| Column | Required answer |
| --- | --- |
| Ingress | Which top-level field, nested `extra_args`, CLI, example, or legacy caller can express the value? |
| Value shape | How do `True`/`False`, `"true"`/`"false"`, `None`, 0/1, sentinel, and missing value behave? |
| Normalization | Which single layer parses and normalizes? Is downstream `bool(value)` forbidden? |
| Owner | Who owns semantics: serving/protocol, AR bridge, DiT pipeline, processor, model config? |
| Consumer | Which downstream key/field is read? Is old key compatibility needed? Is unsupported path fail-fast or documented no-op? |
| No-op cases | What happens for T2I without condition image, disabled feature, empty image list, or incompatible backend? |
| Docs/tests | Where are docs, protocol/schema, bad-path tests, legacy-key tests, and string-bool tests? |

- 受影响行 missing any column makes sub-agent `OK` invalid. Treat as P1 until resolved. `N/A` 没有源码、diff 或调用链证据时也按缺项处理。

- 跨阶段字段还必须补一张行为链表：producer 怎样产生、沿途是否变换、consumer 怎样解释、在哪个边界停止或截断、失败时谁报错。字段已经出现在下游字典里，只能证明透传，不能证明语义一致。

### Audit details

#### Duplication

- New functions / classes / algorithms / constants require grep across repo and upstream reference:

```bash
grep -rn "<function-name-or-concept>" vllm_omni/ scripts/ <upstream_repo>/
```

- Any match needs a one-line reuse judgment. If you cannot explain why not reuse, reuse.

#### Layering

- Logic belongs with the module that owns the data and semantics:

  - entrypoint parsing model-owned data means wrong layer;
  - opaque tokens passed downstream usually mean downstream needed raw structure;
  - lightweight dependency constraints are solved by moving code to the right heavier layer, not duplicating in lightweight code;
  - generic helper names must not leak one caller's private concept.

- Question: if you cut/paste the logic into owner module X and it can run directly, it probably belongs there.

#### Edge cases

- Audit these before claiming clean:

  - non-contiguous ID ranges and off-by-one;
  - `None` vs 0 vs sentinel;
  - empty / single-element / max-size;
  - request-local state under batching: tensor shape, non-tensor metadata, request index, CFG branch, slice/offset, KV/attention metadata;
  - feature flag x cache mode: cache on/off, prefix hit/miss, last/non-last PP rank, downstream all/subset, staged CPU tensor none/fallback, deferred multimodal keys;
  - dormant old code activated by new tests or payload branches;
  - fake runner shape vs real wrapper contract: property vs method, CPU/GPU buffer wrapper, `.np`, `copy_to_gpu()`;
  - online serving preprocessing, chat template, tokenizer/processor/preprocessor artifacts, request synthesis;
  - new model semantic edges: `cos/sin` order, activation, token order, scheduler spacing, `pad_id == eos_id` attention mask, real tokenizer / processor fail-fast.

#### Surface area

- Default is no new knob. Ask:

  - Can the value be derived?
  - Is help text explaining too much because the wrong layer owns the default?
  - Are multiple knobs mutually exclusive?
  - Does an internal optional parameter have a data contract and execution-context contract?
  - Does a wrong caller fail at the owner boundary?
  - Does backend choice affect correctness?
  - Does a shared state/schema change preserve constructor and unpack compatibility?

- For shared schema changes, grep all constructors, unpack sites, and consumers. `py_compile` / `ruff` are not enough; execute at least one constructor smoke.

### Streaming / API protocol

- Treat `stream`, SSE, WebSocket, and OpenAI-compatible chunks as public protocol surface:

  - protocol types live in protocol layer; endpoint code should not yield ad hoc dicts;
  - reuse existing endpoint and output processor patterns before hand-rolling delta / error / DONE;
  - docs and tests must cover public fields;
  - align normal chunk, validation error, `EngineDeadError`, generic exception, client disconnect, and DONE behavior;
  - structured errors must preserve status/type/code into error chunks;
  - fields named `delta` must be appendable, or the protocol must explicitly say replacement/snapshot;
  - `[DONE]` is a protocol event, not a finally-block decoration;
  - test more than `200 text/event-stream`: include 4xx preservation, engine-dead/shutdown, and client reconstruction.
