(function (root) {
    "use strict";
    const IMW = root.IMW = root.IMW || {};

    const TOLERANCES = [10, 20, 30, 40, 50, 60, 70, 80];
    const DEFAULT_TOLERANCE = 40;

    // Cost model. Step cost into pixel q:
    //     EDGE_WEIGHT * edge[q] * gate(d) + max(0, d - T) / COLOUR_DIVISOR,   T = tolerance * T_PER_TOLERANCE
    //     d = max(dPixel, dLocal)
    //     gate(d) = clamp((d - GATE_LO*T) / ((GATE_HI - GATE_LO)*T), 0, 1)
    // dPixel: Lab distance (dE76) from q's colour to the nearest k-means cluster of the stroke's colours.
    // dLocal: distance from q's neighbourhood colour (mean Lab over a (2*LOCAL_RADIUS+1)^2 box) to the
    //   nearest blend of two neighbourhood-colour clusters of the stroke (segment distance; see blendDistance).
    // Pixels whose total path cost is <= 1 + tolerance/40 are selected, then a rim of LOCAL_RADIUS px whose
    // dPixel <= T is added back (the box straddles the outline, so dLocal stops growth a few px short), then
    // cleanMask.
    //
    // Why (measured on the brush tests plus a sweep: 3 px and 12 px stripes; flat backgrounds shifted from
    // SKIN by dE 3.7 / 5.5 / 7.3 / 10.9 touching the disk; +-25% brightness shading):
    // - The brief's ungated `edge * 4` selects only the stroke (IoU 0.055): a multi-colour subject is full
    //   of internal edges (99th-percentile-normalised, stripe edges read 0.4..0.9). The gate makes an edge
    //   cost only on pixels the stroke's palette does not explain.
    // - Pixel colour alone cannot tell a look-alike background from the subject: a background dE 5 from
    //   SKIN is "explained" by the skin cluster, and where it touches a skin stripe there is no edge at all
    //   (the disk boundary's mean edge, 0.36, is weaker than the interior texture's, median 0.59). With the
    //   pixel term only, dE <= 5.5 at tolerance 40 flooded 74% of the image. The neighbourhood term is
    //   what separates them: inside a striped subject the neighbourhood colour is a mix of the stripes, a
    //   flat background's is pure. Look-alike at tolerance 40 now: 3 px stripes leak 0.6-0.7% (IoU 0.97-0.98)
    //   for dE 3.7-10.9; 12 px stripes leak 2.7 / 2.1 / 1.6 / 1.4% (IoU 0.91-0.95).
    // - The real limit: when the subject has a large flat area of the look-alike colour (wide stripes, a
    //   face against a skin-coloured wall), its neighbourhood colour is pure too, so only edges and the
    //   rim separate them. Expect a few % leak at tolerance 40, more at 50 (12 px stripes, dE 3.7: 5.0%).
    // - Blends, not just clusters, for dLocal: with 12 px stripes the stroke's neighbourhood colours run
    //   continuously between stripe colours; nearest-cluster distance cut the flat-background IoU to 0.38.
    // - LOCAL_RADIUS 3: 2 lost reach at tolerance 30 (IoU 0.81); 4 leaked more with 12 px stripes (3.0%
    //   vs 2.1% at dE 5.5).
    // - EDGE_WEIGHT 12 (brief: 4): 4 and 8 leak more with 12 px stripes at dE 5.5, tolerance 40 (3.8% /
    //   2.7% vs 2.1%); the price is reach on shaded subjects (+-25%, tolerance 40: IoU 0.89 at 4, 0.83 at 12),
    //   which another stroke or more tolerance recovers.
    // - GATE_LO/HI 0.25/0.75 of T: below a quarter of T (noise; dE 5 at tolerance 40) edges are free. A
    //   tighter gate (0.2/0.6) cut reach on the shaded disk by about 0.15 IoU.
    // - T_PER_TOLERANCE 0.5, COLOUR_DIVISOR 10, threshold 1 + tolerance/40: as in the brief. Divisor 5
    //   changed nothing measurable; T 0.4 mostly cut reach; down-weighting lightness helped shading but made
    //   a lighter look-alike background leak.
    // - Diagonal steps cost sqrt(2) times a straight step so the growth is not diamond-shaped.
    const EDGE_WEIGHT = 12;
    const COLOUR_DIVISOR = 10;
    const T_PER_TOLERANCE = 0.5;
    const GATE_LO = 0.25, GATE_HI = 0.75;
    const LOCAL_RADIUS = 3;
    const KMEANS_SAMPLE = 4000;
    const KMEANS_ITERS = 10;

    // Paint the stroke polyline (work-pixel coordinates, pixel i covers [i, i+1)) with the given radius,
    // clipped to the image. The pixel under each point is always painted, so a zero-radius dab selects one pixel.
    function strokeSeeds(points, radius, w, h) {
        const m = new Uint8Array(w * h);
        if (!points || points.length === 0) return m;
        const r = Math.max(0, +radius || 0), r2 = r * r;
        const paint = (ax, ay, bx, by) => {
            const x0 = Math.max(0, Math.floor(Math.min(ax, bx) - r)), x1 = Math.min(w - 1, Math.ceil(Math.max(ax, bx) + r));
            const y0 = Math.max(0, Math.floor(Math.min(ay, by) - r)), y1 = Math.min(h - 1, Math.ceil(Math.max(ay, by) + r));
            const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
            for (let y = y0; y <= y1; y++) {
                const py = y + 0.5;
                for (let x = x0; x <= x1; x++) {
                    const px = x + 0.5;
                    let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
                    t = t < 0 ? 0 : t > 1 ? 1 : t;
                    const ex = ax + t * dx - px, ey = ay + t * dy - py;
                    if (ex * ex + ey * ey <= r2) m[y * w + x] = 255;
                }
            }
        };
        for (let i = 0; i < points.length; i++) {
            const a = points[i], b = points[Math.min(i + 1, points.length - 1)];
            if (!isFinite(a.x) || !isFinite(a.y) || !isFinite(b.x) || !isFinite(b.y)) continue;
            if (r > 0) paint(a.x, a.y, b.x, b.y);
            const fx = Math.floor(a.x), fy = Math.floor(a.y);
            if (fx >= 0 && fy >= 0 && fx < w && fy < h) m[fy * w + fx] = 255;
        }
        return m;
    }

    // k-means in Lab over (a deterministic subsample of) the seed pixels. Returns Float32Array k*3 centres.
    function colourModel(lab, seedIdx) {
        const n = seedIdx.length;
        const k = Math.max(1, Math.min(5, Math.floor(n / 50)));
        const step = Math.max(1, Math.floor(n / KMEANS_SAMPLE));
        const sample = [];
        for (let i = 0; i < n; i += step) sample.push(seedIdx[i]);
        const m = sample.length;
        const centres = new Float32Array(k * 3);
        const near = new Float32Array(m).fill(Infinity);
        // Farthest-point initialisation, starting from the sample's mean-nearest pixel (deterministic).
        let first = sample[0];
        {
            let L = 0, A = 0, B = 0;
            for (const p of sample) { L += lab[p * 3]; A += lab[p * 3 + 1]; B += lab[p * 3 + 2]; }
            L /= m; A /= m; B /= m;
            let best = Infinity;
            for (const p of sample) {
                const d = (lab[p * 3] - L) ** 2 + (lab[p * 3 + 1] - A) ** 2 + (lab[p * 3 + 2] - B) ** 2;
                if (d < best) { best = d; first = p; }
            }
        }
        for (let c = 0; c < k; c++) {
            let pick = first;
            if (c > 0) {
                let far = -1;
                for (let i = 0; i < m; i++) if (near[i] > far) { far = near[i]; pick = sample[i]; }
            }
            centres[c * 3] = lab[pick * 3]; centres[c * 3 + 1] = lab[pick * 3 + 1]; centres[c * 3 + 2] = lab[pick * 3 + 2];
            for (let i = 0; i < m; i++) {
                const p = sample[i];
                const d = (lab[p * 3] - centres[c * 3]) ** 2 + (lab[p * 3 + 1] - centres[c * 3 + 1]) ** 2 + (lab[p * 3 + 2] - centres[c * 3 + 2]) ** 2;
                if (d < near[i]) near[i] = d;
            }
        }
        const sum = new Float64Array(k * 3), cnt = new Int32Array(k);
        for (let it = 0; it < KMEANS_ITERS; it++) {
            sum.fill(0); cnt.fill(0);
            for (let i = 0; i < m; i++) {
                const p = sample[i];
                let best = 0, bd = Infinity;
                for (let c = 0; c < k; c++) {
                    const d = (lab[p * 3] - centres[c * 3]) ** 2 + (lab[p * 3 + 1] - centres[c * 3 + 1]) ** 2 + (lab[p * 3 + 2] - centres[c * 3 + 2]) ** 2;
                    if (d < bd) { bd = d; best = c; }
                }
                sum[best * 3] += lab[p * 3]; sum[best * 3 + 1] += lab[p * 3 + 1]; sum[best * 3 + 2] += lab[p * 3 + 2];
                cnt[best]++;
            }
            for (let c = 0; c < k; c++) {
                if (cnt[c] === 0) continue;
                centres[c * 3] = sum[c * 3] / cnt[c]; centres[c * 3 + 1] = sum[c * 3 + 1] / cnt[c]; centres[c * 3 + 2] = sum[c * 3 + 2] / cnt[c];
            }
        }
        return centres;
    }

    // Binary min-heap of (cost, pixel) with parallel typed arrays.
    function Heap(cap) {
        this.cost = new Float32Array(cap);
        this.idx = new Int32Array(cap);
        this.size = 0;
    }
    Heap.prototype.push = function (c, p) {
        if (this.size === this.cost.length) {
            const nc = new Float32Array(this.size * 2); nc.set(this.cost); this.cost = nc;
            const ni = new Int32Array(this.size * 2); ni.set(this.idx); this.idx = ni;
        }
        const cost = this.cost, idx = this.idx;
        let i = this.size++;
        while (i > 0) {
            const par = (i - 1) >> 1;
            if (cost[par] <= c) break;
            cost[i] = cost[par]; idx[i] = idx[par]; i = par;
        }
        cost[i] = c; idx[i] = p;
    };
    Heap.prototype.pop = function () { // returns pixel; cost of it in this.top
        const cost = this.cost, idx = this.idx;
        const p = idx[0];
        this.top = cost[0];
        const n = --this.size;
        if (n > 0) {
            const c = cost[n], q = idx[n];
            let i = 0;
            for (;;) {
                let ch = 2 * i + 1;
                if (ch >= n) break;
                if (ch + 1 < n && cost[ch + 1] < cost[ch]) ch++;
                if (cost[ch] >= c) break;
                cost[i] = cost[ch]; idx[i] = idx[ch]; i = ch;
            }
            cost[i] = c; idx[i] = q;
        }
        return p;
    };

    // Mean Lab over a (2r+1)^2 box around each pixel (separable running sums, borders clamped).
    function boxMeanLab(lab, w, h, r) {
        const tmp = new Float32Array(lab.length), out = new Float32Array(lab.length);
        const win = 2 * r + 1;
        for (let y = 0; y < h; y++) {
            for (let k = 0; k < 3; k++) {
                let sum = 0;
                for (let i = -r; i <= r; i++) sum += lab[(y * w + Math.min(w - 1, Math.max(0, i))) * 3 + k];
                for (let x = 0; x < w; x++) {
                    tmp[(y * w + x) * 3 + k] = sum / win;
                    sum += lab[(y * w + Math.min(w - 1, x + r + 1)) * 3 + k] - lab[(y * w + Math.max(0, x - r)) * 3 + k];
                }
            }
        }
        for (let x = 0; x < w; x++) {
            for (let k = 0; k < 3; k++) {
                let sum = 0;
                for (let i = -r; i <= r; i++) sum += tmp[(Math.min(h - 1, Math.max(0, i)) * w + x) * 3 + k];
                for (let y = 0; y < h; y++) {
                    out[(y * w + x) * 3 + k] = sum / win;
                    sum += tmp[(Math.min(h - 1, y + r + 1) * w + x) * 3 + k] - tmp[(Math.max(0, y - r) * w + x) * 3 + k];
                }
            }
        }
        return out;
    }

    function nearestDistance(lab, q, centres) {
        const L = lab[q * 3], A = lab[q * 3 + 1], B = lab[q * 3 + 2];
        let bd = Infinity;
        for (let c = 0; c < centres.length; c += 3) {
            const d = (L - centres[c]) ** 2 + (A - centres[c + 1]) ** 2 + (B - centres[c + 2]) ** 2;
            if (d < bd) bd = d;
        }
        return Math.sqrt(bd);
    }

    // Distance from pixel q's colour to the nearest point on any segment between two centres (or a centre):
    // the colour counts as explained when it is a blend of two colours the model holds.
    function blendDistance(lab, q, centres) {
        const L = lab[q * 3], A = lab[q * 3 + 1], B = lab[q * 3 + 2];
        const k = centres.length / 3;
        let bd = Infinity;
        for (let i = 0; i < k; i++) {
            const ai = i * 3;
            const d0 = (L - centres[ai]) ** 2 + (A - centres[ai + 1]) ** 2 + (B - centres[ai + 2]) ** 2;
            if (d0 < bd) bd = d0;
            for (let j = i + 1; j < k; j++) {
                const bj = j * 3;
                const ux = centres[bj] - centres[ai], uy = centres[bj + 1] - centres[ai + 1], uz = centres[bj + 2] - centres[ai + 2];
                const uu = ux * ux + uy * uy + uz * uz;
                if (uu < 1e-6) continue;
                let t = ((L - centres[ai]) * ux + (A - centres[ai + 1]) * uy + (B - centres[ai + 2]) * uz) / uu;
                if (t <= 0 || t >= 1) continue;
                const ex = L - centres[ai] - t * ux, ey = A - centres[ai + 1] - t * uy, ez = B - centres[ai + 2] - t * uz;
                const d = ex * ex + ey * ey + ez * ez;
                if (d < bd) bd = d;
            }
        }
        return Math.sqrt(bd);
    }

    function brushSelect(work, seeds, tolerance) {
        const w = work.width, h = work.height, n = w * h, lab = work.lab, edge = work.edge;
        const seedIdx = [];
        for (let i = 0; i < n; i++) if (seeds[i] > 0) seedIdx.push(i);
        if (seedIdx.length === 0) return new Uint8Array(n);

        const tol = +tolerance;
        if (!(tol > 0) || !isFinite(tol)) throw new RangeError("brushSelect: tolerance must be a positive number, got " + tolerance);
        const T = tol * T_PER_TOLERANCE;
        const accept = 1 + tol / 40;
        const centres = colourModel(lab, seedIdx);
        const local = boxMeanLab(lab, w, h, LOCAL_RADIUS);
        const localCentres = colourModel(local, seedIdx);

        // Per-pixel step cost into q.
        const step = new Float32Array(n);
        const rawOk = new Uint8Array(n);
        for (let q = 0; q < n; q++) {
            const dRaw = nearestDistance(lab, q, centres);
            rawOk[q] = dRaw <= T ? 1 : 0;
            const d = Math.max(dRaw, blendDistance(local, q, localCentres));
            let g = (d - T * GATE_LO) / (T * (GATE_HI - GATE_LO));
            g = g < 0 ? 0 : g > 1 ? 1 : g;
            step[q] = edge[q] * EDGE_WEIGHT * g + Math.max(0, d - T) / COLOUR_DIVISOR;
        }

        // Geodesic growth (Dijkstra, 8-neighbour) from all seeds; diagonal steps cost sqrt(2) times as much.
        const dist = new Float32Array(n).fill(Infinity);
        const heap = new Heap(Math.max(1024, seedIdx.length * 2));
        for (const s of seedIdx) { dist[s] = 0; heap.push(0, s); }
        const out = new Uint8Array(n);
        const D = Math.SQRT2;
        while (heap.size > 0) {
            const p = heap.pop();
            const cp = heap.top;
            if (cp > dist[p] || out[p]) continue;
            out[p] = 255;
            const x = p % w, y = (p - x) / w;
            for (let dy = -1; dy <= 1; dy++) {
                const ny = y + dy;
                if (ny < 0 || ny >= h) continue;
                for (let dx = -1; dx <= 1; dx++) {
                    if (dx === 0 && dy === 0) continue;
                    const nx = x + dx;
                    if (nx < 0 || nx >= w) continue;
                    const q = ny * w + nx;
                    if (out[q]) continue;
                    const c = cp + step[q] * (dx !== 0 && dy !== 0 ? D : 1);
                    if (c <= accept && c < dist[q]) { dist[q] = c; heap.push(c, q); }
                }
            }
        }
        // Rim recovery: the neighbourhood term is diluted within LOCAL_RADIUS of the subject's outline (the box
        // straddles the boundary), so the growth stops a few px short. Add back pixels within that distance of
        // the selection whose own colour is in the palette.
        const near = IMW.growMask(out, w, h, LOCAL_RADIUS);
        for (let i = 0; i < n; i++) if (near[i] && rawOk[i]) out[i] = 255;
        return IMW.cleanMask(out, w, h);
    }

    IMW.TOLERANCES = TOLERANCES;
    IMW.DEFAULT_TOLERANCE = DEFAULT_TOLERANCE;
    IMW.strokeSeeds = strokeSeeds;
    IMW.brushSelect = brushSelect;
    if (typeof module !== "undefined") module.exports = IMW;
})(typeof window !== "undefined" ? window : globalThis);
