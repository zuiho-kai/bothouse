---
name: rules-ray-executor
description: "Ray diffusion executor 规则 DIFF-16a、16b、16c、16d：每 actor 一个完整 GPU 的 placement group 与 global/local rank、rendezvous；ray_worker_env 的环境过滤、all-rank 执行单 rank 回复与结果移至 CPU；normal shutdown 至多 5 秒 bounded cleanup、idle actor failure 整组 fail closed；仅 distributed_executor_backend=ray 时启用及性能证据限定（PR #7938）"
metadata:
  scope: 只收 vllm_omni/diffusion/executor/ray_executor.py 的 placement、env/RPC、生命周期与 rollout 规则；通用 request/RPC/output ownership 归 rules-output-lifecycle-1、rules-output-lifecycle-2，并行拓扑归 parallelism
---
# Ray diffusion executor placement 与生命周期合同

## 关键事实

- 源页：`knowledge/repos/vllm-omni/components/diffusion/rules-ray-executor.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, components, diffusion；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：PR #7938；vllm_omni/diffusion/executor/ray_executor.py；vllm_omni/diffusion/worker/diffusion_worker.py；vllm_omni/diffusion/stage_diffusion_proc.py；vllm_omni/diffusion/stage_diffusion_client.py；vllm_omni/engine/stage_init_utils.py；vllm_omni/engine/stage_engine_startup.py
  - tests/diffusion/test_ray_executor.py；docs/configuration/stage_configs.md；docs/design/module/diffusion/diffusion_runtime.md
- 置信度（confidence）：high
- 通用 request/RPC/output ownership 见 [[rules-output-lifecycle-1]]、[[rules-output-lifecycle-2]]（output lifecycle），并行拓扑见 [[parallelism]]（parallelism）。
- [DIFF-16a] Ray placement 必须按 cluster full-GPU capacity 分配并区分 global/local rank
  - 触发：修改 Ray diffusion executor startup、placement group、actor GPU、rank或rendezvous。
  - 强制：每actor请求1个完整GPU；借用current placement group时按每bundle的整数GPU容量求和，fractional bundles不能凑成one-GPU worker。自建group用每worker一GPU的`PACK` bundles，等待ready失败时立即回收；actor创建即登记，后续startup失败释放已创建actors。借用group的ownership必须保留。
  - 强制：按host连续排列global ranks，优先有GPU的driver host作rank0；每actor在自己的Ray visibility下使用local device0，global rank单独传入。单host rendezvous可用loopback，多host必须用rank0 actor IP和可达TCP port；worker只在local/env rendezvous路径设置localhost。PyTorch拥有distributed data plane，Ray拥有placement/process lifecycle。
  - 验收：覆盖multi-host ranks/rendezvous、fractional与multi-GPU bundles、startup各phase失败、ready timeout和borrowed group；非Ray保留local count与lock校验。真实多node还需验证network、GPU assignment和collective，不可由mock placement推断。^[PR #7938]
- [DIFF-16b] Ray env 与 RPC 必须保留 actor identity、reply ownership 和 CPU transport
  - 触发：修改 `ray_worker_env`、stage runtime.env、actor RPC envelopes、DP wave或结果serialization。
  - 强制：转发driver inference环境的既有prefix和显式names，stage `runtime.env`优先且可携带plugin变量；随后过滤device visibility、rank/rendezvous、worker host/side-channel地址和`RAY_*`，保持每actor自己的identity。`ray_worker_env`是内部`init=False`传输状态，不进入user config projection。
  - 强制：`exec_all_ranks`确保所有collective参与者执行；unique reply仅指定rank返回，DP wave仅每replica primary返回且按rank/DP rank恢复request顺序。返回前递归detach并移至CPU，覆盖typed `DiffusionMediaOutput`、DiffusionOutput、RunnerOutput/BatchRunnerOutput和nested containers；不能复制CUDA tensors到driver作为隐式同机路径。
  - 强制：DLO AllGather DP wave必须有一致shape/CFG/denoise/output/LoRA compatibility、相同`extra_args`及非空prompt；text-encoder AllGather还须一致positive/negative precomputed-embedding字段存在性。single request AllGather也使用bounded wave timeout。
  - 验收：typed/untyped stage env传播和precedence、identity剥离、global/local rank、all-rank执行+one-rank reply、typed media CPU转换；覆盖DP compatibility拒绝和single-request AllGather timeout。Ray backend不使用mp的async output pumps，不能继承其IPC性能承诺。^[PR #7938]
- [DIFF-16c] Ray normal shutdown 必须先 bounded cleanup，idle failure 也必须关闭整组并通知 stage
  - 触发：修改Ray actor shutdown、monitor、health probes、RPC errors、engine close或stage teardown。
  - 强制：normal shutdown先对各actor调用`WorkerWrapperBase.shutdown()`，等待总计至多5秒，再kill actors并移除executor-owned placement group；borrowed group保留。finalizer/partial startup/failure路径可立即kill，shutdown幂等。engine close在join可能等待Ray的worker thread前先shutdown executor；
    - stage client给subprocess至多10秒完成remote cleanup，再signal fallback。
  - 强制：独立monitor concurrency group监视actor death，health probes用独立health group；idle actor failure、RPC timeout/actor/task error或health failure使整组fail closed，释放peers与owned group并拒绝后续工作。failure callback通过`call_soon_threadsafe`到stage event loop，即使无request也触发fatal teardown；
    - closed期间正常actor death不报新failure。被close中断的busy loop从tail退出，使pending RPC失败而非永远等待。
  - 验收：覆盖drain成功/超时/异常、borrowed group、shutdown幂等、startup部分失败、idle actor death、RPC三类failure、health timeout与callback在loop建立前后、close打断inflight和signal fallback。mock tests证明控制面；实际Ray/GPU测试另证worker-owned资源释放。^[PR #7938]
- [DIFF-16d] Ray rollout 必须显式选择 backend 并限定 cluster 与性能证据
  - 触发：修改diffusion backend默认、cluster部署文档、dependencies或multi-node性能/支持声明。
  - 强制：Ray仅在`distributed_executor_backend=ray`时选择；省略仍单GPU `uni`、多GPU `mp`，显式single-GPU mp保留，`external_launcher`仍未支持。复用已初始化Ray或调用`ray.init()`并由Ray处理`RAY_ADDRESS`，没有diffusion独有address参数；每node安装依赖并在Omni前启动cluster，executor不替用户在其他host启动Ray。
  - 验收：文档和实际config默认/显式路径一致，缺Ray报可操作错误；真实multinode记录model、head/base、node/GPU、parallel config、request、warmup/repeats、latency spread与quality等价，E2E claim另给stage attribution。作者的bounded test suite和example保留其原scope，不扩展为完整support矩阵。^[PR #7938]

## 决策与踩坑

- [DIFF-16a] 禁止：用driver local GPU数拒绝合法cluster请求，或宣称orchestrator的local device locks协调了其他host；以global rank当local device index；让半成品actors或failed-ready group泄漏。
- [DIFF-16b] 禁止：转发driver `CUDA_VISIBLE_DEVICES`/`MASTER_*`覆盖actor分配，重复返回nonprimary结果，或让不兼容请求进入可能deadlock的collective。
- [DIFF-16c] 禁止：normal shutdown直接kill跳过distributed group/KV connector/offload cleanup；仅标记failed却保留green stage health或peer资源；让首个rank失败后仍给其他可能卡在collective的rank提交新RPC。monitor thread不得强引用executor阻止finalizer。
- [DIFF-16d] 禁止：从一个Cosmos3/Ulysses示例或mock tests声称任意pipeline、topology、quality或compute-bound workload普遍加速；把作者报34→20秒的4→8GB200 scale-up当作隔离软件改动的same-topology A/B。旧head static review和CI资源失败归因也不是最终runtime验证。
