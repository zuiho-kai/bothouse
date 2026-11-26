# Bothouse source modules

This directory pins a reviewed subset of [zuiho-kai/bothouse](https://github.com/zuiho-kai/bothouse) at `8ec73a8f32573b5307922df3c79675a934cdefb7`. The manifest lists each original Git path, mode and blob. Files under `upstream/` are unmodified. Agent Arcade callers can use the functions below through their existing application boundaries.

| Group | Entry points |
| --- | --- |
| Public output | [output.mjs](upstream/integrations/dsh-public-output/output.mjs) parses public replies and guards streamed output. [stream.mjs](upstream/integrations/dsh-public-output/stream.mjs) exposes the public field parser. The voice-history module and upstream DSH plugin adapter stay together with their tests. The plugin adapter requires a DSH host |
| Collaboration data directory | [instance-lock.mjs](upstream/dsh/collab/instance-lock.mjs) wraps an exclusive SQLite lock for a collaboration data directory and exposes its owner record. Existing Agent Arcade task orchestration and its application-window guard have their own entry points |
| Web helper | [uuid.ts](upstream/dsh/packages/client-ui-discord/src/client/uuid.ts) uses the browser UUID API or a secure random byte fallback. The original Vitest test is preserved. The Node smoke test exercises both paths with no extra dependency |
| Voice queue | [queue-player.js](upstream/role-household/rh/static/queue-player.js) waits for missing chunks and plays in sequence. Use current-turn, same-origin, authorized media when adapting it to another app |
| Wiki template | The [MIT template](upstream/bridge/contrib/wiki/template/SOURCE), including both schemas, provides source-tracking and empty Wiki structure. Agent Arcade keeps its own approval rules |
| Collaboration fixtures | The [56 upstream workspace-exit cases](upstream/bridge/core/team_rules/testdata/team-exit-cases.json) and their [rule data](upstream/bridge/core/team_rules/team-exit-rules.json) are available for testing existing handoff and review behavior |

Bothouse project code is [Apache-2.0](upstream/LICENSE). Preserve [NOTICE](upstream/NOTICE), [licensing scope](upstream/LICENSING.md), [source origins](upstream/SOURCE_ORIGINS.md) and [dependency notices](upstream/THIRD-PARTY-LICENSES.md). The Wiki template includes its own [MIT license](upstream/bridge/contrib/wiki/template/LICENSE). The [cc-connect MIT](upstream/bridge/LICENSE-MIT-upstream) notice accompanies the bridge context used by the original voice regression. The [DeepSeek Harness MIT](upstream/integrations/dsh-acp-stream/LICENSE-MIT-DeepSeek) text is included for attribution. The development desktop-pet source has its own MIT license and origin note.

## Development source

`upstream/` contains 42 tracked upstream files. The checked-in manifest also pins 940 development files, including all 935 adaptation candidates and five supporting host contracts or tests. The full 982-path development tree lives under the ignored `materialized/` directory. It includes the public activity continuity, role notification and journal plugins, conversation history, persona schema, mention completion, voice orchestration and browser components, the MIT desktop-pet code and tests, and the reviewed bridge and patch configuration source.

The [manifest](manifest.json) records the 4,309-path inventory digest and per-file provenance. The final review covers four standard Python package entry files, six QQ memory-quote sources and tests, and 19 desktop-pet development files. The desktop-pet files include dependency lock metadata, build and launcher source, and three approved project dotfiles. The dotfile allowance applies only to their exact paths. Dependency packages, build output, and artwork, sound and fonts referred to by the recipe remain outside the snapshot.

The QQ memory-quote group is retained as upstream reference source. Its loader requires the original DSH setup. Its guard requires the authorized macOS QQ host and may read configured records and write approved memory when invoked in that environment. The imported tests describe synthetic and host-dependent cases. The materializer copies bytes, without loading the hook, starting the guard, reading any QQ archive or altering Agent Arcade settings.

### Reviewed bridge and patch sources

The [frozen allowlist](provenance/allowlist.json) assigns 140 paths to Apache-2.0, eight to Apache-2.0 and MIT together, and three to MIT. Seven source and license notices required by the allowlist are already pinned at their upstream paths in the development tree. Their blobs are checked when materializing. The reach of the review is the exact frozen source and selected tests. The three Cordis configuration files are retained as source. Their host, runtime plugins, installations, dependencies and assets are outside this delivery.

The [history evidence](provenance/file-evidence.json) records original, introduction and frozen Git objects. The [donor evidence](provenance/source-witnesses.json) preserves selected original bytes under the corresponding notice and references three further donor objects by Git hash. The older private patch mentioned by the signed public port and the older test examples omitted upstream have only references or comparison metadata. `--check-materialized` can verify the recorded evidence and selected original witness bytes offline. With a local Bothouse checkout it also checks the frozen Git tree. The source review and tests are independent of any App runtime integration.

Development snapshots are for adapting individual components against the existing App boundaries. Host integrations still require their original dependencies. The manifest preserves Python dependency metadata and the DSH upstream pin alongside tests. Go bridge source used by the public-output test is read by the test as text. The original DSH integration cases need a configured DSH host. Desktop-pet code may need the upstream TypeScript host and original build inputs for its complete upstream suite. The materializer only writes Git blobs and never starts these hosts, installs packages or fetches assets.

## Verify and reproduce

From the Agent Arcade checkout, with Git and Node 24:

```powershell
node vendor/bothouse/import.cjs --check
node vendor/bothouse/import.cjs --check "/path/to/bothouse"
node vendor/bothouse/import.cjs --import "/path/to/bothouse"
node vendor/bothouse/import.cjs --materialize "/path/to/bothouse"
node vendor/bothouse/import.cjs --check-materialized "/path/to/bothouse"
$publicTests = Get-ChildItem vendor/bothouse/upstream/integrations/dsh-public-output -Filter '*.test.mjs'
node --test vendor/bothouse/import.test.cjs vendor/bothouse/runtime.test.mjs vendor/bothouse/upstream/dsh/collab/instance-lock.test.mjs $publicTests.FullName
```

`--check` verifies the tracked source slice. `--check-materialized` verifies the full development tree. Both verify every expected blob and reject extra files. Supplying a Bothouse checkout also verifies the corresponding slice against its pinned Git tree. The checkout only needs to contain the pinned commit as an object. `--import` and `--materialize` restore missing files from that tree, even when its working directory has uncommitted changes. An unchanged rerun writes zero files. A local edit fails verification and remains in place. To add a group, review exact source paths, dependencies and licenses before pinning the Git blobs.

The desktop and service packaging inputs omit the top-level `vendor/` directory. This is a source import. Personal files, local configuration, role artwork, media, models and unreviewed dependency code stay outside the manifest. The upstream math Markdown compatibility file identifies code copied from a separate DeepSeek package and needs separate attribution review before inclusion. Tests that require an installed DSH host retain their upstream `DSH_CONTRACT_ENTRY` gate.
