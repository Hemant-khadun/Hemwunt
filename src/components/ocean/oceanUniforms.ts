import { Color, Matrix4, Texture, Vector2, Vector3, Vector4 } from 'three';
import type { IUniform } from 'three';
import {
    SIM_CENTER_X,
    SIM_CENTER_Z,
    SIM_SIZE,
    SKY_FRAME,
    SUN_DIR,
    WAVES,
    packWaves,
    waterSignal,
} from '../../animations/waterSignal';

/**
 * Uniforms shared by every material that has to know about the sea: the sky,
 * the surface, the waterline, the caustics pass, the whale's skin and the god
 * rays. They are the SAME objects in every material (three reads `.value` off
 * the object each draw), so writing one here once per frame updates them all
 * and they can never disagree about where the water is.
 */
const waves = packWaves();

/** A 1x1 stand-in so materials compile and draw before the real textures
 *  exist. Black: no ripples, no caustics, no sky. */
const EMPTY = new Texture();

export const oceanUniforms = {
    uWaveA: { value: waves.a } as IUniform<Float32Array>,
    uWaveB: { value: waves.b } as IUniform<Float32Array>,
    uWaveTime: { value: 0 } as IUniform<number>,
    uWaterLevel: { value: waterSignal.level } as IUniform<number>,
    uDomeRadius: { value: waterSignal.domeRadius } as IUniform<number>,
    uPresence: { value: 1 } as IUniform<number>,
    uAir: { value: 1 } as IUniform<number>,
    /** The wave meeting the lens: see crashWave in waterSignal.ts. */
    uCrashA: { value: new Vector4() } as IUniform<Vector4>,
    uCrashB: { value: new Vector4() } as IUniform<Vector4>,
    uCrashK: { value: 0 } as IUniform<number>,

    uSimTex: { value: EMPTY } as IUniform<Texture>,
    uSimCenter: { value: new Vector2(SIM_CENTER_X, SIM_CENTER_Z) } as IUniform<Vector2>,
    uSimSize: { value: SIM_SIZE } as IUniform<number>,

    /** Broken water over the simulated patch: R surface foam, G the bubble
     *  cloud churned in under it. See `foamFragment`. */
    uFoamTex: { value: EMPTY } as IUniform<Texture>,
    /** Tileable breakup noise (see oceanNoise.ts). */
    uNoiseTex: { value: EMPTY } as IUniform<Texture>,
    /** Lattice for true 3D noise (createNoise3D in oceanNoise.ts). */
    uNoise3D: { value: EMPTY } as IUniform<Texture>,

    uCausticTex: { value: EMPTY } as IUniform<Texture>,
    /** Overall caustic light on the whale. Driven by depth and presence. */
    uCausticStrength: { value: 0 } as IUniform<number>,
    /** Daylight on whatever of the whale stands out of the water, 0..1. */
    uAirLight: { value: 0 } as IUniform<number>,
    /** Distance haze on the whale, 0..1. Only while the live sea is. */
    uWhaleHaze: { value: 0 } as IUniform<number>,

    uSunDir: { value: SUN_DIR.clone() } as IUniform<Vector3>,
    uSunColor: { value: new Color(1.0, 0.93, 0.82) } as IUniform<Color>,

    uSkyTex: { value: EMPTY } as IUniform<Texture>,
    uSkyFrame: { value: new Vector4(...SKY_FRAME) } as IUniform<Vector4>,
    /** The pale band the sky thins into at the horizon: the photo's own
     *  lowest blue, lifted toward white. */
    uHorizonColor: { value: new Color('#c4def2') } as IUniform<Color>,
    uSkyExposure: { value: 1.0 } as IUniform<number>,

    /** The water body, as the rest of the page grades it (depthSignal). */
    uWaterNear: { value: new Color('#117da4') } as IUniform<Color>,
    uWaterFar: { value: new Color('#054b78') } as IUniform<Color>,

    /** Screen -> world, for the full-screen passes (waterline, god rays). */
    uInvProjection: { value: new Matrix4() } as IUniform<Matrix4>,
    uCameraWorld: { value: new Matrix4() } as IUniform<Matrix4>,
};

export type OceanUniforms = typeof oceanUniforms;

export const NUM_WAVES = WAVES.length;
