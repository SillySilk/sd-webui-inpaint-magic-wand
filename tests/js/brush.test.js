"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const IMW = require("./load");
const { disk, noise, iou, circleMask, ringGradient } = require("./fixtures");

// A "person": skin, shirt and hair colours as stripes inside the disk.
const SKIN = [210, 160, 130], SHIRT = [40, 70, 170], HAIR = [70, 45, 30];
const INSIDE = [SKIN, SHIRT, HAIR];
const GREEN = [90, 200, 90];
const W = 320, H = 240, CX = 160, CY = 120, R = 80;

function workOf(rgba, w, h) { return IMW.makeWork(noise(rgba, 6, 7), w, h); }
function count(m) { let n = 0; for (let i = 0; i < m.length; i++) if (m[i]) n++; return n; }
// Horizontal stroke through the centre, crossing all three diagonal stripes.
function centreStroke(radius) {
    return IMW.strokeSeeds([{ x: CX - 40, y: CY }, { x: CX + 40, y: CY + 0.5 }], radius, W, H);
}

test("tolerance presets", () => {
    assert.deepEqual(IMW.TOLERANCES, [10, 20, 30, 40, 50, 60, 70, 80]);
    assert.equal(IMW.DEFAULT_TOLERANCE, 40);
});

test("strokeSeeds paints a clipped polyline of the given radius", () => {
    const m = IMW.strokeSeeds([{ x: 10, y: 10 }, { x: 30.5, y: 10 }], 3, 40, 20);
    assert.equal(m.length, 800);
    assert.equal(m[10 * 40 + 20], 255);
    assert.equal(m[10 * 40 + 5], 0);
    assert.equal(m[17 * 40 + 20], 0);
    const dot = IMW.strokeSeeds([{ x: 5.2, y: 5.7 }], 0, 40, 20);
    assert.equal(count(dot), 1);
    assert.equal(count(IMW.strokeSeeds([{ x: -50, y: -50 }, { x: -40, y: -60 }], 3, 40, 20)), 0);
    assert.equal(count(IMW.strokeSeeds([], 3, 40, 20)), 0);
});

test("a stroke across a multi-colour disk selects the whole disk", () => {
    const wk = workOf(disk(W, H, CX, CY, R, INSIDE, GREEN), W, H);
    const m = IMW.brushSelect(wk, centreStroke(6), IMW.DEFAULT_TOLERANCE);
    const score = iou(m, circleMask(W, H, CX, CY, R));
    assert.ok(score >= 0.93, "IoU " + score.toFixed(3));
});

test("it does not leak through a strong edge into a similar background", () => {
    // Background is GREEN at the disk edge and reaches the SKIN colour 40 px outside it.
    const wk = workOf(disk(W, H, CX, CY, R, INSIDE, ringGradient(CX, CY, R, GREEN, SKIN, 40)), W, H);
    const m = IMW.brushSelect(wk, centreStroke(6), 40);
    const inside = circleMask(W, H, CX, CY, R);
    let outside = 0;
    for (let i = 0; i < m.length; i++) if (m[i] && !inside[i]) outside++;
    assert.ok(outside < 0.01 * W * H, "outside " + outside);
    assert.ok(iou(m, inside) >= 0.9, "IoU " + iou(m, inside).toFixed(3));
});

// Flat background a few dE from SKIN, touching the disk: SKIN + 15 per channel is dE 5.5.
const LOOKALIKE = SKIN.map((v) => v + 15);
function leakAndIoU(m, cx, cy, r) {
    const inside = circleMask(W, H, cx, cy, r);
    let outside = 0;
    for (let i = 0; i < m.length; i++) if (m[i] && !inside[i]) outside++;
    return { leak: outside / (W * H), score: iou(m, inside) };
}

test("it does not flood a look-alike background that touches the subject", () => {
    for (const off of [10, 15, 20]) { // dE 3.7, 5.5, 7.3
        const wk = workOf(disk(W, H, CX, CY, R, INSIDE, SKIN.map((v) => v + off)), W, H);
        const { leak, score } = leakAndIoU(IMW.brushSelect(wk, centreStroke(6), 40), CX, CY, R);
        assert.ok(leak < 0.02, "+" + off + " leak " + (100 * leak).toFixed(1) + "%");
        assert.ok(score >= 0.9, "+" + off + " IoU " + score.toFixed(3));
    }
});

