import { MathUtils, Vector3 } from 'three';

/**
 * Where the sea surface is, published once per frame.
 *
 * The hero used to be a scrubbed video of a dive. It is now the live ocean in
 * `components/ocean/`: a real sky, a simulated surface the whale and the
 * pointer both disturb, caustics, and an over/under opening shot. This module
 * is the one place that says where that water is, so the surface, the
 * waterline, the whale's caustics, the bubbles and the god rays all agree.
 *
 * THE DIVE IS THE WATER RISING, NOT THE CAMERA FALLING. The camera's rest pose
 * and every whale depth in `diveScore.ts` were tuned together for the whole
 * page, so neither moves. Instead the surface starts just above the camera's
 * eye — an over/under frame, sky above the waterline and the whale below it —
 * and climbs away overhead as the page scrolls. To the eye that is the camera
 * and the whale sinking together, which is the point: you dive WITH it.
 *
 * `eyeOffset` is the camera's height relative to the mean water level:
 * slightly negative at the top of the page (the eye just under the surface),
 * strongly negative once the surface has receded out of view.
 */

/** Camera Y the water level is measured against. Matches the rest position
 *  of the camera in `WhaleScene.tsx`. The CameraDirector's small offsets are
 *  deliberately NOT included: the water must stay put while the camera drifts. */
export const EYE_REST_Y = 2;

/**
 * Eye height relative to the water, keyed by scroll in viewport heights, and
 * timed to the story's chapters (animations/story.ts):
 *
 *   0     the hero, over/under: the eye floating just under the mean level,
 *         so the port's waterline rides across the middle of the frame —
 *         half sky and sea surface, half the water the whale is in.
 *   0.8   the waterline has left the top of the frame; fully under.
 *   0.8-1.8  chapter 1 ('the surface') plays with the surface just overhead.
 *   1.8-4.3  chapters 2-3: it recedes into the haze as the dive goes on.
 *   5.2   gone; chapter 4 hands over to the projects in open water.
 *
 * Monotone, and eased between keys, so the dive never stalls or reverses.
 */
const DIVE_KEYS: Array<[number, number]> = [
    [0, -0.16],
    [0.12, -0.2],
    [0.8, -1.35],
    [1.8, -2.8],
    [3.0, -7.5],
    [4.3, -14],
    [5.2, -20],
];

/** Below this eye offset the surface is lost in the haze and nothing of the
 *  water is drawn or simulated. */
export const WATER_GONE_OFFSET = -18;

/**
 * Distance of the virtual port in front of the lens, world units.
 *
 * Real over/under photographs are shot through the window of an underwater
 * housing, and the waterline in the frame is where that window meets the
 * water — which is why it can sit anywhere in the picture, and why the waves
 * sloshing across it make it undulate. Each pixel's medium (air or water) is
 * decided where its ray leaves this port. Collapsed to nothing once the
 * waterline has left the frame, or the surface directly overhead would be
 * clipped inside it.
 */
const DOME_RADIUS = 1.25;

export interface WaterSignal {
    /** World Y of the mean water surface. */
    level: number;
    /** Camera eye height relative to `level` (negative = under). */
    eyeOffset: number;
    /** Current dome radius. */
    domeRadius: number;
    /** 1 while any of the surface is worth drawing, easing to 0 as it goes. */
    presence: number;
    /** 0..1: how much of the frame is still air. 1 at the over/under hero,
     *  0 once the waterline has left the top of the frame. */
    air: number;
    /** False once the water is gone entirely: skip simulation and drawing. */
    active: boolean;
    /** Seconds of wave time. Slowed under reduced motion. */
    time: number;
}

export const waterSignal: WaterSignal = {
    level: EYE_REST_Y + 0.16,
    eyeOffset: -0.16,
    domeRadius: DOME_RADIUS,
    presence: 1,
    air: 1,
    active: true,
    time: 0,
};

const smooth = (t: number) => t * t * (3 - 2 * t);

export function eyeOffsetAt(scrollVh: number): number {
    const s = Math.max(0, scrollVh);
    for (let i = 1; i < DIVE_KEYS.length; i++) {
        const [s1, e1] = DIVE_KEYS[i];
        if (s <= s1) {
            const [s0, e0] = DIVE_KEYS[i - 1];
            return MathUtils.lerp(e0, e1, smooth((s - s0) / (s1 - s0)));
        }
    }
    return DIVE_KEYS[DIVE_KEYS.length - 1][1];
}

