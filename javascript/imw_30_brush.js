(function (root) {
    "use strict";
    const IMW = root.IMW = root.IMW || {};

    const TOLERANCES = [10, 20, 30, 40, 50, 60, 70, 80];
    const DEFAULT_TOLERANCE = 40;

    // Cost constants. Step cost into pixel q:
    //     EDGE_WEIGHT * edge[q] * gate(d) + max(0, d - T) / COLOUR_DIVISOR,   T = tolerance * T_PER_TOLERANCE
    // where d is the Lab distance (dE76) from q to the nearest seed-colour cluster and
    //     gate(d) = clamp((d - GATE_LO*T) / ((GATE_HI - GATE_LO)*T), 0, 1).
    // Pixels whose total path cost is <= 1 + tolerance/40 are selected.
    //
    // Final values and why (tuned on the brush tests plus a sweep of harder fixtures: a background only
    // dE 11.5 from one stripe colour, and a disk with +-25% / +-40% brightness shading):
    // - The brief's ungated `edge * 4` selects only the stroke itself (IoU 0.055): a multi-colour subject
    //   is full of internal edges (the edge map is normalised to its 99th percentile, so stripe edges
    //   read 0.4..0.9), and 80 px of them costs far more than the threshold. The gate fixes that: an
    //   edge only costs when the pixel's colour is not already explained by the stroke's palette. An
    //   edge between two colours the stroke covered is texture; an edge into a colour it did not cover
    //   is a boundary.
    // - GATE_LO/HI = 0.25/0.75 of T: below a quarter of T (noise, at tolerance 40 that is dE 5) edges
    //   are free; from three quarters of T up they cost in full. A tighter gate (0.2/0.6) cut reach on
    //   the shaded disk by about 0.15 IoU.
    // - EDGE_WEIGHT = 12 (brief: 4): with the gate the edge term only acts on boundary pixels, so it
    //   can be strong. On the near-colour background at tolerance 40, weight 4 leaked into 15% of the
    //   image (IoU 0.63), 8 into 2%, 12 into 0% (IoU 0.99); at tolerance 50 weight 12 leaks 4%, 16 leaks
    //   1%. The cost of a higher weight is reach on shaded subjects (+-25% shading at tolerance 40:
    //   IoU 0.86 at weight 4, 0.79 at 12), which the user recovers with another stroke or more
    //   tolerance. 12 is the compromise.
    // - T_PER_TOLERANCE = 0.5, COLOUR_DIVISOR = 10, threshold 1 + tolerance/40: as in the brief. A
    //   divisor of 5 changed nothing measurable; a smaller T (0.4) mostly cut reach. Down-weighting
    //   lightness in d helped shading but made a lighter look-alike background leak, so plain dE76 stays.
    // - Diagonal steps cost sqrt(2) times a straight step so the growth is not diamond-shaped.
    const EDGE_WEIGHT = 12;
    const COLOUR_DIVISOR = 10;
    const T_PER_TOLERANCE = 0.5;
    const GATE_LO = 0.25, GATE_HI = 0.75;
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
        const k = centres.length / 3;

        // Per-pixel step cost into q.
        const step = new Float32Array(n);
        for (let q = 0; q < n; q++) {
            const L = lab[q * 3], A = lab[q * 3 + 1], B = lab[q * 3 + 2];
            let bd = Infinity;
            for (let c = 0; c < k; c++) {
                const d = (L - centres[c * 3]) ** 2 + (A - centres[c * 3 + 1]) ** 2 + (B - centres[c * 3 + 2]) ** 2;
                if (d < bd) bd = d;
            }
            const d = Math.sqrt(bd);
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
        return IMW.cleanMask(out, w, h);
    }

    IMW.TOLERANCES = TOLERANCES;
    IMW.DEFAULT_TOLERANCE = DEFAULT_TOLERANCE;
    IMW.strokeSeeds = strokeSeeds;
    IMW.brushSelect = brushSelect;
    if (typeof module !== "undefined") module.exports = IMW;
})(typeof window !== "undefined" ? window : globalThis);
