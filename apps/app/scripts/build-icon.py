#!/usr/bin/env python3
"""Render app icon from the Smiley Sans subset (得意黑「时」), same brand as web favicon."""

from __future__ import annotations

from io import BytesIO
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parents[1]
FONT_WOFF = ROOT.parent / "web" / "public" / "fonts" / "smiley-sans-subset.woff2"
ASSETS = ROOT / "assets"

ACTION = (255, 107, 53, 255)  # --action #ff6b35
ACTION_FG = (255, 255, 255, 255)  # --action-fg #ffffff
SIZE = 1024


def ttf_bytes() -> bytes:
    font = TTFont(FONT_WOFF)
    font.flavor = None
    buf = BytesIO()
    font.save(buf)
    return buf.getvalue()


def draw_mark(img: Image.Image, pad_ratio: float) -> None:
    draw = ImageDraw.Draw(img)
    font_size = max(10, round(SIZE * (1 - pad_ratio * 2)))
    font = ImageFont.truetype(BytesIO(ttf_bytes()), font_size)
    left, top, right, bottom = font.getbbox("时")
    tw, th = right - left, bottom - top
    x = (SIZE - tw) / 2 - left
    y = (SIZE - th) / 2 - top + SIZE * 0.02
    draw.text((x, y), "时", font=font, fill=ACTION_FG)


def main() -> None:
    ASSETS.mkdir(parents=True, exist_ok=True)

    icon = Image.new("RGBA", (SIZE, SIZE), ACTION)
    draw_mark(icon, 0.18)
    icon.convert("RGB").save(ASSETS / "icon.png", format="PNG")

    adaptive = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    draw_mark(adaptive, 0.28)
    adaptive.save(ASSETS / "adaptive-icon.png", format="PNG")

    splash = Image.new("RGBA", (SIZE, SIZE), ACTION)
    draw_mark(splash, 0.22)
    splash.convert("RGB").save(ASSETS / "splash-icon.png", format="PNG")

    print(f"wrote {ASSETS / 'icon.png'}")
    print(f"wrote {ASSETS / 'adaptive-icon.png'}")
    print(f"wrote {ASSETS / 'splash-icon.png'}")


if __name__ == "__main__":
    main()
