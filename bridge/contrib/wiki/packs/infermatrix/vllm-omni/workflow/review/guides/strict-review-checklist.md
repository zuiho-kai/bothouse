---
name: strict-review-checklist
description: Strict 审查触发式检查单（20-PR 与 teacher traces 蒸馏）：Streaming/TTS serving、Model executor 与 payloads、Platforms/kernels、Configs/deploy yamls、Dependencies、CI/tests、Benchmarks 音频数值、Bugfix 回归覆盖、maintainer 流程规范
metadata:
  scope: 只收 Strict reviewer 注入的触发条件到检查项清单；owner 路由归 maintainer-pattern-routing，模型适配完整性归 model-adaptation-guardrails-1、model-adaptation-guardrails-2，审查入口归 review-guides-overview
---
# Strict 审查触发式检查单

## 关键事实

- 源页：`knowledge/repos/vllm-omni/review/guides/strict-review-checklist.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: vllm-omni, review；created: 2026-08-12；updated: 2026-09-10
- Train-distilled trigger→check lines (20-PR campaign + teacher traces 2026-08-15). The Strict reviewer injects the first 8,000 chars (`knowledge.review_checklist`); keep the core inside that budget.

### Streaming / TTS serving

- `async_chunk` defaults to **False** (`OmniModelConfig`). Any gate keyed on it applies to EVERY async_chunk=false model (moss_tts, voxcpm2, higgs_audio, indextts2, qwen2_5_omni, ...), not just the PR-title model — demand scoping.
- Stream slots/sessions: release must fire on client **abort/disconnect** and on the unscheduled-reap path, not only `finished=True`; slot exhaustion degrades silently (HTTP 200, empty audio) — that is a blocker, not a log line.
- A speed/format constraint usually lives in BOTH the HTTP request model and the WebSocket block of the same protocol file — sweep the whole file for the constraint, not just the hunk's class.
- Per-request seeding/generators die under CUDA-graph replay (replay discards call kwargs); "seeded" in eager mode proves nothing about graph mode.

### Model executor / payloads / checkpoints

- mm-payload / `to_payload_element`: exact dim-0 match gates per-request slicing; a mismatched axis silently clones the WHOLE batch into every request (cross-request contamination lineage #4851→#4870→#4910).
  - Any invariant change here needs a producer census: every `make_omni_output` implementor, hidden- vs scheduled-axis tensors, padded lengths.
- Model capability flags (`use_async_omni_output`, `talker_mtp_graph_safe`, `omni_pooler_payload_include_hidden`, ...): consumers read them via `getattr(model, ..., default)` — typos and dead flags fail silently; trace every consumer after a flag change.
- Async omni output and prefix caching are mutually exclusive (`_should_use_async_omni_output` returns False when `omni_prefix_cache` is set) — a PR touching one must be checked against the other.
- Legacy vs v2 codec/tokenizer selection must be gated by an explicit config marker, never try-instantiate-and-fallback: permissive `from_pretrained` never throws, so the fallback is DEAD and legacy checkpoints hard-fail.
- Never mutate shared config objects (`hf_config`/`model_config`) at load/init; later readers see the mutated value. Vendored files carry a "Vendored from <upstream> @ <ref>" header.

### Platforms / kernels / global defaults

- `vllm_omni/worker/gpu_*model_runner.py` changed → open the NPU twin under `platforms/npu/worker/` and check for the same code;
  - `platforms/cuda/platform.py` changed → grep the same expression in `rocm/` and `xpu/` (copy-pasted branches drift; the same-bug-survives-on-siblings finding is a maintainer staple).
  - Newly-required arguments must also reach `_dummy_run`/profile/warmup paths — the real path getting patched while dummy doesn't is the standard miss.
- Anything under `get_default_*` is inherited by every model on that platform; per-model overrides exist (`_DIFFUSION_IR_OP_PRIORITY_FUNCS`; cosmos3 forces native) — propose the override, not a global flip. Only in-repo caller of IR-op priority is `diffusion_worker._resolve_ir_op_priority`.
- Hardware gates must match the claimed support matrix (`>= 9` admits future arches; upstream uses `== 9` for FA3) — and check what CI hardware actually runs the gated path.
- Kernel-provider/priority switches need before/after latency AND same-seed accuracy per bundled change; `kernels.get_kernel` is unmemoized and `version=N` resolves a moving branch head, not a pin.

### Configs / deploy yamls

- `seed:` under stage-0 qwen3_tts propagates into every request (`tts_local_seed`) → per-row multinomial loop ≈40% throughput cliff; ~30 deploy yamls and `docs/configuration/stage_configs.md` still ship `seed: 42` — removing it from one file leaves the fleet exposed;
  - report exposed vs safe siblings separately.
- Yaml pins (cudagraph_mode, slot counts) often enforce CODE invariants — ask whether the invariant belongs in code, and audit the surrounding comment block: a comment now asserting the opposite of the new value is a finding.
- Deleting a value users copy from a reference profile needs an in-file tombstone comment (match the file's comment style) plus a docs sweep for the hazardous example.

### Dependencies

- New kwarg/API into an optional package: does the OLDEST version the `pyproject.toml` range admits support it? Docs pins (`pkg==X`) are not lower bounds; docs pin vs pyproject range vs actual requirement can three-way disagree.
- Commit timeline shows a described kwarg was later DROPPED → usually the compat fix working; verify via archaeology tools, report as `[resolved]`.

### CI / tests

- Tests select by pytest **markers** (`-m "core_model and cpu"` in `.buildkite/`): a new test file without `pytestmark` is collected then DESELECTED — CI green while never running it. Module-scope platform imports break collection on AMD/Intel/NPU pipelines (xpu pytests the whole tree).
- A test that cannot fail (try/except-and-continue, degenerate inputs, asserting the injected value, real objects monkeypatched away) outranks a missing test.
- Red gate at head: map the diff surface to the lane's coverage INCLUDING configs the lane's tests load — "config-only" is not inert when the red job loads that config; propose the single most plausible in-diff mechanism.
- L2 covers CPU/mock plumbing only; serving/entrypoints tests may not collect under the installed vLLM — classify as environment, not defect.
- PR body vs lane: a `.buildkite/**` step's `commands` are what CI runs and its `source_file_dependencies` say which changed paths it guards.
  - Compare the Test Plan/Test Result against them by SELECTOR (targets, `-m` expression, run-level), never by literal text — `timeout`, `--cov*` and container prefixes differ by design.
  - A guard step never run, a command that drops the lane's marker, or no test evidence at all is a blocking finding naming the step label and both commands.

### Benchmarks / audio numerics

- `benchmarks/patch/patch.py` PCM capture vs `seed_tts_eval` consumers must agree on rate/channels (capture normalizes to 24 kHz mono; env overrides apply at capture only) — a fix branch merging upstream can create a semantic merge conflict here (double resample) that invalidates the PR's own WER
  - numbers; on any merge commit, re-verify reported numbers at HEAD.

### Bugfix PR regression coverage

- Only when the PR is a bugfix (title/labels/linked issue): demand a regression test pinning the ORIGINAL failure path — failing before the fix, matching the root cause, not a happy path (a test that cannot fail counts as missing).
  - Check same-class entrypoints and boundaries; an accepted gap must state reason and residual risk. Conclude by naming the covering test/case or filing an explicit blocking / non-blocking finding — never silence.

### Process norms maintainers enforce

- A PR fixing one of N problems in a linked issue: one comment names the remainder and asks for tracking or a split.
- An unexplained capacity/threshold retune riding along gets a benchmark-rationale ask.
- Duplicated machinery gets a CONCRETE shared-helper proposal naming both files — never a hedged "should we unify?" question.
- Non-test additions past ~1,000 lines get a split ask naming the largest contributing files, or a stated exemption (vendored sync, generated code). Tests, docs, lock files and pure renames are outside the budget; deletions never count.
  - Size stays non-blocking and never raises another finding's severity.
