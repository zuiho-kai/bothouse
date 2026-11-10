---
name: 2026-05-18-remote-runtime-gpu-03
description: 2026-05-18 错题：用户要求 tp=2 在 2,3 卡，但 pytest helper 的 GPU memory monitor 与 residual vLLM cleanup 仍以 0..N 全局视角等 0/1 卡并尝试清理他人进程；解法是临时 YAML 改 devices 与 tensor_parallel_size，并先分清自己与他人进程
metadata:
  scope: 只收 2026-05-18 测试 helper 全局 GPU 视角与 TP=2 指定卡冲突这一起事故；GPU 占用只看 memory.used 的误判归 2026-05-18-remote-runtime-gpu-04
---
# 2026-05-18 — 跑 TP=2 要避开测试 helper 的全局 GPU cleanup/占卡假设

## 关键事实

- 源页：`knowledge/repos/vllm-omni/remote/incidents/2026-05-18-remote-runtime-gpu-03.md`（InferMatrixCopilot@ecfb84d0）；源页无 frontmatter

## 决策与踩坑

- 编号：`inc-2026-05-18-remote-runtime-gpu-03`
- 归属：`repos/vllm-omni/remote`
- 状态：已验证
- 搜索词：跑 TP=2 要避开测试 helper 的全局 GPU cleanup/占卡假设
- 影响范围：repos/vllm-omni/remote
- **症状**：用户要求 `tp=2 2,3卡`，但初次跑 pytest helper 仍等待 GPU 0/1/2/3 全部低于 5% 显存，且之前 0/1 上有别人的 TTS vLLM 服务；后来测试结束时 helper 还尝试清理它识别到的 `VLLM::StageEngineCoreProc`。
- **根因**：测试 helper 的 GPU memory monitor / residual vLLM cleanup 是全局 0..N 视角，不知道当前 YAML 只用 devices `2,3`。Hunyuan stage config 控制运行设备，但 pytest fixture 的 pre/post cleanup 仍看整机。
- **解法**：
  - 按用户要求生成临时 YAML，把 `devices: "0,1,2,3"` 改成 `"2,3"`，`tensor_parallel_size: 4` 改成 `2`。
  - 跑前用 `nvidia-smi --query-compute-apps` 和 `pgrep -af` 明确哪些进程是自己的，哪些是别人的服务。
  - 如果 0/1 有他人服务，不要主动 kill；如果 helper 最后 kill 了残留，要在汇报里说明。
- **怎么避免**：
  1. 跑非全卡测试前，明确区分三层设备配置：YAML `runtime.devices`、`tensor_parallel_size`、pytest helper cleanup 的全局 GPU 视角。
  2. 看到 pre-test monitor 等 0/1 卡，不要误判 TP=2 没生效；看 stage log：`Stage-0 set runtime devices: 2,3` 才是运行路径证据。
  3. 多用户机器上，`pkill -f vllm` 这种全局命令禁用；只 kill 自己刚启动的 PID / stage proc。
