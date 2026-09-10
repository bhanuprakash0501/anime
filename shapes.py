"""
Species silhouettes for the Sketch Aquarium.

Each species is described as a list of smooth closed blobs (Catmull-Rom splines
through a few control points) on a 1000x800 canvas, facing RIGHT (except the
upright creatures). The union of the blobs is the creature mask: it is what
gets printed as an outline on the coloring sheet, and what gets cut out of the
scanned sheet to make the swimming sprite.

"guides" are thin grey hints printed inside the outline (eyes, stripes, mouth)
to help kids color, but they are not part of the mask.
"""
import math
import numpy as np
from PIL import Image, ImageDraw

CANVAS = (1000, 800)


def catmull_rom(points, subdiv=14, closed=True):
    """Return a dense list of points along a Catmull-Rom spline."""
    pts = list(points)
    n = len(pts)
    out = []
    rng = n if closed else n - 1
    for i in range(rng):
        p0 = pts[(i - 1) % n] if closed else pts[max(i - 1, 0)]
        p1 = pts[i]
        p2 = pts[(i + 1) % n] if closed else pts[min(i + 1, n - 1)]
        p3 = pts[(i + 2) % n] if closed else pts[min(i + 2, n - 1)]
        for s in range(subdiv):
            t = s / subdiv
            t2, t3 = t * t, t * t * t
            x = 0.5 * ((2 * p1[0]) + (-p0[0] + p2[0]) * t
                       + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2
                       + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3)
            y = 0.5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * t
                       + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2
                       + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3)
            out.append((x, y))
    if not closed:
        out.append(pts[-1])
    return out


def wavy_strip(x0, y0, x1, y1, width, waves=1.5, amp=25, steps=24, taper=True, phase=0.0):
    """A tentacle/leg: a thin wavy strip from (x0,y0) to (x1,y1) as a closed polygon."""
    left, right = [], []
    dx, dy = x1 - x0, y1 - y0
    length = math.hypot(dx, dy)
    nx, ny = -dy / length, dx / length  # normal
    for i in range(steps + 1):
        t = i / steps
        off = amp * math.sin(t * waves * 2 * math.pi + phase)
        cx = x0 + dx * t + nx * off
        cy = y0 + dy * t + ny * off
        w = width * (1 - 0.65 * t) if taper else width
        left.append((cx + nx * w / 2, cy + ny * w / 2))
        right.append((cx - nx * w / 2, cy - ny * w / 2))
    return left + right[::-1]


def curl(cx, cy, r0, r1, turns, width, steps=40, start=0.0, ccw=True):
    """A tapering spiral strip (seahorse / octopus tail)."""
    left, right = [], []
    for i in range(steps + 1):
        t = i / steps
        a = start + (1 if ccw else -1) * t * turns * 2 * math.pi
        r = r0 + (r1 - r0) * t
        x, y = cx + r * math.cos(a), cy + r * math.sin(a)
        nx, ny = math.cos(a), math.sin(a)
        w = width * (1 - 0.7 * t)
        left.append((x + nx * w / 2, y + ny * w / 2))
        right.append((x - nx * w / 2, y - ny * w / 2))
    return left + right[::-1]


# ---------------------------------------------------------------------------
# Species definitions
# ---------------------------------------------------------------------------
# blobs:  list of ("spline", points) or ("poly", points)
# guides: list of ("circle", (cx, cy, r)) or ("curve", points)
# motion: how the aquarium animates it (see aquarium/app.js)

SPECIES = {}


# natural body colour (R, G, B) used wherever the child left the paper white
NATURAL = {
    "clownfish": (255, 122, 30), "shark": (128, 146, 160), "turtle": (86, 140, 62), "seahorse": (233, 170, 60),
    "ray": (70, 88, 108), "jellyfish": (242, 184, 214), "octopus": (204, 88, 64), "crab": (220, 70, 45),
}


def _add(name, label, motion, blobs, guides, facing="right"):
    SPECIES[name] = dict(label=label, motion=motion, blobs=blobs, guides=guides, facing=facing, color=NATURAL[name])


