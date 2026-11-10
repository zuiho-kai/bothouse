---
name: 2026-05-08-ci-and-testing-15
description: "2026-05-08 CI 错题 inc-2026-05-08-ci-and-testing-15，测 PR #3055 时手写 end2end.py 调用脚本连踩 FileNotFoundError 与 4 卡 OOM，正解是 PR 自带的 test_gebench_h100_smoke.py pytest 命令（4×L20X 7m10s PASS）"
metadata:
  scope: "只收 2026-05-08 测 PR #3055 时不用 PR 自带 pytest 用例而自写脚本的错题，含完整 pytest 命令和五条提醒；同一 PR 的 scope 误读归 2026-05-08-ci-and-testing-16，GEBench judge 满分问题归 2026-05-08-ci-and-testing-18"
---
# 2026-05-08 — 拿到"测一下 PR #3055"任务，自己手写 end2end 调用脚本而不用 PR 自带 pytest 用例

## 关键事实

- 源页：`knowledge/repos/vllm-omni/ci/incidents/2026-05-08-ci-and-testing-15.md`（InferMatrixCopilot@ecfb84d0）；源页无 frontmatter

## 决策与踩坑

- 编号：`inc-2026-05-08-ci-and-testing-15`
- 归属：`repos/vllm-omni/ci`
- 状态：已验证
- 搜索词：拿到"测一下 PR #3055"任务，自己手写 end2end 调用脚本而不用 PR 自带 pytest 用例
- 影响范围：repos/vllm-omni/ci
- **症状**：用户给了 <REMOTE_HOST> 节点 + "/mnt 模型 /rebase 环境 + PR #3055 出图打分有问题去测"。我把 PR #3055 当成"加 buildkite job"理解，clone main 后自己手写 `/tmp/run_hi3_t2i.sh` 调 `examples/.../end2end.py --modality text2img`，连续踩坑：
  1. `--stage-configs-path hunyuan_image3_t2i.yaml`（裸文件名）→ FileNotFoundError，error message 自带迁移指示「Legacy `stage_configs/` yamls were replaced by `vllm_omni/deploy/<model>.yaml`; use `--deploy-config`」我没读，又拼了一次绝对路径继续硬塞
  2. 第二次硬塞绝对路径加载成功，但 4 worker 在 4 卡上各自吃 ~110GB（不是真按 TP=4+EP 切），炸 OOM
  3. 我开始分析"DiT 80B 是不是 4×143GB 装不下"——用户怒了：「PR #3055 这个 PR 就是给用户一键跑测试的，你为什么直接写脚本，浪费我 token」
- **根因**：
  - 没把 PR #3055 当成**入口**而当成**配置增量**。PR 里 `tests/e2e/accuracy/test_gebench_h100_smoke.py` + `--gebench-extra-server-args` JSON + `--gebench-stage-overrides` JSON 已经把"如何起 server / 怎么传 dtype / TP / EP / executor backend / async chunk"全配好了，pytest 一行带完。我自写脚本用 `Omni()` 入口，把这些已知好的参数全部丢了，必然踩坑。
  - 用户在前一轮跟我聊的就是"这个 PR 的 CI 步骤"——`.buildkite/test-nightly.yml` 里那条 `pytest -s -v tests/e2e/accuracy/test_gebench_h100_smoke.py --gebench-model tencent/HunyuanImage-3.0-Instruct ...` 是 ground truth。我把这条命令从 buildkite 删了之后，**完全忘了那条命令本身就是怎么跑这个测试的说明书**。
  - FileNotFoundError 的 error message 自带"用 --deploy-config"指示，我没读 message 直接 sed 绕路。
- **解法**：直接用 PR 的 pytest 用例。git checkout PR 分支后：

```bash
pytest -s -v tests/e2e/accuracy/test_gebench_h100_smoke.py \
    --run-level full_model \
    --gebench-model tencent/HunyuanImage-3.0-Instruct \
    --accuracy-judge-model QuantTrio/Qwen3-VL-30B-A3B-Instruct-AWQ \
    --gebench-devices 0,1,2,3 --accuracy-gpu 0 --gebench-port 8094 \
    --gebench-samples-per-type 2 --gebench-num-inference-steps 28 \
    --accuracy-workers 1 --gebench-t2i-only \
    --gebench-stage-overrides '{"0":{"devices":"0,1,2,3","enable_expert_parallel":true,"max_num_seqs":1}}' \
    --gebench-extra-server-args '["--dtype","bfloat16","--gpu-memory-utilization","0.95","--enforce-eager","--trust-remote-code","--distributed-executor-backend","mp","--no-async-chunk"]'
```

- 4×L20X 143GB → loaded 57GB/卡 PASS in 7m10s；artifacts 在 `tests/e2e/accuracy/artifacts/gebench_<model>/`（PNG + summary.json + evaluations/type*.json + reasoning）
- **对未来的提醒**：
  1. 接到「测一下 PR」任务时**先问**：PR 是在加测试用例（pytest entrypoint）还是只加 CI step？前者直接 pytest 命令照搬，禁止重写 inference 入口
  2. 如果 PR 加了 buildkite/CI step，**那条 step 的命令本身就是"如何跑这个测试"的官方文档**——把它从 CI 删了之前先在 memory 里记住命令，删了之后还能回去拷
  3. error message 含「use X instead」「replaced by Y」「migrate to Z」之类**显式迁移指示**时，先按 message 试一遍，再考虑 workaround；不要 sed 绕路
  4. 自写 `Omni()` / `LLM()` 调用脚本之前自检：现成的 `tests/` / `benchmarks/` 里有没有同任务的 entrypoint？有就用现成的，没有再写
  5. PR #3055 GEBench 跑 4 个样本（type3+type4 各 2）只要 ~7 分钟，不是「重活」——用户给一个能用 7 分钟 pytest 跑通的活，我用 30 分钟 + 多次 OOM 没跑出来。"看起来我的方法更通用"是错觉，**和官方测试框架对齐永远是首选**