/** Publish this frame's water state from scroll. Allocation-free. */
export function updateWater(scrollVh: number, dt: number, timeScale: number): void {
    waterSignal.time += Math.min(dt, 0.1) * timeScale;
    const e = eyeOffsetAt(scrollVh);
    waterSignal.eyeOffset = e;

    // RIDING THE SWELL. A real over/under is shot by someone floating: the
    // long swell lifts photographer and water together, and only the shorter
    // waves slop across the dome. Without this the swell alone floods the
    // lens for seconds at a time, and the opening shot flips between all-sky
    // and all-sea. So while the waterline is in frame, the long swell AT THE
    // CAMERA is taken back out of the mean level. The swell still rolls past
    // everywhere else — the whale's tail still rises and falls through it.
    const riding = 1 - MathUtils.smoothstep(-e, 0.9, 1.7);
    const swell = riding > 0 ? ambientHeight(SWELL_POINT[0], SWELL_POINT[1], waterSignal.time, SWELL_WAVES) : 0;
    waterSignal.level = EYE_REST_Y - e - swell * riding;

    // How far the port's waterline has climbed. It leaves the top of an
    // 80-degree frame once the eye is tan(40deg) of the port distance under,
    // plus wave height.
    const leave = DOME_RADIUS * 0.84 + 0.2;
    waterSignal.air = 1 - MathUtils.smoothstep(-e, 0.72, leave);
    // Collapse the dome only after the waterline is well gone (see above).
    const collapse = MathUtils.smoothstep(-e, leave, leave + 0.35);
    waterSignal.domeRadius = MathUtils.lerp(DOME_RADIUS, 0.02, collapse);

    waterSignal.presence = 1 - MathUtils.smoothstep(-e, 9, -WATER_GONE_OFFSET);
    waterSignal.active = e > WATER_GONE_OFFSET;

    updateCrash(Math.min(dt, 0.1) * timeScale, timeScale > 0.5 ? waterSignal.air : 0);
}

// --- Waves meeting the lens ------------------------------------------------

/**
 * Every so often in the opening shot, a wave rolls in and swamps the lens.
 *
 * Real over/under footage is never still: the photographer is IN the water,
 * and every few seconds a crest runs at the housing, the waterline climbs the
 * frame, the port goes under, and the wave drains away behind it leaving the
 * glass wet. This is that wave: a single crest line travelling toward the
 * camera, bent and uneven along its length (so the line it draws across the
 * frame is too), with a steep front and a long trough behind it.
 *
 * `a` = crest point (world x, z) and travel direction (x, z).
 * `b` = amplitude, front width, back width, seed. Amplitude 0 = no wave.
 * `k` = curvature of the crest, 1/radius: 0 for a wave rolling in from the
 * open sea, a ring for one spreading from something that hit the water.
 * The shaders' `crashHeight` and the CPU `crashHeightAt` below are twins.
 */
export const crashWave = {
    a: new Float32Array(4),
    b: new Float32Array(4),
    k: 0,
    /** 1 when a crest has just swamped the port, draining to 0 over
     *  LENS_DRY_TIME: the wet lens, and the beads left on it (lensDroplets). */
    wet: 0,
    /** True on the one frame the crest reaches the port (the bubble burst). */
    impact: false,
};

/** The port's centre on the water plane: camera z 10, port ahead of it. */
const PORT_X = 0;
const PORT_Z = 10 - DOME_RADIUS;
/** Seconds the port takes to dry after a swamping: the beads left on the
 *  glass run off or dry out over this long. About the gap between waves, so
 *  the lens is seldom quite dry before the next one. */
export const LENS_DRY_TIME = 9;
/** Where the crest starts and ends, along its travel, relative to the port. */
const CRASH_FROM = -9;
const CRASH_TO = 5;
const CRASH_SPEED = 4.4;
const CRASH_FRONT = 0.95;
const CRASH_BACK = 2.0;
/** Share of its run over which a wave from the open sea builds. */
const CRASH_RISE = 0.35;

/** THE WAVE A BREACH SENDS. The whale landing flat on the sea heaves up a
 *  ring of water that runs out from where it went in and, the camera being
 *  so close, rolls up the port: its amplitude, the radius it is born at
 *  (about the white water's), and the share of its run it builds over (it is
 *  born whole, out of the splash). */
