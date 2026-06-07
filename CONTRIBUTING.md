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

The Python script creates the integrated accordion. The JavaScript reads the Forge
inpaint canvas, computes the selection in the browser, and writes the generated mask
back to the hidden Forge foreground image field.

Please avoid adding model downloads or server-side image processing unless the feature
has a clear reason to stop being lightweight.

## Testing Checklist

- The extension loads without startup errors.
- The accordion appears on `img2img` only.
- Selection works in `img2img -> Inpaint`.
- Replace, add, subtract, and intersect all modify the current mask as expected.
- Clear and invert affect the inpaint mask.
- Normal brush masking still works when click selection is disabled.
