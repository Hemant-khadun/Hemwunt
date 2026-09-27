import { Euler, MathUtils, Quaternion, Vector3 } from 'three';
import { WHALE_CONFIG as C } from './whaleConfig';
import { SWIM_BY } from './story';

/**
 * The whale's part in the opening story: one scripted move per chapter.
 *
 * Everywhere else on the page the whale swims itself (physics in
 * `whaleAnimator`, asked for shots by `diveDirector`), and its side of the
 * frame cannot be scheduled. The story is the exception. Like the phoenix in
 * the reference, the animal has to hit its marks — dive past the lens as the
 * first line lands, glide off into the blue behind the second, turn and come
 * at you on the third, and swim right across the lens to leave the last in
 * its wake — so here its ROUTE is a function of scroll.
 *
 * Its MOTION along that route is not. A body keyed straight to scroll stops
 * dead when the page stops, lurches with every wheel notch, snaps round
 * corners and backs up like a car when the visitor scrolls up. So the routes
 * are shaped and timed for a 14 m animal, and the animal swims them:
 *
 *   - THE ROUTES are smooth curves near the marks with no turn tighter than a
 *     humpback can make (radius ~3 units, a seventh of its length; they are
 *     the most agile of the great whales), timed so the speed along them
 *     changes gradually, never in steps at the marks.
 *   - PROGRESS follows the page with mass: speed builds, is carried, and
 *     coasts to a stop; it is capped by how tight the turn ahead is, so the
 *     whale slows into a hairpin instead of spinning through it.
 *   - It faces where it is going. Scroll back a little and it hangs where it
 *     is; scroll back further and it turns round (a banked 180, away from the
 *     lens) and swims back head first.
 *   - The way home is its own route: back along the close pass, then down and
 *     round into the blue and across the deep to the lower right. When the
 *     page is back at the top it comes home by BREACHING: a climbing turn, a
 *     twisting leap right to left across the frame, and a dive that ends in
 *     the opening pose, flukes up. The leap is swum on the clock, not the page
 *     (a whale cannot hang in the air waiting for a scroll), and a whale left
 *     far out on the story takes the shortest way to it.
 *   - It banks into turns in proportion to how fast it is turning, the tail
 *     beat follows speed and effort (and stills in a coast), and the body's
 *     heave is locked to the baked stroke.
 *
 * Coordinates are the animator's (the same space as its output position).
 * The camera sits at (0, 2, 10) looking down -Z; the whale is ~21 units long.
 */

type Mark = [number, number, number, number];

/** The outward route. [scroll vh, x, y, z] */
const MARKS: Mark[] = [
    // The hero: nose down, tail at the surface (the animator's rest pose).
    [0.0, -5.2, -2.6, 0.6],
    // It sounds: down along its own nose as the camera goes under...
    [0.42, -8, -9.6, -0.6],
    // ...pulls out of the dive in the deep, below and left of the frame...
    [0.76, -13, -12.4, -1.5],
    // ...and comes about, out of sight, to climb back toward the lens.
    [1.04, -15.8, -9, 3],
    // Chapter 1: the close pass, rising across the frame just below the words.
    [1.4, -2, -1.2, 3.8],
    [1.9, 10, -1.2, 1.5],
    // Chapter 2: it turns away and dwindles into the blue behind the words.
    [2.45, 13, -5, -10],
    [3.0, 2, -7.5, -21],
    // Chapter 3: it comes about in the blue on the left...
    [3.5, -10, -5.5, -14],
    // ...comes in along the bottom left corner, and turns, rising, out of
    // frame beside the lens, so it is straight and level before it shows.
    [3.72, -17, -1.5, 0],
    [3.9, -14, 3.2, 9],
    // THE SWIM-BY (story.ts SWIM_BY): right across the front of the lens,
    // left to right, flank on, at eye level and close enough to fill the
    // frame...
    [4.02, -6, 3.8, 10.2],
    [4.19, 5.2, 3.9, 10.4],
    [4.36, 16.5, 3.8, 10.2],
    // ...and on, level, until the flukes are past the right edge; chapter 4
    // is written in its wake. Only then down, out of sight, and round under
    // the frame...
    [4.52, 27, 3.4, 9.6],
    [4.78, 27, -8, 3],
    [5.05, 10, -11, -6],
    // ...and on. Physics takes over on the way out of the dive (HANDOFF,
    // 4.95); these last marks only give the route there its shape.
    [5.3, -1, -4.5, -5],
];

/** The close pass on the outward route runs from here to HOME_JOIN. */
const PASS_START = 1.4;
/** Where the way home joins the outward route: the end of the close pass. */
const HOME_JOIN = 1.9;
/** The way home is the close pass swum back, right to left, and then a long
 *  loop down to where it breaches from (see THE LEAP): a descending turn away
 *  from the lens on the left, and a crossing of the deep to the lower right.
 *  Written outward like everything else (it is swum in reverse), so the
 *  first mark is where the way home ENDS, heading right, deep enough that the
 *  climb to the surface is a real run. [scroll vh, x, y, z] */
const HOME_MARKS: Mark[] = [
    [0.0, 12, -11.5, -7],
    [0.35, 3, -11, -7.5],
    [0.7, -5, -9, -6],
    [0.95, -9, -6, -2],
    [1.2, -7, -3.2, 2],
];
/** The glide is rounded like any route, then eased onto the pass itself over
 *  this stretch, so from its end on the way home IS the outward route, point
 *  for point and on the same clock: stepping from one to the other there
 *  cannot move the whale, and the page means the same place on both. */
const HOME_MERGE: [number, number] = [1.45, 1.7];

/** THE SWIM-BY is drawn the same on every screen: narrow ones squeeze the
 *  routes toward the middle of the frame (see `lateral`), which would park
 *  the whale in front of the lens instead of carrying it past. The squeeze is
 *  let go over this much progress (vh) either side of it, while the whale is
 *  out of frame. */
const SWIM_BY_EASE = 0.3;

/** Progress at which the physics whale takes over, all at once: here the
 *  route has levelled out of its dive at the depth the first project's shot
 *  wants, heading into the frame. Past it the route rises, away from that
 *  depth; blending the two over that stretch drew a whale that swam left and
 *  then slid back right, tail first. WhaleModel hands the physics the pose,
 *  speed and beat, and smooths what little is left. */
const HANDOFF = 4.95;
/** Scroll is followed no further than this; past it physics has the whale. */
const HOLD = HANDOFF + 0.1;
/** Taken back further than this (units) from its place on the route, the
 *  whale swims onto it (THE REJOIN); nearer, WhaleModel eases the difference. */
const REJOIN_FROM = 2;
/** The rest pose's own attitude eases into the route's over this range. */
const REST_BLEND: [number, number] = [0.02, 0.32];

// --- Route shape ------------------------------------------------------------
/** Spacing of the route tables, world units. */
const STEP = 0.25;
/** Gaussian rounding of a route, world units. Blends the corners into
 *  continuous-curvature turns, so the bank and turn rate never jump. */
const SHAPE_SIGMA = 3;
/** Half-length of the chord the body is aligned to. The body faces along a
 *  short stretch of route centred on it, not a point tangent. */
const CHORD = 1.2;

// --- Route timing -----------------------------------------------------------
/** Grid step of the timing tables, vh. */
const PACE_STEP = 0.005;
/** Gaussian smoothing of speed along a route, vh. The marks set an average
 *  pace per stretch; this blends one stretch's pace into the next. */
const PACE_SIGMA = 0.2;

// --- Swimming a route -------------------------------------------------------
/** The soft onset: scroll is first eased at this rate (1/s). */
const ONSET_RATE = 9;
/** The chase, tuned as three equal real poles at 4.5/s, so it closes on
 *  where the page is without ever overshooting (an overshoot is the whale
 *  backing up): speed asked per unit of route still to go (1/s), how hard it
 *  works toward that speed (1/s), and how fast its thrust builds (1/s). */
const CHASE_GAIN = 1.5;
const SPEED_GAIN = 4.5;
const THRUST_RATE = 13.5;
/** Top speed, units/s (~1.3 body lengths/s: a burst, and then some). */
const TOP_SPEED = 28;
/** Sideways acceleration it will pull in a turn, units/s^2. Speed through a
 *  turn of radius R is capped at sqrt(TURN_GRIP * R), so it slows into a
 *  tight turn instead of spinning through it. */
const TURN_GRIP = 28;
/** Speed at the opening pose (units/s), and the gentle rate (units/s^2) it
 *  eases off to it or gathers way from it. */
const REST_SPEED = 0.6;
const REST_EASE = 2.5;
/** Most it speeds up or slows down, units/s^2. Its plans assume the lower
 *  braking figure, so it can always stop where the page stopped. */
const MAX_ACCEL = 12;
const PLAN_BRAKE = 8;
/** Lagging more than this (units), it may swim past its comfortable pace by
 *  this much per unit of lag: a jump down the page is not a minute's swim. */
const CATCH_UP_AFTER = 12;
const CATCH_UP_GAIN = 0.45;
const MAX_CATCH_UP = 14;
/** Hardest it can brake when it must, units/s^2. */
const MAX_BRAKE = 36;
/** How far ahead (s) it reads the route's speed limit. */
const LOOK_AHEAD = 0.35;
/** Speed given up mid-way through turning round (0..1). */
const TURNING_SLOW = 0.4;
/** Most it will drift tail first (units/s): the page nudged back less than
 *  TURN_AFTER, or it is still coming round. Whales do not reverse. */
