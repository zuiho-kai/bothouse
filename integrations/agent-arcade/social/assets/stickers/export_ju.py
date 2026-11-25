"""Export the social stickers from Agent Arcade's existing Ju artwork."""

from pathlib import Path
from shutil import copyfile

from PIL import Image, ImageDraw


def crop_pose(source, area):
    with Image.open(source) as picture:
        return picture.convert("RGBA").crop(area).resize((256, 256), Image.Resampling.LANCZOS)


if __name__ == "__main__":
    output = Path(__file__).resolve().parent
    source = output.parents[2] / "src"
    art = source / "pet" / "portrait" / "art"
    copyfile(source / "assets" / "qq-group-replies" / "ju-sticker.png", output / "ju-happy.png")
    approve = crop_pose(art / "speaking.png", (42, 0, 852, 810))
    badge = ImageDraw.Draw(approve)
    badge.ellipse((197, 27, 249, 79), fill="#ffe8ac", outline="#593425", width=3)
    badge.line(((208, 52), (220, 63), (237, 43)), fill="#593425", width=5, joint="curve")
    approve.save(output / "ju-approve.png", optimize=True)
    crop_pose(art / "huff.png", (150, 0, 973, 823)).save(output / "ju-annoyed.png", optimize=True)
