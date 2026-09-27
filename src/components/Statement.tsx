import { viewportHeight } from '../utils/viewport';
import { useEffect, useRef } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { prefersReducedMotion } from '../animations/motionPreference';
import { parseLine, span, writeWords } from '../animations/words';
import WrittenLine from './WrittenLine';

gsap.registerPlugin(ScrollTrigger);

/**
 * The statement, at the deepest point of the dive.
 *
 * Written the way the story and the project chapters write theirs: set word
 * by word into its lines, scrubbed by scroll (see animations/words.ts), in light
 * Montserrat with the key phrases in the italic serif. It used to play once
 * on an IntersectionObserver in bold gradient type, which was the one voice
 * on the page that did not match the others.
 */
const LINES = [
    "I don't just write code.",
    'I architect scalable *digital ecosystems.*',
    'Bringing *algorithmic precision*',
    'and *creative passion* to every pixel.',
    "Let's engineer *the future* together.",
].map(parseLine);

const Statement = () => {
    const sectionRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const el = sectionRef.current;
        if (!el) return;
        const words = Array.from(el.querySelectorAll<HTMLElement>('.story-word, [data-statement-detail]'));
        const write = (self: ScrollTrigger) => {
            const t = (self.scroll() - self.start) / viewportHeight();
            writeWords(words, span(t, 0.25, 1.05), 0, prefersReducedMotion());
        };
        const trigger = ScrollTrigger.create({
            trigger: el,
            start: 'top bottom',
            end: 'bottom top',
            onUpdate: write,
            onRefresh: write,
        });
        return () => trigger.kill();
    }, []);

    return (
        <div ref={sectionRef} className="statement-container">
            <div className="statement-content">
                <p className="statement-subtitle" data-statement-detail data-write="wipe">
                    My commitment
                </p>
                {LINES.map((line, li) => (
                    <h2 key={li} className={`statement-text${li === LINES.length - 1 ? ' statement-highlight' : ''}`}>
                        <WrittenLine words={line} />
                    </h2>
                ))}
                <p className="statement-footer" data-statement-detail>
                    I am dedicated to crafting robust, high-performance web applications that solve complex
                    problems. From intuitive frontend interfaces to powerful backend architectures, I build
                    solutions that scale.
                </p>
            </div>
        </div>
    );
};

export default Statement;
