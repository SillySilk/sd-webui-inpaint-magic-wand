"use strict";

// RGBA image: `colorsInside` ([r,g,b] list) as mottled diagonal stripes inside the disk, flat colorOutside elsewhere.
function disk(w, h, cx, cy, r, colorsInside, colorOutside) {
    const out = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const inside = (x - cx) * (x - cx) + (y - cy) * (y - cy) <= r * r;
            const c = inside
                ? colorsInside[(Math.floor((x + y) / 3) + (x % 5 === 0 ? 1 : 0)) % colorsInside.length]
                : colorOutside;
            const o = (y * w + x) * 4;
            out[o] = c[0]; out[o + 1] = c[1]; out[o + 2] = c[2]; out[o + 3] = 255;
        }
    }
    return out;
}

// Deterministic (mulberry32) uniform noise of +-amount added to RGB channels, in place.
function noise(rgba, amount, seed) {
    let s = seed >>> 0;
    const rnd = () => {
        s = (s + 0x6D2B79F5) >>> 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    for (let i = 0; i < rgba.length; i += 4) {
        for (let k = 0; k < 3; k++) rgba[i + k] += (rnd() * 2 - 1) * amount;
    }
    return rgba;
}

function iou(a, b) {
    let inter = 0, union = 0;
    for (let i = 0; i < a.length; i++) {
        const x = a[i] > 0, y = b[i] > 0;
        if (x && y) inter++;
        if (x || y) union++;
    }
    return union === 0 ? 1 : inter / union;
}

function circleMask(w, h, cx, cy, r) {
    const m = new Uint8Array(w * h);
    for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++)
            if ((x - cx) * (x - cx) + (y - cy) * (y - cy) <= r * r) m[y * w + x] = 255;
    return m;
}

module.exports = { disk, noise, iou, circleMask };