const BREACH_WAVE_AMP = 0.8;
const BREACH_WAVE_R0 = 2.5;
const BREACH_WAVE_RISE = 0.12;

let crashS = Number.NaN;
let crashTimer = 3.2;
let crashAngle = 0;
let crashAmp = 0;
let crashHit = false;
/** Where along its travel this wave started, the share of its run it builds
 *  over, and for a ring, its radius where it started (0 for a straight crest). */
let crashFrom = CRASH_FROM;
let crashRise = CRASH_RISE;
let crashR0 = 0;
/** Set for a frame by something the next wave must not hide (holdCrash). */
let crashHeld = false;

function updateCrash(dt: number, allowed: number): void {
    crashWave.impact = false;

    if (Number.isNaN(crashS)) {
        if (allowed > 0.6) crashTimer -= dt;
        // Held: the next wave waits, and never rolls in the moment it is let go.
        if (crashHeld) crashTimer = Math.max(crashTimer, 2.5);
        if (crashTimer <= 0) {
            crashS = CRASH_FROM;
            crashFrom = CRASH_FROM;
            crashRise = CRASH_RISE;
            crashR0 = 0;
            crashAngle = (Math.random() * 2 - 1) * 0.42;
            // Mostly big enough to put the port under; now and then one that
            // only slops up the glass and falls back.
            crashAmp = Math.random() < 0.75 ? 0.9 + Math.random() * 0.3 : 0.45 + Math.random() * 0.15;
            crashWave.b[3] = Math.random() * Math.PI * 2;
            crashHit = false;
            crashTimer = 6.5 + Math.random() * 5;
        }
    }

    if (!Number.isNaN(crashS)) {
        crashS += CRASH_SPEED * dt;
        const dx = Math.sin(crashAngle);
        const dz = Math.cos(crashAngle);
        crashWave.a[0] = PORT_X + dx * crashS;
        crashWave.a[1] = PORT_Z + dz * crashS;
        crashWave.a[2] = dx;
        crashWave.a[3] = dz;
        crashWave.k = crashR0 > 0 ? 1 / (crashR0 + crashS - crashFrom) : 0;
        const u = (crashS - crashFrom) / (CRASH_TO - crashFrom);
        const envelope = MathUtils.smoothstep(u, 0, crashRise) * (1 - MathUtils.smoothstep(u, 0.72, 1));
        crashWave.b[0] = crashAmp * envelope * MathUtils.clamp(allowed, 0, 1);
        crashWave.b[1] = CRASH_FRONT;
        crashWave.b[2] = CRASH_BACK;
        if (!crashHit && crashS >= 0) {
            crashHit = true;
            crashWave.impact = crashWave.b[0] > 0.3;
            if (crashWave.b[0] > 0.6) crashWave.wet = 1;
        }
        if (crashS >= CRASH_TO) {
            crashS = Number.NaN;
            crashWave.b[0] = 0;
            crashWave.k = 0;
        }
    }

    crashWave.wet = Math.max(0, crashWave.wet - dt / LENS_DRY_TIME);
    crashHeld = false;
}

/** Send THE WAVE A BREACH SENDS out from where the whale landed (world x, z):
 *  a ring centred there, its crest running at the port. It takes the place
 *  of any wave already rolling in, and the next from the open sea waits. */
export function breachWave(x: number, z: number): void {
    const dx = PORT_X - x;
    const dz = PORT_Z - z;
    const dist = Math.hypot(dx, dz);
    // Landed right by the lens: the splash is the wave, and it comes down
    // on the port.
    if (dist < BREACH_WAVE_R0 + 1) {
        crashWave.wet = 1;
        return;
    }
    crashAngle = Math.atan2(dx, dz);
    // Along its travel the port is at 0, so the crest starts this far back.
    crashS = BREACH_WAVE_R0 - dist;
    crashFrom = crashS;
    crashRise = BREACH_WAVE_RISE;
    crashR0 = BREACH_WAVE_R0;
    crashAmp = BREACH_WAVE_AMP;
    crashWave.b[3] = Math.random() * Math.PI * 2;
    crashHit = false;
    crashTimer = 6.5 + Math.random() * 5;
}

/** Hold the next wave back this frame. The whale's breach calls it for as
 *  long as it is under way: a crest rolling at the lens would hide the leap. */
