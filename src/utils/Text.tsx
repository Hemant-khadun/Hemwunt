'use client';

import { Text as DreiText } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useRef, useState } from 'react';
import { Group } from 'three';
import monserrat_font from '@/assets/Montserrat-VariableFont_wght.ttf';

const Text = () => {
    const groupRef = useRef<Group>(null);
    const textRef1 = useRef<any>(null);
    const textRef2 = useRef<any>(null);

    // Measured widths of each word so the merged phrase can be centered as a whole,
    // since "FULLS" and "TACK DEVELOPER" have different widths but must meet at one seam.
    const [width1, setWidth1] = useState(0);
    const [width2, setWidth2] = useState(0);
    const seamX = (width1 - width2) / 2;

    // Base vertical position: low in frame, clear of the whale's entrance
    // (the reveal's tail-smash + dive lands in the upper-right splash) and of
    // the waterline crossing it used to sit on.
    const BASE_Y = -8;

    useFrame(() => {
        if (groupRef.current) {
            const scrollY = window.scrollY;
            const fadeStart = 100;
            const fadeEnd = 500;

            // Sticky effect: Keep it centered but move it slightly up as we scroll
            groupRef.current.position.y = BASE_Y + scrollY * 0.005;

            // Fade effect
            const opacity = 1 - Math.min(1, Math.max(0, (scrollY - fadeStart) / (fadeEnd - fadeStart)));
            if (textRef1.current) {
                textRef1.current.fillOpacity = opacity;
            }
            if (textRef2.current) {
                textRef2.current.fillOpacity = opacity;
            }
        }
    });

    return (
        <group ref={groupRef} position-y={-8} position-z={-7}>
            <DreiText
                ref={textRef1}
                font={monserrat_font}
                anchorX="right"
                position-x={seamX}
                position-y={-1.17}
                fontSize={2}
                color='#c2c2cc'
                fontWeight={600}
                onSync={(troika: any) => {
                    const bounds = troika.textRenderInfo?.blockBounds;
                    if (bounds) setWidth1(bounds[2] - bounds[0]);
                }}>
                FULLS
            </DreiText>
            <DreiText
                ref={textRef2}
                font={monserrat_font}
                anchorX="left"
                position-x={seamX}
                position-y={-1.21}
                fontSize={2}
                color='#c2c2cc'
                fontWeight={600}
                onSync={(troika: any) => {
                    const bounds = troika.textRenderInfo?.blockBounds;
                    if (bounds) setWidth2(bounds[2] - bounds[0]);
                }}>
                TACK DEVELOPER
            </DreiText>
        </group>
    );
};

export default Text;
