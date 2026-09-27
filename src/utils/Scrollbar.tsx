import { useEffect } from 'react';
import { gsap } from 'gsap';
import { Draggable } from 'gsap/Draggable';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { getLenis } from './SmoothScroll';

gsap.registerPlugin(Draggable);
gsap.registerPlugin(ScrollTrigger);

// Accept the disableScroll prop
const Scrollbar = () => {

    let scrollbarHeight: number;
    let thumbHeight: number;

    useEffect(() => {

        // Declare GSAP instances at the top of the effect
        let scrollTween: gsap.core.Tween | null = null;
        let draggableInstance: Draggable[] | null = null;

         // Define the cleanup function
        const cleanup = () => {
            if (scrollTween) {
                scrollTween.kill();
                scrollTween.scrollTrigger?.kill();
                scrollTween = null;
            }

            if (draggableInstance) {
                draggableInstance[0].kill();
                draggableInstance = null;
            }

            window.removeEventListener('resize', handleResize); // Now handleResize is defined
            // ScrollTrigger.removeEventListener('refresh', handleResize); // Not needed if resizing handles refresh
        };

        // Ensure elements exist
        const scrollbar = document.querySelector<HTMLElement>('[data-scrollbar]');
        const thumb = scrollbar?.querySelector<HTMLElement>('[data-scrollbar-thumb]');

        if (!scrollbar || !thumb) {
            console.warn('Custom scrollbar elements not found: [data-scrollbar], [data-scrollbar-thumb]');
            return cleanup; // Return cleanup function
        }

        // --- Event Handlers ---
        // Define handlers first so they can be referenced by cleanup
        const handleResize = () => {
            // Re-calculate thumb size and re-create/update ScrollTrigger and Draggable bounds
            const { maxThumbY } = updateThumbHeight();

            if (gsap.getProperty(scrollbar, 'display') !== 'none') {
                thumbScroll(maxThumbY); // Recreate ScrollTrigger
                // Update draggable bounds - Draggable.create returns an array, need the instance
                if (draggableInstance && draggableInstance[0]) {
                    draggableInstance[0].applyBounds(scrollbar); // Update bounds
                    draggableInstance[0].update(); // Update internal calculations
                    // Re-create draggable might be safer for more complex scenarios, but update should suffice
                    // thumbDrag(maxThumbY);
                }
                // Ensure the thumb is positioned correctly after resize based on current window scroll
                const currentWindowScroll = window.scrollY || window.pageYOffset;
                const totalHeight = document.body.scrollHeight;
                const visibleHeight = window.innerHeight;
                const maxScrollAfterResize = totalHeight - visibleHeight;
                 if (maxScrollAfterResize > 0) {
                     const windowScrollProgress = gsap.utils.normalize(0, maxScrollAfterResize, currentWindowScroll);
                     const newThumbY = windowScrollProgress * maxThumbY;
                      // Use gsap.set for immediate positioning to avoid animation glitches on resize
                     gsap.set(thumb, { y: newThumbY });
                     // Also update the ScrollTrigger's progress to match
                     scrollTween?.progress(windowScrollProgress);
                 } else {
                      // If not scrollable after resize, position thumb at top
                      gsap.set(thumb, { y: 0 });
                      scrollTween?.progress(0);
                 }

            } else {
                // If scrollbar is hidden, kill any existing GSAP animations/draggables
                 if (scrollTween) {
                     scrollTween.kill();
                     scrollTween.scrollTrigger?.kill();
                     scrollTween = null;
                 }
                 if (draggableInstance) {
                     draggableInstance[0].kill();
                     draggableInstance = null;
                 }
            }
        };

        // Calculates thumb height based on visible height vs total scroll height
        const updateThumbHeight = () => {
            // Use scrollHeight for total scrollable height and innerHeight for visible height
            const totalHeight = document.body.scrollHeight;
            const visibleHeight = window.innerHeight;
            scrollbarHeight = scrollbar.getBoundingClientRect().height;

            // Prevent division by zero or negative height if content is smaller than viewport
            if (totalHeight <= visibleHeight || scrollbarHeight <= 0) {
                // Hide or disable the custom scrollbar if not needed
                gsap.set(scrollbar, { display: 'none' });
                // Kill existing GSAP instances if scrollbar is hidden
                if (scrollTween) {
                    scrollTween.kill();
                    scrollTween.scrollTrigger?.kill();
                }
                if (draggableInstance) {
                    draggableInstance[0].kill();
                }
                return { maxScroll: 0, maxThumbY: 0 };
            } else {
                gsap.set(scrollbar, { display: 'block' }); // Ensure it's visible if needed
            }


            thumbHeight = (visibleHeight / totalHeight) * scrollbarHeight;

            // Ensure minimum thumb height if needed (optional)
            // const minThumbHeight = 20; // Example minimum height
            // thumbHeight = Math.max(thumbHeight, minThumbHeight);

            // Clamp thumb height to not exceed scrollbar height
            thumbHeight = Math.min(thumbHeight, scrollbarHeight);


            gsap.set(thumb, { height: thumbHeight });

            // Max scroll position of the window
            // This is the total scrollable distance, i.e., scrollHeight - innerHeight
            const maxScroll = totalHeight - visibleHeight;

            // Max drag position for the thumb
            const maxThumbY = scrollbarHeight - thumbHeight;

            return { maxScroll, maxThumbY };
        };

        // Creates the ScrollTrigger animation for the thumb based on window scroll
        const thumbScroll = (maxThumbY: number) => {
            // Kill existing tween if it exists
            if (scrollTween) {
                scrollTween.kill(); // Kill the animation
                scrollTween.scrollTrigger?.kill(); // Kill the associated trigger
            }

            scrollTween = gsap.to(thumb, {
                // Animate thumb's y position from 0 to maxThumbY
                y: maxThumbY,
                ease: 'none',
                scrollTrigger: {
                    trigger: document.body, // Or a specific scrollable element
                    start: 'top top',     // When the top of the trigger hits the top of the viewport
                    end: 'bottom bottom', // When the bottom of the trigger hits the bottom of the viewport
                    scrub: true,          // Link animation progress to scroll progress
                    markers: false,
                    // This ScrollTrigger drives the thumb based on window scroll.
                    // We'll disable it during dragging and re-enable on release.
                    // It starts enabled by default with scrub: true.
                }
            });
        };

        // Makes the thumb draggable and controls window scroll
        const thumbDrag = (maxThumbY: number) => {
            // Kill existing Draggable instance if it exists
            if (draggableInstance) {
                draggableInstance[0].kill();
            }

            draggableInstance = Draggable.create(thumb, {
                type: 'y',
                bounds: scrollbar, // Constrain drag within the scrollbar track
                onDrag: function(this: any) {
                    // 'this' in Draggable refers to the Draggable instance
                    const progress = gsap.utils.normalize(0, maxThumbY, this.y); // Normalize thumb's y position to 0-1
                    const totalHeight = document.body.scrollHeight;
                    const visibleHeight = window.innerHeight;
                    const maxScroll = totalHeight - visibleHeight;
                    const targetScroll = progress * maxScroll;

                    // Disable the automatic thumb ScrollTrigger while dragging
                    if (scrollTween?.scrollTrigger) {
                         scrollTween.scrollTrigger.disable();
                    }

                    // Scroll immediately to the calculated position. Route through Lenis
                    // when it's running so its internal target stays in sync (otherwise
                    // it would fight a raw window.scrollTo on the next raf tick).
                    const lenis = getLenis();
                    if (lenis) {
                        lenis.scrollTo(targetScroll, { immediate: true });
                    } else {
                        gsap.to(window, {
                            scrollTo: { y: targetScroll, autoKill: false }, // Use autoKill:false to allow multiple calls
                            duration: 0 // Make the scroll immediate while dragging
                        });
                    }

                    scrollbar.setAttribute('data-scrollbar-drag', 'true');
                },
                onRelease: function(this: any) {
                    const totalHeight = document.body.scrollHeight;
                    const visibleHeight = window.innerHeight;
                    const maxScroll = totalHeight - visibleHeight;
                    const currentWindowScroll = window.scrollY || window.pageYOffset;

                    // Re-enable the automatic thumb ScrollTrigger
                     if (scrollTween?.scrollTrigger) {
                         scrollTween.scrollTrigger.enable();
                     }

                    // Sync the ScrollTrigger's progress with the current window scroll position
                    const windowScrollProgress = gsap.utils.normalize(0, maxScroll, currentWindowScroll);
                    scrollTween?.progress(windowScrollProgress);


                    scrollbar.setAttribute('data-scrollbar-drag', 'false');
                }
            });
        };

        const initCustomScrollbar = () => {
            const { maxThumbY } = updateThumbHeight();
            // Only proceed if scrollbar is visible (i.e., scrollable content exists)
            if (gsap.getProperty(scrollbar, 'display') !== 'none') {
                thumbScroll(maxThumbY);
                thumbDrag(maxThumbY);
            }
        };


        // --- Initialization ---
        initCustomScrollbar();

        // --- Event Listeners ---
        window.addEventListener('resize', handleResize);

        // --- Cleanup ---
        return cleanup; // Return the cleanup function for React

        // Mount once. With no dependency array this ran after EVERY render,
        // tearing down and rebuilding the Draggable and its ScrollTrigger each
        // time; resizes are already handled by the listener above.
    }, []);


    return (
        <div className="scrollbar-wrapper" data-scrollbar="" data-scrollbar-drag="false">
            <div className="scrollbar" data-scrollbar-thumb></div>
        </div>
    );
};

export default Scrollbar;