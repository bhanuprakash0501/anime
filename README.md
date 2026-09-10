# Sketch Aquarium

A home-made version of the "paint it, scan it, watch it swim" exhibit: kids color a
printed sea creature, write their name on the sheet, hold it up to a webcam, and the
creature swims into a projected aquarium with the name floating above it.

## How it works

```
 printed sheet  --webcam-->  scanner.py  --PNG sprites-->  aquarium/ (browser, canvas)
 (templates/)               finds the black frame,          polls /api/sprites every 1.5 s
                            decodes the species ID bits,    and animates each creature
                            cuts the drawing out with the
                            species mask, lifts the ink
                            from the name box
```

* `shapes.py` - the eight creature silhouettes (clownfish, shark, turtle, seahorse,
  manta ray, jellyfish, octopus, crab) as smooth splines, plus grey coloring guides.
* `templates.py` - renders the printable sheets to `templates/*.png` and one
  `templates/all_sheets.pdf` (US Letter, 150 dpi). Each sheet has a square barcode
  (ArUco marker) in every corner whose ID encodes the species and the corner, so one
  detection gives the scanner the species, the orientation and an exact crop. The thick
  black frame and the 8-cell ID row are kept for the fallback path.
* `scanner.py` - OpenCV pipeline: find the corner markers (with a contrast-boosted retry),
  fit a homography from their corners, warp to the canonical sheet, then paper white
  balance, mask cut-out, natural-color fill, name-box ink extraction. Two markers are
  enough, so a thumb over one corner is fine. Sheets printed before the markers existed
  still scan through the older black-frame search. Writes `sprites/<ts>_<species>.png`,
  `..._name.png` and appends to `sprites/manifest.json`. Photos that fail are kept in
  `inbox/failed/` so they can be examined.
* `app.py` - runs the webcam scanner window and a tiny HTTP server for the aquarium.
* `aquarium/` - the projected scene, a three.js tank (bundled in `aquarium/vendor`, works
  offline). `aquarium/models.js` holds a rigged procedural 3D model per species: lathe-turned
  fish bodies with tail, dorsal, anal and pectoral fins, eyes, lips, and a scale bump map;
  a shark with gill slits and a toothed mouth; a domed turtle shell with scute relief, head and
  paddle flippers; a tapered seahorse with snout, crown and belly ridges; a thick-centred ray
  with flapping wings, cephalic lobes and a whip tail; a translucent jellyfish bell with oral
  arms and tentacles; an octopus with eight jointed curling arms and suckers; and a crab with
  eye stalks, opening pincers and eight walking legs. The child's coloring is projected onto
  each model as its skin (side view for fish, top view for turtle/ray/crab, front for the
  rest). Open `?showcase=1` (optionally `&only=crab,shark`) to review the models up close,
  and add `&tilt=1` for an overhead view (ray, turtle, crab).
  Creatures move in x, y and depth, turn through the water,
  cross the screen, sometimes swim out of frame and come back a few seconds later, and fade
  into the fog when far away. Motion types: swim (tail wag), glide (wing flap), pulse (bell
  squeeze), upright (sway), crawl (floor scuttle). A submarine pipe at the top right pumps
  every newly scanned creature into the tank with a burst of bubbles. Open `?pipe=1` to see
  all creatures enter through the pipe on load.
* `aquarium/scenery.js` builds the reef: noise-displaced boulders with a mottled stone
  texture, three rock formations with dark cave mouths, tufts of tapered swaying sea grass,
  tall kelp, and corals (branching staghorn, brain coral, sea fans, tube sponges, waving
  anemones). The cave formations are hideouts: now and then a swimmer or the crab heads for
  a cave mouth, slips in behind the rocks, rests out of sight for 4-10 seconds, then comes
  back out.
* The scan page offers the printable sheets as one PDF (`/templates.pdf`).
* Each creature stays for 2 minutes after its scan, then swims out of frame and retires.
  The server stops listing it too, so a page refresh does not bring it back. Change the
  timeout with `python app.py --ttl 300` (seconds) or `run.bat --ttl 300`.
