import {
    DataTexture,
    LinearFilter,
    LinearMipmapLinearFilter,
    RGBAFormat,
    RepeatWrapping,
    UnsignedByteType,
} from 'three';

/** The z-step of the 3D lattice in `createNoise3D`: shaders must use the
 *  same offset (see NOISE3D_GLSL). */
const Z_STEP: [number, number] = [37, 239];

/**
 * A lattice for true 3D value noise from ONE texture read (the technique from
 * Inigo Quilez's 2D-texture 3D noise): G holds random values, and R the same
 * values Z_STEP texels on, so a single bilinear read returns the lattice at
 * two neighbouring z levels, and the shader blends between them.
 *
 * Why not just shear the 2D noise with depth: that makes the pattern constant
 * along one slanted 3D line, and in a volume it reads as STREAKS at that
 * slant — in the bubble cloud they crossed the sun's shafts like light from
 * a second sun. Real 3D noise has no direction of its own.
 */
export function createNoise3D(size = 256): DataTexture {
    const base = new Uint8Array(size * size);
    for (let i = 0; i < base.length; i++) base[i] = Math.floor(Math.random() * 256);
    const data = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const i = y * size + x;
            const j = ((y + Z_STEP[1]) % size) * size + ((x + Z_STEP[0]) % size);
            data[i * 4] = base[j];
            data[i * 4 + 1] = base[i];
            data[i * 4 + 3] = 255;
        }
    }
    const tex = new DataTexture(data, size, size, RGBAFormat, UnsignedByteType);
    tex.wrapS = RepeatWrapping;
    tex.wrapT = RepeatWrapping;
    tex.magFilter = LinearFilter;
    tex.minFilter = LinearFilter;
    tex.generateMipmaps = false;
    tex.needsUpdate = true;
    return tex;
}

/** GLSL for the lattice above: smooth value noise in 0..1. */
export const NOISE3D_GLSL = /* glsl */ `
float noise3(sampler2D lattice, vec3 x) {
    vec3 p = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    vec2 uv = p.xy + vec2(${Z_STEP[0]}.0, ${Z_STEP[1]}.0) * p.z + f.xy;
    vec2 rg = textureLod(lattice, (uv + 0.5) / 256.0, 0.0).yx;
    return mix(rg.x, rg.y, f.z);
}
`;

/**
 * A small tileable noise texture, generated once at load, that the foam, the
 * bubble cloud and the droplets all draw their breakup from:
 *
 *   R  fbm, soft and cloudy (the bubble cloud's billows)
 *   G  cellular F1, inverted: round blobs (clumps of foam, big bubbles)
 *   B  fbm with another seed (a second, uncorrelated octave stack)
 *   A  cellular F2 - F1: thin bright lace along the cell borders, the
 *      pattern of real sea foam as it thins out
 *
 * Every channel wraps at the texture edge, so it can be tiled at any scale
 * without a seam. 256² takes a few milliseconds to build.
 */

function hash(x: number, y: number, seed: number): number {
    let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
}

const smooth = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
const wrap = (i: number, n: number) => ((i % n) + n) % n;

/** Value noise on a lattice of `period` cells, wrapping at the period. */
function valueNoise(x: number, y: number, period: number, seed: number): number {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = smooth(x - x0);
    const fy = smooth(y - y0);
    const a = hash(wrap(x0, period), wrap(y0, period), seed);
    const b = hash(wrap(x0 + 1, period), wrap(y0, period), seed);
    const c = hash(wrap(x0, period), wrap(y0 + 1, period), seed);
    const d = hash(wrap(x0 + 1, period), wrap(y0 + 1, period), seed);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

function fbm(u: number, v: number, seed: number): number {
    let sum = 0;
    let amp = 0.5;
    let norm = 0;
    for (let o = 0; o < 5; o++) {
        const period = 4 << o;
        sum += amp * valueNoise(u * period, v * period, period, seed + o * 17);
        norm += amp;
        amp *= 0.5;
    }
    return sum / norm;
}

/** Nearest and second-nearest feature distances, in cell units. */
function cellular(u: number, v: number, cells: number, seed: number): [number, number] {
    const x = u * cells;
    const y = v * cells;
    const cx = Math.floor(x);
    const cy = Math.floor(y);
    let f1 = 9;
    let f2 = 9;
    for (let j = -1; j <= 1; j++) {
        for (let i = -1; i <= 1; i++) {
            const gx = cx + i;
            const gy = cy + j;
            const px = gx + hash(wrap(gx, cells), wrap(gy, cells), seed);
            const py = gy + hash(wrap(gx, cells), wrap(gy, cells), seed + 101);
            const d = Math.hypot(px - x, py - y);
            if (d < f1) {
                f2 = f1;
                f1 = d;
            } else if (d < f2) {
                f2 = d;
            }
        }
    }
    return [f1, f2];
}

export function createOceanNoise(size = 256): DataTexture {
    const data = new Uint8Array(size * size * 4);
    const raw = new Float32Array(size * size * 2);
    let lo0 = 1;
    let hi0 = 0;
    let lo2 = 1;
    let hi2 = 0;
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const u = x / size;
            const v = y / size;
            const i = y * size + x;
            raw[i * 2] = fbm(u, v, 3);
            raw[i * 2 + 1] = fbm(u, v, 71);
            lo0 = Math.min(lo0, raw[i * 2]);
            hi0 = Math.max(hi0, raw[i * 2]);
            lo2 = Math.min(lo2, raw[i * 2 + 1]);
            hi2 = Math.max(hi2, raw[i * 2 + 1]);

            const [f1] = cellular(u, v, 10, 5);
            const [g1, g2] = cellular(u, v, 18, 9);
            data[i * 4 + 1] = Math.round(255 * Math.max(0, 1 - f1 * 1.25));
            data[i * 4 + 3] = Math.round(255 * Math.max(0, 1 - (g2 - g1) * 3.2));
        }
    }
    // Stretch the fbm channels to the full range: thresholds in the shaders
    // are easier to reason about on 0..1 than on fbm's natural ~0.25..0.75.
    for (let i = 0; i < size * size; i++) {
        data[i * 4] = Math.round((255 * (raw[i * 2] - lo0)) / (hi0 - lo0));
        data[i * 4 + 2] = Math.round((255 * (raw[i * 2 + 1] - lo2)) / (hi2 - lo2));
    }

    const tex = new DataTexture(data, size, size, RGBAFormat, UnsignedByteType);
    tex.wrapS = RepeatWrapping;
    tex.wrapT = RepeatWrapping;
    tex.magFilter = LinearFilter;
    tex.minFilter = LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    tex.needsUpdate = true;
    return tex;
}
