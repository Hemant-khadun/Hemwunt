import whaleModelUrl from '../assets/models/humpback_whale.glb?url';
import { IS_MOBILE } from './device';
import { loaderTask } from './loader';

/**
 * The scene's files in public/, in one place, so the loaders and the preload
 * below always ask for the same URL.
 *
 * Prefixed with Vite's `base` (BASE_URL, '/' by default), so the site also
 * works when it is served from a sub-path. A bare '/sky/sky.jpg' only
 * resolves at the domain root.
 */
export const publicUrl = (path: string) => `${import.meta.env.BASE_URL}${path.replace(/^\//, '')}`;

/** The sky over the surface: a lighter file for the phone's screen. */
export const SKY_URL = publicUrl(IS_MOBILE ? 'sky/sky-mobile.jpg' : 'sky/sky.jpg');
export const WATER_NORMALS_URL = publicUrl('textures/water-normals.jpg');
/** The whale's environment light (see scripts/visual/downsampleHdr.py). */
export const SCENE_HDRI_URL = publicUrl('hdri/dikhololo_night_512.hdr');
/** The footer sphere's reflections. */
export const FOOTER_HDRI_URL = publicUrl('hdri/empty_warehouse_01_1k.hdr');

/**
 * Starts the scene's big downloads at load.
 *
 * Left to themselves, the whale, the sky and the environment map would be
 * requested only once the scene's chunk had arrived and its components had
 * mounted: one download after another, with the largest file (the whale)
 * last. Preloading them from here puts them on the wire beside that chunk.
 *
 * `crossorigin` matches what the loaders send (three's FileLoader fetches in
 * CORS mode; its TextureLoader sets crossOrigin 'anonymous' on the image), so
 * the browser hands the preloaded response over instead of fetching twice.
 *
 * Each one is also on the first screen, so the page's loader waits for it
 * (utils/loader.ts), weighted by its size in MB (what its percentage counts)
 * and lighting its word as it lands.
 */
export function preloadSceneAssets() {
    const assets: Array<[string, 'fetch' | 'image', string, number]> = [
        [whaleModelUrl, 'fetch', 'whale', 3.5],
        [SKY_URL, 'image', 'sky', IS_MOBILE ? 0.1 : 0.26],
        [WATER_NORMALS_URL, 'image', 'sea', 0.11],
        [SCENE_HDRI_URL, 'fetch', 'light', 0.43],
    ];
    // Without preload there is no load event to count; the scene's own mount
    // (see expectScene) still holds the loader until they are in.
    const canPreload = document.createElement('link').relList?.supports?.('preload') ?? false;
    for (const [href, as, part, weight] of assets) {
        const link = document.createElement('link');
        link.rel = 'preload';
        link.as = as;
        link.href = href;
        link.crossOrigin = 'anonymous';
        if (canPreload) {
            const done = loaderTask(part, weight);
            link.onload = link.onerror = () => done();
        }
        document.head.appendChild(link);
    }
}