* `make_synthetic.py` - end-to-end test with no printer or camera: colors each sheet
  with random crayon blotches, fakes a tilted photo, scans it, and seeds the aquarium.

## Setup

Windows quick start: double-click `setup.bat` once (creates the venv, installs the
dependencies, generates the sheets, optionally adds demo creatures), then `run.bat`
each time you want to start the station. `run.bat` opens the aquarium in your browser
and starts the scanner; pass options through, e.g. `run.bat --camera 1` or
`run.bat --no-camera`.

Manual setup:

```
cd sketch_aquarium
python -m venv .venv
.venv\Scripts\activate      # Windows (macOS/Linux: source .venv/bin/activate)
pip install -r requirements.txt
python templates.py        # makes templates/ (print all_sheets.pdf)
python make_synthetic.py   # optional: demo creatures + self-test (expect 8/8 passed)
python app.py              # scanner window + aquarium at http://localhost:8000
```

Open http://localhost:8000 on the projector screen and press `f` for fullscreen.

## Scanning from a phone or laptop (default)

The aquarium shows a QR code and the scan address in its corner, like
`http://192.168.1.20:8000/scan` (also printed in the console). Visitors point their phone
camera at the QR code, or type the address, on any phone, tablet or laptop on the same Wi-Fi:

* **Phones and tablets**: tap "Take a photo" - the native camera app opens - shoot the
  sheet, done. Works on iPhone and Android over plain HTTP, no install, no permissions
  dialog beyond the camera app itself.
* **Laptops / desktops**: on the station itself (localhost) the page shows a live camera
  preview with a "Take photo" button. On other computers use "Choose a photo".

The photo is resized and orientation-corrected in the browser before upload, then the
scanner runs on the station and the page reports which creature was added and whether a
name was found. The creature enters the tank through the pipe within two seconds.

Note: browsers only allow live camera preview on secure origins (localhost or HTTPS), which
is why phones use the camera app through the file picker. That path works on every phone.

If a phone cannot open the page, Windows Firewall is usually the reason. `setup.bat` asks
for admin rights once to allow port 8000; to do it by hand, run as Administrator:

```
netsh advfirewall firewall add rule name="Sketch Aquarium" dir=in action=allow protocol=TCP localport=8000
```

Phone and station must be on the same Wi-Fi (guest networks often isolate devices).

## Admin page

Open `http://<station>:8000/admin` (address printed at start). It shows a card for every
creature in the tank: the scanned drawing, the name as written, species, time added, and a
live countdown with a progress bar that turns orange in the last 45 seconds.

* **+2 min** extends a creature's time; the tank picks the change up within 2 seconds.
* **Delete** removes it from the tank at once. It moves to the "recently expired / removed"
  list below, where **Bring back** returns it through the pipe with a fresh clock, and
  **Forget** deletes it and its files for good.
* **Add creature (photo)** scans a photo from this device, same as the scan page.
* **Clear tank** removes everything currently swimming.

The page is open to anyone on the Wi-Fi by default. To require a password, start with
`run.bat --admin-key mysecret`; the page asks for it once and remembers it.

## Deploying to a Linux server behind HAProxy (https://anime.monagadu.com)

Serving over HTTPS makes the scan page a secure origin, so phones get the live in-page
camera preview instead of the camera-app picker.

```
.venv\Scripts\pip install -r deploy\requirements-deploy.txt
.venv\Scripts\python deploy\deploy.py --host 192.168.201.222 --user root
```

`deploy.py` copies the project to `/opt/sketch_aquarium` and runs `deploy/install.sh`,
which installs Python, the OpenCV system libraries and nginx, builds the venv (headless
OpenCV), generates the sheets, and starts two services:

* `sketch-aquarium` (systemd): the Python app, bound to `127.0.0.1:8000` only. It handles
  the dynamic parts: photo scanning, the live creature list, admin actions.
* `nginx` on port 80: serves the tank, scan and admin pages, the three.js library and the
  sprite images straight from disk with gzip and caching, accepts uploads up to 30 MB, and
  proxies `/api/` to the app. Config: `deploy/nginx-sketch-aquarium.conf`.

