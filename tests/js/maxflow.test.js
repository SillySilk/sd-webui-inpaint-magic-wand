"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const IMW = require("./load");

function grid(w, h) {
    const n = w * h;
    return {
        source: new Float32Array(n), sink: new Float32Array(n),
        right: new Float32Array(n), down: new Float32Array(n),
        diagR: new Float32Array(n), diagL: new Float32Array(n),
    };
}
function run(w, h, g) { return IMW.gridMaxflow(w, h, g.source, g.sink, g.right, g.down, g.diagR, g.diagL); }

test("maxflow cuts a 2x1 grid at the weak link", () => {
    const g = grid(2, 1);
    g.source[0] = 5; g.sink[1] = 5; g.right[0] = 1;
    assert.deepEqual(Array.from(run(2, 1, g)), [1, 0]);
});

test("maxflow follows a weak column", () => {
    const w = 20, h = 10, g = grid(w, h);
    // Links touching column 10 are weak; every other link is strong.
    const weak = (xa, xb) => xa === 10 || xb === 10;
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const i = y * w + x;
            if (x === 0) g.source[i] = 100;
            if (x === w - 1) g.sink[i] = 100;
            if (x + 1 < w) g.right[i] = weak(x, x + 1) ? 0.1 : 10;
            if (y + 1 < h) g.down[i] = 10;
            if (x + 1 < w && y + 1 < h) g.diagR[i] = weak(x, x + 1) ? 0.1 : 10;
            if (x - 1 >= 0 && y + 1 < h) g.diagL[i] = weak(x, x - 1) ? 0.1 : 10;
        }
    }
    const lab = run(w, h, g);
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            if (x < 10) assert.equal(lab[y * w + x], 1, "(" + x + "," + y + ")");
            if (x > 10) assert.equal(lab[y * w + x], 0, "(" + x + "," + y + ")");
        }
    }
});

test("maxflow matches a brute-force minimum cut on small random grids", () => {
    let s = 12345;
    const rnd = () => { s = (Math.imul(s, 1103515245) + 12345) >>> 0; return s / 4294967296; };
    for (let trial = 0; trial < 40; trial++) {
        const w = 4, h = 4, n = w * h, g = grid(w, h);
        for (let i = 0; i < n; i++) {
            const x = i % w, y = (i - x) / w;
            g.source[i] = rnd() < 0.5 ? rnd() * 10 : 0;
            g.sink[i] = rnd() < 0.5 ? rnd() * 10 : 0;
            if (x + 1 < w) g.right[i] = rnd() * 5;
            if (y + 1 < h) g.down[i] = rnd() * 5;
            if (x + 1 < w && y + 1 < h) g.diagR[i] = rnd() * 5;
            if (x > 0 && y + 1 < h) g.diagL[i] = rnd() * 5;
        }
        const cost = (lab) => {
            let c = 0;
            for (let i = 0; i < n; i++) {
                c += lab[i] ? g.sink[i] : g.source[i];
                const x = i % w;
                if (x + 1 < w && lab[i] !== lab[i + 1]) c += g.right[i];
                if (i + w < n && lab[i] !== lab[i + w]) c += g.down[i];
                if (x + 1 < w && i + w < n && lab[i] !== lab[i + w + 1]) c += g.diagR[i];
                if (x > 0 && i + w < n && lab[i] !== lab[i + w - 1]) c += g.diagL[i];
            }
            return c;
        };
        let best = Infinity;
        for (let m = 0; m < (1 << n); m++) {
            const lab = []; for (let i = 0; i < n; i++) lab.push((m >> i) & 1);
            best = Math.min(best, cost(lab));
        }
        const got = cost(Array.from(run(w, h, g)));
        assert.ok(Math.abs(got - best) < 1e-4, "trial " + trial + ": " + got + " vs " + best);
    }
});

test("maxflow rejects arrays of the wrong size", () => {
    const g = grid(4, 4);
    assert.throws(() => IMW.gridMaxflow(4, 4, g.source, new Float32Array(3), g.right, g.down, g.diagR, g.diagL), RangeError);
});
