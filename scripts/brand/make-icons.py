"""Gera os ícones da extensão a partir do escudo SirM (scripts/brand/brand-mark.png)."""
import sys
from pathlib import Path
from PIL import Image, ImageDraw

root = Path(__file__).resolve().parents[2]
mark = Image.open(root / 'scripts/brand/brand-mark.png').convert('RGBA')
white = Image.new('RGBA', mark.size, (255, 255, 255, 255))
white.putalpha(mark.getchannel('A'))

def icon(size, scale=8):
    big = size * scale
    top, bottom = (0x9b, 0x2f, 0xe6), (0x53, 0x00, 0x82)
    gradient = Image.new('RGBA', (big, big))
    draw = ImageDraw.Draw(gradient)
    for y in range(big):
        t = y / (big - 1)
        draw.line([(0, y), (big, y)], fill=tuple(round(a + (b - a) * t) for a, b in zip(top, bottom)) + (255,))
    mask = Image.new('L', (big, big), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, big - 1, big - 1], radius=round(big * 0.24), fill=255)
    tile = Image.new('RGBA', (big, big), (0, 0, 0, 0))
    tile.paste(gradient, (0, 0), mask)
    inner = round(big * (0.86 if size <= 16 else 0.78))
    logo = white.resize((inner, inner), Image.LANCZOS)
    tile.alpha_composite(logo, ((big - inner) // 2, (big - inner) // 2))
    return tile.resize((size, size), Image.LANCZOS)

out = Path(sys.argv[1]) if len(sys.argv) > 1 else root / 'extension/icons'
out.mkdir(parents=True, exist_ok=True)
for size in (16, 32, 48, 128):
    icon(size).save(out / f'icon-{size}.png', optimize=True)
