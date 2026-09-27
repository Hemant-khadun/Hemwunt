import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import tsConfigPaths from 'vite-tsconfig-paths';
import react from '@vitejs/plugin-react';
import glsl from 'vite-plugin-glsl';

/**
 * Builds the PORTFOLIO SITE.
 *
 * This repo began as a fork of `@whatisjery/react-fluid-distortion`, and for a
 * long time this config still built that library: `build.lib` with an entry of
 * `lib/index.ts`, React/three/postprocessing marked external, and
 * `copyPublicDir: false`. The consequence was that `npm run build` emitted a
 * UMD bundle of the fluid effect and no site at all — `index.html` was never
 * processed, `public/` (both HDRIs) was never copied, and deploying the output
 * produced a blank page.
 *
 * `lib/` is still compiled INTO the site rather than deleted: the header menu
 * imports the Fluid effect from it (see `src/components/Header.tsx`). The
 * `glsl()` plugin stays for the same reason — `lib/glsl/*` is imported as
 * source. What is gone is the library PACKAGING: no externals (a site has to
 * bundle its dependencies), no `dts` (nobody consumes types from a website),
 * and `copyPublicDir` back on its default so the HDRIs ship.
 */
export default defineConfig({
    plugins: [react(), glsl(), tsConfigPaths()],

    // GitHub Pages serves a project site from a sub-path (/hemwunt/), so the
    // deploy workflow passes it in as BASE_PATH (from actions/configure-pages,
    // which also yields '/' once a custom domain is set). Everything in the
    // site already resolves against it: Vite rewrites index.html and the
    // bundle, and public/ files go through `publicUrl` (utils/sceneAssets.ts).
    base: process.env.BASE_PATH || '/',

    resolve: {
        alias: [
            {
                find: '@',
                replacement: fileURLToPath(new URL('./src', import.meta.url)),
            },
            // N8AO imports Node's `buffer` for one base64 decode; see the shim.
            {
                find: /^buffer$/,
                replacement: fileURLToPath(new URL('./src/shims/buffer.ts', import.meta.url)),
            },
        ],
    },

    build: {
        // Source maps stay on: this is a portfolio, and the whale physics in
        // `src/animations/` is part of what is being shown off.
        sourcemap: true,
        emptyOutDir: true,
        // Three's core alone is ~650 kB minified, so the default 500 kB
        // warning fires on every build and trains you to ignore it.
        chunkSizeWarningLimit: 900,
        rollupOptions: {
            output: {
                // The big, rarely-changing libraries in chunks of their own,
                // so a deploy that only touches the site's code does not make
                // a returning visitor download three.js and React again.
                // Everything the WebGL scene alone needs (R3F, drei, the post
                // chain, the shaders) stays in the lazy chunks Rollup makes
                // for WebGLStage, MenuFluid and FooterScene. Only three's
                // BUILD goes in 'three': its examples/ addons are only ever
                // used lazily and must not be pulled into the eager chunk.
                manualChunks(id) {
                    if (!id.includes('node_modules')) return undefined;
                    if (/node_modules[\\/]three[\\/]build[\\/]/.test(id)) return 'three';
                    if (/node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) return 'react';
                    if (/node_modules[\\/](gsap|lenis)[\\/]/.test(id)) return 'motion';
                    return undefined;
                },
            },
        },
    },
});