const BACK_DRIFT = 1.8;
/** Fastest it arcs over into the opening pose, rad/s. */
const ARC_RATE = 1.2;
/** Rate (1/s) at which the small jump left by changing routes is absorbed. */
const ROUTE_EASE = 3;

// --- Turning round ----------------------------------------------------------
/** Route the page has to go back (units) before the whale turns round to
 *  follow it. Less than this and it hangs, drifting. */
const TURN_AFTER = 3;
/** Duration of the 180 degree turn, s. */
const TURN_TIME = 2.0;
/** On the outward route near the surface, a whale that has turned round to
 *  swim home arcs over into the opening pose as it rises: nose up, then
 *  round and down. */
const TURN_TOP: [number, number] = [REST_BLEND[0], 0.55];

// --- Attitude ---------------------------------------------------------------
/** Bank per unit of turn rate (rad per rad/s), and its cap. */
const BANK_GAIN = 1.0;
const MAX_BANK = MathUtils.degToRad(38);
/** Rate (1/s) at which the bank follows the turn. */
const BANK_RESPONSE = 3.5;
const MAX_PITCH = MathUtils.degToRad(72);

// --- Tail -------------------------------------------------------------------
/** Hz. The hero's resting beat, a hovering scull, and the hardest stroke. */
const REST_HZ = 0.07;
const HOVER_HZ = 0.09;
const MAX_HZ = 0.48;
const GLIDE_HZ = 0.03;
/** Speed (units/s) at which the beat has gone ~63% of the way to MAX_HZ. */
const TAIL_SPEED_REF = 9;
/** Extra beat per unit/s^2 of acceleration, and per rad/s of turning. */
const TAIL_ACCEL_HZ = 0.025;
const TAIL_TURN_HZ = 0.08;
/** First-order response (1/s) and slew limit (Hz/s) of the beat, so the
 *  clip's playback rate glides rather than steps. */
const TAIL_RESPONSE = 2.5;
const TAIL_SLEW = 0.35;

// --- Life -------------------------------------------------------------------
/** Heave of the body with each stroke (units), and the nod against it (rad). */
const STROKE_HEAVE = 0.09;
const STROKE_NOD = 0.018;
/** The clip's head lead over the peduncle (swim_clip.py HEAD_LEAD). */
const HEAD_LEAD = MathUtils.degToRad(25);
/** The clip's upstroke warp (swim_clip.py UPSTROKE_BIAS). */
const UPSTROKE_BIAS = 0.13;

// --- The leap home ---------------------------------------------------------
/** The page back within this of the top (vh) with the whale out on the story
 *  sends it home by breaching. The waterline is well in the frame by here,
 *  and the page is still coming up while the whale swims to its run. */
const BREACH_AT = 0.3;
/** The page going this far back down (vh) while the whale is still swimming
 *  the way home to its run calls the breach off. */
const BREACH_CANCEL = 0.6;
/** A whale further out than this on the outward route (vh past HOME_JOIN)
 *  when the page reaches the top swims straight to its run, rather than back
 *  along the story first. Nearer in, it swims back to the way home. */
const SHORTCUT_PAST = 0.5;
/** Mean surface at the top of the page in these coordinates, when the scene
 *  does not pass one in (eye 0.16 under the surface, rig shifted by the
 *  whale's <Center>). */
const SURFACE_Y = 4.31;
/** Height the body's centre clears the mean surface by at the top of the
 *  leap, units. About a third of its length: the whole animal is out for a
 *  moment at the top, the flukes last. */
const LEAP_HEIGHT = 6.5;
/** Launch (and entry) angle. Shallower than the opening pose's dive, so the
 *  leap carries it right to left across the frame; it finishes pitching down
 *  under water, where the drag stops its spin. */
const LEAP_ANGLE = MathUtils.degToRad(62);
/** Gravity on the leap, units/s^2: the sea's own (waterSignal GRAVITY). The
 *  model is 21 units for a 14 m whale, so real gravity would be ~14.7; this
 *  much is a touch slower, the way a breach looks on film. */
const LEAP_GRAVITY = 11.5;
/** A body in the air keeps the spin it left the water with; it cannot turn
 *  its nose along the arc. This share of the pitch-over is that spin, the
 *  rest follows the arc (so it leaves and enters the water nose first). The
 *  spin builds as it clears the water, the flukes still pushing, rather
 *  than starting the instant it is out, and is steady by the time it goes
 *  back in. */
const AIR_SPIN = 0.6;
/** It twists as it goes, the way a breaching humpback does: rolling onto its
 *  side over the top of the leap, belly to the lens, going back in on its
 *  side, and righting itself under water as it dives into the pose. */
const LEAP_ROLL = MathUtils.degToRad(35);
/** Where the entry line meets the opening pose's line: this far (units) up
 *  that line from the pose. The dive curves from one onto the other. */
const PLUNGE_CORNER = 3;
/** The climb to the surface, from where the way home ends: a climbing turn
 *  toward the lens, round onto the launch line. It sweeps through RUN_APEX
 *  heading RUN_APEX_DIR (most of the way round, still low) in curves whose
 *  turning builds and dies away, so it comes round before its nose comes up
 *  and does not corkscrew up the last of it. [x, y, z] */
const RUN_APEX = new Vector3(20.5, -9, -1.5);
const RUN_APEX_DIR = new Vector3(-0.3, 0.25, 0.9).normalize();
/** Distances back down the launch line from the exit point (units): the run
 *  is straight for its last stretch, so it leaves the water along the line. */
const RUN_LINE = [8, 5, 2.5];
/** Extra tail beat (Hz) on the climb: the flukes driving flat out. */
const CLIMB_BEAT = 0.1;
/** The stretch of the way home (units back from its end) the run is shaped
 *  through, so it leaves the way home smoothly; the nearer is also how far
 *  into the run what the shaping moved its start is let go over. */
const RUN_JOIN = [8, 4];
/** Most it swims on the way to its run (units/s), and the thrust of the run
 *  itself (units/s^2): a breaching humpback leaves the water at ~8 m/s. */
const LEAD_SPEED = 18;
const RUN_ACCEL = 7;

export interface ChoreographyFrame {
    /** 1 = scripted, 0 = physics (a switch, at HANDOFF). */
    weight: number;
    /** How fast it is swimming along the way it faces, units/s (0 when
     *  drifting back), for the physics whale to take over at. */
    speed: number;
    position: Vector3;
    quaternion: Quaternion;
    /** Euler YZX of `quaternion`, for re-seeding the physics. */
    yaw: number;
    pitch: number;
    roll: number;
    /** Playback rate for the baked swim clip. */
    tailSpeed: number;
    /** True while it is breaching its way home (THE LEAP). */
    breaching: boolean;
    /** True on the one frame the breach lands back in the water. */
    splashdown: boolean;
    /** Where it is on the outward route (vh, on its own clock), or -1 on the
     *  way home or breaching. */
    progress: number;
}

export interface StoryInput {
    /** Page scroll, vh. */
    scroll: number;
    dt: number;
    /** Clock, s. */
    time: number;
    aspect: number;
    /** The baked clip's stroke phase (radians; tail highest at pi/2), or
     *  null before the clip is playing. */
    strokePhase: number | null;
    /** The pose the whale was drawn at last frame (scripted, physics, or a
     *  blend of the two), so a breach can start from wherever it really is. */
    drawn?: { position: Vector3; quaternion: Quaternion };
    /** The water's mean level at the top of the page, in these coordinates. */
    surfaceY?: number;
}

export interface StorySwimmer {
    update(input: StoryInput): ChoreographyFrame;
}

const REST_Q = new Quaternion().setFromEuler(
    new Euler(C.heroRestBank, C.heroRestYaw, C.heroRestPitch, 'YZX'),
);

// --- Route construction (once, at load) --------------------------------------

interface Route {
    /** Positions every STEP units along the route. */
    xyz: Vector3[];
    length: number;
    /** Comfortable top speed at each sample, units/s. */
    limit: number[];
    /** Route length at each PACE_STEP of progress. */
    lengthAt: number[];
    /** Units per vh past the last mark. */
    endPace: number;
    /** Progress of the last mark, vh. */
    end: number;
}

/** Centripetal Catmull-Rom (alpha 0.5): no cusps or loops between marks. */
function centripetal(p0: Vector3, p1: Vector3, p2: Vector3, p3: Vector3, s: number, out: Vector3) {
    const t1 = Math.sqrt(p0.distanceTo(p1));
    const t2 = t1 + Math.sqrt(p1.distanceTo(p2));
    const t3 = t2 + Math.sqrt(p2.distanceTo(p3));
    const t = t1 + (t2 - t1) * s;
    const a1 = p0.clone().multiplyScalar((t1 - t) / t1).addScaledVector(p1, t / t1);
    const a2 = p1.clone().multiplyScalar((t2 - t) / (t2 - t1)).addScaledVector(p2, (t - t1) / (t2 - t1));
    const a3 = p2.clone().multiplyScalar((t3 - t) / (t3 - t2)).addScaledVector(p3, (t - t2) / (t3 - t2));
    const b1 = a1.multiplyScalar((t2 - t) / t2).addScaledVector(a2, t / t2);
    const b2 = a2.clone().multiplyScalar((t3 - t) / (t3 - t1)).addScaledVector(a3, (t - t1) / (t3 - t1));
    return out.copy(b1).multiplyScalar((t2 - t) / (t2 - t1)).addScaledVector(b2, (t - t1) / (t2 - t1));
}

