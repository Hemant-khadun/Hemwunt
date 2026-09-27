import {
    AdditiveBlending,
    BufferAttribute,
    BufferGeometry,
    Color,
    DoubleSide,
    FloatType,
    HalfFloatType,
    LinearFilter,
    LinearMipmapLinearFilter,
    Mesh,
    NoBlending,
    OrthographicCamera,
    PlaneGeometry,
    RGBAFormat,
    Scene,
    ShaderMaterial,
    Vector2,
    Vector4,
    WebGLRenderTarget,
    ClampToEdgeWrapping,
} from 'three';
import type { IUniform, Texture, WebGLRenderer } from 'three';
import {
    causticFragment,
    causticVertex,
    displaceFragment,
    dropFragment,
    foamFragment,
    normalFragment,
    oceanCommon,
    simVertex,
    updateFragment,
} from './oceanShaders';
import { oceanUniforms } from './oceanUniforms';

export interface WaterSimOptions {
    /** Heightfield resolution (square). */
    resolution: number;
    /** Caustics texture resolution (square). */
    causticResolution: number;
    /** Vertices per side of the grid the caustics are traced from. */
    causticGrid: number;
    /** Foam field resolution (square). */
    foamResolution: number;
}

export const MAX_SPHERES = 8;
export const MAX_SPLASHES = 4;

/**
 * The interactive water: Evan Wallace's GPU heightfield, in three.js.
 *
 * Two float targets ping-pong. Each frame the owner adds disturbances (pointer
 * drops, the whale's displacement), steps the wave equation, recomputes slopes,
 * and traces caustics from the result. The latest heightfield and caustics are
 * published through `oceanUniforms`, which is what every visible material reads.
 */
export class WaterSimulation {
    readonly resolution: number;
    readonly caustic: WebGLRenderTarget;

    private readonly gl: WebGLRenderer;
    private front: WebGLRenderTarget;
    private back: WebGLRenderTarget;
    private readonly scene = new Scene();
    private readonly camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
    private readonly quad: Mesh;

    private readonly dropMat: ShaderMaterial;
    private readonly updateMat: ShaderMaterial;
    private readonly normalMat: ShaderMaterial;
    private readonly displaceMat: ShaderMaterial;
    private readonly foamMat: ShaderMaterial;
    private foamFront: WebGLRenderTarget;
    private foamBack: WebGLRenderTarget;

    private readonly causticScene = new Scene();
    private readonly causticMat: ShaderMaterial;
    private readonly causticGeometry: BufferGeometry;

    private readonly savedClear = new Color();

