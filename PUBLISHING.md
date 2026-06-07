# Publishing Checklist

## Create The GitHub Repository

1. Create a public GitHub repository named `sd-webui-inpaint-magic-wand`.
2. Push this folder as the repository root.
3. Confirm the GitHub URLs in `README.md` and
   `docs/extension-index-entry.example.json`.
4. Add a short repository description:

   ```text
   Lightweight magic-wand selector for Forge / Neo Forge img2img inpaint masks.
   ```

5. Suggested topics:

   ```text
   stable-diffusion, stable-diffusion-webui, stable-diffusion-webui-forge, forge, neo-forge, img2img, inpaint, masking, gradio4
   ```

## Verify Install From URL

After pushing, install from the WebUI with:

```text
https://github.com/gcmdnt90/sd-webui-inpaint-magic-wand.git
```

Restart the WebUI and check:

- `Magic Wand Integrated` appears in `img2img`.
- It does not appear in `txt2img`.
- Click selection works in `img2img -> Inpaint`.

## Submit To The A1111 Extension Index

The official extension index is:

```text
https://github.com/AUTOMATIC1111/stable-diffusion-webui-extensions
```

That repository asks extension authors to target the `extensions` branch, copy
`extension_template.json`, fill it in, place it in the `extensions` directory, and
open a pull request.

Use `docs/extension-index-entry.example.json` as the starting material.

## Share With Forge Users

Forge has a community extension list discussion:

```text
https://github.com/lllyasviel/stable-diffusion-webui-forge/discussions/1754
```

Suggested post:

```text
Extension: Inpaint Magic Wand
URL: https://github.com/gcmdnt90/sd-webui-inpaint-magic-wand
Desc: Lightweight magic-wand selector for Forge / Neo Forge img2img inpaint masks. No model downloads, no extra tab, writes directly into the native inpaint canvas.
```

## Optional Release Notes

Suggested first release title:

```text
v0.1.0 - Initial public release
```

Suggested release body:

```text
Initial public release of Inpaint Magic Wand.

- Adds a Magic Wand Integrated accordion to img2img.
- Selects inpaint masks directly on the Forge / Neo Forge inpaint canvas.
- Supports replace, add, subtract, intersect, contiguous/global selection, tolerance, grow, clear, and invert.
- Runs in the browser with no model downloads or Python dependencies.
```
