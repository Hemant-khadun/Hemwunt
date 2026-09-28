import { viewportHeight } from '../../utils/viewport';
import { useEffect, useRef, useState } from 'react';
import type { ComponentType, ForwardRefExoticComponent, RefAttributes, RefObject } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { registerStation } from '../../animations/stationRegistry';
import { prefersReducedMotion } from '../../animations/motionPreference';
import { depthFromScroll } from '../../animations/depthSignal';
import { depthProgress } from '../../animations/story';
import { createOceanSample, sampleOcean } from '../../animations/oceanPalette';
import { parseLine, smooth, span, writeWords } from '../../animations/words';
import { IS_TOUCH } from '../../utils/device';
import WrittenLine from '../WrittenLine';
import { cld } from './projects';
import type { Project, RevealKind } from './projects';
import type { RevealHandle, RevealProps } from './reveals/types';
import DriveReveal from './reveals/DriveReveal';
import ShelvesReveal from './reveals/ShelvesReveal';
import CalendarReveal from './reveals/CalendarReveal';
import BrushReveal from './reveals/BrushReveal';
import PlayReveal from './reveals/PlayReveal';

gsap.registerPlugin(ScrollTrigger);

/**
 * One project, told as a chapter of the dive.
 *
 * The section is CHAPTER_VH viewports tall and holds a sticky, one-viewport
 * stage, so the chapter plays across the scroll: the words write themselves
 * in as the stage rises, the site arrives through its reveal, everything
 * holds while the stage is pinned, and then the words dissolve and the frame
 * falls back as the next chapter comes up underneath.
 *
 * Everything is a pure function of `t`: scroll since the section's top met
 * the bottom of the viewport, in viewport heights. The stage is pinned for t
 * in [1, CHAPTER_VH]; the section's centre, which is where the settle-snap
 * lands and where the dive director keys this station's shot, is at
 * (CHAPTER_VH + 1) / 2.
 */

/** Section height, in viewport heights. */
export const CHAPTER_VH = 2;

/** The chapter's score, in t. Everything has arrived before the centre (1.5). */
const T = {
    plate: [0.5, 0.85],
    name: [0.55, 1.0],
    reveal: [0.62, 1.42],
    hook: [0.92, 1.28],
    details: [1.1, 1.44],
    /** The words dissolve as the stage lets go. */
    leave: [2.0, 2.42],
    /** The frame falls back as the next chapter rises over it. */
    recede: [2.0, 2.9],
} as const;

/**
 * How closely a chapter follows the scroll on a touch screen, in seconds.
 *
 * A phone scrolls natively, off the main thread (at 120 Hz on a ProMotion
 * iPhone), and the page hears where it has got to at most once a frame, and
 * unevenly: 10 px one frame, 30 the next, and a resting finger's tremor back
 * and forth. Scrubbed by that directly, the frame, the tiles and the words
 * lurched and shook until the chapter had finished arriving. So there the
 * chapter eases toward the scroll over this time constant: short enough to
 * stay with the finger (a brisk swipe is ~70 px ahead of it), long enough to
 * iron the sampling out. A desktop scrolls through Lenis, on the same frame
 * the chapter draws, already smooth, and is followed exactly.
 */
const FOLLOW_S = 0.07;

/** A move this large in one frame (viewport heights) is a jump (a menu link,
 *  the page opening mid-way), not scrolling, and is not eased. */
const JUMP = 0.5;

/**
 * On a touch screen the stage is FIXED while it holds, not sticky.
 *
 * iOS Safari keeps a sticky element in place by moving it back against the
 * scroll on its compositor, and the two moves round to the screen's pixels
 * separately: the pinned stage wobbled up and down by a pixel as the page
 * scrolled under it, and the screenshot's fine type shimmered with it. A
 * fixed element is attached to the screen and cannot. The switch is made
 * this far (viewport heights) inside the stretch the sticky stage is pinned
 * for, [1, CHAPTER_VH], where the two put it in exactly the same place, so
 * it cannot be seen even though the page hears of the scroll a frame late.
 */
const HOLD_MARGIN = 0.04;

/**
 * How far ahead (seconds, at the scroll's current speed) the fixed hold looks
 * for its end.
 *
 * The page hears of a phone's scroll late, and later the harder it is flung:
 * a busy frame or two, while the fling covers 50 px each. Let go late, the
 * fixed stage stood still while the page flew on past the end of the pin and
 * then jumped up to meet it (160 px, emulated). Letting go early costs
 * nothing, since the sticky stage it hands back to is pinned in the same
 * place; taking hold late costs nothing either. So the hold is taken where
 * the scroll IS, and let go where it will be this far ahead.
 */
