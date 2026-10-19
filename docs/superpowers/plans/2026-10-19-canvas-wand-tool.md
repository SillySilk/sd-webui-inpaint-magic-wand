# Canvas Wand Tool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flood-fill wand with an on-canvas tool that selects a whole person or object by brushing over it (edge-aware growth) or by dragging a box (GrabCut-style cut), with refinement strokes.

**Architecture:** Pure image-processing modules (no DOM) attach functions to a shared `IMW` namespace and are unit-tested in Node. One UI module wires them to Forge Neo's ForgeCanvas: a toolbar toggle, a floating settings strip, a drag overlay, and mask painting through the canvas's own undo. All work runs on a downscaled copy of the base image, and the mask is upscaled with clean edges.

**Tech Stack:** Plain browser JavaScript (classic scripts, loaded alphabetically by Forge from `javascript/`), CSS, Node 24 `node:test` for tests. No dependencies.

**Spec:** `docs/superpowers/specs/2026-10-19-canvas-wand-tool-design.md`

## Global Constraints

- No AI model, no downloads, no Python packages, no npm dependencies. Everything runs in the browser.
- No changes to Forge Neo's own files. Integrate only through `image_<uuid>`, `drawingCanvas_<uuid>`, `centerButton_<uuid>`, `undoButton_<uuid>`, `redoButton_<uuid>` and `window.forgeCanvasInstances[uuid]` (`saveState()`, `scribbleWidth`, `scribbleColor`, `contrast_scribbles`, `contrast_pattern`, `scribbleAlphaFixed`, `scribbleAlpha`).
- Canvases: `img2maskimg` (Inpaint) and `inpaint_sketch` (Inpaint sketch).
- Each finished stroke, box or refinement = exactly one `saveState()` undo step.
- Responsive on 1–2 MP images: a brush stroke result appears within about 0.5 s of release; a box within 2 s.
- Clean result: no holes or islands smaller than 0.1% of the work-image area, a smooth outline, Grow applied last.
- Analyse only the base image (`image_<uuid>`), never what is drawn on the mask canvas.
- Every module file works both as a browser classic script and under Node `require` (UMD-style namespace below).

## Review Focus

1. A zero-size or tiny drag (box under 4 work pixels on a side, or a click with no movement in Rectangle mode). It should do nothing and show no error.
2. A stroke or box partly or fully outside the image. It should be clipped to the image; fully outside does nothing.
3. A very large image (4096×4096). It must still be fast, because work happens at the downscaled size.
4. An image with transparent pixels (a PNG cut-out). Transparent pixels count as background colour (alpha treated as black), with no crash.
5. The image replaced, or Forge undo pressed, mid-refinement. The refinement session ends, and the next stroke starts fresh rather than resurrecting the old box.

Items 1–4 get unit tests in the owning tasks. Item 5 is a scripted manual check in Task 6.

---

## Shared conventions (every task)

Module wrapper, used by every file in `javascript/`:

```js
(function (root) {
    "use strict";
    const IMW = root.IMW = root.IMW || {};
    // ... define functions, then: IMW.someFn = someFn;
    if (typeof module !== "undefined") module.exports = IMW;
})(typeof window !== "undefined" ? window : globalThis);
```

Tests `require` the files in name order to build `IMW` (`tests/js/load.js` does this once and exports `IMW`).

A **work image** is `{ width, height, lab: Float32Array(w*h*3), edge: Float32Array(w*h), scale }`. `scale` = original width ÷ work width. A **mask** is a `Uint8Array(w*h)` with values 0 or 255.

Run all tests: `node --test tests/js` (expected: all pass, 0 failures).

---

### Task 1: Test harness and image module

**Files:**
- Create: `javascript/imw_10_image.js`, `tests/js/load.js`, `tests/js/fixtures.js`, `tests/js/image.test.js`

