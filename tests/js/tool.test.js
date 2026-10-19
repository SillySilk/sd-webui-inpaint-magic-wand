"use strict";
// UI test for imw_90_tool.js against a minimal fake DOM and ForgeCanvas (no dependencies).
// The fake 2D context models only what the tool uses: alpha-mask compositing (source-over,
// destination-in, destination-out, source-in), get/putImageData and clearRect.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

// --- fake DOM ------------------------------------------------------------------------------------

const byIdMap = new Map();

class ClassList {
    constructor() { this.s = new Set(); }
    add(c) { this.s.add(c); }
    remove(c) { this.s.delete(c); }
    toggle(c, on) { if (on === undefined) on = !this.s.has(c); if (on) this.s.add(c); else this.s.delete(c); return on; }
    contains(c) { return this.s.has(c); }
}

function dispatchTo(listeners, ev) {
    ev.stopped = false;
    ev.defaultPrevented = false;
    ev.preventDefault = () => { ev.defaultPrevented = true; };
    ev.stopImmediatePropagation = () => { ev.stopped = true; };
    ev.stopPropagation = () => { ev.stopped = true; };
    const ls = listeners[ev.type] || [];
    for (const l of ls.filter((x) => x.capture).concat(ls.filter((x) => !x.capture))) {
        if (ev.stopped) break;
        l.fn(ev);
    }
    return ev;
}

class El {
    constructor(tag) {
        this.tagName = tag.toUpperCase();
        this.style = {}; this.dataset = {}; this.classList = new ClassList();
        this.children = []; this.listeners = {}; this.attrs = {}; this.parent = null;
        this.hidden = false; this.textContent = ""; this.value = ""; this.checked = false;
        this.title = ""; this.type = ""; this.min = ""; this.max = ""; this.step = "";
        this.offsetHeight = 40; this.offsetParent = {};
    }
    set id(v) { this._id = v; byIdMap.set(v, this); }
    get id() { return this._id; }
    set className(v) { v.split(/\s+/).filter(Boolean).forEach((c) => this.classList.add(c)); }
    get className() { return [...this.classList.s].join(" "); }
    setAttribute(k, v) { this.attrs[k] = v; }
    append(c) {
        if (typeof c === "string") { const t = new El("#text"); t.textContent = c; c = t; }
        c.parent = this; this.children.push(c);
    }
    appendChild(c) { this.append(c); return c; }
    insertAdjacentElement(where, c) {
        const p = this.parent; c.parent = p; p.children.splice(p.children.indexOf(this) + 1, 0, c);
    }
    addEventListener(type, fn, capture) {
        (this.listeners[type] = this.listeners[type] || []).push({ fn, capture: capture === true });
    }
    dispatch(ev) { return dispatchTo(this.listeners, ev); }
    setPointerCapture(id) { if (this.failCapture) throw new Error("no capture"); this.cap = id; }
    releasePointerCapture() { this.cap = null; }
    hasPointerCapture(id) { return this.cap === id; }
    getBoundingClientRect() { return { left: 0, top: 0, width: this.width, height: this.height }; }
    getContext() { return this.ctx || (this.ctx = new Ctx(this)); }
}

let dataUrlCounter = 0;
class Canvas extends El {
    constructor() { super("canvas"); this._w = 1; this._h = 1; this.px = new Uint8ClampedArray(4); }
    set width(v) { this._w = v; this.px = new Uint8ClampedArray(this._w * this._h * 4); }
    get width() { return this._w; }
    set height(v) { this._h = v; this.px = new Uint8ClampedArray(this._w * this._h * 4); }
    get height() { return this._h; }
    toDataURL() { return `data:image/png;fake,${++dataUrlCounter}`; }
}

class Img extends El { constructor() { super("img"); } }

