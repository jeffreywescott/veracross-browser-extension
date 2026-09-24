"""Generates the extension icons (run once; output is committed)."""
from PIL import Image, ImageDraw

GREEN = (31, 106, 88, 255)
WHITE = (255, 255, 255, 255)
CREAM = (246, 244, 239, 255)

def icon(size):
    s = size * 8  # supersample, then downscale for smooth edges
    im = Image.new('RGBA', (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.rounded_rectangle([0, 0, s - 1, s - 1], radius=int(s * 0.22), fill=GREEN)
    # A page with a folded corner...
    l, t, r, b = s * 0.24, s * 0.18, s * 0.76, s * 0.82
    fold = s * 0.14
    d.polygon([(l, t), (r - fold, t), (r, t + fold), (r, b), (l, b)], fill=CREAM)
    d.polygon([(r - fold, t), (r - fold, t + fold), (r, t + fold)], fill=(200, 214, 208, 255))
    # ...with a check mark on it.
    w = int(s * 0.075)
    pts = [(s * 0.35, s * 0.52), (s * 0.46, s * 0.63), (s * 0.66, s * 0.40)]
    d.line(pts, fill=GREEN, width=w, joint='curve')
    for x, y in (pts[0], pts[-1]):
        d.ellipse([x - w / 2, y - w / 2, x + w / 2, y + w / 2], fill=GREEN)
    return im.resize((size, size), Image.LANCZOS)

for n in (16, 32, 48, 128):
    icon(n).save(f'icons/icon-{n}.png')
print('ok')
