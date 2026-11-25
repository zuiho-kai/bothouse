"""Editable drawing source. Pillow is needed only to export the bundled art."""
from pathlib import Path

from PIL import Image, ImageDraw

PALETTES = {
    'whale': ('#213e77', '#5c9de6', '#b5eaff', '#3874c3', '#7be5ed'),
    'dragon': ('#493267', '#a88ad3', '#eedaff', '#7450ab', '#f9d080'),
}
SCALE = 3


def sticker(role, mood):
    line, skin, belly, shade, accent = PALETTES[role]
    image = Image.new('RGBA', (256 * SCALE, 256 * SCALE))
    draw = ImageDraw.Draw(image)

    def size(coords):
        return tuple(n * SCALE for n in coords)

    def ellipse(coords, color, outline=None):
        draw.ellipse(size(coords), color, outline, 4 * SCALE)

    def shape(points, color, outline=None):
        vertices = [size(pt) for pt in points]
        draw.polygon(vertices, color)
        if outline:
            draw.line(vertices + vertices[:1], outline, 4 * SCALE, joint='curve')

    def arc(coords, start, end, color=line):
        draw.arc(size(coords), start, end, fill=color, width=5 * SCALE)

    def sparkle(x, y, radius):
        shape([(x, y-radius), (x+4, y-4), (x+radius, y), (x+4, y+4),
               (x, y+radius), (x-4, y+4), (x-radius, y), (x-4, y-4)], accent)

    ellipse((42, 215, 208, 238), line + '25')
    if role == 'whale':
        shape([(155, 164), (189, 125), (191, 110), (215, 122), (236, 111),
               (229, 137), (190, 155), (173, 182)], shade, line)
        ellipse((40, 71, 193, 219), skin, line)
        ellipse((55, 133, 177, 208), belly)
        shape([(71, 155), (32, 168), (18, 188), (45, 192), (80, 175)], skin, line)
        draw.line([size((112, 72)), size((112, 58))], skin, 5 * SCALE)
        ellipse((98, 42, 107, 54), accent)
        ellipse((117, 31, 127, 51), accent)
        ellipse((133, 49, 143, 62), accent)
    else:
        shape([(151, 158), (192, 100), (206, 125), (241, 131), (230, 143),
               (229, 166), (207, 153), (173, 189)], shade, line)
        shape([(46, 116), (31, 105), (22, 112), (28, 150), (46, 178), (66, 157)], shade, line)
        shape([(50, 104), (47, 73), (64, 37), (86, 81), (92, 96)], accent, line)
        shape([(126, 91), (142, 69), (166, 51), (166, 102), (154, 118)], accent, line)
        ellipse((41, 74, 186, 220), skin, line)
        ellipse((55, 132, 173, 206), belly)
        arc((57, 97, 83, 126), 165, 275, shade)
        arc((142, 104, 166, 127), 250, 359, shade)
        ellipse((149, 170, 193, 198), skin, line)

    ellipse((64, 153, 81, 162), '#f499b5')
    ellipse((135, 151, 153, 160), '#f499b5')
    if mood == 'happy':
        arc((74, 122, 99, 148), 193, 347)
        arc((121, 121, 146, 147), 193, 347)
        draw.pieslice(size((86, 141, 134, 186)), 0, 180, fill=line)
        draw.pieslice(size((97, 153, 123, 179)), 0, 180, fill='#ff91ac')
        sparkle(32, 78, 13)
        sparkle(208, 67, 16)
        sparkle(229, 91, 8)
    elif mood == 'approve':
        ellipse((80, 126, 94, 148), line)
        ellipse((124, 126, 138, 148), line)
        ellipse((84, 129, 89, 134), '#ffffff')
        ellipse((128, 129, 133, 134), '#ffffff')
        arc((97, 145, 123, 172), 15, 168)
        ellipse((174, 52, 233, 111), belly, line)
        draw.line([size((189, 81)), size((199, 91)), size((219, 72))], line, 6 * SCALE, joint='curve')
    else:
        ellipse((76, 119, 96, 149), line)
        ellipse((122, 119, 142, 149), line)
        ellipse((80, 124, 87, 131), '#ffffff')
        ellipse((126, 124, 133, 131), '#ffffff')
        ellipse((100, 156, 122, 184), line)
        ellipse((105, 168, 117, 180), '#f499b5')
        shape([(210, 33), (222, 34), (214, 71), (205, 69)], accent, line)
        ellipse((202, 76, 216, 90), accent, line)

    return image.resize((256, 256), Image.Resampling.LANCZOS)


if __name__ == '__main__':
    for mascot in PALETTES:
        for reaction in ('happy', 'approve', 'surprised'):
            sticker(mascot, reaction).save(Path(__file__).with_name(f'{mascot}-{reaction}.png'), optimize=True)
