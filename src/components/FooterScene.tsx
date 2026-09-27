import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { Suspense, useEffect, useState } from 'react';
import type { RefObject } from 'react';
// @ts-ignore — Scene is plain JSX with no type declarations.
import Scene from './Scene';
import { IS_TOUCH } from '../utils/device';

/**
 * The footer's sphere: a second WebGL context with its own HDRI, in its own
 * chunk (Footer loads it as the footer comes near).
 *
 * It renders only while it can be seen. Once mounted it stays mounted (a
 * context torn down and rebuilt on every scroll up and back costs more), but
 * its frame loop stops whenever the footer is off screen, instead of drawing
 * a distorting sphere nobody can see behind the whole rest of the page.
 *
 * No orbit drag on touch screens: OrbitControls sets `touch-action: none` on
 * its canvas, which on a phone is a 400 px band across the footer where a
 * swipe could not scroll the page. The sphere still answers a tap.
 */
const FooterScene = ({ container }: { container: RefObject<HTMLElement> }) => {
    const [onScreen, setOnScreen] = useState(true);

    useEffect(() => {
        const el = container.current;
        if (!el) return;
        const observer = new IntersectionObserver(([entry]) => setOnScreen(entry.isIntersecting), {
            rootMargin: '100px 0px',
        });
        observer.observe(el);
        return () => observer.disconnect();
    }, [container]);

    return (
        <Canvas className="canvas" dpr={[1, 2]} frameloop={onScreen ? 'always' : 'never'}>
            <Suspense fallback={null}>
                <Scene setBg={() => {}} />
            </Suspense>
            {!IS_TOUCH && (
                <OrbitControls
                    enablePan={false}
                    enableZoom={false}
                    maxPolarAngle={Math.PI / 2}
                    minPolarAngle={Math.PI / 2}
                />
            )}
        </Canvas>
    );
};

export default FooterScene;
