import { SKY_URL, WATER_NORMALS_URL } from '../../utils/sceneAssets';
import { sceneMounted } from '../../utils/loader';
import { IS_MOBILE } from '../../utils/device';
import { viewportHeight } from '../../utils/viewport';
import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { useGLTF, useTexture } from '@react-three/drei';
import {
    BackSide,
    BufferAttribute,
    BufferGeometry,
    Color,
    DoubleSide,
    MathUtils,
    PlaneGeometry,
    Raycaster,
    RepeatWrapping,
    SRGBColorSpace,
    ShaderMaterial,
    SphereGeometry,
    Vector2,
    Vector3,
} from 'three';
import type { Group, Mesh, Object3D, PerspectiveCamera } from 'three';
import { WaterSimulation, MAX_SPHERES, MAX_SPLASHES } from './WaterSimulation';
import { oceanUniforms } from './oceanUniforms';
import { createNoise3D, createOceanNoise } from './oceanNoise';
import { pendingSplashes, sprayBursts } from './spraySignal';
import {
    oceanCommon,
    screenRay,
    screenVertex,
    skyCommon,
    skyFragment,
    skyVertex,
    surfaceFragment,
    surfaceVertex,
    waterlineFragment,
} from './oceanShaders';
import {
    ambientHeight,
    ambientSlope,
    crashHeightAt,
    SWELL_POINT,
    SWELL_WAVES,
    crashWave,
    triggerCrash,
    updateWater,
    waterSignal,
    SIM_CENTER_X,
    SIM_CENTER_Z,
    SIM_SIZE,
} from '../../animations/waterSignal';
import { preludeSignal } from '../../animations/preludeSignal';
import { depthSignal } from '../../animations/depthSignal';
import { prefersReducedMotion } from '../../animations/motionPreference';
import { frameBudget, holdBudget } from '../../animations/frameBudget';
import whaleModelUrl from '../../assets/models/humpback_whale.glb?url';

/**
 * The live sea: sky, surface, ripples, caustics and the over/under waterline.
 *
 * This replaces the scrubbed dive video. Everything the video showed — sky
 * over the waterline, the underside of the surface, the blue below — is now
 * rendered, so the whale is IN the water rather than composited over footage
 * of it: it pushes the surface around when it is near it, the visitor's
 * pointer ripples it, and the light those ripples focus plays over its skin.
 *
 * See `waterSignal.ts` for how scroll maps to the dive, and `oceanShaders.ts`
 * for the optics.
 */


const QUALITY = IS_MOBILE
    ? { resolution: 256, causticResolution: 512, causticGrid: 192, foamResolution: 128, rings: 220, segments: 150 }
    : { resolution: 512, causticResolution: 1024, causticGrid: 384, foamResolution: 256, rings: 350, segments: 280 };

/** Simulation steps per second. The wave speed is tuned per step, so this
 *  is fixed rather than tied to the display's refresh rate. */
const SIM_HZ = 60;

/** Pointer ripples: a light trail while moving, a real splash on press. */
const TRAIL_RADIUS = 0.5;
const TRAIL_STRENGTH = 0.07;
const SPLASH_RADIUS = 0.9;
const SPLASH_STRENGTH = -0.35;
/** White water a press leaves: radius (world units) and amount. */
const SPLASH_FOAM_RADIUS = 1.1;
const SPLASH_FOAM = 1.6;

/** How much of the swell's slope the floating housing takes up, 0..1. A
 *  real housing tips with the water under it; all of it would read as a
 *  boat, this reads as a camera held at the surface. */
const FLOAT_TILT = 0.45;

/** Caustic light on the whale at the surface. */
const CAUSTIC_STRENGTH = 1.5;

/** Development switches: ?caustics=0 turns the whale's caustics off,
 *  ?causticView shows the caustics texture in the corner. */
const DEV_PARAMS = import.meta.env.DEV ? new URLSearchParams(window.location.search) : null;
const CAUSTIC_SCALE = Number(DEV_PARAMS?.get('caustics') ?? 1);
const CAUSTIC_VIEW = DEV_PARAMS?.has('causticView') ?? false;
const FOAM_VIEW = DEV_PARAMS?.has('foamView') ?? false;

