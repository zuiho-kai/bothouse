# Character portraits & avatars

Snapshot of character avatars for the wizard and management UI, bundled locally so rendering does not require external network access or credentials.

## Preset avatars (B version Q avatars & Grok)
Updated on 2026-11-10 per user selection (Issue #1515, task #596).
- Reference source: [hunmer/aboutme-pets](https://github.com/hunmer/aboutme-pets)
- Source assets:
  - 4-character B version sheet (`B.png`), cropped and super-sampled at 256×256 RGBA with circular masking.
  - Grok user designated artwork (`img_1794292967582_0.png`), cropped to head/shoulders and super-sampled at 256×256 RGBA with circular masking.
- Characters:
  - `orange.png`: Claude (橘 / Claude)
  - `dragon.png`: GPT / Codex (龙娘 / Codex)
  - `whale.png`: DeepSeek / DSH (鲸鱼娘 / DSH)
  - `rainbow.png`: Gemini (彩虹猫 / Gemini)
  - `grok.png`: Grok (Grok / xAI)
  - `lanxi.png`: MiniMax (岚汐 / MiniMax)

## Vendor icon set (default, #602)
Added 2026-11-10 per user request 「默认是各家原本的图标，内置另一套娘化图标」: two built-in sets,
the vendors' own icons by default and the Q-style characters above as the alternative, switched in
Settings → Role avatars (bothouse config `[display] avatar_style = "brand" | "chibi"`).
- Source: [lobehub/lobe-icons](https://github.com/lobehub/lobe-icons), npm `@lobehub/icons-static-png@2.6.0`, `light/` folder.
- License: MIT, Copyright © 2023 LobeHub (the collection). The logos themselves are trademarks of
  their owners; they are used here only to identify the model a role runs on.
- Processing: logo scaled only (no recolor, no distortion), centred on a white disc, 256×256 RGBA,
  rendered at 4× and downsampled. Script: `bridge/contrib/tools/make_brand_avatars.py <icons-static-png>/light <out-dir>` (needs Pillow).
- Files:
  - `brand-claude.png`: Claude (`claude-color.png`)
  - `brand-openai.png`: GPT / Codex (`openai.png`)
  - `brand-deepseek.png`: DeepSeek / DSH (`deepseek-color.png`)
  - `brand-gemini.png`: Gemini (`gemini-color.png`)
  - `brand-grok.png`: Grok (`grok.png`)
  - `brand-minimax.png`: MiniMax (`minimax-color.png`)
