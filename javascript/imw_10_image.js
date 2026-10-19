(function (root) {
    "use strict";
    const IMW = root.IMW = root.IMW || {};

    const WORK_MAX = 640;

    // sRGB 0..255 -> linear light 0..1 lookup
    const LINEAR = new Float32Array(256);
    for (let i = 0; i < 256; i++) {
        const c = i / 255;
        LINEAR[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    }

    // D65 white point
    const XN = 0.95047, YN = 1.0, ZN = 1.08883;
    const EPS = 216 / 24389, KAPPA = 24389 / 27;
    function fLab(t) { return t > EPS ? Math.cbrt(t) : (KAPPA * t + 16) / 116; }

    // Box-filter downscale to (ww x wh), alpha-premultiplied onto black. Returns Float32Array RGB (0..255).
    function boxDownscale(rgba, w, h, ww, wh) {
        const out = new Float32Array(ww * wh * 3);
        const sx = w / ww, sy = h / wh;
        for (let y = 0; y < wh; y++) {
            const y0 = Math.floor(y * sy);
            const y1 = Math.min(h, Math.max(y0 + 1, Math.ceil((y + 1) * sy)));
            for (let x = 0; x < ww; x++) {
                const x0 = Math.floor(x * sx);
                const x1 = Math.min(w, Math.max(x0 + 1, Math.ceil((x + 1) * sx)));
                let r = 0, g = 0, b = 0;
                for (let yy = y0; yy < y1; yy++) {
                    let p = (yy * w + x0) * 4;
                    for (let xx = x0; xx < x1; xx++, p += 4) {
                        const a = rgba[p + 3] / 255;
                        r += rgba[p] * a; g += rgba[p + 1] * a; b += rgba[p + 2] * a;
                    }
                }
                const n = (y1 - y0) * (x1 - x0);
                const o = (y * ww + x) * 3;
                out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n;
            }
        }
        return out;
    }

    function toLab(rgb, count) {
        const lab = new Float32Array(count * 3);
        for (let i = 0; i < count; i++) {
            const r = LINEAR[Math.round(rgb[i * 3])];
            const g = LINEAR[Math.round(rgb[i * 3 + 1])];
            const b = LINEAR[Math.round(rgb[i * 3 + 2])];
            const x = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / XN;
            const y = (0.2126729 * r + 0.7151522 * g + 0.0721750 * b) / YN;
            const z = (0.0193339 * r + 0.1191920 * g + 0.9503041 * b) / ZN;
            const fx = fLab(x), fy = fLab(y), fz = fLab(z);
            lab[i * 3] = 116 * fy - 16;
            lab[i * 3 + 1] = 500 * (fx - fy);
            lab[i * 3 + 2] = 200 * (fy - fz);
        }
        return lab;
    }

    // Separable [1 2 1]/4 blur on 3-channel data, borders clamped.
    function blur3(src, w, h) {
        const tmp = new Float32Array(src.length);
        const out = new Float32Array(src.length);
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const l = (y * w + Math.max(0, x - 1)) * 3;
                const c = (y * w + x) * 3;
                const r = (y * w + Math.min(w - 1, x + 1)) * 3;
                for (let k = 0; k < 3; k++) tmp[c + k] = (src[l + k] + 2 * src[c + k] + src[r + k]) * 0.25;
            }
        }
        for (let y = 0; y < h; y++) {
            const yu = Math.max(0, y - 1), yd = Math.min(h - 1, y + 1);
            for (let x = 0; x < w; x++) {
                const u = (yu * w + x) * 3, c = (y * w + x) * 3, d = (yd * w + x) * 3;
                for (let k = 0; k < 3; k++) out[c + k] = (tmp[u + k] + 2 * tmp[c + k] + tmp[d + k]) * 0.25;
            }
        }
        return out;
    }

    // Sobel magnitude over L, a, b combined, normalised to 0..1 by the 99th percentile.
    function edgeMap(lab, w, h) {
        const s = blur3(lab, w, h);
        const mag = new Float32Array(w * h);
        for (let y = 0; y < h; y++) {
            const yu = Math.max(0, y - 1), yd = Math.min(h - 1, y + 1);
            for (let x = 0; x < w; x++) {
                const xl = Math.max(0, x - 1), xr = Math.min(w - 1, x + 1);
                let sum = 0;
                for (let k = 0; k < 3; k++) {
                    const tl = s[(yu * w + xl) * 3 + k], tc = s[(yu * w + x) * 3 + k], tr = s[(yu * w + xr) * 3 + k];
                    const ml = s[(y * w + xl) * 3 + k], mr = s[(y * w + xr) * 3 + k];
                    const bl = s[(yd * w + xl) * 3 + k], bc = s[(yd * w + x) * 3 + k], br = s[(yd * w + xr) * 3 + k];
                    const gx = (tr + 2 * mr + br) - (tl + 2 * ml + bl);
                    const gy = (bl + 2 * bc + br) - (tl + 2 * tc + tr);
                    sum += gx * gx + gy * gy;
                }
                mag[y * w + x] = Math.sqrt(sum);
            }
        }
        const sorted = Float32Array.from(mag).sort();
        let norm = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.99))];
        if (norm <= 1e-6) norm = sorted[sorted.length - 1];
        const edge = new Float32Array(w * h);
        if (norm > 1e-6) for (let i = 0; i < edge.length; i++) edge[i] = Math.min(1, mag[i] / norm);
        return edge;
    }

    function makeWork(rgba, width, height) {
        const k = Math.min(1, WORK_MAX / Math.max(width, height));
        const ww = Math.max(1, Math.round(width * k));
        const wh = Math.max(1, Math.round(height * k));
        const rgb = boxDownscale(rgba, width, height, ww, wh);
        const lab = toLab(rgb, ww * wh);
        return { width: ww, height: wh, lab, edge: edgeMap(lab, ww, wh), scale: width / ww };
    }

    function labDistance(lab, i, j) {
        const dl = lab[i * 3] - lab[j * 3];
        const da = lab[i * 3 + 1] - lab[j * 3 + 1];
        const db = lab[i * 3 + 2] - lab[j * 3 + 2];
        return Math.sqrt(dl * dl + da * da + db * db);
    }

    IMW.WORK_MAX = WORK_MAX;
    IMW.makeWork = makeWork;
    IMW.labDistance = labDistance;
    if (typeof module !== "undefined") module.exports = IMW;
})(typeof window !== "undefined" ? window : globalThis);