export function holdCrash(): void {
    crashHeld = true;
}

/** Start the next wave now (development: lets a capture catch one). */
export function triggerCrash(): void {
    if (Number.isNaN(crashS)) crashTimer = 0;
}

/** CPU twin of the shaders' `crashHeight` (the bubbles need to know where the
 *  whitewater is). Relative to the mean level. */
export function crashHeightAt(x: number, z: number): number {
    const b = crashWave.b;
    if (b[0] <= 0) return 0;
    const a = crashWave.a;
    const rx = x - a[0];
    const rz = z - a[1];
    let along = rx * a[2] + rz * a[3];
    let lat = -rx * a[3] + rz * a[2];
    if (crashWave.k > 0) {
        // A ring: distance out past it, and arc length round it.
        const r = 1 / crashWave.k;
        const qx = along + r;
        along = Math.hypot(qx, lat) - r;
        lat = r * Math.atan2(lat, qx);
    }
    along += 0.4 * Math.sin(lat * 0.9 + b[3]) + 0.16 * Math.sin(lat * 2.3 + b[3] * 1.7);
    const w = along > 0 ? b[1] : b[2];
    const crest = Math.exp(-(along * along) / (w * w));
    const tq = (along + b[2] * 1.6) / b[2];
    const trough = Math.exp(-tq * tq) * 0.35;
    const amp = b[0] * (1 + 0.3 * Math.sin(lat * 0.55 + b[3] * 2.1));
    return amp * (crest - trough) * Math.exp(-(lat * lat) / 70);
}

// --- The sun ---------------------------------------------------------------

/**
 * Direction TOWARD the sun: high, and well round to the right of where the
 * camera looks. The sky photograph shows no sun of its own (it is bright,
 * open blue), so nothing in it contradicts this; the glint on the water, the
 * caustics on the whale, the light shafts and the glow under the surface all
 * come from here.
 *
 * WHY SO FAR ROUND. The shafts under the water are parallel lines along the
 * refracted sun, so in perspective they converge on the sun's own point in
 * the image. With the sun nearly ahead (it was 28 degrees), that point sat
 * just above the frame, and the shafts fanned out from it — the left ones
 * leaning left, the right ones right, as if lit from two sides. At 70 degrees
 * the point is off the right edge of the frame (x ~1.8 at 16:9, ~1.4 at
 * 21:9), so every shaft leans the same way, tops toward the sun: one light,
 * one angle, the way the shafts in a real underwater frame fall.
 */
const SUN_ELEVATION = MathUtils.degToRad(47.9);
const SUN_AZIMUTH = MathUtils.degToRad(70);

export const SUN_DIR = new Vector3(
    Math.sin(SUN_AZIMUTH) * Math.cos(SUN_ELEVATION),
    Math.sin(SUN_ELEVATION),
    -Math.cos(SUN_AZIMUTH) * Math.cos(SUN_ELEVATION),
).normalize();

/**
 * How the sky photograph (public/sky/sky.jpg) is laid over the dome, in
 * radians: [azimuth centre, azimuth span, lowest elevation, elevation span].
 * The span is about the camera's own horizontal field of view, so the photo
 * sits at roughly its natural scale, and keeps the photo's aspect (1.79:1).
 * The opening shot's sky, between the waterline and the top of the frame
 * (~20-40 degrees up), is the photo's middle band of small clouds.
 */
const SKY_AZ_SPAN = MathUtils.degToRad(122);
export const SKY_FRAME: [number, number, number, number] = [
    0,
    SKY_AZ_SPAN,
    MathUtils.degToRad(-4),
    SKY_AZ_SPAN / (2752 / 1536),
];

// --- The sea state ---------------------------------------------------------

/**
 * The ambient sea: a sum of directional deep-water waves, evaluated
 * analytically in every shader that needs the surface (the mesh, the waterline,
 * the caustics), so they all see the same sea. The interactive ripples from
 * the simulation are added on top.
 *
 * Units: the whale is ~21 world units long (a 15 m humpback), so 1 unit is
 * about 0.7 m and real gravity would be ~14 units/s^2. It is set a little
 * lower, which slows the sea by ~10%: a touch of slow motion reads as
 * cinematic rather than wrong. Wavelengths run geometrically from a long swell
 * down to wind chop at a steepness (a*k) of ~0.05, a moderate breeze.
 *
 * Directions are spread around the wind by the golden ratio rather than picked
 * by hand. With a few hand-placed directions, two dominant waves cross into a
 * diamond lattice, and the caustics on the whale read as a net. Spread
 * quasi-randomly, no two neighbours in the spectrum line up, and the focused
 * light breaks into the irregular web real water throws.
 */