function cumulative(points: Vector3[]): number[] {
    const c = [0];
    for (let i = 1; i < points.length; i++) c.push(c[i - 1] + points[i].distanceTo(points[i - 1]));
    return c;
}

/** Arc length at a fractional index into `c`. */
function atIndex(c: number[], f: number): number {
    const i = MathUtils.clamp(Math.floor(f), 0, c.length - 2);
    return MathUtils.lerp(c[i], c[i + 1], MathUtils.clamp(f - i, 0, 1));
}

/** Even STEP spacing along a polyline. */
function resample(points: Vector3[], c: number[]): Vector3[] {
    const total = c[c.length - 1];
    const out: Vector3[] = [];
    let j = 0;
    for (let s = 0; s <= total + 1e-9; s += STEP) {
        while (j < c.length - 2 && c[j + 1] < s) j++;
        const t = MathUtils.clamp((s - c[j]) / Math.max(1e-9, c[j + 1] - c[j]), 0, 1);
        out.push(points[j].clone().lerp(points[j + 1], t));
    }
    return out;
}

/** Gaussian blur along a sequence. `odd` extends the ends by point
 *  reflection, which pins them and keeps their direction (for a route);
 *  otherwise by mirroring, which conserves the integral (for speeds). */
function blur(values: number[], sigma: number, odd: boolean): number[] {
    const n = values.length;
    const r = Math.ceil(3 * sigma);
    const w: number[] = [];
    for (let k = -r; k <= r; k++) w.push(Math.exp((-k * k) / (2 * sigma * sigma)));
    const sum = w.reduce((a, b) => a + b, 0);
    const at = (i: number) => {
        if (i < 0) return odd ? 2 * values[0] - values[Math.min(n - 1, -i)] : values[Math.min(n - 1, -i - 1)];
        if (i >= n) {
            const m = 2 * (n - 1) - i;
            return odd ? 2 * values[n - 1] - values[Math.max(0, m)] : values[Math.max(0, m + 1)];
        }
        return values[i];
    };
    return values.map((_, i) => {
        let acc = 0;
        for (let k = -r; k <= r; k++) acc += at(i + k) * w[k + r];
        return acc / sum;
    });
}

/** The speed it can carry through the turn at each sample (circle through
 *  points a unit either side). */
function turnLimits(points: Vector3[]): number[] {
    const count = points.length;
    const limit: number[] = [];
    const ab = new Vector3();
    const ac = new Vector3();
    for (let k = 0; k < count; k++) {
        const a = points[Math.max(0, k - 4)];
        const b = points[k];
        const c = points[Math.min(count - 1, k + 4)];
        ab.subVectors(b, a);
        ac.subVectors(c, a);
        const twiceArea = ab.clone().cross(ac).length();
        const radius = twiceArea < 1e-9 ? Infinity : (ab.length() * ac.length() * b.distanceTo(c)) / (2 * twiceArea);
        limit.push(Math.min(TOP_SPEED, Math.sqrt(TURN_GRIP * radius)));
    }
    return limit;
}

/** The turn limits, eased along the route so it slows BEFORE a tight turn
 *  and gathers speed after it. */
function speedLimits(points: Vector3[]): number[] {
    const count = points.length;
    const limit = turnLimits(points);
    // Both routes start at a place it rests (the opening pose, the end of the
    // way home): it glides in to rest there, and gathers way gradually.
    for (let k = 0; k < count; k++) limit[k] = Math.min(limit[k], Math.sqrt(REST_SPEED ** 2 + 2 * REST_EASE * k * STEP));
    for (let k = 1; k < count; k++) limit[k] = Math.min(limit[k], Math.sqrt(limit[k - 1] ** 2 + 2 * PLAN_BRAKE * STEP));
    for (let k = count - 2; k >= 0; k--) limit[k] = Math.min(limit[k], Math.sqrt(limit[k + 1] ** 2 + 2 * PLAN_BRAKE * STEP));
    return limit;
}

/** A smooth path through `marks`, every STEP units, and how far along it each
 *  mark lies. `lead`, if given, is the direction it leaves the first mark in;
 *  otherwise the curve's own. It ends on the last mark, heading from the one
 *  before. */
function shapePath(marks: Vector3[], lead: Vector3 | null): { points: Vector3[]; markLength: number[] } {
    const n = marks.length;
    const ctrl = [
        lead
            ? marks[0].clone().addScaledVector(lead, -marks[0].distanceTo(marks[1]))
            : marks[0].clone().multiplyScalar(2).sub(marks[1]),
        ...marks,
        marks[n - 1].clone().multiplyScalar(2).sub(marks[n - 2]),
    ];

    const dense: Vector3[] = [];
    const markIndex: number[] = [];
    for (let i = 1; i < ctrl.length - 2; i++) {
        markIndex.push(dense.length);
        for (let k = 0; k < 128; k++) {
            dense.push(centripetal(ctrl[i - 1], ctrl[i], ctrl[i + 1], ctrl[i + 2], k / 128, new Vector3()));
        }
    }
    markIndex.push(dense.length);
    dense.push(marks[n - 1].clone());

    // Even spacing, then round the corners. Smoothing keeps each sample's
    // index, so a mark's place survives as a fractional index.
    const denseC = cumulative(dense);
    const even = resample(dense, denseC);
    const markAt = markIndex.map((i) => denseC[i] / STEP);
    const sigma = SHAPE_SIGMA / STEP;
    const xs = blur(even.map((p) => p.x), sigma, true);
    const ys = blur(even.map((p) => p.y), sigma, true);
    const zs = blur(even.map((p) => p.z), sigma, true);
    const smooth = xs.map((x, i) => new Vector3(x, ys[i], zs[i]));
    const smoothC = cumulative(smooth);
    const markLength = markAt.map((f) => atIndex(smoothC, f));
    const points = resample(smooth, smoothC);
    markLength[n - 1] = (points.length - 1) * STEP;
    return { points, markLength };
}

/** A route through `marks`, timed to the page. `lead` as in shapePath. */
function buildRoute(marksIn: Mark[], lead: Vector3 | null): Route {
    const n = marksIn.length;
    const { points, markLength } = shapePath(
        marksIn.map(([, x, y, z]) => new Vector3(x, y, z)),
        lead,
    );
    const length = (points.length - 1) * STEP;
    const limit = speedLimits(points);

    // Timing: each stretch between marks keeps its duration in scroll, and
    // the pace blends across the marks. Blurring shifts a little length from
    // one stretch into the next, so the per-stretch pace is corrected until
    // every mark is reached at its scroll position again.
    const S = marksIn.map(([s]) => s);
    const end = S[n - 1];
    const cells = Math.round(end / PACE_STEP);
    const cellStretch: number[] = [];
    for (let k = 0; k < cells; k++) {
        const s = (k + 0.5) * PACE_STEP;
        let i = 0;
        while (i < n - 2 && s > S[i + 1]) i++;
        cellStretch.push(i);
    }
    const want = markLength.slice(1).map((m, i) => m - markLength[i]);
    const pace = want.map((d, i) => d / (S[i + 1] - S[i]));
    const markCell = S.map((s) => Math.round(s / PACE_STEP));
    let speed: number[] = [];
    const lengthAt: number[] = [];
    for (let iter = 0; iter < 60; iter++) {
        speed = blur(cellStretch.map((i) => pace[i]), PACE_SIGMA / PACE_STEP, false);
        lengthAt.length = 0;
        lengthAt.push(0);
        for (let k = 0; k < cells; k++) lengthAt.push(lengthAt[k] + speed[k] * PACE_STEP);
        for (let i = 0; i < n - 1; i++) {
            const got = lengthAt[markCell[i + 1]] - lengthAt[markCell[i]];
            pace[i] *= want[i] / Math.max(1e-6, got);
        }
    }
    const scale = length / lengthAt[cells];
    for (let k = 0; k <= cells; k++) lengthAt[k] *= scale;

    return { xyz: points, length, limit, lengthAt, endPace: speed[cells - 1] * scale, end };
}

/** Route length (units) at progress `u` (vh). Past the last mark it runs on
 *  straight, so the handoff never sees the scripted whale stop. */
function lengthOn(r: Route, u: number): number {
    if (u <= 0) return 0;
    if (u >= r.end) return r.length + (u - r.end) * r.endPace;
    const f = u / PACE_STEP;
    const k = Math.floor(f);
    return MathUtils.lerp(r.lengthAt[k], r.lengthAt[k + 1], f - k);
}

/** Progress (vh) at which the route is `l` units long: lengthOn's inverse. */
function progressOn(r: Route, l: number): number {
    if (l <= 0) return 0;
    if (l >= r.length) return r.end + (l - r.length) / r.endPace;
    const t = r.lengthAt;
    let lo = 0;
    let hi = t.length - 1;
    while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (t[mid] <= l) lo = mid;
        else hi = mid;
    }
    return (lo + (l - t[lo]) / Math.max(1e-9, t[hi] - t[lo])) * PACE_STEP;
}