# Clownfish: chubby oval body, rounded fins, rounded tail, three white bands.
_add("clownfish", "Clownfish", "swim", [
    ("spline", [(280, 400), (330, 295), (450, 240), (600, 235), (730, 285), (830, 380), (835, 420), (740, 510), (600, 565), (450, 560), (330, 505)]),
    ("spline", [(300, 400), (240, 320), (160, 285), (125, 330), (140, 400), (125, 470), (160, 515), (240, 480)]),
    ("spline", [(400, 260), (470, 175), (600, 160), (690, 230)]),
    ("spline", [(470, 545), (520, 640), (620, 630), (690, 540)]),
    ("spline", [(560, 560), (580, 620), (620, 610)]),
], [
    ("circle", (745, 370, 20)),
    ("curve", [(810, 440), (835, 428)]),
    ("curve", [(390, 265), (360, 400), (390, 540)]),
    ("curve", [(420, 262), (395, 400), (420, 545)]),
    ("curve", [(560, 240), (540, 400), (560, 560)]),
    ("curve", [(590, 240), (570, 400), (590, 560)]),
    ("curve", [(700, 290), (700, 500)]),
    ("curve", [(620, 400), (680, 450), (620, 490), (600, 430)]),
])

# Great white: long fusiform body, heterocercal tail, tall dorsal, swept pectoral.
_add("shark", "Shark", "swim", [
    ("spline", [(150, 420), (230, 360), (350, 322), (500, 308), (650, 318), (800, 352), (905, 400), (900, 425), (800, 458), (650, 486), (500, 496), (350, 490), (230, 472)]),
    ("spline", [(215, 380), (170, 300), (110, 230), (140, 210), (215, 300), (240, 385), (230, 420), (200, 500), (140, 570), (170, 585), (240, 470), (235, 425)]),
    ("spline", [(470, 315), (505, 190), (535, 165), (610, 315)]),
    ("spline", [(560, 486), (500, 620), (470, 655), (445, 640), (520, 496)]),
    ("spline", [(720, 345), (742, 295), (770, 348)]),
    ("spline", [(690, 480), (705, 530), (740, 484)]),
], [
    ("circle", (825, 385, 12)),
    ("curve", [(840, 440), (885, 425)]),
    ("curve", [(690, 345), (695, 470)]), ("curve", [(715, 342), (720, 472)]),
    ("curve", [(740, 342), (745, 470)]), ("curve", [(765, 345), (770, 466)]),
    ("curve", [(250, 445), (500, 468), (800, 440)]),
])

# Sea turtle seen from above: oval shell, long paddle flippers, small rear flippers.
_add("turtle", "Sea Turtle", "swim_slow", [
    ("spline", [(300, 400), (340, 270), (450, 205), (560, 200), (670, 260), (710, 400), (670, 540), (560, 600), (450, 595), (340, 530)]),
    ("spline", [(695, 400), (730, 355), (800, 335), (870, 350), (905, 390), (870, 440), (800, 465), (730, 445)]),
    ("spline", [(580, 255), (640, 180), (760, 110), (850, 80), (880, 100), (830, 180), (720, 262), (640, 300)]),
    ("spline", [(580, 545), (640, 620), (760, 690), (850, 720), (880, 700), (830, 620), (720, 538), (640, 500)]),
    ("spline", [(370, 265), (330, 200), (260, 170), (240, 200), (300, 290), (360, 320)]),
    ("spline", [(370, 535), (330, 600), (260, 630), (240, 600), (300, 510), (360, 480)]),
    ("spline", [(310, 385), (250, 390), (225, 400), (250, 410), (310, 415)]),
], [
    ("circle", (845, 385, 12)),
    ("curve", [(430, 330), (500, 300), (580, 330), (600, 400), (580, 470), (500, 500), (430, 470), (410, 400), (430, 330)]),
    ("curve", [(430, 330), (400, 270)]), ("curve", [(580, 330), (620, 270)]),
    ("curve", [(430, 470), (400, 530)]), ("curve", [(580, 470), (620, 530)]),
    ("curve", [(410, 400), (330, 400)]), ("curve", [(600, 400), (680, 400)]),
    ("curve", [(500, 300), (500, 220)]), ("curve", [(500, 500), (500, 580)]),
])

