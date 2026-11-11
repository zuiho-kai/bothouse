# Compose brand avatars for #602 from @lobehub/icons-static-png 2.6.0 (MIT).
# Logo scaled only (no recolor, no distortion), centred on a white disc, 256x256 RGBA,
# rendered at 4x and downsampled (same convention as bridge/web/public/avatars/README.md).
import sys
from PIL import Image, ImageDraw
src_dir, out_dir = sys.argv[1], sys.argv[2]
PAIRS = {'claude': 'claude-color', 'openai': 'openai', 'deepseek': 'deepseek-color',
         'gemini': 'gemini-color', 'grok': 'grok', 'minimax': 'minimax-color'}
S = 1024  # 4x of 256 (README size)
for slug, name in PAIRS.items():
    logo = Image.open(f'{src_dir}/{name}.png').convert('RGBA')
    logo = logo.crop(logo.getbbox())
    box = int(S * 0.58)  # logo fits inside the circle with margin
    w, h = logo.size
    k = box / max(w, h)
    logo = logo.resize((round(w * k), round(h * k)), Image.LANCZOS)
    canvas = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    disc = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    ImageDraw.Draw(disc).ellipse((0, 0, S - 1, S - 1), fill=(255, 255, 255, 255))
    canvas.alpha_composite(disc)
    canvas.alpha_composite(logo, ((S - logo.width) // 2, (S - logo.height) // 2))
    canvas.resize((256, 256), Image.LANCZOS).save(f'{out_dir}/brand-{slug}.png', optimize=True)
    print('wrote', slug)
