"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const IMW = require("./load");
const { noise, iou, figures, partsMask, stripes } = require("./fixtures");

const SKIN = [210, 160, 130], SHIRT = [40, 70, 170];
const SKIN2 = [165, 115, 85], RED = [170, 40, 50];
// Textured background: mottled diagonal stripes of green and grey-blue.
const BACKGROUND = stripes([[90, 160, 80], [120, 130, 150], [70, 120, 70]], 7);
const W = 320, H = 240;

function count(m) { let n = 0; for (let i = 0; i < m.length; i++) if (m[i]) n++; return n; }
function workOf(parts, w, h) { return IMW.makeWork(noise(figures(w, h, parts, BACKGROUND), 8, 3), w, h); }
function timed(fn) {
    const t0 = process.hrtime.bigint();
    const out = fn();
    return { out, ms: Number(process.hrtime.bigint() - t0) / 1e6 };
}

// One figure: a head disk touching a body disk.
const HEAD = { cx: 160, cy: 65, r: 30, color: SKIN };
const BODY = { cx: 160, cy: 145, r: 55, color: SHIRT };

test("box around a two-tone figure selects it", () => {
    const parts = [HEAD, BODY];
    const wk = workOf(parts, W, H);
    // Figure spans x 105..215, y 35..200; 20 px margin.
    const rect = { x: 85, y: 15, w: 150, h: 205 };
    const { out: m, ms } = timed(() => IMW.boxSelect(wk, rect, { fg: null, bg: null }, IMW.DEFAULT_TOLERANCE));
    const score = iou(m, partsMask(W, H, parts));
    console.log("boxSelect 320x240 figure: IoU " + score.toFixed(3) + ", " + ms.toFixed(1) + " ms");
    assert.ok(score >= 0.9, "IoU " + score.toFixed(3));
    assert.ok(ms < 2000, ms.toFixed(1) + " ms");
    for (let y = 0; y < H; y++)
        for (let x = 0; x < W; x++)
            if (x < rect.x || y < rect.y || x >= rect.x + rect.w || y >= rect.y + rect.h)
                assert.equal(m[y * W + x], 0, "outside rect at " + x + "," + y);
});

test("a background hint separates two touching figures", () => {
    const left = [{ cx: 115, cy: 70, r: 28, color: SKIN }, { cx: 115, cy: 150, r: 50, color: SHIRT }];
    const right = [{ cx: 205, cy: 70, r: 28, color: SKIN2 }, { cx: 205, cy: 150, r: 50, color: RED }];
    const wk = workOf(left.concat(right), W, H);
    const leftMask = partsMask(W, H, left, right), rightMask = partsMask(W, H, right);
    const rect = { x: 45, y: 22, w: 230, h: 198 };

    const bg = IMW.strokeSeeds([{ x: 205, y: 55 }, { x: 205, y: 185 }], 4, W, H);
    const m = IMW.boxSelect(wk, rect, { fg: null, bg }, IMW.DEFAULT_TOLERANCE);
    let rightSel = 0;
    for (let i = 0; i < m.length; i++) if (m[i] && rightMask[i]) rightSel++;
    const frac = rightSel / count(rightMask), score = iou(m, leftMask);
    console.log("boxSelect two figures + bg hint: right " + (100 * frac).toFixed(1) + "%, left IoU " + score.toFixed(3));
    assert.ok(frac < 0.05, "right figure " + (100 * frac).toFixed(1) + "% selected");
    assert.ok(score >= 0.85, "left IoU " + score.toFixed(3));
});

test("a foreground hint is always kept", () => {
    const parts = [HEAD, BODY];
    const wk = workOf(parts, W, H);
    const fg = IMW.strokeSeeds([{ x: 100, y: 30 }, { x: 120, y: 30 }], 3, W, H); // on the background
    const m = IMW.boxSelect(wk, { x: 85, y: 15, w: 150, h: 205 }, { fg, bg: null }, IMW.DEFAULT_TOLERANCE);
    assert.equal(m[30 * W + 110], 255);
});

test("tiny or outside rect returns empty without throwing", () => {
    const wk = workOf([HEAD, BODY], W, H);
    for (const rect of [{ x: 5, y: 5, w: 2, h: 2 }, { x: W + 10, y: 10, w: 50, h: 50 }, { x: -100, y: -100, w: 50, h: 50 }]) {
        let m;
        assert.doesNotThrow(() => { m = IMW.boxSelect(wk, rect, { fg: null, bg: null }, 40); });
        assert.equal(m.length, W * H);
        assert.equal(count(m), 0);
    }
});

test("a rect dragged up and to the left works like the same rect dragged down-right", () => {
    const wk = workOf([HEAD, BODY], W, H);
    const a = IMW.boxSelect(wk, { x: 85, y: 15, w: 150, h: 205 }, { fg: null, bg: null }, 40);
    const b = IMW.boxSelect(wk, { x: 235, y: 220, w: -150, h: -205 }, { fg: null, bg: null }, 40);
    assert.deepEqual(b, a);
});

test("bad inputs throw", () => {
    const wk = workOf([HEAD, BODY], W, H);
    const rect = { x: 85, y: 15, w: 150, h: 205 };
    assert.throws(() => IMW.boxSelect(wk, rect, { fg: null, bg: null }, 0), RangeError);
    assert.throws(() => IMW.boxSelect(wk, rect, { fg: null, bg: null }, NaN), RangeError);
    assert.throws(() => IMW.boxSelect(wk, { x: NaN, y: 0, w: 10, h: 10 }, { fg: null, bg: null }, 40), RangeError);
    assert.throws(() => IMW.boxSelect(wk, rect, { fg: new Uint8Array(5), bg: null }, 40), RangeError);
    assert.throws(() => IMW.boxSelect(wk, rect, null, 40), TypeError);
});

test("box selection on a 640x480 work image finishes within 2 s", () => {
    const k = 2, w = W * k, h = H * k;
    const parts = [HEAD, BODY].map((p) => ({ cx: p.cx * k, cy: p.cy * k, r: p.r * k, color: p.color }));
    const wk = workOf(parts, w, h);
    const truth = partsMask(w, h, parts);
    IMW.boxSelect(wk, { x: 170, y: 30, w: 300, h: 410 }, { fg: null, bg: null }, 40); // warm up the JIT
    for (const rect of [{ x: 170, y: 30, w: 300, h: 410 }, { x: 0, y: 0, w: w, h: h }]) {
        const { out: m, ms } = timed(() => IMW.boxSelect(wk, rect, { fg: null, bg: null }, 40));
        console.log("boxSelect 640x480 rect " + rect.w + "x" + rect.h + ": IoU " + iou(m, truth).toFixed(3) + ", " + ms.toFixed(1) + " ms");
        assert.ok(ms < 2000, ms.toFixed(1) + " ms");
    }
    // Worst case for the max-flow: a full-frame box on pure noise (hundreds of thousands of short paths).
    const grey = new Uint8ClampedArray(w * h * 4).fill(128);
    for (let i = 3; i < grey.length; i += 4) grey[i] = 255;
    const noisy = IMW.makeWork(noise(grey, 120, 9), w, h);
    const { ms } = timed(() => IMW.boxSelect(noisy, { x: 0, y: 0, w: w, h: h }, { fg: null, bg: null }, 40));
    console.log("boxSelect 640x480 pure noise full frame: " + ms.toFixed(1) + " ms");
    assert.ok(ms < 2000, "noise " + ms.toFixed(1) + " ms");
});
