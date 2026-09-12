"""Generate deterministic app icons from the project's companion artwork."""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "assets" / "card-companions-v1.jpg"
OUTPUT = ROOT / "assets" / "icons"
CANVAS = 1024


def build_icon() -> Image.Image:
    image = Image.new("RGB", (CANVAS, CANVAS), "#07152c")
    pixels = image.load()
    for y in range(CANVAS):
        for x in range(CANVAS):
            distance = ((x - 512) ** 2 + (y - 485) ** 2) ** 0.5 / 725
            glow = max(0.0, 1.0 - distance)
            pixels[x, y] = (
                int(7 + 15 * glow),
                int(21 + 32 * glow),
                int(44 + 52 * glow),
            )

    glow_layer = Image.new("RGBA", image.size, (0, 0, 0, 0))
    glow_draw = ImageDraw.Draw(glow_layer)
    glow_draw.ellipse((165, 150, 859, 844), fill=(72, 165, 255, 55))
    glow_layer = glow_layer.filter(ImageFilter.GaussianBlur(58))
    image = Image.alpha_composite(image.convert("RGBA"), glow_layer)

    ring = Image.new("RGBA", image.size, (0, 0, 0, 0))
    ring_draw = ImageDraw.Draw(ring)
    ring_draw.ellipse((176, 174, 848, 846), outline=(255, 222, 141, 225), width=20)
    ring_draw.ellipse((203, 201, 821, 819), outline=(116, 215, 255, 115), width=8)
    image = Image.alpha_composite(image, ring)

    source = Image.open(SOURCE).convert("RGB")
    mascot = source.crop((0, 125, 330, 620))
    mascot.thumbnail((560, 700), Image.Resampling.LANCZOS)
    # The source sheet uses a dark navy backdrop. Build a soft silhouette mask
    # so the home-screen icon reads as one character, not as a pasted rectangle.
    mask = mascot.convert("L").point(lambda value: max(0, min(255, int((value - 34) * 7))))
    mask = mask.filter(ImageFilter.MaxFilter(21)).filter(ImageFilter.GaussianBlur(7))
    mascot_rgba = mascot.convert("RGBA")
    mascot_rgba.putalpha(mask)
    image.alpha_composite(mascot_rgba, ((CANVAS - mascot.width) // 2, 224))

    accents = Image.new("RGBA", image.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(accents)
    draw.regular_polygon((805, 218, 70), 4, rotation=45, fill=(255, 225, 135, 245))
    draw.regular_polygon((805, 218, 31), 4, rotation=45, fill=(255, 255, 239, 255))
    draw.ellipse((194, 735, 230, 771), fill=(181, 235, 255, 220))
    draw.ellipse((770, 712, 793, 735), fill=(255, 231, 153, 220))
    image = Image.alpha_composite(image, accents)

    border = Image.new("RGBA", image.size, (0, 0, 0, 0))
    ImageDraw.Draw(border).rounded_rectangle(
        (20, 20, 1004, 1004), radius=220, outline=(255, 234, 176, 135), width=12
    )
    return Image.alpha_composite(image, border).convert("RGB")


def main() -> None:
    OUTPUT.mkdir(parents=True, exist_ok=True)
    icon = build_icon()
    for filename, size in (
        ("icon-512.png", 512),
        ("icon-maskable-512.png", 512),
        ("icon-192.png", 192),
        ("apple-touch-icon.png", 180),
        ("favicon-32.png", 32),
    ):
        resized = icon.resize((size, size), Image.Resampling.LANCZOS)
        resized.save(OUTPUT / filename, optimize=True)


if __name__ == "__main__":
    main()
