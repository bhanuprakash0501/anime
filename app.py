"""
Sketch Aquarium station.

  python app.py                 # webcam scanner window + aquarium at http://localhost:8000
  python app.py --no-camera     # aquarium only (use scanner.py <image> to add drawings)
  python app.py --camera 1      # pick a different webcam
  python app.py --image x.jpg   # scan one photo, then serve the aquarium

Scanner window keys:  s = scan now   c = clear aquarium   q = quit
Aquarium keys (browser):  f = fullscreen
"""
import argparse
import json
import os
import threading
import time
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler

import cv2
import numpy as np

import scanner

HERE = os.path.dirname(os.path.abspath(__file__))
WEB_DIR = os.path.join(HERE, "aquarium")


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=WEB_DIR, **kw)

    def log_message(self, *a):  # quiet
        pass

    def handle(self):
        # Load-balancer health checks open a TCP connection and drop it without a
        # request; that is not worth a traceback in the journal.
        try:
            super().handle()
        except (ConnectionResetError, BrokenPipeError, TimeoutError):
            pass

    def send_json(self, obj, code=200):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def public_base(self):
        """Address visitors should use: --public-url if set, else what the reverse proxy
        (X-Forwarded-*) or the Host header says, else this machine's LAN address."""
        if PUBLIC_URL:
            return PUBLIC_URL
        host = self.headers.get("X-Forwarded-Host") or self.headers.get("Host")
        proto = self.headers.get("X-Forwarded-Proto", "http")
        if host and not host.startswith(("localhost", "127.")):
            return f"{proto}://{host}"
        return f"http://{lan_ip()}:{PORT}"

    def authorized(self):
        return not ADMIN_KEY or self.headers.get("X-Admin-Key", "") == ADMIN_KEY

    def do_POST(self):
        if self.path.startswith("/api/admin/"):
            if not self.authorized():
                return self.send_json(dict(ok=False, error="admin key required"), 401)
            n = int(self.headers.get("Content-Length", 0))
            try:
                body = json.loads(self.rfile.read(n) or b"{}") if n else {}
            except ValueError:
                body = {}
            op = self.path.split("/api/admin/", 1)[1].split("?")[0]
            return self.send_json(admin_action(op, body))
        if self.path.startswith("/api/scan"):
            n = int(self.headers.get("Content-Length", 0))
            if n <= 0 or n > 30 * 1024 * 1024:
                return self.send_json(dict(ok=False, error="no photo received"), 400)
            data = self.rfile.read(n)
            try:
                result = scan_bytes(data)
            except Exception as e:  # never let a bad photo kill the request
                print("scan error:", e)
                result = dict(ok=False, error="could not process that photo")
            return self.send_json(result)
        self.send_error(404)

    def do_GET(self):
        if self.path.startswith("/api/sprites"):
            self.send_json(live_entries())
        elif self.path.startswith("/api/admin/list"):
            if not self.authorized():
                return self.send_json(dict(ok=False, error="admin key required"), 401)
            self.send_json(admin_list())
        elif self.path == "/admin" or self.path.startswith("/admin?"):
            self.path = "/admin.html"
            super().do_GET()
        elif self.path.startswith("/api/info"):
            self.send_json(dict(scan_url=f"{self.public_base()}/scan", ttl=TTL_SECONDS))
        elif self.path == "/scan" or self.path.startswith("/scan?"):
            self.path = "/scan.html"
            super().do_GET()
        elif self.path.startswith("/sprites/"):
            p = os.path.join(scanner.SPRITES_DIR, os.path.basename(self.path.split("?")[0]))
            if os.path.exists(p):
                with open(p, "rb") as f:
                    data = f.read()
                self.send_response(200)
                self.send_header("Content-Type", "image/png")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)
            else:
                self.send_error(404)
        else:
            super().do_GET()


TTL_SECONDS = 120.0   # how long a scanned creature stays in the tank (--ttl)
PORT = 8000
ADMIN_KEY = ""        # optional; --admin-key makes /admin ask for it
PUBLIC_URL = ""       # e.g. https://anime.monagadu.com when behind a reverse proxy (--public-url / PUBLIC_URL env)
HISTORY_SECONDS = 3600   # how long expired/removed creatures stay listed on the admin page


