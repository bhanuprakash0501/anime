# 3D model credits

Models come from Poly Pizza (https://poly.pizza) and Sketchfab. Embedded textures are removed
because the tank skins each model with the child's drawing at runtime. Heavy models are reduced
with `tools/decimate_glb.py`; the full-resolution source is kept out of the repository.

| File | Title | Creator | Licence | Source |
|---|---|---|---|---|
| clownfish.glb | Clown fish | gimyujun392 (Sketchfab) | CC-BY 4.0 | https://sketchfab.com/3d-models/clown-fish-bd7657ce0ba443308b08febbeaf5bfa2 |
| shark.glb | Shark | Quaternius | CC0 1.0 | https://poly.pizza/m/YYsK3gRCBZ |
| manta.glb | Manta ray | Quaternius | CC0 1.0 | https://poly.pizza/m/yzD8b7ZHZm |
| turtle.glb | Turtle | Poly by Google | CC-BY 3.0 | https://poly.pizza/m/fklSEvGm1Q8 |
| octopus.glb | octopus | s4dned (Sketchfab) | CC-BY 4.0 | https://sketchfab.com/3d-models/octopus-f2e89c34b1bd4f689c32c67db94fcc3d |
| crab.glb | Crab | Poly by Google | CC-BY 3.0 | https://poly.pizza/m/2DgM36qZW2u |
| jellyfish.glb | Jellyfish | Poly by Google | CC-BY 3.0 | https://poly.pizza/m/dA5osnS0Rzj |
| seahorse.glb | Seahorse | Poly by Google | CC-BY 3.0 | https://poly.pizza/m/d_36p3CahYa |

CC-BY requires attribution: the scan page carries a credit line and this file travels with the
code. https://creativecommons.org/licenses/by/3.0/ and https://creativecommons.org/licenses/by/4.0/

The clown fish declared `KHR_materials_pbrSpecularGlossiness` as a *required* extension,
which current three.js no longer implements, so it would not load at all. Material-only
extensions are stripped along with the textures, which also removed 879 KB of embedded JPEGs:

    python tools/decimate_glb.py clown_fish.glb aquarium/models/clownfish.glb --target 100000

The octopus is reduced from 431,258 to 51,177 triangles (12.9 MB -> 1.4 MB) by dropping the
sucker meshes, which are invisible at tank size, and clustering the two body meshes:

    python tools/decimate_glb.py octopus_2.glb aquarium/models/octopus.glb \
        --target 32000 --drop sucker --keep eye "body."