/**
 * The surface mesh: a fan of rings around the camera, dense at the lens and
 * growing geometrically outward (each ring ~1.5% further than the last), so a
 * wave a few metres off is resolved by real geometry while the horizon costs
 * almost nothing. Only the 200 degrees in front of the camera are built — it
 * never turns round.
 */
function buildSeaGeometry(rings: number, segments: number, reach: number): BufferGeometry {
    const inner = 0.3;
    const r0 = 2.6;
    const a = Math.log((reach - inner) / r0 + 1) / rings;
    const span = MathUtils.degToRad(200);
    const positions = new Float32Array((rings + 1) * (segments + 1) * 3);
    let p = 0;
    for (let i = 0; i <= rings; i++) {
        const r = inner + r0 * (Math.exp(a * i) - 1);
        for (let j = 0; j <= segments; j++) {
            const th = -span / 2 + (span * j) / segments;
            positions[p++] = r * Math.sin(th);
            positions[p++] = 0;
            positions[p++] = -r * Math.cos(th);
        }
    }
    const index = new Uint32Array(rings * segments * 6);
    let k = 0;
    const row = segments + 1;
    for (let i = 0; i < rings; i++) {
        for (let j = 0; j < segments; j++) {
            const q = i * row + j;
            index[k++] = q;
            index[k++] = q + row;
            index[k++] = q + 1;
            index[k++] = q + 1;
            index[k++] = q + row;
            index[k++] = q + row + 1;
        }
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(positions, 3));
    g.setIndex(new BufferAttribute(index, 1));
    return g;
}

/** Where the camera sits on the water plane; the fan is centred just behind
 *  it. Matches WhaleScene's camera rest position. */
const FAN_CENTER = new Vector3(0, 0, 10.4);

// --- The whale's body, as the water sees it --------------------------------

/**
 * Spheres along the spine, head to fluke. The water only needs the volume the
 * animal occupies near the surface, so a chain of spheres riding the
 * skeleton's bones is enough — and because they ride the bones, the fluke's
 * stroke moves water exactly when the tail actually moves.
 */
const BODY: Array<[string, number]> = [
    ['Bone007_end_019', 1.3],
    ['Bone007_07', 1.9],
    ['Bone006_06', 2.2],
    ['Bone003_01', 2.0],
    ['Bone002_02', 1.6],
    ['Bone005_04', 1.1],
    ['Bone004_05', 0.8],
    ['Bone004_end_018', 1.4],
];

export const whaleBody = {
    /** World x, y, z, radius per sphere, written each frame. */
    world: new Float32Array(MAX_SPHERES * 4),
    /** World velocity x, y, z and speed per sphere (units/s). */
    velocity: new Float32Array(MAX_SPHERES * 4),
    count: 0,
};

export function WhaleWaterCoupling() {
    const { nodes } = useGLTF(whaleModelUrl);
    const bones = useMemo(
        () =>
            BODY.map(([name, radius]) => ({ bone: nodes[name] as Object3D | undefined, radius })).filter(
                (b) => b.bone,
            ),
        [nodes],
    );
    const tmp = useMemo(() => new Vector3(), []);
    const primed = useRef(false);

    useFrame((_, delta) => {
        const dt = Math.max(Math.min(delta, 0.05), 1e-3);
        const w = whaleBody.world;
        const v = whaleBody.velocity;
        let n = 0;
        for (const { bone, radius } of bones) {
            if (n >= MAX_SPHERES || !bone) break;
            bone.getWorldPosition(tmp);
            const i = n * 4;
            if (primed.current) {
                const vx = (tmp.x - w[i]) / dt;
                const vy = (tmp.y - w[i + 1]) / dt;
                const vz = (tmp.z - w[i + 2]) / dt;
                const speed = Math.hypot(vx, vy, vz);
                // A jump of several units in one frame is the whale being
                // placed (the story re-seeding it, a tab coming back), not a
                // stroke: it must not throw water about.
                if (speed < 25) v.set([vx, vy, vz, speed], i);
                else v.fill(0, i, i + 4);
            }
            w.set([tmp.x, tmp.y, tmp.z, radius], i);
            n++;
        }
        whaleBody.count = n;
        primed.current = n > 0;
    });

    return null;
}

