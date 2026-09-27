import { useContext, useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { EffectComposerContext } from '@react-three/postprocessing';
import { BlendFunction, Effect, EffectAttribute } from 'postprocessing';
import type { Pass } from 'postprocessing';
import { MathUtils, Uniform } from 'three';
import { oceanUniforms } from './oceanUniforms';
import { oceanWater } from './oceanShaders';
import { LENS_DRY_TIME, crashWave, waterSignal } from '../../animations/waterSignal';
import { frameBudget } from '../../animations/frameBudget';
import { IS_MOBILE } from '../../utils/device';

/**
 * The water a wave leaves on the port.
 *
 * When a crest swamps the lens (crashWave in waterSignal.ts) and drains away,
 * the glass does not come out of it clean. For a second the whole pane
 * streams; then what is left is beads — a scatter of small ones, a few large
 * — and now and then one grows too heavy to hold on and runs down, sweeping
 * the beads in its path and leaving a wet streak behind it that thins and
 * dries to a line of tiny ones. Over the
 * next few seconds they run off or dry out, usually just before the next
 * wave. It is the one thing that says a person is holding this camera.
 *
 * Every bead is a tiny lens. It shows the scene round it shrunk and upside
 * down, bent hardest at its rim (which goes dark against the bright sky),
 * with a glint of the sky high on the side toward the sun. So this is a pass
 * that reads the finished frame at offset positions: its own EffectPass
 * (CONVOLUTION), after the bloom and the shockwave, before the grade — the
 * vignette and grain are the camera's, and lie over the water on its glass.
 *
 * Only on glass that is in the AIR: under the waterline the port is wet
 * through, and a bead of water in water is nothing. Each pixel asks where
 * its ray leaves the port, as the waterline does, so the beads are uncovered
 * as the wave drains off the glass and swallowed as the next one climbs it.
 *
 * Positions are in the frame's short side (its height on a landscape screen,
 * its width on a phone held upright), x scaled by the aspect, so beads are
 * round and the same size whichever way the screen is held.
 * The pattern is keyed to the time since the swamping and a seed drawn fresh
 * each time, so every wave leaves its own.
 */

const fragmentShader = /* glsl */ `
${oceanWater}
uniform mat4 uInvProjection;
uniform mat4 uCameraWorld;
uniform float uStrength;
uniform float uAge;
uniform float uSeed;
uniform float uCheap;   // 1 on phones and machines over budget (see LensDroplets)

#define LENS_DRY_TIME ${LENS_DRY_TIME.toFixed(1)}
#define LENS_TAU 6.2831853
// The short side of the frame, in frame heights: sizes are measured in it, so
// a bead is the same size on a phone held upright as on a laptop.
#define LENS_UNIT min(aspect, 1.0)

float lensHash(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

vec4 lensHash4(vec2 p) {
    vec4 p4 = fract(vec4(p.xyxy) * vec4(0.1031, 0.1030, 0.0973, 0.1099));
    p4 += dot(p4, p4.wzxy + 33.33);
    return fract((p4.xxyz + p4.yzzw) * p4.zywx);
}

// 1 where this pixel looks out through glass in the air, 0 where the port is
// under; soft over a few pixels just above the waterline's lit edge.
float glassInAir(vec2 uv) {
    vec4 vp = uInvProjection * vec4(uv * 2.0 - 1.0, 1.0, 1.0);
    vec3 dir = normalize(mat3(uCameraWorld) * (vp.xyz / vp.w));
    vec3 eye = uCameraWorld[3].xyz;
    vec3 forward = -normalize(uCameraWorld[2].xyz);
    vec3 port = eye + dir * (uDomeRadius / max(dot(dir, forward), 0.05));
    float c = portClearance(port, eye, normalize(uCameraWorld[0].xyz));
    float px = max(fwidth(c), 1.0e-5);
    return smoothstep(px * 1.5, px * 6.0, c);
}

// Where a running drop is, and the path it has swept: shared by runnerAt,
// which draws the drop and its streak, and runnerSwept, which only asks
// whether it has been through (once per bead, up to six times a pixel), so
// the two can never disagree about the path.
struct LensRunner {
    vec4 h;         // the column's hash
    float y;        // the drop's height (frame heights)
    float r;        // its radius
    float rate;     // its speed
    float x0;       // the column's centre
    float wander;   // how far it strays from it
    float dx;       // p across from the path
    float along;    // 0..1, p between the drop and where it set off
    float swept;    // 0..1, how far p is on the path it has swept clear
};

// A drop grown too heavy to hold on, running down the glass in fits and
// starts. At most one to each column \`width\` frame heights across, a share
// \`density\` of them running; each sets off \`delay\` plus up to \`spread\`
// seconds after the swamping, at about \`speed\` frame heights a second.
// One column of each kind always runs, somewhere toward the middle of the
// frame, so there is always a streak to see. False where there is none.
bool runnerPath(vec2 p, float width, float density, float speed, float delay, float spread, float seed, float age, out LensRunner run) {
    float col = floor(p.x / width);
    float lead = floor(mix(0.2, 0.8, fract(seed * 0.6180339)) * aspect / (LENS_UNIT * width));
    run.h = lensHash4(vec2(col, seed));
    if (run.h.w > density && col != lead) return false;
    float t = age - delay - run.h.x * spread;
    if (t <= 0.0) return false;
    // Held back by the glass, then letting go (never climbing: 0.3 * 2.6 < 1).
    float ph = run.h.z * LENS_TAU;
    float s = t + 0.3 * (sin(t * 2.6 + ph) - sin(ph));
    float top = mix(0.7, 1.05, run.h.z) / LENS_UNIT;
    run.rate = speed * mix(0.6, 1.4, run.h.y) / LENS_UNIT;
    run.y = top - run.rate * s;
    run.r = width * mix(0.2, 0.3, run.h.x);
    // It wanders a little on its way down, inside its column.
    run.x0 = (col + 0.5) * width;
    run.wander = width * 0.15;
    float pathX = run.x0 + run.wander * sin(p.y * 11.0 + run.h.y * LENS_TAU);
    run.dx = p.x - pathX;
    float across = 1.0 - smoothstep(run.r * 0.5, run.r * 0.85, abs(run.dx));
    run.along = smoothstep(run.y, run.y + run.r * 1.5, p.y) * (1.0 - smoothstep(top, top + run.r, p.y));
    run.swept = across * run.along;
    return true;
}

// The drop over p as (p from its centre, in its radii; its radius in frame
// heights), radius 0 where there is none; and in \`wake\` what it has left
// behind at p: how far p is on the path it has swept clear (x, 0..1); and
// the wet streak down that path, which narrows and dries out over \`linger\`
// seconds: where p is across it (y, -1..1 edge to edge), how much water is
// there (z, 0..1) and how wide it is (w, half, in frame heights).
vec3 runnerAt(vec2 p, float width, float density, float speed, float delay, float spread, float linger, float seed, float age, out vec4 wake) {
    wake = vec4(0.0);
    LensRunner run;
    if (!runnerPath(p, width, density, speed, delay, spread, seed, age, run)) return vec3(0.0);
    vec4 h = run.h;
    float y = run.y;
    float r = run.r;
    float dropX = run.x0 + run.wander * sin(y * 11.0 + h.y * LENS_TAU);
    // The streak: a thread of water drawn out behind it, thinner than the
    // drop and thinning as it drains, pinched here and there where the glass
    // held more of it back, gone a little while after the drop went by.
    float behind = max(p.y - y, 0.0) / run.rate;
    float dry = clamp(behind / linger, 0.0, 1.0);
    float hw = r * mix(0.55, 0.28, dry)
        * (0.8 + 0.2 * sin(p.y * 97.0 + h.x * LENS_TAU) * sin(p.y * 41.0 + h.z * LENS_TAU));
    float wet = run.along * (1.0 - dry * dry) * (1.0 - smoothstep(hw * 0.75, hw, abs(run.dx)));
    wake = vec4(run.swept, run.dx / hw, wet, hw);
    // Drawn out into a tail behind it, round and full in front.
    vec2 d = vec2(p.x - dropX, p.y - y);
    d.y *= d.y > 0.0 ? 0.55 : 1.0;
    return vec3(d / r, r);
}

// Only whether a running drop has swept p: runnerPath without the drop and
// its streak. Takes (and ignores) \`linger\`, so it takes the same LENS_*.
float runnerSwept(vec2 p, float width, float density, float speed, float delay, float spread, float linger, float seed, float age) {
    LensRunner run;
    return runnerPath(p, width, density, speed, delay, spread, seed, age, run) ? run.swept : 0.0;
}

// The two kinds that run, one of each: first a fast one as the wave drains
// off, leaving a long streak that is soon gone; then, while the glass is
// still wet, a heavy one, whose short streak stays.
#define LENS_FAST 0.045, 0.0, 0.9, 0.15, 0.7, 1.1, uSeed + 23.0
#define LENS_SLOW 0.11, 0.0, 0.07, 0.8, 3.0, 2.0, uSeed + 11.0

// Whether a running drop has been through q yet.
bool sweptAt(vec2 q, float age) {
    return max(runnerSwept(q, LENS_FAST, age), runnerSwept(q, LENS_SLOW, age)) > 0.5;
}

// One layer of beads: at most one to each cell of a grid \`cell\` frame
// heights across, a share \`density\` of the cells holding one. Those in the
// path of a running drop are gone, unless \`trail\`: then ONLY those are
// there, the line of tiny ones it leaves behind. Returns the bead over p as
// runnerAt does.
vec3 beadAt(vec2 p, float cell, float density, float seed, float age, bool trail) {
    vec2 g = p / cell;
    vec2 id = floor(g);
    if (lensHash(id + seed * 1.37 + 5.3) > density) return vec3(0.0);
    vec4 h = lensHash4(id + seed);
    // Many small, a few large; the large hold on longest before drying out,
    // and each shrinks a little as it goes.
    float r = mix(0.12, 0.38, h.z * h.z);
    float life = LENS_DRY_TIME * mix(0.3, 0.95, h.w) * mix(0.7, 1.0, h.z);
    if (age > life) return vec3(0.0);
    r *= mix(1.0, 0.6, smoothstep(life - 2.0, life, age));
    // Placed so that it never crosses out of its cell.
    vec2 c = (h.xy - 0.5) * (1.0 - 2.5 * r);
    // Swept away, or left behind, whole.
    if (sweptAt((id + 0.5 + c) * cell, age) != trail) return vec3(0.0);
    vec2 d = g - id - 0.5 - c;
    // Not quite round: its weight sags it, flatter above and fuller below,
    // and its edge holds wherever the glass let it.
    d.y *= d.y > 0.0 ? 1.15 : 0.9;
    d *= 1.0 + 0.05 * sin(atan(d.y, d.x + 1.0e-6) * 3.0 + h.w * LENS_TAU);
    return vec3(d / r, r * cell);
}

void keepDrop(vec3 drop, inout vec3 best) {
    if (drop.z > 0.0 && dot(drop.xy, drop.xy) < 1.0) best = drop;
}

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
    outputColor = inputColor;
    if (uStrength <= 0.0) return;
    float air = glassInAir(uv);
    if (air <= 0.0) return;

    vec2 p = vec2(uv.x * aspect, uv.y) / LENS_UNIT;
    float age = uAge;

    // Back to front: the beads, small and large, and the lines of tiny ones
    // the running drops leave; then the drops still running.
    vec4 fastWake;
    vec4 slowWake;
    vec3 drop = vec3(0.0);
    // Sparse: a few dozen small ones over the pane, a handful of large.
    keepDrop(beadAt(p, 0.022, 0.012, uSeed, age, false), drop);
    keepDrop(beadAt(p, 0.07, 0.035, uSeed + 7.0, age, false), drop);
    // The trail of tiny beads is the dearest layer (each cell asks both
    // runners whether they have been through it) and the least seen.
    if (uCheap < 0.5) keepDrop(beadAt(p, 0.012, 0.3, uSeed + 31.0, age, true), drop);
    keepDrop(runnerAt(p, LENS_FAST, age, fastWake), drop);
    keepDrop(runnerAt(p, LENS_SLOW, age, slowWake), drop);
    vec4 wake = fastWake.z > slowWake.z ? fastWake : slowWake;

    // Straight out of the water the whole pane streams: a sheet running
    // down it that wrinkles the view, gone in a second or so.
    float sheet = uCheap > 0.5 ? 0.0 : 1.0 - smoothstep(0.2, 1.4, age);
    vec2 film = sheet * 0.004 * vec2(
        sin(p.x * 70.0 + sin(p.y * 9.0 + age * 5.0) * 3.0),
        sin(p.y * 31.0 + age * 12.0 + sin(p.x * 23.0) * 2.0));

    // How much of the view the bead over p covers. Where it covers all of it,
    // nothing under it is seen, so the sheet and the streak under it are
    // not read at all (each is a texture tap).
    float r2 = 0.0;
    float rr = 0.0;
    float cap = 0.0;
    float inside = 0.0;
    if (drop.z > 0.0) {
        r2 = dot(drop.xy, drop.xy);
        rr = sqrt(r2);
        cap = sqrt(max(1.0 - r2, 0.0));
        inside = 1.0 - smoothstep(1.0 - 1.5 / (resolution.y * drop.z * LENS_UNIT), 1.0, rr);
    }

    vec4 seen = inputColor;
    if (inside < 1.0) {
        // Likewise the sheet, where the streak's water covers it entirely.
        if (sheet > 0.0 && wake.z < 1.0)
            seen = texture2D(inputBuffer, clamp(uv + vec2(film.x / aspect, film.y), 0.0, 1.0));

        // A streak is a lens too, drawn out along its length: the view through
        // it squeezed and flipped side to side, dark down its edges, and lit
        // down the one toward the sun.
        if (wake.z > 0.0) {
            float s = clamp(wake.y, -1.0, 1.0);
            float lift = sqrt(max(1.0 - s * s, 0.0));
            vec2 off = film - vec2(s / max(lift, 0.3) * wake.w * LENS_UNIT * 1.2, 0.0);
            vec4 through = texture2D(inputBuffer, clamp(uv + vec2(off.x / aspect, off.y), 0.0, 1.0));
            float edge = smoothstep(0.55, 1.0, abs(s));
            float sheen = pow(max(dot(normalize(vec3(s, 0.0, lift)), normalize(vec3(0.45, 0.0, 1.0))), 0.0), 24.0);
            through.rgb = through.rgb * (1.0 - 0.35 * edge) + vec3(1.0, 0.97, 0.92) * sheen * 0.3;
            seen = mix(seen, through, wake.z);
        }
    }

    if (drop.z > 0.0) {
        // A ball lens: the scene round it, shrunk and upside down, bent
        // hardest at the rim.
        vec2 off = film - drop.xy / max(cap, 0.25) * drop.z * LENS_UNIT * 1.3;
        vec2 suv = clamp(uv + vec2(off.x / aspect, off.y), 0.0, 1.0);
        // Right on the glass, far too close to the lens to be sharp.
        // Cheap: one tap, sharp; at a phone's size a bead is a few pixels
        // across and the blur is not missed.
        vec4 bead = texture2D(inputBuffer, suv);
        if (uCheap < 0.5) {
            vec2 b = vec2(drop.z * 0.35 / aspect, drop.z * 0.35) * LENS_UNIT;
            bead = (bead * 2.0
                + texture2D(inputBuffer, clamp(suv + b * vec2(1.0, 0.6), 0.0, 1.0))
                + texture2D(inputBuffer, clamp(suv + b * vec2(-0.6, 1.0), 0.0, 1.0))
                + texture2D(inputBuffer, clamp(suv + b * vec2(-1.0, -0.6), 0.0, 1.0))
                + texture2D(inputBuffer, clamp(suv + b * vec2(0.6, -1.0), 0.0, 1.0))) / 6.0;
        }
        // Dark at the rim, where it bends the light too far to see through;
        // a glint of the sky high on the side toward the sun; and the light
        // it gathers, pooled low inside it.
        vec3 n = normalize(vec3(drop.xy, max(cap, 0.05)));
        float rim = smoothstep(0.65, 1.0, rr);
        float glint = pow(max(dot(n, normalize(vec3(0.45, 0.6, 1.0))), 0.0), 90.0);
        float pool = smoothstep(0.35, 0.85, rr) * smoothstep(0.2, 0.9, -drop.y / max(rr, 1.0e-3));
        bead.rgb = bead.rgb * (1.0 - 0.45 * rim) + vec3(1.0, 0.97, 0.92) * (glint * 0.8 + pool * 0.06);
        seen = mix(seen, bead, inside);
    }
    outputColor = mix(inputColor, seen, air * uStrength);
}
`;

const shared = (key: keyof typeof oceanUniforms) => oceanUniforms[key] as unknown as Uniform;

class LensDropletsEffect extends Effect {
    constructor() {
        super('LensDroplets', fragmentShader, {
            // Reads the frame at other pixels than its own, so it gets a pass
            // to itself, after everything it bends.
            attributes: EffectAttribute.CONVOLUTION,
            blendFunction: BlendFunction.SRC,
            uniforms: new Map<string, Uniform>([
                ['uWaveA', shared('uWaveA')],
                ['uWaveB', shared('uWaveB')],
                ['uWaveTime', shared('uWaveTime')],
                ['uWaterLevel', shared('uWaterLevel')],
                ['uDomeRadius', shared('uDomeRadius')],
                ['uSimTex', shared('uSimTex')],
                ['uSimCenter', shared('uSimCenter')],
                ['uSimSize', shared('uSimSize')],
                ['uCrashA', shared('uCrashA')],
                ['uCrashB', shared('uCrashB')],
                ['uCrashK', shared('uCrashK')],
                ['uInvProjection', shared('uInvProjection')],
                ['uCameraWorld', shared('uCameraWorld')],
                ['uStrength', new Uniform(0)],
                ['uAge', new Uniform(LENS_DRY_TIME)],
                ['uSeed', new Uniform(0)],
                ['uCheap', new Uniform(IS_MOBILE ? 1 : 0)],
            ]),
        });
    }
}

/** Mounted in the EffectComposer after the shockwave, before the grade. */
export function LensDroplets() {
    const effect = useMemo(() => new LensDropletsEffect(), []);
    useEffect(() => () => effect.dispose(), [effect]);
    const lastWet = useRef(0);
    const composer = useContext(EffectComposerContext)?.composer;
    const pass = useRef<Pass | null>(null);

    useFrame(() => {
        const wet = crashWave.wet;
        // Swamped again: a fresh scatter. The port is under when it happens,
        // so the old pattern is never seen to change.
        // The quality is chosen then too, for the same reason: switching it
        // while the beads are in view would be a visible pop.
        if (wet > lastWet.current + 0.01) {
            (effect.uniforms.get('uSeed') as Uniform).value = Math.random() * 97;
            (effect.uniforms.get('uCheap') as Uniform).value = IS_MOBILE || frameBudget.degraded ? 1 : 0;
        }
        lastWet.current = wet;
        const on = waterSignal.active ? oceanUniforms.uPresence.value : 0;
        (effect.uniforms.get('uAge') as Uniform).value = (1 - wet) * LENS_DRY_TIME;
        // The last of it goes gently rather than all at once.
        const strength = on * MathUtils.smoothstep(wet, 0, 0.1);
        (effect.uniforms.get('uStrength') as Uniform).value = strength;

        // A dry port draws nothing, but its pass would still copy the whole
        // frame through its shader every frame (it reads other pixels than
        // its own, so it has a pass to itself; see CONVOLUTION above). Off
        // while dry, and the frame goes straight on to the grade. The pass is
        // found by its effect, and looked up again if the composer rebuilt
        // its passes.
        if (composer && (!pass.current || !composer.passes.includes(pass.current))) {
            pass.current =
                composer.passes.find((p) => (p as unknown as { effects?: Effect[] }).effects?.includes(effect)) ?? null;
        }
        if (pass.current) pass.current.enabled = strength > 0;
    });

    return <primitive object={effect} />;
}
