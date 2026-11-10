---
name: packaging-architecture
description: Native packaging and validation 架构：setup.py、pyproject.toml、rust/Cargo.toml、pre-commit workflow 的职责、data flow、Direct review map 与 validation
metadata:
  scope: 只收 packaging owner 的职责边界、入口文件、数据流、review map 和验证要求；入口说明归 packaging-overview
---
# Native packaging and validation architecture

## 现状

### Responsibilities and boundary

- Platform-dependent installation metadata, Rust builds, native artifact inclusion and the repository validation entrypoints.

### Data flow

- Setup selects platform requirements and builds the Rust executable for source/editable installation.
- Package metadata declares included native artifacts.
- CI workflows and pre-commit helpers define their own test selectors; verify the final wheel contents and imported runtime independently of source-tree fallbacks.

## 关键事实

- 源页：`knowledge/repos/vllm-gr/components/packaging/architecture.md`（InferMatrixCopilot@ecfb84d0）；title: Native packaging and validation architecture；type: architecture；tags: vllm-gr, ci；created: 2026-09-30；updated: 2026-09-30
- 来源（sources）：JiusiServe/vllm-gr@a05103dc16c7b8dfd2213b73c5ee2d4f28cb6fee:setup.py
- 来源（sources）：JiusiServe/vllm-gr@a05103dc16c7b8dfd2213b73c5ee2d4f28cb6fee:pyproject.toml
- 来源（sources）：JiusiServe/vllm-gr@a05103dc16c7b8dfd2213b73c5ee2d4f28cb6fee:rust/Cargo.toml
- 来源（sources）：JiusiServe/vllm-gr@a05103dc16c7b8dfd2213b73c5ee2d4f28cb6fee:tests/packaging/test_install_metadata.py
- 来源（sources）：JiusiServe/vllm-gr@a05103dc16c7b8dfd2213b73c5ee2d4f28cb6fee:.github/workflows/pre-commit.yml

### Source and entrypoints

- `setup.py`
- `pyproject.toml`
- `rust/Cargo.toml`
- `tests/packaging/test_install_metadata.py`
- `.github/workflows/pre-commit.yml`

### Direct review map

- Read `setup.py`, `pyproject.toml`, `MANIFEST.in`, platform `requirements/`, and `rust/Cargo.toml` together.
- Trace each native artifact from its build command to wheel inclusion and the runtime loader.
- Read `.github/workflows/pre-commit.yml` and `tools/pre_commit/` for actual selectors.
- Use an isolated installed-wheel smoke check when native loading or artifact layout changes.
- Focused tests: `tests/packaging/test_install_metadata.py`.

### Validation

- Use the target head's declared dependency versions and test selectors.
- Bind evidence to that head; a missing native build or incompatible environment is a validation gap.
- See the [[packaging-overview]]（owner entry） and [[components-overview]]（component map） for neighboring boundaries.