**Interfaces:**
- Produces:
  - `IMW.WORK_MAX = 640`
  - `IMW.makeWork(rgba: Uint8ClampedArray, width, height) -> work`: downscales so the longest side is at most `WORK_MAX` (box filter), converts to CIE Lab (D65), applies a light 3×3 Gaussian before the edges, and builds `edge` as the Sobel magnitude over L, a and b combined, normalised to 0..1 by the 99th percentile. Alpha 0 counts as black.
  - `IMW.labDistance(lab, i, j) -> number` (ΔE76)
  - `fixtures.js`:
    - `disk(w, h, cx, cy, r, colorsInside[], colorOutside)` returns RGBA with mottled multi-colour stripes inside the disk.
    - `noise(rgba, amount, seed)` adds deterministic noise.
    - `iou(maskA, maskB)`.
    - `circleMask(w, h, cx, cy, r)`.

- [ ] **Step 1: Write failing tests** in `tests/js/image.test.js`:
  - `makeWork keeps small images at full size`: 200×100 input gives `width === 200`, `height === 100`, `scale === 1`.
  - `makeWork downscales the longest side to WORK_MAX`: 4096×2048 gives 640×320 and `scale === 6.4`, built in under 1500 ms.
  - `Lab of pure white is about L=100, a=b=0` (within 0.5).
  - `edges are strong on a hard boundary and weak in flat areas`: a black|white split image has edge at the boundary column above 0.8, and edge 20 px away below 0.05.
  - `transparent pixels are treated as black`: an RGBA with alpha 0 and RGB 255 gives L below 1.
- [ ] **Step 2: Run** `node --test tests/js`. Expected: FAIL (`makeWork` is not a function).
- [ ] **Step 3: Implement** `imw_10_image.js` and the test helpers to the interfaces above.
- [ ] **Step 4: Run** `node --test tests/js`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(wand): image work buffer with Lab colour and edge map`

---

### Task 2: Mask clean-up, grow and upscale

**Files:**
- Create: `javascript/imw_20_mask.js`, `tests/js/mask.test.js`

**Interfaces:**
- Consumes: the mask convention.
- Produces:
  - `IMW.cleanMask(mask, w, h) -> mask`: fills holes and drops islands smaller than `max(16, 0.001*w*h)` pixels, then smooths the outline (3×3 majority, two passes).
  - `IMW.growMask(mask, w, h, radius) -> mask`: round dilation, using a Euclidean distance transform, for 0..64 px. A radius of 0 returns the input unchanged.
  - `IMW.upscaleMask(mask, w, h, outW, outH) -> mask`: bilinear on 0..1, then thresholds at 0.5.
  - `IMW.clipRect(rect, w, h) -> rect | null`: returns null when either side is under 4 px after clipping.

- [ ] **Step 1: Write failing tests:**
  - `cleanMask fills a pinhole`: a 100×100 filled square with one 2×2 hole has no zero pixels inside afterwards.
  - `cleanMask removes a speck`: a lone 3×3 island far from the main square becomes 0.
  - `growMask is round`: a single centre pixel grown by 10 has every pixel inside radius 9.5 set, and corner pixels at distance above 10.5 unset.
  - `growMask radius 0 is identity`.
  - `upscaleMask doubles a square cleanly`: a 10×10 square in 50×50 becomes about 20×20 in 100×100, with IoU at least 0.95 against the expected square.
  - `clipRect drops tiny and outside rects`: `{x:-50,y:-50,w:20,h:20}` gives null, `{x:10,y:10,w:3,h:30}` gives null, and `{x:-10,y:5,w:50,h:50}` in a 100×100 image gives `{x:0,y:5,w:40,h:50}`.
- [ ] **Step 2: Run** `node --test tests/js`. Expected: FAIL.
- [ ] **Step 3: Implement** `imw_20_mask.js`.
- [ ] **Step 4: Run** `node --test tests/js`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(wand): mask clean-up, round grow and upscale`