class Ctx {
    constructor(c) { this.c = c; this.globalCompositeOperation = "source-over"; this.globalAlpha = 1; this.stack = []; }
    save() { this.stack.push(this.globalCompositeOperation); }
    restore() { this.globalCompositeOperation = this.stack.pop(); }
    getImageData(x, y, w, h) { return { width: w, height: h, data: new Uint8ClampedArray(this.c.px) }; }
    putImageData(d) { this.c.px.set(d.data); }
    createImageData(w, h) { return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }; }
    clearRect() { this.c.px.fill(0); }
    drawImage(src) {
        const d = this.c.px, s = src.px;
        if (src instanceof Img) { d.set(s); return; }
        const op = this.globalCompositeOperation;
        for (let i = 0; i < d.length; i += 4) {
            const sa = s[i + 3];
            if (op === "source-over") { if (sa) { d[i] = s[i]; d[i + 1] = s[i + 1]; d[i + 2] = s[i + 2]; d[i + 3] = 255; } }
            else if (op === "destination-out") { if (sa) d[i + 3] = 0; }
            else if (op === "destination-in") { if (!sa) d[i + 3] = 0; }
            else if (op === "source-in") { d[i + 3] = d[i + 3] && sa ? 255 : 0; }
        }
    }
    fillRect() { const d = this.c.px; for (let i = 0; i < d.length; i += 4) if (d[i + 3]) { d[i] = 200; d[i + 1] = 10; d[i + 2] = 10; } }
    beginPath() {} moveTo() {} lineTo() {} stroke() {} strokeRect() {} setLineDash() {}
}

const windowListeners = {};
const store = {};
let uiLoaded = null;
global.window = globalThis;
global.addEventListener = (type, fn) => { (windowListeners[type] = windowListeners[type] || []).push({ fn, capture: false }); };
global.document = {
    createElement: (t) => (t === "canvas" ? new Canvas() : new El(t)),
    getElementById: (id) => byIdMap.get(id) || null,
    querySelector: (sel) => (sel.includes("logical_image_foreground") ? byIdMap.get("__fg") : null),
    listeners: {},
    addEventListener(type, fn, capture) {
        (this.listeners[type] = this.listeners[type] || []).push({ fn, capture: capture === true });
    },
};
const key = (type, k) => dispatchTo(document.listeners, { type, key: k, shiftKey: k === "Shift" });
global.localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = v; } };
global.onUiLoaded = (fn) => { uiLoaded = fn; };
global.requestAnimationFrame = (fn) => setTimeout(fn, 0);

const dir = path.join(__dirname, "..", "..", "javascript");
let IMW = null;
for (const f of fs.readdirSync(dir).filter((x) => /^imw_.*\.js$/.test(x)).sort()) IMW = require(path.join(dir, f));

// --- fake ForgeCanvas: 200x160 image, red disk r=40 at (100, 80) on a blue textured background ----

const W = 200, H = 160, DISK = Math.PI * 40 * 40;
let uuidCounter = 0;