/** Comfortable top speed `l` units along the route (units/s). */
function limitOn(r: Route, l: number): number {
    const f = l / STEP;
    const last = r.limit.length - 1;
    if (f <= 0) return r.limit[0];
    if (f >= last) return TOP_SPEED;
    const i = Math.floor(f);
    return MathUtils.lerp(r.limit[i], r.limit[i + 1], f - i);
}

const edge = new Vector3();

/** Point `l` units along the route (linear past either end). */
function pointOn(r: Pick<Route, 'xyz'>, l: number, out: Vector3): Vector3 {
    const p = r.xyz;
    const last = p.length - 1;
    const f = l / STEP;
    if (f <= 0) return out.copy(p[0]).addScaledVector(edge.subVectors(p[1], p[0]), f);
    if (f >= last) return out.copy(p[last]).addScaledVector(edge.subVectors(p[last], p[last - 1]), f - last);
    const i = Math.floor(f);
    const t = f - i;
    // Uniform Catmull-Rom between table samples; past the ends the table
    // runs on straight, matching the extrapolation above.
    const b = p[i];
    const c = p[i + 1];
    const a = i > 0 ? p[i - 1] : edge.copy(b).multiplyScalar(2).sub(c);
    const d = i + 2 <= last ? p[i + 2] : edge.copy(c).multiplyScalar(2).sub(b);
    const t2 = t * t;
    const t3 = t2 * t;
    return out.set(
        0.5 * (2 * b.x + (c.x - a.x) * t + (2 * a.x - 5 * b.x + 4 * c.x - d.x) * t2 + (3 * b.x - a.x - 3 * c.x + d.x) * t3),
        0.5 * (2 * b.y + (c.y - a.y) * t + (2 * a.y - 5 * b.y + 4 * c.y - d.y) * t2 + (3 * b.y - a.y - 3 * c.y + d.y) * t3),
        0.5 * (2 * b.z + (c.z - a.z) * t + (2 * a.z - 5 * b.z + 4 * c.z - d.z) * t2 + (3 * b.z - a.z - 3 * c.z + d.z) * t3),
    );
}

const ahead = new Vector3();
const behind = new Vector3();

/** Unit direction of travel `l` units along the route. */
function directionOn(r: Pick<Route, 'xyz'>, l: number, lateral: number, out: Vector3): Vector3 {
    pointOn(r, l + CHORD, ahead);
    pointOn(r, l - CHORD, behind);
    out.subVectors(ahead, behind);
    out.x *= lateral;
    if (out.lengthSq() < 1e-10) out.set(1, 0, 0);
    return out.normalize();
}

/** The outward route. The first stretch leaves along the rest pose's nose,
 *  so the sounding really is the animal sliding down its own length. */
const OUTWARD = buildRoute(MARKS, new Vector3(1, 0, 0).applyQuaternion(REST_Q));

/** The way home. The loop is a route through HOME_MARKS and the pass; it is
 *  resampled by progress and eased onto the pass itself over HOME_MERGE
 *  (rounding a copied stretch would pull it inside the original). The table
 *  runs on past HOME_JOIN only so the chord has room. */
const HOME = (() => {
    const onOutward = (u: number) => pointOn(OUTWARD, lengthOn(OUTWARD, u), new Vector3());
    const draft = buildRoute(
        [
            ...HOME_MARKS,
            ...[1.55, 1.7, 1.85, 2.0].map((u): Mark => {
                const p = onOutward(u);
                return [u, p.x, p.y, p.z];
            }),
        ],
        null,
    );
    // Position at every PACE_STEP of progress, so the table's cumulative
    // length IS its timing.
    const cells = Math.round((HOME_JOIN + 0.45) / PACE_STEP);
    const track: Vector3[] = [];
    for (let k = 0; k <= cells; k++) {
        const u = k * PACE_STEP;
        const merge = MathUtils.smootherstep(u, HOME_MERGE[0], HOME_MERGE[1]);
        const glide = merge < 1 ? pointOn(draft, lengthOn(draft, u), new Vector3()) : null;
        const pass = merge > 0 ? onOutward(u) : null;
        track.push(glide && pass ? glide.lerp(pass, merge) : (glide ?? pass)!);
    }
    const lengthAt = cumulative(track);
    const points = resample(track, lengthAt);
    return {
        xyz: points,
        length: lengthAt[cells],
        limit: speedLimits(points),
        lengthAt,
        endPace: (lengthAt[cells] - lengthAt[cells - 1]) / PACE_STEP,
        end: cells * PACE_STEP,
    } satisfies Route;
})();

// --- The leap home ---------------------------------------------------------------

/**
 * THE LEAP. The way home ends deep on the right; from there the whale climbs
 * into a leap across the frame, right to left, twisting onto its side, and
 * dives into the opening pose. Built backwards from that pose: the dive runs
 * down the pose's own line (it ends exactly in it, flukes up), the entry is
 * where a slightly shallower line into that one meets the surface, the exit
 * is one ballistic range to the right of the entry, and the run is shaped to
 * leave the water along the launch line. Only the swim to the exit is a path;
 * the flight is gravity and the dive an ease into the pose, both on the clock.
 */
interface Leap {
    /** The swim to where it leaves the water, every STEP units. */
    path: Pick<Route, 'xyz'>;
    length: number;
    /** Speed planned at each sample (units/s). */
    plan: number[];
    /** Where on the way home the swim began (it follows the way home that
     *  far), or null for a whale that took the shortest way. */
    homeFrom: number | null;
    /** Horizontal distance from leaving the water to going back in. */
    range: number;
}

const REST_POS = new Vector3(MARKS[0][1], MARKS[0][2], MARKS[0][3]);
const REST_NOSE = new Vector3(1, 0, 0).applyQuaternion(REST_Q);
/** The leap heads the way the opening pose faces. */
const LEAP_HEADING = new Vector3(REST_NOSE.x, 0, REST_NOSE.z).normalize();
const LEAP_YAW = Math.atan2(-LEAP_HEADING.z, LEAP_HEADING.x);
/** The way it rolls (sign of the bank) to turn its belly to the lens. */
const LEAP_ROLL_SIDE = Math.cos(LEAP_YAW) < 0 ? 1 : -1;
const WORLD_UP = new Vector3(0, 1, 0);
/** Direction it leaves the water in. */
const LAUNCH = LEAP_HEADING.clone().multiplyScalar(Math.cos(LEAP_ANGLE)).addScaledVector(WORLD_UP, Math.sin(LEAP_ANGLE));
/** Where the entry line meets the opening pose's line. */
const PLUNGE_Q = REST_POS.clone().addScaledVector(REST_NOSE, -PLUNGE_CORNER);
/** Speeds out of the water (units/s) and time in the air (s) at full height. */
const LEAP_VY = Math.sqrt(2 * LEAP_GRAVITY * LEAP_HEIGHT);
const LEAP_SPEED = LEAP_VY / Math.sin(LEAP_ANGLE);
const LEAP_RANGE = (LEAP_SPEED * Math.cos(LEAP_ANGLE) * 2 * LEAP_VY) / LEAP_GRAVITY;
/** Where the way home ends, and the way it is swimming there. */
const HOME_END = pointOn(HOME, 0, new Vector3());
const HOME_END_DIR = directionOn(HOME, 0, 1, new Vector3()).negate();

/** Where the leap leaves the water, for a surface at `surface`. */
function exitPoint(surface: number): Vector3 {
    const rise = Math.max(0.5, surface - PLUNGE_Q.y);
    return PLUNGE_Q.clone()
        .addScaledVector(LEAP_HEADING, -rise / Math.tan(LEAP_ANGLE))
        .setY(surface)
        .addScaledVector(LEAP_HEADING, -LEAP_RANGE);
}

/** Marks about every 3 units along a quintic Hermite curve from `a`, leaving
 *  along `aDir`, to `b`, arriving along `bDir` (the ends themselves left
 *  out): its turning builds from nothing and dies away again, spread over
 *  its whole length. */
function hermiteMarks(a: Vector3, aDir: Vector3, b: Vector3, bDir: Vector3): Vector3[] {
    const span = a.distanceTo(b);
    const count = Math.max(2, Math.ceil(span / 3));
    const marks: Vector3[] = [];
    for (let i = 1; i < count; i++) {
        const s = i / count;
        const s3 = s * s * s;
        const s4 = s3 * s;
        const s5 = s4 * s;
        const toB = 10 * s3 - 15 * s4 + 6 * s5;
        marks.push(
            a
                .clone()
                .multiplyScalar(1 - toB)
                .addScaledVector(aDir, span * (s - 6 * s3 + 8 * s4 - 3 * s5))
                .addScaledVector(b, toB)
                .addScaledVector(bDir, span * (-4 * s3 + 7 * s4 - 3 * s5)),
        );
    }
    return marks;
}

/** The run to the surface: from the end of the way home, a climbing turn
 *  toward the lens and onto the launch line. */