---

### Task 3: Brush selection (edge-aware growth)

**Files:**
- Create: `javascript/imw_30_brush.js`, `tests/js/brush.test.js`

**Interfaces:**
- Consumes: `work`, `IMW.labDistance`, `IMW.cleanMask`.
- Produces:
  - `IMW.TOLERANCES = [10, 20, 30, 40, 50, 60, 70, 80]` and `IMW.DEFAULT_TOLERANCE = 40`.
  - `IMW.strokeSeeds(points: {x,y}[], radius, w, h) -> mask`: work-pixel coordinates; the stroke is painted as a polyline of the given radius and clipped to the image.
  - `IMW.brushSelect(work, seeds: mask, tolerance) -> mask`: an empty seed mask returns an all-zero mask.
- Algorithm (the tests don't fix it, so it's set here):
  1. Build a colour model from seed pixels: k-means in Lab with k = min(5, seeds/50, at least 1).
  2. Run a geodesic growth (Dijkstra with a binary heap, 8-neighbour) from all seeds. Step cost = `edge[q] * 4 + max(0, d(q) − T) / 10`, where `d(q)` is the ΔE from pixel q to its nearest seed cluster and `T = tolerance * 0.5`.
  3. Accept pixels with total cost ≤ `1 + tolerance / 40`.
  4. Pass the result through `cleanMask`.

- [ ] **Step 1: Write failing tests** (fixture: 320×240, a disk with three inside colours and a different flat background, noise 6):
  - `a stroke across a multi-colour disk selects the whole disk`: a stroke through the centre crossing all three stripes gives IoU at least 0.93 against `circleMask`.
  - `it does not leak through a strong edge into a similar background`: the background is a smooth gradient that reaches one inside colour 40 px outside the disk. At tolerance 40, pixels selected outside the disk are below 1% of the image.
  - `low tolerance selects less than high tolerance`: selected count at 10 is at most the count at 80.
  - `a stroke partly outside the image is clipped`: points that run off the right edge cause no throw, and the result is still the disk (IoU at least 0.9).
  - `no seeds gives an empty mask`.
- [ ] **Step 2: Run** `node --test tests/js`. Expected: FAIL.
- [ ] **Step 3: Implement** `imw_30_brush.js` to the algorithm above. Tune only the constants in step 2 of the algorithm if a test needs it, and record the final values in a comment.
- [ ] **Step 4: Run** `node --test tests/js`. Expected: PASS. Brush test runtime is under 300 ms per selection at 640 px.
- [ ] **Step 5: Commit** `feat(wand): edge-aware brush selection`

---

### Task 4: Max-flow and box selection (GrabCut-style)

**Files:**
- Create: `javascript/imw_40_maxflow.js`, `javascript/imw_50_grabcut.js`, `tests/js/maxflow.test.js`, `tests/js/grabcut.test.js`

**Interfaces:**
- Consumes: `work`, `IMW.clipRect`, `IMW.cleanMask`.
- Produces:
  - `IMW.gridMaxflow(w, h, source: Float32Array, sink: Float32Array, right: Float32Array, down: Float32Array, diagR: Float32Array, diagL: Float32Array) -> Uint8Array`: a Boykov–Kolmogorov max-flow on an 8-connected grid. The four neighbour arrays are symmetric edge capacities. Returns 1 for each pixel on the source side.
  - `IMW.boxSelect(work, rect, hints: {fg: mask|null, bg: mask|null}, tolerance) -> mask`. Pixels outside `rect` are always 0. A rect that `clipRect` rejects returns an all-zero mask.
- Algorithm:
  1. Two GMMs (5 components, full covariance, Lab): foreground from inside the rect, background from a band 16 work px wide around it (clipped), plus the whole image outside the rect if that band is empty.
  2. Data terms are the negative log-likelihoods. Hints are hard: fg sets source = 1e9, bg sets sink = 1e9.
  3. Pairwise term `γ·exp(−β‖ΔLab‖²)/dist`, with `β = 1/(2·mean‖ΔLab‖²)` and `γ = 50 * (1.5 − tolerance/100)`.
  4. Run 4 iterations, re-estimating the GMMs from the current labels, then `cleanMask`.

