# Changelog

## Unreleased

### Canvas wand tool

The click-to-flood wand is replaced by a selection tool on the inpaint canvas.

- The wand button in the canvas toolbar now turns a wand tool on and off. While it is on,
  left-drags on the canvas select instead of painting, and a settings strip sits at the
  bottom of the canvas.
- **Brush selection**: drag over the subject and the selection spreads to its edges. It
  uses colour and edge strength, so it no longer floods into the background the way a
  high-tolerance single-colour flood did.
- **Box selection** (`Rectangle`): drag a box and the subject is cut out of the background
  (GrabCut-style colour models plus a graph cut). Strokes inside the box refine the cut:
  Alt-drag marks "not subject", a plain drag marks "subject". This separates two people
  who touch.
- Each stroke, box and refinement is one Forge undo step. A box's refinement ends with a
  new box, unticking `Rectangle`, Clear, Invert, a new picture, turning the wand off,
  Forge's undo or redo, or any other edit that changes Forge's undo history.
- The selection is cleaned (no pinholes or specks), smoothed, then grown by `Grow`.
- The brush size comes from Forge's `Brush Width`.
- Mode defaults to Add, so each brush stroke adds to the selection.
- Shift adds and Alt subtracts for one stroke or box. While the wand is on, Shift no longer
  switches on the ForgeUI-MaskEraser extension's eraser, and the browser's own Alt action is
  suppressed over the canvas.
- Settings (Tolerance, Mode, Rectangle, Grow) are remembered in the browser.
- Removed: the `Magic Wand Integrated` accordion, the Python script, single-click selection
  and the Contiguous option.
- Added unit tests (`node --test "tests/js/*.test.js"`), no dependencies.

### Before the canvas tool

- Works on `img2img -> Inpaint sketch` as well as `Inpaint`; sketch selections use the current sketch color.
- Wand clicks, Clear mask, and Invert mask now create a single undo step on the ForgeCanvas (Undo/Redo buttons and Ctrl+Z work).
- The mask is drawn straight onto the canvas instead of through an async data-URL round trip, so the Gradio mask can no longer be synced before the selection lands.
- Selections follow the canvas brush style: mask color, fixed mask opacity, and the high-contrast checker pattern.
- Shift+click adds to the selection and Alt+click subtracts, regardless of the Mode dropdown.
- Leaves an eraser extension's composite mode untouched.
- Added an in-canvas toolbar toggle beside `Center Position [R]` for enabling or disabling Magic Wand without scrolling to the accordion.

## 0.1.0

- Initial public release.
- Added `Magic Wand Integrated` img2img accordion for Forge / Neo Forge.
- Added browser-side color selection for the inpaint canvas.
- Added replace, add, subtract, and intersect mask modes.
- Added contiguous/global selection, tolerance, grow, clear, and invert controls.
