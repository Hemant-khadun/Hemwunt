/**
 * What the visitor's device is, decided once at load.
 *
 * Every consumer used to ask `matchMedia('(max-width: 860px)')` on its own;
 * they agree now because they read the same constants. Decided ONCE, never
 * re-evaluated mid-scroll: swapping a pass or a particle budget while the
 * visitor watches is a visible pop, and a phone rotated to landscape is
 * still a phone's GPU.
 */

const hasWindow = typeof window !== 'undefined';
const media = (query: string) => hasWindow && !!window.matchMedia?.(query).matches;

/** A narrow screen: the phone layout, and the phone's GPU budget. */
export const IS_MOBILE = media('(max-width: 860px)');

/** A pointer that can hover precisely (a mouse or trackpad), so the custom
 *  cursor has something to follow. False on phones and tablets, and on
 *  touch laptops being used by touch. */
export const CAN_HOVER = media('(hover: hover) and (pointer: fine)');

/** A touch-first device, whatever its width (an iPad is not narrow). */
export const IS_TOUCH = media('(pointer: coarse)');

/**
 * The highest device pixel ratio the WebGL canvas renders at. A phone at DPR
 * 3, or a retina laptop at 2, would otherwise shade the sea, the light volume
 * and every post pass at up to four times the pixels of 1.5, for detail no one
 * sees through water and grain; the text is DOM and stays sharp regardless.
 * The adaptive resolution (animations/frameBudget.ts) scales down from here.
 */
export const MAX_DPR = hasWindow ? Math.min(window.devicePixelRatio || 1, 1.5) : 1;

export interface WebGLSupport {
    /** WebGL 2 with renderable float colour buffers: what the scene needs. */
    ok: boolean;
    /** Why not, when it isn't (logged once, for anyone debugging a report). */
    reason?: string;
}

/**
 * Can this browser run the scene?
 *
 * three r160 quietly falls back to WebGL 1 when WebGL 2 is missing, but the
 * ocean's shaders are GLSL 3 (textureLod, float targets): on WebGL 1 they fail
 * to compile and the page shows a broken sea instead of none. The post chain
 * and the wave simulation render into half-float targets, which needs one of
 * the colour-buffer-float extensions. Without all of that the page runs as
 * DOM only — the painted water, the marine snow, the story and the work —
 * which is a good page, not an error.
 *
 * Probed on a throwaway canvas whose context is released straight away, so the
 * probe does not count against the browser's limit on live contexts.
 */
function probeWebGL(): WebGLSupport {
    if (!hasWindow) return { ok: false, reason: 'no window' };
    if (import.meta.env.DEV && new URLSearchParams(window.location.search).has('nowebgl')) {
        return { ok: false, reason: '?nowebgl' };
    }
    try {
        const canvas = document.createElement('canvas');
        const gl = canvas.getContext('webgl2', { antialias: false, depth: false, powerPreference: 'default' });
        if (!gl) return { ok: false, reason: 'WebGL 2 unavailable' };
        const floatBuffers = !!(gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float'));
        gl.getExtension('WEBGL_lose_context')?.loseContext();
        return floatBuffers ? { ok: true } : { ok: false, reason: 'no renderable float colour buffers' };
    } catch (error) {
        return { ok: false, reason: String(error) };
    }
}

export const webgl = probeWebGL();

if (!webgl.ok && hasWindow) {
    console.info(`[scene] running without WebGL: ${webgl.reason}`);
}
