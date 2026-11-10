---
name: 2026-05-29-ci-and-testing-01
description: "2026-05-29 CI 错题 inc-2026-05-29-ci-and-testing-01，PR #3734 修完 query_start_loc_cpu 后 test_thinker_prefix_caching 仍因 transformers 4.44 禁默认 chat template 收到 400，解法是 server 初始化时从 chat_template.json 读官方模板"
metadata:
  scope: "只收 2026-05-29 PR #3734 prefix-cache 漏掉 online serving chat_template 入口这一起错题和 e2e 全链路分层提醒；同一 PR 前一轮的 query_start_loc_cpu typo 错题归 2026-05-29-ci-and-testing-02"
---
# 2026-05-29 — PR #3734 prefix-cache 修完 runner 后，又漏掉 online serving chat_template 入口

## 关键事实

- 源页：`knowledge/repos/vllm-omni/ci/incidents/2026-05-29-ci-and-testing-01.md`（InferMatrixCopilot@ecfb84d0）；源页无 frontmatter

## 决策与踩坑

- 编号：`inc-2026-05-29-ci-and-testing-01`
- 归属：`repos/vllm-omni/ci`
- 状态：已验证
- 搜索词：PR #3734 prefix-cache 修完 runner 后，又漏掉 online serving chat_template 入口
- 影响范围：repos/vllm-omni/ci

### 原文件说明

### Error Book: CI & 测试

- **症状**：PR #3734 在修完 `query_start_loc_cpu` 后，Buildkite 仍失败在 `tests/e2e/online_serving/test_qwen3_omni.py::test_thinker_prefix_caching[omni_server0]`。
  - 这次不是 runner crash，而是 OpenAI client 收到 400：`As of transformers v4.44, default chat template is no longer allowed, so you must provide a chat template if the tokenizer does not define one.` 最终修复后新 head `957a469ce56928a3904457a5092654fa35d9aed7` 的 GitHub Actions、Linux Buildkite #10620、AMD #8143、
  - Intel #4632 全部通过。
- **根因**：我把这条 e2e 只建模成“prefix cache tail-only hidden-state payload”验证，忽略了它是完整 online serving 请求。`test_thinker_prefix_caching` 会启动 Qwen3-Omni server，再走 OpenAI chat completions 的 preprocessing；在 transformers 4.44+ 下 tokenizer 没有内置 `chat_template` 时，默认模板已经不允许。
  - Qwen3-Omni 的官方模板在模型 repo 的独立 `chat_template.json`，不是 `tokenizer_config.json` 内置字段。之前两个 request 已通过的路径没有证明 prefix-cache 参数这条 server/request 组合也能通过 preprocessing；本地缺完整 e2e 环境后，我也没有把“请求进模型前的 tokenizer/template artifacts”列进验证矩阵。
- **解法**：修 server 初始化，不在测试里硬塞模板：CLI 没传 `--chat-template`，且 engine tokenizer 自身没有 `chat_template` 时，从本地模型目录或 HF 本地 cache 的 `chat_template.json` 读取官方模板，并传给 OpenAI serving render/chat handler。
  - 修完跑 changed-file `ruff check`、`ruff format --check --diff`、`py_compile`、`git diff --check`，再用最小 local-path smoke 验证 `chat_template.json` loader 能读 dict payload；amend + DCO sign-off，用 Taffy SSH identity `force-with-lease` 推回 PR 分支，等待所有 CI 绿后再收口。
- **对未来的提醒**：
  1. online serving e2e 失败时，先按 `request -> API protocol -> chat template/tokenizer/processor -> engine prompt -> runner` 全链路分层，不要因为 PR 改的是 runner 就只看 runner。
  2. transformers / vLLM 升级引入的行为门（例如 transformers 4.44 禁默认 chat template）属于当前 PR 的 CI surface；如果你的新测试激活了这条路径，就要修或显式验证它。
  3. 模型 repo artifact 不只 `config.json` / weights。chat/template/tokenizer/processor 可能在 `chat_template.json`、`preprocessor_config.json`、subfolder config 等独立文件里；真实 checkpoint 缺这些文件时，stub smoke 和 runner 单测都不能证明 serving 能用。
  4. 不要用“已有同文件其它测试通过”推断新增 server args 组合通过。prefix cache / stage overrides / prompt token details 这类 server 参数会改变实际 e2e 路径，必须单独把 preprocessing 和 first request 纳入验证。
  5. CI 修复连续两次失败后，下一轮必须反转假设：问题可能已经不在刚修的模块，而在新 head 走到的更上游/更下游路径。先读完整错误文本，再按层级收敛。
