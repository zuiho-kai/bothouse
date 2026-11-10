---
name: 2026-05-18-remote-runtime-gpu-04
description: 2026-05-18 错题：只看 nvidia-smi memory.used 为 4 MiB 就报 4 卡全空，HunyuanImage3 4 卡 deploy 后 DiT 在 GPU 2,3 OOM；根因是他人进程刚 spawn 尚未加载模型，解法是 memory.used、compute-apps、ps 三件套同查
metadata:
  scope: 只收 2026-05-18 GPU 占用判断漏掉潜伏进程这一起事故；TP=2 指定卡与 helper 全局 cleanup 冲突归 2026-05-18-remote-runtime-gpu-03
---
# 2026-05-18 — GPU 占用判断只看 memory.used 漏了潜伏中的别人进程

## 关键事实

- 源页：`knowledge/repos/vllm-omni/remote/incidents/2026-05-18-remote-runtime-gpu-04.md`（InferMatrixCopilot@ecfb84d0）；源页无 frontmatter

## 决策与踩坑

- 编号：`inc-2026-05-18-remote-runtime-gpu-04`
- 归属：`repos/vllm-omni/remote`
- 状态：已验证
- 搜索词：GPU 占用判断只看 memory.used 漏了潜伏中的别人进程
- 影响范围：repos/vllm-omni/remote
- **症状**：`nvidia-smi --query-gpu=memory.used` 全是 4 MiB，自信报"4 卡全空"，启动 HunyuanImage3 4 卡 deploy 之后 DiT 在 GPU 2,3 OOM；查 compute-apps 才发现别人有 `end2end.py text2img` 已经 spawn 但 model 还没完全 load（瞬时只占几 MB）。前后浪费 ~5 分钟用户问"我看没人跑"才回头复查。
- **根因**：`memory.used` 是 PyTorch reservation 的瞬时值，进程启动到 model load 之间有几十秒 GPU 几乎空。判断 GPU 是否"我的"必须同时看：
  - `nvidia-smi --query-gpu=memory.used` —— 当下已分配
  - `nvidia-smi --query-compute-apps=pid,process_name,gpu_uuid,used_memory` —— 已注册到 driver 的进程
  - `ps -ef | grep -E "(hunyuan|end2end|vllm|VLLM::)"` —— 包括刚 spawn 还没 attach kernel 的 python 进程
- **解法**：跑前三件套并行查；用 `nvidia-smi --query-gpu=index,uuid` + compute-apps 的 gpu_uuid 列做映射，确认哪个物理 GPU 是哪个 worker 的。
- **怎么避免**：
  1. 远端跑 GPU job 前必跑"三件套"：`memory.used` + `compute-apps` + `ps -ef | grep python`，缺一不可。
  2. 不要在用户说"全空"之后跳过自查。用户可能基于上一刻看到的状态，跟你眼下抢卡的窗口不重叠。
  3. 三件套写成脚本，会话开头跑一次：`bash gpu_owner_check.sh`，输出三类一起看。