export const GRAVITY = 11.5;

export interface Wave {
    /** Wavelength, world units. */
    length: number;
    /** Amplitude, world units. */
    amplitude: number;
    /** Direction of travel, degrees from +X toward +Z. */
    direction: number;
    phase: number;
}

/** Direction the wind blows toward, degrees from +X toward +Z, and how far
 *  either side of it the waves spread. */
const WIND_DIRECTION = 20;
const WIND_SPREAD = 80;

export const WAVES: Wave[] = Array.from({ length: 16 }, (_, i) => {
    const length = 40 * Math.pow(0.72, i);
    // The swell is gentle; the waves riding on it are heavy, the way the
    // reference photograph's surface is — steep enough that the underside
    // is all facets and sparkle, and the waterline rolls across the lens.
    const steepness = i < 3 ? 0.04 : i < 5 ? 0.055 : 0.078;
    const spread = ((i * 0.6180339887 + 0.21) % 1) * 2 - 1;
    return {
        length,
        amplitude: (steepness * length) / (Math.PI * 2),
        direction: WIND_DIRECTION + spread * WIND_SPREAD * (i < 3 ? 0.5 : 1),
        phase: ((i * 2.399963) % (Math.PI * 2)),
    };
});

/** The camera's float: it sits on the swell like the housing it is. */
export const SWELL_POINT: [number, number] = [0, 8.8];

/** Waves the vertex shader displaces with; shorter ones are normal-only. */
export const VERTEX_WAVES = 8;

/** The long swell the camera rides in the opening shot (see updateWater). */
export const SWELL_WAVES = 5;

/** Packed for the shaders: [dirX, dirZ, k, omega] and [amplitude, phase]. */
export function packWaves(): { a: Float32Array; b: Float32Array } {
    const a = new Float32Array(WAVES.length * 4);
    const b = new Float32Array(WAVES.length * 2);
    WAVES.forEach((w, i) => {
        const k = (Math.PI * 2) / w.length;
        const d = MathUtils.degToRad(w.direction);
        a.set([Math.cos(d), Math.sin(d), k, Math.sqrt(GRAVITY * k)], i * 4);
        b.set([w.amplitude, w.phase], i * 2);
    });
    return { a, b };
}

/** CPU twin of the shaders' `oceanWaves().x`, for the few JS consumers that
 *  need the actual surface height at one point (the bubbles). */
export function ambientHeight(x: number, z: number, t: number, count = VERTEX_WAVES): number {
    let h = 0;
    for (let i = 0; i < count; i++) {
        const w = WAVES[i];
        const k = (Math.PI * 2) / w.length;
        const d = MathUtils.degToRad(w.direction);
        h += w.amplitude * Math.sin(k * (Math.cos(d) * x + Math.sin(d) * z) - Math.sqrt(GRAVITY * k) * t + w.phase);
    }
    return h;
}

// --- The simulated patch ---------------------------------------------------

/**
 * World-space square the ripple simulation covers. Centred ahead of the
 * camera (which sits at z = 10 looking down -Z) and wide enough for every
 * place the whale can reach the surface in frame. Outside it the ripples fade
 * to the ambient sea over a soft margin.
 */
export const SIM_CENTER_X = 0;
export const SIM_CENTER_Z = -1;
export const SIM_SIZE = 40;

/** Slope of the ambient sea at one point: [dh/dx, dh/dz], written into `out`. */
export function ambientSlope(
    x: number,
    z: number,
    t: number,
    count: number,
    out: [number, number],
): [number, number] {
    out[0] = 0;
    out[1] = 0;
    for (let i = 0; i < count; i++) {
        const w = WAVES[i];
        const k = (Math.PI * 2) / w.length;
        const d = MathUtils.degToRad(w.direction);
        const dx = Math.cos(d);
        const dz = Math.sin(d);
        const c = w.amplitude * k * Math.cos(k * (dx * x + dz * z) - Math.sqrt(GRAVITY * k) * t + w.phase);
        out[0] += c * dx;
        out[1] += c * dz;
    }
    return out;
}
