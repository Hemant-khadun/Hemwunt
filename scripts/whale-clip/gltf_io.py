"""Minimal GLB read/write, plus replacing a file's animations.

Only what the whale needs: no sparse accessors, no extensions, one buffer.
"""
import json
import struct

import numpy as np

COMPONENT = {5126: ('f', 4), 5123: ('H', 2), 5125: ('I', 4), 5121: ('B', 1)}
WIDTH = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}


def read_glb(path):
    data = open(path, 'rb').read()
    magic, _, _ = struct.unpack('<4sII', data[:12])
    assert magic == b'glTF', path
    json_len, = struct.unpack('<I', data[12:16])
    gltf = json.loads(data[20:20 + json_len])
    off = 20 + json_len
    bin_len, = struct.unpack('<I', data[off:off + 4])
    return gltf, data[off + 8:off + 8 + bin_len]


def write_glb(path, gltf, binary):
    binary = bytes(binary) + b'\0' * (-len(binary) % 4)
    gltf['buffers'] = [{'byteLength': len(binary)}]
    text = json.dumps(gltf, separators=(',', ':')).encode()
    text += b' ' * (-len(text) % 4)
    total = 12 + 8 + len(text) + 8 + len(binary)
    with open(path, 'wb') as f:
        f.write(struct.pack('<4sII', b'glTF', 2, total))
        f.write(struct.pack('<I4s', len(text), b'JSON') + text)
        f.write(struct.pack('<I4s', len(binary), b'BIN\0') + binary)


def accessor(gltf, binary, index):
    a = gltf['accessors'][index]
    view = gltf['bufferViews'][a['bufferView']]
    fmt, size = COMPONENT[a['componentType']]
    n = WIDTH[a['type']]
    start = view.get('byteOffset', 0) + a.get('byteOffset', 0)
    stride = view.get('byteStride', size * n)
    rows = np.ndarray((a['count'], n), dtype='<' + fmt, buffer=binary,
                      offset=start, strides=(stride, size))
    out = rows.astype(np.float64)
    if a.get('normalized'):
        out /= {5121: 255, 5123: 65535}[a['componentType']]
    return out


def replace_animations(gltf, binary, animations):
    """Drop every existing clip (and the buffer data only it used) and add
    `animations`: [(name, times[N], {node_index: quats[N,4] xyzw})]."""
    old = set()
    for anim in gltf.get('animations', []):
        for s in anim['samplers']:
            old |= {s['input'], s['output']}
    used = set()
    for mesh in gltf.get('meshes', []):
        for prim in mesh['primitives']:
            used |= set(prim['attributes'].values())
            if 'indices' in prim:
                used.add(prim['indices'])
    for skin in gltf.get('skins', []):
        if 'inverseBindMatrices' in skin:
            used.add(skin['inverseBindMatrices'])
    keep_acc = [i for i in range(len(gltf['accessors'])) if i in used or i not in old]
    acc_map = {old_i: new_i for new_i, old_i in enumerate(keep_acc)}
    accessors = [dict(gltf['accessors'][i]) for i in keep_acc]

    live_views = {a['bufferView'] for a in accessors if 'bufferView' in a}
    live_views |= {img['bufferView'] for img in gltf.get('images', []) if 'bufferView' in img}
    keep_views = sorted(live_views)
    view_map = {old_i: new_i for new_i, old_i in enumerate(keep_views)}

    out = bytearray()
    views = []
    for i in keep_views:
        v = dict(gltf['bufferViews'][i])
        chunk = binary[v.get('byteOffset', 0):v.get('byteOffset', 0) + v['byteLength']]
        out += b'\0' * (-len(out) % 4)
        v['byteOffset'] = len(out)
        v['buffer'] = 0
        out += chunk
        views.append(v)
    for a in accessors:
        if 'bufferView' in a:
            a['bufferView'] = view_map[a['bufferView']]
    for img in gltf.get('images', []):
        if 'bufferView' in img:
            img['bufferView'] = view_map[img['bufferView']]
    for mesh in gltf.get('meshes', []):
        for prim in mesh['primitives']:
            prim['attributes'] = {k: acc_map[v] for k, v in prim['attributes'].items()}
            if 'indices' in prim:
                prim['indices'] = acc_map[prim['indices']]
    for skin in gltf.get('skins', []):
        if 'inverseBindMatrices' in skin:
            skin['inverseBindMatrices'] = acc_map[skin['inverseBindMatrices']]

    def add(array, kind, with_bounds=False):
        array = np.ascontiguousarray(array, dtype='<f4')
        nonlocal out
        out += b'\0' * (-len(out) % 4)
        views.append({'buffer': 0, 'byteOffset': len(out), 'byteLength': array.nbytes})
        out += array.tobytes()
        a = {'bufferView': len(views) - 1, 'componentType': 5126,
             'count': int(array.shape[0]), 'type': kind}
        if with_bounds:
            a['min'] = [float(array.min())]
            a['max'] = [float(array.max())]
        accessors.append(a)
        return len(accessors) - 1

    gltf['animations'] = []
    for name, times, tracks in animations:
        t_acc = add(np.asarray(times).reshape(-1), 'SCALAR', with_bounds=True)
        samplers, channels = [], []
        for node, quats in tracks.items():
            samplers.append({'input': t_acc, 'output': add(quats, 'VEC4'), 'interpolation': 'LINEAR'})
            channels.append({'sampler': len(samplers) - 1, 'target': {'node': node, 'path': 'rotation'}})
        gltf['animations'].append({'name': name, 'samplers': samplers, 'channels': channels})

    gltf['accessors'] = accessors
    gltf['bufferViews'] = views
    return gltf, out
