import gsap from 'gsap';
import { MotionPathPlugin } from 'gsap/MotionPathPlugin';
import { Euler, MathUtils, Quaternion, Vector3 } from 'three';
import { WHALE_CONFIG as C } from './whaleConfig';

gsap.registerPlugin(MotionPathPlugin);

/**
 * Whale locomotion model. Pure math — no React, no R3F, no scene graph.
 *
 * The whole thing rests on one rule: the whale travels along the direction its
 * body is pointing. Nothing is positioned directly. Scroll sets a depth the
 * whale wants to reach, the whale pitches to reach it, and the pitch is what
 * carries it down. Dive arcs, level-offs and overshoot all fall out of that
 * loop rather than being keyframed.
 *
 * Body convention: the model's nose runs along local +X and its back along
 * local +Y. With Euler order YZX that makes rotation about Z the pitch axis and
 * rotation about X the roll axis, and it keeps pitch meaning "nose up" for
 * positive values no matter which way the whale is currently facing.
 */

const TAU = Math.PI * 2;
const FORWARD = new Vector3(1, 0, 0);
const UP = new Vector3(0, 1, 0);

/**
 * What the director ASKS the whale for. Never what the whale IS.
 *
 * Nothing here sets a position, a rotation or a velocity. Every field is a
 * request the locomotion loop is free to satisfy late, satisfy partly, or — in
 * the case of the cues below — decline outright. That is the whole contract:
 * the director composes a shot, and the body decides how to get into it.
 *
 * The moment this becomes a set of values copied onto the whale, every
 * comment in this file stops being true.
 */
export interface WhaleIntent {
    /** World Y the whale should want to reach. Replaces the linear
     *  scroll-to-depth map. The animator still lags it and still gets there by
     *  pitching, so the dive is the same arc it always was. */
    targetDepth: number;
    /** Staging offset along world Z. Negative recedes. Framing only — it never
     *  feeds back into the physics. Apparent size is 4/(4 + this), which bites
     *  hard; see the note on `stageZRange` in whaleConfig. */
    stageZ: number;
    /** Multiplier on the cruise tail beat. The only honest way to change when
     *  the whale arrives somewhere: it strokes harder, and speed follows from
     *  the stroke exactly as it does during a burst. */
    effort: number;
}

export interface WhaleFrameInput {
    /** Seconds since the previous frame. */
    dt: number;
    /** Seconds since the clock started, for the wander waves. */
    elapsed: number;
    scrollY: number;
    /** Total scrollable distance, i.e. scrollHeight - innerHeight. */
    maxScroll: number;
    /** Used to make scroll speed resolution-independent. */
    viewportHeight: number;
    /** True while the user is actively scrolling. Supplied by GSAP
     *  ScrollTrigger, which accounts for momentum and smooth-scrolling; a bare
     *  velocity threshold flickers during the tail of a flick. Omit it and the
     *  animator falls back to its own velocity estimate. */
    scrollActive?: boolean;
    /** Optional composed shot. Omit it and the animator falls back to the
     *  linear scroll-to-depth map, unchanged — the same idiom `scrollActive`
     *  already uses. Keeping that fallback exact is what lets this model still
     *  be driven headlessly by nothing but a scroll number. */
    intent?: WhaleIntent;
    /** 0..1 strength of a click burst. 1 (or omitted) is the full lunge as
     *  tuned; lower values give a slower wind-up and a weaker stroke. Used to
     *  make the animal heavier the deeper it is — a tired half-stroke in the
     *  abyss — without reshaping the envelope, whose tuning is load-bearing. */
    burstScale?: number;
}

export interface WhaleFrameOutput {
    /** Final render position. Mutated in place — copy it, do not retain it. */
    position: Vector3;
    /** Final render orientation. Mutated in place. */
    quaternion: Quaternion;
    /** Playback rate to hand to the baked swim clip. */
    tailSpeed: number;
    visible: boolean;
    /** 0 to 1 as the whale emerges from the depths, for dressing the scene. */
    revealFactor: number;
    /** Physics position: no stroke heave, no staging offset. The director
     *  steers against this rather than against `position`, so the tail wobble
     *  cannot feed back into its decisions. Mutated in place. */
    core: Vector3;
    /** -1 swimming toward -X, +1 toward +X. Lets the director see whether a
     *  turn request was actually taken instead of assuming it was. */
    heading: number;
    /** True while a turn is still in progress. */
    turning: boolean;
}

