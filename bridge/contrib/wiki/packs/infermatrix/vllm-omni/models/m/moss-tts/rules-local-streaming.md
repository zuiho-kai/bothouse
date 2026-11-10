---
name: rules-local-streaming
description: "MOSS Local streaming 与 MRv2 状态：MOSS-LOCAL-1a 逐行 seed 只由该请求 generator 消费（PR #7922）、MOSS-LOCAL-1b MRv2 slot 状态 admission 重置、MOSS-CODEC-1a ramp 与 codec graph 共享 ladder、MOSS-CODEC-1b fast first-chunk handoff、MOSS-REF-1c 共享 reference worker 结束所有等待者（PR #8124、#8213）"
metadata:
  scope: 只收 MOSS-LOCAL-1a、1b、MOSS-CODEC-1a、1b、MOSS-REF-1c；profile 选择、MPS、EOS 与空音频归 rules-local-mrv2，注册 voice 归 rules-registered-reference，reference encoder 缓存归 moss-tts-rules-2
---
# MOSS Local streaming 与 MRv2 状态规则

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/moss-tts/rules-local-streaming.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, models, model-executor；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：PR #7922；PR #8124；PR #8213
- [MOSS-LOCAL-1a] 逐行 seed 仅由该请求 generator 消费
  - 触发：修改 MOSS Local talker/depth transformer 的 generators 参数或 stochastic token sampling。
  - 强制：talker 在 depth loop 前校验 generators 数量精确等于 batch size，包含 all-None 列表；传至 binary choice 与每 codebook sampling。混合列表逐 row 用该 generator 抽样，None使用原默认RNG；未提供或 all-None 保留原 batched 路径。whole-MTP graph 门禁由[[rules-request-rng]]（EXEC-RNG-1a）拥有。
  - 验收：短/长/all-None长度、B1、mixedrows、同seed复现、不同邻居/行位次不影响seededcodes，以及无seed原路径parity；用实际runner验证graphmode依赖。 ^[PR #7922]
- [MOSS-LOCAL-1b] Local MRv2 slot 状态必须在 admission 重置并与父类字段隔离
  - 触发：修改 MossLocalModelState、batch prefill、eager MTP、determined tokens或request slot reuse。
  - 强制：Local字段使用_local_eager_mtp/_local_eager_rows，保留父类hookstate形状；admission清空hidden/codes/active/keep/eager状态。只有完成prefill并运行Local eager MTP的slot可转该路径；stop后的keep gate阻止再次emit。输出code rows由index_select取得owned storage，不把slot/graph view交给request。
  - 验收：通过OmniARModelRunner.sample_tokens做首prefill回归；mixed/chunkedprefill、slotreorder/cancel/reuse、stop、不支持samplingcontrol均覆盖。snapshot在后续slot写入后仍保持原codes及request顺序。 ^[PR #8213]
- [MOSS-CODEC-1a] ramp 与 codec graph 必须共享 ladder 并守恒每个 segment 的 frame
  - 触发：修改 raw async-chunk threshold、codec_chunk_ramp、streaming graph frame set或terminal padding。
  - 强制：processor与codec共用parse_chunk_ramp；null/invalid/single-entry禁用ramp并告警，保持初始→steady路径。索引使用connector的ramp_chunk_count并按segment重启；所有ladder lengths进入(B,T)warmup，state/headroom按最大step分配，fast first graph取ramp首项。terminal row才可pad到bucket，输出crop到真实frame数。
  - 验收：frameorder与总数、segmentrestart、两request独立进度、partial/emptyEOF、null/invalidladder、step>steady、ramp-first与initial优先级、graphfallback均断言。省略steady的default差异须有control，不能凭统一parser假定所有default一致。 ^[PR #8124] ^[PR #8213]
- [MOSS-CODEC-1b] fast first-chunk handoff 必须有界且只能推进一次 slot 状态
  - 触发：修改first-chunk receive hook、专用decode线程/stream、delivery sink或cancel cleanup。
  - 强制：只claim形状匹配、route有效且slot尚未占用的首chunk，clone codes并在admission lock内排队。复用generic prepared first-audio sink；main/cancel按slot handoff event排序；wait timeout必须正有限(默认30s)。关闭/workererror拒绝新job并fail已接收route；sink失败仅重送已decode PCM，finalcodecPCM不带upstream marker。
  - 验收：fast与main交错、sink拒绝、workererror、close/submit竞态、timeout、超过capacity的cancel/reuse和首次已decode标记覆盖；PCM/frame仅一次、slot不提前重用，所有waiter可结束。 ^[PR #8213]
- [MOSS-REF-1c] 共享 reference worker 必须结束所有等待者并保持 result cardinality
  - 触发：修改shared reference encoder、worker graph resources、batch-window队列或Unix-socketclient生命周期。
  - 强制：reference graphs保持显式VLLM_OMNI_MOSS_REF_GRAPHS opt-in，encoding在MRv2外；每worker拥有自己的stream/graphresources。outstanding集合覆盖已取走的job，close使全部job收到error。encode_fn返回数量必须等于输入clips；不匹配整个batch失败，已由close完成的job不能被late结果覆写。
  - 验收：关闭pending/in-flight、startupfail、结果过少/过多、两个并发client独立连接、batching与single-flight、late完成均覆盖；无异常hang且每clip一份结果/错误，graphoff原路径保持。 ^[PR #8213]

## 决策与踩坑

- [MOSS-LOCAL-1a] 禁止：短列表尾行静默回退 global RNG；把 backward-compatible scalar generator 丢弃；为保 seed 串行重跑整行 transformer，或忽略 graph replay 未消费Pythongenerator。
- [MOSS-LOCAL-1b] 禁止：子类覆盖父类_eager_rows tuple为row列表；复用slot读取前request frame；对grammar/processor/distributionmetadata、draft/PP/sharded不兼容采样绕过原sampler。
- [MOSS-CODEC-1a] 禁止：用put_req_chunk使跨segment不重启ramp；两侧各写parser；只捕获initial/steady而漏中间或大于steady的step；重复/遗漏tail、让emptyterminal重复decode上一chunk。
- [MOSS-CODEC-1b] 禁止：无界等engine线程；在partial replay/error/timeout后release或重新decode同slot；cancel后重建receive readiness；首chunk由fast/main两条路重复交付或被丢弃。
- [MOSS-REF-1c] 禁止：zip短结果留下后续caller永久wait；关闭只清pending而遗漏in-flight；在不同worker间复用mutablegraphbuffer；把shared目录或新graphs默认为全族能力。
