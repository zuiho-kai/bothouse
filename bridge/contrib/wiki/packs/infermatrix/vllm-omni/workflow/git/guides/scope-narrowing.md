---
name: scope-narrowing
description: "PR Workflow 第 7 节：reviewer 要求收窄 scope 时先做 diff gate、废弃路线全删，20 条硬规则（HunyuanImage3 perf JSON stage_config_name、cwd 独立路径、证据三层、cache-root gate）与 PR #3819 事故来源"
metadata:
  scope: 只收 scope 收窄与 diff gate 的触发条件、硬规则、验收标准与事故；分支/push/rebase 归 branch-push-rebase-1、branch-push-rebase-2、branch-push-rebase-3，PR body 证据归 pr-body-evidence，入口路由归 pr-workflow
---
# PR Workflow · Scope 收窄与 diff gate

## 关键事实

- 源页：`knowledge/repos/vllm-omni/git/guides/scope-narrowing.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: vllm-omni, git；created: 2026-07-10；updated: 2026-07-16
- 来源（sources）：#3483；#3819

### 7. Reviewer 要求收窄 PR scope 时，先做 diff gate，废弃路线全删

- **触发条件**：
  - Reviewer / 用户说“改动太大”、“预期只是新增/使用 deploy config”、“参考另一个 PR 收窄”。
  - 用户纠正 PR 编号或指出当前方案走了废弃 route。
- **硬规则**：
  1. PR 编号被纠正后，立刻重新读真实目标 PR，不能沿用上一个 PR 的结论。
  2. 动手前和 push 前都跑 diff gate：

     ```bash
     gh pr diff <pr> --name-only
     git diff --name-only origin/main...HEAD
     git log --oneline origin/main..HEAD
     ```

  3. 如果 reviewer 期望 config-only，PR diff 里只能剩 config 文件。pipeline code、runner code、测试、fallback helper 都删掉，除非 reviewer 明确点名要保留。
  4. 废弃 route 要完全 demote，不能嘴上说不用但代码里还留着。
  5. 先确认 main 上已有 deploy YAML；已有就复用，不在 PR 里重写 topology。HunyuanImage3 DiT perf JSON 使用 `stage_config_name: hunyuan_image3_dit.yaml`，由 perf runner 从 repo 的 `vllm_omni/deploy` 目录解析成绝对路径。禁止在这些 JSON 里写相对 `serve_args.deploy-config: vllm_omni/deploy/...`；直接跑 pytest / runner 时 cwd 不稳定，会把相对路径解析错。
  6. 避免 PR #3483 类 diffusion parallel CLI override bug：不要把 `tensor-parallel-size`、`cfg-parallel-size`、`usp` 放进这些 HunyuanImage3 perf JSON 的 `serve_args`。每个 case 的 TP/SP/CFGP 差异放到 `server_params.stage_overrides["0"].parallel_config`。
  7. 解释删文件时直接说“这是支撑废弃路线的额外 scope”。例如 `tests/diffusion/models/hunyuan_image3/test_generation_config.py`、`tools/nightly/run_nightly_jobs.sh`、`pipeline_hunyuan_image3.py` 如果只是为了 fallback / runner 扩展存在，就必须从窄 PR 里移除。
  8. 远端精度 / perf 验证和 scope repair 分开。远端验证失败不能成为往 config-only PR 里加 pipeline/test/runner 改动的理由。跑远端前确认 GPU 空闲；中断或失败后确认 PID 退出、GPU 释放。
  9. 用户问“为什么要加 X，能不能不加”时，先正面回答“能/不能 + 为什么”，再动手删。不要用后续 push 代替解释。
  10. PR 已经被用户指出“还存在 X”时，不能只看本地 diff；必须同时查 GitHub PR diff、local `origin/main...HEAD`、PR head SHA 三者是否一致，避免本地收窄了但远端没更新或用户看到的还是旧 diff。
  11. 远端验证前先判断它是否和本次 scope 有关。config-only PR 的远端精度失败通常只能作为环境/验证记录，不能反向扩大 PR 内容。
  12. 远端已有旧 worktree 时，不复用脏目录。新建本次专用 worktree前，若 `git diff origin/main...HEAD` 出现大量无关文件，先检查 base/ref 是否陈旧；不要把这种噪音当成 PR diff。
  13. PowerShell -> SSH 的复杂命令禁止现场拼带 `|`、`(`、`)`、`grep -E` 的一行字符串。Bash 命令必须落脚本并完整通过 canonical fail-closed 投递门禁（源链接 `../../../../general/remote/guides/debug-basics.md#远端-bash-脚本投递必须失败关闭`），否则容易把 regex 管道在远端 shell 展开成挂起进程或错误命令。
  14. 远端进程检查不要用宽泛 `pgrep -af "a|b|c"` 这类会被 shell 吃掉的模式；分开查具体 pid / repo path / session name。任何 timeout 后先 kill 自己刚制造的查询残留。
  15. 远端测试被用户中断后，第一优先级是确认资源释放：pid file、`ps -p <pid>`、GPU 4/5/6/7 memory、自己启动的 StageDiffusion/Worker 进程。确认后再回答。
  16. 规则落盘位置必须跟项目框架一致。通用规则写 `general/`，vLLM-Omni 规则和错题写 `repos/vllm-omni/`；不要写用户个人 Codex memory。
  17. 如果用户说“规则化”，不是写一条漂亮总结；要写可执行 gate：触发条件、禁止事项、命令、验收标准、事故来源。少于这些维度很可能还是复盘聊天，不是规则。
  18. Config-only perf PR 里凡是把 repo 内 YAML / JSON / asset path 放进 CLI 参数，push 前必须做“cwd 独立”验证：从 runner 入口追到 `subprocess.Popen(cwd=...)` 或真实启动命令，确认最终传入的是绝对路径；否则必须改成现有 resolver 字段或在 runner 层 resolve。只做 `json.tool` / ruff / `Path.exists()` 不够，因为它们不会模拟直接运行时的 cwd。
  19. 结论必须按证据层级说清楚，禁止把单点修复说成 full run pass。最少分三层：
      - `path/参数层已修`：runner 拼出的 CLI / JSON / absolute path 已验证。
      - `server startup 已过`：真实 server 起起来并加载 tokenizer / weights。
      - `request smoke 已过`：至少 1 prompt / 1 step 真请求完成，pytest exit 0。只有第三层过了，才能对用户说“能跑”；前两层只能说“对应问题已修，完整运行待验证”。
  20. 远端 HunyuanImage3 验证前先做 cache-root gate，不能凭默认 HF cache 下结论：

      ```bash
      for root in /data/model/hub /data/models/hub /root/.cache/huggingface/hub; do
        target="$root/models--tencent--HunyuanImage-3.0-Instruct"
        [ -d "$target" ] || continue
        echo "CACHE=$target"
        find -L "$target" -maxdepth 8 -type f | grep -Eic 'safetensors|\.bin$|\.pt$|model\.safetensors\.index\.json'
        du -sh "$target" 2>/dev/null || true
      done
      ```

      - B3 (`<REMOTE_HOST>:31449`) 上 2026-05-29 的完整 cache 是 `/data/model/hub`（约 158G）；`/root/.cache/huggingface/hub` 只有 config/tokenizer 和 `.incomplete` blobs，不能据此报“缺权重”。跑 HunyuanImage3 smoke 时显式 `export HF_HUB_CACHE=/data/model/hub`。
