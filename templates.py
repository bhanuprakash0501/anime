"""
Generate the printable coloring sheets (one per species) and the metadata the
scanner needs to read them back.

Sheet layout (US Letter, 150 dpi, portrait = 1275 x 1650 px):

    +-----------------------------------------------+  <- thick black frame
    | [#]  [b][b][b][b][b][b][b][b]      Clownfish   |  <- orientation marker + 8 ID bits
    |                                               |
    |            (species outline to color)         |  <- ART region
    |                                               |
    | My name: [                                 ]  |  <- NAME box
    |  Color me, write your name, show me to the camera! |
    +-----------------------------------------------+

Everything inside the frame is addressed in "canonical" coordinates: the top-left
outer corner of the frame is (0,0), the frame is CANON_W x CANON_H. The scanner
warps whatever it sees to exactly that size, so the regions below can be read at
fixed pixel positions.
"""
import json
import os
import numpy as np
from PIL import Image, ImageDraw, ImageFont
import cv2

from shapes import SPECIES, render_mask, render_guides, CANVAS

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.join(HERE, "templates")

PAGE_W, PAGE_H = 1275, 1650          # 8.5 x 11 in at 150 dpi
FRAME_OFF = 75                       # frame outer edge offset from page edge
FRAME_T = 24                         # frame thickness
CANON_W, CANON_H = PAGE_W - 2 * FRAME_OFF, PAGE_H - 2 * FRAME_OFF   # 1125 x 1500

MARKER = (40, 40, 110, 110)          # legacy orientation square area (now covered by the TL ArUco marker)
BITS_Y, BITS_X0, BITS_CELL, BITS_STEP, N_BITS = 40, 200, 50, 70, 8
ART = (60, 140, 1065, 1100)          # x0, y0, x1, y1
NAME_LABEL = (60, 1125)
NAME_BOX = (60, 1180, 1065, 1330)
FOOTER_Y = 1400

# ArUco corner markers: square barcodes the scanner locks onto for an exact crop.
# id = (species_id - 1) * 4 + corner, corner 0=TL 1=TR 2=BR 3=BL.
ARUCO_DICT = "DICT_4X4_100"
MK = 110                             # marker size (px)
MKM = 50                             # margin from the frame's outer edge (leaves a white quiet zone inside the frame)
MARKERS = {                          # top-left corner of each marker in canonical coordinates
    0: (MKM, MKM), 1: (CANON_W - MKM - MK, MKM), 2: (CANON_W - MKM - MK, CANON_H - MKM - MK), 3: (MKM, CANON_H - MKM - MK),
}

SPECIES_ORDER = list(SPECIES.keys())   # id = index + 1


def species_id(name):
    return SPECIES_ORDER.index(name) + 1


def id_bits(sid):
    """4 id bits followed by their complement: a cheap validity check."""
    b = [(sid >> i) & 1 for i in range(3, -1, -1)]
    return b + [1 - x for x in b]


def decode_bits(bits):
    """Return the species id or None if the bits are not a valid code."""
    if len(bits) != N_BITS:
        return None
    a, b = bits[:4], bits[4:]
    if any(x == y for x, y in zip(a, b)):
        return None
    sid = int("".join(map(str, a)), 2)
    return sid if 1 <= sid <= len(SPECIES_ORDER) else None


def _font(size, bold=False):
    for f in (["arialbd.ttf", "arial.ttf"] if bold else ["arial.ttf"]):
        p = os.path.join(os.environ.get("WINDIR", "C:/Windows"), "Fonts", f)
        if os.path.exists(p):
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()


def art_transform():
    """Map species canvas (1000x800) -> canonical ART region, keeping aspect."""
    ax0, ay0, ax1, ay1 = ART
    aw, ah = ax1 - ax0, ay1 - ay0
    s = min(aw / CANVAS[0], ah / CANVAS[1]) * 0.92
    ox = ax0 + (aw - CANVAS[0] * s) / 2
    oy = ay0 + (ah - CANVAS[1] * s) / 2
    return s, ox, oy


