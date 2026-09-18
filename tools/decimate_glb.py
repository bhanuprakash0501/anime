"""
Shrink a .glb for the aquarium.

The tank replaces every material with the child's drawing and projects its own UVs, so a
model only needs POSITION, NORMAL and indices. This script:

  * drops meshes whose name matches --drop (e.g. sucker detail nobody sees at tank size)
  * reduces the rest by vertex clustering (grid-snap vertices, collapse each cell to one
    vertex, drop the triangles that collapse to a line), searching for the cell size that
    lands nearest a triangle budget
  * strips textures, UVs and unused buffer data, and rewrites the file

Usage:
    python tools/decimate_glb.py in.glb out.glb --target 50000 --drop sucker --keep eye
"""
import argparse
import json
import math
import struct
import sys

TRIANGLES = 4
FLOAT, UINT32, UINT16 = 5126, 5125, 5123


# --------------------------------------------------------------------------- glb io
def read_glb(path):
    d = open(path, "rb").read()
    magic, ver, _ = struct.unpack_from("<III", d, 0)
    if magic != 0x46546C67 or ver != 2:
        raise SystemExit(f"{path}: not a glTF 2.0 binary file")
    off, js, binb = 12, None, b""
    while off < len(d):
        clen, ctype = struct.unpack_from("<II", d, off)
        off += 8
        chunk = d[off:off + clen]
        off += clen
        if ctype == 0x4E4F534A:
            js = json.loads(chunk.decode("utf-8"))
        elif ctype == 0x004E4942:
            binb = chunk
    return js, binb


def write_glb(path, js, binb):
    jb = json.dumps(js, separators=(",", ":")).encode("utf-8")
    jb += b" " * ((4 - len(jb) % 4) % 4)
    binb += b"\0" * ((4 - len(binb) % 4) % 4)
    with open(path, "wb") as f:
        f.write(struct.pack("<III", 0x46546C67, 2, 12 + 8 + len(jb) + 8 + len(binb)))
        f.write(struct.pack("<II", len(jb), 0x4E4F534A))
        f.write(jb)
        f.write(struct.pack("<II", len(binb), 0x004E4942))
        f.write(binb)


def read_accessor(js, binb, idx):
    """Return a flat list of numbers for accessor idx (handles byteStride)."""
    acc = js["accessors"][idx]
    ncomp = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}[acc["type"]]
    fmt, size = {FLOAT: ("f", 4), UINT32: ("I", 4), UINT16: ("H", 2)}[acc["componentType"]]
    bv = js["bufferViews"][acc["bufferView"]]
    base = bv.get("byteOffset", 0) + acc.get("byteOffset", 0)
    stride = bv.get("byteStride") or ncomp * size
    out = []
    for i in range(acc["count"]):
        out.extend(struct.unpack_from("<" + fmt * ncomp, binb, base + i * stride))
    return out


