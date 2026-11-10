---
name: debug-basics-1
description: Remote Debug 基础策略（第 1/2 部分）：默认执行顺序、远端 Bash 脚本 fail-closed 投递门禁、调试不走 commit-push-pull、环境侦察、HF cache 结构、tmux / docker exec 陷阱、减少 SSH 次数
metadata:
  scope: 只收远端调试的默认执行顺序、Bash 脚本投递门禁、侦察与 SSH/tmux/docker exec 陷阱；import gate、diffusion 串行表述和 issue 复现实践归 debug-basics-2
---
# Remote Debug · 基础策略（第 1/2 部分）

## 现状

- 本页是源页 `debug-basics.md` 的前半部分（“默认执行顺序”到“减少 SSH 次数”）；后半部分（“远端重建 venv / benchmark 先过 import gate”起）在 [[debug-basics-2]]。

## 关键事实

- 源页：`knowledge/general/remote/guides/debug-basics.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: general, remote；created: 2026-07-10；updated: 2026-07-10；sources: 无

### 默认执行顺序

- 远端任务先按下面的机制推进，再读具体事故细节：

1. **侦察**：确认 worktree/head、venv/import、cache root、模型/config 文件和当前 endpoint 支持的 CLI 参数。
2. **本地化试错**：调试阶段优先远端临时脚本 / one-liner，不用 commit-push-pull 当调试循环。
3. **脚本化复杂命令**：PowerShell -> SSH -> bash 的复杂命令必须落脚本；Bash 脚本完整执行下面的 fail-closed 投递门禁，其他解释器使用自己的语法检查。
4. **import gate**：新 venv、重装依赖、换节点或 benchmark 前，先验证 `torch/vllm/vllm_omni/transformers/flashinfer` import 和版本。
5. **状态汇报**：远端 issue 复现只汇报 server/client 双日志和 server-side signature，不把“命令跑过”当复现成功。

### 远端 Bash 脚本投递必须失败关闭

- Windows 或 PowerShell 产生的 Bash 脚本在远端执行前，必须同时过这四道门。Python、PowerShell 或其他解释器的脚本必须改用对应的语法/编译检查，不得套 `bash -n`。

1. `test -s` 机器判定文件非空，`wc -c` 只记大小，`sed -n '1,40p'` 证明实际内容和目标一致。
2. 检查并去除 UTF-8 BOM 和 CRLF；`bash -n` 抓不住所有 shebang/BOM 问题，不能单独当编码证据。
3. `bash -n <script>` 必须通过。如果合同是直接执行 `./script`，还必须验证允许的 Bash shebang 和可执行权限；合同是 `bash script` 时不伪造 shebang 要求。
4. 脚本要么使用 `set -euo pipefail`，要么显式捕获并验证每个阶段的返回码。两者都没有时，后面的命令成功不能让整个 preflight 变成 PASS。

- 最小检查示例：

```bash
set -euo pipefail
script=/tmp/run_x.sh
test -s "$script"
wc -c "$script"
sed -n '1,40p' "$script"
first3=$(od -An -tx1 -N3 "$script" | tr -d ' \n')
if [ "$first3" = efbbbf ]; then
  echo "UTF-8 BOM found in $script" >&2
  exit 1
fi
if grep -n $'\r$' "$script"; then
  echo "CRLF found in $script" >&2
  exit 1
fi
bash -n "$script"

# 后续直接执行脚本路径时，显式设 DIRECT_EXECUTE=1。
if [ "${DIRECT_EXECUTE:-0}" = 1 ]; then
  case "$(head -n 1 "$script")" in
    '#!/bin/bash'|'#!/usr/bin/bash'|'#!/usr/bin/env bash') ;;
    *) echo "unsupported Bash shebang in $script" >&2; exit 1 ;;
  esac
  test -x "$script"
