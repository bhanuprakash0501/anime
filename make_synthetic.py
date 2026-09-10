"""
End-to-end test without a printer or webcam.

For every species: take the printed sheet, "color" it with random crayon
blotches, write a name in the box, photograph it with a fake perspective camera
(rotation, tilt, blur, noise, uneven light) and run the scanner on the result.
The scanned sprites are added to the aquarium so there is demo content.

    python make_synthetic.py
"""
import os
import random
import numpy as np
import cv2
from PIL import Image, ImageDraw, ImageFont

import templates
import scanner

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "test_scans")
NAMES = ["MAHI", "AYKA", "HANNAH", "Leo", "Zoe", "Arjun", "Mia", "Sam"]
CRAYONS = [(255, 90, 60), (255, 190, 40), (70, 200, 90), (60, 140, 255), (230, 80, 200), (255, 130, 30), (40, 210, 220), (150, 90, 220)]


def color_sheet(name, seed):
    rnd = random.Random(seed)
    page = Image.open(os.path.join(templates.OUT_DIR, f"{name}.png")).convert("RGB")
    d = ImageDraw.Draw(page, "RGBA")
    o = templates.FRAME_OFF
    ax0, ay0, ax1, ay1 = templates.ART
    mask = templates.species_mask_canonical(name)
    ys, xs = np.where(mask > 128)
    # crayon blotches centred inside the outline, semi-transparent and overlapping
    cols = rnd.sample(CRAYONS, 3)
    for i in range(60):
        j = rnd.randrange(len(xs))
        cx, cy = o + ax0 + int(xs[j]), o + ay0 + int(ys[j])
        r = rnd.randint(25, 70)
        c = cols[i % 3]
        d.ellipse([cx - r, cy - r * 0.7, cx + r, cy + r * 0.7], fill=c + (150,))
    # re-draw the outline on top (crayon does not hide printed ink much)
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    for cnt in contours:
        pts = [(o + ax0 + float(p[0][0]), o + ay0 + float(p[0][1])) for p in cnt]
        d.line(pts + [pts[0]], fill=(0, 0, 0, 200), width=6)
    # name in marker
    nx0, ny0, nx1, ny1 = templates.NAME_BOX
    font = templates._font(120, bold=True)
    txt = NAMES[seed % len(NAMES)]
    if seed % 4 == 3:
        txt = ""            # every 4th sheet: name box left empty -> no name tag expected
    ink = rnd.choice([(20, 20, 20), (30, 30, 160), (160, 20, 30)])
    d.text((o + nx0 + 60, o + ny0 + 20), txt, fill=ink + (255,), font=font)
    return page, txt


def fake_photo(page, seed, size=(1280, 720)):
    rnd = random.Random(seed * 7 + 1)
    W, H = size
    img = np.array(page)[:, :, ::-1].copy()  # BGR
    ph, pw = img.shape[:2]
    # background: dark wood-ish table with a gradient
    bg = np.zeros((H, W, 3), np.uint8)
    bg[:] = (40, 60, 90)
    grad = np.linspace(0.7, 1.3, W, dtype=np.float32)[None, :, None]
    bg = np.clip(bg * grad, 0, 255).astype(np.uint8)
    # place the sheet: scale to ~70% of frame height, random rotation, tilt
    s = H * rnd.uniform(0.5, 0.8) / ph
    ang = rnd.uniform(-30, 30)
    cx, cy = W / 2 + rnd.uniform(-80, 80), H / 2 + rnd.uniform(-30, 30)
    corners = np.array([[0, 0], [pw, 0], [pw, ph], [0, ph]], np.float32)
    R = cv2.getRotationMatrix2D((0, 0), ang, s)
    dst = (corners @ R[:, :2].T) + [cx - pw * s / 2 * 0, cy]
    dst -= dst.mean(0) - [cx, cy]
    # perspective tilt
    tilt = rnd.uniform(-0.12, 0.12)
    dst[0] += [tilt * 300, tilt * 80]; dst[1] += [-tilt * 300, tilt * 80]
    dst[2] += [tilt * 100, 0]; dst[3] += [-tilt * 100, 0]
    M = cv2.getPerspectiveTransform(corners, dst.astype(np.float32))
    warped = cv2.warpPerspective(img, M, (W, H), borderValue=(0, 0, 0))
    m = cv2.warpPerspective(np.full((ph, pw), 255, np.uint8), M, (W, H))
    out = bg.copy()
    out[m > 0] = warped[m > 0]
    # lighting falloff + warm cast, blur, noise
    yy, xx = np.mgrid[0:H, 0:W]
    light = rnd.uniform(0.55, 1.0) - 0.45 * np.hypot((xx - W * 0.4) / W, (yy - H * 0.3) / H)
    out = out.astype(np.float32) * light[..., None] * np.array([0.92, 0.98, 1.05])
    out = cv2.GaussianBlur(out, (3, 3), 0)
    out += np.random.RandomState(seed).normal(0, 4, out.shape)
    return np.clip(out, 0, 255).astype(np.uint8)


def main():
    os.makedirs(OUT, exist_ok=True)
    ok = 0
    for i, name in enumerate(templates.SPECIES_ORDER):
        page, txt = color_sheet(name, i)
        photo = fake_photo(page, i)
        p = os.path.join(OUT, f"{name}.jpg")
        cv2.imwrite(p, photo, [cv2.IMWRITE_JPEG_QUALITY, 85])
        det = scanner.detect(photo)
        if det is None:
            print(f"FAIL {name}: no sheet detected")
            continue
        entry = scanner.save_sprite(det)
        has_name = entry is not None and entry["name"] is not None
        good = det.species == name and entry is not None and has_name == bool(txt)
        ok += good
        print(f"{'ok  ' if good else 'FAIL'} {name:10s} -> detected {det.species:10s} name({txt or '-'}): {'yes' if has_name else 'no'}")
    print(f"{ok}/{len(templates.SPECIES_ORDER)} passed; fake photos in {OUT}")


if __name__ == "__main__":
    main()