const HOLD_LEAD = 0.15;

type RevealComponent = ForwardRefExoticComponent<RevealProps & RefAttributes<RevealHandle>>;

const REVEALS: Record<RevealKind, RevealComponent> = {
    drive: DriveReveal,
    shelves: ShelvesReveal,
    calendar: CalendarReveal,
    brush: BrushReveal,
    play: PlayReveal,
};

/**
 * The width to request a screenshot at: the frame's real width in device
 * pixels, rounded up to a 200 px step (so resizes reuse cached files) and
 * never above the original. The screenshots are whole pages shown at a third
 * of their size; letting the GPU do that shrink aliases small text into mush,
 * while Cloudinary resamples it cleanly.
 */
function imageWidth(cssWidth: number, original: number): number {
    const px = cssWidth * Math.min(window.devicePixelRatio || 1, 2);
    return Math.min(original, Math.max(400, Math.ceil(px / 200) * 200));
}

/** Depths on the plate are read to the nearest ten metres, like a gauge. */
const formatDepth = (metres: number, label: string) =>
    `${(Math.round(metres / 10) * 10).toLocaleString('en-US')} m · ${label}`;

interface Props {
    project: Project;
    index: number;
    total: number;
}

const ProjectChapter = ({ project, index, total }: Props) => {
    const root = useRef<HTMLElement>(null);
    const visual = useRef<HTMLElement>(null);
    const depth = useRef<HTMLSpanElement>(null);
    const reveal = useRef<RevealHandle>(null);
    const [imgWidth, setImgWidth] = useState(() => Math.min(project.width, 1600));

    const Reveal: ComponentType<RevealProps & RefAttributes<RevealHandle>> = REVEALS[project.reveal];
    const ratio = project.width / project.height;
    const hook = project.hook.map(parseLine);

    // A station on the dive: the director composes the whale's shot around it.
    useEffect(() => {
        const el = root.current;
        if (!el) return;
        return registerStation(index, el);
    }, [index]);

    useEffect(() => {
        const el = root.current;
        const vis = visual.current;
        if (!el || !vis) return;

        const q = <T extends HTMLElement>(sel: string) => Array.from(el.querySelectorAll<T>(sel));
        // The plate's readings are uncovered like engraving, the name is
        // penned whole (split into letters, the serif would lose its
        // kerning), the hook is set word by word, and the details follow one
        // by one: the paragraph, each tag, each link.
        const plate = q('.project__plate > span, .project__category');
        const name = q('.project__name-ink');
        const words = q('.project__hook .story-word');
        const details = q('[data-detail]');
        const ocean = createOceanSample();
        let last = -1;

        const render = (t: number) => {
            if (Math.abs(t - last) < 1e-4) return;
            last = t;
            const reduced = prefersReducedMotion();
            const exit = span(t, T.leave[0], T.leave[1]);

            writeWords(plate, span(t, T.plate[0], T.plate[1]), exit, reduced);
            writeWords(name, span(t, T.name[0], T.name[1]), exit, reduced);
            writeWords(words, span(t, T.hook[0], T.hook[1]), exit, reduced);
            writeWords(details, span(t, T.details[0], T.details[1]), exit, reduced);

            reveal.current?.render(span(t, T.reveal[0], T.reveal[1]), reduced);

            const r = smooth(span(t, T.recede[0], T.recede[1]));
            vis.style.opacity = (1 - r * 0.7).toFixed(3);
            vis.style.transform = reduced || r <= 0 ? '' : `scale(${(1 - r * 0.07).toFixed(4)})`;
        };

        const at = (self: ScrollTrigger) => (self.scroll() - self.start) / viewportHeight();

        // Where the scroll is (`target`), and where the chapter is drawn.
        let target = Number.NaN;
        let shown = Number.NaN;
        const show = (t: number) => {
            shown = t;
            render(t);
        };
        // Touch: the stage held by `position: fixed` (see HOLD_MARGIN and
        // HOLD_LEAD). Keyed to the scroll itself, not the eased `shown`: it is
        // where the stage IS, not how far its reveal has got.
        let held = false;
        const pinned = (t: number) => t > 1 + HOLD_MARGIN && t < CHAPTER_VH - HOLD_MARGIN;
        const hold = (t: number, ahead = t) => {
            const next = IS_TOUCH && pinned(t) && pinned(ahead);
            if (next === held) return;
            held = next;
            el.classList.toggle('project--held', next);
        };
        // The scroll's speed, in viewport heights a second, from the last two
        // times the page heard of it.
        let heardT = Number.NaN;
        let heardAt = 0;
        let speed = 0;
        const aim = (t: number) => {
            const now = performance.now();
            if (!Number.isNaN(heardT)) speed = (t - heardT) / (Math.max(now - heardAt, 8) / 1000);
            heardT = t;
            heardAt = now;
            target = t;
            hold(t, t + speed * HOLD_LEAD);
            if (!IS_TOUCH || Number.isNaN(shown) || Math.abs(t - shown) > JUMP) show(t);
        };
        // Touch: ease toward the scroll (see FOLLOW_S).
        const follow = (_time: number, deltaMs: number) => {
            if (Number.isNaN(target) || shown === target) return;
            const next = shown + (target - shown) * (1 - Math.exp(-Math.min(deltaMs, 100) / 1000 / FOLLOW_S));
            show(Math.abs(target - next) < 2e-4 ? target : next);
        };
        if (IS_TOUCH) gsap.ticker.add(follow);

        const trigger = ScrollTrigger.create({
            trigger: el,
            start: 'top bottom',
            end: 'bottom top',
            onUpdate: (self) => aim(at(self)),
            onRefresh: (self) => {
                // The plate reads the ocean at the scroll position where this
                // chapter sits, with the same curve the light and the whale
                // use, so it can never disagree with the water around it.
                const centre = (self.start + self.end) / 2;
                const d = depthFromScroll(depthProgress(centre, ScrollTrigger.maxScroll(window)));
                sampleOcean(d, ocean);
                if (depth.current) depth.current.textContent = formatDepth(ocean.metres, ocean.label);
                last = -1;
                target = at(self);
                hold(target);
                show(target);
                setImgWidth(imageWidth(vis.clientWidth, project.width));
            },
        });

        return () => {
            trigger.kill();
            gsap.ticker.remove(follow);
            el.classList.remove('project--held');
        };
    }, []);

    const number = String(index + 1).padStart(2, '0');
    const link = project.liveUrl ?? project.codeUrl;

    const frame = <Reveal ref={reveal} image={cld(project.image, imgWidth)} ratio={ratio} address={project.address} />;

    return (
        <section
            ref={root}
            id={`project-${project.id}`}
            className={`project project--frame-${project.side} project--${project.reveal}`}
            style={{ height: `${CHAPTER_VH * 100}vh` }}
            aria-labelledby={`project-${project.id}-name`}>
            <div className="project__stage">
                {link ? (
                    <a
                        ref={visual as RefObject<HTMLAnchorElement>}
                        className="project__visual"
                        href={link}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={`Open ${project.name} (new tab)`}
                        style={{ ['--ratio' as string]: ratio }}>
                        {frame}
                    </a>
                ) : (
                    <div
                        ref={visual as RefObject<HTMLDivElement>}
                        className="project__visual"
                        style={{ ['--ratio' as string]: ratio }}>
                        {frame}
                    </div>
                )}

                <div className="project__text">
                    <p className="project__plate">
                        <span className="project__index" data-write="wipe">
                            {number}
                            <em> / {String(total).padStart(2, '0')}</em>
                        </span>
                        <span className="project__depth" data-write="wipe" ref={depth}>
                            &nbsp;
                        </span>
                    </p>

                    <p className="project__category" data-write="wipe">
                        {project.category}
                    </p>

                    <h3 className="project__name" id={`project-${project.id}-name`}>
                        <span className="story-slot">
                            <span className="project__name-ink" data-write="pen">
                                {project.name}
                            </span>
                        </span>
                    </h3>

                    <p className="project__hook">
                        {hook.map((line, li) => (
                            <WrittenLine key={li} words={line} />
                        ))}
                    </p>

                    <p className="project__body" data-detail>
                        {project.body}
                    </p>

                    <ul className="project__tags" aria-label="Tags">
                        {project.tags.map((tag) => (
                            <li key={tag} data-detail>
                                {tag}
                            </li>
                        ))}
                    </ul>

                    <div className="project__links">
                        {project.liveUrl && (
                            <a
                                className="plink plink--primary"
                                href={project.liveUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                data-detail>
                                <span className="plink__label">Visit site</span> <span className="plink__arrow" aria-hidden="true">↗</span>
                            </a>
                        )}
                        {project.codeUrl && (
                            <a className="plink" href={project.codeUrl} target="_blank" rel="noopener noreferrer" data-detail>
                                <span className="plink__label">Source</span> <span className="plink__arrow" aria-hidden="true">↗</span>
                            </a>
                        )}
                    </div>
                </div>
            </div>
        </section>
    );
};

export default ProjectChapter;
