/**
 * GLSL for the live ocean.
 *
 * The simulation, caustics and surface optics are a port of Evan Wallace's
 * WebGL Water (via willeastcott/webgpu-water-playcanvas, MIT): a heightfield
 * wave equation on ping-pong float targets, normals from its derivatives, and
 * caustics by the differential-area method. What changes is the setting. That
 * demo is a 2x2 pool ray-traced analytically; this is open sea around a
 * skinned whale, so:
 *
 *   - the simulated patch rides on an analytic wind sea (`oceanWaves`) that
 *     every shader evaluates identically, so ripples, surface, waterline and
 *     caustics all agree about the same water;
 *   - the pool walls become sky (a photographed panorama) and the deep;
 *   - the sphere becomes a chain of spheres along the whale's spine;
 *   - the camera looks out through a virtual PORT (the window of an underwater
 *     housing), so a pixel can be in air or in water depending on where its
 *     ray leaves the port — the over/under frame of a split-level photograph.
 *
 * All colour maths is linear; the composer encodes to sRGB at the end.
 *
 * WebGL Water: Copyright (c) 2011 Evan Wallace; PlayCanvas port copyright its
 * authors. MIT — full notice in LICENSE-webgl-water.txt beside this file.
 */
import { NUM_WAVES } from './oceanUniforms';

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------

/** The water itself: waves, ripples, foam. Free of any camera built-ins, so
 *  the post-processing volume (which runs with no scene camera) can use it. */
