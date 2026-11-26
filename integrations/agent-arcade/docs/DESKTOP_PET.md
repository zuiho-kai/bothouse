# Desktop companion

In this development candidate, **Settings → Desktop companion → Show Ju on the desktop** opens Ju's portrait on Windows and macOS. It is off by default. Each state has a separately illustrated transparent portrait. Ju folds her hands at rest, props her chin on one hand as she thinks and extends an open palm to reply. A gentle touch and three quick pokes each have their own portrait. When the touch ends she shows the current activity. The small, medium and large windows fit the full illustration into the available space; medium is 270 × 350 points. Reduce Motion switches directly between stills, including when the system setting changes with the window open.

Drag the painted character to move her. Transparent areas pass clicks through. Double-click to open the App, or click once while she shows an unread mark. Right-click to change her size, open the App or hide her. The screen robot has its own rendering and appearance.

Run `node scripts/pet-app-smoke.cjs` for the ordinary App settings flow in a temporary profile. Use `node scripts/pets/test-desktop-portrait.cjs` for the portrait window replay and screenshots on the native host platform. The editable renderer loads the five [local pose images](../src/pet/portrait/art/). The earlier private artwork study is frozen at `1bbd15e`.

> On the QQ QA source (`origin/preview/mac-qq-qa.3`) the app also has desktop pets of its own, in `src/pets/`, with models for six characters. They and the pet on this page are separate pieces of code that do not call each other; see the end of Verification.

Ju and the on-screen robot show `…` during an App request, `×` for a failed request and `?` when the outcome is unknown. A reply received while the main window is away adds `!`. If another request then fails, both `×` and `!` remain visible. Opening the app clears the unread mark. Idle has no activity mark. Only state symbols reach the two bodies.

An abnormal loss of the chat renderer during a submitted turn leaves its result unknown. Cancelling, closing normally or changing accounts retires the turn. A new turn can restore normal activity. The adapter uses the current App service receipt. The Claude API service currently reports a prematurely ended stream as a request error. The paired status checks run with `node scripts/test.cjs test/pet-app-activity.test.cjs`. On Windows, `electron scripts/pet-robot-status-smoke.cjs` opens the on-screen robot and records its cues and simulated motion in `outputs/pet-robot-status/`.

### When the main process stops answering

While the robot preview is open, its main-process window asks the page to check in every 800 ms and whenever the companion state changes. The page answers with a one-use challenge. The main process samples the current companion and echoes the challenge with just the activity and unread flag. A long request can therefore keep its thinking cue without emitting a new chat event.

After more than 2500 ms without a confirmed sample, the preview shows its dim sleeping face and releases the simulated neck in place. The page measures elapsed time independently of its animation ticks. Old replies, pulses and gestures cannot wake it. After a new challenge succeeds, the preview shows the current state, including ordinary idle. The C++ firmware uses its existing packet timeout and a fresh HELLO before accepting a new face.

Run `electron scripts/pet-robot-heartbeat-smoke.cjs` for the isolated Windows preview with outgoing main messages withheld. Add `--stall` to pause only the test process's main thread and sample the still-running renderer. Its receipt and screenshots go under `outputs/h2-preview/`. To reproduce the pre-fix comparison, pass `--baseline --source <H1 checkout>` with H1 commit `d36ccb1`. These runs use a simulated screen and neck.

## Earlier 3D model and its controls

| Action | Result |
| --- | --- |
| Move the pointer near her | Her eyes follow first, then her head; when the pointer rests she looks back at you |
| Rest the pointer on her | She leans in and opens her eyes fully |
| Click her | She looks at the pointer with one brow raised; three quick clicks and she closes her eyes and turns away |
| Stroke her head without pressing | Eyes close into a smile |
| Drag her | She is carried: arms out, legs hanging, hair and ribbons lag behind the hand; she lands and settles where she is put down. The position is remembered |
| Double-click, or click while she shows `!` | Opens Agent Arcade |
| Right-click | Open Agent Arcade, size (small / medium / large), hide |

