---
name: code-quality-review
description: Reviewing/maintaining code quality — split oversized low-cohesion modules into concern-focused packages (pure helpers to utils.py, public surface preserved via re-exporting __init__), and find dead code with lint+vulture then vet the false positives from dynamic dispatch and portable files
---

## Diagnose
Two smells this skill addresses:
- **Oversized / low-cohesion module**: one file holds several concerns (e.g. an
  agent runtime with dispatch + knowledge retrieval + output coercion + two
  entry points), or a step file mixes read-only fetch, rebase, debug, and push.
  Rule of thumb: >~350 LOC, or a reviewer can't name the file's single job.
- **Dead code**: unused imports, unreferenced functions/classes/methods,
  unreachable branches, orphan modules — often left behind after a refactor.

## Fix

### Splitting an oversized module into a package
1. Map the concerns first. Turn `foo.py` into `foo/` with **one concern per
   file** and **pure/stateless helpers in `foo/utils.py`** so the entry/handler
   files carry control flow, not plumbing. (Applied: `agent_runtime.py` 685→
   dispatch/knowledge/utils/runner/ensemble; `steps/pr.py` 484→fetch/rebase/
   debug/publish/utils; `steps/review.py`→prompts/utils/steps; `cli.py`→copilot/
   entry/utils.)
2. **Preserve the public import surface**: `foo/__init__.py` re-exports every
   symbol external code imported (`from .runner import run_agent_step`, etc.) so
   NO importer or test changes. Keep the *exact* names, including underscored
   ones other modules import.
3. For a self-registering step package (`@step`), `__init__` must `from . import
   <submodules>  # noqa: F401` so registration side effects still fire; re-export
   the tested helpers (e.g. `extract_signature`).
4. Move a symbol's **inline rationale comments with it** — they are institutional
   memory (eval citations, "why untooled reduction"), never drop them.
5. Fix relative imports: nesting one level deeper adds one dot to every relative
   import (`..step`→`...step`). Preserve `python -m pkg` with a `__main__.py` and
   a console-entry (`pkg:main`) via `__init__` re-export.
6. Watch the two things splits break: a **white-box test that monkeypatches a
   module-internal** must retarget the symbol's new home (e.g. `pr._gh` →
   `pr.debug._gh`); and an accidental **repo-neutrality leak** — a docstring/
   comment listing submodules as `checkout/rebase/analyze` contains the literal
   `/rebase/` and trips the scanner (use commas).

### Finding dead code
1. Run all three: `pyflakes` (unused imports/locals), `ruff --select F401,F811,
   F841` (adds redefinition/unused-local), `vulture --min-confidence 80` (dead
   defs). Filter `__init__.py` re-export/side-effect lines (they're `# noqa`).
2. **Vet every vulture hit before deleting** — it can't see dynamic use:
   - `@step`/decorator-registered handlers are dispatched by *name* through a
     registry → live.
   - `getattr(self, f"_op_{kind}")` dispatch tables (profiles/store `_op_*`) →
     live.
   - Portable files copied byte-identical across repos (`tracing.py`) → keep even
     if locally unused; removing desyncs the siblings.
   - Methods only called by tests are **tested public API** → keep.
3. Cross-reference the survivors: `grep -rn <symbol> src/ test/` excluding the
   def. Zero hits repo-wide (only its own SPEC line) = genuinely dead → remove
   it AND its spec mention (e.g. `StepRegistry.read_only_names`).

## Verification
- Full test suite green before and after (the re-exporting `__init__` means the
  count is unchanged — 219 here).
- `python -m compileall` the new package; import-smoke the top-level packages.
- Confirm no orphan modules (every non-`__init__` file is imported somewhere) and
  no `if False:`/unreachable guards.
- Re-run the repo-neutrality guard (`test_repo_neutral_core`) — a split must not
  raise any file's repo-literal count.

## Anti-patterns
- Splitting a **cohesive class** across files — keep the class whole (the
  `Copilot` orchestrator stayed in one `copilot.py`); only move the *wiring*
  (argparse/REPL) and pure formatters out.
- Deleting a vulture hit without cross-referencing — decorator/getattr/portable
  false positives look identical to real dead code.
- Loosening a safety ceiling (repo-neutrality `_KNOWN_LEAKS`, a coverage gate) to
  make a refactor pass — reword the offending line instead.
- A "utils.py" that becomes a junk drawer — it holds *pure, stateless* helpers
  only; anything stateful stays with its owner.