def species_mask_canonical(name):
    """Mask of the species at ART-region resolution (used by the scanner)."""
    s, ox, oy = art_transform()
    ax0, ay0, ax1, ay1 = ART
    m = render_mask(name)
    M = np.float32([[s, 0, ox - ax0], [0, s, oy - ay0]])
    return cv2.warpAffine(m, M, (ax1 - ax0, ay1 - ay0), flags=cv2.INTER_LINEAR)


def make_sheet(name):
    page = Image.new("RGB", (PAGE_W, PAGE_H), "white")
    d = ImageDraw.Draw(page)
    o = FRAME_OFF

    # frame
    d.rectangle([o, o, o + CANON_W - 1, o + CANON_H - 1], outline="black", width=FRAME_T)
    # ArUco corner markers
    adict = cv2.aruco.getPredefinedDictionary(getattr(cv2.aruco, ARUCO_DICT))
    for corner, (mx, my) in MARKERS.items():
        mid = (species_id(name) - 1) * 4 + corner
        mk = cv2.aruco.generateImageMarker(adict, mid, MK)
        page.paste(Image.fromarray(mk).convert("RGB"), (o + mx, o + my))
    # id bits
    for i, bit in enumerate(id_bits(species_id(name))):
        x = o + BITS_X0 + i * BITS_STEP
        d.rectangle([x, o + BITS_Y, x + BITS_CELL, o + BITS_Y + BITS_CELL],
                    fill="black" if bit else "white", outline="black", width=3)
    # title
    d.text((o + 760, o + 45), SPECIES[name]["label"], fill="black", font=_font(40, bold=True))

    # outline + guides
    s, ox, oy = art_transform()
    tf = lambda x, y: (o + ox + x * s, o + oy + y * s)
    mask = render_mask(name)
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    for c in contours:
        pts = [tf(float(p[0][0]), float(p[0][1])) for p in c]
        d.line(pts + [pts[0]], fill="black", width=6, joint="curve")
    render_guides(name, d, tf, color=(170, 170, 170), width=3)

    # name box
    d.text((o + NAME_LABEL[0], o + NAME_LABEL[1]), "My name:", fill="black", font=_font(40, bold=True))
    d.rectangle([o + NAME_BOX[0], o + NAME_BOX[1], o + NAME_BOX[2], o + NAME_BOX[3]], outline=(120, 120, 120), width=3)
    d.text((o + 175, o + FOOTER_Y), "Color me, write your name in the box, then take my photo!",
           fill=(90, 90, 90), font=_font(30))
    return page


def write_layout():
    layout = dict(
        page=[PAGE_W, PAGE_H], frame_off=FRAME_OFF, frame_t=FRAME_T,
        canon=[CANON_W, CANON_H], marker=MARKER,
        bits=dict(y=BITS_Y, x0=BITS_X0, cell=BITS_CELL, step=BITS_STEP, n=N_BITS),
        art=ART, name_box=NAME_BOX,
        aruco=dict(dict=ARUCO_DICT, size=MK, markers={str(k): v for k, v in MARKERS.items()}),
        species={n: dict(id=species_id(n), label=SPECIES[n]["label"], motion=SPECIES[n]["motion"],
                         facing=SPECIES[n]["facing"], color=SPECIES[n]["color"]) for n in SPECIES_ORDER},
    )
    with open(os.path.join(OUT_DIR, "layout.json"), "w") as f:
        json.dump(layout, f, indent=2)
    return layout


def main():
    os.makedirs(os.path.join(OUT_DIR, "masks"), exist_ok=True)
    pages = []
    for name in SPECIES_ORDER:
        page = make_sheet(name)
        page.save(os.path.join(OUT_DIR, f"{name}.png"), dpi=(150, 150))
        cv2.imwrite(os.path.join(OUT_DIR, "masks", f"{name}.png"), species_mask_canonical(name))
        pages.append(page)
        print("sheet:", name, "id", species_id(name), "bits", id_bits(species_id(name)))
    pages[0].save(os.path.join(OUT_DIR, "all_sheets.pdf"), save_all=True, append_images=pages[1:], resolution=150)
    write_layout()
    print("wrote", OUT_DIR)


if __name__ == "__main__":
    main()
