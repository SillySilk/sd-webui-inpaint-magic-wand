(function () {
    "use strict";

    const PANEL_ID = "inpaint_magic_wand_panel";
    const INPAINT_CANVAS_ELEM_ID = "img2maskimg";

    function app() {
        if (typeof gradioApp === "function") return gradioApp();
        return document;
    }

    function byId(id) {
        return app().getElementById(id);
    }

    function setStatus(message, kind = "") {
        const status = byId("imw_status");
        if (!status) return;
        status.textContent = message;
        status.dataset.kind = kind;
    }

    function numberValue(id, fallback) {
        const node = byId(id);
        const value = node ? Number(node.value) : NaN;
        return Number.isFinite(value) ? value : fallback;
    }

    function checkboxValue(id, fallback) {
        const node = byId(id);
        return node ? node.checked : fallback;
    }

    function selectValue(id, fallback) {
        const node = byId(id);
        return node ? node.value : fallback;
    }

    function config() {
        return {
            enabled: checkboxValue("imw_enabled", false),
            mode: selectValue("imw_mode", "replace"),
            contiguous: checkboxValue("imw_contiguous", true),
            tolerance: numberValue("imw_tolerance", 32),
            grow: numberValue("imw_grow", 2),
        };
    }

    function cssEscape(value) {
        if (window.CSS && typeof window.CSS.escape === "function") {
            return window.CSS.escape(value);
        }
        return value.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
    }

    function setTextareaValue(textarea, value) {
        textarea.value = value;
        const event = new Event("input", { bubbles: true });
        Object.defineProperty(event, "target", { value: textarea });
        textarea.dispatchEvent(event);
    }

    function getInpaintForgeCanvas() {
        const block = byId(INPAINT_CANVAS_ELEM_ID);
        if (!block) return null;

        const container = block.querySelector(".forge-container[id^='container_']");
        if (!container) return null;

        const uuid = container.id.replace(/^container_/, "");
        const image = app().getElementById(`image_${uuid}`);
        const drawingCanvas = app().getElementById(`drawingCanvas_${uuid}`);
        const foreground = app().querySelector(
            `#${cssEscape(uuid)}.logical_image_foreground textarea`,
        );

        if (!image || !drawingCanvas || !foreground) return null;

        return { uuid, container, image, drawingCanvas, foreground };
    }

    function syncToolbarButton(info) {
        const button = app().getElementById(`imw_toolbar_toggle_${info.uuid}`);
        if (!button) return;

        const enabled = checkboxValue("imw_enabled", false);
        button.classList.toggle("imw-toolbar-wand-active", enabled);
        button.setAttribute("aria-pressed", enabled ? "true" : "false");
        button.title = enabled ? "Magic Wand: on" : "Magic Wand: off";
    }

    function setMagicWandEnabled(enabled) {
        const checkbox = byId("imw_enabled");
        if (checkbox) {
            checkbox.checked = enabled;
            checkbox.dispatchEvent(new Event("change", { bubbles: true }));
        } else {
            setStatus(enabled ? "Magic wand on" : "Magic wand off", enabled ? "ok" : "");
        }

        const info = getInpaintForgeCanvas();
        if (info) syncToolbarButton(info);
    }

    function toggleMagicWandFromToolbar(event) {
        event.preventDefault();
        event.stopPropagation();
        setMagicWandEnabled(!checkboxValue("imw_enabled", false));
    }

    function attachToolbarButton(info) {
        const centerButton = app().getElementById(`centerButton_${info.uuid}`);
        if (!centerButton || app().getElementById(`imw_toolbar_toggle_${info.uuid}`)) return;

        const button = document.createElement("button");
        button.id = `imw_toolbar_toggle_${info.uuid}`;
        button.type = "button";
        button.className = "forge-btn imw-toolbar-wand";
        button.textContent = "W";
        button.setAttribute("aria-label", "Toggle Magic Wand");
        button.addEventListener("click", toggleMagicWandFromToolbar);

        centerButton.insertAdjacentElement("afterend", button);
        syncToolbarButton(info);
    }

    function imagePixels(image, width, height) {
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        ctx.drawImage(image, 0, 0, width, height);
        return ctx.getImageData(0, 0, width, height);
    }

    function matches(data, pixelIndex, target, toleranceSq) {
        const offset = pixelIndex * 4;
        const dr = data[offset] - target[0];
        const dg = data[offset + 1] - target[1];
        const db = data[offset + 2] - target[2];
        return dr * dr + dg * dg + db * db <= toleranceSq;
    }

    function floodSelection(imageData, width, height, seedX, seedY, tolerance) {
        const total = width * height;
        const selected = new Uint8Array(total);
        const visited = new Uint8Array(total);
        const queue = new Int32Array(total);
        const seed = seedY * width + seedX;
        const data = imageData.data;
        const targetOffset = seed * 4;
        const target = [
            data[targetOffset],
            data[targetOffset + 1],
            data[targetOffset + 2],
        ];
        const toleranceSq = tolerance * tolerance * 3;
        let head = 0;
        let tail = 0;
        let count = 0;

        queue[tail++] = seed;
        visited[seed] = 1;

        while (head < tail) {
            const pixel = queue[head++];
            if (!matches(data, pixel, target, toleranceSq)) continue;

            selected[pixel] = 255;
            count++;

            const x = pixel % width;
            const y = Math.floor(pixel / width);
            const left = pixel - 1;
            const right = pixel + 1;
            const up = pixel - width;
            const down = pixel + width;

            if (x > 0 && !visited[left]) {
                visited[left] = 1;
                queue[tail++] = left;
            }
            if (x < width - 1 && !visited[right]) {
                visited[right] = 1;
                queue[tail++] = right;
            }
            if (y > 0 && !visited[up]) {
                visited[up] = 1;
                queue[tail++] = up;
            }
            if (y < height - 1 && !visited[down]) {
                visited[down] = 1;
                queue[tail++] = down;
            }
        }

        return { selected, count };
    }

    function globalSelection(imageData, width, height, seedX, seedY, tolerance) {
        const total = width * height;
        const selected = new Uint8Array(total);
        const data = imageData.data;
        const seed = seedY * width + seedX;
        const targetOffset = seed * 4;
        const target = [
            data[targetOffset],
            data[targetOffset + 1],
            data[targetOffset + 2],
        ];
        const toleranceSq = tolerance * tolerance * 3;
        let count = 0;

        for (let pixel = 0; pixel < total; pixel++) {
            if (!matches(data, pixel, target, toleranceSq)) continue;
            selected[pixel] = 255;
            count++;
        }

        return { selected, count };
    }

    function growSelection(mask, width, height, radius) {
        const steps = Math.max(0, Math.min(64, Math.round(radius)));
        if (steps === 0) return mask;

        let source = mask;
        let target = new Uint8Array(mask.length);

        for (let step = 0; step < steps; step++) {
            target.set(source);

            for (let y = 0; y < height; y++) {
                const row = y * width;
                for (let x = 0; x < width; x++) {
                    const pixel = row + x;
                    if (!source[pixel]) continue;

                    if (x > 0) target[pixel - 1] = 255;
                    if (x < width - 1) target[pixel + 1] = 255;
                    if (y > 0) target[pixel - width] = 255;
                    if (y < height - 1) target[pixel + width] = 255;
                    if (x > 0 && y > 0) target[pixel - width - 1] = 255;
                    if (x < width - 1 && y > 0) target[pixel - width + 1] = 255;
                    if (x > 0 && y < height - 1) target[pixel + width - 1] = 255;
                    if (x < width - 1 && y < height - 1) target[pixel + width + 1] = 255;
                }
            }

            const swap = source;
            source = target;
            target = swap;
            target.fill(0);
        }

        return source;
    }

    function maskDataUrl(info, selection, mode) {
        const width = info.drawingCanvas.width;
        const height = info.drawingCanvas.height;
        const currentCtx = info.drawingCanvas.getContext("2d", {
            willReadFrequently: true,
        });
        const current = currentCtx.getImageData(0, 0, width, height).data;
        const outCanvas = document.createElement("canvas");
        outCanvas.width = width;
        outCanvas.height = height;
        const outCtx = outCanvas.getContext("2d");
        const out = outCtx.createImageData(width, height);

        for (let pixel = 0; pixel < selection.length; pixel++) {
            const offset = pixel * 4;
            const oldAlpha = current[offset + 3];
            const selected = selection[pixel] ? 255 : 0;
            let alpha = selected;

            if (mode === "add") {
                alpha = Math.max(oldAlpha, selected);
            } else if (mode === "subtract") {
                alpha = selected ? 0 : oldAlpha;
            } else if (mode === "intersect") {
                alpha = oldAlpha && selected ? oldAlpha : 0;
            }

            out.data[offset] = 255;
            out.data[offset + 1] = 255;
            out.data[offset + 2] = 255;
            out.data[offset + 3] = alpha;
        }

        outCtx.putImageData(out, 0, 0);
        return outCanvas.toDataURL("image/png");
    }

    function transparentMaskDataUrl(width, height) {
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        return canvas.toDataURL("image/png");
    }

    function invertMaskDataUrl(info) {
        const width = info.drawingCanvas.width;
        const height = info.drawingCanvas.height;
        const currentCtx = info.drawingCanvas.getContext("2d", {
            willReadFrequently: true,
        });
        const current = currentCtx.getImageData(0, 0, width, height).data;
        const outCanvas = document.createElement("canvas");
        outCanvas.width = width;
        outCanvas.height = height;
        const outCtx = outCanvas.getContext("2d");
        const out = outCtx.createImageData(width, height);

        for (let pixel = 0; pixel < width * height; pixel++) {
            const offset = pixel * 4;
            const alpha = current[offset + 3] > 128 ? 0 : 255;
            out.data[offset] = 255;
            out.data[offset + 1] = 255;
            out.data[offset + 2] = 255;
            out.data[offset + 3] = alpha;
        }

        outCtx.putImageData(out, 0, 0);
        return outCanvas.toDataURL("image/png");
    }

    function writeForeground(info, dataUrl) {
        const image = new Image();
        image.onload = () => {
            const ctx = info.drawingCanvas.getContext("2d");
            ctx.clearRect(0, 0, info.drawingCanvas.width, info.drawingCanvas.height);
            ctx.drawImage(image, 0, 0);
        };
        image.src = dataUrl;
        setTextareaValue(info.foreground, dataUrl);
    }

    function clickToImagePixel(info, event) {
        const rect = info.drawingCanvas.getBoundingClientRect();
        if (!rect.width || !rect.height) return null;

        const x = Math.floor((event.clientX - rect.left) * info.drawingCanvas.width / rect.width);
        const y = Math.floor((event.clientY - rect.top) * info.drawingCanvas.height / rect.height);

        if (x < 0 || y < 0 || x >= info.drawingCanvas.width || y >= info.drawingCanvas.height) {
            return null;
        }

        return { x, y };
    }

    function runSelection(event) {
        const cfg = config();
        if (!cfg.enabled || event.button !== 0) return;

        const info = getInpaintForgeCanvas();
        if (!info || !info.image.src) {
            setStatus("No inpaint image", "warn");
            return;
        }

        const point = clickToImagePixel(info, event);
        if (!point) return;

        event.preventDefault();
        event.stopImmediatePropagation();

        try {
            const width = info.drawingCanvas.width;
            const height = info.drawingCanvas.height;
            const pixels = imagePixels(info.image, width, height);
            const result = cfg.contiguous
                ? floodSelection(pixels, width, height, point.x, point.y, cfg.tolerance)
                : globalSelection(pixels, width, height, point.x, point.y, cfg.tolerance);
            const grown = growSelection(result.selected, width, height, cfg.grow);
            const dataUrl = maskDataUrl(info, grown, cfg.mode);

            writeForeground(info, dataUrl);
            setStatus(`${result.count.toLocaleString()} pixels`, result.count ? "ok" : "warn");
        } catch (error) {
            console.error("Magic Wand Integrated failed", error);
            setStatus("Selection failed", "error");
        }
    }

    function clearMask() {
        const info = getInpaintForgeCanvas();
        if (!info) {
            setStatus("No inpaint canvas", "warn");
            return;
        }
        writeForeground(info, transparentMaskDataUrl(info.drawingCanvas.width, info.drawingCanvas.height));
        setStatus("Mask cleared", "ok");
    }

    function invertMask() {
        const info = getInpaintForgeCanvas();
        if (!info || !info.image.src) {
            setStatus("No inpaint image", "warn");
            return;
        }
        writeForeground(info, invertMaskDataUrl(info));
        setStatus("Mask inverted", "ok");
    }

    function attachCanvas() {
        const info = getInpaintForgeCanvas();
        if (!info) return;

        attachToolbarButton(info);

        if (info.drawingCanvas.dataset.imwAttached === "true") {
            syncToolbarButton(info);
            return;
        }

        info.drawingCanvas.addEventListener("pointerdown", runSelection, true);
        info.drawingCanvas.dataset.imwAttached = "true";
    }

    function attachPanel() {
        const panel = byId(PANEL_ID);
        if (!panel || panel.dataset.imwAttached === "true") return;

        const tolerance = byId("imw_tolerance");
        const grow = byId("imw_grow");
        const enabled = byId("imw_enabled");
        const clear = byId("imw_clear");
        const invert = byId("imw_invert");

        function bindRange(input, outputId) {
            const output = byId(outputId);
            if (!input || !output) return;
            const update = () => {
                output.textContent = input.value;
            };
            input.addEventListener("input", update);
            update();
        }

        bindRange(tolerance, "imw_tolerance_value");
        bindRange(grow, "imw_grow_value");

        if (enabled) {
            enabled.addEventListener("change", () => {
                setStatus(enabled.checked ? "Click inpaint image" : "Idle", enabled.checked ? "ok" : "");
                const info = getInpaintForgeCanvas();
                if (info) syncToolbarButton(info);
            });
        }
        if (clear) clear.addEventListener("click", clearMask);
        if (invert) invert.addEventListener("click", invertMask);

        panel.dataset.imwAttached = "true";
    }

    function setup() {
        attachPanel();
        attachCanvas();
    }

    if (typeof onUiLoaded === "function") onUiLoaded(setup);
    if (typeof onAfterUiUpdate === "function") onAfterUiUpdate(setup);
    window.setTimeout(setup, 1000);
})();
