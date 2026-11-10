---
name: model-adaptation-review
description: Reviewing new-model / pipeline / checkpoint / deploy-config PRs and stage-topology issues — plumbing vs parity evidence, checkpoint layout gate, stage parallelism x device capacity validation, runner preprocess contract
---

## Fix (what to demand / check)
- Plumbing ≠ parity: 0-missing/0-unexpected load, shape smoke, no-NaN, mock
  weights prove plumbing only. Ask for semantic parity vs the HF reference
  (real checkpoint, output compare) before any correctness or perf claim.
- Checkpoint layout gate: before a model id lands in docs/recipes/examples,
  verify the loader-required layout (model_index.json; transformer/vae/
  scheduler/tokenizer subfolder configs) — official vs Diffusers repos differ.
- Stage parallelism × device capacity TOGETHER: expand the merged config
  (CLI → per-stage override → deploy YAML → platform overlay); per-stage
  TP·PP·DP world size must fit that stage's resolved devices BEFORE worker
  creation (engine/stage_init_utils.py setup_stage_devices; #5003 class:
  devices:"0" + tp=4). Fallbacks swallowing capacity errors = finding.
- Runner preprocess contract: gpu_model_runner.py::_preprocess produces
  per-request _omni_prompt_len/_omni_num_computed_tokens/_omni_is_prefill for
  model talkers — phase comes from real scheduling state, not span length;
  review producer AND consumers; regressions live in tests/worker/ mixed-batch.
- A model-PR should declare: public entrypoints per modality, request-field
  owner + consumers + failure policy, path parity, validation tier per claim.

## Anti-patterns
- Accepting unit tests as proof a public entrypoint works.
- Reviewing the model file but not the deploy YAML it ships with.
