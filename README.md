# LocVid

A video studio that runs entirely in your browser. Import photos, clips and audio — or just describe the video you want — and LocVid
turns them into an edited, moving video and exports a real MP4 (H.264 + AAC). There is no server, no account and no upload: projects,
media and rendering stay on your device. Optional AI models run on your own GPU/CPU and are downloaded only when you ask.

## What it does

- **Editor** — projects (create, reopen, rename, delete), a media bin (images, video, audio; duplicates are stored once), a timeline of
  scenes with drag-to-reorder, text overlays, transitions, background music/narration with ducking, undo/redo and autosave.
  16:9, 9:16 and 1:1 output.
- **Describe your video** — type a sentence such as *"create a video showing chhota bheem playing football in a village"*. LocVid plans a
  shot list (wide, close-up, action, the moment, details, finale…), picks a picture for each shot (your photos, pictures generated on your
  device, or designed backgrounds), frames them differently, and directs each shot: a camera move, what the subject does, props and a film look.
  Visuals first — captions are optional.
- **Cinematic 3D motion** — an on-device depth model turns a still into a depth map; a WebGL renderer (three.js) moves a virtual camera
  *through* it — dolly, orbit, crane, track, hand-held float, dolly-zoom — with real parallax, occlusion and a painted-in background for
  revealed areas, plus drifting sky, swaying foliage, depth haze, depth of field with rack focus, bloom, grain and cinema bars.
- **Living subjects** — two more on-device models cut the subject out (people, animals, objects) and paint the background behind it
  ("clean plate"). The subject then moves on its own over the scenery: it breathes, sways, walks, runs, jumps, dances, kicks, comes
  closer or floats — with a contact shadow, at its own depth, never revealing where the photo cuts it off.
- **3D props** that live in the shot's depth and are hidden behind nearer scenery: a football that is dribbled, juggled and kicked toward the
  camera, a flock of birds, balloons, butterflies, confetti, petals, autumn leaves, sky lanterns — chosen from the prompt's words.
- **Film looks** — color grades (cinematic, warm, cool, vivid, noir, vintage, dreamy), atmosphere particles (dust, snow, rain, fireflies,
  embers, sparkles), vignette, grain, glow.
- **Export** — H.264/AAC MP4 at 720p (default) or 1080p, with real progress, cancel and clear errors. Two engines: WebCodecs in a worker
  (fast) and FFmpeg.wasm (compatibility). The preview and the export use the same renderer, so what you see is what you get.

Everything that moves is a pure function of time, so a frame in the preview and the same frame in the export are identical.

## Quick start

Requires Node.js 20.19+ or 22.12+.

```bash
npm install
npm run dev        # http://localhost:5173
```

Production build (static files in `dist/`):

```bash
npm run build
npm run preview    # serves dist/ at http://localhost:4173
```

## Privacy

- No backend. Media, projects, analyses and renders never leave the browser. Storage is IndexedDB (projects, media, depth/cut-out
  analyses) and Cache Storage (downloaded models), in this browser profile only — clearing site data removes it.
- The production build ships a Content-Security-Policy that limits network access to the app's own origin and the Hugging Face model
  hub (plus any binary host you configure, see *Deploying*). It is enforced by the browser, not just promised.
- Models are downloaded only after you click a download button that states the model, its license and its exact size. Requests carry
  no cookies and no referrer; files are pinned to exact repository revisions and verified byte for byte. *AI tools → Device check*
  lists every model with its size and license and deletes any of them.
- Prompts and pictures are processed on your device. Nothing is sent anywhere.

## On-device models (all optional)

