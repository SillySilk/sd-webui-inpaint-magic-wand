# Canvas Wand Tool: edge-aware brush and box selection

Date: 2026-10-19 · Owner: SillySilk · Repo: this extension (fork of gcmdnt90/sd-webui-inpaint-magic-wand)

## Why

The user masks a **whole person or object** for inpainting. The current wand compares every
pixel to the single clicked pixel's colour and floods outward. It has no idea where edges are.
On a person (skin, hair, shirt, trousers) tolerance 30 picks up one patch at a time and
tolerance 50 leaks into the background. The user called it "rudimentary edge detection" and
wants something closer to modern selection tools, while keeping the extension lightweight.

## What it becomes

A **tool on Forge Neo's inpaint canvas** (img2img → Inpaint and Inpaint sketch), alongside
the brush and eraser, with two ways to select:

1. **Brush (default).** Drag over the subject. The selection spreads from the stroke out to the
   subject's edges, like Photoshop's Quick Selection. Each stroke adds to the selection
   (Alt-drag subtracts, Shift-drag adds, whatever the mode dropdown says otherwise).
2. **Rectangle (checkbox).** Drag a box around the subject. The tool separates the subject from
   the background inside the box and cuts along the strongest edges (GrabCut-style:
   colour models for "inside" vs "outside" plus an edge-respecting cut). After a box,
   brush strokes refine the same cut: a stroke in add mode marks "definitely subject",
   in subtract mode "definitely not", and the cut is recomputed with those hints. This is how
   two people who are touching get separated.

Forge's normal mask brush and eraser stay for manual touch-up.

## Settings strip (decided: floating strip, option B)

When the wand tool is picked, a small strip floats at the top of the image. It hides when
another canvas tool is picked. It holds:

- **Tolerance** — small dropdown (preset steps). In brush mode it controls how readily the
  selection crosses soft edges; in rectangle mode, how strongly edges are respected.
- **Mode** — small dropdown: Replace, Add, Subtract, Intersect. Shift/Alt override per stroke.
- **Rectangle** — checkbox; off = brush, on = box.
- **Grow** (pixels), **Clear**, **Invert** — kept, same strip (builder's call on layout: e.g. a
  compact number field and two small buttons).

The old "Magic Wand Integrated" accordion under img2img and the plain single-click flood
selection are removed. A small dab with the brush replaces single-click.

## Constraints

- **No AI model, no downloads, no Python packages.** Everything runs in the browser in plain
  JavaScript, as today. The Python script only needs to load the JS/CSS (it no longer draws the
  accordion; whether a Script class remains is the builder's call).
- **Forge Neo's ForgeCanvas only.** Keep using what the current code relies on: the canvas
  `image_`/`drawingCanvas_` elements, `window.forgeCanvasInstances[uuid].saveState()` for undo
  and Gradio sync, the brush colour / contrast pattern for painting the result, and the toolbar
  next to `centerButton_`. Both `img2maskimg` and `inpaint_sketch` canvases.
- **Each finished stroke or box = one undo step**, through ForgeCanvas's own undo.
- **Responsive on a typical image (≈1–2 megapixels).** A brush stroke should update as you drag
  or immediately on release; a box should finish within a couple of seconds. Working on a
  downscaled copy and upscaling the mask with clean edges is acceptable.
- **The result is a clean mask**: no pinholes or speckle, smooth outline, Grow applied last.

## Non-goals

- AI "select subject" (SAM, rembg, etc.). Explicitly declined.
- Matching Photoshop's Select and Mask / hair refinement.
- Any change to Forge Neo's own files; this stays an extension.

## Anti-goals (would be a failure even if it technically works)

- Leaking into the background as easily as today's tolerance-50 flood.
- Freezing the browser tab for many seconds on a normal image.
- Breaking Forge's own brush, eraser, or undo.
- Needing many fiddly settings to get a person out.

## Success

On a photo of a person against an ordinary background: one box (or two or three brush
strokes) plus at most a couple of refining strokes gives a clean mask of that person, even with
another person touching them.

## Settled details (designer's calls, not the user's; flagged for review)

- **Tool switching.** ForgeCanvas has no tool group (the brush always draws; the eraser is
  another extension). The wand is an extension-owned mode: its toolbar button toggles it, the
  extension takes the canvas's pointer events while it is on, and the strip shows only while it
  is on. No Forge files change, and there is no automatic switch-off when other buttons are used.
- **While dragging.** A light overlay shows the brush path or the box outline while you drag.
  The mask is computed and painted on release. No live mask preview. The overlay must follow
  Forge's pan and zoom.
- **Brush size.** Reuse Forge's current brush size (the instance's scribble width), so the strip
  needs no size control.
- **Rectangle refinement session.** It lasts until the next box, Rectangle unticked, Clear, a
  new image, or the wand switched off. Forge's undo restores pixels only and ends the session.
  Refinement strokes recompute only the current box's cut. Mask outside the box, or from earlier
  selections, is left alone.
- **Mode with boxes.** The box's cut combines with the existing mask using the Mode dropdown. A
  refinement stroke in subtract (or Alt) marks "not subject"; any other stroke marks "subject".
- **Modifiers.** Shift = add and Alt = subtract, overriding the dropdown for that stroke or box,
  in both modes. Suppress the browser's Alt default.
- **Source pixels.** Analyse only the base image, never the mask or sketch strokes drawn on top.
- **Tolerance.** One value shared by both modes, remembered across mode switches.
- **Checking success.** Tune on real photos of people from Forge Neo's own output folder, plus
  small synthetic test images for the algorithm. The user does the final visual check in Forge.

## Left to the builder

The exact algorithms (e.g. edge map, colour models, graph-cut or similar), downscale size,
dropdown step values, icons and styling, how the strip and tool button look, code structure,
and any test approach. Keep the repo's README/CHANGELOG up to date with the new usage.
