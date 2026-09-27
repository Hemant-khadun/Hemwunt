/**
 * Where things are in the world, in the units the whale animator thinks in.
 *
 * These are scene-geometry constants rather than locomotion tuning, which is
 * why they are here and not in `whaleConfig.ts`. They are shared by the
 * surface plane, the light rig and the whale's body shader, and every one of
 * those breaks in a different and confusing way if they disagree — a surface
 * above the sun, a whale lit from below, a body gradient anchored to nothing.
 *
 * The frame, for reference. The camera sits at y = -2, z = 4, looking down
 * -Z with a vertical field of view of 80 degrees, so at the z = 0 plane it
 * sees a half-height of 4 * tan(40 deg) ~= 3.36 — a visible band from about
 * y = -5.4 to y = +1.4, and a half-width of about 7.8.
 */

/**
 * World Y of the water surface.
 *
 * Just inside the top of the hero frame (which ends around y = +1.4), so the
 * page opens with the surface visible overhead and the whale a body-length
 * beneath it. That proximity is the whole point of the first screen: you are
 * not in the deep yet, you are just under the skin of the water, and the
 * descent has somewhere to start from.
 */
export const SURFACE_Y = 1.1;

/**
 * World Y of the sun. Above the surface, not on it — the light has to come
 * through the water, not be emitted by it.
 *
 * The important consequence of anchoring the sun in the world rather than to
 * the camera is that the whale genuinely swims away from it. Falloff over the
 * descent then comes out of the geometry for free, instead of being a curve
 * somebody has to keep in sync with the depth table.
 */
export const SUN_Y = SURFACE_Y + 10;

/**
 * How far the sun reaches. The whale bottoms out around y = -6, which is
 * roughly 17 units below the sun, so this is set just past that: the light
 * runs out at almost exactly the moment the page does.
 */
export const SUN_DISTANCE = 30;

/** Half-width of the visible frame at z = 0. Used to decide whether the whale
 *  is on screen without every consumer re-deriving it from the FOV. */
export const FRAME_HALF_WIDTH = 7.8;