function runMarks(exit: Vector3): Vector3[] {
    const [climb, ...line] = RUN_LINE.map((d) => exit.clone().addScaledVector(LAUNCH, -d));
    return [
        ...hermiteMarks(HOME_END, HOME_END_DIR, RUN_APEX, RUN_APEX_DIR),
        RUN_APEX.clone(),
        ...hermiteMarks(RUN_APEX, RUN_APEX_DIR, climb, LAUNCH),
        climb,
        ...line,
        exit,
    ];
}

/** The shortest way from anywhere to the run: a curve leaving along the way
 *  the whale is facing and arriving along the end of the way home, kept under
 *  the surface and off the lens. Marks for shapePath. */
function shortcutMarks(from: Vector3, facing: Vector3, surface: number): Vector3[] {
    const span = from.distanceTo(HOME_END);
    const k = MathUtils.clamp(span * 0.9, 4, 16);
    const count = Math.max(2, Math.ceil(span / 3));
    const marks: Vector3[] = [];
    for (let i = 0; i <= count; i++) {
        const s = i / count;
        const s2 = s * s;
        const s3 = s2 * s;
        const p = from
            .clone()
            .multiplyScalar(2 * s3 - 3 * s2 + 1)
            .addScaledVector(facing, k * (s3 - 2 * s2 + s))
            .addScaledVector(HOME_END, -2 * s3 + 3 * s2)
            .addScaledVector(HOME_END_DIR, k * (s3 - s2));
        if (i > 0) {
            p.y = Math.min(p.y, surface - 4);
            p.z = Math.min(p.z, 8);
        }
        marks.push(p);
    }
    return marks;
}

/** Plan the swim to the leap: speed limited by the turns, cruising on the
 *  way to the run, and building to the launch speed on it. */
function planLeap(points: Vector3[], runFrom: number, speed0: number, homeFrom: number | null): Leap {
    const cap = turnLimits(points).map((v, k) => Math.min(v, k * STEP < runFrom ? LEAD_SPEED : LEAP_SPEED));
    const plan = cap.slice();
    plan[0] = Math.min(cap[0], Math.max(speed0, 1.5));
    for (let k = 1; k < plan.length; k++) plan[k] = Math.min(cap[k], Math.sqrt(plan[k - 1] ** 2 + 2 * RUN_ACCEL * STEP));
    for (let k = plan.length - 2; k >= 0; k--) plan[k] = Math.min(plan[k], Math.sqrt(plan[k + 1] ** 2 + 2 * PLAN_BRAKE * STEP));
    return {
        path: { xyz: points },
        length: (points.length - 1) * STEP,
        plan,
        homeFrom,
        range: LEAP_RANGE,
    };
}

/** The leap for a whale `travelled` units along the way home: the rest of the
 *  way home, then the run. */
function leapFromHome(travelled: number, speed0: number, surface: number): Leap {
    const lead: Vector3[] = [];
    for (let l = travelled; l > 1e-6; l -= STEP) lead.push(pointOn(HOME, l, new Vector3()));
    // The run is shaped through the last of the way home and cut where it
    // ends, so it carries on along the way home's own line and curve (shaped
    // from the end alone, its rounding set off at an angle to it). What
    // little the rounding moved the end is let go over the first few units.
    const back = RUN_JOIN.map((l) => pointOn(HOME, l, new Vector3()));
    const shaped = shapePath(
        [...back, HOME_END.clone(), ...runMarks(exitPoint(surface))],
        directionOn(HOME, RUN_JOIN[0], 1, new Vector3()).negate(),
    );
    const run = shaped.points.slice(Math.round(shaped.markLength[back.length] / STEP));
    const miss = HOME_END.clone().sub(run[0]);
    run.forEach((p, k) => p.addScaledVector(miss, smootherstep(Math.max(0, 1 - (k * STEP) / RUN_JOIN[1]))));
    // Evenly spaced across the join, which falls between table samples.
    const joined = [...lead, ...run];
    const c = cumulative(joined);
    return planLeap(resample(joined, c), c[lead.length], speed0, travelled);
}

/** The leap for a whale anywhere else, facing `facing`. */
function leapFromAnywhere(from: Vector3, facing: Vector3, speed0: number, surface: number): Leap {
    const lead = shortcutMarks(from, facing, surface);
    const { points, markLength } = shapePath([...lead, ...runMarks(exitPoint(surface))], facing);
    return planLeap(points, markLength[lead.length - 1], speed0, null);
}

// --- Taking the whale back --------------------------------------------------------

/**
 * THE REJOIN. Past HANDOFF the physics whale has the animal, and swims it
 * wherever the projects' shots take it. When the page comes back into the
 * story, the story takes it back, and the whale is rarely where the route
 * is. Easing it across would slide it there sideways, so, like the leap's
 * shortcut, it swims there: a curve leaving along the way it faces and
 * arriving on the route, at the point nearest it between where the story
 * whale is and where the page wants it, heading on toward the page.
 */
interface Rejoin {
    /** The swim onto the route, every STEP units, and its planned speeds. */
    path: Pick<Route, 'xyz'>;
    length: number;
    plan: number[];
    /** Where on the outward route it arrives (units), and whether it is
     *  heading back down the route from there. */
    joinL: number;
    back: boolean;
}

function planRejoin(from: Vector3, facing: Vector3, joinL: number, back: boolean, speed0: number, speed1: number, surface: number): Rejoin {
    const to = pointOn(OUTWARD, joinL, new Vector3());
    const toDir = directionOn(OUTWARD, joinL, 1, new Vector3());
    if (back) toDir.negate();
    const span = from.distanceTo(to);
    const k = MathUtils.clamp(span * 0.9, 4, 16);
    const count = Math.max(2, Math.ceil(span / 3));
    const marks: Vector3[] = [];
    for (let i = 0; i <= count; i++) {
        const s = i / count;
        const s2 = s * s;
        const s3 = s2 * s;
        const p = from
            .clone()
            .multiplyScalar(2 * s3 - 3 * s2 + 1)
            .addScaledVector(facing, k * (s3 - 2 * s2 + s))
            .addScaledVector(to, -2 * s3 + 3 * s2)
            .addScaledVector(toDir, k * (s3 - s2));
        // Under the surface and off the lens on the way.
        if (i > 0 && i < count) {
            p.y = Math.min(p.y, surface - 4);
            p.z = Math.min(p.z, 8);
        }
        marks.push(p);
    }
    const { points } = shapePath(marks, facing);
    const cap = turnLimits(points).map((v) => Math.min(v, LEAD_SPEED));
    const plan = cap.slice();
    const last = plan.length - 1;
    plan[0] = Math.min(cap[0], Math.max(speed0, 1.5));
    for (let i = 1; i <= last; i++) plan[i] = Math.min(cap[i], Math.sqrt(plan[i - 1] ** 2 + 2 * RUN_ACCEL * STEP));
    plan[last] = Math.min(plan[last], Math.max(REST_SPEED, speed1));
    for (let i = last - 1; i >= 0; i--) plan[i] = Math.min(plan[i], Math.sqrt(plan[i + 1] ** 2 + 2 * PLAN_BRAKE * STEP));
    return { path: { xyz: points }, length: last * STEP, plan, joinL, back };
}

// --- The swimmer ---------------------------------------------------------------

const approach = (rate: number, dt: number) => 1 - Math.exp(-rate * dt);
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const smootherstep = (x: number) => x * x * x * (x * (x * 6 - 15) + 10);