export interface WhaleAnimator {
    update(input: WhaleFrameInput): WhaleFrameOutput;
    /** Fire a one-shot lunge. Calling it again mid-burst restarts the stroke. */
    triggerBurst(): void;
    /** Start the emergence. Call once, the moment the model is ready. */
    beginReveal(): void;
    /** Ask for a sounding arch.
     *
     *  A REQUEST, not a command. It is queued with a short life and fires only
     *  on a frame where the body would have wanted to arch anyway: real
     *  outstanding downward depth error, and out of its refractory period. A
     *  whale that arches while swimming level reads as a puppet, which is the
     *  one failure this whole model exists to avoid. */
    requestArch(): void;
    /** Ask the whale to come back the other way before it reaches `turnX`.
     *
     *  Also a request. Ignored mid-turn, inside the turn refractory period, or
     *  while the whale is too near the middle of frame — a 180 taken dead
     *  centre reads as a pivot rather than as a manoeuvre. */
    requestTurn(direction: -1 | 1): void;
    /** Hand the body to an outside choreographer for this frame.
     *
     *  While the story section scrubs the whale along a scripted path (see
     *  `whaleChoreography.ts`), its physics state is re-seeded to that path
     *  every frame. When the choreography then eases out, the physics picks up
     *  from exactly where the scripted whale is, facing the way it faces, so
     *  the handoff cannot jump. Position is the displayed position, including
     *  the staging offset. `motion` hands over how fast it is swimming (units/s
     *  along its heading) and its tail beat (Hz) too: without them the physics
     *  whale takes over at cruise, stopping dead out of a fast swim. */
    follow(
        position: Vector3,
        yaw: number,
        pitch: number,
        roll: number,
        motion?: { speed: number; tailHz: number },
    ): void;
}

const clamp = MathUtils.clamp;

/** Frame-rate independent approach factor for a first-order lag. */
const approach = (rate: number, dt: number) => 1 - Math.exp(-rate * dt);

/**
 * The entrance's own curved targets — built once, sampled every frame the
 * reveal is still running.
 *
 * These are NOT a substitute for the locomotion model: the physics (pitch,
 * thrust, drag) still does the actual swimming, exactly as it does for the
 * scroll-driven descent. What differs during the reveal is only which target
 * it's chasing — a scripted rise-surge-dive curve instead of the usual
 * scroll-derived one — the same "shape the target, physics does the rest"
 * pattern `diveDirector` uses between stations, applied here to one scripted
 * beat instead of many scroll-keyed ones.
 *
 * Sampled with a LOCAL, dt-accumulated progress (`revealT` below), never via
 * GSAP's own ticker/timeline autoplay: this whole model is a pure function of
 * `update(dt)`, called from React's frame loop and, in the headless sims,
 * from a synthetic loop with no real clock at all. A live GSAP timeline ticks
 * in wall-clock time regardless of who's calling `update()`, which would
 * break both. `MotionPathPlugin`'s static sampling utilities are just curve
 * math here — no timeline, no autoplay.
 *
 * Neither curve needs to land exactly on the real hero depth/stageZ at t=1:
 * `update()` crossfades from the curve to whatever the real scroll-derived
 * target is over the curve's last stretch (see `revealHandoff` below), so the
 * curve only has to be dramatic, not numerically exact — the blend is what
 * guarantees no pop at handoff, matching the pattern the camera director
 * already uses to hand off from its own scripted moments.
 */
const revealDepthPath = (() => {
    const path = MotionPathPlugin.getRawPath(
        `M0,${C.revealDeepStartDepth} C0.3,${C.revealDeepStartDepth * 0.4} ${C.revealSmashAt},${C.revealEntryDepth} ${C.revealSmashAt},${C.revealEntryDepth} S0.85,${C.revealEntryDepth * 0.3} 1,-2`,
    );
    MotionPathPlugin.cacheRawPathMeasurements(path);
    return path;
})();

const revealStageZPath = (() => {
    const path = MotionPathPlugin.getRawPath(
        `M0,${C.revealZOffset} C0.3,${C.revealZOffset * 0.3} ${C.revealSmashAt},${C.revealPeakStageZ} ${C.revealSmashAt},${C.revealPeakStageZ} S0.85,${C.revealPeakStageZ * 0.2} 1,0`,
    );
    MotionPathPlugin.cacheRawPathMeasurements(path);
    return path;
})();

/** World-Y depth target at reveal progress `t` (0..1): deep -> near-surface
 *  peak (at `revealSmashAt`) -> settling back down, roughly hero-depth. */
