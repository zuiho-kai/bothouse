---
name: 2026-05-20-remote-venv-and-cleanup-02
description: 2026-05-20 远端错题，用户明确说新建 venv 仍做环境考古，及三起追加事故（误删要保留的 venv、独立 venv 过大、CPFS 长删除卡住）与硬规则
metadata:
  scope: 只收 2026-05-20 复现 vLLM-Omni issue 3743 时的 venv 新建与远端清理系列事故、解法命令和硬规则；cp 复制 venv 事故归 2026-05-14-remote-venv-and-cleanup-01
---
# 2026-05-20 — 用户明确说新建 venv 时，不要继续环境考古

## 关键事实

- 源页：`knowledge/general/remote/incidents/2026-05-20-remote-venv-and-cleanup-02.md`（InferMatrixCopilot@ecfb84d0）；源页无 frontmatter（无 type / tags / created / updated / sources）
- 编号：`inc-2026-05-20-remote-venv-and-cleanup-02`
- 归属：`general/remote`
- 状态：已验证
- 搜索词：用户明确说新建 venv 时，不要继续环境考古
- 影响范围：general/remote

## 决策与踩坑

### 2026-05-20 — 用户明确说新建 venv 时，不要继续环境考古

- **症状**：用户要求到 `ssh root@<REMOTE_HOST> -p 31449` 复现 vLLM-Omni issue #3743。
  - 发现没有合适现成环境后，用户明确说“没有就新建一个”，我仍继续扫已有 venv / worktree / 模型路径，还尝试复用旧环境；
  - 随后用户进一步明确“直接新建venv，然后uv pip install vllm==0.21.0，然后venv名字改一下叫vllm0.21.0”。
  - 中间浪费多轮 SSH 往返，还踩了 PowerShell 引号、tmux 不存在、PID 写成字面量 `$!` 等噪音。

- **根因**：
  - 违反 P2/B4：用户已经给了明确技术方案（新建 venv），我却把“环境侦察要充分”误用成继续找现成路径。
  - 把“复现 issue”拆成了过大的隐式目标，试图一次性确认 repo、venv、模型、服务、benchmark，全都并行摸索；但当前真正 blocker 只有一个：没有匹配 `vllm==0.21.0` 的独立环境。
  - 远端慢机器上小命令过多，每条 SSH 往返都在放大错误；而且没有先把下一条命令压缩成单个最小脚本。
  - 对用户“没有就新建一个”的语义响应不够字面：这句话在 venv 场景下就是 `uv venv <path>` + `uv pip install <exact package>`，不是“再找一个可能能用的旧 venv”。

- **解法**：当用户明确给出 venv 创建方案，直接执行以下最短闭环：

```bash
cd /tmp
uv venv <REMOTE_WORK_ROOT>/vllm0.21.0 --python python3.12
uv pip install --python <REMOTE_WORK_ROOT>/vllm0.21.0/bin/python 'vllm==0.21.0'
<REMOTE_WORK_ROOT>/vllm0.21.0/bin/python - <<'PY'
import torch, vllm
print("torch", torch.__version__, torch.version.cuda, torch.cuda.is_available(), torch.cuda.device_count())
print("vllm", vllm.__version__)
PY
```

- 如果安装要长跑，用 `nohup` 可以，但 PID 写法必须放在远端 shell 中，不让 PowerShell 本地展开：

```bash
nohup bash /tmp/create_vllm0210_venv.sh > /tmp/repro3743_install.nohup.log 2>&1 < /dev/null &
echo $! > /tmp/repro3743_install.pid
sleep 5
tail -80 /tmp/repro3743_install.log
```

- **怎么避免**：
  1. 用户给明确命令 / 包名 / 路径时，先执行字面方案；除非会破坏共享资源，否则不要自作主张先找替代路径。
  2. 远端复现缺 venv 时，最多做 1 次轻量确认（`test -d <target>` / `command -v uv` / `python --version`），然后立刻 `uv venv`。不要全盘 `find /data /home /root` 找旧 venv。
  3. 把“环境侦察”限制在当前 blocker 的最小集合：创建 venv 只需要确认 `uv`、Python、目标目录、磁盘空间；服务复现才需要模型和 YAML。
  4. PowerShell → SSH 长命令容易展开 `$!` / `$VAR`；凡是涉及后台进程、here-doc、环境变量的远端动作，先落 `/tmp/*.sh`，执行前固定 `wc -c` + `sed -n '1,80p'` + `bash -n`。
  5. 没有 `tmux` 不是 blocker；用 `nohup + pid + log`，但必须确认 pid 文件不是字面量 `$!`，并用 `ps -p "$(cat pid)"` 或日志增长验证。
  6. 被用户指出“太浪费时间”后，立即停止扩散侦察，复述最短路径并执行；不要再解释环境复杂性来给绕路找台阶。

- **对我的硬约束（用户追问“我要你怎么避免”后的补充）**：
  1. 每次远端任务先写一句“当前 blocker 是什么”。如果 blocker 是“没有 venv / venv 不匹配”，只做建环境，不同时展开模型、benchmark、旧 worktree、历史 venv。
  2. 用户句式命中“直接 X / 没有就新建 / 装 Y / 名字叫 Z”时，自动进入字面执行模式：只做破坏性/冲突检查，然后执行；禁止把“先确认一下有没有现成的”当成默认步骤。
  3. 远端机器慢时，禁止碎片化 SSH 侦察。多步命令必须合成一个 `/tmp/*.sh`，执行前检查脚本内容，执行后只看 pid/log/版本验证三类证据。
  4. 用户第一次纠正我的路线后，立即切到用户方案；不继续证明原路线“也有道理”，不再找第二个替代方案。
  5. 复现链路按 blocker 串行推进：`venv OK` → `vllm import OK` → `vllm-omni import/entrypoint OK` → `server start OK` → `benchmark OK`。前一步没 OK，不碰后一步。