Everywhere outside her own pixels the window lets clicks through to whatever is underneath.

Left alone she breathes, blinks, sways slightly and now and then runs her fingers down the long lock by her shoulder. With the system's *Reduce motion* setting on, the idle sway, the fidgets and the greeting are skipped and hair movement is damped; state changes still show.

## What she mirrors from the app

Only while Ju is the current companion (`persona.id === 'claude-ju'`):

- **Thinking** — a reply request is in flight (`desktopChat.session.active`). The portrait rests her chin on her hand and shows `…`.
- **Reply arrived** — the `app-chat` / `chat.reply` event changes the portrait to Ju leaning forward and extending an open palm. A stored source reminder can play this cue when the current request has no unresolved issue.
- **Waiting for you** — a reply or a reminder from an enabled data source reached the selected local conversation while the main window was hidden or unfocused. The `!` stays until the main window gets focus. When a reminder arrives after a failed or unknown request, `×!` or `?!` shows both facts. Opening the app clears the unread mark and leaves the request outcome visible.

Voice-session status is shown in the App.

## Artwork

The five desktop portraits were generated separately. Ju's orange blossom, charcoal ribbon, amber earrings, terracotta capelet and sun brooch follow the local character design. The new resting pose served as the visual reference for the four other illustrations. The desktop window scales each complete transparent image to fit.

### Earlier 3D model

The portrait `src/ui/portraits/claude-ju-anime-v2.png` is the reference. Carried over: long wavy orange hair with a centre lock between the eyes and an ahoge, the orange blossom with a charcoal gold-edged ribbon and two amber drops on her right, the small braid under it, amber eyes with a winged upper lash, the mole under her right eye, the terracotta double capelet with gold piping, the frilled cream collar and the charcoal bow with a gold sun brooch. The portrait ends at the chest, so the skirt, petticoat, tights, boots and the bow at the back of her waist are new, in the same palette. Proportions are about 2.4 heads tall so that she stays readable at 270 × 350 points. Her stance — hands folded in front, unhurried movement, attention given to whoever points at her — follows the persona text "gentle, composed and attentive".

- `scripts/pets/kit.cjs` — shared kit: closed-surface primitives (swept tubes, ellipsoids, lathes), a skeleton, and a glTF 2.0 binary writer. No dependencies.
- `scripts/pets/ju.cjs` — Ju's parts, colours, bones and weights. This is the editable source of the model.
- `node scripts/build-pets.cjs` writes `src/pet/models/ju.glb` and `ju.json`; `--check` (and `test/pet-model.test.cjs`) fail when the committed file is not what the script builds.
- `src/pet/face.js` draws eyes, brows, mouth, blush and mole on a canvas mapped onto the head, so blinking, gaze and expressions are parameters rather than extra geometry.
- `src/pet/motion.js` holds stances, gestures and the looking/blinking layers; `src/pet/springs.js` simulates hair, ribbons, drops and skirt; `src/pet/stage.js` is the three.js scene with a two-tone cel shader and an inverted-hull outline.
- `src/pet/window.cjs` is the main-process controller; `src/pet/preload.cjs` is the page's only bridge.
- In `src/main.cjs` the pet has its own block: the `desktopPet` IPC channel for its settings (`config.desktopPet`), `syncPet()` called from `publish()`, and a `will-quit` listener. It deliberately stays out of the general `config` handler and the `before-quit` sequence: several tests run those two slices of `main.cjs` in a sandbox with a fixed set of names, and a first version that touched them turned 36 tests red.

The model is 50 bones (17 humanoid bones named as in VRM, the rest spring bones and three colliders), about 21,000 triangles in one skinned mesh plus the face decal, 855 KB. It imports into Blender 5.0 as one armature with two meshes, so it can be refined by hand there and exported again; the run-time finds everything by bone and material name. It is plain glTF, not VRM.

