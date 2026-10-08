"""Before/after contact sheet for a batch probe dir: python3 -I scripts/sheet.py <outdir>"""
import json, os, sys
from PIL import Image, ImageDraw
out = sys.argv[1]
rows = [r for r in json.load(open(os.path.join(out, 'summary.json'))) if 'out' in r]
TW = 420
tiles = []
for r in rows:
    a = Image.open(r['src']).convert('RGB'); b = Image.open(os.path.join(out, r['out'])).convert('RGB').resize(a.size)
    th = int(TW * a.height / a.width)
    t = Image.new('RGB', (TW * 2 + 6, th + 18), (20, 20, 20))
    t.paste(a.resize((TW, th), Image.LANCZOS), (0, 18)); t.paste(b.resize((TW, th), Image.LANCZOS), (TW + 6, 18))
    ImageDraw.Draw(t).text((4, 3), f"{r['image']}  {r.get('lighting')}/{r.get('subject')}  -> {r['params'].get('sim')}  ev {r['params'].get('exposure')}", fill=(255, 220, 120))
    tiles.append(t)
cols = 2
for page in range(0, len(tiles), 8):
    chunk = tiles[page:page + 8]
    rws = [chunk[i:i + cols] for i in range(0, len(chunk), cols)]
    H = sum(max(t.height for t in rw) for rw in rws); W = cols * (TW * 2 + 6) + (cols - 1) * 10
    sheet = Image.new('RGB', (W, H), (0, 0, 0)); y = 0
    for rw in rws:
        for i, t in enumerate(rw): sheet.paste(t, (i * (TW * 2 + 16), y))
        y += max(t.height for t in rw)
    p = os.path.join(out, f'sheet{page // 8 + 1}.jpg'); sheet.save(p, quality=85); print('sheet', p)
