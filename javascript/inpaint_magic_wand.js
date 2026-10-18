(function () {
    "use strict";

    const PANEL_ID = "inpaint_magic_wand_panel";
    // img2img -> Inpaint (mask) and img2img -> Inpaint sketch (colored mask)
    const CANVAS_ELEM_IDS = ["img2maskimg", "inpaint_sketch"];

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

    function getForgeCanvas(elemId) {
        const block = byId(elemId);
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

        return { elemId, uuid, container, image, drawingCanvas, foreground };
    }

    // ForgeCanvas builds that register themselves expose saveState() (undo
    // history + Gradio sync) and the brush color; older builds fall back to
    // writing the foreground textarea directly. Looked up on every use because
    // the instances are created after this script first attaches.
    function canvasInstance(info) {
        return (window.forgeCanvasInstances || {})[info.uuid] || null;
    }

    function getForgeCanvases() {
        return CANVAS_ELEM_IDS.map(getForgeCanvas).filter(Boolean);
    }

    function getVisibleForgeCanvas() {
        const canvases = getForgeCanvases();
        return canvases.find((info) => info.container.offsetParent !== null) || canvases[0] || null;
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

        getForgeCanvases().forEach(syncToolbarButton);
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

    function selectionCanvas(selection, width, height) {
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        const out = ctx.createImageData(width, height);

        for (let pixel = 0; pixel < selection.length; pixel++) {
            if (!selection[pixel]) continue;
            const offset = pixel * 4;
            out.data[offset] = 255;
            out.data[offset + 1] = 255;
            out.data[offset + 2] = 255;
            out.data[offset + 3] = 255;
        }

        ctx.putImageData(out, 0, 0);
        return canvas;
    }

    // Paint the selection in the canvas's own brush style, so an Inpaint
    // sketch selection gets the sketch color and a high-contrast inpaint mask
    // gets the checker pattern, exactly like a brush stroke would.
    function paintSelection(info, maskCanvas) {
        const canvas = document.createElement("canvas");
        canvas.width = maskCanvas.width;
        canvas.height = maskCanvas.height;
        const ctx = canvas.getContext("2d");
        const instance = canvasInstance(info);

        ctx.drawImage(maskCanvas, 0, 0);
        ctx.globalCompositeOperation = "source-in";
        if (instance && instance.contrast_scribbles && instance.contrast_pattern) {
            ctx.fillStyle = instance.contrast_pattern;
        } else {
            ctx.fillStyle = (instance && instance.scribbleColor) || "#ffffff";
        }
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        return canvas;
    }

    function applySelection(info, selection, mode) {
        const width = info.drawingCanvas.width;
        const height = info.drawingCanvas.height;
        const maskCanvas = selectionCanvas(selection, width, height);
        const ctx = info.drawingCanvas.getContext("2d");

        // save/restore keeps an eraser extension's composite mode intact
        ctx.save();
        ctx.globalAlpha = 1.0;
        if (mode === "subtract") {
            ctx.globalCompositeOperation = "destination-out";
            ctx.drawImage(maskCanvas, 0, 0);
        } else if (mode === "intersect") {
            ctx.globalCompositeOperation = "destination-in";
            ctx.drawImage(maskCanvas, 0, 0);
        } else {
            if (mode !== "add") ctx.clearRect(0, 0, width, height);
            ctx.globalCompositeOperation = "source-over";
            ctx.drawImage(paintSelection(info, maskCanvas), 0, 0);
        }
        ctx.restore();

        commitDrawing(info);
    }

    function clearDrawing(info) {
        const ctx = info.drawingCanvas.getContext("2d");
        ctx.clearRect(0, 0, info.drawingCanvas.width, info.drawingCanvas.height);
        commitDrawing(info);
    }

    function invertDrawing(info) {
        const width = info.drawingCanvas.width;
        const height = info.drawingCanvas.height;
        const ctx = info.drawingCanvas.getContext("2d", { willReadFrequently: true });
        const current = ctx.getImageData(0, 0, width, height).data;
        const inverted = new Uint8Array(width * height);

        for (let pixel = 0; pixel < inverted.length; pixel++) {
            inverted[pixel] = current[pixel * 4 + 3] > 128 ? 0 : 255;
        }

        applySelection(info, inverted, "replace");
    }

    // Push an undo step and sync the Gradio foreground in one go. Without the
    // ForgeCanvas instance, fall back to writing the textarea directly.
    function commitDrawing(info) {
        const instance = canvasInstance(info);
        if (instance && instance.scribbleAlphaFixed && !instance.contrast_scribbles) {
            info.drawingCanvas.style.opacity = instance.scribbleAlpha / 100.0;
        }
        if (instance && typeof instance.saveState === "function") {
            instance.saveState();
            return;
        }
        setTextareaValue(info.foreground, info.drawingCanvas.toDataURL("image/png"));
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

    // Shift+click adds and Alt+click subtracts, like Photoshop's wand.
    function selectionMode(cfg, event) {
        if (event.altKey) return "subtract";
        if (event.shiftKey) return "add";
        return cfg.mode;
    }

    function runSelection(info, event) {
        const cfg = config();
        if (!cfg.enabled || event.button !== 0) return;

        if (!info.image.src || !info.image.naturalWidth) {
            setStatus("No inpaint image", "warn");
            return;
        }

        const point = clickToImagePixel(info, event);
        if (!point) return;

        event.preventDefault();
        event.stopImmediatePropagation();
        // The canvas saves an undo step on pointerup; commitDrawing already did.
        info.swallowPointerUp = true;

        try {
            const width = info.drawingCanvas.width;
            const height = info.drawingCanvas.height;
            const pixels = imagePixels(info.image, width, height);
            const result = cfg.contiguous
                ? floodSelection(pixels, width, height, point.x, point.y, cfg.tolerance)
                : globalSelection(pixels, width, height, point.x, point.y, cfg.tolerance);
            const grown = growSelection(result.selected, width, height, cfg.grow);

            applySelection(info, grown, selectionMode(cfg, event));
            setStatus(`${result.count.toLocaleString()} pixels`, result.count ? "ok" : "warn");
        } catch (error) {
            console.error("Magic Wand Integrated failed", error);
            setStatus("Selection failed", "error");
        }
    }

    function swallowPointerUp(info, event) {
        if (!info.swallowPointerUp) return;
        info.swallowPointerUp = false;
        event.stopImmediatePropagation();
    }

    function clearMask() {
        const info = getVisibleForgeCanvas();
        if (!info) {
            setStatus("No inpaint canvas", "warn");
            return;
        }
        clearDrawing(info);
        setStatus("Mask cleared", "ok");
    }

    function invertMask() {
        const info = getVisibleForgeCanvas();
        if (!info || !info.image.src) {
            setStatus("No inpaint image", "warn");
            return;
        }
        invertDrawing(info);
        setStatus("Mask inverted", "ok");
    }

    function attachCanvas(info) {
        attachToolbarButton(info);

        if (info.drawingCanvas.dataset.imwAttached === "true") {
            syncToolbarButton(info);
            return;
        }

        info.drawingCanvas.addEventListener("pointerdown", (event) => runSelection(info, event), true);
        info.drawingCanvas.addEventListener("pointerup", (event) => swallowPointerUp(info, event), true);
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
                getForgeCanvases().forEach(syncToolbarButton);
            });
        }
        if (clear) clear.addEventListener("click", clearMask);
        if (invert) invert.addEventListener("click", invertMask);

        panel.dataset.imwAttached = "true";
    }

    function setup() {
        attachPanel();
        getForgeCanvases().forEach(attachCanvas);
    }

    if (typeof onUiLoaded === "function") onUiLoaded(setup);
    if (typeof onAfterUiUpdate === "function") onAfterUiUpdate(setup);
    window.setTimeout(setup, 1000);
})();
