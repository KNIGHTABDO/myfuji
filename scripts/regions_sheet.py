"""2x2 overlay sheet for region maps (used by scripts/regions_dump.mjs).

  python3 -I scripts/regions_sheet.py <source image> <out.jpg> < maps.json

maps.json: {"w": W, "h": H, "maps": {"sky"|"foliage"|"ground"|"sun": "data:image/png;base64,..."}}
Each tile is the source tinted by one map (sun: yellow = sunlit, blue = shade, 0.5 = neutral).
"""
import base64, io, json, sys
import numpy as np
from PIL import Image, ImageDraw

src_path, out_path = sys.argv[1], sys.argv[2]
d = json.load(sys.stdin)
W, H = int(d['w']), int(d['h'])
src = np.asarray(Image.open(src_path).convert('RGB').resize((W, H), Image.LANCZOS)).astype(np.float32) / 255.0


def load_map(url):
    raw = base64.b64decode(url.split(',', 1)[1])
    return np.asarray(Image.open(io.BytesIO(raw)).convert('L')).astype(np.float32) / 255.0


COLOURS = {'sky': (0.25, 0.55, 1.0), 'foliage': (0.2, 0.95, 0.25), 'ground': (1.0, 0.55, 0.12)}
TILE_W = 600
tiles = []
for name in ['sky', 'foliage', 'ground', 'sun']:
    m = load_map(d['maps'][name])
    if name == 'sun':
        hi = np.clip((m - 0.5) * 2, 0, 1)[..., None] * 0.85
        lo = np.clip((0.5 - m) * 2, 0, 1)[..., None] * 0.85
        out = src * (1 - hi - lo) + np.array([1.0, 0.9, 0.1]) * hi + np.array([0.1, 0.35, 1.0]) * lo
        stat = f"sun mean {m.mean():.2f} sunlit>0.7 {(m > 0.7).mean() * 100:.1f}% shade<0.3 {(m < 0.3).mean() * 100:.1f}%"
    else:
        a = (m * 0.8)[..., None]
        out = src * (1 - a) + np.array(COLOURS[name]) * a
        stat = f"{name} mean {m.mean():.3f} >0.5 {(m > 0.5).mean() * 100:.1f}% max {m.max():.2f}"
    img = Image.fromarray((np.clip(out, 0, 1) * 255).astype(np.uint8))
    th = int(round(TILE_W * H / W))
    img = img.resize((TILE_W, th), Image.LANCZOS)
    t = Image.new('RGB', (TILE_W, th + 18), (18, 18, 18))
    t.paste(img, (0, 18))
    ImageDraw.Draw(t).text((4, 4), stat, fill=(255, 220, 120))
    tiles.append(t)

th = tiles[0].height
sheet = Image.new('RGB', (TILE_W * 2 + 6, th * 2 + 6), (0, 0, 0))
for i, t in enumerate(tiles):
    sheet.paste(t, ((i % 2) * (TILE_W + 6), (i // 2) * (th + 6)))
sheet.save(out_path, quality=88)
print('sheet', out_path)