test("wide stripes: the whole disk is selected and a look-alike background leaks little", () => {
    const flat = workOf(disk(W, H, CX, CY, R, INSIDE, GREEN, 12), W, H);
    const a = leakAndIoU(IMW.brushSelect(flat, centreStroke(6), 40), CX, CY, R);
    assert.ok(a.score >= 0.93, "flat IoU " + a.score.toFixed(3));
    // Pinned limit: a flat look-alike area inside the subject removes the neighbourhood cue (measured 2.1%).
    const look = workOf(disk(W, H, CX, CY, R, INSIDE, LOOKALIKE, 12), W, H);
    const b = leakAndIoU(IMW.brushSelect(look, centreStroke(6), 40), CX, CY, R);
    assert.ok(b.leak < 0.03, "look-alike leak " + (100 * b.leak).toFixed(1) + "%");
    assert.ok(b.score >= 0.9, "look-alike IoU " + b.score.toFixed(3));
});

test("low tolerance selects less than high tolerance", () => {
    const wk = workOf(disk(W, H, CX, CY, R, INSIDE, GREEN), W, H);
    const seeds = centreStroke(6);
    const lo = count(IMW.brushSelect(wk, seeds, 10));
    const hi = count(IMW.brushSelect(wk, seeds, 80));
    assert.ok(lo > 0, "lo " + lo);
    assert.ok(lo <= hi, lo + " > " + hi);
});

test("a stroke partly outside the image is clipped", () => {
    // Disk cut off by the right edge; the stroke runs past the edge.
    const cx = 290, cy = 120, r = 60;
    const wk = workOf(disk(W, H, cx, cy, r, INSIDE, GREEN), W, H);
    let seeds;
    assert.doesNotThrow(() => {
        seeds = IMW.strokeSeeds([{ x: 250, y: cy }, { x: 330, y: cy }, { x: 420.7, y: cy - 3 }], 6, W, H);
    });
    const m = IMW.brushSelect(wk, seeds, IMW.DEFAULT_TOLERANCE);
    const score = iou(m, circleMask(W, H, cx, cy, r));
    assert.ok(score >= 0.9, "IoU " + score.toFixed(3));
});

test("no seeds gives an empty mask", () => {
    const wk = workOf(disk(W, H, CX, CY, R, INSIDE, GREEN), W, H);
    const m = IMW.brushSelect(wk, new Uint8Array(W * H), 40);
    assert.equal(m.length, W * H);
    assert.equal(count(m), 0);
});

test("a selection at 640 px takes under 300 ms", () => {
    const w = 640, h = 480, cx = 320, cy = 240, r = 160;
    const wk = workOf(disk(w, h, cx, cy, r, INSIDE, ringGradient(cx, cy, r, GREEN, SKIN, 80)), w, h);
    const seeds = IMW.strokeSeeds([{ x: cx - 80, y: cy }, { x: cx + 80, y: cy + 1 }], 12, w, h);
    IMW.brushSelect(wk, seeds, 40); // warm up the JIT
    for (const tol of [10, 40, 80]) {
        const t0 = process.hrtime.bigint();
        const m = IMW.brushSelect(wk, seeds, tol);
        const ms = Number(process.hrtime.bigint() - t0) / 1e6;
        console.log("brushSelect 640x480 tol " + tol + ": " + ms.toFixed(1) + " ms, " + count(m) + " px");
        assert.ok(ms < 300, "tol " + tol + " took " + ms.toFixed(1) + " ms");
    }
    // Worst case: the stroke also covers the background, so the growth floods the whole image.
    const flood = workOf(disk(w, h, cx, cy, r, INSIDE, GREEN), w, h);
    const both = IMW.strokeSeeds([{ x: cx - 80, y: cy }, { x: w + 20, y: cy }], 12, w, h);
    const t0 = process.hrtime.bigint();
    const m = IMW.brushSelect(flood, both, 80);
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    console.log("brushSelect 640x480 flood tol 80: " + ms.toFixed(1) + " ms, " + count(m) + " px");
    assert.ok(ms < 300, "flood took " + ms.toFixed(1) + " ms");
});

test("a tolerance that is not a positive number throws", () => {
    const wk = workOf(disk(W, H, CX, CY, R, INSIDE, GREEN), W, H);
    assert.throws(() => IMW.brushSelect(wk, centreStroke(6), 0), RangeError);
    assert.throws(() => IMW.brushSelect(wk, centreStroke(6), NaN), RangeError);
});
