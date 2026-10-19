(function (root) {
    "use strict";
    const IMW = root.IMW = root.IMW || {};

    // GrabCut-style box selection.
    //   1. Two Lab GMMs (COMPONENTS components, full covariance): foreground from the pixels inside the
    //      rect, background from a band BAND px wide around it (clipped to the image; when the box fills
    //      the whole image there is no band, and the inner-frame rule below covers it: the BAND px frame
    //      inside the rect starts as background).
    //   2. Data terms: negative log-likelihood under each GMM. Hints are hard: fg -> source HARD, bg -> sink HARD.
    //   3. Pairwise: gamma * exp(-beta * |dLab|^2) / dist, beta = 1 / (2 * mean |dLab|^2) over the rect's
    //      8-neighbour pairs, gamma = 50 * (1.5 - tolerance / 100). Rect pixels next to the outside also
    //      link to it as definite background.
    //   4. ITERATIONS rounds of (fit GMMs from the current labels, cut), then cleanMask; outside the rect is 0.
    //      Iteration stops early once a cut changes no label. Iteration 1 seeds each GMM by k-means;
    //      later ones assign each sample to its most likely component and refit (as in GrabCut).
    //
    // Constants are the brief's (5 components, band 16, 4 iterations, the beta and gamma formulas).
    // Additions and why:
    // - COV_FLOOR: a flat colour has zero covariance; 1 dE^2 (about one just-noticeable difference) keeps it
    //   invertible without blurring real colour differences.
    // - Rect sides that touch the image edge have no outside; when the rect is the whole image there is no
    //   background evidence at all, so the frame just inside it seeds the background model (a box drawn
    //   to the canvas edge still means "the subject is inside"). Those pixels are soft, not hard.
    // - Measured against OpenCV's grabCut (5 iterations) on a real 640x360 photo: same result where the
    //   box touches the image edge (the wall above a man's shoulders is selected by both; a bg stroke
    //   removes it), and less of a lamp kept inside a woman's box (530 vs 996 px). Changing BAND (32),
    //   ITERATIONS (10), COV_FLOOR (4) or gamma (x0.5) moved neither number by more than 2%, so the brief's
    //   values stay.
    const COMPONENTS = 5;
    const BAND = 16;
    const ITERATIONS = 4;
    const HARD = 1e9;
    const COV_FLOOR = 1.0;      // added to each covariance diagonal (Lab units^2): a flat or noiseless colour would otherwise be singular
    const FIT_SAMPLES = 40000;  // GMMs are fitted on at most this many evenly strided pixels per side
    const KMEANS_ITERS = 8;
    const MIN_COMPONENT = 8;    // components with fewer samples are dropped
    const LOG2PI3 = 1.5 * Math.log(2 * Math.PI);

    // --- GMM -------------------------------------------------------------------------------------

    // Deterministic k-means (farthest-point seeding) on `idx` (pixel indices into lab). Returns a component per sample.
    function kmeans(lab, idx, k) {
        const n = idx.length;
        const cent = new Float64Array(k * 3);
        const assign = new Uint8Array(n);
        // Seed 0: the sample nearest the mean; then repeatedly the sample farthest from every seed.
        let mL = 0, mA = 0, mB = 0;
        for (let s = 0; s < n; s++) { const p = idx[s] * 3; mL += lab[p]; mA += lab[p + 1]; mB += lab[p + 2]; }
        mL /= n; mA /= n; mB /= n;
        const near = new Float64Array(n);
        let first = 0, bestD = Infinity;
        for (let s = 0; s < n; s++) {
            const p = idx[s] * 3, a = lab[p] - mL, b = lab[p + 1] - mA, c = lab[p + 2] - mB, d = a * a + b * b + c * c;
            if (d < bestD) { bestD = d; first = s; }
        }
        let used = 0;
        let pick = first;
        while (used < k) {
            const p = idx[pick] * 3;
            cent[used * 3] = lab[p]; cent[used * 3 + 1] = lab[p + 1]; cent[used * 3 + 2] = lab[p + 2];
            used++;
            let far = -1, farD = 0;
            for (let s = 0; s < n; s++) {
                const q = idx[s] * 3, j = (used - 1) * 3;
                const a = lab[q] - cent[j], b = lab[q + 1] - cent[j + 1], c = lab[q + 2] - cent[j + 2];
                const d = a * a + b * b + c * c;
                if (used === 1 || d < near[s]) near[s] = d;
                if (near[s] > farD) { farD = near[s]; far = s; }
            }
            if (far < 0) break; // every sample sits on a seed: fewer distinct colours than k
            pick = far;
        }
        for (let it = 0; it < KMEANS_ITERS; it++) {
            const sum = new Float64Array(used * 3), cnt = new Float64Array(used);
            for (let s = 0; s < n; s++) {
                const p = idx[s] * 3;
                let best = 0, bd = Infinity;
                for (let c = 0; c < used; c++) {
                    const a = lab[p] - cent[c * 3], b = lab[p + 1] - cent[c * 3 + 1], e = lab[p + 2] - cent[c * 3 + 2];
                    const d = a * a + b * b + e * e;
                    if (d < bd) { bd = d; best = c; }
                }
                assign[s] = best;
                sum[best * 3] += lab[p]; sum[best * 3 + 1] += lab[p + 1]; sum[best * 3 + 2] += lab[p + 2]; cnt[best]++;
            }
            for (let c = 0; c < used; c++) if (cnt[c] > 0) for (let j = 0; j < 3; j++) cent[c * 3 + j] = sum[c * 3 + j] / cnt[c];
        }
        return assign;
    }

    // Fit a GMM from samples and their component assignment. Each component: weight, mean, inverse covariance, log norm.
    function fitGMM(lab, idx, assign, k) {
        const comps = [];
        const n = idx.length;
        for (let c = 0; c < k; c++) {
            let cnt = 0, mL = 0, mA = 0, mB = 0;
            for (let s = 0; s < n; s++) if (assign[s] === c) { const p = idx[s] * 3; mL += lab[p]; mA += lab[p + 1]; mB += lab[p + 2]; cnt++; }
            if (cnt < MIN_COMPONENT) continue;
            mL /= cnt; mA /= cnt; mB /= cnt;
            let c00 = 0, c01 = 0, c02 = 0, c11 = 0, c12 = 0, c22 = 0;
            for (let s = 0; s < n; s++) {
                if (assign[s] !== c) continue;
                const p = idx[s] * 3, a = lab[p] - mL, b = lab[p + 1] - mA, e = lab[p + 2] - mB;
                c00 += a * a; c01 += a * b; c02 += a * e; c11 += b * b; c12 += b * e; c22 += e * e;
            }
            c00 = c00 / cnt + COV_FLOOR; c11 = c11 / cnt + COV_FLOOR; c22 = c22 / cnt + COV_FLOOR;
            c01 /= cnt; c02 /= cnt; c12 /= cnt;
            // Inverse of the symmetric 3x3 by cofactors.
            const i00 = c11 * c22 - c12 * c12, i01 = c02 * c12 - c01 * c22, i02 = c01 * c12 - c02 * c11;
            const det = c00 * i00 + c01 * i01 + c02 * i02;
            const i11 = c00 * c22 - c02 * c02, i12 = c01 * c02 - c00 * c12, i22 = c00 * c11 - c01 * c01;
            comps.push({
                mean: [mL, mA, mB],
                inv: [i00 / det, i01 / det, i02 / det, i11 / det, i12 / det, i22 / det],
                // log(weight) - 0.5 log det - 1.5 log 2pi
                logNorm: Math.log(cnt / n) - 0.5 * Math.log(det) - LOG2PI3,
            });
        }
        if (comps.length === 0) {
            // Samples spread too thin over the components: model them as one Gaussian.
            if (k > 1 && n >= MIN_COMPONENT) return fitGMM(lab, idx, new Uint8Array(n), 1);
            throw new Error("boxSelect: too few samples to fit a colour model");
        }
        return comps;
    }

    // log p(x) per component; returns the best component index via `out` and the log-sum-exp.
    function logLik(comps, L, A, B, best) {
        let mx = -Infinity;
        const n = comps.length;
        const vals = logLik.vals || (logLik.vals = new Float64Array(COMPONENTS));
        for (let c = 0; c < n; c++) {
            const m = comps[c].mean, v = comps[c].inv;
            const a = L - m[0], b = A - m[1], e = B - m[2];
            const q = a * (v[0] * a + v[1] * b + v[2] * e) + b * (v[1] * a + v[3] * b + v[4] * e) + e * (v[2] * a + v[4] * b + v[5] * e);
            const lv = comps[c].logNorm - 0.5 * q;
            vals[c] = lv;
            if (lv > mx) { mx = lv; if (best) best[0] = c; }
        }
        let s = 0;
        for (let c = 0; c < n; c++) s += Math.exp(vals[c] - mx);
        return mx + Math.log(s);
    }

    // Assign each sample to its most likely component of `comps`, then refit.
    function refit(lab, idx, comps) {
        const assign = new Uint8Array(idx.length), best = [0];
        for (let s = 0; s < idx.length; s++) {
            const p = idx[s] * 3;
            logLik(comps, lab[p], lab[p + 1], lab[p + 2], best);
            assign[s] = best[0];
        }
        return fitGMM(lab, idx, assign, comps.length);
    }

    function stride(list, max) {
        if (list.length <= max) return Int32Array.from(list);
        const out = new Int32Array(max), step = list.length / max;
        for (let s = 0; s < max; s++) out[s] = list[Math.floor(s * step)];
        return out;
    }

    // --- box selection ---------------------------------------------------------------------------

    function checkMask(m, n, name) {
        if (m === null || m === undefined) return null;
        if (typeof m.length !== "number" || m.length !== n) throw new RangeError("boxSelect: " + name + " hint must be a w*h mask");
        return m;
    }

    function boxSelect(work, rect, hints, tolerance) {
        if (!work || !work.lab || !(work.width > 0) || !(work.height > 0)) throw new TypeError("boxSelect: bad work image");
        if (typeof tolerance !== "number" || !(tolerance > 0) || !(tolerance < 150))
            throw new RangeError("boxSelect: tolerance must be a number in (0, 150), got " + tolerance);
        if (!rect || ![rect.x, rect.y, rect.w, rect.h].every((v) => typeof v === "number" && isFinite(v)))
            throw new RangeError("boxSelect: rect needs finite x, y, w, h");
        const W = work.width, H = work.height, N = W * H, lab = work.lab;
        if (!hints || typeof hints !== "object") throw new TypeError("boxSelect: hints must be {fg, bg} (each a mask or null)");
        const fgHint = checkMask(hints.fg, N, "fg");
        const bgHint = checkMask(hints.bg, N, "bg");
        const out = new Uint8Array(N);

        // A rect dragged up or left has negative w / h; snap outward to whole pixels.
        const ax = Math.min(rect.x, rect.x + rect.w), bx = Math.max(rect.x, rect.x + rect.w);
        const ay = Math.min(rect.y, rect.y + rect.h), by = Math.max(rect.y, rect.y + rect.h);
        const fx = Math.floor(ax), fy = Math.floor(ay);
        const r = IMW.clipRect({ x: fx, y: fy, w: Math.ceil(bx) - fx, h: Math.ceil(by) - fy }, W, H);
        if (!r) return out;
        const rx = r.x, ry = r.y, rw = r.w, rh = r.h, rn = rw * rh;

        // Background samples: the clipped band outside the rect (empty when the box fills the image).
        const bgOutside = [];
        const bx0 = Math.max(0, rx - BAND), by0 = Math.max(0, ry - BAND);
        const bx1 = Math.min(W, rx + rw + BAND), by1 = Math.min(H, ry + rh + BAND);
        for (let y = by0; y < by1; y++)
            for (let x = bx0; x < bx1; x++)
                if (x < rx || y < ry || x >= rx + rw || y >= ry + rh) bgOutside.push(y * W + x);

        // Rect-local labels: 1 = foreground. Start: everything fg except bg hints.
        const label = new Uint8Array(rn);
        const hard = new Int8Array(rn); // 1 fg hint, -1 bg hint
        for (let y = 0; y < rh; y++) {
            for (let x = 0; x < rw; x++) {
                const g = (ry + y) * W + rx + x, l = y * rw + x;
                if (bgHint && bgHint[g] > 0) hard[l] = -1;
                else if (fgHint && fgHint[g] > 0) hard[l] = 1;
                label[l] = hard[l] === -1 ? 0 : 1;
            }
        }
        // A rect covering the whole image has no outside: start the BAND px frame just inside it as
        // background instead (soft, unlike the outside, so the cut may still claim it).
        if (bgOutside.length === 0) {
            for (let y = 0; y < rh; y++)
                for (let x = 0; x < rw; x++)
                    if ((x < BAND || y < BAND || x >= rw - BAND || y >= rh - BAND) && hard[y * rw + x] !== 1) label[y * rw + x] = 0;
        }

        // Pairwise weights inside the rect, plus links to the outside (definite background).
        const right = new Float32Array(rn), down = new Float32Array(rn), diagR = new Float32Array(rn), diagL = new Float32Array(rn);
        const gamma = 50 * (1.5 - tolerance / 100);
        const d2 = (g, h2) => {
            const a = lab[g * 3] - lab[h2 * 3], b = lab[g * 3 + 1] - lab[h2 * 3 + 1], c = lab[g * 3 + 2] - lab[h2 * 3 + 2];
            return a * a + b * b + c * c;
        };
        // beta from every 8-neighbour pair touching the rect (inside-inside and inside-outside).
        let sum = 0, pairs = 0;
        const DX = [1, 0, 1, -1], DY = [0, 1, 1, 1];
        for (let y = ry - 1; y < ry + rh; y++) {
            for (let x = rx - 1; x < rx + rw + 1; x++) {
                if (x < 0 || y < 0 || x >= W) continue;
                for (let k = 0; k < 4; k++) {
                    const nx = x + DX[k], ny = y + DY[k];
                    if (nx < 0 || nx >= W || ny >= H) continue;
                    const aIn = x >= rx && x < rx + rw && y >= ry, bIn = nx >= rx && nx < rx + rw && ny >= ry && ny < ry + rh;
                    if (!aIn && !bIn) continue;
                    sum += d2(y * W + x, ny * W + nx); pairs++;
                }
            }
        }
        const meanD2 = pairs > 0 ? sum / pairs : 0;
        const beta = meanD2 > 0 ? 1 / (2 * meanD2) : 0;
        const SQ2 = Math.SQRT2;
        const wgt = (g, h2, dist) => gamma * Math.exp(-beta * d2(g, h2)) / dist;
        const outLink = new Float64Array(rn); // sum of links to outside neighbours
        for (let y = 0; y < rh; y++) {
            const gy = ry + y;
            for (let x = 0; x < rw; x++) {
                const gx = rx + x, g = gy * W + gx, l = y * rw + x;
                if (x + 1 < rw) right[l] = wgt(g, g + 1, 1);
                if (y + 1 < rh) down[l] = wgt(g, g + W, 1);
                if (x + 1 < rw && y + 1 < rh) diagR[l] = wgt(g, g + W + 1, SQ2);
                if (x > 0 && y + 1 < rh) diagL[l] = wgt(g, g + W - 1, SQ2);
                if (x === 0 || y === 0 || x === rw - 1 || y === rh - 1) {
                    for (let dy = -1; dy <= 1; dy++) {
                        for (let dx = -1; dx <= 1; dx++) {
                            const lx = x + dx, ly = y + dy;
                            if (lx >= 0 && ly >= 0 && lx < rw && ly < rh) continue; // inside
                            const ox = gx + dx, oy = gy + dy;
                            if (ox < 0 || oy < 0 || ox >= W || oy >= H) continue; // off the image
                            outLink[l] += wgt(g, oy * W + ox, dx !== 0 && dy !== 0 ? SQ2 : 1);
                        }
                    }
                }
            }
        }

        const source = new Float32Array(rn), sink = new Float32Array(rn);
        let fgComps = null, bgComps = null;
        for (let it = 0; it < ITERATIONS; it++) {
            const fgList = [], bgList = bgOutside.slice();
            for (let y = 0; y < rh; y++)
                for (let x = 0; x < rw; x++)
                    (label[y * rw + x] ? fgList : bgList).push((ry + y) * W + rx + x);
            // Too few pixels left on a side to fit a colour model: the current labels are the answer
            // (an almost empty foreground is then removed by cleanMask).
            if (fgList.length < MIN_COMPONENT || bgList.length < MIN_COMPONENT) break;
            const fgIdx = stride(fgList, FIT_SAMPLES), bgIdx = stride(bgList, FIT_SAMPLES);
            fgComps = fgComps ? refit(lab, fgIdx, fgComps) : fitGMM(lab, fgIdx, kmeans(lab, fgIdx, COMPONENTS), COMPONENTS);
            bgComps = bgComps ? refit(lab, bgIdx, bgComps) : fitGMM(lab, bgIdx, kmeans(lab, bgIdx, COMPONENTS), COMPONENTS);

            for (let y = 0; y < rh; y++) {
                for (let x = 0; x < rw; x++) {
                    const l = y * rw + x, p = ((ry + y) * W + rx + x) * 3;
                    if (hard[l] === 1) { source[l] = HARD; sink[l] = outLink[l]; continue; }
                    if (hard[l] === -1) { source[l] = 0; sink[l] = HARD; continue; }
                    // Cost of foreground = -log p_fg, of background = -log p_bg; keep only the difference.
                    const dFg = -logLik(fgComps, lab[p], lab[p + 1], lab[p + 2], null);
                    const dBg = -logLik(bgComps, lab[p], lab[p + 1], lab[p + 2], null);
                    const diff = dBg - dFg;
                    source[l] = diff > 0 ? diff : 0;
                    sink[l] = (diff < 0 ? -diff : 0) + outLink[l];
                }
            }
            const cut = IMW.gridMaxflow(rw, rh, source, sink, right, down, diagR, diagL);
            let changed = 0;
            for (let l = 0; l < rn; l++) { if (cut[l] !== label[l]) changed++; label[l] = cut[l]; }
            if (changed === 0) break; // converged: another round would refit the same models
        }

        for (let y = 0; y < rh; y++)
            for (let x = 0; x < rw; x++)
                if (label[y * rw + x]) out[(ry + y) * W + rx + x] = 255;
        const clean = IMW.cleanMask(out, W, H);
        // cleanMask's smoothing may spill one pixel past the rect; outside stays 0.
        out.fill(0);
        for (let y = 0; y < rh; y++)
            for (let x = 0; x < rw; x++) {
                const g = (ry + y) * W + rx + x;
                out[g] = clean[g];
            }
        return out;
    }

    IMW.boxSelect = boxSelect;
    if (typeof module !== "undefined") module.exports = IMW;
})(typeof window !== "undefined" ? window : globalThis);
