# Ribbon and conversation artwork

**Design checkpoint, 2026-11-06:** `ribbon-simple-v1.png` is a reversible
application preview candidate. The owner requested a simpler mark after finding
the previous bot too prominent. This is not final brand approval.

## Current preview source

The built-in image-generation tool created the flowing pink ribbon,
speech-bubble opening and two small eyes on **2026-11-06** for Agent Arcade.
The PNG is copied byte-for-byte from the generated output without retouching,
recoloring or re-encoding: **1374×1145**, 8-bit RGBA, **360,418 bytes**.

- File: `ribbon-simple-v1.png`
- SHA-256: `8c559b4c2356abfbae288b3f614101e7fc85fa9557d0f52f158f33ba5144981a`

Awarded identities informed discussion of shared contours, not a claim that
this candidate won an award or matches their quality. Reference artwork is not
included among these assets. This is not an official messaging/AI-provider logo.

## Retained earlier source

`ribbon-negative-space-v1.png` is the earlier generated candidate with chat and
bot-shaped openings. It remains for design history and explicit rollback; it
is no longer selected for runtime or build. Generated **2026-11-06**,
**1254×1254**, 8-bit RGBA, **409,105 bytes**, SHA-256:
`ab4e3dc0d03b3d02472e7e385e9d28977e84d5e8f9b22e328f7135368afb3c82`.

## Packaging derivatives

Existing Electron `nativeImage.resize` scales the complete source by its long
edge while preserving aspect ratio. Its native bitmap is centered on transparent
square padding without changing channels. There is no source crop; both tails
remain. Nine PNG frames (16, 20, 24, 32, 40, 48, 64, 128 and 256 px) form the ICO;
the 256 px frame is also the application PNG. Neither source file is modified.

Sprout remains an observer character and exceptional runtime fallback. A build
fails if the selected source is missing, changed or invalid. Small eye details
are not promised to remain distinct at 16 px. All-system tray rendering has not
been accepted; see `docs/BRAND.md`.

## Decorative UI artwork

These images were generated independently for Agent Arcade with the built-in
image-generation tool on **2026-11-06** and copied unchanged into the UI.
They are project decoration, not downloaded illustrations or official provider
assets.

| Local asset | Dimensions / bytes | SHA-256 |
| --- | --- | --- |
| [`persona-motifs-v1.png`](../../ui/ornaments/persona-motifs-v1.png) — pink companion motifs | 2172×724 / 595,974 | `c8df6b0cb236d3719e28374c756fbc895c6d1174f88a8b491044d8d388aff067` |
| [`cherry-branch-v1.png`](../../ui/ornaments/cherry-branch-v1.png) — light cherry branch | 1254×1254 / 1,562,069 | `feb97d68d415d08abe6382ae8a2c99b30becc1d8f69973a2bf1f9564d4362838` |

They are solely decorative. Position, opacity and blending do not communicate
connection status, QR content, permissions, task success or model capabilities.
The branch includes a faint translucent halo; normal light-background composition
was inspected without editing pixels or claiming a perfectly isolated cutout.

## Output license and limits

Agent Arcade contributors provide this AI-assisted project artwork under the
repository's [MIT license](../../../LICENSE), to the extent they hold licensable
rights. This is not an endorsement, trademark clearance or exclusive ownership
claim for common ribbon, bubble, robot or floral motifs. Keep this record with
redistributed copies. See [third-party notices](../../../THIRD_PARTY_NOTICES.md).