export const oceanWater = /* glsl */ `
#define NUM_WAVES ${NUM_WAVES}
#define OCEAN_PI 3.141592653589793

uniform vec4 uWaveA[NUM_WAVES];   // dir.x, dir.z, k, omega
uniform vec2 uWaveB[NUM_WAVES];   // amplitude, phase
uniform float uWaveTime;
uniform float uWaterLevel;
uniform float uDomeRadius;
uniform float uPresence;
uniform sampler2D uSimTex;        // R height, G velocity, BA slope (world units)
uniform sampler2D uFoamTex;       // R surface foam, G bubble cloud
uniform sampler2D uNoiseTex;      // tileable breakup (oceanNoise.ts)
uniform vec2 uSimCenter;
uniform float uSimSize;
uniform vec3 uSunDir;
uniform vec4 uCrashA;             // crest point (x, z), travel direction (x, z)
uniform vec4 uCrashB;             // amplitude, front width, back width, seed
uniform float uCrashK;            // curvature of the crest (1/radius), 0 straight

// A wave meeting the lens (see crashWave in waterSignal.ts): one crest line
// running at the camera, bent and uneven along its length, steep in front
// with a trough behind — or a ring of one, spreading from where the whale
// landed. Zero when no wave is running.
float crashHeight(vec2 p) {
    if (uCrashB.x <= 0.0) return 0.0;
    vec2 rel = p - uCrashA.xy;
    float along = dot(rel, uCrashA.zw);
    float lat = dot(rel, vec2(-uCrashA.w, uCrashA.z));
    if (uCrashK > 0.0) {
        // A ring: distance out past it, and arc length round it.
        float r = 1.0 / uCrashK;
        vec2 q = vec2(along + r, lat);
        along = length(q) - r;
        lat = r * atan(q.y, q.x + 1.0e-5);
    }
    along += 0.4 * sin(lat * 0.9 + uCrashB.w) + 0.16 * sin(lat * 2.3 + uCrashB.w * 1.7);
    float w = along > 0.0 ? uCrashB.y : uCrashB.z;
    float crest = exp(-along * along / (w * w));
    float tq = (along + uCrashB.z * 1.6) / uCrashB.z;
    float trough = exp(-tq * tq) * 0.35;
    float amp = uCrashB.x * (1.0 + 0.3 * sin(lat * 0.55 + uCrashB.w * 2.1));
    return amp * (crest - trough) * exp(-lat * lat / 70.0);
}
vec2 crashSlope(vec2 p) {
    if (uCrashB.x <= 0.0) return vec2(0.0);
    const float e = 0.035;
    return vec2(
        crashHeight(p + vec2(e, 0.0)) - crashHeight(p - vec2(e, 0.0)),
        crashHeight(p + vec2(0.0, e)) - crashHeight(p - vec2(0.0, e))
    ) / (2.0 * e);
}

// The wind sea at world xz: (height, dh/dx, dh/dz). Waves shorter than a few
// times \`footprint\` (world units covered by one pixel or one vertex) are faded
// out rather than aliased into sparkle.
vec3 oceanWaves(vec2 p, float footprint, int count) {
    vec3 r = vec3(0.0);
    for (int i = 0; i < NUM_WAVES; i++) {
        if (i >= count) break;
        vec4 w = uWaveA[i];
        vec2 b = uWaveB[i];
        float lambda = 2.0 * OCEAN_PI / w.z;
        float a = b.x * (1.0 - smoothstep(lambda * 0.18, lambda * 0.42, footprint));
        float ph = w.z * dot(w.xy, p) - w.w * uWaveTime + b.y;
        r.x += a * sin(ph);
        r.yz += (a * w.z * cos(ph)) * w.xy;
    }
    return r;
}

vec2 simUv(vec2 xz) { return (xz - uSimCenter) / uSimSize + 0.5; }

// The simulated ripples at world xz, faded to nothing at the patch edge.
vec4 simAt(vec2 xz) {
    vec2 uv = simUv(xz);
    vec2 e = min(uv, 1.0 - uv);
    float m = smoothstep(0.0, 0.06, min(e.x, e.y));
    if (m <= 0.0) return vec4(0.0);
    vec4 s = textureLod(uSimTex, uv, 0.0);
    return vec4(s.r * m, s.g, s.ba * m);
}

float surfaceHeight(vec2 xz) {
    return uWaterLevel + oceanWaves(xz, 0.0, 8).x + simAt(xz).r + crashHeight(xz);
}

// The water holding on to the port. The sea never meets the glass in a clean
// line: surface tension drags a sheet of it up the pane, higher in some
// places than others, in soft rounded humps of uneven size, and the sheet
// slops about as the waves come and go. How far above the sea (world units)
// the water on the glass reaches, \`x\` across the port from the middle of
// the frame (so the pattern stays on the glass as it moves).
float portCling(float x) {
    float t = uWaveTime;
    float humps = sin(x * 4.3 + t * 0.6 + 1.8 * sin(x * 1.3 - t * 0.3));
    float lumps = sin(x * 9.7 - t * 0.9 + 1.1 * sin(x * 3.1 + t * 0.4));
    return 0.015 + 0.045 * (0.5 + 0.5 * humps) + 0.012 * lumps;
}

// Where a ray leaves the port at \`port\`, relative to the water there,
// clinging included. > 0: it looks out from air. <= 0: from water.
float portClearance(vec3 port, vec3 eye, vec3 right) {
    return port.y - surfaceHeight(port.xz) - portCling(dot(port - eye, right));
}

// Broken water at world xz: R foam on the surface, G the bubble cloud under
// it. Faded out at the patch edge like the ripples.
vec2 foamAt(vec2 xz) {
    vec2 uv = simUv(xz);
    vec2 e = min(uv, 1.0 - uv);
    float m = smoothstep(0.0, 0.06, min(e.x, e.y));
    if (m <= 0.0) return vec2(0.0);
    return textureLod(uFoamTex, uv, 0.0).rg * m;
}

// Foam is never a flat wash: it is clumps and lace, and as it thins it
// breaks up along the borders of the bubbles rather than fading evenly.
// \`cover\` is how much foam there is (0..1+); the pattern is thresholded
// against it, so more foam fills in more of the pattern. \`soft\` widens the
// threshold where the pattern is too fine for the pixel.
float foamPattern(vec2 xz, float cover, float soft) {
    vec4 a = texture2D(uNoiseTex, xz * 0.21 + vec2(0.011, 0.006) * uWaveTime);
    vec4 b = texture2D(uNoiseTex, xz * 0.83 + vec2(-0.017, 0.009) * uWaveTime);
    float pat = a.r * 0.45 + b.g * 0.3 + b.a * 0.25;
    float thr = 1.0 - clamp(cover, 0.0, 1.0) * 0.95;
    return smoothstep(thr - 0.04 - soft, thr + 0.1 + soft, pat) * smoothstep(0.02, 0.18, cover);
}
`;

/** Where each pixel looks out from: the port of the underwater housing. Uses
 *  the scene camera's built-ins, so only for materials drawn by it. */
export const oceanPort = /* glsl */ `
// The camera looks out through a flat port uDomeRadius in front of the lens
// (a dome would bow the waterline into a smile across a wide frame; a flat
// port keeps it a level line that only the waves bend).
vec3 cameraForward() {
    return -vec3(viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2]);
}
float portDistance(vec3 dir) {
    return uDomeRadius / max(dot(dir, cameraForward()), 0.05);
}
// Where this pixel's ray leaves the port, relative to the water there.
// > 0: the pixel looks out from air. <= 0: from water.
float domeClearance(vec3 dir) {
    vec3 p = cameraPosition + dir * portDistance(dir);
    vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
    return portClearance(p, cameraPosition, right);
}
`;

export const oceanCommon = oceanWater + oceanPort;

