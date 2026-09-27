import { lazy, Suspense, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import gsap from 'gsap';
import SceneBoundary from './SceneBoundary';
import { webgl } from '../utils/device';
import { CONTACT_BEAM_EASE, contactBeamTarget } from '../animations/contactBeam';

// Loaded on demand. The footer sphere is a whole second WebGL context with its
// own 1.7 MB HDRI, and it sits at the very bottom of an eight-screen page:
// nobody should pay for it while they are still at the surface. The canvas and
// its controls come with it, so none of R3F is on the page's first download.
const FooterScene = lazy(() => import('./FooterScene'));

/** How far ahead of the viewport the footer scene starts mounting, so it is
 *  ready by the time the ascent reaches it rather than popping in late. */
const SCENE_MOUNT_MARGIN = '600px 0px';

/** Where, down the glyph's box, the beam's line meets the right edge of the
 *  "L": about the cap line. The glyph's box is the whole line, so its top
 *  sits well above the letter. */
const BEAM_HIT_DOWN = 0.28;

/** Corner radius of the invisible box, in px. The one place it is set: the
 *  streams are drawn round it here, and it is handed to the CSS as
 *  --shield-shape, the rounded box the light is cut away to, so the cut and
 *  the streams always meet. Capped at half the box's height. */
const SHIELD_RADIUS = 32;

/** The two streams the beam splits into where it lands: from the impact
 *  along the top edge, over the corner and down that side. */
const FALLS_SIDES = ['left', 'right'] as const;

/** How far the streams' light reaches before it is gone: along the top edge,
 *  as a multiple of the longer run from the impact to a corner; down the
 *  sides, as a fraction of the box's height (under 1, so it is gone before
 *  the bottom). */
const FALLS_FADE_ALONG = 2.3;
const FALLS_FADE_DOWN = 0.8;

/** Layers of each stream, back to front: the lit edge itself, then the
 *  moving light pouring along it (see .footer-falls__* in styles.css). */
const FALLS_LAYERS = ['rim', 'surge', 'stream', 'spray'] as const;

/** Steps `--beam-arrive` is written in. Finer than any visible change in
 *  the beam's brightness, coarse enough that most frames write nothing. */
const BEAM_ARRIVE_STEPS = 100;

const Footer = () => {
    const [status, setStatus] = useState<'idle' | 'submitting' | 'success' | 'error'>('idle');
    const [formData, setFormData] = useState({ name: '', email: '', message: '' });

    // The sphere's canvas mounts once the footer is near, and then stays: a
    // WebGL context torn down and recreated every time someone scrolls up and
    // back is a worse cost than simply keeping it once it exists.
    const sceneRef = useRef<HTMLDivElement>(null);
    const [sceneNear, setSceneNear] = useState(false);

    // The contact beam falls along --beam-dir (CSS) and strikes the top edge
    // of the invisible box around "Let's chat.", on the line that would carry
    // on to the top-right of the "L". Where that letter and the box sit
    // depends on the layout (and the font), so the impact, the source (back
    // up the beam to the footer's top edge) and the beam's length are all
    // measured.
    const footerRef = useRef<HTMLElement>(null);
    const headingRef = useRef<HTMLHeadingElement>(null);
    const headingTextRef = useRef<HTMLSpanElement>(null);
    // Where the light pours over the box: SVG paths traced round its edge
    // from the impact, reshaped whenever the box is.
    const fallsRef = useRef<SVGSVGElement>(null);
    const fallsPaint = `falls-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;

    useLayoutEffect(() => {
        const footer = footerRef.current;
        const heading = headingRef.current;
        const glyphs = headingTextRef.current?.firstChild;
        if (!footer || !heading || !glyphs) return;
        const letterL = document.createRange();
        letterL.setStart(glyphs, 0);
        letterL.setEnd(glyphs, 1);
        const aim = () => {
            const origin = footer.getBoundingClientRect();
            const left = origin.left + footer.clientLeft;
            const top = origin.top + footer.clientTop;
            const box = heading.getBoundingClientRect();
            const l = letterL.getBoundingClientRect();

            // One step along the beam, from the CSS angle (0 = up,
            // clockwise). dy is kept positive: the light always falls.
            const dir = (parseFloat(getComputedStyle(footer).getPropertyValue('--beam-dir')) * Math.PI) / 180;
            const dx = Math.sin(dir);
            const dy = Math.max(-Math.cos(dir), 0.2);

            // Back up the beam from the L's top-right to the box's top edge.
            const aimX = l.right - left;
            const aimY = l.top + l.height * BEAM_HIT_DOWN - top;
            const impactY = box.top - top;
            const impactX = aimX - ((aimY - impactY) * dx) / dy;
            // And on up to the footer's top edge, where the light comes in.
            const length = impactY / dy;

            const set = (el: HTMLElement, name: string, px: number) =>
                el.style.setProperty(name, `${px}px`);
            set(footer, '--impact-x', impactX);
            set(footer, '--impact-y', impactY);
            set(footer, '--beam-len', length);
            set(footer, '--shield-x', box.left - left);
            set(footer, '--shield-y', box.top - top);
            set(footer, '--shield-w', box.width);
            set(footer, '--shield-h', box.height);
            const r = Math.min(SHIELD_RADIUS, box.width / 2, box.height / 2);
            footer.style.setProperty(
                '--shield-shape',
                `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'%3E%3Crect width='100%25' height='100%25' rx='${r}'/%3E%3C/svg%3E")`,
            );
            // The same impact, on the box's own edge, for the splash of light.
            const hitX = impactX - (box.left - left);
            set(heading, '--hit-x', hitX);

            // The streams, in the box's own px: from the impact along the
            // top, round the corner and down the side.
            const falls = fallsRef.current;
            if (falls) {
                const w = box.width;
                const h = box.height;
                const x = Math.min(Math.max(hitX, r), w - r);
                const paths = {
                    left: `M ${x} 0 H ${r} A ${r} ${r} 0 0 0 0 ${r} V ${h - r}`,
                    right: `M ${x} 0 H ${w - r} A ${r} ${r} 0 0 1 ${w} ${r} V ${h - r}`,
                };
                falls.querySelectorAll<SVGPathElement>('path').forEach((path) => {
                    path.setAttribute('d', paths[path.dataset.side as keyof typeof paths]);
                });
                // Their light fades out from the impact over an ellipse: long
                // along the top edge, short down the sides, so each stream
                // dissolves partway down its side instead of running bright to
                // the end of its path and stopping there. The gradient is a
                // circle of the long radius, squashed about the top edge.
                const along = Math.max(x, w - x) * FALLS_FADE_ALONG;
                const down = h * FALLS_FADE_DOWN;
                const paint = falls.querySelector('radialGradient');
                paint?.setAttribute('cx', String(x));
                paint?.setAttribute('cy', '0');
                paint?.setAttribute('r', String(along));
                paint?.setAttribute('gradientTransform', `scale(1 ${down / along})`);
            }
        };
        aim();
        const observer = new ResizeObserver(aim);
        observer.observe(footer);
        // The heading can change size without the footer doing so (the web
        // font arriving), and the aim has to follow it.
        observer.observe(heading);
        return () => observer.disconnect();
    }, []);

    // The beam seeps in as the page reaches the bottom and out again on the
    // way back up: `--beam-arrive` (0–1) on the footer, eased toward the
    // scroll the same way WhaleScene eases the spotlight on the whale. On the
    // gsap ticker Lenis already drives, like useDepthCss, and the footer is
    // only measured while it is on screen.
    useEffect(() => {
        const footer = footerRef.current;
        if (!footer) return;
        let inView = false;
        let shown = 0;
        let written = -1;
        const observer = new IntersectionObserver(([entry]) => {
            inView = entry.isIntersecting;
        });
        observer.observe(footer);
        const tick = (_time: number, deltaMs: number) => {
            const target = inView ? contactBeamTarget(footer.getBoundingClientRect().top) : 0;
            if (shown === target && written !== -1) return;
            const dt = Math.min(deltaMs / 1000, 0.05);
            shown += (target - shown) * (1 - Math.exp(-CONTACT_BEAM_EASE * dt));
            if (Math.abs(target - shown) < 0.5 / BEAM_ARRIVE_STEPS) shown = target;
            const q = Math.round(shown * BEAM_ARRIVE_STEPS) / BEAM_ARRIVE_STEPS;
            if (q !== written) {
                written = q;
                footer.style.setProperty('--beam-arrive', String(q));
            }
        };
        gsap.ticker.add(tick);
        return () => {
            gsap.ticker.remove(tick);
            observer.disconnect();
        };
    }, []);

    useEffect(() => {
        const el = sceneRef.current;
        if (!el || sceneNear) return;
        const observer = new IntersectionObserver(
            ([entry]) => {
                if (entry.isIntersecting) {
                    setSceneNear(true);
                    observer.disconnect();
                }
            },
            { rootMargin: SCENE_MOUNT_MARGIN },
        );
        observer.observe(el);
        return () => observer.disconnect();
    }, [sceneNear]);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        setStatus('submitting');
        
        const form = e.currentTarget;
        const data = new FormData(form);

        try {
            // Replace YOUR_FORMSPREE_ID with your actual Formspree ID
            const response = await fetch('https://formspree.io/f/mykoyqvk', {
                method: 'POST',
                body: data,
                headers: {
                    'Accept': 'application/json'
                }
            });

            if (response.ok) {
                setStatus('success');
                setFormData({ name: '', email: '', message: '' });
                form.reset();
                // Reset success message after 5 seconds
                setTimeout(() => setStatus('idle'), 5000);
            } else {
                setStatus('error');
            }
        } catch (error) {
            console.error('Form submission error:', error);
            setStatus('error');
        }
    };

    return (
        <footer className="footer-container" id="chat" ref={footerRef}>
            <div className="footer-light" aria-hidden="true">
                <div className="footer-beam" />
                <div className="footer-beam-mist"><i /><i /></div>
                <div className="footer-beam-flare" />
                <div className="footer-beam-flow"><i /><i /><i /></div>
                <div className="footer-beam-core" />
            </div>
            <div className="footer-layout">
                <div className="footer-content">
                    <div className="footer-header">
                        <h2 className="footer-title" ref={headingRef}>
                            <span className="footer-title__text" ref={headingTextRef}>Let's chat.</span>
                            <svg className="footer-title__falls" ref={fallsRef} aria-hidden="true">
                                <defs>
                                    <radialGradient id={fallsPaint} gradientUnits="userSpaceOnUse">
                                        <stop offset="0" stopColor="#fff" />
                                        <stop offset="0.2" stopColor="rgb(200, 222, 255)" stopOpacity="0.85" />
                                        <stop offset="0.5" stopColor="rgb(140, 140, 255)" stopOpacity="0.4" />
                                        <stop offset="0.8" stopColor="rgb(120, 110, 255)" stopOpacity="0.1" />
                                        <stop offset="1" stopColor="rgb(110, 100, 255)" stopOpacity="0" />
                                    </radialGradient>
                                </defs>
                                {FALLS_SIDES.map((side) => (
                                    <g key={side} stroke={`url(#${fallsPaint})`}>
                                        {FALLS_LAYERS.map((layer) => (
                                            <path key={layer} data-side={side} className={`footer-falls__${layer}`} />
                                        ))}
                                    </g>
                                ))}
                            </svg>
                        </h2>
                        <p>Got a project in mind, or just want to say hi? I'd love to hear from you.</p>
                    </div>

                    {/* Each field's label sits in it until it is focused or
                        filled, then lifts above it; a rule draws under the
                        field in focus (see .input-group in styles.css). */}
                    <form className="contact-form" onSubmit={handleSubmit}>
                        <div className="input-group">
                            <input
                                id="contact-name"
                                type="text"
                                name="name"
                                placeholder=" "
                                autoComplete="name"
                                value={formData.name}
                                onChange={handleChange}
                                required
                            />
                            <label htmlFor="contact-name">Your Name</label>
                        </div>
                        <div className="input-group">
                            <input
                                id="contact-email"
                                type="email"
                                name="email"
                                placeholder=" "
                                autoComplete="email"
                                value={formData.email}
                                onChange={handleChange}
                                required
                            />
                            <label htmlFor="contact-email">Your Email</label>
                        </div>
                        <div className="input-group">
                            <textarea
                                id="contact-message"
                                name="message"
                                rows={4}
                                placeholder=" "
                                value={formData.message}
                                onChange={handleChange}
                                required></textarea>
                            <label htmlFor="contact-message">Your Message</label>
                        </div>

                        <button type="submit" disabled={status === 'submitting'} className="submit-btn">
                            <span className="submit-btn__label">{status === 'submitting' ? 'Sending...' : 'Send Message'}</span>
                            <span className="submit-btn__arrow" aria-hidden="true">
                                &rarr;
                            </span>
                        </button>

                        {status === 'success' && (
                            <p className="form-msg success" role="status">
                                ✓ Thanks! I'll get back to you soon.
                            </p>
                        )}
                        {status === 'error' && (
                            <p className="form-msg error" role="alert">
                                ✗ Oops! There was a problem. Try again.
                            </p>
                        )}
                    </form>
                </div>

                <div className="footer-scene-container" ref={sceneRef}>
                    {sceneNear && webgl.ok && (
                        <SceneBoundary>
                            <Suspense fallback={null}>
                                <FooterScene container={sceneRef} />
                            </Suspense>
                        </SceneBoundary>
                    )}
                </div>
            </div>

            <div className="footer-social">
                   
            </div>
            <div className="footer-bottom">
                <p>© {new Date().getFullYear()} Hemwunt. All rights reserved.</p>
            </div>
        </footer>
    );
};

export default Footer;