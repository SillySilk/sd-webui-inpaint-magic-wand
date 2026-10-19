"use strict";

// RGBA image: `colorsInside` ([r,g,b] list) as mottled diagonal stripes inside the disk, colorOutside elsewhere.
// `stripe` is the stripe width in px (default 3). colorOutside is an [r,g,b] (flat background) or a function (x, y) -> [r,g,b] (e.g. ringGradient).
function disk(w, h, cx, cy, r, colorsInside, colorOutside, stripe = 3) {
    const out = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const inside = (x - cx) * (x - cx) + (y - cy) * (y - cy) <= r * r;
            const c = inside
                ? colorsInside[(Math.floor((x + y) / stripe) + (x % 5 === 0 ? 1 : 0)) % colorsInside.length]
                : (typeof colorOutside === "function" ? colorOutside(x, y) : colorOutside);
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

// Background colour function for disk(): equals `atEdge` on the disk boundary and blends smoothly
// (linearly in RGB with distance from the boundary) to `atReach` at `reach` px outside it, then stays there.
function ringGradient(cx, cy, r, atEdge, atReach, reach) {
    return (x, y) => {
        const d = Math.sqrt((x - cx) * (x - cx) + (y - cy) * (y - cy)) - r;
        const t = Math.min(1, Math.max(0, d / reach));
        return [0, 1, 2].map((k) => Math.round(atEdge[k] + (atReach[k] - atEdge[k]) * t));
    };
}

// RGBA image of flat-coloured disks ("parts": [{cx, cy, r, color}], painted in order so later parts cover
// earlier ones) over `background`, a function (x, y) -> [r,g,b].
function figures(w, h, parts, background) {
    const out = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            let c = background(x, y);
            for (const p of parts) if ((x - p.cx) * (x - p.cx) + (y - p.cy) * (y - p.cy) <= p.r * p.r) c = p.color;
            const o = (y * w + x) * 4;
            out[o] = c[0]; out[o + 1] = c[1]; out[o + 2] = c[2]; out[o + 3] = 255;
        }
    }
    return out;
}

// Union of the parts' disks as a mask; parts listed in `minus` are cut out of it (occluders).
function partsMask(w, h, parts, minus = []) {
    const m = new Uint8Array(w * h);
    const hit = (p, x, y) => (x - p.cx) * (x - p.cx) + (y - p.cy) * (y - p.cy) <= p.r * p.r;
    for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++)
            if (parts.some((p) => hit(p, x, y)) && !minus.some((p) => hit(p, x, y))) m[y * w + x] = 255;
    return m;
}

// Textured background: diagonal stripes cycling through `colors`, each `period` px wide.
function stripes(colors, period) {
    return (x, y) => colors[Math.floor((x + y) / period) % colors.length];
}

module.exports = { disk, noise, iou, circleMask, ringGradient, figures, partsMask, stripes };