export const skyCommon = /* glsl */ `
uniform sampler2D uSkyTex;   // a flat photograph of the sky
uniform vec4 uSkyFrame;      // azimuth centre, azimuth span, lowest elevation, elevation span (radians)
uniform vec3 uHorizonColor;
uniform float uSkyExposure;

// The sky is one photograph, not a panorama, so it is laid over the dome by
// angle: its width spans uSkyFrame.y of azimuth centred ahead of the camera,
// its height uSkyFrame.w of elevation from just under the horizon. Beyond
// those edges it mirrors, so reflections and Snell's window — which look in
// every direction — never meet a seam. Toward the horizon it thins into
// haze, the way a real sky pales at the horizon line.
vec3 skyLod(vec3 dir, float lod) {
    float az = atan(dir.x, -dir.z);
    float el = asin(clamp(dir.y, -1.0, 1.0));
    vec2 uv = vec2((az - uSkyFrame.x) / uSkyFrame.y + 0.5, (el - uSkyFrame.z) / uSkyFrame.w);
    uv = 1.0 - abs(mod(uv, 2.0) - 1.0);
    vec3 c = textureLod(uSkyTex, uv, lod).rgb;
    float haze = 1.0 - smoothstep(-0.03, 0.42, el);
    return mix(c, uHorizonColor, haze * 0.8) * uSkyExposure;
}
`;

// ---------------------------------------------------------------------------
// Simulation passes (full-screen quad over the heightfield)
// ---------------------------------------------------------------------------

export const simVertex = /* glsl */ `
varying vec2 vUv;
void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

/** A raised-cosine bump swept along a segment, so a moving pointer leaves a
 *  continuous trail instead of a row of dots. Everything in sim-uv units. */
export const dropFragment = /* glsl */ `
#define PI 3.141592653589793
uniform sampler2D uSource;
uniform vec2 uA;
uniform vec2 uB;
uniform float uRadius;
uniform float uStrength;
varying vec2 vUv;
void main() {
    vec4 info = texture2D(uSource, vUv);
    vec2 pa = vUv - uA;
    vec2 ba = uB - uA;
    float denom = dot(ba, ba);
    float h = denom > 0.0 ? clamp(dot(pa, ba) / denom, 0.0, 1.0) : 0.0;
    float d = max(0.0, 1.0 - length(pa - ba * h) / uRadius);
    d = 0.5 - cos(d * PI) * 0.5;
    info.r += d * uStrength;
    gl_FragColor = info;
}
`;

/** One step of the wave equation. A sponge layer at the edge absorbs waves
 *  instead of reflecting them back in off the patch boundary. */
export const updateFragment = /* glsl */ `
uniform sampler2D uSource;
uniform vec2 uTexel;
uniform float uSpeed;
uniform float uDamping;
varying vec2 vUv;
void main() {
    vec4 info = texture2D(uSource, vUv);
    float avg = (
        texture2D(uSource, vUv - vec2(uTexel.x, 0.0)).r +
        texture2D(uSource, vUv + vec2(uTexel.x, 0.0)).r +
        texture2D(uSource, vUv - vec2(0.0, uTexel.y)).r +
        texture2D(uSource, vUv + vec2(0.0, uTexel.y)).r
    ) * 0.25;
    info.g += (avg - info.r) * uSpeed;
    vec2 e = min(vUv, 1.0 - vUv);
    float sponge = smoothstep(0.0, 0.08, min(e.x, e.y));
    info.g *= uDamping * mix(0.8, 1.0, sponge);
    info.r += info.g;
    info.r *= mix(0.9, 1.0, sponge);
    gl_FragColor = info;
}
`;

/** Slopes from central differences, in world units, into BA. */
export const normalFragment = /* glsl */ `
uniform sampler2D uSource;
uniform vec2 uTexel;
uniform float uTexelWorld;
varying vec2 vUv;
void main() {
    vec4 info = texture2D(uSource, vUv);
    float hx0 = texture2D(uSource, vUv - vec2(uTexel.x, 0.0)).r;
    float hx1 = texture2D(uSource, vUv + vec2(uTexel.x, 0.0)).r;
    float hz0 = texture2D(uSource, vUv - vec2(0.0, uTexel.y)).r;
    float hz1 = texture2D(uSource, vUv + vec2(0.0, uTexel.y)).r;
    info.b = (hx1 - hx0) / (2.0 * uTexelWorld);
    info.a = (hz1 - hz0) / (2.0 * uTexelWorld);
    gl_FragColor = info;
}
`;

/**
 * The whale pushing water. Each sphere along its spine displaces the part of
 * the water column it occupies; the pass adds back the volume it vacated and
 * removes the volume it now fills (Evan's sphere, generalised). A body well
 * below the surface barely lifts it, so the effect decays with depth. Sphere y
 * arrives already relative to the mean surface.
 */
export const displaceFragment = /* glsl */ `
#define MAX_SPHERES 8
uniform sampler2D uSource;
uniform vec4 uOld[MAX_SPHERES];
uniform vec4 uNew[MAX_SPHERES];
uniform int uCount;
uniform float uStrength;
uniform vec2 uSimCenter;
uniform float uSimSize;
varying vec2 vUv;

