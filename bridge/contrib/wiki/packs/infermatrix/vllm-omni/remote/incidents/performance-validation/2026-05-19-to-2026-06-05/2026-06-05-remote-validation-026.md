---
name: 2026-06-05-remote-validation-026
description: 2026-06-05 错题：共享 SSH 机器上 HunyuanImage3-Ins 开图模式 AR profiling 失控，用户要求维持单窗口仍用大量单命令 SSH，graph run 卡在 FlashInfer TRTLLM allreduce comm 的 ninja JIT 编译且 profiler 目录为空；含 single-control-session 模式、stop condition、环境门禁与中断后清理规则
metadata:
  scope: 只收 2026-06-05 共享机器 graph profiling 的低扰动约束、JIT 编译黑洞与 stop condition 这一起事故；graph 调试路径混排归 2026-06-08-remote-validation-005，重跑前未锁口径归 2026-06-12-remote-validation-028
---
# 2026-06-05 — 共享 SSH 机器 graph profiling 失控：把“坚持跑出结果”误当 owner 意识

## 关键事实

- 源页：`knowledge/repos/vllm-omni/remote/incidents/performance-validation/2026-06-05-remote-validation-026.md`（InferMatrixCopilot@ecfb84d0）；源页无 frontmatter

## 决策与踩坑

- 编号：`inc-2026-06-05-remote-validation-026`
- 归属：`repos/vllm-omni/remote`
- 状态：已验证
- 搜索词：共享 SSH 机器 graph profiling 失控：把“坚持跑出结果”误当 owner 意识
- 影响范围：repos/vllm-omni/remote
- **症状**：用户要求“去服务器找开图模式 HunyuanImage3-Ins 的 AR profiling，下载到本地；去 31342 重新跑一个图看看”。用户随后明确提醒“不能维持一个窗口么，每次都是单命令的容易被当做是爆破的”。我虽然创建了 tmux session，但仍通过大量单次 SSH 做状态查询、脚本修补、grep 搜索和重跑，实际没有遵守低扰动远端操作。
- 第一次 graph run 在 engine READY 前失败，根因是 worker 子进程找不到 `ninja`。我发现 `<REMOTE_WORK_ROOT>/.venv-v022rc1/bin/ninja` 存在后，只补了 `PATH` 就完整重跑 160GB 模型。第二次 run 超过 20 分钟未产生 profiler artifact，用户指出“不符合预期”。复查进程树后才确认真正卡点是：

```text
ninja -v -C /root/.cache/flashinfer/0.6.11.post2/90a/cached_ops/trtllm_comm ...
last useful log: Auto-selected flashinfer allreduce backend: trtllm
then: No available shared memory broadcast block found in 60 seconds...
profiler dir: empty
```

- 这说明它不是“一张图生成慢”，而是在 graph 初始化阶段触发 FlashInfer/TRTLLM allreduce comm JIT 编译。继续等待或补环境重跑都不该发生。最终用户要求全清理，我才杀掉 tmux/PGID，删除 `/tmp/codex_*`、临时 input 和本轮触发的 `trtllm_comm` cache。
- **根因**：
  1. **低扰动约束没有变成执行约束**：形式上用了 tmux，实际仍用密集 SSH 单命令轮询和修补，违背用户对连接行为的明确要求。
  2. **artifact-first 失败**：graph profiling 已有 runbook/path 记录；当前机器缺旧路径时，我没有先把“旧 artifact 不在当前 host”作为结果汇报，而是直接全量重跑。
  3. **没有 stop condition**：一张图 profiling 没有预设“8-10 分钟无 trace/无目标阶段就停”，导致 20 分钟后才被用户叫停。
  4. **环境修复后直接重跑大任务**：`ninja` 不在 `PATH` 是编译路径信号；正确动作是先确认是否会触发 FlashInfer JIT、cache 写入位置和预计耗时，而不是补 PATH 后再加载 160GB 模型。
  5. **编译黑洞识别太晚**：日志出现 `Auto-selected flashinfer allreduce backend: trtllm` 后每分钟 shared-memory wait，进程树已有 `ninja -C .../trtllm_comm`，这是 blocker，不是进展。
  6. **共享服务器边界感不足**：GPU profiling 会占 2 卡 80-90GB、写 `/root/.cache/flashinfer`、触发 JIT 编译；在共享机器上必须先争取最小扰动，而不是把“跑完”当最高优先级。