def admin_list():
    """Every creature from the last hour with its live/expired state and clock info."""
    now = time.time()
    out = []
    for e in scanner.load_manifest():
        ttl = e.get("ttl", TTL_SECONDS)
        expires_at = e["ts"] / 1000.0 + ttl
        live = expires_at > now and not e.get("removed")
        if not live and now - e["ts"] / 1000.0 > HISTORY_SECONDS:
            continue
        out.append(dict(e, label=scanner.L["species"][e["species"]]["label"], live=live,
                        expires_at=expires_at, ttl=ttl, removed=bool(e.get("removed"))))
    out.sort(key=lambda e: -e["ts"])
    return dict(ok=True, now=now, ttl=TTL_SECONDS, entries=out)


def admin_action(op, body):
    eid = body.get("id")

    def edit(fn):
        found = []

        def apply(manifest):
            for e in manifest:
                if e["id"] == eid:
                    fn(e)
                    found.append(e)
            return manifest
        scanner.update_manifest(apply)
        return dict(ok=True) if found else dict(ok=False, error="no such creature")

    if op == "delete":           # take it out of the tank now, keep it in history
        return edit(lambda e: e.__setitem__("removed", True))
    if op == "extend":
        secs = float(body.get("seconds", 120))

        def ext(e):
            now = time.time()
            remaining = max(0.0, e["ts"] / 1000.0 + e.get("ttl", TTL_SECONDS) - now)
            e["ttl"] = (now - e["ts"] / 1000.0) + remaining + secs
        return edit(ext)
    if op == "revive":           # back into the tank with a fresh clock (enters through the pipe)
        def rev(e):
            e["ts"] = int(time.time() * 1000)
            e["ttl"] = TTL_SECONDS
            e.pop("removed", None)
        return edit(rev)
    if op == "forget":           # drop from history and delete its files
        def drop(manifest):
            keep = []
            for e in manifest:
                if e["id"] == eid:
                    for k in ("sprite", "name"):
                        if e.get(k):
                            try:
                                os.remove(os.path.join(scanner.SPRITES_DIR, os.path.basename(e[k])))
                            except OSError:
                                pass
                else:
                    keep.append(e)
            return keep
        scanner.update_manifest(drop)
        return dict(ok=True)
    if op == "clear":
        def clear(manifest):
            for e in manifest:
                e["removed"] = True
            return manifest
        scanner.update_manifest(clear)
        return dict(ok=True)
    return dict(ok=False, error="unknown action")


def lan_ip():
    """This machine's address on the local network (what phones should open)."""
    import socket
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))          # no packets are sent; picks the outbound interface
        ip = s.getsockname()[0]
        s.close()
        return ip
    except OSError:
        return "localhost"


def scan_bytes(data, max_side=2200):
    """Decode an uploaded photo, scan it, and describe the result for the web page."""
    img = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        return dict(ok=False, error="that file is not an image")
    s = max_side / max(img.shape[:2])
    if s < 1:
        img = cv2.resize(img, None, fx=s, fy=s, interpolation=cv2.INTER_AREA)
    det = scanner.detect(img)
    if det is None:
        # keep the photo so failures can be diagnosed later
        failed = os.path.join(INBOX, "failed")
        os.makedirs(failed, exist_ok=True)
        cv2.imwrite(os.path.join(failed, f"web_{int(time.time())}.jpg"), img, [cv2.IMWRITE_JPEG_QUALITY, 85])
        return dict(ok=False, error="No sheet found. Get the whole sheet with all four corner markers in the photo, flat and well lit.")
    entry = scanner.save_sprite(det)
    if entry is None:
        return dict(ok=False, error="The drawing could not be read. Try again with less glare.")
    print("web scan:", entry["species"], "name" if entry["name"] else "(no name)")
    return dict(ok=True, species=entry["species"], label=scanner.L["species"][entry["species"]]["label"],
                sprite=entry["sprite"], name=bool(entry["name"]))