# Seahorse: crowned head, tube snout, curved neck, ridged belly, curled tail.
_seahorse_blobs = [
    ("spline", [(500, 150), (540, 110), (600, 118), (640, 168), (632, 222), (590, 252), (540, 262), (490, 242), (468, 200)]),
    ("spline", [(600, 232), (700, 250), (742, 265), (738, 287), (690, 292), (600, 276)]),
    ("spline", [(520, 122), (505, 72), (540, 92), (560, 50), (585, 96), (622, 78), (612, 132)]),
    ("spline", [(482, 232), (540, 262), (598, 330), (648, 430), (660, 530), (632, 620), (572, 680), (512, 700), (462, 682), (440, 600), (440, 500), (452, 400), (452, 300)]),
    ("spline", [(640, 420), (700, 380), (722, 432), (702, 522), (652, 532)]),
    ("poly", curl(440, 720, 70, 20, 0.9, 60, start=-0.3, ccw=True)),
]
_add("seahorse", "Seahorse", "upright", _seahorse_blobs, [
    ("circle", (585, 172, 12)),
    ("curve", [(490, 350), (530, 370)]), ("curve", [(490, 410), (540, 432)]),
    ("curve", [(495, 470), (545, 492)]), ("curve", [(500, 530), (548, 552)]),
    ("curve", [(510, 590), (555, 610)]),
], facing="up")

# Manta ray from above: swept wings with pointed tips, cephalic lobes, whip tail.
_add("ray", "Manta Ray", "glide", [
    ("spline", [(830, 400), (770, 335), (660, 300), (520, 150), (330, 170), (215, 240), (240, 380), (300, 400), (240, 420), (215, 560), (330, 630), (520, 650), (660, 500), (770, 465)]),
    ("spline", [(790, 355), (850, 330), (880, 345), (840, 385)]),
    ("spline", [(790, 445), (850, 470), (880, 455), (840, 415)]),
    ("poly", [(260, 393), (60, 386), (35, 400), (60, 414), (260, 407)]),
], [
    ("circle", (745, 350, 9)), ("circle", (745, 450, 9)),
    ("curve", [(560, 300), (600, 330), (600, 470), (560, 500)]),
    ("curve", [(640, 340), (650, 460)]),
    ("circle", (450, 320, 14)), ("circle", (400, 440, 10)), ("circle", (520, 520, 12)),
])

# Jellyfish: scalloped bell, frilly oral arms, long thin trailing tentacles.
_jelly_blobs = [("spline", [(200, 380), (220, 260), (320, 150), (500, 100), (680, 150), (780, 260), (800, 380), (720, 415), (650, 390), (580, 415), (500, 395), (420, 415), (350, 390), (280, 415)])]
for i, (x, ln, w) in enumerate([(280, 300, 22), (360, 380, 30), (440, 330, 26), (520, 400, 30), (600, 350, 26), (680, 310, 22), (750, 260, 18)]):
    _jelly_blobs.append(("poly", wavy_strip(x, 400, x + (i - 3) * 18, 400 + ln, w, waves=1.3, amp=18 + i * 2, phase=i)))
_add("jellyfish", "Jellyfish", "pulse", _jelly_blobs, [
    ("circle", (440, 290, 13)), ("circle", (560, 290, 13)),
    ("curve", [(465, 345), (500, 362), (535, 345)]),
    ("curve", [(300, 260), (500, 200), (700, 260)]),
], facing="up")

# Octopus: bulbous mantle, eyes at its base, eight curling arms.
_octo_blobs = [("spline", [(360, 340), (350, 200), (420, 110), (500, 90), (580, 110), (650, 200), (640, 340), (600, 390), (500, 410), (400, 390)])]
for i, (x0, x1, ln) in enumerate([(380, 110, 700), (420, 220, 760), (460, 350, 790), (490, 440, 740), (510, 560, 740), (540, 650, 790), (580, 780, 760), (620, 890, 700)]):
    _octo_blobs.append(("poly", wavy_strip(x0, 380, x1, ln, 46, waves=0.9, amp=30, phase=i * 0.8)))
