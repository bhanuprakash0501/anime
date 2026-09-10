"""
Sheet scanner: find a coloring sheet in a camera frame, identify the species,
and lift the colored artwork + hand-written name off it as transparent sprites.

Pipeline
  1. find the ArUco corner markers (id = species*4 + corner); fit a homography from
     their corners and warp the photo to the canonical sheet (CANON_W x CANON_H).
     Fallback for marker-less sheets: black-frame quadrilaterals + the 8-bit ID row.
  2. white-balance against the paper, cut the art out with the species mask, fill
     uncolored paper with the species' natural color, extract ink from the name box.
"""
import json
import os
import threading
import time
import numpy as np
import cv2

HERE = os.path.dirname(os.path.abspath(__file__))
TPL_DIR = os.path.join(HERE, "templates")
SPRITES_DIR = os.path.join(HERE, "sprites")
MANIFEST = os.path.join(SPRITES_DIR, "manifest.json")
MANIFEST_LOCK = threading.Lock()   # scanner thread, web uploads and the admin page all edit it

with open(os.path.join(TPL_DIR, "layout.json")) as f:
    L = json.load(f)
CANON_W, CANON_H = L["canon"]
ID_TO_SPECIES = {v["id"]: k for k, v in L["species"].items()}
_MASKS = {}


def species_mask(name):
    if name not in _MASKS:
        _MASKS[name] = cv2.imread(os.path.join(TPL_DIR, "masks", f"{name}.png"), cv2.IMREAD_GRAYSCALE)
    return _MASKS[name]


# ---------------------------------------------------------------------------
# Geometry
# ---------------------------------------------------------------------------

def order_corners(pts):
    """Order 4 points as top-left, top-right, bottom-right, bottom-left."""
    pts = np.asarray(pts, dtype=np.float32).reshape(4, 2)
    s = pts.sum(1)
    d = np.diff(pts, axis=1).ravel()
    return np.array([pts[np.argmin(s)], pts[np.argmin(d)], pts[np.argmax(s)], pts[np.argmax(d)]], np.float32)


