import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

/**
 * Where each portfolio item is, relative to the viewport, as the dive director
 * needs to see it.
 *
 * One unscrubbed ScrollTrigger per item, spanning from the moment its top
 * enters at the bottom of the screen to the moment its bottom leaves at the
 * top. Its only job is to write a number.
 *
 * Why not the item's existing reveal trigger: that one is windowed on the
 * DISSOLVE ('top bottom-=20%' for '+=80%'), and reusing it would weld the
 * whale's pacing to the reveal's. The two want tuning independently.
 *
 * Why not measure `getBoundingClientRect()` each frame: the items are being
 * transformed by GSAP on every scroll frame, so reading layout from them in
 * the render loop is a read-after-write and forces a synchronous reflow.
 * ScrollTrigger measures once on refresh, caches, and batches every trigger
 * into a single scroll handler, which is exactly the work we would otherwise
 * be reinventing badly.
 */
export interface Station {
    index: number;
    /** 0 as the item's top enters at the bottom, 1 as its bottom leaves at the
     *  top. 0.5 is (for a ~viewport-tall item) dead centre. */
    progress: number;
    /** -1 below the fold, 0 centred, +1 above. The director keys most beats
     *  off this rather than off progress, because "how far from centre" is
     *  the question a shot actually asks. */
    centred: number;
    /** True while any part of the item is on screen. */
    inView: boolean;
    /** The page scroll offset, in pixels, at which the item sits dead centre
     *  in the viewport. Measured by ScrollTrigger on refresh; this is the key
     *  the dive director composes each shot around. */
    centreScroll: number;
    /** False until the first refresh has measured the item. */
    measured: boolean;
    /** The item itself. For the rare consumer that must read layout — the
     *  front pass, for a few seconds once per descent. Not for frame loops. */
    element: HTMLElement;
}

const stations = new Map<number, Station>();

/**
 * Register a portfolio item as a station. Returns the teardown; call it on
 * unmount or the trigger outlives the element and keeps writing to a station
 * that no longer exists.
 */
export function registerStation(index: number, element: HTMLElement): () => void {
    const station: Station = {
        index,
        progress: 0,
        centred: -1,
        inView: false,
        centreScroll: 0,
        measured: false,
        element,
    };
    stations.set(index, station);

    const trigger = ScrollTrigger.create({
        trigger: element,
        start: 'top bottom',
        end: 'bottom top',
        onUpdate: (self) => {
            station.progress = self.progress;
            station.centred = self.progress * 2 - 1;
        },
        onToggle: (self) => {
            station.inView = self.isActive;
        },
        // A deep-linked or restored scroll position lands mid-page without
        // ever firing onUpdate; refresh is where the first real value arrives.
        // It is also where layout is measured, so the centre is taken here.
        // 'top bottom' to 'bottom top' is symmetric about the item's centre
        // meeting the viewport's centre, so the midpoint of the two IS that
        // scroll offset — no separate rect read needed.
        onRefresh: (self) => {
            station.progress = self.progress;
            station.centred = self.progress * 2 - 1;
            station.inView = self.isActive;
            station.centreScroll = (self.start + self.end) / 2;
            station.measured = true;
        },
    });

    return () => {
        trigger.kill();
        // Only remove it if it is still ours. Under StrictMode the effect runs
        // mount-unmount-mount, and the second registration can land before the
        // first teardown — deleting unconditionally would erase the live one.
        if (stations.get(index) === station) stations.delete(index);
    };
}

/** Registered stations, in index order. Allocates; not for the frame loop. */
export function getStations(): Station[] {
    return [...stations.values()].sort((a, b) => a.index - b.index);
}

/** A registered station by index, or undefined. Frame-loop safe. */
export function getStation(index: number): Station | undefined {
    return stations.get(index);
}

/**
 * The station nearest viewport centre, among those in view. Frame-loop safe:
 * iterates the map without allocating. Undefined in the hero, the statement
 * and the footer, which is how the director knows it is between stations.
 */
export function getActiveStation(): Station | undefined {
    let best: Station | undefined;
    for (const s of stations.values()) {
        if (!s.inView) continue;
        if (!best || Math.abs(s.centred) < Math.abs(best.centred)) best = s;
    }
    return best;
}