// --- The sea ------------------------------------------------------------------

const Ocean = () => {
    const gl = useThree((s) => s.gl);
    const camera = useThree((s) => s.camera) as PerspectiveCamera;

    const [skyTex, detailTex] = useTexture([SKY_URL, WATER_NORMALS_URL]);
    const noiseTex = useMemo(() => createOceanNoise(256), []);
    const noise3D = useMemo(() => createNoise3D(256), []);
    useEffect(() => {
        oceanUniforms.uNoiseTex.value = noiseTex;
        oceanUniforms.uNoise3D.value = noise3D;
        return () => {
            noiseTex.dispose();
            noise3D.dispose();
        };
    }, [noiseTex, noise3D]);

    const sim = useMemo(
        () =>
            new WaterSimulation(gl, {
                resolution: QUALITY.resolution,
                causticResolution: QUALITY.causticResolution,
                causticGrid: QUALITY.causticGrid,
                foamResolution: QUALITY.foamResolution,
            }),
        [gl],
    );
    useEffect(() => () => sim.dispose(), [sim]);
    // The sea's shaders compile and its targets allocate as it mounts: a
    // stall the frame budget should not read as a slow machine, and one the
    // page's loader waits out (see utils/loader.ts).
    useEffect(() => {
        holdBudget(3000);
        sceneMounted('sea');
    }, []);

    useMemo(() => {
        // Edges are mirrored in the shader (skyLod), not by the sampler.
        skyTex.colorSpace = SRGBColorSpace;
        skyTex.needsUpdate = true;
        oceanUniforms.uSkyTex.value = skyTex;
        detailTex.wrapS = RepeatWrapping;
        detailTex.wrapT = RepeatWrapping;
        detailTex.needsUpdate = true;
    }, [skyTex, detailTex]);

    const seaGeometry = useMemo(() => buildSeaGeometry(QUALITY.rings, QUALITY.segments, 700), []);
    const skyGeometry = useMemo(() => new SphereGeometry(1, 48, 24), []);
    const screenGeometry = useMemo(() => new PlaneGeometry(2, 2), []);
    useEffect(
        () => () => {
            seaGeometry.dispose();
            skyGeometry.dispose();
            screenGeometry.dispose();
        },
        [seaGeometry, skyGeometry, screenGeometry],
    );

    const materials = useMemo(() => {
        const sky = new ShaderMaterial({
            vertexShader: skyVertex,
            fragmentShader: oceanCommon + skyCommon + skyFragment,
            uniforms: {
                ...oceanUniforms,
                // The sunlit band under the surface (see skyFragment).
                uGlow: { value: 1 },
                uGlowColor: { value: new Color(0.05, 0.14, 0.2) },
            },
            side: BackSide,
            depthWrite: false,
        });
        const surface = new ShaderMaterial({
            vertexShader: oceanCommon + surfaceVertex,
            fragmentShader: oceanCommon + skyCommon + surfaceFragment,
            uniforms: {
                ...oceanUniforms,
                uPixelAngle: { value: 0.001 },
                uDetailNormals: { value: detailTex },
                uDetailStrength: { value: 0.3 },
                uSparkle: { value: 1.0 },
                uGlitter: { value: 1.0 },
                uFoam: { value: 1.0 },
                // Open ocean seen from above: almost black blue, lifted by the
                // light scattered back up out of it.
                uDeepColor: { value: new Color(0.002, 0.03, 0.055) },
                uSssColor: { value: new Color(0.02, 0.22, 0.2) },
                uHaze: { value: 0.0022 },
                uFogDensity: { value: 0.08 },
            },
            side: DoubleSide,
            transparent: true,
            premultipliedAlpha: true,
            depthWrite: true,
        });
        const waterline = new ShaderMaterial({
            vertexShader: screenVertex,
            fragmentShader: oceanCommon + screenRay + waterlineFragment,
            uniforms: { ...oceanUniforms },
            transparent: true,
            premultipliedAlpha: true,
            depthTest: false,
            depthWrite: false,
        });
        const causticView = new ShaderMaterial({
            vertexShader: /* glsl */ `
                varying vec2 vUv;
                void main() {
                    vUv = uv;
                    gl_Position = vec4(position.xy * 0.3 + vec2(0.68, -0.68), 0.0, 1.0);
                }`,
            fragmentShader: /* glsl */ `
                uniform sampler2D uCausticTex;
                uniform sampler2D uFoamTex;
                varying vec2 vUv;
                void main() {
                    gl_FragColor = vec4(FOAM_VIEW ? vec3(texture2D(uFoamTex, vUv).rg * 0.5, 0.0) : vec3(texture2D(uCausticTex, vUv).r * 0.35), 1.0);
                }`,
            uniforms: { uCausticTex: oceanUniforms.uCausticTex, uFoamTex: oceanUniforms.uFoamTex },
            defines: { FOAM_VIEW: FOAM_VIEW },
            depthTest: false,
            depthWrite: false,
        });
        return { sky, surface, waterline, causticView };
    }, [detailTex]);
    useEffect(
        () => () => Object.values(materials).forEach((m) => m.dispose()),
        [materials],
    );

    const group = useRef<Group>(null);
    const skyRef = useRef<Mesh>(null);

    // --- Pointer -----------------------------------------------------------
    const pointer = useRef({ x: 0, y: 0, moved: false, pressed: false, has: false });
    const lastHit = useRef<Vector2 | null>(null);
    const raycaster = useMemo(() => new Raycaster(), []);
    const ndc = useMemo(() => new Vector2(), []);
    const hit = useMemo(() => new Vector3(), []);

    useEffect(() => {
        const onMove = (e: PointerEvent) => {
            pointer.current.x = e.clientX;
            pointer.current.y = e.clientY;
            pointer.current.moved = true;
            pointer.current.has = true;
        };
        const onDown = (e: PointerEvent) => {
            onMove(e);
            pointer.current.pressed = true;
        };
        window.addEventListener('pointermove', onMove, { passive: true });
        window.addEventListener('pointerdown', onDown, { passive: true });
        return () => {
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerdown', onDown);
        };
    }, []);

    /** Where the pointer's ray meets the water, beyond the dome. */
    const pointerOnWater = (): boolean => {
        ndc.set(
            (pointer.current.x / window.innerWidth) * 2 - 1,
            -(pointer.current.y / viewportHeight()) * 2 + 1,
        );
        raycaster.setFromCamera(ndc, camera);
        const { origin, direction } = raycaster.ray;
        if (Math.abs(direction.y) < 1e-4) return false;
        let t = (waterSignal.level - origin.y) / direction.y;
        if (t <= 0) return false;
        t = Math.max(t, waterSignal.domeRadius);
        if (t > 30) return false;
        hit.copy(origin).addScaledVector(direction, t);
        const half = SIM_SIZE / 2;
        return Math.abs(hit.x - SIM_CENTER_X) < half && Math.abs(hit.z - SIM_CENTER_Z) < half;
    };

    // --- Frame ---------------------------------------------------------------
    const clock = useRef({ acc: 0, frame: 0, fadeIn: 0 });
    const slope = useMemo<[number, number]>(() => [0, 0], []);
    const floating = useRef(false);
    const prevRel = useMemo(() => new Float32Array(MAX_SPHERES * 4), []);
    const curRel = useMemo(() => new Float32Array(MAX_SPHERES * 4), []);
    const bodyLocal = useMemo(() => new Float32Array(MAX_SPHERES * 4), []);
    const splashes = useMemo(() => new Float32Array(MAX_SPLASHES * 4), []);
    const bodyPrimed = useRef(false);

    useEffect(() => {
        // Screen -> world for the full-screen passes (waterline, god rays),
        // from the exact camera being rendered — the director moves it after
        // this component's frame runs. Hung on the sky because it is drawn
        // first, in the opaque pass, before any of the passes that need it.
        const sky = skyRef.current;
        if (!sky) return;
        sky.onBeforeRender = (_r, _s, cam) => {
            oceanUniforms.uInvProjection.value.copy(cam.projectionMatrixInverse);
            oceanUniforms.uCameraWorld.value.copy(cam.matrixWorld);
        };
    }, []);

    useFrame((state, delta) => {
        const vh = window.scrollY / viewportHeight();
        updateWater(vh, delta, prefersReducedMotion() ? 0.35 : 1);
        // The only writer: the camera director and the god rays take over as
        // the waterline leaves the frame.
        preludeSignal.progress = waterSignal.air;

        const u = oceanUniforms;
        u.uWaveTime.value = waterSignal.time;
        u.uWaterLevel.value = waterSignal.level;
        u.uDomeRadius.value = waterSignal.domeRadius;
        // The sky and sea arrive with their texture a moment after the page;
        // fade them in over the water backdrop instead of cutting.
        clock.current.fadeIn = Math.min(1, clock.current.fadeIn + Math.min(delta, 0.05) / 0.8);
        const arrive = clock.current.fadeIn * clock.current.fadeIn * (3 - 2 * clock.current.fadeIn);
        u.uPresence.value = waterSignal.presence * arrive;
        u.uAir.value = waterSignal.air;
        u.uCrashA.value.fromArray(crashWave.a);
        u.uCrashB.value.fromArray(crashWave.b);
        u.uCrashK.value = crashWave.k;
        u.uWaterNear.value.copy(depthSignal.ocean.waterNear);
        u.uWaterFar.value.copy(depthSignal.ocean.waterFar);

        const cam = state.camera as PerspectiveCamera;

        // The housing floats. While the waterline is in frame the camera is
        // a photographer's port bobbing at the surface: the swell under it
        // (whose heave updateWater already rides out) tips it, so the horizon
        // and the waterline lean and settle with each wave. Gone once under,
        // where the camera never rotates (see CameraDirector).
        const float = prefersReducedMotion() ? 0 : waterSignal.air;
        if (float > 0) {
            ambientSlope(SWELL_POINT[0], SWELL_POINT[1], waterSignal.time, SWELL_WAVES, slope);
            cam.rotation.set(
                -Math.atan(slope[1]) * FLOAT_TILT * float,
                0,
                Math.atan(slope[0]) * FLOAT_TILT * float,
            );
            floating.current = true;
        } else if (floating.current) {
            cam.rotation.set(0, 0, 0);
            floating.current = false;
        }

        // The glow belongs to water near the surface: strong in the opening
        // shot, fading as the surface recedes overhead.
        materials.sky.uniforms.uGlow.value = Math.exp(-Math.max(0, -waterSignal.eyeOffset - 0.5) / 3.5);
        materials.surface.uniforms.uPixelAngle.value =
            (2 * Math.tan(MathUtils.degToRad(cam.fov) / 2)) / Math.max(1, state.size.height);

        if (group.current) group.current.visible = waterSignal.active;
        if (!waterSignal.active) {
            u.uCausticStrength.value = 0;
            u.uWhaleHaze.value = 0;
            u.uAirLight.value = 0;
            bodyPrimed.current = false;
            lastHit.current = null;
            return;
        }

        // 1. The visitor's hand in the water.
        let splashCount = 0;
        const p = pointer.current;
        if (p.has && (p.moved || p.pressed)) {
            if (pointerOnWater()) {
                if (p.pressed) {
                    pendingSplashes.push({ x: hit.x, z: hit.z, strength: 1 });
                } else if (lastHit.current) {
                    const moved = lastHit.current.distanceTo(ndc.set(hit.x, hit.z));
                    if (moved > 0.02) {
                        sim.drop(
                            lastHit.current.x,
                            lastHit.current.y,
                            hit.x,
                            hit.z,
                            TRAIL_RADIUS,
                            TRAIL_STRENGTH * Math.min(1, moved / 0.25),
                        );
                    }
                }
                lastHit.current = (lastHit.current ?? new Vector2()).set(hit.x, hit.z);
            } else {
                lastHit.current = null;
            }
            p.moved = false;
            p.pressed = false;
        }

        // Splashes: the ripple, the white water where it went in, and the
        // spray it throws (drawn by Spray).
        while (pendingSplashes.length > 0) {
            const s = pendingSplashes.shift()!;
            sim.drop(s.x, s.z, s.x, s.z, SPLASH_RADIUS, SPLASH_STRENGTH * s.strength);
            if (splashCount < MAX_SPLASHES) {
                splashes.set([s.x, s.z, SPLASH_FOAM_RADIUS * Math.sqrt(s.strength), SPLASH_FOAM * s.strength], splashCount * 4);
                splashCount++;
            }
            sprayBursts.push(s);
        }

        // 2. The whale pushing it about.
        const n = whaleBody.count;
        if (n > 0) {
            for (let i = 0; i < n; i++) {
                curRel[i * 4] = whaleBody.world[i * 4];
                curRel[i * 4 + 1] = whaleBody.world[i * 4 + 1] - waterSignal.level;
                curRel[i * 4 + 2] = whaleBody.world[i * 4 + 2];
                curRel[i * 4 + 3] = whaleBody.world[i * 4 + 3];
            }
            if (bodyPrimed.current) sim.displace(prevRel, curRel, n);
            prevRel.set(curRel);
            bodyPrimed.current = true;
        }

        // 3. Physics at a fixed rate.
        const c = clock.current;
        c.acc = Math.min(c.acc + Math.min(delta, 0.05), 3 / SIM_HZ);
        while (c.acc >= 1 / SIM_HZ) {
            sim.step();
            c.acc -= 1 / SIM_HZ;
        }
        sim.updateNormals();

        // 4. White water: where the body cuts the surface (measured against
        // the actual waves there, not the mean level), and the splashes.
        const dtFoam = Math.min(delta, 0.05);
        for (let i = 0; i < n; i++) {
            const x = whaleBody.world[i * 4];
            const z = whaleBody.world[i * 4 + 2];
            const surface = waterSignal.level + ambientHeight(x, z, waterSignal.time) + crashHeightAt(x, z);
            bodyLocal[i * 4] = x;
            bodyLocal[i * 4 + 1] = whaleBody.world[i * 4 + 1] - surface;
            bodyLocal[i * 4 + 2] = z;
            bodyLocal[i * 4 + 3] = whaleBody.world[i * 4 + 3];
        }
        sim.updateFoam(dtFoam, bodyLocal, whaleBody.velocity, n, splashes, splashCount);

        // 5. Caustics. Every other frame when the frame budget is blown.
        c.frame++;
        if (!frameBudget.degraded || c.frame % 2 === 0) sim.updateCaustics();
        u.uCausticStrength.value = CAUSTIC_STRENGTH * CAUSTIC_SCALE * waterSignal.presence;
        u.uWhaleHaze.value = waterSignal.presence;
        u.uAirLight.value = waterSignal.presence;

        if (import.meta.env.DEV) {
            (window as unknown as Record<string, unknown>).__crashNow = triggerCrash;
            (window as unknown as Record<string, unknown>).__splashAt = (x: number, z: number, strength = 1) =>
                pendingSplashes.push({ x, z, strength });
            (window as unknown as Record<string, unknown>).__waterDebug = {
                level: +waterSignal.level.toFixed(3),
                eye: +waterSignal.eyeOffset.toFixed(3),
                air: +waterSignal.air.toFixed(3),
                dome: +waterSignal.domeRadius.toFixed(3),
                wet: +crashWave.wet.toFixed(3),
                body: Array.from(whaleBody.world.slice(0, n * 4)).map((v) => +v.toFixed(2)),
            };
        }
    });

    return (
        <group ref={group}>
            <mesh
                ref={skyRef}
                geometry={skyGeometry}
                material={materials.sky}
                frustumCulled={false}
                renderOrder={-10}
            />
            <mesh
                geometry={seaGeometry}
                material={materials.surface}
                position={FAN_CENTER}
                frustumCulled={false}
                renderOrder={1}
            />
            <mesh
                geometry={screenGeometry}
                material={materials.waterline}
                frustumCulled={false}
                renderOrder={1000}
            />
            {(CAUSTIC_VIEW || FOAM_VIEW) && (
                <mesh
                    geometry={screenGeometry}
                    material={materials.causticView}
                    frustumCulled={false}
                    renderOrder={2000}
                />
            )}
        </group>
    );
};

export default Ocean;