def find_quads(gray, min_area_frac=0.04):
    """Candidate 4-corner contours, biggest first."""
    h, w = gray.shape
    blur = cv2.GaussianBlur(gray, (5, 5), 0)
    cands = []
    # Two binarizations: global Otsu for even lighting, adaptive for uneven.
    _, th1 = cv2.threshold(blur, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    th2 = cv2.adaptiveThreshold(blur, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY_INV, 51, 8)
    for th in (th1, th2):
        contours, _ = cv2.findContours(th, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
        for c in contours:
            area = cv2.contourArea(c)
            if area < min_area_frac * w * h:
                continue
            peri = cv2.arcLength(c, True)
            approx = cv2.approxPolyDP(c, 0.03 * peri, True)
            if len(approx) == 4 and cv2.isContourConvex(approx):
                cands.append((area, order_corners(approx)))
    cands.sort(key=lambda t: -t[0])
    # de-duplicate near-identical quads
    out = []
    for area, q in cands:
        if all(np.abs(q - o).max() > 8 for _, o in out):
            out.append((area, q))
    return out


def warp_sheet(img, corners):
    """Perspective-warp the quad to canonical portrait size. Handles a
    landscape-oriented view by rotating the corner order."""
    tl, tr, br, bl = corners
    wide = (np.linalg.norm(tr - tl) + np.linalg.norm(br - bl)) / 2
    tall = (np.linalg.norm(bl - tl) + np.linalg.norm(br - tr)) / 2
    if wide > tall:  # sheet appears landscape -> rotate corner assignment
        corners = np.array([tr, br, bl, tl], np.float32)
    dst = np.array([[0, 0], [CANON_W - 1, 0], [CANON_W - 1, CANON_H - 1], [0, CANON_H - 1]], np.float32)
    M = cv2.getPerspectiveTransform(corners.astype(np.float32), dst)
    return cv2.warpPerspective(img, M, (CANON_W, CANON_H))


def fix_orientation(sheet):
    """The filled marker square must end up top-left. Try 0 and 180 degrees."""
    x0, y0, x1, y1 = L["marker"]
    g = cv2.cvtColor(sheet, cv2.COLOR_BGR2GRAY)

    def darkness(im):
        return 255 - im[y0 + 10:y1 - 10, x0 + 10:x1 - 10].mean()

    d0 = darkness(g)
    d180 = darkness(cv2.rotate(g, cv2.ROTATE_180))
    if d180 > d0:
        sheet = cv2.rotate(sheet, cv2.ROTATE_180)
    return sheet, max(d0, d180)


def read_bits(sheet):
    b = L["bits"]
    g = cv2.cvtColor(sheet, cv2.COLOR_BGR2GRAY)
    # reference: paper white near the bits, marker black
    white = np.median(g[b["y"]:b["y"] + b["cell"], b["x0"] - 60:b["x0"] - 15])
    mx0, my0, mx1, my1 = L["marker"]
    black = np.median(g[my0 + 10:my1 - 10, mx0 + 10:mx1 - 10])
    if white - black < 40:
        return None
    thresh = (white + black) / 2
    bits = []
    for i in range(b["n"]):
        x = b["x0"] + i * b["step"]
        cell = g[b["y"] + 12:b["y"] + b["cell"] - 12, x + 12:x + b["cell"] - 12]
        bits.append(1 if np.median(cell) < thresh else 0)
    return bits


def decode_bits(bits):
    if bits is None:
        return None
    a, b = bits[:4], bits[4:]
    if any(x == y for x, y in zip(a, b)):
        return None
    sid = int("".join(map(str, a)), 2)
    return sid if sid in ID_TO_SPECIES else None


# ---------------------------------------------------------------------------
# Content extraction
# ---------------------------------------------------------------------------

def white_balance(sheet, mask_art):
    """Scale channels so the un-colored paper around the drawing is white."""
    ax0, ay0, ax1, ay1 = L["art"]
    art = sheet[ay0:ay1, ax0:ax1].astype(np.float32)
    paper = art[mask_art == 0]
    if len(paper) < 100:
        return sheet
    ref = np.percentile(paper, 90, axis=0)  # bright paper per channel (B,G,R)
    ref = np.maximum(ref, 1)
    out = sheet.astype(np.float32) * (255.0 / ref)
    return np.clip(out, 0, 255).astype(np.uint8)


def extract_art(sheet, name):
    ax0, ay0, ax1, ay1 = L["art"]
    mask = species_mask(name)
    art = sheet[ay0:ay1, ax0:ax1]
    # Boost colors slightly (crayon on paper reads pale through a webcam).
    hsv = cv2.cvtColor(art, cv2.COLOR_BGR2HSV).astype(np.float32)
    hsv[..., 1] = np.clip(hsv[..., 1] * 1.35, 0, 255)
    art = cv2.cvtColor(hsv.astype(np.uint8), cv2.COLOR_HSV2BGR)
    # Uncolored paper inside the outline -> the animal's natural color. "Paper" means
    # bright and unsaturated; blend softly so light crayon strokes still show.
    r, g, b = L["species"][name]["color"]
    natural = np.array([b, g, r], np.float32)
    bright = hsv[..., 2] / 255.0
    sat = hsv[..., 1] / 255.0
    paper = np.clip((bright - 0.72) / 0.13, 0, 1) * np.clip((0.22 - sat) / 0.1, 0, 1)
    paper = cv2.GaussianBlur(paper.astype(np.float32), (5, 5), 0)[..., None]
    art = (art.astype(np.float32) * (1 - paper) + natural * paper).astype(np.uint8)
    # Slightly shrink + feather the mask so the printed outline forms a clean edge.
    m = cv2.erode(mask, np.ones((3, 3), np.uint8))
    m = cv2.GaussianBlur(m, (5, 5), 0)
    ys, xs = np.where(m > 10)
    if len(xs) == 0:
        return None
    x0, x1, y0, y1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
    # Outside the outline, continue the nearest colored pixel outward. The 3D models are
    # skinned by projecting this image, and their bodies do not match the outline exactly,
    # so the skin must not have paper-white gaps at the edges.
    inside = (mask > 128).astype(np.uint8)
    _, labels = cv2.distanceTransformWithLabels(1 - inside, cv2.DIST_L2, 5, labelType=cv2.DIST_LABEL_PIXEL)
    iy, ix = np.where(inside > 0)
    lut = np.zeros((labels.max() + 1, 2), np.int32)
    lut[labels[iy, ix]] = np.stack([iy, ix], 1)
    src = lut[labels]
    filled = art[src[..., 0], src[..., 1]]
    rgba = cv2.cvtColor(filled[y0:y1, x0:x1], cv2.COLOR_BGR2BGRA)
    rgba[..., 3] = m[y0:y1, x0:x1]
    return rgba


def extract_name(sheet):
    """Dark ink inside the name box -> BGRA sprite cropped to the writing."""
    nx0, ny0, nx1, ny1 = L["name_box"]
    pad = 14
    box = sheet[ny0 + pad:ny1 - pad, nx0 + pad:nx1 - pad]
    g = cv2.cvtColor(box, cv2.COLOR_BGR2GRAY)
    ink = cv2.adaptiveThreshold(g, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY_INV, 41, 18)
    # also require some real darkness (kills paper texture / shadows)
    ink[g > 200] = 0
    ink = cv2.morphologyEx(ink, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    n, lab, stats, _ = cv2.connectedComponentsWithStats(ink)
    keep = np.zeros_like(ink)
    H, W = ink.shape
    for i in range(1, n):
        x, y, w, h, area = stats[i]
        touches_edge = x <= 1 or y <= 1 or x + w >= W - 1 or y + h >= H - 1
        # real writing: a blob of some size that is not the box border or a shadow along it
        if area >= 60 and not touches_edge and h >= 12 and h <= H * 0.95:
            keep[lab == i] = 255
    total = keep.sum() / 255
    if total < 400:
        return None
    ys_, xs_ = np.where(keep > 0)
    if xs_.max() - xs_.min() < 40 or ys_.max() - ys_.min() < 15:   # a speck, not a name
        return None
    ys, xs = np.where(keep > 0)
    x0, x1, y0, y1 = max(xs.min() - 6, 0), xs.max() + 7, max(ys.min() - 6, 0), ys.max() + 7
    alpha = cv2.GaussianBlur(cv2.dilate(keep, np.ones((3, 3), np.uint8)), (3, 3), 0)
    rgba = cv2.cvtColor(box[y0:y1, x0:x1], cv2.COLOR_BGR2BGRA)
    # darken ink a bit so pale pencil still reads on a bright projection
    rgba[..., :3] = (rgba[..., :3].astype(np.float32) * 0.8).astype(np.uint8)
    rgba[..., 3] = alpha[y0:y1, x0:x1]
    return rgba


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

class Detection:
    def __init__(self, corners, sheet, species):
        self.corners, self.sheet, self.species = corners, sheet, species


def _aruco_detector():
    a = cv2.aruco
    d = a.getPredefinedDictionary(getattr(a, L["aruco"]["dict"]))
    p = a.DetectorParameters()
    p.cornerRefinementMethod = a.CORNER_REFINE_SUBPIX
    p.adaptiveThreshWinSizeMin, p.adaptiveThreshWinSizeMax, p.adaptiveThreshWinSizeStep = 3, 53, 10
    p.minMarkerPerimeterRate = 0.01
    return a.ArucoDetector(d, p)


_DETECTOR = None


def detect_markers(gray):
    """Return {id: 4x2 corners} for every ArUco marker found (tries a contrast-boosted pass too)."""
    global _DETECTOR
    if _DETECTOR is None:
        _DETECTOR = _aruco_detector()
    found = {}
    variants = [gray, cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8, 8)).apply(gray)]
    for img in variants:
        corners, ids, _ = _DETECTOR.detectMarkers(img)
        if ids is None:
            continue
        for c, i in zip(corners, ids.ravel()):
            found.setdefault(int(i), c.reshape(4, 2).astype(np.float32))
        if len(found) >= 4:
            break
    return found


def detect_by_markers(frame, gray):
    """Locate the sheet from its corner ArUco markers. Needs at least 2 markers of one species."""
    found = detect_markers(gray)
    n_species = len(ID_TO_SPECIES)
    by_species = {}
    for mid, c in found.items():
        sid, corner = mid // 4 + 1, mid % 4
        if sid in ID_TO_SPECIES:
            by_species.setdefault(sid, {})[corner] = c
    if not by_species:
        return None
    sid, marks = max(by_species.items(), key=lambda kv: len(kv[1]))
    if len(marks) < 2:
        return None
    mk = L["aruco"]["size"]
    src, dst = [], []
    for corner, c in marks.items():
        mx, my = L["aruco"]["markers"][str(corner)]
        src.extend(c.tolist())
        dst.extend([[mx, my], [mx + mk, my], [mx + mk, my + mk], [mx, my + mk]])
    src, dst = np.float32(src), np.float32(dst)
    H, _ = cv2.findHomography(src, dst, cv2.RANSAC, 6.0)
    if H is None:
        return None
    sheet = cv2.warpPerspective(frame, H, (CANON_W, CANON_H))
    # sheet outline in the photo (for the webcam overlay): map canonical corners back
    Hi = np.linalg.inv(H)
    quad = cv2.perspectiveTransform(np.float32([[[0, 0], [CANON_W, 0], [CANON_W, CANON_H], [0, CANON_H]]]), Hi)[0]
    det = Detection(quad, sheet, ID_TO_SPECIES[sid])
    det.markers = len(marks)
    return det


def detect(frame):
    """Locate a valid sheet in a BGR frame. Returns Detection or None.
    ArUco corner markers first (robust to angle, lighting and clutter); the older
    black-frame search is kept as a fallback for sheets printed without markers."""
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    det = detect_by_markers(frame, gray)
    if det is not None:
        return det
    for _, quad in find_quads(gray)[:6]:
        sheet0 = warp_sheet(frame, quad)
        for sheet in (sheet0, cv2.rotate(sheet0, cv2.ROTATE_180)):
            sid = decode_bits(read_bits(sheet))
            if sid is not None:
                return Detection(quad, sheet, ID_TO_SPECIES[sid])
    return None


def extract(det):
    """Return (art_bgra, name_bgra_or_None) for a Detection."""
    ax0, ay0, ax1, ay1 = L["art"]
    sheet = white_balance(det.sheet, species_mask(det.species))
    return extract_art(sheet, det.species), extract_name(sheet)


def save_sprite(det, max_w=640):
    """Extract, write PNGs and append to the manifest. Returns the manifest entry."""
    art, name_img = extract(det)
    if art is None:
        return None
    os.makedirs(SPRITES_DIR, exist_ok=True)
    ts = int(time.time() * 1000)
    base = f"{ts}_{det.species}"
    if art.shape[1] > max_w:
        s = max_w / art.shape[1]
        art = cv2.resize(art, None, fx=s, fy=s, interpolation=cv2.INTER_AREA)
    cv2.imwrite(os.path.join(SPRITES_DIR, base + ".png"), art)
    entry = dict(id=base, species=det.species, motion=L["species"][det.species]["motion"],
                 facing=L["species"][det.species]["facing"],
                 sprite=f"/sprites/{base}.png", name=None, ts=ts)
    if name_img is not None:
        cv2.imwrite(os.path.join(SPRITES_DIR, base + "_name.png"), name_img)
        entry["name"] = f"/sprites/{base}_name.png"
    with MANIFEST_LOCK:
        manifest = load_manifest()
        manifest.append(entry)
        write_manifest(manifest)
    return entry


def write_manifest(manifest):
    tmp = MANIFEST + ".tmp"
    with open(tmp, "w") as f:
        json.dump(manifest, f)
    os.replace(tmp, MANIFEST)


def update_manifest(fn):
    """Apply fn(list) -> list under the lock and save."""
    with MANIFEST_LOCK:
        manifest = fn(load_manifest())
        write_manifest(manifest)
    return manifest


def load_manifest():
    try:
        with open(MANIFEST) as f:
            return json.load(f)
    except (OSError, ValueError):
        return []


def scan_image_file(path, max_side=2200):
    """Scan a photo (jpg/png, e.g. from a phone). Returns the manifest entry or None."""
    img = cv2.imread(path)          # applies EXIF rotation for phone photos
    if img is None:
        print("cannot read", path)
        return None
    s = max_side / max(img.shape[:2])
    if s < 1:                        # phone photos are huge; the sheet needs only ~1500 px across
        img = cv2.resize(img, None, fx=s, fy=s, interpolation=cv2.INTER_AREA)
    det = detect(img)
    if det is None:
        print("no sheet found in", path)
        return None
    entry = save_sprite(det)
    print("scanned", path, "->", entry["species"], "name:", "yes" if entry["name"] else "no")
    return entry


if __name__ == "__main__":
    import sys
    for p in sys.argv[1:]:
        scan_image_file(p)
