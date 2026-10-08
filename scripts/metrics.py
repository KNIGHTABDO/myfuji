#!/usr/bin/env python3
"""Measure what the app does to a photo: compare probe renders with the source frame.

Usage: python3 scripts/metrics.py [probe_dir] [--ref PATH] [--target PATH]

Definitions (8-bit sRGB values, scaled to 0-1 unless noted):
  L        mean Rec.709 luma of the sRGB-encoded values, shown 0-255
  R G B    mean channel values, 0-255
  warm     mean(R - B), 0-255: positive = warmer, negative = cooler
  S        mean HSV saturation, (max - min) / max
  a b      mean OKLab a (+red / -green) and b (+yellow / -blue)
  p5 p50 p95   luma percentiles, 0-255 (shadow / midtone / highlight)
  lo% hi%  share of pixels with luma < 0.02 / > 0.98
  d*       output minus the source frame
"""
import json
import os
import sys

import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SIMS = ['provia', 'velvia', 'astia', 'classic-chrome', 'reala-ace', 'pro-neg-hi', 'pro-neg-std',
        'classic-neg', 'nostalgic-neg', 'eterna', 'eterna-bb', 'acros', 'mono', 'sepia']


def flag(name, default):
    return sys.argv[sys.argv.index(name) + 1] if name in sys.argv else default


def load(path, size=None):
    im = Image.open(path).convert('RGB')
    if size and im.size != size:
        print(f'note: {os.path.basename(path)} is {im.size}, resampled to {size}', file=sys.stderr)
        im = im.resize(size, Image.LANCZOS)
    return np.asarray(im, dtype=np.float32) / 255.0


def srgb_to_lin(c):
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def oklab(x):
    """Björn Ottosson's OKLab from sRGB (0-1). Returns L, a, b arrays."""
    lin = srgb_to_lin(x)
    r, g, b = lin[..., 0], lin[..., 1], lin[..., 2]
    l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b
    m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b
    s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b
    l, m, s = np.cbrt(l), np.cbrt(m), np.cbrt(s)
    L = 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s
    a = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s
    bb = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s
    return L, a, bb


def analyse(x):
    R, G, B = x[..., 0], x[..., 1], x[..., 2]
    Y = 0.2126 * R + 0.7152 * G + 0.0722 * B
    mx, mn = x.max(-1), x.min(-1)
    S = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1e-9), 0.0)
    _, a, b = oklab(x)
    p5, p50, p95 = np.percentile(Y, [5, 50, 95]) * 255
    m = {
        'L': Y.mean() * 255, 'R': R.mean() * 255, 'G': G.mean() * 255, 'B': B.mean() * 255,
        'warm': (R - B).mean() * 255, 'S': S.mean(), 'a': a.mean(), 'b': b.mean(),
        'p5': p5, 'p50': p50, 'p95': p95, 'lo': (Y < 0.02).mean() * 100, 'hi': (Y > 0.98).mean() * 100,
    }
    return m, Y, a, b


def row(name, m, ref=None):
    def d(k, scale=1.0):
        return '-' if ref is None else f'{(m[k] - ref[k]) * scale:+.3f}' if k in ('a', 'b', 'S') else f'{(m[k] - ref[k]) * scale:+.1f}'
    f = lambda v, w, p=1: f'{v:>{w}.{p}f}'
    return (f'{name:<16}{f(m["L"], 7)}{d("L"):>7}{f(m["R"], 7)}{f(m["G"], 7)}{f(m["B"], 7)}'
            f'{f(m["warm"], 7)}{d("warm"):>7}{f(m["S"], 6, 3)}{f(m["a"], 8, 3)}{d("a"):>8}'
            f'{f(m["b"], 8, 3)}{d("b"):>8}{f(m["p5"], 6, 0)}{f(m["p50"], 6, 0)}{f(m["p95"], 6, 0)}'
            f'{f(m["lo"], 6)}{f(m["hi"], 6)}')


def grid(Yo, ao, bo, Yr, ar, br):
    H, W = Yo.shape
    rows, cols = np.array_split(np.arange(H), 3), np.array_split(np.arange(W), 3)
    names = ['top', 'mid', 'bot']
    layers = [('dL (0-255)', (Yo - Yr) * 255), ('da x100', (ao - ar) * 100), ('db x100', (bo - br) * 100)]
    print('\n9-region grid, auto minus source (rows top/mid/bottom, columns left/centre/right)')
    for label, d in layers:
        print(f'  {label:<12}' + '   '.join(f'{c:>7}' for c in ['left', 'centre', 'right']))
        for i in range(3):
            vals = [d[np.ix_(rows[i], cols[j])].mean() for j in range(3)]
            print(f'  {names[i]:<12}' + '   '.join(f'{v:>+7.2f}' for v in vals))


def main():
    probe = sys.argv[1] if len(sys.argv) > 1 and not sys.argv[1].startswith('--') else os.path.join(ROOT, 'probe')
    ref_path = flag('--ref', os.path.join(ROOT, 'test-forest.jpg'))
    tgt_path = flag('--target', os.path.join(ROOT, 'test-forest-target.jpg'))
    ref = load(ref_path)
    size = (ref.shape[1], ref.shape[0])
    rm, rY, ra, rb = analyse(ref)

    auto_pick = None
    ana = os.path.join(probe, 'analysis.json')
    if os.path.exists(ana):
        auto_pick = json.load(open(ana))['auto']['sim']

    present = {os.path.splitext(f)[0] for f in os.listdir(probe) if f.endswith('.png')}
    order = ['auto'] + [s for s in SIMS if s in present] + ['ablate-wb-asshot', 'control-prefilm', 'control-neutral']
    order += sorted(present - set(order))
    order = [n for n in order if n in present]

    print(f'source: {os.path.basename(ref_path)} {size[0]}x{size[1]}   auto pick: {auto_pick}')
    print(row('source', rm))
    outputs = {}
    for name in order:
        x = load(os.path.join(probe, name + '.png'), size)
        m, Y, a, b = analyse(x)
        outputs[name] = (m, Y, a, b)
        label = name + (' (=pick)' if name == 'auto' else '')
        print(row(label, m, rm))
    if os.path.exists(tgt_path):
        tm, *_ = analyse(load(tgt_path, size))
        print(row('target (ref)', tm, rm))

    if 'auto' in outputs and auto_pick in outputs:
        d = np.abs(load(os.path.join(probe, 'auto.png'), size) - load(os.path.join(probe, auto_pick + '.png'), size)).max()
        print(f'\nauto vs {auto_pick}.png: max channel difference {d * 255:.0f}/255 ' + ('(identical)' if d == 0 else ''))

    if 'auto' in outputs:
        _, Y, a, b = outputs['auto']
        grid(Y, a, b, rY, ra, rb)


if __name__ == '__main__':
    main()