A second character reuses the kit, the skeleton names, the face canvas and all of the motion; it needs its own `scripts/pets/<id>.cjs`, an entry in `scripts/build-pets.cjs` and `PETS` in `src/pet/window.cjs`, its own face layout and iris colours in `face.js`, and stances that suit its personality.

## Looking at a model

```
npx electron scripts/pet-preview.cjs --out preview.png --views "0,35,100,180"
npx electron scripts/pet-preview.cjs --out poses.png --views "0,0:gesture=wave;at=1,0:activity=thinking;at=2,0:stance=held"
```

The model preview uses the 3D renderer on the same page. The normal desktop window uses the portrait renderer.

## Replaying round-screen touches on the earlier 3D model

From a checkout with the platform's Electron dependency installed, run the following in a graphical Windows or macOS session. The replay uses local files and starts Electron with a disposable profile.

```sh
node scripts/pets/test-desktop-touch.cjs --out outputs/desktop-touch
```

The input comes from the H17 paired 480 × 480 screen recording at `1ac85df`. The App driver re-encodes the archived RGB565 image, accepts its recorded acknowledgement and receives three touch packets from that session. The replay routes accepted gestures through `PetPresence`, the live `PetWindow`, its sandboxed preload and `pet.html` to Ju's existing skinned model. One run follows a single poke through recovery. Another follows the original three touches, 668 and 220 ms apart. The first poke tilts her head and lifts a brow. The third touch triggers `huff`, when she closes her eyes and turns away before returning to idle.

Each invocation writes a new `run-*` directory. Open `three/poke-window.png`, `three/huff-window.png` and `three/restored-window.png` for the captured Electron window. The adjacent control images show the untouched character at the same animation time. `report.json` records the input, gestures received through preload, renderer state and measured pixels for both experiments. A duplicate event and an unused event ID from the previous session should reach neither character.

The historical H19 replay uses a dedicated test window for the earlier model on Windows. An earlier Apple Silicon run at `5ab63ac` exercised direct pointer input and preview-to-pet IPC. Its `smoke-window.json` records a local three-click huff, and `smoke-app.json` records a poke from the screen preview. Those receipts predate the board protocol recording. The replay needs neither a serial device nor a personal profile. Native Mac window behavior and a physical board can be checked separately.

## Verification (2026-11-20, macOS 27.2, Apple Silicon, Electron 45.2.1)