    constructor(gl: WebGLRenderer, options: WaterSimOptions) {
        this.gl = gl;
        this.resolution = options.resolution;

        // Full float where it can be both filtered and rendered to, half float
        // otherwise (every iPhone: Apple GPUs cannot filter 32-bit float).
        // Half is enough for ripples a few centimetres high but loses the
        // faintest tails of a decaying wave a little sooner.
        const fullFloat = gl.extensions.has('OES_texture_float_linear') && gl.extensions.has('EXT_color_buffer_float');
        const type = fullFloat ? FloatType : HalfFloatType;
        const makeTarget = (size: number, t = type) =>
            new WebGLRenderTarget(size, size, {
                type: t,
                format: RGBAFormat,
                minFilter: LinearFilter,
                magFilter: LinearFilter,
                wrapS: ClampToEdgeWrapping,
                wrapT: ClampToEdgeWrapping,
                depthBuffer: false,
                stencilBuffer: false,
                generateMipmaps: false,
            });

        this.front = makeTarget(this.resolution);
        this.back = makeTarget(this.resolution);
        this.caustic = makeTarget(options.causticResolution, HalfFloatType);
        // Mipmapped: the light shafts read it blurred (they are soft), and
        // the whale's skin gets it filtered at a distance instead of aliased.
        this.caustic.texture.generateMipmaps = true;
        this.caustic.texture.minFilter = LinearMipmapLinearFilter;
        this.foamFront = makeTarget(options.foamResolution, HalfFloatType);
        this.foamBack = makeTarget(options.foamResolution, HalfFloatType);

        const texel = new Vector2(1 / this.resolution, 1 / this.resolution);
        const texelWorld = oceanUniforms.uSimSize.value / this.resolution;
        const pass = (fragmentShader: string, uniforms: Record<string, IUniform>) =>
            new ShaderMaterial({
                vertexShader: simVertex,
                fragmentShader,
                uniforms: { uSource: { value: null }, ...uniforms },
                depthTest: false,
                depthWrite: false,
                blending: NoBlending,
            });

        this.dropMat = pass(dropFragment, {
            uA: { value: new Vector2() },
            uB: { value: new Vector2() },
            uRadius: { value: 0.01 },
            uStrength: { value: 0 },
        });
        this.updateMat = pass(updateFragment, {
            uTexel: { value: texel },
            // Wave speed: c = sqrt(uSpeed)/2 texels per step. At 60 steps a
            // second over a 40-unit patch that is ~2.3 units/s at 512 texels —
            // about how fast a whale's wake spreads at this scale. Scaled with
            // the grid so it is ~2.3 units/s at ANY resolution: the phone's
            // 256² grid at uSpeed 1 sent every ripple and wake across the sea
            // at twice the desktop's speed.
            uSpeed: { value: (this.resolution / 512) ** 2 },
            uDamping: { value: 0.993 },
        });
        this.normalMat = pass(normalFragment, {
            uTexel: { value: texel },
            uTexelWorld: { value: texelWorld },
        });
        this.displaceMat = pass(displaceFragment, {
            uOld: { value: Array.from({ length: MAX_SPHERES }, () => new Vector4()) },
            uNew: { value: Array.from({ length: MAX_SPHERES }, () => new Vector4()) },
            uCount: { value: 0 },
            uStrength: { value: 0.55 },
            uSimCenter: oceanUniforms.uSimCenter,
            uSimSize: oceanUniforms.uSimSize,
        });

        this.foamMat = pass(foamFragment, {
            uSim: { value: null },
            uTexel: { value: new Vector2(1 / options.foamResolution, 1 / options.foamResolution) },
            uDt: { value: 0 },
            uBody: { value: Array.from({ length: MAX_SPHERES }, () => new Vector4()) },
            uBodyVel: { value: Array.from({ length: MAX_SPHERES }, () => new Vector4()) },
            uCount: { value: 0 },
            uSplash: { value: Array.from({ length: MAX_SPLASHES }, () => new Vector4()) },
            uSplashCount: { value: 0 },
            uSimCenter: oceanUniforms.uSimCenter,
            uSimSize: oceanUniforms.uSimSize,
            // The breeze the wind sea runs before (WIND_DIRECTION, 20 deg).
            uDrift: { value: new Vector2(0.17, 0.06) },
            uChurn: { value: 1 },
        });

        this.quad = new Mesh(new PlaneGeometry(2, 2), this.dropMat);
        this.quad.frustumCulled = false;
        this.scene.add(this.quad);

        // --- Caustics grid ------------------------------------------------
        const n = options.causticGrid;
        const positions = new Float32Array(n * n * 3);
        for (let z = 0; z < n; z++) {
            for (let x = 0; x < n; x++) {
                const i = (z * n + x) * 3;
                positions[i] = x / (n - 1);
                positions[i + 1] = z / (n - 1);
            }
        }
        const index = new Uint32Array((n - 1) * (n - 1) * 6);
        let k = 0;
        for (let z = 0; z < n - 1; z++) {
            for (let x = 0; x < n - 1; x++) {
                const a = z * n + x;
                index[k++] = a;
                index[k++] = a + 1;
                index[k++] = a + n;
                index[k++] = a + n;
                index[k++] = a + 1;
                index[k++] = a + n + 1;
            }
        }
        this.causticGeometry = new BufferGeometry();
        this.causticGeometry.setAttribute('position', new BufferAttribute(positions, 3));
        this.causticGeometry.setIndex(new BufferAttribute(index, 1));

        this.causticMat = new ShaderMaterial({
            vertexShader: oceanCommon + causticVertex,
            fragmentShader: causticFragment,
            uniforms: {
                ...oceanUniforms,
                // The plane the focusing is measured at: roughly where the
                // whale's back sits under the surface in the opening shots.
                uCausticDepth: { value: 2.6 },
                // Sharpens the web. The visible sea is gentle, and gentle
                // waves focus light metres deeper than the whale swims.
                uSlopeGain: { value: 2.4 },
                // Only waves longer than ~1 unit shape the caustics: shorter
                // ones focus into a glitter of specks rather than a web.
                uGridFootprint: { value: Math.max(oceanUniforms.uSimSize.value / n, 0.3) },
                uCausticGain: { value: 1.0 },
            },
            blending: AdditiveBlending,
            depthTest: false,
            depthWrite: false,
            side: DoubleSide,
        });
        const causticMesh = new Mesh(this.causticGeometry, this.causticMat);
        causticMesh.frustumCulled = false;
        this.causticScene.add(causticMesh);

        this.clearTargets();
        this.publish();
    }

    get texture(): Texture {
        return this.front.texture;
    }