export function createStorySwimmer(): StorySwimmer {
    const frame: ChoreographyFrame = {
        weight: 1,
        speed: 0,
        position: new Vector3(),
        quaternion: new Quaternion().copy(REST_Q),
        yaw: C.heroRestYaw,
        pitch: C.heroRestPitch,
        roll: C.heroRestBank,
        tailSpeed: REST_HZ / C.clipBaseHz,
        breaching: false,
        splashdown: false,
        progress: 0,
    };

    const dir = new Vector3();
    const up = new Vector3();
    const side = new Vector3();
    const from = new Vector3();
    const to = new Vector3();
    const shift = new Vector3();
    const fromDir = new Vector3();
    const toDir = new Vector3();
    const twist = new Quaternion();
    const swing = new Quaternion();
    const still = new Quaternion();
    const euler = new Euler(0, 0, 0, 'YZX');
    const pathQ = new Quaternion();
    const lifeQ = new Quaternion();

    let primed = false;
    /** Scroll after the soft onset. */
    let goal = 0;
    /** Which route it is on, how far along it (units), its speed along it
     *  (units/s, negative going back) and its acceleration. */
    let route = OUTWARD;
    let travelled = 0;
    let speed = 0;
    let thrust = 0;
    /** Turning round: where it is heading (0 along the route, 1 back along
     *  it), the linear progress of the turn, and which way it turns. */
    let turnTarget = 0;
    let turnT = 0;
    let turnSide = 1;

    let prevYaw: number | null = null;
    let turnRate = 0;
    let bank = 0;
    let hover = 1;
    let tailHz = REST_HZ;

    /** THE LEAP, while one is under way. */
    let leap: Leap | null = null;
    /** 0 swimming to the surface, 1 in the air, 2 diving into the pose. */
    let leapPhase = 0;
    /** Distance along the swim (units), and time into the air or the dive (s). */
    let leapL = 0;
    let leapT = 0;
    let leapSpeed = 0;
    let leapThrust = 0;
    /** Speed it left the water at, the gravity that carries it the range at
     *  that speed, and the bank it left with. */
    let leapV = LEAP_SPEED;
    let leapG = LEAP_GRAVITY;
    let leapBank = 0;
    const leapExit = new Vector3();
    const leapEntry = new Vector3();
    /** Where it was drawn when the leap began, less where the leap begins:
     *  carried and eased out, as with `shift` and `twist`. */
    const leapShift = new Vector3();
    const leapTwist = new Quaternion();
    /** Last frame's pose before life was added, and the drawn pose's speed. */
    const lastPos = new Vector3();
    const lastQ = new Quaternion().copy(REST_Q);
    const lastDrawn = new Vector3();
    let hasDrawn = false;
    let drawnSpeed = 0;

    /** Whether the story has the whale (not past HANDOFF, where the physics
     *  swims it), and THE REJOIN while one is under way: how far along it and
     *  how fast. */
    let storyHas = true;
    let rejoin: Rejoin | null = null;
    let rejoinL = 0;
    let rejoinSpeed = 0;
    let rejoinThrust = 0;

    /** Move onto `next`, `nextLength` along it. Along most of the pass the
     *  routes are one; any difference (where the loop eases onto the pass)
     *  is carried in `shift` and `twist` and eased out, so the body never
     *  jumps. */
    const switchTo = (next: Route, nextLength: number) => {
        pointOn(route, travelled, from);
        directionOn(route, travelled, 1, fromDir);
        travelled = nextLength;
        pointOn(next, travelled, to);
        directionOn(next, travelled, 1, toDir);
        shift.add(from.sub(to));
        twist.multiply(swing.setFromUnitVectors(toDir, fromDir));
        route = next;
    };

    /** Bank into the turn, from how fast it is actually turning. */
    const bankFor = (yaw: number, dt: number) => {
        const rate = prevYaw === null ? 0 : wrap(yaw - prevYaw) / dt;
        prevYaw = yaw;
        turnRate += (MathUtils.clamp(rate, -4, 4) - turnRate) * approach(BANK_RESPONSE * 2, dt);
        const wantBank = MathUtils.clamp(-turnRate * BANK_GAIN, -MAX_BANK, MAX_BANK);
        bank += (wantBank - bank) * approach(BANK_RESPONSE, dt);
    };

    /** Begin `next`, from the pose the whale was last drawn in (route space:
     *  x not yet compressed for the screen). */
    const beginLeap = (next: Leap, at: Vector3, atQ: Quaternion) => {
        leap = next;
        leapPhase = 0;
        leapL = 0;
        leapT = 0;
        leapThrust = 0;
        leapShift.copy(at).sub(next.path.xyz[0]);
        directionOn(next.path, 0, 1, dir);
        euler.set(bank, Math.atan2(-dir.z, dir.x), MathUtils.clamp(Math.asin(dir.y), -MAX_PITCH, MAX_PITCH), 'YZX');
        leapTwist.copy(atQ).multiply(pathQ.setFromEuler(euler).invert());
        prevYaw = null;
    };

    /** The leap is over: it is in the opening pose, at the start of the
     *  outward route, facing down it. */
    const endLeap = () => {
        leap = null;
        route = OUTWARD;
        travelled = 0;
        speed = 0;
        thrust = 0;
        turnTarget = 0;
        turnT = 0;
        prevYaw = null;
        turnRate = 0;
        bank = 0;
        shift.set(0, 0, 0);
        twist.identity();
    };

    return {
        update({ scroll, dt: rawDt, time, aspect, strokePhase, drawn, surfaceY }) {
            const dt = MathUtils.clamp(rawDt, 1e-4, 0.05);
            const target = MathUtils.clamp(scroll, 0, HOLD);
            const surface = surfaceY ?? SURFACE_Y;
            const lateral = MathUtils.clamp(aspect / (16 / 9), 0.35, 1);
            if (!primed) {
                primed = true;
                goal = target;
                travelled = lengthOn(route, target);
            }
            if (drawn) {
                if (hasDrawn) {
                    const v = drawn.position.distanceTo(lastDrawn) / dt;
                    drawnSpeed += (Math.min(v, TOP_SPEED) - drawnSpeed) * approach(6, dt);
                }
                lastDrawn.copy(drawn.position);
                hasDrawn = true;
            }
            goal += (target - goal) * approach(ONSET_RATE, dt);

            // THE LEAP HOME — the page back at the top, the whale still out on
            // the story. From the way home (once it has turned to swim it) it
            // follows the way home to its end; from far out on the outward
            // route, or from the physics whale past the story, it takes the
            // shortest way. Close in on the outward route it swims its dive
            // back instead (TURN_TOP).
            if (!leap && target <= BREACH_AT) {
                const out = route === OUTWARD && progressOn(OUTWARD, travelled) > HOME_JOIN + SHORTCUT_PAST;
                if ((route === HOME && turnT > 0.9) || out) {
                    // From where it was drawn: its own pose, or the physics
                    // whale's while that one had the frame.
                    const own = frame.weight > 0.999 || !drawn;
                    const pose = own || !drawn ? { position: lastPos, quaternion: lastQ } : drawn;
                    const at = from.copy(pose.position);
                    at.x /= lateral;
                    const atQ = pose.quaternion;
                    const v0 = own ? (rejoin ? rejoinSpeed : Math.abs(speed)) : drawnSpeed;
                    rejoin = null;
                    storyHas = true;
                    if (route === HOME) {
                        beginLeap(leapFromHome(travelled, v0, surface), at, atQ);
                    } else {
                        const facing = dir.set(1, 0, 0).applyQuaternion(atQ);
                        facing.x /= lateral;
                        beginLeap(leapFromAnywhere(at, facing.normalize().clone(), v0, surface), at, atQ);
                    }
                    leapSpeed = v0;
                }
            }
            // Called off: the page went back down while it was still on the
            // way home, before its run. It is on the way home again.
            if (leap && leapPhase === 0 && leap.homeFrom !== null && target > BREACH_CANCEL && leapL < leap.homeFrom - STEP) {
                route = HOME;
                travelled = leap.homeFrom - leapL;
                speed = -leapSpeed;
                thrust = -leapThrust;
                shift.copy(leapShift);
                twist.identity();
                turnTarget = 1;
                turnT = 1;
                leap = null;
            }

            // THE REJOIN — the page back in the story while the physics whale
            // has the animal. The story takes it back; unless it is already
            // at its place on the route, it swims there.
            if (!storyHas && !leap && goal < HANDOFF) {
                storyHas = true;
                const own = pointOn(OUTWARD, travelled, to).add(shift);
                own.x *= lateral;
                if (drawn && drawn.position.distanceTo(own) > REJOIN_FROM) {
                    const at = from.copy(drawn.position);
                    at.x /= lateral;
                    const facing = dir.set(1, 0, 0).applyQuaternion(drawn.quaternion);
                    facing.x /= lateral;
                    facing.normalize();
                    // Onto the route where it is nearest, between the story
                    // whale and where the page wants it.
                    const goalL = lengthOn(OUTWARD, goal);
                    const lo = Math.min(goalL, travelled);
                    const hi = Math.max(goalL, travelled);
                    let joinL = hi;
                    let nearest = Infinity;
                    for (let l = lo; l <= hi + 1e-6; l += 1) {
                        const d = pointOn(OUTWARD, l, to).distanceToSquared(at);
                        if (d < nearest) {
                            nearest = d;
                            joinL = l;
                        }
                    }
                    const back = goalL < joinL || (goalL === joinL && goalL < travelled);
                    const arrive = Math.min(limitOn(OUTWARD, joinL), Math.sqrt(2 * PLAN_BRAKE * Math.abs(goalL - joinL)));
                    rejoin = planRejoin(at, facing.clone(), joinL, back, drawnSpeed, arrive, surface);
                    rejoinL = 0;
                    rejoinSpeed = rejoin.plan[0];
                    rejoinThrust = 0;
                    prevYaw = null;
                    turnRate = 0;
                    bank = 0;
                }
            }

            let settle: number;
            let swim: number;
            let swimAccel: number;
            let moving: number;
            let airborne = false;
            /** 0..1, how steeply it is climbing to the surface. */
            let drive = 0;
            let splashdown = false;
            let u = 0;
            if (leap) {
                const L: Leap = leap;
                const ease = approach(ROUTE_EASE, dt);
                leapShift.multiplyScalar(1 - ease);
                leapTwist.slerp(still, ease);
                settle = 1;

                // 1. THE SWIM TO THE SURFACE: speed follows the plan, and it
                // leaves the water at whatever speed it has built.
                let rest = 0;
                let entered = false;
                if (leapPhase === 0) {
                    const steps = Math.ceil(dt * 240);
                    const h = dt / steps;
                    const before = leapSpeed;
                    for (let i = 0; i < steps; i++) {
                        const f = MathUtils.clamp(leapL / STEP, 0, L.plan.length - 1);
                        const k = Math.min(Math.floor(f), L.plan.length - 2);
                        const want = MathUtils.lerp(L.plan[k], L.plan[k + 1], f - k);
                        leapSpeed += MathUtils.clamp(want - leapSpeed, -1.5 * PLAN_BRAKE * h, RUN_ACCEL * h);
                        leapL += leapSpeed * h;
                        if (leapL >= L.length) {
                            rest = (steps - i - 1) * h + (leapL - L.length) / Math.max(leapSpeed, 1e-3);
                            break;
                        }
                    }
                    leapThrust += ((leapSpeed - before) / dt - leapThrust) * approach(8, dt);
                    if (leapL >= L.length) {
                        leapPhase = 1;
                        leapT = rest;
                        entered = true;
                        pointOn(L.path, L.length, leapExit);
                        // The range is fixed by where it has to land; a slower
                        // exit just floats it (never much: see planLeap).
                        leapV = Math.max(leapSpeed, 0.75 * LEAP_SPEED);
                        leapG = (leapV * leapV * Math.sin(2 * LEAP_ANGLE)) / L.range;
                        leapBank = bank;
                        leapEntry.copy(leapExit).addScaledVector(LEAP_HEADING, L.range);
                    }
                }
                if (leapPhase === 0) {
                    pointOn(L.path, leapL, frame.position);
                    directionOn(L.path, leapL, 1, dir);
                    const yaw = Math.atan2(-dir.z, dir.x);
                    bankFor(yaw, dt);
                    euler.set(bank, yaw, MathUtils.clamp(Math.asin(dir.y), -MAX_PITCH, MAX_PITCH), 'YZX');
                    swim = leapSpeed;
                    swimAccel = leapThrust;
                    moving = leapSpeed;
                    drive = MathUtils.smoothstep(dir.y, 0.3, 0.8);
                } else {
                    if (!entered) leapT += dt;
                    const vh = leapV * Math.cos(LEAP_ANGLE);
                    const vy = leapV * Math.sin(LEAP_ANGLE);
                    const flight = L.range / vh;
                    if (leapPhase === 1 && leapT >= flight) {
                        leapPhase = 2;
                        leapT -= flight;
                        splashdown = true;
                    }
                    if (leapPhase === 1) {
                        // 2. THE FLIGHT: gravity on the body's centre; the
                        // nose turns over partly along the arc, partly at
                        // the steady spin it left the water with, and the
                        // body twists onto its side over the top.
                        const t = leapT;
                        const p = Math.min(1, t / flight);
                        frame.position
                            .copy(leapExit)
                            .addScaledVector(LEAP_HEADING, vh * t)
                            .addScaledVector(WORLD_UP, vy * t - 0.5 * leapG * t * t);
                        const alongArc = Math.atan2(vy - leapG * t, vh);
                        const spun = LEAP_ANGLE * (1 - 2 * p * p * (2 - p));
                        const roll = LEAP_ROLL_SIDE * LEAP_ROLL * MathUtils.smootherstep(p, 0.1, 0.9);
                        const b = MathUtils.lerp(leapBank, C.heroRestBank, smootherstep(p)) + roll;
                        euler.set(b, LEAP_YAW, MathUtils.lerp(alongArc, spun, AIR_SPIN), 'YZX');
                        swim = Math.hypot(vh, vy - leapG * t);
                        swimAccel = 0;
                        moving = swim;
                        airborne = true;
                        turnRate *= 1 - approach(BANK_RESPONSE, dt);
                    } else {
                        // 3. THE DIVE: in along the entry line and round onto
                        // the opening pose's own, slowing to a stop in it.
                        // Its spin carries the nose on down to the pose's
                        // pitch, and the water stops it there; the twist
                        // comes off as it slows.
                        const t = leapT;
                        const toCorner = PLUNGE_Q.distanceTo(leapEntry);
                        const plunge = (6 * toCorner) / leapV;
                        const x = Math.min(1, t / plunge);
                        const s = 1 - (1 - x) ** 3;
                        frame.position
                            .copy(leapEntry)
                            .multiplyScalar((1 - s) * (1 - s))
                            .addScaledVector(PLUNGE_Q, 2 * s * (1 - s))
                            .addScaledVector(REST_POS, s * s);
                        const spin = MathUtils.lerp(
                            -(leapG * vh) / (leapV * leapV),
                            (-2 * LEAP_ANGLE) / flight,
                            AIR_SPIN,
                        );
                        const pitchLeft = C.heroRestPitch + LEAP_ANGLE;
                        const settleTime = MathUtils.clamp((2 * pitchLeft) / Math.min(-1e-3, spin), 0.25, plunge);
                        const y = Math.min(1, t / settleTime);
                        euler.set(
                            C.heroRestBank + LEAP_ROLL_SIDE * LEAP_ROLL * (1 - smootherstep(x)),
                            LEAP_YAW,
                            -LEAP_ANGLE + pitchLeft * (1 - (1 - y) ** 2),
                            'YZX',
                        );
                        const pace = 3 * (1 - x) ** 2 / plunge;
                        swim = pace * 2 * Math.hypot(
                            (1 - s) * (PLUNGE_Q.x - leapEntry.x) + s * (REST_POS.x - PLUNGE_Q.x),
                            (1 - s) * (PLUNGE_Q.y - leapEntry.y) + s * (REST_POS.y - PLUNGE_Q.y),
                            (1 - s) * (PLUNGE_Q.z - leapEntry.z) + s * (REST_POS.z - PLUNGE_Q.z),
                        );
                        swimAccel = -3;
                        moving = swim;
                        settle = 1 - s;
                        turnRate *= 1 - approach(BANK_RESPONSE, dt);
                        if (x >= 1) endLeap();
                    }
                }
                frame.position.add(leapShift);
                frame.position.x *= lateral;
                frame.quaternion.setFromEuler(euler).premultiply(leapTwist);
            } else if (rejoin) {
                // THE REJOIN: the swim onto the route, at the planned speed.
                const R: Rejoin = rejoin;
                const steps = Math.ceil(dt * 240);
                const h = dt / steps;
                const before = rejoinSpeed;
                for (let i = 0; i < steps && rejoinL < R.length; i++) {
                    const f = MathUtils.clamp(rejoinL / STEP, 0, R.plan.length - 1);
                    const k = Math.min(Math.floor(f), R.plan.length - 2);
                    const want = MathUtils.lerp(R.plan[k], R.plan[k + 1], f - k);
                    rejoinSpeed += MathUtils.clamp(want - rejoinSpeed, -1.5 * PLAN_BRAKE * h, RUN_ACCEL * h);
                    rejoinL = Math.min(R.length, rejoinL + rejoinSpeed * h);
                }
                rejoinThrust += ((rejoinSpeed - before) / dt - rejoinThrust) * approach(8, dt);
                pointOn(R.path, rejoinL, frame.position);
                directionOn(R.path, rejoinL, lateral, dir);
                const yaw = Math.atan2(-dir.z, dir.x);
                bankFor(yaw, dt);
                euler.set(bank, yaw, MathUtils.clamp(Math.asin(dir.y), -MAX_PITCH, MAX_PITCH), 'YZX');
                frame.quaternion.setFromEuler(euler);
                frame.position.x *= lateral;
                settle = 1;
                swim = rejoinSpeed;
                swimAccel = rejoinThrust;
                moving = rejoinSpeed;
                u = progressOn(OUTWARD, R.joinL);
                if (rejoinL >= R.length) {
                    // On the route, facing the way the page wants it: it
                    // swims on along it from here.
                    route = OUTWARD;
                    travelled = R.joinL;
                    speed = R.back ? -rejoinSpeed : rejoinSpeed;
                    thrust = 0;
                    turnTarget = R.back ? 1 : 0;
                    turnT = turnTarget;
                    shift.set(0, 0, 0);
                    twist.identity();
                    rejoin = null;
                }
            } else {
                // 1. PROGRESS — the page says where on the route it should be;
                // the animal swims there, with mass, and no faster than it could.
                const gap = lengthOn(route, goal) - travelled;
                // Its back to where it has to go (not yet turned, or still
                // turning): it drifts, it does not reverse.
                const facing = Math.cos(Math.PI * smootherstep(turnT));
                const willing = MathUtils.smoothstep(facing * Math.sign(gap), -0.3, 0.6);
                // The comfortable speed here and a moment ahead (its thrust
                // takes that long to answer), eased off while it is still
                // coming round.
                const comfortable =
                    Math.min(limitOn(route, travelled), limitOn(route, travelled + speed * LOOK_AHEAD)) *
                    (1 - TURNING_SLOW * Math.sin(Math.PI * smootherstep(turnT)));
                // Catching up is done on the straights, not by taking turns faster.
                const catchUp =
                    Math.min(MAX_CATCH_UP, CATCH_UP_GAIN * Math.max(0, Math.abs(gap) - CATCH_UP_AFTER)) *
                    (comfortable / TOP_SPEED) ** 2;
                const cap = MathUtils.lerp(BACK_DRIFT, comfortable + catchUp, willing);
                // Arcing over into the opening pose (see TURN_TOP) is keyed to
                // where it is on the route, so it has to slow down to do it
                // well. Read a few units ahead in the direction it is going,
                // allowing for the braking it can do before it gets there.
                let arcCap = Infinity;
                if (route === OUTWARD && turnT > 0) {
                    const fade = (at: number) =>
                        MathUtils.smoothstep(progressOn(OUTWARD, at), TURN_TOP[0], TURN_TOP[1]);
                    const along = Math.sign(gap);
                    for (let d = 0; d <= 6; d += 1.5) {
                        const at = travelled + along * d;
                        const slope = Math.abs(fade(at + 0.5) - fade(at - 0.5));
                        const there = ARC_RATE / (Math.PI * smootherstep(turnT) * slope + 1e-6);
                        arcCap = Math.min(arcCap, Math.sqrt(there * there + 2 * PLAN_BRAKE * d));
                    }
                }
                const want =
                    Math.sign(gap) *
                    Math.min(cap, arcCap, CHASE_GAIN * Math.abs(gap), Math.sqrt(2 * PLAN_BRAKE * Math.abs(gap)));
                const goalLength = travelled + gap;
                const steps = Math.ceil(dt * 240);
                const h = dt / steps;
                for (let i = 0; i < steps; i++) {
                    // Braking harder than usual when that is what it takes to
                    // stop where the page did (after a jump, or stepping onto
                    // the shorter way home at speed): flippers out, flukes
                    // flared.
                    const toGo = (goalLength - travelled) * Math.sign(speed);
                    const stop = toGo > 0 ? (speed * speed) / (2 * Math.max(0.05, toGo)) : 0;
                    const brake = MathUtils.clamp(stop * 1.25, MAX_ACCEL, MAX_BRAKE);
                    const wantThrust = MathUtils.clamp(
                        (want - speed) * SPEED_GAIN,
                        speed > 0 ? -brake : -MAX_ACCEL,
                        speed < 0 ? brake : MAX_ACCEL,
                    );
                    thrust += (wantThrust - thrust) * approach(THRUST_RATE, h);
                    speed += thrust * h;
                    travelled += speed * h;
                }
                if (travelled < 0) {
                    travelled = 0;
                    speed = Math.max(0, speed);
                    thrust = Math.max(0, thrust);
                }
                u = progressOn(route, travelled);

                // Onto the way home wherever it is swimming back along the
                // close pass; back onto the outward route past the join going
                // the other way.
                if (route === OUTWARD && speed < 0 && u <= HOME_JOIN && u >= PASS_START) {
                    switchTo(HOME, lengthOn(HOME, u));
                } else if (route === HOME && u > HOME_JOIN) {
                    switchTo(OUTWARD, lengthOn(OUTWARD, u));
                }
                u = progressOn(route, travelled);
                const ease = approach(ROUTE_EASE, dt);
                shift.multiplyScalar(1 - ease);
                twist.slerp(still, ease);
                const l = travelled;
                const lat =
                    route === OUTWARD
                        ? MathUtils.lerp(
                              lateral,
                              1,
                              MathUtils.smoothstep(u, SWIM_BY[0] - SWIM_BY_EASE, SWIM_BY[0]) *
                                  (1 - MathUtils.smoothstep(u, SWIM_BY[1], SWIM_BY[1] + SWIM_BY_EASE)),
                          )
                        : lateral;
                // The opening pose is the start of the outward route only; the
                // way home starts (ends) deep on the right, where it breaches.
                const atRest = route === OUTWARD && u <= REST_BLEND[0];

                // 2. WHICH WAY IT FACES — the page going back a good way turns
                // it round to follow; a nudge does not.
                const heading = turnTarget ? -1 : 1;
                if (-gap * heading > TURN_AFTER && (route !== OUTWARD || u > REST_BLEND[0] + 0.02)) {
                    turnTarget = 1 - turnTarget;
                }
                if (atRest) {
                    // At the opening pose any turn has resolved (see TURN_TOP
                    // and THE LEAP), so it starts the next dive facing
                    // down-route.
                    turnTarget = 0;
                    turnT = 0;
                    prevYaw = null;
                }
                turnT = MathUtils.clamp(turnT + ((turnTarget ? 1 : -1) * dt) / TURN_TIME, 0, 1);
                settle = route === OUTWARD ? MathUtils.smoothstep(u, REST_BLEND[0], REST_BLEND[1]) : 1;
                const topFade = route === OUTWARD ? MathUtils.smoothstep(u, TURN_TOP[0], TURN_TOP[1]) : 1;
                const turned = smootherstep(turnT) * topFade;

                // 3. ATTITUDE — along the route, turned round by `turned`.
                directionOn(route, l, lat, dir).applyQuaternion(twist);
                const routeYaw = Math.atan2(-dir.z, dir.x);
                const routePitch = MathUtils.clamp(Math.asin(dir.y), -MAX_PITCH, MAX_PITCH);
                pointOn(route, l, frame.position).add(shift);
                frame.position.x *= lat;
                if (turned < 1e-3 || turned > 1 - 1e-3) {
                    // Between turns, pick the side the next one will take:
                    // away from the lens (a nose swung at the camera fills the
                    // frame), then toward the middle of the frame.
                    const score = (s: number) => {
                        const mid = routeYaw + (s * Math.PI) / 2;
                        return Math.sin(mid) - 0.4 * Math.sign(frame.position.x) * Math.cos(mid);
                    };
                    turnSide = score(1) >= score(-1) ? 1 : -1;
                }
                const yaw = routeYaw + turnSide * Math.PI * turned;
                const pitch = routePitch * Math.cos(Math.PI * turned);
                bankFor(yaw, dt);

                euler.set(bank, yaw, pitch, 'YZX');
                pathQ.setFromEuler(euler);
                frame.quaternion.copy(REST_Q).slerp(pathQ, settle);

                // Speed and thrust along the way it faces: negative is
                // drifting back or braking, which the flukes do not power.
                const forward = Math.cos(Math.PI * turned);
                swim = speed * forward;
                swimAccel = thrust * forward;
                moving = Math.abs(speed);
            }
            lastPos.copy(frame.position);
            lastQ.copy(frame.quaternion);

            // 4. TAIL — speed and effort drive the beat; a coast stills it,
            // and in the air the flukes have nothing to push on.
            let hz = MathUtils.lerp(REST_HZ, HOVER_HZ, settle);
            hz += (MAX_HZ - hz) * (1 - Math.exp(-Math.max(0, swim) / TAIL_SPEED_REF));
            hz += MathUtils.clamp(swimAccel * TAIL_ACCEL_HZ, 0, 0.12);
            hz += CLIMB_BEAT * drive;
            hz += Math.min(0.15, Math.abs(turnRate) * TAIL_TURN_HZ);
            const coasting = airborne ? 1 : MathUtils.smoothstep(-swimAccel, 0.4, 2.5);
            const drifting = MathUtils.smoothstep(-swim, 0.2, 1.5);
            hz = MathUtils.lerp(hz, GLIDE_HZ, Math.max(0.75 * coasting, 0.85 * drifting));
            const next = MathUtils.lerp(tailHz, hz, approach(TAIL_RESPONSE, dt));
            tailHz += MathUtils.clamp(next - tailHz, -TAIL_SLEW * dt, TAIL_SLEW * dt);
            frame.tailSpeed = tailHz / C.clipBaseHz;

            // 5. LIFE — heave and nod locked to the stroke the clip is showing,
            // and a slow hang and sway that fades in once it stops.
            hover += (1 - MathUtils.smoothstep(moving, 0.3, 3) - hover) * approach(1.5, dt);
            const vigour = MathUtils.smoothstep(tailHz, GLIDE_HZ, 0.3);
            let heave = 0;
            let nod = 0;
            if (strokePhase !== null) {
                const wave = (psi: number) => Math.sin(psi + UPSTROKE_BIAS * Math.sin(psi));
                // As the flukes rise the body sinks a little and the nose dips
                // (the clip's own head recoil, carried through the whole body).
                heave = -STROKE_HEAVE * vigour * wave(strokePhase);
                nod = -STROKE_NOD * vigour * wave(strokePhase + HEAD_LEAD);
            }
            const sway = 0.35 + 0.65 * hover;
            euler.set(
                Math.sin(time * 0.19 + 1.1) * 0.035 * sway,
                (Math.sin(time * 0.23) * 0.03 + Math.sin(time * 0.61 + 2) * 0.01) * sway,
                Math.sin(time * 0.31 + 0.7) * 0.02 * sway + nod,
                'YZX',
            );
            lifeQ.setFromEuler(euler);
            frame.quaternion.multiply(lifeQ);
            up.set(0, 1, 0).applyQuaternion(frame.quaternion);
            side.set(0, 0, 1).applyQuaternion(frame.quaternion);
            frame.position
                .addScaledVector(up, heave + Math.sin(time * 0.47 + 1.3) * 0.2 * hover)
                .addScaledVector(side, Math.sin(time * 0.31) * 0.16 * hover);

            // The physics whale takes the animal at HANDOFF on the way out, and
            // keeps it until the page comes back into the story.
            if (storyHas && !rejoin && !leap && route === OUTWARD && u >= HANDOFF && goal >= HANDOFF) {
                storyHas = false;
            }
            frame.weight = storyHas || leap ? 1 : 0;
            frame.speed = Math.max(0, swim);
            frame.breaching = leap !== null;
            frame.splashdown = splashdown;
            frame.progress = leap === null && route === OUTWARD ? u : -1;
            euler.setFromQuaternion(frame.quaternion, 'YZX');
            frame.roll = euler.x;
            frame.yaw = euler.y;
            frame.pitch = euler.z;
            return frame;
        },
    };
}