- [ ] **Step 1: Write failing tests:**
  - `maxflow cuts a 2×1 grid at the weak link`: two pixels with source 5|0, sink 0|5 and link 1 give labels `[1,0]`.
  - `maxflow follows a weak column`: on a 20×10 grid with left column source-heavy, right column sink-heavy and a uniformly weak column 10, every pixel left of x=10 is 1 and every pixel right of it is 0.
  - `box around a two-tone figure selects it`: a 320×240 figure (two inside colours: "head" and "body" disks touching) on a textured background with a 20 px margin rect gives IoU at least 0.9, in under 2000 ms.
  - `a background hint separates two touching figures`: two figures touch inside one rect, and a `bg` hint stroke on the right figure leaves under 5% of the right figure selected and keeps the left at IoU at least 0.85.
  - `tiny or outside rect returns empty without throwing`: a `{x:5,y:5,w:2,h:2}` rect and a fully outside rect both give an all-zero mask.
- [ ] **Step 2: Run** `node --test tests/js`. Expected: FAIL.
- [ ] **Step 3: Implement** `imw_40_maxflow.js`, then `imw_50_grabcut.js`.
- [ ] **Step 4: Run** `node --test tests/js`. Expected: PASS.
- [ ] **Step 5: Commit** two commits: `feat(wand): grid max-flow` and `feat(wand): box selection with refinement hints`.

---

### Task 5: Canvas tool UI (replaces the accordion and the flood wand)

**Files:**
- Create: `javascript/imw_90_tool.js`
- Delete: `javascript/inpaint_magic_wand.js`, `scripts/inpaint_magic_wand.py` (Forge loads `javascript/` and `style.css` on its own, so no Python script is needed)
- Modify: `style.css` (replace the accordion styles with the strip, the active toolbar button and the overlay)

**Interfaces:**
- Consumes:
  - `IMW.makeWork`, `strokeSeeds`, `brushSelect`, `boxSelect`, `growMask`, `upscaleMask` and `clipRect`.
  - `IMW.TOLERANCES` and `DEFAULT_TOLERANCE`.
  - From the old `inpaint_magic_wand.js`, keep these functions' behaviour: `getForgeCanvas`, `canvasInstance`, `paintSelection`, `applySelection` (Replace/Add/Subtract/Intersect compositing), `commitDrawing` and `clickToImagePixel`.
- Produces: no new API. The behaviour is defined below.

Behaviour:
- **Toolbar button.**
  - A wand button is inserted after `centerButton_<uuid>`, as today. It toggles the tool.
  - While on: the button shows as active, the strip shows, the extension takes `pointerdown/move/up` on `drawingCanvas` in the capture phase (`stopImmediatePropagation`), and the cursor is a crosshair.
  - Right button and wheel are never taken, so pan and zoom keep working.
- **Floating strip.**
  - Positioned absolutely at the top centre of `container_<uuid>`, dark translucent, as in mockup B.
  - Holds, in order: Tolerance `<select>` (from `IMW.TOLERANCES`), Mode `<select>` (Replace, Add, Subtract, Intersect), Rectangle checkbox, Grow number field (0–64, default 2), a Clear button and an Invert button.
  - Tolerance, Mode, Rectangle and Grow are stored in `localStorage` key `imw.settings` (reads and writes wrapped in try/catch) and shared by both canvases.
- **Overlay.**
  - A `<canvas>` sibling of `drawingCanvas`, with `pointer-events:none`.
  - On every pointer move it copies `drawingCanvas`'s `style.left/top/width/height/transform` and its pixel size.
  - Brush: a translucent orange stroke path whose width is the instance's `scribbleWidth * 2`, in canvas pixels.
  - Rectangle: a dashed outline.
  - Cleared on pointer up.