float column(vec2 xz, vec4 s) {
    vec2 d = xz - s.xz;
    float r = s.w;
    float t2 = dot(d, d) / (r * r);
    if (t2 >= 1.0) return 0.0;
    float halfChord = r * sqrt(1.0 - t2);
    float bottom = s.y - halfChord;
    float top = s.y + halfChord;
    float sub = clamp(-bottom, 0.0, 2.0 * halfChord);
    return sub * exp(-max(0.0, -top) / (r * 1.2));
}

void main() {
    vec4 info = texture2D(uSource, vUv);
    vec2 xz = uSimCenter + (vUv - 0.5) * uSimSize;
    float dv = 0.0;
    for (int i = 0; i < MAX_SPHERES; i++) {
        if (i >= uCount) break;
        dv += column(xz, uOld[i]) - column(xz, uNew[i]);
    }
    info.r += dv * uStrength;
    gl_FragColor = info;
}
`;

/**
 * Broken water. Two quantities over the simulated patch, stepped once a frame:
 *
 *   R  surface foam: white water lying on the surface. Pops within seconds.
 *   G  the bubble cloud: air driven under the surface, the milky turquoise
 *      volume that hangs round a whale's back in every photograph of one
 *      surfacing. Kept thin and close to the body, and drawn as a volume
 *      by the post-processing pass (underwaterVolume.ts), not on the surface.
 *
 * Fed by three things: water the simulation is throwing about hard (a splash,
 * the whale shoving through), the whale's body wherever it cuts the surface or
 * runs just under it (a collar of broken water, heavier the faster it moves),
 * and explicit splashes (the pointer). Both then drift with the wind, spread,
 * and decay. Nothing is advected by the ripples: foam left where the body WAS
 * is what draws the wake.
 */
export const foamFragment = /* glsl */ `
#define MAX_SPHERES 8
#define MAX_SPLASHES 4
uniform sampler2D uSource;
uniform sampler2D uSim;
uniform vec2 uTexel;
uniform float uDt;
uniform vec4 uBody[MAX_SPHERES];     // x, y above the local surface, z, radius
uniform vec4 uBodyVel[MAX_SPHERES];  // world velocity xyz, speed
uniform int uCount;
uniform vec4 uSplash[MAX_SPLASHES];  // x, z, radius, amount
uniform int uSplashCount;
uniform vec2 uSimCenter;
uniform float uSimSize;
uniform vec2 uDrift;                 // world units per second
uniform float uChurn;
varying vec2 vUv;