def live_entries():
    """Manifest entries that have not timed out, each with its remaining seconds."""
    now = time.time()
    out = []
    for e in scanner.load_manifest():
        if e.get("removed"):
            continue
        remaining = e.get("ttl", TTL_SECONDS) - (now - e["ts"] / 1000.0)
        if remaining > 0:
            out.append(dict(e, expires_in=round(remaining, 1)))
    return out


INBOX = os.path.join(HERE, "inbox")
IMAGE_EXT = (".jpg", ".jpeg", ".png", ".bmp", ".webp")


def inbox_loop():
    """Scan any photo dropped into inbox/ and move it to inbox/done (or inbox/failed)."""
    done, failed = os.path.join(INBOX, "done"), os.path.join(INBOX, "failed")
    for d in (INBOX, done, failed):
        os.makedirs(d, exist_ok=True)
    while True:
        for name in sorted(os.listdir(INBOX)):
            path = os.path.join(INBOX, name)
            if not (os.path.isfile(path) and name.lower().endswith(IMAGE_EXT)):
                continue
            # wait until the file has finished copying
            size = -1
            while size != os.path.getsize(path):
                size = os.path.getsize(path)
                time.sleep(0.3)
            try:
                entry = scanner.scan_image_file(path)
            except Exception as e:  # keep the watcher alive whatever the photo does
                print("inbox error:", name, e)
                entry = None
            dest = os.path.join(done if entry else failed, f"{int(time.time())}_{name}")
            try:
                os.replace(path, dest)
            except OSError:
                pass
        time.sleep(1.0)


def serve(port):
    ThreadingHTTPServer.request_queue_size = 64      # a roomful of phones, not the default 5
    ThreadingHTTPServer.daemon_threads = True
    srv = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    t = threading.Thread(target=srv.serve_forever, daemon=True)
    t.start()
    base = PUBLIC_URL or f"http://{lan_ip()}:{port}"
    print(f"Aquarium:  {base}/   (press f in the browser for fullscreen)")
    print(f"Scan page: {base}/scan   (open on any phone or laptop)")
    print(f"Admin:     {base}/admin")
    return srv


def clear_aquarium():
    os.makedirs(scanner.SPRITES_DIR, exist_ok=True)
    with open(scanner.MANIFEST, "w") as f:
        json.dump([], f)


def open_camera(cam_index, width, height):
    """Try the requested index first, then 0-4, across the Windows backends.
    Returns an opened VideoCapture that delivers frames, or None."""
    backends = [("MSMF", cv2.CAP_MSMF), ("DSHOW", cv2.CAP_DSHOW), ("ANY", cv2.CAP_ANY)] if os.name == "nt" else [("ANY", cv2.CAP_ANY)]
    indices = [cam_index] + [i for i in range(5) if i != cam_index]
    for idx in indices:
        for bname, be in backends:
            cap = cv2.VideoCapture(idx, be)
            if cap.isOpened():
                cap.set(cv2.CAP_PROP_FRAME_WIDTH, width)
                cap.set(cv2.CAP_PROP_FRAME_HEIGHT, height)
                ok, _ = cap.read()
                if ok:
                    print(f"Camera: index {idx} via {bname}")
                    return cap
            cap.release()
    return None


def wait_for_camera(cam_index, width, height):
    """Block until a camera can be opened, keeping the aquarium served meanwhile."""
    cap = open_camera(cam_index, width, height)
    if cap is not None:
        return cap
    print("No camera found. The aquarium keeps running; plug in a webcam and the scanner will start automatically.")
    print("(Windows: Settings > Privacy & security > Camera must allow desktop apps. Ctrl+C to stop.)")
    while cap is None:
        time.sleep(5)
        cap = open_camera(cam_index, width, height)
    return cap


