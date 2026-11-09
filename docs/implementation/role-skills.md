# Role-owned skill lifecycle

Status: implementation plan, revised after independent review and scope updates.

## Required behavior

Nightly wiki processing drafts reusable skills from each role's own transcripts.
Drafts carry their originating role and remain unavailable to agent discovery until
approved. The management website exposes the actions:
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
- `dsh/collab/dsh-member.mjs`: native members mount a DSH agent preset per session;
  DSH's filesystem provider accepts per-preset skill roots.

## Proposed implementation

1. Feed the current wiki's transcript set, identity, model runner, and deadline
   into the existing manual generator. Keep candidate detection unchanged.
   Keep its cursor per wiki. Stage both new and revised content as unapproved
   versions; a nightly append or tidy must not modify an approved active version.
2. Store canonical bundles in a product-data managed library, outside every
   CLI's default scan roots. Pending content lives in a non-discoverable pending
   area and must not use a `SKILL.md` filename. Approval publishes a version to
   the managed library and records provenance. Generate a role-specific enabled
   view linking only approved enabled bundles. Never migrate or edit the user's
   existing `~/.agents/skills` bundles; show them as globally visible, without a
   misleading per-role toggle. Existing `~/.claude/skills` links are user data.
3. Feed each CLI only its role view using that backend's supported project-level
   root/configuration. Do not change global CLI homes or credentials. For Grok
   over ACP, expose role-view descriptions and a bridge body-load command, and
   label this bridge-mediated rather than native. If native per-role isolation
   cannot be demonstrated, report the specific limit rather than claiming it.
4. Implement one skills manager in `bridge/web`; the existing DSH bothouse panel
   embeds that whole management UI, so no second DSH skills page is needed. Adapt
   DSH member presets so their native filesystem provider reads that member's
   generated role view (via `customSkillDirs` and a preset patch). Keep the DSH
   native registry, `skills/list`, and body loader as the actual discovery and
   invocation path. The DSH plugin marketplace installs npm plugins, not loose
   skills; one-click skill installation therefore downloads declared bundles
   through the bridge into the managed library, without executing scripts.
5. Count use only at observed invocation/load points: Claude Skill tool or
   successful `SKILL.md` read; DSH successful skill tool return or `/name`
   injection; Codex successful read of a role-view skill; Grok bridge body load.
   Verify Antigravity's actual event path; report it as unobservable if needed.
   Do not count listing, preview, or mentions.
6. Editing an approved skill creates a new approved version. Deletion removes
   generated links from all role views. Recommended bundle installation resolves
   an explicit downloadable source, preserves relative resources, and never runs
   scripts. Do not invent a download URL from the existing preset display URL.

## Design questions requiring resolution before implementation

The inspected DSH session controller exposes only `skills/list`; management is
provided by the shared bridge UI/API, while DSH's native provider and loader do
the actual discovery and invocation. The marketplace is for npm plugins, not
standalone skill bundles.

The user-owned `~/.agents/skills` root is global to Codex and DSH and cannot be
filtered per role by bridge UI. Existing entries remain globally visible. New
managed skills use per-role project roots instead. Verify those roots separately
from a role's main work directory and a `.git` worktree. Antigravity's documented
home root is `~/.gemini/config/skills`, with project roots including
`<workDir>/.agents/skills`; verify both rather than assume its home scan.

Grok ACP has no native skill loader in the bridge; its supported path in this
plan is explicit bridge-mediated summary and body retrieval, not native skill
discovery. Record this distinction in the backend result table.

## Verification plan

- Exercise candidate detection with isolated role transcript fixtures. Normalize
  tool names/readers at the ingestion boundary (including Codex `exec`) without
  changing the search-grouping decision logic. Keep cursor/state isolated by role.
  Record unsupported transcript readers explicitly.
- Before approval, native discovery and explicit invocation cannot load the
  draft. Approval makes it loadable. A later nightly revision remains pending.
- A managed skill enabled for one role is absent from another role's generated
  view. Exercise the role's main conversation and a `.git` worktree conversation.
- Existing global skills show a global-visibility marker and no per-role switch.
- The web UI exercises body preview, edit-as-new-approved-version, delete,
  approval, role toggles, one-click preset installation, and use counts against
  the service. Capture evidence in the web page and the same page embedded in the
  DSH bothouse panel.
- Claude, Codex, DSH, Antigravity, and Grok each receive a dedicated isolated
  invocation probe. DSH uses its real member preset and native skill tool; Grok
  uses the bridge body-load path. Record actual body-load/result evidence and any
  unsupported operation separately from successful catalog discovery.
- Usage increments on the successful invocation path only. Repeated list and
  preview requests leave the count unchanged.
- Run targeted Go/Python/DSH tests, frontend build/lint,
  applicable CUJs, and the required sandboxed Go suite before review.

No production deployment or changes to existing user skills are part of testing.
