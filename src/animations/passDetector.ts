/**
 * Detects the moment the whale sweeps closest to the viewer.
 *
 * Pure maths, no scene graph, so it can be simulated headlessly like the rest
 * of `animations/`.
 *
 * The whale crosses the frame left to right and back, so its distance to the
 * camera falls to a minimum as it passes the middle and rises again toward the
 * edges. A bare "is it near?" test would fire every frame for the whole
 * crossing. This uses hysteresis instead: the whale has to travel back out past
 * `armDistance` before another pass counts, and the wave fires on the frame the
 * distance stops falling and starts rising, which is the nearest point.
 *
 * Starting DISARMED matters. The whale begins its life near the middle of the
 * frame, so an armed detector would throw a wave the instant the page settled.
 */
export interface PassDetectorOptions {
    /** Fire only if the nearest point of the pass is at least this close. */
    triggerDistance: number;
    /** The whale must retreat past this before another pass can fire. */
    armDistance: number;
}

export interface PassDetector {
    /** Feed the current camera distance. True on the frame of closest approach. */
    update(distance: number): boolean;
    /** True once the whale has retreated far enough to fire again. */
    readonly armed: boolean;
}

export function createPassDetector(options: PassDetectorOptions): PassDetector {
    let armed = false;
    let previous = Infinity;

    return {
        get armed() {
            return armed;
        },
        update(distance: number): boolean {
            let fired = false;

            if (!armed) {
                if (distance > options.armDistance) armed = true;
            } else if (distance < options.triggerDistance && distance > previous) {
                // Distance has stopped falling: this frame is the nearest point.
                armed = false;
                fired = true;
            }

            previous = distance;
            return fired;
        },
    };
}