def camera_loop(cam_index, width, height):
    cap = wait_for_camera(cam_index, width, height)
    print("Scanner: hold a colored sheet flat in front of the camera. s=scan c=clear q=quit")

    stable_frames, last_corners, last_species = 0, None, None
    armed = True            # becomes False after a scan until the sheet is removed
    absent_frames = 0
    flash_until = 0
    STABLE_NEEDED = 10

    while True:
        ok, frame = cap.read()
        if not ok:
            # camera unplugged mid-session: wait for it to come back
            cap.release()
            cv2.destroyAllWindows()
            print("Camera lost, waiting for it to return...")
            cap = wait_for_camera(cam_index, width, height)
            continue
        det = scanner.detect(frame)
        view = frame.copy()
        key = cv2.waitKey(1) & 0xFF

        if det is not None:
            absent_frames = 0
            moved = last_corners is None or np.abs(det.corners - last_corners).max() > 6
            stable_frames = 0 if (moved or det.species != last_species) else stable_frames + 1
            last_corners, last_species = det.corners, det.species
            color = (0, 255, 0) if armed else (0, 200, 255)
            cv2.polylines(view, [det.corners.astype(np.int32)], True, color, 3)
            label = scanner.L["species"][det.species]["label"]
            msg = f"{label}  hold still {min(stable_frames, STABLE_NEEDED)}/{STABLE_NEEDED}" if armed else f"{label}  scanned - remove sheet"
            cv2.putText(view, msg, (int(det.corners[0][0]), max(int(det.corners[0][1]) - 12, 24)),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.8, color, 2)
            if (armed and stable_frames >= STABLE_NEEDED) or key == ord("s"):
                entry = scanner.save_sprite(det)
                if entry:
                    print("added", entry["species"], "name" if entry["name"] else "(no name)")
                    flash_until = time.time() + 1.0
                    armed = False
                    stable_frames = 0
        else:
            stable_frames, last_corners = 0, None
            absent_frames += 1
            if absent_frames > 15:
                armed = True
            cv2.putText(view, "Show me a colored sheet!", (20, 40), cv2.FONT_HERSHEY_SIMPLEX, 1.0, (255, 255, 255), 2)

        if time.time() < flash_until:
            view = cv2.addWeighted(view, 0.4, np.full_like(view, 255), 0.6, 0)
            cv2.putText(view, "Added to the aquarium!", (20, 80), cv2.FONT_HERSHEY_SIMPLEX, 1.2, (0, 140, 0), 3)

        cv2.imshow("Sketch Aquarium - scanner", view)
        if key == ord("q") or cv2.getWindowProperty("Sketch Aquarium - scanner", cv2.WND_PROP_VISIBLE) < 1:
            break
        if key == ord("c"):
            clear_aquarium()
            print("aquarium cleared")
    cap.release()
    cv2.destroyAllWindows()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8000)
    ap.add_argument("--camera", type=int, default=0)
    ap.add_argument("--width", type=int, default=1280)
    ap.add_argument("--height", type=int, default=720)
    ap.add_argument("--webcam", action="store_true", help="also run the local webcam scanner window")
    ap.add_argument("--no-camera", action="store_true", help=argparse.SUPPRESS)   # old default, kept for compatibility
    ap.add_argument("--image", nargs="+", help="scan these photos on start")
    ap.add_argument("--clear", action="store_true", help="empty the aquarium on start")
    ap.add_argument("--ttl", type=float, default=120, help="seconds each creature stays on screen (default 120)")
    ap.add_argument("--admin-key", default=os.environ.get("ADMIN_KEY", ""), help="password for the /admin page (default: none)")
    ap.add_argument("--public-url", default=os.environ.get("PUBLIC_URL", ""),
                    help="public address shown to visitors, e.g. https://anime.monagadu.com (behind a reverse proxy)")
    a = ap.parse_args()
    global TTL_SECONDS, PORT, ADMIN_KEY, PUBLIC_URL
    TTL_SECONDS = a.ttl
    PORT = a.port
    ADMIN_KEY = a.admin_key
    PUBLIC_URL = a.public_url.rstrip("/")

    if a.clear:
        clear_aquarium()
    os.makedirs(scanner.SPRITES_DIR, exist_ok=True)
    serve(a.port)
    threading.Thread(target=inbox_loop, daemon=True).start()
    print(f"Inbox: drop photos of colored sheets into {INBOX} to add them")
    for p in a.image or []:
        scanner.scan_image_file(p)
    if not a.webcam:
        print("serving... Ctrl+C to stop   (add --webcam for the local webcam scanner window)")
        try:
            while True:
                time.sleep(1)
        except KeyboardInterrupt:
            pass
    else:
        try:
            camera_loop(a.camera, a.width, a.height)
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    main()
