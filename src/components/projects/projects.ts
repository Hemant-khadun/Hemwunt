/**
 * The work, as chapters of the dive.
 *
 * Each project is told the way the opening story is told: a short hook that
 * writes itself in, then the site itself arriving through one move that is
 * about the project, not a generic dissolve. `reveal` picks the move (see
 * `reveals/`).
 *
 * COPY IS A DRAFT (Claude's, 2026-09-25). Facts in it come from the live sites
 * and the public repos (FutureSpace runs on Odoo; Kinder Garden is Laravel;
 * Konzé and Artisanal are static JS sites from 2024), but the hooks and
 * wording need the owner's voice. Nothing here claims numbers or results.
 *
 * Depths are NOT listed here. Each chapter reads its depth off the ocean
 * curve at the scroll position where it sits (see ProjectChapter), so the
 * number on its plate always agrees with the light around it, whatever the
 * page's length.
 */

export type RevealKind = 'drive' | 'shelves' | 'calendar' | 'brush' | 'play';

export interface Project {
    id: string;
    /** Set large, in the italic serif. */
    name: string;
    /** The small tracked line above the name. */
    category: string;
    /** The hook, a line per entry. *Asterisks* mark the serif accents. */
    hook: string[];
    body: string;
    tags: string[];
    liveUrl?: string;
    codeUrl?: string;
    /** What the frame's address bar shows. */
    address: string;
    /** Cloudinary original. Served resized through `cld()`. */
    image: string;
    width: number;
    height: number;
    reveal: RevealKind;
    /** Which side of the stage the frame sits on (desktop). */
    side: 'left' | 'right';
}

/** A Cloudinary delivery URL, resized and in the best format the browser takes. */
export function cld(url: string, width: number): string {
    return url.replace('/upload/', `/upload/f_auto,q_auto,w_${width}/`);
}

export const PROJECTS: Project[] = [
    {
        id: 'marvella',
        name: 'Marvella',
        category: 'Car rental · Mauritius',
        hook: ['The island is best', 'seen *from the road.*'],
        body: 'A booking site for a Mauritian car rental company. Pick a car, a pickup point and a date, and the request goes out from a single form.',
        tags: ['Booking site', 'Live'],
        liveUrl: 'https://marvellacarrental.mu/',
        address: 'marvellacarrental.mu',
        image: 'https://res.cloudinary.com/dozgmymua/image/upload/v1789229569/Marvella-by-Hemwunt-Khadun_rgjivr.jpg',
        width: 1903,
        height: 1396,
        reveal: 'drive',
        side: 'left',
    },
    {
        id: 'futurespace',
        name: 'FutureSpace',
        category: 'Electronics store · E-commerce',
        hook: ['The shop floor,', '*rebuilt online.*'],
        body: 'The online storefront of a Mauritian electronics retailer, built on Odoo. Shop by brand or by category, from phones and laptops to portable power stations.',
        tags: ['E-commerce', 'Odoo', 'Live'],
        liveUrl: 'https://shop.futurespace.mu',
        address: 'shop.futurespace.mu',
        image: 'https://res.cloudinary.com/dozgmymua/image/upload/v1789229569/Futurespace-by-Hemwunt-Khadun_hljaa0.jpg',
        width: 1912,
        height: 2097,
        reveal: 'shelves',
        side: 'right',
    },
    {
        id: 'konze',
        name: 'Konzé',
        category: 'Leave planner · Web app',
        hook: ['Same days of leave.', '*Longer holidays.*'],
        body: 'Konzé reads the year’s public holidays and finds the bridges between them: the few days off that turn a long weekend into a real break.',
        tags: ['JavaScript', 'Web app', '2024'],
        liveUrl: 'https://hemant-khadun.github.io/konze/',
        codeUrl: 'https://github.com/Hemant-khadun/konze',
        address: 'hemant-khadun.github.io/konze',
        image: 'https://res.cloudinary.com/dozgmymua/image/upload/v1789229569/konze-by-Hemwunt-Khadun_w2xmvz.jpg',
        width: 1061,
        height: 898,
        reveal: 'calendar',
        side: 'left',
    },
    {
        id: 'artisanal',
        name: 'Artisanal',
        category: 'Local makers · Directory',
        hook: ['Made on the island.', '*Found around the corner.*'],
        body: 'A directory of Mauritian makers, from craft markets to handmade jewellery, so people can find and support the artisan shops closest to them.',
        tags: ['HTML & JS', 'Directory', '2024'],
        liveUrl: 'https://hemant-khadun.github.io/artisanal/',
        codeUrl: 'https://github.com/Hemant-khadun/artisanal',
        address: 'hemant-khadun.github.io/artisanal',
        image: 'https://res.cloudinary.com/dozgmymua/image/upload/v1789229569/Artisanal-by-Hemwunt-Khadun_ciu2rz.jpg',
        width: 1903,
        height: 2010,
        reveal: 'brush',
        side: 'right',
    },
    {
        id: 'kindergarden',
        name: 'KinderGarden',
        category: 'Learning platform · Open source',
        hook: ['Learning should', 'feel like *playtime.*'],
        body: 'An open-source learning platform for kids, built with Laravel: games, lessons and interactive activities for different age groups.',
        tags: ['Laravel', 'PHP', 'Open source'],
        codeUrl: 'https://github.com/Hemant-khadun/edunexus',
        address: 'github.com/Hemant-khadun/edunexus',
        image: 'https://res.cloudinary.com/dozgmymua/image/upload/v1789229569/KinderGarden-by-Hemwunt-Khadun_nzpqsl.jpg',
        width: 2604,
        height: 1600,
        reveal: 'play',
        side: 'left',
    },
];
