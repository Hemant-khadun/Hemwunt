# The Sounding — handoff plan

Resume point for the scenic art-direction overhaul (whale + portfolio as one
descent). Written 2026-09-13 at a usage-limit pause. Read this top to bottom
before touching code; the full original design lives at
`C:\Users\heman\.claude\plans\as-an-art-director-toasty-squid.md`.

**Concept:** the page is one dive. Hero = just under the surface; each of the 5
projects is a composed shot at a deeper zone; the statement is the deepest
point; the contact footer is the ascent back to light.

**Confirmed art calls (do not re-ask):** depth-zone dive · exactly one
front-of-content whale pass · desktop full / mobile graceful · teal *world*
palette but `#5089ff` stays for *UI* · commit to darkness with a rim-light
floor (projects never darken) · keep snap, tuned to beats · quiet depth plates
· click-burst gets heavier with depth · page now opens on the sea surface
(sky, hyperreal static-ish waves, sun glare) and submerges into the existing
dive on the first scroll, rather than opening already underwater (new, this
session — see §4.10).

**References:** `C:\Users\heman\Downloads\wmremove-transformed.webp` (one light
from the surface; gradient runs vertically *through* the whale) and
`C:\Users\heman\Downloads\humpback-whale-vfx-grace-3d-model-7df3a84d01.jpg`
(raw vs final: everything graded into water, contrast falls with camera
distance, blacks are navy, bubble trail off the fluke, surface foam).

---

## 0. First thing next session

1. **Commit a baseline.** The repo has *no commits* (`git log` fails). Nothing
   below is recoverable otherwise. Commit on a branch, not `main`.
2. `npm run dev` → open the page and do the **visual check (§2)**. Claude has no
   browser tooling in this environment, so *none of the visuals have been seen
   yet* — only types, build and headless sims are verified.
3. Feed findings back into the tuning table (§3) before building more.

---

## 1. Done and verified

Verification legend: **T** = `npx tsc --noEmit` clean · **B** = `npm run build`
succeeds · **S** = headless sim in `scripts/sim/`.

| Area | What | Files | Verified |
|---|---|---|---|
| Build | Vite now builds the SITE (was building the old fluid library); deps moved to `dependencies`; tsconfig de-library'd; font via relative URL + `font-display: swap`; favicons in `public/`; dead `Starfield.tsx`, `Hero.tsx.old/.backup`, `<Outlet/>` removed | `vite.config.ts` `package.json` `tsconfig.json` `index.html` `src/styles.css` `src/components/Layout.tsx` | T B |
| Ocean table | Single source of truth for every depth-driven value (water colours, sun/rim/fill/ambient/biolum, bloom, rays, surface, waterBlend, snow). `RIM_FLOOR = 0.5`. Abyss black lifted to navy | `src/animations/oceanPalette.ts` | T |
| Depth signal | Singleton written once/frame from `WhaleModel`; `depthFromScroll` rises to 1 by 88% of scroll then eases back to 0.12 (the ascent) | `src/animations/depthSignal.ts` | T |
| Light rig | One sun anchored above the surface in world space; lights die in order fill → sun → ambient, rim floored, biolum rises | `src/components/whale/SceneLighting.tsx`, `src/animations/stage.ts` | T |
| Surface | Underside of the water at `SURFACE_Y = 1.1`, caustic shader, fades with depth | `src/components/whale/Surface.tsx` | T |
| Whale body | `onBeforeCompile` injection after `<skinning_vertex>`: vertical body gradient + absorption + water blend (highlights resist) + **camera-distance scatter**. normalScale 1.35, roughness/envMap driven by depth | `src/animations/whaleDepthMaterial.ts`, `src/components/whale/WhaleModel.tsx` | T |
| Rays | Colour/spread/length/opacity driven by depth each frame (removed from prop-sync to avoid two writers) | `src/components/whale/LightRays.tsx` | T |
| Marine snow | Replaces starfield; paints graded water + downward-drifting flakes; gradient cached, fillStyle bucketed, rAF cancelled | `src/utils/MarineSnow.tsx` | T |
| CSS bridge | `--depth`, `--zone`, `--water-near/far` on `:root`, quantized writes on `gsap.ticker`; token block added | `src/animations/useDepthCss.ts`, `src/styles.css` | T |
| Depth plates | `200 m · twilight zone` etc. on every item, all 4 desktop layouts | `ScrollFilterItem.tsx`, `Portfolio.tsx`, `styles.css` | T |
| Animator intent API | `intent {targetDepth, stageZ, effort}`, `requestArch()`, `requestTurn()`, output `core/heading/turning`. **Proven visual no-op** without a director | `src/animations/whaleAnimator.ts`, `whaleConfig.ts` (new "Direction" block) | T **S: 0.00 divergence** |
| Dive director | Shots keyed to scroll positions (hero, each item centre, statement @86%, ascent), smoothstep holds at keys; beats fire once per descent, re-arm below fold | `src/animations/diveScore.ts`, `diveDirector.ts`, `stationRegistry.ts` | T **S: beats 1/1/1 down, 0 up, re-arm; max jump 0.04** |
| Snap twitch (R6) | Snap no longer counts as visitor scrolling | `src/utils/SmoothScroll.tsx`, `Portfolio.tsx`, `scrollSignal.ts` | T |
| Housekeeping | `#statment` → `#statement` nav link; footer wash + footer sphere regraded from purple to surface light | `Header.tsx`, `styles.css`, `Scene.jsx` | T B |
| **§4.1 Reveal coupling** | Whale projected to screen each frame (in-front test in view space); each reveal's mask origin latches to the whale's X on the first scrub update (radius ≈ 0, no hop), re-arms at 0, skipped if entered mid-reveal. Radius driven via proxy `t × (radius + offset) × 1.08`. Feathered mask (radial gradient) + 2.5% CSS edge fade on the SVG | `src/animations/screenProjector.ts`, `useWhaleWake.ts`, `ScrollFilterItem.tsx`, `WhaleModel.tsx`, `styles.css` | T B |
| **§4.2 Bubble wake** | 150-point world-space bubbles shed from fluke tip `Bone004_end_018` (confirmed: largest swing in clip, 44.5°). Emission from the bone's measured speed × shallowness × reveal; rim-lit bubble sprite; desktop + no reduced motion only | `src/components/whale/BubbleWake.tsx`, mounted in `WhaleScene.tsx` | T B |
| **§4.3 Camera director** | Additive offsets on top of the prelude's pose (base recovered each frame → no accumulation); lean toward whale ±0.5/±0.4, dolly ≤0.6 for far shots, FOV 80→76 for close pass; never rotates; scaled by `1 − preludeSignal.progress`. Director publishes `diveShot` | `src/components/whale/CameraDirector.tsx`, `diveDirector.ts`, mounted after `SurfacePrelude` | T B |
| **§4.4 Front pass** | z-index raise with overlap-safe cuts, `pointer-events: none !important` layer. **`FRONT_PASS_MODE = 'off'`** — needs the visual alpha test (see file header) | `src/animations/frontPass.ts`, `Canvas.tsx` (`.whale-layer` class), `styles.css`, `stationRegistry.ts` (`element`) | T B |
| **§4.5 Polish** | Burst heavier with depth (`burstScale`, omitted = identical: **S 0.00**); UI colour literals → `var(--ui-*)`; plate hairline tinted by `--water-near` | `whaleAnimator.ts`, `WhaleModel.tsx`, `styles.css` | T B S |
| **§4.6 Perf/a11y** | Frame-budget guard on gsap.ticker (>22 ms for 2 s → halve snow, stop bubbles, pin camera; recover <17.5 ms for 5 s); mobile DPR cap 1.5 + no N8AO; reduced-motion CSS block; Scrollbar effect `[]`; footer sphere canvas mounts near viewport + lazy `Scene` chunk (40 kB); header fluid canvas mounts only while menu open | `frameBudget.ts`, `MarineSnow.tsx`, `BubbleWake.tsx`, `CameraDirector.tsx`, `Canvas.tsx`, `Hero.tsx`, `styles.css`, `Scrollbar.tsx`, `Footer.tsx`, `Header.tsx` | T B; director sim still 1/1/1 · 0 up |

| **Banger entrance (new, this session)** | The reveal used to seed the whale already shallow (`-0.3`) and just dive down. Reworked into a scripted rise-surge-dive: born deep (`revealDeepStartDepth -6`), rises to a near-surface peak close past the camera (`revealPeakStageZ`, staying under the hero photo's waterline — a near-breach, not a literal one, since there's no splash VFX to sell an actual breach), tail-smashes at the peak, then dives away to settle at the real hero depth. Still fully physics-swum (pitch/thrust/drag unchanged) — only the TARGET during the entrance comes from two `MotionPathPlugin`-sampled curves instead of a static value, blended into the real scroll-derived target over the curve's last stretch (`revealHandoff`) so there's no pop at handoff. Fixed a related bug while at it: the position seed used to be gated on `intent` being defined, so a whale revealed before the director's first measured frame would sit at the OLD y=0 chasing the new deep target, then visibly snap once intent arrived — the seed no longer depends on intent's presence. | `src/animations/whaleAnimator.ts` (`revealDepth`, `revealStageZ`, `revealHandoff`), `src/animations/whaleConfig.ts` (`revealDeepStartDepth`, `revealPeakStageZ`) | T B **S: fallback/intent divergence 0.00 (was 2.52, bug fix); director sim unchanged** |
| **Natural depth path (new, this session)** | The whale's locomotion physics (pitch-seeks-depth, thrust, drag, turning) stays exactly as it was — a prior session deliberately rejected putting the whale itself on a MotionPath (see the header note in `scrollSignal.ts`), and that reasoning still holds. What changed is the *target* the physics chases between two stations: `diveDirector` used to hand the animator a straight lerp between each pair of shot depths; each leg is now its own short MotionPathPlugin bezier (built once from `diveScore.ts`'s existing depths, sampled with `MotionPathPlugin.getRawPath`/`cacheRawPathMeasurements`/`getPositionOnPath`), so the target itself swoops rather than ramping linearly. `stageZ`/`effort` are untouched (still a plain lerp — camera framing/effort, not the dive path), and the whale's lateral (X) position is deliberately untouched too (still unscheduled against scroll). `beginReveal()`'s entrance dive and the existing wander/turn behaviour at depth already covered "dive at the start" and "roam at the bottom" — nothing new was needed there. | `src/animations/diveDirector.ts` (`DEPTH_PATH_BOW`, `pathDepth`) | T B **S: director sim unchanged — beats 1/1/1 down, 0 up, re-arm; max jump 0.0417** |

**Re-run the sims:** from `scripts/sim/` —
`npx esbuild simAnimator.ts --bundle --platform=node --format=cjs --outfile=sim.cjs && node sim.cjs`
and `node buildDirectorSim.cjs && node simDirector.cjs`. (Imports use absolute
project paths.)

---

## 2. Visual check (do before §4)

Scroll the whole page slowly, then fast, then back up.