### 追加事故：清理远端目录时把“要保留的 venv”放进删除列表

- **症状**：用户要求保留刚建的 venv、清理其他点名文件，我却把保护对象也加入递归删除列表。用户中断后，旧清理进程仍在运行，造成 venv 被半删并需要重建。

- **根因**：
  - 没有先把用户语义拆成两张白名单：`KEEP` 和 `DELETE`。听到“清理”就按自己假设删，违反 P2。
  - 删除命令没有做“保留项不得出现在删除列表”的机械校验。
  - 用户刚刚已经因为绕路不满，我仍然用了大脚本批量删除，且没有先最小化到用户点名的文件。

- **硬规则**：
  1. 远端清理必须先写两行计划并自检：`KEEP=(...)`、`DELETE=(...)`。`KEEP` 和 `DELETE` 求交集非空时直接 abort。
  2. 用户说“只保留 X”时，`X` 是最高优先级保护对象；任何递归删除计划包含 `X` 都是 P0 错误。
  3. 删除范围默认只包含用户点名的路径；不要顺手删 cache、脚本、venv、worktree，除非用户明确点名或确认。
  4. 大目录删除前先 `ps` 确认没有旧 cleanup 在跑；中断过的清理任务必须先 kill 旧 `rm` / cleanup，再做下一步。
  5. 不要用“我来清理无用产物”扩展成“清空整个目录”。用户说清空时才清空；用户说保留 venv 时，先保护 venv。

### 追加事故：独立 venv 过大，没先解释依赖来源

- **症状**：我用：

```bash
uv venv <REMOTE_WORK_ROOT>/vllm0.21.0 --python python3.12
uv pip install --python <REMOTE_WORK_ROOT>/vllm0.21.0/bin/python 'vllm==0.21.0'
```

- 结果 venv 非常大。用户问“为什么别人 venv 那么小，你下载那么大”，我又开始远端查进程/目录，继续浪费时间。

- **根因**：答案其实很直接：完整独立安装会把 `torch`、CUDA runtime、cuDNN、cuBLAS、NCCL、triton、flashinfer 等大 wheel 全部装进 venv；
  - 别人小 venv 多半是 `--system-site-packages` 复用系统大依赖，或 `--no-deps` 只装 vLLM 本体。
  - 我没有先给这个核心解释。

- **以后默认小 venv 做法**：

```bash
uv venv <REMOTE_WORK_ROOT>/vllm0.21.0 --python python3.12 --system-site-packages
uv pip install --python <REMOTE_WORK_ROOT>/vllm0.21.0/bin/python --no-deps 'vllm==0.21.0'
<REMOTE_WORK_ROOT>/vllm0.21.0/bin/python - <<'PY'
import torch, vllm
print("torch", torch.__version__, torch.version.cuda)
print("vllm", vllm.__version__)
PY
```

- 如果 import 缺依赖，再按报错补最小缺项；不要默认完整下载整个 CUDA/PyTorch 栈。只有用户明确要求“完全独立 venv / 不依赖系统 site-packages”时，才允许完整 `uv pip install vllm==...`。

- **一句话防再犯**：远端环境任务先保护用户要保留的东西，再删用户点名的东西；建 venv 默认复用系统大依赖，除非用户明确要求全独立。

### 追加事故：长时间删除卡住却没有进度感知

- **症状**：用户要求清理已确认的工作根后重建小 venv。我对目录执行了宽泛递归删除，远端 CPFS 对大量旧文件返回 `Stale file handle` 和 `Device or resource busy`。命令运行数分钟后失败，而我没有在 30 秒内主动判断删除阶段卡住。

- **根因**：
  - 把递归删除当成一定会快速结束的原子步骤，没有给长删除设置进度观测和超时切换策略。
  - CPFS / 网络文件系统上的大目录删除很容易被 stale handle / busy file 卡住，不能用本地 ext4 的直觉。
  - 任务目标是“让 `<REMOTE_WORK_ROOT>` 变干净并重建 venv”，不一定要求同步物理删除旧内容；我没及时切换到 `mv <REMOTE_WORK_ROOT> <REMOTE_WORK_ROOT>.trash-<ts> && mkdir <REMOTE_WORK_ROOT>` 的快路径。

- **正确处理**：
  1. 清空远端大目录前，先优先考虑 rename 快路径：
     ```bash
     mv <REMOTE_WORK_ROOT> <REMOTE_WORK_ROOT>.trash-$(date +%Y%m%d-%H%M%S)
     mkdir -p <REMOTE_WORK_ROOT>
     ```
     先交付干净目标目录，再后台慢删 trash。
  2. 如果确实需要物理删除，必须逐个使用已确认的绝对路径，并持续观察进度；30 秒仍无进度或出现 `Stale file handle` / `Device or resource busy` 时立即停止并报告。
  3. 看到 `Stale file handle` 不是“再等等”的信号，而是网络文件系统元数据状态坏了；继续等通常只会浪费时间。
  4. 用户问“是不是卡了”之前，我应该主动汇报：当前卡在删除阶段，错误是 stale/busy，改用 rename 快路径。

- **硬规则**：
  - 远端大目录清理的 SLA：30 秒内必须给出阶段状态（deleting / moved / installing / verifying）。
  - 删除不是业务目标，干净目录才是目标；能 rename 就 rename，不把用户时间耗在物理删除上。
  - 任何长命令输出出现 `Stale file handle` / `Device or resource busy`，立即判定当前 `rm` 路线失败，kill/停止后换方案。
