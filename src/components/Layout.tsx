import { lazy, Suspense, useEffect } from 'react';
import MarineSnow from '../utils/MarineSnow';
import Story from './Story';
import Header from './Header';
import Portfolio from './Portfolio';
import Footer from './Footer';
import Statement from './Statement';
import Cursor from '../utils/Cursor';
import Scrollbar from '../utils/Scrollbar';
import SmoothScroll from '../utils/SmoothScroll';
import ScrollBeats from '../utils/ScrollBeats';
import useDepthCss from '../animations/useDepthCss';
import SceneBoundary from './SceneBoundary';
import { CAN_HOVER, webgl } from '../utils/device';
import { preloadSceneAssets } from '../utils/sceneAssets';
import { expectScene, loaderTask, loaderWaitsFor, sceneAbandoned, sealLoader } from '../utils/loader';

// The WebGL scene is a chunk of its own (see WebGLStage), started here at
// load rather than at first render, with its big assets beside it, so it
// downloads while React puts the words on screen. Not at all where the
// browser cannot run it (see utils/device.ts): the page is DOM-only there.
//
// The loader (index.html) holds the page back until its first screen is in:
// the scene's chunk and assets, the scene mounted and drawn, and the page's
// own words in their typeface. Weights are roughly MB (see utils/loader.ts).
const stage = webgl.ok ? import('./WebGLStage') : null;
if (stage) {
    loaderWaitsFor('sea', 0.6, stage);
    preloadSceneAssets();
    expectScene();
}
const WebGLStage = stage ? lazy(() => stage) : null;
const pageDrawn = loaderTask('', 0.1);
sealLoader();

/**
 * The page, in descent order.
 *
 * The sections are read as depth stations by the dive director (see
 * `src/animations/diveScore.ts`): #home is the surface, the portfolio items
 * are the descent, #statement is the deepest point, and the footer is the
 * ascent back to light. Reordering them reorders the dive.
 *
 * Only one WebGL canvas is mounted here, by `<WebGLStage/>`: the scene pushes
 * the whale, the rays and the post chain through a tunnel-rat portal into a
 * single fixed, pointer-transparent layer behind the content. It is loaded
 * lazily and fenced by `<SceneBoundary/>`, so a browser that cannot run it,
 * or a chunk that fails to arrive, leaves a working page.
 */
const Layout = () => {
    // Publishes the depth signal into CSS custom properties on :root, so the
    // DOM half of the page grades with the same water the scene does.
    useDepthCss();

    // The page is on screen; it is in once its type is too, so nothing on it
    // reflows or swaps font as the loader opens.
    useEffect(() => {
        const fonts = document.fonts;
        if (!fonts) return pageDrawn();
        fonts.load('1em Montserrat').then(() => fonts.ready).then(pageDrawn, pageDrawn);
    }, []);

    return (
        <div>
            <SmoothScroll />
            {/* After SmoothScroll: plays the story one scene per scroll, and
                settles the page on the projects when the visitor stops. */}
            <ScrollBeats />

            {/* Behind the WebGL canvas. Paints the water gradient and the
                marine snow drifting down through it. */}
            <MarineSnow />

            <div id="home" className="section">
                <Header />
            </div>

            {/* The opening story: chapters scrubbed by scroll between the hero
                and the projects (see animations/story.ts). */}
            <Story />

            {WebGLStage && (
                <SceneBoundary onError={sceneAbandoned}>
                    <Suspense fallback={null}>
                        <WebGLStage />
                    </Suspense>
                </SceneBoundary>
            )}

            <div id="portfolio" className="section">
                <Portfolio />
            </div>

            <div id="statement" className="section">
                <Statement />
            </div>

            <Footer />

            <Scrollbar />
            {/* A trail for a mouse to lead. On touch there is nothing to
                follow, and its dots sat stranded in the top-left corner. */}
            {CAN_HOVER && <Cursor />}
        </div>
    );
};

export default Layout;