void main() {
    vec2 uv = vUv - uDrift * uDt / uSimSize;
    vec4 f = texture2D(uSource, uv);
    vec4 around = (
        texture2D(uSource, uv + vec2(uTexel.x, 0.0)) +
        texture2D(uSource, uv - vec2(uTexel.x, 0.0)) +
        texture2D(uSource, uv + vec2(0.0, uTexel.y)) +
        texture2D(uSource, uv - vec2(0.0, uTexel.y))
    ) * 0.25;
    // The cloud spreads faster than the foam on top of it: the bubbles are
    // carried off by the water the whale set moving. Not far, though: a
    // cloud let spread turns the whole sea round the whale milky.
    f.r = mix(f.r, around.r, clamp(uDt * 5.0, 0.0, 0.5));
    f.g = mix(f.g, around.g, clamp(uDt * 8.0, 0.0, 0.45));
    // Foam pops as its bubbles burst; the cloud under it rises out about as
    // fast.
    f.r *= exp(-uDt / 2.6);
    f.g *= exp(-uDt / 2.4);

    vec2 xz = uSimCenter + (vUv - 0.5) * uSimSize;

    // Water moving hard enough breaks: the splash itself, not the rings of
    // ripples it sends out, or they whiten the whole sea over the seconds
    // after a breach. It turns white, but drives little air down: the cloud
    // is the body's doing.
    vec4 s = texture2D(uSim, vUv);
    float churn = smoothstep(0.04, 0.12, abs(s.g)) * uChurn;
    f.r += churn * uDt * 5.0;
    f.g += churn * uDt * 0.8;

    for (int i = 0; i < MAX_SPHERES; i++) {
        if (i >= uCount) break;
        vec4 b = uBody[i];
        float r = b.w;
        float h = abs(b.y);
        // Only a body at or near the surface breaks it.
        float near = 1.0 - smoothstep(r * 0.85, r * 1.7, h);
        if (near <= 0.0) continue;
        float rho = sqrt(max(r * r - b.y * b.y, 0.0));
        float reach = max(rho, r * 0.55);
        float d = length(xz - b.xz);
        float w = 0.35 + 0.35 * r;
        // A collar where the water meets the skin, and a softer boil over a
        // body just beneath the surface.
        float collar = exp(-pow((d - reach) / w, 2.0));
        float boil = 1.0 - smoothstep(reach * 0.4, reach * 1.1, d);
        float speed = uBodyVel[i].w;
        float effort = 0.45 + 2.4 * clamp(speed / 3.0, 0.0, 1.6);
        float amt = near * max(collar, boil * (b.y < 0.0 ? 0.7 : 0.35));
        f.r += amt * effort * uDt * 2.6;
        // The white water scales with how hard the body hits; the cloud
        // under it barely does, or a breach leaves the sea milky for seconds.
        f.g += amt * min(effort, 1.2) * uDt * 1.6;
    }

    for (int i = 0; i < MAX_SPLASHES; i++) {
        if (i >= uSplashCount) break;
        vec4 sp = uSplash[i];
        float d = length(xz - sp.xy) / sp.z;
        float k = exp(-d * d * 2.5);
        f.r += sp.w * k;
        f.g += sp.w * k * 0.9;
    }

    // Absorbed at the patch edge, like the ripples.
    vec2 e = min(vUv, 1.0 - vUv);
    f.rg *= smoothstep(0.0, 0.04, min(e.x, e.y));
    gl_FragColor = vec4(clamp(f.rg, 0.0, 2.5), 0.0, 1.0);
}
`;

// ---------------------------------------------------------------------------
// Caustics (differential area): each vertex of a grid over the patch is sent
// along its refracted sun ray to a plane below the surface; a triangle that
// shrinks got brighter. Stored in "surface-projected" coordinates, so any
// underwater point can look its caustic up by walking back up the flat
// refracted sun direction to the surface.
// ---------------------------------------------------------------------------

export const causticVertex = /* glsl */ `
uniform float uCausticDepth;
uniform float uSlopeGain;
uniform float uGridFootprint;
varying vec3 vOld;
varying vec3 vNew;
void main() {
    vec2 uv = position.xy;
    vec2 xz = uSimCenter + (uv - 0.5) * uSimSize;
    vec4 s = textureLod(uSimTex, uv, 0.0);
    vec3 amb = oceanWaves(xz, uGridFootprint, NUM_WAVES);
    vec2 grad = (amb.yz + s.ba) * uSlopeGain;
    vec3 n = normalize(vec3(-grad.x, 1.0, -grad.y));
    vec3 l0 = refract(-uSunDir, vec3(0.0, 1.0, 0.0), 1.0 / 1.333);
    vec3 l1 = refract(-uSunDir, n, 1.0 / 1.333);
    float h = amb.x + s.r;
    vOld = vec3(xz.x, 0.0, xz.y) + l0 * (-uCausticDepth / l0.y);
    vNew = vec3(xz.x, h, xz.y) + l1 * ((-uCausticDepth - h) / l1.y);
    vec2 q = vNew.xz - l0.xz * (vNew.y / l0.y);
    gl_Position = vec4((q - uSimCenter) / uSimSize * 2.0, 0.0, 1.0);
}
`;

export const causticFragment = /* glsl */ `
uniform float uCausticGain;
varying vec3 vOld;
varying vec3 vNew;
void main() {
    float oldArea = length(dFdx(vOld)) * length(dFdy(vOld));
    float newArea = length(dFdx(vNew)) * length(dFdy(vNew));
    float c = min(oldArea / max(newArea, 1.0e-8), 14.0);
    gl_FragColor = vec4(c * uCausticGain, 0.0, 0.0, 1.0);
}
`;

// ---------------------------------------------------------------------------
// Sky: drawn at the far plane, only for pixels that look out from air.
// ---------------------------------------------------------------------------

export const skyVertex = /* glsl */ `
varying vec3 vDir;
void main() {
    vDir = position;
    vec4 p = projectionMatrix * viewMatrix * vec4(cameraPosition + position * 1200.0, 1.0);
    gl_Position = p.xyww;
}
`;

export const skyFragment = /* glsl */ `
uniform float uGlow;
uniform vec3 uGlowColor;
varying vec3 vDir;
void main() {
    vec3 dir = normalize(vDir);
    if (domeClearance(dir) > 0.0) {
        gl_FragColor = vec4(skyLod(dir, 0.0) * uPresence, uPresence);
        return;
    }
    // Pixels looking out from the water get no sky, but they do get the
    // sea's own light: the bright band of sunlit water just under the surface,
    // strongest toward the sun and fading down into the blue. Written with
    // zero alpha, so it ADDS to the page's water backdrop behind the canvas,
    // and at the far plane, so the whale and the surface pass in front of it.
    float toward = 0.35 + 0.65 * pow(max(dot(normalize(dir.xz + 1.0e-5), normalize(uSunDir.xz)), 0.0), 3.0);
    float above = max(dir.y - 0.01, 0.0);
    float below = max(0.01 - dir.y, 0.0);
    float band = exp(-above * 14.0) * exp(-below * 9.0);
    gl_FragColor = vec4(uGlowColor * band * toward * uGlow * uPresence, 0.0);
}
`;

// ---------------------------------------------------------------------------
// The surface
// ---------------------------------------------------------------------------

export const surfaceVertex = /* glsl */ `
uniform float uPixelAngle;
varying vec3 vWorld;
void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    w.y = uWaterLevel;
    float dist = distance(w.xyz, cameraPosition);
    // Vertex spacing grows ~1.5% of distance (see the grid), so only waves
    // several spacings long are displaced; the rest live in the normals.
    float fp = max(dist * uPixelAngle, dist * 0.015) * 2.0;
    w.y += oceanWaves(w.xz, fp, 8).x + simAt(w.xz).r + crashHeight(w.xz);
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
}
`;

export const surfaceFragment = /* glsl */ `
uniform sampler2D uDetailNormals;
uniform float uDetailStrength;
uniform vec3 uDeepColor;
uniform vec3 uSssColor;
uniform vec3 uSunColor;
uniform vec3 uWaterNear;
uniform vec3 uWaterFar;
uniform float uHaze;
uniform float uFogDensity;
uniform float uSparkle;
uniform float uGlitter;
uniform float uFoam;
varying vec3 vWorld;