function makeForge() {
    const U = `u${++uuidCounter}`;
    const block = new El("div"); block.id = "img2maskimg";
    const container = new El("div"); container.id = `container_${U}`;
    block.querySelector = () => container;
    const imageContainer = new El("div"); container.append(imageContainer);
    const image = new Img(); image.id = `image_${U}`;
    image.src = `data:image/png;img,${U}`; image.naturalWidth = W; image.naturalHeight = H;
    image.px = new Uint8ClampedArray(W * H * 4);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4, inside = (x - 100) ** 2 + (y - 80) ** 2 < 40 * 40;
        const n = ((x * 7 + y * 13) % 11) - 5;
        image.px[i] = inside ? 220 + n : 30 + n; image.px[i + 1] = inside ? 40 + n : 60 + n;
        image.px[i + 2] = inside ? 40 : 200 + n; image.px[i + 3] = 255;
    }
    const canvas = new Canvas(); canvas.id = `drawingCanvas_${U}`; canvas.width = W; canvas.height = H;
    imageContainer.append(image); imageContainer.append(canvas);
    const toolbar = new El("div"); toolbar.id = `toolbar_${U}`; imageContainer.append(toolbar);
    for (const b of ["centerButton_", "undoButton_", "redoButton_"]) { const e = new El("button"); e.id = b + U; toolbar.append(e); }
    const fg = new El("textarea"); fg.id = "__fg";
    const instance = {
        img: "data:a", scribbleWidth: "6", imgScale: 1, scribbleColor: "#ff0000", dragging: false,
        history: [canvas.toDataURL()], historyIndex: 0, saves: 0,
        saveState() {
            this.saves++;
            this.history = this.history.slice(0, this.historyIndex + 1);
            this.history.push(canvas.toDataURL());
            this.historyIndex++;
        },
        undo() { if (this.historyIndex > 0) this.historyIndex--; },
    };
    global.forgeCanvasInstances = Object.assign(global.forgeCanvasInstances || {}, { [U]: instance });
    uiLoaded();

    const strip = byIdMap.get(`imw_strip_${U}`);
    const control = (i) => strip.children[i].children.find((c) => c.tagName !== "#TEXT");
    const f = {
        U, container, imageContainer, image, canvas, toolbar, instance, strip,
        button: byIdMap.get(`imw_toolbar_toggle_${U}`),
        status: () => strip.children.find((c) => c.classList.contains("imw-status")).textContent,
        control,
        stripButton: (t) => strip.children.find((c) => c.tagName === "BUTTON" && c.textContent === t),
        alpha() { let n = 0; for (let i = 3; i < canvas.px.length; i += 4) if (canvas.px[i]) n++; return n; },
        ptr: (type, x, y, extra = {}) => canvas.dispatch(Object.assign({ type, clientX: x, clientY: y, button: 0, pointerId: 1, shiftKey: false, altKey: false }, extra)),
        setRect(on) { control(2).checked = on; control(2).dispatch({ type: "change" }); },
        on() { if (!f.strip.hidden) return; f.button.dispatch({ type: "click" }); },
        async drag(points, extra = {}) {
            f.ptr("pointerdown", points[0][0], points[0][1], extra);
            for (const p of points.slice(1, -1)) f.ptr("pointermove", p[0], p[1], extra);
            const last = points[points.length - 1];
            f.ptr("pointerup", last[0], last[1], extra);
            await wait();
        },
    };
    return f;
}

const wait = (ms = 40) => new Promise((r) => setTimeout(r, ms));
const BOX = [[50, 30], [120, 100], [150, 130]];

// --- tests ---------------------------------------------------------------------------------------

test("tool: button, strip, overlay and pass-through when off", () => {
    const f = makeForge();
    uiLoaded(); // setup is idempotent
    assert.ok(f.button);
    assert.strictEqual(f.toolbar.children.indexOf(f.button), 1, "button sits right after centerButton");
    assert.strictEqual(f.toolbar.children.filter((c) => c === f.button).length, 1);
    assert.ok(f.strip.hidden);
    assert.ok(!f.ptr("pointerdown", 100, 80).stopped, "off: Forge gets the pointer");
    f.on();
    assert.ok(!f.strip.hidden && f.container.classList.contains("imw-on"));
    assert.strictEqual(f.control(0).value, String(IMW.DEFAULT_TOLERANCE));
    assert.strictEqual(f.control(3).value, "2");
    const next = f.imageContainer.children[f.imageContainer.children.indexOf(f.canvas) + 1];
    assert.ok(next.classList.contains("imw-overlay"), "overlay is the drawing canvas's next sibling");
    assert.ok(!f.ptr("pointerdown", 100, 80, { button: 2 }).stopped, "right button passes");
    assert.ok(!f.ptr("pointermove", 110, 80, { button: 2 }).stopped, "idle move passes (pan)");
    f.button.dispatch({ type: "click" });
    assert.ok(f.strip.hidden && !f.ptr("pointerdown", 100, 80).stopped, "off again: passes");
});

test("tool: brush stroke selects the disk in one undo step; Alt subtracts", async () => {
    const f = makeForge();
    f.on(); f.setRect(false);
    const down = f.ptr("pointerdown", 95, 80);
    assert.ok(down.stopped && down.defaultPrevented);
    assert.ok(f.ptr("pointermove", 105, 80).stopped);
    assert.ok(f.ptr("pointerup", 105, 82).stopped);
    assert.strictEqual(f.status(), "Selecting…");
    await wait();
    assert.strictEqual(f.instance.saves, 1);
    assert.ok(f.alpha() > DISK * 0.85 && f.alpha() < DISK * 1.4, `alpha ${f.alpha()}`);
    assert.strictEqual(f.canvas.px[(80 * W + 100) * 4], 200, "painted in the brush style");
    await f.drag([[100, 80], [101, 80]], { altKey: true });
    assert.strictEqual(f.instance.saves, 2);
    assert.ok(f.alpha() < DISK * 0.2);
});

