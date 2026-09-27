# Visual checks (headless Chrome over CDP, no deps, Node 22+)

Dev server must be running (npm run dev).

    node scripts/visual/cdpDive.mjs <outDir> http://localhost:5175/ 0,0.6,1.25,3.6
    node scripts/visual/cdpDiagnose.mjs <outDir> http://localhost:5175/

cdpDive screenshots at scroll depths in viewport heights. cdpDiagnose logs console,
exceptions, failed requests and canvas state, plus timed/scrolled screenshots.
Both wait ~13 s for the whale GLB and HDRI; frames taken earlier show an empty scene.
Headless uses SwiftShader, so the frame-budget guard degrades (camera still, snow halved).

## Hero footage

Re-encode the hero video after replacing media-src/dive-source.mp4:

    node scripts/visual/encodeHeroVideo.mjs path/to/ffmpeg

Writes public/hero/dive.mp4 (1920 px), dive-mobile.mp4 (1080 px) and
dive-poster.jpg. Both videos are all-intra (every frame a keyframe), which is
what makes scroll scrubbing smooth. No system ffmpeg? `npm i ffmpeg-static` in
any folder and pass the path to its ffmpeg.exe.

    node scripts/visual/generateSkyAssets.mjs   # sky assets from the still photo instead
