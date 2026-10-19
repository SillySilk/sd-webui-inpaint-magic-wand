# Inpaint Magic Wand

A lightweight selection tool for the Stable Diffusion WebUI Forge / Neo Forge inpaint canvas.

Turn on the wand in the canvas toolbar, then either brush over a person or object or drag a
box around it. The selection follows the subject's edges and lands in Forge's own inpaint
mask, as one undo step.

Unlike Segment Anything based tools, this extension does not download a model, load a
checkpoint, or send the image through Python. The selection runs in the browser and
writes the result into Forge's existing mask layer.

## Origin

This extension was spec-coded. It started with a Matt Pocock-style "grill me"
session that pressure-tested the idea and helped choose the simplest design: stay
inside the existing Forge inpaint canvas instead of adding another tab or model
workflow. The implementation, debugging, and packaging were completed with tools
from Anthropic and OpenAI.

## Features

- A wand button in the inpaint canvas toolbar, next to `Center Position [R]`.
- **Brush**: drag over the subject and the selection spreads out to its edges.
- **Rectangle**: drag a box around the subject and it is cut out of the background
  (GrabCut-style). Brush strokes inside the box then refine that cut.
- Shift adds and Alt subtracts for a single stroke or box, whatever the Mode says.
- Replace, Add, Subtract and Intersect modes, Tolerance, Grow, Clear and Invert.
- Works on `img2img -> Inpaint` and `img2img -> Inpaint sketch` (the sketch gets the
  current sketch colour).
- Every stroke, box, refinement, Clear and Invert is one Forge undo step.
- No Python package dependencies, no model downloads, no extra tabs.

## Compatibility

Tested with Stable Diffusion WebUI Forge - Neo / Neo Forge using Gradio 4 and
Forge's `ForgeCanvas` inpaint UI, in Chrome.

This is not a stock AUTOMATIC1111 canvas extension. It depends on Forge's
`img2maskimg` / `inpaint_sketch` `ForgeCanvas` DOM structure. Without that canvas the
wand button does not appear.

Works alongside the ForgeUI-MaskEraser extension: while the wand is on and the pointer
is over its canvas, Shift goes to the wand instead of switching the eraser on.

## Installation

### From the WebUI

1. Open the `Extensions` tab.
2. Open `Install from URL`.
3. Enter this repository URL:

   ```text
   https://github.com/SillySilk/sd-webui-inpaint-magic-wand.git
   ```

4. Click `Install`.
5. Restart the WebUI or reload the UI.

### Manual Install

Clone the repository into your WebUI `extensions` folder:

```bash
git clone https://github.com/SillySilk/sd-webui-inpaint-magic-wand.git extensions/sd-webui-inpaint-magic-wand
```

Then restart the WebUI or reload the UI.

## Usage

1. Open `img2img`, then `Inpaint` (or `Inpaint sketch`), and load an image.
2. Click the wand button in the canvas toolbar. It turns orange, and a settings strip
   appears at the bottom of the canvas. Forge's brush is paused while the wand is on.
3. Select the subject:
   - **Whole person, quickest:** tick `Rectangle` and drag a box around them. If the cut
     keeps a bit of background, Alt-drag over it inside the box. If it misses part of the
     person, drag over that part (no modifier). Each refinement recomputes the same box.
   - **Brush:** drag over part of the subject. Each stroke adds to the selection (the
     default Mode is Add). Alt-drag to take a part away. The brush uses Forge's `Brush Width`; keep the stroke
     inside the subject, because whatever it touches counts as "subject".
4. Click the wand button again to get Forge's brush back for touch-ups.
5. Generate with Forge's normal inpaint controls.

Right-drag still pans and the wheel still zooms while the wand is on.

The mask is the same mask Forge uses for inpainting, so `Mask blur`, `Mask mode`,
`Masked content`, `Inpaint area` and `Only masked padding` still work normally.

## Controls

`Tolerance`: how readily the selection crosses soft edges (brush) or how strictly the cut
follows edges (box). 40 is the default. Raise it to 50-60 when a brush stroke stops short
on shaded clothing; lower it when the selection spills into the background.

`Mode`: how a new selection combines with the mask: Add (the default), Replace, Subtract
or Intersect. Shift always adds and Alt always subtracts for that stroke or box.

`Rectangle`: off = brush, on = box. A box's refinement strokes work until a new box,
unticking `Rectangle`, `Clear`, `Invert`, a new picture, turning the wand off, Forge's
undo or redo, or any other edit that changes Forge's undo history (such as a brush stroke).
After that, a drag inside the old box starts a new box. A drag that starts inside (or within
a brush width of) the current box refines it; to draw a new box, start outside the current
one, or untick and re-tick `Rectangle`.

`Grow`: expands the selection by this many pixels before it is written to the mask.

`Clear`: removes the current mask. `Invert`: flips it.

Undo (`Ctrl + Z` or Forge's undo button) steps back one stroke, box or refinement at a time.

## Tips and limits

- The box is the most reliable way to get a whole person. Brush strokes work best on
  areas that differ from their surroundings, such as a shirt against a wall.
- When part of the subject is the same colour as the background next to it (dark
  trousers against a black wall, two people in matching dark suits), the brush cannot
  tell them apart. Use a box, then Alt-drag over the part that does not belong.
- Two people touching: box the one you want, then Alt-drag along the other person where
  they overlap (an arm across the chest, a shoulder).
- Forge's toolbar covers the top of the canvas and the strip covers the bottom. To work
  there, zoom with the wheel and pan with right-drag, or start a box from the bottom
  corner and drag upwards.
- Speed: on a 2 MP image a box takes about 1 s; on a 4K image about 1 s for a box and
  under 1.5 s for a refinement.

## How It Differs From SAM Extensions

Segment Anything extensions are semantic/object segmentation tools. They understand
objects, but need model files, server-side inference, and often a separate
mask-transfer workflow.

Inpaint Magic Wand works from colour and edges only, in the browser. It is fast,
dependency-free, and stays inside the native Forge inpaint panel.

## Troubleshooting

If the wand button does not appear, restart the WebUI after installation, then
hard-refresh the browser so the new JavaScript loads.

If dragging paints with Forge's brush, the wand is off. Click the wand button.

If the strip says `No image`, load an image into the canvas first.

After an undo or any other edit, a drag inside the old box simply draws a new box. The
`Box expired, draw a new one` message only appears if the edit happens while a refinement
is still computing; drag a new box.

## Development

The tests run with Node's built-in runner and need no packages:

```bash
node --test "tests/js/*.test.js"
```

## License

MIT. See [LICENSE](LICENSE).