| Model | Used for | Download | License |
| --- | --- | --- | --- |
| [Depth Anything V2 Small](https://huggingface.co/onnx-community/depth-anything-v2-small) | Depth maps → cinematic 3D motion | 49.6 MB (GPU, fp16) or 27.3 MB (CPU, int8) | Apache-2.0 |
| [IS-Net general use](https://huggingface.co/jellybox/isnet-general-use) ([DIS](https://github.com/xuebinqin/DIS)) | Cutting the subject out | 178.6 MB | Apache-2.0 |
| [MI-GAN](https://huggingface.co/andraniksargsyan/migan) ([Picsart AI Research](https://github.com/Picsart-AI-Research/MI-GAN)) | Painting the background behind the subject | 28.1 MB | MIT (code and weights) |
| [RealPLKSR ×2](https://huggingface.co/darktable-org/upscale-realplksr-onnx) ([PLKSR](https://github.com/dslisleedh/PLKSR)) | Doubling the resolution of generated pictures (sharper close-ups; WebGPU) | 29.6 MB | MIT |
| [SD-Turbo](https://huggingface.co/schmuell/sd-turbo-ort-web) | Generating a picture per shot, in the video’s shape (768×448 for 16:9, 448×768 for 9:16, 512×512 square) | 2.5 GB | [Stability AI Community License](https://huggingface.co/stabilityai/sd-turbo/blob/main/LICENSE.md) |

All run with ONNX Runtime Web — WebGPU when available, otherwise WebAssembly on the CPU (except SD-Turbo, which needs WebGPU).
Without any model, LocVid still edits, animates (2D pan/zoom, parallax cards, designed backgrounds) and exports.

## Browser compatibility

Developed and tested in **Google Chrome 155 on macOS 26 (Apple M4)**. Other browsers use fallbacks:

| Feature | Needs | Fallback |
| --- | --- | --- |
| Fast export | WebCodecs H.264 encoder (Chrome, Edge, Safari) | FFmpeg.wasm engine (any browser with WebAssembly) |
| AAC audio | WebCodecs AAC encoder | Audio is encoded by FFmpeg.wasm and muxed in |
| Cinematic 3D, subjects, props, looks | WebGL2 (worker rendering via OffscreenCanvas when supported) | 2D motion, with a warning in the export summary |
| Depth / cut-out models | WebGPU (any GPU) or WebAssembly | CPU path (slower) |
| SD-Turbo pictures | WebGPU with `shader-f16` | Use your photos or designed backgrounds |

Chromium-based desktop browsers give the best experience. Firefox and Safari can edit and export; on-device AI features depend on
their WebGPU support.

## Hardware guidance

- **Editing and export**: any recent laptop. On an M4 MacBook, a 30-second 720p video with 7 cinematic shots exports in about 5 s
  (WebCodecs); the FFmpeg engine takes roughly 1–2× real time.
- **Depth and cut-out**: well under a second per picture on a recent GPU; on the CPU, about 3 s (depth) and 7–15 s (cut-out) per picture.
  Each picture is analyzed once and the result is stored.
- **SD-Turbo**: a WebGPU GPU with half-precision support, ~4 GB of GPU memory and 8 GB of RAM; the first image takes 10–60 s (shader
  compilation), later ones a few seconds.
- **Storage**: models need their download size in browser storage; each analyzed picture adds about 2–10 MB.

## Export limitations

- Up to 5 minutes per video; 720p or 1080p; H.264 video with AAC audio in MP4.
- 1080p and long videos need more memory; if the browser runs out, export at 720p or use the FFmpeg engine.
- Video backgrounds play as clips (no depth effects); cinematic 3D applies to still pictures.
- Subjects move as a whole (they lean, bend, squash and stretch, travel, jump) — arms and legs don't articulate.

## What "AI video" means here (and Level 3 research)

LocVid doesn't pretend to run a text-to-video model in the browser. As of October 2026, open-weight video models (Wan 2.x, LTX-2,
CogVideoX, HunyuanVideo) are PyTorch/CUDA models needing roughly 8–24 GB of GPU memory and multi-gigabyte text encoders; LTX-2.3 runs on
consumer hardware through a desktop app, not in a browser tab. No maintained WebGPU/ONNX runtime for them exists.

Instead, LocVid builds motion from analysis of the still — depth, a subject matte, a painted-in background — and renders it in real
time with three.js: a virtual camera, a subject that acts, props that live in the scene's depth. Notes from evaluating models for this:

- **BiRefNet-lite** (MIT) produces excellent mattes but doesn't run in browsers yet: its decoder has 32-output `Split` and up to
  1,024-input `Concat` ops that exceed WebGPU's per-shader storage-buffer limit on Apple GPUs (10) in ONNX Runtime's WebGPU backend, fail
  WGSL validation in the older JSEP backend, and exhaust the 4 GB WebAssembly heap at 1024². **IS-Net** (plain convolutions) runs
  everywhere: ~0.4 s on WebGPU, ~7 s on one CPU thread.
- **SlimSAM** needs good prompts (a single point picks a shirt, not a person); the anime-segmentation IS-Net misses animals.
- **MI-GAN** (28 MB) gives convincing clean plates in ~0.8 s on the CPU.

A future in-browser video model can plug in through `src/ai/videogen/registry.ts`: implement `VideoGenerator`, register it, and
*Describe your video* offers it as a source (each clip imported like any other video). Nothing is registered today, so no control
appears.

## Tests

```bash
npm run check                      # typecheck + lint + unit tests + production build
npx playwright test                # end-to-end, against the production build in Google Chrome
LOCVID_E2E_MODEL=1 LOCVID_E2E_PROFILE=~/.locvid-e2e npx playwright test e2e/cinematic.spec.ts e2e/imagegen.spec.ts
                                   # opt-in: real model downloads (~2.8 GB, cached in the profile) and inference
```

Results on 21 October 2026 (Chrome 155, macOS 26, Apple M4):

- Unit tests (Vitest): **156 passed**.
- End-to-end (Playwright): **22 passed**; 3 opt-in model tests skipped by default.
- Opt-in model tests, with fresh downloads: **3 passed** — depth model + moving camera + export; cut-out models + a subject that moves
  while the background stays identical + football + export; SD-Turbo download and generation on WebGPU in the video's shape (768×448)
  and square (512×512).
- A full no-photos run of *Describe your video* (4 shots: SD-Turbo pictures, ×2 sharpening, depth, cut-outs, subject actions, props)
  took 79 s to create and 2 s to export at 720p.
- Exports are verified with `ffprobe`/`ffmpeg` when available (codecs, frame counts, clean decode, colors, audio levels).

## Deploying for free (static hosting)

`npm run build` produces a fully static site in `dist/` with relative paths, so it works from any sub-path. No server-side code or
special headers are needed.

- **GitHub Pages** — build and publish `dist/` with the official Pages actions:

  ```yaml
  # .github/workflows/pages.yml
  on: { push: { branches: [main] } }
  permissions: { contents: read, pages: write, id-token: write }
  jobs:
    deploy:
      runs-on: ubuntu-latest
      environment: github-pages
      steps:
        - uses: actions/checkout@v4
        - uses: actions/setup-node@v4
          with: { node-version: 22 }
        - run: npm ci && npm run build
        - uses: actions/upload-pages-artifact@v3
          with: { path: dist }
        - uses: actions/deploy-pages@v4
  ```

- **Netlify** — drag `dist/` onto app.netlify.com/drop, or `npx netlify deploy --prod --dir=dist`.
- **Cloudflare Pages** — has a 25 MiB per-file limit, which the FFmpeg core (31 MB) and the ONNX Runtime binary (26.8 MB) exceed. Host
  those two files elsewhere (versions must match the installed `@ffmpeg/core` and `onnxruntime-web`) and point the build at them; the
  build then leaves them out of `dist/` and allows their host in the CSP:

  ```bash
  VITE_FFMPEG_BASE_URL=https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm \
  VITE_ORT_WASM_URL=https://cdn.jsdelivr.net/npm/onnxruntime-web@1.30.0/dist/ort-wasm-simd-threaded.asyncify.wasm \
  npm run build
  ```

`VITE_BASE` overrides the base path if a host needs an absolute one.

## Licensing notes

- FFmpeg.wasm's core (`@ffmpeg/core`, includes x264) is GPL-2.0-or-later; distributing a build that bundles it carries GPL obligations.
- Model licenses are listed above. SD-Turbo's Community License restricts some commercial use; generated pictures are yours to the extent
  the law allows. The image model draws generic scenes well but not specific characters — publishing copyrighted characters may need
  permission.
- Fonts are self-hosted from Fontsource (SIL Open Font License 1.1; Permanent Marker: Apache-2.0).

## Project layout

```
src/
  core/        project model, schema (versioned, validated), timeline, storyboard + prompt direction
  render/      the shared compositor; cinematic/ = three.js renderer, camera, subject animation, props, shaders
  ai/          model manifests and downloads, vision workers (depth, cut-out), SD-Turbo, video-model adapter point
  preview/     real-time preview engine
  export/      WebCodecs and FFmpeg pipelines (in a worker), audio mixdown
  storage/     IndexedDB
  features/    UI: home, editor, prompt dialog, AI tools, export
e2e/           Playwright tests and fixtures
```