- **Work image cache.** One `work` per `image.src`, rebuilt when the image `load` event fires.
- **Brush release.**
  1. Map the points to work pixels, then `strokeSeeds` with radius `scribbleWidth / work.scale`.
  2. Run `brushSelect`, then `upscaleMask` to `drawingCanvas` size, then `growMask(grow)`.
  3. `applySelection` with the mode. Shift forces Add and Alt forces Subtract; call `preventDefault` on Alt.
  4. One `saveState` (through `commitDrawing`).
- **Rectangle release.**
  1. Map the rect to work pixels. If `clipRect` returns null, do nothing.
  2. Start a session: `{ rect, fg, bg, before: snapshot of drawingCanvas, mode }`.
  3. Run `boxSelect`, upscale, grow, and apply onto `before` with the mode.
  4. One `saveState`.
- **Refinement stroke** (Rectangle on, session active, stroke inside or touching the rect):
  1. Add the stroke to `bg` when the effective mode is Subtract, otherwise to `fg`.
  2. Restore `before`, recompute `boxSelect` with the hints, and apply it with the session's mode.
  3. One `saveState`.
- **Session ends when:** a new box is drawn, Rectangle is unticked, Clear is pressed, the image `load` fires, the wand is toggled off, `undoButton_`/`redoButton_` is clicked, or Ctrl+Z / Ctrl+Y is pressed while the canvas is visible.
- **Clear and Invert** behave as today (Invert = Replace with the inverted mask). Clear also ends the session.
- **Inpaint sketch:** `paintSelection` already uses the sketch colour or contrast pattern. Keep it.

- [ ] **Step 1: Implement** `imw_90_tool.js` and `style.css` to the behaviour above, and delete the two old files.
- [ ] **Step 2: Run** `node --test tests/js`. Expected: still PASS. Also run `node -e "require('./javascript/imw_90_tool.js')"`. Expected: no throw outside a browser, because UI setup is guarded by `typeof document !== 'undefined'`.
- [ ] **Step 3: Commit** `feat(wand): canvas wand tool with floating strip, brush and box modes`

---

### Task 6: Check in Forge, tune, and update the docs

**Files:**
- Modify: `README.md` (features and usage rewritten for the tool), `CHANGELOG.md` (new entry)
- Possibly modify: constants in `imw_30_brush.js` and `imw_50_grabcut.js`, if real photos need tuning (re-run `node --test tests/js` after any change)

- [ ] **Step 1: Restart Forge Neo.** Ask before stopping a running copy, because it may be in use. Open img2img → Inpaint, load a photo of a person from `forge-neo/output/txt2img-images`, and confirm:
  1. The wand button toggles the strip, and the brush and eraser work normally while it's off.
  2. Two or three brush strokes over the person give a clean whole-person mask. Shift adds and Alt subtracts.
  3. Rectangle: one box around the person gives a clean mask within 2 s. A subtract stroke on a touching second person removes them.
  4. Each action is one Forge undo step. After an undo, the next stroke starts a fresh selection (Review Focus 5). Loading a new image also ends the session.
  5. Pan (right-drag) and zoom keep the overlay aligned.
  6. Inpaint sketch paints the selection in the sketch colour.
  7. A 4K image stays responsive.
- [ ] **Step 2: Tune** constants if real photos leak or fall short, keeping all unit tests passing. Note the final values in the code comments.
- [ ] **Step 3: Update** `README.md` and `CHANGELOG.md`.
- [ ] **Step 4: Run** `node --test tests/js`. Expected: PASS.
- [ ] **Step 5: Commit** `docs(wand): usage for the canvas wand tool` (plus `fix(wand): tune …` if constants changed), then push to `origin main`. Ask the user to do the final visual check in Forge.