- **验收标准**：
  - PR diff 文件列表和 reviewer 期望的窄 scope 一致。
  - 没有废弃 key 或 cwd 相关相对路径。
  - 没有旧 CLI parallel override。
  - 小 config fix 最终是一条 intentional signed-off commit。
  - 用户指出的每个文件都能在 GitHub PR diff 里验证“不在 diff”。
  - 远端验证的状态能说明：命令、机器、worktree、pid、日志、是否释放 GPU、使用的 HF cache root、结论属于 path/server/request 哪一层。
  - 规则落盘位置在框架仓库内，且 `git diff` 只包含预期知识文件变更。

## 决策与踩坑

### 7. Reviewer 要求收窄 PR scope 时，先做 diff gate，废弃路线全删

- **事故来源**：PR #3819 先把 HunyuanImage3 perf 修复扩散到了 `pipeline_hunyuan_image3.py`、`tests/diffusion/models/hunyuan_image3/test_generation_config.py` 和 `tools/nightly/run_nightly_jobs.sh`，后来按 reviewer / 用户要求收窄到 3 个 perf JSON。过程中还暴露了：用户问原因时解释不够直接；远端精度验证和 config scope 混在一起；第一次远端跑被旧残留进程污染；
  - PowerShell/SSH grep quoting 产生错误命令和挂起查询；规则第一次误写到 Codex 全局 memory。2026-05-29 又暴露了更具体的问题：为了收窄 scope，把 `hunyuan_image3_dit.yaml` 写进 `serve_args.deploy-config` 的相对 CLI 参数，静态检查和本地 path check 都通过，但 reviewer 直接运行时 cwd 不同导致 config path 找不到；
  - 正确做法是让 JSON 使用 `stage_config_name`，并让 `tests/dfx/perf/scripts/run_benchmark.py` 的 `DEPLOY_CONFIGS_DIR` 指向 repo 内 `vllm_omni/deploy`，最终传绝对 path。后续我又把“path 问题已修”说成“能跑”，没有区分 path 层、server startup 层、request smoke 层；真实启动才暴露 `TokenizerWrapper` 未透传 `trust_remote_code/revision`。
  - 远端验证时又默认用了 `/root/.cache/huggingface/hub`，误判缺权重；用户指出 `/data/model/hub` 后，使用完整 158G cache 真跑 1 prompt / 1 step 通过。类似情况以后按本节 gate 先收敛，再验证 cwd 独立路径，再做真实 smoke，并在回答里标明证据层级和 cache root。