- `npx electron scripts/pet-smoke.cjs --out <folder>` — the shipped window on the real desktop with a scripted pointer and input events injected into the page: transparent corners, feet on the bottom of the work area, floating without focus, looking at the pointer, click-through off only while the pointer is on her, poke / huff / double-click / press-and-move, carrying across the screen, saved position, thinking / reply / waiting cues, resize, turning off. Three of its checks were confirmed to fail with the corresponding bug injected.
- `node scripts/pet-app-smoke.cjs` — the real main process on an empty temporary profile: the Settings toggle opens the window, size changes apply, the pet returns after a restart and closes when turned off. It runs through `scripts/pet-app-entry.cjs`, which skips only the single-instance guard so it can run while the user's own app is open.
- `test/pet-model.test.cjs`, `test/pet-window.test.cjs`, `test/pet-motion.test.cjs` — model reproducibility and structure, vendored file hashes, page policy, settings normalisation, placement, trusted-sender checks, carrying, activity and cue sequencing, gestures against hover and carrying. Three sentinels were confirmed to fail with injected bugs; the eyes-stay-open-during-a-pat check was written against the real bug and seen failing before the fix.
- `npm test`: 5016 tests, 0 failed, 717 skipped (the skips are the repository's existing platform-gated tests).
- Idle cost at the large size with the pointer resting on her (the more expensive case, because the pixel under the pointer is read back every frame): about 6 % of one core in the pet's renderer process and 8 % in the GPU process, 115 MB in the renderer. Rendering is capped near 30 frames a second, 60 while she is carried.

Everything above was built and checked in a working tree based on `3edf1ce`. Later the same day it was carried onto `origin/main` (`25037fa`): the new files as they were, the lines in `src/main.cjs`, `src/preload.cjs`, `src/ui/` and `package.json` re-applied by hand. Run again there, on the same Mac:

- `node scripts/test.cjs test/pet-*.test.cjs`: 34 tests, 34 passed, none skipped. The firmware tests ran against the simulator built by Apple clang 21 with sanitizers.
- `npm test`: 5099 tests, 4382 passed, 0 failed, 717 skipped. The same base without this work gives 5065, 4348, 0 and 717.
- `pet-smoke.cjs` (11 steps, no problems), `pet-app-smoke.cjs` (all seven checks, with my own Agent Arcade open beside it) and `pet-robot-smoke.cjs` (ten shots; the firmware core ends up holding the picture the twin holds). This time `screencapture` was allowed, so `pet-smoke.cjs` also wrote a still of the real desktop with her standing in front of another application's window.
- Three bugs injected into the re-applied lines, each seen failing and then reverted: without the call to `registerPetHandlers()` the app smoke stops at "the pet window never appeared"; with the robot preview not attached to the presence it stops at the poke that should cross between the two bodies; a pet reference inside the general `config` handler fails six tests in `send-shortcut` and `appearance`.
- A Windows-style checkout, simulated on the Mac in a scratch repository with `core.autocrlf=true`: at first the hash check of the vendored three.js files failed (1 of the 34 pet tests) and `build-pets.cjs --check` reported a difference, both from rewritten line endings. `.gitattributes` now keeps those files' bytes, and the same simulated checkout passes all 34 and the check. Nothing has run on a real Windows machine.
- A second compiler. The firmware core had only ever met Apple clang. GNU g++ 15 with the same flags refused it: three implicit narrowing conversions under `-Wconversion -Werror`, one of them reported only when the sanitizer flags are on. Wherever `c++` is GCC that made `test/pet-robot-firmware.test.cjs` fail instead of skip. With three explicit casts both compilers build it without a warning and the six firmware tests pass against a simulator built by either. GCC's sanitizers themselves were not exercised: the GCC on this Mac has no address-sanitizer library, so the build script fell back to a plain build, as it is written to.

The injected-bug confirmations listed above for `pet-smoke.cjs` and for the unit tests were not repeated, since those files are unchanged, and neither was the idle-cost measurement. The vendored three.js files were compared with a fresh `npm pack three@0.187.0` and match.

The same commits were then replayed onto the QQ QA source, `origin/preview/mac-qq-qa.3` (`47a3f60`), where `src/main.cjs`, `src/preload.cjs`, `src/ui/` and `package.json` had moved again. Three places needed a decision, each one both sides adding lines at the same spot: the requires at the head of `main.cjs`, the app-chat reply subscription and the preload entry. In each of the five files, what this work changes was then compared with what it changes on `origin/main`, and it is the same lines at the same anchors. Run there, on the same Mac:

- `node scripts/test.cjs test/pet-*.test.cjs`: 34 tests, 34 passed.
- `npm test`: 5476 tests, 4740 passed, 19 failed, 717 skipped. The base without this work gives 5442, 4706, 19 and 717, and they are the same 19, in `credential-entrypoints`, `group-member-capacity`, `group-rhythm`, `platform-discovery`, `platform-main` and `qq-group-peer-turns`. I did not look into why the base fails them. One more test, the "maximum natural batch" one in `group-addressing`, failed in a first run of the base and passes on its own on both. `scripts/check-first-run-docs.cjs` fails on that base with and without this work, with the same output.
- `pet-smoke.cjs`, `pet-app-smoke.cjs` and `pet-robot-smoke.cjs` pass. Without the call to `registerPetHandlers()` the app smoke fails, and a pet reference inside the `config` handler fails six tests, as on `origin/main`.
- The base's own desktop pets next to this one, in the real main process on an empty temporary profile: its `claude` pet turned on through `desktopPetSet`, then this pet and the robot preview. All three windows were open together, turning this one off left the base's pet open, and each kept its own setting (`config.desktopPets` and `config.desktopPet`).
- The series applied as patches (`git am`) into a scratch repository with `core.autocrlf=true`: with the `.gitattributes` commit seventh, eight files were left with rewritten line endings and reported as modified, and the hash test failed until they were checked out again. With it first, as it is on that branch, the series applies clean and the 34 pet tests pass.

Ray selected `src/pet/`, including the App integration from `98a3ff0`, as the desktop companion implementation. Its presence hub drives Ju and the robot twin. Ju is its only model today. The design still calls for a 2D portrait with expression layers. The six-model `src/pets/` implementation and its separate Settings card remain available pending approval of the retirement plan. Its per-character `desktopPets` settings have different semantics from the selected implementation's `desktopPet` settings.

At the original 5090 handoff the selected desktop window was macOS-only. The Windows portrait candidate and isolated settings check are described at the top of this page.

That original session did not verify a person using a real mouse or trackpad, multiple displays, a full-screen app in front, the packaged app, Windows or Linux, a real model reply driving the states, or a recording of the desktop. Its pictures captured only the pet window's content.

## Personal handoff on 2026-11-20

On Apple Silicon the personal baseline `52d103e` ran 5,442 tests (4,722 passed, 3 failed, 717 skipped). After the pet integration `5ab63ac`, 5,476 ran (4,756 passed, the same 3 failed, 717 skipped). The existing failures concern QQ peer turns. All 34 pet tests passed. Three real-window scripts covered the 11 scripted pointer steps, seven in-app checks including cold restart, and the robot twin's output against the firmware simulator. The test reports and original handoff evidence are under `outputs/pet-robot-handoff-20261120/` on the 5090.

### Proposed retirement of the six-model implementation (awaiting Ray's approval)

1. Inventory the enabled character IDs in the old `config.desktopPets` array. It can select multiple characters. The selected implementation has one Ju model and an independent `config.desktopPet` object. Keep the old preferences recoverable. Ask the user whether to enable Ju when only other characters were selected; avoid implicitly substituting her or enabling a new floating window.
2. In a separate change remove the old 3D card and renderer script (`src/ui/index.html`, `src/ui/desktop-pets.js`), the `desktopPetSet` preload/IPC, and the corresponding main-process scheme, status projection, account observation, reply, close and reopen hooks. Exercise profile switching, restart and the robot preview with the selected channel and its own quit handler.
3. Retire `src/pets/`, its isolated session/protocol, the six GLBs in `src/assets/pets/` and their generators in `scripts/desktop-pet-models/`. Check every remaining consumer before removing the three npm dependency, lockfile entries and macOS `desktop-pet-addons` packaging. Keep the selected renderer's vendored three.js, its license and hash verifier.
4. Update the legacy packaging smoke and renderer/main tests, including shortcut coverage. Recheck the Ju toggle, saved size/position, both bodies' reactions, single-window behavior and packaging from a clean checkout. Removing the old path also removes its per-character floating windows and its six-role selection. Windows desktop window support needs its own decision.

## Third-party code

three.js 0.187.0 (MIT) is vendored in `src/vendor/three/` by `scripts/vendor-three.cjs`: `three.module.js`, `three.core.js`, `GLTFLoader.js`, `BufferGeometryUtils.js`, `SkeletonUtils.js`. The build files are byte-identical to the npm package; in the three example modules only the bare `from 'three'` import was rewritten to a relative path, because the page's Content-Security-Policy allows no import map. Hashes are in `src/vendor/three/manifest.json`. The model, face drawing and animation are original to this project and need no outside asset.
