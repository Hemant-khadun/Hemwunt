/**
 * Stand-in for Node's `buffer` package in the browser build (aliased in
 * vite.config.ts).
 *
 * The only importer is @react-three/postprocessing's N8AO, which calls
 * `Buffer.from(base64, 'base64')` once, to decode its blue-noise texture into
 * the bytes of a DataTexture. The real polyfill (with base64-js and ieee754)
 * was 27 kB of the scene's chunk for that one line; a Uint8Array from `atob`
 * is byte-for-byte the same data.
 */
export const Buffer = {
    from(data: string, encoding?: string): Uint8Array {
        if (encoding !== 'base64') throw new Error(`buffer shim: only base64 is supported, got ${encoding}`);
        const binary = atob(data);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        return bytes;
    },
};
