# Contributing

Thanks for helping improve Inpaint Magic Wand.

## Good First Issues

- Browser compatibility checks.
- Better keyboard shortcuts.
- Better mask edge refinement.
- Optional feather preview.
- Compatibility reports for different Forge / Neo Forge builds.

## Development Notes

The extension intentionally has no Python dependencies.

There is no Python script: Forge loads `javascript/*.js` and `style.css` on its own. The
files load in name order. `imw_10` to `imw_50` are pure selection code (work image, mask
clean-up, brush, max-flow, box cut) with no DOM access. `imw_90_tool.js` wires them to
Forge's `ForgeCanvas`: the toolbar button, the strip, the drag overlay, and painting the
result onto the drawing canvas with one `saveState()` per action.

Please avoid adding model downloads or server-side image processing unless the feature
has a clear reason to stop being lightweight.

## Testing Checklist

- `node --test "tests/js/*.test.js"` passes.
- The extension loads without console errors.
- The wand button appears after `Center Position [R]` on `Inpaint` and `Inpaint sketch`.
- With the wand off, Forge's brush paints normally.
- Brush strokes and boxes select the subject; Shift adds, Alt subtracts.
- Replace, add, subtract, and intersect all modify the current mask as expected.
- Clear and Invert affect the mask; every action is one undo step.
- The drag overlay stays on the image after panning and zooming.
