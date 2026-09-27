# Whale swim clip

The whale's only animation, `Armature|ArmatureAction` in
`src/assets/models/humpback_whale.glb`, is generated here rather than taken
from the Sketchfab model. The original clip is kept in
`media-src/humpback_whale.original.glb`, which is also the script's input.

    pip install numpy scipy
    python scripts/whale-clip/swim_clip.py                  # rebake the site GLB
    python scripts/whale-clip/swim_clip.py --json clip.json # plus keyframe JSON

The docstring at the top of `swim_clip.py` explains the motion and where each
number comes from. Every tunable is a named constant just below it.

**Tail beat:** `STROKES / CLIP_SECONDS` (7 / 40 s = 0.175 Hz) must equal
`clipBaseHz` in `src/animations/whaleConfig.ts`. Every Hz in that file is a
visible beat because of this. If you change one, change the other, and scale
the config's other Hz values and `strokeDistance` with it.

**Compare:** with `npm run dev` running, open
<http://localhost:5175/scripts/whale-clip/compare.html>. It shows the original
on top and the generated clip below, on the same clock.

`gltf_io.py` swaps the animation and leaves the mesh, skin, textures and nodes
byte-identical.

**Textures:** `swim_clip.py` writes the original PNG textures back. Run
`python scripts/whale-clip/compress_textures.py` after it: the ORM map goes
to full-chroma JPEG (checked against an error limit) and the normal map is
re-saved without its unused alpha, bit-identical (4.7 → 3.5 MB).