fi
```

- 任何验证或编码错误，以及直接执行合同下的 shebang/权限错误，都必须先修正再执行。
- 使用 `bash <script>` 时 shebang 不参与解释器选择，但 BOM、CRLF、语法和错误处理门禁仍必须通过；脚本最后 exit 0 不能覆盖早先的门禁失败。

### 核心原则

- **git commit-push-pull 是部署手段，不是调试手段**。每轮"本地改 → push → 远端 stash → pull → run"5-10 分钟，6 轮就是 30-60 分钟。
- 判据：你的 commit message 是 "fix attempt N" → 你在用部署流程做调试，**立刻停下来换策略**。
- **正确做法**：
  - 调试：远端直接写 `/tmp/test_xxx.py` 或 Python one-liner，tmux 里跑，快速迭代
  - 确认方案后：回本地写正式代码，**一次** commit-push-pull 部署

### HF cache 结构备忘

- 路径：`$HF_HOME/hub/models--{org}--{name}/snapshots/{hash}/`
- `refs/main` 可能不存在（手动下载或旧版 CLI 不创建）
- `try_to_load_from_cache(revision=None)` 依赖 `refs/main` → 不可靠
- `snapshot_download` 返回的路径可能有 symlink 问题
- **最可靠 fallback：手动遍历 snapshots/ 目录找文件**

### Plan 拆分

- Plan 按当前任务拆，不要把未来工作混进来。当前任务是 X 就只 plan X——过大的 plan 导致认知负担重 + 每次读 plan 烧 context。

### 减少 SSH 次数

- 每次 SSH（ASKPASS + capture-pane）~500 token，6 轮调试 × 每轮 3-5 次 = 大量浪费在重复模板。
  - 合并 SSH：一次发多条命令（`&&` 或脚本）
  - 减少 capture 频率：合理估算等待时间，不要频繁轮询
  - 复杂操作写远端脚本一次执行
  - 新终端接手远端任务时，先从当前会话/issue/PR 摘 5 行 runbook（head sha、worktree、venv、tmux、out_dir），不要把已知远端重新 `find` 一遍。
  - 已知有 `<REMOTE_WORK_ROOT>/wt-...` worktree 时，先 `git -C <dir> status` / `rev-parse HEAD` 验证事实；只有不一致才扩大搜索。
  - PowerShell 管道可能因 CRLF/BOM 让路径检查变脏；看到“文档路径不存在”这类结论，先用无 BOM/LF 聚合脚本复查。

## 决策与踩坑

### 接入新模型/新组件前必先做环境侦察

- **反例（2026-04-21 tokenizer 6 轮失败链）**：

1. `AutoTokenizer.from_pretrained` → 没 `auto_map`（**没看 tokenizer_config.json**）
2. `PreTrainedTokenizerFast.from_pretrained` → transformers 版本 bug（**没查远端版本**）
3. `get_class_from_dynamic_module` → `HF_HUB_OFFLINE=1` 断网（**忘了离线约束**）
4. `snapshot_download` → symlink 解析失败（**不了解 HF cache 结构**）
5. `try_to_load_from_cache` → 依赖 `refs/main` 不存在（**同上**）
6. 手动遍历 HF cache 目录 → 成功（**应该是第 1 步**）

- 如果第 1 步花 5 分钟收集信息：

```bash
# 一次 SSH 全收集
cat $HF_HOME/hub/models--XXX/snapshots/*/tokenizer_config.json
ls $HF_HOME/hub/models--XXX/refs/                  # refs/main 是否存在
ls $HF_HOME/hub/models--XXX/snapshots/*/tokenizer*
pip show transformers | grep Version
python -c "from transformers import AutoTokenizer; AutoTokenizer.from_pretrained('XXX')"
```

- 就能一次性发现所有阻塞点，直接跳到最终方案。

### tmux / docker exec 陷阱

- **tmux 前台进程陷阱**：`python ... | tee log` 占住 shell，`send-keys` 发的命令进了进程 stdin。测试 API 必须从**另一个 window** 发请求
- **docker exec 跨节点引号陷阱**：`ssh nodeA "docker exec $(docker ps -q) ..."` 的 `$()` 在本地展开 → 必错。解法：写脚本到 Lustre，然后 `ssh nodeA bash /shared/path/script.sh`
- **远端发命令后必先短 sleep（≤5s）+ capture 确认脚本真启动了**（看到 pytest `collected N items` / 程序日志 / 明确错误信息），再长 sleep 等结果。光看 shell 回显不算
- **PowerShell→SSH→bash 脚本投递陷阱**：`$VENV` / `$()` 可能被本地 PowerShell 展开，UTF-8 BOM 会污染首行，脚本甚至可能落成 0 字节。
  - 远端落盘后必须完整执行本页的 canonical fail-closed 投递门禁（上文“远端 Bash 脚本投递必须失败关闭”一节），不使用弱化三连代替。
- **路径猜测陷阱**：HF snapshot 只代表权重/processor 资产，不代表 vLLM-Omni deploy yaml。
  - 写远端脚本前先 `find <REMOTE_WORK_ROOT> ... -name "*hunyuan*yaml"` 和 `test -f "$MODEL_CFG"`，不要假设 snapshot 下有 `deploy.yaml`。
- **旧 PR venv/ABI 陷阱**：base commit 不一定兼容当前默认 venv。
  - 测旧 PR 先跑 base worktree 的 import/init smoke，确认 custom op / scheduler symbol / vLLM version 匹配；base 起不来时结论是 environment blocker，不是 PR 性能数据。
