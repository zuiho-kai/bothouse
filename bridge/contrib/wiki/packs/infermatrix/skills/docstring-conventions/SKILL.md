---
name: docstring-conventions
description: House docstring standard (PEP 257 + Google style, terse rationale-first voice) — every module/class/function documents its logic and inputs/outputs; one-liners for trivial accessors; docstrings are additive; never introduce repo-specific literals in a docstring
---

## Diagnose
A module/class/function/method has no docstring, or one that restates the
signature instead of explaining behavior + I/O. Or a PR adds a public function
with no docstring.

## Fix
Write to the house voice (grounded in PEP 257 form + Google's "what to
document"), NOT heavy `Args:`/`Returns:` blocks:
- **Module**: the one thing the file owns + what it exports. For a re-export
  `__init__.py`, say what the package groups and that the surface is re-exported.
  The module docstring is the file's **first statement**, above `from __future__`.
- **Class**: role in one line; note the key attribute or invariant it upholds.
  Dataclass field meaning goes in the class docstring or an inline `#` comment.
- **Function/method**: summary line, then inputs → output and the non-obvious
  *why*, **in prose**. Name the parameters that carry meaning; say what the
  return represents. Keep the contract framing the specs use — call out when a
  function is a fail-closed gate, publishes state for a later step (**B2**),
  degrades to a typed BLOCKED result, or records a `capability_gap`.
- **Trivial accessor / property / tiny closure**: a one-line docstring is
  correct and PEP-257-preferred — do not scaffold it.

Scale a large pass with parallel agents over **disjoint file sets**, each given
the style doc and the AST list of what's missing, told to add docstrings ONLY.

## Verification
- AST scan for coverage: parse every file, assert `ast.get_docstring` is
  non-empty for the module and every ClassDef/FunctionDef/AsyncFunctionDef.
- `python -m py_compile` each edited file; full test suite green.
- The diff must be **additive** — the only acceptable deletions are `pass`
  placeholders in empty classes that a docstring now replaces. Any other removed
  line means code was changed.
- Re-run the repo-neutrality guard: a docstring must not add a repo-specific
  literal (naming a sibling repo, a `/rebase/` path). Reword to a generic phrase
  ("the parent rebase-agent") instead of loosening the ceiling.

## Anti-patterns
- Docstrings that narrate the code line-by-line instead of the intent/contract.
- Inventing specifics (thresholds, line numbers, behavior) the code doesn't
  support — describe only what the body actually does.
- Changing signatures/logic or rewriting a correct existing docstring during a
  docstring pass — it is purely additive.
- Duplicating the per-file SPEC — the docstring is the local in-code view; the
  spec is the normative contract.