# ------------------------------------------------------------------- decimation
def cluster(pos, nrm, idx, cell):
    """Vertex clustering at the given cell size -> (positions, normals, indices)."""
    cells, reps = {}, []
    remap = [0] * (len(pos) // 3)
    inv = 1.0 / cell
    for v in range(len(pos) // 3):
        x, y, z = pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]
        key = (math.floor(x * inv), math.floor(y * inv), math.floor(z * inv))
        c = cells.get(key)
        if c is None:
            c = len(reps)
            cells[key] = c
            reps.append([0.0] * 6 + [0])
        remap[v] = c
        r = reps[c]
        r[0] += x; r[1] += y; r[2] += z
        if nrm:
            r[3] += nrm[v * 3]; r[4] += nrm[v * 3 + 1]; r[5] += nrm[v * 3 + 2]
        r[6] += 1

    npos, nnrm = [], []
    for r in reps:
        n = r[6]
        npos.extend([r[0] / n, r[1] / n, r[2] / n])
        ln = math.sqrt(r[3] * r[3] + r[4] * r[4] + r[5] * r[5])
        nnrm.extend([r[3] / ln, r[4] / ln, r[5] / ln] if ln > 1e-9 else [0.0, 1.0, 0.0])

    nidx, seen = [], set()
    for t in range(len(idx) // 3):
        a, b, c = remap[idx[t * 3]], remap[idx[t * 3 + 1]], remap[idx[t * 3 + 2]]
        if a == b or b == c or a == c:
            continue                      # collapsed to a line
        key = tuple(sorted((a, b, c)))
        if key in seen:                   # duplicate facet after collapse
            continue
        seen.add(key)
        nidx.extend([a, b, c])
    return npos, nnrm, nidx


def decimate_to(pos, nrm, idx, target):
    """Search for the cell size whose triangle count is closest to target."""
    xs = pos[0::3]; ys = pos[1::3]; zs = pos[2::3]
    diag = math.dist((min(xs), min(ys), min(zs)), (max(xs), max(ys), max(zs)))
    lo, hi = diag / 4000, diag / 4          # cell size bounds
    best = None
    for _ in range(14):
        mid = math.sqrt(lo * hi)           # geometric bisection
        p, n, i = cluster(pos, nrm, idx, mid)
        tris = len(i) // 3
        if best is None or abs(tris - target) < abs(best[0] - target):
            best = (tris, p, n, i)
        if tris > target:
            lo = mid                       # bigger cells -> fewer triangles
        else:
            hi = mid
        if 0.9 * target <= tris <= 1.05 * target:
            break
    return best[1], best[2], best[3]


# ------------------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("src")
    ap.add_argument("dst")
    ap.add_argument("--target", type=int, default=50000, help="triangle budget for the whole model")
    ap.add_argument("--drop", nargs="*", default=[], help="drop meshes whose name contains any of these")
    ap.add_argument("--keep", nargs="*", default=["eye"], help="never decimate meshes whose name contains these")
    a = ap.parse_args()

    js, binb = read_glb(a.src)
    meshes = js.get("meshes", [])

    # pass 1: read every primitive, decide drop / keep / decimate
    prims, total_kept = [], 0
    for mi, m in enumerate(meshes):
        name = (m.get("name") or "").lower()
        if any(d.lower() in name for d in a.drop):
            prims.append((mi, None))
            continue
        protect = any(k.lower() in name for k in a.keep)
        for p in m["primitives"]:
            if p.get("mode", TRIANGLES) != TRIANGLES or "indices" not in p:
                prims.append((mi, None))
                continue
            pos = read_accessor(js, binb, p["attributes"]["POSITION"])
            nrm = read_accessor(js, binb, p["attributes"]["NORMAL"]) if "NORMAL" in p["attributes"] else None
            idx = [int(v) for v in read_accessor(js, binb, p["indices"])]
            prims.append((mi, dict(p=p, pos=pos, nrm=nrm, idx=idx, protect=protect, name=m.get("name"))))
            if not protect:
                total_kept += len(idx) // 3

    # pass 2: decimate, sharing the budget in proportion to each primitive's size
    out_meshes, mesh_map, buf = [], {}, bytearray()
    accessors, views = [], []
    before = after = 0

    def add_view(data, target_kind=None):
        while len(buf) % 4:
            buf.append(0)
        views.append(dict(buffer=0, byteOffset=len(buf), byteLength=len(data)))
        buf.extend(data)
        return len(views) - 1

    for mi, m in enumerate(meshes):
        entries = [e for (m2, e) in prims if m2 == mi and e]
        if not entries:
            continue
        new_prims = []
        for e in entries:
            pos, nrm, idx = e["pos"], e["nrm"], e["idx"]
            tris_in = len(idx) // 3
            before += tris_in
            if not e["protect"] and total_kept > 0:
                share = max(300, int(a.target * tris_in / total_kept))
                if share < tris_in:
                    pos, nrm, idx = decimate_to(pos, nrm, idx, share)
            after += len(idx) // 3

            pv = add_view(struct.pack(f"<{len(pos)}f", *pos))
            xs, ys, zs = pos[0::3], pos[1::3], pos[2::3]
            accessors.append(dict(bufferView=pv, componentType=FLOAT, count=len(pos) // 3, type="VEC3",
                                  min=[min(xs), min(ys), min(zs)], max=[max(xs), max(ys), max(zs)]))
            ai_pos = len(accessors) - 1
            attrs = {"POSITION": ai_pos}
            if nrm:
                nv = add_view(struct.pack(f"<{len(nrm)}f", *nrm))
                accessors.append(dict(bufferView=nv, componentType=FLOAT, count=len(nrm) // 3, type="VEC3"))
                attrs["NORMAL"] = len(accessors) - 1
            iv = add_view(struct.pack(f"<{len(idx)}I", *idx))
            accessors.append(dict(bufferView=iv, componentType=UINT32, count=len(idx), type="SCALAR"))
            np_ = dict(attributes=attrs, indices=len(accessors) - 1)
            if "material" in e["p"]:
                np_["material"] = e["p"]["material"]
            new_prims.append(np_)
        mesh_map[mi] = len(out_meshes)
        out_meshes.append(dict(name=m.get("name"), primitives=new_prims))

    # rebuild nodes, dropping any that referenced a removed mesh
    nodes = js.get("nodes", [])
    keep_node = [True] * len(nodes)
    for i, n in enumerate(nodes):
        if "mesh" in n and n["mesh"] not in mesh_map:
            keep_node[i] = False
    node_map, new_nodes = {}, []
    for i, n in enumerate(nodes):
        if not keep_node[i]:
            continue
        node_map[i] = len(new_nodes)
        new_nodes.append(n)
    for n in new_nodes:
        if "mesh" in n:
            n["mesh"] = mesh_map[n["mesh"]]
        if "children" in n:
            kids = [node_map[c] for c in n["children"] if c in node_map]
            if kids:
                n["children"] = kids
            else:
                n.pop("children")
    for sc in js.get("scenes", []):
        sc["nodes"] = [node_map[i] for i in sc.get("nodes", []) if i in node_map]

    # materials keep their colours but lose textures (the drawing is the skin)
    for m in js.get("materials", []):
        m.pop("normalTexture", None); m.pop("occlusionTexture", None); m.pop("emissiveTexture", None)
        pbr = m.get("pbrMetallicRoughness", {})
        pbr.pop("baseColorTexture", None); pbr.pop("metallicRoughnessTexture", None)

    js["meshes"] = out_meshes
    js["nodes"] = new_nodes
    js["accessors"] = accessors
    js["bufferViews"] = views
    js["buffers"] = [dict(byteLength=len(buf))]
    for k in ("images", "textures", "samplers", "animations", "skins"):
        js.pop(k, None)

    write_glb(a.dst, js, bytes(buf))
    import os
    print(f"{a.src} -> {a.dst}")
    print(f"  triangles {before:,} -> {after:,}   ({100 * after / max(before, 1):.1f}%)")
    print(f"  bytes     {os.path.getsize(a.src):,} -> {os.path.getsize(a.dst):,}")
    print(f"  meshes    {len(meshes)} -> {len(out_meshes)}")


if __name__ == "__main__":
    main()
