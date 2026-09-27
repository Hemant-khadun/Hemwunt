// Encodes the hero dive video for smooth scroll scrubbing.
//
//   node scripts/visual/encodeHeroVideo.mjs [path/to/ffmpeg]
//
// ffmpeg is not required to be installed: pass a path, set FFMPEG, or run
// `npm i ffmpeg-static` in any folder and point at its ffmpeg.exe.
//
// Input:  media-src/dive-source.mp4
// Output: public/hero/dive.mp4         desktop, 1920 px wide
//         public/hero/dive-mobile.mp4  1080 px wide
//         public/hero/dive-poster.jpg  first frame, shown until the video loads
//
// ALL-INTRA (-g 1): every frame is a keyframe. That is the whole point of this
// encode. A normal video decodes each frame from the keyframe before it, so
// seeking backwards and forwards on scroll stalls on every step; with every
// frame a keyframe, any seek is a single decode. The cost is file size, which
// is why the mobile version is scaled down and slightly more compressed.
// -bf 0 (no B-frames) for the same reason; +faststart so metadata comes first.
import { execFileSync } from 'node:child_process';
import { mkdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const FF = process.argv[2] ?? process.env.FFMPEG ?? 'ffmpeg';
const SRC = join(ROOT, 'media-src', 'dive-source.mp4');
const OUT = join(ROOT, 'public', 'hero');
mkdirSync(OUT, { recursive: true });

const allIntra = ['-c:v', 'libx264', '-preset', 'slow', '-tune', 'film', '-pix_fmt', 'yuv420p',
    '-profile:v', 'high', '-g', '1', '-keyint_min', '1', '-sc_threshold', '0', '-bf', '0',
    '-movflags', '+faststart', '-an'];

const run = (args) => execFileSync(FF, ['-y', '-v', 'error', ...args], { stdio: 'inherit' });

// 1920 wide rather than the source's native 2144: every desktop screen this
// fills is at most that wide, and it is 19.4 MB against 23.4 MB native at
// visually identical quality. CRF 19 is at the edge of visually lossless.
run(['-i', SRC, '-vf', 'scale=1920:-2:flags=lanczos', ...allIntra, '-crf', '19', join(OUT, 'dive.mp4')]);
run(['-i', SRC, '-vf', 'scale=1080:-2:flags=lanczos', ...allIntra, '-crf', '21', join(OUT, 'dive-mobile.mp4')]);
run(['-i', SRC, '-vf', 'select=eq(n\\,0),scale=1920:-2:flags=lanczos', '-frames:v', '1', '-q:v', '2', join(OUT, 'dive-poster.jpg')]);

for (const f of ['dive.mp4', 'dive-mobile.mp4', 'dive-poster.jpg']) {
    console.log(`${(statSync(join(OUT, f)).size / 1048576).toFixed(2)} MB  public/hero/${f}`);
}
