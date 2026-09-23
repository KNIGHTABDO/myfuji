# myfuji: a film darkroom in your browser

Drop in any photo. myfuji studies it the way a lab technician would (faces,
objects, sky, light, colour temperature, time of day), picks the Fujifilm-style
film simulation that suits it, tunes every camera setting to that frame, and
develops it at full resolution on your GPU.

While it works, a hand-drawn mosquito flies along an ink line across the
developing card. At each stage it lands, drinks a little ink and takes off
again. It is built with the
[hand-drawn-canvas-animation](https://github.com/alesha-pro/tools/tree/main/skills/hand-drawn-canvas-animation)
stroke engine.

No account and no server: everything, including the ML models, runs on your
device.

## Run it

```bash
npm install        # also copies the MediaPipe WASM runtime into public/
npm run dev        # http://localhost:5173
npm run build      # static site in dist/, deployable to any static host
```

Needs a browser with WebGL2 (any recent Chrome, Edge, Firefox or Safari).

## What it does

**Reads the photo** (`src/engine/analyze/`)
- Pixel statistics: histogram, key, dynamic range in stops, clipping, contrast, colourfulness, hue mass.
- Light: illuminant estimate (grey-pixel, white-patch and grey-world, weighted by how many neutral surfaces the scene has), CCT and green/magenta tint.
- Sky connected to the top edge (blue, sunset, overcast, dusk, night), point light sources, noise and sharpness measured on a 1:1 crop.
- Palette: k-means in OKLab with colour names.
- On-device models (MediaPipe): faces (full frame, tiles and person head crops), ImageNet scene labels, COCO objects, and DeepLab person segmentation.
- EXIF: camera, lens and exposure. With GPS and time, it computes the **sun's elevation**, which tells golden hour, blue hour and night apart.
- Combines all of that into a subject (portrait, street, landscape, food, night city…), a lighting type (golden hour, tungsten, overcast, backlit, neon…) and a short written reading.

**Picks the film** (`recommend.ts`): scores all 14 simulations against the reading, explains the top pick, suggests a recipe, and auto-tunes exposure, DR, highlight/shadow tone, colour, grain, colour chrome, clarity and sharpness for the frame.

**Develops it** (`src/engine/film/`, `src/engine/gl/`)
- 14 simulations: Provia, Velvia, Astia, Classic Chrome, Reala Ace, Pro Neg Hi/Std, Classic Neg, Nostalgic Neg, Eterna, Eterna Bleach Bypass, Acros (Ye/R/G filters), Monochrome, Sepia. Each is modelled as a tone curve, OKLab hue-selective edits, a split tone and gamut mapping, baked into a 48³ (64³ for export) half-float 3D LUT in a Web Worker.
- WebGL2 pipeline: white balance and shift, exposure, adaptive local tone mapping (guided-filter base layer) that holds skies and keeps blacks, face/subject lift for backlight, DR100/200/400 shoulder, halation, skin-tone protection (a second skin-safe LUT blended through the person mask), clarity, sharpening, vignette, light leaks and resolution-aware film grain.
- Exports are rendered in tiles at full resolution.

**Everything else**
- Any image: JPEG, PNG, WebP, AVIF, GIF, BMP, SVG, HEIC/HEIF (libheif in the browser), TIFF, and camera RAW (DNG, CR2/CR3, NEF, ARW, RAF, ORF, RW2, …) via the embedded full-size preview.
- Several photos at once become a roll; export the whole roll as a .zip.
- Fuji-style Q menu, WB-shift pad, simulation dial, live contact sheet of every film, 14 recipes, custom slots C1–C7 (saved locally).
- Before/after split, hold-to-compare, scroll zoom and drag to pan, live histogram.
- Prints: full bleed, gallery border, "shot-on" EXIF caption, 35mm strip with edge print, instant and square instant (smart-cropped on faces), and a ’98 orange date stamp. Crops include 3:2, 4:5, 1:1, 16:9 and XPan 65:24.
- Optional sound: a synthesised mosquito whine and a shutter click.
- Keyboard shortcuts: press `?` in the app.

## Layout

```
public/hand/        hand-drawn-canvas-animation engine (MIT, unmodified)
public/models/      MediaPipe .tflite models (Apache-2.0)
src/engine/         decoding, EXIF, analysis, film science, WebGL, export
src/mosquito/       the mosquito: whole-pose cels, progress card, idle scene, buzz
src/ui/             React interface
dev/                QA pages (pose sheet, film comparison grid)
scripts/            copy-wasm, and headless-Chromium QA helpers
```

`dev/qa.html?imgs=a.jpg,b.heic` (with images in `dev/imgs/`, which is git-ignored)
develops each image with several simulations side by side. `dev/poses.html`
shows every mosquito drawing.

## Notes

- The film simulations are original tunings that aim for the character of each Fujifilm simulation. They are not Fujifilm's data. myfuji is not affiliated with or endorsed by FUJIFILM Corporation, and simulation names are used descriptively.
- UI fonts load from Google Fonts. Without them the app falls back to system fonts.
- Working resolution is capped by the GPU's texture limit (at most 8192 px on the long edge, 40 MP).
