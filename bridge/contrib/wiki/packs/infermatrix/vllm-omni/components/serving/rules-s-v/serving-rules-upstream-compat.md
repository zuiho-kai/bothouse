---
name: serving-rules-upstream-compat
description: "Serving upstream 兼容规则：SERV-RELEASE-KV-1a/1b kv_hints 穿过 request 升级与 release_kv_cache_memory（PR #8459）；SERV-7a launcher shutdown / renderer warmup / replica compile cache，7b 落后镜像能力探测，7c 对象存储 URI，7d create_error_response import owner，7f OpenPI nd 标记 kind，7e response.output_audio.*，7g/7h serve 入口退役与 ingress 分类，7i logging 初始化顺序；SERV-SPEECH-ERROR-1a voice route 错误"
metadata:
  scope: 只收 SERV-RELEASE-KV-1a/1b、SERV-7a–7i 与 SERV-SPEECH-ERROR-1a；route 覆盖时移除旧 route（SERV-5s）归 rules-app-assembly，sleep/wake admission 归 rules-sleep-control，voice 删除的 403/404 归 rules-voice-management
---
# Serving upstream 兼容规则

## 关键事实

- 源页：`knowledge/repos/vllm-omni/components/serving/rules-upstream-compat.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, components, serving；created: 2026-09-02；updated: 2026-10-09
- 来源（sources）：PR #8459；PR #5976；PR #5957；vllm_omni/engine/stage_engine_startup.py；vllm_omni/entrypoints/openai/api_server.py；vllm_omni/entrypoints/utils.py；vllm_omni/request.py；tests/engine/test_stage_engine_startup_cache_env.py；tests/config/test_endpoint_policy.py；PR #5036；PR #6642；PR #6773
  - PR #6707；vllm_omni/config/endpoint_policy.py；PR #6051；PR #7426；PR #5647；PR #8518；PR #7798
- 置信度（confidence）：high
- [SERV-RELEASE-KV-1a] 新 release KV hints 必须无损穿过 request 升级与 wire
  - 触发：新增 upstream request 字段或修改 Omni `generate`、stage submission、wire conversion。
  - 强制：nonstream 与 streaming 首次 submission 都将 `kv_hints` 传入真实 input processor；`EngineCoreRequest` 升级为 Omni request、wire transport 和 scheduler conversion 保留 `kv_hints` 与 session identity。diffusion stage 不具有该 AR/LLM KV cache，显式拒绝 hints。
    - fixed prompt-token scores 从 worker CPU snapshot 经 scheduler 到 engine output 保持 request identity，partial prefill 不伪造完整 score 输出。
  - 验收：有/无 hints、stream/nonstream、payload upgrade→wire→scheduler，及 diffusion refusal；fixed-token scores 分别覆盖 host copy 与真实 CUDA copy 路径。接口通过不等于 remote KV 性能或完整模型 logprob 质量已经验收。^[PR #8459]
- [SERV-RELEASE-KV-1b] 释放 KV memory 必须在完成 pause 后经 EngineCore 执行
  - 触发：修改 `release_kv_cache_memory`、stage RPC 路由、pause/wake lifecycle。
  - 强制：仅选择 AR stages；要求 frontend pause 已完成且 `_admitting==0`，Stage 0 被选择时先清 frontend multimodal cache，再用 EngineCore helper 释放 KV。成功后记录 KV sleep，恢复前保持 admission hold；以 `wake_up(tags=["kv_cache"])` 恢复再 resume。
  - 验收：未 pause 拒绝、admission drain、AR/diffusion 混合选择、真实 helper 路由、unsupported helper/error propagation、KV wake tag 与 resume admission。mock 测试只证明路由及状态合同，真实显存释放量需另外测量。^[PR #8459]
- [SERV-7a] upstream launcher 生命周期兼容必须保持模式检测语义
  - 触发：upstream launcher、renderer warmup 或 shutdown 读取的 engine-client 属性变化。
  - 强制：pure-diffusion client 只在 launcher-facing `vllm_config.shutdown_timeout` 上提供最小 adapter，其余属性透明转发，内部 `get_vllm_config()` 仍返回 `None`；chat template warmup 调用 upstream 当前 owner `online_renderer`。
    - 多 replica spawn 时 replica 0 复用默认 compile cache，后续 replica 在持锁的 spawn env 中获得 stage/replica 唯一 `VLLM_CACHE_ROOT`，离开 scope 必须恢复环境。
  - 验收：pure diffusion 正常 shutdown 且 detection 不变；renderer 恰好 warmup；cache-env 测试覆盖 replica 0、多个 stage/replica、嵌套恢复和异常恢复。^[PR #5976]
- [SERV-7b] 加速器镜像落后一版时兼容层必须按能力探测
  - 触发：CUDA 主线升级 vLLM 后，XPU/NPU 等镜像仍使用前一版 renderer、tool parser import 或 request layout。
  - 强制：可选 renderer warmup 用属性能力探测；Mistral tool-call parser 只在新 import 不存在时回退旧路径；`OmniRequest` 仅为缺失的 `num_stale_output_tokens` 提供零初值，不覆写新版 owner 已有的值。
  - 验收：新/旧 renderer、两条 Mistral import 和有/无 stale counter 的 request layout 都能初始化，且新版既有 counter 原值不变。^[PR #5957]
- [SERV-7c] 对象存储 URI 必须在 serving 入口绕过预下载
  - 触发：修改 `omni_snapshot_download()` 或入口侧模型解析，使其处理 Run:AI 对象存储 URI、HF repo id 和本地模型路径。
  - 强制：使用上游 `is_runai_obj_uri` 作为唯一对象存储判断，在 Hugging Face/ModelScope 预下载前原样返回对象存储 URI；本地路径与普通 HF repo id 保持既有分支，并将后续配置读取交给配置层的本地物化逻辑。
  - 验收：参数化 mock 测试覆盖 `s3://`、`gs://` 及上游支持的 `az://`，断言 HF 下载未调用且返回值未改变；同时覆盖本地路径、HF repo id 和欺骗性 bucket/组织段匹配，确认入口语义没有回归。resolved HF cache snapshot 的 repo-name recovery 已随 #6642 的 revert 不再是当前合同。^[PR #5036] ^[PR #6642]