- [ ] **Hero:** surface visible overhead, caustics moving, whale a body-length below it, rays coming from above.
- [ ] **Body gradient:** back lit, belly/fluke darker. Holds through the swim cycle (fluke must not flicker). If the whale renders flat/unchanged → check console for `[whaleDepthMaterial] No output chunk found`.
- [ ] **Descent:** light drains progressively; no banding or visible step between zones.
- [ ] **Abyss (Kinder Garden):** whale still findable as a rim silhouette. If lost → raise `RIM_FLOOR` or lower abyss `waterBlend`. Project screenshots at full brightness.
- [ ] **Beats:** FutureSpace arch, Konze burst (close + large, stageZ +1.0), Artisanal turn. None replay on scroll-up.
- [ ] **Close pass:** check for faceting — the mesh is only 1,562 vertices.
- [ ] **Statement:** whale's nose comes up. **Footer:** light returns, whale rises.
- [ ] **Snap:** no pitch twitch when the page settles on a project.
- [ ] Depth plates aligned in all four layouts; readable but quiet.
- [ ] Console clean; DevTools Performance at 4× CPU throttle holds frame rate.
- [ ] **Reveals (§4.1):** each project's dissolve opens from roughly where the whale is on screen (off-centre when the whale is to one side, centred when it's off frame). Edges soft, no hard card rim, no unrevealed corner at full reveal. No hop when the dissolve starts.
- [ ] **Bubbles (§4.2):** near the surface, bubbles trail off the fluke on strokes and bursts, rise and wobble, vanish at the surface; sparse to none in the deep. If they come off the head instead, the tail bone name is wrong.
- [ ] **Camera (§4.3):** subtle lean toward the whale, slight push-in at Kinder Garden, slightly wider at Konze; no rotation, no drift after the prelude hands off.
- [ ] **Front pass test (§4.4):** set `FRONT_PASS_MODE = 'raise'` in `src/animations/frontPass.ts`, scroll to Konze. Whale crosses in front → keep. Page blacks out → set back to `'off'`. Click a project link during the pass either way.
- [ ] **Header menu:** fluid effect still appears when the menu opens (canvas now mounts on open).
- [ ] **Footer:** sphere appears as you approach contact.

---

## 3. Tuning knobs (where to change what)

| Want to change | Edit |
|---|---|
| Any light/colour/bloom/rays/snow at a depth | `OCEAN` stops in `src/animations/oceanPalette.ts` |
| How dark the whale can get | `RIM_FLOOR` (same file); `waterBlend` per stop |
| Body gradient height / distance haze | `createWhaleDepthUniforms()` in `whaleDepthMaterial.ts` (`uBodyFalloff`, `uScatterStart/End/Max`) |
| Per-project whale depth, size, effort, beat, beat timing | `STATION_SHOTS` in `src/animations/diveScore.ts` |
| How much the depth target swoops between two stations, rather than ramping straight | `DEPTH_PATH_BOW` in `src/animations/diveDirector.ts` |
| The entrance's shape — how deep it starts, how close/shallow the peak gets, how long it takes | `revealDeepStartDepth`, `revealEntryDepth`, `revealPeakStageZ`, `revealDuration`, `revealSmashAt` in `whaleConfig.ts`; curve shape itself in `revealDepthPath`/`revealStageZPath` (`whaleAnimator.ts`) |
| Where the ascent starts | `ASCENT_START` / `ASCENT_FLOOR` in `depthSignal.ts` and `STATEMENT_AT` in `diveScore.ts` (keep together) |
| Surface height, sun height/reach | `src/animations/stage.ts` |
| How requests are granted (arch/turn TTLs, cooldowns) | "Direction" block in `whaleConfig.ts` |
| Where each story scene rests; what counts as one gesture; how long a scene waits for the whale; glide speed | `rest` per chapter in `story.ts`; gesture detection, `SCENE_WAIT`, `COMMIT`, `PROXIMITY`, `GLIDE_*` in `src/utils/ScrollBeats.tsx` |

Never change `scale={0.0045}` in `WhaleModel.tsx` without rescaling the length
constants in `whaleConfig.ts` (see its SIZING note). Don't remove `<Center>` in
`WhaleScene.tsx` — the GLB hierarchy is offset by `[0,0,-150]` at scale 500.

---

## 4. Remaining work, in order

Each step: run **T** after, **B** at the end of each step, commit.

### 4.1 Whale → reveal coupling + feathered edges (plan step 7) — ✅ done (T B, not yet seen)
- New `src/animations/screenProjector.ts`: `whaleScreen {x, y, ndcX, onScreen, edgeFalloff}` singleton + `projectWhale(worldPos, camera)`, called in `WhaleModel` `useFrame` after `getWorldPosition`. **Do the in-front test in view space before projecting** (`Vector3.project` mirrors points behind the camera). Zero allocations.
- New `src/animations/useWhaleWake.ts`, used by `ScrollFilterItem.tsx`: **latch** mask `cx` once on the *first* scrub update (radius ≈ 0 — latching at 8% makes a visible hop), re-arm at progress 0; skip the latch if first seen past 10% (deep link). Never track per frame. Cache the viewBox mapping (`preserveAspectRatio="xMidYMin slice"`) on ScrollTrigger refresh only. `cx = clamp(lerp(50, localX, 1 - edgeFalloff), 50±18)`. *(Implementation note: instead of re-tuning radii down, the radius is driven through a proxy tween as `t × (radius + |cx−50|) × 1.08`, so pacing is unchanged for a centred origin.)*
- **Feather the mask edge** (radial alpha falloff in the mask) so screenshots dissolve into the water and the whale reads through the boundary. Keep the no-filter-on-image rule (`ScrollFilterItem.tsx` header comment).
- ⚠️ Do **not** animate `feDisplacementMap` scale — software-rastered, too costly.

### 4.2 Bubble wake off the fluke (new, from VFX Grace reference) — ✅ done (T B, not yet seen)
Replaces the cut SVG ripple. Small instanced-points system in the main canvas, emitting from the tail bone world position during bursts and near the surface (emission ∝ `tailSpeed` × (1 − depth)). Additive, tiny, rising and fading. Budget ≤ 150 particles, desktop only.

### 4.3 Camera director (plan step 8) — ✅ done (T B, not yet seen)
`src/components/whale/CameraDirector.tsx` replacing the bare `<PerspectiveCamera>`. Rules: **never rotates**; never driven by velocity; ±0.5 lateral (critically damped follow of whale NDC X), ±0.4 vertical, dolly ≤ 0.6, FOV 80→76 at the close pass; ~1.2 s time constant; `updateProjectionMatrix` only on real FOV change; static under reduced motion. Dolly cap protects `shockTriggerDistance` tuning.

### 4.4 Front pass (plan step 9) — ⚠️ built, `FRONT_PASS_MODE = 'off'` until the visual alpha test in §2 is done. The "dim the project" fallback below was dropped: it contradicts the confirmed "dark never touches the work" call.
1. 20-minute spike: set the canvas wrapper in `src/utils/Canvas.tsx` to `z-index: 3`. If the page goes black → composer output is opaque → use fallback.
2. If transparent: `.whale-layer` / `.whale-layer--front` classes, toggled only during shot 3's pass on a frame where the whale's screen point doesn't overlap the item rect. Enforce `pointer-events: none !important` on the layer in CSS. Test clicking project links *during* the pass.
3. Fallback: keep z-index; transition the Konze item `filter: brightness(0.35)` for ~1.2 s during the burst.

