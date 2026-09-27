"""Re-encode the whale GLB's PNG textures as full-chroma JPEG, in place.

The Sketchfab export ships the normal map and the occlusion/roughness/metal
map as 1024^2 RGBA PNGs (2.1 MB and 1.2 MB): noisy data, an alpha channel
nothing reads, and lossless compression that cannot do anything with either.
They were three quarters of the page's largest download.

JPEG with 4:4:4 chroma (no subsampling) at high quality keeps every channel at
full resolution, which is what matters for a normal map: 4:2:0 (and lossy WebP,
which is always 4:2:0) would blur the X and Y slopes into each other at half
resolution. JPEG is also core glTF, so no loader extension is needed and every
browser decodes it.

Nothing is replaced blind. Each texture's error is measured after the round
trip (the angle between the old and new normal for the normal map, the channel
error for the rest) and the original is kept if it is over the limit.

    pip install numpy pillow
    python scripts/whale-clip/compress_textures.py            # the site GLB
    python scripts/whale-clip/compress_textures.py in.glb out.glb

Run it again after `swim_clip.py`, which rebakes the GLB from the original.
"""
import io
import sys
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).parent))
from gltf_io import read_glb, write_glb  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
DEFAULT = ROOT / 'src' / 'assets' / 'models' / 'humpback_whale.glb'

QUALITY = 95
# Limits for keeping the JPEG. A shading difference under a degree is below
# what the eye can pick out on a lit surface; a level or two of 255 in a
# roughness or occlusion map is below what the lighting can show.
MAX_MEAN_ANGLE_DEG = 0.6
MAX_P99_ANGLE_DEG = 2.0
MAX_MEAN_LEVELS = 1.5


def encode_jpeg(rgb: Image.Image) -> bytes:
    buf = io.BytesIO()
    rgb.save(buf, 'JPEG', quality=QUALITY, subsampling=0, optimize=True)
    return buf.getvalue()


def normal_error(a: np.ndarray, b: np.ndarray):
    def unpack(x):
        n = x[..., :3].astype(np.float64) / 255 * 2 - 1
        return n / np.maximum(np.linalg.norm(n, axis=-1, keepdims=True), 1e-6)

    cos = np.clip((unpack(a) * unpack(b)).sum(-1), -1, 1)
    deg = np.degrees(np.arccos(cos))
    return float(deg.mean()), float(np.percentile(deg, 99))


def main():
    src = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT
    dst = Path(sys.argv[2]) if len(sys.argv) > 2 else src
    before = src.stat().st_size
    gltf, binary = read_glb(src)

    normal_images = set()
    for mat in gltf.get('materials', []):
        tex = mat.get('normalTexture')
        if tex is not None:
            normal_images.add(gltf['textures'][tex['index']]['source'])

    views = gltf['bufferViews']
    replaced = {}
    for i, img in enumerate(gltf.get('images', [])):
        if img.get('mimeType') != 'image/png' or 'bufferView' not in img:
            continue
        v = views[img['bufferView']]
        raw = binary[v.get('byteOffset', 0):v.get('byteOffset', 0) + v['byteLength']]
        im = Image.open(io.BytesIO(raw))
        arr = np.asarray(im.convert('RGBA'))
        if (arr[..., 3] != 255).any():
            print(f'image {i}: alpha is used, kept as PNG')
            continue
        rgb = im.convert('RGB')
        jpg = encode_jpeg(rgb)
        back = np.asarray(Image.open(io.BytesIO(jpg)).convert('RGB'))
        orig = np.asarray(rgb)

        if i in normal_images:
            mean, p99 = normal_error(orig, back)
            ok = mean <= MAX_MEAN_ANGLE_DEG and p99 <= MAX_P99_ANGLE_DEG
            detail = f'normal error mean {mean:.3f} deg, p99 {p99:.3f} deg'
        else:
            diff = np.abs(orig.astype(np.int16) - back.astype(np.int16))
            mean = float(diff.mean())
            ok = mean <= MAX_MEAN_LEVELS
            detail = f'mean {mean:.3f} levels, max {int(diff.max())}'

        if ok:
            print(f'image {i}: {len(raw) / 1e6:.2f} MB PNG -> {len(jpg) / 1e6:.2f} MB JPEG, {detail}')
            replaced[i] = (jpg, 'image/jpeg')
            continue

        # Too fine for JPEG (the normal map's tubercles are close to noise):
        # stay lossless, but drop the alpha channel nothing reads. The pixels
        # are bit-identical.
        buf = io.BytesIO()
        rgb.save(buf, 'PNG', optimize=True)
        png = buf.getvalue()
        if len(png) < len(raw):
            print(f'image {i}: JPEG over limit ({detail}); {len(raw) / 1e6:.2f} MB RGBA PNG -> {len(png) / 1e6:.2f} MB RGB PNG, lossless')
            replaced[i] = (png, 'image/png')
        else:
            print(f'image {i}: JPEG over limit ({detail}); kept')

    if not replaced:
        print('nothing replaced')
        return

    # Repack the binary chunk with the new image bytes, keeping every other
    # view byte-identical.
    image_views = {gltf['images'][i]['bufferView']: i for i in replaced}
    out = bytearray()
    for vi, v in enumerate(views):
        start = v.get('byteOffset', 0)
        chunk = replaced[image_views[vi]][0] if vi in image_views else binary[start:start + v['byteLength']]
        out += b'\0' * (-len(out) % 4)
        v['byteOffset'] = len(out)
        v['byteLength'] = len(chunk)
        v['buffer'] = 0
        out += chunk
    for i, (_, mime) in replaced.items():
        gltf['images'][i]['mimeType'] = mime

    write_glb(dst, gltf, out)
    print(f'{src.name}: {before / 1e6:.2f} -> {dst.stat().st_size / 1e6:.2f} MB')


if __name__ == '__main__':
    main()
