# Role-owned skills

Nightly wiki processing drafts reusable instructions from the current role’s
transcripts. The existing search-group detector is retained. The wiki’s configured
dream runner and job budget are reused; drafting has no separate model setting.
The ingest nightly entry owns this pass. The role scheduler only launches ingest,
so it cannot draft a second time after ingest returns.

## Storage and approval

Under the configured bothouse data directory:

- `skills/pending/<project>/<name>.md` holds unapproved drafts and revisions.
- `skills/library/<name>/SKILL.md` is the approved canonical document.
- `skills/library/<name>/versions/<version>/SKILL.md` retains approved versions.
- `skills/views/<project>/<name>/` contains approved bundles enabled for that role.
- `skills/state.json` records ownership, versions, role enablement and observed uses.
- `skills/archive/` retains retired views, consumed drafts and removed bundles,
  outside discovery roots. Updating, disabling and removing skills does not
  recursively delete directories.

Nightly append and tidy operations stage the complete revision in pending. They
never rewrite the approved document. Pending drafts override approved text only
inside the drafting pass, allowing later additions to accumulate before review.
Approval publishes a version and enables the originating role. Manual edits of
an approved skill create an approved version immediately.

The management website’s Skills page lists pending content for the selected role,
lets the user inspect/edit/discard it, and approves it for its actual owner.
Approved content can be inspected, edited, enabled per role or removed. Existing
global CLI skills remain global and are not migrated. Recommended installation
supports the catalogue’s explicit HTTPS raw Markdown sources; it does not install
arbitrary archives, run scripts or download extra bundle resources.

## Runtime coverage

The bridge registry reads each role’s enabled view. Existing bridge skill commands
load its body into a role’s agent request. Only successful bridge command dispatch
is counted here; a list, preview or a mention does not count as use.

Native DSH members additionally mount their enabled view using the installed
`dsh-skill-filesystem` provider and native skill tool. Its existing global/default
provider remains intact. Native DSH body loads are not counted by this integration.
Claude Code, Codex, Antigravity and Grok can use bridge skill commands; this change
does not configure or verify their separate native skill-discovery roots. A role
view on disk alone is not evidence that a native CLI has loaded it.

## Nightly installation

The normal wiki installer copies the shared `llmwiki` tools, including `manuals.py`
and its dependencies. Existing installations need those files and the ingest
nightly hook from the same release. Preserve locally maintained ingest runners
and fixes when upgrading an older installation; copying a whole different ingest
implementation is not a migration. Keep the existing nightly schedules.

The role scheduler supplies `MANUALS_ROLE` using the project ID. A direct nightly
run can resolve `.bothouse-role` or `.bothouse-main`; an unmarked wiki uses its
configured assistant identity. Configure the identity deliberately when display
names differ from project IDs. Transcript selection is the current wiki’s
configured transcript root, rather than a global scan.

## Verification

Targeted Python checks cover pending revisions, configured model dispatch, shared
nightly identity/transcripts/deadline and single scheduler ownership. Go checks
cover approval, views, versions, use counts, recommendations and pending review
through HTTP. The optional DSH test loads the installed native provider and skill
tool in isolated main and Git workspaces, checking pending invisibility and role
isolation without starting a model. Frontend checks build the management page.
Installed entry-point checks and actual nightly generation are separate from
these checks and must be recorded for each deployment.
