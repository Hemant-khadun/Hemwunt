/**
 * Splashes. Anything that hits the water (the visitor's press, a dev hook)
 * pushes one onto `pendingSplashes`; `Ocean` takes it on its next frame, puts
 * the ripple and the white water there, and hands it on to `sprayBursts`,
 * which `Spray` drains to throw the droplets and the bubbles.
 */
export interface SprayBurst {
    x: number;
    z: number;
    /** 1 = a hand slapping the water. */
    strength: number;
}

export const pendingSplashes: SprayBurst[] = [];
export const sprayBursts: SprayBurst[] = [];