_add("octopus", "Octopus", "pulse", _octo_blobs, [
    ("circle", (440, 330, 18)), ("circle", (560, 330, 18)),
    ("curve", [(475, 380), (500, 392), (525, 380)]),
    ("curve", [(430, 180), (500, 150), (570, 180)]),
], facing="up")

# Crab: wide oval carapace, big pincers, four jointed legs per side, eye stalks.
_crab_blobs = [
    ("spline", [(280, 400), (320, 318), (420, 270), (500, 262), (580, 270), (680, 318), (720, 400), (680, 470), (580, 510), (500, 520), (420, 510), (320, 470)]),
    ("poly", [(430, 290), (470, 290), (462, 225), (438, 225)]),
    ("poly", [(530, 290), (570, 290), (562, 225), (538, 225)]),
]
for side in (1, -1):
    m = lambda x: 500 + side * (x - 500)
    _crab_blobs.append(("spline", [(m(690), 385), (m(760), 335), (m(830), 322), (m(800), 380), (m(730), 420)]))          # arm
    _crab_blobs.append(("spline", [(m(800), 300), (m(880), 262), (m(950), 285), (m(940), 325), (m(870), 335), (m(810), 340)]))  # upper pincer
    _crab_blobs.append(("spline", [(m(800), 345), (m(870), 350), (m(945), 350), (m(945), 385), (m(880), 405), (m(810), 395)]))  # lower pincer
    for j, (yy, dx, dy) in enumerate([(400, 190, 60), (430, 200, 130), (460, 190, 200), (480, 160, 250)]):
        x0 = 500 + side * 175
        _crab_blobs.append(("poly", wavy_strip(x0, yy, x0 + side * dx, yy + dy, 30, waves=0.5, amp=22, taper=True)))
_add("crab", "Crab", "crawl", _crab_blobs, [
    ("circle", (450, 222, 14)), ("circle", (550, 222, 14)),
    ("curve", [(460, 465), (500, 485), (540, 465)]),
    ("curve", [(360, 330), (420, 350), (500, 340), (580, 350), (640, 330)]),
], facing="up")


# ---------------------------------------------------------------------------
# Rendering helpers
# ---------------------------------------------------------------------------

def blob_points(blob):
    kind, pts = blob
    return catmull_rom(pts) if kind == "spline" else list(pts)


def render_mask(name, size=CANVAS):
    """Binary mask (uint8 0/255) of the species on the 1000x800 canvas."""
    img = Image.new("L", size, 0)
    d = ImageDraw.Draw(img)
    for blob in SPECIES[name]["blobs"]:
        d.polygon(blob_points(blob), fill=255)
    return np.array(img)


def render_guides(name, draw, transform, color=(150, 150, 150), width=3):
    """Draw the grey guide lines onto a PIL ImageDraw using transform(x,y)->(X,Y)."""
    for kind, data in SPECIES[name]["guides"]:
        if kind == "circle":
            cx, cy, r = data
            X, Y = transform(cx, cy)
            R = transform(cx + r, cy)[0] - X
            draw.ellipse([X - R, Y - R, X + R, Y + R], outline=color, width=width)
        else:
            pts = catmull_rom(data, subdiv=10, closed=False)
            draw.line([transform(*p) for p in pts], fill=color, width=width, joint="curve")


if __name__ == "__main__":
    # Quick preview sheet of every species.
    tiles = []
    for n in SPECIES:
        m = Image.fromarray(render_mask(n)).convert("RGB")
        d = ImageDraw.Draw(m)
        render_guides(n, d, lambda x, y: (x, y), color=(255, 0, 0))
        tiles.append(m.resize((500, 400)))
    sheet = Image.new("RGB", (1000, 400 * ((len(tiles) + 1) // 2)), "black")
    for i, t in enumerate(tiles):
        sheet.paste(t, ((i % 2) * 500, (i // 2) * 400))
    sheet.save("species_preview.png")
    print("wrote species_preview.png")