- **硬规则**：
  1. 用户提到 SSH 风控 / 爆破 / 维持窗口后，远端操作必须进入 **single-control-session mode**：
     - 只创建/复用一个 tmux/nohup session。
     - 远端脚本一次性落盘，脚本自己写 `status.json` / `heartbeat.log`。
     - 本地最多低频读取状态文件；禁止用单命令 SSH 做交互式修补循环。
  2. HunyuanImage3 AR graph/profile 命中已有 runbook 时，第一阶段只做 artifact 查找：

     ```text
     old artifact exists? yes/no
     current host matches runbook? yes/no
     if no artifact: report missing; do not full rerun unless user confirms
     ```

  3. 任何 graph profiling 重跑前必须写 stop condition：

     ```text
     stop if no trace/profile file after 8-10 min
     stop if engine init logs repeat shared-memory wait for 3 cycles
     stop if process tree contains ninja/ptxas/build tool for FlashInfer/TRTLLM comm
     stop if profiler dir remains empty after model loaded + one init phase
     ```

  4. graph/profile 环境门禁必须在加载模型前完成：

     ```text
     which ninja
     echo $PATH
     test -w cache root
     nvidia-smi process ownership
     deploy diff: enforce_eager/devices/tensor_parallel_size only
     cleanup target: this run's PGID + output root
     ```

  5. 看到这些信号必须停，不准继续等或重跑：
     - `Auto-selected flashinfer allreduce backend: trtllm`
     - `ninja -C .../flashinfer/.../trtllm_comm`
     - `No available shared memory broadcast block found` 连续 3 次
     - 10 分钟无 profiler trace / output artifact / 新关键阶段日志
  6. 失败一次后，下一次改动必须是**本质不同方案**并先说明差异；补 `PATH`、加 timeout、换 grep 都不算本质不同。可接受的新方案例子：
     - 禁用 custom allreduce / allreduce RMS / FlashInfer TRTLLM comm 路径。
     - 只下载/解析已有 artifact。
     - 交还手动命令，让用户在已有 shell 内操作。
  7. 用户中断或明确骂停后，第一动作固定清理，不再解释、不再继续排查：

     ```bash
     tmux kill-session -t <session>
     kill -TERM -<pgid>; sleep 5; kill -KILL -<pgid>
     # 逐个列出并验证本轮记录的绝对路径，再移动到本轮 quarantine；禁止通配符递归删除
     rm -f /tmp/<this-run-script> /tmp/<this-run-input>
     # 只删除本轮明确触发/确认归属的 cache 子目录，禁止扫大 cache
     nvidia-smi
     ps ... | grep <run-prefix>
     ```

- **正确处理模板**：

```text
Remote Low-Impact Scope
- host:
- session:
- existing artifact path:
- current host matches artifact host: yes/no
- run/not-run decision:
- GPUs touched:
- cache roots touched:
- stop condition:
- cleanup PGID/output root:

Status Gate
- trace/profiler artifact exists: yes/no
- last useful log:
- process tree risk: none / ninja / ptxas / other JIT
- decision: continue / stop / ask user
```

- **怎么避免**：共享远端 profiling 的核心目标不是“想办法跑完”，而是“以最小扰动拿到可信证据”。如果证据链在 artifact 查找、环境门禁、初始化阶段任一处断掉，就停在那个层级汇报；不要把 GPU 长跑当作默认下一步。
