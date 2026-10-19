(function (root) {
    "use strict";
    const IMW = root.IMW = root.IMW || {};

    // Label connected components of pixels where (mask[i] > 0) === fg. Calls visit(pixels, touchesBorder).
    function components(mask, w, h, fg, eight, visit) {
        const seen = new Uint8Array(w * h);
        const stack = new Int32Array(w * h);
        for (let s = 0; s < w * h; s++) {
            if (seen[s] || (mask[s] > 0) !== fg) continue;
            let sp = 0, n = 0, border = false;
            stack[sp++] = s; seen[s] = 1;
            const pix = [];
            while (sp > 0) {
                const p = stack[--sp];
                pix.push(p); n++;
                const x = p % w, y = (p - x) / w;
                if (x === 0 || y === 0 || x === w - 1 || y === h - 1) border = true;
                for (let dy = -1; dy <= 1; dy++) {
                    for (let dx = -1; dx <= 1; dx++) {
                        if ((dx === 0 && dy === 0) || (!eight && dx !== 0 && dy !== 0)) continue;
                        const nx = x + dx, ny = y + dy;
                        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
                        const q = ny * w + nx;
                        if (seen[q] || (mask[q] > 0) !== fg) continue;
                        seen[q] = 1; stack[sp++] = q;
                    }
                }
            }
            visit(pix, border);
        }
    }

    function majority3(mask, w, h) {
        const out = new Uint8Array(w * h);
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                let on = 0, n = 0;
                for (let dy = -1; dy <= 1; dy++) {
                    const ny = y + dy;
                    if (ny < 0 || ny >= h) continue;
                    for (let dx = -1; dx <= 1; dx++) {
                        const nx = x + dx;
                        if (nx < 0 || nx >= w) continue;
                        n++;
                        if (mask[ny * w + nx] > 0) on++;
                    }
                }
                out[y * w + x] = on * 2 > n ? 255 : 0;
            }
        }
        return out;
    }

    function cleanMask(mask, w, h) {
        const limit = Math.max(16, 0.001 * w * h);
        const out = new Uint8Array(w * h);
        for (let i = 0; i < out.length; i++) out[i] = mask[i] > 0 ? 255 : 0;
        // Fill enclosed background regions that are small (4-connected background).
        components(out, w, h, false, false, (pix, border) => {
            if (!border && pix.length < limit) for (const p of pix) out[p] = 255;
        });
        // Drop small foreground islands (8-connected foreground).
        components(out, w, h, true, true, (pix) => {
            if (pix.length < limit) for (const p of pix) out[p] = 0;
        });
        return majority3(majority3(out, w, h), w, h);
    }

    // 1D squared distance transform (Felzenszwalb & Huttenlocher).
    function edt1d(f, n, d, v, z) {
        let k = 0;
        v[0] = 0; z[0] = -Infinity; z[1] = Infinity;
        for (let q = 1; q < n; q++) {
            let s;
            for (;;) {
                const p = v[k];
                s = ((f[q] + q * q) - (f[p] + p * p)) / (2 * q - 2 * p);
                if (s <= z[k] && k > 0) k--; else break;
            }
            if (s <= z[k]) { v[k] = q; z[k] = -Infinity; z[k + 1] = Infinity; continue; }
            k++;
            v[k] = q; z[k] = s; z[k + 1] = Infinity;
        }
        k = 0;
        for (let q = 0; q < n; q++) {
            while (z[k + 1] < q) k++;
            d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
        }
    }

    function growMask(mask, w, h, radius) {
        if (!(radius > 0)) return mask;
        const INF = 1e12;
        const grid = new Float64Array(w * h);
        let any = false;
        for (let i = 0; i < grid.length; i++) {
            if (mask[i] > 0) { grid[i] = 0; any = true; } else grid[i] = INF;
        }
        if (!any) return new Uint8Array(w * h);
        const m = Math.max(w, h);
        const f = new Float64Array(m), d = new Float64Array(m);
        const v = new Int32Array(m), z = new Float64Array(m + 1);
        for (let x = 0; x < w; x++) {
            for (let y = 0; y < h; y++) f[y] = grid[y * w + x];
            edt1d(f, h, d, v, z);
            for (let y = 0; y < h; y++) grid[y * w + x] = d[y];
        }
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) f[x] = grid[y * w + x];
            edt1d(f, w, d, v, z);
            for (let x = 0; x < w; x++) grid[y * w + x] = d[x];
        }
        const r2 = radius * radius + 1e-6;
        const out = new Uint8Array(w * h);
        for (let i = 0; i < out.length; i++) out[i] = grid[i] <= r2 ? 255 : 0;
        return out;
    }

    function upscaleMask(mask, w, h, outW, outH) {
        const out = new Uint8Array(outW * outH);
        const sx = w / outW, sy = h / outH;
        for (let y = 0; y < outH; y++) {
            const fy = Math.min(Math.max((y + 0.5) * sy - 0.5, 0), h - 1);
            const y0 = Math.floor(fy), y1 = Math.min(y0 + 1, h - 1), ty = fy - y0;
            for (let x = 0; x < outW; x++) {
                const fx = Math.min(Math.max((x + 0.5) * sx - 0.5, 0), w - 1);
                const x0 = Math.floor(fx), x1 = Math.min(x0 + 1, w - 1), tx = fx - x0;
                const a = mask[y0 * w + x0] > 0 ? 1 : 0, b = mask[y0 * w + x1] > 0 ? 1 : 0;
                const c = mask[y1 * w + x0] > 0 ? 1 : 0, e = mask[y1 * w + x1] > 0 ? 1 : 0;
                const val = (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + e * tx) * ty;
                out[y * outW + x] = val >= 0.5 ? 255 : 0;
            }
        }
        return out;
    }

    function clipRect(rect, w, h) {
        const x0 = Math.max(0, rect.x), y0 = Math.max(0, rect.y);
        const x1 = Math.min(w, rect.x + rect.w), y1 = Math.min(h, rect.y + rect.h);
        const cw = x1 - x0, ch = y1 - y0;
        if (cw < 4 || ch < 4) return null;
        return { x: x0, y: y0, w: cw, h: ch };
    }

    IMW.cleanMask = cleanMask;
    IMW.growMask = growMask;
    IMW.upscaleMask = upscaleMask;
    IMW.clipRect = clipRect;
    if (typeof module !== "undefined") module.exports = IMW;
})(typeof window !== "undefined" ? window : globalThis);
