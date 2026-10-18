# Inpaint Magic Wand

A lightweight magic-wand mask selector for Stable Diffusion WebUI Forge / Neo Forge.

<img width="894" height="172" alt="image" src="https://github.com/user-attachments/assets/0f064c19-cebc-4226-9d3e-ca6bb5ad54da" />

This extension adds a `Magic Wand Integrated` accordion to the `img2img` page. In
`img2img -> Inpaint` or `img2img -> Inpaint sketch`, enable click selection and click
the original image to create or edit the mask directly on the built-in Forge canvas.

Unlike Segment Anything based tools, this extension does not download a model, load a
checkpoint, or send the image through Python. The selection runs in the browser and
writes the result into Forge's existing inpaint mask layer.

## Origin

This extension was spec-coded. It started with a Matt Pocock-style "grill me"
session that pressure-tested the idea and helped choose the simplest design: stay
inside the existing Forge inpaint canvas instead of adding another tab or model
workflow. The implementation, debugging, and packaging were completed with tools
from Anthropic and OpenAI.

## Features

- Integrated into the normal `img2img` workflow.
- Uses the existing `img2img -> Inpaint` image and mask canvas.
- Replace, add, subtract, and intersect selection modes.
- Contiguous or global color selection.
- Adjustable tolerance and mask growth.
- Clear and invert mask actions.
- In-canvas toolbar toggle next to `Center Position [R]`.
- No Python package dependencies.
- No model downloads.
- No extra tabs.

## Compatibility

Tested with Stable Diffusion WebUI Forge - Neo / Neo Forge using Gradio 4 and
Forge's `ForgeCanvas` inpaint UI.

This is not a stock AUTOMATIC1111 canvas extension. It depends on Forge's
`img2maskimg` / `ForgeCanvas` DOM structure. If another WebUI does not expose that
canvas, the accordion may appear but click selection will not work.

## Installation

### From the WebUI

1. Open the `Extensions` tab.
2. Open `Install from URL`.
3. Enter this repository URL:

   ```text
   https://github.com/gcmdnt90/sd-webui-inpaint-magic-wand.git
   ```

4. Click `Install`.
5. Restart the WebUI or reload the UI.

### Manual Install

Clone the repository into your WebUI `extensions` folder:

```bash
git clone https://github.com/gcmdnt90/sd-webui-inpaint-magic-wand.git extensions/sd-webui-inpaint-magic-wand
```

Then restart the WebUI or reload the UI.

## Usage

1. Open `img2img`.
2. Open the `Inpaint` image mode.
3. Upload or paste an image.
4. Open `Magic Wand Integrated`.
5. Enable `Enable click selection`, or use the `W` toolbar button beside `Center Position [R]` in the image frame.
6. Click the source image to create a mask.
7. Generate with Forge's normal inpaint controls.

The generated mask is the same mask Forge uses for inpainting, so `Mask blur`,
`Mask mode`, `Masked content`, `Inpaint area`, and `Only masked padding` still work
normally.

## Controls

`Tolerance`: how far a pixel color may be from the clicked color.

`Grow pixels`: expands the selected area before writing the mask.

`Mode`: how the new selection combines with the current mask. Shift+click always
adds and Alt+click always subtracts.

`Contiguous`: when enabled, only connected pixels around the click are selected.
When disabled, all matching pixels in the image are selected.

`Clear mask`: removes the current inpaint mask.

Every wand click, Clear, and Invert is one undo step on the canvas (`Ctrl + Z`).

`Invert mask`: flips the current inpaint mask.

`W` toolbar button: toggles Magic Wand on/off from the inpaint image frame, without scrolling back to the accordion.

## How It Differs From SAM Extensions

Segment Anything extensions are semantic/object segmentation tools. They are more
powerful for object selection, but need model files, server-side inference, and often
a separate mask-transfer workflow.

Inpaint Magic Wand is a small canvas tool. It is closer to the color-selection wand
in an image editor. It is fast, dependency-free, and designed to stay inside the
native Forge inpaint panel.

## Troubleshooting

If the accordion does not appear, restart the WebUI after installation.

If clicks still draw with the brush, make sure `Enable click selection` is checked.

If the status says `No inpaint image`, switch to `img2img -> Inpaint` and upload an
image there.

If the panel appears after an update but clicks do nothing, hard-refresh the browser
or reload the UI so the JavaScript is reloaded.

## License

MIT. See [LICENSE](LICENSE).
