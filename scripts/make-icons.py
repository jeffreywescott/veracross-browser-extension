"""Generates every icon: the extension's (icons/) and the Safari app's (safari/…/AppIcon.appiconset).

Run with `npm run icons` (needs Pillow). The output is committed.
"""
from pathlib import Path
from PIL import Image, ImageDraw

GREEN = (31, 106, 88, 255)
CREAM = (246, 244, 239, 255)
FOLD = (200, 214, 208, 255)

ROOT = Path(__file__).resolve().parent.parent
APPICON = ROOT / 'safari/Parent Digest/Shared (App)/Assets.xcassets/AppIcon.appiconset'
SHARED_APP = ROOT / 'safari/Parent Digest/Shared (App)'


def draw(size, shape='rounded'):
    """shape: 'rounded' — green rounded square filling the canvas (extension toolbar icons);
    'square' — opaque full-bleed square (iOS applies its own mask; transparency is rejected);
    'mac' — rounded square inset to macOS's icon grid (824/1024) on a transparent canvas."""
    s = size * 8  # supersample, then downscale for smooth edges
    im = Image.new('RGBA', (s, s), (0, 0, 0, 0) if shape != 'square' else GREEN)
    d = ImageDraw.Draw(im)
    if shape == 'mac':
        inset = s * (1024 - 824) / 2 / 1024
        box = s - 2 * inset
        d.rounded_rectangle([inset, inset, s - inset - 1, s - inset - 1], radius=int(box * 0.225), fill=GREEN)
        ox, oy, scale = inset, inset, box
    else:
        if shape == 'rounded':
            d.rounded_rectangle([0, 0, s - 1, s - 1], radius=int(s * 0.22), fill=GREEN)
        ox, oy, scale = 0, 0, s

    def P(x, y):
        return (ox + scale * x, oy + scale * y)

    # A page with a folded corner...
    l, t, r, b, fold = 0.24, 0.18, 0.76, 0.82, 0.14
    d.polygon([P(l, t), P(r - fold, t), P(r, t + fold), P(r, b), P(l, b)], fill=CREAM)
    d.polygon([P(r - fold, t), P(r - fold, t + fold), P(r, t + fold)], fill=FOLD)
    # ...with a check mark on it.
    w = int(scale * 0.075)
    pts = [P(0.35, 0.52), P(0.46, 0.63), P(0.66, 0.40)]
    d.line(pts, fill=GREEN, width=w, joint='curve')
    for x, y in (pts[0], pts[-1]):
        d.ellipse([x - w / 2, y - w / 2, x + w / 2, y + w / 2], fill=GREEN)
    out = im.resize((size, size), Image.LANCZOS)
    return out.convert('RGB') if shape == 'square' else out


# Extension toolbar/store icons.
for n in (16, 32, 48, 128):
    draw(n).save(ROOT / f'icons/icon-{n}.png')

if APPICON.exists():
    # iOS: one opaque 1024 image (also used for the dark and tinted slots).
    draw(1024, 'square').save(APPICON / 'universal-icon-1024@1x.png')
    # macOS: every size at 1x and 2x.
    for pt in (16, 32, 128, 256, 512):
        for scale in (1, 2):
            draw(pt * scale, 'mac').save(APPICON / f'mac-icon-{pt}@{scale}x.png')
    # Artwork shown inside the container app.
    draw(256).save(SHARED_APP / 'Resources/Icon.png')
    draw(256).save(SHARED_APP / 'Assets.xcassets/LargeIcon.imageset/icon-128.png')

print('ok')
