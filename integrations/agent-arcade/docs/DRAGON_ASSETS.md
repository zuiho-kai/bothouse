# Original dragon portraits

Created on 2026-11-04 with the built-in image generation tool. Both calls used `transparent_background: true` and a new-image prompt, without a reference image or edit input.

The local Bothouse dragon portrait was visually inspected for the broad idea of a readable anime identity. It was not copied, embedded, or supplied to the generator. These are original generated interpretations, not official provider mascots or reproductions of a community illustration. The Claude dragon was an earlier iteration; the owner's later clarification selects [Ju for Claude](JU_ASSET.md) and Dragon Girl for Codex. Only the Codex dragon is an active default. This record preserves both generated assets and is not a popularity claim.

## Asset records

| File | Dimensions | Format | Bytes | SHA-256 |
| --- | --- | --- | --- | --- |
| `src/ui/portraits/claude-dragon.png` | 1254 × 1254 | PNG, 32-bit RGBA | 1821635 | `21aeb6a942ada7a5ce3ada71c49d25d4c120868adafa592a822978c3a3632fde` |
| `src/ui/portraits/codex-dragon.png` | 1254 × 1254 | PNG, 32-bit RGBA | 1715007 | `d5da7ab46a58b05b7adbaec9ed7e740baf5d2038e5a738acbe2c43a594b2afa9` |

The generated PNG bytes were copied unchanged into the repository, and source/destination SHA-256 values matched. System.Drawing read-back confirmed 32-bit ARGB storage and fully transparent pixels at all four corners. The images were opened and visually inspected: one adult character each, fully covered clothing, no text or logos, and distinct faces, hair, horns, eyes, and collars.

The composition is close to the image edges, especially the top of the Codex portrait. The UI should use `object-fit: contain` and modest padding inside a circular avatar rather than cropping the source tightly. The source PNGs are deliberately unedited; actual small-avatar legibility still needs to be checked in the running application.

Generated output basenames retained for provenance:

- Claude: `exec-4fe13281-c0fc-48d7-9c42-2facef6ed094.png`
- Codex: `exec-7480577a-3863-4954-bc59-a186276d8f2c.png`

No third-party image license is inferred or extended by this record. Reference illustrations remain subject to their own terms.

## Exact Claude prompt

```text
Use case: stylized-concept.
Asset type: original transparent square character portrait for Agent Arcade, a light anime desktop chat interface. The portrait will be shown in small 40-pixel circular avatar crops.
Style/medium: polished Japanese anime illustration, precise expressive clean line art, restrained soft cel shading, crisp readable silhouette. High-quality 2D art, not photorealistic, not 3D.
Composition/framing: exactly one clearly adult young woman, shoulders and upper chest portrait, centered almost front-facing with a subtle three-quarter turn, face large and readable, eyes looking toward viewer. Entire head and both horns safely inside central circular crop, comfortable transparent padding around hair; shoulders crop naturally at bottom. No hands or separate props.
Background: genuinely transparent alpha, no scene, no circle backdrop, no checkerboard graphic, no colored panel, no drop shadow.
Constraints: new original facial design and outfit. Fully covered modest practical work clothing. No existing character's costume, no crowns, no flowers, no armor, no wings, no lettering, no logos, no watermark, no UI.
Subject: original warm dragon-woman companion. Silvery-white medium-length layered hair, a soft side-part with one small neat side braid, expressive amber-gold eyes, two short smooth coral and terracotta dragon horns curving gently upward, small pointed ears. Warm self-assured calm smile, intelligent friendly adult expression. Ivory practical work jacket with terracotta-orange shoulder panels and a neat fully closed high collar, minimal warm brass seam accents. Keep coral horns and orange jacket visible at thumbnail size. Warm ivory, white, terracotta and amber palette, gentle even lighting.
```

## Exact Codex prompt

```text
Use case: stylized-concept.
Asset type: original transparent square character portrait for Agent Arcade, a light anime desktop chat interface. The portrait will be shown in small 40-pixel circular avatar crops.
Style/medium: polished Japanese anime illustration, precise expressive clean line art, restrained soft cel shading, crisp readable silhouette. High-quality 2D art, not photorealistic, not 3D.
Composition/framing: exactly one clearly adult young woman, shoulders and upper chest portrait, centered almost front-facing with a subtle three-quarter turn, face large and readable, eyes looking toward viewer. Entire head and both horns safely inside central circular crop, comfortable transparent padding around hair; shoulders crop naturally at bottom. No hands or separate props.
Background: genuinely transparent alpha, no scene, no circle backdrop, no checkerboard graphic, no colored panel, no drop shadow.
Constraints: new original facial design and outfit. Fully covered modest practical work clothing. No existing character's costume, no crowns, no flowers, no armor, no wings, no lettering, no logos, no watermark, no UI.
Subject: original cool dragon-woman companion, a different character. Long silver-white straight hair gathered low behind the shoulders, clean side-swept bangs, cool violet eyes, two short dark-violet horns curving backwards along the head, small pointed ears. Focused yet relaxed expression, faint composed smile, mature oval face. Charcoal and pale-lilac practical work jacket with a fully closed asymmetrical collar and subtle clean angular seam details. Keep violet horns and dark collar visible at thumbnail size. Cool silver, lavender, charcoal and muted violet palette, gentle even lighting.
```

