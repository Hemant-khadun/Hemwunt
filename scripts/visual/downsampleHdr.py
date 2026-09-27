"""Halve a Radiance .hdr (RGBE) environment map, in linear light.

The whale is the only thing the scene's HDRI lights, and it only ever sees
it through a rough, dim reflection (envMapIntensity <= 0.1, roughness
>= 0.84, clearcoat roughness >= 0.6: see WhaleModel.tsx). The PMREM blurs a
1k map down to the same few texels a 512 map gives, so the full-size file was
1.75 MB of detail nothing could show. A 2x2 box filter in linear light keeps
the total energy, so the moon's glint on the skin is as bright as before.

    python scripts/visual/downsampleHdr.py in.hdr out.hdr
"""
import sys

import numpy as np


def read_rgbe(path):
    data = open(path, 'rb').read()
    end = data.index(b'\n\n') + 2
    nl = data.index(b'\n', end)
    res = data[end:nl].split()
    assert res[0] == b'-Y' and res[2] == b'+X', res
    h, w = int(res[1]), int(res[3])
    pos = nl + 1
    out = np.zeros((h, w, 4), np.uint8)
    for y in range(h):
        if data[pos] == 2 and data[pos + 1] == 2 and not data[pos + 2] & 0x80:
            assert (data[pos + 2] << 8 | data[pos + 3]) == w
            pos += 4
            for c in range(4):
                x = 0
                while x < w:
                    n = data[pos]
                    pos += 1
                    if n > 128:
                        out[y, x:x + n - 128, c] = data[pos]
                        pos += 1
                        x += n - 128
                    else:
                        out[y, x:x + n, c] = np.frombuffer(data, np.uint8, n, pos)
                        pos += n
                        x += n
        else:
            out[y] = np.frombuffer(data, np.uint8, w * 4, pos).reshape(w, 4)
            pos += w * 4
    return out


def rgbe_to_float(rgbe):
    e = rgbe[..., 3].astype(np.int32)
    scale = np.where(e > 0, np.ldexp(1.0, e - 136), 0.0)
    return rgbe[..., :3].astype(np.float64) * scale[..., None]


def float_to_rgbe(rgb):
    m = rgb.max(-1)
    mant, exp = np.frexp(m)
    scale = np.where(m > 1e-32, mant * 256.0 / np.maximum(m, 1e-32), 0.0)
    out = np.zeros(rgb.shape[:-1] + (4,), np.uint8)
    out[..., :3] = np.clip(rgb * scale[..., None], 0, 255).astype(np.uint8)
    out[..., 3] = np.where(m > 1e-32, exp + 128, 0).astype(np.uint8)
    return out


def rle_channel(values):
    """New-style RLE for one channel of one scanline."""
    out = bytearray()
    i, n = 0, len(values)
    while i < n:
        run = 1
        while i + run < n and run < 127 and values[i + run] == values[i]:
            run += 1
        if run >= 3:
            out += bytes((128 + run, values[i]))
            i += run
            continue
        j = i
        while j < n and j - i < 128:
            if j + 2 < n and values[j] == values[j + 1] == values[j + 2]:
                break
            j += 1
        out.append(j - i)
        out += bytes(values[i:j])
        i = j
    return out


def write_rgbe(path, rgbe):
    h, w = rgbe.shape[:2]
    body = bytearray()
    for y in range(h):
        body += bytes((2, 2, w >> 8, w & 255))
        for c in range(4):
            body += rle_channel(rgbe[y, :, c].tolist())
    head = b'#?RADIANCE\nGAMMA=1\nFORMAT=32-bit_rle_rgbe\n\n' + f'-Y {h} +X {w}\n'.encode()
    open(path, 'wb').write(head + bytes(body))


def main():
    src, dst = sys.argv[1], sys.argv[2]
    rgb = rgbe_to_float(read_rgbe(src))
    h, w = rgb.shape[:2]
    half = rgb.reshape(h // 2, 2, w // 2, 2, 3).mean(axis=(1, 3))
    write_rgbe(dst, float_to_rgbe(half))
    back = rgbe_to_float(read_rgbe(dst))
    print(f'{w}x{h} -> {w // 2}x{h // 2}; energy {rgb.mean():.6f} -> {back.mean():.6f}; '
          f'peak {rgb.max():.3f} -> {back.max():.3f}')


if __name__ == '__main__':
    main()
