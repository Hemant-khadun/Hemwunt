import { Canvas } from '@react-three/fiber';
import { EffectComposer } from '@react-three/postprocessing';
// Straight from the module, not the `lib` barrel: the barrel also exports the
// library's Leva control panel, and importing through it shipped Leva and
// its dependencies (~150 kB) to every visitor.
import { Fluid } from '../../lib/Fluid';
import { MAX_DPR } from '../utils/device';

/**
 * The fluid behind the open menu. Its own chunk, loaded the first time the
 * menu opens (see Header), and mounted only while it is open: hiding a canvas
 * with display:none does not stop it, R3F would keep a WebGL context and run
 * the simulation's passes every frame for a menu most visitors never open.
 *
 * Capped at the page's pixel ratio: a soft fluid gains nothing at DPR 2, and
 * the menu is a second WebGL context beside the scene. No `shadows`: nothing
 * in it casts one.
 */
const MenuFluid = () => (
    <Canvas className="canvas" dpr={MAX_DPR}>
        <EffectComposer>
            <Fluid rainbow={false} showBackground={false} />
        </EffectComposer>
    </Canvas>
);

export default MenuFluid;
