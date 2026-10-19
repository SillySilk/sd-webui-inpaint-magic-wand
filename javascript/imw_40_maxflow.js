(function (root) {
    "use strict";
    const IMW = root.IMW = root.IMW || {};

    // Boykov-Kolmogorov max-flow on an 8-connected w x h grid (search trees with the timestamp / distance
    // heuristic, as in Kolmogorov's maxflow and OpenCV's GCGraph). Node i's edge in direction d goes to
    // i + OFF[d]; the reverse of direction d is 7 - d.
    //   d: 0 (-1,-1)  1 (0,-1)  2 (+1,-1)  3 (-1,0)  4 (+1,0)  5 (-1,+1)  6 (0,+1)  7 (+1,+1)
    const DX = [-1, 0, 1, -1, 1, -1, 0, 1];
    const DY = [-1, -1, -1, 0, 0, 1, 1, 1];
    const NONE = -1, TERMINAL = -2, ORPHAN = -3;

    function gridMaxflow(w, h, source, sink, right, down, diagR, diagL) {
        if (!(Number.isInteger(w) && Number.isInteger(h) && w > 0 && h > 0)) throw new RangeError("gridMaxflow: bad size " + w + "x" + h);
        const n = w * h;
        for (const a of [source, sink, right, down, diagR, diagL])
            if (!a || a.length !== n) throw new RangeError("gridMaxflow: every array must have w*h = " + n + " entries");

        const off = DX.map((dx, d) => DY[d] * w + dx);
        const cap = new Float64Array(n * 8);   // residual capacity of edge (i, d)
        const valid = new Uint8Array(n);       // bit d set when neighbour d exists
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const i = y * w + x;
                let bits = 0;
                for (let d = 0; d < 8; d++) {
                    const nx = x + DX[d], ny = y + DY[d];
                    if (nx >= 0 && ny >= 0 && nx < w && ny < h) bits |= 1 << d;
                }
                valid[i] = bits;
                // Symmetric links: store each in both directions.
                if (x + 1 < w) { cap[i * 8 + 4] = right[i]; cap[(i + 1) * 8 + 3] = right[i]; }
                if (y + 1 < h) { cap[i * 8 + 6] = down[i]; cap[(i + w) * 8 + 1] = down[i]; }
                if (x + 1 < w && y + 1 < h) { cap[i * 8 + 7] = diagR[i]; cap[(i + w + 1) * 8 + 0] = diagR[i]; }
                if (x > 0 && y + 1 < h) { cap[i * 8 + 5] = diagL[i]; cap[(i + w - 1) * 8 + 2] = diagL[i]; }
            }
        }

        const tr = new Float64Array(n);    // >0: residual from the source, <0: residual to the sink
        const tree = new Uint8Array(n);    // 0: source tree, 1: sink tree (meaningful when parent != NONE)
        const parent = new Int32Array(n).fill(NONE); // direction to the parent, or TERMINAL / ORPHAN / NONE
        const ts = new Int32Array(n), dist = new Int32Array(n);
        const queue = new Int32Array(n);   // FIFO ring of active nodes
        const inQueue = new Uint8Array(n);
        let qHead = 0, qLen = 0;
        const push = (i) => { if (!inQueue[i]) { inQueue[i] = 1; queue[(qHead + qLen) % n] = i; qLen++; } };
        const orphans = new Int32Array(n);
        let nOrph = 0;

        for (let i = 0; i < n; i++) tr[i] = source[i] - sink[i]; // the common part goes straight from source to sink
        // Saturate the one-link paths source -> i -> j -> sink up front: on noisy data most augmenting
        // paths are this short, and pushing them here is far cheaper than one tree search each.
        for (let i = 0; i < n; i++) {
            if (!(tr[i] > 0)) continue;
            const bits = valid[i];
            for (let d = 0; d < 8 && tr[i] > 0; d++) {
                if (!(bits & (1 << d))) continue;
                const j = i + off[d];
                if (!(tr[j] < 0)) continue;
                const c = cap[i * 8 + d];
                if (c === 0) continue;
                const f = Math.min(tr[i], -tr[j], c);
                tr[i] -= f; tr[j] += f;
                cap[i * 8 + d] = c - f; cap[j * 8 + 7 - d] += f;
            }
        }
        for (let i = 0; i < n; i++) {
            const t = tr[i];
            if (t !== 0) { tree[i] = t > 0 ? 0 : 1; parent[i] = TERMINAL; dist[i] = 1; push(i); }
        }

        let time = 0;
        for (;;) {
            // Grow the trees until they touch: path edge (from, dir) runs source side -> sink side.
            let pFrom = -1, pDir = -1;
            while (qLen > 0) {
                const v = queue[qHead];
                if (parent[v] !== NONE) {
                    const vt = tree[v], bits = valid[v];
                    for (let d = 0; d < 8; d++) {
                        if (!(bits & (1 << d))) continue;
                        const u = v + off[d];
                        // Residual in the tree's direction: v -> u for the source tree, u -> v for the sink tree.
                        if ((vt === 0 ? cap[v * 8 + d] : cap[u * 8 + 7 - d]) === 0) continue;
                        if (parent[u] === NONE) {
                            tree[u] = vt; parent[u] = 7 - d; ts[u] = ts[v]; dist[u] = dist[v] + 1; push(u);
                        } else if (tree[u] !== vt) {
                            if (vt === 0) { pFrom = v; pDir = d; } else { pFrom = u; pDir = 7 - d; }
                            break;
                        } else if (dist[u] > dist[v] + 1 && ts[u] <= ts[v]) {
                            parent[u] = 7 - d; ts[u] = ts[v]; dist[u] = dist[v] + 1;
                        }
                    }
                    if (pFrom >= 0) break;
                }
                inQueue[v] = 0; qHead = (qHead + 1) % n; qLen--;
            }
            if (pFrom < 0) break;

            // Bottleneck along source-root ... pFrom -> pTo ... sink-root.
            const pTo = pFrom + off[pDir];
            let min = cap[pFrom * 8 + pDir];
            for (let v = pFrom; ; ) { // source side: edges parent -> v
                const d = parent[v];
                if (d === TERMINAL) { if (tr[v] < min) min = tr[v]; break; }
                const p = v + off[d];
                const c = cap[p * 8 + 7 - d];
                if (c < min) min = c;
                v = p;
            }
            for (let v = pTo; ; ) { // sink side: edges v -> parent
                const d = parent[v];
                if (d === TERMINAL) { if (-tr[v] < min) min = -tr[v]; break; }
                const c = cap[v * 8 + d];
                if (c < min) min = c;
                v += off[d];
            }

            // Push the flow; saturated tree edges make orphans.
            cap[pFrom * 8 + pDir] -= min; cap[pTo * 8 + 7 - pDir] += min;
            for (let v = pFrom; ; ) {
                const d = parent[v];
                if (d === TERMINAL) {
                    tr[v] -= min;
                    if (tr[v] === 0) { parent[v] = ORPHAN; orphans[nOrph++] = v; }
                    break;
                }
                const p = v + off[d];
                cap[v * 8 + d] += min;
                if ((cap[p * 8 + 7 - d] -= min) === 0) { parent[v] = ORPHAN; orphans[nOrph++] = v; }
                v = p;
            }
            for (let v = pTo; ; ) {
                const d = parent[v];
                if (d === TERMINAL) {
                    tr[v] += min;
                    if (tr[v] === 0) { parent[v] = ORPHAN; orphans[nOrph++] = v; }
                    break;
                }
                const p = v + off[d];
                cap[p * 8 + 7 - d] += min;
                if ((cap[v * 8 + d] -= min) === 0) { parent[v] = ORPHAN; orphans[nOrph++] = v; }
                v = p;
            }

            // Adopt the orphans.
            time++;
            while (nOrph > 0) {
                const v = orphans[--nOrph];
                const vt = tree[v], bits = valid[v];
                let best = -1, bestDist = 0x7fffffff;
                for (let d = 0; d < 8; d++) {
                    if (!(bits & (1 << d))) continue;
                    const u = v + off[d];
                    // Candidate parent u needs residual u -> v (source tree) or v -> u (sink tree).
                    if ((vt === 0 ? cap[u * 8 + 7 - d] : cap[v * 8 + d]) === 0) continue;
                    if (tree[u] !== vt || parent[u] === NONE) continue;
                    // Distance from u to its terminal, or invalid if the chain hits an orphan.
                    let k = 0, a = u, ok = true;
                    for (;;) {
                        if (ts[a] === time) { k += dist[a]; break; }
                        const pd = parent[a];
                        k++;
                        if (pd === TERMINAL) { ts[a] = time; dist[a] = 1; break; }
                        if (pd === ORPHAN || pd === NONE) { ok = false; break; }
                        a += off[pd];
                    }
                    if (!ok) continue;
                    k++;
                    if (k < bestDist) { bestDist = k; best = d; }
                    // Stamp the chain so later searches stop early.
                    for (let a2 = u, k2 = k - 1; ts[a2] !== time; a2 += off[parent[a2]]) { ts[a2] = time; dist[a2] = k2--; }
                }
                if (best >= 0) { parent[v] = best; ts[v] = time; dist[v] = bestDist; continue; }

                // No parent: v becomes free; its children become orphans, neighbours that could reach it re-activate.
                ts[v] = 0;
                parent[v] = NONE;
                for (let d = 0; d < 8; d++) {
                    if (!(bits & (1 << d))) continue;
                    const u = v + off[d];
                    const pu = parent[u];
                    if (tree[u] !== vt || pu === NONE) continue;
                    if ((vt === 0 ? cap[u * 8 + 7 - d] : cap[v * 8 + d]) !== 0) push(u);
                    if (pu >= 0 && u + off[pu] === v) { parent[u] = ORPHAN; orphans[nOrph++] = u; }
                }
            }
        }

        const out = new Uint8Array(n);
        for (let i = 0; i < n; i++) out[i] = parent[i] !== NONE && tree[i] === 0 ? 1 : 0;
        return out;
    }

    IMW.gridMaxflow = gridMaxflow;
    if (typeof module !== "undefined") module.exports = IMW;
})(typeof window !== "undefined" ? window : globalThis);