test("tool: over a wand canvas, Shift keydown stops before window listeners (eraser) and Alt is suppressed", () => {
    const f = makeForge();
    f.container.dispatch({ type: "pointerenter" });
    assert.ok(!key("keydown", "Shift").stopped, "wand off: the eraser extension still gets Shift");
    f.on();
    assert.ok(key("keydown", "Shift").stopped, "wand on, pointer over it: Shift keydown stops");
    assert.ok(!key("keyup", "Shift").stopped, "keyup always passes, so a started eraser can stop");
    assert.ok(!key("keydown", "E").stopped, "other keys pass");
    assert.ok(key("keydown", "Alt").defaultPrevented);
    f.container.dispatch({ type: "pointerleave" });
    assert.ok(!key("keydown", "Shift").stopped, "pointer elsewhere: passes");
    assert.ok(!key("keydown", "Alt").defaultPrevented);
    f.button.dispatch({ type: "click" });
});

test("tool: the strip hint follows Rectangle and a new picture", async () => {
    const f = makeForge();
    f.on(); f.setRect(false);
    assert.strictEqual(f.status(), "Brush over the subject");
    f.setRect(true);
    assert.strictEqual(f.status(), "Drag a box");
    f.setRect(false);
    await f.drag([[95, 80], [105, 80]]);
    assert.match(f.status(), /px$/, "a stroke leaves its pixel count");
    f.image.src = "data:image/png;img,another";
    f.image.dispatch({ type: "load" });
    assert.strictEqual(f.status(), "Brush over the subject");
    f.button.dispatch({ type: "click" });
});

test("tool: settings persist in imw.settings", () => {
    const f = makeForge();
    f.on(); f.setRect(true);
    assert.strictEqual(JSON.parse(store["imw.settings"]).rect, true);
    assert.ok(f.container.classList.contains("imw-rect"));
    f.setRect(false);
    assert.strictEqual(JSON.parse(store["imw.settings"]).rect, false);
});

test("tool: box then refinement, one undo step each", async () => {
    const f = makeForge();
    f.on(); f.setRect(true);
    await f.drag(BOX);
    assert.strictEqual(f.instance.saves, 1);
    assert.ok(f.alpha() > DISK * 0.8 && f.alpha() < DISK * 1.4, `alpha ${f.alpha()}`);
    const boxed = f.alpha();
    await f.drag([[70, 80], [90, 60], [90, 100]], { altKey: true });
    assert.strictEqual(f.instance.saves, 2);
    assert.ok(f.alpha() < boxed, "a background hint removes some of the cut");
    f.setRect(false);
});

test("tool: Invert ends the session, so a refinement cannot undo it", async () => {
    const f = makeForge();
    f.on(); f.setRect(true);
    await f.drag(BOX);
    f.stripButton("Invert").dispatch({ type: "click" });
    const inverted = Buffer.from(f.canvas.px);
    const saves = f.instance.saves;
    await f.drag([[100, 80], [101, 81]]); // inside the box: would refine if the session survived
    assert.strictEqual(f.status(), "Box too small", "drag is a fresh (tiny) box, not a refinement");
    assert.strictEqual(f.instance.saves, saves);
    assert.ok(Buffer.from(f.canvas.px).equals(inverted), "invert kept");
    f.setRect(false);
});

test("tool: an outside edit plus saveState expires the session", async () => {
    const f = makeForge();
    f.on(); f.setRect(true);
    await f.drag(BOX);
    // e.g. Forge's Ctrl+X reset or another extension: change pixels, then saveState
    f.canvas.px.fill(0);
    f.canvas.px[3] = 255;
    f.instance.saveState();
    const edited = Buffer.from(f.canvas.px);
    await f.drag([[100, 80], [101, 81]]);
    assert.strictEqual(f.status(), "Box too small", "starts fresh instead of refining");
    assert.ok(Buffer.from(f.canvas.px).equals(edited), "outside edit kept");
    // An undo moves the history head too.
    await f.drag(BOX);
    f.instance.undo();
    await f.drag([[100, 80], [101, 81]]);
    assert.strictEqual(f.status(), "Box too small");
    f.setRect(false);
});

