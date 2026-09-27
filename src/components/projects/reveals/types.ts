/**
 * The contract between a project chapter and its reveal.
 *
 * A reveal owns its browser frame and everything inside it, and is a pure
 * function of `p`: the chapter hands it 0..1 of its reveal window on every
 * scroll update, and the reveal writes styles. No timelines, no internal
 * clocks, so scrolling back rewinds it exactly, like the rest of the dive.
 */
export interface RevealHandle {
    render(p: number, reduced: boolean): void;
}

export interface RevealProps {
    /** Image URL, already sized. */
    image: string;
    /** Width over height of the screenshot. */
    ratio: number;
    /** Shown in the frame's address bar. */
    address: string;
}
