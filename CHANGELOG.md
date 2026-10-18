# Changelog

## Unreleased

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