Settings live in `deploy/env`: `PORT`, `BIND`, `TTL`, `PUBLIC_URL` (optional override; by
default the pages use whatever address the browser opened them with) and `ADMIN_KEY`. Edit, then `systemctl restart sketch-aquarium`.

HAProxy: point the `anime.monagadu.com` backend at `192.168.201.222:80`; see
`deploy/haproxy-snippet.cfg`. If `PUBLIC_URL` is left empty the app derives the address
from the `X-Forwarded-Proto` / `Host` headers instead.

### Mount points and adding more themes

The aquarium is served both at the site root (`https://anime.monagadu.com/`) and under
`https://anime.monagadu.com/aqua/` (`/aqua/scan`, `/aqua/admin`, `/aqua/api/...`). The pages
work out their own base path from the address bar, so the same files serve both mounts, and
the scan link and API calls follow whichever mount the page was opened from.

To add another theme later (say `/jungle/`), give it its own folder and app port, then copy
the `/aqua/` block in `deploy/nginx-sketch-aquarium.conf` and change three things: the
prefix, the `alias` paths, and the upstream port. Nothing in the pages needs to change.
When several themes exist, the root mount can become a landing page that links to them.

### Update pipeline: push to GitHub, server pulls

The server updates itself from GitHub; `deploy.py` is only needed for the first install.

1. Every push to `main` runs `.github/workflows/ci.yml`: compile checks, JavaScript parse,
   sheet generation, the synthetic scan test (must be 8/8) and a live-server smoke test
   including a real photo upload.
2. On the server, `sketch-aquarium-update.timer` runs `deploy/autoupdate.sh` every minute.
   It fetches `origin/main`, asks the GitHub API whether that commit's `test` check passed,
   and deploys only green commits (waits while CI runs, skips failed ones). It reinstalls
   dependencies if `requirements.txt` changed, regenerates sheets, reloads nginx if its
   config changed, restarts the service, and rolls back to the previous commit if the
   health check fails afterwards.

Typical latency from `git push` to live: about two minutes (CI) plus up to one minute
(timer). Log: `/var/log/sketch-aquarium-update.log` or
`journalctl -u sketch-aquarium-update`. Set `REQUIRE_CI=0` in `deploy/env` to deploy every
push without waiting for CI. Runtime data (`sprites/`, `inbox/`) is untouched by updates.

`systemctl status sketch-aquarium` and `journalctl -u sketch-aquarium -f` show the app.

## Local webcam scanner (optional)

`run.bat --webcam` (or `python app.py --webcam`) also opens the OpenCV scanner window that
watches a webcam and auto-scans a sheet held still in front of it. Keys: `s` scan now,
`c` clear the aquarium, `q` quit. `--camera 1` picks another webcam. `--clear` empties the
tank on start.

## Using photos instead of a webcam

Any .jpg or .png photo of a colored sheet works as input, for example a phone photo.
The sheet can be tilted or rotated; it just needs to be fully in frame with the black
border visible.

* **Inbox folder**: while `run.bat` is running, drop photos into `inbox/`. They are scanned
  within a second and moved to `inbox/done` (or `inbox/failed` if no sheet was found).
* **Drag and drop**: drag photos onto `scan.bat`, or run `scan.bat photo1.jpg photo2.jpg`.
* **Command line**: `python app.py --image a.jpg b.jpg` scans them and serves the aquarium,
  or `python scanner.py a.jpg` scans without starting the server.

## Tips for a good scan

* Even lighting, no glare, sheet flat and taking up at least a third of the frame.
* Any camera works; 1280x720 is plenty. A document camera on an arm is ideal.
* Colors are white-balanced against the un-colored paper, so a warm lamp is fine.
* Pencil comes out pale; markers and crayons look best on the projector.

## Ideas for the next version

* 3D models (three.js) textured with the scan, like the exhibit, instead of 2D sprites.
* Touch/kinect interaction: creatures react when kids tap the wall.
* A second projector feed with a "scanning..." animation at the camera station.
* Blank template with a free-draw box so kids can invent their own creature.