test("tool: a failing refinement leaves canvas, history and session unchanged", async () => {
    const f = makeForge();
    f.on(); f.setRect(true);
    await f.drag(BOX);
    const px = Buffer.from(f.canvas.px);
    const saves = f.instance.saves, head = f.instance.history[f.instance.historyIndex];
    const realBox = IMW.boxSelect, realErr = console.error;
    let logged = 0;
    IMW.boxSelect = () => { throw new Error("boom"); };
    console.error = () => { logged++; };
    try {
        await f.drag([[70, 80], [90, 60], [90, 100]], { altKey: true });
    } finally {
        IMW.boxSelect = realBox; console.error = realErr;
    }
    assert.strictEqual(f.status(), "Selection failed");
    assert.ok(logged > 0);
    assert.ok(Buffer.from(f.canvas.px).equals(px), "canvas unchanged");
    assert.strictEqual(f.instance.saves, saves);
    assert.strictEqual(f.instance.history[f.instance.historyIndex], head);
    // Session still live and its hints untouched: the next refinement sees no bg hint.
    let hints = null;
    IMW.boxSelect = (work, rect, h, tol) => { hints = h; return realBox(work, rect, h, tol); };
    try {
        await f.drag([[100, 80], [102, 82]]);
    } finally {
        IMW.boxSelect = realBox;
    }
    assert.ok(hints, "refined (session survived)");
    assert.strictEqual(hints.bg, null, "failed stroke's bg hint was not kept");
    assert.ok(hints.fg && hints.fg.some((v) => v), "this stroke's fg hint is there");
    assert.strictEqual(f.instance.saves, saves + 1);
    f.setRect(false);
});

test("tool: turning the wand off while computing does not paint", async () => {
    const f = makeForge();
    f.on(); f.setRect(false);
    f.ptr("pointerdown", 95, 80);
    f.ptr("pointerup", 105, 80);
    f.button.dispatch({ type: "click" }); // off before the deferred computation runs
    await wait();
    assert.strictEqual(f.instance.saves, 0);
    assert.strictEqual(f.alpha(), 0);
    f.on();
    await f.drag([[95, 80], [105, 80]]);
    assert.strictEqual(f.instance.saves, 1, "works again after re-enabling");
});

test("tool: lost capture or a release elsewhere clears the stroke", async () => {
    const f = makeForge();
    f.on(); f.setRect(false);
    f.ptr("pointerdown", 95, 80);
    f.canvas.dispatch({ type: "lostpointercapture", pointerId: 1 });
    f.ptr("pointerup", 105, 80);
    await wait();
    assert.strictEqual(f.instance.saves, 0, "abandoned stroke does not select");
    f.canvas.failCapture = true;
    f.ptr("pointerdown", 95, 80);
    dispatchTo(windowListeners, { type: "pointerup", pointerId: 1 });
    assert.strictEqual(f.status(), "Stroke cancelled");
    f.canvas.failCapture = false;
    await f.drag([[95, 80], [105, 80]]);
    assert.strictEqual(f.instance.saves, 1, "next stroke is accepted");
});

test("tool: an idle move clears Forge's leftover grab cursor", () => {
    const f = makeForge();
    f.on();
    f.canvas.style.cursor = "grab";
    f.instance.dragging = true;
    f.ptr("pointermove", 50, 50, { button: -1 });
    assert.strictEqual(f.canvas.style.cursor, "grab", "left alone mid-pan");
    f.instance.dragging = false;
    f.ptr("pointermove", 50, 50, { button: -1 });
    assert.strictEqual(f.canvas.style.cursor, "");
});

test("tool: No image, Clear and Invert", async () => {
    const f = makeForge();
    f.on();
    f.instance.img = null;
    f.ptr("pointerdown", 100, 80); f.ptr("pointerup", 160, 120);
    assert.strictEqual(f.status(), "No image");
    f.instance.img = "data:a";
    f.stripButton("Invert").dispatch({ type: "click" });
    assert.strictEqual(f.instance.saves, 1);
    assert.strictEqual(f.alpha(), W * H);
    f.stripButton("Clear").dispatch({ type: "click" });
    assert.strictEqual(f.instance.saves, 2);
    assert.strictEqual(f.alpha(), 0);
});
