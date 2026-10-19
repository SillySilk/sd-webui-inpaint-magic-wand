"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const IMW = require("./load");
const { iou } = require("./fixtures");

function square(w, h, x0, y0, s) {
    const m = new Uint8Array(w * h);
    for (let y = y0; y < y0 + s; y++) for (let x = x0; x < x0 + s; x++) m[y * w + x] = 255;
    return m;
}

test("cleanMask fills a pinhole", () => {
    const m = square(200, 200, 40, 40, 100);
    for (let y = 80; y < 82; y++) for (let x = 80; x < 82; x++) m[y * 200 + x] = 0;
    const out = IMW.cleanMask(m, 200, 200);
    for (let y = 45; y < 135; y++)
        for (let x = 45; x < 135; x++) assert.equal(out[y * 200 + x], 255, x + "," + y);
});

test("cleanMask removes a speck", () => {
    const m = square(200, 200, 40, 40, 100);
    for (let y = 180; y < 183; y++) for (let x = 10; x < 13; x++) m[y * 200 + x] = 255;
    const out = IMW.cleanMask(m, 200, 200);
    for (let y = 175; y < 190; y++) for (let x = 5; x < 20; x++) assert.equal(out[y * 200 + x], 0);
    assert.equal(out[90 * 200 + 90], 255);
});

test("cleanMask keeps a large enclosed hole", () => {
    const m = square(200, 200, 20, 20, 160);
    for (let y = 80; y < 120; y++) for (let x = 80; x < 120; x++) m[y * 200 + x] = 0;
    const out = IMW.cleanMask(m, 200, 200);
    assert.equal(out[100 * 200 + 100], 0);
});

test("growMask is round", () => {
    const w = 60, h = 60;
    const m = new Uint8Array(w * h);
    m[30 * w + 30] = 255;
    const out = IMW.growMask(m, w, h, 10);
    for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
            const d = Math.hypot(x - 30, y - 30);
            if (d <= 9.5) assert.equal(out[y * w + x], 255, x + "," + y);
            if (d > 10.5) assert.equal(out[y * w + x], 0, x + "," + y);
        }
});

test("growMask radius 0 is identity", () => {
    const m = square(40, 40, 10, 10, 8);
    const out = IMW.growMask(m, 40, 40, 0);
    assert.deepEqual(Array.from(out), Array.from(m));
});

test("upscaleMask doubles a square cleanly", () => {
    const m = square(50, 50, 20, 20, 10);
    const out = IMW.upscaleMask(m, 50, 50, 100, 100);
    assert.equal(out.length, 100 * 100);
    assert.ok(iou(out, square(100, 100, 40, 40, 20)) >= 0.95);
});

test("clipRect drops tiny and outside rects", () => {
    assert.equal(IMW.clipRect({ x: -50, y: -50, w: 20, h: 20 }, 100, 100), null);
    assert.equal(IMW.clipRect({ x: 10, y: 10, w: 3, h: 30 }, 100, 100), null);
    assert.deepEqual(IMW.clipRect({ x: -10, y: 5, w: 50, h: 50 }, 100, 100), { x: 0, y: 5, w: 40, h: 50 });
});
