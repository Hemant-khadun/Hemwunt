import { viewportHeight } from '../utils/viewport';
import { Quaternion, Vector3 } from 'three';
import type { Camera, Object3D, PerspectiveCamera } from 'three';

/**
 * The whale's whole body ON THE SCREEN, published once per frame.
 *
 * `screenProjector` gives the DOM one point, the whale's centre. The story's
 * swim-by needs more: its last phrase is written in the whale's wake, each
 * word once the animal has passed it, and a word must not be written over a
 * body that is still crossing it. So this is the outline as a handful of
 * discs in viewport pixels: along the spine (the same chain the water feels,
 * see `BODY` in Ocean.tsx), down each flipper, and out to the tips of the
 * flukes, which have no bones of their own.
 *
 * Written from WhaleModel's frame callback after the pose is applied;
 * allocates nothing per frame.
 */

/** Bones and the radius (world units) of the body around each. Head to fluke,
 *  then the flippers, root to tip. */
const DISCS: Array<[string, number]> = [
    ['Bone007_end_019', 1.3],
    ['Bone007_07', 1.9],
    ['Bone006_06', 2.2],
    ['Bone003_01', 2.0],
    ['Bone002_02', 1.6],
    ['Bone001_03', 1.3],
    ['Bone005_04', 1.1],
    ['Bone004_05', 0.8],
    ['Bone004_end_018', 1.0],
    ['Bone010_013', 0.8],
    ['Bone016_014', 0.7],
    ['Bone016_end_024', 0.6],
    ['Bone011_016', 0.8],
    ['Bone017_017', 0.7],
    ['Bone017_end_025', 0.6],
];
/** The fluke tips, either side of the tail bone along the body's own
 *  sideways axis (units), and their radius. */
const FLUKE_HALF_SPAN = 3.3;
const FLUKE_TIP_RADIUS = 0.7;
/** The spine runs low in the body, nearer the belly than the back, so a disc
 *  round each spine bone left the back and the crown of the head outside the
 *  outline, and words stayed written over them. The spine's discs (the first
 *  SPINE of DISCS) are lifted toward the back along the body's own up
 *  (units), and grown a little. */
const SPINE = 9;
const BACK_LIFT = 0.8;
const BACK_GROW = 1.2;
/** A disc nearer the lens than this (units, in front of it) is beside or
 *  behind the camera: it is counted as off the edge of the frame on its side
 *  rather than projected (a point behind the lens projects mirrored). */
const NEAR = 0.3;

const MAX = DISCS.length + 2;

export const whaleOutline = {
    /** Viewport CSS pixels: centre x, centre y, radius, per disc. */
    discs: new Float32Array(MAX * 3),
    count: 0,
    /** performance.now() of the last write. Stale means there is no whale on
     *  the page (no WebGL), and readers fall back to the page's clock. */
    at: Number.NEGATIVE_INFINITY,
};

const world = new Vector3();
const view = new Vector3();
const side = new Vector3();
const up = new Vector3();
const turn = new Quaternion();

export function createWhaleOutline(nodes: Record<string, Object3D>) {
    const bones = DISCS.map(([name, radius], i) => ({ bone: nodes[name], radius, spine: i < SPINE })).filter((d) => d.bone);
    const tail = nodes.Bone004_end_018;

    const put = (camera: Camera, p: Vector3, radius: number, i: number) => {
        const cam = camera as PerspectiveCamera;
        view.copy(p).applyMatrix4(cam.matrixWorldInverse);
        const w = window.innerWidth;
        const h = viewportHeight();
        const o = i * 3;
        if (view.z > -NEAR) {
            // Beside or behind the lens: off the frame on that side.
            whaleOutline.discs[o] = view.x < 0 ? -1e5 : w + 1e5;
            whaleOutline.discs[o + 1] = h / 2;
            whaleOutline.discs[o + 2] = 0;
            return;
        }
        const depth = -view.z;
        view.applyMatrix4(cam.projectionMatrix);
        whaleOutline.discs[o] = (view.x * 0.5 + 0.5) * w;
        whaleOutline.discs[o + 1] = (-view.y * 0.5 + 0.5) * h;
        // projectionMatrix[5] is 1 / tan(fov / 2): pixels per unit at depth 1
        // is that times half the viewport height.
        whaleOutline.discs[o + 2] = (radius * cam.projectionMatrix.elements[5] * 0.5 * h) / depth;
    };

    return {
        update(whale: Object3D, camera: Camera) {
            let n = 0;
            whale.getWorldQuaternion(turn);
            up.set(0, BACK_LIFT, 0).applyQuaternion(turn);
            for (const { bone, radius, spine } of bones) {
                bone.getWorldPosition(world);
                if (spine) world.add(up);
                put(camera, world, spine ? radius * BACK_GROW : radius, n++);
            }
            if (tail) {
                side.set(0, 0, 1).applyQuaternion(turn).multiplyScalar(FLUKE_HALF_SPAN);
                tail.getWorldPosition(world);
                put(camera, world.add(side), FLUKE_TIP_RADIUS, n++);
                put(camera, world.sub(side).sub(side), FLUKE_TIP_RADIUS, n++);
            }
            whaleOutline.count = n;
            whaleOutline.at = performance.now();
        },
    };
}
