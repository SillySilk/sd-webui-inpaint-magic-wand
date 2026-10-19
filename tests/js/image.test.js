"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const IMW = require("./load");

function solid(w, h, r, g, b, a = 255) {
    const d = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) { d[i * 4] = r; d[i * 4 + 1] = g; d[i * 4 + 2] = b; d[i * 4 + 3] = a; }
    return d;
}

test("makeWork keeps small images at full size", () => {
    const wk = IMW.makeWork(solid(200, 100, 10, 20, 30), 200, 100);
    assert.equal(wk.width, 200);
    assert.equal(wk.height, 100);
    assert.equal(wk.scale, 1);
});

test("makeWork downscales the longest side to WORK_MAX", () => {
    const t0 = Date.now();
    const wk = IMW.makeWork(solid(4096, 2048, 90, 120, 200), 4096, 2048);
    const ms = Date.now() - t0;
    assert.equal(IMW.WORK_MAX, 640);
    assert.equal(wk.width, 640);
    assert.equal(wk.height, 320);
    assert.equal(wk.scale, 6.4);
    assert.ok(ms < 1500, "took " + ms + " ms");
});

test("Lab of pure white is about L=100, a=b=0", () => {
    const wk = IMW.makeWork(solid(4, 4, 255, 255, 255), 4, 4);
    assert.ok(Math.abs(wk.lab[0] - 100) < 0.5);
    assert.ok(Math.abs(wk.lab[1]) < 0.5);
    assert.ok(Math.abs(wk.lab[2]) < 0.5);
});

test("edges are strong on a hard boundary and weak in flat areas", () => {
    const w = 100, h = 60, d = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const v = x < 50 ? 0 : 255, o = (y * w + x) * 4;
        d[o] = d[o + 1] = d[o + 2] = v; d[o + 3] = 255;
    }
    const wk = IMW.makeWork(d, w, h);
    const y = 30;
    const atBoundary = Math.max(wk.edge[y * w + 49], wk.edge[y * w + 50]);
    assert.ok(atBoundary > 0.8, "boundary " + atBoundary);
    assert.ok(wk.edge[y * w + 30] < 0.05, "flat " + wk.edge[y * w + 30]);
    assert.ok(wk.edge[y * w + 70] < 0.05, "flat " + wk.edge[y * w + 70]);
});

test("transparent pixels are treated as black", () => {
    const wk = IMW.makeWork(solid(4, 4, 255, 255, 255, 0), 4, 4);
    assert.ok(wk.lab[0] < 1, "L=" + wk.lab[0]);
});

test("labDistance is the Euclidean Lab distance", () => {
    const lab = new Float32Array([0, 0, 0, 3, 4, 0]);
    assert.equal(IMW.labDistance(lab, 0, 1), 5);
});
