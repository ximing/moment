#!/usr/bin/env python3
"""Render brand favicon from the Smiley Sans subset (得意黑「时」)."""

from __future__ import annotations

from io import BytesIO
from pathlib import Path
import subprocess
import tempfile

from PIL import Image, ImageDraw, ImageFont
from fontTools.misc.transform import Transform
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parents[1]
FONT_WOFF = ROOT / "public/fonts/smiley-sans-subset.woff2"
PUBLIC = ROOT / "public"

ACTION = (201, 74, 58, 255)  # --action light #c94a3a
ACTION_FG = (255, 253, 251, 255)  # --action-fg #fffdfb
ACTION_HEX = "#c94a3a"
ACTION_FG_HEX = "#fffdfb"
ACTION_DARK_HEX = "#ff755e"
ACTION_FG_DARK_HEX = "#241714"


def ttf_bytes() -> bytes:
    font = TTFont(FONT_WOFF)
    font.flavor = None
    buf = BytesIO()
    font.save(buf)
    return buf.getvalue()


def glyph_svg_path(size: int, pad: float) -> str:
    font = TTFont(FONT_WOFF)
    gs = font.getGlyphSet()
    gname = font.getBestCmap()[ord("时")]
    xmin, ymin, xmax, ymax = 61, -81, 788, 888
    gw, gh = xmax - xmin, ymax - ymin
    inner = size - pad * 2
    scale = inner / gh
    dx = pad + (inner - gw * scale) / 2 - xmin * scale
    dy = pad + ymax * scale
    pen = SVGPathPen(gs)
    gs[gname].draw(TransformPen(pen, Transform(scale, 0, 0, -scale, dx, dy)))
    raw = pen.getCommands()
    out: list[str] = []
    num = ""
    for ch in raw:
        if ch in "0123456789.-":
            num += ch
            continue
        if num:
            out.append(f"{float(num):.2f}")
            num = ""
        out.append(ch)
    if num:
        out.append(f"{float(num):.2f}")
    return "".join(out)


def write_svg(path: Path) -> None:
    d = glyph_svg_path(32, 4)
    path.write_text(
        f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" role="img" aria-label="时刻">
  <style>
    .plate {{ fill: {ACTION_HEX}; }}
    .mark {{ fill: {ACTION_FG_HEX}; }}
    @media (prefers-color-scheme: dark) {{
      .plate {{ fill: {ACTION_DARK_HEX}; }}
      .mark {{ fill: {ACTION_FG_DARK_HEX}; }}
    }}
  </style>
  <rect class="plate" width="32" height="32" rx="7"/>
  <path class="mark" d="{d}"/>
</svg>
""",
        encoding="utf-8",
    )


def render_png(ttf: bytes, size: int, pad_ratio: float | None = None) -> Image.Image:
    if pad_ratio is None:
        pad_ratio = 0.06 if size <= 16 else 0.125
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    radius = max(2, round(size * (0.18 if size <= 16 else 0.22)))
    draw.rounded_rectangle((0, 0, size - 1, size - 1), radius=radius, fill=ACTION)
    font_size = max(10, round(size * (1 - pad_ratio * 2)))
    font = ImageFont.truetype(BytesIO(ttf), font_size)
    left, top, right, bottom = font.getbbox("时")
    tw, th = right - left, bottom - top
    x = (size - tw) / 2 - left
    y = (size - th) / 2 - top + size * 0.02
    draw.text((x, y), "时", font=font, fill=ACTION_FG)
    return img


def write_ico(ttf: bytes, path: Path) -> None:
    with tempfile.TemporaryDirectory() as tmp:
        pngs = []
        for size in (16, 32, 48):
            png = Path(tmp) / f"{size}.png"
            render_png(ttf, size).save(png, format="PNG")
            pngs.append(png)
        subprocess.check_call(["magick", *[str(p) for p in pngs], str(path)])


def main() -> None:
    PUBLIC.mkdir(parents=True, exist_ok=True)
    ttf = ttf_bytes()
    write_svg(PUBLIC / "favicon.svg")
    write_ico(ttf, PUBLIC / "favicon.ico")
    render_png(ttf, 180, pad_ratio=0.16).save(PUBLIC / "apple-touch-icon.png", format="PNG")


if __name__ == "__main__":
    main()
