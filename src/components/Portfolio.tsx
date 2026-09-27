import { viewportHeight } from '../utils/viewport';
import { useEffect, useRef } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { prefersReducedMotion } from '../animations/motionPreference';
import { DISSOLVE_SECONDS, WRITE_SECONDS, pace, parseLine, span, writeWords } from '../animations/words';
import ProjectChapter from './projects/ProjectChapter';
import { PROJECTS } from './projects/projects';
import WrittenLine from './WrittenLine';

gsap.registerPlugin(ScrollTrigger);

/** The line that opens the work, written like the story's chapters. */
const INTRO = ['Five projects,', '*five depths.*'].map(parseLine);

// The page settling on the intro and on each project's centre is
// utils/ScrollBeats.tsx, with the story's scenes.
const Portfolio = () => {
    const introRef = useRef<HTMLElement>(null);

    // The intro's words, scrubbed by its own passage through the viewport, and
    // paced like the story's (see `pace`): the page glides onto the intro in
    // one scene, and the line still writes itself in word by word.
    useEffect(() => {
        const el = introRef.current;
        if (!el) return;
        const words = Array.from(el.querySelectorAll<HTMLElement>('.story-word, [data-intro-detail]'));
        const reduced = prefersReducedMotion();
        let wantEnter = 0;
        let wantExit = 0;
        let enter = -1;
        let exit = -1;
        const read = (self: ScrollTrigger) => {
            const t = (self.scroll() - self.start) / viewportHeight();
            wantEnter = span(t, 0.3, 0.9);
            wantExit = span(t, 1.22, 1.7);
        };
        const trigger = ScrollTrigger.create({
            trigger: el,
            start: 'top bottom',
            end: 'bottom top',
            onUpdate: read,
            onRefresh: read,
        });
        const tick = (_time: number, deltaMs: number) => {
            if (enter === wantEnter && exit === wantExit) return;
            const dt = Math.min(0.1, deltaMs / 1000);
            // Starts on the scroll's values: nothing plays on load.
            // Jumped clean over (never on screen): simply where the page
            // says, rather than written in and out on the way past.
            const off = wantEnter <= 0 || wantExit >= 1;
            if (enter < 0 || (off && (enter < 0.02 || exit > 0.98))) {
                enter = wantEnter;
                exit = wantExit;
            }
            enter = pace(enter, wantEnter, dt, WRITE_SECONDS, DISSOLVE_SECONDS);
            exit = pace(exit, wantExit, dt, DISSOLVE_SECONDS, WRITE_SECONDS);
            writeWords(words, enter, exit, reduced);
        };
        gsap.ticker.add(tick);
        return () => {
            gsap.ticker.remove(tick);
            trigger.kill();
        };
    }, []);

    return (
        <div className="portfolio-section">
            <header className="projects-intro" ref={introRef}>
                <p className="projects-intro__kicker" data-intro-detail data-write="wipe">
                    Selected work
                </p>
                <h2 className="projects-intro__title">
                    {INTRO.map((line, li) => (
                        <WrittenLine key={li} words={line} />
                    ))}
                </h2>
                <p className="projects-intro__sub" data-intro-detail data-write="wipe">
                    Each one a little deeper than the last.
                </p>
            </header>

            {PROJECTS.map((project, index) => (
                <ProjectChapter key={project.id} project={project} index={index} total={PROJECTS.length} />
            ))}
        </div>
    );
};

export default Portfolio;