const revealDepth = (t: number) => MotionPathPlugin.getPositionOnPath(revealDepthPath, t).y;

/** Z staging offset at reveal progress `t`: deep behind -> a surge past the
 *  resting stageZ, closer to the camera than the whale ever gets again ->
 *  back toward 0 (the normal per-shot `stageZ` provides the rest). */
const revealStageZ = (t: number) => MotionPathPlugin.getPositionOnPath(revealStageZPath, t).y;

/** Fraction of the reveal, from this point on, spent blending FROM the
 *  scripted curve TO the real scroll-derived target rather than fully
 *  committed to the curve. Starting the blend before t=1 (rather than
 *  switching instantaneously) is what makes the handoff invisible. */
const REVEAL_HANDOFF_FROM = 0.75;

/** 0 while the curve is fully in control, ramping to 1 by t=1. */
const revealHandoff = (t: number) =>
    MathUtils.smoothstep(t, REVEAL_HANDOFF_FROM, 1);

export function createWhaleAnimator(): WhaleAnimator {
    // Allocated once. Nothing in update() creates an object.
    const core = new Vector3(0, 0, 0);
    const render = new Vector3(0, 0, C.revealZOffset);
    const quaternion = new Quaternion();
    const euler = new Euler(0, 0, 0, 'YZX');
    const forward = new Vector3();
    const up = new Vector3();

    const output: WhaleFrameOutput = {
        position: render,
        quaternion,
        tailSpeed: 1,
        visible: false,
        revealFactor: 0,
        core,
        heading: 1,
        turning: false,
    };

    let speed = C.cruiseSpeed;
    let tailHz = C.cruiseTailHz;
    let strokePhase = 0;

    let pitch = 0;
    let yaw = 0;
    let targetYaw = 0;
    let heading = 1;
    let bankRoll = 0;
    /** Current turn rate, eased rather than applied instantly. */
    let yawRateCurrent = 0;

    let burstActive = false;
    let burstAge = 0;
    let burstEnergy = 0;
    /** 0 = powering, 1 = coasting. A blend, never a switch. */
    let glideBlend = 0;

    let archImpulse = 0;
    let archCooldown = 0;
    /** Seconds of life left on a pending external arch request. */
    let archRequest = 0;

    /** Pending external turn: the heading asked for, and how long the ask
     *  stays valid. A request that cannot be honoured in time simply lapses;
     *  it is never held until it can be forced through. */
    let turnRequest = 0;
    let turnRequestTTL = 0;
    let turnCooldown = 0;

    /** 0 = page is still, 1 = actively scrolling. */
    let scrollEngage = 0;

    // The lag that used to sit on scroll PROGRESS now sits on the two things
    // progress fed: the depth the whale wants, and its staging offset. For the
    // fallback path that is arithmetically identical — a first-order lerp
    // commutes with the linear scale applied to it, and all three start at
    // zero — so an animator driven without a director behaves exactly as it
    // did. For the director it is the part that matters: a station change is
    // a step input, and this lag is what stops the whale being yanked.
    let smoothY = 0;
    let smoothStageZ = 0;
    let lastScrollY = 0;
    let scrollVel = 0;
    let scrollPrimed = false;

    // Fade-in only (opacity/rays/etc via revealFactor) — decoupled from
    // POSITION, which the hero-rest block below now owns entirely. Still
    // triggered once, from WhaleModel's mount effect.
    let revealing = false;
    let revealT = 0;

    // --- Hero rest / return-to-top entrance ---------------------------------
    // The hero opens frozen at a fixed pose (see `HERO` in diveScore.ts for
    // the depth/stageZ; pitch/bank are `heroRestPitch`/`heroRestBank` below)
    // and only starts swimming once the visitor scrolls. Scoped to the hero
    // only: once the whale has ever left the top, ordinary scroll-driven
    // swimming applies everywhere else on the page, untouched by any of this.
    /** True while parked at rest: no integration runs at all — every frame
     *  just mirrors the current (already-settled) state onto the output. */
    let heroFrozen = true;
    /** Whether the rest pose has been placed at its real depth/stage yet —
     *  gates the very first placement, which needs a composed shot to know
     *  where "rest" actually is. */
    let restPlaced = false;
    /** Whether the whale has EVER actually left the top. Distinguishes the
     *  first frame ever (start frozen, no flourish) from a later return to
     *  scroll 0 (also ends frozen, but only after the entrance replays). */
    let hasLeftTop = false;
    let atTopPrev = true;

    /** Whether the scripted rise-surge-dive curve is currently driving the
     *  depth/stage target. Never true on the initial load any more — only a
     *  return to the top (after having left it) starts it, as the "welcome
     *  back" flourish. */
    let entranceActive = false;
    let entranceT = 0;
    /** Whether this run of the entrance has already fired its tail-smash. */
    let entranceSmashed = false;

    // Shared by the public triggerBurst() and the scripted entrance smash
    // below, so both start a stroke exactly the same way.
    const startBurst = () => {
        burstActive = true;
        burstAge = 0;
        // glideBlend is deliberately NOT reset. Clicking mid-coast eases
        // back into power from wherever the blend currently sits, instead
        // of snapping to full thrust.
    };

    // Mirrors the current (frozen) state onto the output. Used both for the
    // early-return while parked and for the moment freezing resumes, so both
    // write the exact same shape from the exact same source of truth.
    const writeFrozenOutput = (revealEase: number) => {
        render.copy(core);
        render.z += smoothStageZ;
        output.position.copy(render);
        output.quaternion.copy(quaternion);
        output.tailSpeed = 0;
        output.visible = revealing;
        output.revealFactor = revealEase;
        output.core.copy(core);
        output.heading = heading;
        output.turning = false;
        return output;
    };

    return {
        triggerBurst() {
            startBurst();
        },

        beginReveal() {
            revealing = true;
        },

        requestArch() {
            archRequest = C.archRequestTTL;
        },

        requestTurn(direction) {
            turnRequest = direction;
            turnRequestTTL = C.turnRequestTTL;
        },

        follow(position, followYaw, followPitch, followRoll, motion) {
            core.set(position.x, position.y, position.z - smoothStageZ);
            if (motion) {
                // Faster than its stroke can hold, drag brings it down to
                // cruise: it coasts out of the story's swim.
                speed = Math.max(C.minSpeed, motion.speed);
                tailHz = motion.tailHz;
            }
            smoothY = core.y;
            yaw = followYaw;
            targetYaw = followYaw;
            pitch = followPitch;
            bankRoll = followRoll;
            yawRateCurrent = 0;
            // Heading is the sign of travel along X, which is what the turn
            // logic reasons about; derived from yaw rather than trusted.
            heading = Math.cos(followYaw) >= 0 ? 1 : -1;
            // The choreography owns the opening: none of the hero-rest or
            // return-to-top machinery may fight it or replay behind it.
            heroFrozen = false;
            restPlaced = true;
            hasLeftTop = true;
            entranceActive = false;
            euler.set(bankRoll, yaw, pitch, 'YZX');
            quaternion.setFromEuler(euler);
        },

        update(input: WhaleFrameInput): WhaleFrameOutput {
            // Ceiling stops a tab-refocus delta from teleporting the whale.
            // Floor matters just as much: two frames inside the same millisecond
            // give a delta of zero, and the scroll-velocity divide below would
            // turn every downstream value into NaN for the rest of the session.
            const dt = Math.max(1e-4, Math.min(input.dt, C.maxDelta));

            // 1. REVEAL ENVELOPE — fade only now (see the state block above).
            if (revealing && revealT < 1) {
                revealT = Math.min(1, revealT + dt / C.revealDuration);
            }
            const revealEase = 1 - Math.pow(1 - revealT, 3);

            // 2. SCROLL SAMPLING
            // First frame only establishes a baseline, so a deep-linked load
            // does not read as one enormous downward scroll.
            if (!scrollPrimed) {
                lastScrollY = input.scrollY;
                scrollPrimed = true;
            }
            const rawVel = (input.scrollY - lastScrollY) / dt;
            lastScrollY = input.scrollY;
            scrollVel = MathUtils.lerp(scrollVel, rawVel, approach(6, dt));
            /** Scroll speed in viewport-heights per second, so the arch
             *  triggers identically on a phone and on a 4K monitor. */
            const scrollVelNorm = scrollVel / Math.max(1, input.viewportHeight);

            const scrollProgress =
                input.maxScroll > 0 ? clamp(input.scrollY / input.maxScroll, 0, 1) : 0;

            // Two sources, one path. A director hands over a world Y and a
            // staging offset; with no director, both fall back to the original
            // linear map from page scroll.
            const intent = input.intent;

            // --- HERO REST / RETURN-TO-TOP ENTRANCE ----------------------
            // First-ever placement: straight to rest (no curve, no swim-in —
            // the hero opens already parked on its fixed pose, tilt and all).
            // Only runs once, as soon as a composed shot is available.
            if (!restPlaced && intent) {
                restPlaced = true;
                core.set(C.heroRestX, intent.targetDepth, 0);
                smoothY = intent.targetDepth;
                smoothStageZ = intent.stageZ;
                pitch = C.heroRestPitch;
                bankRoll = C.heroRestBank;
                yaw = C.heroRestYaw;
                targetYaw = C.heroRestYaw;
                heading = C.heroRestHeading;
                euler.set(bankRoll, yaw, pitch, 'YZX');
                quaternion.setFromEuler(euler);
            }

            const atTop = input.scrollY <= C.heroRestScrollEps;
            if (!atTop) {
                hasLeftTop = true;
                heroFrozen = false;
            }

            // Returning to the top — but only once the whale has actually
            // left it, so this never fires on the initial load. Resets to
            // the SAME deep-start point the very first visit would use and
            // replays the whole rise-surge-smash-dive curve, rather than
            // silently retracing the descent in reverse.
            if (atTop && !atTopPrev && hasLeftTop) {
                core.set(C.revealEntryX, C.revealDeepStartDepth, 0);
                if (intent) {
                    smoothY = intent.targetDepth;
                    smoothStageZ = intent.stageZ;
                }
                entranceActive = true;
                entranceT = 0;
                entranceSmashed = false;
                heroFrozen = false;
            }
            atTopPrev = atTop;

            if (heroFrozen) {
                // Parked: no integration at all. Mirrors whatever state the
                // last snap (above, or the re-freeze at the end of this
                // function) left behind straight onto the output.
                return writeFrozenOutput(revealEase);
            }

            // The entrance curve's own clock — separate from the fade-in
            // timer above, since this now only ever runs for the
            // return-to-top flourish, never for the initial load.
            if (entranceActive && entranceT < 1) {
                entranceT = Math.min(1, entranceT + dt / C.revealDuration);
            }

            // The entrance tail-smash: one shot, timed to land exactly at the
            // curve's near-surface, closest-to-camera peak (see `revealDepth`/
            // `revealStageZ` below) rather than at a fixed delay, so it still
            // lands correctly if the frame rate stutters.
            if (entranceActive && !entranceSmashed && entranceT >= C.revealSmashAt) {
                entranceSmashed = true;
                startBurst();
            }
            const follow = approach(C.depthFollowRate, dt);
            const realWantY = intent ? intent.targetDepth : -scrollProgress * C.depthRange;
            const wantStageZ = intent ? intent.stageZ : -scrollProgress * C.stageZRange;
            // During the entrance, the depth-seeking pitch below chases the
            // scripted rise-surge-dive curve instead of the real scroll-
            // derived target — physics still does the swimming, only the
            // target is scripted. `revealHandoff` blends the curve OUT and
            // the real target IN over the curve's last stretch, so there is
            // no jump at the exact frame the entrance ends.
            const wantY =
                entranceActive && entranceT < 1
                    ? MathUtils.lerp(revealDepth(entranceT), realWantY, revealHandoff(entranceT))
                    : realWantY;
            smoothY = MathUtils.lerp(smoothY, wantY, follow);
            smoothStageZ = MathUtils.lerp(smoothStageZ, wantStageZ, follow);
            const effort = intent
                ? clamp(intent.effort, C.minEffort, C.maxEffort)
                : 1;

            // Burst strength. At 1 both values are exactly the configured
            // ones, so an omitted scale leaves the lunge untouched. Lower, the
            // wind-up lengthens and the peak beat drops — but never below
            // half, or a click in the deep stops reading as a response at all.
            const burstScale = clamp(input.burstScale ?? 1, 0, 1);
            const attack = C.burstAttack / MathUtils.lerp(0.6, 1, burstScale);
            const burstPeakHz = MathUtils.lerp(C.burstTailHz * 0.55, C.burstTailHz, burstScale);

            // 2b. SCROLL ENGAGEMENT
            // Prefer the signal ScrollTrigger gives us; fall back to our own
            // velocity estimate when it is not supplied (tests, SSR).
            const active =
                input.scrollActive !== undefined
                    ? input.scrollActive
                    : Math.abs(scrollVelNorm) > 0.05;
            scrollEngage = MathUtils.lerp(
                scrollEngage,
                active ? 1 : 0,
                approach(C.scrollEngageRate, dt),
            );

            // 3. BURST ENVELOPE (click)
            if (burstActive) {
                burstAge += dt;
                if (burstAge < attack) {
                    // Wind-up. Smoothstep, not a linear ramp: it leaves zero
                    // slope at both ends, so the surge has no corner at the
                    // start and none where it hands over to the decay.
                    const a = burstAge / attack;
                    burstEnergy = a * a * (3 - 2 * a);
                } else {
                    burstEnergy = Math.exp(-(burstAge - attack) / C.burstTau);
                }

                // The burst is over once the stroke is spent AND the whale has
                // coasted back down to cruise. Checking both means it never
                // ends mid-glide with speed still bleeding off.
                //
                // The attack guard is essential: the eased ramp starts below
                // 0.02, so without it a burst would satisfy every end condition
                // on its own first frame and cancel itself.
                if (
                    burstAge > attack &&
                    burstEnergy < 0.02 &&
                    glideBlend < 0.05 &&
                    speed <= C.cruiseSpeed * 1.08
                ) {
                    burstActive = false;
                    burstEnergy = 0;
                }
            }

            // Coast once the stroke is spent but the whale is still carrying
            // speed. Updated every frame, not just during a burst, so it always
            // relaxes back to powered swimming.
            const wantGlide =
                burstActive && burstEnergy < C.glideThreshold && speed > C.cruiseSpeed * 1.05
                    ? 1
                    : 0;
            glideBlend = MathUtils.lerp(glideBlend, wantGlide, approach(C.glideBlendRate, dt));
            /** Nose-down coil, peaking mid wind-up and gone by the power stroke. */
            const coil =
                burstActive && burstAge < attack
                    ? -Math.sin((burstAge / attack) * Math.PI) * C.burstCoil
                    : 0;

            // 4. DEPTH SEEKING — something picks a depth, pitch is how we get there
            const depthError = smoothY - core.y;

            archCooldown -= dt;
            archRequest = Math.max(0, archRequest - dt);
            // The refractory period belongs to the ANIMAL, not to whatever
            // asked, so a scroll-fired arch and a director-requested one share
            // it. The depth-error gate is shared for the same reason: a request
            // means "arch on the way down", never "arch in open mid-water".
            if (
                (scrollVelNorm > C.archScrollThreshold || archRequest > 0) &&
                depthError < -C.archDepthThreshold &&
                archCooldown <= 0
            ) {
                archImpulse = 1;
                archCooldown = C.archCooldown;
                archRequest = 0;
            }
            archImpulse *= Math.exp(-dt / C.archTau);

            let desiredPitch = Math.atan(depthError * C.pitchGain);
            desiredPitch = clamp(desiredPitch, -C.maxDivePitch, C.maxSurfacePitch);
            // Commit to the dive attitude only while the page is actually
            // moving. When it stops the whale relaxes toward level and swims on
            // calmly; it keeps the depth it reached rather than snapping back.
            //
            // The entrance is the one exception: it is a scripted rise, surge
            // and dive that a visitor who has not touched the page yet cannot
            // supply `scrollEngage` for, and without full commitment idle
            // damping would flatten the whole curve into a barely-there wobble.
            const pitchCommit = entranceActive && entranceT < 1 ? 1 : scrollEngage;
            desiredPitch *= MathUtils.lerp(C.idlePitchScale, 1, pitchCommit);
            // The peduncle arch overshoots the steering angle briefly. This is
            // the sharp back-arch a humpback makes just before it sounds.
            desiredPitch -= archImpulse * C.archPitch;
            desiredPitch = clamp(
                desiredPitch,
                -C.maxDivePitch - C.archPitch,
                C.maxSurfacePitch,
            );

            // Rate limiting the pitch is what makes the dive an arc.
            const pitchStep = C.pitchRate * dt;
            pitch += clamp(desiredPitch - pitch, -pitchStep, pitchStep);

            // 5. TAIL BEAT — the only input to thrust
            // Effort scales the CRUISE beat only. Speed then follows from the
            // stroke through `strokeDistance`, and the drag equilibrium moves
            // with it — so a whale asked to hurry visibly works harder rather
            // than simply sliding faster through the water.
            const cruiseTail = C.cruiseTailHz * effort;
            let poweredTail = cruiseTail + burstEnergy * (burstPeakHz - cruiseTail);
            poweredTail += archImpulse * C.archTailBoost;
            // Driving downward against buoyancy costs effort.
            poweredTail += scrollEngage * Math.max(0, -pitch) * C.diveTailBoost;
            poweredTail += (1 - revealEase) * C.revealTailBoost;

            // Crossfade to still flukes as the whale settles into a coast.
            const targetTail = MathUtils.lerp(poweredTail, C.glideTailHz, glideBlend);

            // First-order response, then a hard rate cap. The cap is what keeps
            // the clip's playback rate from stepping; see `tailRateLimit`.
            const desiredTail = MathUtils.lerp(tailHz, targetTail, approach(C.tailResponse, dt));
            const tailStep = C.tailRateLimit * dt;
            tailHz += clamp(desiredTail - tailHz, -tailStep, tailStep);

            strokePhase = (strokePhase + tailHz * TAU * dt) % TAU;

            // 6. SPEED — driven up by the stroke, brought back down by drag.
            const targetSpeed = tailHz * C.strokeDistance;

            // Thrust only ever ADDS speed. A whale that stops fluking coasts;
            // it does not reverse its flukes to brake. Letting thrust pull
            // downward is what collapsed the glide: the whale was back at
            // cruise before it had finished coasting.
            //
            // The kink this leaves where deficit crosses zero is deliberate:
            // fading thrust in over a band around the crossing smooths it, but
            // it also lets speed drift past the target, which moves the cruise
            // equilibrium off its configured value and costs burst peak. The
            // kink is worth ~0.5% of cruise speed per frame, so it is invisible.
            const thrust = Math.max(0, targetSpeed - speed) * approach(C.accelRate, dt);

            // Drag does the decelerating. It scales in as the whale exceeds the
            // speed its current stroke can sustain, and again as it settles
            // into a coast, so cruise sits at exact equilibrium: no drag, no
            // thrust.
            //
            // `over` stays LINEAR on purpose. Easing it (smoothstep) kills the
            // restoring force for small overshoots, and since thrust is zero
            // above target, nothing then pulls speed back down: cruise parks
            // ~8% fast. Linear gives a proper spring back to the target.
            const over = clamp((speed - targetSpeed) / Math.max(0.2, targetSpeed), 0, 1);
            // Smooth union rather than max(), which kinks where the two cross.
            const dragScale = over + glideBlend - over * glideBlend;
            speed += thrust - C.dragCoeff * speed * speed * dt * dragScale;
            speed = Math.max(speed, C.minSpeed);

            // 7. TURNING — a banked arc, not a snap
            //
            // External requests are considered first, but only once the whale
            // is settled on its current heading. Re-aiming mid-arc makes the
            // yaw error jump, and the eased yaw rate then reads as a stutter.
            // The automatic turn at `turnX` below is left exactly as it was:
            // it is the safety net that keeps the whale in the frame whatever
            // anyone asks of it.
            turnCooldown -= dt;
            turnRequestTTL -= dt;
            const settled = Math.abs(targetYaw - yaw) < C.turnSettledEps;
            if (
                turnRequestTTL > 0 &&
                settled &&
                turnCooldown <= 0 &&
                turnRequest !== heading &&
                Math.abs(core.x) > C.turnMinX
            ) {
                heading = turnRequest;
                targetYaw = heading === 1 ? 0 : Math.PI;
                turnCooldown = C.turnCooldown;
                turnRequestTTL = 0;
            }

            if (heading === 1 && core.x > C.turnX) {
                heading = -1;
                targetYaw = Math.PI;
            } else if (heading === -1 && core.x < -C.turnX) {
                heading = 1;
                targetYaw = 0;
            }
            // Proportional, rate-limited, and eased. Running the yaw at a flat
            // rate and stopping dead on arrival is what made the old turn read
            // as a pivot: curvature appeared and vanished in a single frame.
            // Now the whale builds into the arc, holds it, and straightens out
            // as it lines up, the way something with mass actually turns.
            const yawErr = targetYaw - yaw;
            const desiredYawRate = clamp(yawErr * C.yawApproach, -C.yawRate, C.yawRate);
            yawRateCurrent = MathUtils.lerp(
                yawRateCurrent,
                desiredYawRate,
                approach(C.yawRateResponse, dt),
            );
            yaw += yawRateCurrent * dt;
            const yawRateActual = yawRateCurrent;

            // 8. ORIENTATION
            const t = input.elapsed;
            const wanderYaw =
                Math.sin(t * 0.17) * C.wanderYaw + Math.sin(t * 0.29 + 1.3) * C.wanderYaw * 0.6;
            const wanderRoll =
                Math.sin(t * 0.13 + 0.7) * C.wanderRoll + Math.sin(t * 0.23) * C.wanderRoll * 0.5;

            // Roll follows the turn through a lag. Reading the yaw rate
            // directly snapped the whale upright the instant a turn finished.
            const targetBank =
                clamp(-yawRateActual * C.bankGain, -C.maxBank, C.maxBank) +
                burstEnergy * C.burstBank;
            bankRoll = MathUtils.lerp(bankRoll, targetBank, approach(C.bankResponse, dt));
            const bank = bankRoll;
            const counterPitch = Math.sin(strokePhase + Math.PI / 2) * C.counterPitchAmp;

            // Lane keeping. A 180-degree turn is a half-circle in XZ, so it
            // leaves the whale a turn-diameter off its z=0 lane, and without a
            // correction that error stacks up every turn until the whale is
            // lost in the distance. Bias the nose back instead of moving the
            // body, so it swims back into the lane rather than sliding there.
            // The sign depends on which way the whale faces: at yaw 0 it needs
            // the opposite correction it needs at yaw pi. Use cos(yaw), NOT the
            // discrete `heading` flag, which flips in a single frame and would
            // snap the bias from one extreme to the other. cos also passes
            // smoothly through zero mid-turn, which is correct: a whale cannot
            // correct its lane while it is busy turning.
            // A wide turn is a half-circle, so it leaves the whale a turn
            // DIAMETER off its lane — 5 units here. Correcting that gently
            // would take longer than the straight, so the whale would re-enter
            // the frame sitting back and looking small. Instead it corrects
            // hard while it is off screen, where the crab cannot be seen, and
            // only subtly once it is back in view.
            const offScreen = clamp((Math.abs(core.x) - C.laneKeepFreeX) / 3, 0, 1);
            const laneMax = MathUtils.lerp(C.laneKeepMax, C.laneKeepMaxOffscreen, offScreen);
            const laneBias = clamp(core.z * C.laneKeepGain * Math.cos(yaw), -laneMax, laneMax);

            euler.set(
                bank + wanderRoll,
                yaw + wanderYaw + laneBias,
                pitch + counterPitch + coil,
                'YZX',
            );
            quaternion.setFromEuler(euler);

            // 9. POSITION — travel along the heading, never along a world axis
            forward.copy(FORWARD).applyQuaternion(quaternion);
            core.addScaledVector(forward, speed * dt);

            // 10. RENDER POSITION — spine plus stroke heave plus staging
            up.copy(UP).applyQuaternion(quaternion);
            render.copy(core).addScaledVector(up, Math.sin(strokePhase) * C.heaveAmp);
            // The entrance's Z staging: deep behind, a surge past the resting
            // stageZ toward the camera, then back to 0 — this curve decays to
            // 0 by t=1 on its own, so it needs no separate handoff blend the
            // way the depth target above does.
            render.z += smoothStageZ + (entranceActive && entranceT < 1 ? revealStageZ(entranceT) : 0);

            if (entranceActive && entranceT >= 1) {
                entranceActive = false;
            }

            // Back at the top, with the entrance (if any) fully settled and
            // no burst still playing: re-park at rest. A clean snap — the
            // exact position AND the deliberate static tilt, heading reset
            // square — rather than however the physics happened to leave the
            // animal, so the hero always settles on the same pose it opened
            // on, whatever route it took to get back here.
            if (atTop && !entranceActive && !burstActive) {
                heroFrozen = true;
                core.set(C.heroRestX, intent ? intent.targetDepth : core.y, 0);
                smoothStageZ = intent ? intent.stageZ : smoothStageZ;
                yaw = C.heroRestYaw;
                targetYaw = C.heroRestYaw;
                yawRateCurrent = 0;
                heading = C.heroRestHeading;
                pitch = C.heroRestPitch;
                bankRoll = C.heroRestBank;
                speed = C.cruiseSpeed;
                tailHz = C.cruiseTailHz;
                strokePhase = 0;
                euler.set(bankRoll, yaw, pitch, 'YZX');
                quaternion.setFromEuler(euler);
                return writeFrozenOutput(revealEase);
            }

            output.tailSpeed = clamp(
                tailHz / C.clipBaseHz,
                C.minTimeScale,
                C.maxTimeScale,
            );
            output.visible = revealing;
            output.revealFactor = revealEase;
            output.heading = heading;
            output.turning = Math.abs(targetYaw - yaw) >= C.turnSettledEps;
            return output;
        },
    };
}