- [SERV-7d] error-response import 必须遵循各 caller 的已验证 owner
  - 触发：pinned vLLM 移动 `create_error_response`，或 endpoint policy / API server 增加直接 caller。
  - 强制：`endpoint_policy.py` 直接从 pinned owner `vllm.entrypoints.serve.exception_handling.error_response` 导入 `create_error_response`，不设 fallback；`api_server.py` 则先从 package root `vllm.entrypoints.serve` 导入，只在 `ImportError` 时回退 `vllm.entrypoints.serve.utils.error_response`。
    - 这是两个 caller 各自的 source-authoritative 合同，不要求共享 fallback 顺序。
  - 验收：在此 pinned revision，直接导入 relocated module，并运行 `tests/config/test_endpoint_policy.py`；API-server 路径仍仅为其 `ImportError` fallback 的静态合同。PR 描述报告该 suite `4 passed`，批准 review 的边界是 static review、merge tree 与 CI，且明确未执行 untrusted fork code；因此不能扩展为完整 vLLM 版本兼容或端到端声明。^[PR #6707, merged 2026-09-02]
- [SERV-7f] OpenPI `nd` 标记必须同时接受 vLLM-native 与 msgpack-numpy 的 `kind`
  - 触发：修改 `entrypoints/openpi/connection.py` 的 `_decode_vllm_numpy_marker` / `_unpack_numpy`，或 OpenPI/DreamZero 观测 payload 解码。
  - 强制：`kind` 仍为区分 array marker 与普通 mapping 的必填字段。plain ndarray 的 `kind` 接受 `""`（msgpack-numpy 包）或 dtype kind 字符（vLLM-native）；二者任一匹配即通过。`kind == "V"`（structured）必须在调用 `np.dtype(type)` 之前拒绝，因该方言的 `type` 是 descriptor list。outbound 仍发 openpi-client 标记。
  - 验收：分别覆盖 vLLM-native `kind`、手写 `kind=b""`、真实 `msgpack_numpy.packb` 观测 round-trip、structured `kind=V` 拒绝，以及无 `kind` 的用户 dict 原样保留。^[PR #6051]
- [SERV-7e] realtime/video-stream 音频事件必须使用 `response.output_audio.*`
  - 触发：修改 realtime WebSocket、video stream serving、示例客户端或协议文档中的音频 delta/done 事件名。
  - 强制：服务端发出的增量与终态音频事件类型必须是 `response.output_audio.delta` / `response.output_audio.done`（及配套 transcript 命名），与已迁移的 OpenAI realtime 合同一致；示例与测试断言同一集合。
  - 验收：duplex/realtime/video-stream 测试收集到的音频事件类型集合等于 `response.output_audio.*`，且不接受仅 legacy 名作为成功合同。^[PR #7426]
- [SERV-7g] 公开 serve 入口退役必须在所有 producer 上 fail closed
  - 触发：删除或改名 serve CLI option、wrapper/chart key 或公开配置文件入口。
  - 强制：parser、headless builder、脚本、chart、测试和公开 serving 文档在同一批迁移到 canonical replacement；已删除的外部 key 必须显式拒绝并给出迁移目标。当前 serve 部署 YAML 的唯一公开 flag 是 `--deploy-config`。
  - 验收：replacement 可解析且到达最终 consumer，旧 option parser 失败；standard/headless 发出同一 canonical 值，wrapper/chart 同时有正向与旧 key 拒绝测试，公开 serve 调用扫描不再命中退役 flag。 ^[PR #5647]
- [SERV-7h] 兼容性按 ingress 分类，不能按同名 symbol 推断
  - 触发：公开 CLI 已移除，但 Python/direct API、offline example 或 resolver 仍保留同名字段。
  - 强制：分别列出 public CLI、wrapper/chart、offline example、Python/direct 和内部 resolver；public 行为由 Serving owner 决定，仍保留的 loader/schema 语义交给 [[configuration-rules-1]]、[[configuration-rules-2]]、[[configuration-rules-3]]（Configuration rules） 并记录明确 follow-up 边界。
  - 验收：公开 rejection 与 canonical forwarding 测试通过；每个暂留内部/direct 路径有独立 compatibility test，直到后续迁移显式删除。 ^[PR #5647]
- [SERV-7i] parsed logging settings 必须先于 Omni command validation 与 dispatch 生效
  - 触发：升级vLLM logger初始化合同或修改Omni CLI/module API-server入口。
  - 强制：Omni CLI在parse_args后、recognized command validate前调用upstream `configure_logging_from_args(args)`，然后dispatch；直接module API server也在parse后、model同步/后续validation与startup前调用同一入口。不得只依赖import-time logger defaults。
  - 验收：两个真实entrypoint分别核对parsed settings→configure→validate/startup顺序，并用显式logging参数检查效果。source的logo观察只支持初始化修复，未解决module入口仍显示 vLLM logo的既有问题，也不提供其它功能/模型运行资格。^[PR #8518]
- [SERV-SPEECH-ERROR-1a] voice route 错误不依赖 tokenization handler
  - 触发：修改 stored-voice GET/POST/DELETE 或 Speech create_error_response。
  - 强制：使用 upstream create_error_response helper 构造规范错误，raw Request 与 serving_tokenization 不是错误构造前提；缺 voice handler/nonexistent voice 返回 404，缺必需 audio 返回 400。
  - 验收：无 serving_tokenization 的 app 覆盖三条 voice route、缺 audio 与不存在 voice，核对 status/body，保留成功路径。 ^[PR #7798]

## 决策与踩坑

- [SERV-RELEASE-KV-1a] 禁止：仅在入口接纳字段却在重新包装 dataclass 时丢失；忽略 diffusion 的 hints；在 async scores copy 完成前读取，或让另一 request 的 scores 混入当前输出。
- [SERV-RELEASE-KV-1b] 禁止：仅调用 worker collective RPC 绕过 EngineCore paused/resident 检查；缺失 helper 时报成功；释放 diffusion stage；RPC 或 pause failure 后伪造成功的 frontend 状态。
- [SERV-7a] 禁止：让 adapter 改变 pure-diffusion detection；调用已删除的 serving-chat warmup；所有 replica 共写 AOT cache，或永久污染父进程环境。
- [SERV-7b] 禁止：用 platform name 猜测 API；为兼容旧版跳过新版必需初始化；将临时 shim 宣称为长期 public API。
- [SERV-7c] 禁止：维护与 vLLM streamer 分离的本地 scheme allowlist；将对象存储 URI 当作 HF repo id 下载；让 bucket 或组织路径段参与模型名称匹配。
- [SERV-7d] 禁止：把 endpoint-policy 的直接模块 import 改回 package-root fallback；捕获任意 `Exception` 伪装成兼容；或以这两个 import 成功声称跨版本 API/JSON parity。
- [SERV-7f] 禁止：要求 `kind == dtype.kind` 而拒绝空 kind；对 structured marker 让 `np.dtype` 抛出不透明 `TypeError`；把 msgpack-numpy **标量**（可省略 `kind`）误当成必须解码的 ndarray marker。
- [SERV-7e] 禁止：在任一生产发送路径残留 legacy `response.audio.delta` / `response.audio.done`；只改文档/示例而漏改 `realtime_connection` 或 `serving_video_stream`/`video_stream_base`。
- [SERV-7g] 禁止：删除是有意 breaking change 时又加静默 alias/fallback；wrapper 接受但忽略旧值；留下仍会发出旧 flag 的可运行命令。
- [SERV-7h] 禁止：因为仓库仍出现 `stage_configs_path` 就恢复公开 serve flag；也不能因为 public parser 已删除就宣称所有内部兼容路径已移除。
- [SERV-7i] 禁止：只修 `vllm serve --omni` 而遗漏 `python -m ...api_server`，或在validate/dispatch后才应用用户settings；logo可见不能替代level/config实际生效或模型startup证明。
- [SERV-SPEECH-ERROR-1a] 禁止：在本可预期的 voice 错误路径访问缺失 tokenization handler 而变 500，或靠初始化无关 handler 规避合同。
