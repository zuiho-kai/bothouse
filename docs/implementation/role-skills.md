# Role-owned skill lifecycle

Status: implementation proposal; no runtime behavior has changed.

## Required behavior

Nightly wiki processing drafts reusable skills from each role's own transcripts.
Drafts carry their originating role and remain unavailable to agent discovery until
approved. The management website and DSH collaboration UI expose the same actions:
inspect, edit, delete, approve, enable per role, install a recommended skill, and
inspect observed use counts. Existing candidate-selection logic is preserved.

## Existing integration points

- `bridge/contrib/wiki/llmwiki/ingest.py`: `dream` runs per wiki and already owns
  the transcript selection, deadline, and selected model runner.
- `bridge/contrib/wiki/llmwiki/manuals.py`: `run`, `write_new`, `write_append`, and
  `tidy_all` currently write active skills and use a global transcript scan.
- `bridge/core/skill.go`: `SkillRegistry` discovers directory bundles and loads
  their descriptions and bodies.
- `bridge/core/management.go`: `handleSkills` and `handleSkillPresets` are read-only.
- `bridge/web/src/pages/Skills/SkillList.tsx`: existing local/recommended cards.
- `dsh/collab/dsh-member.mjs`: native members mount a DSH agent preset per session.

## Proposed implementation

1. Feed the current wiki's transcript set, identity, model runner, and deadline
   into the existing manual generator. Keep candidate detection unchanged.
   Keep its cursor per wiki. Stage both new and revised content as unapproved
   versions; a nightly append or tidy must not modify an approved active version.
2. Store canonical bundles under the shared agents skills directory. Pending
   content must not have a discoverable `SKILL.md` path. Approval publishes the
   selected version and records provenance. Links for CLI-specific directories
   must preserve pre-existing user-owned content and supporting bundle files.
3. Keep role enablement and observed invocation records in the product data
   directory. Enforce enablement at the actual loader as well as bridge command
   lookup. A UI-only filter is insufficient. Do not change global CLI homes or
   credentials to approximate role isolation.
4. Reuse DSH's native skill registry, session-addressed `skills/list`, and market
   installation mechanism. Add only the missing management operations in the
   collaboration plugin. Both UIs must display the same pending/provenance state.
5. Count successful skill-body loads or explicit skill invocations, not catalog
   listing, page previews, or string mentions. Backend observability gaps remain
   explicit; never synthesize successful use counts.
6. Install recommended bundles through declared sources. Do not execute a
   downloaded skill's scripts during installation. Preserve relative assets.

## Design questions requiring resolution before implementation

The inspected DSH session controller exposes only `skills/list`; it returns
name, path, description, optional whenToUse, and modelInvocable. It does not expose
edit, delete, install, or role-toggle methods. Reuse of native discovery and
loading is viable, but the management operations need an adapter rather than
calls to presumed native CRUD endpoints.

The shared default discovery directory is visible to several CLIs independently
of the bridge. Backend-specific exclusion support must be demonstrated before
claiming per-role disablement. A prompt telling an agent to ignore a discoverable
skill does not meet the enablement requirement. Unsupported backends must be
reported rather than quietly changing the requested semantics.

## Verification plan

- An isolated role wiki processes repeated-search fixtures through the unchanged
  candidate detector and produces a role-owned pending draft. Another role's
  transcripts cannot contribute evidence to that draft.
- Before approval, native discovery and explicit invocation cannot load the
  draft. Approval makes it loadable. A later nightly revision remains pending.
- Two roles share one canonical skill: disabling it for one prevents its load
  while the other can still invoke it; re-enable restores the first role.
- Both UIs exercise body preview, edit, delete, approval, role toggles, and preset
  installation against the actual service. Capture rendered evidence.
- Claude, Codex, DSH, Antigravity, and Grok each receive a dedicated isolated
  invocation probe. Record actual body-load/result evidence and any unsupported
  operation separately from successful catalog discovery.
- Usage increments on the successful invocation path only. Repeated list and
  preview requests leave the count unchanged.
- Run targeted Go/Python/DSH tests, frontend build/lint, bundle synchronization,
  applicable CUJs, and the required sandboxed Go suite before review.

No production deployment or changes to existing user skills are part of testing.
