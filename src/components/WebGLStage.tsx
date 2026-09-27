import Hero from './Hero';
import RF3Canvas from '../utils/Canvas';

/**
 * Everything that needs the renderer, as one lazily loaded chunk: the canvas,
 * and the scene pushed into it (the sea, the whale, the light, the post
 * chain). Three's addons, R3F, drei, postprocessing and the scene's shaders
 * are most of the page's script, and none of it is needed to put the hero's
 * words on screen, so the page renders first and this arrives beside it
 * (Layout starts the download at load, not at first render).
 *
 * `<Hero/>` renders no DOM: it goes through the tunnel into the canvas.
 */
const WebGLStage = () => (
    <>
        <Hero />
        <RF3Canvas />
    </>
);

export default WebGLStage;
