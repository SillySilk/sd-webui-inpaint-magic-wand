// Canvas wand tool: wires the pure IMW selection modules to Forge Neo's ForgeCanvas.
// A toolbar button toggles the tool per canvas; while on, a floating strip holds the settings,
// left-button drags on the drawing canvas become brush strokes or boxes, and each finished
// selection is painted onto the mask and committed as one ForgeCanvas undo step.
(function (root) {
    "use strict";
    const IMW = root.IMW = root.IMW || {};

    // Nothing below runs outside a browser: requiring this file in Node only returns IMW.
    if (typeof document === "undefined") {
        if (typeof module !== "undefined") module.exports = IMW;
        return;
    }

    // img2img -> Inpaint (mask) and img2img -> Inpaint sketch (coloured mask)
    const CANVAS_ELEM_IDS = ["img2maskimg", "inpaint_sketch"];
    const SETTINGS_KEY = "imw.settings";
    const MODES = [["replace", "Replace"], ["add", "Add"], ["subtract", "Subtract"], ["intersect", "Intersect"]];
    const GROW_MIN = 0, GROW_MAX = 64, GROW_DEFAULT = 2;
    const MIN_SEED_RADIUS = 2; // work px; 1-px dabs select nothing on fine textures
    const BRUSH_COLOUR = "rgba(240, 138, 36, 0.55)";

    const states = new WeakMap(); // drawingCanvas -> per-canvas tool state
    const allStates = new Set();

    // --- settings (shared by both canvases) ----------------------------------------------------

    function defaultSettings() {
        return { tolerance: IMW.DEFAULT_TOLERANCE, mode: "replace", rect: false, grow: GROW_DEFAULT };
    }

    function clampGrow(value) {
        const n = Math.round(Number(value));
        if (!Number.isFinite(n)) return GROW_DEFAULT;
        return Math.min(GROW_MAX, Math.max(GROW_MIN, n));
    }

    function normaliseSettings(raw) {
        const s = defaultSettings();
        if (!raw || typeof raw !== "object") return s;
        const tol = Number(raw.tolerance);
        if (IMW.TOLERANCES.indexOf(tol) !== -1) s.tolerance = tol;
        if (MODES.some((m) => m[0] === raw.mode)) s.mode = raw.mode;
        s.rect = raw.rect === true;
        if (raw.grow !== undefined) s.grow = clampGrow(raw.grow);
        return s;
    }

    function loadSettings() {
        try {
            const text = window.localStorage.getItem(SETTINGS_KEY);
            return normaliseSettings(text ? JSON.parse(text) : null);
        } catch (error) {
            return defaultSettings(); // storage unavailable: settings live for this page only
        }
    }

    function saveSettings() {
        try {
            window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
        } catch (error) {
            // storage unavailable: keep the in-memory settings
        }
    }

    const settings = loadSettings();

    // --- Forge canvas lookup ---------------------------------------------------------------------

    function app() {
        if (typeof gradioApp === "function") return gradioApp();
        return document;
    }

    function byId(id) {
        return app().getElementById(id);
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

    // --- mask painting (behaviour kept from the original wand) -----------------------------------

    function imagePixels(image, width, height) {
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        ctx.drawImage(image, 0, 0, width, height);
        return ctx.getImageData(0, 0, width, height);
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

    // Same mapping as clickToImagePixel, but sub-pixel and unclamped (a captured drag may leave the image).
    function canvasPoint(info, event) {
        const rect = info.drawingCanvas.getBoundingClientRect();
        if (!rect.width || !rect.height) return null;
        return {
            x: (event.clientX - rect.left) * info.drawingCanvas.width / rect.width,
            y: (event.clientY - rect.top) * info.drawingCanvas.height / rect.height,
        };
    }

    // --- strip status ------------------------------------------------------------------------------

    function setStatus(st, message, kind) {
        if (!st.status) return;
        st.status.textContent = message;
        st.status.dataset.kind = kind || "";
    }

    function fail(st, message, error) {
        console.error("Inpaint Magic Wand:", message, error);
        setStatus(st, message, "error");
    }

    // --- work image cache (one per image.src) ----------------------------------------------------

    function hasImage(info) {
        const instance = canvasInstance(info);
        if (instance && !instance.img) return false;
        return !!(info.image.src && info.image.naturalWidth && info.image.naturalHeight);
    }

    function getWork(st) {
        const image = st.info.image;
        const src = image.src;
        const w = image.naturalWidth, h = image.naturalHeight;
        const cache = st.workCache;
        if (cache && cache.src === src && cache.w === w && cache.h === h) return cache.work;
        const work = IMW.makeWork(imagePixels(image, w, h).data, w, h);
        st.workCache = { src, w, h, work };
        return work;
    }

    // Build the work image in the background so the first stroke on a new image is quick.
    function prebuildWork(st) {
        window.setTimeout(() => {
            if (!st.on || st.busy || !hasImage(st.info)) return;
            try {
                getWork(st);
            } catch (error) {
                fail(st, "Could not read image", error);
            }
        }, 0);
    }

    function onImageLoad(st) {
        // Forge re-assigns the same src on every pan/zoom redraw; only a new picture counts.
        const cache = st.workCache;
        if (cache && cache.src === st.info.image.src) return;
        st.workCache = null;
        endSession(st);
        if (st.on) prebuildWork(st);
    }

    // --- sessions ----------------------------------------------------------------------------------

    function endSession(st) {
        st.session = null;
    }

    function endAllSessions() {
        allStates.forEach(endSession);
    }

    // --- overlay -----------------------------------------------------------------------------------

    function syncOverlay(st) {
        const src = st.info.drawingCanvas, ov = st.overlay;
        if (!ov) return;
        ov.style.left = src.style.left;
        ov.style.top = src.style.top;
        ov.style.width = src.style.width;
        ov.style.height = src.style.height;
        ov.style.transform = src.style.transform;
        if (ov.width !== src.width) ov.width = src.width;
        if (ov.height !== src.height) ov.height = src.height;
    }

    function clearOverlay(st) {
        if (!st.overlay) return;
        st.overlay.getContext("2d").clearRect(0, 0, st.overlay.width, st.overlay.height);
        st.overlay.style.display = "none";
    }

    function drawOverlay(st) {
        const stroke = st.stroke;
        if (!stroke || !st.overlay) return;
        syncOverlay(st);
        const ov = st.overlay;
        ov.style.display = "block";
        const ctx = ov.getContext("2d");
        ctx.clearRect(0, 0, ov.width, ov.height);
        const instance = canvasInstance(st.info);
        const pxPerScreen = 1 / ((instance && Number(instance.imgScale)) || 1);

        if (stroke.kind === "box") {
            const a = stroke.points[0], b = stroke.points[stroke.points.length - 1];
            const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
            const w = Math.abs(b.x - a.x), h = Math.abs(b.y - a.y);
            ctx.lineWidth = 2 * pxPerScreen;
            ctx.setLineDash([8 * pxPerScreen, 6 * pxPerScreen]);
            ctx.strokeStyle = "rgba(0, 0, 0, 0.85)";
            ctx.lineDashOffset = 0;
            ctx.strokeRect(x, y, w, h);
            ctx.strokeStyle = "rgba(255, 255, 255, 0.95)";
            ctx.lineDashOffset = 7 * pxPerScreen;
            ctx.strokeRect(x, y, w, h);
            ctx.setLineDash([]);
            return;
        }

        const pts = stroke.points;
        ctx.lineWidth = scribbleWidth(st) * 2;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.strokeStyle = BRUSH_COLOUR;
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        if (pts.length === 1) ctx.lineTo(pts[0].x + 0.01, pts[0].y);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
        ctx.stroke();
    }

    // --- selection ---------------------------------------------------------------------------------

    function scribbleWidth(st) {
        const instance = canvasInstance(st.info);
        const w = instance ? Number(instance.scribbleWidth) : NaN;
        return Number.isFinite(w) && w > 0 ? w : 20;
    }

    // Shift forces Add and Alt forces Subtract for this stroke or box.
    function effectiveMode(stroke) {
        if (stroke.alt) return "subtract";
        if (stroke.shift) return "add";
        return settings.mode;
    }

    function toWork(st, work, p) {
        const c = st.info.drawingCanvas;
        return { x: p.x * work.width / c.width, y: p.y * work.height / c.height };
    }

    // Seed radius in work px from the Forge brush (canvas px), never below MIN_SEED_RADIUS.
    function seedRadius(st, work) {
        const c = st.info.drawingCanvas;
        return Math.max(MIN_SEED_RADIUS, scribbleWidth(st) * work.width / c.width);
    }

    function strokeMask(st, work, stroke) {
        const pts = stroke.points.map((p) => toWork(st, work, p));
        return IMW.strokeSeeds(pts, seedRadius(st, work), work.width, work.height);
    }

    // Upscale a work-size mask to the drawing canvas, grow it, and paint it with one undo step.
    function applyWorkMask(st, work, mask, mode) {
        const c = st.info.drawingCanvas;
        const up = IMW.upscaleMask(mask, work.width, work.height, c.width, c.height);
        const grown = IMW.growMask(up, c.width, c.height, settings.grow);
        applySelection(st.info, grown, mode);
        let count = 0;
        for (let i = 0; i < grown.length; i++) if (grown[i]) count++;
        setStatus(st, count ? `${count.toLocaleString()} px` : "Nothing selected", count ? "ok" : "warn");
    }

    function snapshot(st) {
        const c = st.info.drawingCanvas;
        return c.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, c.width, c.height);
    }

    function runBrush(st, work, stroke) {
        const seeds = strokeMask(st, work, stroke);
        const mask = IMW.brushSelect(work, seeds, settings.tolerance);
        applyWorkMask(st, work, mask, effectiveMode(stroke));
    }

    function runBox(st, work, stroke) {
        const a = toWork(st, work, stroke.points[0]);
        const b = toWork(st, work, stroke.points[stroke.points.length - 1]);
        const x0 = Math.min(a.x, b.x), y0 = Math.min(a.y, b.y);
        const rect = IMW.clipRect({ x: x0, y: y0, w: Math.max(a.x, b.x) - x0, h: Math.max(a.y, b.y) - y0 },
            work.width, work.height);
        if (!rect) {
            setStatus(st, "Box too small", "warn");
            return;
        }
        endSession(st);
        const mode = effectiveMode(stroke);
        st.session = { rect, fg: null, bg: null, before: snapshot(st), mode, work };
        const mask = IMW.boxSelect(work, rect, { fg: null, bg: null }, settings.tolerance);
        applyWorkMask(st, work, mask, mode);
    }

    function touchesRect(mask, w, rect) {
        for (let y = rect.y; y < rect.y + rect.h; y++)
            for (let x = rect.x; x < rect.x + rect.w; x++)
                if (mask[y * w + x]) return true;
        return false;
    }

    function runRefine(st, work, stroke) {
        const session = st.session;
        const c = st.info.drawingCanvas;
        if (!session || session.work !== work || session.before.width !== c.width || session.before.height !== c.height) {
            endSession(st);
            setStatus(st, "Box expired, draw a new one", "warn");
            return;
        }
        const seeds = strokeMask(st, work, stroke);
        const r = session.rect;
        const rect = { x: Math.floor(r.x), y: Math.floor(r.y), w: Math.ceil(r.x + r.w) - Math.floor(r.x), h: Math.ceil(r.y + r.h) - Math.floor(r.y) };
        if (!touchesRect(seeds, work.width, IMW.clipRect(rect, work.width, work.height) || rect)) {
            setStatus(st, "Stroke is outside the box", "warn");
            return;
        }
        const n = work.width * work.height;
        const toBg = effectiveMode(stroke) === "subtract";
        const add = toBg ? "bg" : "fg", other = toBg ? "fg" : "bg";
        if (!session[add]) session[add] = new Uint8Array(n);
        const into = session[add], from = session[other];
        for (let i = 0; i < n; i++) {
            if (!seeds[i]) continue;
            into[i] = 255;
            if (from) from[i] = 0; // the latest stroke wins where hints overlap
        }
        const mask = IMW.boxSelect(work, session.rect, { fg: session.fg, bg: session.bg }, settings.tolerance);
        c.getContext("2d").putImageData(session.before, 0, 0);
        applyWorkMask(st, work, mask, session.mode);
    }

    function runStroke(st, stroke) {
        if (!hasImage(st.info)) {
            setStatus(st, "No image", "warn");
            return;
        }
        const work = getWork(st);
        if (stroke.kind === "box") runBox(st, work, stroke);
        else if (stroke.kind === "refine") runRefine(st, work, stroke);
        else runBrush(st, work, stroke);
    }

    // Let the browser paint "Selecting…" once before the blocking computation.
    function afterPaint(callback) {
        const later = () => window.setTimeout(callback, 0);
        if (typeof window.requestAnimationFrame === "function") window.requestAnimationFrame(later);
        else later();
    }

    function finishStroke(st, stroke) {
        st.busy = true;
        setStatus(st, "Selecting…", "busy");
        afterPaint(() => {
            try {
                runStroke(st, stroke);
            } catch (error) {
                fail(st, "Selection failed", error);
            } finally {
                st.busy = false;
            }
        });
    }

    // --- pointer handling --------------------------------------------------------------------------

    // Does a refinement stroke start inside the session box (or within one brush radius of it)?
    function startsInSession(st, point) {
        const session = st.session;
        if (!session) return false;
        const work = session.work;
        const p = toWork(st, work, point), r = session.rect, pad = seedRadius(st, work);
        return p.x >= r.x - pad && p.x <= r.x + r.w + pad && p.y >= r.y - pad && p.y <= r.y + r.h + pad;
    }

    function onPointerDown(st, event) {
        if (!st.on || event.button !== 0) return; // right button pans, wheel zooms: never taken
        event.preventDefault(); // also suppresses the browser's Alt default
        event.stopImmediatePropagation();
        try {
            if (st.busy || st.stroke) return;
            if (!hasImage(st.info)) {
                setStatus(st, "No image", "warn");
                return;
            }
            if (!clickToImagePixel(st.info, event)) return;
            const point = canvasPoint(st.info, event);
            const kind = !settings.rect ? "brush" : startsInSession(st, point) ? "refine" : "box";
            st.stroke = { kind, points: [point], pointerId: event.pointerId, shift: event.shiftKey, alt: event.altKey };
            const canvas = st.info.drawingCanvas;
            if (canvas.style.cursor === "grab") canvas.style.cursor = "";
            try {
                canvas.setPointerCapture(event.pointerId);
            } catch (error) {
                // capture is a nicety; the stroke still works inside the canvas
            }
            st.info.container.classList.add("imw-stroking");
            drawOverlay(st);
        } catch (error) {
            st.stroke = null;
            fail(st, "Selection failed", error);
        }
    }

    function onPointerMove(st, event) {
        if (!st.on) return;
        try {
            syncOverlay(st);
            const stroke = st.stroke;
            if (!stroke || event.pointerId !== stroke.pointerId) return; // let Forge pan
            event.preventDefault();
            event.stopImmediatePropagation();
            const point = canvasPoint(st.info, event);
            if (!point) return;
            if (stroke.kind === "box") stroke.points[1] = point;
            else stroke.points.push(point);
            drawOverlay(st);
        } catch (error) {
            fail(st, "Selection failed", error);
        }
    }

    function endPointer(st, event) {
        const canvas = st.info.drawingCanvas;
        try {
            if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
        } catch (error) {
            // already released
        }
        st.info.container.classList.remove("imw-stroking");
        clearOverlay(st);
    }

    function onPointerUp(st, event) {
        const stroke = st.stroke;
        if (!stroke || event.pointerId !== stroke.pointerId) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        try {
            st.stroke = null;
            const point = canvasPoint(st.info, event);
            if (point) {
                if (stroke.kind === "box") stroke.points[1] = point;
                else stroke.points.push(point);
            }
            stroke.shift = stroke.shift || event.shiftKey;
            stroke.alt = stroke.alt || event.altKey;
            endPointer(st, event);
            finishStroke(st, stroke);
        } catch (error) {
            fail(st, "Selection failed", error);
        }
    }

    function onPointerCancel(st, event) {
        const stroke = st.stroke;
        if (!stroke || event.pointerId !== stroke.pointerId) return;
        event.stopImmediatePropagation();
        st.stroke = null;
        try {
            endPointer(st, event);
        } catch (error) {
            console.error("Inpaint Magic Wand:", error);
        }
    }

    // --- UI: toolbar button, strip, overlay --------------------------------------------------------

    function el(tag, props, children) {
        const node = document.createElement(tag);
        Object.keys(props || {}).forEach((k) => {
            if (k === "dataset") Object.assign(node.dataset, props[k]);
            else if (k in node) node[k] = props[k];
            else node.setAttribute(k, props[k]);
        });
        (children || []).forEach((c) => node.append(c));
        return node;
    }

    function syncStrip(st) {
        if (!st.controls) return;
        st.controls.tolerance.value = String(settings.tolerance);
        st.controls.mode.value = settings.mode;
        st.controls.rect.checked = settings.rect;
        st.controls.grow.value = String(settings.grow);
        st.info.container.classList.toggle("imw-rect", settings.rect);
    }

    function changeSetting(key, value) {
        const wasRect = settings.rect;
        settings[key] = value;
        saveSettings();
        if (wasRect && !settings.rect) endAllSessions();
        allStates.forEach(syncStrip);
    }

    function buildStrip(st) {
        const tolerance = el("select", { title: "How readily the selection crosses soft edges" },
            IMW.TOLERANCES.map((t) => el("option", { value: String(t), textContent: String(t) })));
        const mode = el("select", { title: "How a selection combines with the mask (Shift adds, Alt subtracts)" },
            MODES.map((m) => el("option", { value: m[0], textContent: m[1] })));
        const rect = el("input", { type: "checkbox", title: "Drag a box instead of brushing" });
        const grow = el("input", { type: "number", min: String(GROW_MIN), max: String(GROW_MAX), step: "1", title: "Grow the selection by this many pixels" });
        const clear = el("button", { type: "button", textContent: "Clear", title: "Clear the mask" });
        const invert = el("button", { type: "button", textContent: "Invert", title: "Invert the mask" });
        const status = el("span", { className: "imw-status", role: "status" });

        const strip = el("div", { id: `imw_strip_${st.info.uuid}`, className: "imw-strip" }, [
            el("label", {}, ["Tolerance", tolerance]),
            el("label", {}, ["Mode", mode]),
            el("label", { className: "imw-check" }, [rect, "Rectangle"]),
            el("label", {}, ["Grow", grow]),
            clear,
            invert,
            status,
        ]);
        strip.hidden = true;

        tolerance.addEventListener("change", () => changeSetting("tolerance", Number(tolerance.value)));
        mode.addEventListener("change", () => changeSetting("mode", mode.value));
        rect.addEventListener("change", () => changeSetting("rect", rect.checked));
        grow.addEventListener("change", () => changeSetting("grow", clampGrow(grow.value)));
        clear.addEventListener("click", () => {
            try {
                endSession(st);
                if (!hasImage(st.info)) {
                    setStatus(st, "No image", "warn");
                    return;
                }
                clearDrawing(st.info);
                setStatus(st, "Mask cleared", "ok");
            } catch (error) {
                fail(st, "Clear failed", error);
            }
        });
        invert.addEventListener("click", () => {
            try {
                if (!hasImage(st.info)) {
                    setStatus(st, "No image", "warn");
                    return;
                }
                invertDrawing(st.info);
                setStatus(st, "Mask inverted", "ok");
            } catch (error) {
                fail(st, "Invert failed", error);
            }
        });
        // Keep clicks, drags and the wheel on the strip away from Forge's pan, zoom and upload.
        ["pointerdown", "pointerup", "click", "dblclick", "wheel", "contextmenu"].forEach((type) =>
            strip.addEventListener(type, (e) => e.stopPropagation()));

        st.controls = { tolerance, mode, rect, grow };
        st.status = status;
        st.strip = strip;
        st.info.container.appendChild(strip);
        syncStrip(st);
    }

    // Top centre of the container, just under Forge's toolbar so neither covers the other.
    function positionStrip(st) {
        if (!st.strip) return;
        const toolbar = byId(`toolbar_${st.info.uuid}`);
        st.strip.style.top = `${(toolbar ? toolbar.offsetHeight : 0) + 6}px`;
    }

    function buildOverlay(st) {
        const overlay = el("canvas", { className: "imw-overlay", width: 1, height: 1 });
        overlay.setAttribute("aria-hidden", "true");
        st.info.drawingCanvas.insertAdjacentElement("afterend", overlay);
        st.overlay = overlay;
        syncOverlay(st);
        clearOverlay(st);
    }

    function syncToolbarButton(st) {
        const button = byId(`imw_toolbar_toggle_${st.info.uuid}`);
        if (!button) return;
        button.classList.toggle("imw-toolbar-wand-active", st.on);
        button.setAttribute("aria-pressed", st.on ? "true" : "false");
        button.title = st.on ? "Magic Wand: on" : "Magic Wand: off";
    }

    function setOn(st, on) {
        st.on = on;
        if (!on) {
            endSession(st);
            st.stroke = null;
            st.info.container.classList.remove("imw-stroking");
            clearOverlay(st);
        }
        st.info.container.classList.toggle("imw-on", on);
        if (st.strip) st.strip.hidden = !on;
        if (on) {
            positionStrip(st);
            setStatus(st, settings.rect ? "Drag a box" : "Brush over the subject", "");
            prebuildWork(st);
        }
        syncToolbarButton(st);
    }

    function attachToolbarButton(st) {
        const uuid = st.info.uuid;
        const centerButton = byId(`centerButton_${uuid}`);
        if (!centerButton) return;
        if (!byId(`imw_toolbar_toggle_${uuid}`)) {
            const button = el("button", {
                id: `imw_toolbar_toggle_${uuid}`,
                type: "button",
                className: "forge-btn imw-toolbar-wand",
                textContent: "\u{1FA84}",
            });
            button.setAttribute("aria-label", "Toggle Magic Wand");
            button.addEventListener("click", (event) => {
                event.preventDefault();
                event.stopPropagation();
                try {
                    setOn(st, !st.on);
                } catch (error) {
                    fail(st, "Magic Wand failed", error);
                }
            });
            centerButton.insertAdjacentElement("afterend", button);
        }
        syncToolbarButton(st);
    }

    function attachCanvas(info) {
        const existing = states.get(info.drawingCanvas);
        if (existing) {
            existing.info = info;
            attachToolbarButton(existing);
            return;
        }

        const st = { info, on: false, stroke: null, session: null, busy: false, workCache: null, pointerInside: false };
        states.set(info.drawingCanvas, st);
        allStates.forEach((other) => {
            if (other.info.uuid === info.uuid) allStates.delete(other); // canvas rebuilt under the same uuid
        });
        allStates.add(st);

        buildStrip(st);
        buildOverlay(st);
        attachToolbarButton(st);

        const canvas = info.drawingCanvas;
        canvas.addEventListener("pointerdown", (e) => onPointerDown(st, e), true);
        canvas.addEventListener("pointermove", (e) => onPointerMove(st, e), true);
        canvas.addEventListener("pointerup", (e) => onPointerUp(st, e), true);
        canvas.addEventListener("pointercancel", (e) => onPointerCancel(st, e), true);
        info.image.addEventListener("load", () => {
            try {
                onImageLoad(st);
            } catch (error) {
                console.error("Inpaint Magic Wand:", error);
            }
        });
        info.container.addEventListener("pointerenter", () => {
            st.pointerInside = true;
            if (st.on) positionStrip(st);
        });
        info.container.addEventListener("pointerleave", () => {
            st.pointerInside = false;
        });
        // Forge's undo restores pixels only, so a refinement session cannot survive it.
        ["undoButton_", "redoButton_"].forEach((prefix) => {
            const button = byId(prefix + info.uuid);
            if (button) button.addEventListener("click", () => endSession(st), true);
        });
        const toolbar = byId(`toolbar_${info.uuid}`);
        if (toolbar && typeof ResizeObserver === "function") {
            new ResizeObserver(() => positionStrip(st)).observe(toolbar);
        }
    }

    function onKey(event) {
        try {
            const key = (event.key || "").toLowerCase();
            if ((event.ctrlKey || event.metaKey) && (key === "z" || key === "y")) {
                allStates.forEach((st) => {
                    if (st.info.container.offsetParent !== null) endSession(st);
                });
            }
            if (event.key === "Alt") {
                allStates.forEach((st) => {
                    if (st.on && st.pointerInside) event.preventDefault();
                });
            }
        } catch (error) {
            console.error("Inpaint Magic Wand:", error);
        }
    }

    let keysAttached = false;

    function setup() {
        try {
            if (!keysAttached) {
                document.addEventListener("keydown", onKey, true);
                document.addEventListener("keyup", onKey, true);
                keysAttached = true;
            }
            getForgeCanvases().forEach(attachCanvas);
        } catch (error) {
            console.error("Inpaint Magic Wand: setup failed", error);
        }
    }

    if (typeof onUiLoaded === "function") onUiLoaded(setup);
    if (typeof onAfterUiUpdate === "function") onAfterUiUpdate(setup);
    window.setTimeout(setup, 1000);

    if (typeof module !== "undefined") module.exports = IMW;
})(typeof window !== "undefined" ? window : globalThis);