void main() {
    // Everything that needs screen derivatives first: after a discard or
    // inside a branch they are undefined.
    float fp = max(length(fwidth(vWorld.xz)), 1.0e-4);
    vec2 uv1 = vWorld.xz * 0.23 + vec2(0.021, 0.013) * uWaveTime;
    vec2 uv2 = vWorld.xz * 0.61 + vec2(-0.017, 0.029) * uWaveTime;
    vec3 n1 = texture2D(uDetailNormals, uv1).xyz * 2.0 - 1.0;
    vec3 n2 = texture2D(uDetailNormals, uv2).xyz * 2.0 - 1.0;
    vec2 detail = (n1.xy / max(n1.z, 0.35) * 0.55 + n2.xy / max(n2.z, 0.35) * 0.4)
        * uDetailStrength * (1.0 - smoothstep(0.04, 0.5, fp));
    // The finest chop, used only for the sparkle (see below). Faded out as
    // soon as it would be smaller than a pixel, where it could only alias.
    vec2 uv3 = vWorld.xz * 1.9 + vec2(0.041, -0.033) * uWaveTime;
    vec3 n3 = texture2D(uDetailNormals, uv3).xyz * 2.0 - 1.0;
    vec2 micro = n3.xy / max(n3.z, 0.35) * 0.85 * (1.0 - smoothstep(0.015, 0.12, fp));
    // The chop a hand's width across, at full strength: the facets that throw
    // the sun's glitter (see GLITTER below). Coarser than the micro sparkle,
    // so it survives further out and each flash is a blob, not a pixel.
    vec2 chop = n2.xy / max(n2.z, 0.3) * 0.8 * (1.0 - smoothstep(0.06, 0.7, fp))
        + n3.xy / max(n3.z, 0.3) * 0.75 * (1.0 - smoothstep(0.04, 0.35, fp));
    // Broken water, and its lace.
    vec2 foam = foamAt(vWorld.xz) * uFoam;
    // A wave big enough to swamp the lens is breaking: white along its crest.
    // Not the ring a breach sends out: that is a swell of clear water.
    float crashH = crashHeight(vWorld.xz);
    float breaking = uCrashK > 0.0 ? 0.0 : 1.0;
    foam.r += smoothstep(0.6, 0.95, crashH / max(uCrashB.x, 0.5)) * smoothstep(0.5, 0.9, uCrashB.x) * 1.2 * uFoam * breaking;
    float foamMask = foamPattern(vWorld.xz, foam.r, fp * 0.6);

    vec3 toP = vWorld - cameraPosition;
    float dist = length(toP);
    vec3 I = toP / dist;
    // In front of the port: that is lens, not sea.
    if (dist < portDistance(I)) discard;

    vec3 amb = oceanWaves(vWorld.xz, fp, NUM_WAVES);
    vec4 sim = simAt(vWorld.xz);
    vec2 grad = amb.yz + sim.ba + detail + crashSlope(vWorld.xz);
    vec3 N = normalize(vec3(-grad.x, 1.0, -grad.y));
    float lod = clamp(log2(fp * 220.0 + 1.0), 0.0, 7.0);

    vec3 col;
    float alpha = 1.0;

    if (domeClearance(I) > 0.0) {
        // ---- Seen from above ------------------------------------------
        vec3 V = -I;
        float NdV = clamp(dot(N, V), 0.0, 1.0);
        float F = 0.02 + 0.98 * pow(1.0 - NdV, 5.0);
        vec3 R = reflect(I, N);
        R.y = abs(R.y);
        vec3 refl = skyLod(R, lod);
        float sd = max(dot(R, uSunDir), 0.0);
        vec3 glint = uSunColor * (pow(sd, 1400.0) * 60.0 + pow(sd, 120.0) * 1.6);

        // Light that went in and came back out: the water's own colour, lifted
        // on crests the sun shines through (subsurface scatter toward a
        // viewer looking into the light).
        float crest = clamp((amb.x + sim.r + crashH * 0.5) * 2.5 + 0.35, 0.0, 1.0);
        vec2 toSun = normalize(uSunDir.xz);
        float backlit = pow(max(dot(normalize(I.xz), toSun), 0.0), 2.0);
        vec3 body = uDeepColor + uSssColor * crest * crest * (0.35 + backlit);

        col = mix(body, refl, F) + glint;

        // White water from above. The bubble cloud just under it lifts the
        // sea round it to a pale turquoise before the foam proper starts,
        // which is what makes a whale's wake read as churned rather than
        // painted on; the foam itself is lit like any rough white surface.
        col += uSssColor * 2.2 * clamp(foam.g, 0.0, 1.0) * (1.0 - foamMask);
        vec3 foamLit = vec3(0.92, 0.97, 1.0)
            * (uSunColor * (0.35 + 0.75 * max(dot(N, uSunDir), 0.0)) + skyLod(vec3(0.0, 1.0, 0.0), 5.0) * 0.45);
        col = mix(col, foamLit, foamMask * 0.95);

        float haze = 1.0 - exp(-dist * uHaze);
        col = mix(col, skyLod(normalize(vec3(I.x, 0.012, I.z)), 3.0), haze);
    } else {
        // ---- Seen from below ------------------------------------------
        vec3 Nd = -N;
        vec3 T = refract(I, Nd, 1.333);
        vec3 R = reflect(I, Nd);
        // Beyond the critical angle the underside is a mirror of the water
        // below it. At grazing angles that is the same water the backdrop
        // shows just under the horizon, so the two meet without a seam;
        // steeper, it reflects the deep and darkens. The facets tilted toward
        // the light catch the sunlit water column and lift.
        // The gradient spans the whole range of angles the underside is seen
        // at, so every ripple, by tilting the mirror, visibly changes what it
        // reflects: that is how ripples read from below.
        float down = smoothstep(0.0, 0.6, -R.y);
        vec3 mirror = mix(uWaterNear * 1.0, uWaterFar * 0.32, down);
        mirror *= 0.8 + 0.5 * clamp(dot(N, uSunDir) - 0.62, 0.0, 1.0) * 4.0;
        // Crests glow. Sunlight enters a wave from above and scatters out of
        // its thin crest, so seen from below the crests are lit teal and the
        // troughs between them stay navy — the contrast that makes the
        // underside of a real swell look heavy.
        float crestLight = smoothstep(-0.05, 0.3, amb.x + sim.r);
        mirror += uSssColor * 0.55 * crestLight * crestLight;
        float F = 1.0;
        vec3 trans = vec3(0.0);
        // How mirror-like the unrippled surface is here: 1 outside Snell's
        // window. The glitter below belongs there, where it is the ONLY
        // light getting through; inside the window everything transmits.
        float mirrorish = 1.0;
        if (dot(T, T) > 1.0e-6) {
            float ct = clamp(dot(T, N), 0.0, 1.0);
            F = 0.02 + 0.98 * pow(1.0 - ct, 5.0);
            mirrorish = F;
            float sd = max(dot(T, uSunDir), 0.0);
            // Snell's window: the sky, and the sun blazing through it. The
            // sparkle is the sun caught by single wave facets at the window's
            // edge, which is where the underside glitters in a real frame.
            // Seen from below, the sky through the window is softened by the
            // moving surface and graded by the water it comes through: blurred
            // and pulled toward the water's colour, not a sharp photograph.
            vec3 skyThrough = skyLod(T, lod + 3.0) * vec3(0.45, 0.8, 1.0);
            skyThrough = mix(skyThrough, uWaterNear * 1.6, 0.4);
            trans = skyThrough * 0.8
                + uSunColor * (pow(sd, 900.0) * 40.0 + pow(sd, 60.0) * 2.0 + pow(sd, 8.0) * 0.25);
        }
        col = mix(trans, mirror, F);

        // SPARKLE. Every facet of the fine chop is a tiny Snell's window. Near
        // the waterline the underside is seen too obliquely for light to get
        // through, except where a facet happens to be tilted steeply toward
        // the eye — and each of those flashes with the bright sky behind it.
        // That scatter of white points across the dark underside is the
        // single most recognisable thing about a sunny surface seen from below.
        vec3 Ns = normalize(vec3(-(grad.x + micro.x), 1.0, -(grad.y + micro.y)));
        vec3 Ts = refract(I, -Ns, 1.333);
        if (dot(Ts, Ts) > 1.0e-6) {
            float cs = clamp(dot(Ts, Ns), 0.0, 1.0);
            float through = 1.0 - (0.02 + 0.98 * pow(1.0 - cs, 5.0));
            float spark = smoothstep(0.25, 0.65, through);
            col +=(skyLod(Ts, 2.0) * 1.3 + uSunColor * pow(max(dot(Ts, uSunDir), 0.0), 12.0) * 2.5)
                * spark * uSparkle;
        }

        // GLITTER. The same thing one scale up: the hand-sized facets. Where
        // one tips far enough toward the eye to let light through, it shows
        // a blob of the bright sky — and where the ray through it runs back
        // toward the sun, a blazing one. These are far brighter than white,
        // so the bloom opens each into the soft bokeh disc a real lens makes
        // of them: the scatter of white flecks across the underside of every
        // sunny over/under photograph.
        vec3 Ng = normalize(vec3(-(grad.x + chop.x), 1.0, -(grad.y + chop.y)));
        vec3 Tg = refract(I, -Ng, 1.333);
        if (dot(Tg, Tg) > 1.0e-6) {
            float cg = clamp(dot(Tg, Ng), 0.0, 1.0);
            float through = 1.0 - (0.02 + 0.98 * pow(1.0 - cg, 5.0));
            float blob = smoothstep(0.45, 0.8, through);
            float sunward = pow(max(dot(Tg, uSunDir), 0.0), 5.0);
            col += (vec3(0.75, 0.93, 1.0) * 1.2 + uSunColor * sunward * 6.0) * blob * uGlitter
                * smoothstep(0.35, 0.85, mirrorish);
        }

        // White water from below: the underside of foam is bright and milky
        // (it scatters the sunlight it stops), and the bubble cloud under it
        // glows the surface above it turquoise.
        col += uSssColor * 2.6 * clamp(foam.g, 0.0, 1.2);
        vec3 foamUnder = vec3(0.58, 0.86, 0.95) * (0.8 + 0.9 * uSunDir.y);
        col = mix(col, foamUnder, foamMask * 0.9);

        // Water between the surface and the eye; the page's own water
        // backdrop shows through where this runs out.
        float trn = exp(-dist * uFogDensity);
        alpha = trn;
        col *= trn;
    }

    gl_FragColor = vec4(col * uPresence, alpha * uPresence);
}
`;

// ---------------------------------------------------------------------------
// Waterline: the meniscus where the dome meets the water.
// ---------------------------------------------------------------------------

export const screenVertex = /* glsl */ `
varying vec2 vNdc;
void main() {
    vNdc = position.xy;
    gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

/** Shared by the full-screen passes: this pixel's world-space view ray. */
export const screenRay = /* glsl */ `
uniform mat4 uInvProjection;
uniform mat4 uCameraWorld;
vec3 screenRay(vec2 ndc) {
    vec4 v = uInvProjection * vec4(ndc, 1.0, 1.0);
    return normalize(mat3(uCameraWorld) * (v.xyz / v.w));
}
`;

export const waterlineFragment = /* glsl */ `
uniform float uAir;
varying vec2 vNdc;
void main() {
    vec3 dir = screenRay(vNdc);
    float c = domeClearance(dir);
    float px = max(fwidth(c), 1.0e-5);
    // A thin dark film of water on the port, with a lit edge on its air side.
    float film = 1.0 - smoothstep(0.0, px * 2.2, abs(c + px * 1.2));
    float edge = 1.0 - smoothstep(0.0, px * 1.4, abs(c - px * 1.6));
    // Just under the line the port is wet and slightly milky.
    float wet = (1.0 - smoothstep(0.0, px * 40.0, -c)) * step(c, 0.0);
    vec3 col = vec3(0.01, 0.045, 0.07) * film + vec3(0.85, 0.95, 1.0) * edge * 0.55
        + vec3(0.55, 0.8, 0.9) * wet * 0.06;
    float a = clamp(film * 0.9 + edge * 0.35 + wet * 0.06, 0.0, 1.0) * uAir;
    gl_FragColor = vec4(col * uAir, a);
}
`;