    /** Pointer or impact ripple along a world-space segment. */
    drop(x0: number, z0: number, x1: number, z1: number, radius: number, strength: number) {
        const size = oceanUniforms.uSimSize.value;
        const c = oceanUniforms.uSimCenter.value;
        const u = this.dropMat.uniforms;
        u.uA.value.set((x0 - c.x) / size + 0.5, (z0 - c.y) / size + 0.5);
        u.uB.value.set((x1 - c.x) / size + 0.5, (z1 - c.y) / size + 0.5);
        u.uRadius.value = radius / size;
        u.uStrength.value = strength;
        this.run(this.dropMat);
    }

    /** Spheres as (x, y relative to the mean surface, z, radius). */
    displace(previous: Float32Array, current: Float32Array, count: number) {
        const u = this.displaceMat.uniforms;
        const n = Math.min(count, MAX_SPHERES);
        for (let i = 0; i < n; i++) {
            (u.uOld.value as Vector4[])[i].fromArray(previous, i * 4);
            (u.uNew.value as Vector4[])[i].fromArray(current, i * 4);
        }
        u.uCount.value = n;
        this.run(this.displaceMat);
    }

    step() {
        this.run(this.updateMat);
    }

    /**
     * One step of the foam field. `body` is (x, y above the local surface, z,
     * radius) per sphere and `velocity` (vx, vy, vz, speed); `splashes` is
     * (x, z, radius, amount) per splash this frame.
     */
    updateFoam(
        dt: number,
        body: Float32Array,
        velocity: Float32Array,
        count: number,
        splashes: Float32Array,
        splashCount: number,
    ) {
        const u = this.foamMat.uniforms;
        u.uDt.value = dt;
        u.uSim.value = this.front.texture;
        const n = Math.min(count, MAX_SPHERES);
        for (let i = 0; i < n; i++) {
            (u.uBody.value as Vector4[])[i].fromArray(body, i * 4);
            (u.uBodyVel.value as Vector4[])[i].fromArray(velocity, i * 4);
        }
        u.uCount.value = n;
        const m = Math.min(splashCount, MAX_SPLASHES);
        for (let i = 0; i < m; i++) (u.uSplash.value as Vector4[])[i].fromArray(splashes, i * 4);
        u.uSplashCount.value = m;

        const gl = this.gl;
        const prev = gl.getRenderTarget();
        u.uSource.value = this.foamFront.texture;
        this.quad.material = this.foamMat;
        gl.setRenderTarget(this.foamBack);
        gl.render(this.scene, this.camera);
        gl.setRenderTarget(prev);
        const t = this.foamFront;
        this.foamFront = this.foamBack;
        this.foamBack = t;
        this.publish();
    }

    updateNormals() {
        this.run(this.normalMat);
    }

    updateCaustics() {
        const gl = this.gl;
        const prev = gl.getRenderTarget();
        gl.getClearColor(this.savedClear);
        const alpha = gl.getClearAlpha();
        gl.setRenderTarget(this.caustic);
        gl.setClearColor(0x000000, 0);
        gl.clear(true, false, false);
        gl.render(this.causticScene, this.camera);
        gl.setRenderTarget(prev);
        gl.setClearColor(this.savedClear, alpha);
    }

    setCausticParams(depth: number, slopeGain: number) {
        this.causticMat.uniforms.uCausticDepth.value = depth;
        this.causticMat.uniforms.uSlopeGain.value = slopeGain;
    }

    dispose() {
        this.front.dispose();
        this.back.dispose();
        this.caustic.dispose();
        this.foamFront.dispose();
        this.foamBack.dispose();
        this.quad.geometry.dispose();
        this.causticGeometry.dispose();
        [this.dropMat, this.updateMat, this.normalMat, this.displaceMat, this.foamMat, this.causticMat].forEach((m) =>
            m.dispose(),
        );
    }

    private run(material: ShaderMaterial) {
        const gl = this.gl;
        const prev = gl.getRenderTarget();
        material.uniforms.uSource.value = this.front.texture;
        this.quad.material = material;
        gl.setRenderTarget(this.back);
        gl.render(this.scene, this.camera);
        gl.setRenderTarget(prev);
        const t = this.front;
        this.front = this.back;
        this.back = t;
        this.publish();
    }

    private publish() {
        oceanUniforms.uSimTex.value = this.front.texture;
        oceanUniforms.uCausticTex.value = this.caustic.texture;
        oceanUniforms.uFoamTex.value = this.foamFront.texture;
    }

    private clearTargets() {
        const gl = this.gl;
        const prev = gl.getRenderTarget();
        gl.getClearColor(this.savedClear);
        const alpha = gl.getClearAlpha();
        gl.setClearColor(0x000000, 0);
        for (const t of [this.front, this.back, this.caustic, this.foamFront, this.foamBack]) {
            gl.setRenderTarget(t);
            gl.clear(true, false, false);
        }
        gl.setRenderTarget(prev);
        gl.setClearColor(this.savedClear, alpha);
    }
}
