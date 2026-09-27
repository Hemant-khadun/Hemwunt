import { viewportHeight } from '../utils/viewport';
import { MathUtils, Vector3 } from 'three';
import type { Camera } from 'three';

/**
 * Where the whale is ON THE SCREEN, published once per frame.
 *
 * The portfolio items live outside the WebGL canvas, in the DOM, and some of
 * them want to answer to the whale — the reveal opens where it swept past.
 * This is the bridge: the whale's world position projected into viewport CSS
 * pixels. A singleton for the same reason `depthSignal` is one: the readers
 * are scattered across the DOM with no shared React ancestor, and there is
 * exactly one whale.
 *
 * Written from `WhaleModel`'s existing frame callback, directly after the
 * world position is read, so it costs one matrix multiply on a preallocated
 * vector and allocates nothing.
 *
 * The canvas wrapper is position: fixed at 100vw x 100vh, so normalised device
 * coordinates map straight onto viewport coordinates with no scroll offset.
 */
export interface WhaleScreenPoint {
    /** False until the first projection. Consumers treat it as off screen. */
    valid: boolean;
    /** CSS pixels from the viewport's left edge. */
    x: number;
    /** CSS pixels from the viewport's top edge. */
    y: number;
    /** -1..1 across the frame; beyond that range it is off screen. */
    ndcX: number;
    ndcY: number;
    /** In front of the camera AND horizontally inside the frame. */
    onScreen: boolean;
    /** 0 inside the frame, ramping to 1 one frame-width beyond it (and 1 when
     *  behind the camera). Consumers fade their coupling out with this rather
     *  than cutting it, so the whale leaving frame never pops anything. */
    edgeFalloff: number;
}

export const whaleScreen: WhaleScreenPoint = {
    valid: false,
    x: 0,
    y: 0,
    ndcX: 0,
    ndcY: 0,
    onScreen: false,
    edgeFalloff: 1,
};

const scratch = new Vector3();

/**
 * Project a world position through `camera` into `whaleScreen`.
 *
 * The in-front test happens in VIEW space, before the projection, and that
 * ordering is not a style choice: `Vector3.project` divides by w, and a point
 * behind the camera has negative w, so its projected coordinates come out
 * silently MIRRORED onto the screen. During the reveal swim-in or a wide turn
 * that would report the whale confidently on the wrong side of the frame.
 */
export function projectWhale(worldPos: Vector3, camera: Camera): void {
    scratch.copy(worldPos).applyMatrix4(camera.matrixWorldInverse);
    // Camera looks down its own -Z. Anything at or behind z = 0 in view space
    // is not in front of it; a small margin keeps the divide well-conditioned.
    const inFront = scratch.z < -0.05;

    // applyMatrix4 performs the perspective divide.
    scratch.applyMatrix4(camera.projectionMatrix);

    whaleScreen.valid = true;
    whaleScreen.ndcX = scratch.x;
    whaleScreen.ndcY = scratch.y;
    whaleScreen.x = (scratch.x * 0.5 + 0.5) * window.innerWidth;
    whaleScreen.y = (-scratch.y * 0.5 + 0.5) * viewportHeight();
    whaleScreen.onScreen = inFront && Math.abs(scratch.x) <= 1;
    whaleScreen.edgeFalloff = inFront ? MathUtils.clamp(Math.abs(scratch.x) - 1, 0, 1) : 1;
}