### 4.5 Detail + polish — ✅ done except **surface foam** (lives in `Surface.tsx`, now shared with the §4.10 prelude — coordinate before editing)
- **Heavier burst with depth:** bias `burstTailHz` / `burstAttack` / `burstTau` by `depthSignal.depth` (add an optional `burstScale` to the animator; don't reshape the envelope).
- **Surface foam:** brighten caustic ridges above a threshold into white foam bands in `Surface.tsx`.
- **Remaining CSS literals → tokens:** `styles.css` still hardcodes `#5089ff`/`#00c3ff` (statement, links, footer h2, submit, socials — grep them). Swap to `var(--ui-blue)` / `var(--ui-cyan)`.
- Consume `--water-near/far` somewhere visible in the DOM (e.g. subtle section vignettes) with `transition: 400ms`.

### 4.6 Performance + accessibility — ✅ done, bundle size included (see §4.22; the "mobile path" and "frame-budget guard" bullets below are superseded there). Was: main chunk still ~1.9 MB. Lazy footer `Scene` split out only 40 kB because three/drei/react-spring are shared; a real cut needs lazy-loading the whole R3F scene behind the hero or `manualChunks` for three/postprocessing. Both WebGL extras (footer sphere, header fluid) now only exist when needed.
- **Frame-budget guard:** rolling mean frame time; above ~22 ms → halve snow, disable bubble wake, pin camera.
- **Mobile path** (detect once at load, ≤860px or coarse pointer): cap canvas DPR to 1.5, drop N8AO, no front pass, no camera moves.
- `@media (prefers-reduced-motion: reduce)` block in CSS (director already skips beats; `motionPreference.ts` exists).
- Consider removing a WebGL context: footer sphere (`Scene.jsx`, own `<Canvas>` + second HDRI) and/or header menu fluid (`Header.tsx` → `lib/`). Three contexts is heavy.
- Code-split: bundle is 1.97 MB. Lazy-load `Footer`'s `Scene` and the header `Fluid`.
- `src/utils/Scrollbar.tsx` main `useEffect` has **no dependency array** → rebuilds Draggable + ScrollTrigger every render. Add `[]`.

### 4.7 Content (needs the owner's words)
- Konze and Artisanal share the identical description "Web experience built and deployed on GitHub Pages." — ask for real copy.
- Project id `edunexus` vs title "Kinder Garden" mismatch in `Portfolio.tsx`.
- `README.md` still documents the fluid-distortion library.

### 4.8 Companion whale (new, from a second VFX Grace still — `C:\Users\heman\Downloads\humpback-whale-vfx-grace-3d-model-6fe050572e.jpg`, mother/calf pair, near whale sharp, far whale hazy near the surface)

Lower priority than 4.1–4.6 — this is atmosphere, not load-bearing for the
descent narrative. Do this after the core integration/perf work, alongside
or after 4.7.

**Do not add a screen-space depth-of-field pass for this.** `uScatterStart/
End/Max` in `whaleDepthMaterial.ts` already grades per-fragment
contrast-with-camera-distance on the whale's own material, which is the
correct place: a generic screen-space DoF would blur the whole frame
(surface caustics, god rays) instead of just the far animal. A second whale
placed past `uScatterStart` gets hazed for free by the existing shader.

- Second `<WhaleModel>` instance in `WhaleScene.tsx`, offset in world space
  behind and to the side of the lead (start `[2.5, -1.2, -4]` relative) so it
  sits past `uScatterStart`.
- ⚠️ **Material sharing trap.** Drei caches GLTF materials globally, so a
  second `WhaleModel` naively reusing `materials.HumpbackWhale` shares one
  set of shader uniforms with the first — both whales fight over `uWhaleY`
  each frame, driven by whichever `useFrame` runs last. The companion MUST
  get `materials.HumpbackWhale.clone()` plus its **own**
  `createWhaleDepthUniforms()` and its own `applyWhaleDepthGrading()` call
  (the `PATCHED` flag lives on the material instance, so the clone needs
  patching again — this is already how the file is designed to be reused,
  just wasn't exercised with two whales before).
- ⚠️ **Skeleton sharing trap, same shape as the material one.** `WhaleModel`
  mounts `nodes._rootJoint` via `<primitive>` straight from the cached GLTF
  result — a second `WhaleModel` instance would steal the lead's skeleton
  (both whales driven by whichever's bones update last), not just its
  material. The companion needs its own skinned mesh entirely: build it via
  `SkeletonUtils.clone(scene)` (from `three/examples/jsm/utils/SkeletonUtils.js`,
  the standard way to deep-clone a skinned/animated GLTF so bones aren't
  shared) plus its own `AnimationMixer`, not just a second `<WhaleModel>`
  mounted naively. Flagged by the parallel session while wrapping up §4.11.
- Give the companion its own `createWhaleAnimator()` but drive it from a
  **lagged copy** of the lead whale's `frame` (fixed-size ring buffer of the
  lead's last ~20 frames of position/quaternion, read N frames back; zero
  per-frame allocation) rather than an independent director — this is what
  reads as swimming *with* the lead rather than two unrelated whales sharing
  a screen. New file: `src/animations/companionLag.ts`.
- Companion does not drive `WhaleShockwave` or the dive director's beats —
  only the lead whale is a shot subject.
- If frame time regresses (§4.6's frame-budget guard), drop the companion
  first on the mobile path.

### 4.9 Skin-level caustics + wet specular (new)

The reference's tightest highlights are caustic light rippling across the
whale's own back and head, not just the water surface above it. Two
separable additions — do wet specular first (contained, low-risk), caustics
second (touches the shared fragment injection, more likely to interact with
the existing scatter term).

- **Wet specular:** swap `materials.HumpbackWhale` from
  `MeshStandardMaterial` to `MeshPhysicalMaterial` in `WhaleModel.tsx`
  (check what the GLB actually exports first — may need
  `material.clone()`'d into a `MeshPhysicalMaterial` rather than a straight
  swap). Add `clearcoat`/`clearcoatRoughness`, lerped by depth exactly like
  `roughness` already is in `WhaleModel.tsx`'s `useFrame`: `clearcoat` 0.6→0,
  `clearcoatRoughness` 0.15→1 over the same depth range. Material-property
  change only, no shader injection — test this alone before touching
  caustics.
- **Caustic term:** port `Surface.tsx`'s ridge function (`c1/c2/c3` sine sum
  → `pow(1 - ridges, 3)`) into the `whaleDepthMaterial.ts` fragment
  injection. Needs a new `vWhaleWorldXZ` varying alongside the existing
  `vWhaleWorldY`/`vWhaleViewDist` so the pattern samples world-space XZ.
  Share `uTime` and the frequency constants with `Surface.tsx` (pass as
  uniforms, don't duplicate the magic numbers — if they drift apart the
  skin pattern and the overhead pattern will visibly disagree). Modulate
  `gl_FragColor.rgb` with `1.0 + caustic * uCausticStrength *
  (1.0 - uSceneDepth)` — a lift, not a multiply-to-black — and drive
  `uCausticStrength` from `ocean.sun` in the ocean table so it's gone by the
  time the sun itself is.

### 4.10 Opening beat: surface-to-dive prelude (new, this session)

The page currently opens already underwater (§ concept note at the top: "hero
= just under the surface"). The ask is to open ON the surface instead — real
sky, hyperreal waves (static is fine, does not need to be a running
simulation), sun glare — and have the first scroll input submerge the camera
into the existing dive. This is the *start* of the one dive, not a
contradiction of it.

**Confirmed available with zero new dependencies** (checked this session
against the installed versions): `@react-three/drei`'s `<Sky>` (physically
based Preetham/Hosek atmospheric model, procedural — no texture download,
which is what makes "as real as possible" affordable) and three's own
`Water` object at `three/examples/jsm/objects/Water.js` (bundled inside the
`three` package already in `node_modules`, just not imported yet). `Water`
is the same shader used in most of the well-known photoreal three.js ocean
demos: real sun reflection via a fed light direction, Fresnel, distortion —
convincing even nearly frozen, because the realism comes from the normal map
detail, not from the animation speed.

- ⚠️ **Asset gap:** `Water.js` needs a tileable water-normals texture, and
  unlike the JS, three's npm package does **not** ship the texture assets
  from its GitHub examples folder — only the shader code. Source one
  (CC0/public-domain tileable water normal map, e.g. search "water normals
  tileable CC0") before starting this, or fall back to a procedurally
  generated normal map (canvas-drawn Perlin/simplex, baked once at startup)
  if you'd rather not add an external asset — flag which route in a
  follow-up before implementing, it changes the first step.

- **New component** `src/components/whale/SurfacePrelude.tsx`: mounts
  `<Sky>` + `<Water>` + a single `directionalLight` standing in for the sun,
  all positioned from the *existing* shared constants in `stage.ts`
  (`SURFACE_Y`, `SUN_Y`, `SUN_DISTANCE`) rather than new numbers — the sky's
  sun and the underwater spotLight in `SceneLighting.tsx` must agree on
  where the light source is, or the transition will visibly jump.
- **Progress source:** do not reuse `depthSignal.depth` for this — its curve
  (`depthFromScroll`) is shaped for the whole page's descent-then-ascent
  narrative, not a few-percent-of-scroll prelude. Use a small local eased
  value over the first ~5–8% of total scroll (own `smoothstep`), so tuning
  the prelude's length never touches the main dive's timing.
- **Camera:** drive the *existing* shared `PerspectiveCamera` in
  `WhaleScene.tsx` rather than mounting a second camera — start it around
  `SURFACE_Y + 2` with a slight downward pitch (looking near the horizon),
  ease to its current `[0, -2, 4]` / no-pitch resting pose as the prelude
  progress reaches 1. **This pitch move is a one-time scripted transition,
  not the whale-chase camera** — it must not be confused with §4.3's
  CameraDirector rule that the chase camera never rotates; that rule applies
  once the dive proper begins, after this prelude has already handed off.
- **Handoff, not a cut:** cross-fade `<Sky>`/`<Water>` opacity down and the
  existing `Surface.tsx`/`LightRays`/fog up over the same progress value, so
  it reads as diving under rather than a scene swap. Unmount (not just hide)
  `Sky`/`Water` once progress reaches 1 and scroll has moved past the
  threshold with no way back up into it being reachable except an actual
  scroll-to-top — `Water`'s reflection/refraction render-to-texture passes
  are two extra render targets and should not be paid for anywhere else on
  the page (ties into §4.6's frame-budget guard).
- Keep `Water`'s time uniform advancing very slowly (well under its default
  speed) rather than fully frozen — a truly static frame of this shader can
  read as plasticky where the normal map tiles; a slow crawl keeps the
  "hyperreal" read while still satisfying "does not need to look animated."
  Tune after seeing it.

**Status: built, T + B clean.** `src/animations/preludeSignal.ts` (new),
`src/components/whale/SurfacePrelude.tsx` (new), wired into
`WhaleScene.tsx` (added `cameraRef`, passed to both `PerspectiveCamera` and
`SurfacePrelude`), `Surface.tsx` and `LightRays.tsx` each multiply their
opacity by `(1 - preludeSignal.progress)`. Texture at
`public/textures/water-normals.jpg` (sourced from a free PBR set, `NORM`
map). **Not yet visually checked** — no browser tooling available this
session; do the usual `npm run dev` look before trusting the tuning values
above (sun tilt, camera start pose, `WATER_TIME_SPEED`) — they're first
guesses, not measurements.

**Also wired to `frameBudget.degraded`** (§4.6, from the parallel session):
`SurfacePrelude` now forces `preludeSignal.progress` to 0 when degraded,
not just hiding its own mesh — `Water`'s reflection pass is the single most
expensive thing on screen during this beat, and `Surface`/`LightRays` read
the same singleton to suppress themselves, so overriding only the mesh
visibility and not the published progress would have blacked out the frame
(both sides hidden, neither handing off). Caught and fixed before it shipped
as a bug, not after.

**Two edge cases caught in review by the parallel session, both fixed** (the
blank-frame deadlock above was this session's own catch while wiring the
feature — correcting the record, since an earlier note here miscounted it
as a third review finding):

1. **Camera stranding.** A degrade mid-transition used to leave the camera
   wherever the last live frame put it (above the waterline, pitched at the
   horizon) while the underwater dressing was already showing. Fixed by
   snapping straight to `REST_POSITION`/identity on the frame the hand-off
   trips.
2. **Pop-back / strobe on release.** First flagged as: releasing the
   hand-off the instant `frameBudget.degraded` clears could pop Sky/Water
   back in mid-view, since recovery has a 5s hold and the prelude window is
   only the first ~6% of scroll — fixed with a `handedOff` latch releasing
   only once the visitor scrolls back to the top. That fix had its own bug,
   caught in a follow-up pass: the release condition checked scroll position
   alone, and scroll ≈ 0 is where every visitor starts — on a slow machine
   still degraded at the top, the latch would release and re-trip every
   single frame, strobing the landing view between surface and underwater.
   Fixed by also requiring `!frameBudget.degraded` before releasing, so it
   only lets go once the visitor is back at the top AND the budget has
   genuinely recovered.

Both reachable on a slow machine; #2 in particular would have hit the
landing view, not just an edge case reached by scrolling around.

---

### 4.11 Photographic hero — user redirect (supersedes §4.10's visuals) — ✅ done, SEEN in headless Chrome

The user looked at the page and said nothing matched their intent: the hero
should be **their photo `C:\Users\heman\Downloads\bg.jpg`** (split over/under
water: sky, waterline wave, sparkle, rays, deep blue, reef), layered so
scrolling reads as diving into it, toward the look of
`humpback-whale-vfx-grace-3d-model-6fe050572e.jpg` (two whales).

- **`src/components/DivePlate.tsx`** — photo at `src/assets/hero/dive-plate.jpg`. **One unbroken column** (a first version split the photo into three parallax bands; overlapping copies ghosted the sparkle and opened a dark stripe, so it was replaced): the photo "covers" the viewport anchored to the sky and travels up at `PARALLAX` 0.62 of scroll with a slight push-in around the viewport centre. Below it, a gradient of the photo's own deepest blue (`#06283f`) runs `DEEP_EXTENSION_VH` 1.1 and dissolves to transparent into the MarineSnow backdrop; the photo's bottom 12% fades over its opaque start. The handoff is spatial, not a timed cross-fade. Root hidden once fully passed. **Only writer of `preludeSignal.progress`** (1 while the photo fills the view → 0 as it passes), so rays/camera fade in as it leaves. Styles: `.dive-plate*` in `styles.css`.
- **Animated sky** — `sky-mask.png` (the photo's sky, traced along its real waterline, notches removed by 1D morphological closing) and `sky-strip.jpg` (sky band + its mirror, tiles seamlessly) drift inside the column at `SKY_DRIFT` 16 px/s (per 1600 px of photo width), only while the sky is on screen, never under reduced motion. Regenerate both with `node scripts/visual/generateSkyAssets.mjs` if the photo changes; `SKY_BAND` 0.36 must match `DivePlate.tsx` (measured waterline 9.5–28.5%).
- **Water darkens monotonically across the handoff**: ocean stops at 0.18 and 0.36 taken down to `#07304f/#021a30` and `#052642/#02162a` so the backdrop the photo dissolves into is never lighter than the photo's deep band.
- **Whale stays in frame** (`diveDirector.ts`, `KEEP_IN_FRAME_NDC` 0.45): if the whale's *screen* X passes 0.45 while heading outward, the director requests a turn. It was on screen only ~⅓ of the time (auto-turn at x=15, but the 16:9 frame is only ~±6 wide). `turnMinX` 5 → 2 in `whaleConfig.ts`, which otherwise refused those turns. Skipped when `whaleScreen` is invalid, so the sims are unchanged.
- **Water light** (`SceneLighting.tsx`): a hemisphere light, sky colour = `ocean.waterNear` lifted 30% to white, ground = `ocean.waterFar`, intensity `ocean.sun × 0.22` — the scattered light of the water itself, fading with the sun. The whale now reads lit (teal back, paler flippers, visible skin detail) instead of a dark cut-out.
- **`SURFACE_PRELUDE_ENABLED = false`** in `WhaleScene.tsx` — procedural Sky/Water prelude unmounted (files intact, agreed with the §4.10 session). WebGL camera holds its rest pose through the photo dive.
- **Ocean table re-sampled from the photo** (`oceanPalette.ts`): surface stop `#117da4/#054b78`, handoff stop `#0a3f66/#031d36`, deeper stops darkened; `rays` 0.45 at the handoff; every `surface` value 0 (the procedural surface rendered as neon ellipses). Surface stop lighting: rim 2.6, fill 0.25, ambient 0.08.
- **Whale grading**: base colour factor 0.55 (albedo was pale grey → milky cut-out), envMap 0.5 at the surface.
- **Whale depth vs the photo**: screen height from top = (1.4 − y)/6.8 with the camera at y = −2; the photo waterline is ~45% down. Score shifted deeper and monotonic: hero −2.2, then −2.4 / −2.9 / −3.2 / −3.8 / −4.6. **Nudged deeper again** (2026-09-13, user redirect): hero −2.2 → −2.6, "the approach" −2.4 → −2.8 — the origin sat just under the sparkle already, but the pitched, forward-carried nose still poked into the waterline blur; both moved by the same amount so the dive stays monotonic. Rest of the score untouched.
- **Whale start depth** (`whaleAnimator.ts`): the first composed depth seeds `core.y` once, only during the reveal swim-in (otherwise an idle page took 12 s+ to sink off the waterline). No-intent path untouched — **S: 0.00 divergence**; director sim still 1/1/1 · 0 up.

**Visual verification now exists.** `scripts/visual/cdpDive.mjs <outDir> <url> <vh,vh,...>` drives headless Chrome over CDP (no deps, Node 22) and screenshots at scroll depths in viewport heights; `cdpDiagnose.mjs` adds console/exception/network/canvas state. Wait ≥13 s for the GLB/HDRI before judging a frame. Headless uses SwiftShader, so `frameBudget` degrades there — camera and snow differ slightly from a real GPU.

**Still open from this redirect:**
- After ~25 s at the top the whale's repeated keep-in-frame turns bring it very close to the camera: it fills the frame, is cropped, and crosses the "FULLSTACK DEVELOPER" text. Dramatic and close to the reference's near whale, but may want taming — try hero `stageZ` 0.35 → 0.15 in `diveScore.ts`, or `KEEP_IN_FRAME_NDC` 0.45 → 0.55 (fewer turns, less lane drift toward the camera). Awaiting the user's call.
- The reference has **two whales** — §4.8 companion whale. ⚠️ Extra trap beyond §4.8's material note: `WhaleModel` mounts `nodes._rootJoint` via `<primitive>`, so a second instance would *steal* the lead's skeleton. The companion needs `SkeletonUtils.clone(gltf.scene)`, its own mixer, cloned material + own depth uniforms.
- "FULLSTACK DEVELOPER" 3D text (`src/utils/Text.tsx`) crosses the photo's waterline and the whale — reposition or restyle.
- `dive-plate.jpg` is 2.2 MB unoptimised; ship a ~1920px WebP/AVIF.

### 4.12 Footage hero as extracted frames — ⛔ SUPERSEDED by §4.13 (user: "just the video"). `DiveSequence.tsx`, `public/dive/`, `extractDiveFrames.mjs` and `media-src/extract.html` were deleted. Kept below for history.

The user generated `C:\Users\heman\Downloads\1789305654841-0w6ss5nb7yio.mp4`: 8 s, 24 fps, 2144×1440 (3:2), starting on the `bg.jpg` composition and descending straight down (no pan/tilt) through the waterline into deep blue. No fish, whales, text or watermark. It now *is* the hero; the still-photo `DivePlate` remains as the automatic fallback.

- **Frames, not `<video>`** (seeking stutters). `scripts/visual/extractDiveFrames.mjs` uses headless Chrome's decoder + canvas (ffmpeg is not installed) to write `public/dive/{desktop,mobile}/fNNN.webp` — every frame for the first 2.5 s, every 2nd after: **126 frames, 6.5 MB desktop (1600 px) / 2.4 MB mobile (900 px)** — plus `public/dive/manifest.json` (source indices, per-frame waterline for frames 0–23, band colours through the dive). It also regenerates `sky-mask.png`/`sky-strip.jpg` from the video's frame 0 so the sky overlay aligns exactly. Source copied to `media-src/dive-source.mp4` (gitignored; served same-origin by Vite via `media-src/extract.html`).
- **`src/components/DiveSequence.tsx`** (mounted in `Layout.tsx` in place of `DivePlate`): fixed canvas, cover-fit anchored to the sky, frames loaded coarse→fine (first/last, then every 16th, 8th…), nearest-loaded frame drawn with a cross-fade to the next. Scroll mapping: dive plays over `DIVE_VH` 2.2 viewport heights; the first `HEAD_SCROLL` 0.35 of that covers the first `HEAD_TIME` 2 s (the waterline pass), the tail moves faster. Falls back to `<DivePlate/>` if the manifest can't load.
- **Never frozen at the top**: idle swell rocks the first `BOB_FRAMES` 2 source frames (5 s period, eases in after 1.2 s still; measured waterline 15.8% → 12.4% of frame). The drifting sky overlay that was also layered on the footage was **removed at the user's request** — the hero is the footage alone. (`sky-mask.png`/`sky-strip.jpg` remain, used only by the `DivePlate` fallback.)
- **Handoff**: last frame holds and fades over `FADE_VH` 0.8 into the live ocean. Ocean stops re-sampled from the footage: 0.18 → `#025a8e/#001e3f` (~2 s), 0.36 → `#01416f/#000f28` (last frame). `preludeSignal.progress` (this component is the only writer) stays 1 through the footage, which has its own rays, and falls across the fade.
- Verified: T, B (`dist/dive` 9.5 MB, 126+126 frames), director/animator sims unchanged. Headless frames at 0 / 0.1 / 0.3 / 0.5 / 0.8 vh, Marvella, 2.2 vh and FutureSpace show the dive, the whale throughout, and no colour jump at the handoff.

**Open:**
- Payload: 6.5 MB of frames on desktop. Consider AVIF, or dropping to every 3rd frame in the tail, if first-load matters.
- 3:2 footage crops top/bottom on 16:9 screens (anchored to the sky, so the deep is what's cropped).
- `scripts/visual/cdpDive.mjs` still reports `plate: missing` — it queries `.dive-plate`; the footage hero uses `.dive-seq`. Harmless.
- The hero whale-too-close question (§4.11 open list) still stands.

### 4.13 Video hero — the dive video itself, scrubbed by scroll — ⛔ SUPERSEDED by §4.14 (live ocean)

The user asked to drop the frame sequence and use the video, high quality and smooth, not choppy.

- **Why the original can't be scrubbed smoothly** (ffprobe): H.264 with keyframes only at frames 0, 85, 124, 158, 183 — up to 3.5 s apart, so every seek decodes dozens of frames.
- **All-intra re-encode** (`scripts/visual/encodeHeroVideo.mjs`, ffmpeg via `npm i ffmpeg-static` — not installed system-wide): every frame a keyframe (`-g 1 -bf 0`), `+faststart`, no audio. `public/hero/dive.mp4` 1920 px CRF 19 (**19.4 MB**), `dive-mobile.mp4` 1080 px CRF 21 (**5.6 MB**), `dive-poster.jpg` (0.25 MB). ffprobe: 192/192 keyframes in both.
- **Measured seek latency** (headless Chrome, 40 identical random seeks): original **97 ms mean / 197 ms p90 / 284 ms max** → all-intra native-res **19 ms mean / 22.5 ms max** · shipped 1920 px CRF 19 **16.8 ms mean / 34 ms p90 / 80 ms max** (one outlier on headless SwiftShader) · mobile **6.6 ms mean**.
- **`src/components/DiveVideo.tsx`** (in `Layout.tsx` in place of `DiveSequence`): fetches the whole file into a blob URL (seeks never hit the network), poster until then; the shown time eases toward the scroll target (`FOLLOW_RATE` 9/s) and a new seek is issued only after the previous `seeked` — no seek backlog. iOS unlock via muted play→pause on metadata. `object-fit: cover`, anchored to the top. Same pacing (`HEAD_SCROLL` 0.35 → first 2 s), `DIVE_VH` 2.2, `FADE_VH` 0.8 fade into the ocean, and still the only writer of `preludeSignal.progress`. Falls back to `DivePlate` if the video can't load. No idle swell or sky overlay — the hero is the video alone.
- Verified: T; headless frames at 0 / 0.2 / 0.5 vh, Marvella, 2.2 vh, FutureSpace show the video, the whale throughout, no jump at the handoff.

**Open:** the desktop video must fully download (19.4 MB) before scrubbing starts — the poster covers it, but on slow connections the first scroll can arrive before it's ready. Options if that matters: a lighter first encode (CRF 21 at 1920 was 15.0 MB) or streaming playback until the blob lands.

### 4.14 Live ocean + scroll story — user redirect (supersedes §4.13) — ✅ done, SEEN in headless Chrome on the real GPU

The user asked (2026-09-25) to remove the video hero, keep the sky, and make the over/under water and the whale's dive "as realistic as possible", pointing at willeastcott/webgpu-water-playcanvas (Evan Wallace's WebGL Water). Mid-task they added storytelling.noomoagency.com as the experience they want: scroll as a timeline, one creature performing a move per chapter, short phrases that assemble word by word out of a blur.

**The live sea** (`src/components/ocean/`, state in `src/animations/waterSignal.ts`):
- `WaterSimulation.ts` — Evan's heightfield on ping-pong float targets (512² desktop / 256² mobile, 40×40 world units centred ahead of the camera): pointer drops along the drag segment, wave step at a fixed 60 Hz with an edge sponge, slopes, and caustics by the differential-area method (384² grid → 1024² texture). The whale displaces water through 8 spheres riding its spine bones (`BODY` in `Ocean.tsx`; radii for a ~21-unit whale), so the tail breaking the surface moves water.
- An analytic 16-wave wind sea (`WAVES`, golden-ratio directions so caustics form a web, not a lattice) is evaluated identically in every shader; the sim ripples add on top.
- Sky: Poly Haven `kloofendal_48d_partly_cloudy_puresky` (CC0), upper hemisphere only, `public/sky/sky-6k.jpg` (0.54 MB) / `sky-4k.jpg` (mobile). Its sun was measured from the HDR (47.9° up, u 0.595); `SUN_DIR`/`SKY_YAW` put it front-right so glints, caustics and the sky agree.
- Over/under: each pixel's medium is decided where its ray leaves a virtual flat PORT 1.25 units in front of the lens (a dome bowed the waterline into a smile). Sky draws only for air pixels; the surface shades from above (Fresnel, sky reflection, sun glint, subsurface on backlit crests, horizon haze) or from below (Snell's window, TIR mirror, fog to the MarineSnow backdrop); `waterlineFragment` draws the meniscus. While the waterline is in frame the long swell at the port is cancelled (the camera "rides" it), or crests flood the lens.
- THE DIVE IS THE WATER RISING: camera rest pose and whale depths are untouched; `DIVE_KEYS` raises the surface from just above the eye (hero) out of sight by ~5 vh. `Ocean.tsx` is now the only writer of `preludeSignal.progress` (= fraction of frame in air).
- Whale material (`whaleCaustics.ts`, chained `onBeforeCompile`): caustic web lookup (softened away from the traced plane) + distance haze, both only while the sea is active. `LightRays` now masks itself to water pixels instead of waiting for the prelude. `BubbleWake` pops bubbles at the live `waterSignal.level`.
- Dev switches (dev server only): `?caustics=0`, `?causticView`.

**The story** (`src/animations/story.ts`, `src/components/Story.tsx`, `src/animations/whaleChoreography.ts`):
- Hero title is DOM now ("Fullstack *developer*", Instrument Serif italic from Google Fonts); the 3D `Text` is unmounted. A 5.2 vh spacer after `#home` holds 4 chapters; words are scrubbed per frame (opacity/blur/lift). **Copy is Claude's draft — needs the owner's words.**
- The whale is choreographed through the story: a Hermite path through `MARKS` keyed to scroll (dive → close pass under chapter 1 → dwindles into the blue → turns and comes at the lens → dives under the camera), facing along the path and banking into turns, tail beat from scroll speed, x compressed on portrait screens. Physics is re-seeded onto it every frame via the new `animator.follow()`, and the story hands back to the physics whale over 4.95–5.5 vh, so projects and the director are unchanged.
- `depthProgress()` counts the story at 25% of its length for the depth curve, so projects keep their zones.

**Removed:** `DiveVideo.tsx` and the `.dive-video`/`.dive-plate` CSS. The encodes moved from `public/hero/` to `media-src/retired-hero-video/` (gitignored, not deployed; 26 MB off the build). `Surface.tsx`, `SurfacePrelude.tsx` and `utils/Text.tsx` are unmounted but kept.

**Verified:** T, B (dist has no video). Headless Chrome on the GTX 970 (ANGLE/D3D11, not SwiftShader — see the scratch `shot.mjs` flags `--use-angle=d3d11 --enable-gpu`): 60 fps at 1600×900 through the whole story; 390×844 mobile layout; scroll back to top rewinds to the hero pose; projects and footer unchanged.

**Reference match (same day, owner's split-level photo):** eye lowered to -0.62 so the waterline sits in the top fifth and the underside band dominates; mid/short waves steeper (a*k 0.078); stop-0 water resampled from the photo (`#0a5d8f`/`#03325a`, deep blue not teal); underside mirror darker with teal crest light; micro-facet SPARKLE on the underside; a sunlit glow band under the surface, drawn in the sky pass at the far plane (behind the whale); god rays at 45% in the opening; sky exposure 1.1.

**Sky swap (same day):** the panorama is replaced by the owner's own flat sky photo (`public/sky/sky.jpg` 0.26 MB, `sky-mobile.jpg`), laid over the dome by angle (`SKY_FRAME` in waterSignal.ts: 122 deg wide centred ahead, from 4 deg under the horizon), mirrored past its edges, hazing to `uHorizonColor` near the horizon. The sun (`SUN_DIR`) is now independent of the sky image. Eye raised back to -0.44 so the sky fills ~20-33% of the opening frame. Old panorama in `media-src/retired-sky/`.

**Open:** story copy; tune `MARKS` per taste; not yet seen on Safari/iOS or a low-end phone; `frameBudget` only halves caustics — if mobile struggles, drop the sim to 128² and skip caustics there first.

### 4.15 Swim clip rebuilt — ✅ done, SEEN in headless Chrome on the real GPU

The owner asked (2026-09-25) for the whale's animation to be "as realistic as possible" for diving and swimming. The Sketchfab clip bent all four spine bones in unison (no travelling wave), beat at 0.1 Hz while `clipBaseHz` claimed 0.35, swung the fluke tip 0.33 L peak to peak, and flapped the flippers asymmetrically through ~60°.

- **Generated clip** (`scripts/whale-clip/swim_clip.py`, see its README): a dorso-ventral travelling wave (λ 1.05 L, envelope r^2.6 behind 0.38 L so the thorax stays stiff and the peduncle does the work), fluke tip ~0.2 L peak to peak, fluke pitch tracking heave velocity (90° lead, quick flip at the stroke ends), an ~8% quicker upstroke, a head recoil nod, flippers held as hydroplanes with lagging passive flex and slow trim, and slow drift in vigour, course and fluke roll. Posed from the bind pose; Bone_00 is never keyed, so the site still owns the body's attitude. 7 strokes per 40 s loop, seamless. The mesh, skin, textures and nodes in the GLB are byte-identical; the original is in `media-src/humpback_whale.original.glb`.
- **Config made truthful:** `clipBaseHz` 0.35 → 0.175 (what the clip really shows), and every other Hz halved with `strokeDistance` doubled (3.21 → 6.42). Checked in a headless animator sim (60 s, bursts, an arch, intent on and off): with `counterPitchAmp` zeroed in both builds, `tailSpeed`, the core path and orientation are bit-identical. The ONLY behavioural change is that the body's heave and counter-pitch now run at the visible stroke rate instead of 2× (before: 3.5×) it.
- Visible beats: hero rest 0.07 Hz, story idle 0.13 → 0.4 Hz when scrolling fast, cruise 0.175 Hz, burst 0.58 Hz.
- Before/after page: `scripts/whale-clip/compare.html` (dev server).

**Open:** heave/counter-pitch match the stroke's frequency but not its phase (the choreography drives `tailSpeed` itself, and the hero freeze resets `strokePhase`). Locking them would mean feeding the action's time back into the animator. A separate fluke-up "sounding" clip (arched back, flukes lifted clear) would suit the hero dive; it needs a weight blend in WhaleModel, not just a second clip, since every action is played.

### 4.16 Photographic water: shafts, whitewater, spray, grade, floating port — ✅ done, SEEN in headless Chrome on the real GPU

The owner (2026-09-25) pointed at an over/under humpback photograph (whale just under the surface in a milky turquoise bubble cloud, underside of the surface full of white glints, deep navy below, `#011427` at the bottom and `#02577e` mid-water) and asked for that level of splash/bubble detail, grading and light rays, water "reflecting light when splashing", and a starting angle "more floating out of the water". Then: "the whale seems a bit shiny when in depth".

- **Floating port** (`waterSignal.ts`, `Ocean.tsx`): opening eye -0.44 → -0.16, so the waterline rides across the middle of the frame (~40%) instead of the top third. While `air > 0` the camera rolls/pitches with the swell's slope at `SWELL_POINT` (`FLOAT_TILT` 0.45 of it; `ambientSlope()` is the CPU twin). Rotation is reset to zero once under; none under reduced motion. The fluke now stands out of the water in the hero.
- **Foam field** (`WaterSimulation.updateFoam`, `foamFragment`): a 256² (128² mobile) ping-pong target; R = surface foam (τ 2.6 s), G = bubble cloud (τ 3.6 s, spreads faster). Fed by sim churn, a collar wherever a body sphere cuts or runs just under the local surface (heavier with speed; `whaleBody.velocity` is new), and splashes. Drifts with the wind. `?foamView` shows it.
- **Surface shader**: foam lace from above and below (`foamPattern`, thresholded tileable noise from `oceanNoise.ts`, generated at load); crest whitewater and backlit glow on the wave that swamps the lens; GLITTER — hand-sized facets refracting sky/sun, gated to outside Snell's window (`mirrorish`) so looking straight up doesn't turn to snow.
- **Volume pass** (`underwaterVolume.tsx`, in the EffectComposer after N8AO): half-resolution raymarch (24 steps desktop, 12 mobile) from the port to the depth buffer / surface / 34 units. Shafts = the live caustics (mipmapped now) read back up the refracted sun, from 0.3–2.4 units down, HG phase g 0.55. Bubble cloud = foam G × depth profile × billow noise, absorbing and glowing. Composited premultiplied (canvas is transparent over MarineSnow). `?shafts=` / `?cloud=` scale each. The 2D `LightRays` now yield to it (× (1 − 0.85·presence)).
- **Spray** (`Spray.tsx`): CPU droplets drawn as velocity streaks (1/30 s shutter) that blaze when backlit (ball-lens term) and flash; thrown where the body cuts the surface, drained off whatever is out of the water (the raised fluke drips in streams), and by a press on the water (`pendingSplashes` → foam + ripple + `sprayBursts`). Fine bubbles along the collar, off near-surface motion, where spray falls back, and drifting in the top 4 units. Dev: `__splashAt(x, z, strength)`, `__sprayDebug`.
- **Whale out of the water** (`whaleCaustics.ts`, `uAirLight`): daylight + wet sun highlight + sky sheen above the local level; was a black cut-out.
- **Grade** (`oceanGrade.tsx`, last in the composer): navy composited UNDER the canvas toward the bottom (darkens the painted water, not the whale), vignette over, film grain; all × presence, so projects are untouched.
- **Shine at depth**: submerged skin is nearly matte (skin/water index contrast ≈ 0.07% reflectance), so clearcoat 0.6 → 0.12, roughness ≥ 0.84, `specularIntensity` 0.4 → 0.15 with depth, env 0.1. The whale-tracking point light 36 → 14 and now falls with the ocean table's `sun`² (it was a "sunbeam" hotspot at 200 m). Caustics on the skin roll off instead of squaring (they burned to white streaks).

- **One light, one angle** (owner: rays "going right and some left, as if the light is on both sides"): `SUN_AZIMUTH` 28° → 70°. Shafts are parallel along the refracted sun, so in perspective they radiate from the sun's point in the image; at 28° that point sat just above the frame and the shafts fanned both ways. At 70° it is off the right edge (x ≈ 1.8 NDC at 16:9, 1.4 at 21:9; only a 32:9 ultrawide brings it back inside), so all shafts lean top-right → bottom-left. Don't bring the sun back toward the view axis. The 2D `LightRays` are now fully off while the live shafts are up (× (1 − presence)) and come from `top-right` in the deep, the same side.

- **No streaks in the cloud** (owner: "on the whale the rays are going opposite direction"): the bands across the whale were the BUBBLE CLOUD, not the shafts — its billows were 2D noise sheared with depth, i.e. constant along one slanted 3D line, which reads as streaks leaning against the sun. Now true 3D value noise from one read of a lattice texture (`createNoise3D` / `NOISE3D_GLSL` in `oceanNoise.ts`, Quilez's 2D-texture method). Never shear 2D noise through a volume again.
- **Toned down + web perf** (owner: "too much god rays and smoke, decrease a little, optimize"): shafts 0.0035 → 0.0027, cloud density 1.0 → 0.7 and a dimmer lit colour; volume 16 steps (10 when `frameBudget.degraded`, which also drops the cloud; mobile 9/6), reach 28; spray pools 1000/600 (mobile 400/200), particles test in/out of the water against 4 waves not 8, and upload/draw nothing while none are alive; canvas DPR capped at 1.5 on desktop as well as mobile (was 2). 1920×943: 54–56 → 60 fps at 0.6–1 vh.

**Verified:** tsc, `npm run build`; 60 fps at 1600×900 at 0, 0.12, 0.25, 0.4, 0.6, 1, 3, 5.5, 7, 12 vh (the full-res volume was 47–51 fps at 0.6–1 vh, hence half res); 390×844 at 60; projects and scroll-back unchanged.

**Open / tune:** splash strength and drop sizes are guesses (`SPRAY_RATE`, `DRAIN_RATE`, sizes in `throwWater`); the whitewater around the hero whale is modest because its pose only has the tail at the surface — a pose with the back awash (like the reference) would show the cloud properly. The D3D "gradient instruction in a loop" warning is cosmetic. Not yet seen on Safari/iOS.

### 4.17 Projects as chapters, one move each — ✅ done, SEEN in headless Chrome on the real GPU

The owner (2026-09-25): the projects' fonts "not displaying correctly with the background"; add a unique, storytelling animation per project; "find the best way to present them". Replaces the codrops On-Scroll Filter items (the circle dissolve, four grid layouts, faux-italic periwinkle Montserrat titles, bare screenshots with feathered edges).

- **Chapters** (`src/components/projects/`): `ProjectChapter` is a `CHAPTER_VH` = 2 viewport section with a sticky one-viewport stage. Everything is a pure function of `t` (scroll since the section's top met the viewport bottom, in vh; score in `T`): plate/name 0.5–1.0, reveal 0.62–1.42, hook 0.92–1.28, details 1.1–1.44, words dissolve 2.0–2.42, frame recedes 2.0–2.9. Centre (snap + station key) is t = 1.5, after everything has arrived. `SNAP_PROXIMITY` 0.5 = exactly the pinned span, so stopping anywhere on a pinned chapter settles on its finished frame. Still registered as stations; the director and beats are untouched.
- **Type**: the story's voice everywhere — name in Instrument Serif italic (per-letter spans need `font-family: inherit`, the universal `*` Montserrat rule otherwise fakes an italic sans), hook in Montserrat 300 with pale-cyan serif accents, written by the shared `animations/words.ts` (`writeWords`, also used by Story, the intro and the Statement). UI blue now only on hover/focus.
- **Frame** (`reveals/Frame.tsx`): dark-glass browser chrome with the real address; the whole frame links to the site.
- **Plates read the ocean**: each chapter samples `sampleOcean(depthFromScroll(depthProgress(centre)))` on refresh, so the number always matches the light (the hardcoded 200 m etc. had drifted: Marvella sat at ~470 m).
- **The moves** (`reveals/`, each a pure `render(p, reduced)`): Marvella DRIVE (drives in from off-screen, skew + static-blur ghost, headlight beams, brake, headlight sweep); FutureSpace SHELVES (empty dashed slots, 4×5 tiles drop in with a settle, lock together, full image covers seams, gloss); Konzé CALENDAR (month flips up in Konzé's palette, holidays navy → bridge days green → weekends, rings + "2 days of leave → 9 days off", pages tear off in date order); Artisanal BRUSH (paper, boustrophedon brush mask with streaky displacement, wet terracotta lead, mask dropped when done); KinderGarden PLAY (site palette blobs pop in elastically, swell into windows, merge). Reduced motion: plain fade, final state.
- **Intro** "Five projects, *five depths.*" and the **Statement** restyled into the same voice (copy unchanged, accents added).
- **Sharpness** (owner: Artisanal/KinderGarden "blurry/pixelated"): the screenshots are whole pages shown at ~⅓ scale. Each chapter now requests its image at the frame's device-pixel width (`imageWidth()` in ProjectChapter, 200 px steps, capped at the original) so Cloudinary does the downscale instead of the GPU; frames drop their transform at rest and `.pframe` has no `will-change` (it pinned the raster at the 0.955 entrance scale); the SVG-masked reveals (brush, play) hand off to a plain `<img class="rv-sharp">` when done, since Chrome rasterises SVG `<image>` soft on high-DPI screens.
- Dev: `?nosnap` holds any scroll position. Retired `ScrollFilterItem.tsx` / `useWhaleWake.ts` → `media-src/retired-projects/`; `frontPass` now looks for `.project__visual`.

**Verified:** tsc (except the concurrent whaleChoreography unused-constant errors), `vite build`; 60 fps (worst frame 16.9 ms) sweeping every reveal at 1600×900 and 390×844; 1366×768 layout; snap lands at t 1.5; reduced motion.

**Open:** all project copy is Claude's draft (facts from live sites/repos: FutureSpace = Odoo, KinderGarden = Laravel, Konzé/Artisanal static 2024); marvellacarrental.mu returned "Database Error" on 2026-09-25; not seen on Safari/iOS (uses `cqw`, `overflow-x: clip`, `color-mix`).

### 4.18 The way home ends in a breach — ✅ done, SEEN in headless Chrome on the real GPU

The owner (2026-09-25): scrolling back to the top has to leave the whale where it started, by "a jump and dive from right to left". Before, the way home glided under the surface and tipped nose-down, and a jump back from the projects swam the whole story backwards for 8+ s while the hero was already showing.

- **HOME** (`whaleChoreography.ts`, `HOME_MARKS`) is still the close pass swum back, then a descending turn away from the lens on the left and a crossing of the deep to the lower right. It now ENDS there (u = 0 is the run's start, heading right), not at the opening pose. The route-mode rest logic (settle, turn reset, turn allowance) now applies only to OUTWARD at u ≈ 0.
- **THE LEAP** (time-driven, `Leap`, `beginLeap`/`endLeap`): triggers when the page is ≤ `BREACH_AT` (0.3 vh) and the whale is on HOME facing home, or further out on OUTWARD than `HOME_JOIN + SHORTCUT_PAST` (then a Hermite shortcut from wherever it was DRAWN, physics whale included). Three phases: swim (rest of HOME or the shortcut, then `RUN_MARKS` + a straight run up the launch line; speed plan from turn limits, `RUN_ACCEL`), flight (ballistic, `LEAP_HEIGHT` 6.5, `LEAP_ANGLE` 62°, g 11.5; pitch is `AIR_SPIN` 0.6 steady spin / 0.4 along the arc), dive (quadratic Bézier from the entry through `PLUNGE_CORNER` onto the rest pose's own line, cubic ease-out, the spin carries the nose to -70°). It ends exactly in `REST_Q` at the first mark, then hands back to OUTWARD at u = 0. Built backwards from the rest pose, so moving the rest pose moves the whole leap. Called off (`BREACH_CANCEL` 0.6) only while still on the HOME part of the swim.
- Start differences (drawn pose vs plan) are carried in `leapShift`/`leapTwist` and eased out, so it never jumps. `WhaleModel` passes `drawn` (last frame's group pose) and `surfaceY` (sea level at the page top, moved into the `<Center>` rig).
- `holdCrash()` (waterSignal): no lens-swamping wave during a breach (one hid the apex in the first test).
- Dev: `window.__whale` (world/chor position, yaw/pitch/roll, weight).

**Verified:** tsc; 1600×900 scroll-back 2.2 → 0 vh (breach ~4 s after the page reaches the top, settled ~8 s), fast return from 8 vh (shortcut from the physics whale, no jump, settled ~7.5 s after the top), 390×844 (x compressed, leap fills the frame).

**Open:** the wind-up (loop + crossing) before the breach is ~3–4 s on a fast scroll-back; shorten `HOME_MARKS` if it feels long. PRE-EXISTING, not from this: after any scroll round trip the bubble cloud (`?cloud=0` removes it) leaves the water milky and the whale washed out at the hero, and a white band sits at the waterline, much stronger on mobile; the first load is clean. Not yet diagnosed (suspect sim churn / collar feed while the level sweeps past the whale).

### 4.19 The swim-by: chapter 4 written in the whale's wake — 🟡 working, SEEN at 1600×900; tuning left

The owner (2026-09-25): when "Come and see what's down here" is revealed, the whale should "pass through the camera close-up… like a swim-by and reveal the text after it passes by like a nice transition".

- **Route** (`MARKS` in whaleChoreography.ts, 3.5–5.3): after chapter 3 the whale comes in along the lower-left corner, turns out of frame beside the lens, then crosses LEFT TO RIGHT right in front of it (chor z ≈ 10.2–10.4, about 5 units from the lens; y ≈ 3.8–3.9, eye level), stays level until the flukes clear the right edge (4.52), and only then dives out of sight and loops back under the frame into the first project's shot (5.3). Camera in chor coords ≈ (5.23, 4.15, 15.24): the `<Center>` rig offset measured as world − chor = (−5.23, −2.15, −5.24).
- **`SWIM_BY` = [3.8, 4.55]** (story.ts): the window, in the WHALE's progress, not the page's. It lags the page by ~0.3–0.4 vh on a normal scroll, so the text has to follow the whale.
- **Narrow screens**: the choreography's `lateral` x-squeeze is let go over `SWIM_BY_EASE` (0.3 vh) either side of the window (`lat` in `update()`), otherwise portrait would park the whale in front of the lens.
- **Signals**: `ChoreographyFrame.progress` (u on OUTWARD, −1 on the way home or breaching) → `storyWhale` in story.ts (written by WhaleModel). New `src/animations/whaleOutline.ts`: the whale's outline as screen-space discs (spine bones, flipper bones, and fluke tips at ±3.3 along the body's side axis), written from WhaleModel each frame. Dev: `window.__whale.progress`.
- **Words** (Story.tsx, words.ts): `wordPhase`/`writeWord` split out of `writeWords` (same output for existing callers; `writeWord` takes an x `drift`). Chapter 4 has `wake: true`: each word's entrance = min(page gate over start..arrived, "the whole outline is past this word" = trailing edge − word right edge, over `WAKE_FEATHER` 0.17 vw), words drift in from −0.9 em. At the end of the window `done` forces them on. Chapter 3 (and any non-wake chapter live in the window) is wiped where the body's discs come over it and stays gone once the whale is past (`reach`/`past`). Scrolling back is symmetric: the whale swimming back erases chapter 4 and re-reveals chapter 3 behind it. With no whale (no WebGL, stale signals > 500 ms) the old scroll schedule runs.
- **Retimed**: ch3 arrived 3.55, leave 4.1, gone 4.35; ch4 start 3.95, arrived 4.2 (leave/gone unchanged 5.02/5.32).
- Backup of `src` before this: `G:\claude-temp\portfolioackup-swimby\src`. Probe: `G:\claude-temp\portfolio\probe.mjs <out> <fromVh> <toVh> <secs> [shotMs]` (sweeps the scroll, logs `__whale`, `OVERLAY=1` draws the outline discs and the trailing edge); `sheet.py <dir> [start] [n]` makes contact sheets.

**Verified:** tsc; 1600×900 sweep 3.3 → 4.9 vh in 6 s: the head enters left at mid-frame, the pale flipper and flank sweep across, "Come / what's" appear behind the flukes, then the rest; no text drawn over the body.

**Left to do (in order):**
1. **Nose-up look.** The body reads ~15–20° nose-up while crossing although the route is level (logged pitch ≈ 0). Measured: the head-bone→fluke-bone line sits ~22° above the group's nose axis, the same with `?flex=0`, so it is the model/clip posture, not spineFlex. Either add a small nose-down pitch bias over SWIM_BY in the choreography, or check whether the hero/other shots were tuned around it (don't change it globally without looking).
2. **Bank at the crossing.** Roll is still −0.46 rad at u 4.10, left over from the U-turn; it decays by ~4.3. Decide by eye: finish the turn earlier (move the 3.9 mark further left/out) or keep a deliberate small roll toward the lens.
3. **Mobile (390×844)** and **1366×768** not checked yet. Watch the sideways slide while `lat` eases (3.5–3.8 and 4.55–4.85) and that the flukes really clear the frame.
4. ~~**Timing feel.**~~ Done in §4.20: leave/gone 5.1/5.4, and the scene rests at 4.8.
5. **Handoff to physics** starts at 4.95 with the whale further right/deeper than before (loop via (27,−8,3) → (10,−11,−6)). Check the first project's shot still settles on time.
6. Scroll-back from the projects to the top (THE LEAP / shortcut) and reduced motion not re-checked after the route change. Optional polish: a few bubbles off the flukes during the pass, a slight camera bump in the wake.

### 4.20 The story in scenes: one scroll, one chapter; the swim-by on the whale's clock — ✅ done, SEEN in headless Chrome on the real GPU (real wheel, touch and key input)

The owner (2026-09-26): chapter 4 "doesn't show when it's too fast"; wanted a snap "that will keep everything a smooth experience and not expect the user to be at the exact position". A first pass settled the page only once scrolling stopped. The owner then clarified: reaching "Beneath it lives" should snap to the whole text, "so that every scroll reveals the exact scene that was wanted to be portrayed".

**Why chapter 4 didn't show:** it is written by the whale (§4.19), which lags the page by 0.3 vh on a gentle scroll and several vh on a fast one, but it left on the PAGE's clock (5.02–5.32). A fast scroll finished the exit before the whale arrived, so nothing was ever written. A stop short of ~4.55 left the whale mid-crossing, with the right-hand words never written. Chapter 3 had the mirror problem: it left on the page's clock (4.1–4.35), so on a fast scroll it was gone before the whale could wipe it, leaving an empty frame.

- **Scenes** (`story.ts`): each chapter has a `rest` (vh), where the phrase is whole and the whale is on its mark: 1.35 / 2.55 / 3.65 / 4.8. `STORY_BEATS` = hero 0 + those; the projects' intro (centred, 6.2 vh) is the last scene. Keep ch3's rest < `SWIM_BY[0]` and ch4's > `SWIM_BY[1]`.
- **`src/utils/ScrollBeats.tsx`** (new; mounted in `Layout.tsx` after `SmoothScroll`; replaces the snap that lived in `Portfolio.tsx`). Between the hero and the intro, ONE GESTURE = ONE SCENE. A wheel flick, any number of notches, a trackpad swipe with its momentum, a touch swipe (≥ 24 px) or ↑/↓/PgUp/PgDn/Space glides the page (easeInOutCubic, ~1–1.1 s) to the next or previous scene. The rest of the gesture is swallowed: a gesture ends after 180 ms of quiet, or on a clearly harder push through the tail of the last. Input reaches it through Lenis's `virtualScroll` option (`setScrollInput` in SmoothScroll.tsx), so wheel and touch are caught before Lenis or the browser scroll; touchmove is preventDefault'ed there (no native scroll or momentum). Scrolling up out of the projects stops on the intro. Down from the intro the page scrolls freely again. Inactive while the header menu is open.
- **A scene is not left before it's shown:** a chapter is left only once the whale has at least reached the chapter before (never more than one scene behind: it swims each scene in 2–4 s), and the swim-by chapter only once the whale has crossed (`u ≥ SWIM_BY[1]`). Both give up 4 s after the page came to rest (`SCENE_WAIT`). A gesture held by either is not spent, so if the visitor is still scrolling when it lets go, the scene plays then. Going up is never held.
- **Settling** (same file) covers everything that moves the page without a scene (scrollbar thumb, Home/End, menu links) and the projects: 150 ms after scrolling stops it glides to a beat. Hero → chapters → intro → first project are a chain (a stop between two goes to one: `COMMIT` 0.15 from the beat it left, nearest for a beat it flew past); project centres keep the old ±0.5 vh pull, so the gaps, the statement and the footer scroll freely.
- **Fixed a latent bug:** Lenis never calls `onComplete` on an animation that gets interrupted. The old Portfolio snap then left its local flag and `setSnapping(true)` stuck, so snapping stopped for good and the physics whale ignored scrolling for the rest of the session. Glides are now tagged `userData.beat` and also end on the first Lenis scroll frame that isn't theirs. That listener runs after ScrollTrigger's, so a settle's last frame still doesn't read as the visitor scrolling. Only settles set the snapping flag; a scene is the visitor's own scroll. `?nosnap` disables all of it.
- **Swim-by on the whale's clock** (`Story.tsx`): ch3 is `wiped`. It LEAVES at `min(page, whale)`, so it holds until the whale's body comes over it however far ahead the page is. Every chapter is also capped by the last chapter's page exit (`end`), so nothing is ever left over the projects. Ch4 retimed: leave/gone 5.02/5.32 → 5.1/5.4 (the intro starts writing at 5.5).

**Verified:** tsc, vite build; scratch probe `wheel.mjs` (CDP wheel/touch/key input through Lenis, not the scrollTo sweep).
- 1600×900: one notch each goes hero → 1.35 → 2.55, phrases whole.
- A continuous 30-notch spin from 2.55 plays exactly one scene (→ 3.65). It was held ~0.3 s for the whale, then fired mid-spin.
- At 4.8, notches while the whale was still coming were held; ch4 was written ~3 s after landing.
- A decaying trackpad flick 4.8 → 6.2 had its momentum swallowed.
- ↑ from the intro → 4.8; ↑ → 3.65; ↓ → 4.8.
- Interrupted settles release the flag at once.
- 390×844 touch: 200 px and 60 px swipes step one scene each way; a 10 px twitch does nothing. No console errors.

**Open / tune:**
- Paging 4 → 3 → 4 within a few seconds catches the whale mid-turn (it had started swimming back): neither phrase shows for ~3–4 s until it comes past again.
- Going back up from ch4, ch3 stays empty ~3 s while the whale swims back across the frame and ch3 re-forms behind it (the §4.19 symmetric design).
- The whale holds (up to 4 s) are deliberate; if they feel unresponsive, lower `SCENE_WAIT` or speed up the choreography's catch-up (`CATCH_UP_*`).
- Not yet tried by hand on a real trackpad (gesture detection is `GESTURE_GAP`/`NEW_PUSH`), iOS Safari (URL-bar and `innerHeight` vs CSS `vh`), or Firefox. Under reduced motion Lenis makes each scene an instant cut.

**Words at a reading pace (same day, owner: "make the wording still seem to slowly appear despite having a snapping scroll").** A scene glide crosses a phrase's entrance (0.4 vh) in ~0.3 s, so the words popped in. Now every run of words is drawn from values that chase the scroll's own entrance and exit (`pace` in `words.ts`). They move no faster than a whole run in `WRITE_SECONDS` 1.6 s to appear and `DISSOLVE_SECONDS` 0.7 s to go. Moved slower than that, the words follow the scroll exactly, as before.
- Covers the chapters, the hero title and the projects' intro (`Portfolio.tsx`). The wake chapter's page gate is paced too; its words are still written by the whale.
- Visibility follows the paced values, so the story layer stays until its last phrase has actually dissolved.
- A scene isn't left downward until its phrase has finished writing (`storyText.settled`, written by Story.tsx).
- A scroll held by any scene gate is queued and plays the moment it lets go, within `QUEUE_MS` 1.5 s, so a single wheel notch mid-phrase isn't lost.
- Measured: ch1 assembles over ~1.3 s, finishing ~0.9 s after the page lands. ch1 dissolves in ~0.5 s as ch2 begins. A notch made mid-phrase fired 0.7 s later, when the phrase finished.

### 4.21 The handoff to the projects, and back — ✅ done, SEEN in headless Chrome on the real GPU (real wheel input)

The owner (2026-09-26): "when reaching end of choreography and starting the portrait of projects the whale acts weirdly".

**What it was** (measured with `window.__whale`, which now also shows `phys`, `fwd` and `carry` in dev): over u 4.95–5.5 the drawn whale was `lerp(physics, story, weight)`. `follow()` seeded the physics whale's pose but not its speed, so at release it dropped from ~15 units/s to cruise (~1.1) and stalled. Meanwhile the story route swam on and climbed toward y −4.5, away from the depth the first project's shot wants (≈ −10). As the weight fell, the drawn whale swam left ~8 units, then slid ~6 units back to the right tail-first, bobbing ~2.5 units vertically. Scrolling back up had the mirror problem: the story took back a physics whale up to 20+ units away by easing it across, and the whale zipped over the frame.

- **One owner at a time** (`whaleChoreography.ts` `HANDOFF` = 4.95, a switch, not a range; `HOLD` = 5.05): the whale is drawn from the story or from the physics, never a blend. At 4.95 the route has levelled out of its dive at the shot's depth, heading into the frame. The route's marks past it (5.05, 5.3) now only shape the route up to there.
- **Handing over motion, not just pose** (`whaleAnimator.follow(..., { speed, tailHz })`, `ChoreographyFrame.speed`): the physics whale takes over already swimming, and drag coasts it down to cruise over ~2 s and ~7 units.
- **Carry** (`WhaleModel.tsx`, `CARRY_RATE` 3/s): at any switch of owner, the difference between the pose last drawn and the new owner's pose (each has its own heave and sway, ~0.1–0.2 units) is carried and let go, so nothing jumps.
- **THE REJOIN** (`whaleChoreography.ts`, `planRejoin`, `REJOIN_FROM` 2 units): when the page comes back into the story (goal < HANDOFF) and the physics whale is away from its place on the route, it swims there. The path is a Hermite curve like the leap's shortcut: it leaves along the whale's facing and arrives on the route at the nearest point between the story whale and the page's goal, heading toward the goal, staying submerged and off the lens. Speed is planned through the turns (≤ 18 u/s, 7 u/s² gathering way), then it swims on along the route. The story keeps the whale (`storyHas`) until it reaches HANDOFF again with the page past it. A breach called mid-rejoin starts from the rejoin's pose and speed.

**Verified:** tsc, vite build; 1600×900 wheel probe.
- Forward: ch4 → intro → project 1. At the switch the carry was 0.13–0.17 units, gone in ~1.5 s. The drawn whale moves monotonically along its facing (x 12.6 → −2 while it coasts 10 → 1.2 u/s), with no backslide and no bob, into project 1.
- Reverse: project 1 → intro → ch4. At the reclaim the carry was 0.04 (was 22). The whale turns away from the lens, swims right along the bottom of the frame at up to ~11 u/s, and reaches the route in ~2 s.
- Then ch4 → ch3: the swim-by right → left, ch4 erased and ch3 re-revealed behind it. No console errors.
- The `scripts/sim/simAnimator.ts` bundle no longer runs (`gsap.registerPlugin is not a function` in the Node bundle, since MotionPathPlugin was added to the animator), so the animator sim was not re-run.

**Open:** the rejoin's opening U-turn is tight (~150° in under a second, at low speed, turning away from the lens); widen it via `k` in `planRejoin` if it reads as a pivot. The whale at the intro sits low, along the bottom edge of the frame (physics depth for the first project's shot, unchanged).

### 4.22 Every visitor, every device, no effect dropped — ✅ done, SEEN in headless Chrome on the real GPU (desktop 1600×900, phone 390×844 @3x with touch, 4K stress, 6× CPU throttle, no-WebGL)

The owner (2026-09-27): "optimize and make it ready for every web user as well as mobile without any compromise on the effects and the feel". Backup of the sources before this: `G:\claude-temp\portfolio-backup-optimize-2026-09-27`.

**Download** (first visit, desktop): the eager JS falls from 1,968 kB (643 kB gzip) to ~1,070 kB, and the renderer (R3F, drei, post chain, the scene) arrives beside it instead of in front of it.
- Whale GLB 4.70 → 3.50 MB: the ORM map is re-encoded as 4:4:4 JPEG q95 (mean error 0.9/255). The normal map stays lossless, re-saved without its unused alpha (JPEG failed the limit: 1.8° mean normal error). Mesh, skin, animation and the normal map pixels are byte-identical. Script: `scripts/whale-clip/compress_textures.py`; **re-run it after `swim_clip.py`**, which rebakes from the original.
- Scene HDRI 1.75 → 0.43 MB (`dikhololo_night_512.hdr`, 2×2 box in linear light, energy within 0.3%): the whale only sees it through roughness ≥ 0.84 and envMapIntensity ≤ 0.1. `scripts/visual/downsampleHdr.py`; the 1k is in `media-src/retired-hdri/`.
- Montserrat 688 kB TTF → 59 kB WOFF2 core subset (Latin, punctuation, the link arrows) + a 104 kB extended subset loaded only if such characters appear. Weight axis and features kept. `scripts/visual/subsetFont.py`; its ranges must match the `@font-face` rules.
- Code-split: `components/WebGLStage.tsx` (Hero + canvas) is lazy, started at module load in `Layout.tsx`, with the GLB, sky, water normals and HDRI preloaded beside it (`utils/sceneAssets.ts`, which also makes every public URL base-aware). Header fluid (`MenuFluid.tsx`) and footer sphere (`FooterScene.tsx`) are lazy chunks. `manualChunks`: `three`, `react`, `motion` (gsap + lenis) for caching.
- Removed from the bundle: Leva and its deps (~150 kB, pulled in through the `lib` barrel; `MenuFluid` imports `lib/Fluid` directly), React Router (one route; it also 404'd from a sub-path), Node's `buffer` polyfill (N8AO's one base64 decode; `src/shims/buffer.ts`, aliased in vite.config).
- Instrument Serif stylesheet no longer blocks first paint.

**Effects on every device** — the frame budget is now a ladder (`animations/frameBudget.ts`): over budget → render RESOLUTION steps down (×0.85, ×0.72, ×0.6 of `MAX_DPR` 1.5, applied in `utils/Canvas.tsx`, composer resized in `Hero.tsx`), and only after that does `degraded` shed dressing. Every step must earn its keep: judged on the frame time once settled (two half-second averages agree; a step DOWN followed by slower frames is still in its resize stall), undone if it didn't help (a 30 fps-capped low-power phone keeps full quality), retried with doubling backoff; climbs back up likewise. Dev: `window.__budget.log`. Measured at 4K on the GTX 970: 67 ms → 50 → 17 ms (60 fps) at ×0.72 with nothing shed.
- Phones now get N8AO (half resolution, `performance` quality) and the bubble wake, both previously desktop-only.
- **The sea stuttering on an iPhone** (2026-09-28): two causes, both invisible on desktop. (1) The frame time was a MEDIAN, and on a 60 Hz screen a frame lasts 16.7 or 33.3 ms, nothing between, so it read 16.7 until half the frames were late; at 30% late it even read under budget and could climb. Now the mean less the slowest 5%, over budget at 19 ms (~one frame in six shown twice). (2) The sea ran on R3F's delta, `performance.now()` read after every earlier rAF callback and rounded to 1 ms by Safari: 13-20 ms for frames shown exactly 16.7 ms apart, so the waves moved unevenly and the 60 Hz ripple sim took 0 or 2 steps on up to a third of frames. `animations/frameClock.ts` reads the document timeline and snaps deltas to whole frames at 60/120 Hz (other rates pass through); used by `Ocean.tsx` only.
- **Project images jittering on a phone until their words had arrived** (2026-09-28): a chapter was scrubbed straight from the scroll, and a phone scrolls natively off the main thread, so the page samples it unevenly (10 px, then 30) and a resting finger trembles it back and forth. On touch screens (`IS_TOUCH`) `ProjectChapter` now eases toward the scroll (`FOLLOW_S` 70 ms; jumps over half a viewport snap). Emulated uneven drag: frame-to-frame unevenness of the tiles' motion 1.79 → 0.36 (an even drag gave 0.92 → 0.42; the floor is the tiles' own easing). Desktop follows Lenis exactly, as before.
- **…and the pinned image still wobbling by a pixel** (2026-09-28): iOS holds a sticky element by moving it back against the scroll on the compositor, and the two moves round to device pixels separately. On touch screens the stage is now `position: fixed` (`.project--held`) while it holds, switched HOLD_MARGIN (0.04 vh) inside the sticky pin [1, 2], where both put it in the same place. Screencast-tracked: no jump at either switch. Not verifiable off a real iPhone.
- **…and sticking, then jumping, on a hard fling** (2026-09-28, owner: fine scrolled slowly, "stuck and jittery" flung). The page hears a fling late, so the fixed hold was let go 100–200 px past the end of the pin: the stage stood still while the page flew on, then jumped to meet it. The hold is now let go where the scroll will be `HOLD_LEAD` (0.15 s) ahead at its current speed (taken, as before, where it is). Emulated hard flings at 4x CPU, pframe edges tracked in screencast frames against the pinned-stage prediction: worst error 160 → 12 px (the remainder is the recede scale's deliberate FOLLOW_S lag), worst frame-to-frame change 269 → 10 px.
- **The hero at ~9 fps on an iPhone 14 Pro** (2026-09-28, owner's screen recording: a new scene frame every 117-133 ms, steadily, at the top of the page). Desktop Chrome at the same 589x1278 canvas: ~2.6 ms GPU and ~2.3 ms main thread a frame, 60 fps even with the iPhone's WebGL limits imposed (no float filtering, 4x MSAA). So it is Safari-specific, not load. `?perf` (utils/perf.ts, components/PerfProbe.tsx) measures on the device: live fps and scene/gpu/page ms, and a Run button that reloads once per part switched off (post chain, MSAA, AO, shafts, bloom, lens/grade, sea, ripple sim, whale, snow, page layers, all WebGL, a ninth of the pixels) and tables the results. The ladder holds still under `?perf`.
- **Less smoke on phones** (2026-09-28, owner's request: it made the words read badly). `IS_MOBILE` only: no bubble cloud (`PHONE_CLOUD` 0; even at 40% it billowed behind the hero's words, since the tail churns it all through the opening shot), live shafts at 15% (`PHONE_SHAFTS`), deep LightRays at 25% (`PHONE_RAYS`). Phone emulation, mean brightness behind the hero's words: 106 → 65 (62 with the whole volume off). Desktop unchanged.
- **The ~9 fps was the marine snow canvas** (2026-09-28, the owner's `?perf` run on the iPhone 14 Pro): everything on 19 fps; all WebGL off 11 fps; marine snow off 42 fps; page layers off 44 fps; the WebGL frame itself ~1-2 ms script and ~17 ms GPU. A full-screen 2D canvas redrawn every frame made Safari do work in proportion to the whole page each frame. `utils/MarineSnow.tsx` now paints nothing per frame: the water is one static gradient per ocean stop, crossfaded by opacity; the snow is four sheets (far to near) painted once, falling a screen and looping by CSS transform at their depth's speed and swaying on unrelated periods; density by opacity. Side by side on phone emulation at five depths: same water, same snow. `useDepthCss` now samples its colours at the quantized depth (they were rewritten on :root nearly every scroll frame).
- The water sim's wave speed is scaled by grid size: the phone's 256² grid had every ripple and wake moving at twice the desktop's speed.
- Lens-droplet pass (requested by the concurrent session that owns its look): pass disabled while dry; `runnerPath`/`runnerSwept` share the path so the per-bead swept test skips the drop and streak; hidden taps skipped. A/B in one frame: 0 differing pixels at ages 0.5/1/3/6 s.
- Canvas: no MSAA on the canvas itself (the composer has its own), remount on WebGL context restore (iOS drops contexts in background tabs).

**Every browser**
- `utils/device.ts`: one place for `IS_MOBILE` / `CAN_HOVER` / `IS_TOUCH` / `MAX_DPR`, and a WebGL 2 + float-colour-buffer probe. Without it (three r160 silently falls back to WebGL 1, where the GLSL 3 ocean breaks) the page runs DOM-only; `components/SceneBoundary.tsx` does the same if the chunk or the context fails. Dev: `?nowebgl`.
- `utils/viewport.ts`: CSS `100vh` in px, stable while the mobile address bar moves. Every scroll→vh conversion (story, whale, dive, beats, chapters) and scene↔screen projection uses it instead of `innerHeight`, which changed mid-scroll on iOS/Android. MarineSnow sized to it (no realloc per address-bar resize).
- Full float sim targets only when also renderable (`EXT_color_buffer_float`).
- `viewport-fit=cover` + safe-area padding; `overscroll-behavior-y: none`; `text-size-adjust`; `color-mix` fallback; `color-scheme`; `<noscript>`.
- Phone header: signature scales (`min(299px, 100vw - 10.5rem)`) — LinkedIn was cut off at 390 px. Cursor only for hover pointers (its dots sat in the top-left corner on phones), `quickSetter`, rAF cancelled. Menu toggle is a real `<button>` (keyboard, `aria-expanded`, Esc closes), nav scrolls through Lenis (listeners no longer pile up on every close; Lenis is stopped behind the open menu). Footer sphere pauses when off screen and has no orbit drag on touch (OrbitControls' `touch-action: none` blocked scrolling over a 400 px band).

**Verified:** tsc, vite build; prod build on the real GPU: 60 fps at hero / story / projects, desktop and 390×844; wheel and touch step 1.35 → 2.55 → 3.65 → 4.8 → 6.2 vh; GLB/HDR/sky each fetched once (preloads reused); no failed requests or errors (the D3D X3595 warning is the old cosmetic one). No-WebGL: DOM page at 60 fps, story steps, no scene assets fetched.

**Not verified (no devices here):** a real iPhone / Android phone, Safari, Firefox. The 390×844 runs are Chrome's emulation on a desktop GPU, so they prove layout and input, not a phone's frame rate — the ladder is what handles that.

## 5. Risks to keep in mind

- **Whale side-of-frame is not schedulable** (its X is integrated from time; scroll is the visitor's). Never design a shot that depends on it; framing belongs to the camera.
- **Body gradient uses the whale's world Y** (`worldPosRef`), which already includes the `<Center>` offset. Keep it that way.
- Drei caches GLTF materials globally; `applyWhaleDepthGrading` guards against double patching. Don't clone the material without re-applying.
- **Two whales sharing one material = one whale's grading, driven by whichever wrote last.** If §4.8 lands, the companion whale needs its own cloned material, its own uniforms, and its own `applyWhaleDepthGrading()` call — never the lead's `materials.HumpbackWhale` object directly.
- Every new edge-triggered cue must re-arm on scroll-up (see `REARM_BELOW` in `diveDirector.ts`).
- `:root` custom-property writes must stay quantized (full-document style recalc).
