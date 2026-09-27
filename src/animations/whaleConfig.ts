/**
 * Every tunable number for the whale's locomotion lives here.
 *
 * The model is a humpback: a thunniform swimmer that gets all of its thrust from
 * vertical (dorso-ventral) tail strokes. That single fact drives the whole model —
 * the whale cannot accelerate without fluking, and it cannot stop without drag.
 *
 * Units: world units for distance, seconds for time, radians for angles, Hz for
 * tail beat.
 *
 * SIZING: the mesh scale lives in WhaleModel.tsx (currently 0.0045). If you
 * change it, scale every length-based constant here by the same factor, or the
 * gait breaks: tail beat is coupled to distance through `strokeDistance`, so a
 * longer body covering the same ground per stroke visibly slips. The ones that
 * scale are `cruiseSpeed`, `strokeDistance`, `minSpeed`, `heaveAmp`, `turnX`,
 * and `dragCoeff` inversely. Angular values do not scale.
 */

const DEG = Math.PI / 180;

export const WHALE_CONFIG = {
    // --- Frame safety -------------------------------------------------------
    /** Delta clamp. Tab-refocus can hand us a multi-second delta that would
     *  teleport the whale across the scene in one integration step. */
    maxDelta: 0.05,

    // --- Cruise gait --------------------------------------------------------
    /** Relaxed tail beat, as SEEN: the baked clip beats at exactly this rate
     *  at timeScale 1 (see `clipBaseHz`). Real humpbacks cruise around
     *  0.2–0.4 Hz; this sits at the slow end because this whale cruises slowly
     *  for its ~21-unit length, and a faster beat would cover too little
     *  ground per stroke and read as slipping. Here a stroke carries it ~0.3
     *  body lengths. */
    cruiseTailHz: 0.175,
    /** Resulting cruise speed, in world units per second. */
    cruiseSpeed: 1.13,
    /** Distance covered per complete tail stroke. Derived as cruiseSpeed /
     *  cruiseTailHz, so changing either of the two above should update this.
     *  This is what couples thrust to the tail. */
    strokeDistance: 6.42,
    /** Floor so the whale never fully stalls mid-scene. */
    minSpeed: 0.23,

    // --- Thrust and drag ----------------------------------------------------
    /** How briskly speed chases the tail beat. Still a lag — 30 tonnes does not
     *  change pace instantly — but fast enough that a burst actually lands
     *  inside its own envelope rather than decaying before the body responds. */
    accelRate: 2.2,
    /** Quadratic drag, blended in as the whale settles into a glide. Scales
     *  INVERSELY with body size, so a 1.5x whale needs 0.45/1.5, keeping the
     *  coast the same length in seconds rather than in body lengths. */
    dragCoeff: 0.30,
    /** How fast the tail beat itself responds to a new target. Higher than
     *  `accelRate` on purpose: muscle changes stroke rate long before the
     *  animal's momentum catches up. That ordering is what makes the burst
     *  read as effort followed by result. */
    tailResponse: 6.0,
    /** Hard ceiling on how fast the tail beat may change, in Hz per second.
     *
     *  This is what stops a click reading as a switch. `tailSpeed` is just
     *  `tailHz / clipBaseHz`, so an unbounded beat lets the baked clip jump
     *  from 1x to 3.3x playback in a third of a second, which the eye reads as
     *  the animation being swapped rather than the whale working harder.
     *  Limiting the BEAT rather than the clip rate keeps stroke and speed
     *  coupled. A burst moves the beat 0.4 Hz, so it now takes at least 0.5s.
     *  The peak still arrives: the envelope is ~0.87 at 0.44s. */
    tailRateLimit: 0.8,

    // --- Click: burst and glide --------------------------------------------
    /** Wind-up before the power stroke. The body coils slightly. The envelope
     *  eases in over this window rather than ramping linearly, so there is no
     *  slope jump at either end. */
    burstAttack: 0.22,
    /** Peak tail beat during a burst. Around 3x the cruise beat, which is what
     *  humpbacks actually do. Keep `burstTailHz / clipBaseHz` at or below
     *  `maxTimeScale`, or the clip rate clamps while speed keeps climbing and
     *  the visible stroke stops matching the motion. */
    burstTailHz: 0.575,
    /** Exponential decay constant of the burst envelope. Long enough that the
     *  whale reaches real speed before the stroke is spent. */
    burstTau: 1.6,
    /** Below this burst energy the whale stops fluking and coasts. Set high
     *  enough that the glide begins while the whale still carries real speed.
     *  Too low and the powered phase decays all the way back to cruise on its
     *  own, leaving the coast with nothing left to bleed off. */
    glideThreshold: 0.75,
    /** How fast the whale eases between powering and coasting. This is a blend,
     *  not a switch: it crossfades the tail target AND the speed integration
     *  together, so neither the stroke nor the acceleration ever steps. */
    glideBlendRate: 2.2,
    /** Tail beat while gliding — near zero, the flukes are still. */
    glideTailHz: 0.02,
    /** Nose-down coil during the wind-up, radians. */
    burstCoil: 0.1,
    /** Extra roll while powering through a burst, radians. */
    burstBank: 0.18,

    // --- Scroll: depth seeking ---------------------------------------------
    /** How deep the whale goes between the top of the page and the bottom.
     *  The visible band at z=0 runs from about y=-7.4 to y=+1.4, so 6 keeps the
     *  whale in frame for the entire scroll while still reading as a descent.
     *  Vertical movement does NOT change apparent size: the camera looks down
     *  -Z, so only `stageZRange` affects how big the whale appears. */
    depthRange: 6,
    /** How fast the target depth itself follows the scrollbar. */
    depthFollowRate: 0.9,
    /** Converts depth error into a desired pitch angle. Higher is more eager. */
    pitchGain: 0.35,
    /** Whales sound far more steeply than they surface. */
    maxDivePitch: 50 * DEG,
    maxSurfacePitch: 30 * DEG,
    /** Rate limit on pitch. This is what turns a step input into an arc. */
    pitchRate: 0.65,
    /** Steeper dives cost effort, so the tail works harder. Hz per radian. */
    diveTailBoost: 0.175,

    // --- Scroll: the sounding arch -----------------------------------------
    /** Smoothed scroll speed, in viewport-heights per second, needed to fire
     *  the peduncle arch. Normalised so it behaves the same on any screen. */
    archScrollThreshold: 0.55,
    /** Minimum outstanding downward depth error before an arch is worthwhile.
     *  Scaled down with `depthRange`, or the arch would never fire. */
    archDepthThreshold: 1.5,
    /** Extra nose-down beyond the steering angle, radians. */
    archPitch: 0.28,
    /** Tail spike while arching, Hz. */
    archTailBoost: 0.25,
    /** Arch decay constant. Fades over roughly 1.2 s. */
    archTau: 0.45,
    /** Refractory period so a long scroll does not chain-fire arches. */
    archCooldown: 2.5,

    // --- Turning ------------------------------------------------------------
    /** Distance from centre at which the whale turns back. This is the main
     *  control over how often it is on screen: the frame half-width is about
     *  7.8 units, so this turns it just out of view and brings it straight
     *  back. Grows with body size, or a bigger whale turns while still
     *  half-visible at the edge. */
    turnX: 15,
    /** Yaw slew rate. Together with speed this sets the turn radius
     *  (speed/yawRate), and the turn radius matters more than it looks: a
     *  180-degree turn is a half-circle in the XZ plane, so it displaces the
     *  whale by the turn DIAMETER away from the camera. At 0.32 that was 7
     *  units per turn, which stacked up turn after turn and marched the whale
     *  into the distance. Tight turns keep that displacement small, and
     *  humpbacks really do turn inside a body length. */
    yawRate: 0.45,
    /** Proportional gain on the remaining yaw error. The turn runs at the full
     *  rate for most of its arc and then TAPERS as it lines up, instead of
     *  running flat out and stopping dead. */
    yawApproach: 0.5,
    /** How fast the turn rate itself builds. Without this the whale goes from
     *  straight to full curvature in a single frame, which is the other half of
     *  why the old turn read as a pivot rather than a manoeuvre. */
    yawRateResponse: 2.0,
    /** Lane keeping. After a turn the whale is off its z=0 lane; this noses it
     *  gently back rather than correcting position directly, so the motion
     *  stays honest. Radians of yaw bias per world unit of Z error. */
    laneKeepGain: 0.25,
    /** Ceiling on the lane-keeping bias while the whale is ON SCREEN. Low,
     *  because a large value reads as the whale crabbing sideways. */
    laneKeepMax: 12 * DEG,
    /** Ceiling while it is off screen, where nobody can see it crab. This is
     *  what pays for a wide, natural turn: the arc displaces the whale several
     *  units away from the camera, and it claws all of that back out of sight
     *  rather than re-entering the frame small. */
    laneKeepMaxOffscreen: 55 * DEG,
    /** Half-width of the visible frame. Past this the whale is out of sight and
     *  the aggressive ceiling applies. */
    laneKeepFreeX: 7.0,
    /** Roll per unit of yaw rate — the whale banks into its turns. */
    bankGain: 1.8,
    /** How fast the roll follows the turn. This must be a lag, not a direct
     *  reading of the yaw rate: the yaw slew stops dead on the frame the turn
     *  completes, so an instantaneous bank snapped the whale ~35 degrees
     *  upright in a single frame. Rolling in and out progressively is also what
     *  a real animal does. */
    bankResponse: 1.6,
    maxBank: 42 * DEG,

    // --- Body oscillation ---------------------------------------------------
    /** Heave along the body's own up axis, phase-locked to the tail stroke.
     *
     *  Keep this small. The heave adds a vertical velocity of
     *  `heaveAmp * 2pi * tailHz`, against a forward speed of
     *  `tailHz * strokeDistance`, so the path wobbles off the nose direction by
     *  `atan(heaveAmp * 2pi / strokeDistance)` — about 4 degrees here, and
     *  constant at every speed because both terms scale with the tail beat.
     *  Keep it proportional to `strokeDistance`; push the ratio much past
     *  0.023 (it is 0.012) and the whale visibly porpoises instead of
     *  swimming. */
    heaveAmp: 0.075,
    /** Counter-pitch a quarter cycle out of phase with the stroke. */
    counterPitchAmp: 0.05,

    // --- Idle wander --------------------------------------------------------
    /** Low-frequency drift so the path never looks rail-locked, radians. */
    wanderYaw: 3 * DEG,
    wanderRoll: 4 * DEG,

    // --- Staging ------------------------------------------------------------
    /** How far the whale recedes into the background over a full page scroll.
     *  Purely a staging offset — it does not feed back into the physics.
     *
     *  The camera sits only 4 units away, so apparent size is 4/(4+this) and
     *  this number bites HARD: 24 shrinks the whale to 14%, and even 3 costs
     *  43%. This caps apparent size at 4/(4+this), so 0.3 floors it at 93%,
     *  leaving headroom for the small residual a turn leaves behind. */
    stageZRange: 0.3,

    // --- Scroll engagement ---------------------------------------------------
    /** How fast the whale commits to, and relaxes out of, scroll-driven diving.
     *  The engagement signal itself comes from GSAP ScrollTrigger, which knows
     *  about momentum and smooth-scrolling; a bare velocity threshold flickers
     *  on and off during the tail of a flick. */
    scrollEngageRate: 2.5,
    /** How much of the steering pitch survives when the page is still. The
     *  whale keeps its depth but stops holding a committed dive attitude, so it
     *  settles into calm level swimming instead of staying angled. */
    idlePitchScale: 0.25,

    // --- Close pass: shockwave ----------------------------------------------
    /** Pressure wave thrown off as the whale sweeps past the viewer.
     *
     *  Triggered by PROXIMITY, not by the click. The whale crosses the frame
     *  and its distance to the camera bottoms out as it passes the middle; the
     *  wave fires at that nearest point, so it reads as this animal displacing
     *  the water it just swept through, right in front of you.
     *
     *  Geometry: the camera sits at (0,-3,4) and the whale swims the y=0..-6
     *  band, so its distance is sqrt(x^2 + 9 + 16) at the top of the page.
     *  Distance 7 is about |x| < 4.9, comfortably inside the ~7.8 frame
     *  half-width; 10 is about |x| > 8.7, which is just off-screen. So the
     *  whale arms itself while out of view and fires while centred. */
    shockTriggerDistance: 7.0,
    shockArmDistance: 10.0,
    shockSpeed: 2.4,
    shockMaxRadius: 1.1,
    shockWaveSize: 0.18,
    shockAmplitude: 0.045,

    // --- Hero rest, and the return-to-top banger entry ----------------------
    // The hero no longer opens on this curve — it opens frozen at the fixed
    // rest pose below (see `heroFrozen`/`restPlaced` in whaleAnimator.ts) and
    // only starts swimming once the visitor scrolls. This scripted beat is
    // reused instead for the "welcome back" flourish: scrolling all the way
    // back up to the top replays it before the whale re-settles into the
    // same rest pose, rather than silently retracing the descent. A scripted
    // one-shot — like the burst/arch beats below, not continuous locomotion.
    // Physics still swims the whale along it (pitch, thrust, drag all still
    // apply), but the TARGET it's chasing during this window is a curve, not
    // the usual scroll-derived one, built once with MotionPathPlugin from the
    // constants below (see whaleAnimator.ts). The shape: rise from deep
    // water, surge close past the camera near the surface, then dive away to
    // the hero's resting depth — a near-breach, not a literal one (the hero
    // is a fixed photo with no splash VFX, so the whale must stay under its
    // painted waterline throughout).
    /** How far back in the dark water the whale starts, in Z staging. */
    revealZOffset: -45,
    /** World Y the whale rises FROM — deep and unseen, so the surge up to the
     *  surface reads as coming from real depth rather than starting already
     *  shallow. */
    revealDeepStartDepth: -6,
    /** Time to swim the whole entrance curve. */
    revealDuration: 3.4,
    /** Extra tail beat on the way in, fading as it arrives. */
    revealTailBoost: 0.125,
    /** World Y at the peak of the entrance — the shallowest the whale gets,
     *  just under the surface, matching the hero photo's existing wave
     *  crest/splash (upper right, near the waterline). Never breaches: still
     *  comfortably under `HERO.depth`'s waterline clearance, just shallower
     *  than where it settles afterward. */
    revealEntryDepth: -0.3,
    /** How far past its resting stageZ the whale's staging pushes at the
     *  peak — positive is closer to the camera than the hero shot ever gets
     *  again, which is what sells "surges toward you" rather than just
     *  "arrives." Bumped up alongside `HERO.stageZ`'s own increase (to 1.5,
     *  a deliberately large resting size now) so the peak still reads as a
     *  surge PAST that size rather than a step down from it. */
    revealPeakStageZ: 2.6,
    /** World X the whale is born at, screen-right to land under that same
     *  wave crest. Purely a starting offset — normal steering takes over
     *  immediately after. */
    revealEntryX: 2.5,
    /** Fraction of the reveal (0..1) at which the entrance peaks — both the
     *  closest/shallowest point of the curve AND the tail-smash beat, so the
     *  stroke lands exactly as the whale is at its most dramatic. */
    revealSmashAt: 0.45,
    /** Scroll position, in pixels, under which the hero counts as "at the
     *  top" — small enough to ignore sub-pixel scroll jitter, generous
     *  enough that momentum/rubber-banding on a trackpad doesn't flicker the
     *  frozen state on and off right at the boundary. */
    heroRestScrollEps: 6,
    /** Fixed pitch (nose up) the whale holds while parked at rest, radians.
     *  A deliberate static tilt — not zero/level — so the hero pose has some
     *  of the reference photo's dynamism rather than reading as a plain,
     *  level glide. Negative: the hero photo has the whale mid-dive, nose
     *  down and tail breaking the surface, not surfacing nose-up. */
    heroRestPitch: -70 * DEG,
    /** Fixed roll (bank) at rest, radians. Paired with `heroRestPitch` for
     *  the same reason. */
    heroRestBank: 14 * DEG,
    /** Fixed yaw at rest, radians, and the `heading` it corresponds to (see
     *  `WhaleFrameOutput.heading`). Pi/-1 rather than the swimming default
     *  of 0/1: the reference photo has the whale facing screen-left, nose
     *  down. Kept as a matched pair so nothing downstream mistakes the
     *  static rest yaw for a heading the turn logic hasn't caught up to. */
    heroRestYaw: Math.PI,
    heroRestHeading: -1,
    /** World X at rest. Shifted screen-left so the tail lands in the
     *  photo's whitewater splash instead of the open blue beside it. */
    heroRestX: -5.2,

    // --- Direction ----------------------------------------------------------
    /** The dive director composes shots by ASKING, never by setting. These
     *  bound how long an ask stays valid and how often it may be granted.
     *  None of them apply when no director is passed in. */

    /** How long an arch request waits for a frame where the body agrees. Long
     *  enough to catch the dive as it develops after a station change; short
     *  enough that a stale request cannot fire a station later. */
    archRequestTTL: 1.5,
    /** How long a turn request waits for the whale to be settled and clear of
     *  frame centre before it lapses. */
    turnRequestTTL: 2.5,
    /** Minimum time between granted turn requests. A traverse at cruise takes
     *  ~26 s, so this still allows a real change of mind, but never a whale
     *  that visibly zig-zags to chase marks. */
    turnCooldown: 8.0,
    /** Requested turns are refused inside this |x|. A 180 taken near the
     *  middle of frame reads as a pivot, not a manoeuvre.
     *
     *  Was 5, which assumed a frame ~7.8 units wide. At 16:9 the frame at the
     *  whale's lane is only ~6 each side, so 5 refused the director's
     *  keep-in-frame turns until the whale had already all but left the view.
     *  2 still forbids a turn dead centre. */
    turnMinX: 2.0,
    /** Yaw error under which the whale counts as settled on a heading. */
    turnSettledEps: 0.08,
    /** Bounds on the director's effort multiplier. Below 0.7 the stroke is
     *  too slow for the baked clip to read as swimming; above 1.6 cruise
     *  starts to overlap the burst and the click stops meaning anything. */
    minEffort: 0.7,
    maxEffort: 1.6,

    // --- Clip playback ------------------------------------------------------
    /** Tail beat the baked GLB clip shows at timeScale 1: 7 strokes in its
     *  40 s loop. The clip is generated by scripts/whale-clip/swim_clip.py
     *  (STROKES / CLIP_SECONDS); change the two together. Every other Hz in
     *  this file is a real, visible beat because of this, which is also what
     *  keeps the body's heave and counter-pitch in step with the flukes. */
    clipBaseHz: 0.175,
    /** Guard rails on the resulting timeScale. The ceiling sits just above
     *  `burstTailHz / clipBaseHz` so it only catches genuine outliers and never
     *  trims a normal burst. */
    minTimeScale: 0.02,
    maxTimeScale: 3.4,
};

export type WhaleConfig = typeof WHALE_CONFIG;
